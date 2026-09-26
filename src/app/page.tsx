"use client";

import { DesktopSession } from "@/components/DesktopSession";
import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { FloatingMenu } from "@/components/FloatingMenu";
import { WorkflowTabs } from "@/components/WorkflowTabs";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { FloatingActionBar } from "@/components/FloatingActionBar";
import { AnnotationModal } from "@/components/AnnotationModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useWorkflowStore } from "@/store/workflowStore";
import { FTUXModal } from "@/components/onboarding/FTUXModal";
import { getFTUXCompleted, setFTUXCompleted } from "@/store/utils/localStorage";
import { useFTUXStore } from "@/store/ftuxStore";
import { anyWorkflowTabUnsaved } from "@/store/utils/workflowTabs";
import { useAssetStore } from "@/store/assetStore";
import { AssetsView } from "@/components/assets/AssetsView";
import { watchFirstRecording } from "@/components/assets/FirstRunHint";
import { unloadWarning } from "@/components/assets/unloadWarning";
import { initAssetLibrary, pendingRecordings } from "@/lib/assets/client/recorder";

export default function Home() {
  return <DesktopSession><Editor /></DesktopSession>;
}

/** One library init per page load, however often the effect below runs (Strict Mode runs it twice). */
let libraryInit: ReturnType<typeof initAssetLibrary> | null = null;

function Editor() {
  const initializeAutoSave = useWorkflowStore(
    (state) => state.initializeAutoSave
  );
  const cleanupAutoSave = useWorkflowStore((state) => state.cleanupAutoSave);
  const setShowQuickstart = useWorkflowStore((state) => state.setShowQuickstart);
  const [showFTUX, setShowFTUX] = useState(false);
  const assetsShown = useAssetStore((state) => state.appView === "assets");

  useEffect(() => {
    initializeAutoSave();
    return () => cleanupAutoSave();
  }, [initializeAutoSave, cleanupAutoSave]);

  // The asset library: ask the server where it is (recording stays off until
  // it answers that it is available), and say once where the first asset went
  useEffect(() => {
    let cancelled = false;
    let stopHint = () => {};
    libraryInit ??= initAssetLibrary();
    libraryInit
      .then((status) => {
        if (cancelled) return;
        useAssetStore.getState().setLibrary(status);
        stopHint = watchFirstRecording(status);
      })
      .catch((error) => console.warn("Asset library unavailable:", error));
    return () => {
      cancelled = true;
      stopHint();
    };
  }, []);

  // While Assets shows, the canvas behind counts as covered: React Flow's
  // delete, pan and selection stay off (its key handler has its own guard)
  useEffect(() => {
    if (!assetsShown) return;
    useWorkflowStore.getState().incrementModalCount();
    return () => useWorkflowStore.getState().decrementModalCount();
  }, [assetsShown]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const { tabs, hasUnsavedChanges } = useWorkflowStore.getState();
      // Unsaved tabs, or generations still on their way to the library, each said as what it is
      const warning = unloadWarning({
        unsavedTabs: anyWorkflowTabUnsaved(tabs, { hasUnsavedChanges }),
        pendingRecordings: pendingRecordings(),
      });
      if (warning) {
        e.preventDefault();
        // Browsers show their own words; this is the reason for anything that reads it
        e.returnValue = warning;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Client-side only FTUX check (SSR-safe)
  useEffect(() => {
    if (!getFTUXCompleted()) {
      setShowFTUX(true);
    }
  }, []);

  const handleFTUXComplete = () => {
    setShowFTUX(false);
    setFTUXCompleted(true);
  };

  const handleStartTutorial = () => {
    setShowFTUX(false);
    setFTUXCompleted(true);
    setShowQuickstart(false); // Close WelcomeModal if open
    useFTUXStore.getState().startTutorial();
  };

  return (
    <ReactFlowProvider>
      <div className="h-screen flex flex-col bg-[#0f0f0f]">
        <WorkflowTabs />
        {/* The floating menu is positioned against this box, so it clears the tab
            strip. The box is the canvas frame: rounded top corners the active tab
            flows into. It must not isolate its stacking: modals and menus inside
            it are fixed and have to cover the strip too. */}
        <div className="workflow-canvas-frame relative mx-1 mb-1 flex-1 min-h-0 flex flex-col overflow-hidden rounded-t-lg border border-card-border bg-canvas-bg">
        {/* The canvas stays mounted under the Assets view (React Flow keeps
            measuring, a run or an agent turn keeps going), but inert and
            invisible, which also hides its fixed floaters */}
        <div className={`flex min-h-0 flex-1 flex-col ${assetsShown ? "invisible" : ""}`} inert={assetsShown}>
        <ErrorBoundary
          label="Canvas"
          onError={(error, info) =>
            console.error("Canvas crashed:", error, info)
          }
          fallback={(error, reset) => (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="text-sm font-semibold text-red-400">
                The canvas hit an unexpected error
              </div>
              <div className="text-xs text-neutral-400 max-w-md break-words">
                {error.message || "Unexpected render error"}
              </div>
              <div className="text-xs text-neutral-500 max-w-md">
                Your workflow is still in memory. Try recovering the canvas, or
                reload the page.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-1.5 text-xs rounded-md border border-red-500 text-red-300 hover:bg-red-500/10"
                >
                  Try to recover
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="px-3 py-1.5 text-xs rounded-md border border-neutral-600 text-neutral-300 hover:bg-neutral-700/40"
                >
                  Reload page
                </button>
              </div>
            </div>
          )}
        >
          <WorkflowCanvas />
        </ErrorBoundary>
        </div>
        {/* Hidden, not unmounted, while Assets shows: it hosts the settings and
            shortcuts dialogs, which render inline and must still open from
            there. Only its own chrome hides; an open dialog's overlay stays. */}
        <div className={assetsShown ? "contents [&>:not([data-dialog-overlay])]:hidden" : "contents"}>
          <FloatingMenu />
        </div>
        {assetsShown && (
          <div className="absolute inset-0 z-[60] flex">
            <ErrorBoundary
              label="Assets"
              onError={(error, info) => console.error("Assets view crashed:", error, info)}
              fallback={(error, reset) => (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-canvas-bg p-6 text-center">
                  <div className="text-sm font-semibold text-red-400">The Assets view hit an unexpected error</div>
                  <div className="max-w-md break-words text-xs text-neutral-400">{error.message || "Unexpected render error"}</div>
                  <div className="text-xs text-neutral-500">Your files and workflows are not affected.</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-md border border-neutral-600 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/40"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={() => useAssetStore.getState().setAppView("canvas")}
                      className="rounded-md border border-neutral-600 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/40"
                    >
                      Back to canvas
                    </button>
                  </div>
                </div>
              )}
            >
              <AssetsView />
            </ErrorBoundary>
          </div>
        )}
        </div>
        <div hidden={assetsShown} inert={assetsShown}>
          <FloatingActionBar />
        </div>
        <AnnotationModal />
        {showFTUX && (
          <FTUXModal
            onComplete={handleFTUXComplete}
            onStartTutorial={handleStartTutorial}
          />
        )}
      </div>
    </ReactFlowProvider>
  );
}
