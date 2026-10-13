#!/usr/bin/env node
// Tells IndexNow which URLs the site has, so Bing and the other engines that support it (Yandex, Naver,
// Seznam, Yep) pick up new and changed pages in hours instead of waiting for a crawl. Google does not use
// IndexNow. See README "IndexNow".
//
//   npm run indexnow                               reads dist/sitemap-*.xml (run `npm run build` first)
//   npm run indexnow -- https://cmmachshop.com     reads that site's live sitemap-index.xml instead
//   node scripts/indexnow.mjs --dry-run            prints what would be sent and sends nothing (no network at all)
//
// It POSTs { host, key, keyLocation, urlList } to https://api.indexnow.org/indexnow (INDEXNOW_ENDPOINT
// overrides the address, for a local test server) and prints the HTTP status. IndexNow only accepts the
// list after it has fetched https://<host>/<key>.txt, so the script reads that file first.
//
// Exit codes: 0 when the list was sent, and also when nothing could be sent for a reason outside this repo
// (no network, the site is not live yet, IndexNow is busy or down): the message says why, and a deploy never
// fails because of it. 1 only for a mistake here: a bad argument, no key in src/config/site.ts, a key file
// in public/ that does not match it, or IndexNow rejecting the request itself (400, 403, 422 after the key
// file was found). It never runs inside the tests: nothing in package.json's test scripts calls it, and it
// refuses to run in a Playwright worker or when NODE_ENV=test.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow';
const MAX_URLS = 10000; // IndexNow takes at most 10,000 URLs per request
const TIMEOUT_MS = 10000;
const root = fileURLToPath(new URL('..', import.meta.url));

const say = (message) => console.log(`indexnow: ${message}`);
const fail = (message) => {
  console.error(`indexnow: ${message}`);
  process.exitCode = 1;
};

// ---------- Helpers ----------

// What went wrong with a fetch, in a few words (Node puts the system error in err.cause).
function why(err) {
  const code = err?.cause?.code ?? err?.code;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `no answer within ${TIMEOUT_MS / 1000} seconds`;
  return code ? `${code}` : String(err?.cause?.message ?? err?.message ?? err);
}

const get = (url) => fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'cnm-indexnow/1.0' } });

const decodeXml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[n]);
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decodeXml(m[1]));

// The URLs of the site's own sitemap files in dist/ (sitemap-0.xml and friends; the index only names them).
function readDist() {
  const dist = join(root, 'dist');
  if (!existsSync(dist)) return null;
  const urls = [];
  const used = [];
  for (const f of readdirSync(dist).filter((name) => /^sitemap-.*\.xml$/.test(name))) {
    const xml = readFileSync(join(dist, f), 'utf8');
    if (/<sitemapindex\b/.test(xml)) continue;
    urls.push(...locs(xml));
    used.push(f);
  }
  return used.length ? { urls, from: `dist/ (${used.join(', ')})` } : null;
}

// The same from a live site: sitemap-index.xml, then each sitemap it names (fetched from that site's own
// address, whatever host the entries are written with).
async function readLive(origin) {
  const index = await get(new URL('/sitemap-index.xml', origin));
  if (!index.ok) throw new Error(`${origin}/sitemap-index.xml answered HTTP ${index.status}`);
  const xml = await index.text();
  if (!/<sitemapindex\b/.test(xml)) return { urls: locs(xml), from: `${origin}/sitemap-index.xml` };
  const urls = [];
  for (const loc of locs(xml)) {
    const res = await get(new URL(new URL(loc).pathname, origin));
    if (!res.ok) throw new Error(`${loc} answered HTTP ${res.status}`);
    urls.push(...locs(await res.text()));
  }
  return { urls, from: `${origin}/sitemap-index.xml` };
}

const MEANING = {
  200: 'the URLs were submitted',
  202: 'the URLs were received; IndexNow will check the key file shortly',
  400: 'bad request: the payload is not valid',
  403: 'the key is not valid: IndexNow could not find the key file or its content differs',
  422: 'the URLs do not belong to the host, or the key does not match the schema',
  429: 'too many requests: IndexNow asks to try again later',
};

// ---------- The run ----------

