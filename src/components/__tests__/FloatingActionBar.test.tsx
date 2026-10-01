import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FloatingActionBar } from "@/components/FloatingActionBar";
import { ReactFlowProvider } from "@xyflow/react";
import { ProviderSettings } from "@/types";

// Mock the workflow store
const mockAddNode = vi.fn();
const mockRunBatch = vi.fn();
const mockRequestStop = vi.fn();
const mockSetRunCount = vi.fn();
const mockValidateWorkflow = vi.fn();
const mockSetEdgeStyle = vi.fn();
const mockSetAllEdgesHidden = vi.fn();
const mockSetModelSearchOpen = vi.fn();
const mockUseWorkflowStore = vi.fn();

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector?: (state: unknown) => unknown) => {
    if (selector) {
      return mockUseWorkflowStore(selector);
    }
    return mockUseWorkflowStore((s: unknown) => s);
  },
}));

// Mock useReactFlow
const mockScreenToFlowPosition = vi.fn((pos) => pos);
const mockGetNodes = vi.fn(() => []);

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({
      screenToFlowPosition: mockScreenToFlowPosition,
      getNodes: mockGetNodes,
    }),
  };
});

// Mock ModelSearchDialog
vi.mock("@/components/modals/ModelSearchDialog", () => ({
  ModelSearchDialog: ({ isOpen, onClose, initialProvider }: { isOpen: boolean; onClose: () => void; initialProvider?: string }) => (
    isOpen ? (
      <div data-testid="model-search-dialog" data-provider={initialProvider}>
        Model Search Dialog
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}));

// Mock fetch for env-status
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Wrapper component for React Flow context
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

// Default provider settings
const defaultProviderSettings: ProviderSettings = {
  providers: {
    gemini: { id: "gemini", name: "Gemini", enabled: true, apiKey: null, apiKeyEnvVar: "GEMINI_API_KEY" },
    openai: { id: "openai", name: "OpenAI", enabled: false, apiKey: null },
    replicate: { id: "replicate", name: "Replicate", enabled: false, apiKey: null },
    fal: { id: "fal", name: "fal.ai", enabled: true, apiKey: null },
    kie: { id: "kie", name: "Kie.ai", enabled: false, apiKey: null },
    wavespeed: { id: "wavespeed", name: "WaveSpeed", enabled: false, apiKey: null },
  },
};

// Default store state factory
const createDefaultState = (overrides = {}) => ({
  // Two connected nodes, so Run has something to run; a node missing a
  // connection never disables it, only a graph with no connections at all
  nodes: [
    { id: "p", type: "prompt", position: { x: 0, y: 0 }, data: { prompt: "hi" } },
    { id: "gen", type: "nanoBanana", position: { x: 0, y: 0 }, data: {} },
  ],
  desktopConnected: true,
  isRunning: false,
  currentNodeIds: [],
  runBatch: mockRunBatch,
  requestStop: mockRequestStop,
  runCount: 1,
  setRunCount: mockSetRunCount,
  batch: null,
  validateWorkflow: mockValidateWorkflow,
  edgeStyle: "angular" as const,
  edgeAppearance: { thickness: "regular" as const, fadedOpacity: 0.25, gradient: true, loadingPulse: true },
  setEdgeStyle: mockSetEdgeStyle,
  setAllEdgesHidden: mockSetAllEdgesHidden,
  edges: [{ id: "e", source: "p", target: "gen", sourceHandle: "text", targetHandle: "text" }],
  setModelSearchOpen: mockSetModelSearchOpen,
  modelSearchOpen: false,
  modelSearchProvider: null,
  addNode: mockAddNode,
  ...overrides,
});

describe("FloatingActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateWorkflow.mockReturnValue({ valid: true, errors: [] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ gemini: true, openai: false, replicate: false }),
    });

    // Default mock implementation
    mockUseWorkflowStore.mockImplementation((selector) => {
      return selector(createDefaultState());
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic Rendering", () => {
    it("should render node type buttons", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Image" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Prompt" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Output" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "All nodes" })).toBeInTheDocument();
      });
    });

    it("should render the Generate menu button", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
      });
    });

    it("shows the keyboard shortcut in the hover label", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      const imageButton = await screen.findByRole("button", { name: "Image" });
      expect(imageButton.parentElement).toHaveTextContent("⇧I");
    });

    it("should render Run button", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Run")).toBeInTheDocument();
      });
    });

    it("should render edge style toggle button", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Switch to straight connectors" })).toBeInTheDocument();
      });
    });
  });

  describe("Node Button Click", () => {
    it("should call addNode when Image button is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Image" })).toBeInTheDocument();
      });

      const imageButton = screen.getByRole("button", { name: "Image" });
      fireEvent.click(imageButton);

      expect(mockAddNode).toHaveBeenCalledWith("imageInput", expect.any(Object));
    });

    it("should call addNode when Prompt button is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Prompt" })).toBeInTheDocument();
      });

      const promptButton = screen.getByRole("button", { name: "Prompt" });
      fireEvent.click(promptButton);

      expect(mockAddNode).toHaveBeenCalledWith("prompt", expect.any(Object));
    });

    it("should call addNode when Output button is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Output" })).toBeInTheDocument();
      });

      const outputButton = screen.getByRole("button", { name: "Output" });
      fireEvent.click(outputButton);

      expect(mockAddNode).toHaveBeenCalledWith("output", expect.any(Object));
    });
  });

  describe("Node Button Drag", () => {
    it("should set dataTransfer with node type on drag start", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Image" })).toBeInTheDocument();
      });

      const imageButton = screen.getByRole("button", { name: "Image" });

      const mockDataTransfer = {
        setData: vi.fn(),
        effectAllowed: "",
      };

      fireEvent.dragStart(imageButton, {
        dataTransfer: mockDataTransfer,
      });

      expect(mockDataTransfer.setData).toHaveBeenCalledWith("application/node-type", "imageInput");
      expect(mockDataTransfer.effectAllowed).toBe("copy");
    });

    it("should set dataTransfer with prompt type on drag", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Prompt" })).toBeInTheDocument();
      });

      const promptButton = screen.getByRole("button", { name: "Prompt" });

      const mockDataTransfer = {
        setData: vi.fn(),
        effectAllowed: "",
      };

      fireEvent.dragStart(promptButton, {
        dataTransfer: mockDataTransfer,
      });

      expect(mockDataTransfer.setData).toHaveBeenCalledWith("application/node-type", "prompt");
    });
  });

  describe("Generate Combo Button", () => {
    it("should open dropdown menu when Generate button is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
      });

      const generateButton = screen.getByRole("button", { name: "Generate" });
      fireEvent.click(generateButton);

      // Dropdown menu items should appear
      expect(screen.getByRole("menuitem", { name: /^Image/ })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /^Video/ })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Text \(LLM\)/ })).toBeInTheDocument();
    });

    it("opens the menu without adding a node", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      fireEvent.click(await screen.findByRole("button", { name: "Generate" }));

      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("should add nanoBanana node when Image option is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));

      // Click Image option in dropdown
      const imageOption = screen.getByRole("menuitem", { name: /^Image/ });
      fireEvent.click(imageOption);

      expect(mockAddNode).toHaveBeenCalledWith("nanoBanana", expect.any(Object));
    });

    it("should add generateVideo node when Video option is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
      fireEvent.click(screen.getByRole("menuitem", { name: /^Video/ }));

      expect(mockAddNode).toHaveBeenCalledWith("generateVideo", expect.any(Object));
    });

    it("should add llmGenerate node when Text (LLM) option is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
      fireEvent.click(screen.getByRole("menuitem", { name: /Text \(LLM\)/ }));

      expect(mockAddNode).toHaveBeenCalledWith("llmGenerate", expect.any(Object));
    });

    it("should close dropdown after selecting an option", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "Generate" }));

      // Verify dropdown is open
      expect(screen.getByRole("menuitem", { name: /^Video/ })).toBeInTheDocument();

      // Click an option
      fireEvent.click(screen.getByRole("menuitem", { name: /^Video/ }));

      // Dropdown should close
      expect(screen.queryByRole("menuitem", { name: /^Video/ })).not.toBeInTheDocument();
    });
  });

  describe("Browse Models Button", () => {
    it("should render All models button", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "All models" })).toBeInTheDocument();
      });
    });

    it("should open ModelSearchDialog when All models button is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "All models" })).toBeInTheDocument();
      });

      const browseButton = screen.getByRole("button", { name: "All models" });
      fireEvent.click(browseButton);

      expect(mockSetModelSearchOpen).toHaveBeenCalledWith(true);
    });
  });

  describe("All Nodes Menu", () => {
    it("should render All nodes button", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "All nodes" })).toBeInTheDocument();
      });
    });

    it("should open All nodes dropdown when clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "All nodes" })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "All nodes" }));

      // Check representative items from different categories
      expect(screen.getByRole("menuitem", { name: "Image Input" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Generate Image" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Router" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Output Gallery" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Annotate" })).toBeInTheDocument();
    });

    it("should call addNode when a node is selected from All nodes menu", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "All nodes" })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "All nodes" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Annotate" }));

      expect(mockAddNode).toHaveBeenCalledWith("annotation", expect.any(Object));
    });

    it("should close All nodes dropdown after selection", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "All nodes" })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "All nodes" }));

      // Verify dropdown is open
      expect(screen.getByRole("menuitem", { name: "Image Input" })).toBeInTheDocument();

      // Click an item
      fireEvent.click(screen.getByRole("menuitem", { name: "Image Input" }));

      // Dropdown should close - "Image Input" should no longer be visible
      expect(screen.queryByRole("menuitem", { name: "Image Input" })).not.toBeInTheDocument();
    });
  });

  describe("Edge Style Toggle", () => {
    it("should call setEdgeStyle with straight when currently angular", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Switch to straight connectors" })).toBeInTheDocument();
      });

      const toggleButton = screen.getByRole("button", { name: "Switch to straight connectors" });
      fireEvent.click(toggleButton);

      expect(mockSetEdgeStyle).toHaveBeenCalledWith("straight");
    });

    it("should call setEdgeStyle with curved when currently straight", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          edgeStyle: "straight",
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Switch to curved connectors" })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "Switch to curved connectors" }));

      expect(mockSetEdgeStyle).toHaveBeenCalledWith("curved");
    });

    it("should call setEdgeStyle with angular when currently curved", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          edgeStyle: "curved",
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Switch to angular connectors" })).toBeInTheDocument();
      });

      const toggleButton = screen.getByRole("button", { name: "Switch to angular connectors" });
      fireEvent.click(toggleButton);

      expect(mockSetEdgeStyle).toHaveBeenCalledWith("angular");
    });
  });

  describe("Run Button", () => {
    it("runs the whole graph when Run button is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Run")).toBeInTheDocument();
      });

      const runButton = screen.getByText("Run");
      fireEvent.click(runButton);

      expect(mockRunBatch).toHaveBeenCalledWith({ kind: "all" });
    });

    it("should show Stop button when isRunning is true", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          isRunning: true,
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Stop")).toBeInTheDocument();
      });
    });

    it("asks to stop when Stop button is clicked", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          isRunning: true,
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Stop")).toBeInTheDocument();
      });

      const stopButton = screen.getByText("Stop");
      fireEvent.click(stopButton);

      expect(mockRequestStop).toHaveBeenCalled();
    });

    it("keeps Run enabled when some nodes are missing connections", async () => {
      mockUseWorkflowStore.mockImplementation((selector) =>
        selector(createDefaultState({
          nodes: [
            { id: "p", type: "prompt", position: { x: 0, y: 0 }, data: { prompt: "hi" } },
            { id: "gen", type: "nanoBanana", position: { x: 0, y: 0 }, data: {} },
            { id: "lonely", type: "nanoBanana", position: { x: 0, y: 0 }, data: {} },
          ],
          edges: [{ id: "e", source: "p", target: "gen", sourceHandle: "text", targetHandle: "text" }],
        })));

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Run")).toBeInTheDocument();
      });

      expect(screen.getByText("Run").closest("button")).not.toBeDisabled();
      expect(screen.getByTitle("Run options")).toBeInTheDocument();
    });

    it("keeps Run enabled for a self-contained node with no edges", async () => {
      // A ComfyUI app whose values are baked in has no inputs to wire, and it
      // runs from Cmd/Ctrl+Enter — the Run button must offer the same.
      mockUseWorkflowStore.mockImplementation((selector) =>
        selector(createDefaultState({ nodes: [{ id: "app", type: "comfyApp", position: { x: 0, y: 0 }, data: {} }], edges: [] })));

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Run")).toBeInTheDocument();
      });

      const runButton = screen.getByText("Run").closest("button");
      expect(runButton).not.toBeDisabled();
      expect(runButton).toHaveAttribute("title", "Run");
      expect(screen.getByTitle("Run options")).toBeInTheDocument();
    });

    it("disables Run when nothing is connected and nothing runs on its own", async () => {
      mockUseWorkflowStore.mockImplementation((selector) =>
        selector(createDefaultState({ nodes: [{ id: "gen", type: "nanoBanana", position: { x: 0, y: 0 }, data: {} }], edges: [] })));

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        const runButton = screen.getByText("Run").closest("button");
        expect(runButton).toBeDisabled();
        expect(runButton).toHaveAttribute("title", "Connect some nodes to run");
      });
    });

    it("should disable Run button when the workflow is empty", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => selector(createDefaultState({ nodes: [], edges: [] })));

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Run")).toBeInTheDocument();
      });

      const runButton = screen.getByText("Run").closest("button");
      expect(runButton).toBeDisabled();
    });

    it("says why in the title when the workflow is empty", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => selector(createDefaultState({ nodes: [], edges: [] })));

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        const runButton = screen.getByText("Run").closest("button");
        expect(runButton).toHaveAttribute("title", "Workflow is empty");
      });
    });
  });

  describe("Run Menu Dropdown", () => {
    it("should show dropdown chevron when workflow is valid and not running", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });
    });

    it("should not show dropdown chevron when the workflow is empty", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => selector(createDefaultState({ nodes: [], edges: [] })));

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.queryByTitle("Run options")).not.toBeInTheDocument();
      });
    });

    it("should not show dropdown chevron when running", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          isRunning: true,
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.queryByTitle("Run options")).not.toBeInTheDocument();
      });
    });

    it("should open run menu when dropdown chevron is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));

      expect(screen.getByText("Run all")).toBeInTheDocument();
      expect(screen.getByText("Run from selected")).toBeInTheDocument();
      expect(screen.getByText("Run selected")).toBeInTheDocument();
    });

    it("runs the whole graph when 'Run all' is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));
      fireEvent.click(screen.getByText("Run all"));

      expect(mockRunBatch).toHaveBeenCalledWith({ kind: "all" });
    });

    it("should disable 'Run from selected' when no node is selected", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));

      const runFromSelectedButton = screen.getByText("Run from selected").closest("button");
      expect(runFromSelectedButton).toBeDisabled();
    });

    it("should enable 'Run from selected' when a single node is selected", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          nodes: [{ id: "node-1", selected: true, type: "prompt" }],
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));

      const runFromSelectedButton = screen.getByText("Run from selected").closest("button");
      expect(runFromSelectedButton).not.toHaveClass("cursor-not-allowed");
    });

    it("runs from the node when 'Run from selected' is clicked", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          nodes: [{ id: "node-1", selected: true, type: "prompt" }],
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));
      fireEvent.click(screen.getByText("Run from selected"));

      expect(mockRunBatch).toHaveBeenCalledWith({ kind: "from", nodeId: "node-1" });
    });

    it("runs the selection when 'Run selected' is clicked", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          nodes: [{ id: "node-1", selected: true, type: "prompt" }],
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));
      fireEvent.click(screen.getByText("Run selected"));

      expect(mockRunBatch).toHaveBeenCalledWith({ kind: "nodes", nodeIds: ["node-1"] });
    });
  });

  describe("Batch runs", () => {
    it("sets the run count from the stepper in the Run menu", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => selector(createDefaultState({ runCount: 3 })));
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );
      fireEvent.click(await screen.findByTitle("Run options"));

      expect(screen.getByRole("group", { name: "Runs" })).toHaveTextContent("3");
      fireEvent.click(screen.getByRole("button", { name: "More runs" }));
      expect(mockSetRunCount).toHaveBeenCalledWith(4);
      fireEvent.click(screen.getByRole("button", { name: "Fewer runs" }));
      expect(mockSetRunCount).toHaveBeenCalledWith(2);
      // Changing the count leaves the menu open
      expect(screen.getByText("Run all")).toBeInTheDocument();
    });

    it("cannot go below one run", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );
      fireEvent.click(await screen.findByTitle("Run options"));
      expect(screen.getByRole("button", { name: "Fewer runs" })).toBeDisabled();
    });

    it("says on the button how many runs a press makes", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => selector(createDefaultState({ runCount: 10 })));
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );
      expect(await screen.findByText("10×")).toBeInTheDocument();
      expect(screen.getByTitle("Run 10 times")).toBeInTheDocument();
    });

    it("shows which run of the batch is going, and that Stop finishes it first", async () => {
      mockUseWorkflowStore.mockImplementation((selector) =>
        selector(createDefaultState({ isRunning: true, runCount: 10, batch: { id: "b", index: 3, count: 10, stopping: false } }))
      );
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );
      expect(await screen.findByText("3 / 10")).toBeInTheDocument();
      expect(screen.getByText("Stop")).toBeInTheDocument();
      expect(screen.getByTitle("Run 3 of 10. Stop finishes this run first")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Stop"));
      expect(mockRequestStop).toHaveBeenCalled();
    });

    it("offers to run the group when the selection is exactly one group", async () => {
      mockUseWorkflowStore.mockImplementation((selector) =>
        selector(createDefaultState({
          nodes: [
            { id: "a", type: "prompt", selected: true, groupId: "g", position: { x: 0, y: 0 }, data: {} },
            { id: "b", type: "nanoBanana", selected: true, groupId: "g", position: { x: 0, y: 0 }, data: {} },
          ],
          groups: { g: { id: "g", name: "Hero shots", color: "blue", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } } },
        }))
      );
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );
      fireEvent.click(await screen.findByTitle("Run options"));
      expect(screen.getByText("Hero shots")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Run group"));
      expect(mockRunBatch).toHaveBeenCalledWith({ kind: "nodes", nodeIds: ["a", "b"] });
    });

    it("keeps 'Run selected' when the selection is only part of a group", async () => {
      mockUseWorkflowStore.mockImplementation((selector) =>
        selector(createDefaultState({
          nodes: [
            { id: "a", type: "prompt", selected: true, groupId: "g", position: { x: 0, y: 0 }, data: {} },
            { id: "b", type: "nanoBanana", groupId: "g", position: { x: 0, y: 0 }, data: {} },
          ],
          groups: { g: { id: "g", name: "Hero shots", color: "blue", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } } },
        }))
      );
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );
      fireEvent.click(await screen.findByTitle("Run options"));
      expect(screen.getByText("Run selected")).toBeInTheDocument();
      expect(screen.queryByText("Run group")).not.toBeInTheDocument();
    });

    it("says Stopping once Stop was pressed mid-batch", async () => {
      mockUseWorkflowStore.mockImplementation((selector) =>
        selector(createDefaultState({ isRunning: true, runCount: 10, batch: { id: "b", index: 3, count: 10, stopping: true } }))
      );
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );
      expect(await screen.findByText("Stopping")).toBeInTheDocument();
      expect(screen.getByTitle("Stopping after run 3. Click again to stop now")).toBeInTheDocument();
    });
  });
});

