// @vitest-environment node
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryJobStatus, RecordAssetMeta, RecordAssetResult } from "../../types";
import {
  __assetLibraryForTests,
  __drainAssetLibraryForTests,
  __resetAssetLibraryForTests,
  beginRecord,
  bulkAssets,
  cancelJob,
  completeUpload,
  getJob,
  getLibraryStatus,
  listAssets,
  openMedia,
  patchAsset,
  putMedia,
  putRun,
  setLibraryRoot,
  startCleanup,
  startExport,
  startImport,
  upsertWorkflowEntry,
} from "../index";
import { Ingestor } from "../ingest";
import { JobRunner, runExport, runMove, validateMoveTarget, type JobContext } from "../jobs";
import { AssetLibrary } from "../library";
import { installBridge, makePng, makeWav, md5, meta, sha256, streamOf, tempDir, TINY_MP4 } from "./helpers";

let base: string;
let home: string;
let bridge: ReturnType<typeof installBridge>;

beforeEach(async () => {
  base = tempDir();
  home = path.join(base, "home");
  fs.mkdirSync(home);
  bridge = installBridge(path.join(base, "OS Trash"));
  delete process.env.NODE_BANANA_ASSET_LIBRARY;
  // No env override: resolve the default under a fake home, so the library can be moved.
  await __resetAssetLibraryForTests({
    pathContext: { platform: process.platform, env: {}, homedir: home, winPicturesDir: path.join(home, "Pictures") },
  });
});

afterEach(async () => {
  await __resetAssetLibraryForTests();
  bridge.remove();
  fs.rmSync(base, { recursive: true, force: true });
});

let seed = 300;

async function record(overrides: Partial<RecordAssetMeta> = {}, buffer: Buffer = makePng(4, 4, seed++)): Promise<RecordAssetResult> {
  const started = await beginRecord({ meta: meta(overrides), source: { type: "upload" } });
  if ("result" in started) return started.result;
  return completeUpload(started.ticket.uploadId, streamOf(buffer), null);
}

function jobContext(): JobContext {
  return { signal: new AbortController().signal, update: () => {}, addBytes: () => {}, step: () => {}, checkCancelled: () => {} };
}

async function finished(job: LibraryJobStatus): Promise<LibraryJobStatus> {
  await __drainAssetLibraryForTests();
  return getJob(job.id)!;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  if (fs.existsSync(dir)) visit(dir);
  return out.sort();
}