async function main(baseArg) {
  // The key and the site address come from src/config/site.ts (read as text: it is TypeScript).
  const config = readFileSync(join(root, 'src/config/site.ts'), 'utf8');
  const key = /^\s*indexNowKey:\s*'([0-9a-f]{32})'/m.exec(config)?.[1];
  const siteUrl = /^ {2}url:\s*'(https?:\/\/[^']+)'/m.exec(config)?.[1];
  if (!key) return fail("no indexNowKey (32 hex characters) in src/config/site.ts. Generate one with: node -e \"console.log(require('crypto').randomBytes(16).toString('hex'))\"");
  if (!siteUrl) return fail('no site url in src/config/site.ts');
  const keyFile = join(root, 'public', `${key}.txt`);
  if (!existsSync(keyFile) || readFileSync(keyFile, 'utf8').trim() !== key) {
    return fail(`public/${key}.txt must exist and contain the key ${key}`);
  }

  let base;
  try {
    base = new URL(baseArg ?? siteUrl);
  } catch {
    return fail(`"${baseArg}" is not a URL. Example: npm run indexnow -- https://cmmachshop.com`);
  }
  const host = base.hostname;
  const keyLocation = `${base.origin}/${key}.txt`;

  // 1. The URLs: dist/ unless a site address was given (or dist/ has no sitemap), else that site's live sitemap.
  let found = baseArg ? null : readDist();
  if (!found) {
    if (dryRun) return fail(`no sitemap in dist/. Run "npm run build" first, or pass the live site: npm run indexnow -- ${base.origin} --dry-run`);
    try {
      found = await readLive(base.origin);
    } catch (err) {
      return say(`nothing sent: could not read a sitemap (${baseArg ? '' : 'no dist/ sitemap; '}${base.origin}: ${why(err)}). No network, or the site is not live yet. Run "npm run build" first to read dist/, or try again later.`);
    }
  }
  const all = [...new Set(found.urls)];
  const urlList = all.filter((u) => {
    try {
      return new URL(u).hostname === host;
    } catch {
      return false;
    }
  });
  if (urlList.length < all.length) say(`${all.length - urlList.length} of ${all.length} sitemap URLs are not on ${host} and were left out (IndexNow only accepts URLs on the host that serves the key file).`);
  if (!urlList.length) return fail(`${found.from} lists no URLs on ${host}`);
  say(`${urlList.length} URLs for ${host} from ${found.from}`);

  const batches = [];
  for (let i = 0; i < urlList.length; i += MAX_URLS) batches.push(urlList.slice(i, i + MAX_URLS));

  if (dryRun) {
    say(`dry run, nothing sent. Would POST ${batches.length} request(s) to ${ENDPOINT}:`);
    console.log(JSON.stringify({ host, key, keyLocation, urlList: urlList.slice(0, 3).concat(urlList.length > 3 ? [`… ${urlList.length - 3} more`] : []) }, null, 2));
    return;
  }

  // 2. IndexNow fetches the key file before it accepts anything, so look at it first: offline or not live yet
  //    means there is nothing to do, and that is not an error.
  try {
    const res = await get(keyLocation);
    const body = res.ok ? (await res.text()).trim() : '';
    if (body !== key) {
      return say(`nothing sent: ${keyLocation} ${res.ok ? 'does not contain the key' : `answers HTTP ${res.status}`}. The site is not live yet, or this deploy does not carry the key file. IndexNow checks that file before it accepts URLs. Deploy, then run "npm run indexnow" again.`);
    }
  } catch (err) {
    return say(`nothing sent: could not reach ${base.origin} (${why(err)}). No network, or the site is not live yet. Run "npm run indexnow" again once it is.`);
  }

  // 3. Send.
  for (const [n, batch] of batches.entries()) {
    const label = batches.length > 1 ? ` (request ${n + 1} of ${batches.length}, ${batch.length} URLs)` : '';
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation, urlList: batch }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      return say(`nothing sent: could not reach ${new URL(ENDPOINT).host} (${why(err)}). Try again later.`);
    }
    const meaning = MEANING[res.status] ?? (res.status >= 500 ? 'IndexNow is having trouble' : 'unexpected answer');
    say(`HTTP ${res.status} ${res.statusText}${label}: ${meaning}.`);
    if (res.status >= 400 && res.status !== 429 && res.status < 500) return fail('IndexNow did not accept the submission (see the status above).');
    if (res.status >= 400) return; // 429 or a 5xx: temporary, try again later
  }
}

// ---------- Arguments and guards ----------

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bad = args.filter((a) => a.startsWith('-') && a !== '--dry-run');
const positional = args.filter((a) => !a.startsWith('-'));

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run indexnow [-- <site URL>] [-- --dry-run]\nSee the comment at the top of scripts/indexnow.mjs and README "IndexNow".');
} else if (bad.length || positional.length > 1) {
  fail(`unknown argument ${[...bad, ...positional.slice(1)].join(' ')}. Usage: npm run indexnow [-- <site URL>] [-- --dry-run]`);
} else if (process.env.TEST_WORKER_INDEX !== undefined || process.env.NODE_ENV === 'test') {
  say('skipped: this is a test run, and the tests never contact IndexNow.');
} else {
  await main(positional[0]);
}
