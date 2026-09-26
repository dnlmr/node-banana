// @vitest-environment node
import fs from "fs";
import path from "path";
import { gunzipSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssetPageRequest, RecordAssetMeta, RecordAssetResult, SnapshotWorkflow } from "../../types";
import {
  __assetLibraryForTests,
  __drainAssetLibraryForTests,
  __resetAssetLibraryForTests,
  assetExistence,
  beginRecord,
  bulkAssets,
  completeUpload,
  getAsset,
  getAssetWorkflow,
  getFacets,
  getLibraryStatus,
  listAssets,
  mediaHas,
  openAssetFile,
  openMedia,
  patchAsset,
  putMedia,
  putRun,
  upsertWorkflowEntry,
} from "../index";
import { AssetLibrary } from "../library";
import { installBridge, makePng, meta, runId, sha256, streamOf, tempDir } from "./helpers";

let base: string;
let root: string;
let bridge: ReturnType<typeof installBridge>;

beforeEach(async () => {
  base = tempDir();
  root = path.join(base, "Library");
  process.env.NODE_BANANA_ASSET_LIBRARY = root;
  bridge = installBridge(path.join(base, "OS Trash"));
  await __resetAssetLibraryForTests();
});

afterEach(async () => {
  await __resetAssetLibraryForTests();
  bridge.remove();
  delete process.env.NODE_BANANA_ASSET_LIBRARY;
  fs.rmSync(base, { recursive: true, force: true });
});

let seed = 100;

async function record(overrides: Partial<RecordAssetMeta> = {}, buffer: Buffer = makePng(4, 4, seed++)): Promise<RecordAssetResult> {
  const started = await beginRecord({ meta: meta(overrides), source: { type: "upload" } });
  if ("result" in started) return started.result;
  return completeUpload(started.ticket.uploadId, streamOf(buffer), null);
}

async function ids(request: AssetPageRequest = {}): Promise<string[]> {
  return (await listAssets(request)).assets.map((asset) => asset.id);
}