describe("move", () => {
  it("copies the library, verifies it, switches, and removes only what it copied", async () => {
    const status = await getLibraryStatus();
    const oldRoot = path.join(home, "Pictures", "Node Banana");
    expect(status).toMatchObject({ available: true, root: oldRoot, source: "default" });

    const project = path.join(base, "Project");
    fs.mkdirSync(project);
    const inLibrary = await record({ prompt: "keep me" });
    const inProject = await record({ projectDir: project });
    await patchAsset(inLibrary.asset.id, { tags: ["moved"] });
    const media = makePng(2, 2, 1);
    await putMedia(sha256(media), streamOf(media), "image/png");
    fs.writeFileSync(path.join(oldRoot, "notes.txt"), "the user's own file");

    const newRoot = path.join(base, "External", "NB Library");
    const moving = await setLibraryRoot({ root: newRoot, mode: "move" });
    expect(moving.job?.type).toBe("move");
    const job = await finished(moving.job!);
    expect(job).toMatchObject({ state: "done", done: job.total });
    expect(job.message).toMatch(/^Moved \d+ files\.$/);
    expect(job.bytesDone).toBe(job.bytesTotal);

    const after = await getLibraryStatus();
    expect(after).toMatchObject({ root: newRoot, source: "config" });
    const config = JSON.parse(fs.readFileSync(path.join(home, ".node-banana", "library.json"), "utf8"));
    expect(config).toMatchObject({ root: newRoot, setBy: "user" });

    // Old root: only what the library didn't own is left.
    expect(walk(oldRoot)).toEqual(["notes.txt"]);
    const moved = walk(newRoot);
    expect(moved).toContain(inLibrary.asset.file.root === "library" ? inLibrary.asset.file.rel : "");
    expect(moved).toContain(`.nodebanana/assets/${inLibrary.asset.id}.json`);
    expect(moved).toContain(`.nodebanana/media/${sha256(media)}.png`);

    const page = await listAssets({});
    const movedView = page.assets.find((asset) => asset.id === inLibrary.asset.id)!;
    expect(movedView.displayPath.startsWith(newRoot)).toBe(true);
    expect(movedView.tags).toEqual(["moved"]);
    expect(page.assets.find((asset) => asset.id === inProject.asset.id)?.displayPath).toBe(inProject.asset.displayPath);
    expect(await openMedia(sha256(media))).not.toBeNull();

    // Recording continues into the new root.
    const next = await record();
    expect(next.asset.displayPath.startsWith(newRoot)).toBe(true);
  });

  it("refuses targets inside or around the library, or holding another library", async () => {
    const root = path.join(base, "Lib");
    fs.mkdirSync(path.join(root, ".nodebanana"), { recursive: true });
    await expect(validateMoveTarget(root, path.join(root, "Inner"))).rejects.toThrow(/inside the library/);
    await expect(validateMoveTarget(root, base)).rejects.toThrow(/inside the library/);
    await expect(validateMoveTarget(root, root)).rejects.toThrow(/already the library/);
    if (process.platform === "darwin" || process.platform === "win32") {
      await expect(validateMoveTarget(root, path.join(root.toUpperCase(), "x"))).rejects.toThrow(/inside the library/);
    }
    const occupied = path.join(base, "Occupied");
    fs.mkdirSync(path.join(occupied, ".nodebanana", "assets"), { recursive: true });
    fs.writeFileSync(path.join(occupied, ".nodebanana", "assets", "a0000000000001.json"), "{}");
    await expect(validateMoveTarget(root, occupied)).rejects.toMatchObject({ code: "conflict" });
    await expect(validateMoveTarget(root, "relative/path")).rejects.toMatchObject({ status: 400 });
    expect(await validateMoveTarget(root, path.join(base, "Fresh"))).toBe(path.join(base, "Fresh"));
  });

  it("answers writes with 503 + Retry-After while a move has recording paused", async () => {
    const r = await record();
    const rt = (globalThis as { __nodeBananaAssetLibrary?: { paused: boolean } }).__nodeBananaAssetLibrary!;
    rt.paused = true;
    try {
      const paused = { status: 503, code: "paused", retryAfter: expect.any(Number) };
      await expect(beginRecord({ meta: meta(), source: { type: "upload" } })).rejects.toMatchObject(paused);
      await expect(patchAsset(r.asset.id, { favorite: true })).rejects.toMatchObject(paused);
      await expect(putMedia("0".repeat(64), streamOf(Buffer.from("x")), "image/png")).rejects.toMatchObject(paused);
      // Reads carry on from the old root.
      expect((await listAssets({})).total).toBe(1);
    } finally {
      rt.paused = false;
    }
    expect((await patchAsset(r.asset.id, { favorite: true }))?.favorite).toBe(true);
  });

  it("is refused while the root comes from NODE_BANANA_ASSET_LIBRARY", async () => {
    await __resetAssetLibraryForTests({
      pathContext: { platform: process.platform, env: { NODE_BANANA_ASSET_LIBRARY: path.join(base, "EnvLib") }, homedir: home },
    });
    await expect(setLibraryRoot({ root: path.join(base, "Elsewhere"), mode: "switch" })).rejects.toMatchObject({
      status: 409,
      code: "forbidden",
    });
  });

  it("moves only the library's own day folders, never a project's files that sit under Generations", async () => {
    const root = path.join(base, "Owned");
    const library = new AssetLibrary(root);
    await library.ready();
    const day = path.join(root, "Generations", "2026-09-27");
    fs.mkdirSync(path.join(day, "generations"), { recursive: true });
    fs.writeFileSync(path.join(day, "own.png"), makePng(2, 2, 1));
    // From before projects inside the library were refused: a project at <day>, its files in <day>/generations.
    const projectFile = path.join(day, "generations", "p.png");
    const png = makePng(2, 2, 2);
    fs.writeFileSync(projectFile, png);
    await library.addRecord({
      v: 1,
      id: "a" + "p".repeat(13),
      kind: "image",
      origin: "generated",
      mime: "image/png",
      ext: "png",
      bytes: png.length,
      sha256: sha256(png),
      md5: md5(png),
      file: { root: "external", path: projectFile },
      filename: "p.png",
      createdAt: Date.now(),
      producer: { nodeId: "n", nodeType: "nanoBanana" },
      workflowId: "wf_p",
      workflowName: null,
      runId: "r" + "p".repeat(13),
      tags: [],
      favorite: false,
    });
    fs.writeFileSync(path.join(root, "Generations", "loose.png"), makePng(2, 2, 3));

    const target = path.join(base, "OwnedTarget");
    await runMove(jobContext(), {
      library,
      waitForWrites: async () => true,
      toRoot: target,
      setPaused: () => {},
      switchRoot: async () => {},
    });
    expect(walk(path.join(target, "Generations"))).toEqual(["2026-09-27/own.png"]);
    expect(fs.existsSync(projectFile)).toBe(true);
    expect(fs.existsSync(path.join(root, "Generations", "loose.png"))).toBe(true);
    await library.drain();
  });

  it("pauses writes while copying, switches while paused, and cleans up after a cancel", async () => {
    const root = path.join(base, "Direct");
    const library = new AssetLibrary(root);
    await library.ready();
    for (let i = 0; i < 3; i++) {
      const png = makePng(3, 3, 900 + i);
      const dir = path.join(root, "Generations", "2026-09-27");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `f${i}.png`), png);
    }
    const paused: boolean[] = [];
    let pausedAtSwitch: boolean | null = null;
    let isPaused = false;
    const ingest = new Ingestor({ library: () => library, thumbs: () => null, isPaused: () => isPaused });
    let waitedWhilePaused = false;

    const runner = new JobRunner();
    const target = path.join(base, "Target");
    const job = runner.start("move", (ctx) =>
      runMove(ctx, {
        library,
        waitForWrites: async (timeoutMs) => {
          waitedWhilePaused = isPaused;
          return ingest.waitIdle(timeoutMs);
        },
        toRoot: target,
        setPaused: (value) => {
          isPaused = value;
          paused.push(value);
        },
        switchRoot: async () => {
          pausedAtSwitch = isPaused;
        },
      }),
    );
    await runner.drain();
    expect(runner.get(job.id)?.state).toBe("done");
    expect(paused).toEqual([true, false]);
    expect(waitedWhilePaused).toBe(true);
    expect(pausedAtSwitch).toBe(true);
    expect(walk(path.join(root, "Generations"))).toEqual([]);

    // Cancel before the switch: copies are removed, the source is untouched.
    const source = path.join(base, "Source");
    const sourceLibrary = new AssetLibrary(source);
    await sourceLibrary.ready();
    const dir = path.join(source, "Generations", "2026-09-27");
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(dir, `g${i}.png`), makePng(3, 3, 950 + i));
    let switched = false;
    const controller = new AbortController();
    let steps = 0;
    const ctx: JobContext = {
      signal: controller.signal,
      update: () => {},
      addBytes: () => {},
      step: () => {
        if (++steps === 2) controller.abort();
      },
      checkCancelled: () => {
        if (controller.signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "cancelled" });
      },
    };
    const cancelledTarget = path.join(base, "Cancelled");
    await expect(
      runMove(ctx, {
        library: sourceLibrary,
        waitForWrites: async () => true,
        toRoot: cancelledTarget,
        setPaused: () => {},
        switchRoot: async () => {
          switched = true;
        },
      }),
    ).rejects.toThrow(/Cancelled/);
    expect(switched).toBe(false);
    expect(walk(cancelledTarget).filter((file) => file.startsWith("Generations"))).toEqual([]);
    expect(fs.readdirSync(dir)).toHaveLength(4);
  });
});

