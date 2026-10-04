import { describe, expect, it } from "vitest";
import {
  blobToDataUrl,
  dataUrlBytes,
  dataUrlMime,
  dataUrlToBlob,
  isDataUrl,
  isMediaString,
  parseDataUrl,
  sha256Hex,
} from "../mediaBlob";
import { readText, sha256Of } from "./helpers";

describe("media strings", () => {
  it("tells data: URLs from prose that starts with 'data:'", () => {
    expect(isDataUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isDataUrl("data:,Hello")).toBe(true);
    expect(isDataUrl("data:image/svg+xml;charset=utf-8,%3Csvg%3E")).toBe(true);
    expect(isDataUrl("data: the numbers, all of them")).toBe(false);
    expect(isDataUrl("database, tables")).toBe(false);
    expect(isMediaString("blob:http://localhost/1")).toBe(true);
    expect(isMediaString("https://cdn.example.com/a.png")).toBe(false);
    expect(isMediaString(42)).toBe(false);
  });

  it("reads the type without its parameters", () => {
    expect(dataUrlMime("data:Image/SVG+xml;charset=utf-8;base64,AAAA")).toBe("image/svg+xml");
    expect(dataUrlMime("data:,Hello")).toBeNull();
    expect(parseDataUrl("data:text/plain;charset=US-ASCII;base64,SGk=")).toEqual({
      mime: "text/plain",
      base64: true,
      payload: "SGk=",
    });
  });

  it("decodes base64, with whitespace, the URL-safe alphabet or no padding", () => {
    expect(new TextDecoder().decode(dataUrlBytes("data:text/plain;base64,SGVs bG8=\n"))).toBe("Hello");
    expect([...dataUrlBytes("data:application/octet-stream;base64,-_8")]).toEqual([251, 255]);
  });

  it("percent-decodes a payload that is not base64", () => {
    expect(new TextDecoder().decode(dataUrlBytes("data:image/svg+xml;charset=utf-8,%3Csvg%20a='1'%3E%E2%9C%93"))).toBe(
      "<svg a='1'>✓",
    );
    expect(new TextDecoder().decode(dataUrlBytes("data:,100%"))).toBe("100%");
  });

  it("turns a data: URL into a typed Blob synchronously", async () => {
    const blob = dataUrlToBlob(`data:image/png;base64,${btoa("PNG")}`);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(3);
    await expect(readText(blob)).resolves.toBe("PNG");
    expect(dataUrlToBlob("data:,x", "text/plain").type).toBe("text/plain");
    expect(() => dataUrlToBlob("not a url")).toThrow();
  });

  it("round-trips a Blob to a data: URL", async () => {
    const url = `data:image/png;base64,${btoa("PNG")}`;
    await expect(blobToDataUrl(dataUrlToBlob(url))).resolves.toBe(url);
  });

  it("hashes bytes as lowercase hex SHA-256", async () => {
    const bytes = new TextEncoder().encode("abc");
    await expect(sha256Hex(bytes)).resolves.toBe(await sha256Of("abc"));
    await expect(sha256Hex(bytes)).resolves.toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