const T0 = new Date(2026, 8, 20, 12, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;

describe("queries", () => {
  let a: RecordAssetResult;
  let b: RecordAssetResult;
  let c: RecordAssetResult;
  let d: RecordAssetResult;

  beforeEach(async () => {
    a = await record({ createdAt: T0, prompt: "Red fox in snow", model: { provider: "gemini", modelId: "nano-banana" } });
    b = await record({
      createdAt: T0 + HOUR,
      prompt: "Blue whale",
      origin: "edited",
      producer: { nodeId: "annotation-1", nodeType: "annotation", operation: "annotate" },
      model: { provider: "fal", modelId: "flux-pro", displayName: "FLUX Pro" },
      workflowId: "wf_other",
      workflowName: "Ocean",
    });
    c = await record({ createdAt: T0 + 2 * HOUR, prompt: "Green forest", tags: ["Hero", "cover"] });
    d = await record({ createdAt: T0 + 3 * HOUR, prompt: "red panda", workflowId: "wf_other", workflowName: "Ocean" });
  });

  it("sorts newest first by default, oldest on request", async () => {
    expect(await ids()).toEqual([d, c, b, a].map((r) => r.asset.id));
    expect(await ids({ sort: "oldest" })).toEqual([a, b, c, d].map((r) => r.asset.id));
  });

  it("ANDs across groups and ORs within one", async () => {
    expect(await ids({ q: "red" })).toEqual([d.asset.id, a.asset.id]);
    expect(await ids({ q: "RED fox" })).toEqual([a.asset.id]);
    expect(await ids({ origins: ["edited"] })).toEqual([b.asset.id]);
    expect(await ids({ workflowIds: ["wf_other"], q: "red" })).toEqual([d.asset.id]);
    expect(await ids({ models: ["flux-pro"] })).toEqual([b.asset.id]);
    expect(await ids({ models: ["flux-pro", "nano-banana"] })).toHaveLength(4);
    expect(await ids({ tags: ["hero", "missing-tag"] })).toEqual([c.asset.id]);
    expect(await ids({ from: T0 + HOUR, to: T0 + 3 * HOUR })).toEqual([c.asset.id, b.asset.id]);
    expect(await ids({ kinds: ["video"] })).toEqual([]);
    // The search also covers the model label, the workflow name and tags.
    expect(await ids({ q: "flux" })).toEqual([b.asset.id]);
    expect(await ids({ q: "ocean" })).toEqual([d.asset.id, b.asset.id]);
    expect(await ids({ q: "cover" })).toEqual([c.asset.id]);
  });

  it("filters by the workflow's current project, and by 'not in a project'", async () => {
    const project = path.join(base, "Proj");
    await upsertWorkflowEntry("wf_other", { name: "Ocean (renamed)", projectPath: project });
    expect(await ids({ projects: [project] })).toEqual([d.asset.id, b.asset.id]);
    expect(await ids({ projects: [""] })).toEqual([c.asset.id, a.asset.id]);
    expect(await ids({ q: "renamed" })).toEqual([d.asset.id, b.asset.id]);
    const view = await getAsset(b.asset.id);
    expect(view?.workflow).toEqual({ id: "wf_other", name: "Ocean (renamed)", projectPath: project });
  });

  it("pages with a keyset cursor that stays stable while new assets arrive", async () => {
    const first = await listAssets({ limit: 2 });
    expect(first.assets.map((x) => x.id)).toEqual([d.asset.id, c.asset.id]);
    expect(first.total).toBe(4);
    expect(first.totalBytes).toBe([a, b, c, d].reduce((sum, r) => sum + r.asset.bytes, 0));
    expect(first.nextCursor).toBeTruthy();

    const newest = await record({ createdAt: T0 + 10 * HOUR });
    const second = await listAssets({ limit: 2, cursor: first.nextCursor! });
    expect(second.assets.map((x) => x.id)).toEqual([b.asset.id, a.asset.id]);
    expect(second.nextCursor).toBeNull();
    expect(second.total).toBe(5);

    const arrivals = await listAssets({ newerThan: first.headCursor! });
    expect(arrivals.assets.map((x) => x.id)).toEqual([newest.asset.id]);
    expect(arrivals.headCursor).not.toBe(first.headCursor);
    expect((await listAssets({ newerThan: arrivals.headCursor! })).assets).toEqual([]);
  });

  it("pages oldest-first too", async () => {
    const first = await listAssets({ sort: "oldest", limit: 3 });
    expect(first.assets.map((x) => x.id)).toEqual([a, b, c].map((r) => r.asset.id));
    const second = await listAssets({ sort: "oldest", limit: 3, cursor: first.nextCursor! });
    expect(second.assets.map((x) => x.id)).toEqual([d.asset.id]);
  });

  it("rejects a forged cursor", async () => {
    await expect(listAssets({ cursor: "zz.../../x" })).rejects.toMatchObject({ status: 400 });
  });

  it("counts facets over live assets", async () => {
    await patchAsset(a.asset.id, { favorite: true });
    await patchAsset(b.asset.id, { trashed: true });
    const facets = await getFacets();
    expect(facets.total).toBe(3);
    expect(facets.trash).toBe(1);
    expect(facets.favorites).toBe(1);
    expect(facets.kinds.image).toBe(3);
    expect(facets.origins).toEqual({ generated: 3, edited: 0 });
    expect(facets.models.find((m) => m.modelId === "nano-banana")?.count).toBe(3);
    expect(facets.tags).toEqual([
      { tag: "cover", count: 1 },
      { tag: "Hero", count: 1 },
    ]);
    expect(facets.workflows.map((w) => [w.id, w.count])).toEqual([
      ["wf_other", 1],
      ["wf_test_1", 2],
    ]);
    expect(facets.projects).toEqual([{ path: null, name: "Not in a project", count: 3 }]);
  });
});

describe("mutations", () => {
  it("patches tags, favorite and trash state, and lists the trash scope", async () => {
    const r = await record();
    const patched = await patchAsset(r.asset.id, { tags: [" hero ", "Hero", "final"], favorite: true });
    expect(patched).toMatchObject({ tags: ["hero", "final"], favorite: true });
    const trashed = await patchAsset(r.asset.id, { trashed: true });
    expect(trashed?.trashedAt).toBeGreaterThan(0);
    expect(await ids()).toEqual([]);
    expect(await ids({ scope: "trash" })).toEqual([r.asset.id]);
    const restored = await patchAsset(r.asset.id, { trashed: false });
    expect(restored?.trashedAt).toBeUndefined();
    expect(await ids()).toEqual([r.asset.id]);
    await expect(patchAsset(r.asset.id, { favorite: "yes" as unknown as boolean })).rejects.toMatchObject({ status: 400 });
    expect(await patchAsset("a0000000000000", { favorite: true })).toBeNull();

    // The sidecar on disk is the source of truth.
    const sidecar = JSON.parse(fs.readFileSync(path.join(root, ".nodebanana", "assets", `${r.asset.id}.json`), "utf8"));
    expect(sidecar).toMatchObject({ tags: ["hero", "final"], favorite: true });
    expect(sidecar.trashedAt).toBeUndefined();
  });

  it("applies bulk ops to ids and to query selections", async () => {
    const one = await record({ prompt: "alpha" });
    const two = await record({ prompt: "beta" });
    const three = await record({ prompt: "alpha beta" });

    const tagged = await bulkAssets({ selection: { mode: "ids", ids: [one.asset.id, two.asset.id] }, op: { action: "tag", tags: ["set"] } });
    expect(tagged).toMatchObject({ affected: 2, errors: [] });
    expect(await ids({ tags: ["set"] })).toEqual([two.asset.id, one.asset.id]);

    const byQuery = await bulkAssets({
      selection: { mode: "query", query: { q: "alpha" }, excludeIds: [three.asset.id] },
      op: { action: "favorite" },
    });
    expect(byQuery.ids).toEqual([one.asset.id]);
    expect(await ids({ favorite: true })).toEqual([one.asset.id]);

    await bulkAssets({ selection: { mode: "query", query: {}, excludeIds: [] }, op: { action: "untag", tags: ["SET"] } });
    expect(await ids({ tags: ["set"] })).toEqual([]);

    const trashed = await bulkAssets({ selection: { mode: "query", query: { q: "beta" }, excludeIds: [] }, op: { action: "trash" } });
    expect(trashed.affected).toBe(2);
    const restored = await bulkAssets({ selection: { mode: "query", query: { scope: "trash" }, excludeIds: [] }, op: { action: "restore" } });
    expect(restored.affected).toBe(2);
    expect((await listAssets({})).total).toBe(3);

    const missing = await bulkAssets({ selection: { mode: "ids", ids: ["a0000000000000"] }, op: { action: "favorite" } });
    expect(missing).toMatchObject({ affected: 0, errors: [{ id: "a0000000000000" }] });
    await expect(bulkAssets({ selection: { mode: "ids", ids: [] }, op: { action: "nope" } as never })).rejects.toMatchObject({ status: 400 });
  });
});

describe("permanent delete", () => {
  function trashedPaths(): string[] {
    return bridge.calls.filter((call) => call.type === "trash").map((call) => call.path!);
  }

  it("sends an unshared library file to the OS Trash", async () => {
    const r = await record();
    const file = r.asset.displayPath;
    const result = await bulkAssets({ selection: { mode: "ids", ids: [r.asset.id] }, op: { action: "delete" } });
    expect(result).toMatchObject({ affected: 1, errors: [] });
    expect(trashedPaths()).toEqual([file]);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(root, ".nodebanana", "assets", `${r.asset.id}.json`))).toBe(false);
    const journal = fs.readFileSync(path.join(root, ".nodebanana", "journal.ndjson"), "utf8");
    expect(journal).toContain(`"op":"del","id":"${r.asset.id}"`);
  });

  it("keeps a file another record (even a trashed one) still uses", async () => {
    const png = makePng(3, 3, 55);
    const first = await record({}, png);
    const second = await record({}, png);
    await patchAsset(second.asset.id, { trashed: true });
    await bulkAssets({ selection: { mode: "ids", ids: [first.asset.id] }, op: { action: "delete" } });
    expect(trashedPaths()).toEqual([]);
    expect(fs.existsSync(first.asset.displayPath)).toBe(true);
    await bulkAssets({ selection: { mode: "ids", ids: [second.asset.id] }, op: { action: "delete" } });
    expect(trashedPaths()).toEqual([first.asset.displayPath]);
  });

  it("moves bytes a stored workflow snapshot references into media/", async () => {
    const png = makePng(3, 3, 56);
    const r = await record({}, png);
    const sha = sha256(png);
    await putRun(r.asset.runId, {
      meta: { id: r.asset.runId, workflowId: r.asset.workflowId, workflowName: null, projectPath: null, startedAt: Date.now() },
      phase: "start",
      workflow: snapshot(),
      mediaHashes: [sha],
    });
    await bulkAssets({ selection: { mode: "ids", ids: [r.asset.id] }, op: { action: "delete" } });
    expect(trashedPaths()).toEqual([]);
    expect(fs.existsSync(r.asset.displayPath)).toBe(false);
    const kept = path.join(root, ".nodebanana", "media", `${sha}.png`);
    expect(fs.readFileSync(kept).equals(png)).toBe(true);
    expect(await openMedia(sha)).toMatchObject({ path: kept, mime: "image/png", bytes: png.length });
  });

  it("keeps project files unless asked, then trashes them too", async () => {
    const project = path.join(base, "Proj");
    fs.mkdirSync(project);
    const kept = await record({ projectDir: project });
    await bulkAssets({ selection: { mode: "ids", ids: [kept.asset.id] }, op: { action: "delete" } });
    expect(fs.existsSync(kept.asset.displayPath)).toBe(true);
    expect(trashedPaths()).toEqual([]);

    const removed = await record({ projectDir: project });
    await bulkAssets({ selection: { mode: "ids", ids: [removed.asset.id] }, op: { action: "delete", deleteProjectFiles: true } });
    expect(trashedPaths()).toEqual([removed.asset.displayPath]);
  });

  it("leaves a file alone when it no longer matches its record", async () => {
    const r = await record();
    fs.appendFileSync(r.asset.displayPath, "edited in another app");
    await bulkAssets({ selection: { mode: "ids", ids: [r.asset.id] }, op: { action: "delete" } });
    expect(trashedPaths()).toEqual([]);
    expect(fs.existsSync(r.asset.displayPath)).toBe(true);
  });

  it("empties Trash items older than 30 days when the library starts", async () => {
    const old = await record();
    const recent = await record();
    await patchAsset(old.asset.id, { trashed: true });
    await patchAsset(recent.asset.id, { trashed: true });
    const sidecarPath = path.join(root, ".nodebanana", "assets", `${old.asset.id}.json`);
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    sidecar.trashedAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar));

    await __resetAssetLibraryForTests();
    await getLibraryStatus();
    await __drainAssetLibraryForTests();
    expect(await assetExistence([old.asset.id, recent.asset.id])).toEqual({
      [old.asset.id]: "gone",
      [recent.asset.id]: "present",
    });
    expect(trashedPaths()).toEqual([old.asset.displayPath]);
  });
});

