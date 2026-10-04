import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import type { LibraryStatus, RecordAssetResult } from "@/lib/assets/types";

const sonner = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: sonner }));

const recorder = vi.hoisted(() => ({ listener: null as null | ((result: RecordAssetResult) => void) }));
vi.mock("@/lib/assets/client/recorder", () => ({
  getRecorderLibraryStatus: () => null,
  onAssetRecorded: (listener: (result: RecordAssetResult) => void) => {
    recorder.listener = listener;
    return () => {
      recorder.listener = null;
    };
  },
}));

import { FIRST_RUN_KEY, watchFirstRecording } from "@/components/assets/FirstRunHint";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";

const ROOT = "/Users/ada/Documents/Node Banana";

describe("watchFirstRecording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem(FIRST_RUN_KEY);
    useSettingsDialogStore.setState({ request: null });
  });

  it("shows the 280px hint after the first save, and Change… opens Settings › Storage", () => {
    watchFirstRecording({ available: true, empty: true, root: ROOT } as LibraryStatus);
    recorder.listener?.({ asset: { file: { root: "library" } } } as unknown as RecordAssetResult);

    expect(sonner.custom).toHaveBeenCalledTimes(1);
    const renderCard = sonner.custom.mock.calls[0][0] as () => ReactElement;
    render(renderCard());

    const card = screen.getByTestId("assets-first-run");
    expect(card).toHaveStyle({ width: "280px" });
    expect(screen.getByText("Saved to Documents › Node Banana")).toHaveAttribute("title", ROOT);

    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(useSettingsDialogStore.getState().request?.page).toBe("library");
    expect(window.localStorage.getItem(FIRST_RUN_KEY)).toBe("1");
  });
});
