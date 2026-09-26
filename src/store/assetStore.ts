import { create } from "zustand";
import * as api from "@/lib/assets/client/api";
import { sameQuery } from "@/lib/assets/query";
import type {
  AssetBulkOp,
  AssetBulkRequest,
  AssetBulkResult,
  AssetFacets,
  AssetKind,
  AssetOrigin,
  AssetQuery,
  AssetSelection,
  AssetSort,
  AssetView,
  LibraryJobStatus,
  LibraryStatus,
} from "@/lib/assets/types";

/**
 * The Assets view: which view the app shows (canvas or assets), and
 * everything the assets browser holds while it is open — the query, the
 * loaded pages, facets, the selection, the open detail and the undo stack
 * of asset actions.
 *
 * App-wide, not per tab: it is never part of a tab snapshot (SNAPSHOT_KEYS)
 * and never written into a workflow file.
 *
 * Paging is keyset (`cursor` from the previous page) and results are kept
 * in sort order, deduplicated by id. At most MAX_LOADED_ASSETS full records
 * are held: pages far from the viewport drop their records (keeping the
 * layout facts) and are fetched again by their cursor when scrolled back to.
 */

export type AppView = "canvas" | "assets";
/** The rail's Library group. Favorites is a view of the live library, not a tag. */
export type AssetLibraryView = "all" | "favorites" | "missing" | "trash";
export type AssetDatePreset = "any" | "today" | "7d" | "30d";
export type AssetTileSize = "s" | "m" | "l";

export const TILE_SIZE_KEY = "node-banana-assets-tile-size";
export const PAGE_SIZE = 200;
export const MAX_LOADED_ASSETS = 5000;
/** New arrivals are polled this often while the view is open. */
export const ARRIVALS_POLL_MS = 5000;
const UNDO_LIMIT = 20;
const FACETS_DEBOUNCE_MS = 400;
const SEARCH_DEBOUNCE_MS = 200;
const JOB_POLL_MS = 1000;

export interface AssetFilters {
  view: AssetLibraryView;
  q: string;
  kinds: AssetKind[];
  origins: AssetOrigin[];
  /** Project folders; "" is "Not in a project". */
  projects: string[];
  workflowIds: string[];
  models: string[];
  tags: string[];
  date: AssetDatePreset;
}

export type AssetFilterList = "kinds" | "origins" | "projects" | "workflowIds" | "models" | "tags";

export const DEFAULT_FILTERS: AssetFilters = {
  view: "all",
  q: "",
  kinds: [],
  origins: [],
  projects: [],
  workflowIds: [],
  models: [],
  tags: [],
  date: "any",
};

/** One grid slot: the layout facts always, the full record while its page is loaded. */
export interface AssetGridItem {
  id: string;
  createdAt: number;
  kind: AssetKind;
  width?: number;
  height?: number;
  /** Null while its page is dropped to keep memory bounded. */
  asset: AssetView | null;
  /** The page it came from; -1 for new arrivals, which are never dropped. */
  page: number;
}

interface PageSlot {
  /** The cursor that fetched this page (null for the first). */
  cursor: string | null;
  loaded: boolean;
}

/** What Undo replays, and what it puts back on screen. */
interface UndoEntry {
  label: string;
  steps: AssetBulkRequest[];
  /** Records the action took off the grid; Undo puts back the ones that still match. */
  removed: AssetView[];
  /** Tags and favorite as they were, for records the action changed. */
  before: Record<string, Pick<AssetView, "tags" | "favorite">>;
}

export interface AssetNotice {
  id: number;
  message: string;
  tone: "info" | "error";
  /** Offer Undo for the last asset action. */
  undo?: boolean;
  action?: { label: string; run: () => void };
  /** Stays until replaced or dismissed. */
  sticky?: boolean;
}

/**
 * The one popover open over the view. A menu on a selected tile acts on the
 * whole selection (`useSelection`), on any other tile on that tile alone.
 */
export type AssetPopover =
  | { kind: "menu"; x: number; y: number; anchorId: string; useSelection: boolean }
  | {
      kind: "tags";
      x: number;
      y: number;
      selection: AssetSelection;
      /** Hang above `y` (from the bulk bar) rather than below it. */
      above?: boolean;
    }
  | null;

export type AssetConfirm =
  | {
      kind: "delete" | "remove";
      selection: AssetSelection;
      count: number;
      /** How many sit in project folders; null when the selection reaches past what is loaded. */
      projectCount: number | null;
    }
  | null;

export type AssetLoadStatus = "idle" | "loading" | "ready" | "error";

interface AssetStoreState {
  appView: AppView;
  filters: AssetFilters;
  sort: AssetSort;
  tileSize: AssetTileSize;
  /** Select mode: a click toggles selection instead of opening the detail. */
  selectMode: boolean;

  items: AssetGridItem[];
  /** Bumped whenever items change other than by appending (the grid re-lays out from the top). */
  layoutVersion: number;
  pages: PageSlot[];
  nextCursor: string | null;
  headCursor: string | null;
  total: number;
  totalBytes: number;
  status: AssetLoadStatus;
  error: string | null;
  loadingMore: boolean;
  /** The query the loaded items answer. */
  loadedQuery: AssetQuery | null;

