import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetPage, AssetView } from "@/lib/assets/types";
import { encodeAssetPageRequest } from "@/lib/assets/query";

const api = vi.hoisted(() => ({
  fetchAssetPage: vi.fn(),
  fetchFacets: vi.fn(),
  fetchLibraryStatus: vi.fn(),
  bulkAssets: vi.fn(),
  fetchJob: vi.fn(),
  cancelJob: vi.fn(),
}));
vi.mock("@/lib/assets/client/api", () => api);

import {
  DEFAULT_FILTERS,
  buildAssetQuery,
  bulkFavoriteOp,
  hiddenSelectionCount,
  matchesAssetQuery,
  selectionCount,
  useAssetStore,
} from "../assetStore";

const initial = useAssetStore.getState();
const T0 = new Date(2026, 8, 27, 14, 0).getTime();

function asset(id: string, overrides: Partial<AssetView> = {}): AssetView {
  return {
    v: 1,
    id,
    kind: "image",
    origin: "generated",
    mime: "image/png",
    ext: "png",
    bytes: 1000,
    sha256: id.padEnd(64, "0"),
    md5: "",
    file: { root: "library", rel: `Generations/${id}.png` },
    filename: `${id}.png`,
    width: 100,
    height: 100,
    createdAt: T0,
    producer: { nodeId: "n1", nodeType: "nanoBanana" },
    workflowId: "wf_1",
    workflowName: null,
    runId: "r1",
    tags: [],
    favorite: false,
    workflow: { id: "wf_1", name: null, projectPath: null },
    displayPath: `/lib/${id}.png`,
    ...overrides,
  };
}

function page(assets: AssetView[], overrides: Partial<AssetPage> = {}): AssetPage {
  return { assets, nextCursor: null, headCursor: assets[0] ? `head:${assets[0].id}` : null, total: assets.length, totalBytes: 0, ...overrides };
}

const ids = () => useAssetStore.getState().items.map((item) => item.id);

beforeEach(() => {
  vi.clearAllMocks();
  useAssetStore.setState(initial, true);
  api.fetchFacets.mockResolvedValue(null);
});

describe("filters", () => {
  it("turns the rail into request params: AND across groups, lists as repeated keys", () => {
    const query = buildAssetQuery(
      { ...DEFAULT_FILTERS, view: "favorites", q: "  cat ", kinds: ["image", "video"], tags: ["hero"], projects: [""], date: "7d" },
      "oldest",
      T0,
    );
    const midnight = new Date(2026, 8, 27).getTime();
    expect(query).toEqual({
      favorite: true,
      q: "cat",
      kinds: ["image", "video"],
      tags: ["hero"],
      projects: [""],
      from: midnight - 6 * 24 * 3600_000,
      sort: "oldest",
    });
    expect(encodeAssetPageRequest(query).toString()).toBe(
      `q=cat&kind=image&kind=video&tag=hero&project=&favorite=1&from=${midnight - 6 * 24 * 3600_000}&sort=oldest`,
    );
  });

  it("maps Trash and Missing to scopes", () => {
    expect(buildAssetQuery({ ...DEFAULT_FILTERS, view: "trash" }, "newest")).toEqual({ scope: "trash" });
    expect(buildAssetQuery({ ...DEFAULT_FILTERS, view: "missing" }, "newest")).toEqual({ scope: "missing" });
    expect(buildAssetQuery({ ...DEFAULT_FILTERS, date: "today" }, "newest", T0)).toEqual({ from: new Date(2026, 8, 27).getTime() });
  });

  it("requests the page for the current filters and refetches when they change", async () => {
    api.fetchAssetPage.mockResolvedValue(page([asset("a1")]));
    await useAssetStore.getState().refresh();
    expect(api.fetchAssetPage).toHaveBeenLastCalledWith({ limit: 200 }, expect.any(AbortSignal));

    useAssetStore.getState().toggleFilter("kinds", "video");
    await vi.waitFor(() => expect(api.fetchAssetPage).toHaveBeenCalledTimes(2));
    expect(api.fetchAssetPage).toHaveBeenLastCalledWith({ kinds: ["video"], limit: 200 }, expect.any(AbortSignal));
  });

  it("mirrors the server's matching for arrivals and hidden selections", () => {
    const cat = asset("a1", { prompt: "A cat", tags: ["hero"], workflow: { id: "wf_1", name: "Ads", projectPath: "/p/ads" } });
    expect(matchesAssetQuery(cat, { q: "CAT" })).toBe(true);
    expect(matchesAssetQuery(cat, { q: "ads" })).toBe(true);
    expect(matchesAssetQuery(cat, { tags: ["other", "hero"] })).toBe(true);
    expect(matchesAssetQuery(cat, { projects: [""] })).toBe(false);
    expect(matchesAssetQuery(cat, { projects: ["/p/ads"], kinds: ["video"] })).toBe(false);
    expect(matchesAssetQuery(cat, { scope: "trash" })).toBe(false);
    expect(matchesAssetQuery({ ...cat, trashedAt: 1 }, { scope: "trash" })).toBe(true);
    expect(matchesAssetQuery({ ...cat, trashedAt: 1 }, {})).toBe(false);
  });
});

