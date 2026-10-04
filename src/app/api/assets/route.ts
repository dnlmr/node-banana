/**
 * The asset library: list a page of assets, or start recording one.
 *
 * GET  ?<encodeAssetPageRequest(...)>  → AssetPage
 * POST RecordAssetRequest              → { ticket } for an upload (the bytes
 *      follow in PUT /api/assets/uploads/[uploadId]), or { result } once a
 *      `url` source is downloaded and recorded. While the library is moving,
 *      503 with Retry-After: the recorder waits and sends it again.
 */

import { decodeAssetPageRequest } from "@/lib/assets/query";
import { beginRecord, listAssets } from "@/lib/assets/server";
import { handle, json, readJson } from "./_lib/http";
import { parseRecordRequest } from "./_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // a `url` source is downloaded before POST answers

export async function GET(request: Request) {
  return handle(request, "assets.list", async () => {
    const page = decodeAssetPageRequest(new URL(request.url).searchParams);
    return json(await listAssets(page));
  });
}

export async function POST(request: Request) {
  return handle(request, "assets.record", async () => {
    const record = parseRecordRequest(await readJson(request));
    return json(await beginRecord(record));
  });
}
