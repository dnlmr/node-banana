/**
 * Whether a file's bytes are media anything can open.
 *
 * Some files are not: older save routes base64-decoded a whole data URL,
 * header included, when its media type was empty, and wrote noise under a
 * .png name. Their records are kept (the file is the user's, and nothing here
 * ever changes it), but marked `unreadable` so no listing, facet or count
 * shows a tile that can only ever be a placeholder.
 *
 * The test is conservative, so a valid file is never hidden:
 *
 * - image: the first bytes prove no known format, and sharp can't read
 *   dimensions from the file either;
 * - video/audio: the first bytes prove no known container, and mediabunny
 *   recognises none either;
 * - 3D: never.
 *
 * Whatever can't be told for sure — the file can't be read right now (missing,
 * locked, offline), a probe ran out of time, sharp won't load — is `unknown`,
 * and nothing is marked on an `unknown`.
 */

import { promises as fs } from "fs";
import type { AssetKind, AssetRecord } from "../types";
import { mapConcurrent } from "./fsutil";
import type { AssetLibrary } from "./library";
import { imageDimensionsFromFile, probeContainer, readHead, sniffFamily, type ProbeResult } from "./media";
import { isDecodeError, loadSharp } from "./thumbs";
import { mediaTypeForExt } from "./validate";

export type Readability = "readable" | "unreadable" | "unknown";

const HEAD_BYTES = 64 * 1024;
/** Files larger than this are not handed to sharp: reading them would cost more than the answer. */
const MAX_SHARP_BYTES = 256 * 1024 * 1024;
/** Files looked at once when the index loads. */
const SWEEP_CONCURRENCY = 4;

function ascii(head: Buffer, start: number, end: number): string {
  return head.length >= end ? head.toString("latin1", start, end) : "";
}

/**
 * ISO-BMFF / QuickTime boxes a valid file may open with instead of `ftyp`:
 * classic QuickTime movies start with `moov`, `mdat` or `wide`, and some
 * muxers lead with `free` or `skip`. Players open them; mediabunny (and the
 * shared sniffer) recognise only a leading `ftyp`.
 */
const LEADING_BOXES = new Set(["moov", "mdat", "wide", "free", "skip", "pnot", "uuid", "styp", "sidx", "moof", "junk", "pdin"]);
const ASF_GUID = Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]);

/** An SVG whose `<svg` the shared sniffer doesn't reach: after a long comment or a DOCTYPE, or in UTF-16. */
function svgText(head: Buffer): boolean {
  let text: string;
  if (head[0] === 0xff && head[1] === 0xfe) text = head.toString("utf16le", 2);
  else if (head[0] === 0xfe && head[1] === 0xff) text = Buffer.from(head.subarray(2, head.length - (head.length % 2))).swap16().toString("utf16le");
  else text = head.toString("utf8");
  text = text.replace(/^﻿/, "").trimStart();
  return text.startsWith("<") && /<svg[\s>]/i.test(text);
}

/**
 * Formats the library doesn't store (or that the shared sniffer and
 * mediabunny don't recognise in this shape) but a browser or another app may
 * still open, so a file that starts like one is never called unreadable.
 */
function otherKnownFormat(head: Buffer): boolean {
  if (ascii(head, 0, 2) === "BM" && head.length >= 26) return true; // BMP
  const four = ascii(head, 0, 4);
  if (four === "II*\0" || four === "MM\0*") return true; // TIFF
  if (four === "\0\0\x01\0") return true; // ICO
  if ((head[0] === 0xff && head[1] === 0x0a) || ascii(head, 4, 8) === "JXL ") return true; // JPEG XL
  if (ascii(head, 4, 12) === "jP  \r\n\x87\n" || four === "\xffO\xffQ") return true; // JPEG 2000
  if (four === "8BPS") return true; // Photoshop
  // RIFF and IFF containers of any form (AVI, WAVE as RF64/BW64, RIFF MP3, AIFF…).
  if (/^(RIFF|RIFX|RF64|BW64|FORM)$/.test(four) && /^[\x20-\x7e]{4}$/.test(ascii(head, 8, 12))) return true;
  if (four === "riff" && head.length >= 16) return true; // Sony Wave64
  if (head.length >= 8 && LEADING_BOXES.has(ascii(head, 4, 8))) {
    const size = head.readUInt32BE(0);
    if (size === 0 || size === 1 || size >= 8) return true; // ISO-BMFF / QuickTime without a leading ftyp
  }
  if (head.length >= 8 && head.subarray(0, 8).equals(ASF_GUID)) return true; // ASF (WMV, WMA)
  if (ascii(head, 0, 3) === "FLV" && head[3] === 1) return true; // Flash video
  if (head[0] === 0 && head[1] === 0 && head[2] === 1 && (head[3] === 0xba || head[3] === 0xb3)) return true; // MPEG-PS, MPEG video
  if (ascii(head, 0, 5) === "#!AMR" || four === "caff") return true; // AMR, Core Audio
  if (head.length > 188 && head[0] === 0x47 && head[188] === 0x47) return true; // MPEG-TS
  if (head.length > 196 && head[4] === 0x47 && head[196] === 0x47) return true; // M2TS (192-byte packets)
  return svgText(head);
}

