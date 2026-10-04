import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentButton } from "@/components/agent/AgentButton";

describe("AgentButton", () => {
  it("toggles and reports its pressed state", () => {
    const onClick = vi.fn();
    const { rerender } = render(<AgentButton open={false} harness="claude" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Open agent" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<AgentButton open harness="claude" onClick={onClick} />);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("sits where it is told, as a 40px chrome card holding a labelled pill", () => {
    render(<AgentButton open={false} harness="claude" onClick={vi.fn()} style={{ right: 16, top: 16 }} />);
    const card = screen.getByTestId("agent-button");
    expect(card).toHaveStyle({ right: "16px", top: "16px" });
    expect(card.className).toContain("nodrag");
    expect(card.className).toContain("h-10");
    expect(card.className).toContain("backdrop-blur-md");
    const button = screen.getByRole("button", { name: "Open agent" });
    expect(card).toContainElement(button);
    expect(button).toHaveTextContent("Agent");
  });

  it("shows the mark of the harness that will answer", () => {
    const { container, rerender } = render(<AgentButton open={false} harness="claude" onClick={vi.fn()} />);
    expect(container.querySelector("svg path")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    rerender(<AgentButton open={false} harness="codex" onClick={vi.fn()} />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/agent/codex-mark.png");
    expect(container.querySelector("svg path")).toBeNull();
    expect(screen.queryByTestId("agent-marks-both")).toBeNull();
  });

  it("offers both harnesses until the agent has been opened", () => {
    const { container } = render(<AgentButton open={false} harness={null} onClick={vi.fn()} />);
    const both = screen.getByTestId("agent-marks-both");
    expect(both.querySelector("svg path")).not.toBeNull();
    expect(both.querySelector("img")).toHaveAttribute("src", "/agent/codex-mark.png");
    expect(container).toHaveTextContent("Agent");
  });

  it("lights up like an open chrome button while the window is open", () => {
    const { rerender } = render(<AgentButton open={false} harness="claude" onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Open agent" });
    expect(button.className).not.toContain("bg-white/10");
    rerender(<AgentButton open harness="claude" onClick={vi.fn()} />);
    expect(button.className).toContain("bg-white/10");
  });

  it("is disabled and dimmed while the tutorial locks features", () => {
    render(<AgentButton open={false} harness="claude" disabled dimmed onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Open agent" })).toBeDisabled();
    expect(screen.getByTestId("agent-button").className).toContain("opacity-30");
  });

  it("says it is working while a turn runs, with a dot on the mark", () => {
    const { rerender } = render(<AgentButton open={false} harness="claude" busy onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Agent — working" });
    expect(button).toHaveTextContent("Working…");
    expect(screen.getByTestId("agent-busy-dot")).toBeInTheDocument();
    rerender(<AgentButton open={false} harness="claude" onClick={vi.fn()} />);
    expect(screen.queryByTestId("agent-busy-dot")).toBeNull();
    expect(button).toHaveTextContent("Agent");
  });

  it("flags a harness that needs sign-in, but never over the working dot", () => {
    const { rerender } = render(<AgentButton open={false} harness="claude" attention onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Agent — needs sign-in" })).toBeInTheDocument();
    expect(screen.getByTestId("agent-attention-dot")).toBeInTheDocument();
    rerender(<AgentButton open={false} harness="claude" attention busy onClick={vi.fn()} />);
    expect(screen.queryByTestId("agent-attention-dot")).toBeNull();
    expect(screen.getByTestId("agent-busy-dot")).toBeInTheDocument();
  });

  it("reports its width so the history button can sit beside it", () => {
    const onWidthChange = vi.fn();
    render(<AgentButton open={false} harness="claude" onClick={vi.fn()} onWidthChange={onWidthChange} />);
    expect(onWidthChange).toHaveBeenCalledWith(expect.any(Number));
  });
});
