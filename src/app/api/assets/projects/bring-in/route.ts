/**
 * Bring projects in from a folder the user picked: use that folder as the
 * Node Banana folder, move the projects into it, or leave them where they
 * are. POST BringInProjectsRequest → BringInProjectsResult (202 when a move
 * started; follow it at /api/assets/jobs/[id]).
 */

import { bringInProjects } from "@/lib/assets/server";
import { handle, json, readJson } from "../../_lib/http";
import { parseBringInProjects } from "../../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(request, "assets.projects.bringIn", async () => {
    const result = await bringInProjects(parseBringInProjects(await readJson(request)));
    return json(result, result.job ? 202 : 200);
  });
}
