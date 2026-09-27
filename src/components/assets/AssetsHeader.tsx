"use client";

import { ArrowDownUp, Check, ChevronDown, Grid3x3, LayoutGrid, Square, SquareCheck } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useShallow } from "zustand/shallow";
import { cn } from "@/components/nodes/ui/cn";
import { DialogButton, DialogTextButton } from "@/components/ui/Dialog";
import { MenuItem, MenuSectionLabel, MenuSurface } from "@/components/ui/Menu";
import { hasActiveFilters, useAssetStore, type AssetLibraryView, type AssetTileSize } from "@/store/assetStore";
import type { AssetFacets, AssetSort, LibraryJobStatus } from "@/lib/assets/types";
import { formatCount } from "./assetFormat";
import { requestPermanentDelete } from "./assetActions";

const VIEW_TITLES: Record<AssetLibraryView, string> = {
  all: "Assets",
  favorites: "Favorites",
  missing: "Missing files",
  trash: "Trash",
};

const SORT_LABELS: Record<AssetSort, string> = { newest: "Newest", oldest: "Oldest" };
const SORT_OPTIONS: { value: AssetSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

const SIZE_OPTIONS: { value: AssetTileSize; label: string; Icon: typeof Grid3x3 }[] = [
  { value: "s", label: "Small tiles", Icon: Grid3x3 },
  { value: "m", label: "Medium tiles", Icon: LayoutGrid },
  { value: "l", label: "Large tiles", Icon: Square },
];

const JOB_VERBS: Record<LibraryJobStatus["type"], string> = {
  export: "Exporting",
  import: "Importing",
  move: "Moving library",
  cleanup: "Cleaning up",
  projects: "Moving projects",
};

const SORT_MENU_WIDTH = 176;
const EDGE = 8;
const SORT_TRIGGER = "data-assets-sort-trigger";

/** The quiet 28px surface every header control shares. */
const toolClass = cn(
  "flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5 font-display text-xs font-medium tracking-[-0.01em] transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection",
);
const quietTool = "border-white/[0.09] bg-white/[0.03] text-neutral-300 hover:border-white/[0.18] hover:text-neutral-100";

/** How many assets the Library view holds before filters, for "37 of 383". */
function viewTotal(view: AssetLibraryView, facets: AssetFacets | null): number | null {
  if (!facets) return null;
  if (view === "favorites") return facets.favorites;
  if (view === "trash") return facets.trash;
  if (view === "missing") return facets.missing;
  return facets.total;
}

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
 * The header's sort menu, a popover of the view (Escape closes it there).
 * Arrow keys move between the two choices; choosing one closes it.
 */
export function AssetsSortMenu({ x, y }: { x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const sort = useAssetStore((state) => state.sort);
  const setSort = useAssetStore((state) => state.setSort);
  const closePopover = useAssetStore((state) => state.closePopover);
  const [position, setPosition] = useState({ left: x, top: y });

  const backToTrigger = () =>
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[${SORT_TRIGGER}]`)?.focus({ preventScroll: true }));

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    setPosition({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - SORT_MENU_WIDTH - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    });
  }, [x, y]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    // The trigger toggles the menu itself; a press on it is not "outside"
    const outside = (target: EventTarget | null) =>
      !!ref.current && !ref.current.contains(target as Node) && !(target as Element | null)?.closest?.(`[${SORT_TRIGGER}]`);
    const onPointerDown = (event: MouseEvent) => {
      if (outside(event.target)) closePopover();
    };
    const onWheel = (event: WheelEvent) => {
      if (outside(event.target)) closePopover();
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("resize", closePopover);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", closePopover);
    };
  }, [closePopover]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const index = rows.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % rows.length;
    else if (event.key === "ArrowUp") next = index <= 0 ? rows.length - 1 : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    else if (event.key === "Tab") {
      event.preventDefault();
      closePopover();
      backToTrigger();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    rows[next]?.focus();
  };

  return (
    <MenuSurface
      ref={ref}
      role="menu"
      aria-label="Sort"
      onKeyDown={onKeyDown}
      className="py-1"
      style={{ left: position.left, top: position.top, width: SORT_MENU_WIDTH }}
    >
      <MenuSectionLabel className="px-2.5 pb-1 pt-1.5">Sort by date</MenuSectionLabel>
      {SORT_OPTIONS.map((option) => {
        const active = option.value === sort;
        return (
          <MenuItem
            key={option.value}
            role="menuitemradio"
            aria-checked={active}
            onClick={() => {
              setSort(option.value);
              closePopover();
              backToTrigger();
            }}
          >
            <span className="truncate">{option.label}</span>
            {active && <Check size={14} strokeWidth={2} className="ml-auto shrink-0 text-neutral-100" />}
          </MenuItem>
        );
      })}
    </MenuSurface>
  );
}

/**
 * Title and count on the left ("37 of 383" while filters narrow the view);
 * on the right one row of quiet 28px controls: the sort menu, tile size, and
 * Select (Done while selecting). A running library job and, in the Trash,
 * Empty Trash come first.
 */
export function AssetsHeader() {
  const { filters, facets, total, status, sort, tileSize, selectMode, job, popover, setTileSize, setSelectMode, cancelJob, openPopover, closePopover } =
    useAssetStore(
      useShallow((state) => ({
        filters: state.filters,
        facets: state.facets,
        total: state.total,
        status: state.status,
        sort: state.sort,
        tileSize: state.tileSize,
        selectMode: state.selectMode,
        job: state.job,
        popover: state.popover,
        setTileSize: state.setTileSize,
        setSelectMode: state.setSelectMode,
        cancelJob: state.cancelJob,
        openPopover: state.openPopover,
        closePopover: state.closePopover,
      })),
    );
  const sortOpen = popover?.kind === "sort";
  // Empty Trash empties all of it, whatever the filters show
  const trashed = facets?.trash ?? total;
  const base = viewTotal(filters.view, facets);
  const ready = status === "ready" || total > 0;
  const narrowed = ready && hasActiveFilters(filters) && base !== null && base !== total;

  const toggleSort = (button: HTMLButtonElement) => {
    if (sortOpen) {
      closePopover();
      return;
    }
    const rect = button.getBoundingClientRect();
    openPopover({ kind: "sort", x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 pl-8 pr-6 pt-4 pb-2">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="truncate font-display text-xl font-bold leading-7 tracking-display text-neutral-100">{VIEW_TITLES[filters.view]}</h1>
        <span aria-live="polite" className="shrink-0 whitespace-nowrap font-display text-[13px] font-medium text-neutral-500">
          {narrowed ? (
            <>
              <span className="font-semibold text-neutral-400">{total.toLocaleString("en-US")}</span> of {base!.toLocaleString("en-US")}
            </>
          ) : ready ? (
            formatCount(total)
          ) : status === "error" ? (
            "Unavailable"
          ) : (
            "Loading"
          )}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {job?.state === "running" && <JobProgress job={job} onCancel={() => void cancelJob()} />}
        {filters.view === "trash" && trashed > 0 && (
          <DialogButton
            variant="danger"
            size="sm"
            onClick={() => requestPermanentDelete({ mode: "query", query: { scope: "trash" }, excludeIds: [] }, trashed)}
          >
            Empty Trash
          </DialogButton>
        )}

        <button
          type="button"
          {...{ [SORT_TRIGGER]: "" }}
          aria-haspopup="menu"
          aria-expanded={sortOpen}
          aria-label={`Sort: ${SORT_LABELS[sort]} first`}
          onClick={(event) => toggleSort(event.currentTarget)}
          className={cn(toolClass, quietTool, sortOpen && "border-white/[0.18] text-neutral-100")}
        >
          <ArrowDownUp size={14} strokeWidth={1.75} className="text-ink-3" />
          {SORT_LABELS[sort]}
          <ChevronDown size={12} strokeWidth={2} className="text-neutral-500" />
        </button>

        <div role="group" aria-label="Tile size" className="flex gap-0.5 rounded-[7px] border border-white/[0.09] bg-white/[0.03] p-0.5">
          {SIZE_OPTIONS.map(({ value, label, Icon }) => {
            const active = tileSize === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                aria-label={label}
                title={label}
                onClick={() => setTileSize(value)}
                className={cn(
                  "flex h-[22px] w-6 items-center justify-center rounded-[5px] transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection",
                  active ? "bg-white/10 text-neutral-100" : "text-neutral-500 hover:text-neutral-200",
                )}
              >
                <Icon size={14} strokeWidth={1.75} />
              </button>
            );
          })}
        </div>

        <span aria-hidden="true" className="mx-1 h-[18px] w-px bg-white/[0.08]" />

        <button
          type="button"
          aria-pressed={selectMode}
          onClick={() => setSelectMode(!selectMode)}
          title={selectMode ? "Done selecting" : "Select assets"}
          className={cn(
            toolClass,
            selectMode ? "border-neutral-200 bg-neutral-200 font-semibold text-neutral-900 hover:bg-white" : quietTool,
          )}
        >
          {selectMode ? <Check size={14} strokeWidth={2} /> : <SquareCheck size={14} strokeWidth={1.75} className="text-ink-3" />}
          {selectMode ? "Done" : "Select"}
        </button>
      </div>
    </header>
  );
}
