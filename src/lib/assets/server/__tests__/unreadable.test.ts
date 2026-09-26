// @vitest-environment node
/**
 * Files no decoder can read are kept but never shown.
 *
 * The damaged files are the ones older save routes wrote: a data URL with an
 * empty (or octet-stream) media type was base64-decoded whole, header
 * included, so every byte after it was shifted. They are made here exactly
 * that way.
 */
import fs from "fs";
import path from "path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AssetKind, AssetRecord, LibraryJobStatus, RecordAssetMeta, RecordAssetResult } from "../../types";
import {
  __assetLibraryForTests,
  __drainAssetLibraryForTests,
  __resetAssetLibraryForTests,
  assetExistence,
  beginRecord,
  bulkAssets,
  completeUpload,
  getAsset,
  getFacets,
  getJob,
  getLibraryStatus,
  getThumbnail,
  listAssets,
  patchAsset,
  startImport,
} from "../index";
import { AssetLibrary } from "../library";
import { assessReadable, findUnreadable, isUnreadableFile } from "../readable";
import { isDecodeError, loadSharp } from "../thumbs";
import { fakeRecord, installBridge, makePng, makeWav, md5, meta, sha256, streamOf, tempDir, TINY_MP4 } from "./helpers";

/** A file as the old save routes wrote it: the whole data URL decoded as base64. */
function damage(bytes: Buffer, mime = ""): Buffer {
  return Buffer.from(`data:${mime};base64,` + bytes.toString("base64"), "base64");
}

const png = makePng(8, 6, 3);
const damagedPng = damage(png);
const damagedOctetPng = damage(png, "application/octet-stream");
const damagedMp4 = damage(TINY_MP4);
const damagedWav = damage(makeWav());

/** Small valid files of every format the library keeps, whose sizes the pure-JS readers find. */
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x04, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);
const gif = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.from([4, 0, 3, 0, 0, 0, 0]), Buffer.from(";", "latin1")]);
const webp = (() => {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "latin1");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBPVP8X", 8, "latin1");
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(3, 24, 3);
  buffer.writeUIntLE(2, 27, 3);
  return buffer;
})();
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3"/></svg>');
const glb = Buffer.concat([Buffer.from("glTF", "latin1"), Buffer.from([2, 0, 0, 0, 12, 0, 0, 0])]);

let hasSharp = false;
beforeAll(async () => {
  hasSharp = (await loadSharp()) !== null;
});

let base: string;
let root: string;
let bridge: ReturnType<typeof installBridge>;

beforeEach(async () => {
  base = tempDir();
  root = path.join(base, "Library");
  process.env.NODE_BANANA_ASSET_LIBRARY = root;
  bridge = installBridge(path.join(base, "OS Trash"));
  await __resetAssetLibraryForTests();
});

afterEach(async () => {
  await __resetAssetLibraryForTests();
  bridge.remove();
  delete process.env.NODE_BANANA_ASSET_LIBRARY;
  fs.rmSync(base, { recursive: true, force: true });
});