/**
 * Whether the first bytes prove a format: at the start, or after zero
 * padding (which noise from a misread data URL never begins with, but some
 * writers leave before an MP3 or AAC stream, further than mediabunny's 4 KB
 * look for a first frame).
 */
function knownFormat(head: Buffer): { family: string[] | null } | null {
  const family = sniffFamily(head);
  if (family || otherKnownFormat(head)) return { family };
  let start = 0;
  while (start < head.length && head[start] === 0) start++;
  if (start === 0 || start + 4 > head.length) return null;
  const rest = head.subarray(start);
  return sniffFamily(rest) || otherKnownFormat(rest) ? { family: null } : null;
}

/** Whether sharp reads a size from the file: `unreadable` only when its decoder refused the bytes. */
async function sharpVerdict(file: string): Promise<Readability> {
  const sharp = await loadSharp();
  if (!sharp) return "unknown";
  let bytes: Buffer;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_SHARP_BYTES) return "unknown";
    // A Buffer, never the path, so libvips holds no library file open.
    bytes = await fs.readFile(file);
  } catch {
    return "unknown";
  }
  try {
    const metadata = await sharp(bytes, { failOn: "none" }).metadata();
    return metadata.width && metadata.height ? "readable" : "unknown";
  } catch (error) {
    return isDecodeError(error) ? "unreadable" : "unknown";
  }
}

/** Whether the file at `file`, recorded as `kind`, is media anything can open (see the module notes). */
export async function assessReadable(file: string, kind: AssetKind): Promise<Readability> {
  if (kind === "3d") return "readable";
  let head: Buffer;
  try {
    head = await readHead(file, HEAD_BYTES);
  } catch {
    return "unknown";
  }
  const known = knownFormat(head);
  if (known) {
    // The first bytes prove a format: whatever else may be wrong, this is not noise.
    if (kind !== "image") return "readable";
    const image = known.family?.find((ext) => mediaTypeForExt(ext, "image")?.kind === "image");
    return image && (await imageDimensionsFromFile(file, image, head)) ? "readable" : "unknown";
  }
  if (head.length === 0) return "unreadable";
  return kind === "image" ? sharpVerdict(file) : probeContainer(file);
}

/**
 * Whether a file just written or found is unreadable, given what measuring
 * it already proved: an image with a size, or video/audio whose first bytes
 * named a container or whose probe found a duration, needs no further look.
 */
export async function isUnreadableFile(
  file: string,
  type: { kind: AssetKind; sniffed: boolean },
  measured: ProbeResult,
): Promise<boolean> {
  if (type.kind === "3d") return false;
  const proven = type.kind === "image" ? Boolean(measured.width && measured.height) : type.sniffed || Boolean(measured.durationSec);
  if (proven) return false;
  return (await assessReadable(file, type.kind)) === "unreadable";
}

/**
 * Records worth a look when the index loads: images with no size, and video
 * or audio with no duration (a probe that could read the file would have
 * given one; whether the first bytes agree with the recorded type is then the
 * first thing {@link assessReadable} checks). Everything else was measured
 * from readable bytes.
 */
export function isUnreadableSuspect(record: AssetRecord): boolean {
  if (record.unreadable) return false;
  if (record.kind === "image") return !(record.width && record.height);
  if (record.kind === "video" || record.kind === "audio") return !record.durationSec;
  return false;
}

/**
 * The ids of records whose files are unreadable, among the suspects (and
 * every other record holding the same bytes as one). One look per content
 * and kind, a few at a time; each group tries its records' files in turn
 * until one can be read.
 */
export async function findUnreadable(library: AssetLibrary, concurrency = SWEEP_CONCURRENCY): Promise<string[]> {
  const groups = new Map<string, AssetRecord[]>();
  for (const record of library.allRecords()) {
    if (!isUnreadableSuspect(record)) continue;
    const key = `${record.sha256}:${record.kind}`;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }
  const found = await mapConcurrent([...groups.values()], concurrency, async (records) => {
    for (const record of records) {
      const file = library.filePath(record);
      if (!file) continue;
      const verdict = await assessReadable(file, record.kind);
      if (verdict === "readable") return [];
      if (verdict === "unreadable") {
        return library
          .recordsWithHash(record.sha256)
          .filter((other) => other.kind === record.kind && !other.unreadable)
          .map((other) => other.id);
      }
    }
    return [];
  });
  return [...new Set(found.flat())];
}
