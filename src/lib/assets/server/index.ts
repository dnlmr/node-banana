/**
 * Server-side asset library: the facade the /api/assets routes call.
 *
 * CONTRACT STUB — every export below is implemented by the server-core
 * work (internal modules live next to this file: paths, fsutil, validate,
 * media, library, ingest, thumbs, jobs, desktop). Routes import only from
 * here and must not reach into the internal modules.
 *
 * All functions throw `LibraryError` for expected failures; routes map
 * `status` to the HTTP status and `message` to `{ error }`.
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

export class LibraryError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly code: string = "bad_request",
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

function notImplemented(name: string): never {
  throw new LibraryError(`${name} is not implemented yet`, 501, "not_implemented");
}

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

/* Location and status ------------------------------------------------ */

/** Resolves (and on first use, creates and persists) the library root. Never throws for an unwritable root: returns `available: false` with a reason. */
export async function getLibraryStatus(): Promise<LibraryStatus> {
  return notImplemented("getLibraryStatus");
}

/** `switch` changes the root now; `move` starts a background move job and switches when it verifies. */
export async function setLibraryRoot(_request: SetLibraryRootRequest): Promise<LibraryStatus> {
  return notImplemented("setLibraryRoot");
}

/* Browsing ----------------------------------------------------------- */

export async function listAssets(_request: AssetPageRequest): Promise<AssetPage> {
  return notImplemented("listAssets");
}

export async function getFacets(): Promise<AssetFacets> {
  return notImplemented("getFacets");
}

export async function getAsset(_id: string): Promise<AssetView | null> {
  return notImplemented("getAsset");
}

export async function assetExistence(_ids: string[]): Promise<Record<string, AssetExistence>> {
  return notImplemented("assetExistence");
}

/* Mutations ---------------------------------------------------------- */

export async function patchAsset(_id: string, _patch: AssetPatch): Promise<AssetView | null> {
  return notImplemented("patchAsset");
}

export async function bulkAssets(_request: AssetBulkRequest): Promise<AssetBulkResult> {
  return notImplemented("bulkAssets");
}

/* Recording ---------------------------------------------------------- */

/** `upload` source → a ticket for PUT /uploads/[id]; `url` source → downloads and records now. */
export async function beginRecord(
  _request: RecordAssetRequest,
): Promise<{ ticket: UploadTicket } | { result: RecordAssetResult }> {
  return notImplemented("beginRecord");
}

/** Streams the upload body to disk while hashing, then finalises the record. */
export async function completeUpload(
  _uploadId: string,
  _body: ReadableStream<Uint8Array>,
  _contentType: string | null,
): Promise<RecordAssetResult> {
  return notImplemented("completeUpload");
}

/* Files -------------------------------------------------------------- */

export async function openAssetFile(_id: string): Promise<ServedFile | null> {
  return notImplemented("openAssetFile");
}

/** Stores a browser-made poster (video/3D) and derives its thumbnails. */
export async function putPoster(_id: string, _bytes: Uint8Array, _mime: string): Promise<void> {
  return notImplemented("putPoster");
}

/** Returns a cached webp thumbnail, rendering it on a miss (bounded concurrency). Null → the client draws a placeholder. */
export async function getThumbnail(_sha256: string, _width: 320 | 640): Promise<ServedFile | null> {
  return notImplemented("getThumbnail");
}

export async function revealAsset(_id: string): Promise<void> {
  return notImplemented("revealAsset");
}

/* Workflow snapshots ------------------------------------------------- */

export async function getAssetWorkflow(_id: string): Promise<AssetWorkflowResult | null> {
  return notImplemented("getAssetWorkflow");
}

/** Returns the hashes the server does not hold. */
export async function mediaHas(_hashes: string[]): Promise<string[]> {
  return notImplemented("mediaHas");
}

/** Stores snapshot media; verifies the body hashes to `sha256`. */
export async function putMedia(
  _sha256: string,
  _body: ReadableStream<Uint8Array>,
  _mime: string,
): Promise<{ sha256: string; bytes: number }> {
  return notImplemented("putMedia");
}

export async function openMedia(_sha256: string): Promise<ServedFile | null> {
  return notImplemented("openMedia");
}

export async function putRun(_runId: string, _request: PutRunRequest): Promise<PutRunResult> {
  return notImplemented("putRun");
}

export async function upsertWorkflowEntry(
  _id: string,
  _entry: { name: string | null; projectPath: string | null; forkedFrom?: string },
): Promise<LibraryWorkflowEntry> {
  return notImplemented("upsertWorkflowEntry");
}

/* Jobs --------------------------------------------------------------- */

export async function startImport(_request: ImportProjectsRequest): Promise<LibraryJobStatus> {
  return notImplemented("startImport");
}

export async function startCleanup(): Promise<LibraryJobStatus> {
  return notImplemented("startCleanup");
}

export async function startExport(_request: ExportAssetsRequest): Promise<LibraryJobStatus> {
  return notImplemented("startExport");
}

export function getJob(_id: string): LibraryJobStatus | null {
  return notImplemented("getJob");
}

export function cancelJob(_id: string): boolean {
  return notImplemented("cancelJob");
}
