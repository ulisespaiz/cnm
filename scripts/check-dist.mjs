#!/usr/bin/env node
// Validates a built dist/ with no dependencies. Run after `npm run build`:
//
//   npm run check:dist                 checks ./dist
//   node scripts/check-dist.mjs out/   checks another folder
//   node scripts/check-dist.mjs --shop=off   expect a shop-OFF build (default: read
//                                            site.store.enabled from src/config/site.ts)
//   --all                              list every problem (default: the first 40 of each kind)
//
// Errors (exit code 1):
//   - an internal href / src / srcset / form action / social image that does not
//     resolve to a file in dist (trailing-slash directory pages and the redirect
//     rules in dist/_redirects are honoured), or a redirect that goes nowhere
//   - a page without exactly one <title>, or without exactly one meta description
//     of at most 160 characters
//   - the text "undefined", "NaN" or "[object Object]" rendered on a page
//   - a JSON-LD block that does not parse
//   - an indexable page missing from the sitemap, or a sitemap entry that is
//     missing, noindex or off-site
//   - markup the Content-Security-Policy in dist/_headers would block (inline
//     scripts, event-handler attributes, inline <style>, off-site resources)
//   - shop ON: a part page without a Product JSON-LD with a sku, a part page that
//     does not match src/content/parts.json, a bad shop/search-index.json
//   - shop ON: /shop/part-numbers/ (the OEM part number index) with one row per part, in order, each
//     linking to its part page; /shop/catalog.csv (UTF-8 with a BOM, RFC 4180, a header and one record
//     per part, absolute URLs that resolve, no owner-only text, no cell a spreadsheet would run as a
//     formula) and its _headers rule
//   - shop OFF: anything left of /shop/, a link that still points there, or a /shop rule in
//     _redirects that is not a 302 to /quote/
//   - two pages with the same meta description; a title over 65 characters on the pages added for
//     search (/how-to-order/, /shop/part-numbers/); the IndexNow key file (site.indexNowKey in
//     src/config/site.ts) missing from dist or not holding the key
//   - facts that must not drift from src/config/site.ts: JSON-LD `geo` while site.ts has no pin, a LocalBusiness
//     hasMap or any Google Maps link that is not site.maps, a stated number of years ("20 years") in a page or in
//     llms.txt, and a FAQPage question or answer that is not also on the page as visible text
//   - the old machine manufacturer's name (owner request, Oct 2026) in any file visitors are
//     served: every file in dist (text, scripts, styles, images and fonts as raw bytes) and every
//     file name, also when spelled with entities, escapes or markup in the middle. _redirects and
//     _headers are never served, so the old URLs may keep the word there.
// Warnings are printed but do not fail the run.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------- Arguments ----------

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const showAll = args.includes('--all');
const distArg = args.find((a) => !a.startsWith('--')) ?? 'dist';
const root = resolve(distArg);

if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`check-dist: ${distArg}/ not found. Run "npm run build" first.`);
  process.exit(1);
}

const errors = []; // { where, msg }
const warnings = [];
const error = (where, msg) => errors.push({ where, msg });
const warn = (where, msg) => warnings.push({ where, msg });

// ---------- Reading dist ----------

const files = new Set(); // posix paths relative to dist, no leading slash
(function walk(dir, prefix) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
    else files.add(`${prefix}${name}`);
  }
})(root, '');

const read = (rel) => readFileSync(join(root, ...rel.split('/')), 'utf8');
const htmlFiles = [...files].filter((f) => f.endsWith('.html')).sort();

if (!htmlFiles.length) {
  error('dist', 'no HTML files found: the build output is empty');
}

// ---------- Small helpers ----------

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', times: '×', copy: '©', reg: '®', trade: '™',
  deg: '°', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾', rarr: '→', larr: '←', laquo: '«', raquo: '»',
  bull: '•', minus: '−', prime: '′', Prime: '″',
  // Invisible characters: the brand guard (unmask) strips them after decoding, so "Hay&shy;ssen" is caught.
  shy: '­', zwj: '‍', zwnj: '‌', ZeroWidthSpace: '​',
};

function decode(s) {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));/gi, (m, dec, hex, name) => {
    try {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
    } catch {
      return m;
    }
    return ENTITIES[name] ?? m;
  });
}

const chars = (s) => [...s].length;
const snippet = (text, at, len = 0) => text.slice(Math.max(0, at - 30), at + len + 30).replace(/\s+/g, ' ').trim();

const TAG = /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(source) {
  const attrs = {};
  for (const m of source.matchAll(ATTR)) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

function srcsetUrls(value) {
  const urls = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i])) i++;
    let j = i;
    while (j < value.length && !/\s/.test(value[j])) j++;
    let url = value.slice(i, j);
    i = j;
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else while (i < value.length && value[i] !== ',') i++; // skip the "2x" descriptor
    if (url) urls.push(url);
  }
  return urls;
}

// ---------- Site facts: origin, shop switch, CSP ----------

