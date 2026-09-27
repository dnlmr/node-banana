/**
 * Moving project folders into the Node Banana folder (the "projects" job).
 *
 * One project at a time: copy the folder to `<root>/<name>` (numbered past
 * a taken name), checking every file's size; copy again whatever changed
 * in the source meanwhile (a recording landing in its generations folder);
 * point the library at the copy — records of its files, workflow rows,
 * snapshot references, the registry — and only then delete the source. A
 * source that can't be fully deleted leaves the copy in charge and is
 * reported as moved with leftovers, never as a failed job. Cancelling stops
 * between files and removes the copy of the project in progress; projects
 * already moved stay moved.
 */

import { promises as fs, type Dirent } from "fs";
import path from "path";
import type { MovedProject } from "../types";
import { errnoCode, LibraryError } from "./errors";
import { isInsideRoot, pathKey } from "./fsutil";
import type { JobContext } from "./jobs";
import { outermost, uniqueFolderName } from "./known";
import type { AssetLibrary } from "./library";
import type { ProjectRegistry } from "./registry";
import { normaliseProjectDir } from "./validate";

/** Most folders one move takes. */
export const MAX_MOVE_PROJECTS = 500;
/** Passes over a source for what changed while it was copied. */
const RESCAN_PASSES = 3;

export interface ProjectsMoveDeps {
  library: AssetLibrary;
  /** The Node Banana folder. */
  root: string;
  registry: ProjectRegistry;
  platform?: NodeJS.Platform;
}

interface Entry {
  /** Relative to the project folder. */
  rel: string;
  kind: "dir" | "file" | "link";
  size: number;
  mtimeMs: number;
}

/**
 * Checks and normalises the folders of a move: absolute, existing folders,
 * outside the Node Banana folder and not holding it; a folder inside
 * another in the list moves with it, so only the outermost are kept.
 */
export async function normaliseMoveDirs(value: unknown, root: string, platform: NodeJS.Platform = process.platform): Promise<string[]> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new LibraryError("Choose at least one project folder", 400, "bad_request");
  }
  if (value.length > MAX_MOVE_PROJECTS) throw new LibraryError("Too many folders", 400, "bad_request");
  const dirs: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const dir = normaliseProjectDir(entry, platform);
    const key = pathKey(dir, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    if (isInsideRoot(dir, root, { platform, allowEqual: true })) {
      throw new LibraryError(`"${dir}" holds the Node Banana folder, so it can't move into it.`, 400, "bad_request");
    }
    // Already in the Node Banana folder: nothing to move.
    if (isInsideRoot(root, dir, { platform })) continue;
    let stat: import("fs").Stats;
    try {
      stat = await fs.lstat(dir);
    } catch {
      throw new LibraryError(`"${dir}" doesn't exist.`, 404, "not_found");
    }
    if (!stat.isDirectory()) throw new LibraryError(`"${dir}" isn't a folder.`, 400, "bad_request");
    dirs.push(dir);
  }
  return outermost(dirs, platform);
}

/** Every folder, file and link under `dir`, parents before children. Links are listed, never followed. */
async function listTree(dir: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  const visit = async (rel: string): Promise<void> => {
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
    } catch (error) {
      // The project's own folder must be readable; a subfolder that went away mid-move is simply gone.
      if (!rel) throw error;
      return;
    }
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dirent of dirents) {
      const childRel = rel ? path.join(rel, dirent.name) : dirent.name;
      if (dirent.isDirectory()) {
        entries.push({ rel: childRel, kind: "dir", size: 0, mtimeMs: 0 });
        await visit(childRel);
      } else if (dirent.isSymbolicLink() || dirent.isFile()) {
        let stat: import("fs").Stats;
        try {
          stat = await fs.lstat(path.join(dir, childRel));
        } catch {
          continue;
        }
        entries.push({ rel: childRel, kind: dirent.isFile() ? "file" : "link", size: dirent.isFile() ? stat.size : 0, mtimeMs: stat.mtimeMs });
      }
    }
  };
  await visit("");
  return entries;
}

