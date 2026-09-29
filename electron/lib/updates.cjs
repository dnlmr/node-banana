// Updates: a small state machine over electron-updater that the editor renders
// and the Help menu drives. Checks run shortly after launch and every few
// hours; nothing is downloaded until the user asks, and nothing installs
// until they choose to restart (or quit, once a download has finished).
//
// The state the renderer sees:
//   idle         nothing to show
//   checking     a check is running (shown only for a manual check)
//   available    a newer release exists; version and url are set
//   downloading  percent, transferred and total follow the download
//   downloaded   ready to install
//   current      a manual check found nothing newer
//   error        a download or install failed; url points at the release, so
//                the user can still fetch the installer by hand
//
// A failed automatic check (offline, GitHub down) goes back to idle without a
// word. A skipped version stays silent until a manual check asks for it.
const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./files.cjs');

const FIRST_CHECK_DELAY_MS = 15 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 30 * 60 * 1000;

/** The releases page named by the packaged app's update manifest, or undefined outside a package. */
function readReleasesUrl(resourcesPath) {
  try {
    const manifest = fs.readFileSync(path.join(resourcesPath, 'app-update.yml'), 'utf8');
    const owner = /^owner:\s*(\S+)\s*$/m.exec(manifest)?.[1], repo = /^repo:\s*(\S+)\s*$/m.exec(manifest)?.[1];
    if (owner && repo) return `https://github.com/${owner}/${repo}/releases`;
  } catch {}
  return undefined;
}

/** What the bridge answers where updates cannot run (development, a missing updater). */
function createUnsupportedUpdates(currentVersion) {
  const state = { supported: false, status: 'idle', currentVersion };
  const noop = () => state;
  return { state: () => state, check: noop, download: noop, install: noop, skip: noop, dismiss: noop, start() {}, stop() {} };
}

function createUpdates({ updater, userData, currentVersion, releasesUrl, log, onChange, autoCheck = true, timers = { setTimeout, clearTimeout } }) {
  const file = path.join(userData, 'updates-v1.json');
  let skipped = null;
  try { skipped = JSON.parse(fs.readFileSync(file, 'utf8')).skipped ?? null; } catch {}
  let state = { supported: true, status: 'idle', currentVersion };
  // ready: a downloaded version the user put off; the next check offers it
  // for installing rather than for downloading again.
  let manual = false, timer, stopped = false, failed = false, ready = null;
  const releaseUrl = version => releasesUrl ? `${releasesUrl}/tag/v${version}` : undefined;
  const message = error => error?.message || String(error);

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.logger = { info: value => log(`Updates: ${value}`), warn: value => log(`Updates: ${value}`), error: value => log(`Updates: ${value}`), debug() {} };

  function set(patch) {
    state = { supported: true, currentVersion, ...patch };
    onChange(state);
  }
  updater.on('checking-for-update', () => { failed = false; set({ status: 'checking', manual }); });
  updater.on('update-available', info => {
    if (info.version === ready) { set({ status: 'downloaded', version: info.version, url: releaseUrl(info.version) }); return; }
    if (!manual && info.version === skipped) { set({ status: 'idle' }); return; }
    set({ status: 'available', version: info.version, url: releaseUrl(info.version), manual });
  });
  updater.on('update-not-available', () => set({ status: 'current', manual }));
  updater.on('download-progress', progress => {
    if (state.status !== 'downloading' && state.status !== 'available') return;
    set({ status: 'downloading', version: state.version, url: state.url, percent: Math.max(0, Math.min(100, Math.floor(progress.percent || 0))), transferred: progress.transferred, total: progress.total });
  });
  updater.on('update-downloaded', info => set({ status: 'downloaded', version: info.version, url: releaseUrl(info.version) }));
  function fail(error) {
    log(`Updates: ${error?.stack || message(error)}`);
    // Nobody asked for a background check; its failure is nobody's concern.
    if (state.status === 'checking' && !manual) { failed = true; set({ status: 'idle' }); return; }
    if (state.status === 'idle' || state.status === 'current') return;
    set({ status: 'error', version: state.version, url: state.url || releasesUrl, error: message(error), manual });
  }
  updater.on('error', fail);
  // The updater both emits and rejects; the rejection only matters when the
  // event never came (it did not get as far as emitting).
  function attempt(work, during) {
    let result;
    try { result = Promise.resolve(work()); } catch (error) { result = Promise.reject(error); }
    return result.then(() => state, error => { if (state.status === during) fail(error); return state; });
  }

  function check({ manual: requested = false } = {}) {
    if (state.status === 'downloading' || state.status === 'downloaded') return Promise.resolve(state);
    manual = requested;
    return attempt(() => updater.checkForUpdates(), 'checking');
  }
  function download() {
    if (state.status !== 'available' && state.status !== 'error') return state;
    if (!state.version) return state;
    set({ status: 'downloading', version: state.version, url: state.url, percent: 0 });
    void attempt(() => updater.downloadUpdate(), 'downloading');
    return state;
  }
  function install() {
    if (state.status !== 'downloaded') return state;
    try { updater.quitAndInstall(); }
    catch (error) {
      log(`Updates: ${error?.stack || message(error)}`);
      set({ status: 'error', version: state.version, url: state.url || releasesUrl, error: message(error) });
    }
    return state;
  }
  function skip() {
    if (state.status !== 'available' || !state.version) return state;
    skipped = state.version;
    try { atomicWrite(file, JSON.stringify({ version: 1, skipped })); } catch (error) { log(error); }
    set({ status: 'idle' });
    return state;
  }
  function dismiss() {
    if (state.status === 'downloaded') ready = state.version;
    if (['available', 'downloaded', 'current', 'error'].includes(state.status)) set({ status: 'idle' });
    return state;
  }
  function schedule(delay) {
    if (stopped) return;
    timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      void check().then(() => schedule(failed ? RETRY_INTERVAL_MS : CHECK_INTERVAL_MS));
    }, delay);
  }
  function start() { if (autoCheck) schedule(FIRST_CHECK_DELAY_MS); }
  function stop() { stopped = true; timers.clearTimeout(timer); }
  return { state: () => state, check, download, install, skip, dismiss, start, stop };
}

