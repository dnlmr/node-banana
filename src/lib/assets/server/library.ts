/**
 * The asset index for one library root.
 *
 * Sidecars (`.nodebanana/assets/<id>.json`) are the source of truth. This
 * class holds all of them in memory — records, a newest-first array, and
 * hash→ids / path→ids maps — built lazily by one scan. Every mutation writes
 * its sidecar and then appends a line to `.nodebanana/journal.ndjson`; each
 * process remembers how far into the journal it has read, so before serving
 * a query it replays only the tail (another process's writes) and rescans
 * only when the journal shrank (compaction). `del` lines double as the
 * tombstones behind `exists → gone`.
 */

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../query";
import {
  ASSET_KINDS,
  ASSET_ORIGINS,
  type AssetBulkOp,
  type AssetBulkRequest,
  type AssetBulkResult,
  type AssetExistence,
  type AssetFacets,
  type AssetFileLocation,
  type AssetPage,
  type AssetPageRequest,
  type AssetPatch,
  type AssetRecord,
  type AssetSelection,
  type AssetView,
  type LibraryWorkflowEntry,
} from "../types";
import { errnoCode, LibraryError } from "./errors";
import {
  atomicWriteFile,
  foldsCase,
  isInsideRoot,
  KeyedMutex,
  mapConcurrent,
  pathKey,
  unlinkWithRetry,
} from "./fsutil";
import { acquireLock, DATA_DIR, libraryLayout, type LibraryLayout } from "./layout";
import { RunStore } from "./runs";
import {
  compareNewest,
  comparatorFor,
  compileQuery,
  computeFacets,
  decodeCursor,
  encodeCursor,
  indexAfter,
  indexAtOrAfter,
  recordSearchText,
  type QueryContext,
} from "./search";
import {
  extOf,
  isAssetId,
  isMd5,
  isMediaExtension,
  isSha256,
  isWorkflowId,
  MAX_SIDECAR_BYTES,
  normaliseTags,
  scrubRecord,
  validatePatch,
} from "./validate";
import { WorkflowTable, type WorkflowEntryInput } from "./workflows";

const SIDECAR_NAME = /^a[0-9a-z]{12,24}\.json$/;
/** Compact the journal past this size, keeping only `del` lines. */
const JOURNAL_COMPACT_BYTES = 5 * 1024 * 1024;
/** Tombstones kept through a compaction. */
const MAX_TOMBSTONES = 50_000;
/** A tail larger than this is cheaper to handle with a rescan. */
const MAX_TAIL_BYTES = 32 * 1024 * 1024;
/** How long a file check (stat) is trusted before a page stats it again. */
export const MISSING_TTL_MS = 30_000;
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type TrashHook = (file: string) => Promise<unknown>;

export interface AssetLibraryOptions {
  platform?: NodeJS.Platform;
  /** Sends a file to the OS Trash (desktop.ts in production, a fake in tests). */
  trash?: TrashHook;
  now?: () => number;
}

interface JournalLine {
  t: number;
  op: "put" | "del";
  id: string;
  pid: number;
  /** The writing instance, so a process skips its own lines on replay. */
  i: string;
}

/* ------------------------------------------------------------------ */
/* Sidecar parsing                                                     */
/* ------------------------------------------------------------------ */

/** Absolute path of a library-relative location, or null when it would leave the root or enter `.nodebanana`. */
export function libraryRelToPath(root: string, rel: unknown): string | null {
  if (typeof rel !== "string" || rel.length === 0 || rel.length > 1024) return null;
  const segments = rel.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[\\:\0]/.test(segment))) {
    return null;
  }
  const absolute = path.join(root, ...segments);
  if (!isInsideRoot(root, absolute)) return null;
  if (isInsideRoot(path.join(root, DATA_DIR), absolute, { allowEqual: true })) return null;
  return absolute;
}

export function relFromPath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Checks a sidecar read from a folder the user can edit (and sync). A record
 * whose file location escapes the root, or points at a non-media external
 * file, is dropped rather than trusted for streaming or deleting.
 */
