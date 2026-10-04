/**
 * An asset's bytes, streamed with Range support so video can seek.
 * `?download=1` saves it under its filename. The URL stays the same while
 * the record changes, so the browser revalidates by ETag (the content hash).
 */

import { openAssetFile } from "@/lib/assets/server";
import { ASSET_ID_PATTERN } from "@/lib/assets/types";
import { REVALIDATE_CACHE, serveFile } from "../../_lib/files";
import { handle, notFound, pathParam } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, "assets.file", async () => {
    const id = pathParam((await params).id, ASSET_ID_PATTERN, "asset id");
    const file = await openAssetFile(id);
    if (!file) throw notFound("No such asset in the library.");
    const download = new URL(request.url).searchParams.get("download") === "1";
    return serveFile(request, file, {
      cacheControl: REVALIDATE_CACHE,
      disposition: download ? "attachment" : "inline",
    });
  });
}
