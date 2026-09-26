"use client";

import { FolderCheck, X } from "lucide-react";
import { toast } from "sonner";
import { CHROME_SURFACE } from "@/components/chromeStyles";
import { useToast } from "@/components/Toast";
import { revealLibraryRoot } from "@/lib/assets/client/api";
import { getRecorderLibraryStatus, onAssetRecorded } from "@/lib/assets/client/recorder";
import type { LibraryStatus, RecordAssetResult } from "@/lib/assets/types";
import { changeLibraryLocation } from "./assetActions";
import { shortLibraryPath } from "./assetFormat";

export const FIRST_RUN_KEY = "node-banana-assets-first-run-shown";
const HINT_DURATION_MS = 12_000;

/** Shown while web storage is unavailable (a private window, blocked site data): once per page then. */
let shownInMemory = false;

function alreadyShown(): boolean {
  try {
    return window.localStorage.getItem(FIRST_RUN_KEY) === "1";
  } catch {
    return shownInMemory;
  }
}

function markShown() {
  try {
    window.localStorage.setItem(FIRST_RUN_KEY, "1");
  } catch {
    // Shown once per page instead
    shownInMemory = true;
  }
}

/** The card sits on the canvas, where the Assets view's notices are not shown: a failure is a toast. */
function revealRoot() {
  revealLibraryRoot().catch((error: unknown) => {
    useToast.getState().show(error instanceof Error && error.message ? error.message : "Could not show the library folder.", "error");
  });
}

function FirstRunCard({ id, root }: { id: string; root: string }) {
  const action = (run: () => void) => () => {
    toast.dismiss(id);
    run();
  };
  return (
    <div
      role="status"
      data-testid="assets-first-run"
      className={`${CHROME_SURFACE} flex items-center gap-2.5 rounded-xl p-1.5 pl-3`}
      style={{ width: 268 }}
    >
      <FolderCheck size={16} strokeWidth={1.75} className="shrink-0 text-neutral-400" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[11px] font-medium leading-[14px] text-neutral-200" title={root}>
          Saved to {shortLibraryPath(root)}
        </span>
        <span className="flex gap-2 text-[11px] leading-[14px]">
          <button type="button" onClick={action(revealRoot)} className="text-neutral-400 hover:text-white">
            Show
          </button>
          <button type="button" onClick={action(changeLibraryLocation)} className="text-neutral-400 hover:text-white">
            Change…
          </button>
        </span>
      </div>
      <button
        type="button"
        onClick={() => toast.dismiss(id)}
        aria-label="Dismiss"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors duration-[120ms] hover:bg-white/7 hover:text-white"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/**
 * Says once, after the first asset lands in the library folder of a
 * library that was empty, where generations go now, with Show and Change….
 * An asset written into a project's own generations folder is where that
 * project's user expects it: the hint waits for one in the library.
 * The one owner of this hint. Returns the unsubscribe.
 */
export function watchFirstRecording(status: LibraryStatus | null): () => void {
  if (typeof window === "undefined" || !status?.available || !status.empty || !status.root || alreadyShown()) return () => {};
  const startRoot = status.root;
  const off = onAssetRecorded((result: RecordAssetResult) => {
    if (result?.asset?.file?.root !== "library") return;
    off();
    if (alreadyShown()) return;
    markShown();
    // Where the library is now: it may have been switched since the page loaded
    const root = getRecorderLibraryStatus()?.root ?? startRoot;
    const id = "assets-first-run";
    toast.custom(() => <FirstRunCard id={id} root={root} />, { id, duration: HINT_DURATION_MS });
  });
  return off;
}
