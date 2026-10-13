# CLAUDE.md

C&M Machine Shop Inc.: a family-owned machine shop in Salinas, CA. This repo is its static Astro 7
website: service and service-area pages, machinery, a quote form (Web3Forms), and a quote-only parts
store for replacement parts for VFFS (vertical form fill seal) packaging machines under `/shop/` (no prices, no checkout: customers add parts
to a quote list kept in localStorage and send it). Deployed as a Cloudflare Workers static-assets
site (`wrangler.jsonc`, `public/_headers`, `public/_redirects`). README.md has the owner-facing detail.

## Hard rules

- Never invent business facts: hours, prices, lead times, stock, certifications, specs, reviews.
  Unknown means `null` or a `CONFIRM` note in `src/config/site.ts` (`npm run prelaunch` lists them).
- Never send a real form submission, in tests or by hand. Route `https://api.web3forms.com/**` to a
  local `{ "success": true }`.
- No inline scripts (see "CSP" below).
- The machine manufacturer's name appears in nothing the site serves (owner request, Oct 2026; see
  "Catalog data"). `npm run check:dist` enforces it.
- Kill servers you start by PID. Never `pkill -f` (it kills your own shell).
- Do not commit or push unless asked.

## Commands

```bash
npm install
npm run dev              # http://localhost:4321, drafts visible, no CSP
npm run build            # production build into dist/ (drafts excluded)
npm run check:dist       # validates dist/ without dependencies (links, SEO tags, JSON-LD, sitemap, CSP)
npm run check            # type-check .astro, .ts and .mjs files (astro check)
npm run test:e2e         # Playwright smoke tests against `astro preview`; build first
npm run prelaunch        # lists TODO/CONFIRM left before go-live
npm run indexnow         # tells IndexNow (Bing etc.) the sitemap URLs; deploy-time only, see "IndexNow"
```

- `tests/a11y.spec.ts` guards the accessibility fixes (em breakpoints, inert phone menu, 320px reflow, live regions, footer hours).
- `tests/redirects.spec.ts` checks `public/_redirects` as data (astro preview does not apply redirects);
  `tests/bulk-parse.spec.ts` checks the bulk-paste parser. Both need no browser.
