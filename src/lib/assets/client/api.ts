/**
 * Typed client for the /api/assets routes.
 *
 * Every function rejects with `AssetApiError` on a non-2xx response
 * (message = the route's `{ error }`), except where noted. A request that
 * never reached the server rejects with `AssetApiError` status 0, so callers
 * can tell "try again" from "refused"; an aborted request rejects with the
 * AbortError itself.
 */

import { encodeAssetPageRequest } from "../query";
import {
  ASSET_ROUTES,
  type AssetBulkRequest,
  type AssetBulkResult,
  type AssetExistence,
  type AssetFacets,
  type AssetPage,
  type AssetPageRequest,
  type AssetPatch,
  type AssetView,
  type AssetWorkflowResult,
  type BringInProjectsRequest,
  type BringInProjectsResult,
  type CleanupRequest,
  type ExportAssetsRequest,
  type FoundProject,
  type ImportProjectsRequest,
  type KnownProject,
  type LibraryJobStatus,
  type LibraryStatus,
  type LibraryWorkflowEntry,
  type ProjectFolderName,
  type ProjectsElsewhere,
  type ProjectsOverview,
  type PutRunRequest,
  type PutRunResult,
  type RecordAssetRequest,
  type RecordAssetResult,
  type ReportProjectsRequest,
  type ReportProjectsResult,
  type RevealRequest,
  type ScanProjectsResult,
  type SetLibraryRootRequest,
  type UploadTicket,
  type WorkflowEntryUpdate,
} from "../types";

export class AssetApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the request never got an answer. */
    public readonly status: number,
    /** From a `Retry-After` header (503 while the library is moving). */
    public readonly retryAfterMs?: number,
    /** The route's `code`, e.g. "unavailable" when the library root is gone, "paused" during a move. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AssetApiError";
  }
}

/** Ids per POST /exists, so a long carousel does not make one huge request. */
const EXISTENCE_BATCH = 500;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Seconds or an HTTP date, per RFC 9110; capped so a bad header cannot park a job for hours. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const seconds = /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - now;
  if (!Number.isFinite(seconds)) return undefined;
  return Math.min(Math.max(0, seconds), 10 * 60 * 1000);
}

/** The route's `{ error, code }`, else the start of the body, else the status line. */
async function toApiError(response: Response): Promise<AssetApiError> {
  let detail = "";
  let code: string | undefined;
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text) as { error?: unknown; message?: unknown; code?: unknown };
      const value = json.error ?? json.message;
      detail = typeof value === "string" ? value : "";
      if (typeof json.code === "string" && json.code) code = json.code;
    } catch {
      detail = text.trim().slice(0, 200);
    }
  } catch {
    // Body unreadable: the status line is all we have.
  }
  const retryAfter = parseRetryAfter(response.headers?.get?.("Retry-After") ?? null);
  return new AssetApiError(
    detail || `${response.status} ${response.statusText ?? ""}`.trim(),
    response.status,
    retryAfter,
    code,
  );
}

async function send(url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (isAbort(error) || init.signal?.aborted) throw error;
    throw new AssetApiError("Couldn't reach the asset library.", 0);
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

/** Like `send`, but a 404 is an answer (null) rather than an error. */
async function sendOrNull(url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await send(url, init);
  } catch (error) {
    if (error instanceof AssetApiError && error.status === 404) return null;
    throw error;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new AssetApiError("The asset library sent an unreadable answer.", response.status);
  }
}

function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return send(url, { cache: "no-store", signal }).then((response) => readJson<T>(response));
}

function sendJson<T>(url: string, method: "POST" | "PUT" | "PATCH", body: unknown): Promise<T> {
  return send(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => readJson<T>(response));
}

