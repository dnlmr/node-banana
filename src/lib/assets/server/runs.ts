/**
 * Workflow snapshots and the media they reference.
 *
 * One gzip file per run (`runs/<runId>.json.gz`) holds the graph at the
 * start and, when the run finished on the same canvas, at the end. Media in
 * those graphs are `{ $nbMedia: sha256 }` refs, resolved from `media/` first
 * and then from any asset file with the same bytes.
 *
 * Next to each snapshot, `runs/<runId>.hashes.json` repeats its mediaHashes
 * with the snapshot's mtime:size, so a reference scan reads a few KB per run
 * instead of inflating every graph. A list whose stamp no longer matches (a
 * crash between the two writes, a copy, another build) is ignored and the
 * snapshot is read instead.
 *
 * A run belongs to its assets: when the last of them is deleted for good,
 * the library removes the snapshot too (and cleanup removes any it missed),
 * so bytes only a dead run referenced can leave the disk.
 */

import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { gunzip as gunzipCallback, gzip as gzipCallback } from "zlib";
import type { PutRunRequest, PutRunResult, RunMeta, SnapshotWorkflow, StoredRun } from "../types";
import { errnoCode, LibraryError } from "./errors";
import {
  atomicWriteFile,
  commitPartial,
  copyFileVerified,
  discardPartial,
  KeyedMutex,
  mapConcurrent,
  PARTIAL_SUFFIX,
  renameWithRetry,
  streamToPartial,
  unlinkWithRetry,
  withFsRetry,
} from "./fsutil";
import type { LibraryLayout } from "./layout";
import { isRunId, isSha256, isWorkflowId, requireRunId, requireSha256, storageTypeForMime, mediaTypeForExt, extOf } from "./validate";

const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);

/** Snapshots are media-stripped (25–160 KB typical); anything near this is not a stripped graph. */
const MAX_SNAPSHOT_JSON = 32 * 1024 * 1024;
const MAX_MEDIA_HASHES = 20_000;
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
const RUN_FILE = /^(r[0-9a-z]{12,24})\.json\.gz$/;
const HASH_LIST_FILE = /^(r[0-9a-z]{12,24})\.hashes\.json$/;
/** Run files read at once during a reference scan. */
const SCAN_CONCURRENCY = 8;

export interface MediaLookup {
  /** An asset file holding these bytes, if any is on disk. */
  assetFileFor(sha256: string): Promise<{ path: string; mime: string; bytes: number; filename: string } | null>;
}

/** What the stored snapshots reference. */
export interface ReferencedHashes {
  hashes: Set<string>;
  /**
   * A snapshot exists but could not be read right now (a file held open, a
   * cloud placeholder offline, EIO): what it references is unknown, so
   * nothing may be deleted on the strength of this answer.
   */
  incomplete: boolean;
}

function runFile(layout: LibraryLayout, runId: string): string {
  return path.join(layout.runs, `${requireRunId(runId)}.json.gz`);
}

function hashListFile(layout: LibraryLayout, runId: string): string {
  return path.join(layout.runs, `${requireRunId(runId)}.hashes.json`);
}

function isAbsent(error: unknown): boolean {
  const code = errnoCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function stampOf(stat: { mtimeMs: number; size: number }): string {
  return `${stat.mtimeMs}:${stat.size}`;
}

function validateSnapshot(value: unknown): SnapshotWorkflow {
  const workflow = value as SnapshotWorkflow;
  if (
    !workflow ||
    typeof workflow !== "object" ||
    workflow.version !== 1 ||
    !Array.isArray(workflow.nodes) ||
    !Array.isArray(workflow.edges) ||
    typeof workflow.name !== "string" ||
    typeof workflow.edgeStyle !== "string"
  ) {
    throw new LibraryError("Invalid workflow snapshot", 400, "bad_request");
  }
  return workflow;
}

function parseStoredRun(value: unknown, runId: string): StoredRun | null {
  const run = value as StoredRun;
  if (!run || typeof run !== "object" || run.id !== runId || !isWorkflowId(run.workflowId)) return null;
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: typeof run.workflowName === "string" ? run.workflowName : null,
    projectPath: typeof run.projectPath === "string" ? run.projectPath : null,
    startedAt: typeof run.startedAt === "number" ? run.startedAt : 0,
    updatedAt: typeof run.updatedAt === "number" ? run.updatedAt : 0,
    ...(run.start ? { start: run.start } : {}),
    ...(run.final ? { final: run.final } : {}),
    mediaHashes: Array.isArray(run.mediaHashes) ? run.mediaHashes.filter(isSha256) : [],
  };
}

export function runMeta(run: StoredRun): RunMeta {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    projectPath: run.projectPath,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
  };
}

