"use client";

import { useEffect } from "react";

import { useToast } from "@/components/Toast";
import { revealLibraryRoot } from "@/lib/assets/client/api";
import {
  getRecorderLibraryStatus,
  onAssetRecorded,
  onLibraryStatus,
  onRecorderError,
} from "@/lib/assets/client/recorder";
import type { LibraryStatus } from "@/lib/assets/types";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";

/** Set once the "Saved to …" hint has been shown; it never shows again in this browser. */
export const FIRST_RUN_SHOWN_KEY = "node-banana-assets-first-run-shown";
/** Set once the fallback-folder warning has been shown in this session. */
export const FALLBACK_SHOWN_KEY = "node-banana-assets-fallback-shown";

/** The last two segments of a folder, for a toast: "Pictures › Node Banana". */
export function shortLibraryPath(root: string): string {
  const parts = root.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts.slice(-2).join(" › ") : root;
}

// One-time notices already shown while web storage was unavailable (a
// private window, blocked site data): then the page's lifetime is the limit.
const shownInMemory = new Set<string>();

/** Claim a one-time notice: true the first time, false once it has been shown. */
function claimOnce(storage: () => Storage, key: string): boolean {
  try {
    const store = storage();
    if (store.getItem(key) !== null) return false;
    store.setItem(key, "1");
    return true;
  } catch {
    if (shownInMemory.has(key)) return false;
    shownInMemory.add(key);
    return true;
  }
}

function openLibrarySettings() {
  useSettingsDialogStore.getState().openSettings("library");
}

function revealRoot() {
  revealLibraryRoot().catch((error: unknown) => {
    useToast
      .getState()
      .show(error instanceof Error && error.message ? error.message : "Could not show the library folder.", "error");
  });
}

/**
 * The asset library's messages outside the Assets view, as toasts:
 *
 * - once ever, after the first asset lands in a library that was empty, where
 *   it was saved (with Show and Change…);
 * - the recorder's failures, which it already rate-limits;
 * - once per session, that the default folder could not be used and the
 *   library fell back to another one.
 *
 * Mounted once, by FloatingMenu. Renders nothing itself.
 */
export function LibraryNotices() {
  useEffect(() => {
    let status: LibraryStatus | null = null;
    // Seen empty before the hint's asset arrived. Latched: the recorder may
    // report the library as no longer empty before it reports the asset.
    let wasEmpty = false;
    let hintDecided = false;

    const handleStatus = (next: LibraryStatus) => {
      status = next;
      if (!hintDecided && next.available && next.empty) wasEmpty = true;

      if (next.available && next.fallbackReason && claimOnce(() => sessionStorage, FALLBACK_SHOWN_KEY)) {
        useToast.getState().show(next.fallbackReason, "warning", false, null, [
          { label: "Change…", onClick: openLibrarySettings },
        ]);
      }
    };

    const initial = getRecorderLibraryStatus();
    if (initial) handleStatus(initial);
    const offStatus = onLibraryStatus(handleStatus);

    const offRecorded = onAssetRecorded((result) => {
      if (hintDecided) return;
      // An asset written into a project's own generations folder is where that
      // project's user expects it; the hint is about the library folder.
      if (result?.asset?.file?.root !== "library") return;
      hintDecided = true;
      const root = status?.root;
      if (!wasEmpty || !root || !claimOnce(() => localStorage, FIRST_RUN_SHOWN_KEY)) return;
      useToast.getState().show(`Saved to ${shortLibraryPath(root)}`, "info", false, null, [
        { label: "Show", onClick: revealRoot },
        { label: "Change…", onClick: openLibrarySettings },
      ]);
    });

    const offError = onRecorderError((message) => {
      useToast.getState().show(message, "error");
    });

    return () => {
      offStatus();
      offRecorded();
      offError();
    };
  }, []);

  return null;
}
