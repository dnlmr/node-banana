/**
 * The application menu, as a template `Menu.buildFromTemplate` takes.
 *
 * Kept apart from main.cjs so the one thing worth testing, that File › Save
 * carries Cmd/Ctrl+S and asks the window to save, can be tested without
 * Electron. Everything else is Electron's own role menus.
 */
function buildMenuTemplate({ platform, onSave, onCheckForUpdates, onOpenLogs, onRestartServer, onRecoverEditor }) {
  const mac = platform === 'darwin';
  return [
    ...(mac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: onSave },
        { type: 'separator' },
        { role: mac ? 'close' : 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for Updates…', click: onCheckForUpdates },
        { type: 'separator' },
        { label: 'Open Logs', click: onOpenLogs },
        { label: 'Restart Local Server', click: onRestartServer },
        { label: 'Recover Editor', click: onRecoverEditor },
      ],
    },
  ];
}

module.exports = { buildMenuTemplate };
