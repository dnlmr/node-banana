// Where the asset library lives. Main decides the default because only main can
// ask Electron for the Documents folder (app.getPath follows Windows known-folder
// redirection); the server reads the answer from its environment.
const path = require('node:path');

const LIBRARY_FOLDER = 'Node Banana';
// Known Folder Move puts Documents inside OneDrive. A library there would sync
// one sidecar per asset to every PC the user signs into, conflict copies and
// all, so on Windows a synced Documents sends the library to the home folder.
const ONEDRIVE_KEYS = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'];

function pathsFor(platform) { return platform === 'win32' ? path.win32 : path.posix; }

// `child` is `parent` or inside it. Windows paths compare without case and with
// either separator; a trailing separator on either side never matters.
function isWithin(parent, child, platform) {
  const paths = pathsFor(platform);
  const fold = value => {
    const normal = paths.normalize(value).replace(/[\\/]+$/, '');
    return platform === 'win32' ? normal.toLowerCase() : normal;
  };
  const outer = fold(parent), inner = fold(child);
  return inner === outer || inner.startsWith(outer + paths.sep);
}

function syncedByOneDrive(folder, env, platform) {
  const paths = pathsFor(platform);
  return ONEDRIVE_KEYS.some(key => typeof env[key] === 'string' && paths.isAbsolute(env[key]) && isWithin(env[key], folder, platform));
}

// <Documents>/Node Banana, or <home>\Node Banana when Windows syncs Documents to
// OneDrive. `documentsDir` is app.getPath('documents'); without one (Electron
// could not resolve it) the conventional <home>/Documents stands in.
function decideDefaultLibrary({ platform, documentsDir, homeDir, env = {} }) {
  const paths = pathsFor(platform);
  const documents = documentsDir || paths.join(homeDir, 'Documents');
  if (platform === 'win32' && syncedByOneDrive(documents, env, platform)) return paths.join(homeDir, LIBRARY_FOLDER);
  return paths.join(documents, LIBRARY_FOLDER);
}

// The keys main adds to the server's environment: the default above, and the
// library itself when one is imposed. An explicit NODE_BANANA_ASSET_LIBRARY
// wins; otherwise a test profile (NODE_BANANA_ELECTRON_USER_DATA) keeps its
// generations inside the profile instead of the developer's real library.
// A key is either present with a path or absent, never undefined: the packaged
// server's environment is an allowlist (env.cjs) and passes nothing else.
function libraryEnv({ platform, documentsDir, homeDir, userDataDir, processEnv = {}, cwd = process.cwd() }) {
  const paths = pathsFor(platform);
  const explicit = processEnv.NODE_BANANA_ASSET_LIBRARY;
  // The server's working directory is a runtime folder replaced on every
  // update, so a relative override is anchored where the app was launched.
  const library = typeof explicit === 'string' && explicit.trim() ? paths.resolve(cwd, explicit)
    : processEnv.NODE_BANANA_ELECTRON_USER_DATA && userDataDir ? paths.join(userDataDir, 'Library')
    : undefined;
  return {
    NODE_BANANA_DEFAULT_LIBRARY: decideDefaultLibrary({ platform, documentsDir, homeDir, env: processEnv }),
    ...(library ? { NODE_BANANA_ASSET_LIBRARY: library } : {}),
  };
}

module.exports = { LIBRARY_FOLDER, ONEDRIVE_KEYS, decideDefaultLibrary, libraryEnv, isWithin };