/**
 * A stand-in for electron-updater so the notice can be seen in development
 * (NODE_BANANA_ELECTRON_PREVIEW_UPDATES=1, or =fail to break the download):
 * every check finds the next minor version, a download takes a few seconds,
 * and installing calls `onInstall` instead of restarting anything.
 */
function createPreviewUpdater({ currentVersion, fail = false, onInstall = () => {}, timers = { setTimeout, clearTimeout } }) {
  const { EventEmitter } = require('node:events');
  const [major, minor] = currentVersion.split('.').map(Number);
  const version = `${major}.${(minor || 0) + 1}.0`;
  const updater = new EventEmitter();
  const total = 600 * 1024 * 1024;
  updater.checkForUpdates = () => new Promise(resolve => {
    updater.emit('checking-for-update');
    timers.setTimeout(() => { updater.emit('update-available', { version }); resolve({ isUpdateAvailable: true, updateInfo: { version } }); }, 800);
  });
  updater.downloadUpdate = () => new Promise((resolve, reject) => {
    let percent = 0;
    const step = () => {
      percent = Math.min(100, percent + 4);
      if (fail && percent >= 60) { const error = new Error('Preview: the download was cut off'); updater.emit('error', error); reject(error); return; }
      updater.emit('download-progress', { percent, transferred: Math.round(total * percent / 100), total });
      if (percent >= 100) { updater.emit('update-downloaded', { version }); resolve([]); return; }
      timers.setTimeout(step, 160);
    };
    timers.setTimeout(step, 300);
  });
  updater.quitAndInstall = () => onInstall(version);
  return updater;
}

module.exports = { createUpdates, createUnsupportedUpdates, createPreviewUpdater, readReleasesUrl, FIRST_CHECK_DELAY_MS, CHECK_INTERVAL_MS, RETRY_INTERVAL_MS };
