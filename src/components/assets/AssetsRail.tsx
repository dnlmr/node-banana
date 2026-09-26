"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useShallow } from "zustand/shallow";
import { cn } from "@/components/nodes/ui/cn";
import {
  DialogEyebrow,
  DialogFilterGroup,
  DialogFilterItem,
  DialogPane,
  DialogPaneRule,
  DialogSearchField,
  DialogTextButton,
  filterPaneClass,
} from "@/components/ui/Dialog";
import { ASSET_KINDS, ASSET_ORIGINS } from "@/lib/assets/types";
import { useAssetStore, type AssetDatePreset, type AssetFilterList, type AssetLibraryView } from "@/store/assetStore";
import { KIND_PLURALS, ORIGIN_LABELS, projectLabel, resolvePlatform, revealLabel, workflowLabel } from "./assetFormat";
import { changeLibraryLocation, revealLibrary } from "./assetActions";

const RAIL_WIDTH = 232;
/** Rows shown in a long group before "Show all". */
const COLLAPSED_ROWS = 5;

const DATE_OPTIONS: { value: AssetDatePreset; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

function Count({ children }: { children: ReactNode }) {
  return <span className="ml-auto pl-2 font-mono text-[11px] font-normal tabular-nums text-ink-3">{children}</span>;
}

interface Row {
  value: string;
  label: string;
  count?: number;
  title?: string;
}

/**
 * A multi-select group: rows toggle, OR within the group. Long lists show
 * the first few (and anything selected) until expanded. `collapsible`
 * groups start folded to their heading.
 */
function MultiGroup({
  label,
  list,
  rows,
  selected,
  collapsible = false,
}: {
  label: string;
  list: AssetFilterList;
  rows: Row[];
  selected: string[];
  collapsible?: boolean;
}) {
  const toggleFilter = useAssetStore((state) => state.toggleFilter);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(!collapsible);
  // Filters still on keep their row even when nothing matches them any more
  const all: Row[] = [
    ...rows,
    ...selected.filter((value) => !rows.some((row) => row.value === value)).map((value) => ({ value, label: value || "Not in a project" })),
  ];
  const shown = expanded ? all : all.filter((row, i) => i < COLLAPSED_ROWS || selected.includes(row.value));
  if (all.length === 0) return null;

  const body = (
    <>
      {shown.map((row) => (
        <DialogFilterItem
          key={row.value}
          active={selected.includes(row.value)}
          onClick={() => toggleFilter(list, row.value)}
          title={row.title ?? row.label}
        >
          <span className="min-w-0 truncate">{row.label}</span>
          {row.count !== undefined && <Count>{row.count.toLocaleString("en-US")}</Count>}
        </DialogFilterItem>
      ))}
      {all.length > COLLAPSED_ROWS && (expanded || all.length > shown.length) && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="h-6 self-start pl-[11px] font-mono text-[10px] uppercase tracking-eyebrow text-ink-3 hover:text-neutral-200"
        >
          {expanded ? "Show fewer" : `Show all ${all.length}`}
        </button>
      )}
    </>
  );

  if (!collapsible) return <DialogFilterGroup label={label}>{body}</DialogFilterGroup>;
  return (
    <div role="group" aria-label={label}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="mb-1 flex w-full items-center gap-1 pl-[11px] text-left"
      >
        <DialogEyebrow className="text-neutral-500">{label}</DialogEyebrow>
        {selected.length > 0 && <DialogEyebrow className="text-neutral-300">· {selected.length}</DialogEyebrow>}
        {open ? <ChevronDown size={12} className="ml-auto mr-1 text-neutral-500" /> : <ChevronRight size={12} className="ml-auto mr-1 text-neutral-500" />}
      </button>
      {open && <div className="flex flex-col">{body}</div>}
    </div>
  );
}

/**
 * The filter rail: search, the Library views, then the facets (types,
 * source, projects, workflows, models, tags, date). Groups narrow together;
 * rows within a group add up. The foot says where the files are, with Show
 * and Change….
 */
