# C&M Machine Shop website

Static rebuild of the Elementor/WordPress site: a product catalog where
visitors build a quote list and send it by email. Built with
[Astro](https://astro.build), hosted on Cloudflare Workers (static assets) from this repo, with
forms delivered by [Web3Forms](https://web3forms.com).

## Status

Content and design are rebuilt from the Simply Static export of cmmachshop.com
(services, machinery, about, contact, brand colors, Geist font, logo) plus the
replacement-parts catalog for VFFS (vertical form fill seal) packaging machines under `/shop/`.
`npm run prelaunch` lists everything still left before DNS can point here (every `TODO` and `CONFIRM` in the config,
the pages and the content), then prints, for information only, the owner work it cannot block on: parts with
`oemVerify`, parts with owner `flags`, parts without a photo, draft service-area pages and empty social links.

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
| OEM part number index (`/shop/part-numbers/`) and catalog CSV (`/shop/catalog.csv`) | `src/pages/shop/part-numbers/index.astro`, `src/pages/shop/catalog.csv.ts`; both read `src/lib/catalog.ts` |
| How to order page (`/how-to-order/`) and its FAQ | `src/pages/how-to-order.astro` (facts from `src/config/site.ts`) |
| IndexNow key and submit script | `indexNowKey` in `src/config/site.ts`, `public/<key>.txt`, `scripts/indexnow.mjs` |
| Old URL → new URL redirects | `public/_redirects` |
| Security and cache headers | `public/_headers` |
| Build checks | `scripts/check-dist.mjs` |
| Browser smoke tests | `tests/smoke.spec.ts`, `playwright.config.ts` |
| Bulk-paste parser, redirect-rule and IndexNow wiring tests (no browser) | `tests/bulk-parse.spec.ts`, `tests/redirects.spec.ts`, `tests/indexnow.spec.ts` |
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

- No `/shop/` pages are generated: no catalog, section or part pages, no OEM part number
  index (`/shop/part-numbers/`), no `catalog.csv` and no `search-index.json`. The build also deletes anything left in `dist/shop/`,
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
  column (with its OEM part number index link), the home page search, Parts Store section and VFFS parts FAQ, the
  VFFS parts section and FAQ on the food processing page, the quote page's catalog
  wording and bulk paste, `llms.txt`, and the 404 and thank-you buttons.
- The red header button reads "Get a Quote" and the quote page does not fetch
  the catalog: a `?part=` number is added to the quote list as a plain line for
  the shop to look up.
- Quotes, the part-number request form, services and everything else work as
  before. `/how-to-order/` stays, and reads as a services and part request guide: it leaves out the
  catalog, the quote list and bulk paste and links nothing under `/shop/`.

**Preview the shop while it is off:** set `enabled: true` locally and run
`npm run dev`, or push a branch with it set to `true` and use the Cloudflare
preview build for that branch. Do not merge that to `main` until you want the
shop public.

## OEM part number index, catalog CSV and how to order

**`/shop/part-numbers/`** (parts shop on only) is one accessible table of every part: OEM #, C&M #,
part name, section. It is sorted by OEM number as text (so `03187A0897` sits with the other `0318…` numbers);
parts that share an OEM number go by C&M number, and parts with no OEM number come last, by C&M number.
Each row links to the part page. It is plain HTML with no script of its own, so it works with Ctrl-F and
on a slow phone: from 640px it is a table with a sticky header, below that every row stacks into a card
(OEM # and C&M # on one line, then the part name as the link, then the section). The ARIA table roles are
repeated on purpose, so the stacked rows keep their table meaning in every browser. The page links to bulk
paste, carries the part request form and the trademark disclaimer, and is linked from `/shop/`, the machine
page, the footer Shop column and `llms.txt`.

**`/shop/catalog.csv`** (parts shop on only) is the same list as a download: columns `OEM part number`,
`C&M number`, `Part name`, `Section`, `URL` (absolute), UTF-8 **with a BOM** so Excel opens it as UTF-8,
RFC 4180 (CRLF line ends, a field with a comma or a double quote is quoted, quotes are doubled). It never
carries `flags`, `nameRaw` or any other owner-only field (`src/lib/catalog.ts` copies only public fields),
and the build stops if a value starts with `=`, `+`, `-` or `@` (a spreadsheet would run it as a formula).
`public/_headers` sets `Content-Type: text/csv; charset=utf-8` and a 5-minute cache; with the shop off the
build removes that rule along with the file. Both the page and the CSV come from `getCatalogRows()` in
`src/lib/catalog.ts`, so they cannot disagree.

**`/how-to-order/`** explains how a part or job gets quoted: quote-only (no online checkout, no prices), what to
send (part number, sample, photo or drawing, quantity, needed by, pickup or shipping with ZIP), the quote
list, bulk paste and the part request form, the reply time, local pickup (address and hours from the
`site.hours` helpers), shipping (`site.store.shipping`), phone and email, and a six-question FAQ. The FAQ is
rendered once and feeds both the visible `<details>` and the FAQPage JSON-LD, so they always match. Every fact
comes from `src/config/site.ts` or from what the quote and part request forms already say: when you change
the reply time, hours, pickup or shipping there, this page follows. It is linked from the footer Company column,
the quote page ("How ordering works"), `/shop/`, `llms.txt` and the sitemap.

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

The quote, contact and part request forms need a name and at least one of email or phone. Neither is
`required` in the HTML (that would force both, and the form must still post without JavaScript). The
two inputs sit in a `<fieldset data-reach id="...">`; `src/scripts/web3forms-submit.ts` shows one error
for the pair ("Enter an email or a phone number so we can reply.") when both are empty, tied to both
fields with `aria-invalid` and `aria-describedby`. An email that is typed is still checked as an email,
and an empty email is left out of the Web3Forms request (Web3Forms uses `email` as the reply-to).

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
  page that does not match `parts.json`, a broken `search-index.json`, an OEM part number
  index whose rows are not one per part in order and linking each part page, or a
  `catalog.csv` that has no BOM, is not valid RFC 4180, does not match `parts.json` row for row
  (absolute URLs that resolve), carries a `flags` note, a `nameRaw` or a formula-like cell, or lacks its
  `_headers` rule; with
  the shop off: anything left of `/shop/`, a link that still points there, or a
  `/shop` rule in `_redirects` that is not a `302` to `/quote/`;
- two indexable pages with the same meta description, a title over 65 characters on
  `/how-to-order/` or `/shop/part-numbers/`, or the IndexNow key file missing from `dist/` or not
  holding the key;
- a fact that drifted from `src/config/site.ts`: JSON-LD `geo` while the config has no pin, a LocalBusiness
  `hasMap` or any Google Maps link that is not `site.maps`, a stated number of years ("20 years") in a page or
  in `llms.txt` (only the founding year is stated), or a FAQPage question or answer that is not also on the page
  as visible text;
- the manufacturer's name (case-insensitive, owner request Oct 2026) in any served
  file: every file under `dist/` is scanned (HTML, XML, TXT, JSON, JS, CSS, SVG, webmanifest,
  and images and fonts as raw bytes, so a new file type is covered too), also when the name is
  spelled with entities, `\u` escapes or markup in the middle, and in a file name.
  `_redirects` and `_headers` are not served, so they are excluded. `shop/catalog.csv` is scanned
  like every other file (also with its CSV quotes taken out). A logo drawn inside a
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
the OEM part number index (146 rows in order, every link answers, no JavaScript needed, stacked rows and no sideways
scroll on a phone, head tags and breadcrumb), the catalog CSV (downloaded through its link: BOM, 147 lines,
RFC 4180 quoting, matches `parts.json`, no owner-only text), `/how-to-order/` (facts from the config, the FAQ matching
its JSON-LD, both shop states) and the footer, quote page, shop and `llms.txt` links, and a console-error
check of the main pages. With the shop off the part-number and CSV tests skip and one test checks they are not
built. `tests/indexnow.spec.ts` checks the IndexNow wiring as data (it never runs the script).
`tests/bulk-parse.spec.ts` checks
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
uploads its Playwright report. The optional `deploy` job waits for both legs, deploys, and then runs
`npm run indexnow` as a best-effort step (see "IndexNow").

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
   use to pick up changes fast. `npm run indexnow` (below) does the same on
   demand, from this repo.
3. **Google Business Profile**: claim or verify it, category "Machine
   shop", the same name/address/phone as the site, hours, photos, and the
   website link. The listing link is already in `site.maps` (footer and contact address links, schema.org
   `hasMap`; it joins `sameAs` once the owner has opened it and confirmed it is the C&M listing). No `geo` coordinates are published: add them to `site.ts` and the LocalBusiness
   in `src/lib/schema.ts` only from the real pin on the Business Profile, never a guess. A profile URL
   of its own goes in `site.social.googleBusiness`.
4. **Bing Places** and **Apple Business Connect**: same details. Bing data
   feeds ChatGPT search and Copilot; Apple feeds Siri and Maps.
5. **Search Console and Bing Webmaster Tools**: submit `/sitemap-index.xml`.
6. **Reviews**: ask happy customers for Google reviews. Ratings were
   removed from the site until real reviews exist.

### IndexNow

[IndexNow](https://www.indexnow.org) is an open protocol: a site tells the participating search engines
(Bing, Yandex, Naver, Seznam, Yep) which URLs exist or changed, and they crawl them within hours instead
of waiting for their next visit. Bing's index also feeds Copilot and ChatGPT search. Google does not take part.
Sending a list costs nothing and changes no ranking by itself: it only gets the pages looked at sooner.

- **The key.** A random 32-hex-character key proves the list comes from the site's owner. It is
  `indexNowKey` in `src/config/site.ts`, and the site serves it as `https://cmmachshop.com/<key>.txt`
  (the file `public/<key>.txt`, containing only the key). It is public by design. To rotate it, generate
  a new one (`node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`), rename the file,
  put the same key in the file and in `site.ts`; `npm run check:dist` fails if the two disagree.
- **The script.** `scripts/indexnow.mjs` reads the URLs from `dist/sitemap-*.xml` (or, given a site
  address, from that site's live `sitemap-index.xml`) and POSTs `host`, `key`, `keyLocation` and
  `urlList` (up to 10,000 per request) to `https://api.indexnow.org/indexnow`, then prints the HTTP status
  (200 or 202 is success). Before sending it fetches the key file from the site, as IndexNow itself will.
  It exits `0` with a plain message when there is no network, when the site is not live yet (the key file
  is not served) or when IndexNow is busy; it exits `1` only for a mistake in this repo (bad argument, no key,
  a key file that does not match) or when IndexNow rejects the request (400, 403, 422).
- **Never in tests.** No test and no `package.json` script calls it, it refuses to run inside a
  Playwright worker or with `NODE_ENV=test`, and `--dry-run` prints what it would send without any network.
- **GitHub Actions deploy.** The `deploy` job runs `npm run indexnow` right after `wrangler deploy`
  (`continue-on-error`, so it can never fail a deploy).

**After a Workers Builds deploy** (the Cloudflare Git integration, which cannot run it for you), run it by hand
once the new version is live, from a checkout of `main`:

```bash
npm ci && npm run build        # writes dist/sitemap-*.xml
npm run indexnow               # sends every URL in the sitemap
npm run indexnow -- --dry-run  # prints what would be sent, sends nothing
```

or, without a build, straight from the live sitemap: `npm run indexnow -- https://cmmachshop.com`.
If it says the key file is not served yet, wait for the deploy to finish and run it again. Run it after a
deploy that adds or changes pages (a new catalog part, a copy change); there is no need after every
small fix, and sending the same list twice is harmless.

## Content source

Rebuilt from the Simply Static export (`_export/simply-static-1-1791239758.zip`
on the `site-export` branch). Never deploy the export itself. Old URLs are
mapped in `public/_redirects`.
