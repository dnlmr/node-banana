/**
 * Where the library lives and whether it works.
 *
 * GET → LibraryStatus. Always 200: when the request guard refuses, or the
 *     status cannot be read, the answer is `available: false` with the
 *     reason, so the page (which calls this on load) can explain instead of
 *     failing, and a `reasonCode` ("guard" for the guard) so it knows
 *     whether asking again can help. A refused caller learns nothing about
 *     the machine's folders.
 * PUT SetLibraryRootRequest → LibraryStatus: `switch` uses the folder now,
 *     `move` starts a move job and switches when it verifies.
 */

import { getLibraryStatus, setLibraryRoot } from "@/lib/assets/server";
import { checkAssetRequest } from "@/lib/assets/server/guard";
import type { LibraryStatus } from "@/lib/assets/types";
import { logger } from "@/utils/logger";
import { handle, isLibraryError, json, readJson } from "../_lib/http";
import { parseSetLibraryRoot } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable(reason: string, reasonCode: NonNullable<LibraryStatus["reasonCode"]>): LibraryStatus {
  return {
    available: false,
    reason,
    reasonCode,
    root: null,
    source: "default",
    defaultRoot: "",
    cacheDir: "",
    platform: process.platform,
    synced: null,
    counts: { assets: 0, trashed: 0, bytes: 0 },
    empty: false,
    job: null,
  };
}

export async function GET(request: Request) {
  const check = checkAssetRequest(request);
  // Refused by the guard: no answer from this page will change while it is open.
  if (!check.ok) return json(unavailable(check.reason, "guard"));
  try {
    return json(await getLibraryStatus());
  } catch (error) {
    if (!isLibraryError(error)) {
      logger.error("api.error", "Asset library status failed", {}, error instanceof Error ? error : undefined);
    }
    const reason = error instanceof Error && error.message ? error.message : "The asset library could not start.";
    return json(unavailable(reason, "unavailable"));
  }
}

export async function PUT(request: Request) {
  return handle(request, "assets.library.set", async () => {
    const change = parseSetLibraryRoot(await readJson(request));
    return json(await setLibraryRoot(change));
  });
}
