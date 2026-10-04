/**
 * The model catalog: each fetched provider's list (Replicate, fal.ai,
 * WaveSpeed), kept on disk under `~/.node-banana/catalog/` and in memory,
 * and served straight away.
 *
 * - A list younger than CATALOG_FRESH_MS is served as it is.
 * - An older list is served as it is too, and refreshed in the background;
 *   the next request gets the new one.
 * - With nothing stored (first run, or the file is gone) the request waits
 *   for the fetch, under the caller's deadline.
 * - A refresh that fails keeps the previous list and reports the error
 *   beside it, so a bad key or an outage never empties the browse dialog.
 *
 * `NODE_BANANA_CATALOG_DIR` moves the folder (tests point it at a temp dir).
 * Server only.
 */

import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startDeadline } from "./deadline";
import type { ProviderModel } from "./types";

/** How long a stored list is served without a refresh being started. */
export const CATALOG_FRESH_MS = 6 * 60 * 60 * 1000;
export const CATALOG_DIR_ENV = "NODE_BANANA_CATALOG_DIR";

interface StoredCatalog {
  v: 1;
  provider: string;
  fetchedAt: number;
  models: ProviderModel[];
}

interface CatalogEntry {
  models: ProviderModel[];
  fetchedAt: number;
}

export interface CatalogStatus {
  models: ProviderModel[];
  /** When the list was fetched from the provider; null when there is none yet. */
  fetchedAt: number | null;
  /** Served from the stored list, with no fetch waited on in this call. */
  cached: boolean;
  /** The stored list is older than CATALOG_FRESH_MS. */
  stale: boolean;
  /** A refresh is running in the background; ask again for the new list. */
  refreshing: boolean;
  /** The last fetch failed. The models are the previous list, if there was one. */
  error?: string;
}

export interface CatalogOptions {
  /** Wait for a fresh fetch even when a list is stored. */
  refresh?: boolean;
  /** How long one fetch (all its pages) may take. */
  timeoutMs: number;
  /** For tests. */
  now?: number;
}

/** Fetches a provider's whole list; aborted through the signal when the deadline passes. */
export type CatalogFetcher = (signal: AbortSignal) => Promise<ProviderModel[]>;

interface ProviderSlot {
  entry: CatalogEntry | null;
  /** The disk has been read once. */
  loaded: boolean;
  inFlight: Promise<CatalogEntry> | null;
  lastError: string | null;
}

const slots = new Map<string, ProviderSlot>();

export function catalogDir(): string {
  return process.env[CATALOG_DIR_ENV] || path.join(os.homedir(), ".node-banana", "catalog");
}

function fileFor(provider: string): string {
  return path.join(catalogDir(), `${provider}.json`);
}

function readStored(provider: string): CatalogEntry | null {
  try {
    const data = JSON.parse(fsSync.readFileSync(fileFor(provider), "utf8")) as Partial<StoredCatalog>;
    if (data.v !== 1 || !Array.isArray(data.models) || typeof data.fetchedAt !== "number") return null;
    return { models: data.models as ProviderModel[], fetchedAt: data.fetchedAt };
  } catch {
    return null;
  }
}

async function writeStored(provider: string, entry: CatalogEntry): Promise<void> {
  const file = fileFor(provider);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const stored: StoredCatalog = { v: 1, provider, fetchedAt: entry.fetchedAt, models: entry.models };
    // Written beside, then moved in, so a crash mid-write never leaves a half file
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(stored));
    await fs.rename(tmp, file);
  } catch (error) {
    console.warn(`[Catalog] could not store ${provider}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function slotFor(provider: string): ProviderSlot {
  let slot = slots.get(provider);
  if (!slot) {
    slot = { entry: null, loaded: false, inFlight: null, lastError: null };
    slots.set(provider, slot);
  }
  if (!slot.loaded) {
    slot.entry = readStored(provider);
    slot.loaded = true;
  }
  return slot;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One fetch at a time per provider: a second caller joins the one in flight. */
function runFetch(provider: string, slot: ProviderSlot, fetcher: CatalogFetcher, timeoutMs: number): Promise<CatalogEntry> {
  if (slot.inFlight) return slot.inFlight;
  const deadline = startDeadline(timeoutMs);
  const work = (async () => {
    try {
      const models = await deadline.race(fetcher(deadline.signal));
      const entry: CatalogEntry = { models, fetchedAt: Date.now() };
      slot.entry = entry;
      slot.lastError = null;
      void writeStored(provider, entry);
      return entry;
    } catch (error) {
      slot.lastError = errorMessage(error);
      throw error;
    } finally {
      deadline.clear();
      slot.inFlight = null;
    }
  })();
  slot.inFlight = work;
  return work;
}

function status(entry: CatalogEntry, extra: Pick<CatalogStatus, "cached" | "stale" | "refreshing">, error: string | null): CatalogStatus {
  return { models: entry.models, fetchedAt: entry.fetchedAt, ...extra, ...(error ? { error } : {}) };
}

/**
 * The provider's list, as described above. Throws only when there is no
 * stored list and the fetch fails: the caller then reports the provider as
 * failed, the way it always has.
 */
export async function getProviderCatalog(
  provider: string,
  fetcher: CatalogFetcher,
  { refresh = false, timeoutMs, now = Date.now() }: CatalogOptions,
): Promise<CatalogStatus> {
  const slot = slotFor(provider);
  const entry = slot.entry;

  if (!refresh && entry) {
    const fresh = now - entry.fetchedAt < CATALOG_FRESH_MS;
    if (fresh) return status(entry, { cached: true, stale: false, refreshing: slot.inFlight !== null }, slot.lastError);
    // Serve what is there; the new list is fetched behind it
    runFetch(provider, slot, fetcher, timeoutMs).catch(() => {});
    return status(entry, { cached: true, stale: true, refreshing: true }, slot.lastError);
  }

  try {
    const fetched = await runFetch(provider, slot, fetcher, timeoutMs);
    return status(fetched, { cached: false, stale: false, refreshing: false }, null);
  } catch (error) {
    if (entry) return status(entry, { cached: true, stale: true, refreshing: false }, errorMessage(error));
    throw error;
  }
}

/** A refresh in flight for the provider, if any (so a caller can wait for it). */
export function catalogRefreshInFlight(provider: string): Promise<unknown> | null {
  return slots.get(provider)?.inFlight ?? null;
}

/** Forget every loaded list (tests). The files stay unless `disk` is set. */
export function resetCatalog({ disk = false }: { disk?: boolean } = {}): void {
  if (disk) {
    for (const provider of slots.keys()) {
      try {
        fsSync.rmSync(fileFor(provider), { force: true });
      } catch {
        // nothing to remove
      }
    }
  }
  slots.clear();
}