  /** Arrived while the grid was scrolled down; shown by the "N new" pill. */
  arrivals: AssetView[];
  atTop: boolean;
  scrollTop: number;
  /** Bumped to ask the grid to scroll to the top. */
  scrollToTopSeq: number;

  facets: AssetFacets | null;
  library: LibraryStatus | null;
  job: LibraryJobStatus | null;

  selection: AssetSelection;
  /** Records of the selected assets (ids mode), for bulk rules and the hidden-by-filters count. */
  selectedRecords: Record<string, AssetView>;
  /** Total of the query when "Select all N matching" was chosen. */
  selectionTotal: number;
  /** Cmd+A selected every loaded tile: offer "Select all N matching". */
  selectAllOffer: boolean;
  anchorId: string | null;
  focusedId: string | null;
  detailId: string | null;
  detailAsset: AssetView | null;
  popover: AssetPopover;
  confirm: AssetConfirm;
  notice: AssetNotice | null;
  undoStack: UndoEntry[];

  setAppView: (view: AppView) => void;
  toggleAppView: () => void;

  setFilters: (patch: Partial<AssetFilters>) => void;
  setSearch: (q: string) => void;
  setLibraryView: (view: AssetLibraryView) => void;
  toggleFilter: (list: AssetFilterList, value: string) => void;
  clearFilterList: (list: AssetFilterList) => void;
  clearFilters: () => void;
  setSort: (sort: AssetSort) => void;
  setTileSize: (size: AssetTileSize) => void;
  setSelectMode: (on: boolean) => void;

  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  ensurePage: (page: number) => Promise<void>;
  trimLoaded: (visibleFrom: number, visibleTo: number) => void;
  pollArrivals: () => Promise<void>;
  receiveArrivals: (assets: AssetView[]) => void;
  showArrivals: () => void;
  setScroll: (scrollTop: number, atTop: boolean) => void;

  refreshFacets: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  setLibrary: (status: LibraryStatus | null) => void;
  trackJob: (job: LibraryJobStatus, doneMessage?: (job: LibraryJobStatus) => string) => void;
  cancelJob: () => Promise<void>;

  toggleSelect: (id: string) => void;
  selectRange: (id: string) => void;
  setSelected: (ids: string[], selected: boolean) => void;
  selectAllLoaded: () => void;
  selectAllMatching: () => void;
  clearSelection: () => void;
  setFocused: (id: string | null) => void;

  openDetail: (id: string) => void;
  closeDetail: () => void;
  stepDetail: (delta: number) => Promise<void>;

  openPopover: (popover: AssetPopover) => void;
  closePopover: () => void;
  requestConfirm: (confirm: AssetConfirm) => void;
  closeConfirm: () => void;
  showNotice: (notice: Omit<AssetNotice, "id">) => void;
  dismissNotice: () => void;

