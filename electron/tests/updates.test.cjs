const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUpdates, createUnsupportedUpdates, readReleasesUrl, FIRST_CHECK_DELAY_MS, CHECK_INTERVAL_MS, RETRY_INTERVAL_MS } = require('../lib/updates.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));
const RELEASES = 'https://github.com/shrimbly/node-banana/releases';

function harness({ autoCheck = false, userData = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-updates-')) } = {}) {
  const updater = Object.assign(new EventEmitter(), {
    checks: 0, downloads: 0, installs: 0,
    checkForUpdates() { this.checks += 1; this.emit('checking-for-update'); return Promise.resolve(); },
    downloadUpdate() { this.downloads += 1; return Promise.resolve([]); },
    quitAndInstall() { this.installs += 1; },
  });
  const timers = { pending: [], setTimeout(callback, delay) { const id = { callback, delay }; this.pending.push(id); return id; }, clearTimeout(id) { this.pending = this.pending.filter(entry => entry !== id); } };
  const changes = [], logs = [];
  const updates = createUpdates({ updater, userData, currentVersion: '1.10.0', releasesUrl: RELEASES, log: value => logs.push(String(value)), onChange: state => changes.push(state), autoCheck, timers });
  return { updater, updates, timers, changes, logs, userData };
}

test('configures the updater to ask before downloading and installs on quit', () => {
  const { updater } = harness();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(typeof updater.logger.info, 'function');
});

test('an available update is offered, downloaded on request and installed on request', async () => {
  const { updater, updates, changes } = harness();
  assert.deepEqual(updates.state(), { supported: true, status: 'idle', currentVersion: '1.10.0' });
  const checked = updates.check();
  updater.emit('update-available', { version: '1.11.0' });
  assert.deepEqual(await checked, { supported: true, status: 'available', currentVersion: '1.10.0', version: '1.11.0', url: `${RELEASES}/tag/v1.11.0`, manual: false });
  assert.equal(updates.download().status, 'downloading');
  await tick();
  assert.equal(updater.downloads, 1);
  updater.emit('download-progress', { percent: 41.7, transferred: 41, total: 100 });
  assert.deepEqual(updates.state(), { supported: true, status: 'downloading', currentVersion: '1.10.0', version: '1.11.0', url: `${RELEASES}/tag/v1.11.0`, percent: 41, transferred: 41, total: 100 });
  updater.emit('update-downloaded', { version: '1.11.0' });
  assert.equal(updates.state().status, 'downloaded');
  // A check while a download is ready does nothing to it
  await updates.check({ manual: true });
  assert.equal(updater.checks, 1);
  updates.install();
  assert.equal(updater.installs, 1);
  assert.deepEqual(changes.map(state => state.status), ['checking', 'available', 'downloading', 'downloading', 'downloaded']);
});

test('a download or install failure reports the error with the release to fetch by hand', async () => {
  const { updater, updates } = harness();
  const checked = updates.check();
  updater.emit('update-available', { version: '1.11.0' });
  await checked;
  updates.download();
  updater.emit('error', new Error('Could not get code signature for running application'));
  assert.deepEqual(updates.state(), { supported: true, status: 'error', currentVersion: '1.10.0', version: '1.11.0', url: `${RELEASES}/tag/v1.11.0`, error: 'Could not get code signature for running application', manual: false });
  // Trying again is allowed from the error
  assert.equal(updates.download().status, 'downloading');
  updater.emit('update-downloaded', { version: '1.11.0' });
  updater.quitAndInstall = () => { throw new Error('Installer missing'); };
  assert.equal(updates.install().status, 'error');
  assert.equal(updates.state().error, 'Installer missing');
});

test('a failed automatic check is silent; a failed manual check is not', async () => {
  const { updater, updates, changes, logs } = harness();
  const quiet = updates.check();
  updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
  assert.equal((await quiet).status, 'idle');
  assert.match(logs.join('\n'), /ERR_INTERNET_DISCONNECTED/);
  const loud = updates.check({ manual: true });
  updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
  assert.deepEqual(await loud, { supported: true, status: 'error', currentVersion: '1.10.0', version: undefined, url: RELEASES, error: 'net::ERR_INTERNET_DISCONNECTED', manual: true });
  assert.deepEqual(changes.map(state => state.status), ['checking', 'idle', 'checking', 'error']);
});

test('a manual check that finds nothing says so; an automatic one stays quiet', async () => {
  const { updater, updates, changes } = harness();
  const automatic = updates.check();
  updater.emit('update-not-available', { version: '1.10.0' });
  await automatic;
  const manual = updates.check({ manual: true });
  updater.emit('update-not-available', { version: '1.10.0' });
  await manual;
  assert.deepEqual(changes.map(state => [state.status, state.manual]), [['checking', false], ['current', false], ['checking', true], ['current', true]]);
  assert.equal(updates.dismiss().status, 'idle');
});

test('a skipped version stays skipped across launches until a manual check asks', async () => {
  const first = harness();
  let checked = first.updates.check();
  first.updater.emit('update-available', { version: '1.11.0' });
  await checked;
  assert.equal(first.updates.skip().status, 'idle');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(first.userData, 'updates-v1.json'), 'utf8')), { version: 1, skipped: '1.11.0' });

  const second = harness({ userData: first.userData });
  checked = second.updates.check();
  second.updater.emit('update-available', { version: '1.11.0' });
  assert.equal((await checked).status, 'idle');
  checked = second.updates.check();
  second.updater.emit('update-available', { version: '1.12.0' });
  assert.equal((await checked).status, 'available');
  checked = second.updates.check({ manual: true });
  second.updater.emit('update-available', { version: '1.11.0' });
  assert.deepEqual(await checked, { supported: true, status: 'available', currentVersion: '1.10.0', version: '1.11.0', url: `${RELEASES}/tag/v1.11.0`, manual: true });
});

