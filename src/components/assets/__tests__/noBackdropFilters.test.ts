// @vitest-environment node
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * A backdrop filter gives its element a render pass of its own. One per tile
 * (checkbox, badges) or on the sticky day headers meant 60+ of them inside
 * the grid's scroller, and Chromium (Electron on macOS especially) stopped
 * painting whole regions of the view until a hover repainted them. The grid
 * uses solid, near-opaque grounds instead.
 */
describe("Assets view", () => {
  it("uses no backdrop filters in its components", () => {
    const dir = path.join(__dirname, "..");
    const offenders = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".tsx"))
      .filter((name) => /backdrop-(blur|filter|brightness|saturate)|backdropFilter/.test(fs.readFileSync(path.join(dir, name), "utf8")));
    expect(offenders).toEqual([]);
  });
});
