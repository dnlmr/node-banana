import type { APIRoute } from "astro";

// Everything may be crawled; the sitemap is where the site is published.
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL("/sitemap-index.xml", site ?? "https://nodebanana.app").href;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
