/**
 * Done in the annotation modal keeps the drawn-on image in the asset library,
 * as an "annotate" edit of the annotation node.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { forwardRef, useImperativeHandle, type ReactNode } from "react";
import { AnnotationModal } from "@/components/AnnotationModal";
import type { ToolType, ToolOptions, AnnotationShape } from "@/types";

// A Stage whose ref is set, so flattening has a stage to work from
vi.mock("react-konva", () => ({
  Stage: forwardRef(function Stage({ children }: { children: ReactNode }, ref) {
    useImperativeHandle(ref, () => ({ findOne: () => null }));
    return <div data-testid="konva-stage">{children}</div>;
  }),
  Layer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Image: () => <div data-testid="konva-image" />,
  Rect: () => <div />,
  Ellipse: () => <div />,
  Arrow: () => <div />,
  Line: () => <div />,
  Text: () => <div />,
  Transformer: () => <div />,
}));

// The off-screen stage the modal flattens onto
vi.mock("konva", () => {
  class Shape {}
  class Container {
    add() {}
    draw() {}
  }
  class Stage extends Container {
    toDataURL() {
      return "data:image/png;base64,flattened";
    }
    destroy() {}
  }
  return { default: { Stage, Layer: Container, Image: Shape, Rect: Shape, Ellipse: Shape, Arrow: Shape, Line: Shape, Text: Shape, Transformer: Shape } };
});

const rectangle: AnnotationShape = {
  id: "shape-1",
  type: "rectangle",
  x: 10,
  y: 10,
  width: 50,
  height: 40,
  stroke: "#ef4444",
  strokeWidth: 3,
  fill: null,
  opacity: 1,
} as AnnotationShape;

const toolOptions: ToolOptions = { strokeColor: "#ef4444", strokeWidth: 3, fillColor: null, fontSize: 24, opacity: 1 };
const mockCloseModal = vi.fn();
let annotations: AnnotationShape[] = [rectangle];

vi.mock("@/store/annotationStore", () => ({
  useAnnotationStore: () => ({
    isModalOpen: true,
    sourceNodeId: "ann-1",
    sourceImage: "data:image/png;base64,source",
    annotations,
    selectedShapeId: null,
    currentTool: "rectangle" as ToolType,
    toolOptions,
    closeModal: mockCloseModal,
    addAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    clearAnnotations: vi.fn(),
    selectShape: vi.fn(),
    setCurrentTool: vi.fn(),
    setToolOptions: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  }),
}));

const mockUpdateNodeData = vi.fn();
const mockRecordUiAsset = vi.fn();
let previousOutput: string | null = null;
const storeState = () => ({
  updateNodeData: mockUpdateNodeData,
  recordUiAsset: mockRecordUiAsset,
  nodes: [{ id: "ann-1", type: "annotation", position: { x: 0, y: 0 }, data: { outputImage: previousOutput } }],
});
vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: Object.assign(
    (selector?: (state: unknown) => unknown) => (selector ? selector(storeState()) : storeState()),
    { getState: () => storeState() }
  ),
}));

class MockImage {
  onload: (() => void) | null = null;
  width = 800;
  height = 600;
  set src(_value: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}
const OriginalImage = global.Image;

async function renderLoaded() {
  render(<AnnotationModal />);
  // The source image has loaded once the stage draws it
  await screen.findByTestId("konva-image");
}

describe("AnnotationModal recording", () => {
  beforeAll(() => {
    vi.stubGlobal("Image", MockImage);
  });
  afterAll(() => {
    vi.stubGlobal("Image", OriginalImage);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    annotations = [rectangle];
    previousOutput = null;
  });

  it("records the flattened image as an annotate edit when Done is pressed", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText("Done"));

    expect(mockUpdateNodeData).toHaveBeenCalledWith("ann-1", expect.objectContaining({ outputImage: "data:image/png;base64,flattened" }));
    expect(mockRecordUiAsset).toHaveBeenCalledExactlyOnceWith({
      kind: "image",
      origin: "edited",
      media: "data:image/png;base64,flattened",
      mime: "image/png",
      producer: { nodeId: "ann-1", nodeType: "annotation", operation: "annotate" },
      width: 800,
      height: 600,
    });
    // Recorded after the output is written, so the run's graph shows the edit
    expect(mockUpdateNodeData.mock.invocationCallOrder[0]).toBeLessThan(mockRecordUiAsset.mock.invocationCallOrder[0]);
    expect(mockCloseModal).toHaveBeenCalled();
  });

  it("records nothing when nothing was drawn", async () => {
    annotations = [];
    await renderLoaded();

    fireEvent.click(screen.getByText("Done"));

    expect(mockUpdateNodeData).toHaveBeenCalled();
    expect(mockRecordUiAsset).not.toHaveBeenCalled();
  });

  it("records nothing when the drawing is the one already there", async () => {
    previousOutput = "data:image/png;base64,flattened";
    await renderLoaded();

    fireEvent.click(screen.getByText("Done"));

    expect(mockRecordUiAsset).not.toHaveBeenCalled();
  });
});
