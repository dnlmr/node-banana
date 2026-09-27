"use client";

import { CircleAlert, TriangleAlert, X } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

import { CHROME_SURFACE } from "@/components/chromeStyles";
import { getRecorderLibraryStatus, onLibraryStatus, onRecorderError } from "@/lib/assets/client/recorder";
import type { LibraryStatus } from "@/lib/assets/types";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";

/** Set once the fallback-folder warning has been shown in this session. */
export const FALLBACK_SHOWN_KEY = "node-banana-assets-fallback-shown";

/** How long a notice card stays: time to read a reason, and longer when there is an action to reach. */
export const NOTICE_DURATION_MS = 8000;
export const NOTICE_WITH_ACTION_DURATION_MS = 12_000;
/** The generation cards' width, so the stack reads as one column. */
const CARD_WIDTH = 268;

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

interface NoticeAction {
  label: string;
  onClick: () => void;
}

/** One library notice in the sonner stack, in the generation cards' skin. */
export function LibraryNoticeCard({
  id,
  tone,
  message,
  action,
}: {
  id: string;
  tone: "warning" | "error";
  message: string;
  action?: NoticeAction;
}) {
  const dismiss = () => toast.dismiss(id);
  const Icon = tone === "error" ? CircleAlert : TriangleAlert;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-testid="library-notice"
      className={`${CHROME_SURFACE} flex items-start gap-2.5 rounded-xl p-1.5 pl-3`}
      style={{ width: CARD_WIDTH }}
    >
      {/* mt-1: centred on the first line of text, as the dismiss button is */}
      <Icon
        size={16}
        strokeWidth={1.75}
        aria-hidden="true"
        className={`mt-1 shrink-0 ${tone === "error" ? "text-error" : "text-amber-400"}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[5px]">
        <span className="line-clamp-4 text-[11px] font-medium leading-[14px] text-neutral-200 [overflow-wrap:anywhere]" title={message}>
          {message}
        </span>
        {action && (
          <span className="flex gap-2 text-[11px] leading-[14px]">
            <button
              type="button"
              onClick={() => {
                dismiss();
                action.onClick();
              }}
              className="text-neutral-400 hover:text-white"
            >
              {action.label}
            </button>
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors duration-[120ms] hover:bg-white/7 hover:text-white"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** Keyed by its text: the same notice again replaces its card and restarts the timer rather than stacking. */
function showNotice(tone: "warning" | "error", message: string, action?: NoticeAction) {
  const id = `library-notice:${message}`;
  toast.custom(() => <LibraryNoticeCard id={id} tone={tone} message={message} action={action} />, {
    id,
    duration: action ? NOTICE_WITH_ACTION_DURATION_MS : NOTICE_DURATION_MS,
  });
}

/**
 * The asset library's messages outside the Assets view:
 *
 * - the recorder's failures, which it already rate-limits;
 * - once per session, that the default folder could not be used and the
 *   library fell back to another one.
 *
 * They are cards in the sonner stack with the generation cards, never the
 * one-slot message toast, where they would replace a persistent "Generation
 * failed" and hide it after a few seconds. The first-run "Saved to …" hint is
 * FirstRunHint's (see page.tsx), not this component's.
 *
 * Mounted once, by FloatingMenu. Renders nothing itself.
 */
export function LibraryNotices() {
  useEffect(() => {
    const handleStatus = (next: LibraryStatus) => {
      if (next.available && next.fallbackReason && claimOnce(() => sessionStorage, FALLBACK_SHOWN_KEY)) {
        showNotice("warning", next.fallbackReason, { label: "Change…", onClick: openLibrarySettings });
      }
    };

    const initial = getRecorderLibraryStatus();
    if (initial) handleStatus(initial);
    const offStatus = onLibraryStatus(handleStatus);
    const offError = onRecorderError((message) => showNotice("error", message));

    return () => {
      offStatus();
      offError();
    };
  }, []);

  return null;
}
