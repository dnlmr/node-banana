/**
 * Grid thumbnails and video/3D posters.
 *
 * Thumbnails are 320 and 640 px wide webp files in the local cache
 * (`<cache>/thumbs/<sha256>-<w>.webp`), keyed by content so they never need
 * invalidating — not by a move, a re-index or a relink. Images are rendered
 * at record time in a background queue (one at a time); misses are rendered
 * on demand, two at a time. sharp is loaded lazily with its file cache off
 * and is only ever handed Buffers, so libvips never holds a library file
 * open (an open handle blocks renames and deletes on Windows).
 *
 * Video and 3D thumbnails come from a poster the browser captures and
 * uploads (`.nodebanana/posters/<sha256>.webp`): Node has no video decoder.
 *
 * An image asset's file sharp can't decode at all is reported through
 * `onUndecodable`, and the facade checks whether its records are unreadable
 * (then they are no longer listed, nor thumbnailed).
 */

import { promises as fs } from "fs";
import path from "path";
import { THUMB_WIDTHS, type AssetRecord } from "../types";
import { errnoCode, LibraryError } from "./errors";
import { atomicWriteFile, mapConcurrent, Semaphore, unlinkWithRetry } from "./fsutil";
import type { AssetLibrary } from "./library";
import { sniffFamily } from "./media";
import { isSha256 } from "./validate";

export type ThumbWidth = (typeof THUMB_WIDTHS)[number];

type SharpModule = typeof import("sharp");

let sharpModule: Promise<SharpModule | null> | null = null;

/** sharp, configured for a long-lived server, or null when its native binary will not load. */
export function loadSharp(): Promise<SharpModule | null> {
  sharpModule ??= import("sharp")
    .then((module) => {
      const sharp = ((module as unknown as { default?: SharpModule }).default ?? module) as SharpModule;
      sharp.cache(false);
      sharp.concurrency(2);
      return sharp;
    })
    .catch(() => null);
  return sharpModule;
}

/** Sources larger than this are not thumbnailed (decoding them would cost far more than a placeholder). */
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_POSTER_BYTES = 16 * 1024 * 1024;
export const THUMB_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const THUMB_CACHE_TARGET_BYTES = 1.5 * 1024 * 1024 * 1024;
/** Serving a thumbnail refreshes its atime at most this often (the trim evicts by atime). */
const ATIME_REFRESH_MS = 24 * 60 * 60 * 1000;

export interface ServedThumb {
  path: string;
  mime: string;
  bytes: number;
  sha256: string;
  filename: string;
}

export function isThumbWidth(value: number): value is ThumbWidth {
  return (THUMB_WIDTHS as readonly number[]).includes(value);
}

/**
 * A failure of the decoder itself — the bytes — as opposed to the file
 * system (an errno code: ENOENT, EACCES, EMFILE…), memory, or time.
 */
export function isDecodeError(error: unknown): boolean {
  if (!(error instanceof Error) || errnoCode(error)) return false;
  return !/time(d)?\s?out|memory|cancel|abort|EMFILE|ENOENT|EACCES|EBUSY/i.test(error.message);
}

/** What rendering thumbnails from a source came to. */
type RenderOutcome = "ok" | "failed" | "undecodable";

/** The bytes a hash's thumbnails come from, and the asset file they were read from (not for a poster). */
interface ThumbSource {
  bytes: Buffer;
  file?: string;
}

export interface ThumbnailerOptions {
  /**
   * sharp could not decode an image asset's file (a decode error, not a
   * missing file or a timeout). The library decides whether its records are
   * unreadable.
   */
  onUndecodable?: (sha256: string, file: string) => void;
}

export class Thumbnailer {
  readonly dir: string;
  private readonly onDemand = new Semaphore(2);
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private readonly inFlight = new Map<string, Promise<boolean>>();

