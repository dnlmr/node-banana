import { create } from "zustand";

/** Settings pages that can be opened from outside the settings dialog. */
export type SettingsPageRequest = "project" | "library" | "providers" | "comfy" | "nodeDefaults" | "canvas" | "noodles";

interface SettingsDialogState {
  /** A pending request to open the settings dialog at a page; the dialog's host consumes it. */
  request: { page: SettingsPageRequest; at: number } | null;
  openSettings: (page: SettingsPageRequest) => void;
  consumeRequest: () => void;
}

/**
 * Lets any view (the Assets tab's "Change…" action, the first-run hint) open
 * Settings at a page. The settings dialog is hosted by FloatingMenu, which
 * watches `request`.
 */
export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  request: null,
  openSettings: (page) => set({ request: { page, at: Date.now() } }),
  consumeRequest: () => set({ request: null }),
}));
