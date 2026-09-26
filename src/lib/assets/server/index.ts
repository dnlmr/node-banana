/**
 * Server-side asset library: the facade the /api/assets routes call.
 *
 * Internal modules live next to this file (paths, fsutil, validate, media,
 * layout, library, search, workflows, runs, ingest, download, thumbs, jobs,
 * desktop). Routes import only from here and must not reach into them.
 *
 * All functions throw `LibraryError` for expected failures; routes map
 * `status` to the HTTP status and `message` to `{ error }` (and send
 * `Retry-After` when `retryAfter` is set, e.g. code "paused" during a move).
 *
 * State lives in one runtime object on `globalThis`, so Next's per-route
 * module copies and dev reloads share one index, one ticket table and one
 * job runner per process.
 */

import { promises as fs } from "fs";
import path from "path";
import type {
  AssetBulkRequest,
  AssetBulkResult,
  AssetExistence,
  AssetFacets,
  AssetPage,
  AssetPageRequest,
  AssetPatch,
  AssetRecord,
  AssetView,
  AssetWorkflowResult,
  CleanupRequest,
  ExportAssetsRequest,
  ImportProjectsRequest,
  LibraryJobStatus,
  LibraryStatus,
  LibraryWorkflowEntry,
  PutRunRequest,
  PutRunResult,
  RecordAssetRequest,
  RecordAssetResult,
  SetLibraryRootRequest,
  UploadTicket,
} from "../types";
import { openFolder, revealFile } from "./desktop";
import { LibraryError } from "./errors";
import { hideOnWindows, isInsideRoot, sweepStaleTemps } from "./fsutil";
import { Ingestor, PAUSED_RETRY_AFTER, STALE_PARTIAL_MS } from "./ingest";
import {
  JobRunner,
  normaliseImportDirs,
  prepareExportDest,
  runCleanup,
  runExport,
  runImport,
  runMove,
  validateMoveTarget,
} from "./jobs";
import { AssetLibrary } from "./library";
import {
  currentPathContext,
  envVar,
  initLibraryLocation,
  isHostedServer,
  detectSynced,
  pathApi,
  probeWritable,
  resetPathCachesForTests,
  writeLibraryConfig,
  type LocationResult,
  type PathContext,
  type ResolvedLocation,
} from "./paths";
import { runMeta } from "./runs";
import { Thumbnailer } from "./thumbs";
import { extOf, isAssetId, isMediaExtension, isSha256, requireSha256 } from "./validate";

export { LibraryError } from "./errors";

/** A file the route streams to the client (supports Range). */
export interface ServedFile {
  path: string;
  mime: string;
  bytes: number;
  /** ETag source. */
  sha256: string;
  /** Suggested download name. */
  filename: string;
}

/* ------------------------------------------------------------------ */
/* Runtime                                                             */
/* ------------------------------------------------------------------ */

const RUNTIME_VERSION = 1;
const HOSTED_REASON = "The asset library needs Node Banana running on your own computer.";
/** How often a healthy location is checked for its data folder (a drive can be unplugged). */
const RECHECK_OK_MS = 60_000;
/** How often an unavailable location is retried (a drive can be plugged back in). */
const RECHECK_FAILED_MS = 10_000;
/** How often library.json is stat'ed for a switch made by the other build. */
const CONFIG_STAMP_MS = 2_000;

interface ResolvedState {
  key: string;
  result: LocationResult;
  checkedAt: number;
  stampAt: number;
  configStamp: string;
}

interface Runtime {
  version: number;
  ctxOverride: PathContext | null;
  resolved: ResolvedState | null;
  resolving: Promise<LocationResult> | null;
  library: AssetLibrary | null;
  thumbs: Thumbnailer | null;
  ingest: Ingestor;
  jobs: JobRunner;
  paused: boolean;
  /** Writes other than recordings in flight (edits, snapshots, media, workflow rows). */
  writes: number;
  writeWaiters: (() => void)[];
  initialised: Set<string>;
  background: Set<Promise<unknown>>;
}

