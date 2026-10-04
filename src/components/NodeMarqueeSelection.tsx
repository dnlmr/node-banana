"use client";

import { useEffect } from "react";
import { useStoreApi } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { boxOf, marqueeTakesNode, type Box, type NodeBoxes } from "@/lib/nodes/marqueeSelection";

/** Each node's screen boxes, measured once per marquee: nodes do not move while one is drawn. */
export function measureNodeBoxes(domNode: Element, ids: string[]): Map<string, NodeBoxes> {
  const boxes = new Map<string, NodeBoxes>();
  for (const id of ids) {
    const element = domNode.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
    if (!element) continue;
    const card = element.querySelector("[data-media-card]");
    boxes.set(id, { node: boxOf(element.getBoundingClientRect()), mediaCard: card ? boxOf(card.getBoundingClientRect()) : null });
  }
  return boxes;
}

/**
 * The marquee's node selection, by our rule: a node is taken when the marquee
 * holds its media card whole (its whole self, when it has no media card).
 *
 * React Flow draws the marquee and proposes selections by overlap, which the
 * canvas vetoes (handleNodesChange); but React Flow proposes each node once,
 * so a veto would leave a node unselectable for the rest of that marquee. This
 * follows the rectangle itself and keeps the store's selection equal to the
 * set the rule gives, as the edge marquee does for noodles.
 */
export function NodeMarqueeSelection({ disabled, measure = measureNodeBoxes }: { disabled: boolean; measure?: typeof measureNodeBoxes }) {
  const flow = useStoreApi();
  useEffect(() => {
    if (disabled) return;
    let boxes: Map<string, NodeBoxes> | null = null;
    return flow.subscribe((state, previous) => {
      const rect = state.userSelectionRect;
      if (!rect) { boxes = null; return; }
      if (!state.userSelectionActive || rect === previous.userSelectionRect || !state.domNode) return;
      const store = useWorkflowStore.getState();
      if (!boxes) boxes = measure(state.domNode, store.nodes.map((node) => node.id));
      const bounds = state.domNode.getBoundingClientRect();
      const marquee: Box = { left: bounds.left + rect.x, top: bounds.top + rect.y, right: bounds.left + rect.x + rect.width, bottom: bounds.top + rect.y + rect.height };
      const changes = store.nodes.flatMap((node) => {
        const nodeBoxes = boxes!.get(node.id);
        if (!nodeBoxes || node.selectable === false) return [];
        const take = marqueeTakesNode(marquee, nodeBoxes);
        return Boolean(node.selected) !== take ? [{ type: "select" as const, id: node.id, selected: take }] : [];
      });
      if (changes.length) store.onNodesChange(changes);
    });
  }, [disabled, flow, measure]);
  return null;
}
