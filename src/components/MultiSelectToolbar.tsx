"use client";

import { ChevronDown, Columns2, Cpu, Download, Group, LayoutGrid, Play, Rows2, Shrink } from "lucide-react";
import { MenuDivider, MenuIconButton, MenuItem, MenuList, MenuShortcut, MenuSurface } from "@/components/ui/Menu";
import { useReactFlow } from "@xyflow/react";
import { useShallow } from "zustand/shallow";
import { useWorkflowStore } from "@/store/workflowStore";
import { memo, useMemo, useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import type {
  ImageInputNodeData,
  AnnotationNodeData,
  NanoBananaNodeData,
  OutputNodeData,
} from "@/types";
import { parseDataUrl } from "@/utils/dataUrl";
import { sniffExtension } from "@/utils/mediaSniff";
import { getNodeSize } from "@/utils/nodeDimensions";
import { cn } from "@/components/nodes/ui/cn";
import { ModelSearchDialog } from "@/components/modals/ModelSearchDialog";
import { GENERATE_NODE_LABEL, capabilityForGenerateNode, sharedGenerateType } from "@/store/utils/modelSelection";

const STACK_GAP = 20;
/** A zipped image's extension when its bytes don't prove one. */
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
type Arrangement = "horizontal" | "vertical" | "grid";
const ARRANGEMENTS: { mode: Arrangement; label: string; shortcut?: string; Icon: typeof LayoutGrid }[] = [
  { mode: "horizontal", label: "Stack horizontally", Icon: Columns2 },
  { mode: "vertical", label: "Stack vertically", shortcut: "V", Icon: Rows2 },
  { mode: "grid", label: "Arrange as grid", shortcut: "G", Icon: LayoutGrid },
];
/** Keeps a press inside the menu or slider from panning, dragging or deselecting on the canvas beneath. */
const stopCanvasEvents = {
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
  onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation(),
  onDoubleClick: (event: React.MouseEvent) => event.stopPropagation(),
};

// Memoised: rendered by the canvas, which re-renders on every drag frame
export const MultiSelectToolbar = memo(function MultiSelectToolbar() {
  // Only the selection: a drag of anything else must not re-render the toolbar
  const selectedNodes = useWorkflowStore(useShallow((state) => state.nodes.filter((node) => node.selected)));
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  const createGroup = useWorkflowStore((state) => state.createGroup);
  const removeNodesFromGroup = useWorkflowStore((state) => state.removeNodesFromGroup);
  const executeSelectedNodes = useWorkflowStore((state) => state.executeSelectedNodes);
  const isRunning = useWorkflowStore((state) => state.isRunning);
  const applyModelToNodes = useWorkflowStore((state) => state.applyModelToNodes);
  // One model for the whole selection, offered when every node is the same kind of generator
  const generateType = useMemo(() => sharedGenerateType(selectedNodes), [selectedNodes]);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const { getViewport } = useReactFlow();
  const selectionKey = JSON.stringify(selectedNodes.map((node) => node.id).sort());
  const [arrangement, setArrangement] = useState<{
    selectionKey: string;
    mode: Arrangement;
    nodes: typeof selectedNodes;
    position: { x: number; y: number };
    gap: number;
  } | null>(null);
  const [arrangeMenuOpen, setArrangeMenuOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Clear the spacing control when the selection changes, including deselection.
  if (arrangement && arrangement.selectionKey !== selectionKey) {
    setArrangement(null);
  }
  const activeArrangement = arrangement?.selectionKey === selectionKey ? arrangement : null;
  const popoverOpen = arrangeMenuOpen || activeArrangement !== null;

  // The menu and the spacing slider behave like a popover: a press outside the
  // toolbar closes both; Escape closes the menu first, then the slider.
  useEffect(() => {
    if (!popoverOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      setArrangeMenuOpen(false);
      setArrangement(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (arrangeMenuOpen) setArrangeMenuOpen(false);
      else setArrangement(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [popoverOpen, arrangeMenuOpen]);

  // Check if any selected nodes are in a group
  const selectedNodeGroups = useMemo(() => {
    const groupIds = new Set(selectedNodes.map((n) => n.groupId).filter(Boolean));
    return [...groupIds];
  }, [selectedNodes]);

  const someInGroup = selectedNodeGroups.length > 0;

  // Calculate toolbar position (centered above selected nodes)
  const toolbarPosition = useMemo(() => {
    if (selectedNodes.length < 2) return null;

    const viewport = getViewport();

    // Find bounding box of selected nodes
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;

    selectedNodes.forEach((node) => {
      const nodeWidth = getNodeSize(node).width;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + nodeWidth);
    });

    // Convert flow coordinates to screen coordinates
    const centerX = (minX + maxX) / 2;
    const screenX = centerX * viewport.zoom + viewport.x;
    const screenY = minY * viewport.zoom + viewport.y - 50; // 50px above the top

    return { x: screenX, y: screenY };
  }, [selectedNodes, getViewport]);

  const handleStackHorizontally = (gap: number, nodes = selectedNodes) => {
    if (selectedNodes.length < 2) return;

    // Sort by current x position to maintain relative order
    const sortedNodes = [...nodes].sort((a, b) => a.position.x - b.position.x);

    // Use the topmost y position as the alignment point
    const alignY = Math.min(...sortedNodes.map((n) => n.position.y));

    let currentX = sortedNodes[0].position.x;

    const changes = sortedNodes.map((node) => {
      const nodeWidth = getNodeSize(node).width;

      const change = {
        type: "position" as const,
        id: node.id,
        position: { x: currentX, y: alignY },
      };

      currentX += nodeWidth + gap;
      return change;
    });

    onNodesChange(changes);
  };

  const handleStackVertically = (gap: number, nodes = selectedNodes) => {
    if (selectedNodes.length < 2) return;

    // Sort by current y position to maintain relative order
    const sortedNodes = [...nodes].sort((a, b) => a.position.y - b.position.y);

    // Use the leftmost x position as the alignment point
    const alignX = Math.min(...sortedNodes.map((n) => n.position.x));

    let currentY = sortedNodes[0].position.y;

    const changes = sortedNodes.map((node) => {
      const nodeHeight = getNodeSize(node).height;

      const change = {
        type: "position" as const,
        id: node.id,
        position: { x: alignX, y: currentY },
      };

      currentY += nodeHeight + gap;
      return change;
    });

    onNodesChange(changes);
  };

  const handleArrangeAsGrid = (gap: number, nodes = selectedNodes) => {
    if (selectedNodes.length < 2) return;

    // Calculate optimal grid dimensions (as square as possible)
    const count = nodes.length;
    const cols = Math.ceil(Math.sqrt(count));

    // Sort nodes by their current position (top-to-bottom, left-to-right)
    const sortedNodes = [...nodes].sort((a, b) => {
      const rowA = Math.floor(a.position.y / 100);
      const rowB = Math.floor(b.position.y / 100);
      if (rowA !== rowB) return rowA - rowB;
      return a.position.x - b.position.x;
    });

    // Find the starting position (top-left of bounding box)
    const startX = Math.min(...sortedNodes.map((n) => n.position.x));
    const startY = Math.min(...sortedNodes.map((n) => n.position.y));

    // Get max node dimensions for consistent spacing
    const maxWidth = Math.max(...sortedNodes.map((n) => getNodeSize(n).width));
    const maxHeight = Math.max(...sortedNodes.map((n) => getNodeSize(n).height));

    // Position each node in the grid
    const changes = sortedNodes.map((node, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);

      return {
        type: "position" as const,
        id: node.id,
        position: {
          x: startX + col * (maxWidth + gap),
          y: startY + row * (maxHeight + gap),
        },
      };
    });

    onNodesChange(changes);
  };

  const applyArrangement = (mode: Arrangement, gap: number, nodes = selectedNodes) => {
    if (mode === "horizontal") handleStackHorizontally(gap, nodes);
    else if (mode === "vertical") handleStackVertically(gap, nodes);
    else handleArrangeAsGrid(gap, nodes);
  };

  const chooseArrangement = (mode: Arrangement) => {
    setArrangeMenuOpen(false);
    if (!toolbarPosition || activeArrangement?.mode === mode) return;
    const gap = activeArrangement?.gap ?? STACK_GAP;
    setArrangement({
      selectionKey, mode, nodes: selectedNodes, gap,
      position: activeArrangement?.position ?? toolbarPosition,
    });
    applyArrangement(mode, gap);
  };

  const handleCreateGroup = () => {
    const nodeIds = selectedNodes.map((n) => n.id);
    createGroup(nodeIds);
  };

  const handleUngroup = () => {
    const nodeIds = selectedNodes.map((n) => n.id);
    removeNodesFromGroup(nodeIds);
  };

  const handleDownloadImages = useCallback(async () => {
    // Extract images from selected nodes based on node type
    const images: { bytes: Uint8Array; name: string }[] = [];

    selectedNodes.forEach((node, index) => {
      let imageData: string | null = null;

      switch (node.type) {
        case "imageInput":
          imageData = (node.data as ImageInputNodeData).image;
          break;
        case "annotation":
          imageData = (node.data as AnnotationNodeData).outputImage;
          break;
        case "nanoBanana":
          imageData = (node.data as NanoBananaNodeData).outputImage;
          break;
        case "output":
          imageData = (node.data as OutputNodeData).image;
          break;
      }

      // Only the payload is decoded (any declared type, or none); anything else — a URL — is left out
      // rather than written into the zip as noise.
      const parsed = imageData ? parseDataUrl(imageData) : null;
      if (parsed) {
        const ext = sniffExtension(parsed.bytes, "image") ?? IMAGE_MIME_EXTENSIONS[parsed.mime] ?? "png";
        images.push({ bytes: parsed.bytes, name: `image-${index + 1}.${ext}` });
      }
    });

    if (images.length === 0) return;

    // Create ZIP file
    const zip = new JSZip();
    images.forEach(({ bytes, name }) => {
      zip.file(name, bytes);
    });

    // Generate and download
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `images-${Date.now()}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [selectedNodes]);

  if (!toolbarPosition || selectedNodes.length < 2) return null;

  return (
    <MenuSurface
      ref={toolbarRef}
      variant="bar"
      className="nodrag nopan"
      style={{
        left: activeArrangement?.position.x ?? toolbarPosition.x,
        top: activeArrangement?.position.y ?? toolbarPosition.y,
        transform: "translateX(-50%)",
      }}
    >
      {/* Run just the selection */}
      <MenuIconButton
        onClick={() => executeSelectedNodes(selectedNodes.map((node) => node.id))}
        disabled={isRunning}
        title={isRunning ? "A run is in progress" : `Run ${selectedNodes.length} selected nodes`}
        aria-label="Run selected nodes"
      >
        <Play size={16} strokeWidth={0} fill="currentColor" />
      </MenuIconButton>

      {/* Separator */}
      <MenuDivider variant="bar" className="mx-0.5" />

      <MenuIconButton
        onClick={() => setArrangeMenuOpen((open) => !open)}
        aria-label="Arrange nodes"
        aria-haspopup="menu"
        aria-expanded={arrangeMenuOpen}
        title="Arrange nodes"
        className={cn(
          "flex items-center gap-0.5 pr-1",
          (arrangeMenuOpen || activeArrangement) && "bg-neutral-700 text-neutral-100"
        )}
      >
        <LayoutGrid size={16} strokeWidth={1.5} />
        <ChevronDown
          size={12}
          strokeWidth={2.25}
          className={cn("transition-transform duration-[120ms]", arrangeMenuOpen && "rotate-180")}
        />
      </MenuIconButton>

      {/* Separator */}
      <MenuDivider variant="bar" className="mx-0.5" />

      {/* Group/Ungroup buttons */}
      {someInGroup ? (
        <MenuIconButton
          onClick={handleUngroup}
            title="Remove from group"
        >
          <Shrink size={16} strokeWidth={1.5} />
        </MenuIconButton>
      ) : (
        <MenuIconButton
          onClick={handleCreateGroup}
            title="Create group"
        >
          <Group size={16} strokeWidth={1.5} />
        </MenuIconButton>
      )}

      {/* Separator */}
      <MenuDivider variant="bar" className="mx-0.5" />

      {generateType && (
        <>
          <MenuIconButton
            onClick={() => setModelDialogOpen(true)}
            title={`Change model for ${selectedNodes.length} ${GENERATE_NODE_LABEL[generateType]} nodes`}
            aria-label="Change model for selected nodes"
          >
            <Cpu size={16} strokeWidth={1.5} />
          </MenuIconButton>
          <MenuDivider variant="bar" className="mx-0.5" />
        </>
      )}

      {/* Download images button */}
      <MenuIconButton
        onClick={handleDownloadImages}
        title="Download images as ZIP"
      >
        <Download size={16} strokeWidth={1.5} />
      </MenuIconButton>

      {/* The slider sits directly under the bar, and a reopened menu opens beneath it so the slider never moves */}
      {popoverOpen && (
        <div className="absolute top-full left-1/2 mt-1.5 -translate-x-1/2 flex flex-col items-center gap-1.5">
        {activeArrangement && (
          <MenuSurface
            variant="bar"
            floating={false}
            className="nodrag nopan w-[200px] gap-2 px-2.5 py-1.5"
            {...stopCanvasEvents}
          >
            <span className="text-[10px] text-neutral-400">Gap</span>
            <input
              type="range"
              aria-label="Node spacing"
              aria-valuetext={`${activeArrangement.gap} pixels`}
              min={0}
              max={200}
              step={1}
              value={activeArrangement.gap}
              className="nodrag nopan min-w-0 flex-1 h-4 accent-neutral-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection rounded"
              onChange={(event) => {
                const gap = Number(event.target.value);
                setArrangement({ ...activeArrangement, gap });
                applyArrangement(activeArrangement.mode, gap, activeArrangement.nodes);
              }}
            />
            <span className="w-9 text-right text-[10px] text-neutral-400 tabular-nums">
              {activeArrangement.gap}px
            </span>
          </MenuSurface>
        )}
        {arrangeMenuOpen && (
          <MenuSurface
            floating={false}
            role="menu"
            aria-label="Arrange nodes"
            className="nodrag nopan min-w-[184px]"
            {...stopCanvasEvents}
          >
            <MenuList>
              {ARRANGEMENTS.map(({ mode, label, shortcut, Icon }) => (
                <MenuItem
                  key={mode}
                  role="menuitemradio"
                  aria-checked={activeArrangement?.mode === mode}
                  selected={activeArrangement?.mode === mode}
                  onClick={() => chooseArrangement(mode)}
                >
                  <Icon size={16} strokeWidth={1.5} className="text-neutral-400" />
                  <span className="whitespace-nowrap">{label}</span>
                  {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
                </MenuItem>
              ))}
            </MenuList>
          </MenuSurface>
        )}
        </div>
      )}
      {modelDialogOpen && generateType && (
        <ModelSearchDialog
          isOpen
          onClose={() => setModelDialogOpen(false)}
          title={`Change model for ${selectedNodes.length} nodes`}
          initialCapabilityFilter={capabilityForGenerateNode(generateType)}
          onModelSelected={(model) => {
            applyModelToNodes(selectedNodes.map((node) => node.id), model);
            setModelDialogOpen(false);
          }}
        />
      )}
    </MenuSurface>
  );
});
