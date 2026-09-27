/**
 * The projects the app knows about — the Node Banana folder's own, the
 * registry's and the workflow rows' — newest first, with the summary of the
 * ones that live in other folders. GET → ProjectsOverview
 */

import { listProjects } from "@/lib/assets/server";
import { handle, json } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The Node Banana folder is walked on every listing (bounded to a few seconds).
export const maxDuration = 60;

export async function GET(request: Request) {
  return handle(request, "assets.projects", async () => json(await listProjects()));
}
