/**
 * Video posters. The server cannot decode video frames, so after a video is
 * recorded the browser loads it from the library (same origin), seeks a
 * little way in, draws that frame 640 px wide and uploads it; the server
 * derives the grid thumbnails from it. Best effort: a missing poster only
 * means a placeholder tile.
 */

import type { AssetView } from "../types";
import { assetFileUrl, uploadPoster } from "./api";
import { createEmitter } from "./emitter";

const POSTER_WIDTH = 640;
const STEP_TIMEOUT_MS = 20_000;

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

async function capture(assetId: string, mime?: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const video = document.createElement("video");
  if (!canPlay(video, mime)) return false;
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
    if (!videoWidth || !videoHeight) return false;
    const canvas = document.createElement("canvas");
    canvas.width = POSTER_WIDTH;
    canvas.height = Math.max(1, Math.round((POSTER_WIDTH * videoHeight) / videoWidth));
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Browsers without a WebP encoder hand back PNG; JPEG is the smaller fallback.
    let poster = await toBlob(canvas, "image/webp", 0.8);
    if (!poster || poster.type !== "image/webp") poster = await toBlob(canvas, "image/jpeg", 0.85);
    if (!poster) return false;
    await uploadPoster(assetId, poster);
    return true;
  } catch (error) {
    console.warn("Couldn't make a poster for a recorded video:", error instanceof Error ? error.message : error);
    return false;
  } finally {
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      // Releasing the decoder is a courtesy.
    }
  }
}

/** Makes and uploads a poster for a recorded video. Never rejects; resolves whether a poster was stored. */
export function capturePoster(assetId: string, mime?: string): Promise<boolean> {
  const run = queue.then(() => capture(assetId, mime)).catch(() => false);
  queue = run;
  return run;
}

const posterReady = createEmitter<string>();
const inFlight = new Map<string, Promise<boolean>>();

/** Fires with the asset id once a poster was stored, so tiles can load their thumbnail again. */
export function onPosterReady(listener: (assetId: string) => void): () => void {
  return posterReady.on(listener);
}

/**
 * Makes sure a video asset has a poster: captures one when it has none,
 * once at a time per asset. Resolves whether a poster was stored now.
 */
export function ensurePoster(asset: Pick<AssetView, "id" | "kind" | "mime" | "hasPoster">): Promise<boolean> {
  if (asset.kind !== "video" || asset.hasPoster) return Promise.resolve(false);
  const running = inFlight.get(asset.id);
  if (running) return running;
  const run = capturePoster(asset.id, asset.mime).then((stored) => {
    inFlight.delete(asset.id);
    if (stored) posterReady.emit(asset.id);
    return stored;
  });
  inFlight.set(asset.id, run);
  return run;
}
