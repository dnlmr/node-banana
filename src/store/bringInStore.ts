import { create } from "zustand";

interface BringInState {
  /** A pending request to open the quickstart on its Bring-in view; the quickstart's host consumes it. */
  request: { at: number } | null;
  consumeRequest: () => void;
}

/**
 * Lets a view outside the quickstart (Settings › Storage's "Choose folder…")
 * open the Bring-in view. Whoever hosts the quickstart watches `request`,
 * opens it on Bring-in and consumes the request.
 */
export const useBringInStore = create<BringInState>((set) => ({
  request: null,
  consumeRequest: () => set({ request: null }),
}));

/** Asks for the quickstart's Bring-in view ("Bring in your projects"). */
export function openBringIn(): void {
  useBringInStore.setState({ request: { at: Date.now() } });
}
