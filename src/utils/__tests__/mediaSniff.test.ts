// @vitest-environment node
import { describe, expect, it } from "vitest";
import { kindOfExtension, mimeOfExtension, sniffExtension, sniffFamily } from "../mediaSniff";
import { makePng, makeWav, TINY_MP4 } from "@/lib/assets/server/__tests__/helpers";

function ftyp(brand: string): Buffer {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write("ftyp", 4, "latin1");
  box.write(brand, 8, "latin1");
  return box;
}

describe("sniffExtension", () => {
  it("names every format the save routes write by its bytes", () => {
    expect(sniffExtension(makePng())).toBe("png");
    expect(sniffExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpg");
    expect(sniffExtension(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"))).toBe("gif");
    expect(sniffExtension(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("webp");
    expect(sniffExtension(Buffer.from('<?xml version="1.0"?>\n<svg width="1" height="1"/>'))).toBe("svg");
    expect(sniffExtension(TINY_MP4)).toBe("mp4");
    expect(sniffExtension(ftyp("qt  "))).toBe("mov");
    expect(sniffExtension(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))).toBe("webm");
    expect(sniffExtension(Buffer.from("ID3\x04\0\0", "latin1"))).toBe("mp3");
    expect(sniffExtension(makeWav())).toBe("wav");
    expect(sniffExtension(Buffer.from("OggS\0\0", "latin1"))).toBe("ogg");
    expect(sniffExtension(Buffer.from("fLaC\0\0", "latin1"))).toBe("flac");
    expect(sniffExtension(ftyp("M4A "))).toBe("m4a");
    expect(sniffExtension(Buffer.from("glTF\x02\0\0\0", "latin1"))).toBe("glb");
  });

  it("lets the kind pick within a container that carries either", () => {
    expect(sniffExtension(TINY_MP4, "audio")).toBe("m4a");
    expect(sniffExtension(TINY_MP4, "video")).toBe("mp4");
    expect(sniffExtension(ftyp("M4A "), "video")).toBe("mp4");
  });

  it("reads a zip or glTF JSON as 3D only when a model was meant", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(sniffExtension(zip, "image")).toBeNull();
    expect(sniffExtension(zip)).toBeNull();
    expect(sniffExtension(zip, "3d")).toBe("usdz");
    expect(sniffExtension(Buffer.from('{"asset":{"version":"2.0"}}'), "3d")).toBe("gltf");
  });

  it("proves nothing about noise, such as a PNG decoded together with its data: header", () => {
    const damaged = Buffer.from(`data:;base64,${makePng().toString("base64")}`, "base64");
    expect(sniffExtension(damaged)).toBeNull();
    expect(sniffExtension(Buffer.from("hello"))).toBeNull();
    expect(sniffExtension(new Uint8Array(0))).toBeNull();
  });

  it("works on a plain Uint8Array (the browser has no Buffer)", () => {
    expect(sniffFamily(new Uint8Array(makePng()))).toEqual(["png"]);
    expect(sniffFamily(new Uint8Array(TINY_MP4))).toEqual(["mp4", "m4a"]);
  });
});

describe("kindOfExtension and mimeOfExtension", () => {
  it("map a sniffed extension to its kind and MIME type", () => {
    expect(kindOfExtension("m4a")).toBe("audio");
    expect(kindOfExtension("glb")).toBe("3d");
    expect(kindOfExtension("txt")).toBeNull();
    expect(mimeOfExtension("jpg")).toBe("image/jpeg");
    expect(mimeOfExtension("m4a")).toBe("audio/mp4");
    expect(mimeOfExtension("webm", "audio")).toBe("audio/webm");
    expect(mimeOfExtension("webm")).toBe("video/webm");
  });
});
