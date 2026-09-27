/**
 * What this page load's localStorage remembers: its project folders and the
 * old default workflows folder, sent once per load. The server lists them
 * in the registry and, once, may make the workflows folder the Node Banana
 * folder. POST ReportProjectsRequest → ReportProjectsResult
 */

import { reportProjects } from "@/lib/assets/server";
import { handle, json, readJson } from "../../_lib/http";
import { parseReportProjects } from "../../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(request, "assets.projects.report", async () =>
    json(await reportProjects(parseReportProjects(await readJson(request)))),
  );
}
