/**
 * The asset recorder: the one path by which the browser saves an asset.
 *
 * - `initAssetLibrary()` is called once from the page. It asks the server for
 *   the library status and enables recording only when it is `available`.
 *   Until then (and on hosted/read-only servers, or when the request guard
 *   refuses) `isRecorderEnabled()` is false and callers fall back to today's
 *   project-only save path. If the status request itself fails it is asked
 *   again every 30 s until it gets an answer.
 * - `recordAsset()` mints the asset id, turns data:/blob: media into a Blob
 *   synchronously-at-call (a blob: URL revoked later must not lose the bytes),
 *   queues the upload (concurrency 2, its own queue: never counted in the
 *   store's pendingMediaSaves, so tabs stay usable), and returns at once.
 *   Failures are retried while the library is temporarily unavailable, then
 *   reported once through `onRecorderError`.
 * - `beginRun()` / `endRun()` bracket a run. The start graph is held by
 *   reference and only encoded/uploaded when the run records its first
 *   asset. `endRun(id, graph)` writes the final snapshot if the run recorded
 *   anything; `endRun(id, null)` means the canvas was replaced mid-run and no
 *   final snapshot must be written.
 */

import type {
  AssetRunContext,
  AssetView,
  LibraryStatus,
  RecordAssetInput,
  RecordAssetMeta,
  RecordAssetResult,
  RecordedAssetHandle,
} from "../types";
import {
  AssetApiError,
  beginRecord,
  fetchAsset,
  fetchLibraryStatus,
  putRun,
  uploadAssetBytes,
  uploadMedia,
  upsertWorkflowEntry,
} from "./api";
import { mapWithConcurrency, withRetry } from "./async";
import { createEmitter } from "./emitter";
import { newAssetId } from "./ids";
import { dataUrlMime, dataUrlToBlob, isBlobUrl, isDataUrl, isMediaString } from "./mediaBlob";
import { capturePoster } from "./poster";
import {
  encodeSnapshot,
  prefetchBlobUrls,
  rememberMediaHash,
  type CapturedGraph,
  type PrefetchedMedia,
} from "./snapshot";

const CONCURRENCY = 2;
const STATUS_RETRY_MS = 30_000;
/** The same failure is reported at most once in this window. */
const ERROR_REPEAT_MS = 60_000;

/* Library status ----------------------------------------------------- */

let libraryStatus: LibraryStatus | null = null;
let statusRequest: Promise<LibraryStatus | null> | null = null;
let statusRetry: ReturnType<typeof setTimeout> | null = null;

const recordedListeners = createEmitter<RecordAssetResult>();
const errorListeners = createEmitter<string>();
const statusListeners = createEmitter<LibraryStatus>();

async function loadStatus(): Promise<LibraryStatus | null> {
  try {
    const status = await fetchLibraryStatus();
    applyLibraryStatus(status);
    return status;
  } catch (error) {
    console.warn("The asset library is not reachable yet:", error instanceof Error ? error.message : error);
    if (!statusRetry) {
      statusRetry = setTimeout(() => {
        statusRetry = null;
        statusRequest = loadStatus();
      }, STATUS_RETRY_MS);
    }
    return null;
  }
}

/** Idempotent: every call before the answer shares the one request. */
export function initAssetLibrary(): Promise<LibraryStatus | null> {
  statusRequest ??= loadStatus();
  return statusRequest;
}

/** Asks the server again, e.g. after Settings moved or switched the library. */
export function refreshAssetLibrary(): Promise<LibraryStatus | null> {
  if (statusRetry) clearTimeout(statusRetry);
  statusRetry = null;
  statusRequest = loadStatus();
  return statusRequest;
}

/** Takes a status the caller already has (a PUT /library answer) without asking again. */
export function applyLibraryStatus(status: LibraryStatus): void {
  libraryStatus = status;
  statusListeners.emit(status);
}

export function isRecorderEnabled(): boolean {
  return libraryStatus?.available === true;
}

/** The last status the recorder saw (null before init). */
export function getRecorderLibraryStatus(): LibraryStatus | null {
  return libraryStatus;
}

/** Known to be unavailable (as opposed to not asked yet). */
function knownUnavailable(): boolean {
  return libraryStatus !== null && !libraryStatus.available;
}

/* Errors -------------------------------------------------------------- */

const lastReported = new Map<string, number>();

function reportError(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  const message = `Couldn't save an asset to the library: ${reason}`;
  console.error(message);
  const now = Date.now();
  for (const [text, at] of lastReported) if (now - at >= ERROR_REPEAT_MS) lastReported.delete(text);
  if (lastReported.has(message)) return;
  lastReported.set(message, now);
  errorListeners.emit(message);
}

/* Media --------------------------------------------------------------- */

type TakenMedia =
  | { kind: "bytes"; blob: Promise<Blob>; mime?: string; key?: string }
  | { kind: "url"; url: string; mime?: string };

