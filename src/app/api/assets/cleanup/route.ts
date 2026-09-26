/**
 * Delete snapshot media and posters nothing references, and/or empty the
 * thumbnail cache (a background job).
 * POST CleanupRequest → 202 { job }; follow it at /api/assets/jobs/[id].
 */

import { startCleanup } from "@/lib/assets/server";
import { handle, json, readJson } from "../_lib/http";
import { parseCleanupRequest } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(request, "assets.cleanup", async () => {
    const job = await startCleanup(parseCleanupRequest(await readJson(request)));
    return json({ job }, 202);
  });
}
