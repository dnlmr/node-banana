/**
 * Layout for the Assets grid: day sections, each a shortest-column masonry.
 *
 * Everything here is pure arithmetic over the items' recorded sizes, never
 * the DOM, so it runs the same in tests as in the browser, and it is
 * incremental: passing the previous result places only the items appended
 * since (one page at a time), and never moves a tile already placed. That
 * is what keeps the grid still while pages load under the user.
 */

import type { AssetKind } from "@/lib/assets/types";
import { dayKey } from "./assetFormat";

/** What placement needs to know about an asset. */
export interface MasonryItem {
  id: string;
  createdAt: number;
  kind: AssetKind;
  width?: number;
  height?: number;
}

/** Extremes are clamped so one panorama or one strip cannot dominate a column. */
const MIN_ASPECT = 1 / 3;
const MAX_ASPECT = 3;

/**
 * Height ÷ width a tile is drawn at: the recorded dimensions when known,
 * else by kind: video 16:9, audio a 2:1 strip, 3D and anything else square.
 */
export function tileAspect(item: Pick<MasonryItem, "kind" | "width" | "height">): number {
  if (item.kind === "audio") return 0.5;
  if (item.width && item.height && item.width > 0 && item.height > 0) {
    return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, item.height / item.width));
  }
  if (item.kind === "video") return 9 / 16;
  return 1;
}

/* ------------------------------------------------------------------ */
/* One masonry block                                                  */
/* ------------------------------------------------------------------ */

export interface PlacedTile {
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
}

export interface MasonryResult {
  columnCount: number;
  columnWidth: number;
  gap: number;
  /** One per placed item, in item order. */
  tiles: PlacedTile[];
  /** Where the next tile in each column would start (includes the trailing gap). */
  columnBottoms: number[];
  /** Per column, the indices of its tiles top to bottom (for binary search). */
  columns: number[][];
  /** Height of the block (no trailing gap). */
  height: number;
}

/**
 * Shortest-column masonry: each item goes to the column that currently ends
 * highest, the leftmost on a tie. Pass `previous` (the result for a prefix
 * of `items`) to place only the items after it; the result is identical to
 * laying out everything at once.
 */
export function masonry(
  items: readonly Pick<MasonryItem, "kind" | "width" | "height">[],
  columnCount: number,
  columnWidth: number,
  gap: number,
  previous?: MasonryResult | null,
): MasonryResult {
  const count = Math.max(1, Math.floor(columnCount));
  const reuse =
    previous &&
    previous.columnCount === count &&
    previous.columnWidth === columnWidth &&
    previous.gap === gap &&
    previous.tiles.length <= items.length;
  const tiles = reuse ? previous.tiles.slice() : [];
  const columnBottoms = reuse ? previous.columnBottoms.slice() : new Array<number>(count).fill(0);
  const columns = reuse ? previous.columns.map((column) => column.slice()) : Array.from({ length: count }, () => [] as number[]);

  for (let index = tiles.length; index < items.length; index++) {
    let column = 0;
    for (let c = 1; c < count; c++) {
      if (columnBottoms[c]! < columnBottoms[column]!) column = c;
    }
    const y = columnBottoms[column]!;
    const height = Math.max(1, Math.round(columnWidth * tileAspect(items[index]!)));
    tiles.push({ x: column * (columnWidth + gap), y, width: columnWidth, height, column });
    columns[column]!.push(index);
    columnBottoms[column] = y + height + gap;
  }

  const tallest = Math.max(0, ...columnBottoms);
  return {
    columnCount: count,
    columnWidth,
    gap,
    tiles,
    columnBottoms,
    columns,
    height: tiles.length ? tallest - gap : 0,
  };
}

/** Column count and width for a container: as many columns as fit near the target width, stretched to fill it. */
export function fitColumns(containerWidth: number, targetWidth: number, gap: number): { columnCount: number; columnWidth: number } {
  const width = Math.max(0, containerWidth);
  const columnCount = Math.max(1, Math.round((width + gap) / (targetWidth + gap)));
  const columnWidth = Math.max(1, (width - gap * (columnCount - 1)) / columnCount);
  return { columnCount, columnWidth };
}

/* ------------------------------------------------------------------ */
/* Day sections                                                       */
/* ------------------------------------------------------------------ */

export interface GridLayoutOptions {
  columnCount: number;
  columnWidth: number;
  gap: number;
  /** Height of a section's sticky header. */
  headerHeight: number;
  /** Space between one section's last tile and the next header. */
  sectionGap: number;
}

export interface GridSection {
  /** Local `YYYY-MM-DD`. */
  key: string;
  /** createdAt of the section's first item, for its label. */
  at: number;
  /** Index of the section's first item in the whole list. */
  start: number;
  /** Top of the section (its header) within the grid. */
  top: number;
  masonry: MasonryResult;
}

export interface GridLayout extends GridLayoutOptions {
  sections: GridSection[];
  itemCount: number;
  /** Height of everything laid out so far. */
  height: number;
}

function sameOptions(a: GridLayoutOptions, b: GridLayoutOptions): boolean {
  return (
    a.columnCount === b.columnCount &&
    a.columnWidth === b.columnWidth &&
    a.gap === b.gap &&
    a.headerHeight === b.headerHeight &&
    a.sectionGap === b.sectionGap
  );
}

function sectionBottom(section: GridSection, options: GridLayoutOptions): number {
  return section.top + options.headerHeight + section.masonry.height;
}

