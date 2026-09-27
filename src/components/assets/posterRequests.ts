/**
 * Which video tiles get a poster made, and when. poster.ts draws one video
 * at a time, in the order it is asked, and cannot take a request back; an
 * imported library has hundreds of videos without a poster. Asking for every
 * tile the grid mounts (a viewport above, two below) queued them all, so the
 * tile the user scrolled to waited behind everything scrolled past, and the
 * captures went on long after the view closed.
 *
 * So a tile asks here only while it is on screen, and withdraws when it
 * leaves or unmounts. At most MAX_ACTIVE_POSTERS requests are handed to
 * ensurePoster at a time, in the order the tiles came into view; the rest
 * wait here, where withdrawing costs nothing. A request gives its turn up
 * while its capture waits out a failed try (5 s, then 30 s): a few videos
 * this browser cannot decode must not keep every other tile waiting.
 */

import { ensurePoster } from "@/lib/assets/client/poster";
import type { AssetView } from "@/lib/assets/types";

type PosterAsset = Pick<AssetView, "id" | "kind" | "mime" | "hasPoster">;

/**
 * A few: the capture queue stays busy (one drawing, the next ready) while
 * little is queued that may scroll away.
 */
export const MAX_ACTIVE_POSTERS = 3;

/** On screen and not handed on yet, in the order they came into view. */
const waiting = new Map<string, PosterAsset>();
/** Handed on and drawing or uploading (not waiting out a retry). */
const active = new Set<string>();
/** Handed to ensurePoster this session: once each, even when the capture fails (it tries again on its own). */
const asked = new Set<string>();

function pump(): void {
  while (active.size < MAX_ACTIVE_POSTERS && waiting.size > 0) {
    const [id, asset] = waiting.entries().next().value as [string, PosterAsset];
    waiting.delete(id);
    asked.add(id);
    active.add(id);
    // Once: at the first retry wait or at the end, whichever comes first. The
    // try after a wait runs without a turn; poster.ts still draws one at a time.
    const release = () => {
      if (active.delete(id)) pump();
    };
    void ensurePoster(asset, { onRetryWait: release })
      .catch(() => false)
      .finally(release);
  }
}

/**
 * Asks for a poster for a video tile on screen. Returns the withdrawal, for
 * when the tile leaves the screen or unmounts: a request not handed on yet
 * is dropped, and asked again if the tile comes back.
 */
export function requestPoster(asset: PosterAsset): () => void {
  if (asked.has(asset.id) || waiting.has(asset.id)) return () => {};
  waiting.set(asset.id, asset);
  pump();
  return () => {
    if (waiting.get(asset.id) === asset) waiting.delete(asset.id);
  };
}

export function __resetPosterRequestsForTests(): void {
  waiting.clear();
  active.clear();
  asked.clear();
}
