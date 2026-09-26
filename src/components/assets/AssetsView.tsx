"use client";

import { CircleAlert, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/shallow";
import { cn } from "@/components/nodes/ui/cn";
import { CHROME_SURFACE } from "@/components/chromeStyles";
import { clearGenerationToasts } from "@/components/GenerationToast";
import { getRecorderLibraryStatus, onAssetRecorded, onLibraryStatus } from "@/lib/assets/client/recorder";
import { sameQuery } from "@/lib/assets/query";
import { ARRIVALS_POLL_MS, buildAssetQuery, selectionCount, useAssetStore } from "@/store/assetStore";
import { useWorkflowStore } from "@/store/workflowStore";
import { AssetContextMenu } from "./AssetContextMenu";
import { AssetDetail, toggleDetailFullscreen } from "./AssetDetail";
import { AssetGrid, gridNavigation } from "./AssetGrid";
import { AssetsHeader } from "./AssetsHeader";
import { AssetsRail } from "./AssetsRail";
import { BulkBar } from "./BulkBar";
import { ConfirmDelete } from "./ConfirmDelete";
import { EmptyState } from "./EmptyState";
import { BulkTagEditor } from "./TagEditor";
import { copyPrompt, recordsOf, removeSelection, selectionOf } from "./assetActions";
import type { GridDirection } from "./masonryLayout";

const RAIL_WIDTH = 232;
const PANEL_WIDTH = 340;
const FACETS_AFTER_RECORDING_MS = 1500;

const ARROWS: Record<string, GridDirection> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input, textarea, select, [contenteditable='true']"));
}

/** A control other than a tile has focus: Enter and Space are its own. */
function isOtherControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("button, a, [role='checkbox']") && !target.closest("[data-asset-tile]");
}

/**
 * The view's one keyboard handler, in the capture phase so it runs before
 * anything else on the window (the canvas behind is also guarded, but this
 * keeps the view's keys its own), following AnnotationModal's shield:
 *
 * Esc closes the detail, then clears the selection, then returns to the
 * canvas. Arrows move through the grid (←/→ step through the detail),
 * Enter opens, Space selects, ⌘A selects all loaded, Delete trashes, ⌘Z
 * undoes the last asset action, F is fullscreen in the detail, ? shows the
 * shortcuts and A goes back to the canvas. ⌘C copies selected text as
 * usual, or the open asset's prompt when nothing is selected.
 */
function handleAssetsKey(event: KeyboardEvent) {
  const store = useAssetStore.getState();
  if (store.appView !== "assets") return;
  // A dialog above the view (settings, shortcuts, the delete confirm) owns the keyboard
  if (document.querySelector("[data-dialog-overlay]")) return;
  const key = event.key;
  const lower = key.toLowerCase();
  const mod = event.metaKey || event.ctrlKey;
  const own = () => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  // A menu or the tag editor handles its own keys; Escape closes it
  if (store.popover) {
    if (key === "Escape") {
      own();
      store.closePopover();
    }
    return;
  }

  if (isTypingTarget(event.target)) {
    if (key === "Escape") {
      own();
      (event.target as HTMLElement).blur();
    }
    return;
  }

  if (key === "Escape") {
    own();
    if (store.detailId) store.closeDetail();
    else if (selectionCount(store) > 0) store.clearSelection();
    else if (store.selectMode) store.setSelectMode(false);
    else store.setAppView("canvas");
    return;
  }

  if (mod) {
    if (lower === "z" && !event.shiftKey) {
      own();
      void store.undo();
    } else if (lower === "a") {
      own();
      if (!store.detailId) store.selectAllLoaded();
    } else if (lower === "c") {
      // Selected text copies as it always does
      if (window.getSelection()?.toString()) return;
      own();
      if (store.detailAsset?.prompt) void copyPrompt(store.detailAsset);
    }
    return;
  }
  if (event.altKey) return;

  if (key === "?") {
    own();
    useWorkflowStore.getState().setShortcutsDialogOpen(true);
    return;
  }
  if (lower === "a" && !event.shiftKey) {
    own();
    if (!event.repeat) store.setAppView("canvas");
    return;
  }

  if (store.detailId) {
    if (key === "ArrowLeft" || key === "ArrowRight") {
      own();
      void store.stepDetail(key === "ArrowLeft" ? -1 : 1);
    } else if (lower === "f" && !event.shiftKey) {
      own();
      toggleDetailFullscreen();
    } else if (key === "Delete" || key === "Backspace") {
      own();
      removeSelection(selectionOf([store.detailId]));
    }
    return;
  }

  if (ARROWS[key]) {
    own();
    gridNavigation.current?.(ARROWS[key]!);
    return;
  }
  if (key === "Enter" && store.focusedId && !isOtherControl(event.target)) {
    own();
    store.openDetail(store.focusedId);
    return;
  }
  if (key === " " && store.focusedId && !isOtherControl(event.target)) {
    own();
    store.toggleSelect(store.focusedId);
    return;
  }
  if (key === "Delete" || key === "Backspace") {
    own();
    if (selectionCount(store) > 0) removeSelection(store.selection);
    else if (store.focusedId) removeSelection(selectionOf([store.focusedId]));
  }
}

