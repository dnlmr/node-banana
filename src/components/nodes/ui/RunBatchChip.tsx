"use client";

import type { RunBatchTag } from "@/types";
import { cn } from "./cn";

/** "14:02": when the run was, in the viewer's clock. */
function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Which run of a batch the output on show came from ("RUN 7 OF 10 · 14:02"),
 * bottom-left on the media. It shows while the node is hovered, which needs
 * the media card's `group` class (NodeShell's `mediaClassName="group"`).
 */
export function RunBatchChip({ batch, timestamp, className }: { batch?: RunBatchTag; timestamp?: number; className?: string }) {
  if (!batch) return null;
  return (
    <span
      className={cn(
        "pointer-events-none absolute bottom-1.5 left-1.5 rounded-[5px] border border-white/10 bg-neutral-900/80 px-1.5 py-0.5",
        "font-mono text-[10px] uppercase leading-3 tracking-eyebrow text-neutral-200 whitespace-nowrap",
        "opacity-0 transition-opacity group-hover:opacity-100",
        className
      )}
    >
      Run {batch.index} of {batch.count}
      {timestamp ? ` · ${clockTime(timestamp)}` : ""}
    </span>
  );
}
