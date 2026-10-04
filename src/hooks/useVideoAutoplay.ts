import { useRef, useEffect } from "react";
import { useWorkflowStore } from "@/store/workflowStore";

/** How long the pointer rests on a node before its video starts. */
export const VIDEO_HOVER_DELAY_MS = 300;

/**
 * What the user last asked of this video.
 *
 * - `hover`: untouched. The video previews while the node is hovered and
 *   pauses where it is when the pointer leaves.
 * - `playing`: the user pressed play. Playback is pinned and ignores hover.
 * - `paused`: the user paused or scrubbed. The frame holds and hover does
 *   not restart it; only pressing play does.
 */
export type VideoPlaybackIntent = "hover" | "playing" | "paused";

/**
 * Drives a node's video from hover and the user's own play, pause and scrub
 * actions, so the two never fight.
 *
 * The hook plays and pauses the element itself for hover previews and marks
 * those transitions so it can tell them apart from the user's. Any play or
 * pause it did not ask for becomes the user's intent, which takes precedence
 * over hover until the source changes or the video ends on its own.
 *
 * @param nodeId - The node's unique ID
 * @param src - The current source; a change resets the intent to hover
 * @returns A ref to attach to the video element
 */
export function useVideoAutoplay(nodeId: string, src?: string | null): React.RefObject<HTMLVideoElement | null> {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isHovered = useWorkflowStore((s) => s.hoveredNodeId === nodeId);
  const intent = useRef<VideoPlaybackIntent>("hover");
  /** A transition this hook started, so its event is not read as the user's. */
  const expected = useRef<"play" | "pause" | null>(null);
  const bound = useRef<HTMLVideoElement | null>(null);

  // A new source is a new video: forget what the user did with the last one.
  useEffect(() => {
    intent.current = "hover";
    expected.current = null;
  }, [src]);

  // Listen for the user's own transitions. The element may mount after the
  // first render, so rebind whenever the ref points somewhere new.
  useEffect(() => {
    const video = videoRef.current;
    if (video === bound.current) return;
    const onPlay = () => {
      if (expected.current === "play") expected.current = null;
      else intent.current = "playing";
    };
    const onPause = () => {
      if (expected.current === "pause") expected.current = null;
      else intent.current = "paused";
    };
    const onEnded = () => {
      // It ran out on its own: hovering again replays it from the start.
      intent.current = "hover";
      expected.current = null;
    };
    bound.current?.removeEventListener("play", onPlay);
    bound.current = video;
    if (!video) return;
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      if (bound.current === video) bound.current = null;
    };
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || intent.current !== "hover") return;

    if (!isHovered) {
      if (!video.paused) {
        expected.current = "pause";
        video.pause();
      }
      return;
    }

    const timeout = setTimeout(() => {
      if (intent.current !== "hover" || !video.paused) return;
      expected.current = "play";
      video.play().catch((e) => {
        expected.current = null;
        if (e.name !== "AbortError") {
          console.warn("Video play failed:", e);
        }
      });
    }, VIDEO_HOVER_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [isHovered, nodeId, src]);

  return videoRef;
}