  runBulk: (selection: AssetSelection, op: AssetBulkOp) => Promise<AssetBulkResult | null>;
  undo: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The rail's filters as an AssetQuery. Date presets start at local
 * midnight, so the query stays the same all day (polling compares queries).
 */
export function buildAssetQuery(filters: AssetFilters, sort: AssetSort, now: number = Date.now()): AssetQuery {
  const query: AssetQuery = {};
  if (filters.view === "trash") query.scope = "trash";
  else if (filters.view === "missing") query.scope = "missing";
  else if (filters.view === "favorites") query.favorite = true;
  const q = filters.q.trim();
  if (q) query.q = q;
  if (filters.kinds.length) query.kinds = [...filters.kinds];
  if (filters.origins.length) query.origins = [...filters.origins];
  if (filters.projects.length) query.projects = [...filters.projects];
  if (filters.workflowIds.length) query.workflowIds = [...filters.workflowIds];
  if (filters.models.length) query.models = [...filters.models];
  if (filters.tags.length) query.tags = [...filters.tags];
  if (filters.date !== "any") {
    const today = startOfLocalDay(now);
    query.from = filters.date === "today" ? today : today - (filters.date === "7d" ? 6 : 29) * DAY_MS;
  }
  if (sort !== "newest") query.sort = sort;
  return query;
}

/** Any filter beyond the Library view. */
export function hasActiveFilters(filters: AssetFilters): boolean {
  return (
    filters.q.trim() !== "" ||
    filters.kinds.length > 0 ||
    filters.origins.length > 0 ||
    filters.projects.length > 0 ||
    filters.workflowIds.length > 0 ||
    filters.models.length > 0 ||
    filters.tags.length > 0 ||
    filters.date !== "any"
  );
}

/** Client-side mirror of the server's filter semantics (AND across groups, OR within). */
export function matchesAssetQuery(asset: AssetView, query: AssetQuery): boolean {
  const scope = query.scope ?? "library";
  if (scope === "trash" ? !asset.trashedAt : !!asset.trashedAt) return false;
  if (scope === "missing" && !asset.missing) return false;
  if (query.favorite !== undefined && asset.favorite !== query.favorite) return false;
  if (query.kinds?.length && !query.kinds.includes(asset.kind)) return false;
  if (query.origins?.length && !query.origins.includes(asset.origin)) return false;
  if (query.tags?.length && !query.tags.some((tag) => asset.tags.includes(tag))) return false;
  if (query.models?.length && !(asset.model && query.models.includes(asset.model.modelId))) return false;
  if (query.workflowIds?.length && !query.workflowIds.includes(asset.workflowId)) return false;
  if (query.projects?.length && !query.projects.includes(asset.workflow?.projectPath ?? "")) return false;
  if (query.from !== undefined && asset.createdAt < query.from) return false;
  if (query.to !== undefined && asset.createdAt >= query.to) return false;
  if (query.q) {
    const needle = query.q.toLowerCase();
    const haystack = [
      asset.prompt,
      asset.filename,
      asset.model?.modelId,
      asset.model?.displayName,
      asset.workflow?.name ?? asset.workflowName,
      ...asset.tags,
    ];
    if (!haystack.some((value) => value?.toLowerCase().includes(needle))) return false;
  }
  return true;
}

/** Sort order of the list: (createdAt, id), newest first unless `oldest`. */
export function compareAssets(a: Pick<AssetView, "createdAt" | "id">, b: Pick<AssetView, "createdAt" | "id">, sort: AssetSort): number {
  const byTime = a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return sort === "oldest" ? byTime : -byTime;
}

export function selectionHas(selection: AssetSelection, id: string): boolean {
  return selection.mode === "ids" ? selection.ids.includes(id) : !selection.excludeIds.includes(id);
}

function gridItem(asset: AssetView, page: number): AssetGridItem {
  return {
    id: asset.id,
    createdAt: asset.createdAt,
    kind: asset.kind,
    width: asset.width,
    height: asset.height,
    asset,
    page,
  };
}

const EMPTY_SELECTION: AssetSelection = { mode: "ids", ids: [] };

function loadTileSize(): AssetTileSize {
  try {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(TILE_SIZE_KEY) : null;
    return stored === "s" || stored === "l" ? stored : "m";
  } catch {
    return "m";
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/* ------------------------------------------------------------------ */
/* Request bookkeeping (outside state: nothing renders from it)        */
/* ------------------------------------------------------------------ */

/** Bumped per refresh; a response for an older one is dropped. */
let requestSeq = 0;
let refreshController: AbortController | null = null;
let facetsTimer: ReturnType<typeof setTimeout> | null = null;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let jobTimer: ReturnType<typeof setTimeout> | null = null;
let noticeSeq = 0;
/** Failed page requests wait this long before the grid may ask again. */
const LOAD_RETRY_MS = 5000;
let lastLoadFailure = 0;
const pageFailures = new Map<number, number>();
const pageRequests = new Set<number>();

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useAssetStore = create<AssetStoreState>((set, get) => {
  const currentQuery = () => buildAssetQuery(get().filters, get().sort);

  const scheduleFacets = () => {
    if (facetsTimer) clearTimeout(facetsTimer);
    facetsTimer = setTimeout(() => {
      facetsTimer = null;
      void get().refreshFacets();
    }, FACETS_DEBOUNCE_MS);
  };

  /** Selection and records follow a patched record. */
  const replaceRecords = (updated: Map<string, AssetView>) => {
    if (updated.size === 0) return;
    set((state) => {
      const selectedRecords = { ...state.selectedRecords };
      for (const [id, asset] of updated) if (selectedRecords[id]) selectedRecords[id] = asset;
      const query = state.loadedQuery;
      // Records that no longer answer the query leave the grid (unfavorited in Favorites, say)
      let removedAny = false;
      const items: AssetGridItem[] = [];
      for (const item of state.items) {
        const asset = updated.get(item.id);
        if (!asset) {
          items.push(item);
        } else if (query && !matchesAssetQuery(asset, query)) {
          removedAny = true;
        } else {
          items.push({ ...item, asset });
        }
      }
      const detail = state.detailId ? updated.get(state.detailId) : undefined;
      return {
        items,
        selectedRecords,
        layoutVersion: removedAny ? state.layoutVersion + 1 : state.layoutVersion,
        total: removedAny ? Math.max(0, state.total - (state.items.length - items.length)) : state.total,
        detailAsset: detail ?? state.detailAsset,
      };
    });
  };

  /** Take records off the grid (trashed, restored, deleted). */
  const removeItems = (ids: Set<string>) => {
    if (ids.size === 0) return;
    set((state) => {
      const items = state.items.filter((item) => !ids.has(item.id));
      const removed = state.items.length - items.length;
      const selection =
        state.selection.mode === "ids"
          ? { mode: "ids" as const, ids: state.selection.ids.filter((id) => !ids.has(id)) }
          : state.selection;
      const selectedRecords = { ...state.selectedRecords };
      for (const id of ids) delete selectedRecords[id];
      return {
        items,
        selection,
        selectedRecords,
        arrivals: state.arrivals.filter((asset) => !ids.has(asset.id)),
        layoutVersion: removed ? state.layoutVersion + 1 : state.layoutVersion,
        total: Math.max(0, state.total - removed),
        focusedId: state.focusedId && ids.has(state.focusedId) ? null : state.focusedId,
      };
    });
  };

  /** Put records back where they sort (Undo of Trash/Restore). */
  const insertItems = (assets: AssetView[]) => {
    set((state) => {
      const query = state.loadedQuery;
      const present = new Set(state.items.map((item) => item.id));
      const incoming = assets.filter((asset) => !present.has(asset.id) && (!query || matchesAssetQuery(asset, query)));
      if (incoming.length === 0) return {};
      const sort = state.sort;
      const items = [...state.items];
      for (const asset of incoming) {
        // Never past the loaded end while more pages exist: that part of the list is not known yet
        let at = items.findIndex((item) => compareAssets(asset, item, sort) < 0);
        if (at === -1) {
          if (state.nextCursor) continue;
          at = items.length;
        }
        items.splice(at, 0, gridItem(asset, -1));
      }
      return {
        items,
        layoutVersion: state.layoutVersion + 1,
        total: state.total + (items.length - state.items.length),
      };
    });
  };

  const knownRecord = (id: string): AssetView | null => {
    const state = get();
    return (
      state.items.find((item) => item.id === id)?.asset ??
      state.selectedRecords[id] ??
      (state.detailAsset?.id === id ? state.detailAsset : null)
    );
  };

  /** What undoes `op` on `ids`, given each record as it was before. */
  const inverseOf = (op: AssetBulkOp, ids: string[], before: Map<string, AssetView>): AssetBulkRequest[] => {
    const on = (list: string[], inverse: AssetBulkOp): AssetBulkRequest[] =>
      list.length ? [{ selection: { mode: "ids", ids: list }, op: inverse }] : [];
    switch (op.action) {
      case "trash":
        return on(ids, { action: "restore" });
      case "restore":
        return on(ids, { action: "trash" });
      case "favorite":
        return on(ids.filter((id) => !before.get(id)?.favorite), { action: "unfavorite" });
      case "unfavorite":
        return on(ids.filter((id) => before.get(id)?.favorite ?? true), { action: "favorite" });
      case "tag":
        return op.tags.flatMap((tag) => on(ids.filter((id) => !before.get(id)?.tags.includes(tag)), { action: "untag", tags: [tag] }));
      case "untag":
        return op.tags.flatMap((tag) => on(ids.filter((id) => before.get(id)?.tags.includes(tag) ?? false), { action: "tag", tags: [tag] }));
      default:
        return [];
    }
  };

  /** Local effect of a successful op on the records we hold. */
  const applyLocally = (op: AssetBulkOp, ids: string[]) => {
    const idSet = new Set(ids);
    if (op.action === "trash" || op.action === "restore" || op.action === "delete") {
      removeItems(idSet);
      return;
    }
    const updated = new Map<string, AssetView>();
    for (const id of ids) {
      const record = knownRecord(id);
      if (!record) continue;
      let next: AssetView = record;
      if (op.action === "favorite") next = { ...record, favorite: true };
      else if (op.action === "unfavorite") next = { ...record, favorite: false };
      else if (op.action === "tag") next = { ...record, tags: [...record.tags, ...op.tags.filter((tag) => !record.tags.includes(tag))] };
      else if (op.action === "untag") next = { ...record, tags: record.tags.filter((tag) => !op.tags.includes(tag)) };
      updated.set(id, next);
    }
    replaceRecords(updated);
  };

  const describe = (op: AssetBulkOp, count: number): string => {
    const n = `${count.toLocaleString("en-US")} ${count === 1 ? "asset" : "assets"}`;
    switch (op.action) {
      case "trash": return `Trashed ${n}`;
      case "restore": return `Restored ${n}`;
      case "delete": return `Deleted ${n}`;
      case "favorite": return `Added ${n} to Favorites`;
      case "unfavorite": return `Removed ${n} from Favorites`;
      case "tag": return `Tagged ${n}`;
      case "untag": return `Untagged ${n}`;
    }
  };

  return {
    appView: "canvas",
    filters: DEFAULT_FILTERS,
    sort: "newest",
    tileSize: loadTileSize(),
    selectMode: false,

    items: [],
    layoutVersion: 0,
    pages: [],
    nextCursor: null,
    headCursor: null,
    total: 0,
    totalBytes: 0,
    status: "idle",
    error: null,
    loadingMore: false,
    loadedQuery: null,

    arrivals: [],
    atTop: true,
    scrollTop: 0,
    scrollToTopSeq: 0,

    facets: null,
    library: null,
    job: null,

    selection: EMPTY_SELECTION,
    selectedRecords: {},
    selectionTotal: 0,
    selectAllOffer: false,
    anchorId: null,
    focusedId: null,
    detailId: null,
    detailAsset: null,
    popover: null,
    confirm: null,
    notice: null,
    undoStack: [],

    setAppView: (view) => {
      if (get().appView === view) return;
      set({ appView: view, popover: null });
    },
    toggleAppView: () => get().setAppView(get().appView === "assets" ? "canvas" : "assets"),

    setFilters: (patch) => {
      set((state) => ({ filters: { ...state.filters, ...patch } }));
      void get().refresh();
    },
    setSearch: (q) => {
      set((state) => ({ filters: { ...state.filters, q } }));
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchTimer = null;
        void get().refresh();
      }, SEARCH_DEBOUNCE_MS);
    },
    setLibraryView: (view) => get().setFilters({ view }),
    toggleFilter: (list, value) => {
      const current = get().filters[list] as string[];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      get().setFilters({ [list]: next } as Partial<AssetFilters>);
    },
    clearFilterList: (list) => get().setFilters({ [list]: [] } as Partial<AssetFilters>),
    clearFilters: () => get().setFilters({ ...DEFAULT_FILTERS, view: get().filters.view }),
    setSort: (sort) => {
      if (get().sort === sort) return;
      set({ sort });
      void get().refresh();
    },
    setTileSize: (tileSize) => {
      set({ tileSize });
      try {
        window.localStorage.setItem(TILE_SIZE_KEY, tileSize);
      } catch {
        // Private mode or blocked storage: the size lasts the session
      }
    },
    setSelectMode: (selectMode) => set({ selectMode }),

    refresh: async () => {
      if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = null;
      }
      const seq = ++requestSeq;
      refreshController?.abort();
      const controller = new AbortController();
      refreshController = controller;
      pageRequests.clear();
      pageFailures.clear();
      lastLoadFailure = 0;
      const query = currentQuery();
      // "Select all matching" belongs to the query it was made for
      set((state) => ({
        status: "loading",
        error: null,
        // A page request of the old query that is still out never lands
        loadingMore: false,
        ...(state.selection.mode === "query" && !sameQuery(state.selection.query, query)
          ? { selection: EMPTY_SELECTION, selectedRecords: {}, selectionTotal: 0 }
          : {}),
        selectAllOffer: false,
      }));
      try {
        const page = await api.fetchAssetPage({ ...query, limit: PAGE_SIZE }, controller.signal);
        if (seq !== requestSeq) return;
        const seen = new Set<string>();
        const items: AssetGridItem[] = [];
        for (const asset of page.assets) {
          if (seen.has(asset.id)) continue;
          seen.add(asset.id);
          items.push(gridItem(asset, 0));
        }
        set((state) => ({
          items,
          pages: [{ cursor: null, loaded: true }],
          layoutVersion: state.layoutVersion + 1,
          nextCursor: page.nextCursor,
          headCursor: page.headCursor,
          total: page.total,
          totalBytes: page.totalBytes,
          status: "ready",
          loadedQuery: query,
          arrivals: [],
          scrollToTopSeq: state.scrollToTopSeq + 1,
          focusedId: state.focusedId && seen.has(state.focusedId) ? state.focusedId : null,
        }));
      } catch (error) {
        if (seq !== requestSeq || controller.signal.aborted) return;
        set({ status: "error", error: errorMessage(error, "The asset library could not be read.") });
      } finally {
        if (refreshController === controller) refreshController = null;
      }
    },

    loadMore: async () => {
      const { nextCursor, loadingMore, status, loadedQuery } = get();
      if (!nextCursor || loadingMore || status !== "ready" || !loadedQuery) return;
      // After a failure, wait before trying again (the grid asks on every scroll)
      if (Date.now() - lastLoadFailure < LOAD_RETRY_MS) return;
      const seq = requestSeq;
      set({ loadingMore: true });
      try {
        const page = await api.fetchAssetPage({ ...loadedQuery, cursor: nextCursor, limit: PAGE_SIZE });
        if (seq !== requestSeq) return;
        set((state) => {
          const seen = new Set(state.items.map((item) => item.id));
          const pageIndex = state.pages.length;
          const appended: AssetGridItem[] = [];
          for (const asset of page.assets) {
            if (seen.has(asset.id)) continue;
            seen.add(asset.id);
            appended.push(gridItem(asset, pageIndex));
          }
          return {
            items: appended.length ? [...state.items, ...appended] : state.items,
            pages: appended.length ? [...state.pages, { cursor: nextCursor, loaded: true }] : state.pages,
            // A page that brings nothing new and points at the same place again is the end
            nextCursor: appended.length === 0 && page.nextCursor === nextCursor ? null : page.nextCursor,
            total: page.total,
            totalBytes: page.totalBytes,
          };
        });
      } catch (error) {
        if (seq !== requestSeq) return;
        lastLoadFailure = Date.now();
        get().showNotice({ message: errorMessage(error, "More assets could not be loaded."), tone: "error" });
      } finally {
        if (seq === requestSeq) set({ loadingMore: false });
      }
    },

    ensurePage: async (pageIndex) => {
      const { pages, loadedQuery } = get();
      const slot = pages[pageIndex];
      if (!slot || slot.loaded || !loadedQuery || pageRequests.has(pageIndex)) return;
      if (Date.now() - (pageFailures.get(pageIndex) ?? 0) < LOAD_RETRY_MS) return;
      const seq = requestSeq;
      pageRequests.add(pageIndex);
      try {
        const page = await api.fetchAssetPage({ ...loadedQuery, cursor: slot.cursor ?? undefined, limit: PAGE_SIZE });
        if (seq !== requestSeq) return;
        const byId = new Map(page.assets.map((asset) => [asset.id, asset]));
        set((state) => ({
          items: state.items.map((item) => (item.page === pageIndex && !item.asset && byId.has(item.id) ? { ...item, asset: byId.get(item.id)! } : item)),
          pages: state.pages.map((p, i) => (i === pageIndex ? { ...p, loaded: true } : p)),
        }));
      } catch {
        // Tiles of that page keep their placeholders; scrolling retries after a pause
        pageFailures.set(pageIndex, Date.now());
      } finally {
        pageRequests.delete(pageIndex);
      }
    },

    trimLoaded: (visibleFrom, visibleTo) => {
      const { items, pages } = get();
      let loaded = 0;
      for (const item of items) if (item.asset) loaded++;
      if (loaded <= MAX_LOADED_ASSETS) return;
      const nearFrom = items[visibleFrom]?.page ?? 0;
      const nearTo = items[Math.min(visibleTo, items.length - 1)]?.page ?? nearFrom;
      const perPage = new Map<number, number>();
      for (const item of items) if (item.asset && item.page >= 0) perPage.set(item.page, (perPage.get(item.page) ?? 0) + 1);
      // Drop whole pages, farthest from what is on screen first
      const candidates = [...perPage.keys()]
        .filter((page) => page < nearFrom - 1 || page > nearTo + 1)
        .sort((a, b) => Math.max(nearFrom - b, b - nearTo) - Math.max(nearFrom - a, a - nearTo));
      const dropped = new Set<number>();
      for (const page of candidates) {
        if (loaded <= MAX_LOADED_ASSETS) break;
        dropped.add(page);
        loaded -= perPage.get(page) ?? 0;
      }
      if (dropped.size === 0) return;
      set({
        items: items.map((item) => (dropped.has(item.page) && item.asset ? { ...item, asset: null } : item)),
        pages: pages.map((slot, i) => (dropped.has(i) ? { ...slot, loaded: false } : slot)),
      });
    },

    pollArrivals: async () => {
      const { status, loadedQuery, headCursor, items } = get();
      if (status !== "ready" || !loadedQuery || (loadedQuery.sort ?? "newest") !== "newest") return;
      const seq = requestSeq;
      try {
        if (!headCursor) {
          // Nothing loaded yet: the first page is the arrival
          if (items.length === 0) {
            const page = await api.fetchAssetPage({ ...loadedQuery, limit: PAGE_SIZE });
            if (seq !== requestSeq || page.assets.length === 0) return;
            set({ headCursor: page.headCursor, nextCursor: page.nextCursor });
            get().receiveArrivals(page.assets);
          }
          return;
        }
        const page = await api.fetchAssetPage({ ...loadedQuery, newerThan: headCursor, limit: PAGE_SIZE });
        if (seq !== requestSeq) return;
        if (page.assets.length) set({ headCursor: page.headCursor ?? headCursor });
        get().receiveArrivals(page.assets);
      } catch {
        // The next poll tries again
      }
    },

    receiveArrivals: (assets) => {
      const state = get();
      const query = state.loadedQuery;
      if (state.status !== "ready" || !query) return;
      const present = new Set([...state.items.map((item) => item.id), ...state.arrivals.map((asset) => asset.id)]);
      const fresh = assets.filter((asset) => !present.has(asset.id) && matchesAssetQuery(asset, query));
      if (fresh.length === 0) return;
      fresh.sort((a, b) => compareAssets(a, b, state.sort));
      const bytes = fresh.reduce((sum, asset) => sum + asset.bytes, 0);
      if ((query.sort ?? "newest") === "oldest") {
        // New assets sort last: they show up when the end is reached, or now if it already has been
        if (!state.nextCursor) {
          set({
            items: [...state.items, ...fresh.map((asset) => gridItem(asset, -1))],
            total: state.total + fresh.length,
            totalBytes: state.totalBytes + bytes,
          });
        } else {
          set({ total: state.total + fresh.length, totalBytes: state.totalBytes + bytes });
        }
      } else if (state.atTop && state.arrivals.length === 0) {
        set({
          items: [...fresh.map((asset) => gridItem(asset, -1)), ...state.items],
          layoutVersion: state.layoutVersion + 1,
          total: state.total + fresh.length,
          totalBytes: state.totalBytes + bytes,
        });
      } else {
        // Never insert above what the user is looking at: hold them for the pill
        set({
          arrivals: [...fresh, ...state.arrivals],
          total: state.total + fresh.length,
          totalBytes: state.totalBytes + bytes,
        });
      }
      scheduleFacets();
    },

    showArrivals: () =>
      set((state) => {
        if (state.arrivals.length === 0) return { scrollToTopSeq: state.scrollToTopSeq + 1 };
        return {
          items: [...state.arrivals.map((asset) => gridItem(asset, -1)), ...state.items],
          arrivals: [],
          layoutVersion: state.layoutVersion + 1,
          scrollToTopSeq: state.scrollToTopSeq + 1,
        };
      }),

    setScroll: (scrollTop, atTop) => {
      const state = get();
      if (state.atTop === atTop && Math.abs(state.scrollTop - scrollTop) < 1) return;
      set({ scrollTop, atTop });
      // Back at the top with arrivals waiting: they can go in now without moving anything under the user
      if (atTop && !state.atTop && state.arrivals.length) get().showArrivals();
    },

    refreshFacets: async () => {
      try {
        const facets = await api.fetchFacets();
        set({ facets });
      } catch {
        // Keep the last counts
      }
    },

    refreshLibrary: async () => {
      try {
        const library = await api.fetchLibraryStatus();
        set({ library, ...(library.job ? { job: library.job } : {}) });
      } catch {
        // The recorder's status (if any) stands
      }
    },

    setLibrary: (library) => set({ library }),

    trackJob: (job, doneMessage) => {
      if (jobTimer) clearTimeout(jobTimer);
      set({ job });
      const poll = async (current: LibraryJobStatus) => {
        if (current.state !== "running") {
          jobTimer = null;
          const message =
            current.state === "done"
              ? doneMessage?.(current) ?? "Done"
              : current.state === "cancelled"
                ? "Cancelled"
                : current.error ?? current.message ?? "The job failed";
          get().showNotice({ message, tone: current.state === "failed" ? "error" : "info" });
          if (current.type === "import" || current.type === "cleanup") {
            void get().refresh();
            scheduleFacets();
          }
          return;
        }
        jobTimer = setTimeout(async () => {
          try {
            const next = (await api.fetchJob(current.id)) ?? { ...current, state: "failed" as const, error: "The job was lost" };
            if (get().job?.id !== current.id) return;
            set({ job: next });
            void poll(next);
          } catch {
            void poll(current);
          }
        }, JOB_POLL_MS);
      };
      void poll(job);
    },

    cancelJob: async () => {
      const job = get().job;
      if (!job || job.state !== "running") return;
      try {
        await api.cancelJob(job.id);
      } catch (error) {
        get().showNotice({ message: errorMessage(error, "The job could not be cancelled."), tone: "error" });
      }
    },

    toggleSelect: (id) =>
      set((state) => {
        const record = state.items.find((item) => item.id === id)?.asset ?? state.selectedRecords[id];
        if (state.selection.mode === "query") {
          const excluded = state.selection.excludeIds.includes(id);
          return {
            selection: {
              ...state.selection,
              excludeIds: excluded ? state.selection.excludeIds.filter((x) => x !== id) : [...state.selection.excludeIds, id],
            },
            anchorId: id,
            selectAllOffer: false,
          };
        }
        const on = state.selection.ids.includes(id);
        const selectedRecords = { ...state.selectedRecords };
        if (on) delete selectedRecords[id];
        else if (record) selectedRecords[id] = record;
        return {
          selection: { mode: "ids", ids: on ? state.selection.ids.filter((x) => x !== id) : [...state.selection.ids, id] },
          selectedRecords,
          anchorId: id,
          selectAllOffer: false,
        };
      }),

    selectRange: (id) => {
      const state = get();
      const anchor = state.anchorId ?? state.focusedId;
      const from = anchor ? state.items.findIndex((item) => item.id === anchor) : -1;
      const to = state.items.findIndex((item) => item.id === id);
      if (from === -1 || to === -1) {
        get().toggleSelect(id);
        return;
      }
      // The range runs in sort order, whatever columns the tiles landed in
      const range = state.items.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.id);
      get().setSelected(range, true);
      set({ anchorId: anchor });
    },

    setSelected: (ids, selected) =>
      set((state) => {
        if (state.selection.mode === "query") {
          const exclude = new Set(state.selection.excludeIds);
          for (const id of ids) {
            if (selected) exclude.delete(id);
            else exclude.add(id);
          }
          return { selection: { ...state.selection, excludeIds: [...exclude] }, selectAllOffer: false };
        }
        const current = new Set(state.selection.ids);
        const selectedRecords = { ...state.selectedRecords };
        const byId = new Map(state.items.map((item) => [item.id, item.asset]));
        for (const id of ids) {
          if (selected) {
            current.add(id);
            const record = byId.get(id);
            if (record) selectedRecords[id] = record;
          } else {
            current.delete(id);
            delete selectedRecords[id];
          }
        }
        return { selection: { mode: "ids", ids: [...current] }, selectedRecords, selectAllOffer: false };
      }),

    selectAllLoaded: () =>
      set((state) => {
        const selectedRecords: Record<string, AssetView> = {};
        for (const item of state.items) if (item.asset) selectedRecords[item.id] = item.asset;
        return {
          selection: { mode: "ids", ids: state.items.map((item) => item.id) },
          selectedRecords,
          selectAllOffer: state.total > state.items.length,
        };
      }),

    selectAllMatching: () =>
      set((state) => ({
        selection: { mode: "query", query: state.loadedQuery ?? currentQuery(), excludeIds: [] },
        selectedRecords: {},
        selectionTotal: state.total,
        selectAllOffer: false,
      })),

    clearSelection: () => set({ selection: EMPTY_SELECTION, selectedRecords: {}, selectionTotal: 0, selectAllOffer: false, anchorId: null }),

    setFocused: (focusedId) => set({ focusedId }),

    openDetail: (id) => {
      const asset = get().items.find((item) => item.id === id)?.asset ?? get().selectedRecords[id] ?? null;
      set({ detailId: id, detailAsset: asset, focusedId: id, popover: null });
      const item = get().items.find((i) => i.id === id);
      if (item && !item.asset) void get().ensurePage(item.page);
    },

    closeDetail: () => set({ detailId: null, detailAsset: null }),

    stepDetail: async (delta) => {
      const { detailId, items, nextCursor } = get();
      if (!detailId) return;
      const index = items.findIndex((item) => item.id === detailId);
      if (index === -1) return;
      let target = index + delta;
      if (target >= items.length && nextCursor) {
        await get().loadMore();
        target = Math.min(target, get().items.length - 1);
      }
      const next = get().items[target];
      if (!next || target < 0) return;
      set({ detailId: next.id, detailAsset: next.asset, focusedId: next.id });
      if (!next.asset) {
        await get().ensurePage(next.page);
        const loaded = get().items.find((item) => item.id === next.id)?.asset;
        if (loaded && get().detailId === next.id) set({ detailAsset: loaded });
      }
    },

    openPopover: (popover) => set({ popover }),
    closePopover: () => set({ popover: null }),
    requestConfirm: (confirm) => set({ confirm, popover: null }),
    closeConfirm: () => set({ confirm: null }),

    showNotice: (notice) => set({ notice: { ...notice, id: ++noticeSeq } }),
    dismissNotice: () => set({ notice: null }),

    runBulk: async (selection, op) => {
      const targetIds = selection.mode === "ids" ? selection.ids : [];
      if (selection.mode === "ids" && targetIds.length === 0) return null;
      const targetsSelection = selection === get().selection;
      // Records as they were, for Undo and for putting them back on the grid
      const before = new Map<string, AssetView>();
      if (selection.mode === "ids") {
        for (const id of targetIds) {
          const record = knownRecord(id);
          if (record) before.set(id, record);
        }
      } else {
        for (const item of get().items) if (item.asset && selectionHas(selection, item.id)) before.set(item.id, item.asset);
      }
      let result: AssetBulkResult;
      try {
        result = await api.bulkAssets({ selection, op });
      } catch (error) {
        get().showNotice({ message: errorMessage(error, "That did not work."), tone: "error" });
        return null;
      }

      const detailId = get().detailId;
      const detailIndex = detailId ? get().items.findIndex((item) => item.id === detailId) : -1;
      applyLocally(op, result.ids);

      // The open detail moves on when its asset leaves the list
      if (detailId && result.ids.includes(detailId) && (op.action === "trash" || op.action === "restore" || op.action === "delete")) {
        const items = get().items;
        const next = items[Math.min(detailIndex, items.length - 1)];
        if (next && detailIndex >= 0) set({ detailId: next.id, detailAsset: next.asset, focusedId: next.id });
        else set({ detailId: null, detailAsset: null });
      }
      // Whatever was selected has left the list
      if (targetsSelection && (op.action === "trash" || op.action === "restore" || op.action === "delete")) {
        get().clearSelection();
      }

      const steps = inverseOf(op, result.ids, before);
      if (steps.length) {
        const removed = op.action === "trash" || op.action === "restore" ? result.ids.map((id) => before.get(id)).filter((a): a is AssetView => !!a) : [];
        const entry: UndoEntry = {
          label: describe(op, result.affected),
          steps,
          removed,
          before: Object.fromEntries([...before].filter(([id]) => result.ids.includes(id)).map(([id, record]) => [id, { tags: record.tags, favorite: record.favorite }])),
        };
        set((state) => ({ undoStack: [...state.undoStack, entry].slice(-UNDO_LIMIT) }));
      }
      const failed = result.errors.length;
      get().showNotice(
        failed
          ? { message: `${describe(op, result.affected)} · ${failed} could not be changed`, tone: "error", undo: steps.length > 0 }
          : { message: describe(op, result.affected), tone: "info", undo: steps.length > 0 },
      );
      scheduleFacets();
      return result;
    },

    undo: async () => {
      const entry = get().undoStack[get().undoStack.length - 1];
      if (!entry) return;
      set((state) => ({ undoStack: state.undoStack.slice(0, -1) }));
      try {
        for (const step of entry.steps) await api.bulkAssets(step);
      } catch (error) {
        get().showNotice({ message: errorMessage(error, "Undo did not work."), tone: "error" });
        void get().refresh();
        return;
      }
      if (entry.removed.length) {
        insertItems(entry.removed);
      }
      const restored = new Map<string, AssetView>();
      for (const [id, prior] of Object.entries(entry.before)) {
        const record = knownRecord(id);
        if (record) restored.set(id, { ...record, ...prior });
      }
      replaceRecords(restored);
      get().showNotice({ message: `Undid: ${entry.label}`, tone: "info" });
      scheduleFacets();
    },
  };
});

