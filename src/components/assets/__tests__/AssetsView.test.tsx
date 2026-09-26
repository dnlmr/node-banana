import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AssetFacets, AssetPage, AssetView, LibraryStatus } from "@/lib/assets/types";

const api = vi.hoisted(() => ({
  fetchAssetPage: vi.fn(),
  fetchFacets: vi.fn(),
  fetchLibraryStatus: vi.fn(),
  bulkAssets: vi.fn(),
  revealAsset: vi.fn(),
  revealLibraryRoot: vi.fn(),
  fetchAssetBlob: vi.fn(),
  startExport: vi.fn(),
  startImport: vi.fn(),
  fetchJob: vi.fn(),
  cancelJob: vi.fn(),
  assetFileUrl: (id: string, download = false) => `/api/assets/${id}/file${download ? "?download=1" : ""}`,
  assetThumbUrl: (sha: string, width: number) => `/api/assets/thumb/${sha}?w=${width}`,
}));
vi.mock("@/lib/assets/client/api", () => api);

const recorder = vi.hoisted(() => ({ listener: null as ((result: unknown) => void) | null }));
vi.mock("@/lib/assets/client/recorder", () => ({
  getRecorderLibraryStatus: () => null,
  onAssetRecorded: (listener: (result: unknown) => void) => {
    recorder.listener = listener;
    return () => {
      recorder.listener = null;
    };
  },
  onLibraryStatus: () => () => {},
}));

const openWorkflow = vi.hoisted(() => ({
  openAssetWorkflow: vi.fn(),
  openWorkflowBlockedReason: vi.fn(),
}));
vi.mock("@/lib/assets/client/openWorkflow", () => openWorkflow);

import { AssetsView } from "../AssetsView";
import { useAssetStore } from "@/store/assetStore";
import { useWorkflowStore } from "@/store/workflowStore";

const initial = useAssetStore.getState();
const T0 = new Date(2026, 8, 27, 14, 2).getTime();

function asset(id: string, overrides: Partial<AssetView> = {}): AssetView {
  return {
    v: 1,
    id,
    kind: "image",
    origin: "generated",
    mime: "image/png",
    ext: "png",
    bytes: 2_400_000,
    sha256: id.padEnd(64, "0"),
    md5: "",
    file: { root: "library", rel: `Generations/2026-09-27/${id}.png` },
    filename: `${id}.png`,
    width: 1024,
    height: 768,
    createdAt: T0,
    prompt: `A cat called ${id}`,
    model: { provider: "gemini", modelId: "nano-banana-pro", displayName: "Nano Banana Pro" },
    producer: { nodeId: "n1", nodeType: "nanoBanana" },
    workflowId: "wf_1",
    workflowName: null,
    runId: "r1",
    tags: [],
    favorite: false,
    workflow: { id: "wf_1", name: null, projectPath: null },
    displayPath: `/Users/me/Pictures/Node Banana/Generations/2026-09-27/${id}.png`,
    ...overrides,
  };
}

function page(assets: AssetView[], overrides: Partial<AssetPage> = {}): AssetPage {
  return { assets, nextCursor: null, headCursor: assets[0] ? "h" : null, total: assets.length, totalBytes: 0, ...overrides };
}

const facets = (overrides: Partial<AssetFacets> = {}): AssetFacets => ({
  total: 3,
  favorites: 0,
  trash: 0,
  missing: 0,
  kinds: { image: 3, video: 0, audio: 0, "3d": 0 },
  origins: { generated: 3, edited: 0 },
  models: [],
  tags: [],
  workflows: [],
  projects: [],
  ...overrides,
});

const library = (overrides: Partial<LibraryStatus> = {}): LibraryStatus => ({
  available: true,
  root: "/Users/me/Pictures/Node Banana",
  source: "default",
  defaultRoot: "/Users/me/Pictures/Node Banana",
  cacheDir: "/Users/me/Library/Caches/Node Banana",
  platform: "darwin",
  synced: null,
  counts: { assets: 3, trashed: 0, bytes: 0 },
  empty: false,
  job: null,
  ...overrides,
});

const tile = (id: string) => document.querySelector<HTMLElement>(`[data-asset-tile="${id}"]`)!;

async function renderView(assets: AssetView[] = [asset("a3"), asset("a2"), asset("a1")]) {
  api.fetchAssetPage.mockResolvedValue(page(assets));
  const view = render(<AssetsView />);
  if (assets.length) await waitFor(() => expect(tile(assets[0]!.id)).toBeInTheDocument());
  else await waitFor(() => expect(screen.getByTestId("assets-empty")).toBeInTheDocument());
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAssetStore.setState({ ...initial, appView: "assets" }, true);
  api.fetchFacets.mockResolvedValue(facets());
  api.fetchLibraryStatus.mockResolvedValue(library());
  openWorkflow.openWorkflowBlockedReason.mockReturnValue(null);
  openWorkflow.openAssetWorkflow.mockResolvedValue({ ok: true, tabId: "tab-2", nodeId: "n1" });
});