function write(name: string, bytes: Buffer): string {
  const file = path.join(base, "files", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

async function record(buffer: Buffer, overrides: Partial<RecordAssetMeta> = {}, contentType: string | null = "image/png"): Promise<RecordAssetResult> {
  const started = await beginRecord({ meta: meta(overrides), source: { type: "upload" } });
  if ("result" in started) return started.result;
  return completeUpload(started.ticket.uploadId, streamOf(buffer), contentType);
}

/** A record of a project file, as an older build or an import would have left it (no size, no duration). */
function projectRecord(file: string, kind: AssetKind, ext: string, mime: string, overrides: Partial<AssetRecord> = {}): AssetRecord {
  const bytes = fs.readFileSync(file);
  return fakeRecord({
    kind,
    mime,
    ext,
    bytes: bytes.length,
    sha256: sha256(bytes),
    md5: md5(bytes),
    file: { root: "external", path: file },
    filename: path.basename(file),
    imported: true,
    ...overrides,
  });
}

const listedIds = async (scope?: "library" | "trash" | "missing") => (await listAssets(scope ? { scope } : {})).assets.map((asset) => asset.id);

async function finished(job: LibraryJobStatus): Promise<LibraryJobStatus> {
  await __drainAssetLibraryForTests();
  return getJob(job.id)!;
}

describe("assessReadable", () => {
  it("never calls a valid PNG, JPEG, WebP, GIF, SVG, MP4, WAV or GLB unreadable", async () => {
    const cases: [string, Buffer, AssetKind][] = [
      ["a.png", png, "image"],
      ["a.jpg", jpeg, "image"],
      ["a.webp", webp, "image"],
      ["a.gif", gif, "image"],
      ["a.svg", svg, "image"],
      ["a.mp4", TINY_MP4, "video"],
      ["a.m4a", TINY_MP4, "audio"],
      ["a.wav", makeWav(), "audio"],
      ["a.glb", glb, "3d"],
    ];
    for (const [name, bytes, kind] of cases) {
      expect([name, await assessReadable(write(name, bytes), kind)]).toEqual([name, "readable"]);
    }
  });

  it("never calls sharp-made JPEG, WebP and GIF unreadable", async () => {
    if (!hasSharp) return;
    const sharp = (await loadSharp())!;
    const image = () => sharp({ create: { width: 30, height: 20, channels: 3, background: "#227744" } });
    for (const [name, bytes] of [
      ["s.jpg", await image().jpeg().toBuffer()],
      ["s.webp", await image().webp().toBuffer()],
      ["s.gif", await image().gif().toBuffer()],
      ["s.png", await image().png().toBuffer()],
    ] as const) {
      expect([name, await assessReadable(write(name, bytes), "image")]).toEqual([name, "readable"]);
    }
  });

  it("calls a PNG decoded together with its data: header unreadable", async () => {
    if (!hasSharp) return;
    expect(await assessReadable(write("d1.png", damagedPng), "image")).toBe("unreadable");
    expect(await assessReadable(write("d2.png", damagedOctetPng), "image")).toBe("unreadable");
  });

  it("calls video and audio decoded together with their data: header unreadable", async () => {
    expect(await assessReadable(write("d.mp4", damagedMp4), "video")).toBe("unreadable");
    expect(await assessReadable(write("d.wav", damagedWav), "audio")).toBe("unreadable");
  });

  it("answers unknown, never unreadable, when it can't be sure", async () => {
    // Not there (or offline): can't tell.
    expect(await assessReadable(path.join(base, "nowhere.png"), "image")).toBe("unknown");
    // A format the first bytes name, even one it can't measure or doesn't keep.
    const heic = Buffer.alloc(32);
    heic.writeUInt32BE(24, 0);
    heic.write("ftypheic", 4, "latin1");
    expect(await assessReadable(write("h.heic", heic), "image")).not.toBe("unreadable");
    const bmp = Buffer.concat([Buffer.from("BM", "latin1"), Buffer.alloc(60)]);
    expect(await assessReadable(write("b.png", bmp), "image")).not.toBe("unreadable");
    // 3D is never judged.
    expect(await assessReadable(write("m.glb", damagedPng), "3d")).toBe("readable");
    // An empty file is nothing at all.
    expect(await assessReadable(write("e.png", Buffer.alloc(0)), "image")).toBe("unreadable");
  });
});

describe("isUnreadableFile", () => {
  it("takes what measuring already proved, and looks further only without it", async () => {
    const file = write("m.wav", damagedWav);
    // A probe that found a duration, or first bytes that named a container: no further look.
    expect(await isUnreadableFile(file, { kind: "audio", sniffed: false }, { durationSec: 2 })).toBe(false);
    expect(await isUnreadableFile(file, { kind: "audio", sniffed: true }, {})).toBe(false);
    expect(await isUnreadableFile(file, { kind: "3d", sniffed: false }, {})).toBe(false);
    expect(await isUnreadableFile(file, { kind: "audio", sniffed: false }, {})).toBe(true);
    expect(await isUnreadableFile(write("m.png", png), { kind: "image", sniffed: true }, {})).toBe(false);
  });
});

describe("isDecodeError", () => {
  it("is the decoder refusing the bytes, not the file system, memory or time", () => {
    expect(isDecodeError(new Error("Input buffer contains unsupported image format"))).toBe(true);
    expect(isDecodeError(Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }))).toBe(false);
    expect(isDecodeError(Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" }))).toBe(false);
    expect(isDecodeError(new Error("timeout: 10% complete"))).toBe(false);
    expect(isDecodeError(new Error("Timed out"))).toBe(false);
    expect(isDecodeError(new Error("out of memory"))).toBe(false);
    expect(isDecodeError("not an error")).toBe(false);
  });
});

describe("live recordings", () => {
  it("keep an unreadable file and its record, but never list it", async () => {
    if (!hasSharp) return;
    const good = await record(makePng(4, 4, 1));
    const { headCursor } = await listAssets({});
    const bad = await record(damagedPng, { createdAt: Date.now() + 1000 });

    // Nothing is lost: the bytes are on disk as they came, with a record.
    expect(bad.asset.unreadable).toBe(true);
    expect(fs.readFileSync(bad.asset.displayPath).equals(damagedPng)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(root, ".nodebanana", "assets", `${bad.asset.id}.json`), "utf8"))).toMatchObject({
      unreadable: true,
    });
    expect(good.asset.unreadable).toBeUndefined();

    // Not listed, in any scope, nor as a new arrival.
    expect(await listedIds()).toEqual([good.asset.id]);
    expect((await listAssets({ newerThan: headCursor! })).assets).toEqual([]);
    await patchAsset(bad.asset.id, { trashed: true });
    expect(await listedIds("trash")).toEqual([]);
    await patchAsset(bad.asset.id, { trashed: false });

    // Not counted.
    const facets = await getFacets();
    expect(facets).toMatchObject({ total: 1, trash: 0, kinds: { image: 1 } });
    expect((await getLibraryStatus()).counts).toEqual({ assets: 1, trashed: 0, bytes: good.asset.bytes });

    // Not caught up in "select all".
    const bulk = await bulkAssets({ selection: { mode: "query", query: {}, excludeIds: [] }, op: { action: "favorite" } });
    expect(bulk.ids).toEqual([good.asset.id]);

    // Whoever holds its id still gets it.
    expect((await getAsset(bad.asset.id))?.unreadable).toBe(true);
    expect(await assetExistence([bad.asset.id])).toEqual({ [bad.asset.id]: "present" });
    // And no thumbnail is attempted for it.
    expect(await getThumbnail(bad.asset.sha256, 320)).toBeNull();
  });

  it("keep and hide unreadable video and audio (declared with no type, or octet-stream)", async () => {
    const video = await record(damagedMp4, { kind: "video" }, null);
    const audio = await record(damagedWav, { kind: "audio" }, "application/octet-stream");
    expect(video.asset.unreadable).toBe(true);
    expect(audio.asset.unreadable).toBe(true);
    expect(fs.readFileSync(video.asset.displayPath).equals(damagedMp4)).toBe(true);
    expect(await listedIds()).toEqual([]);
  });

  it("never mark valid PNG, JPEG, WebP, GIF, SVG, MP4, WAV or GLB", async () => {
    const results = [
      await record(png),
      await record(jpeg, {}, "image/jpeg"),
      await record(webp, {}, "image/webp"),
      await record(gif, {}, "image/gif"),
      await record(svg, {}, "image/svg+xml"),
      await record(TINY_MP4, { kind: "video" }, "video/mp4"),
      await record(makeWav(), { kind: "audio" }, "audio/wav"),
      await record(glb, { kind: "3d" }, "model/gltf-binary"),
    ];
    expect(results.map((result) => result.asset.unreadable)).toEqual(results.map(() => undefined));
    expect((await listAssets({})).total).toBe(results.length);
  });
});