/** Reads the bytes now: a data: URL is decoded, a blob: or same-origin URL is fetched (which binds it). */
function takeMedia(input: RecordAssetInput): TakenMedia {
  const { media } = input;
  if (typeof media !== "string") return { kind: "bytes", blob: Promise.resolve(media), mime: input.mime || media.type || undefined };
  if (isDataUrl(media)) {
    const mime = input.mime || dataUrlMime(media) || undefined;
    return { kind: "bytes", blob: Promise.resolve(dataUrlToBlob(media, mime)), mime, key: media };
  }
  if (/^https?:\/\//i.test(media)) return { kind: "url", url: media, mime: input.mime };
  if (isBlobUrl(media) || media.startsWith("/")) {
    const blob = fetch(media).then((response) => {
      if (!response.ok) throw new Error(`the media could not be read (${response.status})`);
      return response.blob();
    });
    // Handled when the job runs; until then the rejection is expected, not unhandled.
    blob.catch(() => {});
    return { kind: "bytes", blob, mime: input.mime, key: isBlobUrl(media) ? media : undefined };
  }
  throw new Error("that kind of media can't be saved");
}

/** Keeps request bodies small: parameters never need inline media (the server drops it anyway). */
function scrubParameters(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return isMediaString(value) ? undefined : value;
  if (value === null || typeof value !== "object") return typeof value === "function" ? undefined : value;
  if (depth > 8) return undefined;
  if (Array.isArray(value)) return value.map((item) => scrubParameters(item, depth + 1)).filter((item) => item !== undefined);
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const scrubbed = scrubParameters(child, depth + 1);
    if (scrubbed !== undefined) result[key] = scrubbed;
  }
  return result;
}

function buildMeta(assetId: string, input: RecordAssetInput, run: AssetRunContext, mime: string | undefined): RecordAssetMeta {
  const meta: RecordAssetMeta = {
    id: assetId,
    kind: input.kind,
    origin: input.origin,
    createdAt: Date.now(),
    producer: input.producer,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    projectDir: run.projectDir,
    runId: run.runId,
  };
  if (mime) meta.mime = mime;
  if (input.prompt) meta.prompt = input.prompt;
  if (input.model) meta.model = input.model;
  if (input.parameters) meta.parameters = scrubParameters(input.parameters) as Record<string, unknown>;
  if (input.aspectRatio) meta.aspectRatio = input.aspectRatio;
  if (input.resolution) meta.resolution = input.resolution;
  if (input.cost) meta.cost = input.cost;
  if (input.width) meta.width = input.width;
  if (input.height) meta.height = input.height;
  if (input.durationSec) meta.durationSec = input.durationSec;
  return meta;
}

function resultFromView(asset: AssetView): RecordAssetResult {
  return { asset, filename: asset.filename, legacyId: asset.filename.replace(/\.[^.]+$/, ""), reusedFile: false };
}

async function upload(meta: RecordAssetMeta, media: TakenMedia): Promise<RecordAssetResult> {
  const blob = media.kind === "bytes" ? await media.blob : null;
  if (blob && !meta.mime && blob.type) meta.mime = blob.type;
  return withRetry(async (attempt) => {
    try {
      const begun = await beginRecord({
        meta,
        source: media.kind === "url" ? { type: "url", url: media.url } : { type: "upload" },
      });
      if ("result" in begun) return begun.result;
      if (!blob) throw new Error("the library asked for bytes it was meant to download");
      return await uploadAssetBytes(begun.ticket.uploadId, blob);
    } catch (error) {
      // An earlier attempt may have landed with only its answer lost.
      if (attempt > 1 && error instanceof AssetApiError && error.status === 409) {
        const asset = await fetchAsset(meta.id).catch(() => null);
        if (asset) return resultFromView(asset);
      }
      throw error;
    }
  });
}

/* Queue --------------------------------------------------------------- */

const queue: (() => Promise<void>)[] = [];
let active = 0;

function pump(): void {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    active += 1;
    void job().finally(() => {
      active -= 1;
      pump();
    });
  }
}

/* Runs ---------------------------------------------------------------- */

interface RunState {
  run: AssetRunContext;
  start: CapturedGraph;
  startMedia: PrefetchedMedia;
  /** Recordings of this run queued or uploading. */
  pending: number;
  recorded: number;
  /** The workflow upsert and start snapshot; never rejects. */
  startWrite: Promise<void> | null;
  ended: { graph: CapturedGraph | null; media: PrefetchedMedia | null } | null;
}

const runs = new Map<string, RunState>();
let snapshotWrites = 0;

/** Counts a background write for pendingRecordings; failures are logged, never thrown. */
function track(label: string, task: () => Promise<void>): Promise<void> {
  snapshotWrites += 1;
  return task()
    .catch((error) => {
      console.warn(`Couldn't store the ${label}:`, error instanceof Error ? error.message : error);
    })
    .finally(() => {
      snapshotWrites -= 1;
    });
}

