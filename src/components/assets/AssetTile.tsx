"use client";

import { AudioWaveform, Box, Check, FileWarning, Image as ImageIcon, Play, Star, Video } from "lucide-react";
import { memo, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/components/nodes/ui/cn";
import { assetFileUrl, assetThumbUrl } from "@/lib/assets/client/api";
import { THUMB_WIDTHS, type AssetKind, type AssetView } from "@/lib/assets/types";
import { VIDEO_HOVER_DELAY_MS } from "@/hooks/useVideoAutoplay";
import { assetTitle, formatDuration, KIND_LABELS } from "./assetFormat";
import { requestPoster } from "./posterRequests";
import { prefersReducedMotion } from "./useVirtualWindow";

/** Kind colour (the node sockets' colours): placeholder ground and glyph. */
export const KIND_TONE: Record<AssetKind, { ground: string; glyph: string }> = {
  image: { ground: "bg-handle-image/10", glyph: "text-handle-image" },
  video: { ground: "bg-handle-video/10", glyph: "text-handle-video" },
  audio: { ground: "bg-handle-audio/10", glyph: "text-handle-audio" },
  "3d": { ground: "bg-handle-3d/10", glyph: "text-handle-3d" },
};

export const KIND_ICONS: Record<AssetKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  audio: AudioWaveform,
  "3d": Box,
};

/** Smallest server thumbnail at least as wide as the tile on this screen. */
export function thumbBucket(tileWidth: number, dpr: number = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1): 320 | 640 {
  const needed = tileWidth * dpr;
  return THUMB_WIDTHS.find((width) => width >= needed) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
}

/**
 * The grid thumbnail. A video's comes from a poster the browser makes, so
 * the URL changes once one exists: an image that failed before it did is
 * asked for again, not served from memory.
 */
export function tileThumbUrl(asset: Pick<AssetView, "sha256" | "hasPoster">, tileWidth: number): string {
  const url = assetThumbUrl(asset.sha256, thumbBucket(tileWidth));
  return asset.hasPoster ? `${url}&poster=1` : url;
}

/** Kind-coloured stand-in: no thumbnail yet (204), a failed one, a missing file, audio. */
export function AssetPlaceholder({ kind, className, size = 28 }: { kind: AssetKind; className?: string; size?: number }) {
  const Icon = KIND_ICONS[kind];
  return (
    <div className={cn("flex h-full w-full items-center justify-center", KIND_TONE[kind].ground, className)}>
      <Icon size={size} strokeWidth={1.5} className={cn(KIND_TONE[kind].glyph, "opacity-80")} />
    </div>
  );
}

/** Mono chip over the tile's bottom-left corner. */
function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-[5px] bg-black/60 px-1.5 font-mono text-[10px] leading-none text-neutral-100 backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface AssetTileProps {
  id: string;
  kind: AssetKind;
  /** Null while its page is being fetched again. */
  asset: AssetView | null;
  width: number;
  height: number;
  left: number;
  top: number;
  /** Inside the visible area, not only mounted in the overscan around it. */
  onScreen: boolean;
  selected: boolean;
  focused: boolean;
  /** The grid's one Tab stop (roving tabindex): the focused tile, else the first in view. */
  tabbable: boolean;
  /** Show the checkbox at rest (select mode, or something is selected). */
  selecting: boolean;
  onFocus: (id: string) => void;
  onActivate: (id: string, event: ReactMouseEvent) => void;
  onToggleSelect: (id: string, event: ReactMouseEvent) => void;
  onToggleFavorite: (asset: AssetView) => void;
  onContextMenu: (id: string, event: ReactMouseEvent) => void;
}

/**
 * One asset in the grid: a server thumbnail (never the original), badges
 * for what it is, a checkbox and a favorite star. Videos preview on hover
 * after the canvas's hover delay, unless the user asked for less motion.
 */
