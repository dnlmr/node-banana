/**
 * Finding the Node Banana projects under a folder the user picked, for
 * "Import generations from existing projects". A project is a folder with a
 * direct `generations` subfolder holding at least one media file, however
 * deeply it is nested. Nothing is written.
 *
 * The walk is breadth-first and bounded (depth, folders visited, projects
 * found, time), so a whole drive answers in seconds and says it stopped
 * early rather than hanging. It never follows a symbolic link or a Windows
 * junction, which also rules out loops, and it skips what can't hold a
 * project: hidden folders, package and build folders, the library's own
 * data, system folders and paths too long for an import to take, and a
 * project's own media folders. A project's other subfolders are still
 * searched, since projects can nest.
 */

import { promises as fs, type Dirent } from "fs";
import path from "path";
import { validateWorkflowPath } from "@/utils/pathValidation";
import { FOUND_MEDIA_COUNT_CAP, MAX_IMPORT_PROJECTS, type FoundProject, type ScanProjectsResult } from "../types";
import { errnoCode, LibraryError } from "./errors";
import { foldsCase, isInsideRoot, mapConcurrent, pathKey } from "./fsutil";
import { readHead } from "./media";
import { extOf, isMediaExtension, MAX_PROJECT_DIR_LENGTH, normaliseProjectDir } from "./validate";

export interface ScanLimits {
  /** Levels below the root that are searched (the root is level 0). */
  maxDepth: number;
  /** Folders read before the search stops. */
  maxDirs: number;
  /** Projects reported before the search stops. */
  maxProjects: number;
  timeoutMs: number;
  /** A project's media count stops here. */
  maxMediaCount: number;
  /** Longer folder paths are not searched: the import refuses them. */
  maxPathLength: number;
}

export const SCAN_LIMITS: Readonly<ScanLimits> = {
  maxDepth: 8,
  maxDirs: 20_000,
  maxProjects: MAX_IMPORT_PROJECTS,
  timeoutMs: 15_000,
  maxMediaCount: FOUND_MEDIA_COUNT_CAP,
  maxPathLength: MAX_PROJECT_DIR_LENGTH,
};

export interface ScanOptions {
  /** Folders never entered, wherever they turn up: the library's Generations and data folders, the thumbnail cache. */
  exclude?: readonly string[];
  /** Smaller bounds (tests). */
  limits?: Partial<ScanLimits>;
  /** The clock the time bound reads (tests). */
  now?: () => number;
}

/** Folders read at once. A network drive answers each one slowly. */
const SCAN_CONCURRENCY = 8;
/** Never searched, wherever they are; nor is anything whose name starts with ".". */
const SKIPPED_NAMES = new Set(["node_modules", "__pycache__"]);
/** What makes a folder a project. */
const GENERATIONS = "generations";
/** A project's own folders hold its media, never another project. */
const PROJECT_MEDIA_DIRS = new Set([GENERATIONS, "inputs", "outputs", ".images"]);
/** A workflow file names itself near its start (list-workflows reads as much). */
const WORKFLOW_HEAD_BYTES = 1024;
const NAME_FIELD = /"name"\s*:\s*"((?:\\.|[^"\\])*)"/;

/** The folder to search: absolute, no `..`, resolved, and a folder that exists. */
export async function resolveScanRoot(value: unknown): Promise<string> {
  const root = normaliseProjectDir(value, process.platform, "folder to search");
  let isDirectory: boolean;
  try {
    isDirectory = (await fs.stat(root)).isDirectory();
  } catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") throw new LibraryError(`"${root}" doesn't exist.`, 404, "not_found");
    throw new LibraryError(`Node Banana can't open "${root}" (${code ?? "unknown error"}).`, 400, "bad_request");
  }
  if (!isDirectory) throw new LibraryError(`"${root}" isn't a folder.`, 400, "bad_request");
  return root;
}

/** What reading one folder found. */
interface Visit {
  project: FoundProject | null;
  /** Subfolders to search next. */
  children: string[];
  /** Its generations folder could not be read. */
  unreadableGenerations: boolean;
}

/**
 * Every project under `root` (itself included), sorted by path. `root`
 * must already be resolved ({@link resolveScanRoot}).
 */
