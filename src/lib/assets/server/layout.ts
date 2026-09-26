/**
 * The on-disk layout of one library root (see `../types.ts` for the picture)
 * and the lock file that serialises journal compaction and library moves
 * across processes.
 */

import { promises as fs } from "fs";
import path from "path";
import { errnoCode } from "./errors";

export const GENERATIONS_DIR = "Generations";
export const DATA_DIR = ".nodebanana";

export interface LibraryLayout {
  root: string;
  generations: string;
  data: string;
  assets: string;
  runs: string;
  media: string;
  posters: string;
  workflowsFile: string;
  journal: string;
  lock: string;
  libraryFile: string;
}

export function libraryLayout(root: string): LibraryLayout {
  const data = path.join(root, DATA_DIR);
  return {
    root,
    generations: path.join(root, GENERATIONS_DIR),
    data,
    assets: path.join(data, "assets"),
    runs: path.join(data, "runs"),
    media: path.join(data, "media"),
    posters: path.join(data, "posters"),
    workflowsFile: path.join(data, "workflows.json"),
    journal: path.join(data, "journal.ndjson"),
    lock: path.join(data, "lock"),
    libraryFile: path.join(data, "library.json"),
  };
}

/** A lock is abandoned when its holder has not refreshed it for this long. */
export const LOCK_STALE_MS = 60_000;
const LOCK_HEARTBEAT_MS = 20_000;

export interface HeldLock {
  release(): Promise<void>;
}

async function readLockAge(file: string, now: number): Promise<number> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as { at?: unknown };
    return typeof parsed.at === "number" ? now - parsed.at : Infinity;
  } catch {
    return Infinity;
  }
}

/**
 * Takes `.nodebanana/lock` ({pid, at}), or returns null when a live holder
 * has it. A lock older than {@link LOCK_STALE_MS} is taken over. Long holders
 * (a library move) pass `heartbeat` so their lock never looks stale.
 */
export async function acquireLock(file: string, options: { heartbeat?: boolean } = {}): Promise<HeldLock | null> {
  const write = () => fs.writeFile(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await write();
      let timer: ReturnType<typeof setInterval> | undefined;
      if (options.heartbeat) {
        timer = setInterval(() => {
          fs.writeFile(file, JSON.stringify({ pid: process.pid, at: Date.now() })).catch(() => {});
        }, LOCK_HEARTBEAT_MS);
        timer.unref?.();
      }
      return {
        release: async () => {
          if (timer) clearInterval(timer);
          await fs.rm(file, { force: true }).catch(() => {});
        },
      };
    } catch (error) {
      if (errnoCode(error) !== "EEXIST") return null;
      if ((await readLockAge(file, Date.now())) < LOCK_STALE_MS) return null;
      await fs.rm(file, { force: true }).catch(() => {});
    }
  }
  return null;
}
