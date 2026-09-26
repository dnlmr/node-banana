/**
 * Long library operations as background jobs, one at a time: move the
 * library, import existing project folders, clean up unused data, export a
 * selection. The route returns at once; the UI follows progress through
 * `LibraryStatus.job` and `GET /api/assets/jobs/[id]`, and can cancel.
 */

import { createHash, randomUUID } from "crypto";
import { constants as fsConstants, promises as fs } from "fs";
import path from "path";
import { newAssetId, newRunId } from "../client/ids";
import type { AssetModelRef, AssetRecord, LibraryJobStatus, LibraryJobType } from "../types";
import { errnoCode, LibraryError } from "./errors";
import {
  copyFileVerified,
  foldsCase,
  hashFile,
  isInsideRoot,
  pathKey,
  PARTIAL_SUFFIX,
  sweepStaleTemps,
  unlinkWithRetry,
} from "./fsutil";
import type { Ingestor } from "./ingest";
import { acquireLock, DATA_DIR, GENERATIONS_DIR } from "./layout";
import type { AssetLibrary } from "./library";
import { decideMediaType, imageDimensionsFromFile, probeAudioVideo, readHead } from "./media";
import type { Thumbnailer } from "./thumbs";
import { extOf, isMediaExtension, isWorkflowId, mediaTypeForExt, normaliseProjectDir } from "./validate";

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export interface JobContext {
  signal: AbortSignal;
  update(patch: Partial<Pick<LibraryJobStatus, "done" | "total" | "bytesDone" | "bytesTotal" | "message">>): void;
  addBytes(bytes: number): void;
  step(): void;
  /** Throws when the job was cancelled. */
  checkCancelled(): void;
}

interface JobEntry {
  status: LibraryJobStatus;
  controller: AbortController;
  promise: Promise<void>;
}

/** Finished jobs stay visible in the library status this long. */
const FINISHED_VISIBLE_MS = 5 * 60 * 1000;
const MAX_REMEMBERED_JOBS = 20;

function cancelled(): LibraryError {
  return new LibraryError("Cancelled", 499, "cancelled");
}

export class JobRunner {
  private readonly jobs = new Map<string, JobEntry>();
  private running: JobEntry | null = null;

