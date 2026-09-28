import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ModelSearchDialog } from "@/components/modals/ModelSearchDialog";
import { ProviderSettings } from "@/types";
import { ProviderModel } from "@/lib/providers/types";

// Mock deduplicatedFetch to pass through to global fetch (avoids caching issues in tests)
vi.mock("@/utils/deduplicatedFetch", () => ({
  deduplicatedFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  clearFetchCache: vi.fn(),
}));

// Mock the workflow store
const mockAddNode = vi.fn();
const mockIncrementModalCount = vi.fn();
const mockDecrementModalCount = vi.fn();
const mockTrackModelUsage = vi.fn();
const mockUseWorkflowStore = vi.fn();
// Mutable so a test can hand the dialog a Comfy Router key; reset in beforeEach.
const providerApiKeys = {
  replicateApiKey: "test-replicate-key" as string | null,
  falApiKey: "test-fal-key" as string | null,
  kieApiKey: null as string | null,
  wavespeedApiKey: null as string | null,
  openaiApiKey: null as string | null,
  comfyApiKey: null as string | null,
  comfyEnabled: true,
  replicateEnabled: true,
  kieEnabled: false,
};

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector?: (state: unknown) => unknown) => {
    if (selector) {
      return mockUseWorkflowStore(selector);
    }
    return mockUseWorkflowStore((s: unknown) => s);
  },
  useProviderApiKeys: () => ({ ...providerApiKeys }),
}));

// Mock useReactFlow
const mockScreenToFlowPosition = vi.fn((pos) => pos);

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({
      screenToFlowPosition: mockScreenToFlowPosition,
    }),
  };
});

// Mock createPortal for dialog
vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom");
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock fetch
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
    replicate: { id: "replicate", name: "Replicate", enabled: true, apiKey: "test-replicate-key" },
    fal: { id: "fal", name: "fal.ai", enabled: true, apiKey: "test-fal-key" },
    kie: { id: "kie", name: "Kie.ai", enabled: false, apiKey: null },
    wavespeed: { id: "wavespeed", name: "WaveSpeed", enabled: false, apiKey: null },
    comfy: { id: "comfy", name: "ComfyUI", enabled: false, apiKey: null },
  },
};

// Sample models for testing
const sampleModels: ProviderModel[] = [
  {
    id: "flux/dev",
    name: "FLUX.1 Dev",
    description: "High quality image generation model",
    provider: "fal",
    capabilities: ["text-to-image", "image-to-image"],
    coverImage: "https://example.com/flux.jpg",
  },
  {
    id: "stability-ai/sdxl",
    name: "SDXL",
    description: "Stable Diffusion XL",
    provider: "replicate",
    capabilities: ["text-to-image"],
    coverImage: "https://example.com/sdxl.jpg",
  },
  {
    id: "kling-video/v1.6/pro",
    name: "Kling Video Pro",
    description: "AI video generation",
    provider: "fal",
    capabilities: ["text-to-video", "image-to-video"],
    coverImage: "https://example.com/kling.jpg",
  },
  {
    id: "fal-ai/triposr",
    name: "TripoSR",
    description: "3D model generation from images",
    provider: "fal",
    capabilities: ["image-to-3d"],
    coverImage: "https://example.com/triposr.jpg",
  },
];

