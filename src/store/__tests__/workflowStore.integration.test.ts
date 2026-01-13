/**
 * Integration tests for workflowStore
 *
 * Tests the integration functions that handle node connections and data flow:
 * - getConnectedInputs: extracts data from connected nodes
 * - validateWorkflow: checks workflow integrity
 * - topological sort: ensures correct execution order
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { useWorkflowStore } from "../workflowStore";
import type { WorkflowNode, WorkflowEdge } from "@/types";

// Mock the Toast hook
vi.mock("@/components/Toast", () => ({
  useToast: {
    getState: () => ({
      show: vi.fn(),
    }),
  },
}));

// Mock the logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    startSession: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(undefined),
    getCurrentSession: vi.fn().mockReturnValue(null),
  },
}));

// Mock localStorage for provider settings
const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage[key];
  }),
  clear: vi.fn(() => {
    Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]);
  }),
});

// Helper to reset store state between tests
function resetStore() {
  const store = useWorkflowStore.getState();
  store.clearWorkflow();
}

// Helper to create a test node
function createTestNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  position = { x: 0, y: 0 }
): WorkflowNode {
  return {
    id,
    type: type as WorkflowNode["type"],
    position,
    data: data as WorkflowNode["data"],
  };
}

// Helper to create a test edge
function createTestEdge(
  source: string,
  target: string,
  sourceHandle: string | null = null,
  targetHandle: string | null = null,
  hasPause = false
): WorkflowEdge {
  return {
    id: `edge-${source}-${target}-${sourceHandle || "default"}-${targetHandle || "default"}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    data: hasPause ? { hasPause: true } : undefined,
  };
}

describe("workflowStore integration tests", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetStore();
  });

  describe("getConnectedInputs", () => {
    describe("Basic data extraction scenarios", () => {
      it("should extract image from imageInput node", () => {
        const store = useWorkflowStore.getState();
        const testImage = "data:image/png;base64,testImageData";

        // Set up nodes and edges directly
        useWorkflowStore.setState({
          nodes: [
            createTestNode("imageInput-1", "imageInput", { image: testImage }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [createTestEdge("imageInput-1", "nanoBanana-1", "image", "image")],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        expect(result.images).toContain(testImage);
        expect(result.images).toHaveLength(1);
      });

      it("should extract image from annotation node (outputImage)", () => {
        const store = useWorkflowStore.getState();
        const testImage = "data:image/png;base64,annotatedImageData";

        useWorkflowStore.setState({
          nodes: [
            createTestNode("annotation-1", "annotation", { outputImage: testImage }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [createTestEdge("annotation-1", "nanoBanana-1", "image", "image")],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        expect(result.images).toContain(testImage);
        expect(result.images).toHaveLength(1);
      });

      it("should extract image from nanoBanana node (outputImage)", () => {
        const store = useWorkflowStore.getState();
        const testImage = "data:image/png;base64,generatedImageData";

        useWorkflowStore.setState({
          nodes: [
            createTestNode("nanoBanana-1", "nanoBanana", { outputImage: testImage }),
            createTestNode("nanoBanana-2", "nanoBanana", {}),
          ],
          edges: [createTestEdge("nanoBanana-1", "nanoBanana-2", "image", "image")],
        });

        const result = store.getConnectedInputs("nanoBanana-2");

        expect(result.images).toContain(testImage);
        expect(result.images).toHaveLength(1);
      });

      it("should extract text from prompt node", () => {
        const store = useWorkflowStore.getState();
        const testPrompt = "A beautiful sunset over the ocean";

        useWorkflowStore.setState({
          nodes: [
            createTestNode("prompt-1", "prompt", { prompt: testPrompt }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [createTestEdge("prompt-1", "nanoBanana-1", "text", "text")],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        expect(result.text).toBe(testPrompt);
      });

      it("should extract text from llmGenerate node (outputText)", () => {
        const store = useWorkflowStore.getState();
        const testOutput = "Generated text from LLM";

        useWorkflowStore.setState({
          nodes: [
            createTestNode("llmGenerate-1", "llmGenerate", { outputText: testOutput }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [createTestEdge("llmGenerate-1", "nanoBanana-1", "text", "text")],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        expect(result.text).toBe(testOutput);
      });
    });

    describe("Multiple connections", () => {
      it("should collect multiple images from different sources", () => {
        const store = useWorkflowStore.getState();
        const testImage1 = "data:image/png;base64,image1Data";
        const testImage2 = "data:image/png;base64,image2Data";
        const testImage3 = "data:image/png;base64,image3Data";

        useWorkflowStore.setState({
          nodes: [
            createTestNode("imageInput-1", "imageInput", { image: testImage1 }),
            createTestNode("imageInput-2", "imageInput", { image: testImage2 }),
            createTestNode("annotation-1", "annotation", { outputImage: testImage3 }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [
            createTestEdge("imageInput-1", "nanoBanana-1", "image", "image"),
            createTestEdge("imageInput-2", "nanoBanana-1", "image", "image"),
            createTestEdge("annotation-1", "nanoBanana-1", "image", "image"),
          ],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        expect(result.images).toHaveLength(3);
        expect(result.images).toContain(testImage1);
        expect(result.images).toContain(testImage2);
        expect(result.images).toContain(testImage3);
      });

      it("should use last connected text source (not array)", () => {
        const store = useWorkflowStore.getState();
        const prompt1 = "First prompt";
        const prompt2 = "Second prompt";

        useWorkflowStore.setState({
          nodes: [
            createTestNode("prompt-1", "prompt", { prompt: prompt1 }),
            createTestNode("prompt-2", "prompt", { prompt: prompt2 }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [
            createTestEdge("prompt-1", "nanoBanana-1", "text", "text"),
            createTestEdge("prompt-2", "nanoBanana-1", "text", "text"),
          ],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        // Should have text from one of the prompts (last one processed)
        expect(result.text).toBe(prompt2);
      });

      it("should handle mix of image and text connections", () => {
        const store = useWorkflowStore.getState();
        const testImage = "data:image/png;base64,imageData";
        const testPrompt = "Test prompt text";

        useWorkflowStore.setState({
          nodes: [
            createTestNode("imageInput-1", "imageInput", { image: testImage }),
            createTestNode("prompt-1", "prompt", { prompt: testPrompt }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [
            createTestEdge("imageInput-1", "nanoBanana-1", "image", "image"),
            createTestEdge("prompt-1", "nanoBanana-1", "text", "text"),
          ],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        expect(result.images).toContain(testImage);
        expect(result.images).toHaveLength(1);
        expect(result.text).toBe(testPrompt);
      });
    });

    describe("Dynamic input mapping", () => {
      it("should map handle IDs to schema names when inputSchema is present", () => {
        const store = useWorkflowStore.getState();
        const testImage = "data:image/png;base64,imageData";

        useWorkflowStore.setState({
          nodes: [
            createTestNode("imageInput-1", "imageInput", { image: testImage }),
            createTestNode("generateVideo-1", "generateVideo", {
              inputSchema: [
                { name: "image_url", type: "image", required: true, label: "Image" },
              ],
            }),
          ],
          edges: [createTestEdge("imageInput-1", "generateVideo-1", "image", "image")],
        });

        const result = store.getConnectedInputs("generateVideo-1");

        expect(result.dynamicInputs).toHaveProperty("image_url");
        expect(result.dynamicInputs.image_url).toBe(testImage);
      });

      it("should map multiple image handles to schema names", () => {
        const store = useWorkflowStore.getState();
        const testImage1 = "data:image/png;base64,firstFrame";
        const testImage2 = "data:image/png;base64,lastFrame";

        useWorkflowStore.setState({
          nodes: [
            createTestNode("imageInput-1", "imageInput", { image: testImage1 }),
            createTestNode("imageInput-2", "imageInput", { image: testImage2 }),
            createTestNode("generateVideo-1", "generateVideo", {
              inputSchema: [
                { name: "first_frame", type: "image", required: true, label: "First Frame" },
                { name: "last_frame", type: "image", required: false, label: "Last Frame" },
              ],
            }),
          ],
          edges: [
            createTestEdge("imageInput-1", "generateVideo-1", "image", "image-0"),
            createTestEdge("imageInput-2", "generateVideo-1", "image", "image-1"),
          ],
        });

        const result = store.getConnectedInputs("generateVideo-1");

        expect(result.dynamicInputs).toHaveProperty("first_frame", testImage1);
        expect(result.dynamicInputs).toHaveProperty("last_frame", testImage2);
      });

      it("should map multiple text handles to schema names", () => {
        const store = useWorkflowStore.getState();
        const prompt = "Create a video";
        const negativePrompt = "No blur";

        useWorkflowStore.setState({
          nodes: [
            createTestNode("prompt-1", "prompt", { prompt }),
            createTestNode("prompt-2", "prompt", { prompt: negativePrompt }),
            createTestNode("generateVideo-1", "generateVideo", {
              inputSchema: [
                { name: "prompt", type: "text", required: true, label: "Prompt" },
                { name: "negative_prompt", type: "text", required: false, label: "Negative Prompt" },
              ],
            }),
          ],
          edges: [
            createTestEdge("prompt-1", "generateVideo-1", "text", "text-0"),
            createTestEdge("prompt-2", "generateVideo-1", "text", "text-1"),
          ],
        });

        const result = store.getConnectedInputs("generateVideo-1");

        expect(result.dynamicInputs).toHaveProperty("prompt", prompt);
        expect(result.dynamicInputs).toHaveProperty("negative_prompt", negativePrompt);
      });

      it("should not populate dynamicInputs when no inputSchema present", () => {
        const store = useWorkflowStore.getState();
        const testImage = "data:image/png;base64,imageData";

        useWorkflowStore.setState({
          nodes: [
            createTestNode("imageInput-1", "imageInput", { image: testImage }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [createTestEdge("imageInput-1", "nanoBanana-1", "image", "image")],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        expect(Object.keys(result.dynamicInputs)).toHaveLength(0);
        // But images array should still be populated
        expect(result.images).toContain(testImage);
      });
    });

    describe("Edge cases", () => {
      it("should return empty images array and null text when no connections", () => {
        const store = useWorkflowStore.getState();

        useWorkflowStore.setState({
          nodes: [createTestNode("nanoBanana-1", "nanoBanana", {})],
          edges: [],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        expect(result.images).toEqual([]);
        expect(result.text).toBeNull();
        expect(result.dynamicInputs).toEqual({});
      });

      it("should handle source node with null output data", () => {
        const store = useWorkflowStore.getState();

        useWorkflowStore.setState({
          nodes: [
            createTestNode("imageInput-1", "imageInput", { image: null }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [createTestEdge("imageInput-1", "nanoBanana-1", "image", "image")],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        expect(result.images).toEqual([]);
      });

      it("should handle connection to non-existent source node", () => {
        const store = useWorkflowStore.getState();

        useWorkflowStore.setState({
          nodes: [createTestNode("nanoBanana-1", "nanoBanana", {})],
          edges: [createTestEdge("nonexistent-1", "nanoBanana-1", "image", "image")],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        expect(result.images).toEqual([]);
        expect(result.text).toBeNull();
      });

      it("should treat empty string as no value (falsy check in getSourceOutput)", () => {
        const store = useWorkflowStore.getState();

        useWorkflowStore.setState({
          nodes: [
            createTestNode("prompt-1", "prompt", { prompt: "" }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [createTestEdge("prompt-1", "nanoBanana-1", "text", "text")],
        });

        const result = store.getConnectedInputs("nanoBanana-1");

        // Empty string is treated as falsy/no value by getSourceOutput
        expect(result.text).toBeNull();
      });
    });
  });

  describe("validateWorkflow", () => {
    describe("Empty workflow", () => {
      it("should return invalid with 'Workflow is empty' error", () => {
        useWorkflowStore.setState({
          nodes: [],
          edges: [],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Workflow is empty");
      });
    });

    describe("nanoBanana node validation", () => {
      it("should return error when nanoBanana node missing text input", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Generate node "nanoBanana-1" missing text input');
      });

      it("should return valid when text input is connected", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("prompt-1", "prompt", { prompt: "test" }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [createTestEdge("prompt-1", "nanoBanana-1", "text", "text")],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should not require image input (optional)", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("prompt-1", "prompt", { prompt: "test" }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
          ],
          edges: [createTestEdge("prompt-1", "nanoBanana-1", "text", "text")],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        // Should be valid without image input
        expect(result.valid).toBe(true);
      });

      it("should validate multiple nanoBanana nodes independently", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("prompt-1", "prompt", { prompt: "test" }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
            createTestNode("nanoBanana-2", "nanoBanana", {}), // No text input
          ],
          edges: [createTestEdge("prompt-1", "nanoBanana-1", "text", "text")],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Generate node "nanoBanana-2" missing text input');
        expect(result.errors).not.toContain('Generate node "nanoBanana-1" missing text input');
      });
    });

    describe("annotation node validation", () => {
      it("should return error when no image connected and no sourceImage", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("annotation-1", "annotation", { sourceImage: null }),
          ],
          edges: [],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Annotation node "annotation-1" missing image input');
      });

      it("should return valid when image is connected", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("imageInput-1", "imageInput", { image: "data:image/png;base64,test" }),
            createTestNode("annotation-1", "annotation", { sourceImage: null }),
          ],
          edges: [createTestEdge("imageInput-1", "annotation-1", "image", "image")],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(true);
      });

      it("should return valid when sourceImage is present (manual load)", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("annotation-1", "annotation", {
              sourceImage: "data:image/png;base64,manuallyLoadedImage",
            }),
          ],
          edges: [],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(true);
      });
    });

    describe("output node validation", () => {
      it("should return error when output node has no image input", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("output-1", "output", {}),
          ],
          edges: [],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Output node "output-1" missing image input');
      });

      it("should return valid when output node has image connected", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("imageInput-1", "imageInput", { image: "data:image/png;base64,test" }),
            createTestNode("output-1", "output", {}),
          ],
          edges: [createTestEdge("imageInput-1", "output-1", "image", "image")],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(true);
      });
    });

    describe("Valid workflow scenarios", () => {
      it("should validate simple prompt -> nanoBanana -> output chain", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("prompt-1", "prompt", { prompt: "test prompt" }),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
            createTestNode("output-1", "output", {}),
          ],
          edges: [
            createTestEdge("prompt-1", "nanoBanana-1", "text", "text"),
            createTestEdge("nanoBanana-1", "output-1", "image", "image"),
          ],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should validate complex workflow with multiple node types", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("imageInput-1", "imageInput", { image: "data:image/png;base64,test" }),
            createTestNode("prompt-1", "prompt", { prompt: "describe this" }),
            createTestNode("llmGenerate-1", "llmGenerate", {}),
            createTestNode("nanoBanana-1", "nanoBanana", {}),
            createTestNode("annotation-1", "annotation", { sourceImage: null }),
            createTestNode("output-1", "output", {}),
          ],
          edges: [
            createTestEdge("imageInput-1", "llmGenerate-1", "image", "image"),
            createTestEdge("prompt-1", "llmGenerate-1", "text", "text"),
            createTestEdge("llmGenerate-1", "nanoBanana-1", "text", "text"),
            createTestEdge("nanoBanana-1", "annotation-1", "image", "image"),
            createTestEdge("annotation-1", "output-1", "image", "image"),
          ],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should validate workflow with groups (groups don't affect validation)", () => {
        useWorkflowStore.setState({
          nodes: [
            { ...createTestNode("prompt-1", "prompt", { prompt: "test" }), groupId: "group-1" },
            { ...createTestNode("nanoBanana-1", "nanoBanana", {}), groupId: "group-1" },
          ],
          edges: [createTestEdge("prompt-1", "nanoBanana-1", "text", "text")],
          groups: {
            "group-1": {
              id: "group-1",
              name: "Test Group",
              color: "neutral",
              position: { x: 0, y: 0 },
              size: { width: 400, height: 400 },
            },
          },
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(true);
      });

      it("should allow nodes that don't require validation (imageInput, prompt)", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("imageInput-1", "imageInput", { image: null }),
            createTestNode("prompt-1", "prompt", { prompt: "" }),
          ],
          edges: [],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        // These nodes don't have validation rules, so workflow is valid
        expect(result.valid).toBe(true);
      });
    });

    describe("Multiple validation errors", () => {
      it("should report all validation errors, not just the first", () => {
        useWorkflowStore.setState({
          nodes: [
            createTestNode("nanoBanana-1", "nanoBanana", {}),
            createTestNode("nanoBanana-2", "nanoBanana", {}),
            createTestNode("annotation-1", "annotation", { sourceImage: null }),
            createTestNode("output-1", "output", {}),
          ],
          edges: [],
        });

        const store = useWorkflowStore.getState();
        const result = store.validateWorkflow();

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(4);
        expect(result.errors).toContain('Generate node "nanoBanana-1" missing text input');
        expect(result.errors).toContain('Generate node "nanoBanana-2" missing text input');
        expect(result.errors).toContain('Annotation node "annotation-1" missing image input');
        expect(result.errors).toContain('Output node "output-1" missing image input');
      });
    });
  });
});
