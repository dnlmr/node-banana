"use client";

import { useEffect } from "react";

import { useToast } from "@/components/Toast";
import { getRecorderLibraryStatus, onLibraryStatus, onRecorderError } from "@/lib/assets/client/recorder";
import type { LibraryStatus } from "@/lib/assets/types";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";

/** Set once the fallback-folder warning has been shown in this session. */
export const FALLBACK_SHOWN_KEY = "node-banana-assets-fallback-shown";

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

/**
 * The asset library's messages outside the Assets view, as toasts:
 *
 * - the recorder's failures, which it already rate-limits;
 * - once per session, that the default folder could not be used and the
 *   library fell back to another one.
 *
 * The first-run "Saved to …" hint is FirstRunHint's (see page.tsx), not this
 * component's: two listeners on one key showed the wrong hint and spent it.
 *
 * Mounted once, by FloatingMenu. Renders nothing itself.
 */
export function LibraryNotices() {
  useEffect(() => {
    const handleStatus = (next: LibraryStatus) => {
      if (next.available && next.fallbackReason && claimOnce(() => sessionStorage, FALLBACK_SHOWN_KEY)) {
        useToast.getState().show(next.fallbackReason, "warning", false, null, [
          { label: "Change…", onClick: openLibrarySettings },
        ]);
      }
    };

    const initial = getRecorderLibraryStatus();
    if (initial) handleStatus(initial);
    const offStatus = onLibraryStatus(handleStatus);

    const offError = onRecorderError((message) => {
      useToast.getState().show(message, "error");
    });

    return () => {
      offStatus();
      offError();
    };
  }, []);

  return null;
}
