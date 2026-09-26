/**
 * Shared fixtures for the asset library tests: media generated in code
 * (no binary fixture files), a temp library root, and a fake desktop bridge.
 */

import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { deflateSync } from "zlib";
import type { DesktopServerBridge, RecordAssetMeta } from "../../types";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A valid RGB PNG of one flat colour. Different `seed`s give different bytes. */
export function makePng(width = 4, height = 3, seed = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = (seed * 37) & 0xff;
    row[2 + x * 3] = (seed * 91 + 50) & 0xff;
    row[3 + x * 3] = (seed * 13 + 200) & 0xff;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A 16-bit mono PCM WAV of `seconds` of silence. */
export function makeWav(seconds = 0.5, sampleRate = 8000): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** A 64x48 flat red H.264 MP4, 0.6 s long (made with ffmpeg, 1.6 KB). */
export const TINY_MP4 = Buffer.from(
  [
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANdbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAlgAAQAAAQAA",
    "AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAA",
    "Aoh0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAlgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAA",
    "AAAAAAAAAAAAAABAAAAAAEAAAAAwAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAJYAAAQAAABAAAAAAIAbWRpYQAAACBtZGhk",
    "AAAAAAAAAAAAAAAAAAAoAAAAGABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABq21p",
    "bmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAWtzdGJsAAAAv3N0c2QA",
    "AAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAMABIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGli",
    "eDI2NAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UR7ARAAAAMAEAAAAwCg8SJZYAEABmjr48siwP34+AAAAAAQ",
    "cGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAnUgAAAAAAAAAYc3R0cwAAAAAAAAABAAAAAwAACAAAAAAUc3RzcwAAAAAAAAABAAAA",
    "AQAAAChjdHRzAAAAAAAAAAMAAAABAAAQAAAAAAEAABgAAAAAAQAACAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAMAAAABAAAAIHN0",
    "c3oAAAAAAAAAAAAAAAMAAALZAAAADgAAAAwAAAAUc3RjbwAAAAAAAAABAAADjQAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIA",
    "AAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjEuNy4xMDAAAAAIZnJl",
    "ZQAAAvttZGF0AAACrQYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOCAzMWUxOWY5IC0gSC4yNjQvTVBF",
    "Ry00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9w",
    "dGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBw",
    "c3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09",
    "MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVh",
    "ZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFp",
    "bmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Bl",
    "bl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xv",
    "b2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlw",
    "X3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAkZYiEABH//ufj/AprKxHEv01QKM3ptdyoujXHtijNqS8fduE/AAAACkGaImxD//6p",
    "06AAAAAIAZ5BeQ//CVk=",
  ].join(""),
  "base64",
);

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function md5(buffer: Buffer): string {
  return createHash("md5").update(buffer).digest("hex");
}

export function tempDir(prefix = "nb-assets-"): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

let counter = 0;

/** A client-style asset id (matches ASSET_ID_PATTERN). */
export function assetId(): string {
  counter++;
  return `a${Date.now().toString(36)}${counter.toString(36).padStart(10, "0")}`;
}

export function runId(): string {
  counter++;
  return `r${Date.now().toString(36)}${counter.toString(36).padStart(10, "0")}`;
}

export function meta(overrides: Partial<RecordAssetMeta> = {}): RecordAssetMeta {
  return {
    id: assetId(),
    kind: "image",
    origin: "generated",
    createdAt: Date.now(),
    prompt: "A cat in a hat",
    model: { provider: "gemini", modelId: "nano-banana", displayName: "Nano Banana" },
    producer: { nodeId: "nanoBanana-1", nodeType: "nanoBanana" },
    workflowId: "wf_test_1",
    workflowName: "Test flow",
    runId: runId(),
    ...overrides,
  };
}

export async function* bytes(buffer: Buffer, chunkSize = 1000): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    yield new Uint8Array(buffer.subarray(offset, offset + chunkSize));
  }
}

export function streamOf(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

/** Installs a fake Electron bridge that records requests and "trashes" by moving files aside. */
export function installBridge(trashDir: string): { calls: { type: string; path?: string }[]; remove(): void } {
  const calls: { type: string; path?: string }[] = [];
  fs.mkdirSync(trashDir, { recursive: true });
  const bridge: DesktopServerBridge = {
    async request(type, payload) {
      calls.push({ type, path: payload.path });
      if (type === "trash" && payload.path) {
        fs.renameSync(payload.path, path.join(trashDir, `${calls.length}-${path.basename(payload.path)}`));
      }
      return { ok: true };
    },
  };
  (globalThis as { __nodeBananaDesktop?: DesktopServerBridge }).__nodeBananaDesktop = bridge;
  return {
    calls,
    remove: () => {
      delete (globalThis as { __nodeBananaDesktop?: DesktopServerBridge }).__nodeBananaDesktop;
    },
  };
}
