import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLoadGenerationById } from "../useLoadGenerationById";
import { useWorkflowStore } from "@/store/workflowStore";

const mockShow = vi.fn();
vi.mock("@/components/Toast", () => ({
  useToast: { getState: () => ({ show: mockShow }) },
}));

const mockFetchAssetBlob = vi.fn();
vi.mock("@/lib/assets/client/api", () => ({
  fetchAssetBlob: (...args: unknown[]) => mockFetchAssetBlob(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("useLoadGenerationById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ json: async () => ({ success: true, image: "data:image/png;base64,ok" }) });
  });

  it("loads from the configured generations folder", async () => {
    useWorkflowStore.setState({ generationsPath: "/proj/generations", saveDirectoryPath: "/proj" });
    const { result } = renderHook(() => useLoadGenerationById("image", "Image"));

    await expect(result.current({ id: "abc" })).resolves.toBe("data:image/png;base64,ok");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ directoryPath: "/proj/generations", imageId: "abc" });
    expect(mockFetchAssetBlob).not.toHaveBeenCalled();
  });

  it("looks beside the workflow when only its folder is known", async () => {
    useWorkflowStore.setState({ generationsPath: null, saveDirectoryPath: "/proj" });
    const { result } = renderHook(() => useLoadGenerationById("video", "Video"));

    await result.current({ id: "clip" });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).directoryPath).toBe("/proj/generations");
    expect(mockShow).not.toHaveBeenCalled();
  });

  it("tells the user once when there is no folder to look in", async () => {
    useWorkflowStore.setState({ generationsPath: null, saveDirectoryPath: null });
    const { result } = renderHook(() => useLoadGenerationById("image", "Image"));

    await expect(result.current({ id: "a" })).resolves.toBeNull();
    await expect(result.current({ id: "b" })).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockShow).toHaveBeenCalledWith("Set a project folder to browse image history", "warning");
  });

  describe("an entry recorded in the asset library", () => {
    it("loads from the library as a data URL, with no folder needed", async () => {
      useWorkflowStore.setState({ generationsPath: null, saveDirectoryPath: null });
      mockFetchAssetBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
      const { result } = renderHook(() => useLoadGenerationById("image", "Image"));

      await expect(result.current({ id: "1700000000000", assetId: "a0000000000001" })).resolves.toBe("data:image/png;base64,cG5n");
      expect(mockFetchAssetBlob).toHaveBeenCalledWith("a0000000000001");
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockShow).not.toHaveBeenCalled();
    });

    it("falls back to the project folder when the library cannot serve it", async () => {
      useWorkflowStore.setState({ generationsPath: "/proj/generations", saveDirectoryPath: "/proj" });
      mockFetchAssetBlob.mockRejectedValue(new Error("not found"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = renderHook(() => useLoadGenerationById("image", "Image"));

      await expect(result.current({ id: "fox_abc", assetId: "a0000000000001" })).resolves.toBe("data:image/png;base64,ok");
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ directoryPath: "/proj/generations", imageId: "fox_abc" });
      warn.mockRestore();
    });

    it("gives up quietly when neither the library nor a folder has it", async () => {
      useWorkflowStore.setState({ generationsPath: null, saveDirectoryPath: null });
      mockFetchAssetBlob.mockRejectedValue(new Error("library unavailable"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = renderHook(() => useLoadGenerationById("image", "Image"));

      await expect(result.current({ id: "x", assetId: "a0000000000001" })).resolves.toBeNull();
      expect(mockShow).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
