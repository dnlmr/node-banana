import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capturePoster } from "../poster";
import { jsonResponse, stubFetch } from "./helpers";

const media = HTMLMediaElement.prototype;
const video = HTMLVideoElement.prototype;
const canvas = HTMLCanvasElement.prototype;
const saved: { target: object; key: string; descriptor: PropertyDescriptor | undefined }[] = [];

function override(target: object, key: string, descriptor: PropertyDescriptor) {
  if (!saved.some((entry) => entry.target === target && entry.key === key)) {
    saved.push({ target, key, descriptor: Object.getOwnPropertyDescriptor(target, key) });
  }
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
}

function restore() {
  for (const { target, key, descriptor } of saved.reverse()) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete (target as Record<string, unknown>)[key];
  }
  saved.length = 0;
}

/** A browser that can play video: loading and seeking fire their events, frames come from a fake decoder. */
function playableVideo(size: { width: number; height: number; duration: number }) {
  const seeks: number[] = [];
  override(media, "canPlayType", { value: () => "maybe" });
  override(media, "load", { value: () => {} });
  override(video, "videoWidth", { get: () => size.width });
  override(video, "videoHeight", { get: () => size.height });
  override(media, "duration", { get: () => size.duration });
  override(media, "src", {
    get() {
      return this.getAttribute("src") ?? "";
    },
    set(this: HTMLMediaElement, value: string) {
      this.setAttribute("src", value);
      setTimeout(() => this.dispatchEvent(new Event("loadeddata")), 0);
    },
  });
  let time = 0;
  override(media, "currentTime", {
    get: () => time,
    set(this: HTMLMediaElement, value: number) {
      time = value;
      seeks.push(value);
      setTimeout(() => this.dispatchEvent(new Event("seeked")), 0);
    },
  });
  return { seeks };
}

function drawableCanvas(encoders: Record<string, string | null>) {
  const drawImage = vi.fn();
  const sizes: { width: number; height: number }[] = [];
  override(canvas, "getContext", {
    value(this: HTMLCanvasElement) {
      sizes.push({ width: this.width, height: this.height });
      return { drawImage };
    },
  });
  override(canvas, "toBlob", {
    value(callback: BlobCallback, type: string) {
      const produced = encoders[type];
      callback(produced === null ? null : new Blob(["frame"], { type: produced ?? "image/png" }));
    },
  });
  return { drawImage, sizes };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("capturePoster", () => {
  it("does nothing where video cannot play (jsdom)", async () => {
    const { calls } = stubFetch(() => jsonResponse({}));
    await expect(capturePoster("a1", "video/mp4")).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("draws an early frame 640 px wide and uploads it as WebP", async () => {
    const { seeks } = playableVideo({ width: 1920, height: 1080, duration: 8 });
    const { drawImage, sizes } = drawableCanvas({ "image/webp": "image/webp" });
    const { calls } = stubFetch(() => jsonResponse({}));

    await expect(capturePoster("a1", "video/mp4")).resolves.toBe(true);
    expect(seeks).toEqual([0.1]);
    expect(sizes).toEqual([{ width: 640, height: 360 }]);
    expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLVideoElement), 0, 0, 640, 360);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "/api/assets/a1/poster", method: "PUT" });
    expect(calls[0].headers["content-type"]).toBe("image/webp");
  });

  it("seeks half way into a very short clip and falls back to JPEG without a WebP encoder", async () => {
    const { seeks } = playableVideo({ width: 480, height: 640, duration: 0.08 });
    const { sizes } = drawableCanvas({ "image/webp": "image/png", "image/jpeg": "image/jpeg" });
    const { calls } = stubFetch(() => jsonResponse({}));

    await expect(capturePoster("a2")).resolves.toBe(true);
    expect(seeks).toEqual([0.04]);
    expect(sizes).toEqual([{ width: 640, height: 853 }]);
    expect(calls[0].headers["content-type"]).toBe("image/jpeg");
  });

  it("resolves false, without throwing, when the upload fails", async () => {
    playableVideo({ width: 100, height: 100, duration: 1 });
    drawableCanvas({ "image/webp": "image/webp" });
    stubFetch(() => jsonResponse({ error: "No such asset" }, { status: 404 }));
    await expect(capturePoster("gone", "video/webm")).resolves.toBe(false);
  });
});
