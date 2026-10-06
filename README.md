# C&M Machine Shop website

Static rebuild of the Elementor/WordPress site: a product catalog where
visitors build a quote list and send it by email. Built with
[Astro](https://astro.build), hosted on Cloudflare Workers (static assets) from this repo, with
forms delivered by [Web3Forms](https://web3forms.com).

## Status

Content and design are rebuilt from the Simply Static export of cmmachshop.com
(services, machinery, about, contact, 4 products in 4 categories, brand colors,
Geist font, logo). `npm run prelaunch` lists everything still left before DNS
can point here.

## Local development

```bash
npm install
cp .env.example .env    # optional: override the Web3Forms key
npm run dev             # http://localhost:4321, drafts visible
npm run build           # production build in dist/, drafts excluded
SHOW_DRAFTS=1 npm run build   # production build including drafts, for review
```

## Where things live

| What | Where |
|---|---|
| Business name, phone, address, hours, domain | `src/config/site.ts` |
| Cities offered in the form and listed on the hub | `serviceAreas` in `src/config/site.ts` |
| Product categories | `src/content/categories.json` |
| Products (one file each) | `src/content/products/*.md` |
| Product images | `src/assets/products/` (referenced from product files) |
| Services (one file each) | `src/content/services/*.md` |
| Machinery | `src/content/equipment.json`, images in `src/assets/equipment/` |
| Home page sections, FAQ, work gallery | `src/pages/index.astro` |
| City pages (one file each) | `src/content/areas/*.md` |
| Colors, fonts, spacing | tokens at the top of `src/styles/global.css` |
| Old URL → new URL redirects | `public/_redirects` |
| Security and cache headers | `public/_headers` |

### Adding a product

```markdown
---
title: Product Name
category: category-id          # an id from categories.json
summary: One or two sentences, shown on cards and as the meta description.
images:
  - src: ../../assets/products/product-name-1.jpg
    alt: What the photo shows
options:                       # choices made before adding to the quote
  - name: Size
    values: [Small, Medium, Large]
specs:
  - label: Material
    value: Steel
featured: false
order: 10
---

Long description in Markdown.
```

The URL is `/shop/<category-id>/<file-name>/`.

### City pages: publishing rules

City pages start as `draft: true` and are excluded from production. Only flip
one to `draft: false` when it has content that would be false if you swapped
the city name: projects done there, reviews from there, delivery or install
details, local conditions, real FAQs. Pages that differ only by city name are
treated as doorway pages under Google's spam policies and can drag down the
whole site. The template in each draft lists what to gather.

Cities without a page are still listed on `/service-areas/` and in the
LocalBusiness `areaServed` data.

## Quote form (Web3Forms)

1. The access key for cmoreno@cmmachshop.com (Web3Forms form "C&M Shop") is
   committed in `src/config/forms.ts`. The key is public by design: it is in
   every form's HTML and can only send mail to that inbox. To send quotes to a
   different inbox, create a new key at web3forms.com and replace it there.
2. Optional: `PUBLIC_WEB3FORMS_KEY` (in `.env` or as a Cloudflare build
   variable) overrides the committed key, e.g. to test against your own inbox.
3. Submit a test quote from the deployed site and confirm it arrives (check
   spam the first time and allow-list the sender).

The email contains the selected products (name, options, quantity, link),
the customer's details, city and preferred contact method. Spam protection is
a honeypot field; add Web3Forms' hCaptcha or move the form to a Cloudflare Worker
with Turnstile if spam gets through. File uploads are not supported
on the Web3Forms free plan; see the plan in the PR if customers need them.

If JavaScript fails, the form still posts directly to Web3Forms and redirects
to `/quote/thanks/`. If the request fails, the customer sees a prefilled
`mailto:` fallback.

## Deploying (Cloudflare Workers)

The site deploys as a static-assets Worker named `cnmwebsite`, configured in
`wrangler.jsonc` (no Worker script, no Astro adapter). Workers Builds is
connected to this repo:

- Deploy command: `npx wrangler deploy` (the default). `wrangler.jsonc`
  runs `npm run build` first, so a separate build command is optional.
- Variables: none required. `PUBLIC_WEB3FORMS_KEY` is an optional override
  and, if used, must be a **build** variable (Settings > Builds > Variables
  and secrets), since Astro inlines it.
- Every push to `main` deploys to production; other branches get preview
  builds and a status check on the PR.
- `_redirects` and `_headers` in `public/` are applied by Workers Static
  Assets; `404.html` is served for unknown paths.

Before go-live: `npm run prelaunch` passes, then add the custom domain
(Settings > Domains & Routes) and a www-to-apex redirect rule.

Test locally with Cloudflare's runtime: `npx wrangler dev` (builds, then
serves `dist` with the redirects and headers applied).

## Search and AI visibility

Built in:

- `robots.txt` allows everything and names AI crawlers explicitly (OpenAI,
  Anthropic, Perplexity, Google-Extended, Apple, Bing, DuckDuckGo, Meta).
- `llms.txt` is generated from the content collections, so it never drifts.
- JSON-LD on every page: LocalBusiness (logo, founding date, hours, contact
  point, area served, services catalog, `knowsAbout`) and WebSite; plus
  Service, Product, BreadcrumbList and FAQPage where relevant.
- Default share image `public/og.jpg` (1200x630, built from the real CNC machining center photo `src/assets/work/our-work-2.jpg`; regenerate if the brand changes).
- Photos: real C&M shop photos only (no stock or AI images). `our-work-1` Timesavers finishing machine, `our-work-2` CNC machining center, `our-work-6` Sharp 22120B lathe, plus `src/assets/equipment/` and the storefront shots in `src/assets/site/`.
- Q&A sections on every service page and the industry page.

Do these at launch; they matter more than anything in the code:

1. **Cloudflare: allow AI crawlers.** Cloudflare can block AI bots at the
   edge regardless of robots.txt. Check Security > Bots and AI Crawl Control
   and make sure search/assistant crawlers are allowed.
2. **Cloudflare: turn on Crawler Hints** (Caching > Configuration). It
   pings IndexNow, which Bing, and through it Copilot and ChatGPT search,
   use to pick up changes fast.
3. **Google Business Profile**: claim or verify it, category "Machine
   shop", the same name/address/phone as the site, hours, photos, and the
   website link. Then put its URL in `site.social.googleBusiness` and the
   map pin in `site.geo`.
4. **Bing Places** and **Apple Business Connect**: same details. Bing data
   feeds ChatGPT search and Copilot; Apple feeds Siri and Maps.
5. **Search Console and Bing Webmaster Tools**: submit `/sitemap-index.xml`.
6. **Reviews**: ask happy customers for Google reviews. Ratings were
   removed from the site until real reviews exist.

## Content source

Rebuilt from the Simply Static export (`_export/simply-static-1-1791239758.zip`
on the `site-export` branch). Never deploy the export itself. Old URLs are
mapped in `public/_redirects`.
