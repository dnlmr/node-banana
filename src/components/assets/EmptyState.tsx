"use client";

import { CircleAlert, FileWarning, LibraryBig, SearchX, Star, Trash2, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/shallow";
import { DialogButton, DialogTextButton } from "@/components/ui/Dialog";
import { loadSaveConfigs } from "@/store/utils/localStorage";
import { hasActiveFilters, useAssetStore } from "@/store/assetStore";
import { formatCount, resolvePlatform, revealLabel } from "./assetFormat";
import { changeLibraryLocation, importProjects, revealLibrary } from "./assetActions";

function Frame({ icon: Icon, title, children, actions }: { icon: LucideIcon; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 pb-16 text-center" data-testid="assets-empty">
      <Icon size={40} strokeWidth={1.25} className="mb-4 text-neutral-600" />
      <h2 className="font-display text-base font-semibold leading-6 tracking-[-0.01em] text-neutral-100">{title}</h2>
      {children && <div className="mt-1.5 max-w-md text-[13px] leading-5 text-ink-3">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}

/** Project folders this browser has saved workflows into, for the upgrade offer. */
function useSavedProjectDirs(): string[] {
  return useMemo(() => {
    try {
      const dirs = Object.values(loadSaveConfigs())
        .map((config) => config.directoryPath)
        .filter((dir): dir is string => typeof dir === "string" && dir.length > 0);
      return [...new Set(dirs)];
    } catch {
      return [];
    }
  }, []);
}

/**
 * What the view says when there is nothing to show: an unavailable
 * library, a fresh one (with an import offer for projects saved before the
 * library existed), filters that match nothing, an empty Trash, Favorites
 * or Missing list, or a failed load.
 */
export function EmptyState() {
  const { status, error, filters, library, facets, job, refresh, clearFilters, setAppView } = useAssetStore(
    useShallow((state) => ({
      status: state.status,
      error: state.error,
      filters: state.filters,
      library: state.library,
      facets: state.facets,
      job: state.job,
      refresh: state.refresh,
      clearFilters: state.clearFilters,
      setAppView: state.setAppView,
    })),
  );
  const projectDirs = useSavedProjectDirs();
  const reveal = revealLabel(resolvePlatform(library));

  if (library && !library.available) {
    return (
      <Frame icon={CircleAlert} title="The asset library is not available" actions={library.source !== "env" && <DialogButton variant="outline" onClick={changeLibraryLocation}>Change…</DialogButton>}>
        {library.reason ?? "Generations cannot be saved or browsed on this server."}
      </Frame>
    );
  }

  if (status === "error") {
    return (
      <Frame icon={CircleAlert} title="Assets could not be loaded" actions={<DialogButton variant="outline" onClick={() => void refresh()}>Try again</DialogButton>}>
        {error}
      </Frame>
    );
  }

  if (hasActiveFilters(filters)) {
    return (
      <Frame icon={SearchX} title="No assets match" actions={<DialogTextButton onClick={clearFilters}>Clear filters</DialogTextButton>}>
        Try another search, or fewer filters.
      </Frame>
    );
  }

  if (filters.view === "trash") {
    return (
      <Frame icon={Trash2} title="Trash is empty">
        Items in Trash are deleted after 30 days.
      </Frame>
    );
  }

  if (filters.view === "missing") {
    return (
      <Frame icon={FileWarning} title="No missing files">
        Every asset&apos;s file is where it was saved.
      </Frame>
    );
  }

  if (filters.view === "favorites") {
    return (
      <Frame icon={Star} title="No favorites yet">
        Star an asset to keep it here.
      </Frame>
    );
  }

  // A fresh library (or one whose live assets are all in the Trash)
  const importing = job?.type === "import" && job.state === "running";
  const inTrash = facets?.trash ?? 0;
  return (
    <Frame
      icon={LibraryBig}
      title="Nothing saved yet"
      actions={
        <>
          {projectDirs.length > 0 && (
            <DialogButton variant="primary" size="md" disabled={importing} onClick={() => void importProjects(projectDirs)}>
              Import generations from your {formatCount(projectDirs.length, "project")}
            </DialogButton>
          )}
          {library?.root && (
            <DialogButton variant="outline" onClick={() => void revealLibrary()}>
              {reveal}
            </DialogButton>
          )}
          <DialogButton variant="ghost" onClick={() => setAppView("canvas")}>
            Back to canvas
          </DialogButton>
        </>
      }
    >
      Every image, video, sound and 3D model you generate or edit is saved
      {library?.root ? (
        <>
          {" "}to <span className="font-mono text-[12px] text-neutral-300">{library.root}</span>
        </>
      ) : null}
      , whether or not the workflow is a project. It shows up here, with its prompt and the workflow that made it.
      {inTrash > 0 && <span className="mt-2 block">{formatCount(inTrash)} in Trash.</span>}
    </Frame>
  );
}
