"use client";

import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { defaultNodeDimensions } from "@/store/utils/nodeDefaults";

export interface AddMediaNodeOptions {
  kind: "image" | "video";
  src: string;
  filename: string;
}

/**
 * Put a piece of media on the canvas as an input node, at the middle of the
 * viewport (nudged off anything already there), selected. What "Add to
 * graph" in the media viewer does, for the history and the output gallery.
 */
export function useAddMediaNode() {
  const { screenToFlowPosition, setNodes } = useReactFlow();
  const addNode = useWorkflowStore((state) => state.addNode);
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);

  return useCallback(
    ({ kind, src, filename }: AddMediaNodeOptions): string => {
      const type = kind === "video" ? "videoInput" : "imageInput";
      const { width, height } = defaultNodeDimensions[type];
      const centre = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const position = { x: centre.x - width / 2, y: centre.y - height / 2 };
      const id =
        kind === "video"
          ? addNode("videoInput", position, { video: src, filename })
          : addNode("imageInput", position, { image: src, filename });

      if (kind === "image" && typeof Image !== "undefined") {
        const img = new Image();
        img.onload = () => updateNodeData(id, { dimensions: { width: img.width, height: img.height } });
        img.src = src;
      }

      setNodes((nodes) => nodes.map((node) => ({ ...node, selected: node.id === id })));
      return id;
    },
    [screenToFlowPosition, setNodes, addNode, updateNodeData],
  );
}