describe("importing project folders", () => {
  it("skips unreadable files, leaves them untouched, and says how many", async () => {
    const project = path.join(base, "Old project");
    const generations = path.join(project, "generations");
    fs.mkdirSync(generations, { recursive: true });
    const put = (name: string, bytes: Buffer) => {
      fs.writeFileSync(path.join(generations, name), bytes);
      return path.join(generations, name);
    };
    put("good_1.png", png);
    put("good_2.mp4", TINY_MP4);
    const damaged = [put("bad_1.png", damagedPng), put("bad_2.png", damagedOctetPng), put("bad_3.wav", damagedWav)];

    const job = await finished(await startImport({ projectDirs: [project] }));
    const skipped = hasSharp ? 3 : 1;
    expect(job).toMatchObject({ state: "done", total: 5, done: 5 });
    expect(job.message).toBe(`Imported ${5 - skipped} files. ${skipped} unreadable ${skipped === 1 ? "file" : "files"} skipped.`);
    const page = await listAssets({});
    expect(page.assets.map((asset) => asset.filename).sort()).toEqual(
      hasSharp ? ["good_1.png", "good_2.mp4"] : ["bad_1.png", "bad_2.png", "good_1.png", "good_2.mp4"],
    );
    const library = await __assetLibraryForTests();
    expect(library.recordsAtPath(damaged[2])).toEqual([]);
    expect(fs.readFileSync(damaged[0]).equals(damagedPng)).toBe(true);
    expect(fs.readFileSync(damaged[2]).equals(damagedWav)).toBe(true);
  });
});