export const AssetTile = memo(function AssetTile({
  id,
  kind,
  asset,
  width,
  height,
  left,
  top,
  onScreen,
  selected,
  focused,
  tabbable,
  selecting,
  onFocus,
  onActivate,
  onToggleSelect,
  onToggleFavorite,
  onContextMenu,
}: AssetTileProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sha = asset?.sha256;
  const hasPoster = !!asset?.hasPoster;
  useEffect(() => setThumbFailed(false), [sha, hasPoster]);
  // A video on screen without a poster (recorded a moment ago, imported, or its
  // capture failed) gets one made; onPosterReady then marks it and this tile reloads.
  // Only while on screen: one scrolled past before its turn is withdrawn
  const needsPoster = !!asset && asset.kind === "video" && !asset.hasPoster && !asset.missing;
  useEffect(() => {
    if (!needsPoster || !onScreen || !asset) return;
    return requestPoster(asset);
    // Once per asset, whatever else about the record changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPoster, onScreen, asset?.id]);
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  const missing = !!asset?.missing;
  const showThumb = !!asset && !missing && kind !== "audio" && !thumbFailed;
  const title = asset ? assetTitle(asset) : KIND_LABELS[kind];

  const startPreview = () => {
    if (kind !== "video" || !asset || missing || prefersReducedMotion()) return;
    hoverTimer.current = setTimeout(() => setPreviewing(true), VIDEO_HOVER_DELAY_MS);
  };
  const stopPreview = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setPreviewing(false);
  };

  return (
    <div
      className="group absolute"
      style={{ left, top, width, height }}
      data-asset-id={id}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
    >
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        aria-label={title}
        aria-pressed={selecting ? selected : undefined}
        data-asset-tile={id}
        data-selected={selected || undefined}
        onFocus={() => onFocus(id)}
        onClick={(event) => onActivate(id, event)}
        onContextMenu={(event) => onContextMenu(id, event)}
        className={cn(
          "relative block h-full w-full overflow-hidden rounded-media bg-well text-left",
          "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] transition-[box-shadow,opacity] duration-[120ms]",
          "focus-visible:outline-none",
          selected
            ? "ring-2 ring-selection ring-offset-1 ring-offset-canvas-bg"
            : focused
              ? "ring-2 ring-white/40 ring-offset-1 ring-offset-canvas-bg"
              : "group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]",
        )}
      >
        {showThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tileThumbUrl(asset, width)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setThumbFailed(true)}
            className="pointer-events-none h-full w-full object-cover"
          />
        ) : (
          <AssetPlaceholder kind={kind} className={cn(missing && "opacity-50")} size={kind === "audio" ? Math.min(40, height * 0.45) : 28} />
        )}
        {previewing && asset && (
          <video
            src={assetFileUrl(asset.id)}
            muted
            loop
            autoPlay
            playsInline
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
        )}

        {/* What it is, bottom-left */}
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex gap-1">
          {missing && (
            <Badge className="bg-error/80">
              <FileWarning size={11} strokeWidth={2} />
              Missing
            </Badge>
          )}
          {kind === "video" && (
            <Badge>
              <Play size={9} strokeWidth={0} fill="currentColor" />
              {asset?.durationSec ? formatDuration(asset.durationSec) : "Video"}
            </Badge>
          )}
          {kind === "audio" && asset?.durationSec ? <Badge>{formatDuration(asset.durationSec)}</Badge> : null}
          {kind === "3d" && <Badge>3D</Badge>}
        </span>
      </button>

      {/* Checkbox, top-left: on hover, while selecting, or when selected */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? `Deselect ${title}` : `Select ${title}`}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSelect(id, event);
        }}
        className={cn(
          "absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-[5px] border transition-opacity duration-[120ms]",
          selected
            ? "border-selection bg-selection text-white opacity-100"
            : cn("border-white/70 bg-black/35 text-transparent backdrop-blur-sm", selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100"),
        )}
      >
        <Check size={12} strokeWidth={3} />
      </button>

      {/* Favorite, top-right: always when on, on hover to add */}
      {asset && (
        <button
          type="button"
          aria-label={asset.favorite ? "Remove from Favorites" : "Add to Favorites"}
          aria-pressed={asset.favorite}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(asset);
          }}
          className={cn(
            "absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-white transition-opacity duration-[120ms] hover:bg-black/40",
            asset.favorite ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <Star size={15} strokeWidth={1.75} fill={asset.favorite ? "currentColor" : "rgba(0,0,0,0.25)"} className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
        </button>
      )}
    </div>
  );
});
