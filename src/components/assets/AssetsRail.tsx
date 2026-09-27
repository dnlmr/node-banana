"use client";

import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { useShallow } from "zustand/shallow";
import { cn } from "@/components/nodes/ui/cn";
import {
  DialogEyebrow,
  DialogFilterItem,
  DialogPane,
  DialogPaneRule,
  DialogSearchField,
  DialogTextButton,
  filterPaneClass,
} from "@/components/ui/Dialog";
import { ASSET_KINDS } from "@/lib/assets/types";
import {
  useAssetStore,
  type AssetDatePreset,
  type AssetFilterList,
  type AssetFilters,
  type AssetLibraryView,
} from "@/store/assetStore";
import { KIND_PLURALS, projectLabel, resolvePlatform, revealLabel, workflowLabel } from "./assetFormat";
import { changeLibraryLocation, revealLibrary } from "./assetActions";

const RAIL_WIDTH = 232;
/** Rows shown in a long group before "Show all". */
const COLLAPSED_ROWS = 5;
/** Which filter groups the viewer left open (per browser). */
export const RAIL_OPEN_KEY = "node-banana-assets-rail-open";

const DATE_OPTIONS: { value: AssetDatePreset; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

type GroupKey = "type" | "projects" | "workflows" | "models" | "tags" | "date";
const DEFAULT_OPEN: Record<GroupKey, boolean> = {
  type: true,
  projects: false,
  workflows: false,
  models: false,
  tags: false,
  date: false,
};

/** Everything but the Library view and the search: what "Clear all" resets. */
const CLEARED: Partial<AssetFilters> = { kinds: [], origins: [], projects: [], workflowIds: [], models: [], tags: [], date: "any" };

function readOpen(): Record<GroupKey, boolean> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(RAIL_OPEN_KEY) ?? "null") as Partial<Record<GroupKey, unknown>> | null;
    if (!stored || typeof stored !== "object") return DEFAULT_OPEN;
    const open = { ...DEFAULT_OPEN };
    for (const key of Object.keys(DEFAULT_OPEN) as GroupKey[]) {
      if (typeof stored[key] === "boolean") open[key] = stored[key] as boolean;
    }
    return open;
  } catch {
    return DEFAULT_OPEN;
  }
}

/** Open groups, remembered across visits. */
function useOpenGroups(): [Record<GroupKey, boolean>, (key: GroupKey) => void] {
  const [open, setOpen] = useState(readOpen);
  const toggle = useCallback((key: GroupKey) => {
    setOpen((current) => {
      const next = { ...current, [key]: !current[key] };
      try {
        window.localStorage.setItem(RAIL_OPEN_KEY, JSON.stringify(next));
      } catch {
        // Remembered for this visit only
      }
      return next;
    });
  }, []);
  return [open, toggle];
}

function Count({ children }: { children: ReactNode }) {
  return <span className="ml-auto pl-2 font-mono text-[11px] font-normal tabular-nums text-ink-3">{children}</span>;
}

interface Row {
  value: string;
  label: string;
  count?: number;
  title?: string;
}

/** A filter that is on, as a removable chip. */
interface ActiveFilter {
  id: string;
  kind: string;
  label: string;
  remove: () => void;
}

function FilterChip({ filter }: { filter: ActiveFilter }) {
  return (
    <button
      type="button"
      onClick={filter.remove}
      aria-label={`Remove filter: ${filter.label}`}
      title={`${filter.kind}: ${filter.label}`}
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-white/10 bg-canvas-bg pl-[9px] pr-1",
        "font-display text-xs font-medium text-neutral-200 transition-colors hover:border-white/20",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection",
      )}
    >
      <span className="min-w-0 truncate">{filter.label}</span>
      <X size={12} strokeWidth={2} className="shrink-0 text-neutral-400" />
    </button>
  );
}

/**
 * A group that folds from its header: chevron, name, how many of its
 * filters are on, and how many it offers.
 */
function FilterGroup({
  label,
  open,
  onToggle,
  activeCount,
  total,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  activeCount: number;
  total?: number;
  children: ReactNode;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div role="group" aria-label={label} className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "flex h-[30px] w-full items-center gap-2 rounded-md pl-[7px] pr-2 text-left",
          "font-display text-[13px] font-semibold tracking-[-0.01em] text-neutral-300 transition-colors",
          "hover:bg-white/[0.03] hover:text-neutral-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection",
        )}
      >
        <Chevron size={14} strokeWidth={2} className="shrink-0 text-neutral-500" />
        <span className="min-w-0 truncate">{label}</span>
        {activeCount > 0 && (
          <span
            className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-neutral-200 px-[5px] font-mono text-[10px] font-medium text-neutral-950"
            aria-label={`${activeCount} on`}
          >
            {activeCount}
          </span>
        )}
        {total !== undefined && <span className="ml-auto font-mono text-[11px] font-normal tabular-nums text-neutral-500">{total}</span>}
      </button>
      {open && <div className="flex flex-col pb-2 pl-[18px]">{children}</div>}
    </div>
  );
}

