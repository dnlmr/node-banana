// Build in isolation: Next must never discover the developer's .env files.
//
//   npm run electron:package                 unsigned app, DMG and ZIP (Mac) or installer and ZIP (Windows)
//   npm run electron:package -- --dir        app only, for a quick packaging iteration
//   npm run electron:package -- --sign       Mac: Developer ID signing, hardened runtime and notarisation
//   npm run electron:package -- --publish    upload the artifacts and updater manifests to a draft GitHub release
//
// Signing finds the Developer ID Application identity in the keychain (CSC_NAME
// picks one). Notarisation reads the App Store Connect key from APPLE_API_KEY,
// APPLE_API_KEY_ID and APPLE_API_ISSUER (or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD
// and APPLE_TEAM_ID). Publishing needs GH_TOKEN. Windows builds are not signed.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { build } = require('electron-builder');
const { pickHostEnvironment } = require('../electron/lib/env.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist-electron');
const run = (command, args, cwd, env) => new Promise((resolve, reject) => {
  // On Windows npm is a .cmd shim and Node refuses to spawn .cmd/.bat without a
  // shell (EINVAL). Only npm needs it; node.exe and magick.exe spawn directly.
  const shell = process.platform === 'win32' && command === 'npm';
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
});
// fs.cp hands over native paths, so normalise the separator before matching or
// none of these exclusions apply on Windows.
const filter = source => !/(^|\/)(\.env[^/]*|\.DS_Store|__tests__|__fixtures__|__mocks__|fixtures|tests?|coverage)(\/|$)|\.(test|spec)\.[^/]+$/.test(source.split(path.sep).join('/'));
/** The release the packaged app checks for updates against; also where --publish uploads. */
const GITHUB_RELEASES = { provider: 'github', owner: 'shrimbly', repo: 'node-banana', releaseType: 'draft' };
const notarizationConfigured = () =>
  (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER) ||
  (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) ||
  (process.env.APPLE_KEYCHAIN && process.env.APPLE_KEYCHAIN_PROFILE);