  constructor(
    cacheDir: string,
    private readonly library: () => AssetLibrary | null,
    private readonly options: ThumbnailerOptions = {},
  ) {
    this.dir = path.join(cacheDir, "thumbs");
  }

  thumbPath(sha256: string, width: ThumbWidth): string {
    return path.join(this.dir, `${sha256}-${width}.webp`);
  }

  private posterPath(sha256: string): string | null {
    const library = this.library();
    return library ? path.join(library.layout.posters, `${sha256}.webp`) : null;
  }

  /**
   * Renders every width from one decoded source. `undecodable` when sharp
   * could not decode the bytes at all (the other widths are not tried).
   */
  private async render(sha256: string, source: Buffer, widths: readonly ThumbWidth[]): Promise<RenderOutcome> {
    const sharp = await loadSharp();
    if (!sharp) return "failed";
    await fs.mkdir(this.dir, { recursive: true });
    let outcome: RenderOutcome = "ok";
    for (const width of widths) {
      let output: Buffer;
      try {
        output = await sharp(source, { animated: false, failOn: "none" })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
      } catch (error) {
        if (isDecodeError(error)) return "undecodable";
        outcome = "failed";
        continue;
      }
      try {
        await atomicWriteFile(this.thumbPath(sha256, width), output, { fsync: false });
      } catch {
        outcome = "failed";
      }
    }
    return outcome;
  }

  /** The bytes thumbnails of this hash are made from: a poster, else a readable image asset's file. */
  private async sourceFor(sha256: string): Promise<ThumbSource | null> {
    const poster = this.posterPath(sha256);
    if (poster) {
      try {
        return { bytes: await fs.readFile(poster) };
      } catch {
        // No poster; try the file itself.
      }
    }
    const library = this.library();
    if (!library) return null;
    for (const record of library.recordsWithHash(sha256)) {
      if (record.kind !== "image" || record.unreadable || record.bytes > MAX_SOURCE_BYTES) continue;
      const file = library.filePath(record);
      if (!file) continue;
      try {
        return { bytes: await fs.readFile(file), file };
      } catch (error) {
        library.noteFileError(record.id, error);
      }
    }
    return null;
  }

  private renderOnce(sha256: string, source: () => Promise<ThumbSource | null>): Promise<boolean> {
    let job = this.inFlight.get(sha256);
    if (!job) {
      job = (async () => {
        const found = await source();
        if (!found) return false;
        const outcome = await this.render(sha256, found.bytes, THUMB_WIDTHS);
        // Only an asset's own file says something about the asset; a broken poster doesn't.
        if (outcome === "undecodable" && found.file) this.options.onUndecodable?.(sha256, found.file);
        return outcome === "ok";
      })().finally(() => this.inFlight.delete(sha256));
      this.inFlight.set(sha256, job);
    }
    return job;
  }

  /** Queues thumbnails for a just-recorded image (background, one at a time). */
  enqueue(record: AssetRecord, file: string): void {
    if (record.kind !== "image" || record.unreadable || record.bytes > MAX_SOURCE_BYTES) return;
    this.pending++;
    this.queue = this.queue
      .then(async () => {
        if (await this.hasAll(record.sha256)) return;
        await this.renderOnce(record.sha256, async () => {
          const bytes = await fs.readFile(file).catch(() => null);
          return bytes ? { bytes, file } : null;
        });
      })
      .catch(() => {})
      .finally(() => {
        this.pending--;
      });
  }

  /** Waits for the record-time queue to empty. */
  async drain(): Promise<void> {
    while (this.pending) await this.queue;
    await Promise.all([...this.inFlight.values()]);
  }

  private async hasAll(sha256: string): Promise<boolean> {
    for (const width of THUMB_WIDTHS) {
      try {
        await fs.access(this.thumbPath(sha256, width));
      } catch {
        return false;
      }
    }
    return true;
  }