describe("records already in the library", () => {
  it("are looked at when the index loads, and the unreadable ones marked and hidden", async () => {
    const files = {
      badPng: write("p/generations/bad_png.png", damagedPng),
      badOctet: write("p/generations/bad_octet.png", damagedOctetPng),
      goodPng: write("p/generations/good.png", png),
      badMp4: write("p/generations/bad.mp4", damagedMp4),
      goodMp4: write("p/generations/good.mp4", TINY_MP4),
      badWav: write("p/generations/bad.wav", damagedWav),
      goodWav: write("p/generations/good.wav", makeWav()),
    };
    const records = {
      badPng: projectRecord(files.badPng, "image", "png", "image/png"),
      // The same bytes with a size the client sent: they share the verdict.
      badPngSized: projectRecord(files.badPng, "image", "png", "image/png", { width: 8, height: 6, imported: undefined }),
      badOctet: projectRecord(files.badOctet, "image", "png", "image/png"),
      goodPng: projectRecord(files.goodPng, "image", "png", "image/png"),
      badMp4: projectRecord(files.badMp4, "video", "mp4", "video/mp4"),
      goodMp4: projectRecord(files.goodMp4, "video", "mp4", "video/mp4"),
      badWav: projectRecord(files.badWav, "audio", "wav", "audio/wav"),
      goodWav: projectRecord(files.goodWav, "audio", "wav", "audio/wav"),
    };
    const first = await __assetLibraryForTests();
    for (const value of Object.values(records)) await first.addRecord(value);
    expect((await listAssets({})).total).toBe(8);

    // The next start (a new process) looks, off the request path.
    await __resetAssetLibraryForTests();
    await listAssets({});
    await __drainAssetLibraryForTests();

    const expectedHidden = hasSharp
      ? ["badPng", "badPngSized", "badOctet", "badMp4", "badWav"]
      : ["badMp4", "badWav"];
    const listed = new Set(await listedIds());
    for (const [name, value] of Object.entries(records)) {
      expect([name, listed.has(value.id)]).toEqual([name, !expectedHidden.includes(name)]);
      const sidecar = JSON.parse(fs.readFileSync(path.join(root, ".nodebanana", "assets", `${value.id}.json`), "utf8"));
      expect([name, sidecar.unreadable === true]).toEqual([name, expectedHidden.includes(name)]);
    }
    // Journalled like any other change, so another process sees it.
    const journal = fs.readFileSync(path.join(root, ".nodebanana", "journal.ndjson"), "utf8");
    for (const name of expectedHidden) expect(journal).toContain(`"op":"put","id":"${records[name as keyof typeof records].id}"`);
    // The files themselves are never touched.
    expect(fs.readFileSync(files.badPng).equals(damagedPng)).toBe(true);
    expect(fs.readFileSync(files.badMp4).equals(damagedMp4)).toBe(true);
    expect((await getLibraryStatus()).counts.assets).toBe(8 - expectedHidden.length);
  });

  it("finds only what is unreadable, and another process's index picks up the mark", async () => {
    const bad = projectRecord(write("q/bad.mp4", damagedMp4), "video", "mp4", "video/mp4");
    const good = projectRecord(write("q/good.png", png), "image", "png", "image/png");
    const missing = projectRecord(write("q/gone.mp4", damagedMp4), "video", "mp4", "video/mp4", {
      file: { root: "external", path: path.join(base, "q", "elsewhere.mp4") },
    });
    const library = await __assetLibraryForTests();
    for (const value of [bad, good, missing]) await library.addRecord(value);
    const other = new AssetLibrary(root);
    await other.ready();

    // The missing file's bytes can't be looked at: never guessed. Its twin (same bytes, same kind) is marked.
    const found = await findUnreadable(library);
    expect(found.sort()).toEqual([bad.id, missing.id].sort());
    expect(await library.markUnreadable([bad.id])).toEqual([bad.id]);
    expect(await library.markUnreadable([bad.id])).toEqual([bad.id]);

    const page = await other.query({});
    expect(page.assets.map((asset) => asset.id).sort()).toEqual([good.id, missing.id].sort());
    expect(other.get(bad.id)?.unreadable).toBe(true);
  });
});

