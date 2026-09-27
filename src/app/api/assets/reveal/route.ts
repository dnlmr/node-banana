/**
 * Show an asset's file, or the library folder, in Finder/Explorer.
 * POST { id } | { target: "root" } → { ok: true }
 */

import { revealAsset, revealLibraryRoot } from "@/lib/assets/server";
import { handle, ok, readJson } from "../_lib/http";
import { parseRevealRequest } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(request, "assets.reveal", async () => {
    const reveal = parseRevealRequest(await readJson(request));
    if ("id" in reveal) await revealAsset(reveal.id);
    else await revealLibraryRoot();
    return ok();
  });
}
