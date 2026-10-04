import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CATALOG_DIR_ENV, CATALOG_FRESH_MS, catalogRefreshInFlight, getProviderCatalog, resetCatalog } from "../catalog";
import type { ProviderModel } from "../types";

const model = (id: string): ProviderModel => ({ id, name: id, description: null, provider: "replicate", capabilities: ["text-to-image"] });

let dir: string;

describe("model catalog", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-catalog-"));
    process.env[CATALOG_DIR_ENV] = dir;
    resetCatalog();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    resetCatalog();
    delete process.env[CATALOG_DIR_ENV];
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("waits for the first fetch, then serves it from memory and from disk", async () => {
    const fetcher = vi.fn(async () => [model("a/one")]);
    const first = await getProviderCatalog("replicate", fetcher, { timeoutMs: 1000 });
    expect(first).toMatchObject({ models: [model("a/one")], cached: false, stale: false, refreshing: false });
    expect(first.fetchedAt).toEqual(expect.any(Number));

    const second = await getProviderCatalog("replicate", fetcher, { timeoutMs: 1000 });
    expect(second).toMatchObject({ cached: true, stale: false, refreshing: false, fetchedAt: first.fetchedAt });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // The file is written behind the response; a new process reads it
    await vi.waitFor(() => expect(fs.existsSync(path.join(dir, "replicate.json"))).toBe(true));
    resetCatalog();
    const fromDisk = await getProviderCatalog("replicate", fetcher, { timeoutMs: 1000 });
    expect(fromDisk).toMatchObject({ models: [model("a/one")], cached: true, fetchedAt: first.fetchedAt });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves a stale list straight away and refreshes it behind the request", async () => {
    let release: (models: ProviderModel[]) => void = () => {};
    const fetcher = vi
      .fn<(signal: AbortSignal) => Promise<ProviderModel[]>>()
      .mockResolvedValueOnce([model("a/old")])
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const then = Date.now();
    await getProviderCatalog("fal", fetcher, { timeoutMs: 1000, now: then });

    const later = then + CATALOG_FRESH_MS + 1;
    const served = await getProviderCatalog("fal", fetcher, { timeoutMs: 1000, now: later });
    expect(served).toMatchObject({ models: [model("a/old")], cached: true, stale: true, refreshing: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    // A third caller joins the refresh rather than starting another
    await getProviderCatalog("fal", fetcher, { timeoutMs: 1000, now: later });
    expect(fetcher).toHaveBeenCalledTimes(2);

    release([model("a/new")]);
    await catalogRefreshInFlight("fal");
    const fresh = await getProviderCatalog("fal", fetcher, { timeoutMs: 1000 });
    expect(fresh).toMatchObject({ models: [model("a/new")], cached: true, stale: false, refreshing: false });
  });

  it("refresh waits for a new fetch even with a fresh list stored", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce([model("a/one")]).mockResolvedValueOnce([model("a/two")]);
    await getProviderCatalog("wavespeed", fetcher, { timeoutMs: 1000 });
    const refreshed = await getProviderCatalog("wavespeed", fetcher, { timeoutMs: 1000, refresh: true });
    expect(refreshed).toMatchObject({ models: [model("a/two")], cached: false });
  });

  it("keeps the previous list when a refresh fails, and says why", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce([model("a/one")]).mockRejectedValue(new Error("Replicate API error: 401"));
    await getProviderCatalog("replicate", fetcher, { timeoutMs: 1000 });
    const kept = await getProviderCatalog("replicate", fetcher, { timeoutMs: 1000, refresh: true });
    expect(kept).toMatchObject({ models: [model("a/one")], cached: true, stale: true, error: "Replicate API error: 401" });
    // The error stays beside the list until a fetch succeeds
    const again = await getProviderCatalog("replicate", fetcher, { timeoutMs: 1000 });
    expect(again.error).toBe("Replicate API error: 401");
  });

  it("throws when there is nothing stored and the fetch fails, or outlives its deadline", async () => {
    await expect(getProviderCatalog("replicate", async () => { throw new Error("boom"); }, { timeoutMs: 1000 })).rejects.toThrow("boom");
    let seen: AbortSignal | undefined;
    await expect(
      getProviderCatalog("fal", (signal) => { seen = signal; return new Promise(() => {}); }, { timeoutMs: 20 }),
    ).rejects.toThrow("timed out after 0.02s");
    expect(seen?.aborted).toBe(true);
  });

  it("ignores a stored file it cannot read", async () => {
    fs.writeFileSync(path.join(dir, "replicate.json"), "not json");
    const fetcher = vi.fn(async () => [model("a/one")]);
    const result = await getProviderCatalog("replicate", fetcher, { timeoutMs: 1000 });
    expect(result).toMatchObject({ models: [model("a/one")], cached: false });
  });
});
