/**
 * The progress line under a running turn: the opening "Fallooning" in the
 * answering harness's colour, and plain lines (including text-only status
 * parts from older servers) in the usual ink.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentConversation, type AgentConversationProps } from "@/components/agent/AgentConversation";
import type { AgentUIMessage } from "@/lib/agent/types";

const user: AgentUIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "add a prompt node" }] };

function renderLine(statusLine: AgentConversationProps["statusLine"]) {
  render(
    <AgentConversation
      messages={[user]}
      busy
      statusLine={statusLine}
      stoppedMessageIds={new Set()}
      error={undefined}
      onRetry={() => {}}
      onDismissError={() => {}}
      onSignIn={() => {}}
    />,
  );
  const status = screen.getByRole("status");
  const text = status.firstElementChild as HTMLElement;
  return { status, background: text.style.backgroundImage };
}

describe("AgentConversation progress line", () => {
  it("says Fallooning in clay for Claude Code", () => {
    const { status, background } = renderLine({ text: "Fallooning", harness: "claude", renderedParts: 0 });
    expect(status.textContent).toBe("Fallooning");
    expect(background).toContain("#D97757");
  });

  it("says Fallooning in blue for Codex", () => {
    const { status, background } = renderLine({ text: "Fallooning", harness: "codex", renderedParts: 0 });
    expect(status.textContent).toBe("Fallooning");
    expect(background).toContain("#3b82f6");
  });

  it("renders a text-only status part in the usual ink", () => {
    const { status, background } = renderLine({ text: "Starting Claude Code…", renderedParts: 0 });
    expect(status.textContent).toBe("Starting Claude Code…");
    expect(background).toContain("var(--color-ink-3)");
    expect(background).not.toContain("#D97757");
  });
});
