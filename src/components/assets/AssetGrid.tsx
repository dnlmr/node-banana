"use client";

import { ArrowUp, Check, Minus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useShallow } from "zustand/shallow";
import { cn } from "@/components/nodes/ui/cn";
import { DialogSpinner } from "@/components/ui/Dialog";
import type { AssetView } from "@/lib/assets/types";
import { selectionHas, useAssetStore, type AssetGridItem, type AssetTileSize } from "@/store/assetStore";
import { daySectionLabel, formatCount } from "./assetFormat";
import { AssetTile } from "./AssetTile";
import { toggleFavorite } from "./assetActions";
import {
  fitColumns,
  layoutGrid,
  locate,
  neighbourIndex,
  tileBounds,
  visibleIndices,
  visibleSections,
  type GridDirection,
  type GridLayout,
  type GridLayoutOptions,
} from "./masonryLayout";
import { useVirtualWindow } from "./useVirtualWindow";

/** Target column width per tile size; the columns stretch to fill the row. */
export const TILE_TARGET_WIDTH: Record<AssetTileSize, number> = { s: 180, m: 240, l: 320 };
const GAP = 8;
const HEADER_HEIGHT = 40;
const SECTION_GAP = 16;
/** px-8, matching the split dialogs' page padding. */
const SIDE_PADDING = 32;
/** Room under the last row for the bulk bar. */
const BOTTOM_PADDING = 96;

/**
 * The grid's keyboard movement, registered while the grid is mounted so the
 * view's key handler (which owns the keys) can move the focus through the
 * layout it cannot see.
 */
export const gridNavigation: { current: ((direction: GridDirection) => void) | null } = { current: null };

/** Scroll a tile into view and focus it: where closing the detail lands. */
export const gridReveal: { current: ((id: string) => void) | null } = { current: null };

/** Focus a tile once the virtual window has mounted it (a scroll renders a frame or two later). */
function focusTileSoon(scroller: HTMLElement | null, id: string, frames = 4) {
  requestAnimationFrame(() => {
    const tile = scroller?.querySelector<HTMLElement>(`[data-asset-tile="${id}"]`);
    if (tile) tile.focus({ preventScroll: true });
    else if (frames > 1) focusTileSoon(scroller, id, frames - 1);
  });
}

/** Lays out incrementally while only pages are appended; from the top when `version` changes. */
function useGridLayout(items: AssetGridItem[], options: GridLayoutOptions, version: number): GridLayout {
  const cache = useRef<{ layout: GridLayout; version: number } | null>(null);
  const { columnCount, columnWidth, gap, headerHeight, sectionGap } = options;
  return useMemo(() => {
    const previous = cache.current?.version === version ? cache.current.layout : null;
    const layout = layoutGrid(items, { columnCount, columnWidth, gap, headerHeight, sectionGap }, previous);
    cache.current = { layout, version };
    return layout;
  }, [items, columnCount, columnWidth, gap, headerHeight, sectionGap, version]);
}

function SectionHeader({
  label,
  count,
  state,
  onToggle,
}: {
  label: string;
  count: number;
  state: "all" | "some" | "none";
  onToggle: () => void;
}) {
  return (
    <div
      className="sticky top-0 z-10 -mx-2 flex items-center gap-2 bg-canvas-bg/90 px-2 backdrop-blur-sm"
      style={{ height: HEADER_HEIGHT }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
        aria-label={`Select ${label}`}
        onClick={onToggle}
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-[4px] border transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection",
          state === "none" ? "border-neutral-600 text-transparent hover:border-neutral-400" : "border-selection bg-selection text-white",
        )}
      >
        {state === "some" ? <Minus size={10} strokeWidth={3} /> : <Check size={10} strokeWidth={3} />}
      </button>
      <span className="font-mono text-[11px] uppercase leading-4 tracking-eyebrow text-neutral-300">{label}</span>
      <span className="font-mono text-[11px] leading-4 tracking-eyebrow text-ink-3">{count.toLocaleString("en-US")}</span>
    </div>
  );
}

/**
 * The masonry of assets, one block per day under a sticky header. Only
 * tiles within a viewport of the visible area are mounted; pages load as
 * the bottom comes within 1.5 viewports, and the scrollbar is sized for the
 * whole result from the average tile so it does not jump as they arrive.
 */
