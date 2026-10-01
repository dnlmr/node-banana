import { describe, it, expect } from "vitest";
import { GROUP_COLORS, GROUP_COLOR_LABELS, GROUP_COLOR_ORDER } from "@/store/utils/nodeDefaults";
import { groupBaseColor, groupColorLabel, groupFill, groupLabelColor, isGroupColor } from "../groupColors";

describe("group colours", () => {
  it("keeps the six keys that saved workflows and the agent carry", () => {
    expect(GROUP_COLOR_ORDER).toEqual(["neutral", "blue", "green", "purple", "orange", "red"]);
    expect(Object.keys(GROUP_COLORS).sort()).toEqual([...GROUP_COLOR_ORDER].sort());
    expect(Object.keys(GROUP_COLOR_LABELS).sort()).toEqual([...GROUP_COLOR_ORDER].sort());
  });

  it("paints a key as a faint fill of its hue and a lifted label colour", () => {
    expect(groupBaseColor("green")).toBe("#8fa34a");
    expect(groupFill("green")).toBe("rgba(143, 163, 74, 0.09)");
    expect(groupLabelColor("green")).toBe("#c1cc9b");
    expect(groupColorLabel("green")).toBe("Olive");
  });

  it("falls back to neutral for a key it does not know, so older files still render", () => {
    expect(isGroupColor("blue")).toBe(true);
    expect(isGroupColor("teal")).toBe(false);
    expect(isGroupColor(undefined)).toBe(false);
    expect(groupFill("teal")).toBe(groupFill("neutral"));
    expect(groupLabelColor(undefined)).toBe(groupLabelColor("neutral"));
  });
});
