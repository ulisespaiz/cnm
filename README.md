# C&M Machine Shop website

Static rebuild of the Elementor/WordPress site: a product catalog where
visitors build a quote list and send it by email. Built with
[Astro](https://astro.build), hosted on Cloudflare Workers (static assets) from this repo, with
forms delivered by [Web3Forms](https://web3forms.com).

## Status

Content and design are rebuilt from the Simply Static export of cmmachshop.com
(services, machinery, about, contact, brand colors, Geist font, logo) plus the
replacement-parts catalog for VFFS (vertical form fill seal) packaging machines under `/shop/`.
`npm run prelaunch` lists everything still left before DNS can point here.

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
| Parts shop on/off switch | `store.enabled` in `src/config/site.ts` |
| Cities offered in the form and listed on the hub | `serviceAreas` in `src/config/site.ts` |
| Parts catalog (one object per part) | `src/content/parts.json`; its sections in `sections.json`, the machine in `machines.json` |
| Part photos | `src/assets/parts/` (referenced from `parts.json`) |
| Services (one file each) | `src/content/services/*.md` |
| Machinery | `src/content/equipment.json`, images in `src/assets/equipment/` |
| Home page sections, FAQ, work gallery | `src/pages/index.astro` |
| City pages (one file each) | `src/content/areas/*.md` |
| Colors, fonts, spacing | tokens at the top of `src/styles/global.css` |
| Old URL → new URL redirects | `public/_redirects` |
| Security and cache headers | `public/_headers` |
| Build checks | `scripts/check-dist.mjs` |
| Browser smoke tests | `tests/smoke.spec.ts`, `playwright.config.ts` |
| Bulk-paste parser and redirect-rule tests (no browser) | `tests/bulk-parse.spec.ts`, `tests/redirects.spec.ts` |
| CI and the optional GitHub Actions deploy | `.github/workflows/ci.yml` |

### Adding or editing a part

Parts live in `src/content/parts.json`, one object each, in catalog order. The
build validates the file (`src/lib/parts.ts`) and stops with a list of problems,
so a bad entry never ships. The page is `/shop/<machine>/<section>/<id>/`; the one
machine is `vffs`, so a part is at `/shop/vffs/registration/10097a2083-gear-spur/`.

```json
{
  "id": "10097a2083-gear-spur",
  "machine": "vffs",
  "section": "registration",
  "name": "Gear Spur",
  "nameRaw": "GEAR SPUR",
  "oem": "10097A2083",
  "oemKey": "10097A2083",
  "oemAlt": [],
  "oemVerify": false,
  "cm": "CM-0111",
  "type": "gear",
  "images": ["./../assets/parts/10097a2083-cm-0111.jpg"],
  "imageAlt": "Gear Spur, OEM part number 10097A2083",
  "description": "Plain text that names CM-0111 and 10097A2083 ...",
  "order": 118,
  "flags": []
}
```

- The `id` is the part's public URL, and customers' saved quote lists and search
  engines keep it. Never change an `id` once the part is live. If one must change,
  add a `301` from the old page URL (with and without the trailing slash) to the
  new one in `public/_redirects`, and note that a quote list saved in a customer's
  browser still holds the old id.
- `cm` is the C&M number (`CM-0111`, unique). `oem` is the OEM part number as
  shown, `oemKey` the same number with only capital letters and digits. A part
  with no OEM number leaves out both and is found by its C&M number.
- An OEM number is 5 digits, a letter and 4 digits. Anything else (or a
  number two parts share) needs `"oemVerify": true`, which marks it for the owner
  to confirm. `oemAlt` lists extra spellings that should also match in search.
- `description` (optional) is plain text, 600 characters at most. When it is set it
  must contain the C&M number and the OEM number, and may only state facts
  from the catalog. Say "OEM part number" (never the manufacturer's name: see "The
  manufacturer's name" below).
- `flags` are notes for the owner about the data ("Verify: ..."). They are never
  shown on the site.
- The photo goes in `src/assets/parts/`, named after the part numbers.

### The manufacturer's name (owner request, Oct 2026)

The owner asked for the machine manufacturer's name, Hayssen, to be **gone from the website**.
Nothing a visitor is served may contain it: pages, JSON-LD, titles and meta tags, `llms.txt`,
the search index, scripts, styles, file names. How the shop reads instead:

- Part numbers are labelled **OEM #** (column headers, cards, rows, quote lines, the quote email) and
  **OEM part number** in prose. The OEM number is the original equipment manufacturer's number; it
  only identifies the part our replacement matches.
- The machine is `vffs` ("VFFS Packaging Machines"): URLs are `/shop/vffs/...`. In copy say "VFFS
  packaging machines", or "vertical form fill seal (VFFS) packaging machines" on first mention.
  Never imply a part fits every VFFS machine: fit is identified by the OEM part number.
- `site.store.disclaimer` is brand-free (OEM numbers identify the part; C&M is independent and not
  affiliated with or endorsed by any machine manufacturer) and stays on every shop page.
- Search and the bulk-paste box still work when a customer types a brand or "OEM" in front of a
  number (`Hayssen 03027A9240`, `OEM# 03027A9240`, `oem 03027-A9240`) without the word being in any
  shipped file: the parsers are generic. A word in front of a number that matches nothing is
  ignored, and the part-number-shaped run of words is matched on its own.
- Old URLs keep working: `public/_redirects` sends `/shop/hayssen-vffs` and `/shop/hayssen-vffs/*`
  to `/shop/vffs/` with a 301 (the source paths keep the old word; that file is not served).
  Two placeholder rules (`/shop/hayssen-vffs/:section/:slug` and `/:section`) send old section and
  part URLs requested without a trailing slash straight to the slash form, so they take one 301
  instead of a 301 and then Cloudflare's own trailing-slash redirect; the two renamed part ids have
  their own rules, before these, pointing at their final URL.
  With the shop off, the build turns these into `302 /quote/` like every other shop path.
- The word may still appear in `public/_redirects` (sources), in `parts.json` `flags` (owner notes,
  never rendered) and in `scripts/check-dist.mjs` (the guard). `npm run check:dist` **fails** if the
  name (any capitalization) appears in a file under `dist/` other than `_redirects` and `_headers`.
- A quote list saved in a customer's browser before the change keeps working: its part links are
  rewritten to `/shop/vffs/...` when it is read, and a part whose page id was renamed folds into one
  line by its C&M number.

### City pages: publishing rules

City pages start as `draft: true` and are excluded from production. Only flip
one to `draft: false` when it has content that would be false if you swapped
the city name: projects done there, reviews from there, delivery or install
details, local conditions, real FAQs. Pages that differ only by city name are
treated as doorway pages under Google's spam policies and can drag down the
whole site. The template in each draft lists what to gather.

Cities without a page are still listed on `/service-areas/` and in the
LocalBusiness `areaServed` data.

## Parts shop on/off

The VFFS parts catalog under `/shop/` is live. One line in
`src/config/site.ts` controls it: `true` shows the shop, `false` hides it from
the public.

```ts
store: {
  enabled: true, // Parts shop switch (see README "Parts shop on/off")
```

All the shop code stays in the repo; flip it to `false` to hide the shop again
and back to `true` to show it.

**While it is `false`** (the build output, not just the links):

- No `/shop/` pages are generated: no catalog, section or part pages and no
  `search-index.json`. The build also deletes anything left in `dist/shop/`,
  keeps `/shop/` out of the sitemap, and deletes the part photos and shop
  scripts and styles that no page uses from `dist/_astro/`, plus
  `shop-early.js` (the store home's search script) at the site root, so none of
  them stays a public URL.
- `/shop` and `/shop/*` answer with a `302` to `/quote/` (the build appends
  these rules to `dist/_redirects`; the old `/product/*` links and the old
  catalog path (`/shop/hayssen-vffs/*`, which normally redirects to `/shop/vffs/`)
  in `public/_redirects` are rewritten in `dist/_redirects` to `302` straight to
  `/quote/` too, so no redirect names a shop path).
- Nothing else points at the shop: the Shop nav item, header button and footer
  column, the home page search, Parts Store section and VFFS parts FAQ, the
  VFFS parts section and FAQ on the food processing page, the quote page's catalog
  wording and bulk paste, `llms.txt`, and the 404 and thank-you buttons.
- The red header button reads "Get a Quote" and the quote page does not fetch
  the catalog: a `?part=` number is added to the quote list as a plain line for
  the shop to look up.
- Quotes, the part-number request form, services and everything else work as
  before.

**Preview the shop while it is off:** set `enabled: true` locally and run
`npm run dev`, or push a branch with it set to `true` and use the Cloudflare
preview build for that branch. Do not merge that to `main` until you want the
shop public.

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

## Checks

Run these before opening a pull request. CI runs the same ones on every push and
pull request.

```bash
npm run build                      # production build into dist/
npm run check:dist                 # validate dist/ (no dependencies, about a second)
npm run check                      # type-check .astro, .ts and .mjs files (astro check)
npx playwright install chromium    # once: downloads the browser the tests use
npm run test:e2e                   # Playwright smoke tests against `astro preview`
```

**`npm run check:dist`** (`scripts/check-dist.mjs`) reads the built `dist/` and
exits with code 1 when it finds:

- an internal link, image, script, stylesheet, form action or share image that
  does not resolve to a file (trailing-slash pages and the rules in
  `dist/_redirects` are honoured), or a redirect that goes nowhere;
- a page without exactly one `<title>`, or without exactly one meta description
  of at most 160 characters;
- the text `undefined`, `NaN` or `[object Object]` on a page, or a JSON-LD block
  that does not parse;
- an indexable page missing from the sitemap, or a sitemap entry that is missing,
  `noindex` or off-site;
- markup the Content-Security-Policy in `public/_headers` would block: an inline
  script, an inline event handler, an inline `<style>`, or a resource from
  another site;
- with the shop on: a part page without a Product JSON-LD with a `sku`, a part
  page that does not match `parts.json`, or a broken `search-index.json`; with
  the shop off: anything left of `/shop/`, a link that still points there, or a
  `/shop` rule in `_redirects` that is not a `302` to `/quote/`;
- the manufacturer's name (case-insensitive, owner request Oct 2026) in any served
  file: every file under `dist/` is scanned (HTML, XML, TXT, JSON, JS, CSS, SVG, webmanifest,
  and images and fonts as raw bytes, so a new file type is covered too), also when the name is
  spelled with entities, `\u` escapes or markup in the middle, and in a file name.
  `_redirects` and `_headers` are not served, so they are excluded. A logo drawn inside a
  part photo cannot be found by text: look at the photos once.

It prints a short report; warnings (for example a link to an `#id` that does not
exist) do not fail the run. Options: a folder (default `dist`), `--shop=on|off`
(default: the `store.enabled` switch) and `--all` (list every problem instead of
the first 40 of each kind).

**`npm run test:e2e`** runs `tests/smoke.spec.ts` in Chromium against
`astro preview` on port 4321, so build first and free that port. It covers the
home page and navigation, shop search (also with "OEM" or any other word in front
of a number), adding a part to the quote list from a part page and from
`/quote/?part=10097A2083&qty=2`, sending the quote form and the contact form,
and a console-error check of the main pages. `tests/bulk-parse.spec.ts` checks
the bulk-paste parser against the built search index (no browser).
`tests/redirects.spec.ts` reads `public/_redirects` (and `dist/_redirects` with
the shop off) as data and checks the old catalog path, the renamed part ids, the
slashless placeholder rules and the `302`s to `/quote/`; `astro preview` does not
apply redirects, so they are not followed in a browser.

- Web3Forms is never contacted: `https://api.web3forms.com/**` is answered
  locally with `{"success": true}` and the test reads the payload. Any other
  request that leaves the machine is blocked and fails the test.
- Pages are served with the Content-Security-Policy from `public/_headers`
  (`astro preview` does not apply `_headers`), so a script or style the real
  site would refuse shows up as a console error.
- To use a Chromium you already have instead of the downloaded one:
  `PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.
- If port 4321 is taken (another preview or build running in this folder), pick
  another one: `PW_PORT=4399 npm run test:e2e`.

**Both shop states.** `check:dist` compares the build with the `store.enabled`
switch and the Playwright tests follow the build they find. To test the shop
off, set `store.enabled` to `false` in `src/config/site.ts`, run
`npm run build && npm run check:dist && npm run test:e2e` (the shop tests are
skipped), then set it back to `true` and rebuild.

**CI** (`.github/workflows/ci.yml`) runs on pull requests and on pushes to `main` (a
branch is checked once, through its pull request; a newer push to a branch cancels
the older run). The `build` job has two legs, one per parts shop state; the checks are named
`Build and test (shop on)` and `Build and test (shop off)`, so if branch protection requires the
old name `Build and test`, change the required checks to these two. Each builds
with Node 24 and runs `check:dist` and the Playwright tests; the **shop on** leg also
runs `npm run check` (`astro check`, which type-checks `.astro` files too), and the
**shop off** leg first rewrites the `enabled: true, // Parts shop switch` line in
`src/config/site.ts` to `false` inside the job (nothing is committed). A failed leg
uploads its Playwright report. The optional `deploy` job waits for both legs.

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

### Deploying from GitHub Actions

An alternative to Workers Builds: the `deploy` job in `.github/workflows/ci.yml`
runs `wrangler deploy` from GitHub Actions on every push to `main`, after the
build, `check:dist`, type-check and smoke tests have passed in both shop states. **Use one or the
other.** With both on, every push to `main` is deployed twice.

1. Create a Cloudflare API token with the **Workers Scripts: Edit** permission
   (My Profile > API Tokens; the "Edit Cloudflare Workers" template includes it).
2. In the GitHub repo, Settings > Secrets and variables > Actions, add two
   repository secrets: `CLOUDFLARE_API_TOKEN` (the token) and
   `CLOUDFLARE_ACCOUNT_ID` (your Cloudflare account ID, shown on the Workers &
   Pages overview).
3. Disconnect Workers Builds so the site is not deployed twice: Cloudflare
   dashboard > Workers & Pages > `cnmwebsite` > Settings > Builds > disconnect
   the Git repository.
4. Push to `main` and watch the Actions tab. The Worker name, assets, redirects
   and headers all come from `wrangler.jsonc` and `public/`, as before.

Until `CLOUDFLARE_API_TOKEN` exists the `deploy` job only prints a notice and
deploys nothing, so merging the workflow changes nothing by itself. To go back,
delete the secret and reconnect Workers Builds. Preview builds for other
branches are a Workers Builds feature: GitHub Actions only deploys `main`.

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
