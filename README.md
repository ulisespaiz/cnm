# CNM website

Static rebuild of the Elementor/WordPress site: a product catalog where
visitors build a quote list and send it by email. Built with
[Astro](https://astro.build), hosted on Cloudflare Pages from this repo, with
forms delivered by [Web3Forms](https://web3forms.com).

## Status

The framework is done. Content is placeholder until the Simply Static export is
extracted (see [Content extraction](#content-extraction)). `npm run prelaunch`
lists everything still left before DNS can point here.

## Local development

```bash
npm install
cp .env.example .env    # add PUBLIC_WEB3FORMS_KEY
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

The URL is `/products/<category-id>/<file-name>/`.

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

1. Create an access key at web3forms.com using the inbox that should receive
   quotes. The key is public by design: it can only send mail to that inbox.
2. Set `PUBLIC_WEB3FORMS_KEY` in Cloudflare Pages (Settings → Variables and
   Secrets) for Production and Preview, and in `.env` locally.
3. Submit a test quote from the deployed site and confirm it arrives (check
   spam the first time and allow-list the sender).

The email contains the selected products (name, options, quantity, link),
the customer's details, city and preferred contact method. Spam protection is
a honeypot field; add Web3Forms' hCaptcha or move to a Cloudflare Pages
Function with Turnstile if spam gets through. File uploads are not supported
on the Web3Forms free plan; see the plan in the PR if customers need them.

If JavaScript fails, the form still posts directly to Web3Forms and redirects
to `/quote/thanks/`. If the request fails, the customer sees a prefilled
`mailto:` fallback.

## Deploying (Cloudflare Pages)

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git →
   select this repo.
2. Build command `npm run build`, output directory `dist`, environment variable
   `NODE_VERSION=22` plus `PUBLIC_WEB3FORMS_KEY`.
3. Every push to `main` deploys; every other branch gets a preview URL.
4. Before go-live: `npm run prelaunch` passes, `public/_redirects` covers the
   old URLs, then add the custom domain in Pages.
5. After go-live: submit `/sitemap-index.xml` in Google Search Console and
   Bing Webmaster Tools, and update the website link on the Google Business
   Profile.

## Content extraction

Source: the Simply Static export (`simply-static-1-1791239758.zip`), to be
committed on the `site-export` branch under `_export/`. Never deploy the export
itself.

1. **Inventory**: list every HTML page with its URL path, page type
   (product / category / content / utility / junk) and the images it really
   uses (not every resized copy WordPress generated).
2. **Extraction**: for each product, write `src/content/products/<slug>.md`
   in the format above, keep the original copy, and copy only the largest
   original of each image used into `src/assets/products/`. Write the
   categories, About copy and business details into the config.
3. **Redirects**: map every old URL to its new path in `public/_redirects`.
4. **Brand**: lift colors, fonts and logo from the export into the CSS tokens.
5. **Verify**: `npm run build`, check each page on a phone-sized screen,
   `npm run prelaunch`.
