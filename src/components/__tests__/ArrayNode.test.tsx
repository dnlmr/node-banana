import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ArrayNode } from "@/components/nodes/ArrayNode";
import type { ArrayNodeData } from "@/types";

const mockUpdateNodeData = vi.fn();
const mockUseWorkflowStore = vi.fn();
let mockState: unknown = null;

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: Object.assign((selector: (state: unknown) => unknown) => mockUseWorkflowStore(selector), {
    getState: () => mockState,
  }),
}));

const NODE_ID = "array-1";
const ITEMS = ["fox", "lighthouse", "koi", "motel", "greenhouse", "market", "harbour"];

function nodeData(overrides: Partial<ArrayNodeData> = {}): ArrayNodeData {
  const inputText = overrides.inputText ?? null;
  return {
    inputText,
    splitMode: "delimiter",
    delimiter: "*",
    regexPattern: "",
    trimItems: true,
    removeEmpty: true,
    batchMode: false,
    selectedOutputIndex: null,
    outputItems: [],
    outputText: "[]",
    error: null,
    ...overrides,
  };
}

function setup(data: ArrayNodeData, edges: Array<Record<string, unknown>> = []) {
  const state = {
    updateNodeData: mockUpdateNodeData,
    addNode: vi.fn(),
    onConnect: vi.fn(),
    currentNodeIds: [] as string[],
    setHoveredNodeId: vi.fn(),
    nodes: [
      { id: NODE_ID, type: "array", position: { x: 0, y: 0 }, data },
      { id: "prompt-1", type: "prompt", position: { x: -300, y: 0 }, data: { prompt: data.inputText ?? "" } },
    ],
    edges,
  };
  mockUseWorkflowStore.mockImplementation((selector: (s: typeof state) => unknown) => selector(state));
  mockState = state;
  return render(
    <ReactFlowProvider>
      <ArrayNode
        id={NODE_ID}
        type="array"
        data={data}
        selected={false}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        zIndex={0}
        dragging={false}
        deletable
        selectable
        draggable
      />
    </ReactFlowProvider>
  );
}

const incoming = { id: "in", source: "prompt-1", sourceHandle: "text", target: NODE_ID, targetHandle: "text", data: {} };
const outgoing = (index: number) => ({
  id: `out-${index}`, source: NODE_ID, sourceHandle: "text", target: `t-${index}`, targetHandle: "text",
  data: { arrayItemIndex: index, createdAt: index + 1 },
});

describe("ArrayNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for text when nothing is connected", () => {
    setup(nodeData());
    expect(screen.getByText("Connect text to split it")).toBeInTheDocument();
    expect(screen.getByTestId("array-item-count")).toHaveTextContent("No items");
    expect(screen.getByRole("button", { name: /Make Prompts/ })).toBeDisabled();
  });

  it("previews the first five items and marks the wired ones and the next", () => {
    setup(nodeData({ inputText: ITEMS.join("*"), outputItems: ITEMS }), [incoming, outgoing(0), outgoing(1)]);
    const list = screen.getByTestId("array-items");
    expect(screen.getByTestId("array-item-count")).toHaveTextContent("7 items");
    expect(within(list).getByText("greenhouse")).toBeInTheDocument();
    expect(within(list).queryByText("market")).toBeNull();
    expect(within(list).getAllByTestId("array-item-wired")).toHaveLength(2);
    expect(within(list).getByText("koi").closest("button")).toHaveTextContent("next");

    fireEvent.click(within(list).getByText("2 more"));
    expect(within(list).getByText("harbour")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Make 7 Prompts/ })).toBeEnabled();
  });

  it("pins an item for the next connection", () => {
    setup(nodeData({ inputText: ITEMS.join("*"), outputItems: ITEMS }), [incoming]);
    fireEvent.click(screen.getByText("motel"));
    expect(mockUpdateNodeData).toHaveBeenCalledWith(NODE_ID, { selectedOutputIndex: 3 });
  });

  it("explains batch mode and drops the Prompt action", () => {
    setup(nodeData({ inputText: ITEMS.join("*"), outputItems: ITEMS, batchMode: true }), [incoming]);
    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByText("Each connected Generate or LLM node runs 7 times, once per item.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Make/ })).toBeNull();
    expect(screen.queryByText("next")).toBeNull();
  });

  it("shows a parse error in the list", () => {
    const error = "Invalid regular expression: /[a-z/: Unterminated character class";
    setup(nodeData({ inputText: "a b", splitMode: "regex", regexPattern: "[a-z", error }), [incoming]);
    expect(screen.getByRole("alert")).toHaveTextContent("Unterminated character class");
    expect(screen.getByLabelText("Regex pattern")).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the clean-up options behind a button", () => {
    setup(nodeData({ inputText: "a* b", outputItems: ["a", "b"] }), [incoming]);
    expect(screen.queryByText("Trim spaces")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clean-up options" }));
    fireEvent.click(screen.getByRole("button", { name: "Trim spaces" }));
    expect(mockUpdateNodeData).toHaveBeenCalledWith(NODE_ID, expect.objectContaining({ trimItems: false }));
  });
});