describe("paging", () => {
  it("pages by cursor and drops duplicates by id", async () => {
    api.fetchAssetPage.mockResolvedValueOnce(page([asset("a3"), asset("a2")], { nextCursor: "c1", total: 4 }));
    await useAssetStore.getState().refresh();
    expect(ids()).toEqual(["a3", "a2"]);

    api.fetchAssetPage.mockResolvedValueOnce(page([asset("a2"), asset("a1"), asset("a0")], { nextCursor: null, total: 4 }));
    await useAssetStore.getState().loadMore();
    expect(api.fetchAssetPage).toHaveBeenLastCalledWith({ cursor: "c1", limit: 200 });
    expect(ids()).toEqual(["a3", "a2", "a1", "a0"]);
    expect(useAssetStore.getState().nextCursor).toBeNull();

    // Nothing more to fetch
    await useAssetStore.getState().loadMore();
    expect(api.fetchAssetPage).toHaveBeenCalledTimes(2);
  });

  it("drops a response for a query that has since changed", async () => {
    let resolveFirst!: (value: AssetPage) => void;
    api.fetchAssetPage.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    api.fetchAssetPage.mockResolvedValueOnce(page([asset("b1")]));
    const first = useAssetStore.getState().refresh();
    await useAssetStore.getState().refresh();
    resolveFirst(page([asset("stale")]));
    await first;
    expect(ids()).toEqual(["b1"]);
  });

  it("keeps at most the cap of full records, dropping far pages and refetching them by cursor", async () => {
    // 26 pages of 200: one page over the cap
    const pageOf = (n: number) => Array.from({ length: 200 }, (_, i) => asset(`a${String(n * 200 + i).padStart(5, "0")}`));
    api.fetchAssetPage.mockResolvedValueOnce(page(pageOf(0), { nextCursor: "c1", total: 5200 }));
    await useAssetStore.getState().refresh();
    for (let n = 1; n < 26; n++) {
      api.fetchAssetPage.mockResolvedValueOnce(page(pageOf(n), { nextCursor: n < 25 ? `c${n + 1}` : null, total: 5200 }));
      await useAssetStore.getState().loadMore();
    }
    expect(useAssetStore.getState().items).toHaveLength(5200);

    // Looking at the end: the first page gives up its records but keeps its slots
    useAssetStore.getState().trimLoaded(5100, 5199);
    const state = useAssetStore.getState();
    expect(state.items).toHaveLength(5200);
    expect(state.items.filter((item) => item.asset).length).toBe(5000);
    expect(state.items[0]!.asset).toBeNull();
    expect(state.items[200]!.asset).not.toBeNull();
    expect(state.pages[0]!.loaded).toBe(false);

    api.fetchAssetPage.mockResolvedValueOnce(page(pageOf(0)));
    await useAssetStore.getState().ensurePage(0);
    expect(api.fetchAssetPage).toHaveBeenLastCalledWith({ cursor: undefined, limit: 200 });
    expect(useAssetStore.getState().items[0]!.asset?.id).toBe("a00000");

    // A middle page is refetched by the cursor that first fetched it
    useAssetStore.getState().trimLoaded(0, 100);
    const dropped = useAssetStore.getState().pages.findIndex((slot) => !slot.loaded);
    expect(dropped).toBe(25);
    api.fetchAssetPage.mockResolvedValueOnce(page(pageOf(25)));
    await useAssetStore.getState().ensurePage(25);
    expect(api.fetchAssetPage).toHaveBeenLastCalledWith({ cursor: "c25", limit: 200 });
  });
});

