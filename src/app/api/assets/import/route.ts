/**
 * Index the generations of existing project folders (a background job).
 * POST ImportProjectsRequest → 202 { job }; follow it at /api/assets/jobs/[id].
 */

import { startImport } from "@/lib/assets/server";
import { handle, json, readJson } from "../_lib/http";
import { parseImportRequest } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(request, "assets.import", async () => {
    const job = await startImport(parseImportRequest(await readJson(request)));
    return json({ job }, 202);
  });
}
