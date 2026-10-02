import { describe, it, expect } from "vitest";
import { insideAgentWindow, isSaveShortcut } from "../saveShortcut";

const key = (overrides: Partial<Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">>) => ({
  key: "s", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides,
});

describe("isSaveShortcut", () => {
  it("is Cmd+S or Ctrl+S, either case, with no other modifier", () => {
    expect(isSaveShortcut(key({ metaKey: true }))).toBe(true);
    expect(isSaveShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isSaveShortcut(key({ metaKey: true, key: "S" }))).toBe(true);
    expect(isSaveShortcut(key({}))).toBe(false);
    expect(isSaveShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isSaveShortcut(key({ metaKey: true, altKey: true }))).toBe(false);
    expect(isSaveShortcut(key({ metaKey: true, key: "z" }))).toBe(false);
  });
});

describe("insideAgentWindow", () => {
  it("is true only for a target under the agent window", () => {
    const agent = document.createElement("div");
    agent.className = "nb-agent";
    const textarea = document.createElement("textarea");
    agent.appendChild(textarea);
    document.body.appendChild(agent);
    const other = document.createElement("input");
    document.body.appendChild(other);
    expect(insideAgentWindow(textarea)).toBe(true);
    expect(insideAgentWindow(other)).toBe(false);
    expect(insideAgentWindow(null)).toBe(false);
    agent.remove();
    other.remove();
  });
});
