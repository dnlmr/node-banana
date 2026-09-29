"use client";

import { CircleAlert, CircleCheck, Download, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DesktopUpdateState } from "@/types/desktop";

/** How long "up to date" stays up after a manual check. */
const UP_TO_DATE_MS = 4000;

const ACTION = "rounded px-1.5 py-1 text-xs font-semibold opacity-90 transition-colors hover:bg-white/10 hover:opacity-100";
const PRIMARY_ACTION = "rounded bg-white/12 px-2 py-1 text-xs font-semibold transition-colors hover:bg-white/20";

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
}

/**
 * The desktop app's update notice, in the notification stack: offered when a
 * newer release exists, following the download, and asking to restart once it
 * is ready. Nothing renders in the browser or while there is nothing to say.
 */
export function DesktopUpdateNotice() {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  useEffect(() => {
    const updates = window.nodeBananaDesktop?.updates;
    if (!updates) return;
    let active = true;
    const unsubscribe = updates.onChange(next => { if (active) setState(next); });
    void updates.state().then(next => { if (active) setState(next); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);
  // A manual check that found nothing is worth a moment, not a fixture.
  useEffect(() => {
    if (state?.status !== "current") return;
    const timer = setTimeout(() => void window.nodeBananaDesktop?.updates.dismiss(), UP_TO_DATE_MS);
    return () => clearTimeout(timer);
  }, [state]);
  if (!state || !state.supported) return null;
  if (state.status === "idle" || (state.status === "checking" && !state.manual) || (state.status === "current" && !state.manual)) return null;

  const updates = window.nodeBananaDesktop!.updates;
  const dismiss = () => void updates.dismiss();
  const viewRelease = () => { if (state.url) window.open(state.url, "_blank", "noopener"); };
  let icon = <Download size={20} strokeWidth={2} />;
  let title: string;
  let detail: string | null = null;
  let actions: React.ReactNode = null;
  let progress: number | null = null;
  switch (state.status) {
    case "checking":
      icon = <RefreshCw size={20} strokeWidth={2} className="animate-spin" />;
      title = "Checking for updates…";
      break;
    case "current":
      icon = <CircleCheck size={20} strokeWidth={2} />;
      title = `Node Banana ${state.currentVersion} is up to date`;
      break;
    case "available":
      title = `Node Banana ${state.version} is available`;
      detail = `You have ${state.currentVersion}. The update downloads in the background and installs when you restart.`;
      actions = <>
        <button type="button" className={PRIMARY_ACTION} onClick={() => void updates.download()}>Download</button>
        <button type="button" className={ACTION} onClick={viewRelease}>Release notes</button>
        <button type="button" className={ACTION} onClick={() => void updates.skip()}>Skip this version</button>
      </>;
      break;
    case "downloading":
      title = `Downloading Node Banana ${state.version}…`;
      progress = state.percent ?? 0;
      detail = state.total ? `${formatBytes(state.transferred ?? 0)} of ${formatBytes(state.total)}` : null;
      break;
    case "downloaded":
      icon = <CircleCheck size={20} strokeWidth={2} />;
      title = `Node Banana ${state.version} is ready to install`;
      detail = "Restart now to update, or it installs when you next quit. Unsaved work is asked about first.";
      actions = <>
        <button type="button" className={PRIMARY_ACTION} onClick={() => void updates.install()}>Restart to update</button>
        <button type="button" className={ACTION} onClick={dismiss}>Later</button>
      </>;
      break;
    case "error":
      icon = <CircleAlert size={20} strokeWidth={2} />;
      title = state.version ? `Node Banana ${state.version} could not be installed` : "Could not check for updates";
      detail = state.error ?? null;
      actions = <>
        {state.version && <button type="button" className={PRIMARY_ACTION} onClick={() => void updates.download()}>Try again</button>}
        {state.url && <button type="button" className={ACTION} onClick={viewRelease}>{state.version ? "Download from GitHub" : "Open releases"}</button>}
      </>;
      break;
  }
  return (
    <div role="status" data-testid="desktop-update-notice" className="animate-drop-in flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-600 bg-neutral-800 text-neutral-100 shadow-xl">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="shrink-0 pt-0.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium [overflow-wrap:anywhere]">{title}</div>
          {detail && <div className="mt-0.5 text-xs text-neutral-400 [overflow-wrap:anywhere]">{detail}</div>}
          {progress !== null && (
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Download progress" className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-neutral-200 transition-[width] duration-300" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
        {state.status !== "downloading" && (
          <button type="button" onClick={dismiss} className="shrink-0 rounded p-1 transition-colors hover:bg-white/10" title="Dismiss" aria-label="Dismiss update notice">
            <X size={16} strokeWidth={2} />
          </button>
        )}
      </div>
      {actions && <div className="-mt-1.5 flex flex-wrap items-center gap-1 pb-2.5 pl-[42px] pr-4">{actions}</div>}
    </div>
  );
}
