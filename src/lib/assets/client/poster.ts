/**
 * Video posters. The server cannot decode video frames, so after a video is
 * recorded the browser loads it from the library (same origin), seeks a
 * little way in, draws that frame 640 px wide and uploads it; the server
 * derives the grid thumbnails from it. Best effort: a missing poster only
 * means a placeholder tile. `ensurePoster` tries a failed capture again with
 * backoff, and gives up on that video for the session after three tries.
 */

import type { AssetView } from "../types";
import { assetFileUrl, uploadPoster } from "./api";
import { delay, withRetry } from "./async";
import { createEmitter } from "./emitter";

const POSTER_WIDTH = 640;
const STEP_TIMEOUT_MS = 20_000;
/** Captures per video in all, and the waits between them. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5_000, 30_000];

/** `unsupported`: this browser cannot make a poster at all, so another try is pointless. */
type Outcome = "stored" | "failed" | "unsupported";

/** One capture at a time: each holds a decoder and a full-size frame. */
let queue: Promise<unknown> = Promise.resolve();

function waitFor(video: HTMLVideoElement, event: "loadeddata" | "seeked"): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${event}`)), STEP_TIMEOUT_MS);
    const onEvent = () => finish();
    const onError = () => finish(new Error("The video could not be decoded"));
    function finish(error?: Error) {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    }
    video.addEventListener(event, onEvent);
    video.addEventListener("error", onError);
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/** False where this browser (or jsdom) cannot play video at all. */
function canPlay(video: HTMLVideoElement, mime?: string): boolean {
  if (typeof video.canPlayType !== "function") return false;
  return [mime, "video/mp4", "video/webm"].some((type) => !!type && video.canPlayType(type) !== "");
}

async function capture(assetId: string, mime?: string): Promise<Outcome> {
  if (typeof document === "undefined") return "unsupported";
  const video = document.createElement("video");
  if (!canPlay(video, mime)) return "unsupported";
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const loaded = waitFor(video, "loadeddata");
    video.src = assetFileUrl(assetId);
    await loaded;

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const target = Math.min(0.1, duration / 2);
    if (target > 0 && Math.abs(video.currentTime - target) > 0.001) {
      const seeked = waitFor(video, "seeked");
      video.currentTime = target;
      await seeked;
    }

    const { videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight) return "failed";
    const canvas = document.createElement("canvas");
    canvas.width = POSTER_WIDTH;
    canvas.height = Math.max(1, Math.round((POSTER_WIDTH * videoHeight) / videoWidth));
    const context = canvas.getContext("2d");
    if (!context) return "unsupported";
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Browsers without a WebP encoder hand back PNG; JPEG is the smaller fallback.
    let poster = await toBlob(canvas, "image/webp", 0.8);
    if (!poster || poster.type !== "image/webp") poster = await toBlob(canvas, "image/jpeg", 0.85);
    if (!poster) return "failed";
    // A blip, or a library move holding writes, is waited out rather than lost.
    await withRetry(() => uploadPoster(assetId, poster));
    return "stored";
  } catch (error) {
    console.warn("Couldn't make a poster for a recorded video:", error instanceof Error ? error.message : error);
    return "failed";
  } finally {
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      // Releasing the decoder is a courtesy.
    }
  }
}

function enqueue(assetId: string, mime?: string): Promise<Outcome> {
  const run = queue.then(() => capture(assetId, mime)).catch((): Outcome => "failed");
  queue = run;
  return run;
}

/** Makes and uploads a poster for a recorded video, once. Never rejects; resolves whether a poster was stored. */
export function capturePoster(assetId: string, mime?: string): Promise<boolean> {
  return enqueue(assetId, mime).then((outcome) => outcome === "stored");
}

const posterReady = createEmitter<string>();
const inFlight = new Map<string, Promise<boolean>>();
/** Videos whose poster this session stored, and ones it gave up on. */
const stored = new Set<string>();
const gaveUp = new Set<string>();

/** Fires with the asset id once a poster was stored, so tiles can load their thumbnail again. */
export function onPosterReady(listener: (assetId: string) => void): () => void {
  return posterReady.on(listener);
}

/**
 * Makes sure a video asset has a poster: captures one when it has none,
 * once at a time per asset. A failed capture or upload is tried again after
 * 5 s and 30 s; after three failures (or at once where this browser cannot
 * make posters) the video is left alone for the rest of the session.
 * Resolves true once this session has stored a poster for it (now or
 * earlier, so a tile holding an old view can load its thumbnail again).
 */
export function ensurePoster(asset: Pick<AssetView, "id" | "kind" | "mime" | "hasPoster">): Promise<boolean> {
  if (asset.kind !== "video" || asset.hasPoster || gaveUp.has(asset.id)) return Promise.resolve(false);
  if (stored.has(asset.id)) return Promise.resolve(true);
  const running = inFlight.get(asset.id);
  if (running) return running;
  const run = (async () => {
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await enqueue(asset.id, asset.mime);
      if (outcome === "stored") {
        stored.add(asset.id);
        posterReady.emit(asset.id);
        return true;
      }
      if (outcome === "unsupported" || attempt >= MAX_ATTEMPTS) {
        gaveUp.add(asset.id);
        return false;
      }
      await delay(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
    }
  })().finally(() => {
    inFlight.delete(asset.id);
  });
  inFlight.set(asset.id, run);
  return run;
}