async function writeSnapshot(run: AssetRunContext, phase: "start" | "final", graph: CapturedGraph, media: PrefetchedMedia | null) {
  const encoded = await withRetry(() => encodeSnapshot(graph, media ? { prefetched: media } : {}));
  const { missingMedia } = await withRetry(() =>
    putRun(run.runId, {
      meta: {
        id: run.runId,
        workflowId: run.workflowId,
        workflowName: run.workflowName,
        projectPath: run.projectDir,
        startedAt: run.startedAt,
      },
      phase,
      workflow: encoded.workflow,
      mediaHashes: encoded.mediaHashes,
    }),
  );
  // The encoder uploaded what media/has reported missing; this covers media
  // that went missing in between (a cleanup job, a moved library).
  if (!missingMedia.length || !encoded.readMedia) return;
  await mapWithConcurrency(missingMedia, 2, async (sha256) => {
    const blob = await encoded.readMedia!(sha256);
    if (blob) await withRetry(() => uploadMedia(sha256, blob)).catch((error) => console.warn("Snapshot media upload failed:", error));
  });
}

function startRunSnapshot(state: RunState): void {
  const { run } = state;
  state.startWrite = track("workflow snapshot", async () => {
    try {
      await withRetry(() => upsertWorkflowEntry(run.workflowId, { name: run.workflowName, projectPath: run.projectDir }));
    } catch (error) {
      console.warn("Couldn't classify the workflow in the library:", error instanceof Error ? error.message : error);
    }
    await writeSnapshot(run, "start", state.start, state.startMedia);
  });
}

function finishRun(state: RunState): void {
  runs.delete(state.run.runId);
  const graph = state.ended?.graph;
  if (!graph || state.recorded === 0) return;
  const media = state.ended?.media ?? null;
  void track("final workflow snapshot", async () => {
    await state.startWrite;
    await writeSnapshot(state.run, "final", graph, media);
  });
}

function settle(state: RunState | undefined, result: RecordAssetResult | null): void {
  if (!state) return;
  state.pending -= 1;
  if (result) {
    state.recorded += 1;
    if (state.recorded === 1) startRunSnapshot(state);
  }
  if (state.ended && state.pending === 0) finishRun(state);
}

export function beginRun(run: AssetRunContext, graph: CapturedGraph): void {
  if (knownUnavailable() || runs.has(run.runId)) return;
  runs.set(run.runId, {
    run,
    start: graph,
    // Bound now: a node that re-runs revokes its old blob: URL.
    startMedia: prefetchBlobUrls(graph),
    pending: 0,
    recorded: 0,
    startWrite: null,
    ended: null,
  });
}

export function endRun(runId: string, graph: CapturedGraph | null): void {
  const state = runs.get(runId);
  if (!state || state.ended) return;
  const mayWrite = graph !== null && (state.recorded > 0 || state.pending > 0);
  state.ended = { graph, media: mayWrite ? prefetchBlobUrls(graph) : null };
  // Recordings still uploading decide whether the run recorded anything.
  if (state.pending === 0) finishRun(state);
}

/* Recording ----------------------------------------------------------- */

export function recordAsset(input: RecordAssetInput, run: AssetRunContext): RecordedAssetHandle {
  const assetId = newAssetId();
  if (knownUnavailable()) return { assetId, done: Promise.resolve(null) };

  let media: TakenMedia;
  try {
    media = takeMedia(input);
  } catch (error) {
    reportError(error);
    return { assetId, done: Promise.resolve(null) };
  }

  const meta = buildMeta(assetId, input, run, media.mime);
  const state = runs.get(run.runId);
  if (state) state.pending += 1;

  const done = new Promise<RecordAssetResult | null>((resolve) => {
    queue.push(async () => {
      let result: RecordAssetResult | null = null;
      try {
        result = await upload(meta, media);
      } catch (error) {
        reportError(error);
      }
      if (result) {
        if (media.kind === "bytes" && media.key) {
          rememberMediaHash(media.key, result.asset.sha256, result.asset.mime, result.asset.bytes);
        }
        recordedListeners.emit(result);
        if (result.asset.kind === "video" && !result.asset.hasPoster) void capturePoster(result.asset.id, result.asset.mime);
      }
      settle(state, result);
      resolve(result);
    });
    pump();
  });
  return { assetId, done };
}

/** Recordings queued or uploading, plus snapshot writes (for beforeunload). */
export function pendingRecordings(): number {
  return queue.length + active + snapshotWrites;
}

export function onAssetRecorded(listener: (result: RecordAssetResult) => void): () => void {
  return recordedListeners.on(listener);
}

export function onRecorderError(listener: (message: string) => void): () => void {
  return errorListeners.on(listener);
}

export function onLibraryStatus(listener: (status: LibraryStatus) => void): () => void {
  return statusListeners.on(listener);
}
