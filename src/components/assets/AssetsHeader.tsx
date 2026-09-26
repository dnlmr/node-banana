"use client";

import { SquareCheck, X } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { cn } from "@/components/nodes/ui/cn";
import { DialogButton, DialogEyebrow, DialogTextButton } from "@/components/ui/Dialog";
import { Segmented } from "@/components/ui/Controls";
import { hasActiveFilters, useAssetStore, type AssetLibraryView, type AssetTileSize } from "@/store/assetStore";
import type { AssetSort, LibraryJobStatus } from "@/lib/assets/types";
import { formatCount } from "./assetFormat";
import { requestPermanentDelete } from "./assetActions";

const VIEW_TITLES: Record<AssetLibraryView, string> = {
  all: "Assets",
  favorites: "Favorites",
  missing: "Missing files",
  trash: "Trash",
};

const SORT_OPTIONS: { value: AssetSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

const SIZE_OPTIONS: { value: AssetTileSize; label: string; title: string }[] = [
  { value: "s", label: "S", title: "Small tiles" },
  { value: "m", label: "M", title: "Medium tiles" },
  { value: "l", label: "L", title: "Large tiles" },
];

const JOB_VERBS: Record<LibraryJobStatus["type"], string> = {
  export: "Exporting",
  import: "Importing",
  move: "Moving library",
  cleanup: "Cleaning up",
};

/** A running library job: what, how far, and Cancel. */
function JobProgress({ job, onCancel }: { job: LibraryJobStatus; onCancel: () => void }) {
  const fraction = job.total > 0 ? Math.min(1, job.done / job.total) : 0;
  return (
    <div className="flex items-center gap-2.5" role="status" aria-live="polite">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] leading-4 tracking-eyebrow text-neutral-300 uppercase">
          {JOB_VERBS[job.type]} {job.total > 0 ? `${job.done.toLocaleString("en-US")} of ${job.total.toLocaleString("en-US")}` : "…"}
        </span>
        <span className="h-0.5 w-32 overflow-hidden rounded-full bg-neutral-700">
          <span className="block h-full bg-neutral-200 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${fraction * 100}%` }} />
        </span>
      </div>
      <DialogTextButton onClick={onCancel} className="text-xs">
        Cancel
      </DialogTextButton>
    </div>
  );
}

/**
 * Title and count on the left; sort, tile size and Select on the right,
 * with "Clear filters" while any are on and "Empty Trash" in the Trash.
 */
export function AssetsHeader() {
  const { filters, total, trashed, status, sort, tileSize, selectMode, job, setSort, setTileSize, setSelectMode, clearFilters, cancelJob } = useAssetStore(
    useShallow((state) => ({
      filters: state.filters,
      total: state.total,
      // Empty Trash empties all of it, whatever the filters show
      trashed: state.facets?.trash ?? state.total,
      status: state.status,
      sort: state.sort,
      tileSize: state.tileSize,
      selectMode: state.selectMode,
      job: state.job,
      setSort: state.setSort,
      setTileSize: state.setTileSize,
      setSelectMode: state.setSelectMode,
      clearFilters: state.clearFilters,
      cancelJob: state.cancelJob,
    })),
  );
  const filtered = hasActiveFilters(filters);
  const countLabel = status === "ready" || total > 0 ? formatCount(total) : status === "error" ? "Unavailable" : "Loading";

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 pl-8 pr-6 pt-5 pb-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate font-display text-[22px] font-bold leading-7 tracking-display text-neutral-100">{VIEW_TITLES[filters.view]}</h1>
        <DialogEyebrow aria-live="polite" className="shrink-0">
          {countLabel}
        </DialogEyebrow>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {job?.state === "running" && <JobProgress job={job} onCancel={() => void cancelJob()} />}
        {filtered && <DialogTextButton onClick={clearFilters}>Clear filters</DialogTextButton>}
        {filters.view === "trash" && trashed > 0 && (
          <DialogButton
            variant="danger"
            onClick={() => requestPermanentDelete({ mode: "query", query: { scope: "trash" }, excludeIds: [] }, trashed)}
          >
            Empty Trash
          </DialogButton>
        )}
        <Segmented label="Sort" options={SORT_OPTIONS} value={sort} onChange={setSort} className="w-[148px]" />
        <Segmented label="Tile size" options={SIZE_OPTIONS} value={tileSize} onChange={setTileSize} className="w-[96px]" />
        <button
          type="button"
          aria-pressed={selectMode}
          onClick={() => setSelectMode(!selectMode)}
          title={selectMode ? "Done selecting" : "Select assets"}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-display text-xs font-medium tracking-[-0.01em] transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection",
            selectMode ? "bg-neutral-200 text-neutral-900 hover:bg-white" : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100",
          )}
        >
          {selectMode ? <X size={14} strokeWidth={2} /> : <SquareCheck size={14} strokeWidth={1.75} />}
          {selectMode ? "Done" : "Select"}
        </button>
      </div>
    </header>
  );
}