const globalState = globalThis as typeof globalThis & { __nodeBananaAssetLibrary?: Runtime };

function createRuntime(): Runtime {
  const rt = {
    version: RUNTIME_VERSION,
    ctxOverride: null,
    resolved: null,
    resolving: null,
    library: null,
    thumbs: null,
    jobs: new JobRunner(),
    paused: false,
    writes: 0,
    writeWaiters: [],
    initialised: new Set<string>(),
    background: new Set<Promise<unknown>>(),
  } as unknown as Runtime;
  rt.ingest = new Ingestor({
    library: () => {
      if (!rt.library) throw new LibraryError("The asset library is not available", 503, "unavailable");
      return rt.library;
    },
    thumbs: () => rt.thumbs,
    isPaused: () => rt.paused,
  });
  return rt;
}

function runtime(): Runtime {
  const existing = globalState.__nodeBananaAssetLibrary;
  // After a dev reload the object may come from an older version of this module.
  if (existing && existing.version === RUNTIME_VERSION) return existing;
  const created = createRuntime();
  globalState.__nodeBananaAssetLibrary = created;
  return created;
}

function track(rt: Runtime, promise: Promise<unknown>): void {
  const tracked = promise.catch((error) => console.warn("[assets]", error)).finally(() => rt.background.delete(tracked));
  rt.background.add(tracked);
}

function pathContext(rt: Runtime): PathContext {
  return rt.ctxOverride ?? currentPathContext();
}

function contextKey(ctx: PathContext): string {
  return [
    ctx.platform,
    ctx.homedir,
    envVar(ctx, "NODE_BANANA_ASSET_LIBRARY") ?? "",
    envVar(ctx, "NODE_BANANA_DEFAULT_LIBRARY") ?? "",
  ].join("\0");
}

