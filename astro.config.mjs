// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { site } from './src/config/site.ts';

export default defineConfig({
  site: site.url,
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [
    sitemap({
      // The quote page and its thank-you page are noindex, so keep them out of the sitemap.
      filter: (page) => !/\/quote\/(thanks\/)?$/.test(new URL(page).pathname),
    }),
  ],
});
