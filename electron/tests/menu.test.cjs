const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMenuTemplate } = require('../lib/menu.cjs');

const handlers = () => ({ onSave: () => {}, onCheckForUpdates: () => {}, onOpenLogs: () => {}, onRestartServer: () => {}, onRecoverEditor: () => {} });

test('File › Save carries Cmd/Ctrl+S and asks the window to save', () => {
  let saved = 0;
  const template = buildMenuTemplate({ platform: 'darwin', ...handlers(), onSave: () => { saved += 1; } });
  const file = template.find(item => item.label === 'File');
  assert.ok(file, 'a File menu');
  const save = file.submenu.find(item => item.label === 'Save');
  assert.equal(save.accelerator, 'CmdOrCtrl+S');
  save.click();
  assert.equal(saved, 1);
});

test('the rest of the menu is the platform roles, with the app menu on the Mac only', () => {
  const mac = buildMenuTemplate({ platform: 'darwin', ...handlers() });
  assert.deepEqual(mac.map(item => item.role || item.label), ['appMenu', 'File', 'editMenu', 'viewMenu', 'windowMenu', 'Help']);
  assert.equal(mac.find(item => item.label === 'File').submenu.at(-1).role, 'close');
  const win = buildMenuTemplate({ platform: 'win32', ...handlers() });
  assert.deepEqual(win.map(item => item.role || item.label), ['File', 'editMenu', 'viewMenu', 'windowMenu', 'Help']);
  assert.equal(win.find(item => item.label === 'File').submenu.at(-1).role, 'quit');
  assert.deepEqual(win.find(item => item.label === 'Help').submenu.filter(i => i.label).map(i => i.label), ['Check for Updates…', 'Open Logs', 'Restart Local Server', 'Recover Editor']);
});
