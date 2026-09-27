/**
 * The bytes of an asset POST /api/assets issued a ticket for. PUT the raw
 * body → RecordAssetResult. The body is handed to the library as a stream,
 * which hashes it into a partial file as it arrives (never buffered here).
 */

import { completeUpload } from "@/lib/assets/server";
import {
  UPLOAD_BYTE_LIMIT,
  UPLOAD_ID_PATTERN,
  bodyStream,
  checkDeclaredLength,
  handle,
  json,
  pathParam,
} from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // a large video over a slow local connection

export async function PUT(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  return handle(request, "assets.upload", async () => {
    const uploadId = pathParam((await params).uploadId, UPLOAD_ID_PATTERN, "upload id");
    checkDeclaredLength(request, UPLOAD_BYTE_LIMIT);
    const result = await completeUpload(uploadId, bodyStream(request), request.headers.get("content-type"));
    return json(result);
  });
}
