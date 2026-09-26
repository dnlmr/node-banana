// @vitest-environment node
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/assets/server", async (importOriginal) =>
  (await import("./support")).mockFacade(await importOriginal()),
);
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as facade from "@/lib/assets/server";
import { LibraryError, type ServedFile } from "@/lib/assets/server";
import { GET as getFile } from "../[id]/file/route";
import { PUT as putPoster } from "../[id]/poster/route";
import { GET as getMedia, PUT as putMedia } from "../media/[sha256]/route";
import { POST as mediaHas } from "../media/has/route";
import { GET as getThumb } from "../thumb/[sha256]/route";
import { PUT as upload } from "../uploads/[uploadId]/route";
import { ASSET_ID, SHA, assetView, crossSite, ctx, drain, page, unvouch, vouch } from "./support";

let dir: string;
let served: ServedFile;
const CONTENT = "0123456789";

beforeEach(() => {
  vouch();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-assets-"));
  const filePath = path.join(dir, "120000_cat_abababab.mp4");
  fs.writeFileSync(filePath, CONTENT);
  served = { path: filePath, mime: "video/mp4", bytes: CONTENT.length, sha256: SHA, filename: "Cat ☕.mp4" };
});

afterEach(() => {
  unvouch();
  vi.resetAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/assets/[id]/file", () => {
  const request = (query = "", headers: Record<string, string> = {}) =>
    page(`/api/assets/${ASSET_ID}/file${query}`, { headers });

  it("streams the file, revalidated by ETag and named for Save As", async () => {
    vi.mocked(facade.openAssetFile).mockResolvedValue(served);
    const response = await getFile(request(), ctx({ id: ASSET_ID }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
    expect(response.headers.get("etag")).toBe(`"${SHA}"`);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-disposition")).toMatch(/^inline; filename="Cat _.mp4"; filename\*=UTF-8''Cat%20%E2%98%95\.mp4$/);
    expect(facade.openAssetFile).toHaveBeenCalledWith(ASSET_ID);
  });

  it("?download=1 saves it as an attachment", async () => {
    vi.mocked(facade.openAssetFile).mockResolvedValue(served);
    const response = await getFile(request("?download=1"), ctx({ id: ASSET_ID }));
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; /);
    await response.arrayBuffer();
  });

  it("serves a range for video seeking", async () => {
    vi.mocked(facade.openAssetFile).mockResolvedValue(served);
    const response = await getFile(request("", { range: "bytes=2-4" }), ctx({ id: ASSET_ID }));
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("234");
    expect(response.headers.get("content-range")).toBe("bytes 2-4/10");
  });

  it("answers 304 to a current copy and 416 to a range past the end", async () => {
    vi.mocked(facade.openAssetFile).mockResolvedValue(served);
    expect((await getFile(request("", { "if-none-match": `"${SHA}"` }), ctx({ id: ASSET_ID }))).status).toBe(304);
    const past = await getFile(request("", { range: "bytes=50-" }), ctx({ id: ASSET_ID }));
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */10");
  });

  it("answers 404 for an unknown asset, and code missing when its file is gone", async () => {
    vi.mocked(facade.openAssetFile).mockResolvedValue(null);
    expect((await getFile(request(), ctx({ id: ASSET_ID }))).status).toBe(404);

    vi.mocked(facade.openAssetFile).mockResolvedValue({ ...served, path: path.join(dir, "moved-away.mp4") });
    const gone = await getFile(request(), ctx({ id: ASSET_ID }));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ code: "missing" });
  });

  it("refuses a bad id and a cross-site load", async () => {
    expect((await getFile(request(), ctx({ id: "../../x" }))).status).toBe(400);
    expect((await getFile(crossSite(`/api/assets/${ASSET_ID}/file`, "GET"), ctx({ id: ASSET_ID }))).status).toBe(403);
    expect(facade.openAssetFile).not.toHaveBeenCalled();
  });
});

