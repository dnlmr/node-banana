"use client";

import { CircleAlert, X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/components/nodes/ui/cn";
import { CHROME_SURFACE } from "@/components/chromeStyles";
import { useAssetStore } from "@/store/assetStore";

/**
 * The last asset action's result, with Undo; errors stay a little longer.
 * The view shows it bottom-centre, and the detail shows it inside itself
 * while it is fullscreen (anything outside the fullscreen element is not
 * painted).
 */
export function AssetNotice() {
  const notice = useAssetStore((state) => state.notice);
  const dismiss = useAssetStore((state) => state.dismissNotice);
  const undo = useAssetStore((state) => state.undo);
  const canUndo = useAssetStore((state) => state.undoStack.length > 0);

  useEffect(() => {
    if (!notice || notice.sticky) return;
    const timer = setTimeout(() => {
      if (useAssetStore.getState().notice?.id === notice.id) dismiss();
    }, notice.undo || notice.tone === "error" ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <div
      key={notice.id}
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn(CHROME_SURFACE, "animate-drop-in motion-reduce:animate-none pointer-events-auto flex min-h-10 max-w-[520px] items-center gap-2 rounded-xl py-1.5 pl-3 pr-1.5 text-xs text-neutral-200")}
    >
      {notice.tone === "error" && <CircleAlert size={14} strokeWidth={1.75} className="shrink-0 text-red-400" />}
      <span className="min-w-0 flex-1">{notice.message}</span>
      {notice.undo && canUndo && (
        <button
          type="button"
          onClick={() => {
            dismiss();
            void undo();
          }}
          className="h-7 shrink-0 rounded-md px-2 font-medium text-neutral-100 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection"
        >
          Undo
        </button>
      )}
      {notice.action && (
        <button
          type="button"
          onClick={() => {
            dismiss();
            notice.action!.run();
          }}
          className="h-7 shrink-0 rounded-md px-2 font-medium text-neutral-100 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection"
        >
          {notice.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.08] hover:text-neutral-100"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
