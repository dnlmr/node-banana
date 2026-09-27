/**
 * A run's workflow snapshot, written when its first asset is recorded
 * (`start`) and again when it ends (`final`). PUT PutRunRequest (at most
 * 16 MB: media travel separately, by hash) → PutRunResult, listing the
 * media the client still has to upload.
 */

import { putRun } from "@/lib/assets/server";
import { RUN_ID_PATTERN } from "@/lib/assets/types";
import { RUN_BODY_LIMIT, handle, json, pathParam, readJson } from "../../_lib/http";
import { parsePutRunRequest } from "../../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  return handle(request, "assets.run", async () => {
    const runId = pathParam((await params).runId, RUN_ID_PATTERN, "run id");
    const run = parsePutRunRequest(runId, await readJson(request, RUN_BODY_LIMIT));
    return json(await putRun(runId, run));
  });
}
