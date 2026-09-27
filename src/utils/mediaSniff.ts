/**
 * What a file is, from its first bytes. Works on any Uint8Array (a Node
 * Buffer is one), so the browser, the save routes and the asset library all
 * read a file's type the same way.
 */

export type SniffKind = "image" | "video" | "audio" | "3d";

/** Latin-1 text of `bytes[start, end)`, or "" when the buffer is shorter than `end`. */
function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return "";
  let text = "";
  for (let i = start; i < end; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

const AVIF_BRANDS = new Set(["avif", "avis"]);
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);
/** Brands any HEIF still or sequence may lead with; the compatible brands then say AVIF or HEIC. */
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

/** An ISO-BMFF file that is an AVIF or HEIC image (by its ftyp brands), else null. */
function heifImage(head: Uint8Array): "avif" | "heic" | null {
  const major = ascii(head, 8, 12);
  if (AVIF_BRANDS.has(major)) return "avif";
  if (HEIC_BRANDS.has(major)) return "heic";
  if (!HEIF_BRANDS.has(major)) return null;
  const end = Math.min(uint32be(head, 0), head.length, 512);
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (AVIF_BRANDS.has(ascii(head, offset, offset + 4))) return "avif";
  }
  return "heic";
}

/**
 * The format families a file's first bytes prove, most specific first. A
 * family lists every type the container can be (an ISO-BMFF file is mp4
 * video or m4a audio), and the caller picks by kind. Null when the bytes
 * prove nothing.
 */
export function sniffFamily(head: Uint8Array): string[] | null {
  if (head.length < 4) return null;
  if (head[0] === 0x89 && ascii(head, 1, 4) === "PNG") return ["png"];
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return ["jpg"];
  const first6 = ascii(head, 0, 6);
  if (first6 === "GIF87a" || first6 === "GIF89a") return ["gif"];
  if (ascii(head, 0, 4) === "RIFF") {
    const form = ascii(head, 8, 12);
    if (form === "WEBP") return ["webp"];
    if (form === "WAVE") return ["wav"];
    return null;
  }
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand === "qt  ") return ["mov"];
    if (brand === "M4A " || brand === "M4B " || brand === "M4P ") return ["m4a", "mp4"];
    // AVIF and HEIC stills are ISO-BMFF too; they are images, not mp4 video.
    const image = heifImage(head);
    if (image) return [image];
    return ["mp4", "m4a"];
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return ["webm"];
  if (ascii(head, 0, 4) === "OggS") return ["ogg"];
  if (ascii(head, 0, 4) === "fLaC") return ["flac"];
  if (ascii(head, 0, 3) === "ID3") return ["mp3"];
  if (head[0] === 0xff && (head[1] & 0xf6) === 0xf0) return ["aac"];
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0) return ["mp3"];
  if (ascii(head, 0, 4) === "glTF") return ["glb"];
  if (ascii(head, 0, 18) === "Kaydara FBX Binary") return ["fbx"];
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return ["usdz"];

  const text = new TextDecoder("utf-8").decode(head.subarray(0, Math.min(head.length, 4096))).replace(/^﻿/, "").trimStart();
  if (/^<svg[\s>]/i.test(text) || (/^<\?xml/i.test(text) && /<svg[\s>]/i.test(text))) return ["svg"];
  if (text.startsWith("{") && /"asset"\s*:/.test(text)) return ["gltf"];
  return null;
}

const KIND_OF_EXT: Record<string, SniffKind> = {
  png: "image",
  jpg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  avif: "image",
  heic: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  aac: "audio",
  m4a: "audio",
  glb: "3d",
  gltf: "3d",
  fbx: "3d",
  usdz: "3d",
};

/** Formats a file only is when it was meant as a 3D model: any zip looks like usdz, any glTF-ish JSON like gltf. */
const ONLY_FOR_3D = new Set(["usdz", "gltf", "fbx"]);

/**
 * The file extension the bytes prove (lowercase, no dot), or null. `kind`
 * picks within a container that carries either (an ISO-BMFF file is `m4a`
 * for audio, `mp4` otherwise); a zip or JSON only counts for a 3D kind.
 */
export function sniffExtension(bytes: Uint8Array, kind?: SniffKind): string | null {
  const family = sniffFamily(bytes);
  if (!family) return null;
  const usable = family.filter((ext) => !ONLY_FOR_3D.has(ext) || kind === "3d");
  if (!usable.length) return null;
  return (kind && usable.find((ext) => KIND_OF_EXT[ext] === kind)) || usable[0];
}

/** Which kind of media an extension from {@link sniffExtension} is. */
export function kindOfExtension(ext: string): SniffKind | null {
  return KIND_OF_EXT[ext] ?? null;
}

const MIME_OF_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  fbx: "model/fbx",
  usdz: "model/vnd.usdz+zip",
};

/** The MIME type of an extension from {@link sniffExtension} (`webm` audio is `audio/webm`). */
export function mimeOfExtension(ext: string, kind?: SniffKind): string | null {
  if (ext === "webm" && kind === "audio") return "audio/webm";
  return MIME_OF_EXT[ext] ?? null;
}
