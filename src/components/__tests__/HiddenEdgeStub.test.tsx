import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { HiddenEdgeStub, STUB_DOUBLE_CLICK_MS } from "@/components/edges/HiddenEdgeStub";

const onSelect = vi.fn();
const onCommit = vi.fn();
const onHoverChange = vi.fn();

const renderStub = (overrides: Partial<React.ComponentProps<typeof HiddenEdgeStub>> = {}) =>
  render(
    <HiddenEdgeStub
      side="target"
      x={10}
      y={20}
      direction={-1}
      label="Texts"
      color="#fff"
      selected={false}
      onHoverChange={onHoverChange}
      onSelect={onSelect}
      rename={{ value: "", ariaLabel: "Rename stack", onCommit }}
      {...overrides}
    />
  );

const pill = () => screen.getByTestId("hidden-edge-stub-target").querySelector("button")!;
const input = () => screen.getByRole("textbox", { name: "Rename stack" }) as HTMLInputElement;

describe("HiddenEdgeStub", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("shows the label and selects on click", () => {
    renderStub();
    expect(pill()).toHaveTextContent("Texts");
    fireEvent.click(pill());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("opens an input in the pill on double-click, starting from the own label", () => {
    renderStub({ rename: { value: "Model", ariaLabel: "Rename stack", onCommit } });
    fireEvent.doubleClick(pill());
    expect(input().value).toBe("Model");
    expect(input()).toHaveFocus();
    expect(input().placeholder).toBe("Texts");
    expect(input().className).toContain("nodrag");
    expect(input().className).toContain("nopan");
  });

  it("commits on Enter", () => {
    renderStub();
    fireEvent.doubleClick(pill());
    fireEvent.change(input(), { target: { value: "Model" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Model");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(pill()).toBeTruthy();
  });

  it("commits on blur", () => {
    renderStub();
    fireEvent.doubleClick(pill());
    fireEvent.change(input(), { target: { value: "Model" } });
    fireEvent.blur(input());
    expect(onCommit).toHaveBeenCalledWith("Model");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("cancels on Escape", () => {
    renderStub();
    fireEvent.doubleClick(pill());
    fireEvent.change(input(), { target: { value: "Model" } });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(pill()).toHaveTextContent("Texts");
  });

  it("keeps keys and pointer presses in the input from reaching the canvas", () => {
    const onKeyDown = vi.fn();
    const onPointerDown = vi.fn();
    render(
      <div onKeyDown={onKeyDown} onPointerDown={onPointerDown}>
        <HiddenEdgeStub
          side="target" x={0} y={0} direction={1} label="Texts" color="#fff" selected={false}
          onHoverChange={onHoverChange} onSelect={onSelect} rename={{ value: "", ariaLabel: "Rename stack", onCommit }}
        />
      </div>
    );
    fireEvent.doubleClick(pill());
    fireEvent.keyDown(input(), { key: "Backspace" });
    fireEvent.pointerDown(input());
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it("does not open the canvas's double-click search", () => {
    const onDoubleClick = vi.fn();
    render(
      <div onDoubleClick={onDoubleClick}>
        <HiddenEdgeStub
          side="target" x={0} y={0} direction={1} label="Texts" color="#fff" selected={false}
          onHoverChange={onHoverChange} onSelect={onSelect}
        />
      </div>
    );
    fireEvent.doubleClick(pill());
    expect(onDoubleClick).not.toHaveBeenCalled();
    // Without a rename there is nothing to edit
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("holds a click until a double-click is ruled out when asked to", () => {
    vi.useFakeTimers();
    renderStub({ waitForDoubleClick: true });
    fireEvent.click(pill(), { detail: 1 });
    expect(onSelect).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(STUB_DOUBLE_CLICK_MS));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("drops the held click when it turns out to be a double-click", () => {
    vi.useFakeTimers();
    renderStub({ waitForDoubleClick: true });
    fireEvent.click(pill(), { detail: 1 });
    fireEvent.click(pill(), { detail: 2 });
    fireEvent.doubleClick(pill());
    act(() => vi.advanceTimersByTime(STUB_DOUBLE_CLICK_MS * 2));
    expect(onSelect).not.toHaveBeenCalled();
    expect(input()).toBeTruthy();
  });
});
