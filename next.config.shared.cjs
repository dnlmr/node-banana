// Public Next options shared by the browser build and packaged custom server.
/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The agent spawns the Claude Code and Codex CLIs, which these packages locate
  // relative to their own install path; bundling them breaks that lookup.
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk', '@openai/codex'],
  // Shown in the split dialogs' pane; baked in at build time.
  env: { NEXT_PUBLIC_APP_VERSION: require('./package.json').version },
  // Nothing uses next/image, but /_next/image still fetches any local URL it
  // is given, from inside the server and without the browser headers the API
  // checks. Unoptimized turns that endpoint off.
  images: { unoptimized: true },
  experimental: {
    serverActions: { bodySizeLimit: '100mb' },
    // There is no proxy.ts/middleware.ts today. If one is added, it must skip
    // /api/assets (matcher) or raise `proxyClientMaxBodySize`: Next clones
    // request bodies for a proxy and silently truncates them past its limit
    // (10 MB by default), which would corrupt streamed asset uploads
    // (PUT /api/assets/uploads/[id], PUT /api/assets/media/[sha256]).
  },
};

module.exports = config;