const home = files.has('index.html') ? read('index.html') : '';
const canonicalOfHome = /<link\b[^>]*\brel="canonical"[^>]*\bhref="([^"]+)"/i.exec(home)?.[1] ?? /<link\b[^>]*\bhref="([^"]+)"[^>]*\brel="canonical"/i.exec(home)?.[1];
let origin = '';
try {
  origin = new URL(decode(canonicalOfHome ?? '')).origin;
} catch {
  error('/', 'the home page has no usable <link rel="canonical">, so the site origin is unknown');
  origin = 'https://example.invalid';
}

const configText = existsSync('src/config/site.ts') ? readFileSync('src/config/site.ts', 'utf8') : '';
const configShop = /store:\s*\{[^}]*?\benabled:\s*(true|false)/s.exec(configText)?.[1];
// Facts the pages must keep in step with the config (checked per page below).
const configMaps = /^\s*maps:\s*'([^']*)'/m.exec(configText)?.[1];
const configHasGeo = /^\s*geo:\s*\{/m.test(configText); // a real pin was added to site.ts: JSON-LD may then carry it
const MAPS_LINK = /^(?:https?:)?\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i;
const YEARS = /\b\d+\+?\s?years\b/i; // "20 years", "20+ years": goes stale, nothing in the config backs it
const squash = (t) => decode(String(t)).replace(/\s+/g, ' ').trim();
const hasGeo = (v) =>
  Array.isArray(v) ? v.some(hasGeo) : v && typeof v === 'object' ? 'geo' in v || v['@type'] === 'GeoCoordinates' || Object.values(v).some(hasGeo) : false;
const wantShop = flag('shop') ?? (configShop ? (configShop === 'true' ? 'on' : 'off') : 'auto');
const builtShop = files.has('shop/index.html');
// The switch decides what the build should contain; without a switch, the build decides.
const shopOn = wantShop === 'auto' ? builtShop : wantShop === 'on';
if (shopOn && !builtShop) error('/shop/', 'the shop is ON (site.store.enabled) but dist has no shop/index.html (built with the shop OFF?)');
if (!shopOn && builtShop) error('/shop/', 'the shop is OFF (site.store.enabled) but dist contains shop pages (built with the shop ON?)');
const shopLabel = shopOn ? 'ON' : 'OFF';

// Content-Security-Policy from the catch-all block of dist/_headers.
const csp = {};
if (files.has('_headers')) {
  const line = read('_headers').split('\n').find((l) => /^\s*Content-Security-Policy:/i.test(l));
  for (const part of (line ?? '').replace(/^\s*Content-Security-Policy:/i, '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) csp[name.toLowerCase()] = sources;
  }
}
const hasCsp = Object.keys(csp).length > 0;
const policy = (...names) => {
  for (const n of names) if (csp[n]) return csp[n];
  return csp['default-src'];
};
const allowsInline = (...names) => !hasCsp || !!policy(...names)?.includes("'unsafe-inline'");
const allowsOrigin = (list, url) => !hasCsp || !list || list.includes('*') || list.includes(url.protocol) || list.includes(url.origin);

// ---------- Redirects (dist/_redirects, as deployed) ----------

const rules = [];
if (files.has('_redirects')) {
  for (const line of read('_redirects').split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const [from, to, status = '301'] = text.split(/\s+/);
    if (!to || !from.startsWith('/')) continue; // host-based rules are not path rules
    const names = [];
    let pattern = '';
    for (const part of from.split(/(\*|:[A-Za-z_]\w*)/)) {
      if (part === '*') {
        names.push('splat');
        pattern += '(.*)';
      } else if (/^:[A-Za-z_]/.test(part)) {
        names.push(part.slice(1));
        pattern += '([^/]+)';
      } else pattern += part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
    rules.push({ from, to, status: Number(status), names, re: new RegExp(`^${pattern}$`) });
  }
}

function matchRedirect(path) {
  for (const rule of rules) {
    const m = rule.re.exec(path);
    if (!m) continue;
    const values = Object.fromEntries(rule.names.map((n, i) => [n, m[i + 1]]));
    return { rule, target: rule.to.replace(/:([A-Za-z_]\w*)/g, (all, n) => values[n] ?? all) };
  }
  return null;
}

// ---------- Resolving a path the way Workers Static Assets serves it ----------
// html_handling "auto-trailing-slash": /about/ is about/index.html, /x is x.html or x/index.html.

function lookupFile(path) {
  if (path === '/' || path.endsWith('/')) {
    const rel = `${path.slice(1)}index.html`;
    return files.has(rel) ? { file: rel } : null;
  }
  const rel = path.slice(1);
  if (files.has(rel)) return { file: rel };
  if (files.has(`${rel}.html`)) return { file: `${rel}.html` };
  if (files.has(`${rel}/index.html`)) return { file: `${rel}/index.html`, noSlash: true };
  return null;
}

// -> { ok, file?, redirected, noSlash, reason? }
function resolvePath(path, trail = []) {
  const found = lookupFile(path);
  if (found) return { ok: true, ...found, redirected: trail.length };
  const hit = matchRedirect(path);
  if (!hit) return { ok: false, reason: 'no such file' };
  if (trail.length >= 5 || trail.includes(path)) return { ok: false, reason: 'redirect loop or chain longer than 5' };
  let next;
  try {
    next = new URL(hit.target, origin);
  } catch {
    return { ok: false, reason: `redirect to unusable target ${hit.target}` };
  }
  if (next.origin !== origin) return { ok: true, redirected: trail.length + 1, external: true };
  const result = resolvePath(decodeURIComponent(next.pathname), [...trail, path]);
  return result.ok ? result : { ...result, reason: `redirects to ${next.pathname}: ${result.reason}` };
}

// A reference as written in the page -> a path in this site, or null when it is not ours.
function internalPath(raw, pageUrl) {
  const value = raw.trim();
  if (!value || value.startsWith('#')) return null;
  if (/^(mailto|tel|sms|data|blob|about):/i.test(value)) return null;
  let url;
  try {
    url = new URL(value, origin + pageUrl);
  } catch {
    return { bad: true };
  }
  if (url.origin !== origin) return null;
  try {
    return { path: decodeURIComponent(url.pathname), hash: url.hash.slice(1) };
  } catch {
    return { bad: true };
  }
}

// ---------- Pages ----------

const pageUrl = (rel) => (rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`);
const WORD = /\b(?:undefined|NaN)\b|\[object Object\]/;
const CSP_FOR = {
  script: ['script-src-elem', 'script-src'],
  stylesheet: ['style-src-elem', 'style-src'],
  img: ['img-src'],
  font: ['font-src'],
  frame: ['frame-src', 'child-src'],
  media: ['media-src'],
  object: ['object-src'],
  form: ['form-action'],
};

const pages = []; // { rel, url, noindex, stub, ids, jsonld, title, description }
const fragments = []; // { from, path, hash }
const brokenRefs = new Map(); // "ref (reason)" -> pages that use it
let refsChecked = 0;
let viaRedirect = 0;
const noSlashLinks = new Set();

function note(map, key, page) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(page);
}

function checkRef(page, raw, kind, tagName) {
  if (raw === undefined || raw === null) return;
  const value = raw.trim();
  if (!value || value.startsWith('#')) {
    if (value.length > 1) fragments.push({ from: page.url, path: page.url, hash: value.slice(1) });
    return;
  }
  if (/^javascript:/i.test(value)) {
    if (!allowsInline('script-src-attr', 'script-src')) error(page.url, `javascript: URL in <${tagName}> (blocked by the CSP)`);
    return;
  }
  const ours = internalPath(value, page.url);
  if (ours === null) {
    // Not this site: only the CSP cares, and only about things the browser loads.
    if (kind && /^(https?:)?\/\//i.test(value)) {
      const url = new URL(value.startsWith('//') ? `https:${value}` : value);
      if (!allowsOrigin(policy(...CSP_FOR[kind]), url)) error(page.url, `<${tagName}> loads ${url.origin}, which the Content-Security-Policy does not allow`);
    }
    return;
  }
  if (ours.bad) {
    note(brokenRefs, `${value} (not a valid URL)`, page.url);
    return;
  }
  refsChecked++;
  if (!shopOn && /^\/shop(\/|$)/.test(ours.path)) {
    error(page.url, `links to ${ours.path} while the shop is OFF (<${tagName}>)`);
    return;
  }
  const result = resolvePath(ours.path);
  if (!result.ok) {
    note(brokenRefs, `${ours.path} (${result.reason})`, page.url);
    return;
  }
  if (result.redirected) viaRedirect++;
  if (result.noSlash) noSlashLinks.add(ours.path);
  if (ours.hash && result.file && !result.redirected) fragments.push({ from: page.url, path: pageUrl(result.file), hash: decodeURIComponent(ours.hash) });
}

for (const rel of htmlFiles) {
  const url = pageUrl(rel);
  const html = read(rel);
  const page = { rel, url, noindex: false, stub: false, ids: new Set(), jsonld: [], title: '', description: '' };
  pages.push(page);

  // Scripts first (their bodies are code or JSON, not markup), then take bodies and comments out.
  const scripts = [];
  let markup = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_all, attrSource, body) => {
    scripts.push({ attrs: parseAttrs(attrSource), body });
    return `<script ${attrSource}></script>`;
  });
  const inlineStyles = [...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].length;
  markup = markup.replace(/<style\b([^>]*)>[\s\S]*?<\/style>/gi, '<style $1></style>').replace(/<!--[\s\S]*?-->/g, '');
  const noSvg = markup.replace(/<svg\b[\s\S]*?<\/svg>/gi, '');

  // Tags
  const tags = [];
  for (const m of markup.matchAll(TAG)) tags.push({ name: m[1].toLowerCase(), attrs: parseAttrs(m[2]) });
  const metas = tags.filter((t) => t.name === 'meta');
  page.stub = metas.some((t) => t.attrs['http-equiv']?.toLowerCase() === 'refresh');
  page.noindex = page.stub || metas.some((t) => t.attrs.name?.toLowerCase() === 'robots' && /noindex/i.test(t.attrs.content ?? ''));
  for (const t of tags) if (t.attrs.id) page.ids.add(t.attrs.id);

  // Title and description (an Astro redirect stub has neither and is not a page)
  if (!page.stub) {
    const titles = [...noSvg.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
    if (titles.length !== 1) error(url, `${titles.length} <title> elements (need exactly 1)`);
    else if (!decode(titles[0][1]).trim()) error(url, 'the <title> is empty');
    else page.title = decode(titles[0][1]).trim();

    const descriptions = metas.filter((t) => t.attrs.name?.toLowerCase() === 'description');
    if (descriptions.length !== 1) error(url, `${descriptions.length} meta descriptions (need exactly 1)`);
    else {
      const text = (descriptions[0].attrs.content ?? '').trim();
      if (!text) error(url, 'the meta description is empty');
      else if (chars(text) > 160) error(url, `meta description is ${chars(text)} characters (max 160)`);
      else page.description = text;
    }
  }

  // Text that should never be rendered. Every tag counts as a word break, except <span class="nowrap">: it only
  // keeps a phrase ("1–2 business days") on one line, so "within <span>1–2 business days</span>." reads as one sentence.
  const text = decode(noSvg.replace(/<span class="nowrap">([^<]*)<\/span>/g, '$1').replace(TAG, ' '));
  const seen = WORD.exec(text);
  if (seen) error(url, `renders "${seen[0]}": …${snippet(text, seen.index, seen[0].length)}…`);
  const years = YEARS.exec(text);
  if (years) error(url, `states a number of years ("${years[0]}"), which goes stale; the site gives the founding year only: …${snippet(text, years.index, years[0].length)}…`);
  if (configMaps) {
    for (const t of tags) {
      const href = t.attrs.href;
      if (t.name === 'a' && href && MAPS_LINK.test(href) && decode(href) !== configMaps) error(url, `a map link (${href}) is not site.maps (${configMaps})`);
    }
  }
  for (const t of tags) {
    for (const [name, value] of Object.entries(t.attrs)) {
      const bad = WORD.exec(value);
      if (bad) error(url, `<${t.name} ${name}> contains "${bad[0]}": ${snippet(value, bad.index, bad[0].length)}`);
    }
  }

  // JSON-LD
  scripts.forEach((s, n) => {
    if (s.attrs.type?.toLowerCase() !== 'application/ld+json') return;
    let data;
    try {
      data = JSON.parse(s.body);
    } catch (e) {
      error(url, `JSON-LD block ${n + 1} does not parse: ${e.message}`);
      return;
    }
    page.jsonld.push(data);
    const walkLd = (v, path) => {
      if (typeof v === 'string') {
        const bad = WORD.exec(v);
        if (bad) error(url, `JSON-LD value ${path} contains "${bad[0]}": ${snippet(v, bad.index, bad[0].length)}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walkLd(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkLd(x, `${path}.${k}`);
    };
    walkLd(data, '$');
    const nodes = [data].flat().flatMap((d) => (Array.isArray(d?.['@graph']) ? d['@graph'] : [d]));
    if (!nodes.length || nodes.some((d) => !d || typeof d !== 'object' || !d['@type'])) error(url, `JSON-LD block ${n + 1} has an entry without @type`);

    // Facts that come from the config
    if (!configHasGeo && hasGeo(data)) error(url, 'JSON-LD has `geo` / GeoCoordinates, but site.ts has no pin (coordinates are never guessed)');
    for (const d of nodes) {
      if (!d || typeof d !== 'object') continue;
      if (configMaps && typeof d['@id'] === 'string' && d['@id'].endsWith('/#business') && d.hasMap !== configMaps) {
        error(url, `the LocalBusiness hasMap (${JSON.stringify(d.hasMap)}) is not site.maps (${configMaps})`);
      }
      // A FAQPage may only say what the page also shows, word for word.
      if (d['@type'] === 'FAQPage') {
        const visible = squash(text);
        for (const q of Array.isArray(d.mainEntity) ? d.mainEntity : []) {
          const name = squash(q?.name ?? '');
          const answer = squash(q?.acceptedAnswer?.text ?? '');
          if (!name || !answer) error(url, 'FAQPage JSON-LD has a question or an answer with no text');
          else if (!visible.includes(name)) error(url, `FAQPage question is not on the page as visible text: "${snippet(name, 0)}"`);
          else if (!visible.includes(answer)) error(url, `FAQPage answer to "${snippet(name, 0)}" is not on the page as visible text`);
        }
      }
    }
  });

  // Content-Security-Policy: what the browser would refuse to run
  scripts.forEach((s) => {
    const type = (s.attrs.type ?? '').toLowerCase();
    const isCode = !s.attrs.src && !(type && type !== 'module' && !/javascript|ecmascript/.test(type));
    if (isCode && s.body.trim() && !allowsInline('script-src-elem', 'script-src')) error(url, `inline <script> (the CSP only allows scripts from 'self'): ${snippet(s.body.trim(), 0)}`);
  });
  if (inlineStyles && !allowsInline('style-src-elem', 'style-src')) error(url, `${inlineStyles} inline <style> element(s) (the CSP only allows stylesheets from 'self')`);
  for (const t of tags) {
    for (const name of Object.keys(t.attrs)) {
      if (/^on[a-z]+$/.test(name) && !allowsInline('script-src-attr', 'script-src')) error(url, `<${t.name} ${name}> is an inline event handler (blocked by the CSP)`);
    }
    if (t.attrs.style !== undefined && !allowsInline('style-src-attr', 'style-src')) warn(url, `<${t.name} style="…"> is blocked by the CSP`);
  }

  // Links, assets and every other reference
  for (const t of tags) {
    const a = t.attrs;
    const rels = (a.rel ?? '').toLowerCase().split(/\s+/);
    if (t.name === 'a' || t.name === 'area') checkRef(page, a.href, null, t.name);
    else if (t.name === 'link') {
      const preload = rels.includes('preload');
      const kind =
        rels.includes('stylesheet') || (preload && a.as === 'style')
          ? 'stylesheet'
          : rels.includes('modulepreload') || (preload && a.as === 'script')
            ? 'script'
            : preload && a.as === 'font'
              ? 'font'
              : preload && a.as === 'image'
                ? 'img'
                : rels.some((r) => /^(icon|apple-touch-icon|mask-icon)$/.test(r))
                  ? 'img'
                  : null;
      checkRef(page, a.href, kind, 'link');
      if (a.imagesrcset) srcsetUrls(a.imagesrcset).forEach((u) => checkRef(page, u, 'img', 'link'));
      if (rels.includes('canonical') && !page.noindex) {
        const mine = internalPath(a.href ?? '', url);
        if (!mine || mine.bad) warn(url, `canonical ${a.href} is not on ${origin}`);
        else if (mine.path !== url) warn(url, `canonical points at ${mine.path}, not at the page itself`);
      }
    } else if (t.name === 'script') checkRef(page, a.src, 'script', 'script');
    else if (t.name === 'img' || t.name === 'source') {
      checkRef(page, a.src, 'img', t.name);
      if (a.srcset) srcsetUrls(a.srcset).forEach((u) => checkRef(page, u, 'img', t.name));
    } else if (t.name === 'iframe') checkRef(page, a.src, 'frame', t.name);
    else if (t.name === 'video' || t.name === 'audio' || t.name === 'track') {
      checkRef(page, a.src, 'media', t.name);
      checkRef(page, a.poster, 'img', t.name);
    } else if (t.name === 'embed') checkRef(page, a.src, 'object', t.name);
    else if (t.name === 'object') checkRef(page, a.data, 'object', t.name);
    else if (t.name === 'form') checkRef(page, a.action, 'form', t.name);
    else if (t.name === 'meta') {
      const key = (a.property ?? a.name ?? '').toLowerCase();
      if (/^(og:image|og:url|twitter:image)$/.test(key) && /^(https?:)?\/\/|^\//.test(a.content ?? '')) checkRef(page, a.content, null, 'meta');
    }
    // Paths the page scripts read from data attributes (quote list thumbnails and part links)
    for (const name of ['data-url', 'data-thumb', 'data-href']) if (a[name]) checkRef(page, a[name], null, `${t.name} ${name}`);
  }
}

for (const [key, from] of brokenRefs) {
  const list = [...from];
  error(list[0], `broken reference ${key}${list.length > 1 ? `, also on ${list.length - 1} other page(s): ${list.slice(1, 4).join(' ')}${list.length > 4 ? ' …' : ''}` : ''}`);
}

if (noSlashLinks.size) warn('links', `${noSlashLinks.size} link target(s) lack the trailing slash and are redirected: ${[...noSlashLinks].slice(0, 3).join(' ')}${noSlashLinks.size > 3 ? ' …' : ''}`);

// Fragments: #id must exist on the page it points at (warning: a script may add it later)
const pageByUrl = new Map(pages.map((p) => [p.url, p]));
const seenFragments = new Set();
for (const f of fragments) {
  const target = pageByUrl.get(f.path);
  const key = `${f.path}#${f.hash}`;
  if (!target || target.ids.has(f.hash) || target.stub || seenFragments.has(`${f.from}|${key}`)) continue;
  if (f.hash === 'top') continue;
  seenFragments.add(`${f.from}|${key}`);
  warn(f.from, `links to ${key}, but no element has that id`);
}

// ---------- Redirect rules ----------

for (const rule of rules) {
  if (/:[A-Za-z_]/.test(rule.to)) continue; // target depends on the request
  let next;
  try {
    next = new URL(rule.to, origin);
  } catch {
    error('_redirects', `${rule.from}: unusable target ${rule.to}`);
    continue;
  }
  if (next.origin !== origin) continue;
  const result = resolvePath(next.pathname);
  if (!result.ok) error('_redirects', `${rule.from} -> ${rule.to} goes nowhere (${result.reason})`);
  else if (result.redirected) warn('_redirects', `${rule.from} -> ${rule.to} is a redirect chain; point it at the final URL`);
}

// ---------- Sitemap ----------

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decode(m[1]));
const sitemapUrls = new Set();
let sitemapFiles = 0;

function readSitemap(path, depth = 0) {
  const found = resolvePath(path);
  if (!found.ok || !found.file) {
    error('sitemap', `${path} does not exist in dist`);
    return;
  }
  sitemapFiles++;
  const xml = read(found.file);
  if (/<sitemapindex\b/.test(xml)) {
    if (depth > 2) return;
    for (const loc of locs(xml)) {
      const ours = internalPath(loc, '/');
      if (!ours || ours.bad) error('sitemap', `${found.file} lists ${loc}, which is not on ${origin}`);
      else readSitemap(ours.path, depth + 1);
    }
    return;
  }
  for (const loc of locs(xml)) {
    const ours = internalPath(loc, '/');
    if (!ours || ours.bad) {
      error('sitemap', `lists ${loc}, which is not on ${origin}`);
      continue;
    }
    if (sitemapUrls.has(ours.path)) warn('sitemap', `lists ${ours.path} twice`);
    sitemapUrls.add(ours.path);
  }
}

if (files.has('sitemap-index.xml') || files.has('sitemap.xml')) readSitemap(files.has('sitemap-index.xml') ? '/sitemap-index.xml' : '/sitemap.xml');
else error('sitemap', 'no sitemap-index.xml in dist');

const indexable = pages.filter((p) => !p.noindex);
for (const p of indexable) if (!sitemapUrls.has(p.url)) error(p.url, 'indexable page is missing from the sitemap');
for (const path of sitemapUrls) {
  const p = pageByUrl.get(path);
  if (!p) error('sitemap', `lists ${path}, which is not a page in dist`);
  else if (p.noindex) error('sitemap', `lists ${path}, which is noindex`);
}

if (files.has('robots.txt')) {
  for (const m of read('robots.txt').matchAll(/^sitemap:\s*(\S+)/gim)) {
    const ours = internalPath(m[1], '/');
    if (!ours || ours.bad) error('robots.txt', `Sitemap: ${m[1]} is not on ${origin}`);
    else if (!resolvePath(ours.path).ok) error('robots.txt', `Sitemap: ${m[1]} does not exist in dist`);
  }
} else error('robots.txt', 'missing');

// ---------- Titles and descriptions ----------

// Every indexable page needs its own meta description: the same text on two pages tells a search engine
// nothing about either.
const byDescription = new Map();
for (const p of indexable) if (p.description) note(byDescription, p.description, p.url);
for (const [text, urls] of byDescription) {
  if (urls.size > 1) error([...urls][0], `the same meta description is on ${urls.size} pages (${[...urls].slice(0, 3).join(' ')}${urls.size > 3 ? ' …' : ''}): "${snippet(text, 0)}"`);
}
// Search results cut a title off after about 65 characters. The pages added for search keep to it.
for (const url of ['/how-to-order/', '/shop/part-numbers/']) {
  const p = pageByUrl.get(url);
  if (p?.title && chars(p.title) > 65) error(url, `the <title> is ${chars(p.title)} characters (max 65): ${p.title}`);
}

// ---------- IndexNow key ----------
// public/<key>.txt holds the key and nothing else, and site.indexNowKey in src/config/site.ts is that key,
// so https://<site>/<key>.txt proves the site's owner sent the list (scripts/indexnow.mjs, README "IndexNow").

const indexNowKey = /^\s*indexNowKey:\s*'([^']*)'/m.exec(configText)?.[1];
let indexNowChecked = false;
if (indexNowKey !== undefined) {
  indexNowChecked = true;
  if (!/^[0-9a-f]{32}$/.test(indexNowKey)) error('src/config/site.ts', `indexNowKey must be 32 hex characters, got "${indexNowKey}"`);
  else if (!files.has(`${indexNowKey}.txt`)) error(`/${indexNowKey}.txt`, 'the IndexNow key file is missing from dist (put it in public/)');
  else if (read(`${indexNowKey}.txt`).trim() !== indexNowKey) error(`/${indexNowKey}.txt`, 'the IndexNow key file does not contain the key');
}

