/**
 * Request guard for the asset library routes (`/api/assets/*`) and for the
 * older routes that read, write, list or reveal files by path
 * (`/api/workflow`, `/api/save-generation`, `/api/load-generation`,
 * `/api/browse-directory` and the like).
 *
 * The library lists, streams, reveals and deletes the user's own files, and
 * the older routes take any absolute path, so they answer only Node Banana's
 * page on this computer: not another website open in the same browser (an
 * `<img>` or a hidden form aimed at localhost) and not another device on the
 * network. The checks are the agent's (`checkSameOrigin`; its header comment
 * explains each one), with the library's own host allowlist,
 * `NB_LIBRARY_ALLOWED_HOSTS`, so opening the library to a LAN name does not
 * also open the agent, and the other way round.
 *
 * Refusals carry a message of the guard's own rather than the agent's
 * wording; the specific reason, reworded to name this guard and its
 * allowlist, goes to the server log. The one exception is a server that
 * cannot vouch for loopback connections at all (plain `next dev` /
 * `next start`), where every request fails and the fix is to start Node
 * Banana the supported way.
 */

import { NextResponse } from "next/server";

import { AGENT_ALLOWED_HOSTS_ENV, AGENT_LOCAL_SECRET_ENV, checkSameOrigin } from "@/lib/agent/server/sameOrigin";
import { logger } from "@/utils/logger";

/** Environment variable that lists extra host names the library may be used from (comma-separated, no ports). */
export const LIBRARY_ALLOWED_HOSTS_ENV = "NB_LIBRARY_ALLOWED_HOSTS";

export const LIBRARY_GUARD_MESSAGE =
  "Node Banana only opens your asset library and files to its own page on this computer. " +
  `To use it from another address, add that host name to ${LIBRARY_ALLOWED_HOSTS_ENV}.`;

export const LIBRARY_UNVOUCHED_MESSAGE =
  "The asset library and file access need Node Banana's own server, which can tell this computer from another: " +
  "start Node Banana with `npm run dev` or `npm start`, not `next dev` or `next start`.";

/** Mirrors sameOrigin.ts: a shorter stamp secret is treated as unset. */
const MIN_LOCAL_SECRET_LENGTH = 32;

export type AssetRequestCheck = { ok: true } | { ok: false; reason: string };

/** The guard's verdict, with a reason fit to show the user. */
export function checkAssetRequest(request: Request): AssetRequestCheck {
  const allowedHosts = libraryAllowedHosts();
  const result = checkSameOrigin(request, { allowedHosts });
  if (result.ok) return result;

  logger.warn("api.error", "Asset library or file request blocked", {
    method: request.method,
    path: pathOf(request),
    reason: libraryReason(result.reason),
  });
  const unvouched = !serverVouches() && !allowedHosts.includes(hostnameOf(request));
  return { ok: false, reason: unvouched ? LIBRARY_UNVOUCHED_MESSAGE : LIBRARY_GUARD_MESSAGE };
}

/** Null when the request may proceed; otherwise the 403 to return. */
export function guardAssetRequest(request: Request): Response | null {
  const check = checkAssetRequest(request);
  if (check.ok) return null;
  return NextResponse.json(
    { error: check.reason, code: "forbidden" },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * `checkSameOrigin` words its reasons for the agent and names the agent's
 * allowlist. An operator who followed that advice would open the agent and
 * leave this guard refusing, so the log gets the reason with this guard's
 * subject and `NB_LIBRARY_ALLOWED_HOSTS` instead.
 */
function libraryReason(reason: string): string {
  return reason
    .split(AGENT_ALLOWED_HOSTS_ENV)
    .join(LIBRARY_ALLOWED_HOSTS_ENV)
    .replace(/\bThe agent\b/g, "The asset library")
    .replace(/\bthe agent\b/g, "the asset library");
}

function libraryAllowedHosts(): string[] {
  const raw = process.env[LIBRARY_ALLOWED_HOSTS_ENV];
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** server.js and electron/server.cjs set the stamp secret; plain `next dev` / `next start` do not. */
function serverVouches(): boolean {
  return (process.env[AGENT_LOCAL_SECRET_ENV]?.length ?? 0) >= MIN_LOCAL_SECRET_LENGTH;
}

/** The request's host name without its port, lower-cased (IPv6 keeps its brackets, as the allowlist is written). */
function hostnameOf(request: Request): string {
  const host = request.headers.get("host")?.trim() || safeUrl(request.url)?.host || "";
  return safeUrl(`http://${host}`)?.hostname.toLowerCase() ?? host.toLowerCase();
}

function pathOf(request: Request): string {
  return safeUrl(request.url)?.pathname ?? "";
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
