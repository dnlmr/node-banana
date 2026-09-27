// @vitest-environment node
/**
 * The shared data: URL parser.
 *
 * The bug it replaces: a save route whose regex did not match a data URL —
 * no media type (`data:;base64,…`, what a ComfyUI output with an empty
 * content type became), `application/octet-stream`, a `;charset=` parameter,
 * `image/svg+xml` — fell back to base64-decoding the WHOLE string. Node skips
 * `:`, `;` and `,`, so "data", the type and "base64" were read as base64
 * characters, every byte after them was shifted, and the PNG on disk was
 * noise no decoder can open.
 */

import { describe, expect, it } from "vitest";
import { decodeBase64, isDataUrl, parseDataUrl, parseDataUrlHeader, percentDecode } from "../dataUrl";
import { makePng, makeWav, TINY_MP4 } from "@/lib/assets/server/__tests__/helpers";

const png = makePng(6, 4);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,10,10" width="10" height="10"><rect width="10" height="10" fill="#f00"/></svg>';

const bytesOf = (value: string) => Buffer.from(parseDataUrl(value)!.bytes);

describe("parseDataUrl", () => {
  it("decodes the ordinary base64 form", () => {
    const parsed = parseDataUrl(`data:image/png;base64,${png.toString("base64")}`);
    expect(parsed?.mime).toBe("image/png");
    expect(parsed?.params).toEqual({});
    expect(Buffer.from(parsed!.bytes).equals(png)).toBe(true);
  });

  it("decodes a URL with no media type, and never the header", () => {
    const url = `data:;base64,${png.toString("base64")}`;
    const parsed = parseDataUrl(url);
    expect(parsed?.mime).toBe("");
    expect(Buffer.from(parsed!.bytes).equals(png)).toBe(true);
    // What the old fallback wrote: the header read as base64, every byte after it shifted.
    expect(Buffer.from(url, "base64").equals(png)).toBe(false);
  });

  it("decodes a URL whose type is a bare word as one with no type, as browsers do", () => {
    for (const word of ["image", "png", "PNG"]) {
      const parsed = parseDataUrl(`data:${word};base64,${png.toString("base64")}`);
      expect([word, parsed?.mime]).toEqual([word, ""]);
      expect(Buffer.from(parsed!.bytes).equals(png)).toBe(true);
    }
    // Prose still isn't a data: URL.
    expect(parseDataUrl("data: prose, really")).toBeNull();
    expect(parseDataUrl("data:two words, here")).toBeNull();
  });

  it("decodes application/octet-stream like any other type", () => {
    const parsed = parseDataUrl(`data:application/octet-stream;base64,${png.toString("base64")}`);
    expect(parsed?.mime).toBe("application/octet-stream");
    expect(Buffer.from(parsed!.bytes).equals(png)).toBe(true);
  });

  it("reads parameters before the base64 flag, lowercasing the type and keys", () => {
    const parsed = parseDataUrl(`data:Image/PNG;Charset=UTF-8;name="cat.png";base64,${png.toString("base64")}`);
    expect(parsed?.mime).toBe("image/png");
    expect(parsed?.params).toEqual({ charset: "UTF-8", name: "cat.png" });
    expect(Buffer.from(parsed!.bytes).equals(png)).toBe(true);
    expect(bytesOf("data:text/plain;charset=US-ASCII;base64,SGk=").toString()).toBe("Hi");
  });

  it("decodes image/svg+xml both percent-encoded and base64, commas in the payload included", () => {
    const percent = parseDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    expect(percent).toMatchObject({ mime: "image/svg+xml", params: { charset: "utf-8" } });
    expect(Buffer.from(percent!.bytes).toString("utf8")).toBe(svg);
    // Unescaped, the payload's own commas follow the first one: they are payload.
    expect(bytesOf(`data:image/svg+xml,${svg.replace(/#/g, "%23")}`).toString("utf8")).toBe(svg);
    const base64 = parseDataUrl(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
    expect(base64?.mime).toBe("image/svg+xml");
    expect(Buffer.from(base64!.bytes).toString("utf8")).toBe(svg);
  });

  it("forgives whitespace, missing padding, the URL-safe alphabet and %-escapes in base64", () => {
    expect(bytesOf("data:text/plain;base64,SGVs bG8=\n").toString()).toBe("Hello");
    expect(bytesOf("data:text/plain;base64,SGVsbG8").toString()).toBe("Hello");
    expect([...bytesOf("data:application/octet-stream;base64,-_8")]).toEqual([251, 255]);
    expect([...bytesOf("data:application/octet-stream;base64,%2B%2F8%3D")]).toEqual([251, 255]);
  });

  it("percent-decodes a payload without the base64 flag, as UTF-8", () => {
    expect(bytesOf("data:,Hello%2C%20World").toString()).toBe("Hello, World");
    expect(bytesOf("data:text/plain,%E2%9C%93 done").toString()).toBe("✓ done");
    expect(bytesOf("data:,100%").toString()).toBe("100%");
  });

  it("refuses a base64 payload that is not base64, instead of skipping what it can't read", () => {
    expect(parseDataUrl("data:image/png;base64,!!!")).toBeNull();
    expect(parseDataUrl("data:image/png;base64,AAAA=AAAA")).toBeNull();
    expect(parseDataUrl("data:image/png;base64,A")).toBeNull();
  });

  it("answers null for what is not a data: URL", () => {
    expect(parseDataUrl("https://example.com/cat.png")).toBeNull();
    expect(parseDataUrl("blob:http://localhost/1")).toBeNull();
    expect(parseDataUrl("data:image/png;base64")).toBeNull();
    expect(parseDataUrl("data: the numbers, all of them")).toBeNull();
    expect(parseDataUrl("database, tables")).toBeNull();
    expect(parseDataUrl(`data:${"x".repeat(2000)}/png;base64,AAAA`)).toBeNull();
    expect(parseDataUrl(42)).toBeNull();
  });

  it("decodes the same bytes without Buffer (the browser path)", () => {
    const holder = globalThis as { Buffer?: unknown };
    const saved = holder.Buffer;
    let decoded: Uint8Array | null = null;
    try {
      delete holder.Buffer;
      decoded = parseDataUrl(`data:;base64,${png.toString("base64")}`)?.bytes ?? null;
    } finally {
      holder.Buffer = saved;
    }
    expect(decoded).not.toBeNull();
    expect(Buffer.from(decoded!).equals(png)).toBe(true);
  });

  it("round-trips real media of every kind", () => {
    for (const [mime, bytes] of [
      ["image/jpeg", jpeg],
      ["audio/wav", makeWav()],
      ["video/mp4", TINY_MP4],
    ] as const) {
      expect(bytesOf(`data:${mime};base64,${bytes.toString("base64")}`).equals(bytes)).toBe(true);
    }
  });
});

describe("parseDataUrlHeader and isDataUrl", () => {
  it("reads the header without decoding the payload", () => {
    const url = `data:image/png;base64,${png.toString("base64")}`;
    expect(parseDataUrlHeader(url)).toEqual({ mime: "image/png", params: {}, base64: true, payloadStart: 22 });
    expect(url.slice(22)).toBe(png.toString("base64"));
    expect(parseDataUrlHeader("data:,x")).toEqual({ mime: "", params: {}, base64: false, payloadStart: 6 });
  });

  it("tells data: URLs from other strings", () => {
    expect(isDataUrl("data:;base64,AAAA")).toBe(true);
    expect(isDataUrl("DATA:IMAGE/PNG;BASE64,AAAA")).toBe(true);
    expect(isDataUrl("data:image/svg+xml;charset=utf-8,%3Csvg%3E")).toBe(true);
    expect(isDataUrl("data: prose, really")).toBe(false);
    expect(isDataUrl("https://example.com")).toBe(false);
  });
});

describe("decodeBase64 and percentDecode", () => {
  it("decodes raw base64 and refuses anything else", () => {
    expect(Buffer.from(decodeBase64(png.toString("base64"))!).equals(png)).toBe(true);
    expect(decodeBase64("https://example.com/a.png")).toBeNull();
    expect(decodeBase64("data:;base64,AAAA")).toBeNull();
    expect(decodeBase64("")?.length).toBe(0);
  });

  it("keeps a stray % and the UTF-8 of other characters", () => {
    expect(Buffer.from(percentDecode("a%zzb%41é")).toString("utf8")).toBe("a%zzbAé");
  });
});
