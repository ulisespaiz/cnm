import type { APIRoute } from 'astro';

// Everything is public. AI search and assistant crawlers are named explicitly
// so the intent is unambiguous: this business wants to be found and cited.
// Note: Cloudflare can block AI crawlers at the edge regardless of this file
// (Security > Bots / AI Crawl Control); see README.
const aiAgents = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'GPTBot',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Bingbot',
  'DuckAssistBot',
  'meta-externalagent',
];

export const GET: APIRoute = ({ site }) => {
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /quote/thanks/',
    '',
    ...aiAgents.flatMap((ua) => [`User-agent: ${ua}`, 'Allow: /', '']),
    `Sitemap: ${new URL('/sitemap-index.xml', site).href}`,
    '',
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
