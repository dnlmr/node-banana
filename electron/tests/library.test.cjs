const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideDefaultLibrary, libraryEnv } = require('../lib/library.cjs');

test('macOS and Linux keep the library in the Documents folder Electron reports', () => {
  assert.equal(decideDefaultLibrary({ platform: 'darwin', documentsDir: '/Users/u/Documents', homeDir: '/Users/u' }), '/Users/u/Documents/Node Banana');
  // The OneDrive rule is Windows-only; a Mac OneDrive client sets no such redirection.
  assert.equal(decideDefaultLibrary({ platform: 'darwin', documentsDir: '/Users/u/Documents', homeDir: '/Users/u', env: { OneDrive: '/Users/u' } }), '/Users/u/Documents/Node Banana');
  // XDG user dirs can be localised or moved.
  assert.equal(decideDefaultLibrary({ platform: 'linux', documentsDir: '/home/u/Bilder', homeDir: '/home/u' }), '/home/u/Bilder/Node Banana');
  // Electron could not resolve Documents: the conventional folder stands in.
  assert.equal(decideDefaultLibrary({ platform: 'linux', documentsDir: undefined, homeDir: '/home/u' }), '/home/u/Documents/Node Banana');
});

test('Windows uses Documents unless OneDrive syncs it', () => {
  const homeDir = 'C:\\Users\\u';
  const decide = (documentsDir, env) => decideDefaultLibrary({ platform: 'win32', documentsDir, homeDir, env });
  assert.equal(decide('C:\\Users\\u\\Documents', {}), 'C:\\Users\\u\\Documents\\Node Banana');
  assert.equal(decide('D:\\Media\\Documents', { OneDrive: 'C:\\Users\\u\\OneDrive' }), 'D:\\Media\\Documents\\Node Banana');
  assert.equal(decide(undefined, {}), 'C:\\Users\\u\\Documents\\Node Banana');
  // Known Folder Move, under each variable the OneDrive client sets.
  assert.equal(decide('C:\\Users\\u\\OneDrive\\Documents', { OneDrive: 'C:\\Users\\u\\OneDrive' }), 'C:\\Users\\u\\Node Banana');
  assert.equal(decide('C:\\Users\\u\\OneDrive\\Documents', { OneDriveConsumer: 'C:\\Users\\u\\OneDrive' }), 'C:\\Users\\u\\Node Banana');
  assert.equal(decide('C:\\Users\\u\\OneDrive - Contoso\\Documents', { OneDrive: 'C:\\Users\\u\\OneDrive', OneDriveCommercial: 'C:\\Users\\u\\OneDrive - Contoso' }), 'C:\\Users\\u\\Node Banana');
  // Case, separators and a trailing separator do not hide the prefix.
  assert.equal(decide('c:/users/U/onedrive/documents', { OneDrive: 'C:\\Users\\u\\OneDrive\\' }), 'C:\\Users\\u\\Node Banana');
  assert.equal(decide('C:\\Users\\u\\OneDrive', { OneDrive: 'C:\\Users\\u\\OneDrive' }), 'C:\\Users\\u\\Node Banana');
  // A sibling folder that merely shares the prefix is not inside OneDrive.
  assert.equal(decide('C:\\Users\\u\\OneDriveArchive\\Documents', { OneDrive: 'C:\\Users\\u\\OneDrive' }), 'C:\\Users\\u\\OneDriveArchive\\Documents\\Node Banana');
  // Empty or relative values are not OneDrive roots.
  assert.equal(decide('C:\\Users\\u\\Documents', { OneDrive: '', OneDriveConsumer: 'OneDrive' }), 'C:\\Users\\u\\Documents\\Node Banana');
});

test('an explicit library wins, a test profile gets its own, and otherwise none is imposed', () => {
  const base = { platform: 'darwin', documentsDir: '/Users/u/Documents', homeDir: '/Users/u', userDataDir: '/tmp/profile', cwd: '/work' };
  const defaultLibrary = '/Users/u/Documents/Node Banana';
  assert.deepEqual(libraryEnv({ ...base, processEnv: { NODE_BANANA_ASSET_LIBRARY: '/Volumes/Media/Library', NODE_BANANA_ELECTRON_USER_DATA: '/tmp/profile' } }),
    { NODE_BANANA_DEFAULT_LIBRARY: defaultLibrary, NODE_BANANA_ASSET_LIBRARY: '/Volumes/Media/Library' });
  assert.deepEqual(libraryEnv({ ...base, processEnv: { NODE_BANANA_ASSET_LIBRARY: 'media/library' } }),
    { NODE_BANANA_DEFAULT_LIBRARY: defaultLibrary, NODE_BANANA_ASSET_LIBRARY: '/work/media/library' });
  assert.deepEqual(libraryEnv({ ...base, processEnv: { NODE_BANANA_ELECTRON_USER_DATA: '/tmp/profile' } }),
    { NODE_BANANA_DEFAULT_LIBRARY: defaultLibrary, NODE_BANANA_ASSET_LIBRARY: '/tmp/profile/Library' });
  for (const processEnv of [{}, { NODE_BANANA_ASSET_LIBRARY: '' }, { NODE_BANANA_ASSET_LIBRARY: '  ', NODE_BANANA_ELECTRON_USER_DATA: '' }]) {
    const env = libraryEnv({ ...base, processEnv });
    assert.deepEqual(env, { NODE_BANANA_DEFAULT_LIBRARY: defaultLibrary });
    assert.ok(!Object.hasOwn(env, 'NODE_BANANA_ASSET_LIBRARY'));
  }
  const windows = libraryEnv({ platform: 'win32', documentsDir: 'C:\\Users\\u\\OneDrive\\Documents', homeDir: 'C:\\Users\\u', userDataDir: 'C:\\Temp\\profile', cwd: 'C:\\work',
    processEnv: { OneDrive: 'C:\\Users\\u\\OneDrive', NODE_BANANA_ELECTRON_USER_DATA: 'C:\\Temp\\profile' } });
  assert.deepEqual(windows, { NODE_BANANA_DEFAULT_LIBRARY: 'C:\\Users\\u\\Node Banana', NODE_BANANA_ASSET_LIBRARY: 'C:\\Temp\\profile\\Library' });
  for (const env of [windows, libraryEnv({ ...base, processEnv: {} })]) assert.ok(Object.values(env).every(value => typeof value === 'string' && value));
});
