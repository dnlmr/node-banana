import { GROUP_COLORS, GROUP_COLOR_LABELS } from "@/store/utils/nodeDefaults";
import type { GroupColor } from "@/types";

/**
 * How a group's colour key becomes paint. Keys are what saved workflows and
 * the agent carry (`neutral`, `blue`, …), so they never change; the hues
 * behind them are the "Earth" set and a group is painted with its hue once,
 * lightly: a faint fill with no outline, and the name in a tinted text
 * colour above it. An unknown key (an older or hand-edited file) falls back
 * to neutral rather than rendering nothing.
 */

/** Fill alpha over the canvas. */
export const GROUP_FILL_ALPHA = 0.09;

/** How far the label colour is pulled towards white from the base hue. */
const LABEL_LIGHTEN = 0.45;

export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(GROUP_COLORS, value);
}

/** The hue behind a colour key, neutral for anything unknown. */
export function groupBaseColor(color: unknown): string {
  return GROUP_COLORS[isGroupColor(color) ? color : "neutral"];
}

export function groupColorLabel(color: GroupColor): string {
  return GROUP_COLOR_LABELS[color];
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** The group body: the hue at a faint alpha, no outline. */
export function groupFill(color: unknown): string {
  const [r, g, b] = channels(groupBaseColor(color));
  return `rgba(${r}, ${g}, ${b}, ${GROUP_FILL_ALPHA})`;
}

/** The group name: the hue lifted towards white so it reads on the canvas. */
export function groupLabelColor(color: unknown): string {
  const hex = channels(groupBaseColor(color))
    .map((c) => Math.round(c + (255 - c) * LABEL_LIGHTEN).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}