export class RunStore {
  private readonly runLocks = new KeyedMutex();
  /** mediaHashes per run file, keyed by name and checked against mtime/size, so reference scans are incremental. */
  private readonly hashCache = new Map<string, { stamp: string; hashes: string[] }>();
  /** sha256 → file name in media/, rebuilt from a listing when a lookup misses. */
  private mediaIndex: Map<string, string> | null = null;
  private mediaIndexAt = 0;

  constructor(
    private readonly layout: LibraryLayout,
    private readonly lookup: MediaLookup,
  ) {}

  /* Runs ------------------------------------------------------------- */

  async get(runId: string): Promise<StoredRun | null> {
    if (!isRunId(runId)) return null;
    return (await this.load(runId)).run;
  }

  /**
   * A stored run. `unreadable` when the file is there but could not be read
   * right now — unlike a missing or corrupt file, that says nothing about
   * what it references.
   */
  private async load(runId: string): Promise<{ run: StoredRun | null; unreadable: boolean }> {
    let raw: Buffer;
    try {
      raw = await withFsRetry(() => fs.readFile(runFile(this.layout, runId)));
    } catch (error) {
      return { run: null, unreadable: !isAbsent(error) };
    }
    try {
      return { run: parseStoredRun(JSON.parse((await gunzip(raw)).toString("utf8")), runId), unreadable: false };
    } catch {
      return { run: null, unreadable: false };
    }
  }

