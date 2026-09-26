/**
 * Typed client for the /api/assets routes.
 *
 * CONTRACT STUB — implemented by the client-core work. Every function
 * rejects with `AssetApiError` on a non-2xx response (message = the route's
 * `{ error }`), except where noted.
 */

import type {
  AssetBulkRequest,
  AssetBulkResult,
  AssetExistence,
  AssetFacets,
  AssetPage,
  AssetPageRequest,
  AssetPatch,
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

export class AssetApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AssetApiError";
  }
}

function notImplemented(name: string): never {
  throw new AssetApiError(`${name} is not implemented yet`, 501);
}

export async function fetchLibraryStatus(): Promise<LibraryStatus> {
  return notImplemented("fetchLibraryStatus");
}
export async function setLibraryRoot(_request: SetLibraryRootRequest): Promise<LibraryStatus> {
  return notImplemented("setLibraryRoot");
}
export async function fetchAssetPage(_request: AssetPageRequest, _signal?: AbortSignal): Promise<AssetPage> {
  return notImplemented("fetchAssetPage");
}
export async function fetchFacets(_signal?: AbortSignal): Promise<AssetFacets> {
  return notImplemented("fetchFacets");
}
export async function fetchAsset(_id: string): Promise<AssetView | null> {
  return notImplemented("fetchAsset");
}
export async function patchAsset(_id: string, _patch: AssetPatch): Promise<AssetView> {
  return notImplemented("patchAsset");
}
export async function bulkAssets(_request: AssetBulkRequest): Promise<AssetBulkResult> {
  return notImplemented("bulkAssets");
}
/** Never rejects: on failure every id is `unknown`. */
export async function fetchAssetExistence(_ids: string[]): Promise<Record<string, AssetExistence>> {
  return notImplemented("fetchAssetExistence");
}
export async function revealAsset(_id: string): Promise<void> {
  return notImplemented("revealAsset");
}
export async function revealLibraryRoot(): Promise<void> {
  return notImplemented("revealLibraryRoot");
}
export async function fetchAssetWorkflow(_id: string): Promise<AssetWorkflowResult | null> {
  return notImplemented("fetchAssetWorkflow");
}
/** Fetches an asset's bytes as a Blob (same-origin /file route). */
export async function fetchAssetBlob(_id: string, _signal?: AbortSignal): Promise<Blob> {
  return notImplemented("fetchAssetBlob");
}
export async function beginRecord(
  _request: RecordAssetRequest,
): Promise<{ ticket: UploadTicket } | { result: RecordAssetResult }> {
  return notImplemented("beginRecord");
}
export async function uploadAssetBytes(_uploadId: string, _blob: Blob): Promise<RecordAssetResult> {
  return notImplemented("uploadAssetBytes");
}
export async function uploadPoster(_id: string, _blob: Blob): Promise<void> {
  return notImplemented("uploadPoster");
}
export async function mediaHas(_hashes: string[]): Promise<string[]> {
  return notImplemented("mediaHas");
}
export async function uploadMedia(_sha256: string, _blob: Blob): Promise<void> {
  return notImplemented("uploadMedia");
}
export async function fetchMediaBlob(_sha256: string): Promise<Blob> {
  return notImplemented("fetchMediaBlob");
}
export async function putRun(_runId: string, _request: PutRunRequest): Promise<PutRunResult> {
  return notImplemented("putRun");
}
export async function upsertWorkflowEntry(
  _workflowId: string,
  _entry: { name: string | null; projectPath: string | null; forkedFrom?: string },
): Promise<LibraryWorkflowEntry> {
  return notImplemented("upsertWorkflowEntry");
}
export async function startImport(_request: ImportProjectsRequest): Promise<LibraryJobStatus> {
  return notImplemented("startImport");
}
export async function startCleanup(_request: CleanupRequest): Promise<LibraryJobStatus> {
  return notImplemented("startCleanup");
}
export async function startExport(_request: ExportAssetsRequest): Promise<LibraryJobStatus> {
  return notImplemented("startExport");
}
export async function fetchJob(_jobId: string): Promise<LibraryJobStatus | null> {
  return notImplemented("fetchJob");
}
export async function cancelJob(_jobId: string): Promise<void> {
  return notImplemented("cancelJob");
}

/** URL helpers (no request). */
export function assetFileUrl(id: string, download = false): string {
  return `/api/assets/${id}/file${download ? "?download=1" : ""}`;
}
export function assetThumbUrl(sha256: string, width: 320 | 640): string {
  return `/api/assets/thumb/${sha256}?w=${width}`;
}
