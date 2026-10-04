import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVideoAutoplay, VIDEO_HOVER_DELAY_MS } from "../useVideoAutoplay";

let hoveredNodeId: string | null = null;
vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector: (s: { hoveredNodeId: string | null }) => unknown) => selector({ hoveredNodeId }),
}));

/**
 * A video element stand-in: play/pause flip `paused` and fire the events
 * the real element would, so the hook sees both its own and the "user's"
 * transitions the same way.
 */
function fakeVideo() {
  const listeners = new Map<string, Set<() => void>>();
  const fire = (type: string) => listeners.get(type)?.forEach((fn) => fn());
  const video = {
    paused: true,
    play: vi.fn(() => {
      video.paused = false;
      fire("play");
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      video.paused = true;
      fire("pause");
    }),
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    fire,
  };
  return video;
}

type Fake = ReturnType<typeof fakeVideo>;

function mount(src: string | null = "blob:a") {
  const video = fakeVideo();
  const hook = renderHook(({ s }) => useVideoAutoplay("n1", s), { initialProps: { s: src } });
  hook.result.current.current = video as unknown as HTMLVideoElement;
  hook.rerender({ s: src });
  return { video, hook };
}

const hover = (hook: ReturnType<typeof mount>["hook"], on: boolean, src: string | null = "blob:a") => {
  hoveredNodeId = on ? "n1" : null;
  hook.rerender({ s: src });
};

/** The user pressing the scrub row's button, as the element would report it. */
const userPlay = (video: Fake) => act(() => { video.play(); });
const userPause = (video: Fake) => act(() => { video.pause(); });

describe("useVideoAutoplay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hoveredNodeId = null;
  });
  afterEach(() => vi.useRealTimers());

  it("previews after the hover delay and pauses on leave", () => {
    const { video, hook } = mount();
    hover(hook, true);
    expect(video.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(VIDEO_HOVER_DELAY_MS);
    expect(video.play).toHaveBeenCalledTimes(1);
    hover(hook, false);
    expect(video.pause).toHaveBeenCalledTimes(1);
  });

  it("does not play a node that is not hovered", () => {
    const { video, hook } = mount();
    hoveredNodeId = "other";
    hook.rerender({ s: "blob:a" });
    vi.advanceTimersByTime(VIDEO_HOVER_DELAY_MS * 2);
    expect(video.play).not.toHaveBeenCalled();
  });

  it("drops a pending preview when the pointer leaves before the delay", () => {
    const { video, hook } = mount();
    hover(hook, true);
    hover(hook, false);
    vi.advanceTimersByTime(VIDEO_HOVER_DELAY_MS * 2);
    expect(video.play).not.toHaveBeenCalled();
  });

  it("pins playback once the user presses play: leaving does not pause", () => {
    const { video, hook } = mount();
    userPlay(video);
    hover(hook, true);
    vi.advanceTimersByTime(VIDEO_HOVER_DELAY_MS);
    hover(hook, false);
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.paused).toBe(false);
  });

  it("holds a paused video: hover does not restart it after the user pauses", () => {
    const { video, hook } = mount();
    hover(hook, true);
    vi.advanceTimersByTime(VIDEO_HOVER_DELAY_MS);
    expect(video.paused).toBe(false);
    userPause(video);
    hover(hook, false);
    hover(hook, true);
    vi.advanceTimersByTime(VIDEO_HOVER_DELAY_MS * 2);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(true);
  });

  it("lets the user pin a paused video again by pressing play", () => {
    const { video, hook } = mount();
    userPause(video);
    userPlay(video);
    hover(hook, true);
    hover(hook, false);
    expect(video.paused).toBe(false);
  });

  it("forgets the user's intent when the source changes", () => {
    const { video, hook } = mount();
    userPause(video);
    hover(hook, true, "blob:b");
    vi.advanceTimersByTime(VIDEO_HOVER_DELAY_MS);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it("goes back to hover previews after the video ends on its own", () => {
    const { video, hook } = mount();
    userPlay(video);
    act(() => { video.paused = true; video.fire("ended"); });
    hover(hook, true);
    vi.advanceTimersByTime(VIDEO_HOVER_DELAY_MS);
    expect(video.play).toHaveBeenCalledTimes(2);
  });
});
