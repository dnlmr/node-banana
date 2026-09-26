"use client";

import React, { useCallback, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { cn } from "./cn";
import { NODE_MIN_W } from "./tokens";

interface CornerGripProps {
  nodeId: string;
  /** Current media height in flow px. */
  height: number;
  minHeight?: number;
  maxHeight?: number;
  minWidth?: number;
  maxWidth?: number;
  onHeightChange: (height: number) => void;
  label?: string;
  className?: string;
}

/** Widest a node can be dragged; the shell's edge controls use the same cap. */
const RESIZE_MAX_W = 1200;

/**
 * A grab corner at the media card's bottom-right that resizes width and
 * height together, in flow pixels. Width goes to React Flow the way the
 * shell's edge controls write it; height goes to the node's own
 * `mediaHeight` through `onHeightChange`, like the HeightGrip.
 */
export function CornerGrip({
  nodeId,
  height,
  minHeight = 60,
  maxHeight = 800,
  minWidth = NODE_MIN_W,
  maxWidth = RESIZE_MAX_W,
  onHeightChange,
  label = "Resize",
  className,
}: CornerGripProps) {
  const reactFlow = useReactFlow();
  const drag = useRef<{ startX: number; startY: number; startW: number; startH: number; zoom: number } | null>(null);

  const nodeWidth = useCallback((): number => {
    const node = reactFlow.getNodes?.().find((n) => n.id === nodeId);
    const styleW = typeof node?.style?.width === "number" ? node.style.width : undefined;
    return node?.width ?? styleW ?? node?.measured?.width ?? minWidth;
  }, [reactFlow, nodeId, minWidth]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const zoom = typeof reactFlow.getZoom === "function" ? reactFlow.getZoom() || 1 : 1;
      drag.current = { startX: e.clientX, startY: e.clientY, startW: nodeWidth(), startH: height, zoom };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [reactFlow, nodeWidth, height]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      const width = Math.round(Math.max(minWidth, Math.min(maxWidth, d.startW + (e.clientX - d.startX) / d.zoom)));
      const next = Math.round(Math.max(minHeight, Math.min(maxHeight, d.startH + (e.clientY - d.startY) / d.zoom)));
      reactFlow.setNodes((nodes) =>
        nodes.map((node) => (node.id === nodeId ? { ...node, width, style: { ...node.style, width } } : node))
      );
      if (next !== height) onHeightChange(next);
    },
    [reactFlow, nodeId, minWidth, maxWidth, minHeight, maxHeight, height, onHeightChange]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      role="separator"
      aria-label={label}
      title="Drag to resize"
      data-corner-grip
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={cn(
        // A generous target: 28px square, hanging a little past the card's
        // corner so the pointer catches it from outside too. The glyph stays
        // small and tucked in the corner.
        "nodrag nopan absolute -bottom-2 -right-2 z-10 flex h-7 w-7 cursor-nwse-resize items-end justify-end p-[11px] group/corner",
        className
      )}
    >
      <svg
        viewBox="0 0 10 10"
        aria-hidden="true"
        className="h-2.5 w-2.5 text-neutral-500/80 transition-colors group-hover/corner:text-neutral-200"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      >
        <path d="M9 1 1 9M9 5 5 9M9 9h0" />
      </svg>
    </div>
  );
}