describe("existence", () => {
  it("tells present, gone and unknown apart", async () => {
    const live = await record();
    const trashed = await record();
    const deleted = await record();
    const vanished = await record();
    await patchAsset(trashed.asset.id, { trashed: true });
    await bulkAssets({ selection: { mode: "ids", ids: [deleted.asset.id] }, op: { action: "delete" } });
    fs.unlinkSync(vanished.asset.displayPath);
    const library = await __assetLibraryForTests();
    await library.verifyFiles([library.get(vanished.asset.id)!], 0);

    expect(
      await assetExistence([live.asset.id, trashed.asset.id, deleted.asset.id, vanished.asset.id, "a0000000000000", "nonsense"]),
    ).toEqual({
      [live.asset.id]: "present",
      [trashed.asset.id]: "present",
      [deleted.asset.id]: "gone",
      [vanished.asset.id]: "gone",
      a0000000000000: "unknown",
      nonsense: "unknown",
    });
  });

  it("answers unknown for everything when the library is unavailable", async () => {
    process.env.VERCEL = "1";
    try {
      expect(await assetExistence(["a0000000000001"])).toEqual({ a0000000000001: "unknown" });
    } finally {
      delete process.env.VERCEL;
    }
  });
});

describe("missing files", () => {
  it("serves present files and lists missing ones in their own scope", async () => {
    const r = await record();
    expect(await openAssetFile(r.asset.id)).toMatchObject({ path: r.asset.displayPath, mime: "image/png", sha256: r.asset.sha256 });
    fs.unlinkSync(r.asset.displayPath);
    expect(await openAssetFile(r.asset.id)).toBeNull();
    expect(await ids({ scope: "missing" })).toEqual([r.asset.id]);
    expect((await getFacets()).missing).toBe(1);
    expect((await listAssets({})).assets[0].missing).toBe(true);
  });
});

