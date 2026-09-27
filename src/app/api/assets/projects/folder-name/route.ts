/**
 * The folder a new project of that name is saved in: the name made safe
 * for the filesystem, numbered past a folder that already has it.
 * GET ?name= → ProjectFolderName
 */

import { getProjectFolderName } from "@/lib/assets/server";
import { handle, json } from "../../_lib/http";
import { parseProjectName } from "../../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(request, "assets.projects.folderName", async () => {
    const name = parseProjectName(new URL(request.url).searchParams.get("name"));
    return json(await getProjectFolderName(name));
  });
}
