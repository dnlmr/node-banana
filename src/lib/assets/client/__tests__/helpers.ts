/**
 * Shared fixtures for the asset client tests. jsdom's Blob cannot go through
 * Node's Response, so fetch mocks answer with plain Response-shaped objects.
 */

import { createHash } from "node:crypto";
import { vi } from "vitest";
import type { AssetView, LibraryStatus, RecordAssetResult } from "../../types";

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(init.headers),
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    blob: async () => new Blob([JSON.stringify(body)], { type: "application/json" }),
    clone() {
      return this;
    },
  } as unknown as Response;
}

export function blobResponse(blob: Blob, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers({ "Content-Type": blob.type }),
    json: async () => {
      throw new Error("not json");
    },
    text: async () => "",
    blob: async () => blob,
  } as unknown as Response;
}

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Stubs fetch with `handler` and records each call. */
export function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: FetchCall = { url: String(input), method: init.method ?? "GET", headers, body: init.body };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

/**
 * An in-memory stand-in for the snapshot media routes and blob: URLs:
 * `blobs` answers blob: fetches (delete an entry to "revoke" it), `media` is
 * the server's media store. `route` can answer any call first.
 */
export function fakeMediaServer(route?: (call: FetchCall) => Response | Promise<Response> | undefined) {
  const blobs = new Map<string, Blob>();
  const media = new Map<string, Blob>();
  const answer = async (call: FetchCall): Promise<Response> => {
    const answered = await route?.(call);
    if (answered) return answered;
    if (call.url === "/api/assets/media/has") {
      const { hashes } = jsonBody<{ hashes: string[] }>(call);
      return jsonResponse({ missing: hashes.filter((hash) => !media.has(hash)) });
    }
    const mediaRoute = /^\/api\/assets\/media\/([0-9a-f]{64})$/.exec(call.url);
    if (mediaRoute && call.method === "PUT") {
      const blob = call.body as Blob;
      const bytes = await readBytes(blob);
      if ((await sha256Of(bytes)) !== mediaRoute[1]) return jsonResponse({ error: "Hash mismatch" }, { status: 400 });
      media.set(mediaRoute[1], new Blob([bytes as BlobPart], { type: call.headers["x-nb-mime"] }));
      return jsonResponse({ sha256: mediaRoute[1], bytes: bytes.length });
    }
    if (mediaRoute) {
      const blob = media.get(mediaRoute[1]);
      return blob ? blobResponse(blob) : jsonResponse({ error: "Not found" }, { status: 404 });
    }
    return jsonResponse({ error: `Unexpected ${call.method} ${call.url}` }, { status: 500 });
  };
  const stub = stubFetch((call) => {
    // Like a real fetch, a blob: URL is resolved when fetch() is called.
    if (call.url.startsWith("blob:")) {
      const blob = blobs.get(call.url);
      return blob ? blobResponse(blob) : Promise.reject(new TypeError("Failed to fetch"));
    }
    return answer(call);
  });
  return { ...stub, blobs, media };
}

export function jsonBody<T = Record<string, unknown>>(call: FetchCall): T {
  return JSON.parse(String(call.body)) as T;
}

export function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

export function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Node's own hash, so tests can count the client's crypto.subtle calls. */
export async function sha256Of(bytes: Uint8Array | string): Promise<string> {
  return createHash("sha256").update(bytes).digest("hex");
}

export function dataUrlOf(text: string, mime = "image/png"): string {
  return `data:${mime};base64,${btoa(text)}`;
}

export function libraryStatus(overrides: Partial<LibraryStatus> = {}): LibraryStatus {
  return {
    available: true,
    root: "/Users/test/Pictures/Node Banana",
    source: "default",
    defaultRoot: "/Users/test/Pictures/Node Banana",
    cacheDir: "/Users/test/Library/Caches/Node Banana",
    platform: "darwin",
    synced: null,
    counts: { assets: 0, trashed: 0, bytes: 0 },
    empty: true,
    job: null,
    ...overrides,
  };
}

export function assetView(overrides: Partial<AssetView> = {}): AssetView {
  return {
    v: 1,
    id: "a0000000000001abcdefghij",
    kind: "image",
    origin: "generated",
    mime: "image/png",
    ext: "png",
    bytes: 5,
    sha256: "a".repeat(64),
    md5: "b".repeat(32),
    file: { root: "library", rel: "Generations/2026-09-27/143200_cat_aaaaaaaa.png" },
    filename: "143200_cat_aaaaaaaa.png",
    createdAt: Date.UTC(2026, 8, 27, 2, 32),
    prompt: "a cat",
    producer: { nodeId: "nanoBanana-1", nodeType: "nanoBanana" },
    workflowId: "wf_1_abc",
    workflowName: "Cats",
    runId: "r0000000000001abcdefghij",
    tags: [],
    favorite: false,
    workflow: { id: "wf_1_abc", name: "Cats", projectPath: null },
    displayPath: "/Users/test/Pictures/Node Banana/Generations/2026-09-27/143200_cat_aaaaaaaa.png",
    ...overrides,
  };
}

export function recordResult(asset: AssetView): RecordAssetResult {
  return { asset, filename: asset.filename, legacyId: asset.filename.replace(/\.[^.]+$/, ""), reusedFile: false };
}
