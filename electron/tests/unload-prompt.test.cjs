const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { UNLOAD_PROMPT } = require('../lib/unload-prompt.cjs');

test('the close prompt names both reasons the page can block, not only unsaved workflows', () => {
  const text = `${UNLOAD_PROMPT.message}\n${UNLOAD_PROMPT.detail}`;
  // The page also blocks while a generation is still being saved to the
  // library, with every workflow saved; blaming workflows alone misleads.
  assert.doesNotMatch(UNLOAD_PROMPT.message, /workflows?\?$/i);
  assert.match(text, /workflow/i);
  assert.match(text, /generation/i);
  assert.match(text, /library/i);
});

test('the headline does not claim a save is under way', () => {
  // Most often the page blocks for unsaved workflow edits, which nothing is
  // saving: "still saving your work" would have the user wait for nothing.
  assert.doesNotMatch(UNLOAD_PROMPT.message, /\b(is|are) still saving\b|\bsaving your work\b/i);
  assert.match(UNLOAD_PROMPT.message, /unsaved changes/i);
  assert.match(UNLOAD_PROMPT.message, /generations? that (is|are) still being saved/i);
});

test('the safe choice stays first, the default and the cancel; closing is button 1', () => {
  assert.equal(UNLOAD_PROMPT.buttons.length, 2);
  assert.equal(UNLOAD_PROMPT.defaultId, 0);
  assert.equal(UNLOAD_PROMPT.cancelId, 0);
  // main.cjs closes on choice 1; the acceptance scripts pick it by this label.
  assert.equal(UNLOAD_PROMPT.buttons[1], 'Discard and close');
  assert.ok(Object.isFrozen(UNLOAD_PROMPT) && Object.isFrozen(UNLOAD_PROMPT.buttons));
});

test('main answers will-prevent-unload with this prompt', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.match(main, /require\('\.\/lib\/unload-prompt\.cjs'\)/);
  assert.match(main, /'will-prevent-unload'[^\n]*\n[^\n]*showMessageBoxSync\(current, \{ \.\.\.UNLOAD_PROMPT/);
});
