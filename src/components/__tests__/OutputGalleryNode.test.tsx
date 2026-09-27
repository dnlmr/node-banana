import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { OutputGalleryNode } from "@/components/nodes/OutputGalleryNode";

const mockUpdateNodeData = vi.fn();
vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: vi.fn((selector) =>
    selector({
      updateNodeData: mockUpdateNodeData,
      incrementModalCount: vi.fn(),
      decrementModalCount: vi.fn(),
      currentNodeIds: [],
      groups: {},
      nodes: [],
      edges: [],
      addNode: vi.fn(),
      onConnect: vi.fn(),
      setHoveredNodeId: vi.fn(),
      getConnectedInputs: vi.fn(() => ({ images: [], videos: [], text: null, dynamicInputs: {} })),
    })
  ),
}));
vi.mock("@/components/WorkflowCanvas", () => ({ isPanningRef: { current: false }, isDraggingNodeRef: { current: false } }));

const IMG = "data:image/png;base64,iVBORw0KGgo=";
const props = {
  id: "gallery-1",
  type: "outputGallery" as const,
  selected: false,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  zIndex: 0,
  dragging: false,
  deletable: true,
  selectable: true,
  draggable: true,
  parentId: undefined,
  dragHandle: undefined,
};

function renderGallery(data: Record<string, unknown>) {
  return render(
    <ReactFlowProvider>
      <OutputGalleryNode {...props} data={{ images: [], ...data }} />
    </ReactFlowProvider>
  );
}

describe("OutputGalleryNode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has no grip while empty", () => {
    renderGallery({ images: [] });
    expect(screen.queryByRole("separator", { name: /Resize gallery/ })).toBeNull();
  });

  it("resizes vertically by its grip and remembers the height on the node", () => {
    const { container } = renderGallery({ images: [IMG, IMG] });
    const grip = screen.getByRole("separator", { name: "Resize gallery height" });
    grip.setPointerCapture = vi.fn();
    grip.releasePointerCapture = vi.fn();
    const clip = container.querySelector("[data-media-clip]") as HTMLElement;
    expect(clip.style.height).toBe("240px");
    fireEvent.pointerDown(grip, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 180, pointerId: 1 });
    expect(mockUpdateNodeData).toHaveBeenLastCalledWith("gallery-1", { mediaHeight: 320 });
    // Below the minimum it clamps.
    fireEvent.pointerMove(grip, { clientY: -500, pointerId: 1 });
    expect(mockUpdateNodeData).toHaveBeenLastCalledWith("gallery-1", { mediaHeight: 120 });
  });

  it("draws the grid at a stored height", () => {
    const { container } = renderGallery({ images: [IMG], mediaHeight: 400 });
    expect((container.querySelector("[data-media-clip]") as HTMLElement).style.height).toBe("400px");
  });

  it("resizes both ways from the corner", () => {
    renderGallery({ images: [IMG], mediaHeight: 300 });
    const corner = screen.getByRole("separator", { name: "Resize gallery" });
    corner.setPointerCapture = vi.fn();
    corner.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(corner, { clientX: 500, clientY: 400, pointerId: 1, button: 0 });
    fireEvent.pointerMove(corner, { clientX: 560, clientY: 450, pointerId: 1 });
    expect(mockUpdateNodeData).toHaveBeenLastCalledWith("gallery-1", { mediaHeight: 350 });
    // Width goes to React Flow; the store's node list is empty here, so only the
    // height is observable, and the drag must not throw without a node to size.
    fireEvent.pointerUp(corner, { pointerId: 1 });
    expect(corner.releasePointerCapture).toHaveBeenCalled();
  });
});