describe("ModelSearchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    providerApiKeys.comfyApiKey = null;

    // Default mock fetch response
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, models: sampleModels }),
    });

    // Default store mock
    mockUseWorkflowStore.mockImplementation((selector) => {
      const state = {
        providerSettings: defaultProviderSettings,
        addNode: mockAddNode,
        incrementModalCount: mockIncrementModalCount,
        decrementModalCount: mockDecrementModalCount,
        recentModels: [],
        trackModelUsage: mockTrackModelUsage,
      };
      return selector(state);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refreshes older OpenAI catalogue caches without waiting for their TTL", async () => {
    localStorage.setItem("node-banana-models-cache", JSON.stringify({
      rf: { models: [], availableProviders: ["openai"], timestamp: Date.now() },
    }));
    const { OPENAI_IMAGE_25_MODELS } = await import("@/lib/providers/openaiImages");
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, models: OPENAI_IMAGE_25_MODELS, availableProviders: ["openai"] }) });
    render(<TestWrapper><ModelSearchDialog isOpen onClose={vi.fn()} /></TestWrapper>);
    expect(await screen.findByText("GPT Image 2.5 Sunburst")).toBeInTheDocument();
    expect(screen.getByText("GPT Image 2.5 Flare")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalled();
  });

  it("refreshes older Gemini catalogues so Omni appears immediately", async () => {
    localStorage.setItem("node-banana-models-cache", JSON.stringify({
      rf: { models: [], availableProviders: ["gemini"], timestamp: Date.now(), openaiCatalogueVersion: 1 },
    }));
    const { GEMINI_OMNI_MODELS } = await import("@/lib/providers/geminiOmni");
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, models: GEMINI_OMNI_MODELS, availableProviders: ["gemini"] }) });
    render(<TestWrapper><ModelSearchDialog isOpen onClose={vi.fn()} /></TestWrapper>);
    expect(await screen.findByText("Gemini Omni 1.1 Flash")).toBeInTheDocument();
    expect(screen.getByText("Gemini Omni Flash Preview")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalled();
  });

  describe("Visibility", () => {
    it("should not render when isOpen is false", () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={false} onClose={vi.fn()} />
        </TestWrapper>
      );

      expect(screen.queryByText("Browse models")).not.toBeInTheDocument();
    });

    it("should render with title when isOpen is true", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      expect(screen.getByText("Browse models")).toBeInTheDocument();
    });

    it("should register and unregister modal count", async () => {
      const { unmount } = render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      expect(mockIncrementModalCount).toHaveBeenCalled();

      unmount();

      expect(mockDecrementModalCount).toHaveBeenCalled();
    });
  });

  describe("Search Functionality", () => {
    it("should render search input", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      const searchInput = screen.getByPlaceholderText("Search models...");
      expect(searchInput).toBeInTheDocument();
    });

    it("searches the loaded list locally, without another request", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );
      await waitFor(() => expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument());
      mockFetch.mockClear();

      fireEvent.change(screen.getByPlaceholderText("Search models..."), { target: { value: "kling" } });

      await waitFor(() => expect(screen.queryByText("FLUX.1 Dev")).not.toBeInTheDocument());
      expect(screen.getByText("Kling Video Pro")).toBeInTheDocument();
      expect(screen.getByText(/^1 model$/)).toBeInTheDocument();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("offers the providers' own search and merges what it finds", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );
      await waitFor(() => expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument());
      // Nothing to offer without a query
      expect(screen.queryByTestId("deep-search")).not.toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText("Search models..."), { target: { value: "topaz" } });
      await waitFor(() => expect(screen.getByText("No models found")).toBeInTheDocument());
      const row = screen.getByTestId("deep-search");
      expect(row).toHaveTextContent("Replicate and fal.ai may have more");

      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, models: [{ id: "topazlabs/video-upscale", name: "Topaz Video Upscale", description: "Upscale", provider: "replicate", capabilities: ["image-to-video"] }] }),
      });
      fireEvent.click(within(row).getByRole("button", { name: /Search Replicate and fal.ai/ }));
      await waitFor(() => expect(screen.getByText("Topaz Video Upscale")).toBeInTheDocument());
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("search=topaz");
      expect(url).toContain("deep=true");

      // A new query starts over
      fireEvent.change(screen.getByPlaceholderText("Search models..."), { target: { value: "flux" } });
      await waitFor(() => expect(screen.queryByText("Topaz Video Upscale")).not.toBeInTheDocument());
      expect(screen.getByTestId("deep-search")).toHaveTextContent("may have more");
    });

    it("should focus search input when dialog opens", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      const searchInput = screen.getByPlaceholderText("Search models...");
      await waitFor(() => {
        expect(document.activeElement).toBe(searchInput);
      });
    });
  });

  describe("Provider Filter", () => {
    it("should render provider filter buttons", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      // Provider filter is now buttons - check for "All" button with title "All Providers"
      const allButton = screen.getByTitle("All Providers");
      expect(allButton).toBeInTheDocument();
      expect(allButton).toHaveTextContent("All");
    });

    it("should filter by provider when button is clicked, locally", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );
      await waitFor(() => expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument());
      mockFetch.mockClear();

      fireEvent.click(screen.getByTitle("Replicate"));

      expect(screen.getByText("SDXL")).toBeInTheDocument();
      expect(screen.queryByText("FLUX.1 Dev")).not.toBeInTheDocument();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should not show the ComfyUI filter without a Comfy Router key", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await vi.advanceTimersByTimeAsync(100);
      expect(screen.queryByTitle("ComfyUI")).not.toBeInTheDocument();
    });

    it("should show the ComfyUI filter when a Comfy Router key is set and send its header", async () => {
      providerApiKeys.comfyApiKey = "comfyui-test-key";

      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await waitFor(() => expect(mockFetch).toHaveBeenCalled());
      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(options.headers).toMatchObject({ "X-Comfy-Router-Key": "comfyui-test-key" });
      await waitFor(() => expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument());

      fireEvent.click(screen.getByTitle("ComfyUI"));
      // None of the sample models are Comfy Router models
      expect(screen.getByText("No models found")).toBeInTheDocument();
    });

    it("should use initialProvider when provided", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} initialProvider="fal" />
        </TestWrapper>
      );

      await waitFor(() => expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument());
      expect(screen.queryByText("SDXL")).not.toBeInTheDocument();
      // One request for the whole list; the provider is a local filter
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe("/api/models");
    });
  });

  describe("Capability Filter", () => {
    it("should render the type rail with All selected", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      const typeRail = screen.getByText("Type").nextElementSibling as HTMLElement;
      const allType = within(typeRail).getByRole("button", { name: "All" });
      expect(allType).toHaveAttribute("aria-pressed", "true");
    });

    it("should filter by image capabilities when selected", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );
      await waitFor(() => expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "Image" }));
      expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument();
      expect(screen.getByText("SDXL")).toBeInTheDocument();
      expect(screen.queryByText("Kling Video Pro")).not.toBeInTheDocument();
      expect(screen.queryByText("TripoSR")).not.toBeInTheDocument();
    });

    it("should filter by video capabilities when selected", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );
      await waitFor(() => expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "Video" }));
      expect(screen.getByText("Kling Video Pro")).toBeInTheDocument();
      expect(screen.queryByText("FLUX.1 Dev")).not.toBeInTheDocument();
    });

    it("should use initialCapabilityFilter when provided", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} initialCapabilityFilter="video" />
        </TestWrapper>
      );

      await waitFor(() => expect(screen.getByText("Kling Video Pro")).toBeInTheDocument());
      expect(screen.queryByText("FLUX.1 Dev")).not.toBeInTheDocument();
      expect(screen.getByText(/^1 model$/)).toBeInTheDocument();
    });
  });

  describe("Provider status", () => {
    it("says which provider failed, and why, above the list", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          models: sampleModels,
          providers: {
            fal: { success: true, count: 3, cached: true, fetchedAt: Date.now(), stale: false, refreshing: false },
            wavespeed: { success: false, count: 0, error: "WaveSpeed API error: 401" },
          },
        }),
      });
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );
      await waitFor(() => expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument());
      const notices = screen.getByTestId("provider-notices");
      expect(notices).toHaveTextContent("WaveSpeed is unavailable: WaveSpeed API error: 401");
      expect(notices).toHaveTextContent("The key was rejected. Check it in Settings.");
      expect(within(notices).getByRole("button", { name: "Retry" })).toBeInTheDocument();
      // Only the failing one; and not on another provider's tab
      expect(notices).not.toHaveTextContent("fal.ai");
      fireEvent.click(screen.getByTitle("Replicate"));
      expect(screen.queryByTestId("provider-notices")).not.toBeInTheDocument();
    });

    it("can be dismissed, and stays dismissed for that error until a refresh is asked for", async () => {
      const respond = (error: string) => ({
        ok: true,
        json: () => Promise.resolve({ success: true, models: sampleModels, providers: { wavespeed: { success: false, count: 0, error } } }),
      });
      mockFetch.mockResolvedValue(respond("WaveSpeed API error: 401"));
      const { unmount } = render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );
      await waitFor(() => expect(screen.getByTestId("provider-notices")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Dismiss WaveSpeed notice" }));
      expect(screen.queryByTestId("provider-notices")).not.toBeInTheDocument();
      expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument();
      unmount();

      // Next open: the same error stays quiet
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );
      await waitFor(() => expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument());
      expect(screen.queryByTestId("provider-notices")).not.toBeInTheDocument();

      // A different error is news again
      mockFetch.mockResolvedValue(respond("timed out after 20s"));
      fireEvent.click(screen.getByText("Refresh catalog"));
      await waitFor(() => expect(screen.getByTestId("provider-notices")).toHaveTextContent("timed out after 20s"));
      // And a refresh brings back a dismissed one too
      fireEvent.click(screen.getByRole("button", { name: "Dismiss WaveSpeed notice" }));
      expect(screen.queryByTestId("provider-notices")).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Refresh catalog"));
      await waitFor(() => expect(screen.getByTestId("provider-notices")).toBeInTheDocument());
    });

    it("keeps a provider's previous list when its refresh failed, and says so", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          models: sampleModels,
          providers: { replicate: { success: true, count: 1, cached: true, fetchedAt: Date.now() - 3 * 3600_000, stale: true, refreshing: false, error: "timed out after 20s" } },
        }),
      });
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );
      await waitFor(() => expect(screen.getByText("SDXL")).toBeInTheDocument());
      const notices = screen.getByTestId("provider-notices");
      expect(notices).toHaveTextContent("Replicate could not be refreshed: timed out after 20s");
      expect(notices).toHaveTextContent("Showing the list from 3h ago.");
    });

    it("asks again while a provider refreshes behind the answer, then takes the new list", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, models: sampleModels.slice(0, 2), providers: { replicate: { success: true, count: 1, cached: true, fetchedAt: 1, stale: true, refreshing: true } } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, models: sampleModels, providers: { replicate: { success: true, count: 1, cached: true, fetchedAt: Date.now(), stale: false, refreshing: false } } }),
        });
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );
      await waitFor(() => expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument());
      expect(screen.getByText(/2 models · updating Replicate…/)).toBeInTheDocument();
      expect(screen.queryByText("Kling Video Pro")).not.toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(3100);
      await waitFor(() => expect(screen.getByText("Kling Video Pro")).toBeInTheDocument());
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe("/api/models");
      expect(screen.getByText(/^4 models$/)).toBeInTheDocument();
    });
  });

  describe("Model Card Rendering", () => {
    it("should render model cards with name and description", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument();
        expect(screen.getByText("High quality image generation model")).toBeInTheDocument();
        expect(screen.getByText("SDXL")).toBeInTheDocument();
        expect(screen.getByText("Stable Diffusion XL")).toBeInTheDocument();
      });
    });

    it("should render provider badges on model cards", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await waitFor(() => {
        const card = (name: string) => screen.getByText(name).closest("button") as HTMLElement;
        expect(within(card("FLUX.1 Dev")).getByText("fal.ai")).toBeInTheDocument();
        expect(within(card("Kling Video Pro")).getByText("fal.ai")).toBeInTheDocument();
        expect(within(card("SDXL")).getByText("Replicate")).toBeInTheDocument();
      });
    });

    it("should render capability badges on model cards", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await waitFor(() => {
        // Check for capability badges (using short form labels)
        const txtImgBadges = screen.getAllByText("txt\u2192img");
        const imgImgBadges = screen.getAllByText("img\u2192img");
        const txtVidBadges = screen.getAllByText("txt\u2192vid");
        const imgVidBadges = screen.getAllByText("img\u2192vid");

        expect(txtImgBadges.length).toBeGreaterThanOrEqual(2); // FLUX and SDXL
        expect(imgImgBadges.length).toBeGreaterThanOrEqual(1); // FLUX
        expect(txtVidBadges.length).toBeGreaterThanOrEqual(1); // Kling Video
        expect(imgVidBadges.length).toBeGreaterThanOrEqual(1); // Kling Video
      });
    });

    it("should render the model count", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText(/^4 models$/)).toBeInTheDocument();
      });
    });
  });

  describe("Model Selection", () => {
    it("should call onModelSelected when a model card is clicked (callback mode)", async () => {
      const onModelSelected = vi.fn();
      const onClose = vi.fn();

      render(
        <TestWrapper>
          <ModelSearchDialog
            isOpen={true}
            onClose={onClose}
            onModelSelected={onModelSelected}
          />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument();
      });

      // Click on the FLUX.1 Dev model card
      const modelCard = screen.getByText("FLUX.1 Dev").closest("button");
      fireEvent.click(modelCard!);

      expect(onModelSelected).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "flux/dev",
          name: "FLUX.1 Dev",
          provider: "fal",
        })
      );
      expect(onClose).toHaveBeenCalled();
    });

    it("should call addNode when a model card is clicked (create node mode)", async () => {
      const onClose = vi.fn();

      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={onClose} />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("SDXL")).toBeInTheDocument();
      });

      // Click on the SDXL model card
      const modelCard = screen.getByText("SDXL").closest("button");
      fireEvent.click(modelCard!);

      expect(mockAddNode).toHaveBeenCalledWith(
        "nanoBanana",
        expect.any(Object),
        expect.objectContaining({
          selectedModel: {
            provider: "replicate",
            modelId: "stability-ai/sdxl",
            displayName: "SDXL",
            capabilities: ["text-to-image"],
          },
        })
      );
      expect(onClose).toHaveBeenCalled();
    });

    it("should create generateVideo node for video models", async () => {
      const onClose = vi.fn();

      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={onClose} />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Kling Video Pro")).toBeInTheDocument();
      });

      // Click on the Kling Video model card
      const modelCard = screen.getByText("Kling Video Pro").closest("button");
      fireEvent.click(modelCard!);

      expect(mockAddNode).toHaveBeenCalledWith(
        "generateVideo",
        expect.any(Object),
        expect.objectContaining({
          selectedModel: {
            provider: "fal",
            modelId: "kling-video/v1.6/pro",
            displayName: "Kling Video Pro",
            capabilities: ["text-to-video", "image-to-video"],
          },
        })
      );
    });

    it("should create generate3d node for 3D models", async () => {
      const onClose = vi.fn();

      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={onClose} />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("TripoSR")).toBeInTheDocument();
      });

      // Click on the TripoSR 3D model card
      const modelCard = screen.getByText("TripoSR").closest("button");
      fireEvent.click(modelCard!);

      expect(mockAddNode).toHaveBeenCalledWith(
        "generate3d",
        expect.any(Object),
        expect.objectContaining({
          selectedModel: {
            provider: "fal",
            modelId: "fal-ai/triposr",
            displayName: "TripoSR",
            capabilities: ["image-to-3d"],
          },
        })
      );
    });
  });

  describe("Close Behavior", () => {
    it("should call onClose when close button is clicked", async () => {
      const onClose = vi.fn();

      const { container } = render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={onClose} />
        </TestWrapper>
      );

      // Find close button in the header (first button after title)
      fireEvent.click(screen.getByLabelText("Close"));

      expect(onClose).toHaveBeenCalled();
    });

    it("should call onClose when Escape key is pressed", async () => {
      const onClose = vi.fn();

      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={onClose} />
        </TestWrapper>
      );

      fireEvent.keyDown(window, { key: "Escape" });

      expect(onClose).toHaveBeenCalled();
    });

    it("should call onClose when backdrop is clicked", async () => {
      const onClose = vi.fn();

      const { container } = render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={onClose} />
        </TestWrapper>
      );

      // Click on the backdrop (the dialog's overlay, in a body portal)
      fireEvent.click(document.querySelector("[data-dialog-overlay]")!);

      expect(onClose).toHaveBeenCalled();
    });

    it("should not close when clicking inside the dialog", async () => {
      const onClose = vi.fn();

      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={onClose} />
        </TestWrapper>
      );

      // Click on the dialog title (inside the dialog)
      fireEvent.click(screen.getByText("Browse models"));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("Loading State", () => {
    it("should show loading spinner while fetching models", async () => {
      // Create a promise that won't resolve immediately
      let resolvePromise: ((value: unknown) => void) | undefined;
      mockFetch.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const { container } = render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      // Check for loading spinner
      await waitFor(() => {
        const spinner = container.querySelector(".animate-spin");
        expect(spinner).toBeInTheDocument();
      });

      expect(screen.getByText("Loading models...")).toBeInTheDocument();

      // Resolve the promise
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ success: true, models: [] }),
      });
    });
  });

  describe("Error State", () => {
    it("should show error message when fetch fails", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: false, error: "API error occurred" }),
      });

      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("API error occurred")).toBeInTheDocument();
      });
    });

    it("should show error message when network request fails", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Network error")).toBeInTheDocument();
      });
    });

    it("should show Try again button on error", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: false, error: "API error" }),
      });

      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Try again")).toBeInTheDocument();
      });
    });

    it("should refetch when Try again button is clicked", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false, error: "API error" }),
      });

      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Try again")).toBeInTheDocument();
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, models: sampleModels }),
      });

      fireEvent.click(screen.getByText("Try again"));

      await waitFor(() => {
        expect(screen.getByText("FLUX.1 Dev")).toBeInTheDocument();
      });
    });
  });

  describe("Empty State", () => {
    it("should show empty state when no models match search", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, models: [] }),
      });

      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("No models found")).toBeInTheDocument();
        expect(screen.getByText("Try adjusting your search or filters")).toBeInTheDocument();
      });
    });
  });

  describe("API Headers", () => {
    it("should include API keys in request headers", async () => {
      render(
        <TestWrapper>
          <ModelSearchDialog isOpen={true} onClose={vi.fn()} />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        const options = fetchCall[1] as RequestInit;
        expect(options.headers).toEqual({
          "X-Replicate-Key": "test-replicate-key",
          "X-Fal-Key": "test-fal-key",
        });
      });
    });
  });
});