afterEach(() => {
  useAssetStore.setState(initial, true);
});

describe("AssetsView", () => {
  it("renders a tile per asset of the first page, under a day header, with the count", async () => {
    await renderView();
    expect(api.fetchAssetPage).toHaveBeenCalledWith({ limit: 200 }, expect.any(AbortSignal));
    expect(screen.getByRole("button", { name: "A cat called a3" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-asset-tile]")).toHaveLength(3);
    expect(screen.getByText("3 assets")).toBeInTheDocument();
    // Thumbnails come from the server's cache, never the original file
    expect(tile("a3").querySelector("img")!.getAttribute("src")).toMatch(/^\/api\/assets\/thumb\/a3/);
  });

  it("opens the context menu on right-click, and Open workflow opens it and goes back to the canvas", async () => {
    await renderView();
    fireEvent.contextMenu(tile("a2"), { clientX: 200, clientY: 200 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Show in Finder/ })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Open workflow/ }));
    await waitFor(() => expect(openWorkflow.openAssetWorkflow).toHaveBeenCalledWith(expect.objectContaining({ id: "a2" }), "snapshot"));
    await waitFor(() => expect(useAssetStore.getState().appView).toBe("canvas"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("says why Open workflow is unavailable instead of failing after the click", async () => {
    openWorkflow.openWorkflowBlockedReason.mockReturnValue("Available when the run finishes");
    await renderView();
    fireEvent.contextMenu(tile("a2"), { clientX: 10, clientY: 10 });
    const item = within(screen.getByRole("menu")).getByRole("menuitem", { name: /Open workflow/ });
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent("Available when the run finishes");
  });

  it("shows the bulk bar for a selection, and bulk Trash sends that selection", async () => {
    await renderView();
    fireEvent.click(tile("a3"), { metaKey: true });
    fireEvent.click(tile("a1"), { metaKey: true });
    const bar = screen.getByRole("toolbar", { name: "Selected assets" });
    expect(bar).toHaveTextContent("2 selected");

    api.bulkAssets.mockResolvedValueOnce({ affected: 2, ids: ["a3", "a1"], errors: [] });
    fireEvent.click(within(bar).getByRole("button", { name: "Trash" }));
    await waitFor(() =>
      expect(api.bulkAssets).toHaveBeenCalledWith({ selection: { mode: "ids", ids: ["a3", "a1"] }, op: { action: "trash" } }),
    );
    await waitFor(() => expect(document.querySelectorAll("[data-asset-tile]")).toHaveLength(1));
    expect(screen.getByRole("status")).toHaveTextContent("Moved 2 assets to Trash");
    expect(screen.queryByRole("toolbar", { name: "Selected assets" })).not.toBeInTheDocument();
  });

  it("selects a range in sort order with Shift-click", async () => {
    await renderView();
    fireEvent.click(tile("a3"), { metaKey: true });
    fireEvent.click(tile("a1"), { shiftKey: true });
    expect(useAssetStore.getState().selection).toEqual({ mode: "ids", ids: ["a3", "a2", "a1"] });
  });

  it("opens the detail with its metadata, and Open workflow opens it and switches to the canvas", async () => {
    await renderView();
    fireEvent.click(tile("a2"));
    const panel = screen.getByRole("complementary", { name: "Asset details" });
    expect(within(panel).getByText("Image · Generated · 27 Sep 2026")).toBeInTheDocument();
    expect(within(panel).getByText("27 Sep 2026, 14:02")).toBeInTheDocument();
    expect(within(panel).getByText("Nano Banana Pro")).toBeInTheDocument();
    expect(within(panel).getByText("1024 × 768")).toBeInTheDocument();
    expect(within(panel).getByText("2.4 MB")).toBeInTheDocument();
    expect(within(panel).getByText("Untitled · 27 Sep 14:02")).toBeInTheDocument();
    expect(within(panel).getByText("Not in a project")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Open workflow" }));
    await waitFor(() => expect(openWorkflow.openAssetWorkflow).toHaveBeenCalledWith(expect.objectContaining({ id: "a2" }), "snapshot"));
    await waitFor(() => expect(useAssetStore.getState().appView).toBe("canvas"));
  });

  it("offers a project asset its project, and the copy as it was when made", async () => {
    await renderView([asset("a1", { workflow: { id: "wf_1", name: "Cat ads", projectPath: "/p/Cat ads" }, file: { root: "external", path: "/p/Cat ads/generations/x.png" } })]);
    fireEvent.click(tile("a1"));
    const panel = screen.getByRole("complementary", { name: "Asset details" });
    expect(within(panel).getByRole("button", { name: "Open project" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Open as it was when made" })).toBeInTheDocument();
    expect(within(panel).getByText("Opens a copy; your project isn't changed.")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Open as it was when made" }));
    await waitFor(() => expect(openWorkflow.openAssetWorkflow).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }), "snapshot"));
  });

  it("keeps the view and says why when a workflow cannot be opened", async () => {
    openWorkflow.openAssetWorkflow.mockResolvedValueOnce({ ok: false, reason: "No snapshot of this run was saved" });
    await renderView();
    fireEvent.click(tile("a2"));
    fireEvent.click(screen.getByRole("button", { name: "Open workflow" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No snapshot of this run was saved"));
    expect(useAssetStore.getState().appView).toBe("assets");
  });

  it("flags a missing file in the detail with Remove from library", async () => {
    await renderView([asset("a1", { missing: true })]);
    fireEvent.click(tile("a1"));
    expect(screen.getByText(/File not found at \/Users\/me\/Pictures/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove from library" }));
    expect(useAssetStore.getState().confirm).toMatchObject({ kind: "remove", count: 1 });
  });

  it("steps through the detail with the arrow keys and closes it, then the selection, then the view, with Escape", async () => {
    await renderView();
    fireEvent.click(tile("a3"));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(useAssetStore.getState().detailId).toBe("a2"));
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() => expect(useAssetStore.getState().detailId).toBe("a3"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useAssetStore.getState().detailId).toBeNull();
    fireEvent.click(tile("a2"), { metaKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useAssetStore.getState().selection).toEqual({ mode: "ids", ids: [] });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useAssetStore.getState().appView).toBe("canvas");
  });

  it("keeps its keys from the canvas: they stop at the view's capture handler", async () => {
    await renderView();
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    try {
      fireEvent.keyDown(window, { key: "a", metaKey: true });
      fireEvent.keyDown(window, { key: "Delete" });
      expect(behind).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", behind);
    }
    expect(useAssetStore.getState().selection).toEqual({ mode: "ids", ids: ["a3", "a2", "a1"] });
  });

  it("trashes with Delete and undoes with Cmd+Z", async () => {
    await renderView();
    fireEvent.click(tile("a2"), { metaKey: true });
    api.bulkAssets.mockResolvedValueOnce({ affected: 1, ids: ["a2"], errors: [] });
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(document.querySelectorAll("[data-asset-tile]")).toHaveLength(2));

    api.bulkAssets.mockResolvedValueOnce({ affected: 1, ids: ["a2"], errors: [] });
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await waitFor(() => expect(api.bulkAssets).toHaveBeenLastCalledWith({ selection: { mode: "ids", ids: ["a2"] }, op: { action: "restore" } }));
    await waitFor(() => expect(document.querySelectorAll("[data-asset-tile]")).toHaveLength(3));
  });

  it("offers to select everything matching after Cmd+A", async () => {
    // The grid asks for the next page at once (the first is shorter than the window): make it slow
    api.fetchAssetPage.mockImplementation((request: { cursor?: string }) =>
      request.cursor ? new Promise(() => {}) : Promise.resolve(page([asset("a3"), asset("a2")], { total: 40, nextCursor: "c1" })),
    );
    render(<AssetsView />);
    await waitFor(() => expect(tile("a3")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Select all 40 matching" }));
    expect(useAssetStore.getState().selection).toEqual({ mode: "query", query: {}, excludeIds: [] });
    expect(screen.getByRole("toolbar", { name: "Selected assets" })).toHaveTextContent("40 selected");
  });

  it("acts on the whole selection from the menu of a selected tile", async () => {
    await renderView();
    fireEvent.click(tile("a3"), { metaKey: true });
    fireEvent.click(tile("a2"), { metaKey: true });
    fireEvent.contextMenu(tile("a2"), { clientX: 10, clientY: 10 });
    const menu = screen.getByRole("menu", { name: "2 assets selected" });
    api.bulkAssets.mockResolvedValueOnce({ affected: 2, ids: ["a3", "a2"], errors: [] });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Favorite" }));
    await waitFor(() =>
      expect(api.bulkAssets).toHaveBeenCalledWith({ selection: { mode: "ids", ids: ["a3", "a2"] }, op: { action: "favorite" } }),
    );
  });

  it("stops asking for more when a page brings nothing new", async () => {
    api.fetchAssetPage.mockResolvedValue(page([asset("a3"), asset("a2")], { total: 40, nextCursor: "c1" }));
    render(<AssetsView />);
    await waitFor(() => expect(tile("a3")).toBeInTheDocument());
    await waitFor(() => expect(useAssetStore.getState().nextCursor).toBeNull());
    expect(api.fetchAssetPage).toHaveBeenCalledTimes(2);
  });

  it("prepends a recorded asset that matches while scrolled to the top", async () => {
    await renderView();
    act(() => recorder.listener?.({ asset: asset("a4", { createdAt: T0 + 1000 }), filename: "a4.png", legacyId: "a4", reusedFile: false }));
    await waitFor(() => expect(tile("a4")).toBeInTheDocument());
    expect(useAssetStore.getState().items[0]!.id).toBe("a4");
  });

  describe("empty states", () => {
    it("explains a fresh library, where it saves, and the way back", async () => {
      api.fetchFacets.mockResolvedValue(facets({ total: 0 }));
      await renderView([]);
      const empty = screen.getByTestId("assets-empty");
      await waitFor(() => expect(within(empty).getByText("/Users/me/Pictures/Node Banana")).toBeInTheDocument());
      expect(within(empty).getByText("Nothing saved yet")).toBeInTheDocument();
      // The rail's foot says the same, with Show and Change…
      expect(screen.getByRole("button", { name: "Change…" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show in Finder" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Back to canvas" }));
      expect(useAssetStore.getState().appView).toBe("canvas");
    });

    it("offers to import the generations of projects saved before the library", async () => {
      window.localStorage.setItem(
        "node-banana-workflow-configs",
        JSON.stringify({ wf_1: { workflowId: "wf_1", name: "Cat ads", directoryPath: "/p/cat", generationsPath: null, lastSavedAt: null } }),
      );
      try {
        await renderView([]);
        api.startImport.mockResolvedValueOnce({ id: "j1", type: "import", state: "running", done: 0, total: 5, bytesDone: 0, bytesTotal: 0, startedAt: 1 });
        fireEvent.click(screen.getByRole("button", { name: "Import generations from your 1 project" }));
        await waitFor(() => expect(api.startImport).toHaveBeenCalledWith({ projectDirs: ["/p/cat"] }));
      } finally {
        window.localStorage.removeItem("node-banana-workflow-configs");
      }
    });

    it("says nothing matches, with Clear filters", async () => {
      useAssetStore.setState({ filters: { ...initial.filters, kinds: ["video"] } });
      await renderView([]);
      expect(screen.getByText("No assets match")).toBeInTheDocument();
      api.fetchAssetPage.mockResolvedValue(page([asset("a1")]));
      fireEvent.click(within(screen.getByTestId("assets-empty")).getByRole("button", { name: "Clear filters" }));
      await waitFor(() => expect(tile("a1")).toBeInTheDocument());
    });

    it("says how long the Trash keeps things", async () => {
      useAssetStore.setState({ filters: { ...initial.filters, view: "trash" } });
      await renderView([]);
      expect(api.fetchAssetPage).toHaveBeenCalledWith({ scope: "trash", limit: 200 }, expect.any(AbortSignal));
      expect(screen.getByText("Items in Trash are deleted after 30 days.")).toBeInTheDocument();
    });

    it("explains an unavailable library", async () => {
      api.fetchLibraryStatus.mockResolvedValue(library({ available: false, reason: "This server is read-only." }));
      await renderView([]);
      await waitFor(() => expect(screen.getAllByText("This server is read-only.").length).toBeGreaterThan(0));
      expect(screen.getByText("The asset library is not available")).toBeInTheDocument();
    });
  });

  it("asks before deleting from the Trash, naming project files as kept", async () => {
    useAssetStore.setState({ filters: { ...initial.filters, view: "trash" } });
    await renderView([asset("a1", { trashedAt: 1, file: { root: "external", path: "/p/x.png" } })]);
    fireEvent.click(tile("a1"), { metaKey: true });
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Selected assets" })).getByRole("button", { name: "Delete permanently…" }));
    const dialog = screen.getByRole("dialog", { name: "Delete 1 asset permanently?" });
    expect(within(dialog).getByText(/Also delete the 1 file in project folders/)).toBeInTheDocument();
    api.bulkAssets.mockResolvedValueOnce({ affected: 1, ids: ["a1"], errors: [] });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() =>
      expect(api.bulkAssets).toHaveBeenCalledWith({
        selection: { mode: "ids", ids: ["a1"] },
        op: { action: "delete", deleteProjectFiles: false },
      }),
    );
  });

  it("opens the shortcuts from ? and hands the keyboard to a dialog above it", async () => {
    await renderView();
    fireEvent.keyDown(window, { key: "?" });
    expect(useWorkflowStore.getState().shortcutsDialogOpen).toBe(true);
    useWorkflowStore.setState({ shortcutsDialogOpen: false });
  });
});
