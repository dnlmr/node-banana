// @vitest-environment node
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/assets/server", async (importOriginal) =>
  (await import("./support")).mockFacade(await importOriginal()),
);
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as facade from "@/lib/assets/server";
import { LibraryError } from "@/lib/assets/server";
import { LIBRARY_GUARD_MESSAGE, LIBRARY_UNVOUCHED_MESSAGE } from "@/lib/assets/server/guard";
import type { LibraryStatus } from "@/lib/assets/types";
import { logger } from "@/utils/logger";
import { POST as cleanup } from "../cleanup/route";
import { POST as exportAssets } from "../export/route";
import { POST as importProjects } from "../import/route";
import { DELETE as cancelJob, GET as getJob } from "../jobs/[jobId]/route";
import { GET as getLibrary, PUT as putLibrary } from "../library/route";
import { PUT as putRun } from "../runs/[runId]/route";
import { PUT as putWorkflow } from "../workflows/[workflowId]/route";
import { ASSET_ID, RUN_ID, SHA, crossSite, ctx, jobStatus, page, unvouch, vouch } from "./support";

const DIR = path.resolve("/tmp-nb-assets", "Library");

const STATUS: LibraryStatus = {
  available: true,
  root: DIR,
  source: "default",
  defaultRoot: DIR,
  cacheDir: path.resolve("/tmp-nb-assets", "cache"),
  platform: process.platform,
  synced: null,
  counts: { assets: 2, trashed: 0, bytes: 10 },
  empty: false,
  job: null,
};

/** The shape GET /library answers with whenever the library cannot be used. */
const UNAVAILABLE = {
  available: false,
  root: null,
  source: "default",
  defaultRoot: "",
  cacheDir: "",
  platform: process.platform,
  synced: null,
  counts: { assets: 0, trashed: 0, bytes: 0 },
  empty: false,
  job: null,
};

beforeEach(vouch);
afterEach(() => {
  unvouch();
  vi.resetAllMocks();
});