describe("GET /api/assets/thumb/[sha256]", () => {
  const request = (query: string, headers: Record<string, string> = {}) =>
    page(`/api/assets/thumb/${SHA}${query}`, { headers });

  it("serves a thumbnail, cached for good", async () => {
    vi.mocked(facade.getThumbnail).mockResolvedValue({ ...served, mime: "image/webp" });
    const response = await getThumb(request("?w=320"), ctx({ sha256: SHA }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.text()).toBe(CONTENT);
    expect(facade.getThumbnail).toHaveBeenCalledWith(SHA, 320);
  });

  it("answers 204, not cached, when there is no thumbnail", async () => {
    vi.mocked(facade.getThumbnail).mockResolvedValue(null);
    const response = await getThumb(request("?w=640"), ctx({ sha256: SHA }));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(facade.getThumbnail).toHaveBeenCalledWith(SHA, 640);
  });

  it("refuses widths other than 320 and 640, and bad hashes", async () => {
    for (const query of ["", "?w=100", "?w=abc", "?w=1280"]) {
      expect((await getThumb(request(query), ctx({ sha256: SHA }))).status, query).toBe(400);
    }
    expect((await getThumb(request("?w=320"), ctx({ sha256: SHA.toUpperCase() }))).status).toBe(400);
    expect((await getThumb(request("?w=320"), ctx({ sha256: "abc" }))).status).toBe(400);
    expect(facade.getThumbnail).not.toHaveBeenCalled();
  });
});

describe("PUT /api/assets/uploads/[uploadId]", () => {
  it("hands the body to the library as an unread stream, with its content type", async () => {
    const result = { asset: assetView(), filename: "x.png", legacyId: "x", reusedFile: false };
    let received = "";
    vi.mocked(facade.completeUpload).mockImplementation(async (_id, body) => {
      expect(body.locked).toBe(false);
      received = await drain(body);
      return result;
    });
    const response = await upload(
      page("/api/assets/uploads/up_1", { method: "PUT", body: "raw bytes", headers: { "content-type": "image/png" } }),
      ctx({ uploadId: "up_1" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(received).toBe("raw bytes");
    expect(vi.mocked(facade.completeUpload).mock.calls[0][0]).toBe("up_1");
    expect(vi.mocked(facade.completeUpload).mock.calls[0][2]).toBe("image/png");
  });

  it("refuses a declared length over 2 GB before touching the library", async () => {
    const response = await upload(
      page("/api/assets/uploads/up_1", {
        method: "PUT",
        body: "x",
        headers: { "content-length": String(3 * 1024 * 1024 * 1024) },
      }),
      ctx({ uploadId: "up_1" }),
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe("The upload is over the 2 GB limit.");
    expect(facade.completeUpload).not.toHaveBeenCalled();
  });

  it("refuses a bad upload id and a missing body", async () => {
    expect((await upload(page("/api/assets/uploads/x", { method: "PUT", body: "x" }), ctx({ uploadId: "../x" }))).status).toBe(400);
    expect((await upload(page("/api/assets/uploads/up_1", { method: "PUT" }), ctx({ uploadId: "up_1" }))).status).toBe(400);
  });

  it("maps an expired ticket and a paused library", async () => {
    vi.mocked(facade.completeUpload).mockRejectedValueOnce(new LibraryError("That upload has expired.", 410, "expired"));
    const expired = await upload(page("/api/assets/uploads/up_1", { method: "PUT", body: "x" }), ctx({ uploadId: "up_1" }));
    expect(expired.status).toBe(410);
    vi.mocked(facade.completeUpload).mockRejectedValueOnce(new LibraryError("Moving.", 503, "paused"));
    const paused = await upload(page("/api/assets/uploads/up_1", { method: "PUT", body: "x" }), ctx({ uploadId: "up_1" }));
    expect(paused.status).toBe(503);
    expect(paused.headers.get("retry-after")).toBe("5");
  });
});

describe("PUT /api/assets/[id]/poster", () => {
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(16)]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const put = (body: BodyInit, type: string, headers: Record<string, string> = {}) =>
    page(`/api/assets/${ASSET_ID}/poster`, { method: "PUT", body, headers: { "content-type": type, ...headers } });

  it("stores a WebP poster", async () => {
    vi.mocked(facade.putPoster).mockResolvedValue();
    const response = await putPoster(put(webp, "image/webp"), ctx({ id: ASSET_ID }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const [id, bytes, mime] = vi.mocked(facade.putPoster).mock.calls[0];
    expect(id).toBe(ASSET_ID);
    expect(Buffer.from(bytes)).toEqual(webp);
    expect(mime).toBe("image/webp");
  });

  it("passes the type the bytes really are", async () => {
    vi.mocked(facade.putPoster).mockResolvedValue();
    await putPoster(put(png, "image/jpeg"), ctx({ id: ASSET_ID }));
    expect(vi.mocked(facade.putPoster).mock.calls[0][2]).toBe("image/png");
  });

  it("refuses other types with 415, non-images with 400 and over 5 MB with 413", async () => {
    expect((await putPoster(put(webp, "image/svg+xml"), ctx({ id: ASSET_ID }))).status).toBe(415);
    expect((await putPoster(put("<svg/>", "image/png"), ctx({ id: ASSET_ID }))).status).toBe(400);
    const big = Buffer.concat([webp, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await putPoster(put(big, "image/webp"), ctx({ id: ASSET_ID }))).status).toBe(413);
    expect(facade.putPoster).not.toHaveBeenCalled();
  });
});

describe("snapshot media", () => {
  it("POST /media/has answers the hashes the library lacks", async () => {
    vi.mocked(facade.mediaHas).mockResolvedValue([SHA]);
    const response = await mediaHas(page("/api/assets/media/has", { json: { hashes: [SHA, SHA] } }));
    expect(await response.json()).toEqual({ missing: [SHA] });
    expect(facade.mediaHas).toHaveBeenCalledWith([SHA]);
  });

  it("POST /media/has refuses bad hashes and more than 5,000", async () => {
    expect((await mediaHas(page("/api/assets/media/has", { json: { hashes: ["nope"] } }))).status).toBe(400);
    const many = Array.from({ length: 5001 }, () => SHA);
    expect((await mediaHas(page("/api/assets/media/has", { json: { hashes: many } }))).status).toBe(400);
  });

  it("PUT /media/[sha256] streams the body with the x-nb-mime type", async () => {
    let received = "";
    vi.mocked(facade.putMedia).mockImplementation(async (sha256, body) => {
      received = await drain(body);
      return { sha256, bytes: received.length };
    });
    const response = await putMedia(
      page(`/api/assets/media/${SHA}`, { method: "PUT", body: "media", headers: { "x-nb-mime": "Video/MP4" } }),
      ctx({ sha256: SHA }),
    );
    expect(await response.json()).toEqual({ sha256: SHA, bytes: 5 });
    expect(received).toBe("media");
    expect(vi.mocked(facade.putMedia).mock.calls[0][2]).toBe("video/mp4");
  });

  it("PUT /media/[sha256] defaults the type and refuses a malformed one", async () => {
    vi.mocked(facade.putMedia).mockResolvedValue({ sha256: SHA, bytes: 1 });
    await putMedia(page(`/api/assets/media/${SHA}`, { method: "PUT", body: "x" }), ctx({ sha256: SHA }));
    expect(vi.mocked(facade.putMedia).mock.calls[0][2]).toBe("application/octet-stream");
    const bad = await putMedia(
      page(`/api/assets/media/${SHA}`, { method: "PUT", body: "x", headers: { "x-nb-mime": "nope" } }),
      ctx({ sha256: SHA }),
    );
    expect(bad.status).toBe(400);
  });

  it("PUT /media/[sha256] maps a hash mismatch", async () => {
    vi.mocked(facade.putMedia).mockRejectedValue(new LibraryError("The bytes do not match their hash.", 422, "hash_mismatch"));
    const response = await putMedia(page(`/api/assets/media/${SHA}`, { method: "PUT", body: "x" }), ctx({ sha256: SHA }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "The bytes do not match their hash.", code: "hash_mismatch" });
  });

  it("GET /media/[sha256] serves the bytes, cached for good, or 404", async () => {
    vi.mocked(facade.openMedia).mockResolvedValueOnce(served);
    const response = await getMedia(page(`/api/assets/media/${SHA}`), ctx({ sha256: SHA }));
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(await response.text()).toBe(CONTENT);
    vi.mocked(facade.openMedia).mockResolvedValueOnce(null);
    expect((await getMedia(page(`/api/assets/media/${SHA}`), ctx({ sha256: SHA }))).status).toBe(404);
    expect((await getMedia(page(`/api/assets/media/x`), ctx({ sha256: "x" }))).status).toBe(400);
  });
});