describe("two processes on one library", () => {
  it("see each other's records, edits and deletes through the journal", async () => {
    const mine = await record({ prompt: "from the web build" });
    const other = new AssetLibrary(root);
    await other.ready();
    expect((await other.query({})).assets.map((x) => x.id)).toEqual([mine.asset.id]);

    await other.patch(mine.asset.id, { tags: ["from-desktop"] });
    expect((await getAsset(mine.asset.id))?.tags).toEqual(["from-desktop"]);

    const theirs = await other.addRecord({
      ...(await other.readSidecar(mine.asset.id))!,
      id: "a" + "z".repeat(13),
      createdAt: mine.asset.createdAt + 1,
      tags: [],
    });
    expect(await ids()).toEqual([theirs.id, mine.asset.id]);

    await other.deleteRecords([theirs.id]);
    expect(await assetExistence([theirs.id])).toEqual({ [theirs.id]: "gone" });
    expect(await ids()).toEqual([mine.asset.id]);
    await other.drain();
  });

  it("rescans after the journal is compacted", async () => {
    const r = await record();
    const other = new AssetLibrary(root);
    await other.ready();
    await other.deleteRecords([r.asset.id]);
    expect(await other.compactJournal()).toBe(true);
    const journal = fs.readFileSync(path.join(root, ".nodebanana", "journal.ndjson"), "utf8").trim().split("\n");
    expect(journal.map((line) => JSON.parse(line).op)).toEqual(["del"]);
    expect(await ids()).toEqual([]);
    expect(await assetExistence([r.asset.id])).toEqual({ [r.asset.id]: "gone" });
    await other.drain();
  });
});

