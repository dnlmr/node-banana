/**
 * `.nodebanana/workflows.json`: one row per workflow, holding its current
 * name and project folder. Classifying a workflow's assets into a project is
 * a single write here, never a rewrite of their sidecars.
 */

import { promises as fs } from "fs";
import path from "path";
import type { LibraryWorkflowEntry } from "../types";
import { atomicWriteFile, KeyedMutex, rebasePath } from "./fsutil";
import { isWorkflowId, normaliseProjectDir, requireWorkflowId } from "./validate";
import { LibraryError } from "./errors";

export interface WorkflowEntryInput {
  name: string | null;
  projectPath: string | null;
  forkedFrom?: string;
  /** When the caller saw these values (ms); older than the row's last change, they don't overwrite it. */
  asOf?: number;
}

function parseEntry(id: string, value: unknown): LibraryWorkflowEntry | null {
  if (!isWorkflowId(id) || !value || typeof value !== "object") return null;
  const entry = value as Partial<LibraryWorkflowEntry>;
  const name = typeof entry.name === "string" ? entry.name : null;
  const projectPath =
    typeof entry.projectPath === "string" && path.isAbsolute(entry.projectPath) ? entry.projectPath : null;
  const createdAt = typeof entry.createdAt === "number" ? entry.createdAt : 0;
  const updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : createdAt;
  return {
    id,
    name,
    projectPath,
    createdAt,
    updatedAt,
    ...(isWorkflowId(entry.forkedFrom) ? { forkedFrom: entry.forkedFrom } : {}),
  };
}

export class WorkflowTable {
  private entries = new Map<string, LibraryWorkflowEntry>();
  /** `mtimeMs:size` of the file as last read; a change means another process wrote it. */
  private stamp = "";
  private readonly writes = new KeyedMutex();

  constructor(
    private readonly file: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  get(id: string): LibraryWorkflowEntry | undefined {
    return this.entries.get(id);
  }

  all(): LibraryWorkflowEntry[] {
    return [...this.entries.values()];
  }

  /** Re-reads the file when it changed since the last read. Returns true when it did. */
  async refresh(): Promise<boolean> {
    let stamp = "";
    try {
      const stat = await fs.stat(this.file);
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      stamp = "absent";
    }
    if (stamp === this.stamp) return false;
    const entries = new Map<string, LibraryWorkflowEntry>();
    if (stamp !== "absent") {
      try {
        const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as Record<string, unknown>;
        for (const [id, value] of Object.entries(parsed ?? {})) {
          const entry = parseEntry(id, value);
          if (entry) entries.set(id, entry);
        }
      } catch {
        // A torn or hand-edited file: keep what we had rather than forgetting every project.
        if (this.entries.size) {
          this.stamp = stamp;
          return false;
        }
      }
    }
    this.entries = entries;
    this.stamp = stamp;
    return true;
  }

  /**
   * Inserts or updates a row. A no-op (no write) when nothing changed, which
   * is the common case: the recorder upserts at every run start. A null name
   * or folder never clears one the row already has. The recorder's upsert
   * carries what the canvas knew when its run started (`asOf`) and can land
   * after a rename or a folder change made while the run went on: seen
   * before the row's last change, it only fills in what the row lacks.
   */
  async upsert(id: string, input: WorkflowEntryInput, now: number = Date.now()): Promise<{ entry: LibraryWorkflowEntry; changed: boolean }> {
    requireWorkflowId(id);
    const incomingName = input.name === null || input.name === undefined ? null : String(input.name).slice(0, 512);
    const incomingPath =
      input.projectPath === null || input.projectPath === undefined || input.projectPath === ""
        ? null
        : normaliseProjectDir(input.projectPath, this.platform);
    if (input.forkedFrom !== undefined && !isWorkflowId(input.forkedFrom)) {
      throw new LibraryError("Invalid forkedFrom workflow id", 400, "bad_request");
    }
    return this.writes.run("table", async () => {
      await this.refresh();
      const existing = this.entries.get(id);
      const asOf = input.asOf;
      const stale = existing !== undefined && typeof asOf === "number" && Number.isFinite(asOf) && asOf < existing.updatedAt;
      const name = stale ? (existing.name ?? incomingName) : (incomingName ?? existing?.name ?? null);
      const projectPath = stale ? (existing.projectPath ?? incomingPath) : (incomingPath ?? existing?.projectPath ?? null);
      const forkedFrom = input.forkedFrom ?? existing?.forkedFrom;
      if (
        existing &&
        existing.name === name &&
        existing.projectPath === projectPath &&
        existing.forkedFrom === forkedFrom
      ) {
        return { entry: existing, changed: false };
      }
      const entry: LibraryWorkflowEntry = {
        id,
        name,
        projectPath,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(forkedFrom ? { forkedFrom } : {}),
      };
      const next = new Map(this.entries);
      next.set(id, entry);
      await this.write(next);
      return { entry, changed: true };
    });
  }

  /**
   * Points every row whose project folder is `fromDir` or inside it at the
   * same place under `toDir` (the folder moved). Dated now, so a run's late
   * upsert naming the old folder doesn't move it back. Returns the rows changed.
   */
  async relocate(fromDir: string, toDir: string, now: number = Date.now()): Promise<number> {
    return this.writes.run("table", async () => {
      await this.refresh();
      const next = new Map(this.entries);
      let changed = 0;
      for (const [id, entry] of this.entries) {
        const projectPath = entry.projectPath && rebasePath(fromDir, toDir, entry.projectPath, this.platform);
        if (!projectPath || projectPath === entry.projectPath) continue;
        next.set(id, { ...entry, projectPath, updatedAt: Math.max(now, entry.updatedAt) });
        changed++;
      }
      if (changed) await this.write(next);
      return changed;
    });
  }

  private async write(next: Map<string, LibraryWorkflowEntry>): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await atomicWriteFile(this.file, JSON.stringify(Object.fromEntries(next)), { fsync: false });
    this.entries = next;
    try {
      const stat = await fs.stat(this.file);
      this.stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      this.stamp = "";
    }
  }
}
