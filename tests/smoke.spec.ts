import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';

// Smoke tests for the production build (served by `astro preview`, see playwright.config.ts).
// They follow the build they find: the parts shop tests are skipped when dist/ was built with
// site.store.enabled = false, and the shared tests expect the matching wording.
//
// Safety rules, enforced by the `page` fixture below:
//   - Web3Forms is never contacted: https://api.web3forms.com/** is answered locally with
//     {success:true} and the payload is kept for the test to inspect.
//   - Any other request that leaves the local server is blocked and fails the test.
//   - A console error, an uncaught exception or a blocked request fails the test.
//   - Pages are served with the Content-Security-Policy from public/_headers (astro preview
//     ignores _headers), so a script or style the real site would refuse shows up as a console error.

const shopOn = existsSync('dist/shop/index.html');
const PART = '10097A2083';
// A made-up word: customers may type any maker's name (or "OEM") in front of a number, and the search
// must not depend on a list of brands. No real maker's name appears in the tests or the code.
const NOISE = 'acmeco';
const LOCAL_ORIGIN = `http://127.0.0.1:${Number(process.env.PW_PORT) || 4321}`; // same default as playwright.config.ts

const csp = readFileSync(fileURLToPath(new URL('../public/_headers', import.meta.url)), 'utf8')
  .split('\n')
  .find((line) => /^\s*Content-Security-Policy:/i.test(line))
  ?.replace(/^\s*Content-Security-Policy:\s*/i, '')
  .trim();

interface Submission {
  fields: Record<string, string>;
}

// multipart/form-data body (what FormData sends) -> field name -> value
function parseMultipart(body: string, contentType: string): Record<string, string> {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
  if (!boundary) throw new Error(`Not a multipart request: ${contentType}`);
  const fields: Record<string, string> = {};
  for (const part of body.split(`--${boundary}`)) {
    const split = part.indexOf('\r\n\r\n');
    const name = /name="([^"]+)"/.exec(part.slice(0, split))?.[1];
    if (split < 0 || !name) continue;
    fields[name] = part.slice(split + 4).replace(/\r\n$/, '');
  }
  return fields;
}

const test = base.extend<{ problems: string[]; web3forms: Submission[] }>({
  problems: async ({}, use) => {
    await use([]);
  },
  web3forms: async ({}, use) => {
    await use([]);
  },
  page: async ({ page, problems, web3forms }, use, testInfo) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console.error on ${page.url()}: ${msg.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`uncaught exception on ${page.url()}: ${error.message}`));

    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.hostname === 'api.web3forms.com') {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
        if (request.method() === 'POST') {
          web3forms.push({ fields: parseMultipart(request.postData() ?? '', request.headers()['content-type'] ?? '') });
          return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, message: 'Email sent successfully!' }) });
        }
        return route.fulfill({ status: 204, headers: cors });
      }

      if (url.origin !== LOCAL_ORIGIN) {
        problems.push(`blocked request to ${request.url()}`);
        return route.abort();
      }

      if (request.resourceType() === 'document' && csp) {
        const response = await route.fetch();
        const headers: Record<string, string> = { ...response.headers(), 'content-security-policy': csp };
        delete headers['content-encoding'];
        delete headers['content-length'];
        return route.fulfill({ response, headers });
      }
      return route.fallback();
    });

    await use(page);

    if (testInfo.status === 'passed') expect(problems, 'console errors, uncaught exceptions or blocked requests').toEqual([]);
  },
});

const quoteBadge = (page: Page) => page.locator('.cart-btn [data-quote-count]');
const quoteRows = (page: Page) => page.locator('[data-quote-items] .qi');

async function findPart(request: APIRequestContext) {
  const response = await request.get('/shop/search-index.json');
  expect(response.ok(), 'the search index loads').toBe(true);
  const records: { o: string; c: string; u: string }[] = await response.json();
  const record = records.find((r) => r.o === PART);
  expect(record, `${PART} is in the catalog`).toBeTruthy();
  return record!;
}

test('home renders with the main navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/C&M Machine Shop/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Main', exact: true });
  for (const name of ['Home', 'About', 'Services', 'Our Machinery', 'Contact']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  const shop = nav.getByRole('link', { name: 'Shop', exact: true });
  if (shopOn) await expect(shop).toHaveAttribute('href', '/shop/');
  else await expect(shop).toHaveCount(0);
  await expect(page.locator('.cart-btn')).toHaveAttribute('href', '/quote/');
});