async function main() {
  const isMac = process.platform === 'darwin' && process.arch === 'arm64';
  const isWin = process.platform === 'win32' && process.arch === 'x64';
  if (!isMac && !isWin) throw new Error('Build this preview on an Apple Silicon Mac (darwin/arm64) or a Windows x64 machine (win32/x64).');
  const flags = new Set(process.argv.slice(2));
  const dirOnly = flags.has('--dir'), sign = flags.has('--sign'), publish = flags.has('--publish');
  if (sign && !isMac) throw new Error('--sign applies to the Mac build; Windows builds are published unsigned.');
  if (sign && !notarizationConfigured()) throw new Error('--sign needs notarisation credentials in the environment: APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER (an App Store Connect API key), or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.');
  if (publish && dirOnly) throw new Error('--publish needs the installers; drop --dir.');
  if (publish && !process.env.GH_TOKEN) throw new Error(`--publish needs GH_TOKEN, a GitHub token that can write releases on ${GITHUB_RELEASES.owner}/${GITHUB_RELEASES.repo}.`);
  // Build from the temp dir's real path. On macOS os.tmpdir() is /var/…, a
  // symlink to /private/var/…; Next's file tracer then sees the externalised
  // packages (the agent SDK) resolve outside the build root and emits hashed
  // aliases for them that the packaged runtime cannot find.
  const work = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'node-banana-release-'));
  // The same OS allowlist the packaged backend gets, so a developer key can
  // never reach npm, the Next build or electron-builder by any name. Windows
  // tools additionally resolve program and profile directories.
  const env = pickHostEnvironment(isWin ? ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'CommonProgramFiles', 'ALLUSERSPROFILE', 'PUBLIC'] : []);
  Object.assign(env, { NEXT_TELEMETRY_DISABLED: '1', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  try {
    const source = path.join(work, 'source');
    const app = path.join(work, 'app');
    const runtime = path.join(work, 'runtime');
    // Use Apple's ICNS encoder on macOS: the automatic PNG conversion can corrupt
    // the legacy small representations. Generate every standard size from the
    // artwork. On Windows, build a multi-resolution .ico from the same source
    // artwork with ImageMagick; electron-builder embeds it in the exe/installer.
    let icon;
    if (isMac) {
      const iconset = path.join(work, 'NodeBanana.iconset');
      icon = path.join(work, 'NodeBanana.icns');
      await fs.mkdir(iconset);
      for (const size of [16, 32, 128, 256, 512]) {
        for (const scale of [1, 2]) {
          await require('sharp')(path.join(root, 'electron/icon.png'))
            .resize(size * scale, size * scale)
            .png().toFile(path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
        }
      }
      await run('/usr/bin/iconutil', ['--convert', 'icns', '--output', icon, iconset], work, env);
    } else {
      icon = path.join(work, 'icon.ico');
      await run('magick', [path.join(root, 'electron/icon.png'), '-define', 'icon:auto-resize=256,128,64,48,32,16', icon], work, env);
    }
    await fs.mkdir(source);
    await fs.mkdir(runtime);
    for (const entry of ['src', 'public', 'package.json', 'package-lock.json', 'next.config.ts', 'next.config.shared.cjs', 'postcss.config.mjs', 'tsconfig.json']) {
      await fs.cp(path.join(root, entry), path.join(source, entry), { recursive: true, verbatimSymlinks: true, filter });
    }
    await run('npm', ['ci', '--no-audit', '--no-fund'], source, env);
    await run(process.execPath, [path.join(source, 'node_modules/next/dist/bin/next'), 'build'], source, { ...env, NODE_ENV: 'production' });
    const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
    // Install the lockfile's full production dependency closure, including native modules.
    await run('npm', ['prune', '--omit=dev', '--no-audit', '--no-fund'], source, env);
    for (const entry of ['public', 'node_modules']) await fs.cp(path.join(source, entry), path.join(runtime, entry), { recursive: true, verbatimSymlinks: true, filter });
    await fs.cp(path.join(source, '.next'), path.join(runtime, '.next'), { recursive: true,
      filter: file => !['cache', 'diagnostics', 'types', 'dev'].some(part => path.relative(path.join(source, '.next'), file).split(path.sep)[0] === part) && !file.endsWith('.map') });
    await relinkBuildAliases(source, runtime);
    // Use public configuration, not Next's normalized internal manifest options.
    const config = { ...require(path.join(root, 'next.config.shared.cjs')), distDir: '.next' };
    await fs.writeFile(path.join(runtime, 'next.config.js'), `module.exports = ${JSON.stringify(config)};\n`);
    await fs.writeFile(path.join(runtime, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, dependencies: pkg.dependencies }));
    await fs.cp(path.join(root, 'electron/server.cjs'), path.join(runtime, 'server.cjs'));
    await fs.mkdir(path.join(runtime, 'lib'));
    // Every module server.cjs requires from lib/.
    for (const file of ['diagnostics.cjs', 'bridge.cjs']) await fs.cp(path.join(root, 'electron/lib', file), path.join(runtime, 'lib', file));
    await fs.writeFile(path.join(runtime, 'runtime.json'), JSON.stringify({ version: 1, buildId: `${pkg.version}-${randomUUID()}`, arch: process.arch }));
    await fs.mkdir(app);
    await fs.cp(path.join(root, 'electron'), path.join(app, 'electron'), { recursive: true, verbatimSymlinks: true, filter });
    await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, main: 'electron/main.cjs', description: 'Node Banana desktop workflow editor', author: 'Node Banana' }));
    // Every nested binary (helpers, the agent CLIs, native modules) inherits these.
    const entitlements = path.join(app, 'electron/entitlements.mac.plist');
    await build({ projectDir: app, publish: publish ? 'always' : 'never', config: {
      appId: 'com.nodebanana.desktop', productName: 'Node Banana', electronVersion: require('electron/package.json').version,
      directories: { output }, files: ['package.json', 'electron/**/*.cjs'],
      // Written into the app as app-update.yml, which the updater reads whether
      // or not this build is published.
      publish: GITHUB_RELEASES,
      // electron-builder deliberately excludes a root node_modules from each FileSet.
      // Copy its contents with their own explicit FileSet.
      extraResources: [
        { from: runtime, to: 'runtime', filter: ['**/*', '**/.*', '!**/.env*'] },
        { from: path.join(runtime, 'node_modules'), to: 'runtime/node_modules', filter: ['**/*', '!**/.env*'] },
      ],
      afterPack: async context => {
        // The bundled runtime lives inside the .app on macOS and directly under
        // resources/ on Windows and Linux.
        const bundled = context.electronPlatformName === 'darwin'
          ? path.join(context.appOutDir, 'Node Banana.app/Contents/Resources/runtime')
          : path.join(context.appOutDir, 'resources', 'runtime');
        // The main process loads the updater from here (see electron/main.cjs).
        for (const file of ['.next/BUILD_ID', 'node_modules/next/package.json', 'node_modules/sharp/package.json', 'node_modules/electron-updater/package.json', 'public/banana_icon.png', 'server.cjs', 'lib/diagnostics.cjs', 'lib/bridge.cjs']) await fs.access(path.join(bundled, file));
        // electron-builder writes the updater's manifest only when it also
        // builds an installer; a --dir build gets the same one here, so the
        // app always knows which releases to check.
        const manifest = path.join(path.dirname(bundled), 'app-update.yml');
        try { await fs.access(manifest); }
        catch { await fs.writeFile(manifest, `provider: ${GITHUB_RELEASES.provider}\nowner: ${GITHUB_RELEASES.owner}\nrepo: ${GITHUB_RELEASES.repo}\nupdaterCacheDirName: ${pkg.name}-updater\n`); }
      },
      npmRebuild: false, asar: true,
      // Squirrel.Mac (the updater) installs from the zip, so it ships beside the DMG.
      mac: { target: dirOnly ? [{ target: 'dir', arch: ['arm64'] }] : [{ target: 'dir', arch: ['arm64'] }, { target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }],
        icon, category: 'public.app-category.graphics-design', hardenedRuntime: true,
        // Unsigned unless asked: with --sign, electron-builder takes the Developer
        // ID identity from the keychain, then notarises and staples the app.
        ...(sign ? { entitlements, entitlementsInherit: entitlements, notarize: true } : { identity: null }) },
      dmg: { sign: false, contents: [{ x: 130, y: 220 }, { x: 410, y: 220, type: 'link', path: '/Applications' }] },
      // Windows x64: unpacked dir for --dir, otherwise a per-user NSIS installer
      // and a zip. Windows builds are not signed (electron-builder simply skips
      // it); do not set forceCodeSigning. The updater runs the installer silently.
      win: { target: dirOnly ? [{ target: 'dir', arch: ['x64'] }] : [{ target: 'nsis', arch: ['x64'] }, { target: 'zip', arch: ['x64'] }],
        icon },
      nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
      // No spaces: GitHub renames uploaded assets and the updater would then
      // ask for a file that is not there.
      artifactName: 'Node-Banana-${version}-${arch}.${ext}',
    } });
    console.log(`Release artifacts: ${output}`);
  } finally { await fs.rm(work, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

/**
 * Next writes aliases for some externalised packages (the agent SDK's ESM
 * entry, for one) as `.next/node_modules/<name>-<hash>` symlinks whose targets
 * are ABSOLUTE paths into the build's throwaway source tree. Copied as-is they
 * dangle once that tree is removed, and the route importing through them fails
 * with ERR_MODULE_NOT_FOUND at runtime. Point each at the runtime's own copy
 * of the package, relatively, so the bundle is self-contained.
 */
async function relinkBuildAliases(source, runtime) {
  const aliases = path.join(runtime, '.next', 'node_modules');
  const sourceModules = path.join(source, 'node_modules');
  const realSourceModules = await fs.realpath(sourceModules).catch(() => sourceModules);
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const link = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = path.resolve(dir, await fs.readlink(link));
        const rel = [sourceModules, realSourceModules].map(base => path.relative(base, target)).find(r => r && !r.startsWith('..') && !path.isAbsolute(r));
        if (!rel) throw new Error(`Build alias ${link} points outside the source node_modules: ${target}`);
        await fs.unlink(link);
        await fs.symlink(path.relative(dir, path.join(runtime, 'node_modules', rel)), link);
      } else if (entry.isDirectory()) {
        await walk(link);
      }
    }
  }
  await walk(aliases);
}