export function parseRecord(value: unknown, expectedId: string, root: string, rawBytes = 0): AssetRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.id !== expectedId || !isAssetId(raw.id)) return null;
  if (!(ASSET_KINDS as readonly unknown[]).includes(raw.kind)) return null;
  if (!(ASSET_ORIGINS as readonly unknown[]).includes(raw.origin)) return null;
  if (typeof raw.mime !== "string" || typeof raw.ext !== "string" || !isMediaExtension(raw.ext)) return null;
  if (!isSha256(raw.sha256) || !isMd5(raw.md5)) return null;
  const bytes = optionalNumber(raw.bytes);
  const createdAt = optionalNumber(raw.createdAt);
  if (bytes === undefined || bytes < 0 || createdAt === undefined) return null;
  if (!isWorkflowId(raw.workflowId) || typeof raw.runId !== "string" || typeof raw.filename !== "string") return null;

  const fileValue = raw.file as Record<string, unknown> | undefined;
  let file: AssetFileLocation;
  if (fileValue?.root === "library") {
    if (!libraryRelToPath(root, fileValue.rel)) return null;
    file = { root: "library", rel: fileValue.rel as string };
  } else if (fileValue?.root === "external") {
    const external = fileValue.path;
    if (typeof external !== "string" || !path.isAbsolute(external) || !isMediaExtension(extOf(external))) return null;
    file = { root: "external", path: external };
  } else {
    return null;
  }

  const producer = (raw.producer ?? {}) as Record<string, unknown>;
  const record: AssetRecord = {
    ...(raw as unknown as AssetRecord),
    v: 1,
    bytes,
    createdAt,
    file,
    producer: {
      ...(producer as unknown as AssetRecord["producer"]),
      nodeId: typeof producer.nodeId === "string" ? producer.nodeId : "",
      nodeType: typeof producer.nodeType === "string" ? producer.nodeType : "",
    },
    workflowName: typeof raw.workflowName === "string" ? raw.workflowName : null,
    tags: normaliseTags(raw.tags),
    favorite: raw.favorite === true,
  };
  if (optionalNumber(raw.trashedAt) === undefined) delete record.trashedAt;
  for (const key of ["width", "height", "durationSec"] as const) {
    if (optionalNumber(raw[key]) === undefined) delete record[key];
  }
  return rawBytes > MAX_SIDECAR_BYTES ? scrubRecord(record) : record;
}

function sameMutableState(a: AssetRecord, b: AssetRecord): boolean {
  return (
    a.favorite === b.favorite &&
    a.trashedAt === b.trashedAt &&
    a.hasPoster === b.hasPoster &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index])
  );
}

/** How a bulk op changes one record (delete is handled separately). */
function applyBulkOp(record: AssetRecord, op: Exclude<AssetBulkOp, { action: "delete" }>, now: number): AssetRecord {
  switch (op.action) {
    case "tag": {
      const tags = normaliseTags([...record.tags, ...op.tags]);
      return { ...record, tags };
    }
    case "untag": {
      const remove = new Set(op.tags.map((tag) => tag.toLowerCase()));
      return { ...record, tags: record.tags.filter((tag) => !remove.has(tag.toLowerCase())) };
    }
    case "favorite":
      return { ...record, favorite: true };
    case "unfavorite":
      return { ...record, favorite: false };
    case "trash":
      return record.trashedAt === undefined ? { ...record, trashedAt: now } : record;
    case "restore": {
      const next = { ...record };
      delete next.trashedAt;
      return next;
    }
  }
}

function validateBulkOp(value: unknown): AssetBulkOp {
  const op = value as AssetBulkOp;
  if (!op || typeof op !== "object") throw new LibraryError("op is required", 400, "bad_request");
  switch (op.action) {
    case "tag":
    case "untag": {
      const tags = normaliseTags((op as { tags?: unknown }).tags);
      if (!tags.length) throw new LibraryError("tags are required", 400, "bad_request");
      return { action: op.action, tags };
    }
    case "favorite":
    case "unfavorite":
    case "trash":
    case "restore":
      return { action: op.action };
    case "delete":
      return { action: "delete", deleteProjectFiles: op.deleteProjectFiles === true };
    default:
      throw new LibraryError("Unknown bulk action", 400, "bad_request");
  }
}

/* ------------------------------------------------------------------ */
/* The index                                                           */
/* ------------------------------------------------------------------ */

export class AssetLibrary {
  readonly layout: LibraryLayout;
  readonly platform: NodeJS.Platform;
  readonly runs: RunStore;
  private readonly workflowTable: WorkflowTable;
  private readonly trash: TrashHook;
  private readonly now: () => number;
  private readonly instance = randomUUID().slice(0, 12);

  private records = new Map<string, AssetRecord>();
  /** Every record, `(createdAt desc, id desc)`. */
  private sorted: AssetRecord[] = [];
  private byHash = new Map<string, Set<string>>();
  private byPath = new Map<string, Set<string>>();
  private searchCache = new Map<string, string>();
  private tombstones = new Set<string>();
  private missing = new Map<string, { missing: boolean; at: number }>();
  private journalOffset = 0;
  private loadPromise: Promise<void> | null = null;
  private refreshPromise: Promise<void> | null = null;
  private isLoaded = false;
  private readonly idLocks = new KeyedMutex();
  /** Bumped on every change that can alter a query or facet result. */
  private revision = 0;
  private facetsCache: { revision: number; facets: AssetFacets } | null = null;
  private statsCache: { revision: number; stats: { assets: number; trashed: number; bytes: number } } | null = null;
  private readonly background = new Set<Promise<unknown>>();
  private compacting = false;
  /** Serialises this process's journal appends with compaction, so no line of ours is lost to the rewrite. */
  private readonly journalLock = new KeyedMutex();
  /** Mutations in flight; a full scan waits for them so it never reads a sidecar mid-change. */
  private mutations = 0;
  private mutationWaiters: (() => void)[] = [];
  /** Set while a full scan runs; mutations wait for it so none lands in maps the scan is replacing. */
  private scanGate: Promise<void> | null = null;

