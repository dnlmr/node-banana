/**
 * Workflow snapshots and the media they reference.
 *
 * One gzip file per run (`runs/<runId>.json.gz`) holds the graph at the
 * start and, when the run finished on the same canvas, at the end. Media in
 * those graphs are `{ $nbMedia: sha256 }` refs, resolved from `media/` first
 * — a file of the bytes, or a `<sha256>.ref` pointing at a project's own file
 * that still holds them — and then from any asset file with the same bytes.
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
  hashFile,
  KeyedMutex,
  mapConcurrent,
  PARTIAL_SUFFIX,
  renameWithRetry,
  streamToPartial,
  unlinkWithRetry,
  withFsRetry,
} from "./fsutil";
import type { LibraryLayout } from "./layout";
import {
  extOf,
  isMediaExtension,
  isRunId,
  isSha256,
  isWorkflowId,
  mediaTypeForExt,
  requireRunId,
  requireSha256,
  storageTypeForMime,
} from "./validate";

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
/** `media/<sha256>.ref`: the bytes are a project's own file, kept where it is. */
const REF_SUFFIX = ".ref";

/** A file to read media bytes from. */
export interface MediaSource {
  path: string;
  mime: string;
  bytes: number;
  filename: string;
}

export interface MediaLookup {
  /** An asset file holding these bytes, if any is on disk. */
  assetFileFor(sha256: string): Promise<MediaSource | null>;
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
  /** sha256 → the version (`path, size, mtime`) of the referenced file last hashed to it. */
  private readonly verifiedRefs = new Map<string, string>();

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
        if (name.endsWith(PARTIAL_SUFFIX) || name.endsWith(".tmp") || name.endsWith(REF_SUFFIX)) continue;
        const sha = name.split(".")[0];
        if (isSha256(sha)) index.set(sha, name);
      }
    } catch {
      // No media folder yet.
    }
    return index;
  }

  /** The media/ file holding a hash's bytes, if there is one (not a reference). */
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

  private refFile(sha256: string): string {
    return path.join(this.layout.media, `${requireSha256(sha256)}${REF_SUFFIX}`);
  }

  /**
   * The project file a `media/<sha256>.ref` points at, while it still holds
   * exactly those bytes: same size, and the same hash (hashed once per
   * version of the file, then remembered). Null when there is no reference,
   * or the file moved, changed or went.
   */
  async referencedFile(sha256: string): Promise<MediaSource | null> {
    if (!isSha256(sha256)) return null;
    let ref: { path?: unknown; bytes?: unknown };
    try {
      ref = JSON.parse(await fs.readFile(this.refFile(sha256), "utf8")) as { path?: unknown; bytes?: unknown };
    } catch {
      return null;
    }
    const file = ref.path;
    if (typeof file !== "string" || !path.isAbsolute(file) || !isMediaExtension(extOf(file)) || typeof ref.bytes !== "number") {
      return null;
    }
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size !== ref.bytes) return null;
      const version = `${file}\0${stat.size}\0${stat.mtimeMs}`;
      if (this.verifiedRefs.get(sha256) !== version) {
        if ((await hashFile(file)).sha256 !== sha256) return null;
        this.verifiedRefs.set(sha256, version);
      }
      return {
        path: file,
        mime: mediaTypeForExt(extOf(file))?.mime ?? "application/octet-stream",
        bytes: stat.size,
        filename: path.basename(file),
      };
    } catch {
      return null;
    }
  }

  /** Hashes whose bytes the server holds neither in media/ (a file or a reference) nor in an asset file. */
  async missing(hashes: string[]): Promise<string[]> {
    const missing: string[] = [];
    for (const hash of [...new Set(hashes.filter(isSha256))].slice(0, MAX_MEDIA_HASHES)) {
      if (await this.mediaFile(hash)) continue;
      if (await this.referencedFile(hash)) continue;
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
    const existing = (await this.mediaFile(sha256)) ?? (await this.referencedFile(sha256))?.path;
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
    await this.dropReference(sha256);
    return { sha256, bytes: written.bytes };
  }

  /** Where to read snapshot media from: media/ first (a file, then a reference), then an asset file with the same bytes. */
  async openMedia(sha256: string): Promise<MediaSource | null> {
    if (!isSha256(sha256)) return null;
    const file = await this.mediaFile(sha256);
    if (file) {
      try {
        const stat = await fs.stat(file);
        const ext = extOf(file);
        const mime = ext === "bin" ? "application/octet-stream" : (mediaTypeForExt(ext)?.mime ?? "application/octet-stream");
        return { path: file, mime, bytes: stat.size, filename: path.basename(file) };
      } catch {
        // Fall through to a reference, then asset files.
      }
    }
    return (await this.referencedFile(sha256)) ?? this.lookup.assetFileFor(sha256);
  }

  /**
   * Keeps the bytes of a file a snapshot still needs after its asset is
   * deleted: moves it into media/ (copying across volumes), or drops it when
   * media/ already holds them. A reference to the file is replaced by the
   * bytes themselves. Returns false when the caller should dispose of `file`
   * itself.
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
      await this.dropReference(sha256);
      return false;
    }
    this.mediaIndex?.set(sha256, path.basename(target));
    await this.dropReference(sha256);
    return true;
  }

  /**
   * Keeps the bytes of a project's own file for the snapshots that need
   * them, leaving it where it is: `media/<sha256>.ref` points at it (and is
   * checked against the hash on every use) rather than a second copy of
   * what may be a large video. Should the app later remove that file
   * (deleting a record of it with its project file), {@link adoptFile}
   * takes the bytes in first.
   */
  async retainReference(sha256: string, file: string, bytes: number): Promise<void> {
    if (await this.mediaFile(sha256)) return;
    await fs.mkdir(this.layout.media, { recursive: true });
    await atomicWriteFile(this.refFile(sha256), JSON.stringify({ v: 1, path: file, bytes }), { fsync: false });
  }

  private async dropReference(sha256: string): Promise<void> {
    this.verifiedRefs.delete(sha256);
    await unlinkWithRetry(this.refFile(sha256)).catch(() => {});
  }

  /** Every file in media/ with its hash (references too), for cleanup. */
  async mediaEntries(): Promise<{ sha256: string; path: string }[]> {
    this.mediaIndex = await this.listMedia();
    this.mediaIndexAt = Date.now();
    const entries = [...this.mediaIndex.entries()].map(([sha256, name]) => ({ sha256, path: path.join(this.layout.media, name) }));
    try {
      for (const name of await fs.readdir(this.layout.media)) {
        const sha256 = name.slice(0, -REF_SUFFIX.length);
        if (name.endsWith(REF_SUFFIX) && isSha256(sha256)) entries.push({ sha256, path: path.join(this.layout.media, name) });
      }
    } catch {
      // No media folder yet.
    }
    return entries;
  }

  forgetMedia(sha256: string): void {
    this.mediaIndex?.delete(sha256);
    this.verifiedRefs.delete(sha256);
  }
}
