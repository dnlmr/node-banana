/**
 * Counts for the Assets filter rail. GET → AssetFacets
 */

import { getFacets } from "@/lib/assets/server";
import { handle, json } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(request, "assets.facets", async () => json(await getFacets()));
}
