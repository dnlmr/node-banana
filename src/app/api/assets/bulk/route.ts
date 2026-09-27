/**
 * One operation over a selection: tag, untag, favorite, unfavorite, trash,
 * restore or delete for good. POST AssetBulkRequest → AssetBulkResult
 * (per-asset failures are listed in `errors`, not raised).
 */

import { bulkAssets } from "@/lib/assets/server";
import { handle, json, readJson } from "../_lib/http";
import { parseBulkRequest } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(request, "assets.bulk", async () => {
    const bulk = parseBulkRequest(await readJson(request));
    return json(await bulkAssets(bulk));
  });
}
