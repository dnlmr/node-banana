/**
 * Copy the selection's files into a folder the user picked (a background job).
 * POST ExportAssetsRequest → 202 { job }; follow it at /api/assets/jobs/[id].
 */

import { startExport } from "@/lib/assets/server";
import { handle, json, readJson } from "../_lib/http";
import { parseExportRequest } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(request, "assets.export", async () => {
    const job = await startExport(parseExportRequest(await readJson(request)));
    return json({ job }, 202);
  });
}