describe("thumbnails", () => {
  it("mark an image unreadable when its file can't be decoded", async () => {
    if (!hasSharp) return;
    // A size on record, so the load-time look passes it by; its bytes are noise all the same.
    const file = write("t/sized.png", damagedOctetPng);
    const sized = projectRecord(file, "image", "png", "image/png", { width: 8, height: 6 });
    const library = await __assetLibraryForTests();
    await library.addRecord(sized);
    expect(await listedIds()).toEqual([sized.id]);

    expect(await getThumbnail(sized.sha256, 320)).toBeNull();
    await __drainAssetLibraryForTests();
    expect((await getAsset(sized.id))?.unreadable).toBe(true);
    expect(await listedIds()).toEqual([]);
    expect(fs.readFileSync(file).equals(damagedOctetPng)).toBe(true);
  });

  it("do not mark an image whose file is missing, nor a valid one", async () => {
    if (!hasSharp) return;
    const gone = projectRecord(write("t/gone.png", damagedPng), "image", "png", "image/png", {
      width: 8,
      height: 6,
      file: { root: "external", path: path.join(base, "t", "not-there.png") },
    });
    const good = projectRecord(write("t/good.png", makePng(12, 9, 5)), "image", "png", "image/png", { width: 12, height: 9 });
    const library = await __assetLibraryForTests();
    await library.addRecord(gone);
    await library.addRecord(good);

    expect(await getThumbnail(gone.sha256, 320)).toBeNull();
    expect(await getThumbnail(good.sha256, 320)).not.toBeNull();
    await __drainAssetLibraryForTests();
    expect((await getAsset(gone.id))?.unreadable).toBeUndefined();
    expect((await getAsset(good.id))?.unreadable).toBeUndefined();
  });
});