/** Copies one entry into `dest`; a file is checked by size once it is there. */
async function copyEntry(source: string, dest: string, entry: Entry): Promise<void> {
  const from = path.join(source, entry.rel);
  const to = path.join(dest, entry.rel);
  if (entry.kind === "dir") {
    await fs.mkdir(to, { recursive: true });
    return;
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  if (entry.kind === "link") {
    const target = await fs.readlink(from);
    await fs.rm(to, { force: true });
    try {
      await fs.symlink(target, to);
    } catch {
      // A link Windows won't let us make without rights: the copy goes on without it.
    }
    return;
  }
  // A rescan copies a changed file again, over the first copy.
  await fs.copyFile(from, to);
  const [copied, original] = await Promise.all([fs.stat(to), fs.stat(from)]);
  if (copied.size !== original.size) {
    throw new LibraryError(`The copy of ${entry.rel} didn't come out the same size. Nothing more was moved.`, 500, "copy_mismatch");
  }
}

/** The folder a project moves to: its own name in `root`, numbered past a taken one, created now. */
async function claimDestination(root: string, dir: string): Promise<string> {
  const base = path.basename(dir);
  for (let attempt = 0; attempt < 20; attempt++) {
    const { folder } = await uniqueFolderName(root, base);
    const dest = path.join(root, folder);
    try {
      await fs.mkdir(dest);
      return dest;
    } catch (error) {
      // Taken between the look and the claim: look again.
      if (errnoCode(error) !== "EEXIST") throw error;
    }
  }
  throw new LibraryError(`There's no free folder name for "${base}" in the Node Banana folder.`, 409, "conflict");
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Moves each folder into the Node Banana folder in turn; see the file comment. */
export async function runProjectsMove(ctx: JobContext, deps: ProjectsMoveDeps, dirs: readonly string[]): Promise<string> {
  const { library, root, registry } = deps;
  await library.ready();
  await fs.mkdir(root, { recursive: true });
  const plans: { dir: string; entries: Entry[] }[] = [];
  for (const dir of dirs) {
    ctx.checkCancelled();
    plans.push({ dir, entries: await listTree(dir) });
  }
  let total = 0;
  let bytesTotal = 0;
  for (const { entries } of plans) {
    for (const entry of entries) {
      if (entry.kind === "dir") continue;
      total++;
      bytesTotal += entry.size;
    }
  }
  ctx.update({ total, bytesTotal, moved: [] });

  const moved: MovedProject[] = [];
  for (const { dir, entries } of plans) {
    ctx.checkCancelled();
    const dest = await claimDestination(root, dir);
    try {
      for (const entry of entries) {
        ctx.checkCancelled();
        await copyEntry(dir, dest, entry);
        if (entry.kind !== "dir") {
          ctx.addBytes(entry.size);
          ctx.step();
        }
      }
      // What changed in the source while it was copied: a recording that landed, a save.
      await copyChanges(ctx, dir, dest, entries);
    } catch (error) {
      await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    // The copy is whole: the library follows it before the source goes.
    // Published, so a move of the library in the other build waits for these records.
    await library.writing(() => library.relocateExternal(dir, dest));
    await registry.relocate(dir, dest);
    // Anything that landed in the source during that, one last time. The project has moved
    // now, so a cancel no longer stops it; a copy that fails keeps the source whole.
    let leftovers = false;
    try {
      await copyChanges({ ...ctx, checkCancelled: () => {} }, dir, dest, await listTree(dest), true);
    } catch {
      leftovers = true;
    }
    if (!leftovers) {
      try {
        await fs.rm(dir, { recursive: true, force: false, maxRetries: 3 });
      } catch {
        leftovers = true;
      }
    }
    moved.push({ from: dir, to: dest, ...(leftovers ? { leftovers: true } : {}) });
    ctx.update({ moved: [...moved] });
  }

  const leftovers = moved.filter((project) => project.leftovers);
  const message = `Moved ${plural(moved.length, "project", "projects")} into ${path.basename(root)}.`;
  if (!leftovers.length) return message;
  return `${message} Some files could not be removed from ${plural(leftovers.length, "old folder", "old folders")} (${leftovers
    .map((project) => project.from)
    .join(", ")}); they are safe to delete.`;
}

/**
 * Copies what is new or changed in `dir` since `known` was listed (by size
 * and mtime), a few passes until nothing is. With `destKnown`, `known`
 * describes the destination, so every source file the destination lacks or
 * holds at another size is copied.
 */
async function copyChanges(ctx: JobContext, dir: string, dest: string, known: Entry[], destKnown = false): Promise<void> {
  let before = new Map(known.map((entry) => [entry.rel, entry]));
  for (let pass = 0; pass < RESCAN_PASSES; pass++) {
    ctx.checkCancelled();
    const now = await listTree(dir);
    const changed = now.filter((entry) => {
      const seen = before.get(entry.rel);
      if (!seen || seen.kind !== entry.kind) return true;
      if (entry.kind !== "file") return false;
      return destKnown ? seen.size !== entry.size : seen.size !== entry.size || seen.mtimeMs !== entry.mtimeMs;
    });
    if (!changed.length) return;
    for (const entry of changed) {
      ctx.checkCancelled();
      await copyEntry(dir, dest, entry);
    }
    before = new Map(now.map((entry) => [entry.rel, entry]));
    destKnown = false;
  }
}

