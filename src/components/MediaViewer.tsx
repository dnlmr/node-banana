"use client";

import { ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useVideoBlobUrl } from "@/hooks/useVideoBlobUrl";
import { CHROME_SURFACE, LIGHTBOX_BUTTON } from "./chromeStyles";
import { cn } from "./nodes/ui/cn";

/**
 * The full-screen media viewer: one component behind the recent-generations
 * drop-down and the output gallery node. It owns the stage, the filmstrip,
 * previous/next, the keys and the motion; a host hands it the items and the
 * actions that make sense there, and the rail shows whatever it is given.
 */

export interface MediaViewerItem {
  id: string;
  src: string;
  kind: "image" | "video";
  /** A poster frame for the strip; a video without one gets a plain tile. */
  thumb?: string;
  /** The rail's heading: the prompt, or "Image 3". */
  title?: string;
  /** Rows under "Details", in order. */
  details?: [string, string][];
}

export interface MediaViewerAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  tone?: "primary" | "default" | "danger" | "success";
  /** A key that fires it while the viewer is open: "Enter", "d". */
  shortcut?: string;
  disabled?: boolean;
}

export interface MediaViewerProps {
  open: boolean;
  items: MediaViewerItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  actions: MediaViewerAction[];
  /** The rail's last row, e.g. a link to Assets. */
  footer?: ReactNode;
  /** Accessible name of the dialog. */
  label: string;
}

/** The strip is a dock: the active tile is large, its neighbours a step up from the rest. */
export const STRIP_ACTIVE = 72;
export const STRIP_NEAR = 52;
export const STRIP_FAR = 40;
const STRIP_GAP = 4;
/** How long the outgoing image is kept for its exit animation. */
const LEAVE_MS = 260;

export function stripTileSize(index: number, active: number): number {
  if (index === active) return STRIP_ACTIVE;
  return Math.abs(index - active) === 1 ? STRIP_NEAR : STRIP_FAR;
}

/**
 * Offset that keeps the active tile under the stage's middle: the strip's
 * track is centred, so shift it by the distance from its centre to the tile's.
 */
export function stripShift(count: number, active: number): number {
  let x = 0;
  let centre = 0;
  for (let i = 0; i < count; i++) {
    const size = stripTileSize(i, active);
    if (i === active) centre = x + size / 2;
    x += size + STRIP_GAP;
  }
  const total = Math.max(0, x - STRIP_GAP);
  return Math.round(total / 2 - centre);
}

const EASE = "cubic-bezier(0.2,0,0,1)";

const ACTION_TONE: Record<NonNullable<MediaViewerAction["tone"]>, string> = {
  primary: "bg-neutral-200 text-neutral-900 hover:bg-[#ededed]",
  success: "bg-emerald-400 text-neutral-900",
  default: "border border-white/12 bg-white/[0.03] text-neutral-200 hover:border-neutral-500 hover:bg-white/7",
  danger: "border border-red-500/35 bg-white/[0.03] text-red-400 hover:bg-red-500/10",
};

function StageVideo({ src, className }: { src: string; className: string }) {
  const blobUrl = useVideoBlobUrl(src);
  return <video src={blobUrl ?? undefined} className={className} controls autoPlay playsInline />;
}

function StageMedia({ item, className, hidden }: { item: MediaViewerItem; className?: string; hidden?: boolean }) {
  const base = cn("absolute inset-0 m-auto max-h-full max-w-full rounded-md object-contain", className);
  if (item.kind === "video") {
    // An outgoing video is a still: a second decoder for a quarter second is not worth it.
    return hidden ? (
      <div aria-hidden="true" className={cn(base, "h-full w-full bg-neutral-900")} />
    ) : (
      <StageVideo src={item.src} className={base} />
    );
  }
  return <img src={item.src} alt={hidden ? "" : item.title ?? ""} aria-hidden={hidden || undefined} className={base} draggable={false} />;
}