describe("new arrivals", () => {
  beforeEach(async () => {
    api.fetchAssetPage.mockResolvedValueOnce(page([asset("a2", { createdAt: T0 + 2 }), asset("a1", { createdAt: T0 + 1 })], { headCursor: "h2" }));
    await useAssetStore.getState().refresh();
  });

  it("go straight in at the top when the grid is scrolled to the top", async () => {
    api.fetchAssetPage.mockResolvedValueOnce(page([asset("a3", { createdAt: T0 + 3 })], { headCursor: "h3" }));
    await useAssetStore.getState().pollArrivals();
    expect(api.fetchAssetPage).toHaveBeenLastCalledWith({ newerThan: "h2", limit: 200 });
    expect(ids()).toEqual(["a3", "a2", "a1"]);
    expect(useAssetStore.getState().headCursor).toBe("h3");
    expect(useAssetStore.getState().total).toBe(3);
  });

  it("wait behind the pill while the user is scrolled down, then go in on request", async () => {
    useAssetStore.getState().setScroll(800, false);
    api.fetchAssetPage.mockResolvedValueOnce(page([asset("a3", { createdAt: T0 + 3 })], { headCursor: "h3" }));
    await useAssetStore.getState().pollArrivals();
    expect(ids()).toEqual(["a2", "a1"]);
    expect(useAssetStore.getState().arrivals.map((a) => a.id)).toEqual(["a3"]);

    const before = useAssetStore.getState().scrollToTopSeq;
    useAssetStore.getState().showArrivals();
    expect(ids()).toEqual(["a3", "a2", "a1"]);
    expect(useAssetStore.getState().scrollToTopSeq).toBe(before + 1);
  });

  it("take recorder results only when they match the current query, once", () => {
    useAssetStore.getState().receiveArrivals([asset("v1", { kind: "video", createdAt: T0 + 5, trashedAt: 3 })]);
    expect(ids()).toEqual(["a2", "a1"]);
    useAssetStore.getState().receiveArrivals([asset("a3", { createdAt: T0 + 3 }), asset("a2")]);
    useAssetStore.getState().receiveArrivals([asset("a3", { createdAt: T0 + 3 })]);
    expect(ids()).toEqual(["a3", "a2", "a1"]);
  });
});

describe("selection", () => {
  beforeEach(async () => {
    api.fetchAssetPage.mockResolvedValueOnce(
      page([asset("a4", { kind: "video" }), asset("a3"), asset("a2", { favorite: true }), asset("a1")], { total: 10, nextCursor: "c1" }),
    );
    await useAssetStore.getState().refresh();
  });

  it("toggles, and selects ranges in sort order from the anchor", () => {
    const store = useAssetStore.getState();
    store.toggleSelect("a3");
    store.selectRange("a1");
    expect(useAssetStore.getState().selection).toEqual({ mode: "ids", ids: ["a3", "a2", "a1"] });
    useAssetStore.getState().toggleSelect("a2");
    expect(selectionCount(useAssetStore.getState())).toBe(2);
  });

  it("selects every loaded tile, then everything matching as a query with exclusions", () => {
    useAssetStore.getState().selectAllLoaded();
    expect(selectionCount(useAssetStore.getState())).toBe(4);
    expect(useAssetStore.getState().selectAllOffer).toBe(true);

    useAssetStore.getState().selectAllMatching();
    expect(useAssetStore.getState().selection).toEqual({ mode: "query", query: {}, excludeIds: [] });
    expect(selectionCount(useAssetStore.getState())).toBe(10);
    useAssetStore.getState().toggleSelect("a4");
    expect(useAssetStore.getState().selection).toEqual({ mode: "query", query: {}, excludeIds: ["a4"] });
    expect(selectionCount(useAssetStore.getState())).toBe(9);
  });

  it("keeps an ids selection through a filter change and counts what the filters hide", async () => {
    useAssetStore.getState().toggleSelect("a4");
    useAssetStore.getState().toggleSelect("a3");
    api.fetchAssetPage.mockResolvedValueOnce(page([asset("a3")]));
    useAssetStore.getState().setFilters({ kinds: ["image"] });
    await vi.waitFor(() => expect(ids()).toEqual(["a3"]));
    expect(selectionCount(useAssetStore.getState())).toBe(2);
    expect(hiddenSelectionCount(useAssetStore.getState())).toBe(1);
  });

  it("drops a select-all-matching when the query changes", async () => {
    useAssetStore.getState().selectAllMatching();
    api.fetchAssetPage.mockResolvedValueOnce(page([]));
    useAssetStore.getState().setFilters({ kinds: ["audio"] });
    await vi.waitFor(() => expect(useAssetStore.getState().status).toBe("ready"));
    expect(useAssetStore.getState().selection).toEqual({ mode: "ids", ids: [] });
  });

  it("favorites in bulk unless every selected asset already is one", () => {
    useAssetStore.getState().toggleSelect("a2");
    expect(bulkFavoriteOp(useAssetStore.getState())).toEqual({ action: "unfavorite" });
    useAssetStore.getState().toggleSelect("a1");
    expect(bulkFavoriteOp(useAssetStore.getState())).toEqual({ action: "favorite" });
  });
});

