/**
 * The progress line under a running turn: the server's lines ("Fallooning…",
 * "Planning edits…") in italics and the answering harness's colour, and
 * text-only status parts from older servers in the usual ink.
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
  return { status, background: text.style.backgroundImage, italic: text.classList.contains("italic") };
}

describe("AgentConversation progress line", () => {
  it("says Fallooning…, italic, in clay for Claude Code", () => {
    const { status, background, italic } = renderLine({ text: "Fallooning…", harness: "claude", renderedParts: 0 });
    expect(status.textContent).toBe("Fallooning…");
    expect(background).toContain("#D97757");
    expect(italic).toBe(true);
  });

  it("says Fallooning… in blue for Codex", () => {
    const { status, background } = renderLine({ text: "Fallooning…", harness: "codex", renderedParts: 0 });
    expect(status.textContent).toBe("Fallooning…");
    expect(background).toContain("#3b82f6");
  });

  it("styles a tool-call line the same way", () => {
    const { status, background, italic } = renderLine({ text: "Planning edits…", harness: "codex", renderedParts: 0 });
    expect(status.textContent).toBe("Planning edits…");
    expect(background).toContain("#3b82f6");
    expect(italic).toBe(true);
  });

  it("renders a text-only status part in the usual ink", () => {
    const { status, background, italic } = renderLine({ text: "Starting Claude Code…", renderedParts: 0 });
    expect(italic).toBe(false);
    expect(status.textContent).toBe("Starting Claude Code…");
    expect(background).toContain("var(--color-ink-3)");
    expect(background).not.toContain("#D97757");
  });
});
