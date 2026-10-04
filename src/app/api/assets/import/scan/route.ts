/**
 * Find the Node Banana projects under a folder the user picked, nested ones
 * included, for the import to offer. Reads folders only.
 * POST ScanProjectsRequest → ScanProjectsResult.
 */

import { scanProjects } from "@/lib/assets/server";
import { handle, json, readJson, SCAN_BODY_LIMIT } from "../../_lib/http";
import { parseScanProjectsRequest } from "../../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The search stops itself after 15 seconds.
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(request, "assets.import.scan", async () =>
    json(await scanProjects(parseScanProjectsRequest(await readJson(request, SCAN_BODY_LIMIT)))),
  );
}