  constructor(root: string, options: AssetLibraryOptions = {}) {
    this.layout = libraryLayout(root);
    this.platform = options.platform ?? process.platform;
    this.trash = options.trash ?? (async (file) => (await import("./desktop")).trashFile(file));
    this.now = options.now ?? Date.now;
    this.workflowTable = new WorkflowTable(this.layout.workflowsFile, this.platform);
    this.runs = new RunStore(this.layout, { assetFileFor: (sha256) => this.assetFileFor(sha256) });
  }

  get root(): string {
    return this.layout.root;
  }

  get loaded(): boolean {
    return this.isLoaded;
  }

  /* Loading and freshness -------------------------------------------- */

  /** Starts the first scan (once). */
  ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.fullScan().then(() => {
      this.isLoaded = true;
      this.track(this.verifyFiles(this.sorted.filter((record) => record.trashedAt === undefined), 0, 8));
    });
    this.loadPromise.catch(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  /** Loaded and caught up with other processes' writes. */
  async ready(): Promise<void> {
    await this.ensureLoaded();
    await this.refresh();
  }

  /** Replays the journal tail and re-reads workflows.json if either changed. */
  refresh(): Promise<void> {
    this.refreshPromise ??= (async () => {
      try {
        await this.replayJournal();
        if (await this.workflowTable.refresh()) this.bump();
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  private bump(): void {
    this.revision++;
  }

  private track(promise: Promise<unknown>): void {
    const tracked = promise.catch((error) => console.warn("[assets]", error)).finally(() => this.background.delete(tracked));
    this.background.add(tracked);
  }

  /** Waits for background work (file checks, compaction). Tests and shutdown. */
  async drain(): Promise<void> {
    while (this.background.size) await Promise.all([...this.background]);
  }

  /** Marks a mutation as in flight (after any running scan); call the result when it is done. */
  private async beginMutation(): Promise<() => void> {
    while (this.scanGate) await this.scanGate;
    this.mutations++;
    return () => {
      this.mutations--;
      if (this.mutations === 0) {
        const waiters = this.mutationWaiters;
        this.mutationWaiters = [];
        waiters.forEach((wake) => wake());
      }
    };
  }

  private async fullScan(): Promise<void> {
    while (this.scanGate) await this.scanGate;
    let open!: () => void;
    this.scanGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    try {
      while (this.mutations > 0) await new Promise<void>((resolve) => this.mutationWaiters.push(resolve));
      await this.scanNow();
    } finally {
      this.scanGate = null;
      open();
    }
  }

  private async scanNow(): Promise<void> {
    await fs.mkdir(this.layout.assets, { recursive: true });
    let journal = Buffer.alloc(0);
    try {
      journal = await fs.readFile(this.layout.journal);
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
    }
    const complete = journal.subarray(0, journal.lastIndexOf(0x0a) + 1);
    const tombstones = new Set<string>();
    for (const line of this.parseJournal(complete)) {
      if (line.op === "del") tombstones.add(line.id);
      else tombstones.delete(line.id);
    }

    const names = (await fs.readdir(this.layout.assets)).filter((name) => SIDECAR_NAME.test(name));
    const loaded = await mapConcurrent(names, 32, (name) => this.readSidecar(name.slice(0, -5)));

    this.records = new Map();
    this.byHash = new Map();
    this.byPath = new Map();
    this.searchCache = new Map();
    for (const record of loaded) {
      if (!record) continue;
      this.records.set(record.id, record);
      this.indexLinks(record);
      tombstones.delete(record.id);
    }
    this.sorted = [...this.records.values()].sort(compareNewest);
    this.tombstones = tombstones;
    for (const id of this.missing.keys()) if (!this.records.has(id)) this.missing.delete(id);
    this.journalOffset = complete.length;
    await this.workflowTable.refresh();
    this.bump();
  }

  private parseJournal(buffer: Buffer): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const text of buffer.toString("utf8").split("\n")) {
      if (!text) continue;
      try {
        const line = JSON.parse(text) as JournalLine;
        if ((line.op === "put" || line.op === "del") && isAssetId(line.id)) lines.push(line);
      } catch {
        // A torn line from a crash mid-append; the sidecars are still the truth.
      }
    }
    return lines;
  }

  private async replayJournal(): Promise<void> {
    let size = 0;
    try {
      size = (await fs.stat(this.layout.journal)).size;
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
    }
    if (size < this.journalOffset || size - this.journalOffset > MAX_TAIL_BYTES) {
      await this.fullScan();
      return;
    }
    if (size === this.journalOffset) return;

    const length = size - this.journalOffset;
    const buffer = Buffer.alloc(length);
    const handle = await fs.open(this.layout.journal, "r");
    let bytesRead = 0;
    try {
      ({ bytesRead } = await handle.read(buffer, 0, length, this.journalOffset));
    } finally {
      await handle.close();
    }
    const lastNewline = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
    if (lastNewline < 0) return;
    this.journalOffset += lastNewline + 1;

    const latest = new Map<string, "put" | "del">();
    for (const line of this.parseJournal(buffer.subarray(0, lastNewline + 1))) {
      if (line.i === this.instance) continue;
      latest.set(line.id, line.op);
    }
    const puts: string[] = [];
    for (const [id, op] of latest) {
      if (op === "del") {
        this.removeFromIndex(id);
        this.tombstones.add(id);
        this.missing.delete(id);
      } else {
        puts.push(id);
      }
    }
    // Under the id lock, so a stale read can't land after one of our own writes to the same record.
    await mapConcurrent(puts, 32, (id) =>
      this.idLocks.run(id, async () => {
        const record = await this.readSidecar(id);
        if (record) this.upsertIndex(record);
      }),
    );
  }

  private journalLine(op: "put" | "del", id: string): string {
    const line: JournalLine = { t: this.now(), op, id, pid: process.pid, i: this.instance };
    return `${JSON.stringify(line)}\n`;
  }

  private async appendJournal(lines: string[]): Promise<void> {
    if (!lines.length) return;
    // The leading newline seals off a torn last line left by a crash, which would otherwise swallow ours.
    await this.journalLock.run("journal", () => fs.appendFile(this.layout.journal, `\n${lines.join("")}`));
    if (this.compacting) return;
    try {
      const { size } = await fs.stat(this.layout.journal);
      if (size > JOURNAL_COMPACT_BYTES) this.track(this.compactJournal());
    } catch {
      // Compaction is an optimisation.
    }
  }

  /**
   * Rewrites the journal keeping only `del` lines (the tombstones), under the
   * library lock. Every process — this one included — then sees the journal
   * shrink below its offset and rescans, which also picks up any line
   * appended in the instant between the read and the rename.
   */
  async compactJournal(): Promise<boolean> {
    if (this.compacting) return false;
    this.compacting = true;
    const lock = await acquireLock(this.layout.lock);
    try {
      if (!lock) return false;
      await this.journalLock.run("journal", async () => {
        const buffer = await fs.readFile(this.layout.journal);
        const deleted: JournalLine[] = [];
        const seen = new Set<string>();
        const lines = this.parseJournal(buffer);
        for (let index = lines.length - 1; index >= 0 && deleted.length < MAX_TOMBSTONES; index--) {
          const line = lines[index];
          if (seen.has(line.id)) continue;
          seen.add(line.id);
          if (line.op === "del") deleted.push(line);
        }
        deleted.reverse();
        const body = deleted.map((line) => `${JSON.stringify(line)}\n`).join("");
        await atomicWriteFile(this.layout.journal, body, { fsync: false });
      });
      this.journalOffset = Number.MAX_SAFE_INTEGER;
      return true;
    } finally {
      await lock?.release();
      this.compacting = false;
    }
  }

  /* Index maintenance ------------------------------------------------ */

  private addLink(map: Map<string, Set<string>>, key: string, id: string): void {
    const set = map.get(key);
    if (set) set.add(id);
    else map.set(key, new Set([id]));
  }

  private dropLink(map: Map<string, Set<string>>, key: string, id: string): void {
    const set = map.get(key);
    if (!set) return;
    set.delete(id);
    if (!set.size) map.delete(key);
  }

  private indexLinks(record: AssetRecord): void {
    this.addLink(this.byHash, record.sha256, record.id);
    const file = this.filePath(record);
    if (file) this.addLink(this.byPath, pathKey(file, this.platform), record.id);
  }

  private unindexLinks(record: AssetRecord): void {
    this.dropLink(this.byHash, record.sha256, record.id);
    const file = this.filePath(record);
    if (file) this.dropLink(this.byPath, pathKey(file, this.platform), record.id);
  }

  private sortedIndexOf(record: AssetRecord): number {
    const index = indexAtOrAfter(this.sorted, record, compareNewest);
    if (this.sorted[index]?.id === record.id) return index;
    return this.sorted.findIndex((item) => item.id === record.id);
  }

  private upsertIndex(record: AssetRecord): void {
    const previous = this.records.get(record.id);
    if (previous) {
      this.unindexLinks(previous);
      const index = this.sortedIndexOf(previous);
      if (index >= 0) this.sorted.splice(index, 1);
    }
    this.records.set(record.id, record);
    this.indexLinks(record);
    this.sorted.splice(indexAtOrAfter(this.sorted, record, compareNewest), 0, record);
    this.searchCache.delete(record.id);
    this.tombstones.delete(record.id);
    this.bump();
  }

  private removeFromIndex(id: string): void {
    const previous = this.records.get(id);
    if (!previous) return;
    this.unindexLinks(previous);
    const index = this.sortedIndexOf(previous);
    if (index >= 0) this.sorted.splice(index, 1);
    this.records.delete(id);
    this.searchCache.delete(id);
    this.bump();
  }

  /* Sidecars --------------------------------------------------------- */

  sidecarPath(id: string): string {
    if (!isAssetId(id)) throw new LibraryError("Invalid asset id", 400, "bad_request");
    return path.join(this.layout.assets, `${id}.json`);
  }

  /** The record as it is on disk now (null when absent or unreadable). */
  async readSidecar(id: string): Promise<AssetRecord | null> {
    if (!isAssetId(id)) return null;
    let text: string;
    try {
      text = await fs.readFile(this.sidecarPath(id), "utf8");
    } catch {
      return null;
    }
    try {
      return parseRecord(JSON.parse(text), id, this.root, text.length);
    } catch {
      return null;
    }
  }

  private async writeSidecar(record: AssetRecord, fsync: boolean): Promise<void> {
    await atomicWriteFile(this.sidecarPath(record.id), `${JSON.stringify(record)}\n`, { fsync });
  }

  /* Paths and views -------------------------------------------------- */

  /** Absolute path of a record's file (null for a location that fails validation). */
  filePath(record: AssetRecord): string | null {
    if (record.file.root === "library") return libraryRelToPath(this.root, record.file.rel);
    const external = record.file.path;
    return path.isAbsolute(external) && isMediaExtension(extOf(external)) ? external : null;
  }

  private projectKey = (projectPath: string): string =>
    foldsCase(this.platform) ? path.resolve(projectPath).toLowerCase() : path.resolve(projectPath);

  /** A record's workflow as the UI shows it: the workflows table first, the record's own name second. */
  workflowOf(record: AssetRecord): { name: string | null; projectPath: string | null } {
    const entry = this.workflowTable.get(record.workflowId);
    if (entry) return { name: entry.name ?? record.workflowName, projectPath: entry.projectPath };
    let projectPath: string | null = null;
    if (record.file.root === "external") {
      // A project file with no workflow row (e.g. from another machine): its folder is `<project>/generations`.
      const dir = path.dirname(record.file.path);
      if (path.basename(dir).toLowerCase() === "generations") projectPath = path.dirname(dir);
    }
    return { name: record.workflowName, projectPath };
  }

  private queryContext(): QueryContext {
    return {
      workflowOf: (record) => this.workflowOf(record),
      isMissing: (id) => this.missing.get(id)?.missing === true,
      searchText: (record) => {
        let text = this.searchCache.get(record.id);
        if (text === undefined) {
          text = recordSearchText(record);
          this.searchCache.set(record.id, text);
        }
        return text;
      },
      projectKey: this.projectKey,
    };
  }

  toView(record: AssetRecord): AssetView {
    const workflow = this.workflowOf(record);
    const view: AssetView = {
      ...record,
      workflow: { id: record.workflowId, name: workflow.name, projectPath: workflow.projectPath },
      displayPath: this.filePath(record) ?? "",
    };
    if (this.missing.get(record.id)?.missing) view.missing = true;
    return view;
  }

  get(id: string): AssetRecord | undefined {
    return this.records.get(id);
  }

  /** From memory, else straight from disk (another process may have just written it). */
  async find(id: string): Promise<AssetRecord | null> {
    if (!isAssetId(id)) return null;
    const known = this.records.get(id);
    if (known) return known;
    const fromDisk = await this.readSidecar(id);
    if (fromDisk) this.upsertIndex(fromDisk);
    return fromDisk;
  }

  recordsWithHash(sha256: string): AssetRecord[] {
    const ids = this.byHash.get(sha256);
    if (!ids) return [];
    return [...ids].map((id) => this.records.get(id)).filter((record): record is AssetRecord => Boolean(record));
  }

  /** Records whose file is this path (live or trashed). */
  recordsAtPath(file: string): AssetRecord[] {
    const ids = this.byPath.get(pathKey(file, this.platform));
    if (!ids) return [];
    return [...ids].map((id) => this.records.get(id)).filter((record): record is AssetRecord => Boolean(record));
  }

  allRecords(): readonly AssetRecord[] {
    return this.sorted;
  }

  /** An asset file on disk holding these bytes (for snapshot media and thumbnails). */
  async assetFileFor(sha256: string): Promise<{ path: string; mime: string; bytes: number; filename: string } | null> {
    for (const record of this.recordsWithHash(sha256)) {
      const file = this.filePath(record);
      if (!file) continue;
      try {
        const stat = await fs.stat(file);
        if (stat.isFile() && stat.size === record.bytes) {
          return { path: file, mime: record.mime, bytes: stat.size, filename: record.filename };
        }
      } catch {
        this.setMissing(record.id, true);
      }
    }
    return null;
  }

  /* Missing files ---------------------------------------------------- */

  setMissing(id: string, missing: boolean): void {
    const previous = this.missing.get(id);
    this.missing.set(id, { missing, at: this.now() });
    if ((previous?.missing ?? false) !== missing) this.bump();
  }

  isMissing(id: string): boolean {
    return this.missing.get(id)?.missing === true;
  }

  /** Stats the files of `records` whose last check is older than `maxAgeMs`. */
  async verifyFiles(records: readonly AssetRecord[], maxAgeMs: number = MISSING_TTL_MS, concurrency = 16): Promise<void> {
    const now = this.now();
    const stale = records.filter((record) => {
      const checked = this.missing.get(record.id);
      return !checked || now - checked.at >= maxAgeMs;
    });
    await mapConcurrent(stale, concurrency, async (record) => {
      const file = this.filePath(record);
      if (!file) {
        this.setMissing(record.id, true);
        return;
      }
      try {
        const stat = await fs.stat(file);
        this.setMissing(record.id, !stat.isFile());
      } catch (error) {
        const code = errnoCode(error);
        if (code === "ENOENT" || code === "ENOTDIR") this.setMissing(record.id, true);
      }
    });
  }

  /* Queries ---------------------------------------------------------- */

  async query(request: AssetPageRequest): Promise<AssetPage> {
    await this.ready();
    const limit = Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(request.limit ?? DEFAULT_PAGE_LIMIT)));
    const compare = comparatorFor(request.sort);
    const match = compileQuery(request, this.queryContext());
    const matched: AssetRecord[] = [];
    let totalBytes = 0;
    for (const record of this.sorted) {
      if (!match(record)) continue;
      matched.push(record);
      totalBytes += record.bytes;
    }
    if (request.sort === "oldest") matched.reverse();

    let page: AssetRecord[];
    let nextCursor: string | null = null;
    if (request.newerThan) {
      // New arrivals, nearest the client's head first so they join up with what it holds.
      const end = indexAtOrAfter(matched, decodeCursor(request.newerThan), compare);
      page = matched.slice(Math.max(0, end - limit), end);
    } else {
      const start = request.cursor ? indexAfter(matched, decodeCursor(request.cursor), compare) : 0;
      page = matched.slice(start, start + limit);
      if (start + limit < matched.length && page.length) nextCursor = encodeCursor(page[page.length - 1]);
    }
    await this.verifyFiles(page);
    return {
      assets: page.map((record) => this.toView(record)),
      nextCursor,
      headCursor: matched.length ? encodeCursor(matched[0]) : null,
      total: matched.length,
      totalBytes,
    };
  }

  async facets(): Promise<AssetFacets> {
    await this.ready();
    if (this.facetsCache?.revision !== this.revision) {
      this.facetsCache = { revision: this.revision, facets: computeFacets(this.sorted, this.queryContext()) };
    }
    return this.facetsCache.facets;
  }

  /** Live and trashed counts, and the bytes of distinct files (deduplicated files count once). */
  stats(): { assets: number; trashed: number; bytes: number } {
    if (this.statsCache?.revision !== this.revision) {
      let assets = 0;
      let trashed = 0;
      let bytes = 0;
      const files = new Set<string>();
      for (const record of this.sorted) {
        if (record.trashedAt === undefined) assets++;
        else trashed++;
        const file = this.filePath(record);
        const key = file ? pathKey(file, this.platform) : record.id;
        if (!files.has(key)) {
          files.add(key);
          bytes += record.bytes;
        }
      }
      this.statsCache = { revision: this.revision, stats: { assets, trashed, bytes } };
    }
    return this.statsCache.stats;
  }

  /** No asset was ever recorded here (drives the first-run hint). */
  isEmpty(): boolean {
    return this.records.size === 0 && this.tombstones.size === 0;
  }

  async existence(ids: string[]): Promise<Record<string, AssetExistence>> {
    await this.ready();
    const states: Record<string, AssetExistence> = {};
    const known: AssetRecord[] = [];
    for (const id of [...new Set(ids)].slice(0, 5000)) {
      if (!isAssetId(id)) {
        states[id] = "unknown";
        continue;
      }
      const record = this.records.get(id) ?? (this.tombstones.has(id) ? null : await this.find(id));
      if (record) known.push(record);
      else states[id] = this.tombstones.has(id) ? "gone" : "unknown";
    }
    await this.verifyFiles(known);
    for (const record of known) states[record.id] = this.isMissing(record.id) ? "gone" : "present";
    return states;
  }

  /* Workflows -------------------------------------------------------- */

  getWorkflow(id: string): LibraryWorkflowEntry | undefined {
    return this.workflowTable.get(id);
  }

  async upsertWorkflow(id: string, input: WorkflowEntryInput): Promise<LibraryWorkflowEntry> {
    const { entry, changed } = await this.workflowTable.upsert(id, input, this.now());
    if (changed) this.bump();
    return entry;
  }

  /* Mutations -------------------------------------------------------- */

  /** Runs a change to one record under its lock, counted as a mutation so a full scan waits for it. */
  private mutate<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return this.idLocks.run(id, async () => {
      const done = await this.beginMutation();
      try {
        return await fn();
      } finally {
        done();
      }
    });
  }