describe("GET /api/assets/library", () => {
  it("answers the library status", async () => {
    vi.mocked(facade.getLibraryStatus).mockResolvedValue(STATUS);
    const response = await getLibrary(page("/api/assets/library"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(STATUS);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a refused request with 200 and available: false, revealing no folders", async () => {
    const response = await getLibrary(crossSite("/api/assets/library", "GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...UNAVAILABLE, reason: LIBRARY_GUARD_MESSAGE });
    expect(facade.getLibraryStatus).not.toHaveBeenCalled();
  });

  it("explains how to start Node Banana when the server cannot vouch for this machine", async () => {
    unvouch();
    const response = await getLibrary(page("/api/assets/library"));
    expect(await response.json()).toEqual({ ...UNAVAILABLE, reason: LIBRARY_UNVOUCHED_MESSAGE });
  });

  it("answers available: false with the reason when the status cannot be read", async () => {
    vi.mocked(facade.getLibraryStatus).mockRejectedValueOnce(new Error("EIO: i/o error"));
    const failed = await getLibrary(page("/api/assets/library"));
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual({ ...UNAVAILABLE, reason: "EIO: i/o error" });
    expect(logger.error).toHaveBeenCalled();

    vi.mocked(facade.getLibraryStatus).mockRejectedValueOnce(new LibraryError("Not yet.", 501, "not_implemented"));
    expect(await (await getLibrary(page("/api/assets/library"))).json()).toMatchObject({ available: false, reason: "Not yet." });
  });
});

describe("PUT /api/assets/library", () => {
  it("switches or moves the library to a folder", async () => {
    vi.mocked(facade.setLibraryRoot).mockResolvedValue(STATUS);
    const response = await putLibrary(page("/api/assets/library", { method: "PUT", json: { root: `${DIR}${path.sep}`, mode: "move" } }));
    expect(await response.json()).toEqual(STATUS);
    expect(facade.setLibraryRoot).toHaveBeenCalledWith({ root: DIR, mode: "move" });
  });

  it("refuses a relative or system folder", async () => {
    const relative = await putLibrary(page("/api/assets/library", { method: "PUT", json: { root: "Pictures", mode: "switch" } }));
    expect(relative.status).toBe(400);
    expect((await relative.json()).error).toBe("root: Path must be absolute.");
    expect(facade.setLibraryRoot).not.toHaveBeenCalled();
  });

  it("maps the library's refusal (an env override, a folder inside the library)", async () => {
    vi.mocked(facade.setLibraryRoot).mockRejectedValue(
      new LibraryError("The library folder is set by NODE_BANANA_ASSET_LIBRARY.", 409, "env_override"),
    );
    const response = await putLibrary(page("/api/assets/library", { method: "PUT", json: { root: DIR, mode: "switch" } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "The library folder is set by NODE_BANANA_ASSET_LIBRARY.",
      code: "env_override",
    });
  });

  it("is guarded like every other mutation", async () => {
    expect((await putLibrary(crossSite("/api/assets/library", "PUT"))).status).toBe(403);
  });
});

describe("/api/assets/jobs/[jobId]", () => {
  it("GET answers the job, or 404", async () => {
    vi.mocked(facade.getJob).mockReturnValueOnce(jobStatus({ done: 4 }));
    const response = await getJob(page("/api/assets/jobs/job_1"), ctx({ jobId: "job_1" }));
    expect(await response.json()).toMatchObject({ id: "job_1", done: 4 });
    vi.mocked(facade.getJob).mockReturnValueOnce(null);
    expect((await getJob(page("/api/assets/jobs/job_2"), ctx({ jobId: "job_2" }))).status).toBe(404);
  });

  it("DELETE cancels a known job", async () => {
    vi.mocked(facade.getJob).mockReturnValue(jobStatus());
    vi.mocked(facade.cancelJob).mockReturnValue(true);
    const response = await cancelJob(page("/api/assets/jobs/job_1", { method: "DELETE" }), ctx({ jobId: "job_1" }));
    expect(await response.json()).toEqual({ cancelled: true });
    expect(facade.cancelJob).toHaveBeenCalledWith("job_1");
  });

  it("DELETE answers 404 for an unknown job", async () => {
    vi.mocked(facade.getJob).mockReturnValue(null);
    const response = await cancelJob(page("/api/assets/jobs/job_9", { method: "DELETE" }), ctx({ jobId: "job_9" }));
    expect(response.status).toBe(404);
    expect(facade.cancelJob).not.toHaveBeenCalled();
  });

  it("refuses job ids outside [A-Za-z0-9_-]{1,64}", async () => {
    for (const jobId of ["../x", "a b", "x".repeat(65), ""]) {
      expect((await getJob(page("/api/assets/jobs/x"), ctx({ jobId }))).status, jobId).toBe(400);
    }
  });
});

describe("job starts", () => {
  it("POST /import starts an import and answers 202 { job }", async () => {
    vi.mocked(facade.startImport).mockResolvedValue(jobStatus());
    const response = await importProjects(page("/api/assets/import", { json: { projectDirs: [DIR] } }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ job: jobStatus() });
    expect(facade.startImport).toHaveBeenCalledWith({ projectDirs: [DIR] });
  });

  it("POST /import refuses no folders or a relative one", async () => {
    expect((await importProjects(page("/api/assets/import", { json: { projectDirs: [] } }))).status).toBe(400);
    expect((await importProjects(page("/api/assets/import", { json: { projectDirs: ["proj"] } }))).status).toBe(400);
  });

  it("POST /cleanup starts a cleanup", async () => {
    vi.mocked(facade.startCleanup).mockResolvedValue(jobStatus({ type: "cleanup" }));
    const response = await cleanup(page("/api/assets/cleanup", { json: { thumbnails: true } }));
    expect(response.status).toBe(202);
    expect(facade.startCleanup).toHaveBeenCalledWith({ thumbnails: true });
    expect((await cleanup(page("/api/assets/cleanup", { json: {} }))).status).toBe(400);
  });

  it("POST /export starts an export to the chosen folder", async () => {
    vi.mocked(facade.startExport).mockResolvedValue(jobStatus({ type: "export" }));
    const body = { selection: { mode: "ids", ids: [ASSET_ID] }, dest: DIR };
    const response = await exportAssets(page("/api/assets/export", { json: body }));
    expect(response.status).toBe(202);
    expect(facade.startExport).toHaveBeenCalledWith(body);
  });

  it("maps a busy job runner", async () => {
    vi.mocked(facade.startExport).mockRejectedValue(new LibraryError("Another job is running.", 409, "busy"));
    const body = { selection: { mode: "ids", ids: [ASSET_ID] }, dest: DIR };
    const response = await exportAssets(page("/api/assets/export", { json: body }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Another job is running.", code: "busy" });
  });
});

describe("PUT /api/assets/runs/[runId]", () => {
  const run = (overrides: Record<string, unknown> = {}) => ({
    meta: { id: RUN_ID, workflowId: "wf_1", workflowName: "Cats", projectPath: null, startedAt: 1 },
    phase: "start",
    workflow: { version: 1, name: "Cats", nodes: [], edges: [], edgeStyle: "curved" },
    mediaHashes: [SHA],
    ...overrides,
  });

  it("stores the snapshot and answers the media still missing", async () => {
    vi.mocked(facade.putRun).mockResolvedValue({ missingMedia: [SHA] });
    const response = await putRun(page(`/api/assets/runs/${RUN_ID}`, { method: "PUT", json: run() }), ctx({ runId: RUN_ID }));
    expect(await response.json()).toEqual({ missingMedia: [SHA] });
    expect(vi.mocked(facade.putRun).mock.calls[0][0]).toBe(RUN_ID);
    expect(vi.mocked(facade.putRun).mock.calls[0][1]).toMatchObject({ phase: "start", mediaHashes: [SHA] });
  });

  it("accepts a snapshot over 1 MB, up to 16 MB", async () => {
    vi.mocked(facade.putRun).mockResolvedValue({ missingMedia: [] });
    const big = run({ workflow: { version: 1, name: "Cats", nodes: [{ data: { prompt: "x".repeat(2 * 1024 * 1024) } }], edges: [], edgeStyle: "curved" } });
    const response = await putRun(page(`/api/assets/runs/${RUN_ID}`, { method: "PUT", json: big }), ctx({ runId: RUN_ID }));
    expect(response.status).toBe(200);
  });

  it("refuses a snapshot over 16 MB", async () => {
    const response = await putRun(
      page(`/api/assets/runs/${RUN_ID}`, {
        method: "PUT",
        body: "{}",
        headers: { "content-type": "application/json", "content-length": String(17 * 1024 * 1024) },
      }),
      ctx({ runId: RUN_ID }),
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe("The request body is over the 16 MB limit.");
  });

  it("refuses a bad run id or one that does not match the body", async () => {
    expect((await putRun(page(`/api/assets/runs/x`, { method: "PUT", json: run() }), ctx({ runId: "x" }))).status).toBe(400);
    const other = "r9999999999999";
    expect((await putRun(page(`/api/assets/runs/${other}`, { method: "PUT", json: run() }), ctx({ runId: other }))).status).toBe(400);
    expect(facade.putRun).not.toHaveBeenCalled();
  });
});

describe("PUT /api/assets/workflows/[workflowId]", () => {
  it("classifies a workflow whose id arrives URL-encoded", async () => {
    const entry = { id: "tpl:cats.v2", name: "Cats", projectPath: DIR, createdAt: 1, updatedAt: 2 };
    vi.mocked(facade.upsertWorkflowEntry).mockResolvedValue(entry);
    const response = await putWorkflow(
      page(`/api/assets/workflows/tpl%3Acats.v2`, { method: "PUT", json: { name: "Cats", projectPath: DIR } }),
      ctx({ workflowId: "tpl%3Acats.v2" }),
    );
    expect(await response.json()).toEqual(entry);
    expect(facade.upsertWorkflowEntry).toHaveBeenCalledWith("tpl:cats.v2", { name: "Cats", projectPath: DIR });
  });

  it("records a fork and a workflow without a project", async () => {
    vi.mocked(facade.upsertWorkflowEntry).mockResolvedValue({ id: "wf_2", name: null, projectPath: null, createdAt: 1, updatedAt: 1 });
    await putWorkflow(
      page(`/api/assets/workflows/wf_2`, { method: "PUT", json: { name: null, projectPath: null, forkedFrom: "wf_1" } }),
      ctx({ workflowId: "wf_2" }),
    );
    expect(facade.upsertWorkflowEntry).toHaveBeenCalledWith("wf_2", { name: null, projectPath: null, forkedFrom: "wf_1" });
  });

  it("passes when the caller saw the values (asOf) through, and refuses one that is not a number", async () => {
    vi.mocked(facade.upsertWorkflowEntry).mockResolvedValue({ id: "wf_3", name: "Fox", projectPath: null, createdAt: 1, updatedAt: 1 });
    await putWorkflow(
      page(`/api/assets/workflows/wf_3`, { method: "PUT", json: { name: "Fox", projectPath: null, asOf: 1234 } }),
      ctx({ workflowId: "wf_3" }),
    );
    expect(facade.upsertWorkflowEntry).toHaveBeenCalledWith("wf_3", { name: "Fox", projectPath: null, asOf: 1234 });
    const refused = await putWorkflow(
      page(`/api/assets/workflows/wf_3`, { method: "PUT", json: { name: "Fox", projectPath: null, asOf: "yesterday" } }),
      ctx({ workflowId: "wf_3" }),
    );
    expect(refused.status).toBe(400);
  });

  it("refuses ids with path characters and relative project folders", async () => {
    for (const workflowId of ["wf%2F..%2Fx", "a b", "x".repeat(129)]) {
      const response = await putWorkflow(
        page(`/api/assets/workflows/x`, { method: "PUT", json: { name: null, projectPath: null } }),
        ctx({ workflowId }),
      );
      expect(response.status, workflowId).toBe(400);
    }
    const relative = await putWorkflow(
      page(`/api/assets/workflows/wf_1`, { method: "PUT", json: { name: "x", projectPath: "proj" } }),
      ctx({ workflowId: "wf_1" }),
    );
    expect(relative.status).toBe(400);
    expect(facade.upsertWorkflowEntry).not.toHaveBeenCalled();
  });
});
