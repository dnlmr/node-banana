import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBringInRequest } from "@/components/quickstart/useBringInRequest";
import { openBringIn, useBringInStore } from "@/store/bringInStore";
import { useWorkflowStore } from "@/store/workflowStore";

describe("useBringInRequest", () => {
  beforeEach(() => {
    useBringInStore.setState({ request: null });
    useWorkflowStore.setState({ showQuickstart: false, quickstartView: "initial" });
  });

  it("opens the welcome dialog on Bring-in and consumes the request", () => {
    renderHook(() => useBringInRequest());

    act(() => openBringIn());

    expect(useWorkflowStore.getState().showQuickstart).toBe(true);
    expect(useWorkflowStore.getState().quickstartView).toBe("bringIn");
    expect(useBringInStore.getState().request).toBeNull();
  });
});