// ---------- Parts shop ----------

let partPages = 0;
if (shopOn) {
  const parts = existsSync('src/content/parts.json') ? JSON.parse(readFileSync('src/content/parts.json', 'utf8')) : null;
  const expected = new Map((parts ?? []).map((p) => [`/shop/${p.machine}/${p.section}/${p.id}/`, p]));

  const partPageList = pages.filter((p) => /^shop\/[^/]+\/[^/]+\/[^/]+\/index\.html$/.test(p.rel));
  partPages = partPageList.length;
  for (const p of partPageList) {
    const products = p.jsonld.flatMap((d) => (Array.isArray(d?.['@graph']) ? d['@graph'] : [d])).filter((d) => d?.['@type'] === 'Product');
    if (products.length !== 1) {
      error(p.url, `${products.length} Product JSON-LD blocks (need exactly 1)`);
      continue;
    }
    const { sku, name } = products[0];
    const hasSku = typeof sku === 'string' && sku.trim() !== '';
    if (!hasSku) error(p.url, 'Product JSON-LD has no sku');
    if (typeof name !== 'string' || !name.trim()) error(p.url, 'Product JSON-LD has no name');
    const part = expected.get(p.url);
    if (parts && !part) error(p.url, 'part page that is not in src/content/parts.json (stale build?)');
    else if (part && hasSku && sku !== part.cm) error(p.url, `Product sku is ${JSON.stringify(sku)}, the catalog says ${part.cm}`);
  }
  const missing = [...expected.keys()].filter((url) => !pageByUrl.has(url));
  if (missing.length) error('/shop/', `${missing.length} catalog part(s) have no page in dist, e.g. ${missing.slice(0, 2).join(' ')}`);
  if (!partPages) error('/shop/', 'the shop is ON but dist has no part pages');

  // The search index drives shop search, bulk paste and ?part= links
  if (!files.has('shop/search-index.json')) error('/shop/search-index.json', 'missing');
  else {
    let index;
    try {
      index = JSON.parse(read('shop/search-index.json'));
    } catch (e) {
      error('/shop/search-index.json', `does not parse: ${e.message}`);
    }
    if (index) {
      if (!Array.isArray(index) || !index.length) error('/shop/search-index.json', 'is empty');
      else {
        if (parts && index.length !== parts.length) error('/shop/search-index.json', `has ${index.length} records, the catalog has ${parts.length}`);
        for (const rec of index) {
          for (const field of ['u', 'p']) {
            if (!rec[field]) continue;
            const ours = internalPath(rec[field], '/');
            if (!ours || ours.bad || !resolvePath(ours.path).ok) error('/shop/search-index.json', `${rec.c ?? rec.i}: ${field}=${rec[field]} does not resolve`);
          }
          if (!rec.c || !rec.n || !rec.u) error('/shop/search-index.json', `record ${rec.i ?? '?'} lacks c, n or u`);
        }
      }
    }
  }

  // The expected order of the index and the CSV: OEM number (as text) then C&M number, parts with no OEM number last.
  const sectionTitles = new Map(
    (existsSync('src/content/sections.json') ? JSON.parse(readFileSync('src/content/sections.json', 'utf8')) : []).map((x) => [x.id, x.title]),
  );
  const ordered = [...(parts ?? [])].sort((a, b) => {
    const ka = a.oemKey ?? '';
    const kb = b.oemKey ?? '';
    if (!ka !== !kb) return ka ? -1 : 1;
    return ka < kb ? -1 : ka > kb ? 1 : a.cm < b.cm ? -1 : a.cm > b.cm ? 1 : 0;
  });
  const partPath = (p) => `/shop/${p.machine}/${p.section}/${p.id}/`;

  // /shop/part-numbers/: one table row per part, in that order, each row linking to its part page.
  const indexHtml = files.has('shop/part-numbers/index.html') ? read('shop/part-numbers/index.html') : null;
  if (indexHtml === null) error('/shop/part-numbers/', 'the OEM part number index is missing from dist');
  else {
    const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(indexHtml)?.[1] ?? '';
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
    const hrefs = rows.map((r) => /<a\b[^>]*\bhref="([^"]+)"/i.exec(r)?.[1]);
    if (!/<table\b/i.test(indexHtml) || !/<caption\b/i.test(indexHtml)) error('/shop/part-numbers/', 'needs a <table> with a <caption>');
    if ([...indexHtml.matchAll(/<th\b[^>]*\bscope="col"/gi)].length !== 4) error('/shop/part-numbers/', 'the table needs exactly 4 column headers (th scope="col"): OEM #, C&M #, Part name, Section');
    if (parts) {
      if (rows.length !== parts.length) error('/shop/part-numbers/', `${rows.length} table rows, the catalog has ${parts.length} parts`);
      const wrong = ordered.findIndex((p, i) => hrefs[i] !== partPath(p));
      if (rows.length === parts.length && wrong >= 0) error('/shop/part-numbers/', `row ${wrong + 1} links ${hrefs[wrong]}, expected ${partPath(ordered[wrong])} (rows must be sorted by OEM number, then parts without one by C&M number, each linking its part page)`);
    }
    if (!/href="\/shop\/catalog\.csv"/.test(indexHtml)) error('/shop/part-numbers/', 'has no link to /shop/catalog.csv');
  }

  // /shop/catalog.csv
  if (!files.has('shop/catalog.csv')) error('/shop/catalog.csv', 'missing');
  else {
    const bytes = readFileSync(join(root, 'shop', 'catalog.csv'));
    if (!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) error('/shop/catalog.csv', 'does not start with a UTF-8 byte order mark (Excel then reads it as a legacy code page)');
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    // RFC 4180: records end in CRLF, a field with a comma, quote or line break is quoted, a quote inside is doubled.
    const records = [];
    let record = [];
    let field = '';
    let quoted = false;
    let wasQuoted = false;
    let broken = '';
    for (let i = 0; i < text.length && !broken; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') {
        if (field || wasQuoted) broken = `a quote in the middle of a field (record ${records.length + 1})`;
        quoted = wasQuoted = true;
      } else if (c === ',') {
        record.push(field);
        field = '';
        wasQuoted = false;
      } else if (c === '\r' && text[i + 1] === '\n') {
        record.push(field);
        records.push(record);
        record = [];
        field = '';
        wasQuoted = false;
        i++;
      } else if (c === '\n' || c === '\r') broken = `a bare line break outside quotes (record ${records.length + 1}): records must end in CRLF`;
      else field += c;
    }
    if (!broken && quoted) broken = 'a quoted field is never closed';
    if (!broken && (field || record.length)) broken = 'the last record does not end in CRLF';
    if (broken) error('/shop/catalog.csv', broken);
    else if (parts) {
      const header = ['OEM part number', 'C&M number', 'Part name', 'Section', 'URL'];
      if (records[0]?.join('\t') !== header.join('\t')) error('/shop/catalog.csv', `the header must be ${header.map((h) => `"${h}"`).join(',')}`);
      if (records.length !== parts.length + 1) error('/shop/catalog.csv', `${records.length} lines (header + records), expected ${parts.length + 1}`);
      const byCm = new Map(parts.map((p) => [p.cm, p]));
      const seen = new Set();
      records.slice(1).forEach((r, n) => {
        const where = `record ${n + 2}`;
        if (r.length !== 5) return error('/shop/catalog.csv', `${where} has ${r.length} fields, expected 5`);
        const [oem, cm, name, section, url] = r;
        const part = byCm.get(cm);
        if (!part) return error('/shop/catalog.csv', `${where}: C&M number ${cm} is not in parts.json`);
        if (seen.has(cm)) error('/shop/catalog.csv', `${where}: ${cm} is listed twice`);
        seen.add(cm);
        if (oem !== (part.oem ?? '')) error('/shop/catalog.csv', `${where} (${cm}): OEM part number "${oem}", the catalog says "${part.oem ?? ''}"`);
        if (name !== part.name) error('/shop/catalog.csv', `${where} (${cm}): part name "${name}", the catalog says "${part.name}"`);
        if (section !== (sectionTitles.get(part.section) ?? part.section)) error('/shop/catalog.csv', `${where} (${cm}): section "${section}"`);
        if (url !== `${origin}${partPath(part)}`) error('/shop/catalog.csv', `${where} (${cm}): URL ${url} is not the absolute URL of the part page ${origin}${partPath(part)}`);
        else if (!pageByUrl.has(partPath(part))) error('/shop/catalog.csv', `${where} (${cm}): ${url} is not a page in dist`);
        // A cell that starts with = + - @ is run as a formula by a spreadsheet.
        for (const cell of r) if (/^[=+\-@\t\r]/.test(cell)) error('/shop/catalog.csv', `${where} (${cm}): "${cell}" starts with a character a spreadsheet reads as a formula`);
      });
      // Owner-only data never goes in: the notes in `flags`, and `nameRaw` (the name as written in the source catalog).
      const cells = new Set(records.flat());
      for (const p of parts) {
        for (const flag of p.flags ?? []) if (flag.trim().length >= 8 && text.includes(flag)) error('/shop/catalog.csv', `contains an owner note from parts.json (flags of ${p.cm}): "${snippet(flag, 0)}"`);
        if (p.nameRaw && p.nameRaw !== p.name && cells.has(p.nameRaw)) error('/shop/catalog.csv', `contains nameRaw of ${p.cm} ("${p.nameRaw}"), which is owner-only`);
      }
    }
  }
  const headerRule = files.has('_headers') ? /^\/shop\/catalog\.csv\n((?:[ \t]+.*\n?)*)/m.exec(read('_headers'))?.[1] : undefined;
  if (headerRule === undefined) error('_headers', 'no rule for /shop/catalog.csv (its Content-Type text/csv; charset=utf-8 and a short cache)');
  else {
    if (!/^\s*Content-Type:\s*text\/csv;\s*charset=utf-8\s*$/im.test(headerRule)) error('_headers', 'the /shop/catalog.csv rule must set Content-Type: text/csv; charset=utf-8');
    if (!/^\s*Cache-Control:/im.test(headerRule)) error('_headers', 'the /shop/catalog.csv rule must set a Cache-Control');
  }
} else {
  if (files.has('_headers') && /^\/shop\//m.test(read('_headers'))) error('_headers', 'a /shop/ header rule is left in dist/_headers while the shop is OFF');
  for (const f of files) {
    if (f.startsWith('shop/') || f === 'shop-early.js') error(`/${f}`, 'left in dist while the shop is OFF');
  }
  if (!rules.some((r) => r.from === '/shop' || r.from === '/shop/*')) warn('_redirects', 'no /shop redirect while the shop is OFF');
  // Every rule for a /shop path (the shop's own, the old catalog path, the old WooCommerce URLs) must send the visitor
  // to the quote page with a temporary redirect: no Location header may name a hidden shop page, and no browser may
  // cache a permanent redirect into it.
  for (const r of rules) {
    if (/^\/shop(\/|$)/.test(r.from) && (r.to !== '/quote/' || r.status !== 302))
      error('_redirects', `${r.from} -> ${r.to} (${r.status}): while the shop is OFF a /shop rule must be "/quote/ 302"`);
    else if (r.to.startsWith('/shop')) error('_redirects', `${r.from} -> ${r.to} still points at the hidden shop (expected "/quote/ 302")`);
  }
}

// ---------- llms.txt: no stated number of years ----------
if (files.has('llms.txt')) {
  const llms = read('llms.txt');
  const years = YEARS.exec(llms);
  if (years) error('/llms.txt', `states a number of years ("${years[0]}"), which goes stale; the site gives the founding year only: …${snippet(llms, years.index, years[0].length)}…`);
}

// ---------- The manufacturer's name (owner request, Oct 2026) ----------
// "Hayssen" must not appear anywhere visitors can read it: pages, JSON-LD, the search index, llms.txt,
// scripts, styles, manifests, a file name, or any other file the site serves. The old URLs live on in
// _redirects, which is not served. EVERY file in dist is scanned (images and fonts too, as raw bytes: a
// name in a photo's metadata is still served), not a list of extensions, so a new file type added to
// public/ is covered. Text files are scanned a second time with the usual disguises undone (HTML
// entities (named ones for soft hyphens and zero-width characters too), \u escapes, %XX, tags or invisible
// characters in the middle of the word). A logo drawn inside a
// photo cannot be found this way: the owner has to look at the photos.

const BRAND = /hayssen/i;
const NOT_SERVED = new Set(['_redirects', '_headers']);
const unmask = (text) =>
  decode(
    decode(
      text
        .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/<[^>]*>/g, ''),
    ),
  ).replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '');
