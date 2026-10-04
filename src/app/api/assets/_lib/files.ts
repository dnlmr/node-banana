/**
 * Streaming a library file to the browser: single byte ranges (video
 * seeking), ETag revalidation from the content hash, and download names.
 *
 * The file is opened once and measured from the open handle, so the length
 * and range describe the bytes actually sent even if the record's size is
 * stale. The read stream is destroyed when the browser goes away (a seek
 * cancels the previous range), so no descriptor outlives its request.
 */

import { createReadStream } from "fs";
import { open, type FileHandle } from "fs/promises";
import { Readable } from "stream";

import type { ServedFile } from "@/lib/assets/server";
import { HttpError } from "./http";

/** Content-addressed responses (thumbnails, snapshot media) never change under their URL. */
export const IMMUTABLE_CACHE = "private, max-age=31536000, immutable";
/** An asset's file keeps its URL across edits of the record, so the browser revalidates by ETag. */
export const REVALIDATE_CACHE = "private, no-cache";

/**
 * A file opened directly (a new tab in web mode) renders as an inert
 * document: no scripts, no requests elsewhere. `<img>` and `<video>` loads
 * ignore it.
 */
const FILE_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";

export type ByteRange =
  | { type: "full" }
  /** Inclusive byte offsets. */
  | { type: "partial"; start: number; end: number }
  | { type: "unsatisfiable" };

/**
 * Reads a `Range` header against a file of `size` bytes (RFC 9110 §14).
 * One range is served: `bytes=a-b`, `bytes=a-` and the suffix `bytes=-n`.
 * Anything else a server may ignore (other units, several ranges, an
 * invalid spec) answers with the whole file. A range that starts past the
 * end, or a zero-length suffix, cannot be satisfied.
 */
export function parseRange(header: string | null, size: number): ByteRange {
  if (!header) return { type: "full" };
  const match = /^\s*bytes\s*=\s*(.*)$/i.exec(header);
  if (!match) return { type: "full" };
  const specs = match[1]
    .split(",")
    .map((spec) => spec.trim())
    .filter(Boolean);
  if (specs.length !== 1) return { type: "full" };

  const parts = /^(\d*)\s*-\s*(\d*)$/.exec(specs[0]);
  if (!parts) return { type: "full" };
  const [, first, last] = parts;

  if (first === "") {
    if (last === "") return { type: "full" };
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return { type: "unsatisfiable" };
    return { type: "partial", start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(first);
  const end = last === "" ? Infinity : Number(last);
  if (end < start) return { type: "full" };
  if (start >= size) return { type: "unsatisfiable" };
  return { type: "partial", start, end: Math.min(end, size - 1) };
}

/** A strong ETag from the content hash; null when the value could not sit in one. */
export function etagFor(sha256: string): string | null {
  return /^[\x21\x23-\x7e]+$/.test(sha256) ? `"${sha256}"` : null;
}

/** `If-None-Match` (weak comparison, `*` matches anything). */
export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag);
}

/** `If-Range`: honour the range only when the browser's copy is exactly this one (strong comparison; dates never match). */
export function ifRangeAllows(header: string | null, etag: string | null): boolean {
  if (header === null) return true;
  return etag !== null && header.trim() === etag;
}

/**
 * `Content-Disposition` with a plain ASCII `filename` for old clients and the
 * exact UTF-8 name in `filename*` (RFC 6266 / 5987).
 */
export function contentDisposition(filename: string, type: "attachment" | "inline" = "attachment"): string {
  const name = filename.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim() || "download";
  const fallback =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\x20-\x7e]|["%;]/g, "_")
      .trim() || "download";
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export interface ServeFileOptions {
  cacheControl: string;
  /** `attachment` saves the file (`?download=1`); `inline` names it for "Save as…"; omitted sends no disposition. */
  disposition?: "attachment" | "inline";
}

/** Streams `file`, honouring `Range`, `If-Range`, `If-None-Match` and HEAD. */
export async function serveFile(request: Request, file: ServedFile, options: ServeFileOptions): Promise<Response> {
  const etag = etagFor(file.sha256);
  const headers = new Headers({
    "Cache-Control": options.cacheControl,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": FILE_CSP,
  });
  if (etag) headers.set("ETag", etag);

  if (etag && matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }

  const handle = await openFile(file.path);
  let streaming = false;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw missingFile();
    const size = stat.size;

    let range = parseRange(request.headers.get("range"), size);
    if (range.type !== "full" && !ifRangeAllows(request.headers.get("if-range"), etag)) range = { type: "full" };
    if (range.type === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }

    headers.set("Content-Type", file.mime || "application/octet-stream");
    if (options.disposition) headers.set("Content-Disposition", contentDisposition(file.filename, options.disposition));

    const start = range.type === "partial" ? range.start : 0;
    const end = range.type === "partial" ? range.end : size - 1;
    const status = range.type === "partial" ? 206 : 200;
    if (range.type === "partial") headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(size === 0 ? 0 : end - start + 1));

    if (request.method === "HEAD" || size === 0 || request.signal.aborted) {
      return new Response(null, { status, headers });
    }

    const stream = createReadStream(file.path, { fd: handle, start, end, autoClose: true });
    streaming = true;
    const abort = () => stream.destroy();
    request.signal.addEventListener("abort", abort, { once: true });
    stream.once("close", () => request.signal.removeEventListener("abort", abort));
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, { status, headers });
  } finally {
    if (!streaming) await handle.close().catch(() => undefined);
  }
}

async function openFile(filePath: string): Promise<FileHandle> {
  try {
    return await open(filePath, "r");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") throw missingFile();
    throw error;
  }
}

function missingFile(): HttpError {
  return new HttpError(404, "The file is not on disk any more.", "missing");
}