export function AssetGrid() {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Back where the user left it when the view comes back
  const [initialScrollTop] = useState(() => useAssetStore.getState().scrollTop);
  const { width, height, scrollTop } = useVirtualWindow(scrollRef, initialScrollTop);
  const {
    items,
    layoutVersion,
    tileSize,
    total,
    nextCursor,
    loadingMore,
    status,
    selection,
    selectMode,
    focusedId,
    arrivals,
    scrollToTopSeq,
  } = useAssetStore(
    useShallow((state) => ({
      items: state.items,
      layoutVersion: state.layoutVersion,
      tileSize: state.tileSize,
      total: state.total,
      nextCursor: state.nextCursor,
      loadingMore: state.loadingMore,
      status: state.status,
      selection: state.selection,
      selectMode: state.selectMode,
      focusedId: state.focusedId,
      arrivals: state.arrivals,
      scrollToTopSeq: state.scrollToTopSeq,
    })),
  );

  const { columnCount, columnWidth } = fitColumns(width - SIDE_PADDING * 2, TILE_TARGET_WIDTH[tileSize], GAP);
  const layout = useGridLayout(
    items,
    { columnCount, columnWidth, gap: GAP, headerHeight: HEADER_HEIGHT, sectionGap: SECTION_GAP },
    layoutVersion,
  );

  // One viewport of overscan either side
  const windowTop = scrollTop - height;
  const windowBottom = scrollTop + height * 2;
  const visible = useMemo(() => visibleIndices(layout, windowTop, windowBottom), [layout, windowTop, windowBottom]);
  const shownSections = useMemo(() => visibleSections(layout, windowTop, windowBottom), [layout, windowTop, windowBottom]);
  const selecting = selectMode || (selection.mode === "ids" ? selection.ids.length > 0 : true);

  const firstSeq = useRef(scrollToTopSeq);
  useEffect(() => {
    if (scrollToTopSeq === firstSeq.current) return;
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [scrollToTopSeq]);

  useEffect(() => {
    useAssetStore.getState().setScroll(scrollTop, scrollTop < 8);
  }, [scrollTop]);

  // More when the loaded bottom is near
  useEffect(() => {
    if (!nextCursor || loadingMore || status !== "ready") return;
    if (layout.height - (scrollTop + height) < height * 1.5) void useAssetStore.getState().loadMore();
  }, [nextCursor, loadingMore, status, layout.height, scrollTop, height]);

  // Pages dropped for memory come back when scrolled to; far ones go when too many are held
  useEffect(() => {
    const store = useAssetStore.getState();
    const pages = new Set<number>();
    for (const index of visible) {
      const item = items[index];
      if (item && !item.asset && item.page >= 0) pages.add(item.page);
    }
    for (const page of pages) void store.ensurePage(page);
  }, [visible, items]);
  useEffect(() => {
    if (visible.length) useAssetStore.getState().trimLoaded(visible[0]!, visible[visible.length - 1]!);
    // Only when pages arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      const bounds = tileBounds(layout, index);
      if (!el || !bounds) return;
      if (bounds.top - HEADER_HEIGHT < el.scrollTop) el.scrollTop = Math.max(0, bounds.top - HEADER_HEIGHT - GAP);
      else if (bounds.bottom > el.scrollTop + el.clientHeight) el.scrollTop = bounds.bottom - el.clientHeight + GAP;
    },
    [layout],
  );

  useEffect(() => {
    gridNavigation.current = (direction) => {
      const store = useAssetStore.getState();
      const current = store.focusedId ? store.items.findIndex((item) => item.id === store.focusedId) : -1;
      const next = current === -1 ? (visible.find((index) => (tileBounds(layout, index)?.top ?? 0) >= scrollTop) ?? 0) : neighbourIndex(layout, current, direction);
      if (next === null) {
        if (direction === "right" && store.nextCursor) void store.loadMore();
        return;
      }
      const item = store.items[next];
      if (!item) return;
      store.setFocused(item.id);
      scrollToIndex(next);
      focusTileSoon(scrollRef.current, item.id);
    };
    gridReveal.current = (id) => {
      const index = useAssetStore.getState().items.findIndex((item) => item.id === id);
      if (index === -1) return;
      scrollToIndex(index);
      focusTileSoon(scrollRef.current, id);
    };
    return () => {
      gridNavigation.current = null;
      gridReveal.current = null;
    };
  }, [layout, visible, scrollTop, scrollToIndex]);

  const onActivate = useCallback((id: string, event: ReactMouseEvent) => {
    const store = useAssetStore.getState();
    store.setFocused(id);
    if (event.shiftKey) store.selectRange(id);
    else if (event.metaKey || event.ctrlKey || store.selectMode) store.toggleSelect(id);
    else store.openDetail(id);
  }, []);

  const onToggleSelect = useCallback((id: string, event: ReactMouseEvent) => {
    const store = useAssetStore.getState();
    store.setFocused(id);
    if (event.shiftKey) store.selectRange(id);
    else store.toggleSelect(id);
  }, []);

  const onContextMenu = useCallback((id: string, event: ReactMouseEvent) => {
    event.preventDefault();
    const store = useAssetStore.getState();
    store.setFocused(id);
    store.openPopover({
      kind: "menu",
      x: event.clientX,
      y: event.clientY,
      anchorId: id,
      useSelection: selectionHas(store.selection, id) && (store.selection.mode === "query" || store.selection.ids.length > 1),
    });
  }, []);

  const onToggleFavorite = useCallback((asset: AssetView) => toggleFavorite(asset), []);
  const onFocus = useCallback((id: string) => {
    if (useAssetStore.getState().focusedId !== id) useAssetStore.getState().setFocused(id);
  }, []);

  // Membership in O(1): the selection can hold thousands of ids
  const isSelected = useMemo(() => {
    if (selection.mode === "ids") {
      const ids = new Set(selection.ids);
      return (id: string) => ids.has(id);
    }
    const excluded = new Set(selection.excludeIds);
    return (id: string) => !excluded.has(id);
  }, [selection]);
  // One Tab stop into the grid: the focused tile while it is mounted, else the first in view
  const tabStop = focusedId && visible.some((index) => items[index]?.id === focusedId) ? focusedId : items[visible[0] ?? -1]?.id;

  const remaining = Math.max(0, total - items.length);
  const perItem = items.length ? layout.height / items.length : 0;
  const contentHeight = layout.height + (nextCursor ? remaining * perItem : 0) + BOTTOM_PADDING;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        data-testid="asset-grid"
        className={cn(
          "absolute inset-0 overflow-y-auto overscroll-contain transition-opacity duration-150",
          status === "loading" && "pointer-events-none opacity-60",
        )}
        aria-busy={status === "loading" || loadingMore || undefined}
      >
        <div className="relative" style={{ height: contentHeight }}>
          {shownSections.map((sectionIndex) => {
            const section = layout.sections[sectionIndex]!;
            const size = section.masonry.tiles.length;
            let selected = 0;
            for (let i = section.start; i < section.start + size; i++) if (items[i] && isSelected(items[i]!.id)) selected++;
            const state = selected === 0 ? "none" : selected === size ? "all" : "some";
            return (
              <section
                key={`${section.key}:${section.start}`}
                aria-label={daySectionLabel(section.at)}
                className="absolute"
                style={{ top: section.top, left: SIDE_PADDING, right: SIDE_PADDING, height: HEADER_HEIGHT + section.masonry.height }}
              >
                <SectionHeader
                  label={daySectionLabel(section.at)}
                  count={size}
                  state={state}
                  onToggle={() => {
                    const ids = items.slice(section.start, section.start + size).map((item) => item.id);
                    useAssetStore.getState().setSelected(ids, state !== "all");
                  }}
                />
              </section>
            );
          })}
          {visible.map((index) => {
            const item = items[index]!;
            const at = locate(layout, index)!;
            const section = layout.sections[at.section]!;
            const tile = section.masonry.tiles[at.local]!;
            return (
              <AssetTile
                key={item.id}
                id={item.id}
                kind={item.kind}
                asset={item.asset}
                width={tile.width}
                height={tile.height}
                left={SIDE_PADDING + tile.x}
                top={section.top + HEADER_HEIGHT + tile.y}
                selected={isSelected(item.id)}
                focused={focusedId === item.id}
                tabbable={item.id === tabStop}
                selecting={selecting}
                onFocus={onFocus}
                onActivate={onActivate}
                onToggleSelect={onToggleSelect}
                onToggleFavorite={onToggleFavorite}
                onContextMenu={onContextMenu}
              />
            );
          })}
          {loadingMore && (
            <div className="absolute left-0 right-0 flex justify-center" style={{ top: layout.height + 24 }}>
              <DialogSpinner />
            </div>
          )}
        </div>
      </div>

      {arrivals.length > 0 && (
        <button
          type="button"
          onClick={() => useAssetStore.getState().showArrivals()}
          className="animate-drop-in motion-reduce:animate-none absolute left-1/2 top-3 z-20 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-neutral-200 px-3.5 font-display text-xs font-semibold text-neutral-900 shadow-menu transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection"
        >
          <ArrowUp size={14} strokeWidth={2} />
          {formatCount(arrivals.length, "new", "new")}
        </button>
      )}
    </div>
  );
}