describe("loading sidecars", () => {
  it("accepts only exact sidecar names and drops records that point outside the library", async () => {
    const r = await record();
    const assets = path.join(root, ".nodebanana", "assets");
    const sidecar = JSON.parse(fs.readFileSync(path.join(assets, `${r.asset.id}.json`), "utf8"));
    // Sync-conflict copies and temp files are not records.
    fs.writeFileSync(path.join(assets, `${r.asset.id}-DESKTOP-1.json`), JSON.stringify({ ...sidecar, id: `${r.asset.id}-DESKTOP-1` }));
    fs.writeFileSync(path.join(assets, `${r.asset.id}.json.1234.tmp`), "{");
    const escaping = "a" + "e".repeat(13);
    fs.writeFileSync(
      path.join(assets, `${escaping}.json`),
      JSON.stringify({ ...sidecar, id: escaping, file: { root: "library", rel: "../../outside.png" } }),
    );
    const notMedia = "a" + "f".repeat(13);
    fs.writeFileSync(
      path.join(assets, `${notMedia}.json`),
      JSON.stringify({ ...sidecar, id: notMedia, file: { root: "external", path: path.join(base, "secret.txt") } }),
    );
    const intoData = "a" + "g".repeat(13);
    fs.writeFileSync(
      path.join(assets, `${intoData}.json`),
      JSON.stringify({ ...sidecar, id: intoData, file: { root: "library", rel: ".nodebanana/journal.ndjson" } }),
    );
    fs.writeFileSync(path.join(assets, `${"a" + "h".repeat(13)}.json`), "not json");
    // A torn journal line from a crash is ignored.
    fs.appendFileSync(path.join(root, ".nodebanana", "journal.ndjson"), '{"op":"put","id":');

    const fresh = new AssetLibrary(root);
    await fresh.ready();
    expect(fresh.allRecords().map((x) => x.id)).toEqual([r.asset.id]);

    // A write after the torn line still reaches other processes.
    await fresh.patch(r.asset.id, { tags: ["after-crash"] });
    expect((await getAsset(r.asset.id))?.tags).toEqual(["after-crash"]);
    await fresh.drain();
  });
});

