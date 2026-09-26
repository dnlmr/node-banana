"use client";

import { FolderCheck, X } from "lucide-react";
import { toast } from "sonner";
import { CHROME_SURFACE } from "@/components/chromeStyles";
import { onAssetRecorded } from "@/lib/assets/client/recorder";
import type { LibraryStatus } from "@/lib/assets/types";
import { changeLibraryLocation, revealLibrary } from "./assetActions";
import { shortLibraryPath } from "./assetFormat";

export const FIRST_RUN_KEY = "node-banana-assets-first-run-shown";
const HINT_DURATION_MS = 12_000;

function alreadyShown(): boolean {
  try {
    return window.localStorage.getItem(FIRST_RUN_KEY) === "1";
  } catch {
    return true;
  }
}

function markShown() {
  try {
    window.localStorage.setItem(FIRST_RUN_KEY, "1");
  } catch {
    // Shown once per session instead
  }
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
          <button type="button" onClick={action(() => void revealLibrary())} className="text-neutral-400 hover:text-white">
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
 * Says once, after the first asset lands in an empty library, where
 * generations go now, with Show and Change…. Returns the unsubscribe.
 */
export function watchFirstRecording(status: LibraryStatus | null): () => void {
  if (typeof window === "undefined" || !status?.available || !status.empty || !status.root || alreadyShown()) return () => {};
  const root = status.root;
  const off = onAssetRecorded(() => {
    off();
    if (alreadyShown()) return;
    markShown();
    const id = "assets-first-run";
    toast.custom(() => <FirstRunCard id={id} root={root} />, { id, duration: HINT_DURATION_MS });
  });
  return off;
}
