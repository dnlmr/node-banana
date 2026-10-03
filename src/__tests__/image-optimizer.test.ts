// @vitest-environment node
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import sharedConfig from "../../next.config.shared.cjs";

describe("Next image optimizer", () => {
  // Leaving next/image unused does not turn off the /_next/image endpoint;
  // only this setting does, for the browser build and the packaged app alike.
  it("is off in the shared config the desktop build uses", () => {
    expect(sharedConfig.images?.unoptimized).toBe(true);
  });

  it("is off in the browser build", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });
});
