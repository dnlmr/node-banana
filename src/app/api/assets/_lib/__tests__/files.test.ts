// @vitest-environment node
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every read stream serveFile opens, so tests can see it destroyed. */
const opened = vi.hoisted(() => [] as import("fs").ReadStream[]);

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    createReadStream: ((...args: Parameters<typeof actual.createReadStream>) => {
      const stream = actual.createReadStream(...args);
      opened.push(stream);
      return stream;
    }) as typeof actual.createReadStream,
  };
});

import type { ServedFile } from "@/lib/assets/server";
import {
  IMMUTABLE_CACHE,
  REVALIDATE_CACHE,
  contentDisposition,
  etagFor,
  ifRangeAllows,
  matchesIfNoneMatch,
  parseRange,
  serveFile,
} from "../files";
import { HttpError } from "../http";

const SHA = "ab".repeat(32);
const ETAG = `"${SHA}"`;

describe("parseRange", () => {
  it("serves the whole file without a Range header", () => {
    expect(parseRange(null, 100)).toEqual({ type: "full" });
    expect(parseRange("", 100)).toEqual({ type: "full" });
  });

  it("reads bytes=a-b, clamping the end to the file", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ type: "partial", start: 0, end: 9 });
    expect(parseRange("bytes=90-200", 100)).toEqual({ type: "partial", start: 90, end: 99 });
    expect(parseRange("bytes=5-5", 100)).toEqual({ type: "partial", start: 5, end: 5 });
  });

  it("reads an open-ended range bytes=a-", () => {
    expect(parseRange("bytes=40-", 100)).toEqual({ type: "partial", start: 40, end: 99 });
    expect(parseRange("bytes=0-", 100)).toEqual({ type: "partial", start: 0, end: 99 });
  });

  it("reads a suffix range bytes=-n", () => {
    expect(parseRange("bytes=-10", 100)).toEqual({ type: "partial", start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ type: "partial", start: 0, end: 99 });
  });

  it("tolerates case and whitespace in the unit and spec", () => {
    expect(parseRange("Bytes = 1 - 2", 100)).toEqual({ type: "partial", start: 1, end: 2 });
    expect(parseRange("bytes=10-19,", 100)).toEqual({ type: "partial", start: 10, end: 19 });
  });

  it("cannot satisfy a start past the end, a zero suffix, or any range of an empty file", () => {
    expect(parseRange("bytes=100-", 100)).toEqual({ type: "unsatisfiable" });
    expect(parseRange("bytes=150-200", 100)).toEqual({ type: "unsatisfiable" });
    expect(parseRange("bytes=-0", 100)).toEqual({ type: "unsatisfiable" });
    expect(parseRange("bytes=0-", 0)).toEqual({ type: "unsatisfiable" });
    expect(parseRange("bytes=-5", 0)).toEqual({ type: "unsatisfiable" });
    expect(parseRange("bytes=99999999999999999999999-", 100)).toEqual({ type: "unsatisfiable" });
  });

  it("ignores what it may ignore: other units, several ranges, invalid specs", () => {
    for (const header of ["items=0-5", "bytes=0-1,5-6", "bytes=5-2", "bytes=-", "bytes=abc", "bytes=1-2-3", "0-5"]) {
      expect(parseRange(header, 100), header).toEqual({ type: "full" });
    }
  });
});

describe("ETag helpers", () => {
  it("quotes the hash as a strong ETag", () => {
    expect(etagFor(SHA)).toBe(ETAG);
    expect(etagFor('bad"tag')).toBeNull();
    expect(etagFor("")).toBeNull();
  });

  it("If-None-Match matches weakly, in a list, or with *", () => {
    expect(matchesIfNoneMatch(ETAG, ETAG)).toBe(true);
    expect(matchesIfNoneMatch(`W/${ETAG}`, ETAG)).toBe(true);
    expect(matchesIfNoneMatch(`"other", ${ETAG}`, ETAG)).toBe(true);
    expect(matchesIfNoneMatch("*", ETAG)).toBe(true);
    expect(matchesIfNoneMatch('"other"', ETAG)).toBe(false);
    expect(matchesIfNoneMatch(null, ETAG)).toBe(false);
  });

  it("If-Range honours the range only for this exact copy", () => {
    expect(ifRangeAllows(null, ETAG)).toBe(true);
    expect(ifRangeAllows(ETAG, ETAG)).toBe(true);
    expect(ifRangeAllows(`W/${ETAG}`, ETAG)).toBe(false);
    expect(ifRangeAllows("Wed, 21 Oct 2015 07:28:00 GMT", ETAG)).toBe(false);
    expect(ifRangeAllows(ETAG, null)).toBe(false);
  });
});

