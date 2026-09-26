/**
 * A grid thumbnail: GET ?w=320|640 → image/webp, rendered on a miss.
 * 204 when there is none to give (a video without a poster, a file sharp
 * cannot read); the grid then draws a placeholder. Thumbnails are addressed
 * by the content hash, so a served one is cached for good; a 204 is not,
 * since a poster may arrive later.
 */

import { getThumbnail } from "@/lib/assets/server";
import { SHA256_PATTERN, THUMB_WIDTHS } from "@/lib/assets/types";
import { IMMUTABLE_CACHE, serveFile } from "../../_lib/files";
import { badRequest, handle, pathParam } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ sha256: string }> }) {
  return handle(request, "assets.thumb", async () => {
    const sha256 = pathParam((await params).sha256, SHA256_PATTERN, "hash");
    const width = Number(new URL(request.url).searchParams.get("w"));
    if (!(THUMB_WIDTHS as readonly number[]).includes(width)) {
      throw badRequest(`w must be one of: ${THUMB_WIDTHS.join(", ")}.`);
    }
    const thumbnail = await getThumbnail(sha256, width as (typeof THUMB_WIDTHS)[number]);
    if (!thumbnail) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    return serveFile(request, thumbnail, { cacheControl: IMMUTABLE_CACHE });
  });
}