export function MediaViewer({ open, items, index, onIndexChange, onClose, actions, footer, label }: MediaViewerProps) {
  const count = items.length;
  const current = items[index];
  // The image on its way out, kept for the crossfade.
  const [leaving, setLeaving] = useState<{ item: MediaViewerItem; dir: 1 | -1 } | null>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const shownRef = useRef<{ index: number; item: MediaViewerItem | undefined }>({ index, item: current });

  useEffect(() => {
    const prev = shownRef.current;
    shownRef.current = { index, item: current };
    if (!open || !prev.item || !current || prev.item.id === current.id) return;
    const direction: 1 | -1 = index >= prev.index ? 1 : -1;
    setDir(direction);
    setLeaving({ item: prev.item, dir: direction });
    const timer = window.setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [open, index, current]);

  const go = useCallback(
    (next: number) => {
      if (next < 0 || next >= count || next === index) return;
      onIndexChange(next);
    },
    [count, index, onIndexChange],
  );

  // Keys: arrows step, the actions' own shortcuts fire them. Escape is the dialog's.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(index - 1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(index + 1);
        return;
      }
      const action = actions.find((a) => a.shortcut && !a.disabled && a.shortcut.toLowerCase() === event.key.toLowerCase());
      if (action) {
        event.preventDefault();
        action.onClick();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, index, go, actions]);

  if (!open || !current) return null;

  const hasPrev = index > 0;
  const hasNext = index < count - 1;
  const arrow = (side: "prev" | "next") => (
    <button
      type="button"
      aria-label={side === "prev" ? "Previous" : "Next"}
      disabled={side === "prev" ? !hasPrev : !hasNext}
      onClick={() => go(side === "prev" ? index - 1 : index + 1)}
      className={cn(
        "absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full disabled:opacity-0",
        LIGHTBOX_BUTTON,
        side === "prev" ? "left-3" : "right-3",
      )}
    >
      {side === "prev" ? <ChevronLeft size={20} strokeWidth={2} /> : <ChevronRight size={20} strokeWidth={2} />}
    </button>
  );

  return (
    <Dialog open onClose={onClose} variant="lightbox" portal label={label} className="flex h-full w-full items-stretch gap-6" stopWheel>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
        {/* Stage */}
        <div data-testid="media-viewer-stage" className="relative min-h-0 w-full flex-1 overflow-hidden">
          {leaving && (
            <div data-testid="media-viewer-leaving" className="pointer-events-none absolute inset-0">
              <StageMedia item={leaving.item} hidden className={leaving.dir > 0 ? "animate-viewer-out-left" : "animate-viewer-out-right"} />
            </div>
          )}
          <div key={current.id} className={cn("absolute inset-0", leaving && (dir > 0 ? "animate-viewer-in-right" : "animate-viewer-in-left"))}>
            <StageMedia item={current} />
          </div>
          {arrow("prev")}
          {arrow("next")}
        </div>

        {/* Strip */}
        <div className={cn(CHROME_SURFACE, "flex h-[84px] w-full shrink-0 items-center justify-center overflow-hidden rounded-xl")} data-testid="media-viewer-strip">
          <div
            className="flex items-center gap-1 transition-transform duration-[240ms] motion-reduce:transition-none"
            style={{ transform: `translateX(${stripShift(count, index)}px)`, transitionTimingFunction: EASE }}
          >
            {items.map((item, i) => {
              const size = stripTileSize(i, index);
              const active = i === index;
              const near = Math.abs(i - index) === 1;
              const tile = item.kind === "video" ? item.thumb : item.src;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.title ?? `${item.kind === "video" ? "Video" : "Image"} ${i + 1}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => go(i)}
                  style={{ width: size, height: size, transitionTimingFunction: EASE }}
                  className={cn(
                    "relative shrink-0 overflow-hidden bg-well transition-[width,height,opacity,border-radius,box-shadow] duration-[240ms] motion-reduce:transition-none",
                    active ? "rounded-[10px] opacity-100 shadow-[inset_0_0_0_2px_#3b82f6]" : "rounded-lg shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:opacity-100",
                    !active && (near ? "opacity-85" : "opacity-60"),
                  )}
                >
                  {tile ? <img src={tile} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} /> : null}
                  {item.kind === "video" && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                      <Play size={active ? 20 : 14} strokeWidth={2} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Rail */}
      <aside className={cn(CHROME_SURFACE, "flex w-80 shrink-0 flex-col gap-4 rounded-xl p-4")} data-testid="media-viewer-rail">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tabular-nums text-neutral-400">
            {index + 1} of {count}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Previous"
              disabled={!hasPrev}
              onClick={() => go(index - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-white/4 text-neutral-200 transition-colors hover:bg-white/8 disabled:opacity-30 disabled:hover:bg-white/4"
            >
              <ChevronLeft size={16} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Next"
              disabled={!hasNext}
              onClick={() => go(index + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-white/4 text-neutral-200 transition-colors hover:bg-white/8 disabled:opacity-30 disabled:hover:bg-white/4"
            >
              <ChevronRight size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        <div key={current.id} className="flex min-h-0 flex-col gap-4 animate-viewer-rail">
          {current.title && (
            <p className="line-clamp-4 select-text text-sm font-medium leading-5 tracking-[-0.01em] text-neutral-100" title={current.title}>
              {current.title}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  disabled={action.disabled}
                  onClick={action.onClick}
                  className={cn(
                    "flex h-9 w-full items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors duration-[160ms] disabled:opacity-40",
                    ACTION_TONE[action.tone ?? "default"],
                  )}
                >
                  <Icon size={15} strokeWidth={2} />
                  {action.label}
                </button>
              );
            })}
          </div>
          {current.details && current.details.length > 0 && (
            <>
              <div className="h-px bg-white/8" />
              <dl className="flex flex-col gap-2">
                <span className="text-[10px] uppercase tracking-[0.06em] text-neutral-500">Details</span>
                {current.details.map(([name, value]) => (
                  <div key={name} className="flex justify-between gap-3 text-[11px] leading-[14px]">
                    <dt className="text-neutral-500">{name}</dt>
                    <dd className="select-text text-right text-neutral-300">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>

        <div className="flex-1" />
        {footer}
      </aside>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={cn("absolute -right-4 -top-4 flex h-8 w-8 items-center justify-center rounded-lg", LIGHTBOX_BUTTON)}
      >
        <X size={16} strokeWidth={2} />
      </button>
    </Dialog>
  );
}