  /** The hash list next to a snapshot, when it was written for exactly this version of it. */
  private async readHashList(runId: string, stamp: string): Promise<string[] | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(hashListFile(this.layout, runId), "utf8")) as { stamp?: unknown; hashes?: unknown };
      if (parsed.stamp !== stamp || !Array.isArray(parsed.hashes)) return null;
      return parsed.hashes.filter(isSha256);
    } catch {
      return null;
    }
  }

  private async writeHashList(runId: string, stamp: string, hashes: string[]): Promise<void> {
    try {
      await atomicWriteFile(hashListFile(this.layout, runId), JSON.stringify({ stamp, hashes }), { fsync: false });
    } catch {
      // An optimisation: the next scan reads the snapshot instead.
    }
  }

  /** Writes the start or final snapshot of a run, keeping the other phase, and reports media the server lacks. */
  async put(runId: string, request: PutRunRequest, now: number = Date.now()): Promise<PutRunResult> {
    requireRunId(runId);
    if (!request || typeof request !== "object" || !request.meta || request.meta.id !== runId) {
      throw new LibraryError("The run id does not match the request", 400, "bad_request");
    }
    if (request.phase !== "start" && request.phase !== "final") {
      throw new LibraryError("phase must be start or final", 400, "bad_request");
    }
    if (!isWorkflowId(request.meta.workflowId)) throw new LibraryError("Invalid workflow id", 400, "bad_request");
    const workflow = validateSnapshot(request.workflow);
    if (!Array.isArray(request.mediaHashes) || request.mediaHashes.length > MAX_MEDIA_HASHES) {
      throw new LibraryError("Invalid mediaHashes", 400, "bad_request");
    }
    const hashes = [...new Set(request.mediaHashes.filter(isSha256))];
    if (Buffer.byteLength(JSON.stringify(workflow)) > MAX_SNAPSHOT_JSON) {
      throw new LibraryError("The workflow snapshot is too large", 413, "too_large");
    }

    await this.runLocks.run(runId, async () => {
      const { run: existing, unreadable } = await this.load(runId);
      // Writing over a snapshot we can't read would drop its other phase.
      if (unreadable) throw new LibraryError("The workflow snapshot is busy. Try again in a moment.", 503, "busy", 5);
      const stored: StoredRun = {
        id: runId,
        workflowId: request.meta.workflowId,
        workflowName: typeof request.meta.workflowName === "string" ? request.meta.workflowName : null,
        projectPath: typeof request.meta.projectPath === "string" ? request.meta.projectPath : null,
        startedAt: existing?.startedAt ?? (Number.isFinite(request.meta.startedAt) ? request.meta.startedAt : now),
        updatedAt: now,
        ...(existing?.start ? { start: existing.start } : {}),
        ...(existing?.final ? { final: existing.final } : {}),
        mediaHashes: [...new Set([...(existing?.mediaHashes ?? []), ...hashes])],
      };
      stored[request.phase] = workflow;
      await fs.mkdir(this.layout.runs, { recursive: true });
      const file = runFile(this.layout, runId);
      await atomicWriteFile(file, await gzip(Buffer.from(JSON.stringify(stored))), { fsync: false });
      try {
        const stamp = stampOf(await fs.stat(file));
        this.hashCache.set(path.basename(file), { stamp, hashes: stored.mediaHashes });
        await this.writeHashList(runId, stamp, stored.mediaHashes);
      } catch {
        this.hashCache.delete(path.basename(file));
      }
    });
    return { missingMedia: await this.missing(hashes) };
  }

  /**
   * Every sha256 any stored snapshot references. Reads only run files that
   * are new or changed since the last call (and of those, the small hash
   * list when it matches), so another process's runs are seen without
   * re-reading every snapshot. A snapshot that can't be read now is not
   * cached, and marks the answer incomplete.
   */
  async referencedHashes(): Promise<ReferencedHashes> {
    const names = (await this.listRunFiles()).map(({ name }) => name);
    const present = new Set(names);
    for (const name of this.hashCache.keys()) if (!present.has(name)) this.hashCache.delete(name);
    const hashes = new Set<string>();
    let incomplete = false;
    await mapConcurrent(names, SCAN_CONCURRENCY, async (name) => {
      const runId = name.slice(0, -".json.gz".length);
      let stamp: string;
      try {
        stamp = stampOf(await fs.stat(path.join(this.layout.runs, name)));
      } catch (error) {
        if (!isAbsent(error)) incomplete = true;
        return;
      }
      let cached = this.hashCache.get(name);
      if (!cached || cached.stamp !== stamp) {
        const listed = await this.readHashList(runId, stamp);
        if (listed) {
          cached = { stamp, hashes: listed };
        } else {
          const { run, unreadable } = await this.load(runId);
          if (unreadable) {
            incomplete = true;
            return;
          }
          cached = { stamp, hashes: run?.mediaHashes ?? [] };
          if (run) await this.writeHashList(runId, stamp, cached.hashes);
        }
        this.hashCache.set(name, cached);
      }
      for (const hash of cached.hashes) hashes.add(hash);
    });
    return { hashes, incomplete };
  }

  private async listRunFiles(): Promise<{ name: string; runId: string }[]> {
    try {
      return (await fs.readdir(this.layout.runs)).flatMap((name) => {
        const match = RUN_FILE.exec(name);
        return match ? [{ name, runId: match[1] }] : [];
      });
    } catch {
      return [];
    }
  }

  /** Deletes a run's snapshot (and its hash list); true when there was one. */
  async remove(runId: string): Promise<boolean> {
    if (!isRunId(runId)) return false;
    return this.runLocks.run(runId, async () => {
      const file = runFile(this.layout, runId);
      this.hashCache.delete(path.basename(file));
      let existed = true;
      try {
        await fs.stat(file);
      } catch (error) {
        if (isAbsent(error)) existed = false;
      }
      if (existed) await unlinkWithRetry(file);
      await unlinkWithRetry(hashListFile(this.layout, runId));
      return existed;
    });
  }

  /**
   * Deletes the snapshots of runs `keep` doesn't list, last written before
   * `olderThan` (a run still recording has its start snapshot a moment
   * before its asset is indexed), and hash lists with no snapshot.
   */
  async removeOrphans(keep: ReadonlySet<string>, olderThan: number): Promise<{ files: number; bytes: number }> {
    let files = 0;
    let bytes = 0;
    for (const { runId } of await this.listRunFiles()) {
      if (keep.has(runId)) continue;
      try {
        const stat = await fs.stat(runFile(this.layout, runId));
        if (stat.mtimeMs >= olderThan) continue;
        if (await this.remove(runId)) {
          files++;
          bytes += stat.size;
        }
      } catch {
        // Gone already, or held open: the next cleanup gets it.
      }
    }
    let names: string[] = [];
    try {
      names = await fs.readdir(this.layout.runs);
    } catch {
      names = [];
    }
    const snapshots = new Set(names.filter((name) => RUN_FILE.test(name)));
    for (const name of names) {
      const match = HASH_LIST_FILE.exec(name);
      if (match && !snapshots.has(`${match[1]}.json.gz`)) await unlinkWithRetry(path.join(this.layout.runs, name)).catch(() => {});
    }
    return { files, bytes };
  }

  /* Media ------------------------------------------------------------ */

  private async listMedia(): Promise<Map<string, string>> {
    const index = new Map<string, string>();
    try {
      for (const name of await fs.readdir(this.layout.media)) {
        if (name.endsWith(PARTIAL_SUFFIX) || name.endsWith(".tmp")) continue;
        const sha = name.split(".")[0];
        if (isSha256(sha)) index.set(sha, name);
      }
    } catch {
      // No media folder yet.
    }
    return index;
  }

  /** The media/ file for a hash, if held. */
  async mediaFile(sha256: string): Promise<string | null> {
    if (!isSha256(sha256)) return null;
    if (!this.mediaIndex || (!this.mediaIndex.has(sha256) && Date.now() - this.mediaIndexAt > 2000)) {
      this.mediaIndex = await this.listMedia();
      this.mediaIndexAt = Date.now();
    }
    const name = this.mediaIndex.get(sha256);
    if (!name) return null;
    const file = path.join(this.layout.media, name);
    try {
      await fs.access(file);
      return file;
    } catch {
      this.mediaIndex.delete(sha256);
      return null;
    }
  }

  /** Hashes whose bytes the server holds neither in media/ nor in an asset file. */
  async missing(hashes: string[]): Promise<string[]> {
    const missing: string[] = [];
    for (const hash of [...new Set(hashes.filter(isSha256))].slice(0, MAX_MEDIA_HASHES)) {
      if (await this.mediaFile(hash)) continue;
      if (await this.lookup.assetFileFor(hash)) continue;
      missing.push(hash);
    }
    return missing;
  }

  /** Stores snapshot media, verifying the bytes hash to `sha256`. */
  async putMedia(
    sha256: string,
    body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
    mime: string,
  ): Promise<{ sha256: string; bytes: number }> {
    requireSha256(sha256);
    const type = storageTypeForMime(mime);
    const existing = await this.mediaFile(sha256);
    if (existing) {
      if ("cancel" in body && typeof body.cancel === "function") await body.cancel().catch(() => {});
      return { sha256, bytes: (await fs.stat(existing)).size };
    }
    const written = await streamToPartial(body, this.layout.media, { maxBytes: MAX_MEDIA_BYTES, idleTimeoutMs: 60_000 });
    if (written.sha256 !== sha256) {
      await discardPartial(written);
      throw new LibraryError("The uploaded bytes do not match their hash", 400, "hash_mismatch");
    }
    const file = path.join(this.layout.media, `${sha256}.${type.ext}`);
    try {
      await commitPartial(written.partialPath, file);
    } catch (error) {
      await discardPartial(written);
      throw error;
    }
    this.mediaIndex?.set(sha256, path.basename(file));
    return { sha256, bytes: written.bytes };
  }

  /** Where to read snapshot media from: media/ first, then an asset file with the same bytes. */
  async openMedia(sha256: string): Promise<{ path: string; mime: string; bytes: number; filename: string } | null> {
    if (!isSha256(sha256)) return null;
    const file = await this.mediaFile(sha256);
    if (file) {
      try {
        const stat = await fs.stat(file);
        const ext = extOf(file);
        const mime = ext === "bin" ? "application/octet-stream" : (mediaTypeForExt(ext)?.mime ?? "application/octet-stream");
        return { path: file, mime, bytes: stat.size, filename: path.basename(file) };
      } catch {
        // Fall through to asset files.
      }
    }
    return this.lookup.assetFileFor(sha256);
  }

  /**
   * Keeps the bytes of a file a snapshot still needs after its asset is
   * deleted: moves it into media/ (copying across volumes), or drops it when
   * media/ already holds them. Returns false when the caller should dispose
   * of `file` itself.
   */
  async adoptFile(sha256: string, ext: string, file: string): Promise<boolean> {
    if (await this.mediaFile(sha256)) return false;
    await fs.mkdir(this.layout.media, { recursive: true });
    const target = path.join(this.layout.media, `${sha256}.${ext}`);
    try {
      await renameWithRetry(file, target);
    } catch (error) {
      if (errnoCode(error) !== "EXDEV") throw error;
      await copyFileVerified(file, target, { expectSha256: sha256 });
      this.mediaIndex?.set(sha256, path.basename(target));
      return false;
    }
    this.mediaIndex?.set(sha256, path.basename(target));
    return true;
  }

  /**
   * Keeps a copy of a file's bytes in media/ for the snapshots that need
   * them, leaving the file where it is (a project's own file). The copy is
   * checked against `sha256` before it is committed.
   */
  async retainCopy(sha256: string, ext: string, file: string): Promise<void> {
    if (await this.mediaFile(sha256)) return;
    await fs.mkdir(this.layout.media, { recursive: true });
    const target = path.join(this.layout.media, `${sha256}.${ext}`);
    await copyFileVerified(file, target, { expectSha256: sha256 });
    this.mediaIndex?.set(sha256, path.basename(target));
  }

  /** Every file in media/ with its hash, for cleanup. */
  async mediaEntries(): Promise<{ sha256: string; path: string }[]> {
    this.mediaIndex = await this.listMedia();
    this.mediaIndexAt = Date.now();
    return [...this.mediaIndex.entries()].map(([sha256, name]) => ({ sha256, path: path.join(this.layout.media, name) }));
  }

  forgetMedia(sha256: string): void {
    this.mediaIndex?.delete(sha256);
  }
}
