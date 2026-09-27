import { useCallback, useRef } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useToast } from "@/components/Toast";
import { fetchAssetBlob } from "@/lib/assets/client/api";

/** A carousel entry: its file name in the generations folder, and its asset library id when it has one. */
export interface GenerationRef {
  id: string;
  assetId?: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Returns a loader for a previously generated asset: from the asset library
 * when the entry has an asset id, otherwise (or when the library cannot
 * serve it) from the configured generations folder via POST
 * /api/load-generation. Node data keeps media as data URLs, so either way
 * the result is one.
 *
 * @param resultField preferred key on the response payload (e.g. "image",
 *   "video", "audio"); falls back to `result.image` when absent.
 * @param label capitalized media label used in log messages (e.g. "Image").
 */
export function useLoadGenerationById(resultField: string, label: string) {
  const generationsPath = useWorkflowStore((state) => state.generationsPath);
  const saveDirectoryPath = useWorkflowStore((state) => state.saveDirectoryPath);
  // Said once per node, not on every arrow press
  const warnedRef = useRef(false);

  return useCallback(
    async (item: GenerationRef): Promise<string | null> => {
      if (item.assetId) {
        try {
          return await blobToDataUrl(await fetchAssetBlob(item.assetId));
        } catch (error) {
          // Deleted from the library, or the library is off: try the folder
          console.warn(`${label} ${item.assetId} could not be loaded from the asset library:`, error);
        }
      }

      // A workflow with a folder keeps its generations beside it even when the
      // path was never recorded; only a workflow with no folder has nowhere to look.
      const directoryPath = generationsPath ?? (saveDirectoryPath ? `${saveDirectoryPath}/generations` : null);
      if (!directoryPath) {
        if (!item.assetId && !warnedRef.current) {
          warnedRef.current = true;
          useToast.getState().show(`Set a project folder to browse ${label.toLowerCase()} history`, "warning");
        }
        return null;
      }

      try {
        const response = await fetch("/api/load-generation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directoryPath,
            imageId: item.id,
          }),
        });

        const result = await response.json();
        if (!result.success) {
          // Missing assets are expected when refs point to deleted/moved files
          console.log(`${label} not found: ${item.id}`);
          return null;
        }
        return result[resultField] || result.image;
      } catch (error) {
        console.warn(`Error loading ${label.toLowerCase()}:`, error);
        return null;
      }
    },
    [generationsPath, saveDirectoryPath, resultField, label]
  );
}
