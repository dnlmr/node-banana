"use client";

import { Download, FolderInput, RotateCcw, Star, Tag, Trash2, X, type LucideIcon } from "lucide-react";
import { useRef } from "react";
import { useShallow } from "zustand/shallow";
import { cn } from "@/components/nodes/ui/cn";
import { MenuBarLabel, MenuDivider, MenuSurface } from "@/components/ui/Menu";
import { bulkFavoriteOp, hiddenSelectionCount, selectionCount, useAssetStore } from "@/store/assetStore";
import { formatCount } from "./assetFormat";
import { canZip, downloadZip, exportAssets, favoriteSelection, isDesktopApp, recordsOf, removeSelection, requestPermanentDelete, restoreSelection } from "./assetActions";

function BarButton({
  icon: Icon,
  label,
  onClick,
  danger,
  iconOnly,
  title,
  buttonRef,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
  iconOnly?: boolean;
  title?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={iconOnly ? label : undefined}
      title={title ?? label}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection",
        danger && "text-red-400 hover:text-red-300",
        iconOnly && "w-7 justify-center px-0",
      )}
    >
      <Icon size={14} strokeWidth={1.75} />
      {!iconOnly && label}
    </button>
  );
}

/**
 * The selection's actions, bottom-centre (MenuSurface bar): count, Tags…,
 * Favorite, Export…, Download (the browser zips only small selections),
 * Trash, Clear. Restore and Delete permanently in Trash; Remove from library
 * for missing files. Above it, the Gmail-style offer to widen Cmd+A to
 * every matching asset.
 */
export function BulkBar() {
  const state = useAssetStore(
    useShallow((s) => ({
      selection: s.selection,
      selectionTotal: s.selectionTotal,
      selectedRecords: s.selectedRecords,
      selectAllOffer: s.selectAllOffer,
      filters: s.filters,
      sort: s.sort,
      total: s.total,
      totalBytes: s.totalBytes,
      items: s.items,
      library: s.library,
    })),
  );
  const tagsButton = useRef<HTMLButtonElement>(null);
  const count = selectionCount(state);
  const hidden = hiddenSelectionCount(state);
  if (count === 0) return null;

  const store = useAssetStore.getState();
  const { selection, filters } = state;
  const records = recordsOf(selection);
  const bytes = selection.mode === "ids" ? records.reduce((sum, asset) => sum + asset.bytes, 0) : state.totalBytes;
  // The browser zips only what it fully knows and can hold
  const zippable = !isDesktopApp() && selection.mode === "ids" && records.length === count && canZip(count, bytes);
  const favorite = bulkFavoriteOp(state);

  const openTags = () => {
    const rect = tagsButton.current?.getBoundingClientRect();
    store.openPopover({ kind: "tags", x: rect?.left ?? 0, y: (rect?.top ?? 0) - 8, selection, above: true });
  };

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2">
      {(state.selectAllOffer || selection.mode === "query") && (
        <div className="animate-drop-in motion-reduce:animate-none flex items-center gap-2 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 shadow-menu">
          {selection.mode === "query" ? (
            <>
              <span>All {formatCount(state.selectionTotal, "matching asset", "matching assets")} are selected.</span>
              <button type="button" onClick={() => store.clearSelection()} className="font-medium text-neutral-100 underline-offset-2 hover:underline">
                Clear selection
              </button>
            </>
          ) : (
            <>
              <span>All {formatCount(state.items.length, "loaded asset", "loaded assets")} are selected.</span>
              <button type="button" onClick={() => store.selectAllMatching()} className="font-medium text-neutral-100 underline-offset-2 hover:underline">
                Select all {state.total.toLocaleString("en-US")} matching
              </button>
            </>
          )}
        </div>
      )}
      <MenuSurface variant="bar" floating={false} role="toolbar" aria-label="Selected assets" className="animate-drop-in motion-reduce:animate-none">
        <MenuBarLabel className="py-1 text-[11px]">
          {count.toLocaleString("en-US")} selected
          {hidden > 0 && <span className="text-ink-3">({hidden.toLocaleString("en-US")} hidden by filters)</span>}
        </MenuBarLabel>
        {filters.view === "trash" ? (
          <>
            <BarButton icon={RotateCcw} label="Restore" onClick={() => restoreSelection(selection)} />
            <BarButton icon={Trash2} label="Delete permanently…" danger onClick={() => requestPermanentDelete(selection, count)} />
          </>
        ) : (
          <>
            <BarButton icon={Tag} label="Tags…" onClick={openTags} buttonRef={tagsButton} />
            <BarButton
              icon={Star}
              label={favorite.action === "favorite" ? "Favorite" : "Unfavorite"}
              onClick={favoriteSelection}
            />
            <MenuDivider variant="bar" className="mx-0.5" />
            {filters.view === "missing" ? (
              // Nothing to copy: the files are gone
              <BarButton icon={Trash2} label="Remove from library…" danger onClick={() => removeSelection(selection)} />
            ) : (
              <>
                <BarButton icon={FolderInput} label="Export…" onClick={() => void exportAssets(selection)} title="Copy the files to a folder" />
                {zippable && <BarButton icon={Download} label="Download" onClick={() => void downloadZip(records)} title="Download as a zip" />}
                <MenuDivider variant="bar" className="mx-0.5" />
                <BarButton icon={Trash2} label="Trash" onClick={() => removeSelection(selection)} />
              </>
            )}
          </>
        )}
        <MenuDivider variant="bar" className="mx-0.5" />
        <BarButton icon={X} label="Clear selection" iconOnly onClick={() => store.clearSelection()} />
      </MenuSurface>
    </div>
  );
}