let brandFiles = 0;
let brandScanned = 0;
for (const f of [...files].sort()) {
  if (NOT_SERVED.has(f)) continue;
  brandScanned++;
  if (BRAND.test(f)) {
    brandFiles++;
    error(`/${f}`, 'the manufacturer name is in the file name');
    continue;
  }
  const bytes = readFileSync(join(root, ...f.split('/')));
  let content = bytes.toString('latin1'); // the name is plain ASCII, so any byte-for-byte view finds it
  let how = '';
  let hit = BRAND.exec(content);
  if (!hit && !bytes.subarray(0, 8192).includes(0)) {
    content = unmask(bytes.toString('utf8'));
    // A CSV cell's quotes are only quoting: take them out too, so a name cut into two quoted pieces is still found.
    if (f.endsWith('.csv')) content = content.replace(/"/g, '');
    hit = BRAND.exec(content);
    how = ' (hidden by entities, escapes, markup or CSV quoting)';
  }
  if (hit) {
    brandFiles++;
    const count = content.match(new RegExp(BRAND.source, 'gi')).length;
    error(`/${f}`, `contains the manufacturer name ${count} time(s)${how}: …${snippet(content, hit.index, hit[0].length)}…`);
  }
}

// ---------- Report ----------

const noindexCount = pages.length - indexable.length;
console.log(`check-dist  ${distArg}/  (shop ${shopLabel}, ${origin})`);
console.log(`  pages      ${pages.length} HTML (${indexable.length} indexable, ${noindexCount} noindex)${shopOn ? `, ${partPages} part pages` : ''}`);
console.log(`  references ${refsChecked} internal checked, ${viaRedirect} via redirects, ${rules.length} redirect rules`);
console.log(`  sitemap    ${sitemapUrls.size} URLs in ${sitemapFiles} file(s)`);
console.log(`  brand name ${brandFiles ? `FOUND in ${brandFiles} file(s)` : `none in ${brandScanned} served files${files.has('shop/catalog.csv') ? ' (shop/catalog.csv included)' : ''}`}`);
if (indexNowChecked) console.log(`  indexnow   key file ${indexNowKey}.txt present`);

const limit = showAll ? Infinity : 40;
const print = (label, list) => {
  list.slice(0, limit).forEach((e) => console.log(`  ${label}  ${e.where}: ${e.msg}`));
  if (list.length > limit) console.log(`  … and ${list.length - limit} more ${label.toLowerCase()}(s), run with --all to list them`);
};
print('ERROR', errors);
print('WARN ', warnings);

console.log(errors.length ? `\nFAILED: ${errors.length} error(s), ${warnings.length} warning(s)` : `\nOK: no errors${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
process.exit(errors.length ? 1 : 0);