  private async served(sha256: string, width: ThumbWidth): Promise<ServedThumb | null> {
    const file = this.thumbPath(sha256, width);
    try {
      const stat = await fs.stat(file);
      if (Date.now() - stat.atimeMs > ATIME_REFRESH_MS) {
        await fs.utimes(file, new Date(), stat.mtime).catch(() => {});
      }
      return { path: file, mime: "image/webp", bytes: stat.size, sha256: `${sha256}-${width}`, filename: path.basename(file) };
    } catch {
      return null;
    }
  }

  /** A cached thumbnail, rendered on a miss (two renders at a time). Null → the client draws a placeholder. */
  async get(sha256: string, width: number): Promise<ServedThumb | null> {
    if (!isSha256(sha256) || !isThumbWidth(width)) return null;
    const cached = await this.served(sha256, width);
    if (cached) return cached;
    const library = this.library();
    if (!library || !library.recordsWithHash(sha256).some((record) => !record.unreadable)) return null;
    const rendered = await this.onDemand.run(() => this.renderOnce(sha256, () => this.sourceFor(sha256)));
    return rendered || (await this.hasAll(sha256)) ? this.served(sha256, width) : null;
  }

  /**
   * Stores a browser-made poster for a video or 3D asset as webp, then
   * derives its thumbnails from it.
   */
  async putPoster(record: AssetRecord, bytes: Uint8Array, mime: string): Promise<void> {
    if (record.kind !== "video" && record.kind !== "3d") {
      throw new LibraryError("Posters are only for video and 3D assets", 400, "bad_request");
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_POSTER_BYTES) {
      throw new LibraryError("The poster must be an image under 16 MB", 413, "too_large");
    }
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const family = sniffFamily(buffer)?.[0];
    if (family !== "webp" && family !== "jpg" && family !== "png") {
      throw new LibraryError("The poster must be a webp, jpeg or png image", 415, "unsupported");
    }
    // The bytes decide; `mime` is only the client's label for them.
    void mime;
    let webp: Buffer = buffer;
    if (family !== "webp") {
      const sharp = await loadSharp();
      if (!sharp) throw new LibraryError("Posters must be webp on this server", 415, "unsupported");
      webp = await sharp(buffer, { failOn: "none" }).webp({ quality: 82 }).toBuffer();
    }
    const poster = this.posterPath(record.sha256);
    if (!poster) throw new LibraryError("The library is not available", 503, "unavailable");
    await fs.mkdir(path.dirname(poster), { recursive: true });
    await atomicWriteFile(poster, webp, { fsync: false });
    await this.render(record.sha256, webp, THUMB_WIDTHS);
  }

  /** Deletes the least recently used thumbnails when the cache is over `maxBytes`, down to `targetBytes`. */
  async trim(maxBytes = THUMB_CACHE_MAX_BYTES, targetBytes = THUMB_CACHE_TARGET_BYTES): Promise<number> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return 0;
    }
    const entries = (
      await mapConcurrent(names, 32, async (name) => {
        const file = path.join(this.dir, name);
        try {
          const stat = await fs.stat(file);
          return stat.isFile() ? { file, size: stat.size, atime: stat.atimeMs } : null;
        } catch {
          return null;
        }
      })
    ).filter((entry): entry is { file: string; size: number; atime: number } => entry !== null);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= maxBytes) return 0;
    entries.sort((a, b) => a.atime - b.atime);
    let removed = 0;
    for (const entry of entries) {
      if (total <= targetBytes) break;
      try {
        await unlinkWithRetry(entry.file);
        total -= entry.size;
        removed++;
      } catch {
        // Held open; skip it.
      }
    }
    return removed;
  }

  /** Empties the thumbnail cache. */
  async clear(): Promise<number> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      try {
        await unlinkWithRetry(path.join(this.dir, name));
        removed++;
      } catch {
        // Held open; the next clear gets it.
      }
    }
    return removed;
  }
}

/** Test hook: forget the cached sharp import. */
export function resetSharpForTests(): void {
  sharpModule = null;
}