  /** Writes a new record (sidecar fsynced, then the journal line). */
  async addRecord(record: AssetRecord): Promise<AssetRecord> {
    const clean = scrubRecord(record);
    return this.mutate(clean.id, async () => {
      await fs.mkdir(this.layout.assets, { recursive: true });
      await this.writeSidecar(clean, true);
      this.upsertIndex(clean);
      this.setMissing(clean.id, false);
      await this.appendJournal([this.journalLine("put", clean.id)]);
      return clean;
    });
  }

  /**
   * Read-modify-write of one record under its lock, re-reading the sidecar
   * from disk so a change made by another process is never overwritten with
   * a stale copy. Returns the journal line for the caller to append.
   */
  private async updateRecord(
    id: string,
    mutate: (record: AssetRecord) => AssetRecord,
  ): Promise<{ record: AssetRecord | null; line?: string }> {
    return this.mutate(id, async () => {
      const current = await this.readSidecar(id);
      if (!current) {
        this.removeFromIndex(id);
        return { record: null };
      }
      const next = mutate(current);
      if (sameMutableState(current, next)) {
        const known = this.records.get(id);
        if (!known || !sameMutableState(known, current)) this.upsertIndex(current);
        return { record: current };
      }
      const clean = scrubRecord(next);
      await this.writeSidecar(clean, false);
      this.upsertIndex(clean);
      return { record: clean, line: this.journalLine("put", id) };
    });
  }

