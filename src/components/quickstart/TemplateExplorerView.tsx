"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { WorkflowFile } from "@/store/workflowStore";
import { getAllPresets, PRESET_TEMPLATES } from "@/lib/quickstart/templates";
import {
  DialogEyebrow,
  DialogFilterGroup,
  DialogFilterItem,
  DialogPage,
  DialogPageBody,
  DialogPageHead,
  DialogPane,
  DialogPaneFoot,
  DialogPaneRule,
  DialogPaneTitle,
  DialogSearchField,
  DialogSearchGlyph,
  DialogSpinner,
  DialogStatus,
  DialogTextButton,
  filterPaneClass,
} from "@/components/ui/Dialog";
import { cn } from "@/components/nodes/ui/cn";
import { APP_VERSION } from "@/lib/appVersion";
import { QuickstartBackButton } from "./QuickstartBackButton";
import { TemplateCard } from "./TemplateCard";
import { CommunityWorkflowMeta, TemplateCategory, TemplateMetadata } from "@/types/quickstart";

interface TemplateExplorerViewProps {
  onBack: () => void;
  onWorkflowSelected: (workflow: WorkflowFile) => void;
}

type CategoryFilter = "all" | TemplateCategory;

const CATEGORY_OPTIONS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "simple", label: "Simple" },
  { id: "advanced", label: "Advanced" },
  { id: "community", label: "Community" },
];

// Static preset list (getAllPresets is pure/deterministic) — hoisted so its
// identity is stable across renders and downstream useMemos stay cached.
const PRESETS = getAllPresets();

// Primary thumbnails (resized content images - 288px for 2x retina)
const primaryThumbnails: Record<string, string> = {
  "product-shot": "/template-thumbnails/primary/product-shot.jpg",
  "model-product": "/template-thumbnails/primary/model-product.jpg",
  "color-variations": "/template-thumbnails/primary/color-variations.jpg",
  "background-swap": "/template-thumbnails/primary/background-swap.jpg",
  "style-transfer": "/template-thumbnails/primary/style-transfer.jpg",
  "scene-composite": "/template-thumbnails/primary/scene-composite.jpg",
};

// Hover thumbnails (workflow screenshots - 288px)
const hoverThumbnails: Record<string, string> = {
  "product-shot": "/template-thumbnails/product-shot.png",
  "model-product": "/template-thumbnails/model-product.png",
  "color-variations": "/template-thumbnails/color-variations.png",
  "background-swap": "/template-thumbnails/background-swap.png",
  "style-transfer": "/template-thumbnails/style-transfer.png",
  "scene-composite": "/template-thumbnails/scene-composite.png",
};

/**
 * The template explorer, on the same shape as the model browser: a 232px
 * filter pane (search, Category, Provider, the mark at the foot) beside a
 * two-column grid of 124px cards, the community section ruled off beneath.
 */
