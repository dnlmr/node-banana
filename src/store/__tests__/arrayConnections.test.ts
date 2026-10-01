/**
 * Connections from an Array node record which item they carry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { useWorkflowStore } from "../workflowStore";

vi.mock("@/components/Toast", () => ({
  useToast: { getState: () => ({ show: vi.fn() }) },
}));

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

const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage[key];
  }),
  clear: vi.fn(),
});

function connectToNewLlm(arrayId: string, x: number): void {
  const store = useWorkflowStore.getState();
  const target = store.addNode("llmGenerate", { x, y: 0 });
  act(() => {
    useWorkflowStore.getState().onConnect({ source: arrayId, sourceHandle: "text", target, targetHandle: "text" });
  });
}

function itemIndices(arrayId: string): unknown[] {
  return useWorkflowStore
    .getState()
    .edges.filter((e) => e.source === arrayId)
    .map((e) => e.data?.arrayItemIndex);
}

describe("Array connections", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWorkflowStore.getState().clearWorkflow();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands out items in order and wraps", () => {
    const arrayId = useWorkflowStore.getState().addNode("array", { x: 0, y: 0 }, { outputItems: ["a", "b", "c"] });
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(1);
      connectToNewLlm(arrayId, 400 + i * 10);
    }
    expect(itemIndices(arrayId)).toEqual([0, 1, 2, 0]);
  });

  it("gives the pinned item to the next connection", () => {
    const arrayId = useWorkflowStore
      .getState()
      .addNode("array", { x: 0, y: 0 }, { outputItems: ["a", "b", "c"], selectedOutputIndex: 2 });
    connectToNewLlm(arrayId, 400);
    expect(itemIndices(arrayId)).toEqual([2]);
  });
});
