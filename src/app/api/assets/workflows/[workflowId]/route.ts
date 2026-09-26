/**
 * Classify a workflow: its current name and project folder, in one write.
 * PUT { name, projectPath, forkedFrom? } → LibraryWorkflowEntry. The id is
 * URL-encoded by the client (workflow ids may hold `:` and `.`).
 */

import { upsertWorkflowEntry } from "@/lib/assets/server";
import { WORKFLOW_ID_PATTERN } from "@/lib/assets/types";
import { handle, json, pathParam, readJson } from "../../_lib/http";
import { parseWorkflowEntry } from "../../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  return handle(request, "assets.workflowEntry", async () => {
    const workflowId = pathParam((await params).workflowId, WORKFLOW_ID_PATTERN, "workflow id");
    const entry = parseWorkflowEntry(await readJson(request));
    return json(await upsertWorkflowEntry(workflowId, entry));
  });
}
