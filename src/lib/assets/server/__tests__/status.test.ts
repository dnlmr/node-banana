// @vitest-environment node
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAssetLibraryForTests, beginRecord, completeUpload, getLibraryStatus } from "../index";
import { AssetLibrary } from "../library";
import { installBridge, makePng, meta, streamOf, tempDir } from "./helpers";

let base: string;
let bridge: ReturnType<typeof installBridge>;

beforeEach(async () => {
  base = tempDir();
  process.env.NODE_BANANA_ASSET_LIBRARY = path.join(base, "Library");
  bridge = installBridge(path.join(base, "OS Trash"));
  await __resetAssetLibraryForTests();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await __resetAssetLibraryForTests();
  bridge.remove();
  delete process.env.NODE_BANANA_ASSET_LIBRARY;
  fs.rmSync(base, { recursive: true, force: true });
});

async function record(): Promise<void> {
  const started = await beginRecord({ meta: meta(), source: { type: "upload" } });
  if ("result" in started) return;
  await completeUpload(started.ticket.uploadId, streamOf(makePng(4, 4, 7)), null);
}

describe("getLibraryStatus counts", () => {
  it("are marked provisional while the first scan outlasts the request", async () => {
    await record();
    await __resetAssetLibraryForTests();

    // Hold the scan back past the status request's wait
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scan = AssetLibrary.prototype.ensureLoaded;
    vi.spyOn(AssetLibrary.prototype, "ensureLoaded").mockImplementation(function (this: AssetLibrary) {
      return held.then(() => scan.call(this));
    });

    let status;
    try {
      status = await getLibraryStatus();
    } finally {
      // Let the scan go whatever happened, or the library never drains
      release();
    }
    expect(status.available).toBe(true);
    expect(status.counting).toBe(true);
    expect(status.counts).toEqual({ assets: 0, trashed: 0, bytes: 0 });
    expect(status.empty).toBe(false);

    const counted = await getLibraryStatus();
    expect(counted.counting).toBeUndefined();
    expect(counted.counts.assets).toBe(1);
  }, 10_000);

  it("carry no such mark once the library is loaded", async () => {
    await record();
    const status = await getLibraryStatus();
    expect(status.counting).toBeUndefined();
    expect(status.counts.assets).toBe(1);
  });
});
