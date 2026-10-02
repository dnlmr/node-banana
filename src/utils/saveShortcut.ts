/**
 * Cmd/Ctrl+S, read off a keydown event.
 *
 * It is the one shortcut that must work while typing: a prompt is where most
 * edits happen, so saving from inside one is expected. The agent window's
 * composer is the exception, since it belongs to a different surface; the
 * canvas leaves that keystroke alone.
 */
export function isSaveShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">): boolean {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "s";
}

/** "⌘S" on a Mac, "Ctrl+S" elsewhere, for tooltips and notices. */
export function saveShortcutLabel(): string {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? "⌘S" : "Ctrl+S";
}

/** True when the keystroke happened inside the agent window. */
export function insideAgentWindow(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".nb-agent") !== null;
}
