"use client";

import { useEffect } from "react";
import { useBringInStore } from "@/store/bringInStore";
import { useWorkflowStore } from "@/store/workflowStore";

/**
 * For the quickstart's host: answers `openBringIn()` (Settings › Storage's
 * "Choose folder…") by opening the welcome dialog on its Bring-in view.
 */
export function useBringInRequest(): void {
  const request = useBringInStore((state) => state.request);
  useEffect(() => {
    if (!request) return;
    useBringInStore.getState().consumeRequest();
    useWorkflowStore.getState().setShowQuickstart(true, "bringIn");
  }, [request]);
}