  /** Starts `work` as a job, or throws when another job is running. */
  start(type: LibraryJobType, work: (ctx: JobContext) => Promise<string | void>): LibraryJobStatus {
    if (this.running) {
      throw new LibraryError("Another library task is running. Wait for it to finish or cancel it.", 409, "busy");
    }
    const controller = new AbortController();
    const status: LibraryJobStatus = {
      id: `j${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      type,
      state: "running",
      done: 0,
      total: 0,
      bytesDone: 0,
      bytesTotal: 0,
      startedAt: Date.now(),
    };
    const ctx: JobContext = {
      signal: controller.signal,
      update: (patch) => Object.assign(status, patch),
      addBytes: (bytes) => {
        status.bytesDone += bytes;
      },
      step: () => {
        status.done++;
      },
      checkCancelled: () => {
        if (controller.signal.aborted) throw cancelled();
      },
    };
    const entry: JobEntry = { status, controller, promise: Promise.resolve() };
    entry.promise = (async () => {
      try {
        const message = await work(ctx);
        status.state = "done";
        if (message) status.message = message;
      } catch (error) {
        if (controller.signal.aborted || (error instanceof LibraryError && error.code === "cancelled")) {
          status.state = "cancelled";
        } else {
          status.state = "failed";
          status.error = error instanceof Error ? error.message : String(error);
        }
      } finally {
        status.finishedAt = Date.now();
        if (this.running === entry) this.running = null;
      }
    })();
    this.jobs.set(status.id, entry);
    this.running = entry;
    while (this.jobs.size > MAX_REMEMBERED_JOBS) {
      const oldest = [...this.jobs.values()].find((job) => job.status.state !== "running");
      if (!oldest) break;
      this.jobs.delete(oldest.status.id);
    }
    return { ...status };
  }

  get(id: string): LibraryJobStatus | null {
    const entry = this.jobs.get(id);
    return entry ? { ...entry.status } : null;
  }

  cancel(id: string): boolean {
    const entry = this.jobs.get(id);
    if (!entry || entry.status.state !== "running") return false;
    entry.controller.abort();
    return true;
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  /** The running job, else the most recent one if it finished in the last few minutes. */
  visible(now: number = Date.now()): LibraryJobStatus | null {
    if (this.running) return { ...this.running.status };
    let latest: LibraryJobStatus | null = null;
    for (const { status } of this.jobs.values()) {
      if (status.finishedAt && now - status.finishedAt < FINISHED_VISIBLE_MS && (!latest || status.finishedAt > latest.finishedAt!)) {
        latest = status;
      }
    }
    return latest ? { ...latest } : null;
  }

  async drain(): Promise<void> {
    await Promise.all([...this.jobs.values()].map((job) => job.promise));
  }
}

/* ------------------------------------------------------------------ */
/* Import existing projects                                            */
/* ------------------------------------------------------------------ */

interface CarouselMatch {
  item: Record<string, unknown>;
  nodeId: string;
  nodeType: string;
  data: Record<string, unknown>;
}

interface ProjectWorkflow {
  id: string | null;
  name: string | null;
  carousel: Map<string, CarouselMatch>;
}

const HISTORY_FIELDS = ["imageHistory", "videoHistory", "audioHistory"] as const;

/** The project's newest workflow JSON (by mtime), as /api/workflow?load=true picks it. */
export async function readProjectWorkflow(projectDir: string): Promise<ProjectWorkflow | null> {
  let names: string[];
  try {
    names = (await fs.readdir(projectDir)).filter((name) => name.toLowerCase().endsWith(".json"));
  } catch {
    return null;
  }
  const candidates: { file: string; mtime: number }[] = [];
  for (const name of names) {
    const file = path.join(projectDir, name);
    try {
      const stat = await fs.stat(file);
      if (stat.isFile() && stat.size < 512 * 1024 * 1024) candidates.push({ file, mtime: stat.mtimeMs });
    } catch {
      // Unreadable; skip.
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const { file } of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
      if (typeof parsed.version !== "number" || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) continue;
      const carousel = new Map<string, CarouselMatch>();
      for (const node of parsed.nodes as Record<string, unknown>[]) {
        const data = (node?.data ?? {}) as Record<string, unknown>;
        for (const field of HISTORY_FIELDS) {
          const items = data[field];
          if (!Array.isArray(items)) continue;
          for (const item of items as Record<string, unknown>[]) {
            if (item && typeof item.id === "string") {
              carousel.set(item.id, {
                item,
                nodeId: typeof node.id === "string" ? node.id : "",
                nodeType: typeof node.type === "string" ? node.type : "",
                data,
              });
            }
          }
        }
      }
      return {
        id: isWorkflowId(parsed.id) ? parsed.id : null,
        name: typeof parsed.name === "string" ? parsed.name : null,
        carousel,
      };
    } catch {
      // Not a workflow file.
    }
  }
  return null;
}

/** The model a carousel entry ran, with provider and label from its node when they agree. */
function carouselModel(match: CarouselMatch): AssetModelRef | undefined {
  const generation = match.item.generation as { modelId?: unknown } | undefined;
  const modelId =
    typeof generation?.modelId === "string" ? generation.modelId : typeof match.item.model === "string" ? match.item.model : null;
  if (!modelId) return undefined;
  const selected = match.data.selectedModel as { provider?: unknown; modelId?: unknown; displayName?: unknown } | undefined;
  if (selected && selected.modelId === modelId) {
    return {
      provider: typeof selected.provider === "string" ? selected.provider : "",
      modelId,
      ...(typeof selected.displayName === "string" ? { displayName: selected.displayName } : {}),
    };
  }
  return { provider: modelId.startsWith("nano-banana") ? "gemini" : "", modelId };
}

interface ImportDeps {
  library: AssetLibrary;
  thumbs: Thumbnailer | null;
}

/**
 * Indexes the files in each project's `generations/` folder in place:
 * hashes, measures, and attaches what the newest workflow JSON knows about
 * each file (its carousel entry: prompt, model, parameters).
 */
export async function runImport(ctx: JobContext, deps: ImportDeps, projectDirs: string[]): Promise<string> {
  const { library } = deps;
  await library.ready();
  const plan: { projectDir: string; files: { file: string; size: number; mtime: number }[] }[] = [];
  let skippedDirs = 0;
  for (const dir of projectDirs) {
    ctx.checkCancelled();
    const generations = path.join(dir, "generations");
    let names: string[];
    try {
      names = await fs.readdir(generations);
    } catch {
      skippedDirs++;
      continue;
    }
    const files: { file: string; size: number; mtime: number }[] = [];
    for (const name of names.sort()) {
      if (name.endsWith(PARTIAL_SUFFIX) || !isMediaExtension(extOf(name))) continue;
      const file = path.join(generations, name);
      if (library.recordsAtPath(file).length) continue;
      try {
        const stat = await fs.stat(file);
        if (stat.isFile() && stat.size > 0) files.push({ file, size: stat.size, mtime: stat.mtimeMs });
      } catch {
        // Vanished; skip.
      }
    }
    plan.push({ projectDir: dir, files });
  }
  ctx.update({
    total: plan.reduce((sum, entry) => sum + entry.files.length, 0),
    bytesTotal: plan.reduce((sum, entry) => sum + entry.files.reduce((s, f) => s + f.size, 0), 0),
  });

  let imported = 0;
  let failed = 0;
  for (const { projectDir, files } of plan) {
    const workflow = await readProjectWorkflow(projectDir);
    const workflowId =
      workflow?.id ?? `import_${createHash("sha1").update(pathKey(projectDir)).digest("hex").slice(0, 16)}`;
    const workflowName = workflow?.name ?? path.basename(projectDir);
    // Importing is an explicit "these files belong to this folder"; a name set in the app since is kept.
    const existing = library.getWorkflow(workflowId);
    await library.upsertWorkflow(workflowId, { name: existing?.name ?? workflowName, projectPath: projectDir });
    const runId = newRunId();
    for (const { file, size, mtime } of files) {
      ctx.checkCancelled();
      try {
        const digest = await hashFile(file, ctx.signal);
        const ext = extOf(file);
        const hinted = mediaTypeForExt(ext);
        if (!hinted) throw new Error("unsupported type");
        const head = await readHead(file, 64 * 1024);
        const type = decideMediaType({ head, kind: hinted.kind, hintExt: ext });
        const filename = path.basename(file);
        const match = workflow?.carousel.get(filename.slice(0, filename.length - ext.length - 1));
        let dims: { width?: number; height?: number; durationSec?: number } = {};
        if (type.kind === "image") dims = (await imageDimensionsFromFile(file, ext, head)) ?? {};
        else if (type.kind === "video" || type.kind === "audio") dims = await probeAudioVideo({ path: file }, type.kind);

        const generation = match?.item.generation as { parameters?: unknown; cost?: unknown } | undefined;
        const cost = generation?.cost as { amount?: unknown; estimated?: unknown } | undefined;
        const record: AssetRecord = {
          v: 1,
          id: newAssetId(),
          kind: type.kind,
          origin: "generated",
          mime: type.mime,
          ext,
          bytes: digest.bytes,
          sha256: digest.sha256,
          md5: digest.md5,
          file: { root: "external", path: file },
          filename,
          ...(dims.width && dims.height ? { width: dims.width, height: dims.height } : {}),
          ...(dims.durationSec ? { durationSec: dims.durationSec } : {}),
          createdAt: Math.floor(mtime),
          ...(typeof match?.item.prompt === "string" && match.item.prompt ? { prompt: match.item.prompt } : {}),
          ...(match && carouselModel(match) ? { model: carouselModel(match) } : {}),
          ...(generation?.parameters && typeof generation.parameters === "object"
            ? { parameters: generation.parameters as Record<string, unknown> }
            : {}),
          ...(typeof match?.item.aspectRatio === "string" ? { aspectRatio: match.item.aspectRatio } : {}),
          ...(cost && typeof cost.amount === "number"
            ? { cost: { amount: cost.amount, currency: "USD" as const, estimated: cost.estimated === true } }
            : {}),
          producer: { nodeId: match?.nodeId ?? "", nodeType: match?.nodeType ?? "import" },
          workflowId,
          workflowName,
          runId,
          tags: [],
          favorite: false,
          imported: true,
        };
        const saved = await library.addRecord(record);
        deps.thumbs?.enqueue(saved, file);
        imported++;
      } catch (error) {
        if (error instanceof LibraryError && error.code === "cancelled") throw error;
        failed++;
      }
      ctx.addBytes(size);
      ctx.step();
    }
  }
  const parts = [`Imported ${imported} ${imported === 1 ? "file" : "files"}.`];
  if (failed) parts.push(`${failed} could not be read.`);
  if (skippedDirs) parts.push(`${skippedDirs} ${skippedDirs === 1 ? "folder has" : "folders have"} no generations folder.`);
  return parts.join(" ");
}

/** Checks and normalises the folders of an import request. */
export function normaliseImportDirs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new LibraryError("Choose at least one project folder", 400, "bad_request");
  }
  if (value.length > 500) throw new LibraryError("Too many folders", 400, "bad_request");
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const entry of value) {
    const dir = normaliseProjectDir(entry);
    const key = pathKey(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(dir);
  }
  return dirs;
}

/* ------------------------------------------------------------------ */
/* Cleanup                                                             */
/* ------------------------------------------------------------------ */

interface CleanupDeps {
  library: AssetLibrary;
  thumbs: Thumbnailer | null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * `unusedMedia`: delete snapshot media no stored run references, posters of
 * assets that no longer exist, stale partial files, and trim the thumbnail
 * cache. `thumbnails`: empty the thumbnail cache.
 */
export async function runCleanup(
  ctx: JobContext,
  deps: CleanupDeps,
  request: { unusedMedia?: boolean; thumbnails?: boolean },
): Promise<string> {
  const { library, thumbs } = deps;
  await library.ready();
  let files = 0;
  let bytes = 0;
  const remove = async (file: string) => {
    try {
      const stat = await fs.stat(file);
      await unlinkWithRetry(file);
      files++;
      bytes += stat.size;
    } catch {
      // Held open or gone.
    }
  };

  if (request.unusedMedia) {
    const referenced = await library.runs.referencedHashes();
    const media = await library.runs.mediaEntries();
    let posterNames: string[] = [];
    try {
      posterNames = await fs.readdir(library.layout.posters);
    } catch {
      posterNames = [];
    }
    ctx.update({ total: media.length + posterNames.length });
    for (const entry of media) {
      ctx.checkCancelled();
      if (!referenced.has(entry.sha256)) {
        await remove(entry.path);
        library.runs.forgetMedia(entry.sha256);
      }
      ctx.step();
    }
    for (const name of posterNames) {
      ctx.checkCancelled();
      const sha = name.split(".")[0];
      if (library.recordsWithHash(sha).length === 0) await remove(path.join(library.layout.posters, name));
      ctx.step();
    }
    for (const dir of [library.layout.data, library.layout.assets, library.layout.runs, library.layout.media, library.layout.posters]) {
      await sweepStaleTemps(dir, 60 * 60 * 1000);
    }
    await thumbs?.trim();
  }
  if (request.thumbnails && thumbs) {
    ctx.checkCancelled();
    files += await thumbs.clear();
  }
  return files ? `Removed ${files} ${files === 1 ? "file" : "files"}${bytes ? ` (${formatBytes(bytes)})` : ""}.` : "Nothing to clean up.";
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/** `name.ext`, then `name (2).ext`, … — whichever does not exist yet (created exclusively). */
async function copyToUniqueName(source: string, dir: string, filename: string): Promise<string> {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  for (let n = 1; n < 10_000; n++) {
    const target = path.join(dir, n === 1 ? filename : `${base} (${n})${ext}`);
    try {
      await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL);
      return target;
    } catch (error) {
      if (errnoCode(error) !== "EEXIST") throw error;
    }
  }
  throw new LibraryError(`Too many files named ${filename} in the destination`, 409, "conflict");
}

/** Checks an export destination: absolute, and not inside the library's own data folder. */
export async function prepareExportDest(value: unknown, library: AssetLibrary): Promise<string> {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw new LibraryError("Choose a folder to export to", 400, "bad_request");
  }
  const dest = path.resolve(value);
  if (isInsideRoot(library.layout.data, dest, { allowEqual: true })) {
    throw new LibraryError("Choose a folder outside the library's data folder", 400, "bad_request");
  }
  await fs.mkdir(dest, { recursive: true });
  return dest;
}

export async function runExport(ctx: JobContext, library: AssetLibrary, ids: string[], dest: string): Promise<string> {
  const records = ids
    .map((id) => library.get(id))
    .filter((record): record is AssetRecord => Boolean(record));
  ctx.update({ total: records.length, bytesTotal: records.reduce((sum, record) => sum + record.bytes, 0) });
  let copied = 0;
  let missing = 0;
  for (const record of records) {
    ctx.checkCancelled();
    const file = library.filePath(record);
    try {
      if (!file) throw new Error("no file");
      await copyToUniqueName(file, dest, record.filename);
      copied++;
    } catch (error) {
      if (errnoCode(error) === "ENOENT") library.setMissing(record.id, true);
      missing++;
    }
    ctx.addBytes(record.bytes);
    ctx.step();
  }
  const parts = [`Exported ${copied} ${copied === 1 ? "file" : "files"}.`];
  if (missing) parts.push(`${missing} could not be found.`);
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/* Move                                                                */
/* ------------------------------------------------------------------ */

/** realpath of the nearest existing ancestor, with the rest re-appended (the target may not exist yet). */
async function realpathNearest(target: string): Promise<string> {
  const rest: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

async function isNonEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await fs.readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

/**
 * Checks a move destination before the job starts: absolute, not the
 * current root, neither inside the other (after resolving symlinks such as
 * macOS's /var → /private/var, case-folded where the disk folds case), and
 * not already holding a library.
 */
export async function validateMoveTarget(fromRoot: string, target: unknown, platform: NodeJS.Platform = process.platform): Promise<string> {
  if (typeof target !== "string" || !path.isAbsolute(target) || target.includes("\0")) {
    throw new LibraryError("Choose a folder for the library", 400, "bad_request");
  }
  const to = path.resolve(target);
  const [realFrom, realTo] = await Promise.all([realpathNearest(fromRoot), realpathNearest(to)]);
  const fold = (value: string) => (foldsCase(platform) ? value.toLowerCase() : value);
  if (fold(realFrom) === fold(realTo)) throw new LibraryError("That is already the library folder", 400, "bad_request");
  if (isInsideRoot(realFrom, realTo, { platform }) || isInsideRoot(realTo, realFrom, { platform })) {
    throw new LibraryError("The new folder can't be inside the library, or contain it", 400, "bad_request");
  }
  try {
    const stat = await fs.stat(to);
    if (!stat.isDirectory()) throw new LibraryError("That is a file, not a folder", 400, "bad_request");
  } catch (error) {
    if (error instanceof LibraryError) throw error;
  }
  if ((await isNonEmptyDir(path.join(to, DATA_DIR))) || (await isNonEmptyDir(path.join(to, GENERATIONS_DIR)))) {
    throw new LibraryError(
      "That folder already holds a Node Banana library. Use it as it is, or choose an empty folder.",
      409,
      "conflict",
    );
  }
  return to;
}

interface ManifestEntry {
  rel: string;
  source: string;
  size: number;
}

/** Library-owned files only: Generations/ and .nodebanana/ (never projects, caches, locks or temp files). */
async function buildManifest(root: string): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  const skipDirs = new Set([path.join(root, DATA_DIR, "cache")]);
  const skipFiles = new Set([path.join(root, DATA_DIR, "lock"), path.join(root, DATA_DIR, "config.json")]);
  const walk = async (dir: string) => {
    let names: import("fs").Dirent[];
    try {
      names = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of names) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (!skipDirs.has(full)) await walk(full);
      } else if (dirent.isFile()) {
        if (skipFiles.has(full) || dirent.name.endsWith(PARTIAL_SUFFIX) || dirent.name.endsWith(".tmp")) continue;
        if (dirent.name.startsWith(".probe-")) continue;
        const stat = await fs.stat(full);
        entries.push({ rel: path.relative(root, full), source: full, size: stat.size });
      }
    }
  };
  await walk(path.join(root, GENERATIONS_DIR));
  await walk(path.join(root, DATA_DIR));
  return entries;
}

async function removeEmptyDirs(dirs: Iterable<string>, stopAt: string): Promise<void> {
  const sorted = [...new Set(dirs)].sort((a, b) => b.length - a.length);
  for (const dir of sorted) {
    let current = dir;
    while (isInsideRoot(stopAt, current)) {
      try {
        await fs.rmdir(current);
      } catch {
        break;
      }
      current = path.dirname(current);
    }
  }
}

export interface MoveDeps {
  library: AssetLibrary;
  ingest: Ingestor;
  toRoot: string;
  setPaused(paused: boolean): void;
  /** Persists the new root and swaps the server over to it. */
  switchRoot(toRoot: string): Promise<void>;
}

/**
 * Copies the library-owned files to the new root from a manifest, verifying
 * size and hash per file, with recording (and every other write) paused;
 * switches the root only once everything verified; then deletes exactly the
 * files it copied from the old root. A failure or cancel before the switch
 * removes the copies and leaves the old library untouched.
 */
export async function runMove(ctx: JobContext, deps: MoveDeps): Promise<string> {
  const from = deps.library;
  const fromRoot = from.root;
  const toRoot = deps.toRoot;
  deps.setPaused(true);
  const copied: { source: string; dest: string }[] = [];
  let lock: Awaited<ReturnType<typeof acquireLock>> = null;
  let switched = false;
  try {
    if (!(await deps.ingest.waitIdle(60_000))) {
      throw new LibraryError("Recordings are still being saved. Try again in a moment.", 409, "busy");
    }
    lock = await acquireLock(from.layout.lock, { heartbeat: true });
    if (!lock) throw new LibraryError("The library is busy in another window. Try again in a moment.", 409, "busy");
    await from.drain();

    const manifest = await buildManifest(fromRoot);
    ctx.update({ total: manifest.length, bytesTotal: manifest.reduce((sum, entry) => sum + entry.size, 0) });
    await fs.mkdir(toRoot, { recursive: true });
    for (const entry of manifest) {
      ctx.checkCancelled();
      const dest = path.join(toRoot, entry.rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await copyFileVerified(entry.source, dest, { signal: ctx.signal, onBytes: (bytes) => ctx.addBytes(bytes) });
      copied.push({ source: entry.source, dest });
      ctx.step();
    }
    ctx.checkCancelled();
    await deps.switchRoot(toRoot);
    switched = true;
  } catch (error) {
    if (!switched) {
      for (const { dest } of copied) await unlinkWithRetry(dest).catch(() => {});
      await removeEmptyDirs(copied.map(({ dest }) => path.dirname(dest)), toRoot);
    }
    throw error;
  } finally {
    await lock?.release();
    deps.setPaused(false);
  }

  let leftovers = 0;
  for (const { source } of copied) {
    try {
      await unlinkWithRetry(source);
    } catch {
      leftovers++;
    }
  }
  await removeEmptyDirs(copied.map(({ source }) => path.dirname(source)), fromRoot);
  const moved = `Moved ${copied.length} ${copied.length === 1 ? "file" : "files"}.`;
  return leftovers
    ? `${moved} ${leftovers} could not be removed from the old folder (${fromRoot}); they are safe to delete.`
    : moved;
}