async function fileStamp(file: string | undefined): Promise<string> {
  if (!file) return "";
  try {
    const stat = await fs.stat(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "absent";
  }
}

/**
 * The current location, re-resolved when the environment changed, when
 * library.json changed (the other build switched or moved the library), and
 * periodically so an unplugged or reconnected drive is noticed.
 */
async function activeLocation(rt: Runtime): Promise<LocationResult> {
  const ctx = pathContext(rt);
  const key = contextKey(ctx);
  const now = Date.now();
  const state = rt.resolved;
  if (state && state.key === key) {
    const age = now - state.checkedAt;
    let fresh = state.result.ok ? true : age < RECHECK_FAILED_MS;
    if (state.result.ok && age >= RECHECK_OK_MS) {
      // A cheap look rather than a write probe, so a synced folder doesn't churn.
      fresh = (await fileStamp(path.join(state.result.location.root, ".nodebanana"))) !== "absent";
      if (fresh) state.checkedAt = now;
    }
    if (fresh) {
      if (now - state.stampAt < CONFIG_STAMP_MS) return state.result;
      const stamp = await fileStamp(state.result.location?.configFile);
      state.stampAt = now;
      if (stamp === state.configStamp) return state.result;
    }
  }
  rt.resolving ??= (async () => {
    try {
      const result = await initLibraryLocation(ctx);
      rt.resolved = {
        key,
        result,
        checkedAt: Date.now(),
        stampAt: Date.now(),
        configStamp: await fileStamp(result.location?.configFile),
      };
      return result;
    } finally {
      rt.resolving = null;
    }
  })();
  return rt.resolving;
}

/** The index for a location, created (and initialised in the background) on first use. */
function libraryFor(rt: Runtime, location: ResolvedLocation): AssetLibrary {
  if (!rt.library || rt.library.root !== location.root) {
    const previous = rt.library;
    rt.library = new AssetLibrary(location.root);
    if (previous) track(rt, previous.drain());
  }
  if (!rt.thumbs || rt.thumbs.dir !== path.join(location.cacheDir, "thumbs")) {
    rt.thumbs = new Thumbnailer(location.cacheDir, () => rt.library);
  }
  const library = rt.library;
  if (!rt.initialised.has(location.root)) {
    rt.initialised.add(location.root);
    track(rt, initialiseRoot(rt, library));
  }
  return library;
}

/**
 * Once per root and process: the library marker, hidden data folder on
 * Windows, a sweep of stale partial files, the index scan, then auto-empty
 * of Trash items older than 30 days and a thumbnail cache trim.
 */
async function initialiseRoot(rt: Runtime, library: AssetLibrary): Promise<void> {
  const layout = library.layout;
  await fs.mkdir(layout.assets, { recursive: true });
  hideOnWindows(layout.data);
  try {
    await fs.writeFile(layout.libraryFile, `${JSON.stringify({ v: 1, createdAt: Date.now() })}\n`, { flag: "wx" });
  } catch {
    // Already marked.
  }
  await library.ensureLoaded();
  const dirs = [layout.data, layout.assets, layout.runs, layout.media, layout.posters];
  try {
    for (const day of await fs.readdir(layout.generations)) dirs.push(path.join(layout.generations, day));
  } catch {
    // No generations yet.
  }
  for (const dir of dirs) await sweepStaleTemps(dir, STALE_PARTIAL_MS);
  if (!rt.paused) await counted(rt, () => library.emptyExpiredTrash());
  await rt.thumbs?.trim();
}

async function availableLibrary(rt: Runtime): Promise<{ library: AssetLibrary; location: ResolvedLocation }> {
  if (isHostedServer()) throw new LibraryError(HOSTED_REASON, 503, "unavailable");
  const result = await activeLocation(rt);
  if (!result.ok) throw new LibraryError(result.reason, 503, "unavailable");
  return { library: libraryFor(rt, result.location), location: result.location };
}

async function readyLibrary(): Promise<AssetLibrary> {
  const { library } = await availableLibrary(runtime());
  await library.ready();
  return library;
}

/** Writes wait while a move copies the library (they would be lost from the copy). */
function assertWritable(rt: Runtime): void {
  if (rt.paused) {
    throw new LibraryError("The library is being moved. Try again in a moment.", 503, "paused", PAUSED_RETRY_AFTER);
  }
}

/**
 * Runs a write against the ready library, counted so a move can wait for it.
 * The pause check and the count happen with no await between them.
 */
async function write<T>(fn: (library: AssetLibrary) => Promise<T>): Promise<T> {
  const rt = runtime();
  assertWritable(rt);
  const library = await readyLibrary();
  return counted(rt, () => fn(library));
}

/** Counts `fn` as an in-flight write (after checking the pause, synchronously). */
async function counted<T>(rt: Runtime, fn: () => Promise<T>): Promise<T> {
  assertWritable(rt);
  rt.writes++;
  try {
    return await fn();
  } finally {
    rt.writes--;
    if (rt.writes === 0) {
      const waiters = rt.writeWaiters;
      rt.writeWaiters = [];
      waiters.forEach((wake) => wake());
    }
  }
}

/** Resolves once no recording or other write is in flight (false after `timeoutMs`). */
async function waitForWrites(rt: Runtime, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  if (!(await rt.ingest.waitIdle(timeoutMs))) return false;
  if (rt.writes === 0) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
    rt.writeWaiters.push(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/* Location and status ------------------------------------------------ */

function emptyStatus(reason: string, platform: string): LibraryStatus {
  return {
    available: false,
    reason,
    root: null,
    source: "default",
    defaultRoot: "",
    cacheDir: "",
    platform,
    synced: null,
    counts: { assets: 0, trashed: 0, bytes: 0 },
    empty: true,
    job: null,
  };
}

/** A cheap "anything recorded yet?" while the first scan is still running. */
async function hasAnySidecar(assetsDir: string): Promise<boolean> {
  let dir: import("fs").Dir | null = null;
  try {
    dir = await fs.opendir(assetsDir);
    for (let checked = 0; checked < 64; checked++) {
      const entry = await dir.read();
      if (!entry) return false;
      if (/^a[0-9a-z]{12,24}\.json$/.test(entry.name)) return true;
    }
    return true;
  } catch {
    return false;
  } finally {
    await dir?.close().catch(() => {});
  }
}

/** Resolves (and on first use, creates and persists) the library root. Never throws for an unwritable root: returns `available: false` with a reason. */
export async function getLibraryStatus(): Promise<LibraryStatus> {
  const rt = runtime();
  const ctx = pathContext(rt);
  if (isHostedServer()) return emptyStatus(HOSTED_REASON, ctx.platform);
  try {
    const result = await activeLocation(rt);
    const location = result.location;
    const base = {
      root: location?.root ?? null,
      source: location?.source ?? "default",
      defaultRoot: location?.defaultRoot ?? "",
      ...(location?.fallbackReason ? { fallbackReason: location.fallbackReason } : {}),
      cacheDir: location?.cacheDir ?? "",
      platform: ctx.platform,
      synced: location ? detectSynced(location.root, ctx) : null,
      job: rt.jobs.visible(),
    };
    if (!result.ok || !location) {
      return { ...base, available: false, reason: result.ok ? "Unavailable" : result.reason, counts: { assets: 0, trashed: 0, bytes: 0 }, empty: true };
    }
    const library = libraryFor(rt, location);
    // Kick off the scan; answer with counts if it finishes quickly.
    const loading = library.ensureLoaded().then(() => library.refresh());
    loading.catch(() => {});
    await Promise.race([loading, new Promise((resolve) => setTimeout(resolve, 1500))]);
    const counts = library.loaded ? library.stats() : { assets: 0, trashed: 0, bytes: 0 };
    const empty = library.loaded ? library.isEmpty() : !(await hasAnySidecar(library.layout.assets));
    return { ...base, available: true, counts, empty, job: rt.jobs.visible() };
  } catch (error) {
    return emptyStatus(error instanceof Error ? error.message : String(error), ctx.platform);
  }
}

/** `switch` changes the root now; `move` starts a background move job and switches when it verifies. */
export async function setLibraryRoot(request: SetLibraryRootRequest): Promise<LibraryStatus> {
  const rt = runtime();
  if (isHostedServer()) throw new LibraryError(HOSTED_REASON, 503, "unavailable");
  if (!request || typeof request !== "object" || (request.mode !== "move" && request.mode !== "switch")) {
    throw new LibraryError("mode must be move or switch", 400, "bad_request");
  }
  const ctx = pathContext(rt);
  const result = await activeLocation(rt);
  const location = result.location;
  if (location?.source === "env") {
    throw new LibraryError(
      "The library folder is set by NODE_BANANA_ASSET_LIBRARY, so it can't be changed here.",
      409,
      "forbidden",
    );
  }
  if (rt.jobs.isRunning) {
    throw new LibraryError("Another library task is running. Wait for it to finish or cancel it.", 409, "busy");
  }
  const api = pathApi(ctx.platform);
  if (typeof request.root !== "string" || !api.isAbsolute(request.root) || request.root.includes("\0")) {
    throw new LibraryError("Choose a folder for the library", 400, "bad_request");
  }
  const configFile = location?.configFile;
  if (!configFile) throw new LibraryError("The library location can't be changed", 500, "unavailable");

  const switchTo = async (root: string) => {
    await writeLibraryConfig(configFile, { root, setBy: "user" });
    rt.resolved = null;
    const next = await activeLocation(rt);
    if (next.ok) libraryFor(rt, next.location);
  };

  if (request.mode === "switch") {
    const root = api.resolve(request.root);
    if (location && root === location.root) return getLibraryStatus();
    const failure = await probeWritable(root);
    if (failure) {
      throw new LibraryError(`Node Banana can't write to "${root}" (${failure.code}).`, 400, "bad_request");
    }
    await switchTo(root);
    return getLibraryStatus();
  }

  if (!result.ok || !location) throw new LibraryError(result.ok ? "Unavailable" : result.reason, 503, "unavailable");
  const library = libraryFor(rt, location);
  await library.ready();
  const toRoot = await validateMoveTarget(location.root, request.root, ctx.platform);
  const failure = await probeWritable(toRoot);
  if (failure) throw new LibraryError(`Node Banana can't write to "${toRoot}" (${failure.code}).`, 400, "bad_request");
  // The probe leaves an empty data folder behind; the move copies into it.
  rt.jobs.start("move", (job) =>
    runMove(job, {
      library,
      waitForWrites: (timeoutMs) => waitForWrites(rt, timeoutMs),
      toRoot,
      setPaused: (paused) => {
        rt.paused = paused;
      },
      switchRoot: switchTo,
    }),
  );
  return getLibraryStatus();
}

/* Browsing ----------------------------------------------------------- */

export async function listAssets(request: AssetPageRequest): Promise<AssetPage> {
  const library = await readyLibrary();
  return library.query(request ?? {});
}

export async function getFacets(): Promise<AssetFacets> {
  const library = await readyLibrary();
  return library.facets();
}

export async function getAsset(id: string): Promise<AssetView | null> {
  if (!isAssetId(id)) return null;
  const library = await readyLibrary();
  const record = await library.find(id);
  if (!record) return null;
  await library.verifyFiles([record]);
  return library.toView(record);
}

/** Never throws for an unavailable library: every id is then `unknown`. */
export async function assetExistence(ids: string[]): Promise<Record<string, AssetExistence>> {
  if (!Array.isArray(ids)) throw new LibraryError("ids must be a list", 400, "bad_request");
  const list = ids.filter((id): id is string => typeof id === "string").slice(0, 5000);
  try {
    const library = await readyLibrary();
    return await library.existence(list);
  } catch (error) {
    if (error instanceof LibraryError && error.code !== "unavailable") throw error;
    return Object.fromEntries(list.map((id) => [id, "unknown" as const]));
  }
}

/* Mutations ---------------------------------------------------------- */

export async function patchAsset(id: string, patch: AssetPatch): Promise<AssetView | null> {
  if (!isAssetId(id)) return null;
  return write((library) => library.patch(id, patch));
}

export async function bulkAssets(request: AssetBulkRequest): Promise<AssetBulkResult> {
  return write((library) => library.bulk(request));
}

/* Recording ---------------------------------------------------------- */

/** `upload` source → a ticket for PUT /uploads/[id]; `url` source → downloads and records now. */
export async function beginRecord(
  request: RecordAssetRequest,
): Promise<{ ticket: UploadTicket } | { result: RecordAssetResult }> {
  const rt = runtime();
  assertWritable(rt);
  await readyLibrary();
  return rt.ingest.begin(request);
}

/** Streams the upload body to disk while hashing, then finalises the record. */
export async function completeUpload(
  uploadId: string,
  body: ReadableStream<Uint8Array>,
  contentType: string | null,
): Promise<RecordAssetResult> {
  const rt = runtime();
  await readyLibrary();
  return rt.ingest.complete(uploadId, body, contentType);
}

/* Files -------------------------------------------------------------- */

/** The record's file, re-checked: inside the library, or exactly the recorded external media path. */
async function verifiedFile(library: AssetLibrary, record: AssetRecord): Promise<{ file: string; bytes: number } | null> {
  const file = library.filePath(record);
  if (!file) return null;
  if (record.file.root === "library" && !isInsideRoot(library.root, file)) return null;
  if (record.file.root === "external" && (file !== record.file.path || !isMediaExtension(extOf(file)))) return null;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) {
      library.setMissing(record.id, true);
      return null;
    }
    library.setMissing(record.id, false);
    return { file, bytes: stat.size };
  } catch {
    library.setMissing(record.id, true);
    return null;
  }
}

export async function openAssetFile(id: string): Promise<ServedFile | null> {
  if (!isAssetId(id)) return null;
  const library = await readyLibrary();
  const record = await library.find(id);
  if (!record) return null;
  const verified = await verifiedFile(library, record);
  if (!verified) return null;
  return { path: verified.file, mime: record.mime, bytes: verified.bytes, sha256: record.sha256, filename: record.filename };
}

/** Stores a browser-made poster (video/3D) and derives its thumbnails. */
export async function putPoster(id: string, bytes: Uint8Array, mime: string): Promise<void> {
  if (!isAssetId(id)) throw new LibraryError("Invalid asset id", 400, "bad_request");
  const rt = runtime();
  await write(async (library) => {
    const record = await library.find(id);
    if (!record) throw new LibraryError("Asset not found", 404, "not_found");
    if (!rt.thumbs) throw new LibraryError("The asset library is not available", 503, "unavailable");
    await rt.thumbs.putPoster(record, bytes, mime);
    await library.setHasPoster(id);
  });
}

/** Returns a cached webp thumbnail, rendering it on a miss (bounded concurrency). Null → the client draws a placeholder. */
export async function getThumbnail(sha256: string, width: 320 | 640): Promise<ServedFile | null> {
  if (!isSha256(sha256)) return null;
  const rt = runtime();
  try {
    // Tiles don't need the journal replayed first; the thumbnail is keyed by content.
    const { library } = await availableLibrary(rt);
    await library.ensureLoaded();
  } catch {
    return null;
  }
  return (await rt.thumbs?.get(sha256, width)) ?? null;
}

export async function revealAsset(id: string): Promise<void> {
  if (!isAssetId(id)) throw new LibraryError("Invalid asset id", 400, "bad_request");
  const library = await readyLibrary();
  const record = await library.find(id);
  if (!record) throw new LibraryError("Asset not found", 404, "not_found");
  const verified = await verifiedFile(library, record);
  if (!verified) throw new LibraryError("The file can't be found where it was saved.", 404, "not_found");
  await revealFile(verified.file);
}

/** Opens the library root folder in Finder/Explorer. */
export async function revealLibraryRoot(): Promise<void> {
  const { library } = await availableLibrary(runtime());
  await fs.mkdir(library.root, { recursive: true });
  await openFolder(library.root);
}

/* Workflow snapshots ------------------------------------------------- */

export async function getAssetWorkflow(id: string): Promise<AssetWorkflowResult | null> {
  if (!isAssetId(id)) return null;
  const library = await readyLibrary();
  const record = await library.find(id);
  if (!record || record.imported) return null;
  const run = await library.runs.get(record.runId);
  if (!run) return null;
  const which = run.final ? "final" : run.start ? "start" : null;
  if (!which) return null;
  return { asset: library.toView(record), run: runMeta(run), which, workflow: run[which]! };
}

/** Returns the hashes the server does not hold. */
export async function mediaHas(hashes: string[]): Promise<string[]> {
  if (!Array.isArray(hashes)) throw new LibraryError("hashes must be a list", 400, "bad_request");
  const library = await readyLibrary();
  return library.runs.missing(hashes.filter(isSha256));
}

/** Stores snapshot media; verifies the body hashes to `sha256`. */
export async function putMedia(
  sha256: string,
  body: ReadableStream<Uint8Array>,
  mime: string,
): Promise<{ sha256: string; bytes: number }> {
  requireSha256(sha256);
  return write((library) => library.runs.putMedia(sha256, body, mime));
}

export async function openMedia(sha256: string): Promise<ServedFile | null> {
  if (!isSha256(sha256)) return null;
  const library = await readyLibrary();
  const media = await library.runs.openMedia(sha256);
  return media ? { ...media, sha256 } : null;
}

export async function putRun(runId: string, request: PutRunRequest): Promise<PutRunResult> {
  return write((library) => library.runs.put(runId, request));
}

export async function upsertWorkflowEntry(
  id: string,
  entry: { name: string | null; projectPath: string | null; forkedFrom?: string },
): Promise<LibraryWorkflowEntry> {
  if (!entry || typeof entry !== "object") throw new LibraryError("Invalid workflow entry", 400, "bad_request");
  return write((library) =>
    library.upsertWorkflow(id, {
      name: typeof entry.name === "string" ? entry.name : null,
      projectPath: typeof entry.projectPath === "string" ? entry.projectPath : null,
      ...(entry.forkedFrom !== undefined ? { forkedFrom: entry.forkedFrom } : {}),
    }),
  );
}

/* Jobs --------------------------------------------------------------- */

export async function startImport(request: ImportProjectsRequest): Promise<LibraryJobStatus> {
  const rt = runtime();
  const dirs = normaliseImportDirs(request?.projectDirs);
  assertWritable(rt);
  const library = await readyLibrary();
  return rt.jobs.start("import", (job) => runImport(job, { library, thumbs: rt.thumbs }, dirs));
}

export async function startCleanup(request: CleanupRequest): Promise<LibraryJobStatus> {
  const rt = runtime();
  const unusedMedia = request?.unusedMedia === true;
  const thumbnails = request?.thumbnails === true;
  if (!unusedMedia && !thumbnails) throw new LibraryError("Choose what to clean up", 400, "bad_request");
  assertWritable(rt);
  const library = await readyLibrary();
  return rt.jobs.start("cleanup", (job) => runCleanup(job, { library, thumbs: rt.thumbs }, { unusedMedia, thumbnails }));
}

export async function startExport(request: ExportAssetsRequest): Promise<LibraryJobStatus> {
  const rt = runtime();
  if (!request || typeof request !== "object") throw new LibraryError("Invalid request", 400, "bad_request");
  const library = await readyLibrary();
  const ids = library.resolveSelection(request.selection);
  if (!ids.length) throw new LibraryError("Nothing is selected", 400, "bad_request");
  const dest = await prepareExportDest(request.dest, library);
  return rt.jobs.start("export", (job) => runExport(job, library, ids, dest));
}

export function getJob(id: string): LibraryJobStatus | null {
  if (typeof id !== "string") return null;
  return runtime().jobs.get(id);
}

export function cancelJob(id: string): boolean {
  if (typeof id !== "string") return false;
  return runtime().jobs.cancel(id);
}

/* Test hooks --------------------------------------------------------- */

/** Waits for every background task (scans, thumbnails, jobs) to settle. */
export async function __drainAssetLibraryForTests(): Promise<void> {
  const rt = globalState.__nodeBananaAssetLibrary;
  if (!rt) return;
  for (let round = 0; round < 5; round++) {
    await rt.jobs.drain();
    while (rt.background.size) await Promise.all([...rt.background]);
    await rt.library?.drain();
    await rt.thumbs?.drain();
    if (!rt.background.size) break;
  }
}

/** Drains and forgets the process-wide library state, so the next call resolves from scratch. */
export async function __resetAssetLibraryForTests(options: { pathContext?: PathContext | null } = {}): Promise<void> {
  await __drainAssetLibraryForTests();
  delete globalState.__nodeBananaAssetLibrary;
  resetPathCachesForTests();
  if (options.pathContext) runtime().ctxOverride = options.pathContext;
}

/** The live index (for tests that inspect it). */
export async function __assetLibraryForTests(): Promise<AssetLibrary> {
  return readyLibrary();
}