export function TemplateExplorerView({
  onBack,
  onWorkflowSelected,
}: TemplateExplorerViewProps) {
  const [communityWorkflows, setCommunityWorkflows] = useState<CommunityWorkflowMeta[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [loadingWorkflowId, setLoadingWorkflowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce search query
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 200);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Calculate node counts for each preset
  const presetMetadata = useMemo(() => {
    const metadata: Record<string, TemplateMetadata> = {};
    PRESET_TEMPLATES.forEach((template) => {
      metadata[template.id] = {
        nodeCount: template.workflow.nodes.length,
        category: template.category,
        tags: template.tags,
      };
    });
    return metadata;
  }, []);

  // Filter presets based on search, category, and tags
  const filteredPresets = useMemo(() => {
    return PRESETS.filter((preset) => {
      // Search filter: match name or description
      if (debouncedSearch) {
        const searchLower = debouncedSearch.toLowerCase();
        const matchesSearch =
          preset.name.toLowerCase().includes(searchLower) ||
          preset.description.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Category filter
      if (categoryFilter !== "all" && categoryFilter !== "community") {
        if (preset.category !== categoryFilter) return false;
      }

      // If "community" is selected, hide preset templates (they're not community)
      if (categoryFilter === "community") {
        return false;
      }

      // Tags filter (OR logic - match ANY selected tag)
      if (selectedTags.size > 0) {
        const hasMatchingTag = preset.tags.some((tag) => selectedTags.has(tag));
        if (!hasMatchingTag) return false;
      }

      return true;
    });
  }, [debouncedSearch, categoryFilter, selectedTags]);

  // Filter community workflows
  const filteredCommunity = useMemo(() => {
    // Only show community workflows if "all" or "community" category selected
    if (categoryFilter !== "all" && categoryFilter !== "community") {
      return [];
    }

    return communityWorkflows.filter((workflow) => {
      // Search filter
      if (debouncedSearch) {
        const searchLower = debouncedSearch.toLowerCase();
        const matchesSearch =
          workflow.name.toLowerCase().includes(searchLower) ||
          workflow.author.toLowerCase().includes(searchLower) ||
          workflow.description.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Tags filter (OR logic - match ANY selected tag)
      if (selectedTags.size > 0) {
        const hasMatchingTag = workflow.tags.some((tag) => selectedTags.has(tag));
        if (!hasMatchingTag) return false;
      }

      return true;
    });
  }, [communityWorkflows, debouncedSearch, categoryFilter, selectedTags]);

  // Collect all unique tags from presets and community workflows
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    PRESETS.forEach((preset) => {
      preset.tags.forEach((tag) => tags.add(tag));
    });
    communityWorkflows.forEach((workflow) => {
      workflow.tags.forEach((tag) => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [communityWorkflows]);

  // Toggle tag selection
  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setDebouncedSearch("");
    setCategoryFilter("all");
    setSelectedTags(new Set());
  }, []);

  // Check if any filters are active
  const hasActiveFilters = searchQuery !== "" || categoryFilter !== "all" || selectedTags.size > 0;

  // Check if results are empty
  const hasNoResults =
    filteredPresets.length === 0 &&
    (categoryFilter === "community" ? filteredCommunity.length === 0 : true) &&
    !isLoadingList;

  // Fetch community workflows on mount
  useEffect(() => {
    async function fetchCommunityWorkflows() {
      try {
        const response = await fetch("/api/community-workflows");
        const result = await response.json();

        if (result.success) {
          setCommunityWorkflows(result.workflows);
        } else {
          console.error("Failed to fetch community workflows:", result.error);
        }
      } catch (err) {
        console.error("Error fetching community workflows:", err);
      } finally {
        setIsLoadingList(false);
      }
    }

    fetchCommunityWorkflows();
  }, []);

  const handlePresetSelect = useCallback(
    async (templateId: string) => {
      setLoadingWorkflowId(templateId);
      setError(null);

      try {
        const response = await fetch("/api/quickstart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId,
            contentLevel: "full",
          }),
        });

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || "Failed to load template");
        }

        if (result.workflow) {
          onWorkflowSelected(result.workflow);
        }
      } catch (err) {
        console.error("Error loading preset:", err);
        setError(err instanceof Error ? err.message : "Failed to load template");
      } finally {
        setLoadingWorkflowId(null);
      }
    },
    [onWorkflowSelected]
  );

  const handleCommunitySelect = useCallback(
    async (workflowId: string) => {
      setLoadingWorkflowId(workflowId);
      setError(null);

      try {
        // Step 1: Get presigned download URL from API
        const response = await fetch(`/api/community-workflows/${workflowId}`);
        const result = await response.json();

        if (!result.success || !result.downloadUrl) {
          throw new Error(result.error || "Failed to get download URL");
        }

        // Step 2: Download workflow directly from R2
        const workflowResponse = await fetch(result.downloadUrl);
        if (!workflowResponse.ok) {
          throw new Error("Failed to download workflow");
        }

        const workflow = await workflowResponse.json();
        onWorkflowSelected(workflow);
      } catch (err) {
        console.error("Error loading community workflow:", err);
        setError(err instanceof Error ? err.message : "Failed to load workflow");
      } finally {
        setLoadingWorkflowId(null);
      }
    },
    [onWorkflowSelected]
  );

  const isLoading = loadingWorkflowId !== null;

  const showCommunity =
    filteredCommunity.length > 0 ||
    (isLoadingList && (categoryFilter === "all" || categoryFilter === "community"));

  const resultCount = filteredPresets.length + filteredCommunity.length;
  const countLabel = `${resultCount} template${resultCount === 1 ? "" : "s"}`;

  return (
    <>
      <DialogPane width={232} className={filterPaneClass}>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col">
          <QuickstartBackButton onClick={onBack} disabled={isLoading} className="ml-[11px]" />
          <DialogPaneTitle className="mt-2.5">Templates</DialogPaneTitle>

          <DialogSearchField
            aria-label="Search templates"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="mt-3"
          />

          <div className="mt-[18px] flex flex-col gap-3.5">
            <DialogFilterGroup label="Category">
              {CATEGORY_OPTIONS.map((option) => (
                <DialogFilterItem
                  key={option.id}
                  active={categoryFilter === option.id}
                  onClick={() => setCategoryFilter(option.id)}
                >
                  {option.label}
                </DialogFilterItem>
              ))}
            </DialogFilterGroup>

            {availableTags.length > 0 && (
              <>
                <DialogPaneRule />

                <DialogFilterGroup label="Provider">
                  {availableTags.map((tag) => (
                    <DialogFilterItem key={tag} active={selectedTags.has(tag)} onClick={() => toggleTag(tag)}>
                      {tag}
                    </DialogFilterItem>
                  ))}
                </DialogFilterGroup>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center pt-2 border-t border-white/[0.06]">
          <DialogPaneFoot version={APP_VERSION || undefined} className="h-7 pl-[11px]" />
        </div>
      </DialogPane>

      <DialogPage>
        <DialogPageHead
          eyebrow={<span aria-live="polite">{countLabel}</span>}
          actions={hasActiveFilters && <DialogTextButton onClick={clearFilters}>Clear filters</DialogTextButton>}
        />

        <DialogPageBody className="overscroll-contain pt-3 pb-6 flex flex-col gap-5">
          {/* Empty State */}
          {hasNoResults && hasActiveFilters && (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <DialogSearchGlyph className="w-10 h-10 text-neutral-600 mb-4" strokeWidth={1.25} />
              <h3 className="font-display text-sm leading-[18px] font-semibold tracking-[-0.01em] text-neutral-100">
                No templates match your filters
              </h3>
              <p className="mt-1 text-xs leading-4 text-ink-3">
                Try adjusting your search or filters
              </p>
              <DialogTextButton onClick={clearFilters} className="mt-3">
                Clear all filters
              </DialogTextButton>
            </div>
          )}

          {/* Quick Start Templates */}
          {filteredPresets.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {filteredPresets.map((preset) => (
                <TemplateCard
                  key={preset.id}
                  template={preset}
                  nodeCount={presetMetadata[preset.id]?.nodeCount ?? 0}
                  previewImage={primaryThumbnails[preset.id]}
                  hoverImage={hoverThumbnails[preset.id]}
                  isLoading={loadingWorkflowId === preset.id}
                  onUseWorkflow={() => handlePresetSelect(preset.id)}
                  disabled={isLoading && loadingWorkflowId !== preset.id}
                />
              ))}
            </div>
          )}

          {/* Community Workflows */}
          {showCommunity && (
            <div className="flex flex-col gap-5">
              <div
                className={cn(
                  "flex items-center justify-between gap-4",
                  filteredPresets.length > 0 && "pt-4 border-t border-card"
                )}
              >
                <DialogEyebrow>Community Workflows</DialogEyebrow>
                <a
                  href="https://discord.com/invite/89Nr6EKkTf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] leading-4 tracking-eyebrow uppercase text-neutral-400 hover:text-neutral-100 transition-colors whitespace-nowrap"
                >
                  Share yours on Discord
                </a>
              </div>

              {isLoadingList ? (
                <div className="flex items-center justify-center py-8">
                  <DialogSpinner />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredCommunity.map((workflow) => (
                    <TemplateCard
                      key={workflow.id}
                      template={{
                        id: workflow.id,
                        name: workflow.name,
                        description: workflow.description,
                        icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
                        category: "community",
                        tags: workflow.tags,
                      }}
                      nodeCount={workflow.nodeCount}
                      author={workflow.author}
                      previewImage={workflow.previewImage}
                      hoverImage={workflow.hoverImage}
                      isLoading={loadingWorkflowId === workflow.id}
                      onUseWorkflow={() => handleCommunitySelect(workflow.id)}
                      disabled={isLoading && loadingWorkflowId !== workflow.id}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center justify-between gap-3">
              <DialogStatus tone="error" className="normal-case tracking-normal text-neutral-300 min-w-0">
                <span className="truncate">{error}</span>
              </DialogStatus>
              <DialogTextButton onClick={() => setError(null)}>Dismiss</DialogTextButton>
            </div>
          )}
        </DialogPageBody>
      </DialogPage>
    </>
  );
}