describe("contentDisposition", () => {
  it("names an ASCII file plainly and exactly", () => {
    expect(contentDisposition("120304_cat_1a2b3c4d.png")).toBe(
      `attachment; filename="120304_cat_1a2b3c4d.png"; filename*=UTF-8''120304_cat_1a2b3c4d.png`,
    );
  });

  it("gives an ASCII fallback and the exact UTF-8 name for other scripts", () => {
    const header = contentDisposition("café 猫.webp", "inline");
    expect(header).toBe(`inline; filename="cafe _.webp"; filename*=UTF-8''caf%C3%A9%20%E7%8C%AB.webp`);
  });

  it("keeps quotes, separators and control characters out of the header", () => {
    const header = contentDisposition('a"b\\c/d;e%f\r\n.png');
    expect(header).toBe(`attachment; filename="a_b_c_d_e_f__.png"; filename*=UTF-8''a%22b_c_d%3Be%25f__.png`);
    expect(header).not.toMatch(/[\r\n]/);
  });

  it("percent-encodes the characters RFC 5987 leaves out of attr-char", () => {
    expect(contentDisposition("it's (1)*.png")).toContain("filename*=UTF-8''it%27s%20%281%29%2A.png");
  });

  it("falls back to a generic name when nothing printable is left", () => {
    expect(contentDisposition("")).toBe(`attachment; filename="download"; filename*=UTF-8''download`);
    expect(contentDisposition("猫")).toBe(`attachment; filename="_"; filename*=UTF-8''%E7%8C%AB`);
  });
});