describe("import", () => {
  it("indexes project generations in place with the newest workflow's carousel metadata", async () => {
    const project = path.join(base, "Old Project");
    const generations = path.join(project, "generations");
    fs.mkdirSync(generations, { recursive: true });
    const png = makePng(20, 10, 1);
    const pngName = `a_cat_${md5(png)}`;
    fs.writeFileSync(path.join(generations, `${pngName}.png`), png);
    fs.writeFileSync(path.join(generations, `generation_${md5(TINY_MP4)}.mp4`), TINY_MP4);
    fs.writeFileSync(path.join(generations, `voice_${md5(makeWav())}.wav`), makeWav());
    fs.writeFileSync(path.join(generations, "leftover.partial"), "x");
    fs.writeFileSync(path.join(generations, "notes.txt"), "x");
    const mtime = new Date(2025, 4, 1, 10, 0, 0);
    fs.utimesSync(path.join(generations, `${pngName}.png`), mtime, mtime);

    const workflow = {
      version: 1,
      id: "wf_old_project",
      name: "Old flow",
      nodes: [
        {
          id: "nanoBanana-3",
          type: "nanoBanana",
          data: {
            selectedModel: { provider: "gemini", modelId: "nano-banana-pro", displayName: "Nano Banana Pro" },
            imageHistory: [
              {
                id: pngName,
                prompt: "a cat",
                model: "nano-banana-pro",
                aspectRatio: "2:1",
                timestamp: 1,
                generation: { modelId: "nano-banana-pro", parameters: { seed: 4 }, cost: { amount: 0.1, currency: "USD", estimated: false } },
              },
            ],
          },
        },
      ],
      edges: [],
    };
    fs.writeFileSync(path.join(project, "older.json"), JSON.stringify({ ...workflow, id: "wf_stale", name: "Stale" }));
    const older = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(project, "older.json"), older, older);
    fs.writeFileSync(path.join(project, "Old flow.json"), JSON.stringify(workflow));

    const empty = path.join(base, "No Generations");
    fs.mkdirSync(empty);

    const job = await finished(await startImport({ projectDirs: [project, `${project}/`, empty] }));
    expect(job).toMatchObject({ state: "done", total: 3, done: 3 });
    expect(job.message).toBe("Imported 3 files. 1 folder has no generations folder.");

    const page = await listAssets({ sort: "oldest" });
    expect(page.total).toBe(3);
    const image = page.assets.find((asset) => asset.kind === "image")!;
    expect(image).toMatchObject({
      imported: true,
      origin: "generated",
      filename: `${pngName}.png`,
      file: { root: "external", path: path.join(generations, `${pngName}.png`) },
      createdAt: mtime.getTime(),
      width: 20,
      height: 10,
      prompt: "a cat",
      aspectRatio: "2:1",
      model: { provider: "gemini", modelId: "nano-banana-pro", displayName: "Nano Banana Pro" },
      parameters: { seed: 4 },
      cost: { amount: 0.1, currency: "USD", estimated: false },
      producer: { nodeId: "nanoBanana-3", nodeType: "nanoBanana" },
      workflow: { id: "wf_old_project", name: "Old flow", projectPath: project },
    });
    const video = page.assets.find((asset) => asset.kind === "video")!;
    expect(video).toMatchObject({ width: 64, height: 48, producer: { nodeType: "import" } });
    expect(page.assets.find((asset) => asset.kind === "audio")?.durationSec).toBeGreaterThan(0);

    // Running it again finds nothing new.
    const again = await finished(await startImport({ projectDirs: [project] }));
    expect(again.message).toBe("Imported 0 files.");
  });

  it("files a folder under its own id when its workflow id already belongs to another project", async () => {
    const first = path.join(base, "A");
    const second = path.join(base, "B");
    fs.mkdirSync(path.join(second, "generations"), { recursive: true });
    fs.writeFileSync(path.join(second, "generations", "x.png"), makePng(2, 2, 5));
    fs.writeFileSync(path.join(second, "flow.json"), JSON.stringify({ version: 1, id: "wf_shared", name: "Shared", nodes: [], edges: [] }));
    await upsertWorkflowEntry("wf_shared", { name: "Shared", projectPath: first });

    await finished(await startImport({ projectDirs: [second] }));
    const [asset] = (await listAssets({})).assets;
    expect(asset.workflowId).toMatch(/^import_/);
    expect(asset.workflow).toMatchObject({ projectPath: second, name: "Shared" });
    const library = await __assetLibraryForTests();
    expect(library.getWorkflow("wf_shared")?.projectPath).toBe(first);
    expect(library.getWorkflow(asset.workflowId)?.forkedFrom).toBe("wf_shared");
  });

  it("refuses a bad folder list and a second job while one runs", async () => {
    await expect(startImport({ projectDirs: [] })).rejects.toMatchObject({ status: 400 });
    await expect(startImport({ projectDirs: ["relative"] })).rejects.toMatchObject({ status: 400 });
    const dirs = Array.from({ length: 3 }, (_, i) => {
      const dir = path.join(base, `P${i}`, "generations");
      fs.mkdirSync(dir, { recursive: true });
      for (let j = 0; j < 20; j++) fs.writeFileSync(path.join(dir, `f${j}.png`), makePng(2, 2, i * 100 + j));
      return path.dirname(dir);
    });
    const first = await startImport({ projectDirs: dirs });
    await expect(startCleanup({ thumbnails: true })).rejects.toMatchObject({ status: 409, code: "busy" });
    expect(cancelJob(first.id)).toBe(true);
    const done = await finished(first);
    expect(done.state).toBe("cancelled");
    expect(cancelJob(first.id)).toBe(false);
  });
});