describe("asset actions and undo", () => {
  beforeEach(async () => {
    api.fetchAssetPage.mockResolvedValueOnce(page([asset("a3", { createdAt: T0 + 3 }), asset("a2", { createdAt: T0 + 2, tags: ["hero"] }), asset("a1", { createdAt: T0 + 1 })]));
    await useAssetStore.getState().refresh();
  });

  it("trashes the selection, then Undo restores it to its place", async () => {
    useAssetStore.getState().toggleSelect("a2");
    const selection = useAssetStore.getState().selection;
    api.bulkAssets.mockResolvedValueOnce({ affected: 1, ids: ["a2"], errors: [] });
    await useAssetStore.getState().runBulk(selection, { action: "trash" });
    expect(api.bulkAssets).toHaveBeenLastCalledWith({ selection: { mode: "ids", ids: ["a2"] }, op: { action: "trash" } });
    expect(ids()).toEqual(["a3", "a1"]);
    expect(selectionCount(useAssetStore.getState())).toBe(0);
    expect(useAssetStore.getState().notice).toMatchObject({ message: "Moved 1 asset to Trash", undo: true });

    api.bulkAssets.mockResolvedValueOnce({ affected: 1, ids: ["a2"], errors: [] });
    await useAssetStore.getState().undo();
    expect(api.bulkAssets).toHaveBeenLastCalledWith({ selection: { mode: "ids", ids: ["a2"] }, op: { action: "restore" } });
    expect(ids()).toEqual(["a3", "a2", "a1"]);
    expect(useAssetStore.getState().undoStack).toHaveLength(0);
  });

  it("undoes a tag only on the assets that did not have it", async () => {
    api.bulkAssets.mockResolvedValueOnce({ affected: 2, ids: ["a2", "a1"], errors: [] });
    await useAssetStore.getState().runBulk({ mode: "ids", ids: ["a2", "a1"] }, { action: "tag", tags: ["hero"] });
    expect(useAssetStore.getState().items.find((item) => item.id === "a1")!.asset!.tags).toEqual(["hero"]);

    api.bulkAssets.mockResolvedValueOnce({ affected: 1, ids: ["a1"], errors: [] });
    await useAssetStore.getState().undo();
    expect(api.bulkAssets).toHaveBeenLastCalledWith({ selection: { mode: "ids", ids: ["a1"] }, op: { action: "untag", tags: ["hero"] } });
    expect(useAssetStore.getState().items.find((item) => item.id === "a1")!.asset!.tags).toEqual([]);
    expect(useAssetStore.getState().items.find((item) => item.id === "a2")!.asset!.tags).toEqual(["hero"]);
  });

  it("does not offer Undo for a permanent delete", async () => {
    api.bulkAssets.mockResolvedValueOnce({ affected: 1, ids: ["a1"], errors: [] });
    await useAssetStore.getState().runBulk({ mode: "ids", ids: ["a1"] }, { action: "delete" });
    expect(useAssetStore.getState().undoStack).toHaveLength(0);
    expect(useAssetStore.getState().notice).toMatchObject({ message: "Deleted 1 asset", undo: false });
  });

  it("moves the open detail on to the next asset when its asset is trashed", async () => {
    useAssetStore.getState().openDetail("a2");
    api.bulkAssets.mockResolvedValueOnce({ affected: 1, ids: ["a2"], errors: [] });
    await useAssetStore.getState().runBulk({ mode: "ids", ids: ["a2"] }, { action: "trash" });
    expect(useAssetStore.getState().detailId).toBe("a1");
  });

  it("reports a failed action and keeps the grid as it was", async () => {
    api.bulkAssets.mockRejectedValueOnce(new Error("The library is busy"));
    await useAssetStore.getState().runBulk({ mode: "ids", ids: ["a1"] }, { action: "trash" });
    expect(ids()).toEqual(["a3", "a2", "a1"]);
    expect(useAssetStore.getState().notice).toMatchObject({ message: "The library is busy", tone: "error" });
  });
});

describe("app view", () => {
  it("toggles between canvas and assets", () => {
    expect(useAssetStore.getState().appView).toBe("canvas");
    useAssetStore.getState().toggleAppView();
    expect(useAssetStore.getState().appView).toBe("assets");
    useAssetStore.getState().setAppView("canvas");
    expect(useAssetStore.getState().appView).toBe("canvas");
  });

  it("remembers the tile size per viewer", () => {
    useAssetStore.getState().setTileSize("l");
    expect(window.localStorage.getItem("node-banana-assets-tile-size")).toBe("l");
  });
});
