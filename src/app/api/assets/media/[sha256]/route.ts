/**
 * Content-addressed media referenced by stored workflow snapshots.
 *
 * PUT raw bytes, type in `x-nb-mime` (default application/octet-stream)
 *     → { sha256, bytes }. The library streams the body to disk and refuses
 *     it unless it hashes to the URL's sha256.
 * GET → the bytes (Range supported), cached for good: the hash is the name.
 */

import { openMedia, putMedia } from "@/lib/assets/server";
import { SHA256_PATTERN } from "@/lib/assets/types";
import { IMMUTABLE_CACHE, serveFile } from "../../_lib/files";
import {
  MEDIA_MIME_HEADER,
  UPLOAD_BYTE_LIMIT,
  badRequest,
  bodyStream,
  checkDeclaredLength,
  handle,
  json,
  mediaType,
  notFound,
  pathParam,
} from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // snapshot media can be a large video

interface RouteContext {
  params: Promise<{ sha256: string }>;
}

export async function PUT(request: Request, { params }: RouteContext) {
  return handle(request, "assets.media.put", async () => {
    const sha256 = pathParam((await params).sha256, SHA256_PATTERN, "hash");
    const header = request.headers.get(MEDIA_MIME_HEADER);
    const mime = header === null ? "application/octet-stream" : mediaType(header);
    if (!mime) throw badRequest(`${MEDIA_MIME_HEADER} is not a media type.`);
    checkDeclaredLength(request, UPLOAD_BYTE_LIMIT);
    return json(await putMedia(sha256, bodyStream(request), mime));
  });
}

export async function GET(request: Request, { params }: RouteContext) {
  return handle(request, "assets.media.get", async () => {
    const sha256 = pathParam((await params).sha256, SHA256_PATTERN, "hash");
    const file = await openMedia(sha256);
    if (!file) throw notFound("The library does not hold this media.");
    return serveFile(request, file, { cacheControl: IMMUTABLE_CACHE });
  });
}
