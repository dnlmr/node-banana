/**
 * Following a projects move on this page. The server moves a project folder
 * into the Node Banana folder and deletes the original; everything this page
 * still holds under the old folder — the open canvas and parked tabs, the
 * saved configs in localStorage, the recorder's runs — is pointed at the new
 * one, or the next autosave and recording would make the old folder again.
 *
 * Fed with every job and library status the page sees (a job reports its
 * `moved` projects as each one finishes), so it runs whether Settings, the
 * Assets view, Bring-in or nothing at all was watching the move. Each move
 * is applied once.
 */

import { useWorkflowStore } from "@/store/workflowStore";
import { loadSaveConfigs, saveSaveConfig } from "@/store/utils/localStorage";
import type { LibraryJobStatus, LibraryStatus, MovedProject } from "../types";
import { rebaseProjectPath } from "./projects";
import { onLibraryStatus, rebaseRunProjects } from "./recorder";

const applied = new Set<string>();

interface ProjectPaths {
  saveDirectoryPath: string | null;
  generationsPath: string | null;
  imageRefBasePath: string | null;
}

/** The fields of `state` that change, or null when none does. */
function rebased(state: ProjectPaths, from: string, to: string): Partial<ProjectPaths> | null {
  const patch: Partial<ProjectPaths> = {};
  for (const key of ["saveDirectoryPath", "generationsPath", "imageRefBasePath"] as const) {
    const moved = rebaseProjectPath(from, to, state[key]);
    if (moved) patch[key] = moved;
  }
  return Object.keys(patch).length ? patch : null;
}

function applyMove({ from, to }: MovedProject): void {
  const store = useWorkflowStore.getState();
  const live = rebased(store, from, to);
  let tabsChanged = false;
  const tabs = store.tabs.map((tab) => {
    const patch = tab.snapshot ? rebased(tab.snapshot, from, to) : null;
    if (!patch || !tab.snapshot) return tab;
    tabsChanged = true;
    return { ...tab, snapshot: { ...tab.snapshot, ...patch } };
  });
  if (live || tabsChanged) useWorkflowStore.setState({ ...(live ?? {}), ...(tabsChanged ? { tabs } : {}) });

  try {
    for (const config of Object.values(loadSaveConfigs())) {
      if (!config) continue;
      const directoryPath = rebaseProjectPath(from, to, config.directoryPath);
      const generationsPath = rebaseProjectPath(from, to, config.generationsPath);
      if (!directoryPath && !generationsPath) continue;
      saveSaveConfig({
        ...config,
        ...(directoryPath ? { directoryPath } : {}),
        ...(generationsPath ? { generationsPath } : {}),
      });
    }
  } catch (error) {
    console.warn("Couldn't update the saved project folders after a move:", error);
  }

  rebaseRunProjects(from, to);
}

/** Points this page at the new folders of every project `job` has moved so far. */
export function followMovedProjects(job: LibraryJobStatus | null | undefined): void {
  if (!job?.moved?.length) return;
  for (const move of job.moved) {
    const key = `${move.from}\0${move.to}`;
    if (applied.has(key)) continue;
    applied.add(key);
    applyMove(move);
  }
}

let watching = false;

/** Follows the moves in every library status the page receives from now on. Idempotent. */
export function watchMovedProjects(status?: LibraryStatus | null): void {
  followMovedProjects(status?.job);
  if (watching) return;
  watching = true;
  onLibraryStatus((next) => followMovedProjects(next.job));
}

/** Tests only: forget which moves were applied. */
export function __resetMovedProjectsForTests(): void {
  applied.clear();
}
