/**
 * "Keep where they are": the offer to move projects that live in other
 * folders into the Node Banana folder is not made again.
 * POST ProjectsOfferRequest → { ok }
 */

import { setProjectsOffer } from "@/lib/assets/server";
import { handle, ok, readJson } from "../../_lib/http";
import { parseProjectsOffer } from "../../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(request, "assets.projects.offer", async () => {
    await setProjectsOffer(parseProjectsOffer(await readJson(request)));
    return ok();
  });
}
