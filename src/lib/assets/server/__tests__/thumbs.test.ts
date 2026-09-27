// @vitest-environment node
import fs from "fs";
import path from "path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RecordAssetMeta, RecordAssetResult } from "../../types";
import {
  __assetLibraryForTests,
  __drainAssetLibraryForTests,
  __resetAssetLibraryForTests,
  beginRecord,
  completeUpload,
  getAsset,
  getThumbnail,
  putPoster,
  startCleanup,
} from "../index";
import { loadSharp, Thumbnailer } from "../thumbs";
import { makePng, meta, streamOf, tempDir, TINY_MP4 } from "./helpers";

let hasSharp = false;

beforeAll(async () => {
  hasSharp = (await loadSharp()) !== null;
});

let base: string;
let root: string;
let thumbsDir: string;

beforeEach(async () => {
  base = tempDir();
  root = path.join(base, "Library");
  thumbsDir = path.join(root, ".nodebanana", "cache", "thumbs");
  process.env.NODE_BANANA_ASSET_LIBRARY = root;
  await __resetAssetLibraryForTests();
});

afterEach(async () => {
  await __resetAssetLibraryForTests();
  delete process.env.NODE_BANANA_ASSET_LIBRARY;
  fs.rmSync(base, { recursive: true, force: true });
});

async function record(buffer: Buffer, overrides: Partial<RecordAssetMeta> = {}): Promise<RecordAssetResult> {
  const started = await beginRecord({ meta: meta(overrides), source: { type: "upload" } });
  if ("result" in started) return started.result;
  return completeUpload(started.ticket.uploadId, streamOf(buffer), null);
}

async function waitForJob(id: string) {
  const { getJob } = await import("../index");
  await __drainAssetLibraryForTests();
  return getJob(id);
}

describe("thumbnails", () => {
  it("renders 320 and 640 webp at record time, keyed by content", async () => {
    if (!hasSharp) return;
    const sharp = (await loadSharp())!;
    const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#336699" } }).png().toBuffer();
    const result = await record(photo);
    await __drainAssetLibraryForTests();
    const files = fs.readdirSync(thumbsDir).sort();
    expect(files).toEqual([`${result.asset.sha256}-320.webp`, `${result.asset.sha256}-640.webp`]);
    const small = await sharp(fs.readFileSync(path.join(thumbsDir, files[0]))).metadata();
    expect(small).toMatchObject({ format: "webp", width: 320, height: 213 });

    const served = await getThumbnail(result.asset.sha256, 640);
    expect(served).toMatchObject({ mime: "image/webp", sha256: `${result.asset.sha256}-640` });
  });

  it("renders a miss on demand and never upscales", async () => {
    if (!hasSharp) return;
    const result = await record(makePng(50, 20));
    await __drainAssetLibraryForTests();
    fs.rmSync(thumbsDir, { recursive: true, force: true });
    const served = await getThumbnail(result.asset.sha256, 320);
    expect(served).not.toBeNull();
    const sharp = (await loadSharp())!;
    expect(await sharp(fs.readFileSync(served!.path)).metadata()).toMatchObject({ width: 50, height: 20 });
  });

  it("answers null for unknown hashes, bad widths and undecodable files", async () => {
    expect(await getThumbnail("0".repeat(64), 320)).toBeNull();
    expect(await getThumbnail("../x", 320)).toBeNull();
    const video = await record(TINY_MP4, { kind: "video" });
    expect(await getThumbnail(video.asset.sha256, 320)).toBeNull();
    expect(await getThumbnail(video.asset.sha256, 500 as 320)).toBeNull();
  });

  it("stores a browser-made poster for a video and derives thumbnails from it", async () => {
    if (!hasSharp) return;
    const video = await record(TINY_MP4, { kind: "video" });
    const sharp = (await loadSharp())!;
    const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#aa0000" } }).jpeg().toBuffer();
    await putPoster(video.asset.id, jpeg, "image/jpeg");
    const poster = path.join(root, ".nodebanana", "posters", `${video.asset.sha256}.webp`);
    expect((await sharp(fs.readFileSync(poster)).metadata()).format).toBe("webp");
    expect((await getAsset(video.asset.id))?.hasPoster).toBe(true);
    expect(await getThumbnail(video.asset.sha256, 320)).toMatchObject({ mime: "image/webp" });

    const image = await record(makePng());
    await expect(putPoster(image.asset.id, jpeg, "image/jpeg")).rejects.toMatchObject({ status: 400 });
    await expect(putPoster(video.asset.id, Buffer.from("not an image"), "image/webp")).rejects.toMatchObject({ status: 415 });
  });

  it("empties the cache on request", async () => {
    if (!hasSharp) return;
    await record(makePng(30, 30));
    await __drainAssetLibraryForTests();
    expect(fs.readdirSync(thumbsDir)).toHaveLength(2);
    const job = await startCleanup({ thumbnails: true });
    expect((await waitForJob(job.id))?.state).toBe("done");
    expect(fs.readdirSync(thumbsDir)).toEqual([]);
  });
});

describe("cache trim", () => {
  it("evicts least recently used thumbnails above the budget", async () => {
    const cache = path.join(base, "cache");
    const library = await __assetLibraryForTests();
    const thumbs = new Thumbnailer(cache, () => library);
    fs.mkdirSync(thumbs.dir, { recursive: true });
    const now = Date.now() / 1000;
    for (let i = 0; i < 10; i++) {
      const file = path.join(thumbs.dir, `${String(i).repeat(64).slice(0, 64)}-320.webp`);
      fs.writeFileSync(file, Buffer.alloc(100));
      fs.utimesSync(file, now - (10 - i) * 1000, now);
    }
    expect(await thumbs.trim(1000, 600)).toBe(0);
    expect(await thumbs.trim(900, 600)).toBe(4);
    const left = fs.readdirSync(thumbs.dir).map((name) => name[0]).sort();
    expect(left).toEqual(["4", "5", "6", "7", "8", "9"]);
  });
});
