// @ts-check
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { site } from './src/config/site.ts';

// Parts shop switch (site.store.enabled in src/config/site.ts). While it is off the
// shop pages generate nothing; this sweeps up whatever is left under /shop/ and sends
// the URL to the quote page. Cloudflare reads these from _redirects.
//
// The parts collection still makes Vite emit every part photo (and the shop scripts and
// styles) into _astro/, although no page uses them. Anything in _astro/ that no other
// output file mentions is deleted, so none of it stays a public URL.
async function pruneAstroAssets(out) {
  const text = /\.(html|css|js|json|xml|txt|svg)$/;
  const dir = join(out, '_astro');
  const unreached = new Set((await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name));
  let seen = '';
  for (const f of await readdir(out, { recursive: true })) {
    if (text.test(f) && f.split(/[\\/]/)[0] !== '_astro') seen += (await readFile(join(out, f), 'utf8')) + '\n';
  }
  // A file stays if some page, or some file that stays, names it (scripts import each other).
  for (let found = true; found; ) {
    found = false;
    for (const f of unreached) {
      if (!seen.includes(f)) continue;
      unreached.delete(f);
      found = true;
      if (text.test(f)) seen += (await readFile(join(dir, f), 'utf8')) + '\n';
    }
  }
  await Promise.all([...unreached].map((f) => rm(join(dir, f))));
}

// public/_redirects still sends the old WooCommerce URLs to /shop/ pages with a permanent 301.
// While the shop is off those go straight to the quote page, so no Location header names a
// shop path and no browser caches a permanent redirect into the hidden shop.
const redirectsToQuote = (text) =>
  text
    .split('\n')
    .map((line) => {
      const [from, to] = line.trim().split(/\s+/);
      return !line.startsWith('#') && to?.startsWith('/shop') ? `${from} /quote/ 302` : line;
    })
    .join('\n');

/** @type {import('astro').AstroIntegration} */
const shopSwitch = {
  name: 'shop-switch',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      if (site.store.enabled) return;
      const out = fileURLToPath(dir);
      await rm(join(out, 'shop'), { recursive: true, force: true });
      await pruneAstroAssets(out);
      const redirects = await readFile(join(out, '_redirects'), 'utf8').catch(() => '');
      await writeFile(
        join(out, '_redirects'),
        redirectsToQuote(redirects) +
          [
            '',
            '# Parts shop is off (site.store.enabled = false in src/config/site.ts).',
            '/shop /quote/ 302',
            '/shop/* /quote/ 302',
            '',
          ].join('\n'),
      );
      // The search index is gone, so its cache rule goes too.
      const headers = await readFile(join(out, '_headers'), 'utf8').catch(() => '');
      if (headers) await writeFile(join(out, '_headers'), headers.replace(/^\/shop\/search-index\.json\n(?:[ \t]+.*\n?)*/m, ''));
    },
  },
};

export default defineConfig({
  site: site.url,
  trailingSlash: 'always',
  build: { format: 'directory' },
  // The CSP is script-src 'self': never let Vite inline a small bundled script into the HTML.
  vite: { build: { assetsInlineLimit: 0 } },
  integrations: [
    sitemap({
      // The quote page and its thank-you page are noindex, so keep them out of the sitemap.
      // While the parts shop is off, so is everything under /shop/.
      filter: (page) => {
        const { pathname } = new URL(page);
        return !/\/quote\/(thanks\/)?$/.test(pathname) && (site.store.enabled || !pathname.startsWith('/shop/'));
      },
    }),
    shopSwitch,
  ],
});