/* ------------------------------------------------------------------ */
/* Derived values                                                      */
/* ------------------------------------------------------------------ */

type SelectionState = Pick<AssetStoreState, "selection" | "selectionTotal">;

/** How many assets the selection covers. */
export function selectionCount(state: SelectionState): number {
  return state.selection.mode === "ids"
    ? state.selection.ids.length
    : Math.max(0, state.selectionTotal - state.selection.excludeIds.length);
}

/** Selected assets the current filters hide ("3 selected (1 hidden by filters)"). */
export function hiddenSelectionCount(state: Pick<AssetStoreState, "selection" | "selectedRecords" | "filters" | "sort">): number {
  if (state.selection.mode !== "ids" || state.selection.ids.length === 0) return 0;
  const query = buildAssetQuery(state.filters, state.sort);
  let hidden = 0;
  for (const id of state.selection.ids) {
    const record = state.selectedRecords[id];
    if (record && !matchesAssetQuery(record, query)) hidden++;
  }
  return hidden;
}

/** Bulk Favorite adds unless every selected asset already is one. */
export function bulkFavoriteOp(state: Pick<AssetStoreState, "selection" | "selectedRecords">): AssetBulkOp {
  if (state.selection.mode === "query") return state.selection.query.favorite ? { action: "unfavorite" } : { action: "favorite" };
  const records = state.selection.ids.map((id) => state.selectedRecords[id]);
  const all = records.length > 0 && records.every((record) => record?.favorite);
  return all ? { action: "unfavorite" } : { action: "favorite" };
}