function snapshot(name = "Flow"): SnapshotWorkflow {
  return { version: 1, name, nodes: [{ id: "n1", data: { outputImage: { $nbMedia: "x" } } }], edges: [], edgeStyle: "curved" };
}

describe("run snapshots and media", () => {
  it("stores start then final in one gzip file and reports media it lacks", async () => {
    const r = await record();
    const run = r.asset.runId;
    const other = "f".repeat(64);
    const started = await putRun(run, {
      meta: { id: run, workflowId: r.asset.workflowId, workflowName: "Test flow", projectPath: null, startedAt: 1000 },
      phase: "start",
      workflow: snapshot("Start"),
      mediaHashes: [r.asset.sha256, other],
    });
    expect(started.missingMedia).toEqual([other]);
    expect((await getAssetWorkflow(r.asset.id))?.which).toBe("start");

    await putRun(run, {
      meta: { id: run, workflowId: r.asset.workflowId, workflowName: "Test flow", projectPath: null, startedAt: 2000 },
      phase: "final",
      workflow: snapshot("Final"),
      mediaHashes: [],
    });
    const opened = await getAssetWorkflow(r.asset.id);
    expect(opened).toMatchObject({ which: "final", workflow: { name: "Final" }, run: { id: run, startedAt: 1000 } });

    const stored = JSON.parse(gunzipSync(fs.readFileSync(path.join(root, ".nodebanana", "runs", `${run}.json.gz`))).toString());
    expect(stored.start.name).toBe("Start");
    expect(stored.mediaHashes.sort()).toEqual([r.asset.sha256, other].sort());
  });

  it("has no workflow for an asset whose run was never stored", async () => {
    const r = await record({ runId: runId() });
    expect(await getAssetWorkflow(r.asset.id)).toBeNull();
  });

  it("verifies media uploads against their hash", async () => {
    const png = makePng(2, 2, 77);
    const sha = sha256(png);
    expect(await mediaHas([sha])).toEqual([sha]);
    await expect(putMedia("0".repeat(64), streamOf(png), "image/png")).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(fs.readdirSync(path.join(root, ".nodebanana", "media"))).toEqual([]);
    expect(await putMedia(sha, streamOf(png), "image/png")).toEqual({ sha256: sha, bytes: png.length });
    expect(await mediaHas([sha])).toEqual([]);
    expect(await openMedia(sha)).toMatchObject({ mime: "image/png", bytes: png.length });
    // A second upload of the same bytes is a no-op.
    expect(await putMedia(sha, streamOf(png), "image/png")).toEqual({ sha256: sha, bytes: png.length });
  });

  it("refuses a snapshot for a different run id", async () => {
    await expect(
      putRun(runId(), {
        meta: { id: runId(), workflowId: "wf_1", workflowName: null, projectPath: null, startedAt: 1 },
        phase: "start",
        workflow: snapshot(),
        mediaHashes: [],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("workflows table", () => {
  it("upserts without rewriting when nothing changed, and records forks", async () => {
    const file = path.join(root, ".nodebanana", "workflows.json");
    const project = path.join(base, "Proj");
    const entry = await upsertWorkflowEntry("wf_a", { name: "A", projectPath: `${project}/` });
    expect(entry).toMatchObject({ id: "wf_a", name: "A", projectPath: project });
    const before = fs.statSync(file).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const same = await upsertWorkflowEntry("wf_a", { name: "A", projectPath: project });
    expect(same.updatedAt).toBe(entry.updatedAt);
    expect(fs.statSync(file).mtimeMs).toBe(before);

    const fork = await upsertWorkflowEntry("wf_b", { name: "A", projectPath: path.join(base, "Elsewhere"), forkedFrom: "wf_a" });
    expect(fork.forkedFrom).toBe("wf_a");
    const table = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(table.wf_a.projectPath).toBe(project);
    await expect(upsertWorkflowEntry("bad/id", { name: null, projectPath: null })).rejects.toMatchObject({ status: 400 });
    await expect(upsertWorkflowEntry("wf_c", { name: null, projectPath: "relative" })).rejects.toMatchObject({ status: 400 });
  });
});
