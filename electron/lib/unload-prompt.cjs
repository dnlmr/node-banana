// What main asks when the page blocks its own unload (will-prevent-unload).
// The page blocks both for workflow tabs with unsaved changes and for
// generations still being saved to the asset library (src/app/page.tsx), and
// main cannot tell which, so the wording names both: a user who has just saved
// must not read it as "your workflows are unsaved" and discard a generation
// that is still on its way to the library, and a user with unsaved edits must
// not read it as a save under way that will finish if they wait.
const UNLOAD_PROMPT = Object.freeze({
  type: 'question',
  buttons: Object.freeze(['Keep open', 'Discard and close']),
  defaultId: 0,
  cancelId: 0,
  message: 'You have unsaved changes or generations that are still being saved.',
  detail: 'If you close now, unsaved workflow changes are lost, and so is any generation not yet in your library.',
});

module.exports = { UNLOAD_PROMPT };
