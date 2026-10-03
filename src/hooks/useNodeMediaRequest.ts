"use client";

import { useCallback, useEffect, useRef } from "react";
import { useWorkflowStore } from "@/store/workflowStore";

/**
 * Scopes a node's deferred file reads (FileReader, metadata probes) to the
 * upload that started them. `beginRequest` returns a check that turns false
 * once a later upload or a removal supersedes it, the node unmounts, or the
 * canvas is replaced (a load or tab switch can bring back a node with the
 * same id).
 */
export function useNodeMediaRequest() {
  const requestId = useRef(0);
  const cancelRequest = useCallback(() => {
    requestId.current += 1;
  }, []);

  useEffect(() => cancelRequest, [cancelRequest]);

  const beginRequest = useCallback(() => {
    const currentRequest = ++requestId.current;
    const generation = useWorkflowStore.getState().canvasGeneration;
    return () =>
      requestId.current === currentRequest && useWorkflowStore.getState().canvasGeneration === generation;
  }, []);

  return { beginRequest, cancelRequest };
}
