"use client";

import { DialogChip, DialogRowTitle, DialogSpinner, dialogCardClass } from "@/components/ui/Dialog";
import { cn } from "@/components/nodes/ui/cn";
import { TemplateCategory } from "@/types/quickstart";

interface TemplateCardProps {
  template: {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: TemplateCategory;
    tags: string[];
  };
  nodeCount: number;
  /** Who published it; community workflows name their author in the meta line. */
  author?: string;
  previewImage?: string;
  hoverImage?: string;
  isLoading?: boolean;
  onUseWorkflow: () => void;
  disabled?: boolean;
}

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  simple: "Simple",
  advanced: "Advanced",
  community: "Community",
};

/**
 * One template in the explorer grid, drawn like a model card: a fixed
 * 124px with a full-height thumbnail (cross-fading to the workflow
 * screenshot on hover), the name, a mono meta line, one row of provider
 * chips and exactly two lines of description.
 */
export function TemplateCard({
  template,
  nodeCount,
  author,
  previewImage,
  hoverImage,
  isLoading = false,
  onUseWorkflow,
  disabled = false,
}: TemplateCardProps) {
  const category = CATEGORY_LABELS[template.category] ?? template.category;
  const meta = [author && `by ${author}`, `${nodeCount} node${nodeCount === 1 ? "" : "s"}`].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onUseWorkflow}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        dialogCardClass,
        "group relative flex items-stretch w-full h-[124px] overflow-hidden",
        isLoading && "border-neutral-500",
        disabled && !isLoading && "opacity-50 cursor-not-allowed hover:border-card-border hover:bg-transparent"
      )}
    >
      {/* Full-height thumbnail */}
      <span className="relative w-[122px] self-stretch shrink-0 overflow-hidden bg-card flex items-center justify-center">
        {previewImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImage}
              alt={`${template.name} preview`}
              className={cn(
                "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
                hoverImage && "group-hover:opacity-0"
              )}
            />
            {hoverImage && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={hoverImage}
                alt={`${template.name} hover preview`}
                className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              />
            )}
          </>
        ) : (
          <svg className="w-7 h-7 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.25} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d={template.icon} />
          </svg>
        )}
      </span>

      {/* Fixed height: title, meta line, one row of chips and two lines of description. */}
      <span className="flex-1 min-w-0 px-3.5 py-3 flex flex-col gap-1.5 overflow-hidden">
        <span className={cn("min-w-0", isLoading && "pr-[26px]")}>
          <DialogRowTitle className="truncate">{template.name}</DialogRowTitle>
          <span className="flex items-center gap-1.5 mt-0.5 min-w-0 font-mono text-[11px] leading-4">
            <span className="shrink-0 text-neutral-400">{category}</span>
            {meta.map((part) => (
              <span key={part} className="flex items-center gap-1.5 min-w-0">
                <span aria-hidden="true" className="shrink-0 text-neutral-600">·</span>
                <span className="text-ink-3 truncate">{part}</span>
              </span>
            ))}
          </span>
        </span>
        <span className="flex items-center gap-1 overflow-hidden">
          {template.tags.map((tag) => (
            <DialogChip key={tag} className="shrink-0">{tag}</DialogChip>
          ))}
        </span>
        <span className="h-8 shrink-0 text-xs leading-4 text-ink-3 line-clamp-2">{template.description}</span>
      </span>

      {/* The spinner sits where a model card keeps its provider link. */}
      {isLoading && (
        <span className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center">
          <DialogSpinner className="w-4 h-4" />
        </span>
      )}
    </button>
  );
}
