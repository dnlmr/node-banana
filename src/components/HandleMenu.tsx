"use client";

import { Eye, EyeOff, Trash2 } from "lucide-react";
import { MenuBarLabel, MenuDivider, MenuIconButton, MenuSurface } from "@/components/ui/Menu";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import { bundleIdAt, edgesOnHandle } from "@/lib/edges/bundles";
import { edgeColorForHandles } from "@/lib/edges/colors";

/**
 * The bar a single click on a handle opens, centred above it: a count of the
 * connections on that handle, then Bundle (or Unbundle), Hide (or Show) and
 * Remove all. Bundling actions use text labels. A drag on the handle still starts a connection.
 */

export interface HandleMenuTarget {
  nodeId: string;
  handleId: string | null;
  type: "source" | "target";
  /** The handle's centre on screen. */
  position: { x: number; y: number };
}

interface HandleMenuProps {
  target: HandleMenuTarget;
  onClose: () => void;
}

/** Gap between the handle's centre and the bar's bottom edge. */
const GAP = 14;


export function HandleMenu({ target, onClose }: HandleMenuProps) {
  const edges = useWorkflowStore((state) => state.edges);
  const bundleEdges = useWorkflowStore((state) => state.bundleEdges);
  const unbundleEdges = useWorkflowStore((state) => state.unbundleEdges);
  const setEdgesHidden = useWorkflowStore((state) => state.setEdgesHidden);
  const removeEdges = useWorkflowStore((state) => state.removeEdges);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Measure on mount so the first paint is already centred above the handle
  const measure = useCallback((el: HTMLDivElement | null) => {
    menuRef.current = el;
    if (el) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, []);

  const onHandle = useMemo(() => edgesOnHandle(edges, target.nodeId, target.type, target.handleId), [edges, target]);
  const ids = onHandle.map((e) => e.id);
  const bundleable = onHandle.filter((e) => !e.data?.hidden && e.type !== "reference");
  const bundled = bundleable.filter((e) => bundleIdAt(e, target.type));
  const allInOneBundle =
    bundleable.length >= 2 && bundled.length === bundleable.length && new Set(bundled.map((e) => bundleIdAt(e, target.type))).size === 1;
  const hiddenCount = onHandle.filter((e) => e.data?.hidden).length;
  const allHidden = onHandle.length > 0 && hiddenCount === onHandle.length;
  const count = onHandle.length;
  const color = edgeColorForHandles(target.type === "source" ? target.handleId : null, target.type === "target" ? target.handleId : null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const run = (action: () => void) => {
    action();
    onClose();
  };

  // Centred above the handle, kept inside the viewport
  const left = Math.max(8, Math.min(window.innerWidth - size.width - 8, target.position.x - size.width / 2));
  const top = Math.max(8, target.position.y - GAP - size.height);

  return (
    <MenuSurface
      ref={measure}
      variant="bar"
      role="menu"
      aria-label="Handle connections"
      data-testid="handle-menu"
      style={{ left, top }}
    >
      <MenuBarLabel className="pr-2.5" data-testid="handle-menu-count">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        {count}
      </MenuBarLabel>

      {allInOneBundle ? (
        <MenuIconButton role="menuitem" className="px-2 text-xs font-medium text-neutral-300" title="Unbundle" aria-label="Unbundle" onClick={() => run(() => unbundleEdges(bundled.map((e) => e.id), target.type))}>
          Unbundle
        </MenuIconButton>
      ) : (
        <MenuIconButton role="menuitem" className="px-2 text-xs font-medium text-neutral-300" title="Bundle" aria-label="Bundle" disabled={bundleable.length < 2} onClick={() => run(() => bundleEdges(bundleable.map((e) => e.id), target.type))}>
          Bundle
        </MenuIconButton>
      )}

      {allHidden ? (
        <MenuIconButton role="menuitem" title="Show" aria-label="Show" onClick={() => run(() => setEdgesHidden(ids, false))}>
          <Eye size={16} strokeWidth={1.75} />
        </MenuIconButton>
      ) : (
        <MenuIconButton role="menuitem" title="Hide" aria-label="Hide" disabled={count === 0} onClick={() => run(() => setEdgesHidden(ids, true))}>
          <EyeOff size={16} strokeWidth={1.75} />
        </MenuIconButton>
      )}

      <MenuDivider variant="bar" />

      <MenuIconButton role="menuitem" className="hover:text-red-400" title="Remove all" aria-label="Remove all" disabled={count === 0} onClick={() => run(() => removeEdges(ids))}>
        <Trash2 size={16} strokeWidth={1.5} />
      </MenuIconButton>
    </MenuSurface>
  );
}
