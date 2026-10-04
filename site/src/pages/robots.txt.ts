import type { APIRoute } from "astro";

// Everything may be crawled; the sitemap is where the site is published.
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL("/sitemap-index.xml", site ?? "https://nodebanana.app").href;
  // Answer engines are welcome: named so a default-deny list elsewhere never
  // reads as the site's intent.
  const crawlers = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "anthropic-ai", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot"];
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    ...crawlers.flatMap((agent) => [`User-agent: ${agent}`, "Allow: /", ""]),
    `Sitemap: ${sitemap}`,
    `# Facts about Node Banana for language models: ${new URL("/llms.txt", site ?? "https://nodebanana.app").href}`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