/**
 * Splits `items` (already in sort order) into runs of one local day and lays
 * each run out as its own masonry block under a header. With `previous` for
 * a prefix of `items` and the same options, only the appended items are
 * placed: the last section grows, and new days add sections below.
 */
export function layoutGrid(items: readonly MasonryItem[], options: GridLayoutOptions, previous?: GridLayout | null): GridLayout {
  const reuse = previous && sameOptions(previous, options) && previous.itemCount <= items.length;
  const sections: GridSection[] = reuse ? previous.sections.slice() : [];
  let index = reuse ? previous.itemCount : 0;

  while (index < items.length) {
    const key = dayKey(items[index]!.createdAt);
    let end = index + 1;
    while (end < items.length && dayKey(items[end]!.createdAt) === key) end++;

    const last = sections[sections.length - 1];
    if (last && last.key === key) {
      // The page continues the day the previous one ended on
      const run = items.slice(last.start, end);
      sections[sections.length - 1] = {
        ...last,
        masonry: masonry(run, options.columnCount, options.columnWidth, options.gap, last.masonry),
      };
    } else {
      const top = last ? sectionBottom(last, options) + options.sectionGap : 0;
      sections.push({
        key,
        at: items[index]!.createdAt,
        start: index,
        top,
        masonry: masonry(items.slice(index, end), options.columnCount, options.columnWidth, options.gap),
      });
    }
    index = end;
  }

  const last = sections[sections.length - 1];
  return {
    ...options,
    sections,
    itemCount: items.length,
    height: last ? sectionBottom(last, options) : 0,
  };
}

/** Number of items in a section. */
export function sectionSize(section: GridSection): number {
  return section.masonry.tiles.length;
}

/** First index in `column` (tile indices, top-down) whose tile ends at or below `y`. */
function firstEndingBelow(column: number[], tiles: PlacedTile[], y: number): number {
  let lo = 0;
  let hi = column.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const tile = tiles[column[mid]!]!;
    if (tile.y + tile.height < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Global indices of the items whose tiles intersect `[top, bottom]` (grid
 * coordinates), found per column by binary search on the sorted tops.
 * Sorted ascending.
 */
export function visibleIndices(layout: GridLayout, top: number, bottom: number): number[] {
  const result: number[] = [];
  for (const section of layout.sections) {
    const blockTop = section.top + layout.headerHeight;
    if (blockTop + section.masonry.height < top) continue;
    if (section.top > bottom) break;
    const localTop = top - blockTop;
    const localBottom = bottom - blockTop;
    for (const column of section.masonry.columns) {
      for (let i = firstEndingBelow(column, section.masonry.tiles, localTop); i < column.length; i++) {
        const tile = section.masonry.tiles[column[i]!]!;
        if (tile.y > localBottom) break;
        result.push(section.start + column[i]!);
      }
    }
  }
  return result.sort((a, b) => a - b);
}

/** Sections whose header or tiles intersect `[top, bottom]`. */
export function visibleSections(layout: GridLayout, top: number, bottom: number): number[] {
  const result: number[] = [];
  layout.sections.forEach((section, i) => {
    if (sectionBottom(section, layout) >= top && section.top <= bottom) result.push(i);
  });
  return result;
}

/** The section and local index of a global item index. */
export function locate(layout: GridLayout, index: number): { section: number; local: number } | null {
  let lo = 0;
  let hi = layout.sections.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const section = layout.sections[mid]!;
    if (index < section.start) hi = mid - 1;
    else if (index >= section.start + sectionSize(section)) lo = mid + 1;
    else return { section: mid, local: index - section.start };
  }
  return null;
}

/** Top and bottom of an item's tile in grid coordinates. */
export function tileBounds(layout: GridLayout, index: number): { top: number; bottom: number } | null {
  const at = locate(layout, index);
  if (!at) return null;
  const section = layout.sections[at.section]!;
  const tile = section.masonry.tiles[at.local]!;
  const top = section.top + layout.headerHeight + tile.y;
  return { top, bottom: top + tile.height };
}

export type GridDirection = "left" | "right" | "up" | "down";

/**
 * Keyboard neighbour of an item. Left and right walk the sort order, so
 * every asset is reachable in reading order; up and down stay in the
 * column, crossing into the next section at its nearest column that has
 * tiles.
 */
export function neighbourIndex(layout: GridLayout, index: number, direction: GridDirection): number | null {
  if (direction === "left") return index > 0 ? index - 1 : null;
  if (direction === "right") return index + 1 < layout.itemCount ? index + 1 : null;

  const at = locate(layout, index);
  if (!at) return null;
  const section = layout.sections[at.section]!;
  const tile = section.masonry.tiles[at.local]!;
  const column = section.masonry.columns[tile.column]!;
  const position = column.indexOf(at.local);
  const step = direction === "up" ? -1 : 1;
  const within = column[position + step];
  if (within !== undefined) return section.start + within;

  // Off the end of the column: the adjacent section, nearest column with tiles
  const next = layout.sections[at.section + step];
  if (!next) return null;
  const columns = next.masonry.columns;
  let best: number | null = null;
  let bestDistance = Infinity;
  columns.forEach((candidate, c) => {
    if (!candidate.length) return;
    const distance = Math.abs(c - tile.column);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = direction === "up" ? candidate[candidate.length - 1]! : candidate[0]!;
    }
  });
  return best === null ? null : next.start + best;
}