test.describe('parts shop', () => {
  test.skip(!shopOn, 'the parts shop is off in this build');

  test('shop search finds 10097A2083', async ({ page }) => {
    await page.goto('/shop/');
    await page.locator('.psearch--hero').getByRole('searchbox').fill(PART);

    const first = page.locator('.psearch--hero .ps-hit').first();
    await expect(first).toContainText(PART);
    await first.getByRole('link').click();

    await expect(page).toHaveURL(new RegExp(`/shop/vffs/.+/${PART.toLowerCase()}-`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PART);
  });

  test('shop search finds the part when "OEM" or any other word is typed in front of the number', async ({ page }) => {
    await page.goto('/shop/');
    const field = page.locator('.psearch--hero').getByRole('searchbox');
    const first = page.locator('.psearch--hero .ps-hit').first();
    const queries = [`OEM ${PART}`, `OEM# ${PART}`, 'oem 10097-A2083', `oem. ${PART}`, '10097 A2083', `${NOISE} ${PART}`, `${NOISE}-${PART}`, `${NOISE}: 10097 A2083`, `${PART} ${NOISE}`];
    for (const query of queries) {
      await field.fill(query);
      await expect(first, query).toContainText(PART);
      await expect(page.locator('.psearch--hero .ps-hit'), query).toHaveCount(1);
    }
    // Words that match nothing are ignored when the other words match: "<word> gear" lists the gears.
    await field.fill(`${NOISE} gear`);
    await expect(first).toContainText('Gear');
    // A number that is not in the catalog stays a miss, whatever the word in front of it
    await field.fill(`${NOISE} 10097A9999`);
    await expect(page.locator('.psearch--hero .ps-empty')).toContainText('No match');
  });

  test('shop search reads a C&M number with a word in front of it or after it as that C&M number', async ({ page }) => {
    // CM-0111 is the gear spur with OEM 10097A2083. The digits "0111" must never be tried as a
    // part-number run, where they would match another part by prefix (a wrong, confident hit).
    await page.goto('/shop/');
    const field = page.locator('.psearch--hero').getByRole('searchbox');
    const hits = page.locator('.psearch--hero .ps-hit');
    for (const query of ['CM-0111', `${NOISE} CM-0111`, `OEM CM-0111`, `CM-0111 ${NOISE}`, `${NOISE} cm 111`, `${NOISE} cm0111`]) {
      await field.fill(query);
      await expect(hits, query).toHaveCount(1);
      await expect(hits.first(), query).toContainText(PART);
    }
    // A C&M number that does not exist finds nothing, with or without a word in front
    for (const query of ['CM-0999', `${NOISE} CM-0999`]) {
      await field.fill(query);
      await expect(page.locator('.psearch--hero .ps-empty'), query).toContainText('No match');
    }
  });

  test('pressing Enter on "<word> <number>" goes straight to the part', async ({ page, request }) => {
    const part = await findPart(request);
    await page.goto('/shop/');
    const field = page.locator('.psearch--hero').getByRole('searchbox');
    await field.fill(`OEM# ${PART}`);
    await expect(page.locator('.psearch--hero .ps-hit').first()).toContainText(PART);
    await field.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${part.u}$`));
  });

  test('the parts list filters by "<word> <number>" from the home page search and from a ?q= link', async ({ page }) => {
    await page.goto('/');
    await page.locator('#hero-q').fill(`${NOISE} ${PART}`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/shop\/\?q=/);
    const visibleRows = page.locator('[data-rows] > li.prow:not([hidden])');
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows.first()).toContainText(PART);

    await page.goto(`/shop/?q=${encodeURIComponent(`OEM# ${PART}`)}`);
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows.first()).toContainText(PART);
  });

  test('labels and URLs say OEM and VFFS packaging machines', async ({ page, request }) => {
    const part = await findPart(request);
    expect(part.u).toMatch(/^\/shop\/vffs\//);

    await page.goto('/shop/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('VFFS packaging');
    await expect(page.locator('.plist__head')).toContainText('OEM #');
    await expect(page.locator('.plist__head')).toContainText('C&M #');
    await expect(page.locator('.store-disclaimer')).toContainText('not affiliated with or endorsed by any machine manufacturer');

    await page.goto('/shop/vffs/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('VFFS Packaging Machines');

    await page.goto(part.u);
    await expect(page.locator('.ident__label')).toHaveText('OEM #');
    await expect(page.locator('.specs')).toContainText('OEM #');
    await expect(page.locator('.specs')).toContainText('VFFS Packaging Machines');
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const product = ld.map((t) => JSON.parse(t)).flatMap((d) => (Array.isArray(d['@graph']) ? d['@graph'] : [d])).find((d) => d['@type'] === 'Product');
    expect(product.additionalProperty).toEqual([{ '@type': 'PropertyValue', name: 'OEM part number', value: PART }]);
    expect(product.isAccessoryOrSparePartFor).toEqual({ '@type': 'Product', name: 'VFFS packaging machine' });
    expect(product).not.toHaveProperty('brand');
  });

  test('an open search panel hides the page under it, and Tab or Escape bring it back', async ({ page }) => {
    await page.goto('/shop/');
    const field = page.locator('.psearch--hero').getByRole('searchbox');
    const panel = page.locator('.psearch--hero [data-ps-panel]');
    const tiles = page.locator('.shop__tiles');
    await expect(tiles).toBeVisible();

    // A sliver of a tile left showing under the panel's edge is a target too small to hit: the regions
    // under the panel are hidden while it is open.
    await field.fill(PART);
    await expect(panel).toBeVisible();
    await expect(tiles).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(tiles).toBeVisible();

    // Tabbing out of the last control closes the panel and lands on the page behind it, not past it.
    await field.fill(PART);
    await expect(tiles).toBeHidden();
    for (let i = 0; i < 12 && (await panel.isVisible()); i++) await page.keyboard.press('Tab');
    await expect(panel).toBeHidden();
    await expect(tiles).toBeVisible();
    await expect(page.locator('.shop__paste:focus, .shop__tiles :focus')).toHaveCount(1);
  });

  test('a part page adds the part to the quote list', async ({ page, request }) => {
    const part = await findPart(request);
    await page.goto(part.u);

    const badge = quoteBadge(page);
    await expect(badge).toBeHidden();
    await page.getByRole('button', { name: `Add to Quote: ${PART}` }).click();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1');

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('quote-list-v2') ?? 'null'));
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0]).toMatchObject({ kind: 'part', oem: PART, cm: part.c, qty: 1 });

    // The list survives the page change
    await page.goto('/quote/');
    await expect(quoteRows(page)).toHaveCount(1);
    await expect(quoteRows(page).first()).toContainText(PART);
    await expect(quoteRows(page).first()).toContainText(`OEM # ${PART}`);
    await expect(badge).toHaveText('1');
  });
});

test.describe('quote list saved before the machine was renamed', () => {
  test.skip(!shopOn, 'the parts shop is off in this build');

  test('is repaired when read, and the quote email carries the current links and labelled numbers', async ({ page, request, web3forms }) => {
    const part = await findPart(request);
    const currentId = part.u.split('/').filter(Boolean).pop()!;
    // Made-up older machine folder and part id: the repair must not depend on knowing any real old name.
    const oldUrl = part.u.replace('/shop/vffs/', '/shop/old-machine/');
    const line = (id: string, qty: number, url: string) => ({ key: id, kind: 'part', id, title: 'Gear Spur', oem: PART, cm: part.c, section: 'Registration Parts', url, options: {}, qty });
    await page.goto('/');
    await page.evaluate(
      ([items]) => localStorage.setItem('quote-list-v2', JSON.stringify({ ref: 'Q-260101-TEST', items })),
      [[line('an-older-id-of-the-same-part', 1, oldUrl), line(currentId, 2, oldUrl)]] as const,
    );

    await page.goto('/quote/');
    await expect(quoteRows(page), 'the same part under two ids is one line').toHaveCount(1);
    await expect(quoteRows(page).first().locator('.qi__qty')).toHaveValue('3');
    await expect(quoteRows(page).first().locator('a.qi__name')).toHaveAttribute('href', part.u);

    const form = page.locator('form[data-kind="quote"]');
    await form.getByLabel(/Full Name/).fill('Test Customer');
    await form.getByLabel(/Email Address/).fill('test.customer@example.com');
    await form.getByLabel(/Phone Number/).fill('(831) 555-0100');
    await form.getByRole('button', { name: /Send Quote Request/ }).click();
    await expect(page).toHaveURL(/\/quote\/thanks\/$/);

    expect(web3forms).toHaveLength(1);
    const products = web3forms[0].fields.products;
    expect(products).toContain(`${LOCAL_ORIGIN}${part.u}`);
    expect(products).not.toContain('old-machine');
    expect(products).toContain(`OEM # ${PART} | C&M # ${part.c} | Gear Spur | qty 3`);
  });
});

test('/quote/?part=10097A2083&qty=2 adds the line', async ({ page }) => {
  await page.goto(`/quote/?part=${PART}&qty=2`);

  await expect(quoteRows(page)).toHaveCount(1);
  await expect(quoteRows(page).first()).toContainText(PART);
  await expect(quoteRows(page).first().locator('.qi__qty')).toHaveValue('2');
  await expect(quoteBadge(page)).toHaveText('1');
  // The parameters are dropped, so a reload does not add the part again
  await expect(page).toHaveURL(/\/quote\/$/);
  await page.reload();
  await expect(quoteRows(page).first().locator('.qi__qty')).toHaveValue('2');
});

test.describe('bulk paste', () => {
  test.skip(!shopOn, 'the parts shop is off in this build');

  test('matches numbers typed with "OEM" or any other word in front, and adds them to the quote', async ({ page }) => {
    await page.goto('/quote/#bulk');
    const bulk = page.locator('#bulk');
    await expect(bulk).toHaveJSProperty('open', true);
    await bulk.locator('[data-bulk-text]').fill([`${NOISE} ${PART} x2`, `OEM# ${PART} 3`, `2 x ${NOISE}: 10097 A2083`, `${NOISE} 10097A9999`].join('\n'));
    await bulk.getByRole('button', { name: 'Check list' }).click();

    await expect(bulk.locator('[data-bulk-summary]')).toContainText('1 matched · 1 not found · 2 duplicate lines merged');
    await expect(bulk.locator('.bk__row--ok')).toHaveCount(1);
    await expect(bulk.locator('.bk__row--ok .bk__qty')).toHaveValue('7');
    await expect(bulk.locator('.bk__row--miss')).toHaveCount(1);
    await expect(bulk.locator('.bk__row--miss')).toContainText('10097A9999');

    await bulk.getByRole('button', { name: /Add \d+ lines? to quote/ }).click();
    await expect(quoteRows(page)).toHaveCount(2);
    await expect(quoteRows(page).first()).toContainText(`OEM # ${PART}`);
    await expect(quoteRows(page).first().locator('.qi__qty')).toHaveValue('7');
  });
});

test('the quote form posts to Web3Forms and lands on the thank-you page', async ({ page, web3forms }) => {
  await page.goto(`/quote/?part=${PART}&qty=2`);
  await expect(quoteRows(page)).toHaveCount(1);

  const form = page.locator('form[data-kind="quote"]');
  await form.getByLabel(/Full Name/).fill('Test Customer');
  await form.getByLabel(/Email Address/).fill('test.customer@example.com');
  await form.getByLabel(/Phone Number/).fill('(831) 555-0100');
  await form.getByLabel(/Additional Notes/).fill('Smoke test, please ignore.');
  await form.getByRole('button', { name: /Send Quote Request/ }).click();

  await expect(page).toHaveURL(/\/quote\/thanks\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Thanks');

  expect(web3forms).toHaveLength(1);
  const sent = web3forms[0].fields;
  expect(sent.access_key).toBeTruthy();
  expect(sent.name).toBe('Test Customer');
  expect(sent.email).toBe('test.customer@example.com');
  expect(sent.subject).toMatch(/^Quote request Q-\d{6}-[A-Z0-9]{4}: 1 item \(2 pieces\) from Test Customer/);
  expect(sent.products).toContain(PART);
  expect(sent.products).toContain('qty 2');
  expect(sent.quote_ref).toMatch(/^Q-\d{6}-[A-Z0-9]{4}$/);
  expect(sent).not.toHaveProperty('botcheck');

  // The list is emptied after a send, and the thank-you page shows the reference
  await expect(quoteBadge(page)).toBeHidden();
  await expect(page.locator('[data-ref-box]')).toContainText(sent.quote_ref);
});

test('the contact form shows a success message', async ({ page, web3forms }) => {
  await page.goto('/contact/');

  const form = page.locator('form[data-kind="contact"]');
  await form.getByLabel(/^Name/).fill('Test Customer');
  await form.getByLabel(/^Email/).fill('test.customer@example.com');
  await form.getByLabel(/^Message/).fill('Smoke test, please ignore.');
  await form.getByRole('button', { name: /Send Message/ }).click();

  const status = form.locator('[data-form-status]');
  await expect(status).toContainText('Thanks, we got your message');
  await expect(status).toHaveClass(/form-alert--success/);

  expect(web3forms).toHaveLength(1);
  expect(web3forms[0].fields).toMatchObject({ name: 'Test Customer', email: 'test.customer@example.com', message: 'Smoke test, please ignore.' });
  expect(web3forms[0].fields.subject).toBe('Website message from Test Customer');
});

test('pages load without console errors', async ({ page, request, problems }) => {
  const urls = ['/', '/services/', '/contact/', '/quote/', '/quote/thanks/'];
  if (shopOn) {
    const part = await findPart(request);
    urls.push('/shop/', part.u.replace(/[^/]+\/$/, ''), part.u);
  }
  for (const url of urls) {
    const response = await page.goto(url);
    expect(response?.status(), url).toBe(200);
    // Scripts that run when the browser is idle (the shop's search index) have finished once the network is quiet.
    await page.waitForLoadState('networkidle');
    expect(problems, url).toEqual([]);
  }
});
