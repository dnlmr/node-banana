/**
 * Shared by the /api/assets route tests: requests as Node Banana's page
 * sends them (stamped by the server, same-origin), route contexts, and a
 * facade whose functions are all mocks while LibraryError stays real.
 *
 * Usage in a test file:
 *
 *   vi.mock("@/lib/assets/server", async (importOriginal) =>
 *     (await import("./support")).mockFacade(await importOriginal()),
 *   );
 */

import { vi } from "vitest";

import { AGENT_LOCAL_HEADER, AGENT_LOCAL_SECRET_ENV } from "@/lib/agent/server/sameOrigin";
import type { AssetView, LibraryJobStatus } from "@/lib/assets/types";

export const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";
export const ORIGIN = "http://localhost:3000";

export const ASSET_ID = "a0123456789abc";
export const RUN_ID = "r0123456789abc";
export const SHA = "ab".repeat(32);

export function mockFacade(actual: Record<string, unknown>): Record<string, unknown> {
  const mocked: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    mocked[name] = typeof value === "function" && name !== "LibraryError" ? vi.fn() : value;
  }
  return mocked;
}

/** Call in beforeEach: the stamp secret server.js sets. */
export function vouch(): void {
  process.env[AGENT_LOCAL_SECRET_ENV] = SECRET;
}

export function unvouch(): void {
  delete process.env[AGENT_LOCAL_SECRET_ENV];
}

type PageInit = Omit<RequestInit, "headers" | "body"> & {
  headers?: Record<string, string>;
  /** Serialised as JSON unless it is already a body. */
  json?: unknown;
  body?: BodyInit | null;
};

/** A request from Node Banana's own page, over a loopback connection the server stamped. */
export function page(pathAndQuery: string, init: PageInit = {}): Request {
  const method = init.method ?? (init.json !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = {
    host: "localhost:3000",
    "sec-fetch-site": "same-origin",
    [AGENT_LOCAL_HEADER]: SECRET,
    ...(method !== "GET" && method !== "HEAD" ? { origin: ORIGIN } : {}),
    ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
    ...init.headers,
  };
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  const { json: _json, headers: _headers, body: _body, ...rest } = init;
  return new Request(`${ORIGIN}${pathAndQuery}`, {
    ...rest,
    method,
    headers,
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}

/** The same request from another website open in the browser. */
export function crossSite(pathAndQuery: string, method = "POST"): Request {
  return new Request(`${ORIGIN}${pathAndQuery}`, {
    method,
    headers: {
      host: "localhost:3000",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
      [AGENT_LOCAL_HEADER]: SECRET,
    },
  });
}

export function ctx<P extends Record<string, string>>(params: P): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}

export function assetView(overrides: Partial<AssetView> = {}): AssetView {
  return {
    v: 1,
    id: ASSET_ID,
    kind: "image",
    origin: "generated",
    mime: "image/png",
    ext: "png",
    bytes: 3,
    sha256: SHA,
    md5: "0".repeat(32),
    file: { root: "library", rel: "Generations/2026-09-27/120000_cat_abababab.png" },
    filename: "120000_cat_abababab.png",
    createdAt: 1,
    producer: { nodeId: "n1", nodeType: "nanoBanana" },
    workflowId: "wf_1",
    workflowName: "Cats",
    runId: RUN_ID,
    tags: [],
    favorite: false,
    workflow: { id: "wf_1", name: "Cats", projectPath: null },
    displayPath: "/Pictures/Node Banana/Generations/2026-09-27/120000_cat_abababab.png",
    ...overrides,
  };
}

export function jobStatus(overrides: Partial<LibraryJobStatus> = {}): LibraryJobStatus {
  return {
    id: "job_1",
    type: "import",
    state: "running",
    done: 0,
    total: 10,
    bytesDone: 0,
    bytesTotal: 0,
    startedAt: 1,
    ...overrides,
  };
}

/** Reads a stream the way the library would, to prove the route handed it over unread. */
export async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}