test('an update put off after downloading comes back ready to install', async () => {
  const { updater, updates } = harness();
  let checked = updates.check();
  updater.emit('update-available', { version: '1.11.0' });
  await checked;
  updates.download();
  updater.emit('update-downloaded', { version: '1.11.0' });
  assert.equal(updates.dismiss().status, 'idle');
  checked = updates.check();
  updater.emit('update-available', { version: '1.11.0' });
  assert.equal((await checked).status, 'downloaded');
  assert.equal(updater.downloads, 1);
});

test('automatic checks run after launch, then every few hours, sooner after a failure', async () => {
  const { updater, updates, timers } = harness({ autoCheck: true });
  assert.equal(timers.pending.length, 0);
  updates.start();
  assert.equal(timers.pending[0].delay, FIRST_CHECK_DELAY_MS);
  timers.pending.shift().callback();
  updater.emit('update-not-available', { version: '1.10.0' });
  await tick(); await tick();
  assert.equal(updater.checks, 1);
  assert.equal(timers.pending[0].delay, CHECK_INTERVAL_MS);
  timers.pending.shift().callback();
  updater.emit('error', new Error('offline'));
  await tick(); await tick();
  assert.equal(timers.pending[0].delay, RETRY_INTERVAL_MS);
  updates.stop();
  assert.equal(timers.pending.length, 0);
  timers.setTimeout = () => { throw new Error('scheduled after stop'); };
  updates.start();
});

test('without a packaged updater the bridge answers unsupported', () => {
  const updates = createUnsupportedUpdates('1.10.0');
  assert.deepEqual(updates.state(), { supported: false, status: 'idle', currentVersion: '1.10.0' });
  assert.equal(updates.check().status, 'idle');
  assert.doesNotThrow(() => { updates.start(); updates.stop(); });
});

test('the releases page comes from the update manifest', () => {
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-resources-'));
  assert.equal(readReleasesUrl(resources), undefined);
  fs.writeFileSync(path.join(resources, 'app-update.yml'), 'owner: shrimbly\nrepo: node-banana\nprovider: github\nreleaseType: draft\nupdaterCacheDirName: node-banana-updater\n');
  assert.equal(readReleasesUrl(resources), RELEASES);
});

test('the preview updater walks the notice through a whole update without a release', async () => {
  const { createPreviewUpdater } = require('../lib/updates.cjs');
  const timers = { pending: [], setTimeout(callback, delay) { const id = { callback, delay }; this.pending.push(id); return id; }, clearTimeout() {} };
  const run = async () => { while (timers.pending.length) timers.pending.shift().callback(); await tick(); };
  const installed = [];
  const updater = createPreviewUpdater({ currentVersion: '1.10.0', onInstall: version => installed.push(version), timers });
  const changes = [];
  const updates = createUpdates({ updater, userData: fs.mkdtempSync(path.join(os.tmpdir(), 'banana-preview-')), currentVersion: '1.10.0', releasesUrl: RELEASES, log() {}, onChange: state => changes.push(state.status), autoCheck: false, timers });
  const checked = updates.check({ manual: true });
  await run();
  assert.equal((await checked).version, '1.11.0');
  updates.download();
  await tick();
  while (updates.state().status === 'downloading') await run();
  assert.equal(updates.state().status, 'downloaded');
  updates.install();
  assert.deepEqual(installed, ['1.11.0']);
  assert.deepEqual([...new Set(changes)], ['checking', 'available', 'downloading', 'downloaded']);

  const broken = createPreviewUpdater({ currentVersion: '1.10.0', fail: true, timers });
  const failing = createUpdates({ updater: broken, userData: fs.mkdtempSync(path.join(os.tmpdir(), 'banana-preview-')), currentVersion: '1.10.0', releasesUrl: RELEASES, log() {}, onChange() {}, autoCheck: false, timers });
  void failing.check(); await run();
  failing.download(); await tick();
  while (failing.state().status === 'downloading') await run();
  assert.equal(failing.state().status, 'error');
  assert.equal(failing.state().url, `${RELEASES}/tag/v1.11.0`);
});