export async function findProjects(root: string, options: ScanOptions = {}): Promise<ScanProjectsResult> {
  const limits = { ...SCAN_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const deadline = now() + limits.timeoutMs;
  const fold = foldsCase(process.platform);
  const nameKey = (name: string) => (fold ? name.toLowerCase() : name);
  // Excluded folders are compared by where they really are, so a root picked
  // through a link (macOS's /tmp, a linked home) still leaves them out. No
  // link below the root is followed, so a folder's real path is the root's
  // real path plus the rest of it.
  const real = (dir: string) => fs.realpath(dir).catch(() => dir);
  const realRoot = await real(root);
  const realKey = (dir: string) => pathKey(realRoot === root ? dir : path.join(realRoot, dir.slice(root.length)));
  const exclude = await Promise.all((options.exclude ?? []).map(real));
  const excluded = new Set(exclude.map((dir) => pathKey(dir)));

  const result: ScanProjectsResult = { root, projects: [], truncated: false, unreadable: 0 };
  // Searching inside the library's own data finds nothing an import could use.
  if (exclude.some((dir) => isInsideRoot(dir, realRoot, { allowEqual: true }))) return result;

  const searchable = (dir: string, entry: Dirent, inProject: boolean): boolean => {
    // A Dirent describes the entry itself: a link to a folder is a link, never a folder.
    if (!entry.isDirectory()) return false;
    if (entry.name.startsWith(".") || SKIPPED_NAMES.has(entry.name)) return false;
    if (inProject && PROJECT_MEDIA_DIRS.has(nameKey(entry.name))) return false;
    const child = path.join(dir, entry.name);
    // The import refuses system folders and over-long paths, so a project there could never be imported
    // (and one such folder would refuse the whole import).
    if (child.length > limits.maxPathLength) return false;
    return !excluded.has(realKey(child)) && validateWorkflowPath(child).valid;
  };

  const visit = async (dir: string, descend: boolean): Promise<Visit | "late" | "unreadable"> => {
    if (now() > deadline) return "late";
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return "unreadable";
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    let project: FoundProject | null = null;
    let unreadableGenerations = false;
    const generations = entries.find(
      (entry) => entry.isDirectory() && nameKey(entry.name) === GENERATIONS && !excluded.has(realKey(path.join(dir, entry.name))),
    );
    if (generations) {
      const mediaCount = await countMedia(path.join(dir, generations.name), limits.maxMediaCount);
      if (mediaCount === null) unreadableGenerations = true;
      else if (mediaCount > 0) project = { dir, name: await projectName(dir, entries), mediaCount };
    }
    const children = descend
      ? entries
          // A generations folder that couldn't be read is counted once, not again as a subfolder.
          .filter((entry) => !(unreadableGenerations && entry === generations) && searchable(dir, entry, project !== null))
          .map((entry) => path.join(dir, entry.name))
      : [];
    return { project, children, unreadableGenerations };
  };

  // A folder that never answers (a network drive that went away, a file the
  // cloud is still fetching) is given up on when time runs out, so the
  // search answers on time with what it has.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"late">((resolve) => {
    // setTimeout fires at once past its 32-bit limit.
    timer = setTimeout(() => resolve("late"), Math.min(limits.timeoutMs, 2 ** 31 - 1));
    timer.unref?.();
  });
  try {
    await walk(root, limits, result, (dir, descend) => Promise.race([visit(dir, descend), expired]));
  } finally {
    clearTimeout(timer);
  }

  result.projects.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  return result;
}

/** Level by level from `root`, within the folder and project bounds, filling `result`. */
async function walk(
  root: string,
  limits: ScanLimits,
  result: ScanProjectsResult,
  visit: (dir: string, descend: boolean) => Promise<Visit | "late" | "unreadable">,
): Promise<void> {
  let level = [root];
  let visited = 0;
  for (let depth = 0; level.length > 0; depth++) {
    const room = limits.maxDirs - visited;
    if (room <= 0) {
      result.truncated = true;
      break;
    }
    const batch = level.length > room ? level.slice(0, room) : level;
    if (batch.length < level.length) result.truncated = true;
    visited += batch.length;
    // Results keep the level's order, so which projects a bound cuts off is the same every time.
    const visits = await mapConcurrent(batch, SCAN_CONCURRENCY, (dir) => visit(dir, depth < limits.maxDepth));
    const next: string[] = [];
    for (const found of visits) {
      if (found === "late") {
        result.truncated = true;
        continue;
      }
      if (found === "unreadable") {
        result.unreadable++;
        continue;
      }
      if (found.unreadableGenerations) result.unreadable++;
      if (found.project) {
        if (result.projects.length >= limits.maxProjects) {
          result.truncated = true;
          break;
        }
        result.projects.push(found.project);
      }
      // One past what the next level may read is enough to know it stops there.
      for (const child of found.children) if (next.length <= limits.maxDirs - visited) next.push(child);
    }
    if (result.truncated) break;
    level = next;
  }
}

/** Media files directly in `dir`, up to `cap`; null when the folder can't be read. */
async function countMedia(dir: string, cap: number): Promise<number | null> {
  let handle: import("fs").Dir;
  try {
    handle = await fs.opendir(dir);
  } catch {
    return null;
  }
  let count = 0;
  try {
    // Leaving the loop closes the folder.
    for await (const entry of handle) {
      if (entry.isFile() && isMediaExtension(extOf(entry.name)) && ++count >= cap) break;
    }
  } catch {
    // It stopped reading part-way: what was counted stands.
  }
  return count;
}

/**
 * The name in the newest workflow file directly in `dir`, else the folder's
 * own name. Only the head of each file is read: a workflow with its media
 * inline can run to hundreds of megabytes.
 */
async function projectName(dir: string, entries: readonly Dirent[]): Promise<string> {
  const fallback = path.basename(dir);
  const files = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"));
  const dated = await mapConcurrent(files, SCAN_CONCURRENCY, async (entry) => {
    const file = path.join(dir, entry.name);
    try {
      return { file, mtime: (await fs.stat(file)).mtimeMs };
    } catch {
      return null;
    }
  });
  const newestFirst = dated
    .filter((candidate): candidate is { file: string; mtime: number } => candidate !== null)
    .sort((a, b) => b.mtime - a.mtime || (a.file < b.file ? -1 : 1));
  for (const { file } of newestFirst) {
    let head: string;
    try {
      head = (await readHead(file, WORKFLOW_HEAD_BYTES)).toString("utf8");
    } catch {
      continue;
    }
    if (!head.includes('"version"') || !head.includes('"nodes"')) continue;
    const match = NAME_FIELD.exec(head);
    return (match && jsonString(match[1]).trim()) || fallback;
  }
  return fallback;
}

/** The value of a JSON string literal's body, escapes and all. */
function jsonString(body: string): string {
  try {
    const value: unknown = JSON.parse(`"${body}"`);
    return typeof value === "string" ? value : "";
  } catch {
    return body;
  }
}