/** The last asset action's result, with Undo, bottom-centre; errors stay a little longer. */
function Notice() {
  const notice = useAssetStore((state) => state.notice);
  const dismiss = useAssetStore((state) => state.dismissNotice);
  const undo = useAssetStore((state) => state.undo);
  const canUndo = useAssetStore((state) => state.undoStack.length > 0);

  useEffect(() => {
    if (!notice || notice.sticky) return;
    const timer = setTimeout(() => {
      if (useAssetStore.getState().notice?.id === notice.id) dismiss();
    }, notice.undo || notice.tone === "error" ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <div
      key={notice.id}
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn(CHROME_SURFACE, "animate-drop-in pointer-events-auto flex min-h-10 max-w-[520px] items-center gap-2 rounded-xl py-1.5 pl-3 pr-1.5 text-xs text-neutral-200")}
    >
      {notice.tone === "error" && <CircleAlert size={14} strokeWidth={1.75} className="shrink-0 text-red-400" />}
      <span className="min-w-0 flex-1">{notice.message}</span>
      {notice.undo && canUndo && (
        <button
          type="button"
          onClick={() => {
            dismiss();
            void undo();
          }}
          className="h-7 shrink-0 rounded-md px-2 font-medium text-neutral-100 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection"
        >
          Undo
        </button>
      )}
      {notice.action && (
        <button
          type="button"
          onClick={() => {
            dismiss();
            notice.action!.run();
          }}
          className="h-7 shrink-0 rounded-md px-2 font-medium text-neutral-100 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection"
        >
          {notice.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.08] hover:text-neutral-100"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function Popovers() {
  const popover = useAssetStore((state) => state.popover);
  // Re-read records when they change, so the tag editor's states follow each click
  useAssetStore(useShallow((state) => [state.items, state.selectedRecords, state.detailAsset]));
  const facets = useAssetStore((state) => state.facets);
  if (!popover) return null;
  if (popover.kind === "menu") {
    return <AssetContextMenu x={popover.x} y={popover.y} anchorId={popover.anchorId} useSelection={popover.useSelection} />;
  }
  return (
    <BulkTagEditor
      selection={popover.selection}
      records={recordsOf(popover.selection)}
      suggestions={(facets?.tags ?? []).map((tag) => tag.tag)}
      x={popover.x}
      y={popover.y}
    />
  );
}

/**
 * The Assets view: every asset the library holds, as a masonry of day
 * sections with a filter rail, a detail view, bulk actions and tags. It is
 * a layer over the canvas inside the canvas frame; the canvas stays mounted
 * (inert) underneath. While open it polls for new arrivals, listens to the
 * recorder, and owns the keyboard (see handleAssetsKey).
 */
export function AssetsView() {
  const rootRef = useRef<HTMLDivElement>(null);
  const { status, itemCount, detailOpen } = useAssetStore(
    useShallow((state) => ({ status: state.status, itemCount: state.items.length, detailOpen: state.detailId !== null })),
  );

  useEffect(() => {
    const store = useAssetStore.getState();
    const query = buildAssetQuery(store.filters, store.sort);
    // Coming back to the same query keeps what was loaded (and where the user was)
    if (store.status === "ready" && store.loadedQuery && sameQuery(store.loadedQuery, query)) void store.pollArrivals();
    else void store.refresh();
    void store.refreshFacets();
    const known = getRecorderLibraryStatus();
    if (known) store.setLibrary(known);
    void store.refreshLibrary();
    clearGenerationToasts();
    rootRef.current?.focus({ preventScroll: true });

    let facetsTimer: ReturnType<typeof setTimeout> | null = null;
    const offRecorded = onAssetRecorded((result) => {
      useAssetStore.getState().receiveArrivals([result.asset]);
      if (facetsTimer) clearTimeout(facetsTimer);
      facetsTimer = setTimeout(() => void useAssetStore.getState().refreshFacets(), FACETS_AFTER_RECORDING_MS);
    });
    const offStatus = onLibraryStatus((next) => useAssetStore.getState().setLibrary(next));
    const poll = setInterval(() => void useAssetStore.getState().pollArrivals(), ARRIVALS_POLL_MS);
    window.addEventListener("keydown", handleAssetsKey, { capture: true });
    return () => {
      offRecorded();
      offStatus();
      clearInterval(poll);
      if (facetsTimer) clearTimeout(facetsTimer);
      window.removeEventListener("keydown", handleAssetsKey, { capture: true });
      useAssetStore.getState().closePopover();
    };
  }, []);

  const showGrid = itemCount > 0;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-testid="assets-view"
      role="region"
      aria-label="Assets"
      className="absolute inset-0 flex bg-canvas-bg outline-none"
    >
      <AssetsRail />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <AssetsHeader />
        {showGrid ? (
          <AssetGrid />
        ) : status === "loading" || status === "idle" ? (
          <div className="flex flex-1 items-center justify-center pb-16" aria-busy>
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300 motion-reduce:animate-none" />
          </div>
        ) : (
          <EmptyState />
        )}
      </main>

      <AssetDetail />

      {/* Bulk bar and notices, centred over the grid or the detail's stage */}
      <div
        className="pointer-events-none absolute bottom-5 z-40 flex flex-col items-center gap-2"
        style={detailOpen ? { left: 0, right: PANEL_WIDTH } : { left: RAIL_WIDTH, right: 0 }}
      >
        <Notice />
        {!detailOpen && <BulkBar />}
      </div>

      <Popovers />
      <ConfirmDelete />
    </div>
  );
}
