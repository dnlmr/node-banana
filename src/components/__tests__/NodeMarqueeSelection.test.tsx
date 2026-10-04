import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { NodeMarqueeSelection } from "../NodeMarqueeSelection";
import { useWorkflowStore } from "@/store/workflowStore";
import type { WorkflowNode } from "@/types";
import type { NodeBoxes } from "@/lib/nodes/marqueeSelection";

const initial = useWorkflowStore.getState();
let flow: ReturnType<typeof useStoreApi>;
function Capture() { flow = useStoreApi(); return null; }
const node = (id: string, type: string): WorkflowNode => ({ id, type, data: {}, position: { x: 0, y: 0 } } as WorkflowNode);
beforeEach(() => useWorkflowStore.setState({ ...initial, nodes: [node("gen", "nanoBanana"), node("logic", "router")], edges: [] }));
afterEach(() => { cleanup(); useWorkflowStore.setState(initial); });

// A generate node: a 300×200 media card over a controls card, 320 tall in all; a logic node with no card.
const boxes = new Map<string, NodeBoxes>([
  ["gen", { node: { left: 100, top: 100, right: 400, bottom: 420 }, mediaCard: { left: 100, top: 100, right: 400, bottom: 300 } }],
  ["logic", { node: { left: 500, top: 100, right: 700, bottom: 200 }, mediaCard: null }],
]);
function setup() {
  const view = render(<ReactFlowProvider><Capture /><div><NodeMarqueeSelection disabled={false} measure={() => boxes} /></div></ReactFlowProvider>);
  const domNode = view.container.firstChild as HTMLDivElement;
  domNode.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
  act(() => flow.setState({ domNode }));
}
const marquee = (x: number, y: number, width: number, height: number) =>
  act(() => flow.setState({ userSelectionActive: true, userSelectionRect: { x, y, width, height, startX: x, startY: y } }));
const selected = () => useWorkflowStore.getState().nodes.filter((n) => n.selected).map((n) => n.id);

it("takes a node once its media card is inside whole, controls card or not", () => {
  setup();
  marquee(90, 90, 320, 150); // half the picture
  expect(selected()).toEqual([]);
  marquee(90, 90, 320, 220); // the whole picture, none of the controls
  expect(selected()).toEqual(["gen"]);
});

it("lets a node go when the marquee no longer holds its card, and takes a cardless node only whole", () => {
  setup();
  marquee(90, 90, 620, 220);
  expect(selected()).toEqual(["gen", "logic"]);
  marquee(90, 90, 550, 220); // the logic node is cut; the generate node's card still inside
  expect(selected()).toEqual(["gen"]);
  marquee(250, 90, 400, 220); // the picture is cut too
  expect(selected()).toEqual([]);
});

it("keeps the selection when the marquee is released", () => {
  setup();
  marquee(90, 90, 320, 220);
  act(() => flow.setState({ userSelectionActive: false, userSelectionRect: null }));
  expect(selected()).toEqual(["gen"]);
});
