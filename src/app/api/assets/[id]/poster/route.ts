/**
 * A browser-made poster for a video or 3D asset (the server cannot decode
 * video frames). PUT the image bytes as image/webp, image/jpeg or
 * image/png, at most 5 MB → { ok: true }. The library stores it and derives
 * the grid thumbnails from it.
 */

import { putPoster } from "@/lib/assets/server";
import { ASSET_ID_PATTERN } from "@/lib/assets/types";
import { HttpError, badRequest, handle, mediaType, ok, pathParam, readBytes } from "../../_lib/http";
import { POSTER_TYPES, sniffPosterType } from "../../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POSTER_BYTE_LIMIT = 5 * 1024 * 1024;

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, "assets.poster", async () => {
    const id = pathParam((await params).id, ASSET_ID_PATTERN, "asset id");
    const declared = mediaType(request.headers.get("content-type"));
    if (!declared || !(POSTER_TYPES as readonly string[]).includes(declared)) {
      throw new HttpError(415, "A poster must be a WebP, JPEG or PNG image.");
    }
    const bytes = await readBytes(request, POSTER_BYTE_LIMIT);
    const mime = sniffPosterType(bytes);
    if (!mime) throw badRequest("The poster is not a WebP, JPEG or PNG image.");
    await putPoster(id, bytes, mime);
    return ok();
  });
}
