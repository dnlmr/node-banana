/**
 * The asset recorder: the one path by which the browser saves an asset.
 *
 * CONTRACT STUB — implemented by the client-core work.
 *
 * - `initAssetLibrary()` is called once from the page. It asks the server for
 *   the library status and enables recording only when it is `available`.
 *   Until then (and on hosted/read-only servers, or when the request guard
 *   refuses) `isRecorderEnabled()` is false and callers fall back to today's
 *   project-only save path.
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
  LibraryStatus,
  RecordAssetInput,
  RecordAssetResult,
  RecordedAssetHandle,
} from "../types";
import type { CapturedGraph } from "./snapshot";

export async function initAssetLibrary(): Promise<LibraryStatus | null> {
  throw new Error("initAssetLibrary is not implemented yet");
}

export function isRecorderEnabled(): boolean {
  return false;
}

/** The last status the recorder saw (null before init). */
export function getRecorderLibraryStatus(): LibraryStatus | null {
  return null;
}

export function recordAsset(_input: RecordAssetInput, _run: AssetRunContext): RecordedAssetHandle {
  throw new Error("recordAsset is not implemented yet");
}

export function beginRun(_run: AssetRunContext, _graph: CapturedGraph): void {
  throw new Error("beginRun is not implemented yet");
}

export function endRun(_runId: string, _graph: CapturedGraph | null): void {
  throw new Error("endRun is not implemented yet");
}

/** Recordings queued or uploading (for beforeunload). */
export function pendingRecordings(): number {
  return 0;
}

export function onAssetRecorded(_listener: (result: RecordAssetResult) => void): () => void {
  return () => {};
}

export function onRecorderError(_listener: (message: string) => void): () => void {
  return () => {};
}

export function onLibraryStatus(_listener: (status: LibraryStatus) => void): () => void {
  return () => {};
}
