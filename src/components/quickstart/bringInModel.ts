/**
 * The words and groupings of the Bring-in view, kept apart from the view
 * so they can be tested without rendering it.
 */

import type { FoundProject, LibraryJobStatus } from "@/lib/assets/types";

export type BringInMode = "use" | "move" | "leave";

/** A path's separators as "/" and without a trailing one, for comparing. */
function normalise(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isInside(dir: string, parent: string): boolean {
  const child = normalise(dir);
  const base = normalise(parent);
  return child === base || child.startsWith(`${base}/`);
}

/** `dir` relative to `root`, "/"-separated; the empty string for the root itself. */
function relativeTo(dir: string, root: string): string {
  const child = normalise(dir);
  const base = normalise(root);
  if (child === base) return "";
  return child.startsWith(`${base}/`) ? child.slice(base.length + 1) : child;
}

/** The last segment of a path. */
export function folderName(path: string): string {
  return normalise(path).split("/").filter(Boolean).pop() || path;
}

/**
 * The folder's groups when its projects sit in several places: one per
 * parent of an outermost project ("test-files › test workflows"), or the
 * project's own name when it sits at the top of the folder. Nested
 * projects count in their outermost project's group. Largest first, then
 * by name.
 */
export function groupFoundProjects(root: string, projects: FoundProject[]): { label: string; count: number }[] {
  const sorted = [...projects].sort((a, b) => normalise(a.dir).length - normalise(b.dir).length);
  const outermost: string[] = [];
  const groups = new Map<string, { label: string; count: number }>();
  for (const project of sorted) {
    let owner = outermost.find((dir) => isInside(project.dir, dir));
    if (!owner) {
      owner = project.dir;
      outermost.push(owner);
    }
    const parts = relativeTo(owner, root).split("/").filter(Boolean);
    const key = (parts.length > 1 ? parts.slice(0, -1) : parts).join("/") || folderName(owner);
    const group = groups.get(key) ?? { label: key.split("/").join(" › "), count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  // A group inside another folds into it: "workflows › nood-prod" counts under "workflows"
  const keys = [...groups.keys()].sort((a, b) => a.length - b.length);
  for (const key of keys) {
    const ancestor = keys.find((other) => other !== key && key.startsWith(`${other}/`) && groups.has(other));
    if (!ancestor) continue;
    groups.get(ancestor)!.count += groups.get(key)!.count;
    groups.delete(key);
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/** Where a projects move stands for one found project: moved, being moved, or waiting. */
export type MoveRowState = "done" | "now" | "wait";

/**
 * Each found project's state in a running or finished projects move: done
 * once its folder (or the folder it sits in) has moved; the first one not
 * yet done is the one moving while the job runs.
 */
export function moveRowStates(projects: FoundProject[], job: LibraryJobStatus | null): MoveRowState[] {
  const moved = job?.moved?.map((entry) => entry.from) ?? [];
  const done = projects.map((project) => moved.some((from) => isInside(project.dir, from)));
  const running = job?.state === "running";
  const now = running ? done.indexOf(false) : -1;
  return done.map((isDone, index) => (isDone ? "done" : index === now ? "now" : "wait"));
}

/** How far the move is, 0–100: by bytes when the job counts them, else by files. */
export function movePercent(job: LibraryJobStatus): number {
  const fraction = job.bytesTotal > 0 ? job.bytesDone / job.bytesTotal : job.total > 0 ? job.done / job.total : 0;
  return Math.max(0, Math.min(100, Math.floor(fraction * 100)));
}
