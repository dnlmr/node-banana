import { describe, expect, it } from "vitest";
import { unloadWarning } from "../unloadWarning";

describe("closing the page", () => {
  it("says generations are still being saved when the workflows are all saved", () => {
    expect(unloadWarning({ unsavedTabs: false, pendingRecordings: 1 })).toBe(
      "A generation is still being saved to your library. Closing now loses it.",
    );
    expect(unloadWarning({ unsavedTabs: false, pendingRecordings: 3 })).toBe(
      "3 generations are still being saved to your library. Closing now loses them.",
    );
  });

  it("names both when workflows are unsaved as well, and only the workflows otherwise", () => {
    expect(unloadWarning({ unsavedTabs: true, pendingRecordings: 2 })).toBe(
      "You have unsaved workflows, and 2 generations are still being saved to your library.",
    );
    expect(unloadWarning({ unsavedTabs: true, pendingRecordings: 0 })).toBe("You have unsaved workflows.");
  });

  it("lets the page close when nothing would be lost", () => {
    expect(unloadWarning({ unsavedTabs: false, pendingRecordings: 0 })).toBeNull();
  });
});
