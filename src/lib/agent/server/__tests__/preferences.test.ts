// @vitest-environment node
/**
 * Preferences stated early in a chat must still reach the agent later in it.
 * Each case is one place a turn-1 preference used to fall out by turn 3
 * (docs/agent-memory-spike.md has the trace). `it.fails` marks a loss that
 * still happens.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildAgentSystemPrompt } from "../../prompt";
import { createAgentChatStream } from "../chatStream";
import { CODEX_DEVELOPER_INSTRUCTIONS } from "../codexHarness";
import { withConversationHistory } from "../history";
import type { AgentHarness, AgentHarnessStatus, AgentUIMessage, HarnessTurnParams } from "../../types";

const PREFERENCE = "From now on write every prompt in British English and use Seedream 4 for images.";

function text(role: "user" | "assistant", body: string, id: string): AgentUIMessage {
  return { id, role, parts: [{ type: "text", text: body }] };
}

/** Turn 1 states the preference, turn 2 is unrelated, turn 3 should honour it. */
const conversation: AgentUIMessage[] = [
  text("user", PREFERENCE, "u1"),
  text("assistant", "Noted. Built a portrait workflow with Seedream 4.", "a1"),
  text("user", "Group the nodes into a stage.", "u2"),
  text("assistant", "Grouped them as Portrait.", "a2"),
  text("user", "Add a second generator for a landscape.", "u3"),
];

function status(): AgentHarnessStatus {
  return {
    id: "codex",
    label: "Codex",
    installed: true,
    signedIn: true,
    billing: "subscription",
    models: [
      { id: "gpt-a", label: "GPT A", isDefault: true },
      { id: "gpt-b", label: "GPT B" },
    ],
    signIn: { state: "idle" },
    signInCommand: "codex login",
  };
}

async function runTurn(model: string): Promise<HarnessTurnParams> {
  const turns: HarnessTurnParams[] = [];
  const harness: AgentHarness = {
    id: "codex",
    label: "Codex",
    getStatus: async () => status(),
    startSignIn: async () => ({ state: "pending" }),
    runTurn: (params) => {
      turns.push(params);
      return (async function* () {})();
    },
  };
  const stream = createAgentChatStream({
    body: {
      id: `chat-${model}`,
      harness: "codex",
      model,
      sessionId: "thread-1",
      messages: conversation,
      workflow: { nodes: [], edges: [], groups: [], selectedNodeIds: [] },
    },
    harness,
    signal: new AbortController().signal,
    createToolRuntime: () => ({ definitions: [], execute: async () => ({ ok: true, text: "", summary: "", ops: [] }) }),
    buildSystemPrompt: () => "SYSTEM",
  });
  const reader = stream.getReader();
  while (!(await reader.read()).done);
  return turns[0];
}

describe("a preference stated earlier in the chat", () => {
  it.fails("is covered by a rule that keeps it standing, ahead of the saved defaults", () => {
    const prompt = buildAgentSystemPrompt({ harness: "claude" });
    // Rule 6 used to apply only what "the user named" and leave everything else
    // to the saved defaults, so a model chosen in turn 1 was dropped in turn 3.
    expect(prompt).toMatch(/earlier in the conversation/);
    expect(prompt).toMatch(/hold for the rest of the conversation until they change them/);
    // "Use Opus" in the chat cannot switch the agent's own model; it must say where to.
    expect(prompt).toMatch(/model menu at the top of this chat/);
  });

  it.fails("is not overridden by Codex's guard against the user's AGENTS.md", () => {
    // The guard told Codex to ignore "dialect, language … preferences" and reply
    // in "neutral English", with nothing tying that to the files alone.
    expect(CODEX_DEVELOPER_INSTRUCTIONS).toMatch(/those files describe/);
    expect(CODEX_DEVELOPER_INSTRUCTIONS).toMatch(/What the user asks for in this chat, including preferences from earlier messages, always applies/);
  });

  it.fails("survives a switch of model in the panel: the system prompt (Codex's thread signature) stays the same", async () => {
    const before = await runTurn("gpt-a");
    const after = await runTurn("gpt-b");
    // A different system prompt starts a new Codex thread, seeded with text only.
    expect(after.systemPrompt).toBe(before.systemPrompt);
    expect(before.prompt).toContain("You are running on GPT A");
    expect(after.prompt).toContain("You are running on GPT B");
  });

  it.fails("stays in the replay that seeds a new session, even when later turns fill the budget", () => {
    const history = [
      { role: "user" as const, text: PREFERENCE },
      ...Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 ? ("user" as const) : ("assistant" as const),
        text: `turn ${i} ${"words ".repeat(400)}`,
      })),
    ];
    const seeded = withConversationHistory(history, "<user>Add a second generator.</user>");
    expect(seeded).toContain(PREFERENCE);
  });
});