function sendBytes(url: string, blob: Blob, headers: Record<string, string> = {}): Promise<Response> {
  return send(url, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/octet-stream", ...headers },
    body: blob,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Routes answer with the object itself; tolerate `{ [key]: object }` too, so
 * a wrapped answer does not read as an empty record. `probe` is a field the
 * bare object always has.
 */
function unwrap<T>(body: unknown, key: string, probe: string): T {
  if (isRecord(body) && !(probe in body) && isRecord(body[key])) return body[key] as T;
  return body as T;
}

/* Library ------------------------------------------------------------ */

export async function fetchLibraryStatus(): Promise<LibraryStatus> {
  return unwrap<LibraryStatus>(await getJson(ASSET_ROUTES.library), "status", "available");
}

export async function setLibraryRoot(request: SetLibraryRootRequest): Promise<LibraryStatus> {
  return unwrap<LibraryStatus>(await sendJson(ASSET_ROUTES.library, "PUT", request), "status", "available");
}

/* Browsing ----------------------------------------------------------- */

export async function fetchAssetPage(request: AssetPageRequest, signal?: AbortSignal): Promise<AssetPage> {
  const query = encodeAssetPageRequest(request).toString();
  const page = await getJson<Partial<AssetPage>>(query ? `${ASSET_ROUTES.list}?${query}` : ASSET_ROUTES.list, signal);
  return {
    assets: Array.isArray(page.assets) ? page.assets : [],
    nextCursor: page.nextCursor ?? null,
    headCursor: page.headCursor ?? null,
    total: typeof page.total === "number" ? page.total : 0,
    totalBytes: typeof page.totalBytes === "number" ? page.totalBytes : 0,
  };
}

export async function fetchFacets(signal?: AbortSignal): Promise<AssetFacets> {
  return unwrap<AssetFacets>(await getJson(ASSET_ROUTES.facets, signal), "facets", "total");
}

export async function fetchAsset(id: string): Promise<AssetView | null> {
  const response = await sendOrNull(ASSET_ROUTES.asset(id), { cache: "no-store" });
  return response ? unwrap<AssetView>(await readJson(response), "asset", "id") : null;
}

/** Never rejects: on failure every id is `unknown`. */
export async function fetchAssetExistence(ids: string[]): Promise<Record<string, AssetExistence>> {
  const unique = [...new Set(ids)];
  const states: Record<string, AssetExistence> = Object.fromEntries(unique.map((id) => [id, "unknown"]));
  for (let start = 0; start < unique.length; start += EXISTENCE_BATCH) {
    const batch = unique.slice(start, start + EXISTENCE_BATCH);
    try {
      const body = await sendJson<{ states?: Record<string, unknown> }>(ASSET_ROUTES.exists, "POST", { ids: batch });
      for (const id of batch) {
        const state = body.states?.[id];
        if (state === "present" || state === "gone" || state === "unknown") states[id] = state;
      }
    } catch {
      // Unknown is the safe answer: carousels prune only `gone`.
    }
  }
  return states;
}

/* Mutations ---------------------------------------------------------- */

export async function patchAsset(id: string, patch: AssetPatch): Promise<AssetView> {
  return unwrap<AssetView>(await sendJson(ASSET_ROUTES.asset(id), "PATCH", patch), "asset", "id");
}

export async function bulkAssets(request: AssetBulkRequest): Promise<AssetBulkResult> {
  const result = await sendJson<Partial<AssetBulkResult>>(ASSET_ROUTES.bulk, "POST", request);
  return {
    affected: typeof result.affected === "number" ? result.affected : 0,
    ids: Array.isArray(result.ids) ? result.ids : [],
    errors: Array.isArray(result.errors) ? result.errors : [],
  };
}

async function reveal(request: RevealRequest): Promise<void> {
  await send(ASSET_ROUTES.reveal, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export async function revealAsset(id: string): Promise<void> {
  await reveal({ id });
}

export async function revealLibraryRoot(): Promise<void> {
  await reveal({ target: "root" });
}

/* Files and workflows ------------------------------------------------ */

export async function fetchAssetWorkflow(id: string): Promise<AssetWorkflowResult | null> {
  const response = await sendOrNull(ASSET_ROUTES.workflow(id), { cache: "no-store" });
  return response ? readJson<AssetWorkflowResult>(response) : null;
}

/** Fetches an asset's bytes as a Blob (same-origin /file route). */
export async function fetchAssetBlob(id: string, signal?: AbortSignal): Promise<Blob> {
  return (await send(assetFileUrl(id), { signal })).blob();
}

/* Recording ---------------------------------------------------------- */

export async function beginRecord(
  request: RecordAssetRequest,
): Promise<{ ticket: UploadTicket } | { result: RecordAssetResult }> {
  const body = await sendJson<Record<string, unknown>>(ASSET_ROUTES.record, "POST", request);
  if (isRecord(body.ticket) && typeof body.ticket.uploadId === "string") return { ticket: body.ticket as unknown as UploadTicket };
  if (isRecord(body.result)) return { result: body.result as unknown as RecordAssetResult };
  if (isRecord(body.asset)) return { result: body as unknown as RecordAssetResult };
  throw new AssetApiError("The asset library sent an unreadable answer.", 200);
}

/** PUT the bytes for a ticket from `beginRecord`; the raw body is streamed to disk. */
export async function uploadAssetBytes(uploadId: string, blob: Blob): Promise<RecordAssetResult> {
  const body = await readJson<unknown>(await sendBytes(ASSET_ROUTES.upload(uploadId), blob));
  return unwrap<RecordAssetResult>(body, "result", "asset");
}

export async function uploadPoster(id: string, blob: Blob): Promise<void> {
  await sendBytes(ASSET_ROUTES.poster(id), blob);
}

/** Of `hashes`, the ones the server does not hold. */
export async function mediaHas(hashes: string[]): Promise<string[]> {
  if (!hashes.length) return [];
  const body = await sendJson<{ missing?: unknown }>(ASSET_ROUTES.mediaHas, "POST", { hashes });
  return Array.isArray(body.missing) ? body.missing.filter((hash): hash is string => typeof hash === "string") : [];
}

export async function uploadMedia(sha256: string, blob: Blob): Promise<void> {
  await sendBytes(ASSET_ROUTES.media(sha256), blob, { "x-nb-mime": blob.type || "application/octet-stream" });
}

export async function fetchMediaBlob(sha256: string): Promise<Blob> {
  return (await send(ASSET_ROUTES.media(sha256))).blob();
}

export async function putRun(runId: string, request: PutRunRequest): Promise<PutRunResult> {
  const body = await sendJson<Partial<PutRunResult>>(ASSET_ROUTES.run(runId), "PUT", request);
  return { missingMedia: Array.isArray(body.missingMedia) ? body.missingMedia : [] };
}

export async function upsertWorkflowEntry(
  workflowId: string,
  entry: WorkflowEntryUpdate,
): Promise<LibraryWorkflowEntry> {
  const body = await sendJson<unknown>(ASSET_ROUTES.workflowEntry(workflowId), "PUT", entry);
  return unwrap<LibraryWorkflowEntry>(body, "entry", "id");
}

/* Jobs --------------------------------------------------------------- */

async function startJob(url: string, request: unknown): Promise<LibraryJobStatus> {
  return unwrap<LibraryJobStatus>(await sendJson(url, "POST", request), "job", "state");
}

export async function startImport(request: ImportProjectsRequest): Promise<LibraryJobStatus> {
  return startJob(ASSET_ROUTES.importProjects, request);
}

/** The Node Banana projects under `root`, nested ones included; malformed rows are dropped. */
export async function scanProjects(root: string): Promise<ScanProjectsResult> {
  const body = await sendJson<Partial<ScanProjectsResult>>(ASSET_ROUTES.scanProjects, "POST", { root });
  const projects = Array.isArray(body.projects)
    ? body.projects.filter(
        (project): project is FoundProject =>
          isRecord(project) && typeof project.dir === "string" && typeof project.name === "string",
      )
    : [];
  return {
    root: typeof body.root === "string" ? body.root : root,
    projects: projects.map((project) => ({
      dir: project.dir,
      name: project.name,
      mediaCount: typeof project.mediaCount === "number" ? project.mediaCount : 0,
      ...(typeof project.bytes === "number" ? { bytes: project.bytes } : {}),
    })),
    truncated: body.truncated === true,
    unreadable: typeof body.unreadable === "number" ? body.unreadable : 0,
    ...(typeof body.recommendUse === "boolean" ? { recommendUse: body.recommendUse } : {}),
  };
}

export async function startCleanup(request: CleanupRequest): Promise<LibraryJobStatus> {
  return startJob(ASSET_ROUTES.cleanup, request);
}

export async function startExport(request: ExportAssetsRequest): Promise<LibraryJobStatus> {
  return startJob(ASSET_ROUTES.exportAssets, request);
}

export async function fetchJob(jobId: string): Promise<LibraryJobStatus | null> {
  const response = await sendOrNull(ASSET_ROUTES.job(jobId), { cache: "no-store" });
  return response ? unwrap<LibraryJobStatus>(await readJson(response), "job", "state") : null;
}

export async function cancelJob(jobId: string): Promise<void> {
  await send(ASSET_ROUTES.job(jobId), { method: "DELETE" });
}

/* Projects ----------------------------------------------------------- */

function knownProject(value: unknown): KnownProject | null {
  if (!isRecord(value) || typeof value.dir !== "string" || typeof value.name !== "string") return null;
  const relativePath = typeof value.relativePath === "string" ? value.relativePath : null;
  return {
    dir: value.dir,
    name: value.name,
    relativePath,
    inRoot: value.inRoot === true || (value.inRoot === undefined && relativePath !== null),
    lastModified: typeof value.lastModified === "number" ? value.lastModified : 0,
    mediaCount: typeof value.mediaCount === "number" ? value.mediaCount : 0,
  };
}

function projectsElsewhere(value: unknown): ProjectsElsewhere | null {
  if (!isRecord(value) || typeof value.count !== "number" || value.count <= 0) return null;
  const groups = Array.isArray(value.groups)
    ? value.groups.filter(
        (group): group is { label: string; count: number } =>
          isRecord(group) && typeof group.label === "string" && typeof group.count === "number",
      )
    : [];
  return {
    count: value.count,
    dirs: Array.isArray(value.dirs) ? value.dirs.filter((dir): dir is string => typeof dir === "string") : [],
    bytes: typeof value.bytes === "number" ? value.bytes : 0,
    groups: groups.map(({ label, count }) => ({ label, count })),
  };
}

/** Every project the app knows about, newest first; malformed rows are dropped. */
export async function fetchProjects(signal?: AbortSignal): Promise<ProjectsOverview> {
  const body = await getJson<Partial<Record<keyof ProjectsOverview, unknown>>>(ASSET_ROUTES.projects, signal);
  return {
    root: typeof body.root === "string" ? body.root : "",
    projects: Array.isArray(body.projects)
      ? body.projects.map(knownProject).filter((project): project is KnownProject => project !== null)
      : [],
    elsewhere: projectsElsewhere(body.elsewhere),
    offerDismissed: body.offerDismissed === true,
  };
}

/** Tells the server what this page's localStorage remembers (once per page load). */
export async function reportProjects(request: ReportProjectsRequest): Promise<ReportProjectsResult> {
  const body = await sendJson<Partial<ReportProjectsResult>>(ASSET_ROUTES.reportProjects, "POST", request);
  return { adopted: body.adopted === true, root: typeof body.root === "string" ? body.root : null };
}

/** Use the folder, move the projects in, or list them where they are; `job` is the move to follow. */
export async function bringInProjects(request: BringInProjectsRequest): Promise<BringInProjectsResult> {
  const body = await sendJson<Partial<BringInProjectsResult>>(ASSET_ROUTES.bringInProjects, "POST", request);
  return {
    root: typeof body.root === "string" ? body.root : null,
    job: isRecord(body.job) && typeof body.job.id === "string" ? (body.job as unknown as LibraryJobStatus) : null,
  };
}

/** "Keep where they are": the offer to move projects in is not made again. */
export async function dismissProjectsOffer(): Promise<void> {
  await sendJson(ASSET_ROUTES.projectsOffer, "POST", { dismissed: true });
}

/** The folder a new project called `name` would be saved in. */
export async function fetchProjectFolderName(name: string, signal?: AbortSignal): Promise<ProjectFolderName> {
  const body = await getJson<Partial<ProjectFolderName>>(ASSET_ROUTES.projectFolderName(name), signal);
  if (typeof body.folder !== "string" || typeof body.path !== "string") {
    throw new AssetApiError("The asset library sent an unreadable answer.", 200);
  }
  return { folder: body.folder, path: body.path, taken: body.taken === true };
}

/** URL helpers (no request). */
export function assetFileUrl(id: string, download = false): string {
  return `${ASSET_ROUTES.file(id)}${download ? "?download=1" : ""}`;
}
export function assetThumbUrl(sha256: string, width: 320 | 640): string {
  return ASSET_ROUTES.thumb(sha256, width);
}