describe("serveFile", () => {
  let dir: string;
  let filePath: string;
  let file: ServedFile;
  const content = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");

  const get = (headers: Record<string, string> = {}, init: RequestInit = {}) =>
    new Request("http://localhost:3000/api/assets/a1/file", { headers, ...init });

  beforeEach(() => {
    opened.length = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-assets-"));
    filePath = path.join(dir, "clip.mp4");
    fs.writeFileSync(filePath, content);
    file = { path: filePath, mime: "video/mp4", bytes: content.length, sha256: SHA, filename: "clip.mp4" };
  });

  afterEach(() => {
    for (const stream of opened) stream.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("streams the whole file with its headers", async () => {
    const response = await serveFile(get(), file, { cacheControl: REVALIDATE_CACHE });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(content);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "accept-ranges": "bytes",
      "content-length": String(content.length),
      "content-type": "video/mp4",
      etag: ETAG,
      "cache-control": "private, no-cache",
      "x-content-type-options": "nosniff",
    });
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("answers a range with 206 and Content-Range", async () => {
    const response = await serveFile(get({ range: "bytes=10-15" }), file, { cacheControl: IMMUTABLE_CACHE });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("abcdef");
    expect(response.headers.get("content-range")).toBe(`bytes 10-15/${content.length}`);
    expect(response.headers.get("content-length")).toBe("6");
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE_CACHE);
  });

  it("answers open-ended and suffix ranges", async () => {
    const open = await serveFile(get({ range: "bytes=30-" }), file, { cacheControl: IMMUTABLE_CACHE });
    expect(open.status).toBe(206);
    expect(await open.text()).toBe("uvwxyz");
    const suffix = await serveFile(get({ range: "bytes=-3" }), file, { cacheControl: IMMUTABLE_CACHE });
    expect(await suffix.text()).toBe("xyz");
    expect(suffix.headers.get("content-range")).toBe(`bytes 33-35/${content.length}`);
  });

  it("answers an unsatisfiable range with 416 and the file size", async () => {
    const response = await serveFile(get({ range: "bytes=999-" }), file, { cacheControl: IMMUTABLE_CACHE });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${content.length}`);
    expect(await response.text()).toBe("");
    expect(opened).toHaveLength(0);
  });

  it("measures the file on disk, not the record's size", async () => {
    const response = await serveFile(get({ range: "bytes=-4" }), { ...file, bytes: 5 }, { cacheControl: IMMUTABLE_CACHE });
    expect(await response.text()).toBe("wxyz");
    expect(response.headers.get("content-range")).toBe(`bytes 32-35/${content.length}`);
  });

  it("answers 304 when the browser's copy is current, without opening the file", async () => {
    const response = await serveFile(get({ "if-none-match": ETAG }), { ...file, path: path.join(dir, "gone") }, {
      cacheControl: REVALIDATE_CACHE,
    });
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(ETAG);
    expect(response.headers.get("cache-control")).toBe(REVALIDATE_CACHE);
    expect(opened).toHaveLength(0);
  });

  it("sends the whole file when If-Range names another copy", async () => {
    const response = await serveFile(get({ range: "bytes=0-3", "if-range": '"stale"' }), file, {
      cacheControl: IMMUTABLE_CACHE,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(content.toString());
  });

  it("honours If-Range naming this copy", async () => {
    const response = await serveFile(get({ range: "bytes=0-3", "if-range": ETAG }), file, { cacheControl: IMMUTABLE_CACHE });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("0123");
  });

  it("sets Content-Disposition when asked", async () => {
    const response = await serveFile(get(), { ...file, filename: "My clip.mp4" }, {
      cacheControl: REVALIDATE_CACHE,
      disposition: "attachment",
    });
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="My clip.mp4"; filename*=UTF-8''My%20clip.mp4`,
    );
    await response.arrayBuffer();
  });

  it("answers HEAD with headers only", async () => {
    const response = await serveFile(get({}, { method: "HEAD" }), file, { cacheControl: REVALIDATE_CACHE });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(content.length));
    expect(response.body).toBeNull();
    expect(opened).toHaveLength(0);
  });

  it("serves an empty file as an empty 200", async () => {
    fs.writeFileSync(filePath, "");
    const response = await serveFile(get(), file, { cacheControl: REVALIDATE_CACHE });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("0");
    expect(await response.text()).toBe("");
  });

  it("falls back to application/octet-stream without a type", async () => {
    const response = await serveFile(get(), { ...file, mime: "" }, { cacheControl: REVALIDATE_CACHE });
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    await response.arrayBuffer();
  });

  it("throws a 404 HttpError (code missing) when the file is gone or is a folder", async () => {
    for (const target of [path.join(dir, "gone.mp4"), path.join(dir, "gone", "deeper.mp4"), dir]) {
      const error = await serveFile(get(), { ...file, path: target }, { cacheControl: REVALIDATE_CACHE }).catch((e) => e);
      expect(error, target).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status: 404, code: "missing" });
    }
  });

  it("destroys the read stream when the browser goes away", async () => {
    const big = Buffer.alloc(4 * 1024 * 1024, 7);
    fs.writeFileSync(filePath, big);
    const controller = new AbortController();
    const response = await serveFile(get({}, { signal: controller.signal }), file, { cacheControl: REVALIDATE_CACHE });
    expect(opened).toHaveLength(1);
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await vi.waitFor(() => expect(opened[0].destroyed).toBe(true));
    await reader.cancel().catch(() => undefined);
  });

  it("destroys the read stream when the response body is cancelled (a seek)", async () => {
    fs.writeFileSync(filePath, Buffer.alloc(4 * 1024 * 1024, 7));
    const response = await serveFile(get({ range: "bytes=0-" }), file, { cacheControl: REVALIDATE_CACHE });
    await response.body!.cancel();
    await vi.waitFor(() => expect(opened[0].destroyed).toBe(true));
  });

  it("does not start streaming for a request that was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await serveFile(get({}, { signal: controller.signal }), file, { cacheControl: REVALIDATE_CACHE });
    expect(response.body).toBeNull();
    expect(opened).toHaveLength(0);
  });
});
