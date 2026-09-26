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
import type { AssetKind } from "../types";
import { imageDimensionsFromFile, probeContainer, readHead, sniffFamily, type ProbeResult } from "./media";
import { isDecodeError, loadSharp } from "./thumbs";
import { mediaTypeForExt } from "./validate";

export type Readability = "readable" | "unreadable" | "unknown";

const HEAD_BYTES = 64 * 1024;
/** Files larger than this are not handed to sharp: reading them would cost more than the answer. */
const MAX_SHARP_BYTES = 256 * 1024 * 1024;

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
 * named a container, needs no further look.
 */
export async function isUnreadableFile(
  file: string,
  type: { kind: AssetKind; sniffed: boolean },
  measured: ProbeResult,
): Promise<boolean> {
  if (type.kind === "3d") return false;
  if (type.kind === "image" ? Boolean(measured.width && measured.height) : type.sniffed) return false;
  return (await assessReadable(file, type.kind)) === "unreadable";
}
