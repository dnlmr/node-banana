/**
 * data: URLs (RFC 2397, read as the Fetch spec does):
 *
 *   data:[<mime>][;<key>=<value>]*[;base64],<payload>
 *
 * The media type may be missing (`data:;base64,…` is what a provider with no
 * content type produces), parameters such as `;charset=utf-8` may sit before
 * the base64 flag, and the payload is everything after the FIRST comma. A
 * base64 payload is base64-decoded; any other payload is percent-decoded.
 *
 * The header is never decoded as part of the payload. Decoding the whole
 * string as base64 — what a regex that failed to match used to fall back to —
 * reads "data", the media type and "base64" as base64 characters and shifts
 * every byte after them, so the file on disk is noise no decoder can open.
 *
 * Works in the browser and in Node (Buffer when there is one, atob otherwise).
 */

export interface DataUrlHeader {
  /** The declared media type, lowercased and without parameters; "" when the URL declares none. */
  mime: string;
  /** `;key=value` parameters, keys lowercased (e.g. `{ charset: "utf-8" }`). */
  params: Record<string, string>;
  /** The URL carries the `;base64` flag. */
  base64: boolean;
  /** Where the payload starts: just past the first comma. */
  payloadStart: number;
}

export interface DataUrl {
  /** The declared media type, lowercased and without parameters; "" when the URL declares none. */
  mime: string;
  /** `;key=value` parameters, keys lowercased (e.g. `{ charset: "utf-8" }`). */
  params: Record<string, string>;
  /** The payload's bytes. */
  bytes: Uint8Array;
}

/** A header longer than this is not a data: URL header (and scanning further would only cost time). */
const MAX_HEADER_LENGTH = 1024;
const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const PARAM = /^([a-z0-9!#$%&'*+.^_`|~-]+)(?:=(.*))?$/i;
const BASE64 = /^[A-Za-z0-9+/]*$/;

/**
 * The header of a data: URL — media type, parameters, base64 flag — without
 * touching the payload. Null when `value` is not a data: URL: no `data:`
 * scheme, no comma, or a header that is not a media type and parameters (so
 * prose that happens to start with "data:" is not mistaken for media).
 */
export function parseDataUrlHeader(value: unknown): DataUrlHeader | null {
  if (typeof value !== "string" || value.length < 6 || value.slice(0, 5).toLowerCase() !== "data:") return null;
  const comma = value.indexOf(",", 5);
  if (comma < 0 || comma - 5 > MAX_HEADER_LENGTH) return null;
  const [type, ...rest] = value.slice(5, comma).split(";");
  const mime = type.trim().toLowerCase();
  if (mime && !MIME.test(mime)) return null;
  const params: Record<string, string> = {};
  let base64 = false;
  for (const part of rest) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === "base64") {
      base64 = true;
      continue;
    }
    const match = PARAM.exec(trimmed);
    if (!match) return null;
    params[match[1].toLowerCase()] = (match[2] ?? "").trim().replace(/^"(.*)"$/, "$1");
  }
  return { mime, params, base64, payloadStart: comma + 1 };
}

/** Whether `value` is a data: URL (by its header; the payload is not checked). */
export function isDataUrl(value: unknown): value is string {
  return parseDataUrlHeader(value) !== null;
}

function hexValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

/**
 * The bytes of a percent-encoded payload: its UTF-8 bytes, with every valid
 * `%XX` replaced by that byte (a stray `%` stays as it is), as the Fetch
 * spec decodes a non-base64 data: URL.
 */
export function percentDecode(payload: string): Uint8Array {
  const raw = new TextEncoder().encode(payload);
  if (!payload.includes("%")) return raw;
  const out = new Uint8Array(raw.length);
  let length = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 37 && i + 2 < raw.length) {
      const high = hexValue(raw[i + 1]);
      const low = hexValue(raw[i + 2]);
      if (high >= 0 && low >= 0) {
        out[length++] = high * 16 + low;
        i += 2;
        continue;
      }
    }
    out[length++] = raw[i];
  }
  return out.slice(0, length);
}

type BufferLike = { from(data: string, encoding: "base64"): Uint8Array };

/**
 * Forgiving base64 (the Fetch spec's, plus the URL-safe alphabet that turns
 * up in the wild): whitespace is ignored, padding is optional, `%XX` escapes
 * are undone first. Anything else outside the alphabet makes it null rather
 * than being skipped, since skipping characters is exactly what turns a
 * misread payload into noise.
 */
export function decodeBase64(payload: string): Uint8Array | null {
  let text = payload.includes("%") ? payload.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : payload;
  text = text.replace(/\s+/g, "");
  if (text.includes("-") || text.includes("_")) text = text.replace(/-/g, "+").replace(/_/g, "/");
  if (text.endsWith("==")) text = text.slice(0, -2);
  else if (text.endsWith("=")) text = text.slice(0, -1);
  if (text.length % 4 === 1 || !BASE64.test(text)) return null;
  const NodeBuffer = (globalThis as { Buffer?: BufferLike }).Buffer;
  if (NodeBuffer) return NodeBuffer.from(text, "base64");
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Decodes a data: URL: its media type (possibly ""), its parameters, and the
 * bytes of everything after the first comma. Null when `value` is not a
 * data: URL, or its base64 payload is not base64.
 */
export function parseDataUrl(value: unknown): DataUrl | null {
  const header = parseDataUrlHeader(value);
  if (!header) return null;
  const payload = (value as string).slice(header.payloadStart);
  const bytes = header.base64 ? decodeBase64(payload) : percentDecode(payload);
  if (!bytes) return null;
  return { mime: header.mime, params: header.params, bytes };
}