- Tests in a sandbox: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`.
- Do not run `npm run build` (it empties `dist/`) or the e2e tests in this folder while another agent or terminal is
  building or previewing here; builds collide with ENOENT. Use `PW_PORT=<free port>` if 4321 is taken.
- Astro 7 puts `astro preview` in the background when it detects an AI agent. Playwright uses
  `--ignore-lock`; for a manual preview use `npx astro preview stop` or kill the PID.
- `trailingSlash` is `always` and pages are `dir/index.html`: link to `/about/`, not `/about`.

## Where things live

- `src/config/site.ts`: business details, hours, shop switch, store copy. Single source of truth.
- `src/config/forms.ts`: Web3Forms endpoint and (public) access key.
- `src/content/parts.json`, `sections.json`, `machines.json`: the parts catalog. Photos: `src/assets/parts/`.
- `src/content/services/`, `areas/` (city pages, `draft: true` until they have real local content),
  `equipment.json`. Collections and their schemas: `src/content.config.ts`.
- `src/lib/parts.ts` validates the catalog at build time; `partkey.ts` normalizes part numbers
  (shared by build and browser); `schema.ts` builds JSON-LD.
- `src/scripts/`: browser code (quote store, search, forms). `public/*-early.js`: tiny classic
  scripts that run before first paint.
- `astro.config.mjs`: sitemap filter and the `shopSwitch` hook that prunes `dist/` when the shop is off.
- `src/lib/catalog.ts` (`getCatalogRows`, `catalogCsv`) feeds `/shop/part-numbers/` (the OEM part number index) and
  `/shop/catalog.csv`; both exist only with the shop on. Only public part fields go in: never `flags` or `nameRaw`.
- `src/pages/how-to-order.astro`: quote-only ordering guide and FAQ, in both shop states; every fact comes from
  `src/config/site.ts` (reply time, pickup, shipping, hours, phone, email). Do not add a fact there that is not in the config
  or on the quote and part request forms.

## Catalog data (`src/content/parts.json`)

- One object per part, in catalog order (`order`). Page: `/shop/<machine>/<section>/<id>/`.
  `id` is the slug of the OEM number plus name (`10097a2083-gear-spur`); a part with no OEM
  number uses `cm-0117-...`. The machine is `vffs` (`/shop/vffs/<section>/<id>/`).
  The `id` is a public URL (and is saved in customers' quote lists): never change one that is live.
  If it must change, add 301 rules for the old URL (with and without the trailing slash) to
  `public/_redirects`.
- `cm`: C&M number, `CM-` plus 4 digits (currently CM-0001 to CM-0146), unique. Customers quote these: never renumber or reuse.
- `oem`: OEM number as displayed (`03187A0897`). `oemKey`: the same with only A-Z0-9
  (`oemKey()` in `src/lib/partkey.ts`); the build fails if they disagree. A part with no OEM
  number omits both and is found by its C&M number.
- Standard format is 5 digits, a letter, 4 digits. Anything else, or a number two parts share, needs
  `oemVerify: true` (the owner must confirm it). `oemAlt` holds extra keys that must also match search
  (typos as written in the source). `nameRaw` is the name exactly as in the source catalog.
- `flags` are notes for the owner about data quality. They are never rendered; add one instead of
  guessing, and do not delete the owner's. `note`, in contrast, is shown on the part page.
- `description` (optional, 600 characters at most) uses only catalog facts: name, size, material and
  the numbers. It must mention the C&M number and the OEM number (the build checks). No claims
  about stock, lead time, price, quality or fit beyond the part numbers. `availability` stays `ask`.
- **No manufacturer name on the website (owner request, Oct 2026).** The word "Hayssen" must appear in
  no file the site serves: visible text, aria-labels, titles and meta tags, JSON-LD, `llms.txt`, the
  search index, scripts, styles, file names. The part-number label is **"OEM #"** (columns, cards, rows,
  ident blocks, chips, quote lines, the quote email summary, toasts) and **"OEM part number"** in prose;
  JSON-LD uses the property name "OEM part number" and `isAccessoryOrSparePartFor` "VFFS packaging machine".
  The machine is `vffs`, "VFFS Packaging Machines": say "VFFS packaging machines" (or "vertical form fill
  seal (VFFS) packaging machines" on first mention) and never imply a part fits every VFFS machine; fit is
  identified by the OEM part number ("matched by OEM part number"). No logos or imagery of any maker.
  Allowed leftovers: `public/_redirects` sources (the old `/shop/hayssen-vffs/` URLs 301 to `/shop/vffs/`, with
  placeholder rules so slashless old URLs take one hop; the file is not served), `flags` in `parts.json` (owner notes, never rendered) and the guard itself.
  `npm run check:dist` fails if the name (case-insensitive) is in any served file in `dist/` (every
  file, images included, also with entities or markup in the middle of the word). Search and
  bulk paste must stay brand-agnostic: a word in front of a number that matches nothing is ignored, so
  "<any word> 03027A9240", "OEM# 03027A9240" and "oem 03027-A9240" all find the part; do not list brands.
  A C&M number inside a longer query ("<any word> CM-0111") is read as that exact key, never as a digit
  run matched by prefix. A logo inside a part photo cannot be found by text: look at the photos.
- Descriptions never say a part "fits" (build check): write "a replacement for OEM part number X" or
  "made to match ...", and "an OEM", not "a OEM" (build check).
- Other wording rules: say "replacement", "made to match your part number, sample or print". Never
  "genuine", "authorized" or "official" in public copy. "OEM" is allowed only as the number label above.
  `site.store.disclaimer` (the `StoreDisclaimer` component) is brand-free and stays on every shop page.

## Parts shop switch

`site.store.enabled` in `src/config/site.ts` (a plain literal: `astro.config.mjs` imports the file)
hides the whole shop: no `/shop/` pages, search index, part photos or shop links, `/shop*` redirects
to `/quote/` (302), and the quote page adds `?part=` numbers as plain lines. It is currently ON.
Everything you add to a shared page (nav, footer, home, quote, 404, llms.txt) must respect it.
Details: README "Parts shop on/off".

## IndexNow

`site.indexNowKey` (`src/config/site.ts`) is also the name and content of `public/<key>.txt`; `check:dist` fails if they
disagree. `scripts/indexnow.mjs` POSTs the sitemap URLs to `https://api.indexnow.org/indexnow`. It runs only in the CI
`deploy` job (after `wrangler deploy`, `continue-on-error`) or by hand. **Never run it in a test or from an agent session
without `--dry-run`**: no test, npm test script or build step may call it (`tests/indexnow.spec.ts` checks the wiring as data).
It exits 0 with a message when offline or when the site is not live yet.

## Accessibility

Goal: WCAG 2.2 AA; `/accessibility/` says what was checked and what is known to fall short (README "Privacy policy and accessibility statement").
- Media queries are in `em` (`48em`, not `768px`), so a larger default text size gets the phone layout. No `overflow-x: hidden` on `body`.
- Never add a claim to the statement that no check backs; when a review is repeated, update its date, "How we test" and "Known limitations" together.
- The privacy policy (`/privacy/`) follows the same rule: it says only what the code, `src/config/site.ts` or the owner has confirmed (no deletion
  schedule, inbox access, response deadline or Web3Forms retention the repo cannot show). Open owner questions are `CONFIRM` lines in the page's
  top comment, so `npm run prelaunch` lists them. A line of text that ends before a tag or `{expression}` loses its line break in Astro, so keep
  "(see <a>" on one line (a test checks the built pages).

## CSP

`public/_headers` sets `script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'`.
- No inline `<script>`, `on*=` handlers, `javascript:` URLs or inline `<style>` blocks. Write browser
  code in `src/scripts/` (bundled to `/_astro/`) or as a file in `public/` loaded with `src`.
  JSON-LD `<script type="application/ld+json">` is fine. `vite.build.assetsInlineLimit` is 0 so Vite
  never inlines a bundle into the HTML.
- Allowed origins: `connect-src` and `form-action` add `https://api.web3forms.com`; everything else is
  same-origin. No third-party scripts, fonts, embeds or trackers without changing the policy on purpose.
- `npm run check:dist` and `npm run test:e2e` both enforce this (the tests serve pages with the policy).

## Web3Forms

All forms (quote, contact, part request) share `bindWeb3Form` in `src/scripts/web3forms-submit.ts`:
JS posts `FormData` to the endpoint, then shows success or goes to `/quote/thanks/`; without JS the form
posts directly and Web3Forms redirects there. The access key is public by design; `PUBLIC_WEB3FORMS_KEY`
overrides it. A failed send shows a `mailto:` fallback. Tests must stub the endpoint (see Hard rules).

## Verifying a change

1. `npm run build` (the catalog is validated here, so data mistakes fail the build).
2. `npm run check:dist`, `npm run check`, `npm run test:e2e`. All must pass; CI runs the same, once with
   the shop on and once with it off (a matrix leg that rewrites the switch line inside the job).
3. Check both shop states when you touch a shared page, the catalog, redirects or the quote flow: set
   `store.enabled: false`, rebuild, run `check:dist` and `test:e2e` (shop tests skip), then restore
   `true` and rebuild. Never leave the switch flipped.
4. For UI work, open the page in a browser (dev or preview) at phone and desktop widths.

## Git and PRs

- Work on a feature branch (this repo uses `claude/<name>` branches), open a PR into `main`; the owner
  merges it. A push to `main` deploys to production (Workers Builds, or the optional GitHub Actions
  `deploy` job; only one of the two may be on, see README).
- Commit subject: short, imperative, no trailing period, often `Area: what changed`
  (`Shop: one switch to hide the parts shop`). The body says what and why, with bullets for details.
  End with the `Co-Authored-By` and `Claude-Session` trailers.
- CI checks are named `Build and test (shop on)` and `Build and test (shop off)`; if branch protection
  still requires the old `Build and test`, change the required checks.
- Keep a PR to one topic. State what you ran (build, check:dist, check, test:e2e, both shop states) and
  anything you could not verify. Keep `package-lock.json` in step with `package.json`.
- Agent worktrees live in `.claude/worktrees/` (gitignored). Test output (`test-results/`,
  `playwright-report/`) is gitignored too.
