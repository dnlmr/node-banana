// @ts-check
import { defineConfig } from "astro/config";

// The landing page: one static page, no client framework. `astro dev` serves it
// with hot reload on 3105; `astro build` writes the deployable folder to dist/.
//
// `site` is the address the page is published at: it makes og:image, og:url
// and the canonical link absolute, which link previews need. SITE_URL (no
// trailing slash) overrides it for a preview deployment.
export default defineConfig({
  site: process.env.SITE_URL || "https://nodebanana.app",
  output: "static",
  server: { port: 3105, host: false },
  devToolbar: { enabled: false },
});
