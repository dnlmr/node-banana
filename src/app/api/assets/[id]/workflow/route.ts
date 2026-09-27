/**
 * The workflow as it was when the asset was made, for "Open workflow".
 * GET → AssetWorkflowResult; 404 when the asset has no stored run (an
 * imported asset) or the run's snapshot is gone.
 */

import { getAssetWorkflow } from "@/lib/assets/server";
import { ASSET_ID_PATTERN } from "@/lib/assets/types";
import { handle, json, notFound, pathParam } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, "assets.workflow", async () => {
    const id = pathParam((await params).id, ASSET_ID_PATTERN, "asset id");
    const result = await getAssetWorkflow(id);
    if (!result) throw notFound("No stored workflow for this asset.");
    return json(result);
  });
}
