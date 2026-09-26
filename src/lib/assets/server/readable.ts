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
 * Formats the library doesn't store but a browser (or another app) may still
 * open, so a file that starts like one is never called unreadable.
 */
function otherKnownFormat(head: Buffer): boolean {
  if (ascii(head, 0, 2) === "BM" && head.length >= 26) return true; // BMP
  const four = ascii(head, 0, 4);
  if (four === "II*\0" || four === "MM\0*") return true; // TIFF
  if (four === "\0\0\x01\0") return true; // ICO
  if ((head[0] === 0xff && head[1] === 0x0a) || ascii(head, 4, 8) === "JXL ") return true; // JPEG XL
  if (four === "8BPS") return true; // Photoshop
  if (four === "FORM" && /^AIF[FC]$/.test(ascii(head, 8, 12))) return true; // AIFF
  if (ascii(head, 0, 5) === "#!AMR" || four === "caff") return true; // AMR, Core Audio
  if (head.length > 188 && head[0] === 0x47 && head[188] === 0x47) return true; // MPEG-TS
  return false;
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
  const family = sniffFamily(head);
  if (family || otherKnownFormat(head)) {
    // The first bytes prove a format: whatever else may be wrong, this is not noise.
    if (kind !== "image") return "readable";
    const image = family?.find((ext) => mediaTypeForExt(ext, "image")?.kind === "image");
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
