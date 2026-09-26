"use client";

import { Check, Minus, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cn } from "@/components/nodes/ui/cn";
import { MenuSectionLabel, MenuSurface } from "@/components/ui/Menu";
import type { AssetSelection, AssetView } from "@/lib/assets/types";
import { useAssetStore } from "@/store/assetStore";

/** Tags are free text: trimmed, single-spaced, at most 64 characters. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 64);
}

const hasTag = (tags: string[], tag: string) => tags.some((t) => t.toLowerCase() === tag.toLowerCase());

/** Whether every, some or none of a set of assets carry a tag. */
export type TagState = "all" | "some" | "none";

export function tagStates(records: Pick<AssetView, "tags">[]): Map<string, TagState> {
  const counts = new Map<string, number>();
  for (const record of records) for (const tag of new Set(record.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const states = new Map<string, TagState>();
  for (const [tag, count] of counts) states.set(tag, count === records.length ? "all" : "some");
  return states;
}

/** One tag. `some`: only part of a selection carries it (dashed). */
export function TagChip({
  tag,
  state = "all",
  onRemove,
  className,
}: {
  tag: string;
  state?: TagState;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1 rounded-md border pl-2 text-xs text-neutral-200",
        state === "some" ? "border-dashed border-neutral-600 text-neutral-400" : "border-white/[0.08] bg-white/[0.06]",
        onRemove ? "pr-0.5" : "pr-2",
        className,
      )}
    >
      <span className="truncate">{tag}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${tag}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-white/[0.08] hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection"
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}
    </span>
  );
}

/**
 * Chips and a field: Enter or comma adds what was typed (or the highlighted
 * suggestion), Backspace in an empty field takes the last chip off.
 */
export function TagInput({
  tags,
  suggestions,
  onAdd,
  onRemove,
  placeholder = "Add a tag",
  autoFocus,
  className,
}: {
  tags: string[];
  suggestions: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const [focused, setFocused] = useState(false);
  const listId = useId();

  const matches = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    return suggestions
      .filter((tag) => !hasTag(tags, tag) && (!needle || tag.toLowerCase().includes(needle)))
      .slice(0, 6);
  }, [draft, suggestions, tags]);

  const commit = (raw: string) => {
    const tag = normalizeTag(raw);
    setDraft("");
    setHighlight(-1);
    if (!tag || hasTag(tags, tag)) return;
    onAdd(tag);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(highlight >= 0 && matches[highlight] ? matches[highlight]! : draft);
    } else if (event.key === "Backspace" && !draft && tags.length) {
      onRemove(tags[tags.length - 1]!);
    } else if (event.key === "ArrowDown" && matches.length) {
      event.preventDefault();
      setHighlight((i) => (i + 1) % matches.length);
    } else if (event.key === "ArrowUp" && matches.length) {
      event.preventDefault();
      setHighlight((i) => (i <= 0 ? matches.length - 1 : i - 1));
    }
  };

  const open = focused && matches.length > 0;

  return (
    <div className={cn("relative", className)}>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-card-border bg-card px-1.5 py-1.5 focus-within:border-neutral-500">
        {tags.map((tag) => (
          <TagChip key={tag} tag={tag} onRemove={() => onRemove(tag)} />
        ))}
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setHighlight(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={tags.length ? "" : placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoFocus={autoFocus}
          className="h-6 min-w-[80px] flex-1 bg-transparent px-1 text-[13px] text-neutral-100 placeholder:text-neutral-500 outline-none"
        />
      </div>
      {open && (
        <MenuSurface floating={false} id={listId} role="listbox" className="absolute left-0 right-0 top-full z-10 mt-1 py-1">
          {matches.map((tag, index) => (
            <button
              key={tag}
              type="button"
              role="option"
              aria-selected={index === highlight}
              // Before the input blurs, or the list would be gone
              onMouseDown={(event) => {
                event.preventDefault();
                commit(tag);
              }}
              className={cn(
                "flex h-7 w-full items-center px-2.5 text-left text-xs text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100",
                index === highlight && "bg-neutral-700 text-neutral-100",
              )}
            >
              {tag}
            </button>
          ))}
        </MenuSurface>
      )}
    </div>
  );
}

const POPOVER_WIDTH = 280;

/**
 * Tags for several assets at once. Every tag any of them carries is listed
 * with its state: all (✓), some (–) or none. Clicking a partial or absent
 * tag gives it to all of them; clicking a full one takes it off all.
 */
export function BulkTagEditor({
  selection,
  records,
  suggestions,
  x,
  y,
}: {
  selection: AssetSelection;
  records: AssetView[];
  suggestions: string[];
  x: number;
  y: number;
}) {
  const runBulk = useAssetStore((state) => state.runBulk);
  const closePopover = useAssetStore((state) => state.closePopover);
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const states = tagStates(records);
  // Everything the selection carries first, then the library's other tags to offer
  const rows = [...states.keys()].sort((a, b) => a.localeCompare(b));
  for (const tag of suggestions) if (!states.has(tag) && rows.length < 24) rows.push(tag);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) closePopover();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [closePopover]);

  const apply = (tag: string, state: TagState) => {
    void runBulk(selection, state === "all" ? { action: "untag", tags: [tag] } : { action: "tag", tags: [tag] });
  };

  const left = typeof window !== "undefined" ? Math.max(8, Math.min(x, window.innerWidth - POPOVER_WIDTH - 8)) : x;
  const top = typeof window !== "undefined" ? Math.max(8, Math.min(y, window.innerHeight - 360)) : y;

  return (
    <MenuSurface
      ref={ref}
      role="dialog"
      aria-label="Tags"
      className="flex max-h-[340px] flex-col"
      style={{ left, top, width: POPOVER_WIDTH }}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="border-b border-chrome-border p-2">
        <input
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const tag = normalizeTag(draft);
            if (tag) apply(tag, "none");
            setDraft("");
          }}
          placeholder="Add a tag to all"
          aria-label="Add a tag to all"
          className="h-7 w-full rounded-md bg-canvas-bg px-2 text-xs text-neutral-100 placeholder:text-neutral-500 outline-none focus-visible:ring-1 focus-visible:ring-neutral-500"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-neutral-500">No tags yet. Type one above.</div>
        ) : (
          <>
            <MenuSectionLabel className="px-2.5 pb-1 pt-1.5">{records.length > 1 ? `${records.length} assets` : "Tags"}</MenuSectionLabel>
            {rows.map((tag) => {
              const state = states.get(tag) ?? "none";
              return (
                <button
                  key={tag}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
                  onClick={() => apply(tag, state)}
                  className="flex h-7 w-full items-center gap-2 px-2.5 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100 focus-visible:bg-neutral-700 focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                      state === "none" ? "border-neutral-600" : "border-neutral-200 bg-neutral-200 text-neutral-900",
                    )}
                  >
                    {state === "all" && <Check size={10} strokeWidth={3} />}
                    {state === "some" && <Minus size={10} strokeWidth={3} />}
                  </span>
                  <span className="truncate">{tag}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </MenuSurface>
  );
}
