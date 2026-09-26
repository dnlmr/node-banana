/**
 * A background library job (move, import, cleanup, export).
 *
 * GET    → LibraryJobStatus (404 once the server no longer knows it)
 * DELETE → { cancelled }: false when it had already finished
 */

import { cancelJob, getJob } from "@/lib/assets/server";
import { JOB_ID_PATTERN, handle, json, notFound, pathParam } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  return handle(request, "assets.job.get", async () => {
    const jobId = pathParam((await params).jobId, JOB_ID_PATTERN, "job id");
    const job = getJob(jobId);
    if (!job) throw notFound("No such job.");
    return json(job);
  });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return handle(request, "assets.job.cancel", async () => {
    const jobId = pathParam((await params).jobId, JOB_ID_PATTERN, "job id");
    if (!getJob(jobId)) throw notFound("No such job.");
    return json({ cancelled: cancelJob(jobId) });
  });
}