/**
 * A multi-select list: rows toggle, OR within the group. Long lists show the
 * first few (and anything selected) until expanded.
 */
function MultiRows({
  list,
  rows,
  selected,
  empty,
}: {
  list: AssetFilterList;
  rows: Row[];
  selected: string[];
  empty?: string;
}) {
  const toggleFilter = useAssetStore((state) => state.toggleFilter);
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return empty ? <p className="px-[11px] pb-1 pt-0.5 text-xs leading-4 text-neutral-500">{empty}</p> : null;
  const shown = expanded ? rows : rows.filter((row, i) => i < COLLAPSED_ROWS || selected.includes(row.value));

  return (
    <>
      {shown.map((row) => {
        const active = selected.includes(row.value);
        return (
          <DialogFilterItem
            key={row.value}
            active={active}
            onClick={() => toggleFilter(list, row.value)}
            title={row.title ?? row.label}
            className={cn(!active && row.count === 0 && "text-neutral-600")}
          >
            <span className="min-w-0 truncate">{row.label}</span>
            {row.count !== undefined && <Count>{row.count.toLocaleString("en-US")}</Count>}
          </DialogFilterItem>
        );
      })}
      {rows.length > COLLAPSED_ROWS && (expanded || rows.length > shown.length) && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="h-6 self-start pl-[11px] font-mono text-[10px] uppercase tracking-eyebrow text-ink-3 hover:text-neutral-200"
        >
          {expanded ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}

/** Rows for a list, plus any filter still on that no row offers any more. */
function withSelected(rows: Row[], selected: string[], label: (value: string) => string): Row[] {
  return [...rows, ...selected.filter((value) => !rows.some((row) => row.value === value)).map((value) => ({ value, label: label(value) }))];
}

/**
 * The filter rail: search, then the filters that are on as removable chips,
 * the Library views, and the facets (type, projects, workflows, models, tags,
 * date), each folding from its header. Groups narrow together; rows within a
 * group add up. The foot says where the files are, with Show and Change….
 */
export function AssetsRail() {
  const { filters, facets, library, setSearch, setLibraryView, setFilters, toggleFilter } = useAssetStore(
    useShallow((state) => ({
      filters: state.filters,
      facets: state.facets,
      library: state.library,
      setSearch: state.setSearch,
      setLibraryView: state.setLibraryView,
      setFilters: state.setFilters,
      toggleFilter: state.toggleFilter,
    })),
  );
  const [open, toggleOpen] = useOpenGroups();

  const libraryRows: { view: AssetLibraryView; label: string; count?: number; hidden?: boolean }[] = [
    { view: "all", label: "All assets", count: facets?.total },
    { view: "favorites", label: "Favorites", count: facets?.favorites },
    { view: "missing", label: "Missing", count: facets?.missing, hidden: !facets?.missing && filters.view !== "missing" },
    { view: "trash", label: "Trash", count: facets?.trash },
  ];

  const typeRows: Row[] = ASSET_KINDS.map((kind) => ({ value: kind, label: KIND_PLURALS[kind], count: facets?.kinds[kind] }));
  const projects = withSelected(
    (facets?.projects ?? []).map((project) => ({
      value: project.path ?? "",
      label: project.path ? project.name || projectLabel(project.path) : "Not in a project",
      count: project.count,
      title: project.path ?? "Not in a project",
    })),
    filters.projects,
    (value) => (value ? projectLabel(value) : "Not in a project"),
  );
  const workflows = withSelected(
    (facets?.workflows ?? []).map((workflow) => ({
      value: workflow.id,
      label: workflowLabel(workflow.name, workflow.lastAt),
      count: workflow.count,
    })),
    filters.workflowIds,
    (value) => value,
  );
  const models = withSelected(
    (facets?.models ?? []).map((model) => ({
      value: model.modelId,
      label: model.label || model.modelId,
      count: model.count,
      title: `${model.label || model.modelId} · ${model.provider}`,
    })),
    filters.models,
    (value) => value,
  );
  const tags = withSelected(
    (facets?.tags ?? []).map((tag) => ({ value: tag.tag, label: tag.tag, count: tag.count })),
    filters.tags,
    (value) => value,
  );

  const labelIn = (rows: Row[], value: string) => rows.find((row) => row.value === value)?.label ?? value;
  const chipsFor = (list: AssetFilterList, kind: string, rows: Row[]): ActiveFilter[] =>
    (filters[list] as string[]).map((value) => ({
      id: `${list}:${value}`,
      kind,
      label: labelIn(rows, value),
      remove: () => toggleFilter(list, value),
    }));
  const active: ActiveFilter[] = [
    ...chipsFor("kinds", "Type", typeRows),
    ...chipsFor("projects", "Project", projects),
    ...chipsFor("workflowIds", "Workflow", workflows),
    ...chipsFor("models", "Model", models),
    ...chipsFor("tags", "Tag", tags),
    ...(filters.date !== "any"
      ? [
          {
            id: "date",
            kind: "Date",
            label: DATE_OPTIONS.find((option) => option.value === filters.date)?.label ?? filters.date,
            remove: () => setFilters({ date: "any" }),
          },
        ]
      : []),
  ];

  const platform = resolvePlatform(library);
  const root = library?.root;

  return (
    <DialogPane width={RAIL_WIDTH} className={cn(filterPaneClass, "z-[1]")}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DialogSearchField
          aria-label="Search assets"
          placeholder="Search prompts, tags, models…"
          value={filters.q}
          onChange={(event) => setSearch(event.target.value)}
        />

        {active.length > 0 && (
          <div role="group" aria-label="Filters on" className="mt-3.5 flex shrink-0 flex-col gap-2 border-b border-white/[0.06] pb-3">
            <div className="flex items-center pl-[11px]">
              <DialogEyebrow className="text-neutral-500">Filtering by</DialogEyebrow>
              <DialogTextButton onClick={() => setFilters(CLEARED)} className="ml-auto h-5 text-xs">
                Clear all
              </DialogTextButton>
            </div>
            <div className="flex flex-wrap gap-1.5 pl-[7px] pr-1">
              {active.map((filter) => (
                <FilterChip key={filter.id} filter={filter} />
              ))}
            </div>
          </div>
        )}

        <div className="-mx-4 mt-3.5 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-2">
          <div role="group" aria-label="Library" className="flex flex-col">
            {libraryRows
              .filter((row) => !row.hidden)
              .map((row) => (
                <DialogFilterItem key={row.view} active={filters.view === row.view} onClick={() => setLibraryView(row.view)}>
                  {row.label}
                  {row.count !== undefined && <Count>{row.count.toLocaleString("en-US")}</Count>}
                </DialogFilterItem>
              ))}
          </div>

          <DialogPaneRule className="my-2 shrink-0" />

          <div className="flex flex-col gap-0.5">
            <FilterGroup label="Type" open={open.type} onToggle={() => toggleOpen("type")} activeCount={filters.kinds.length}>
              <MultiRows list="kinds" rows={typeRows} selected={filters.kinds} />
            </FilterGroup>
            <FilterGroup
              label="Projects"
              open={open.projects}
              onToggle={() => toggleOpen("projects")}
              activeCount={filters.projects.length}
              total={projects.length}
            >
              <MultiRows list="projects" rows={projects} selected={filters.projects} empty="No projects yet." />
            </FilterGroup>
            <FilterGroup
              label="Workflows"
              open={open.workflows}
              onToggle={() => toggleOpen("workflows")}
              activeCount={filters.workflowIds.length}
              total={workflows.length}
            >
              <MultiRows list="workflowIds" rows={workflows} selected={filters.workflowIds} empty="No workflows yet." />
            </FilterGroup>
            <FilterGroup
              label="Models"
              open={open.models}
              onToggle={() => toggleOpen("models")}
              activeCount={filters.models.length}
              total={models.length}
            >
              <MultiRows list="models" rows={models} selected={filters.models} empty="No models yet." />
            </FilterGroup>
            <FilterGroup
              label="Tags"
              open={open.tags}
              onToggle={() => toggleOpen("tags")}
              activeCount={filters.tags.length}
              total={tags.length}
            >
              <MultiRows list="tags" rows={tags} selected={filters.tags} empty="No tags yet. Add them from an asset's details." />
            </FilterGroup>
            <FilterGroup label="Date" open={open.date} onToggle={() => toggleOpen("date")} activeCount={filters.date === "any" ? 0 : 1}>
              {DATE_OPTIONS.map((option) => (
                <DialogFilterItem key={option.value} active={filters.date === option.value} onClick={() => setFilters({ date: option.value })}>
                  {option.label}
                </DialogFilterItem>
              ))}
            </FilterGroup>
          </div>
        </div>
      </div>

      {/* Where the files are */}
      <div className="flex shrink-0 flex-col gap-1 border-t border-white/[0.06] px-[11px] pt-2.5">
        <DialogEyebrow className="text-neutral-500">{library && !library.available ? "Library unavailable" : "Saved to"}</DialogEyebrow>
        <span
          className="truncate font-mono text-[11px] leading-4 text-neutral-300"
          title={library && !library.available ? library.reason : root ?? undefined}
          dir="rtl"
        >
          {/* rtl keeps the folder's own name visible when the path is cut */}
          <bdi>{library && !library.available ? library.reason ?? "Not available" : root ?? "…"}</bdi>
        </span>
        <div className="-ml-1.5 flex items-center gap-1">
          {root && library?.available && (
            <DialogTextButton onClick={() => void revealLibrary()} className="text-xs" title={revealLabel(platform)}>
              Show
            </DialogTextButton>
          )}
          {library?.source !== "env" && (
            <DialogTextButton onClick={changeLibraryLocation} className="text-xs">
              Change…
            </DialogTextButton>
          )}
        </div>
      </div>
    </DialogPane>
  );
}
