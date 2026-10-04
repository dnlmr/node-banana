// @vitest-environment node
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertPublicHttpsUrl, downloadToPartial, isBlockedAddress, type FetchLike, type LookupAll } from "../download";
import { Ingestor } from "../ingest";
import { AssetLibrary } from "../library";
import { makePng, meta, sha256, tempDir } from "./helpers";

let dir: string;

beforeEach(() => {
  dir = tempDir("nb-assets-dl-");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const publicLookup: LookupAll = async () => [{ address: "93.184.216.34", family: 4 }];

function streamResponse(body: Buffer, init: ResponseInit & { chunk?: number } = {}): Response {
  const size = init.chunk ?? 7;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= body.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(body.subarray(offset, offset + size)));
      offset += size;
    },
  });
  return new Response(stream, { status: 200, ...init });
}

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1234",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:c0a8:0101::1",
    "not an ip",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe("assertPublicHttpsUrl", () => {
  it("allows https URLs whose host resolves to public addresses", async () => {
    await expect(assertPublicHttpsUrl("https://cdn.example.com/v.mp4", publicLookup)).resolves.toBeInstanceOf(URL);
  });

  it.each([
    ["http://cdn.example.com/v.mp4", /https/],
    ["file:///etc/passwd", /https/],
    ["https://user:pw@cdn.example.com/x", /credentials/],
    ["https://localhost/x", /not allowed/],
    ["https://127.0.0.1/x", /not allowed/],
    ["https://[::1]/x", /not allowed/],
    ["https://169.254.169.254/latest/meta-data", /not allowed/],
    ["not a url", /Invalid URL/],
  ])("refuses %s", async (url, message) => {
    await expect(assertPublicHttpsUrl(url, publicLookup)).rejects.toThrow(message);
  });

  it("refuses a hostname that resolves to any private address", async () => {
    const mixed: LookupAll = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    await expect(assertPublicHttpsUrl("https://rebind.example.com/x", mixed)).rejects.toMatchObject({ code: "blocked_url" });
  });
});

describe("downloadToPartial", () => {
  it("streams the body to a partial file with its hashes", async () => {
    const png = makePng(10, 10);
    const fetchMock = vi.fn<FetchLike>(async () => streamResponse(png, { headers: { "content-type": "image/png" } }));
    const result = await downloadToPartial("https://cdn.example.com/out.png", dir, { fetch: fetchMock, lookup: publicLookup });
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.com/out.png", expect.objectContaining({ redirect: "manual" }));
    expect(result.file.sha256).toBe(sha256(png));
    expect(result.contentType).toBe("image/png");
    expect(fs.readFileSync(result.file.partialPath).equals(png)).toBe(true);
  });

  it("re-validates every redirect hop", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) =>
      url.includes("first")
        ? new Response(null, { status: 302, headers: { location: "https://internal.example.com/secret" } })
        : streamResponse(Buffer.from("never")),
    );
    const lookup: LookupAll = async (host) =>
      host === "internal.example.com" ? [{ address: "192.168.0.10", family: 4 }] : [{ address: "93.184.216.34", family: 4 }];
    await expect(downloadToPartial("https://first.example.com/x", dir, { fetch: fetchMock, lookup })).rejects.toMatchObject({
      code: "blocked_url",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows at most five redirects", async () => {
    let hops = 0;
    const fetchMock: FetchLike = async () => {
      hops++;
      return new Response(null, { status: 301, headers: { location: `/hop${hops}` } });
    };
    await expect(downloadToPartial("https://cdn.example.com/x", dir, { fetch: fetchMock, lookup: publicLookup })).rejects.toThrow(
      /too many/,
    );
    expect(hops).toBe(6);
  });

  it("enforces the size cap while streaming, even without Content-Length", async () => {
    const fetchMock: FetchLike = async () => streamResponse(Buffer.alloc(100, 1));
    await expect(
      downloadToPartial("https://cdn.example.com/big", dir, { fetch: fetchMock, lookup: publicLookup, maxBytes: 50 }),
    ).rejects.toMatchObject({ code: "too_large" });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("refuses early when Content-Length is over the cap", async () => {
    const fetchMock: FetchLike = async () => streamResponse(Buffer.alloc(10), { headers: { "content-length": "999" } });
    await expect(
      downloadToPartial("https://cdn.example.com/big", dir, { fetch: fetchMock, lookup: publicLookup, maxBytes: 50 }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("abandons a body that stops arriving", async () => {
    const fetchMock: FetchLike = async (_url, init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            init.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
          },
        }),
      );
    await expect(
      downloadToPartial("https://cdn.example.com/slow", dir, { fetch: fetchMock, lookup: publicLookup, idleTimeoutMs: 40 }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("reports HTTP errors", async () => {
    const fetchMock: FetchLike = async () => new Response("nope", { status: 403 });
    await expect(downloadToPartial("https://cdn.example.com/x", dir, { fetch: fetchMock, lookup: publicLookup })).rejects.toThrow(
      /HTTP 403/,
    );
  });
});

describe("recording from a URL", () => {
  it("downloads into the library and records it", async () => {
    const root = path.join(dir, "Library");
    const library = new AssetLibrary(root);
    await library.ready();
    const png = makePng(12, 7, 3);
    const ingest = new Ingestor({
      library: () => library,
      thumbs: () => null,
      isPaused: () => false,
      download: { fetch: async () => streamResponse(png, { headers: { "content-type": "application/octet-stream" } }), lookup: publicLookup },
    });
    const m = meta({ kind: "image", prompt: "from a url" });
    const started = await ingest.begin({ meta: m, source: { type: "url", url: "https://cdn.example.com/files/out.png?sig=1" } });
    expect("result" in started).toBe(true);
    if (!("result" in started)) return;
    expect(started.result.asset).toMatchObject({ id: m.id, ext: "png", width: 12, height: 7, sha256: sha256(png) });
    expect(fs.readFileSync(started.result.asset.displayPath).equals(png)).toBe(true);
    await library.drain();
  });

  it("refuses to record while the library is paused", async () => {
    const library = new AssetLibrary(path.join(dir, "Library"));
    const ingest = new Ingestor({ library: () => library, thumbs: () => null, isPaused: () => true });
    await expect(ingest.begin({ meta: meta(), source: { type: "upload" } })).rejects.toMatchObject({
      status: 503,
      code: "paused",
      retryAfter: expect.any(Number),
    });
  });
});
