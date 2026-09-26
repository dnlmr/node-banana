import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useGenerationCarousel } from "../useGenerationCarousel";
import { useWorkflowStore } from "@/store/workflowStore";

const initial = useWorkflowStore.getState();

describe("useGenerationCarousel", () => {
  const updateNodeData = vi.fn();
  const history = [
    { id: "newest", assetId: "a0000000000002" },
    { id: "older", assetId: "a0000000000001" },
    { id: "legacy" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkflowStore.setState({ ...initial, updateNodeData });
  });

  it("hands the loader the whole entry, so it can use the asset id", async () => {
    const loadFn = vi.fn().mockResolvedValue("data:image/png;base64,older");
    const buildUpdate = (media: string, index: number) => ({ outputImage: media, selectedHistoryIndex: index });
    const { result } = renderHook(() =>
      useGenerationCarousel({ nodeId: "gen-1", history, currentIndex: 0, loadFn, buildUpdate })
    );

    await act(() => result.current.handleNext());

    expect(loadFn).toHaveBeenCalledWith({ id: "older", assetId: "a0000000000001" });
    expect(updateNodeData).toHaveBeenCalledWith("gen-1", { outputImage: "data:image/png;base64,older", selectedHistoryIndex: 1 });
  });

  it("wraps to the oldest entry, and leaves the node alone when nothing loads", async () => {
    const loadFn = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() =>
      useGenerationCarousel({ nodeId: "gen-1", history, currentIndex: 0, loadFn, buildUpdate: () => ({}) })
    );

    await act(() => result.current.handlePrevious());

    expect(loadFn).toHaveBeenCalledWith({ id: "legacy" });
    expect(updateNodeData).not.toHaveBeenCalled();
  });
});
