// @vitest-environment node
/**
 * Every /api/assets handler: Node runtime, never statically cached, and the
 * request guard runs before anything else, so another website (or another
 * machine) never reaches the library.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/assets/server", async (importOriginal) =>
  (await import("./support")).mockFacade(await importOriginal()),
);
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as facade from "@/lib/assets/server";
import * as assetFile from "../[id]/file/route";
import * as poster from "../[id]/poster/route";
import * as asset from "../[id]/route";
import * as assetWorkflow from "../[id]/workflow/route";
import * as bulk from "../bulk/route";
import * as cleanup from "../cleanup/route";
import * as exists from "../exists/route";
import * as exportAssets from "../export/route";
import * as facets from "../facets/route";
import * as importProjects from "../import/route";
import * as job from "../jobs/[jobId]/route";
import * as library from "../library/route";
import * as media from "../media/[sha256]/route";
import * as mediaHas from "../media/has/route";
import * as reveal from "../reveal/route";
import * as root from "../route";
import * as run from "../runs/[runId]/route";
import * as thumb from "../thumb/[sha256]/route";
import * as upload from "../uploads/[uploadId]/route";
import * as workflowEntry from "../workflows/[workflowId]/route";
import { ASSET_ID, RUN_ID, SHA, crossSite, ctx, unvouch, vouch } from "./support";

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

const ROUTES: { path: string; module: Record<string, unknown>; params: Record<string, string> }[] = [
  { path: "/api/assets", module: root, params: {} },
  { path: "/api/assets/facets", module: facets, params: {} },
  { path: `/api/assets/${ASSET_ID}`, module: asset, params: { id: ASSET_ID } },
  { path: `/api/assets/${ASSET_ID}/file`, module: assetFile, params: { id: ASSET_ID } },
  { path: `/api/assets/${ASSET_ID}/poster`, module: poster, params: { id: ASSET_ID } },
  { path: `/api/assets/${ASSET_ID}/workflow`, module: assetWorkflow, params: { id: ASSET_ID } },
  { path: "/api/assets/uploads/up_1", module: upload, params: { uploadId: "up_1" } },
  { path: `/api/assets/thumb/${SHA}?w=320`, module: thumb, params: { sha256: SHA } },
  { path: "/api/assets/bulk", module: bulk, params: {} },
  { path: "/api/assets/exists", module: exists, params: {} },
  { path: "/api/assets/reveal", module: reveal, params: {} },
  { path: "/api/assets/media/has", module: mediaHas, params: {} },
  { path: `/api/assets/media/${SHA}`, module: media, params: { sha256: SHA } },
  { path: `/api/assets/runs/${RUN_ID}`, module: run, params: { runId: RUN_ID } },
  { path: "/api/assets/workflows/wf_1", module: workflowEntry, params: { workflowId: "wf_1" } },
  { path: "/api/assets/library", module: library, params: {} },
  { path: "/api/assets/jobs/job_1", module: job, params: { jobId: "job_1" } },
  { path: "/api/assets/import", module: importProjects, params: {} },
  { path: "/api/assets/cleanup", module: cleanup, params: {} },
  { path: "/api/assets/export", module: exportAssets, params: {} },
];

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

beforeEach(vouch);
afterEach(() => {
  unvouch();
  vi.resetAllMocks();
});

describe("every /api/assets route", () => {
  it.each(ROUTES)("$path runs on Node and is never statically cached", ({ module }) => {
    expect(module.runtime).toBe("nodejs");
    expect(module.dynamic).toBe("force-dynamic");
  });

  it.each(ROUTES)("$path refuses another website before touching the library", async ({ path, module, params }) => {
    const handlers = METHODS.filter((method) => typeof module[method] === "function");
    expect(handlers.length).toBeGreaterThan(0);
    for (const method of handlers) {
      const response = await (module[method] as Handler)(crossSite(path, method), ctx(params));
      if (module === library && method === "GET") {
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ available: false, root: null });
      } else {
        expect(response.status, `${method} ${path}`).toBe(403);
        expect(await response.json()).toMatchObject({ code: "forbidden" });
      }
    }
    for (const fn of Object.values(facade)) {
      if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    }
  });

  it("gives uploads and url ingest ten minutes, job starts one", () => {
    expect(root.maxDuration).toBe(600);
    expect(upload.maxDuration).toBe(600);
    expect(media.maxDuration).toBe(600);
    expect(importProjects.maxDuration).toBe(60);
    expect(cleanup.maxDuration).toBe(60);
    expect(exportAssets.maxDuration).toBe(60);
  });
});