describe("cleanup", () => {
  it("removes snapshot media nothing references and posters of deleted assets", async () => {
    const keep = makePng(2, 2, 11);
    const drop = makePng(2, 2, 12);
    await putMedia(sha256(keep), streamOf(keep), "image/png");
    await putMedia(sha256(drop), streamOf(drop), "image/png");
    const r = await record();
    await putRun(r.asset.runId, {
      meta: { id: r.asset.runId, workflowId: r.asset.workflowId, workflowName: null, projectPath: null, startedAt: 1 },
      phase: "start",
      workflow: { version: 1, name: "x", nodes: [], edges: [], edgeStyle: "curved" },
      mediaHashes: [sha256(keep)],
    });
    const library = await __assetLibraryForTests();
    const posters = library.layout.posters;
    fs.mkdirSync(posters, { recursive: true });
    fs.writeFileSync(path.join(posters, `${r.asset.sha256}.webp`), "live");
    fs.writeFileSync(path.join(posters, `${"e".repeat(64)}.webp`), "orphan");

    const job = await finished(await startCleanup({ unusedMedia: true }));
    expect(job.state).toBe("done");
    expect(job.message).toMatch(/^Removed 2 files/);
    expect(fs.readdirSync(library.layout.media)).toEqual([`${sha256(keep)}.png`]);
    expect(fs.readdirSync(posters)).toEqual([`${r.asset.sha256}.webp`]);
    await expect(startCleanup({})).rejects.toMatchObject({ status: 400 });
  });

  it("removes old snapshots no asset belongs to, then the media only they referenced", async () => {
    const only = makePng(2, 2, 13);
    await putMedia(sha256(only), streamOf(only), "image/png");
    const r = await record();
    const orphanRun = `r${"0".repeat(12)}orphan`;
    await putRun(orphanRun, {
      meta: { id: orphanRun, workflowId: r.asset.workflowId, workflowName: null, projectPath: null, startedAt: 1 },
      phase: "final",
      workflow: { version: 1, name: "x", nodes: [], edges: [], edgeStyle: "curved" },
      mediaHashes: [sha256(only)],
    });
    const library = await __assetLibraryForTests();
    const orphanFile = path.join(library.layout.runs, `${orphanRun}.json.gz`);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(orphanFile, old, old);

    const job = await finished(await startCleanup({ unusedMedia: true }));
    expect(job.state).toBe("done");
    expect(fs.existsSync(orphanFile)).toBe(false);
    expect(fs.readdirSync(library.layout.runs)).toEqual([]);
    expect(fs.readdirSync(library.layout.media)).toEqual([]);
  });

  it("deletes no snapshot media while a snapshot can't be read", async () => {
    const needed = makePng(2, 2, 14);
    await putMedia(sha256(needed), streamOf(needed), "image/png");
    const r = await record();
    await putRun(r.asset.runId, {
      meta: { id: r.asset.runId, workflowId: r.asset.workflowId, workflowName: null, projectPath: null, startedAt: 1 },
      phase: "start",
      workflow: { version: 1, name: "x", nodes: [], edges: [], edgeStyle: "curved" },
      mediaHashes: [sha256(needed)],
    });
    const library = await __assetLibraryForTests();
    const file = path.join(library.layout.runs, `${r.asset.runId}.json.gz`);
    // Changed since it was last read (say, by a sync client), and unreadable right now.
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    const readFile = fs.promises.readFile;
    const spy = vi.spyOn(fs.promises, "readFile").mockImplementation(((target: fs.PathLike, ...rest: unknown[]) =>
      String(target) === file
        ? Promise.reject(Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" }))
        : (readFile as (...args: unknown[]) => Promise<unknown>)(target, ...rest)) as typeof readFile);
    try {
      const job = await finished(await startCleanup({ unusedMedia: true }));
      expect(job.message).toMatch(/couldn't be read/);
      expect(fs.readdirSync(library.layout.media)).toEqual([`${sha256(needed)}.png`]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("export", () => {
  it("copies a selection to a folder with unique names", async () => {
    const png = makePng(3, 3, 21);
    const one = await record({}, png);
    const two = await record({}, png);
    const gone = await record();
    fs.unlinkSync(gone.asset.displayPath);
    const dest = path.join(base, "Export");
    const job = await finished(
      await startExport({ selection: { mode: "ids", ids: [one.asset.id, two.asset.id, gone.asset.id] }, dest }),
    );
    expect(job.message).toBe("Exported 2 files. 1 could not be found.");
    const name = one.filename;
    const stem = name.slice(0, name.lastIndexOf("."));
    expect(fs.readdirSync(dest).sort()).toEqual([name, `${stem} (2).png`].sort());

    const library = await __assetLibraryForTests();
    await expect(startExport({ selection: { mode: "ids", ids: [one.asset.id] }, dest: library.layout.assets })).rejects.toMatchObject({
      status: 400,
    });
    await expect(startExport({ selection: { mode: "ids", ids: [] }, dest })).rejects.toMatchObject({ status: 400 });
  });

  it("never writes outside the chosen folder, whatever a sidecar's file name says", async () => {
    const r = await record();
    const library = await __assetLibraryForTests();
    const sidecar = path.join(library.layout.assets, `${r.asset.id}.json`);
    const raw = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    // A synced library folder: someone else's machine wrote this sidecar.
    fs.writeFileSync(sidecar, JSON.stringify({ ...raw, filename: "../../escape.png" }));
    const other = new AssetLibrary(library.root);
    await other.ready();
    // Reduced to its last segment when read.
    expect(other.get(r.asset.id)?.filename).toBe("escape.png");
    // And a name that never went through a sidecar check still can't leave the folder.
    await other.addRecord({ ...raw, id: "a" + "q".repeat(13), filename: "../../also-escape.png" });

    const dest = path.join(base, "Out", "Inner");
    fs.mkdirSync(dest, { recursive: true });
    const message = await runExport(jobContext(), other, [r.asset.id, "a" + "q".repeat(13)], dest);
    expect(message).toBe("Exported 2 files.");
    expect(fs.existsSync(path.join(base, "escape.png"))).toBe(false);
    expect(fs.existsSync(path.join(base, "also-escape.png"))).toBe(false);
    expect(fs.readdirSync(dest).sort()).toEqual(["also-escape.png", "escape.png"]);
    await other.drain();
  });

  it("stops when the export folder goes away, and marks nothing missing", async () => {
    const one = await record();
    const two = await record();
    const library = await __assetLibraryForTests();
    const dest = path.join(base, "Unplugged");
    await expect(runExport(jobContext(), library, [one.asset.id, two.asset.id], dest)).rejects.toThrow(/no longer available/);
    expect(library.isMissing(one.asset.id)).toBe(false);
    expect(library.isMissing(two.asset.id)).toBe(false);
  });

  it("exports a query selection", async () => {
    const a = await record({ prompt: "sunset one" });
    await record({ prompt: "other" });
    await bulkAssets({ selection: { mode: "ids", ids: [a.asset.id] }, op: { action: "favorite" } });
    const dest = path.join(base, "Favs");
    const job = await finished(await startExport({ selection: { mode: "query", query: { favorite: true }, excludeIds: [] }, dest }));
    expect(job.message).toBe("Exported 1 file.");
    expect(fs.readdirSync(dest)).toEqual([a.filename]);
  });
});