export function AssetsRail() {
  const { filters, facets, library, setSearch, setLibraryView, setFilters, clearFilterList } = useAssetStore(
    useShallow((state) => ({
      filters: state.filters,
      facets: state.facets,
      library: state.library,
      setSearch: state.setSearch,
      setLibraryView: state.setLibraryView,
      setFilters: state.setFilters,
      clearFilterList: state.clearFilterList,
    })),
  );

  const libraryRows: { view: AssetLibraryView; label: string; count?: number; hidden?: boolean }[] = [
    { view: "all", label: "All assets", count: facets?.total },
    { view: "favorites", label: "Favorites", count: facets?.favorites },
    { view: "missing", label: "Missing", count: facets?.missing, hidden: !facets?.missing && filters.view !== "missing" },
    { view: "trash", label: "Trash", count: facets?.trash },
  ];

  const projects: Row[] = (facets?.projects ?? []).map((project) => ({
    value: project.path ?? "",
    label: project.path ? project.name || projectLabel(project.path) : "Not in a project",
    count: project.count,
    title: project.path ?? "Not in a project",
  }));
  const workflows: Row[] = (facets?.workflows ?? []).map((workflow) => ({
    value: workflow.id,
    label: workflowLabel(workflow.name, workflow.lastAt),
    count: workflow.count,
  }));
  const models: Row[] = (facets?.models ?? []).map((model) => ({
    value: model.modelId,
    label: model.label || model.modelId,
    count: model.count,
    title: `${model.label || model.modelId} · ${model.provider}`,
  }));
  const tags: Row[] = (facets?.tags ?? []).map((tag) => ({ value: tag.tag, label: tag.tag, count: tag.count }));

  const platform = resolvePlatform(library);
  const root = library?.root;

  return (
    <DialogPane width={RAIL_WIDTH} className={cn(filterPaneClass, "z-[1]")}>
      <div className="-mx-4 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4">
        <DialogSearchField
          aria-label="Search assets"
          placeholder="Search prompts, tags, models…"
          value={filters.q}
          onChange={(event) => setSearch(event.target.value)}
        />

        <div className="mt-[18px] flex flex-col gap-3.5 pb-2">
          <DialogFilterGroup label="Library">
            {libraryRows
              .filter((row) => !row.hidden)
              .map((row) => (
                <DialogFilterItem key={row.view} active={filters.view === row.view} onClick={() => setLibraryView(row.view)}>
                  {row.label}
                  {row.count !== undefined && <Count>{row.count.toLocaleString("en-US")}</Count>}
                </DialogFilterItem>
              ))}
          </DialogFilterGroup>

          <DialogPaneRule />

          <DialogFilterGroup label="Type">
            <DialogFilterItem active={filters.kinds.length === 0} onClick={() => clearFilterList("kinds")}>
              All types
            </DialogFilterItem>
            {ASSET_KINDS.map((kind) => (
              <DialogFilterItem
                key={kind}
                active={filters.kinds.includes(kind)}
                onClick={() => useAssetStore.getState().toggleFilter("kinds", kind)}
              >
                {KIND_PLURALS[kind]}
                {facets && <Count>{facets.kinds[kind].toLocaleString("en-US")}</Count>}
              </DialogFilterItem>
            ))}
          </DialogFilterGroup>

          <MultiGroup
            label="Source"
            list="origins"
            selected={filters.origins}
            rows={ASSET_ORIGINS.map((origin) => ({ value: origin, label: ORIGIN_LABELS[origin], count: facets?.origins[origin] }))}
          />

          {(projects.length > 0 || filters.projects.length > 0) && <DialogPaneRule />}
          <MultiGroup label="Projects" list="projects" rows={projects} selected={filters.projects} />
          <MultiGroup label="Workflows" list="workflowIds" rows={workflows} selected={filters.workflowIds} collapsible />
          <MultiGroup label="Models" list="models" rows={models} selected={filters.models} />
          <MultiGroup label="Tags" list="tags" rows={tags} selected={filters.tags} />

          <DialogPaneRule />

          <DialogFilterGroup label="Date">
            {DATE_OPTIONS.map((option) => (
              <DialogFilterItem key={option.value} active={filters.date === option.value} onClick={() => setFilters({ date: option.value })}>
                {option.label}
              </DialogFilterItem>
            ))}
          </DialogFilterGroup>
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