  async patch(id: string, value: AssetPatch): Promise<AssetView | null> {
    if (!isAssetId(id)) return null;
    const patch = validatePatch(value);
    await this.ready();
    const now = this.now();
    const { record, line } = await this.updateRecord(id, (current) => {
      const next: AssetRecord = { ...current };
      if (patch.tags) next.tags = patch.tags;
      if (patch.favorite !== undefined) next.favorite = patch.favorite;
      if (patch.trashed === true && next.trashedAt === undefined) next.trashedAt = now;
      if (patch.trashed === false) delete next.trashedAt;
      return next;
    });
    if (line) await this.appendJournal([line]);
    return record ? this.toView(record) : null;
  }

  async setHasPoster(id: string): Promise<AssetRecord | null> {
    const { record, line } = await this.updateRecord(id, (current) => ({ ...current, hasPoster: true }));
    if (line) await this.appendJournal([line]);
    return record;
  }

  /** The ids a selection covers right now (a query selection is evaluated at call time). */
  resolveSelection(selection: AssetSelection): string[] {
    if (!selection || typeof selection !== "object") throw new LibraryError("selection is required", 400, "bad_request");
    if (selection.mode === "ids") {
      if (!Array.isArray(selection.ids)) throw new LibraryError("selection.ids must be a list", 400, "bad_request");
      return [...new Set(selection.ids.filter(isAssetId))];
    }
    if (selection.mode === "query") {
      const exclude = new Set(Array.isArray(selection.excludeIds) ? selection.excludeIds : []);
      const match = compileQuery(selection.query ?? {}, this.queryContext());
      return this.sorted.filter((record) => !exclude.has(record.id) && match(record)).map((record) => record.id);
    }
    throw new LibraryError("Unknown selection mode", 400, "bad_request");
  }

