/**
 * Which snapshot media the library lacks, so the client uploads only those.
 * POST { hashes } (at most 5,000 sha256) → { missing }
 */

import { mediaHas } from "@/lib/assets/server";
import { handle, json, readJson } from "../../_lib/http";
import { parseMediaHashes } from "../../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(request, "assets.mediaHas", async () => {
    const hashes = [...new Set(parseMediaHashes(await readJson(request)))];
    const missing = hashes.length > 0 ? await mediaHas(hashes) : [];
    return json({ missing });
  });
}
