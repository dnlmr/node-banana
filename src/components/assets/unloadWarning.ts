/**
 * What closing the page now would lose, in words, or null when nothing.
 * Generations still on their way to the library are named as such: a user
 * who has just saved their workflows would otherwise take "unsaved
 * workflows" for a false alarm and close, and those generations never land.
 */
export function unloadWarning({ unsavedTabs, pendingRecordings }: { unsavedTabs: boolean; pendingRecordings: number }): string | null {
  const saving =
    pendingRecordings > 0
      ? `${pendingRecordings === 1 ? "a generation is" : `${pendingRecordings.toLocaleString("en-US")} generations are`} still being saved to your library`
      : null;
  if (unsavedTabs && saving) return `You have unsaved workflows, and ${saving}.`;
  if (unsavedTabs) return "You have unsaved workflows.";
  if (saving) return `${saving.charAt(0).toUpperCase()}${saving.slice(1)}. Closing now loses ${pendingRecordings === 1 ? "it" : "them"}.`;
  return null;
}