  async bulk(request: AssetBulkRequest): Promise<AssetBulkResult> {
    if (!request || typeof request !== "object") throw new LibraryError("Invalid request", 400, "bad_request");
    const op = validateBulkOp(request.op);
    await this.ready();
    const ids = this.resolveSelection(request.selection);
    if (op.action === "delete") return this.deleteRecords(ids, { deleteProjectFiles: op.deleteProjectFiles });

    const now = this.now();
    const done = new Set<string>();
    const errors: AssetBulkResult["errors"] = [];
    let lines: string[] = [];
    const flush = async () => {
      const batch = lines;
      lines = [];
      await this.appendJournal(batch);
    };
    await mapConcurrent(ids, 8, async (id) => {
      try {
        const { record, line } = await this.updateRecord(id, (current) => applyBulkOp(current, op, now));
        if (!record) {
          errors.push({ id, error: "Not found" });
          return;
        }
        done.add(id);
        if (line) lines.push(line);
        if (lines.length >= 500) await flush();
      } catch (error) {
        errors.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    });
    await flush();
    const affected = ids.filter((id) => done.has(id));
    return { affected: affected.length, ids: affected, errors };
  }

  /**
   * Removes records for good. Sidecars go first (with `del` journal lines);
   * then each file no remaining record uses is released — library files and,
   * with `deleteProjectFiles`, project files. Bytes a stored workflow
   * snapshot still references move into `.nodebanana/media` instead of the
   * OS Trash, so "open original workflow" keeps working.
   */
  async deleteRecords(ids: string[], options: { deleteProjectFiles?: boolean } = {}): Promise<AssetBulkResult> {
    await this.ready();
    const removed: AssetRecord[] = [];
    const done = new Set<string>();
    const errors: AssetBulkResult["errors"] = [];
    const lines: string[] = [];
    await mapConcurrent([...new Set(ids.filter(isAssetId))], 8, (id) =>
      this.mutate(id, async () => {
        try {
          const record = await this.readSidecar(id);
          if (!record) {
            this.removeFromIndex(id);
            if (this.tombstones.has(id)) done.add(id);
            else errors.push({ id, error: "Not found" });
            return;
          }
          await unlinkWithRetry(this.sidecarPath(id));
          this.removeFromIndex(id);
          this.tombstones.add(id);
          this.missing.delete(id);
          removed.push(record);
          lines.push(this.journalLine("del", id));
          done.add(id);
        } catch (error) {
          errors.push({ id, error: error instanceof Error ? error.message : String(error) });
        }
      }),
    );
    await this.appendJournal(lines);
    await this.releaseFiles(removed, options.deleteProjectFiles === true);
    const affected = [...new Set(ids)].filter((id) => done.has(id));
    return { affected: affected.length, ids: affected, errors };
  }

  /** Re-checks that a file is the one the record describes before anything moves or trashes it. */
  private async isOwnedFile(record: AssetRecord, file: string): Promise<boolean> {
    if (record.file.root === "library") {
      if (!isInsideRoot(this.layout.generations, file, { platform: this.platform })) return false;
    } else if (file !== record.file.path || !isMediaExtension(extOf(file))) {
      return false;
    }
    try {
      const stat = await fs.stat(file);
      return stat.isFile() && stat.size === record.bytes;
    } catch {
      return false;
    }
  }

  private async releaseFiles(removed: AssetRecord[], deleteProjectFiles: boolean): Promise<void> {
    if (!removed.length) return;
    const byFile = new Map<string, { record: AssetRecord; file: string }>();
    for (const record of removed) {
      if (record.file.root === "external" && !deleteProjectFiles) continue;
      const file = this.filePath(record);
      if (file) byFile.set(pathKey(file, this.platform), { record, file });
    }
    if (!byFile.size) return;
    const referenced = await this.runs.referencedHashes();
    for (const [key, { record, file }] of byFile) {
      if (this.byPath.get(key)?.size) continue;
      if (!(await this.isOwnedFile(record, file))) continue;
      try {
        if (referenced.has(record.sha256) && (await this.runs.adoptFile(record.sha256, record.ext, file))) continue;
        await this.trash(file);
      } catch (error) {
        console.warn("[assets] could not remove", file, error);
      }
    }
  }

  /** Permanently deletes records that have been in the Trash longer than the retention period. */
  async emptyExpiredTrash(retentionMs: number = TRASH_RETENTION_MS): Promise<number> {
    await this.ready();
    const cutoff = this.now() - retentionMs;
    const expired = this.sorted
      .filter((record) => record.trashedAt !== undefined && record.trashedAt <= cutoff)
      .map((record) => record.id);
    if (!expired.length) return 0;
    const result = await this.deleteRecords(expired);
    return result.affected;
  }

  /* Dedupe ----------------------------------------------------------- */

  /**
   * A file already holding these bytes in the destination, so a new record
   * can point at it instead of writing a copy. Library destinations match
   * anywhere under Generations/; project destinations match only that
   * project's generations folder (by index, then by the legacy
   * `_<md5>.<ext>` name). Sizes must match — a truncated file never wins.
   */
  async findReusableFile(input: {
    sha256: string;
    md5: string;
    bytes: number;
    ext: string;
    destination: { type: "library" } | { type: "project"; dir: string };
  }): Promise<{ file: AssetFileLocation; path: string; filename: string; source?: AssetRecord } | null> {
    const sizeMatches = async (file: string) => {
      try {
        const stat = await fs.stat(file);
        return stat.isFile() && stat.size === input.bytes;
      } catch {
        return false;
      }
    };
    const destination = input.destination;
    for (const record of this.recordsWithHash(input.sha256)) {
      const file = this.filePath(record);
      if (!file || record.bytes !== input.bytes) continue;
      if (destination.type === "library") {
        if (record.file.root !== "library" || !isInsideRoot(this.layout.generations, file, { platform: this.platform })) continue;
      } else if (record.file.root !== "external" || pathKey(path.dirname(file), this.platform) !== pathKey(destination.dir, this.platform)) {
        continue;
      }
      if (await sizeMatches(file)) {
        return { file: record.file, path: file, filename: path.basename(file), source: record };
      }
    }
    if (destination.type === "project") {
      let names: string[] = [];
      try {
        names = await fs.readdir(destination.dir);
      } catch {
        names = [];
      }
      const suffix = `_${input.md5}.${input.ext}`.toLowerCase();
      for (const name of names) {
        if (!name.toLowerCase().endsWith(suffix)) continue;
        const file = path.join(destination.dir, name);
        if (await sizeMatches(file)) return { file: { root: "external", path: file }, path: file, filename: name };
      }
    }
    return null;
  }
}

