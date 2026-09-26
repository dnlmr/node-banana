/**
 * Server-side downloads of provider URLs (large videos and 3D models come
 * back as URLs that expire). The URL comes from the browser, so it is
 * treated as untrusted: https only, no credentials, every redirect hop
 * re-checked, and every address the host resolves to must be public — no
 * loopback, private, link-local, CGNAT or multicast targets.
 *
 * The body is streamed straight into the destination's `.partial` file with
 * a running cap and an idle timeout, never buffered whole.
 */

import { lookup as dnsLookup } from "dns/promises";
import { isIP } from "net";
import { LibraryError } from "./errors";
import { streamToPartial, type StreamedFile } from "./fsutil";

export const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

export type LookupAll = (hostname: string) => Promise<{ address: string; family: number }[]>;
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const defaultLookup: LookupAll = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/* ------------------------------------------------------------------ */
/* Address checks                                                      */
/* ------------------------------------------------------------------ */

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** CIDR blocks that are not the public internet. */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata lives here)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

const BLOCKED_V4_RANGES = BLOCKED_V4.map(([base, bits]) => {
  const start = ipv4ToInt(base)!;
  const size = 2 ** (32 - bits);
  return { start, end: start + size - 1 };
});

function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true;
  return BLOCKED_V4_RANGES.some((range) => value >= range.start && value <= range.end);
}

/** Expands an IPv6 address to eight 16-bit groups (null when malformed). */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const lastColon = text.lastIndexOf(":");
  if (lastColon < 0) return null;
  let tail: number[] = [];
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    const v4 = ipv4ToInt(last);
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    text = text.slice(0, lastColon + 1);
    if (!text.endsWith("::")) text = text.slice(0, -1);
  }
  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  const needed = 8 - tail.length;
  const gap = text.indexOf("::");
  if (gap !== text.lastIndexOf("::")) return null;
  if (gap < 0) {
    const groups = parseGroups(text);
    return groups && groups.length === needed ? [...groups, ...tail] : null;
  }
  const head = parseGroups(text.slice(0, gap));
  const rest = parseGroups(text.slice(gap + 2));
  if (!head || !rest) return null;
  const fill = needed - head.length - rest.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...rest, ...tail];
}

function isBlockedIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const [a, b] = groups;
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) carry an IPv4 target.
  const embedded = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
  if (groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    return isBlockedIpv4(embedded);
  }
  if (a === 0x64 && b === 0xff9b) return isBlockedIpv4(embedded);
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((a & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  if (a === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return true; // discard-only
  if (a === 0x2002) {
    // 6to4 embeds an IPv4 address in the next two groups.
    return isBlockedIpv4(`${b >> 8}.${b & 0xff}.${groups[2] >> 8}.${groups[2] & 0xff}`);
  }
  return false;
}

/** True for any address a server-side download must not reach. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

/**
 * Checks a URL before each request: https, no credentials, a real host,
 * and every resolved address public. Throws LibraryError("blocked_url").
 */
export async function assertPublicHttpsUrl(raw: string, lookup: LookupAll = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LibraryError("Invalid URL", 400, "blocked_url");
  }
  if (url.protocol !== "https:") throw new LibraryError("Only https URLs can be saved", 400, "blocked_url");
  if (url.username || url.password) throw new LibraryError("URLs with credentials are not allowed", 400, "blocked_url");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new LibraryError("That address is not allowed", 400, "blocked_url");
  }
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new LibraryError("That address is not allowed", 400, "blocked_url");
    return url;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new LibraryError(`Could not resolve ${hostname}`, 502, "download_failed");
  }
  if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new LibraryError("That address is not allowed", 400, "blocked_url");
  }
  return url;
}

/* ------------------------------------------------------------------ */
/* Download                                                            */
/* ------------------------------------------------------------------ */

export interface DownloadResult {
  file: StreamedFile;
  contentType: string | null;
  /** The URL after redirects (its extension is a type hint). */
  finalUrl: string;
}

export interface DownloadOptions {
  maxBytes?: number;
  idleTimeoutMs?: number;
  fetch?: FetchLike;
  lookup?: LookupAll;
}

/**
 * Downloads an https URL into `<dir>/<uuid>.partial`, following at most five
 * redirects by hand so each hop is validated before it is requested.
 */
export async function downloadToPartial(rawUrl: string, dir: string, options: DownloadOptions = {}): Promise<DownloadResult> {
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const lookup = options.lookup ?? defaultLookup;
  const maxBytes = options.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const idleTimeoutMs = options.idleTimeoutMs ?? DOWNLOAD_IDLE_TIMEOUT_MS;

  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicHttpsUrl(current, lookup);
    const controller = new AbortController();
    const headersTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), { redirect: "manual", signal: controller.signal });
    } catch (error) {
      throw new LibraryError(
        controller.signal.aborted ? "The download timed out" : `The download failed: ${error instanceof Error ? error.message : String(error)}`,
        502,
        controller.signal.aborted ? "timeout" : "download_failed",
      );
    } finally {
      clearTimeout(headersTimer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) throw new LibraryError("The download redirected nowhere", 502, "download_failed");
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new LibraryError(`The download failed (HTTP ${response.status})`, 502, "download_failed");
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new LibraryError("The file is too large to save", 413, "too_large");
    }
    const file = await streamToPartial(response.body, dir, {
      maxBytes,
      idleTimeoutMs,
      onAbort: () => controller.abort(),
    });
    return { file, contentType: response.headers.get("content-type"), finalUrl: url.toString() };
  }
  throw new LibraryError("The download redirected too many times", 502, "download_failed");
}
