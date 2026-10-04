// @vitest-environment node
/**
 * The older routes that read, write, list or reveal files by path answer
 * only Node Banana's own page on this computer, with the same guard (and the
 * same NB_LIBRARY_ALLOWED_HOSTS allowlist) as /api/assets. Otherwise another
 * device on the network, or another website through DNS rebinding, could read
 * the library's predictable Generations folder around the /api/assets guard.
 *
 * The guard is real here; the filesystem, child processes, the library facade
 * and fetch are mocks, so a refused request must leave every one untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { fsMocks, childMocks } = vi.hoisted(() => {
  // A mocked exec/execFile fails at once, so a request that gets past the guard never hangs.
  const failing = () =>
    vi.fn((...args: unknown[]) => {
      const callback = args[args.length - 1];
      if (typeof callback === "function") callback(new Error("not run in tests"));
    });
  return { fsMocks: {} as Record<string, ReturnType<typeof vi.fn>>, childMocks: { exec: failing(), execFile: failing() } };
});

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value === "function") fsMocks[name] = vi.fn();
  }
  return { ...fsMocks, default: fsMocks };
});
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked = { ...actual, ...childMocks };
  return { ...mocked, default: mocked };
});
vi.mock("@/lib/assets/server", async (importOriginal) =>
  (await import("../assets/__tests__/support")).mockFacade(await importOriginal()),
);
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { AGENT_LOCAL_HEADER } from "@/lib/agent/server/sameOrigin";
import * as facade from "@/lib/assets/server";
import { LIBRARY_ALLOWED_HOSTS_ENV, LIBRARY_GUARD_MESSAGE } from "@/lib/assets/server/guard";
import { SECRET, unvouch, vouch } from "../assets/__tests__/support";
import * as browseDirectory from "../browse-directory/route";
import * as listGenerations from "../list-generations/route";
import * as listWorkflows from "../list-workflows/route";
import * as loadGeneration from "../load-generation/route";
import * as openDirectory from "../open-directory/route";
import * as openFile from "../open-file/route";
import * as saveGeneration from "../save-generation/route";
import * as workflowImages from "../workflow-images/route";
import * as workflow from "../workflow/route";

type Handler = (request: NextRequest) => Promise<Response>;

const GENERATIONS = "/Users/me/Pictures/Node Banana/Generations/2026-09-27";

/** Every path-taking field these routes read, so a request that got through would do real work. */
const QUERY = new URLSearchParams({ path: GENERATIONS, workflowPath: "/Users/me/project", imageId: "101500_cat_deadbeef", load: "true", purpose: "library" });
const BODY = {
  directoryPath: GENERATIONS,
  imageId: "101500_cat_deadbeef",
  filename: "workflow",
  workflow: { nodes: [], edges: [] },
  workflowPath: "/Users/me/project",
  imageData: "data:image/png;base64,aGk=",
  image: "data:image/png;base64,aGk=",
  prompt: "cat",
  filePath: `${GENERATIONS}/101500_cat_deadbeef.png`,
  path: GENERATIONS,
};

const ROUTES: { path: string; module: Record<string, unknown> }[] = [
  { path: "/api/load-generation", module: loadGeneration },
  { path: "/api/list-generations", module: listGenerations },
  { path: "/api/workflow-images", module: workflowImages },
  { path: "/api/workflow", module: workflow },
  { path: "/api/list-workflows", module: listWorkflows },
  { path: "/api/save-generation", module: saveGeneration },
  { path: "/api/open-file", module: openFile },
  { path: "/api/open-directory", module: openDirectory },
  { path: "/api/browse-directory", module: browseDirectory },
];

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function handlersOf(module: Record<string, unknown>) {
  const handlers = METHODS.filter((method) => typeof module[method] === "function");
  expect(handlers.length).toBeGreaterThan(0);
  return handlers.map((method) => ({ method, handler: module[method] as Handler }));
}

function build(path: string, method: string, headers: Record<string, string>, host = "localhost:3000"): NextRequest {
  const read = method === "GET" || method === "HEAD";
  return new NextRequest(`http://${host}${path}${read ? `?${QUERY}` : ""}`, {
    method,
    headers: { host, ...(read ? {} : { "content-type": "application/json" }), ...headers },
    ...(read ? {} : { body: JSON.stringify(BODY) }),
  });
}

/** Another website open in the same browser, aimed at localhost (the stamp is there: it is the user's own browser). */
const crossSite = (path: string, method: string) =>
  build(path, method, { origin: "https://evil.example", "sec-fetch-site": "cross-site", [AGENT_LOCAL_HEADER]: SECRET });

/** Another device on the network: a LAN address, no Origin, no stamp. */
const fromLan = (path: string, method: string) => build(path, method, {}, "192.168.1.50:3000");

/** Node Banana's own page. */
const fromPage = (path: string, method: string) =>
  build(path, method, {
    "sec-fetch-site": "same-origin",
    [AGENT_LOCAL_HEADER]: SECRET,
    ...(method === "GET" ? {} : { origin: "http://localhost:3000" }),
  });

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vouch();
  // A request that gets through finds nothing on disk.
  for (const fn of Object.values(fsMocks)) fn.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
});

afterEach(() => {
  unvouch();
  delete process.env[LIBRARY_ALLOWED_HOSTS_ENV];
  fetchSpy.mockRestore();
  vi.clearAllMocks();
});

function expectUntouched() {
  for (const fn of [...Object.values(fsMocks), ...Object.values(childMocks), fetchSpy]) {
    expect(fn).not.toHaveBeenCalled();
  }
  for (const fn of Object.values(facade)) {
    if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
  }
}

describe("legacy file routes: request guard", () => {
  it.each(ROUTES)("$path refuses another website before touching anything", async ({ path, module }) => {
    for (const { method, handler } of handlersOf(module)) {
      const response = await handler(crossSite(path, method));
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toEqual({ error: LIBRARY_GUARD_MESSAGE, code: "forbidden" });
    }
    expectUntouched();
  });

  it.each(ROUTES)("$path refuses another device on the network", async ({ path, module }) => {
    for (const { method, handler } of handlersOf(module)) {
      const response = await handler(fromLan(path, method));
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toMatchObject({ code: "forbidden" });
    }
    expectUntouched();
  });

  it.each(ROUTES)("$path still answers Node Banana's own page", async ({ path, module }) => {
    for (const { method, handler } of handlersOf(module)) {
      const response = await handler(fromPage(path, method));
      const body = (await response.json()) as { code?: string };
      expect(body.code, `${method} ${path}`).not.toBe("forbidden");
    }
  });

  it("answers a LAN host listed in NB_LIBRARY_ALLOWED_HOSTS, like the library", async () => {
    process.env[LIBRARY_ALLOWED_HOSTS_ENV] = "192.168.1.50";
    fsMocks.readdir.mockResolvedValue(["101500_cat_deadbeef.png"]);
    const request = build("/api/list-generations", "GET", { referer: "http://192.168.1.50:3000/" }, "192.168.1.50:3000");
    const response = await (listGenerations.GET as Handler)(request);
    expect(await response.json()).toEqual({ success: true, ids: ["101500_cat_deadbeef"] });
  });
});