describe("Hidden connections toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateWorkflow.mockReturnValue({ valid: true, errors: [] });
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ gemini: true }) });
  });

  it("is disabled when there are no connections", async () => {
    mockUseWorkflowStore.mockImplementation((selector) => selector(createDefaultState({ edges: [] })));
    render(
      <TestWrapper>
        <FloatingActionBar />
      </TestWrapper>
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Hide all connections" })).toBeDisabled());
  });

  it("hides every connection when none are hidden", async () => {
    mockUseWorkflowStore.mockImplementation((selector) =>
      selector(createDefaultState({ edges: [{ id: "e1", data: {} }, { id: "e2", data: {} }] }))
    );
    render(
      <TestWrapper>
        <FloatingActionBar />
      </TestWrapper>
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Hide all connections" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Hide all connections" }));
    expect(mockSetAllEdgesHidden).toHaveBeenCalledWith(true);
  });

  it("counts the hidden connections and shows them all", async () => {
    mockUseWorkflowStore.mockImplementation((selector) =>
      selector(createDefaultState({ edges: [{ id: "e1", data: { hidden: true } }, { id: "e2", data: { hidden: true } }, { id: "e3", data: {} }] }))
    );
    render(
      <TestWrapper>
        <FloatingActionBar />
      </TestWrapper>
    );
    const button = await screen.findByRole("button", { name: "Show 2 hidden connections" });
    // The count badge sits beside the button, inside the same group.
    expect(button.parentElement).toHaveTextContent("2");
    fireEvent.click(button);
    expect(mockSetAllEdgesHidden).toHaveBeenCalledWith(false);
  });
});
