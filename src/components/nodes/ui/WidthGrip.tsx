"use client";

import React, { useCallback, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { cn } from "./cn";
import { CONTROLS_MIN_W, CONTROLS_RESIZE_MAX_W } from "./tokens";

interface WidthGripProps {
  /** Which edge of the element the grip sits on. */
  side: "left" | "right";
  /** Current width in flow px; the drag starts from here. */
  width: number;
  min?: number;
  max?: number;
  /** Called with the new width while dragging; `undefined` on double-click to reset. */
  onChange: (width: number | undefined) => void;
  /** The element is centred, so one edge moving by dx changes the width by 2·dx. */
  symmetric?: boolean;
  className?: string;
}

/**
 * A grab strip along one vertical edge of the controls card. Dragging it
 * changes the card's width in flow pixels (so it accounts for the canvas
 * zoom); double-clicking hands back `undefined` so the card follows the node
 * width again.
 */
export function WidthGrip({
  side,
  width,
  min = CONTROLS_MIN_W,
  max = CONTROLS_RESIZE_MAX_W,
  onChange,
  symmetric = true,
  className,
}: WidthGripProps) {
  const reactFlow = useReactFlow();
  const drag = useRef<{ startX: number; startW: number; zoom: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const zoom = typeof reactFlow.getZoom === "function" ? reactFlow.getZoom() || 1 : 1;
      drag.current = { startX: e.clientX, startW: width, zoom };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [reactFlow, width]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      const dx = ((e.clientX - drag.current.startX) / drag.current.zoom) * (side === "right" ? 1 : -1);
      const next = Math.round(Math.max(min, Math.min(max, drag.current.startW + dx * (symmetric ? 2 : 1))));
      if (next !== width) onChange(next);
    },
    [max, min, onChange, side, symmetric, width]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onChange(undefined);
    },
    [onChange]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize settings (${side} edge)`}
      title="Drag to resize · double-click to reset"
      data-width-grip={side}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      className={cn(
        "nodrag nopan absolute top-0 bottom-0 w-[6px] cursor-ew-resize group/wgrip flex items-center",
        side === "left" ? "left-0 justify-start" : "right-0 justify-end",
        className
      )}
    >
      <span
        aria-hidden
        className="h-6 w-[2px] rounded-full bg-neutral-500/0 group-hover/wgrip:bg-neutral-400/80 group-active/wgrip:bg-neutral-300 transition-colors"
      />
    </div>
  );
}
