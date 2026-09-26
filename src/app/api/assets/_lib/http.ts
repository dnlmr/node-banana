/**
 * Plumbing shared by the `/api/assets/*` handlers: the guard-then-try
 * wrapper, JSON bodies with a size limit, path-parameter checks and the
 * mapping from thrown errors to responses.
 *
 * `_lib` is a private folder (the underscore keeps it out of the App
 * Router), so these exports never become routes.
 */

import { NextResponse } from "next/server";

import { formatByteLimit, readJsonBody } from "@/app/api/agent/shared";
import type { LibraryError } from "@/lib/assets/server";
import { guardAssetRequest } from "@/lib/assets/server/guard";
import { logger } from "@/utils/logger";

/** The largest JSON body most routes read. */
export const JSON_BODY_LIMIT = 1024 * 1024;
/** PUT /runs/[runId] carries a media-free workflow snapshot. */
export const RUN_BODY_LIMIT = 16 * 1024 * 1024;
/** Uploads and snapshot media: refused early when the declared length is over this (the library enforces it as bytes arrive). */
export const UPLOAD_BYTE_LIMIT = 2 * 1024 * 1024 * 1024;

/** PUT /media/[sha256] carries the media type here, since the body is raw bytes. */
export const MEDIA_MIME_HEADER = "x-nb-mime";

/** How long a paused library (a move in progress) asks the recorder to wait. */
export const PAUSED_RETRY_AFTER_SECONDS = 5;

/** Upload tickets are minted by the library; they never reach a path unchecked, but the route still refuses anything odd. */
export const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const DEFAULT_CODES: Record<number, string> = {
  400: "bad_request",
  404: "not_found",
  413: "too_large",
  415: "unsupported_media_type",
};

/** An expected failure raised by the route itself (bad input, not found). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = DEFAULT_CODES[status] ?? "error",
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message: string) => new HttpError(404, message);

/** JSON answer. Library answers change underneath the page, so nothing may cache them. */
export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export const ok = () => json({ ok: true });

/**
 * Guard the request, then run the handler, turning anything it throws into
 * a response. `route` names the handler in the server log.
 */
export async function handle(request: Request, route: string, run: () => Promise<Response>): Promise<Response> {
  const refused = guardAssetRequest(request);
  if (refused) return refused;
  try {
    return await run();
  } catch (error) {
    return errorResponse(error, route);
  }
}

/**
 * `HttpError` and `LibraryError` carry their status and `{ error, code }`;
 * a paused library answers 503 with `Retry-After` so the recorder waits and
 * tries again. Anything else is unexpected: logged, and answered 500.
 */
export function errorResponse(error: unknown, route: string): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  if (isLibraryError(error)) {
    if (error.code === "paused") {
      return json({ error: error.message, code: error.code }, 503, {
        "Retry-After": String(PAUSED_RETRY_AFTER_SECONDS),
      });
    }
    const status = error.status >= 400 && error.status <= 599 ? error.status : 500;
    if (status >= 500) {
      logger.warn("api.error", `Asset library failed: ${route}`, { route, status, code: error.code, error: error.message });
    }
    return json({ error: error.message, code: error.code }, status);
  }
  logger.error("api.error", `Asset route failed: ${route}`, { route }, error instanceof Error ? error : undefined);
  const message = error instanceof Error && error.message ? error.message : "The asset library could not answer.";
  return json({ error: message, code: "internal" }, 500);
}

/**
 * By shape rather than `instanceof`: the facade's class can be loaded twice
 * (dev-server reloads, test mocks), and a LibraryError from either copy
 * must still map to its own status.
 */
export function isLibraryError(error: unknown): error is LibraryError {
  if (!(error instanceof Error) || error.name !== "LibraryError") return false;
  const candidate = error as Partial<LibraryError>;
  return typeof candidate.status === "number" && typeof candidate.code === "string";
}

/** Reads a JSON body of at most `maxBytes` (refused before buffering when the declared length is over). */
export async function readJson(request: Request, maxBytes: number = JSON_BODY_LIMIT): Promise<unknown> {
  const read = await readJsonBody(request, maxBytes);
  if (read.ok) return read.value;
  if (read.problem === "too_large") {
    throw new HttpError(413, `The request body is over the ${formatLimit(maxBytes)} limit.`);
  }
  throw badRequest("The request body is not JSON.");
}

/**
 * A path parameter, decoded once and checked against its pattern. Next hands
 * params over decoded or not depending on the route shape; none of the
 * patterns admit `%`, so decoding an already decoded value changes nothing.
 */
export function pathParam(raw: string | undefined, pattern: RegExp, label: string): string {
  let value: string;
  try {
    value = decodeURIComponent(raw ?? "");
  } catch {
    throw badRequest(`Invalid ${label}.`);
  }
  if (!pattern.test(value)) throw badRequest(`Invalid ${label}.`);
  return value;
}

/** Refuses a raw-body upload whose declared length is already over the limit. */
export function checkDeclaredLength(request: Request, maxBytes: number): void {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, `The upload is over the ${formatLimit(maxBytes)} limit.`);
  }
}

/** The request body as a stream for the library to consume, never buffered here. */
export function bodyStream(request: Request): ReadableStream<Uint8Array> {
  if (!request.body) throw badRequest("The request has no body.");
  return request.body;
}

/** A small raw body (a poster), read whole but never past `maxBytes`. */
export async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  checkDeclaredLength(request, maxBytes);
  const reader = bodyStream(request).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      throw badRequest("The upload was interrupted.");
    }
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      void reader.cancel().catch(() => undefined);
      throw new HttpError(413, `The upload is over the ${formatLimit(maxBytes)} limit.`);
    }
    chunks.push(chunk.value);
  }
  if (size === 0) throw badRequest("The request has no body.");
  // A Buffer is a Uint8Array; sharp wants Buffers, so no copy into a plain array.
  return Buffer.concat(chunks);
}

/** "2 GB", "16 MB", "5 MB": a limit as a refusal names it. */
export function formatLimit(bytes: number): string {
  const gb = 1024 * 1024 * 1024;
  if (bytes >= gb) return `${Math.round((bytes / gb) * 10) / 10} GB`;
  return formatByteLimit(bytes);
}

/** The media type without parameters, lower-cased; null when absent or malformed. */
export function mediaType(value: string | null): string | null {
  if (!value) return null;
  const type = value.split(";")[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) ? type : null;
}
