"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { CHROME_ICON_BUTTON, CHROME_ICON_BUTTON_OPEN, CHROME_SURFACE } from "@/components/chromeStyles";
import { cn } from "@/components/agent/lib/utils";
import type { AgentHarnessId } from "@/lib/agent/types";
import { HarnessIcon } from "./HarnessIcon";

export interface AgentButtonProps {
  open: boolean;
  /**
   * The harness the agent will answer with, or null before the user has
   * opened the agent: then both marks show, since either could be chosen.
   */
  harness: AgentHarnessId | null;
  /** A turn is running. */
  busy?: boolean;
  /** The chosen harness can't run a turn yet (signed out, wrong account, not installed). */
  attention?: boolean;
  disabled?: boolean;
  /** Dimmed like the other canvas chrome while the tutorial locks features. */
  dimmed?: boolean;
  style?: CSSProperties;
  onClick: () => void;
  /** The card's rendered width, so the history button can sit beside it. */
  onWidthChange?: (width: number) => void;
}

/**
 * Opens the agent window: a labelled pill in the canvas's top-right corner,
 * on the same glass card as the other chrome, showing the mark of the harness
 * that will answer. The canvas hides it while the window is open (the window
 * takes its place and closes from its own header), so `open` only styles a
 * pressed state for hosts that keep it up.
 */
export function AgentButton({
  open,
  harness,
  busy = false,
  attention = false,
  disabled = false,
  dimmed = false,
  style,
  onClick,
  onWidthChange,
}: AgentButtonProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Report the width whenever the label or mark changes it.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !onWidthChange) return;
    const report = () => onWidthChange(card.getBoundingClientRect().width);
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(card);
    return () => observer.disconnect();
  }, [onWidthChange]);

  const label = busy ? "Working…" : "Agent";
  const name = busy ? "Agent — working" : attention ? "Agent — needs sign-in" : "Open agent";

  return (
    <div
      ref={cardRef}
      data-testid="agent-button"
      style={style}
      className={cn(
        CHROME_SURFACE,
        "nodrag nopan nowheel absolute z-10 flex h-10 items-center rounded-xl px-1",
        dimmed && "pointer-events-none opacity-30",
      )}
    >
      <button
        type="button"
        aria-label={name}
        aria-pressed={open}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          CHROME_ICON_BUTTON,
          "h-8 gap-2 pl-2.5 pr-[11px] text-xs font-medium text-neutral-200 disabled:hover:text-neutral-200",
          open && CHROME_ICON_BUTTON_OPEN,
        )}
      >
        <span className="relative flex shrink-0 items-center">
          {harness === null ? (
            <span data-testid="agent-marks-both" className="flex items-center">
              <HarnessIcon harness="claude" />
              {/* The cloud overlaps the spark; the shadow in the card's grey keeps them apart. */}
              <span className="-ml-1 flex [filter:drop-shadow(0_0_1.5px_#262626)_drop-shadow(0_0_1px_#262626)]">
                <HarnessIcon harness="codex" />
              </span>
            </span>
          ) : (
            <HarnessIcon harness={harness} className={cn(attention && !busy && "opacity-55")} />
          )}
          {busy && (
            <span
              data-testid="agent-busy-dot"
              aria-hidden="true"
              className="absolute -right-1 -top-1 size-[7px] rounded-full bg-[#D97757] ring-2 ring-neutral-800 shadow-[0_0_0_4px_rgba(217,119,87,0.2)] motion-safe:animate-pulse"
            />
          )}
          {attention && !busy && (
            <span
              data-testid="agent-attention-dot"
              aria-hidden="true"
              className="absolute -right-1 -top-1 size-[7px] rounded-full bg-amber-400 ring-2 ring-neutral-800"
            />
          )}
        </span>
        <span>{label}</span>
      </button>
    </div>
  );
}
