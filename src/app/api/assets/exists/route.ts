/**
 * Which of these asset ids the library still has, for pruning carousels.
 * POST { ids } (at most 1,000) → { states: Record<id, AssetExistence> },
 * with an entry for every id asked about. Ids that are not asset ids at all
 * (old or hand-edited workflows) read `unknown` without troubling the
 * library, and carousels only prune `gone`.
 */

import { assetExistence } from "@/lib/assets/server";
import { ASSET_ID_PATTERN, type AssetExistence } from "@/lib/assets/types";
import { handle, json, readJson } from "../_lib/http";
import { parseExistsIds } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(request, "assets.exists", async () => {
    const ids = parseExistsIds(await readJson(request));
    const valid = [...new Set(ids.filter((id) => ASSET_ID_PATTERN.test(id)))];
    const known = valid.length > 0 ? await assetExistence(valid) : {};
    const states: Record<string, AssetExistence> = {};
    for (const id of ids) states[id] = known[id] ?? "unknown";
    return json({ states });
  });
}
