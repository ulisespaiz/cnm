import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type APIRequestContext, type Locator, type Page } from '@playwright/test';

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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('VFFS packaging machines');

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

// ---------- Reaching the customer: a name plus an email or a phone number ----------
// The quote, contact and part request forms need a name and at least one of email or phone. Neither
// field is required on its own (so the forms still post without JavaScript); with both empty one inline
// error is tied to both fields (src/scripts/web3forms-submit.ts, the <fieldset data-reach>).
const REACH_ERROR = 'Enter an email or a phone number so we can reply.';
const CUSTOMER_EMAIL = 'test.customer@example.com';
const CUSTOMER_PHONE = '(831) 555-0100';

interface ReachForm {
  title: string;
  /** Opens the page and returns the form. */
  open: (page: Page) => Promise<Locator>;
  /** Fills everything except email and phone. */
  fill: (form: Locator) => Promise<void>;
  send: (form: Locator) => Promise<void>;
  /** Waits for the form's success state. */
  expectSent: (page: Page, form: Locator) => Promise<void>;
  email: RegExp;
  phone: RegExp;
}

const reachForms: ReachForm[] = [
  {
    title: 'quote form',
    open: async (page) => {
      await page.goto('/quote/');
      return page.locator('form[data-kind="quote"]');
    },
    fill: async (form) => {
      await form.getByLabel(/Full Name/).fill('Test Customer');
      await form.getByLabel(/Additional Notes/).fill('Smoke test, please ignore.');
    },
    send: (form) => form.getByRole('button', { name: /Send Quote Request/ }).click(),
    expectSent: async (page) => {
      await expect(page).toHaveURL(/\/quote\/thanks\/$/);
    },
    email: /Email Address/,
    phone: /Phone Number/,
  },
  {
    title: 'contact form',
    open: async (page) => {
      await page.goto('/contact/');
      return page.locator('form[data-kind="contact"]');
    },
    fill: async (form) => {
      await form.getByLabel(/^Name/).fill('Test Customer');
      await form.getByLabel(/^Message/).fill('Smoke test, please ignore.');
    },
    send: (form) => form.getByRole('button', { name: /Send Message/ }).click(),
    expectSent: async (_page, form) => {
      await expect(form.locator('[data-form-status]')).toContainText('Thanks, we got your message');
    },
    email: /^Email/,
    phone: /^Phone/,
  },
  {
    title: 'part request form',
    open: async (page) => {
      await page.goto('/quote/');
      await page.locator('#cant-find > summary').click();
      return page.locator('form[data-part-request]');
    },
    fill: async (form) => {
      await form.getByLabel(/^Name/).fill('Test Customer');
      await form.locator('#pr-number').fill('10097A9999');
    },
    send: (form) => form.getByRole('button', { name: /Send part request/ }).click(),
    expectSent: async (page) => {
      await expect(page.locator('[data-pr-success]')).toBeVisible();
    },
    email: /^Email/,
    phone: /^Phone/,
  },
];

for (const f of reachForms) {
  test.describe(`${f.title}: name plus an email or a phone number`, () => {
    test('phone only sends, without an email field', async ({ page, web3forms }) => {
      const form = await f.open(page);
      await f.fill(form);
      await form.getByLabel(f.phone).fill(CUSTOMER_PHONE);
      await f.send(form);
      await f.expectSent(page, form);

      expect(web3forms).toHaveLength(1);
      const sent = web3forms[0].fields;
      expect(sent.name).toBe('Test Customer');
      expect(sent.phone).toBe(CUSTOMER_PHONE);
      expect(sent, 'an empty email is not sent: Web3Forms uses it as the reply-to address').not.toHaveProperty('email');
    });

    test('email only sends, with the email as reply-to', async ({ page, web3forms }) => {
      const form = await f.open(page);
      await f.fill(form);
      await form.getByLabel(f.email).fill(CUSTOMER_EMAIL);
      await f.send(form);
      await f.expectSent(page, form);

      expect(web3forms).toHaveLength(1);
      const sent = web3forms[0].fields;
      expect(sent.name).toBe('Test Customer');
      expect(sent.email).toBe(CUSTOMER_EMAIL);
      expect(sent.phone ?? '').toBe('');
    });

    test('both given sends both', async ({ page, web3forms }) => {
      const form = await f.open(page);
      await f.fill(form);
      await form.getByLabel(f.email).fill(CUSTOMER_EMAIL);
      await form.getByLabel(f.phone).fill(CUSTOMER_PHONE);
      await f.send(form);
      await f.expectSent(page, form);

      expect(web3forms).toHaveLength(1);
      expect(web3forms[0].fields).toMatchObject({ email: CUSTOMER_EMAIL, phone: CUSTOMER_PHONE });
    });

    test('neither shows one error tied to both fields and sends nothing', async ({ page, web3forms }) => {
      const form = await f.open(page);
      const email = form.getByLabel(f.email);
      const phone = form.getByLabel(f.phone);
      const reach = form.locator('fieldset[data-reach]');
      const url = page.url();
      await f.fill(form);

      // Neither input is required in the HTML, so the form still posts without JavaScript
      await expect(email).not.toHaveAttribute('required', /.*/);
      await expect(phone).not.toHaveAttribute('required', /.*/);

      await f.send(form);

      // One message for the pair, under both fields, named by both fields' aria-describedby
      const error = reach.locator('.field-error');
      await expect(error).toHaveCount(1);
      await expect(error).toHaveText(REACH_ERROR);
      const errorId = await error.getAttribute('id');
      expect(errorId).toBeTruthy();
      for (const field of [email, phone]) {
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(((await field.getAttribute('aria-describedby')) ?? '').split(/\s+/)).toContain(errorId);
      }
      await expect(form.locator('.field-error')).toHaveCount(1);
      // The same as the per-field errors: focus on the first field, and the message in the status line
      await expect(email).toBeFocused();
      await expect(form.locator('[data-form-status]')).toHaveText(REACH_ERROR);
      expect(page.url()).toBe(url);
      expect(web3forms, 'nothing is sent').toHaveLength(0);

      // Filling either field answers the error for both
      await phone.fill(CUSTOMER_PHONE);
      await expect(form.locator('.field-error')).toHaveCount(0);
      await expect(email).not.toHaveAttribute('aria-invalid', /.*/);
      await expect(phone).not.toHaveAttribute('aria-invalid', /.*/);
      expect(((await email.getAttribute('aria-describedby')) ?? '').includes(errorId!)).toBe(false);
      await expect(form.locator('[data-form-status]')).toHaveText('');

      await f.send(form);
      await f.expectSent(page, form);
      expect(web3forms).toHaveLength(1);
      expect(web3forms[0].fields.phone).toBe(CUSTOMER_PHONE);
    });

    test('a badly typed email is still refused, even with a phone number', async ({ page, web3forms }) => {
      const form = await f.open(page);
      const email = form.getByLabel(f.email);
      await f.fill(form);
      await email.fill('not-an-email');
      await form.getByLabel(f.phone).fill(CUSTOMER_PHONE);
      await f.send(form);

      await expect(email).toHaveAttribute('aria-invalid', 'true');
      await expect(email).toBeFocused();
      await expect(form.locator('.field-error')).toHaveCount(1);
      await expect(form.locator('.field-error')).not.toHaveText(REACH_ERROR);
      expect(web3forms).toHaveLength(0);

      await email.fill(CUSTOMER_EMAIL);
      await f.send(form);
      await f.expectSent(page, form);
      expect(web3forms).toHaveLength(1);
      expect(web3forms[0].fields.email).toBe(CUSTOMER_EMAIL);
    });
  });
}

test('an empty contact form lists every problem at once, including the missing email or phone', async ({ page, web3forms }) => {
  await page.goto('/contact/');
  const form = page.locator('form[data-kind="contact"]');
  await form.getByRole('button', { name: /Send Message/ }).click();

  await expect(form.locator('.field-error')).toHaveCount(3);
  await expect(form.locator('fieldset[data-reach] .field-error')).toHaveText(REACH_ERROR);
  await expect(form.locator('[data-form-status]')).toHaveText('Please fix 3 fields: Name, Email or phone, Message.');
  await expect(form.getByLabel(/^Name/)).toBeFocused();
  // Each empty field says what to enter, not the browser's "Please fill out this field."
  await expect(form.locator('#contact-name-err')).toHaveText('Enter your name');
  await expect(form.locator('#contact-message-err')).toHaveText('Enter your message');
  expect(web3forms).toHaveLength(0);
});

test('an empty name on the quote form says "Enter your name" under the field, and is the only message when it is the only problem', async ({ page, web3forms }) => {
  await page.goto('/quote/');
  const form = page.locator('form[data-kind="quote"]');
  const name = form.getByLabel(/Full Name/);

  // Nothing filled in: the name and the missing email or phone are reported together
  await form.getByRole('button', { name: /Send Quote Request/ }).click();
  await expect(form.locator('#quote-name-err')).toHaveText('Enter your name');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(((await name.getAttribute('aria-describedby')) ?? '').split(/\s+/)).toContain('quote-name-err');
  await expect(form.locator('[data-form-status]')).toHaveText('Please fix 2 fields: Full Name, Email or phone.');
  await expect(name).toBeFocused();

  // Only the name is missing: the status line is the same words, not "Full Name: Please fill out this field."
  await form.getByLabel(/Email Address/).fill(CUSTOMER_EMAIL);
  await form.getByLabel(/Additional Notes/).fill('Smoke test, please ignore.');
  await form.getByRole('button', { name: /Send Quote Request/ }).click();
  await expect(form.locator('.field-error')).toHaveCount(1);
  await expect(form.locator('#quote-name-err')).toHaveText('Enter your name');
  await expect(form.locator('[data-form-status]')).toHaveText('Enter your name');
  expect(web3forms, 'nothing is sent').toHaveLength(0);

  // Typing a name answers it
  await name.fill('Test Customer');
  await expect(form.locator('.field-error')).toHaveCount(0);
  await expect(form.locator('[data-form-status]')).toHaveText('');
});

test('pages load without console errors', async ({ page, request, problems }) => {
  const urls = ['/', '/services/', '/contact/', '/contact/thanks/', '/quote/', '/quote/thanks/', '/how-to-order/'];
  if (shopOn) {
    const part = await findPart(request);
    urls.push('/shop/', '/shop/part-numbers/', part.u.replace(/[^/]+\/$/, ''), part.u);
  }
  for (const url of urls) {
    const response = await page.goto(url);
    expect(response?.status(), url).toBe(200);
    // Scripts that run when the browser is idle (the shop's search index) have finished once the network is quiet.
    await page.waitForLoadState('networkidle');
    expect(problems, url).toEqual([]);
  }
});

// ---------- OEM part number index, catalog CSV, how to order ----------

interface CatalogPart {
  id: string;
  machine: string;
  section: string;
  oem?: string;
  cm: string;
  name: string;
  shortName?: string;
  nameRaw?: string;
  oemKey?: string;
  oemVerify?: boolean;
  description?: string;
  flags?: string[];
}
const catalog: CatalogPart[] = JSON.parse(readFileSync('src/content/parts.json', 'utf8'));
const sectionTitle = new Map<string, string>(JSON.parse(readFileSync('src/content/sections.json', 'utf8')).map((x: { id: string; title: string }) => [x.id, x.title]));
const siteConfig = readFileSync('src/config/site.ts', 'utf8');
// A plain string literal from src/config/site.ts (the single source of truth for the business facts).
const configString = (name: string) => new RegExp(`^\\s*${name}:\\s*'([^']*)'`, 'm').exec(siteConfig)?.[1] ?? '';
const SITE_ORIGIN = new URL(/^ {2}url:\s*'([^']+)'/m.exec(siteConfig)![1]).origin;
const partPath = (p: CatalogPart) => `/shop/${p.machine}/${p.section}/${p.id}/`;
const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

// The order of the index and the CSV: OEM number as text, then C&M number; parts with no OEM number last.
const inCatalogOrder = [...catalog].sort((a, b) => {
  const ka = a.oem ? a.oem.replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
  const kb = b.oem ? b.oem.replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
  if (!ka !== !kb) return ka ? -1 : 1;
  return ka < kb ? -1 : ka > kb ? 1 : a.cm < b.cm ? -1 : a.cm > b.cm ? 1 : 0;
});

// RFC 4180 reader (CRLF records, "quoted" fields with "" for a quote), so the test does not trust the code that wrote the file.
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i++;
    } else field += c;
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}

// Parts that carry the same OEM number as another part, computed from the catalog (never listed by hand).
const sharedGroups = (() => {
  const byKey = new Map<string, CatalogPart[]>();
  for (const p of catalog) if (p.oemKey) byKey.set(p.oemKey, [...(byKey.get(p.oemKey) ?? []), p]);
  return [...byKey.values()].filter((list) => list.length > 1);
})();
const sharedCms = new Set(sharedGroups.flat().map((p) => p.cm));
// A part whose description says its OEM number is being confirmed.
const confirmingParts = catalog.filter((p) => p.oem && p.oemVerify && /confirm/i.test(p.description ?? ''));

// Text of an HTML attribute or element as the browser reads it (the few entities Astro writes).
const unescapeHtml = (text: string) =>
  text.replace(/&(?:amp|quot|lt|gt|#39|#34|#x27);|&#(\d+);/g, (m, dec) => (dec ? String.fromCodePoint(Number(dec)) : ({ '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&#34;': '"', '&#x27;': "'" } as Record<string, string>)[m]));

async function jsonLd(page: Page) {
  const blocks = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t));
  return blocks.flatMap((d) => (Array.isArray(d['@graph']) ? d['@graph'] : [d]));
}

test.describe('OEM part number index', () => {
  test.skip(!shopOn, 'the parts shop is off in this build');

  test('lists every part in one labelled table, in OEM-number order, each row linking to its part page', async ({ page, request }) => {
    await page.goto('/shop/part-numbers/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('OEM part number index');

    const table = page.getByRole('table', { name: /146 parts, sorted by OEM #/ });
    await expect(table).toHaveCount(1);
    await expect(table.getByRole('columnheader')).toHaveText(['OEM #', 'C&M #', 'Part name', 'Section']);
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(146);
    expect(catalog).toHaveLength(146);

    const listed = await rows.evaluateAll((trs) =>
      trs.map((tr) => ({
        oem: tr.querySelector('.oem, .oem-none .visually-hidden')?.textContent?.trim() ?? '',
        cm: /CM-\d{4}/.exec(tr.querySelector('.pn__cm')?.textContent ?? '')?.[0] ?? '',
        name: tr.querySelector('.pn__name a')?.firstChild?.textContent?.trim() ?? '',
        href: tr.querySelector('.pn__name a')?.getAttribute('href') ?? '',
        section: tr.querySelector('.pn__sec')?.textContent?.trim() ?? '',
      })),
    );
    expect(listed).toEqual(
      inCatalogOrder.map((p) => ({ oem: p.oem ?? 'No OEM #', cm: p.cm, name: p.name, href: partPath(p), section: sectionTitle.get(p.section) })),
    );
    // The parts with an OEM number come first, the ones without are last
    const noOem = inCatalogOrder.filter((p) => !p.oem).length;
    expect(noOem).toBeGreaterThan(0);
    expect(listed.slice(-noOem).every((r) => r.oem === 'No OEM #')).toBe(true);
    expect(listed.slice(0, -noOem).every((r) => r.oem !== 'No OEM #')).toBe(true);

    // Every link answers
    const statuses = await Promise.all(listed.map(async (r) => [r.href, (await request.get(r.href)).status()] as const));
    expect(statuses.filter(([, status]) => status !== 200)).toEqual([]);

    // A row opens its part page
    await rows.filter({ hasText: PART }).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/shop/vffs/.+/${PART.toLowerCase()}-`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PART);
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('the whole table is in the HTML', async ({ page }) => {
      await page.goto('/shop/part-numbers/');
      await expect(page.locator('table tbody tr')).toHaveCount(146);
      await expect(page.getByRole('link', { name: 'Download the catalog (CSV)' })).toHaveAttribute('href', '/shop/catalog.csv');
    });
  });

  test('stacks each row on a phone and stays a table on a desktop, with no sideways scrolling', async ({ page }) => {
    const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/shop/part-numbers/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'phone: no horizontal scroll').toBeLessThanOrEqual(0);
    const oem = await box('tbody tr .pn__oem');
    const name = await box('tbody tr .pn__name');
    expect(name.y, 'phone: the part name sits under the numbers').toBeGreaterThanOrEqual(oem.y + oem.height - 1);
    expect(name.height, 'phone: a 44px tap target').toBeGreaterThanOrEqual(44);
    // the column headers are still there for screen readers
    await expect(page.getByRole('columnheader', { name: 'OEM #' })).toHaveCount(1);

    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'desktop: no horizontal scroll').toBeLessThanOrEqual(0);
    const dOem = await box('tbody tr .pn__oem');
    const dName = await box('tbody tr .pn__name');
    expect(Math.abs(dName.y - dOem.y), 'desktop: one line per row').toBeLessThan(dOem.height);
    expect(dName.x).toBeGreaterThan(dOem.x + dOem.width);
  });

  test('has a short title, its own description, a canonical URL and a breadcrumb', async ({ page, request }) => {
    await page.goto('/shop/part-numbers/');
    expect((await page.title()).length).toBeLessThanOrEqual(65);
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description!.length).toBeLessThanOrEqual(160);
    await page.goto('/shop/');
    expect(await page.locator('meta[name="description"]').getAttribute('content'), 'unique description').not.toBe(description);

    await page.goto('/shop/part-numbers/');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_ORIGIN}/shop/part-numbers/`);
    const crumbs = (await jsonLd(page)).find((d) => d['@type'] === 'BreadcrumbList');
    expect(crumbs.itemListElement.map((i: { name: string; item: string }) => [i.name, i.item])).toEqual([
      ['Home', `${SITE_ORIGIN}/`],
      ['Parts Store', `${SITE_ORIGIN}/shop/`],
      ['OEM Part Number Index', `${SITE_ORIGIN}/shop/part-numbers/`],
    ]);
    // the visible breadcrumb names the same pages (desktop)
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('listitem')).toHaveText(['Home', 'Parts Store', 'OEM Part Number Index']);

    const sitemap = await (await request.get('/sitemap-0.xml')).text();
    expect(sitemap).toContain(`<loc>${SITE_ORIGIN}/shop/part-numbers/</loc>`);
  });

  test('points to bulk paste, the part request form and the CSV, and is linked from the shop', async ({ page }) => {
    await page.goto('/shop/part-numbers/');
    await expect(page.locator('main').getByRole('link', { name: 'Paste a list of part numbers' })).toHaveAttribute('href', '/quote/#bulk');
    await expect(page.getByRole('link', { name: 'Send us the part number' }).first()).toHaveAttribute('href', '#request');
    await expect(page.locator('#request form[data-part-request]')).toHaveCount(1);
    await expect(page.locator('.store-disclaimer')).toContainText('not affiliated with or endorsed by any machine manufacturer');
    await expect(page.getByRole('link', { name: 'Download the catalog (CSV)' })).toHaveAttribute('href', '/shop/catalog.csv');

    for (const url of ['/shop/', '/shop/vffs/']) {
      await page.goto(url);
      await expect(page.locator('main').getByRole('link', { name: /OEM part number index/ }).first(), url).toHaveAttribute('href', '/shop/part-numbers/');
    }
    await page.goto('/');
    await expect(page.locator('footer').getByRole('navigation', { name: 'Shop' }).getByRole('link', { name: 'OEM part number index' })).toHaveAttribute('href', '/shop/part-numbers/');
  });

  test('shows a filter field that narrows the rows as you type, reading numbers the way the shop search does', async ({ page }) => {
    await page.goto('/shop/part-numbers/');
    const filter = page.getByLabel('Filter by OEM #, C&M # or name');
    await expect(filter).toBeVisible();
    const visible = page.locator('table tbody tr:visible');
    const status = page.locator('[data-pn-status]');
    await expect(visible).toHaveCount(146);

    // A number that two parts share finds both, however it is typed
    const [pair] = sharedGroups;
    expect(pair?.length).toBe(2);
    const pairCms = pair.map((p) => p.cm).sort();
    for (const typed of [pair[0].oem!, `OEM # ${pair[0].oem}`, `acmeco ${pair[0].oem!.replace(/^(\d{5})/, '$1-')}`, pair[0].oem!.replace(/^0/, ''), pair[0].oem!.replace(/^0/, 'O').toLowerCase()]) {
      await filter.fill(typed);
      await expect(visible, typed).toHaveCount(2);
      expect((await visible.locator('.pn__cm').allTextContents()).map((t) => t.trim()).sort(), typed).toEqual(pairCms);
    }
    await expect(status).toHaveText('Showing 2 of 146 parts');

    // A C&M number is read as a C&M number
    await filter.fill('cm 2');
    await expect(visible).toHaveCount(1);
    await expect(visible.locator('.pn__cm')).toHaveText('CM-0002');
    await filter.fill('acmeco CM-0111');
    await expect(visible.locator('.pn__cm')).toHaveText('CM-0111');

    // Words match the start of a word in the name
    const pulleys = catalog.filter((p) => /(^|[^a-z0-9])pulley/i.test(p.name)).length;
    expect(pulleys).toBeGreaterThan(1);
    await filter.fill('pulley');
    await expect(visible).toHaveCount(pulleys);

    // Nothing matches: say so, and offer the request form
    await filter.fill('zzqx');
    await expect(visible).toHaveCount(0);
    await expect(page.getByText('No part in the list matches that.')).toBeVisible();
    await expect(page.locator('[data-pn-empty]').getByRole('link', { name: 'Send us the part number' })).toHaveAttribute('href', '#request');

    // Escape clears the filter and brings every row back
    await filter.press('Escape');
    await expect(filter).toHaveValue('');
    await expect(visible).toHaveCount(146);
    await expect(status).toHaveText('');
  });

  test('the filter works with the phone card layout', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/shop/part-numbers/');
    const filter = page.getByLabel('Filter by OEM #, C&M # or name');
    await expect(filter).toBeVisible();
    expect((await filter.boundingBox())!.width, 'the field uses the width of the phone').toBeGreaterThan(300);
    const [pair] = sharedGroups;
    await filter.fill(pair[0].oem!);
    const visible = page.locator('table tbody tr:visible');
    await expect(visible).toHaveCount(2);
    expect(await visible.first().evaluate((tr) => getComputedStyle(tr).display), 'a visible row is still a card').toBe('grid');
    expect(await page.locator('table tbody tr').first().evaluate((tr) => getComputedStyle(tr).display), 'a hidden row takes no space').toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'no horizontal scroll').toBeLessThanOrEqual(0);
  });

  test('without JavaScript the filter field is not shown and the whole table is', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(new URL('/shop/part-numbers/', LOCAL_ORIGIN).href);
    await expect(page.locator('[data-pn-filter]')).toBeHidden();
    await expect(page.locator('table tbody tr:visible')).toHaveCount(146);
    await context.close();
  });

  test('marks every row that shares its OEM number with another part, and no other row', async ({ page }) => {
    await page.goto('/shop/part-numbers/');
    expect(sharedGroups.length).toBeGreaterThan(0);
    const marked = page.locator('table tbody tr:has(.pn__shared)');
    await expect(marked).toHaveCount(sharedCms.size);
    const cms = (await marked.locator('.pn__cm').allTextContents()).map((t) => t.trim()).sort();
    expect(cms).toEqual([...sharedCms].sort());
    await expect(marked.first().locator('.pn__shared')).toHaveText('Shared OEM #, see both');
    // the OEM number in the row is still the first thing in its cell
    await expect(marked.first().locator('.pn__oem .oem')).toHaveText(/^\d{5}[A-Z]\d{4}$/);
  });

  test('phone cards give the OEM # the larger type and the C&M # the smaller', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/shop/part-numbers/');
    const size = (selector: string) => page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const oem = await size('tbody tr .pn__oem .oem');
    const cm = await size('tbody tr .pn__cm');
    expect(oem, 'OEM # is larger than C&M #').toBeGreaterThan(cm);
  });
});

test.describe('part pages: titles, descriptions, shared and unconfirmed numbers', () => {
  test.skip(!shopOn, 'the parts shop is off in this build');

  test('every title keeps the whole part name within 65 characters, and every meta description is one sentence with the numbers', async ({ request }) => {
    const titles = new Map<string, string>();
    const metas = new Map<string, string>();
    for (let i = 0; i < catalog.length; i += 25) {
      await Promise.all(
        catalog.slice(i, i + 25).map(async (p) => {
          const html = await (await request.get(partPath(p))).text();
          const title = unescapeHtml(/<title>([\s\S]*?)<\/title>/.exec(html)![1]);
          const meta = unescapeHtml(/<meta name="description" content="([^"]*)"/.exec(html)![1]);
          const names = [p.name, p.shortName].filter(Boolean) as string[];

          expect([...title].length, title).toBeLessThanOrEqual(65);
          // one template for every part: the OEM number (the C&M number when there is none) first, the shop name last
          expect(title.startsWith(`${p.oem ?? p.cm} `), `${title} starts with the part number`).toBe(true);
          expect(title.endsWith(' | C&M Machine Shop'), `${title} ends with the shop name`).toBe(true);
          expect(title, 'no "VFFS Part" suffix').not.toContain('VFFS Part');
          expect(title, 'the name is never cut').not.toMatch(/…|\.\.\./);
          expect(names.some((n) => title.includes(n)), `${title} holds the whole name`).toBe(true);
          expect(titles.get(title), `title ${title} is unique`).toBeUndefined();
          titles.set(title, p.cm);

          expect([...meta].length, meta).toBeLessThanOrEqual(155);
          expect(meta, p.cm).toContain(`C&M number ${p.cm}`);
          if (p.oem && !confirmingParts.some((c) => c.cm === p.cm)) {
            // never a bare "replacement part for VFFS packaging machines": the OEM number says what it replaces
            expect(meta).toContain(`a replacement for OEM part number ${p.oem}`);
          } else if (p.oem) expect(meta).toContain(p.oem);
          else expect(meta, 'a part with no OEM number says so').toContain('No OEM part number is listed');
          expect(names.some((n) => meta.includes(n)), `${meta} holds the name`).toBe(true);
          expect(meta, 'a sentence').toMatch(/[.!?]$/);
          expect(meta).not.toMatch(/made to replace|replaced by|in place of|is the pattern|\bon (?:a )?VFFS|filed under/i);
          expect(metas.get(meta), 'meta description is unique').toBeUndefined();
          metas.set(meta, p.cm);
        }),
      );
    }
    expect(titles.size).toBe(catalog.length);
  });

  test('a name too long for a title uses its shortName there and keeps the full name in the heading', async ({ page }) => {
    const long = catalog.filter((p) => p.shortName);
    expect(long.length).toBeGreaterThan(0);
    for (const p of long) {
      await page.goto(partPath(p));
      expect([...(await page.title())].length).toBeLessThanOrEqual(65);
      expect(await page.title()).toContain(p.shortName!);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(p.name);
      await expect(page.locator('.specs')).toContainText(p.oem ?? p.cm);
    }
  });

  test('a part whose OEM number is being confirmed says so in its meta description and JSON-LD, and claims no match', async ({ page, request }) => {
    expect(confirmingParts.length).toBeGreaterThan(0);
    for (const p of confirmingParts) {
      const html = await (await request.get(partPath(p))).text();
      const meta = unescapeHtml(/<meta name="description" content="([^"]*)"/.exec(html)![1]);
      expect(meta, p.cm).toContain(`OEM # ${p.oem}`);
      expect(meta, p.cm).toContain('being confirmed');
      expect(meta, p.cm).not.toMatch(/replacement|replaces|matched by|made to match|fits/i);

      await page.goto(partPath(p));
      const product = (await jsonLd(page)).find((d) => d['@type'] === 'Product');
      expect(product.description, p.cm).toMatch(/confirm/i);
      expect(product.description, p.cm).not.toMatch(/\breplac\w*|matched by|\bfits\b/i);
    }
  });

  test('two parts that share an OEM number each say so, link the other part, and tell the buyer what to do', async ({ page }) => {
    expect(sharedGroups.length).toBeGreaterThan(0);
    for (const list of sharedGroups) {
      expect(list.length, 'the note is written for a pair').toBe(2);
      for (const p of list) {
        const other = list.find((o) => o.cm !== p.cm)!;
        await page.goto(partPath(p));
        const note = page.locator('[data-shared-oem]');
        await expect(note).toHaveCount(1);
        await expect(note).toBeVisible();
        expect(squash(await note.textContent())).toBe(
          `Two parts in our catalog use OEM # ${p.oem}: ${other.name} and this one. Check the name and photo, or send a photo of your part with your quote.`,
        );
        await expect(note.getByRole('link', { name: other.name })).toHaveAttribute('href', partPath(other));
      }
      // the link goes to the other part
      await page.goto(partPath(list[0]));
      await page.locator('[data-shared-oem]').getByRole('link').click();
      await expect(page).toHaveURL(new RegExp(`${partPath(list[1])}$`));
    }
    // a part with its own number has no such note
    const own = catalog.find((p) => p.oem && !sharedCms.has(p.cm))!;
    await page.goto(partPath(own));
    await expect(page.locator('[data-shared-oem]')).toHaveCount(0);
  });

  test('the store home and the machine hub describe themselves, and bulk paste has one name', async ({ page }) => {
    const descriptions: string[] = [];
    for (const url of ['/shop/', '/shop/vffs/']) {
      await page.goto(url);
      const meta = (await page.locator('meta[name="description"]').getAttribute('content'))!;
      expect([...meta].length, url).toBeLessThanOrEqual(160);
      descriptions.push(meta);
    }
    expect(descriptions[0]).not.toBe(descriptions[1]);
    expect(descriptions[0], 'the store home is about searching the whole store').toMatch(/Search all \d+ replacement parts/);
    expect(descriptions[1], 'the machine hub is about finding the part number').toMatch(/How to find the part number/);

    for (const url of ['/', '/shop/', '/shop/vffs/', '/shop/part-numbers/', '/how-to-order/']) {
      await page.goto(url);
      const links = page.getByRole('link', { name: /paste a (part )?list/i });
      expect(await links.count(), url).toBeGreaterThan(0);
      for (const text of await links.allTextContents()) expect(squash(text), url).toBe('Paste a list of part numbers');
    }
    // the footer link (every page) and the panel on the quote page use the same name
    await expect(page.locator('footer').getByRole('link', { name: /paste a/i })).toHaveText('Paste a list of part numbers');
    await page.goto('/quote/');
    await expect(page.locator('summary', { hasText: /paste a/i })).toHaveText('Paste a list of part numbers');
    for (const text of await page.locator('main').getByRole('link', { name: /paste a/i }).allTextContents()) expect(squash(text)).toBe('Paste a list of part numbers'); // the empty-list button
  });
});

test.describe('catalog CSV', () => {
  test.skip(!shopOn, 'the parts shop is off in this build');

  test('the download link saves a UTF-8 file with a BOM, a header and one line per part', async ({ page }) => {
    await page.goto('/shop/part-numbers/');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download the catalog (CSV)' }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const saved = readFileSync((await download.path())!);
    expect([...saved.subarray(0, 3)], 'UTF-8 byte order mark').toEqual([0xef, 0xbb, 0xbf]);

    const text = saved.toString('utf8').slice(1);
    const lines = text.replace(/\r\n$/, '').split('\r\n');
    expect(lines, 'header + 146 parts').toHaveLength(147);
    expect(lines[0]).toBe('OEM part number,C&M number,Part name,Section,URL');
    expect(parseCsv(text)).toHaveLength(147);
  });

  test('matches the catalog, uses RFC 4180 quoting, and has no owner-only text', async ({ request }) => {
    const response = await request.get('/shop/catalog.csv');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^text\/csv/);
    const body = await response.body();
    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = body.toString('utf8').slice(1);

    const records = parseCsv(text);
    expect(records[0]).toEqual(['OEM part number', 'C&M number', 'Part name', 'Section', 'URL']);
    expect(records.slice(1)).toEqual(inCatalogOrder.map((p) => [p.oem ?? '', p.cm, p.name, sectionTitle.get(p.section), `${SITE_ORIGIN}${partPath(p)}`]));
    expect(records.every((r) => r.length === 5)).toBe(true);
    // a name with a double quote is quoted and the quote doubled; so is one with a comma
    expect(text).toContain(',"Bearing Ball 1""",');
    expect(text).toContain(',"Air Cylinder, Special (1.5"" Bore x 3.5"" Stroke)",');

    // nothing from the owner's notes: not the flags, not the name as written in the source catalog
    const cells = new Set(records.flat());
    for (const p of catalog) {
      for (const flag of p.flags ?? []) if (flag.trim().length >= 8) expect(text.includes(flag), `flag of ${p.cm}`).toBe(false);
      if (p.nameRaw && p.nameRaw !== p.name) expect(cells.has(p.nameRaw), `nameRaw of ${p.cm}`).toBe(false);
    }
    expect(text).not.toMatch(/Verify:/);
    // no cell a spreadsheet would run as a formula
    for (const cell of cells) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
  });

  test('public/_headers gives the file its type and a short cache', () => {
    const rule = /^\/shop\/catalog\.csv\n((?:[ \t]+.*\n?)*)/m.exec(readFileSync('public/_headers', 'utf8'))?.[1] ?? '';
    expect(rule).toMatch(/Content-Type:\s*text\/csv;\s*charset=utf-8/i);
    expect(rule).toMatch(/Cache-Control:.*max-age=\d{1,4}\b/i);
  });
});

test.describe('how to order', () => {
  test('renders the steps, the facts from the site config, and a visible FAQ that matches its FAQPage JSON-LD', async ({ page }) => {
    await page.goto('/how-to-order/');
    // One name for the page: the title, the h1, the breadcrumb (checked below) and the footer link all say "How to Order"
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to Order');
    await expect(page).toHaveTitle(/^How to Order \| /);
    await expect(page.locator('main .eyebrow', { hasText: /^How to Order$/ }), 'the name is not repeated as a chip above the h1').toHaveCount(0);
    expect((await page.title()).length).toBeLessThanOrEqual(65);
    expect((await page.locator('meta[name="description"]').getAttribute('content'))!.length).toBeLessThanOrEqual(150);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_ORIGIN}/how-to-order/`);

    const main = page.getByRole('main');
    await expect(main).toContainText('no online checkout');
    // quote-only: nothing on the page offers a price or a cart
    await expect(main).not.toContainText(/\$\d/);
    await expect(main.getByRole('button', { name: /add to cart|checkout|buy now/i })).toHaveCount(0);

    // facts come from src/config/site.ts
    await expect(main).toContainText(configString('replyTime'));
    await expect(main).toContainText(configString('shipping'));
    await expect(main).toContainText(configString('leadTimeFallback'));
    await expect(main).toContainText('772 Vertin Ave, Salinas, CA 93901');
    await expect(main.locator('.ho__hours')).toContainText('7:00am – 4:00pm');
    await expect(main.locator('.ho__hours')).toContainText('10:00am – 2:00pm');
    await expect(main.getByRole('link', { name: configString('phone') }).first()).toHaveAttribute('href', `tel:${configString('phoneE164')}`);
    await expect(main.getByRole('link', { name: configString('email') }).first()).toHaveAttribute('href', `mailto:${configString('email')}`);
    // what to send
    for (const label of ['A sample, photo or drawing', 'How many', 'When you need it', 'Pickup or shipping']) await expect(main.getByText(label, { exact: true })).toBeVisible();
    await expect(main).toContainText('ZIP code');

    // visible FAQ: 4 to 6 questions, and FAQPage JSON-LD with the same questions and answers
    const items = page.locator('details.faq');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(6);
    const visible = await items.evaluateAll((els) => els.map((el) => ({ q: el.querySelector('summary')?.textContent ?? '', a: el.querySelector('p')?.textContent ?? '' })));
    const faq = (await jsonLd(page)).find((d) => d['@type'] === 'FAQPage');
    expect(faq, 'FAQPage JSON-LD').toBeTruthy();
    expect(faq.mainEntity.map((e: { name: string; acceptedAnswer: { text: string } }) => ({ q: squash(e.name), a: squash(e.acceptedAnswer.text) }))).toEqual(
      visible.map((v) => ({ q: squash(v.q), a: squash(v.a) })),
    );
    const crumbs = (await jsonLd(page)).find((d) => d['@type'] === 'BreadcrumbList');
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Home', 'How to Order']);

    // the first answer is open, and the others open on a click
    await expect(items.first()).toHaveJSProperty('open', true);
    await items.nth(1).locator('summary').click();
    await expect(items.nth(1).locator('p')).toBeVisible();
  });

  test('follows the parts shop switch', async ({ page }) => {
    await page.goto('/how-to-order/');
    const main = page.getByRole('main');
    if (shopOn) {
      await expect(main.getByRole('link', { name: 'Paste a list' })).toHaveAttribute('href', '/quote/#bulk');
      await expect(main.getByRole('link', { name: 'Browse the parts store' }).first()).toHaveAttribute('href', '/shop/');
      await expect(main.getByRole('link', { name: 'OEM part number index', exact: true })).toHaveAttribute('href', '/shop/part-numbers/');
      await expect(main.getByRole('link', { name: 'Send a part number' })).toHaveAttribute('href', '/shop/#request');
      await expect(main.getByText('Part request form', { exact: true })).toBeVisible();
    } else {
      // services and the part request form only: no catalog, quote list or bulk paste, and no link into /shop/
      await expect(main.locator('a[href^="/shop"]')).toHaveCount(0);
      await expect(main).not.toContainText(/bulk paste|paste a list|quote list|catalog|parts store/i);
      await expect(main.getByRole('link', { name: 'Send a part number' })).toHaveAttribute('href', '/quote/#cant-find');
      await expect(main.getByRole('link', { name: 'See our services' })).toHaveAttribute('href', '/services/');
      await expect(main.getByText('Replacement part request', { exact: true })).toBeVisible();
    }
    await expect(main.getByRole('link', { name: 'Request a Quote' }).first()).toHaveAttribute('href', '/quote/');
  });

  test('keeps a C&M number in one piece (no line break at its hyphen)', async ({ page }) => {
    test.skip(!shopOn, 'the C&M number examples are in the parts shop wording');
    await page.goto('/how-to-order/');
    const kept = page.locator('.ho__steps .nowrap, .ho__ways .nowrap');
    await expect(kept.first()).toBeVisible();
    expect(await kept.allTextContents()).toEqual(expect.arrayContaining(['CM-0111', '03187A0897 x2', '2 x CM-0002']));
    for (const el of await kept.all()) await expect(el).toHaveCSS('white-space', 'nowrap');
  });

  test('keeps the reply time range in one piece (no line break inside "1–2 business days")', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/how-to-order/');
    const range = page.locator('main .nowrap', { hasText: /^\d+–\d+ business days$/ });
    // hero lead, step 4 (or 3), the facts card and the FAQ answers
    expect(await range.count()).toBeGreaterThanOrEqual(4);
    for (const el of await range.all()) await expect(el).toHaveCSS('white-space', 'nowrap');
    // The hero sentence is where it used to break ("within 1–" / "2 business days"): the span must stay on one line
    const hero = page.locator('.lead .nowrap');
    await expect(hero).toHaveCount(1);
    expect(await hero.evaluate((el) => el.getClientRects().length)).toBe(1);
  });

  test('fits a phone without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/how-to-order/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test('is linked from the footer, the quote page, llms.txt and the sitemap (and from the shop index with the shop on)', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.locator('footer').getByRole('navigation', { name: 'Company' }).getByRole('link', { name: 'How to Order' })).toHaveAttribute('href', '/how-to-order/');

    await page.goto('/quote/');
    const how = page.getByRole('main').getByRole('link', { name: 'How to Order', exact: true });
    await expect(how).toHaveAttribute('href', '/how-to-order/');
    await expect(how, 'near the top of the quote page').toBeVisible();
    expect((await how.boundingBox())!.y).toBeLessThan(450);

    if (shopOn) {
      await page.goto('/shop/');
      await expect(page.getByRole('main').getByRole('link', { name: 'How to Order', exact: true })).toHaveAttribute('href', '/how-to-order/');
    }

    const llms = await (await request.get('/llms.txt')).text();
    expect(llms).toContain(`${SITE_ORIGIN}/how-to-order/`);
    const sitemap = await (await request.get('/sitemap-0.xml')).text();
    expect(sitemap).toContain(`<loc>${SITE_ORIGIN}/how-to-order/</loc>`);
  });
});

// Facts the pages state must come from src/config/site.ts or be true of every form: no payment, language or
// "email only" claims, no drafting note on the privacy page.
test.describe('stated facts', () => {
  test('the business JSON-LD claims no payment, language or coordinates', async ({ page }) => {
    await page.goto('/');
    const business = (await jsonLd(page)).find((d) => d['@type'] === 'LocalBusiness');
    expect(business, 'LocalBusiness JSON-LD').toBeTruthy();
    expect(business).not.toHaveProperty('currenciesAccepted');
    expect(business).not.toHaveProperty('geo');
    expect(business.contactPoint).not.toHaveProperty('availableLanguage');
  });

  test('the privacy page has no drafting note and lists the fields the forms collect', async ({ page }) => {
    await page.goto('/privacy/');
    const main = page.getByRole('main');
    await expect(main).not.toContainText(/template|before launch/i);
    for (const field of ['company', 'PO or reference number', 'ZIP code', 'machine model or serial number']) await expect(main).toContainText(field);
    await expect(main).not.toContainText('city,');
  });

  test('quote copy does not promise an email to a visitor who gave a phone number', async ({ page }) => {
    for (const url of ['/quote/', '/quote/thanks/']) {
      await page.goto(url);
      await expect(page.getByRole('main'), url).not.toContainText(/email you/i);
      expect((await page.locator('meta[name="description"]').getAttribute('content'))!, url).not.toMatch(/email you/i);
    }
  });

  test('the parts FAQ says "make", not "carry" or "sell" (no stock claim)', async ({ page }) => {
    test.skip(!shopOn, 'the VFFS parts FAQ entry exists only with the shop on');
    for (const url of ['/', '/industries/food-processing-agriculture/']) {
      await page.goto(url);
      const questions = await page.locator('details.faq summary').allTextContents();
      expect(questions.some((q) => /replacement parts for VFFS/.test(q)), url).toBe(true);
      expect(questions.filter((q) => /VFFS/.test(q) && /\b(carry|sell|stock)\b/i.test(q)), url).toEqual([]);
    }
  });
});

test.describe('shared pages follow the parts shop switch', () => {
  test('llms.txt and the footer list the number index and the CSV only with the shop on', async ({ page, request }) => {
    const llms = await (await request.get('/llms.txt')).text();
    await page.goto('/');
    const shopColumn = page.locator('footer').getByRole('navigation', { name: 'Shop' });
    if (shopOn) {
      expect(llms).toContain(`(${SITE_ORIGIN}/shop/part-numbers/)`);
      expect(llms).toContain(`(${SITE_ORIGIN}/shop/catalog.csv)`);
      await expect(shopColumn.getByRole('link', { name: 'OEM part number index' })).toHaveCount(1);
    } else {
      expect(llms).not.toContain('/shop/');
      await expect(shopColumn).toHaveCount(0);
      await expect(page.locator('a[href^="/shop"]')).toHaveCount(0);
    }
  });
});

test.describe('parts shop off: the index and the CSV do not exist', () => {
  test.skip(shopOn, 'the parts shop is on in this build');

  test('nothing is built, and the /shop/* rule covers the old addresses', () => {
    expect(existsSync('dist/shop/part-numbers/index.html')).toBe(false);
    expect(existsSync('dist/shop/catalog.csv')).toBe(false);
    expect(existsSync('dist/shop')).toBe(false);
    const redirects = readFileSync('dist/_redirects', 'utf8');
    expect(redirects).toMatch(/^\/shop\/\*\s+\/quote\/\s+302\s*$/m);
    expect(readFileSync('dist/_headers', 'utf8')).not.toContain('/shop/');
  });
});

// ---------- Ordering and contact pages ----------

test.describe('quote page copy', () => {
  test('says the reply time once, under the send button, and its reassurances are plain bullets, not tick boxes', async ({ page }) => {
    await page.goto('/quote/');
    const reply = configString('replyTime');
    // textContent also counts text inside the closed "send us the part number" panel
    const text = squash(await page.getByRole('main').textContent());
    expect(text.split(reply).length - 1, `"${reply}" on /quote/: once, under the send button`).toBe(1);
    await expect(page.locator('.quote-page > .container > .lead')).not.toContainText(reply);
    await expect(page.locator('form[data-kind="quote"] .form-note')).toContainText(reply);

    const checks = page.locator('.qs__checks');
    await expect(checks.locator('li')).toHaveText(['No payment required: quote only', "We'll send you a detailed quote"]);
    await expect(checks).toHaveCSS('list-style-type', 'disc');
    // no box, no tick: nothing that looks like a checked form control
    await expect(page.locator('.qs__tick, .qs__checks svg')).toHaveCount(0);
  });
});

test.describe('contact page', () => {
  test('sends a part or job quote to the quote page and everything else to the form', async ({ page }) => {
    await page.goto('/contact/');
    const lead = page.locator('main .lead').first();
    await expect(lead).not.toContainText('Reach out for quotes');
    await expect(lead.getByRole('link', { name: 'quote page' })).toHaveAttribute('href', '/quote/');
    await expect(lead).toContainText('send us a message');
    await expect(lead).toContainText(configString('replyTime'));
  });

  test('the form posts to /contact/thanks/ without JavaScript; the quote form keeps /quote/thanks/', async ({ page }) => {
    await page.goto('/contact/');
    const contact = await page.locator('form[data-kind="contact"] input[name="redirect"]').getAttribute('value');
    expect(contact).toBe(`${SITE_ORIGIN}/contact/thanks/`);
    await page.goto('/quote/');
    const quote = await page.locator('form[data-kind="quote"] input[name="redirect"]').getAttribute('value');
    expect(quote).toBe(`${SITE_ORIGIN}/quote/thanks/`);
  });

  test('/contact/thanks/ is a neutral thank-you: noindex, not in the sitemap, no quote talk, same layout as /quote/thanks/', async ({ page, request }) => {
    await page.goto('/contact/thanks/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thanks, we got your message.');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const main = page.getByRole('main');
    await expect(main).toContainText(configString('replyTime'));
    await expect(main).not.toContainText(/detailed quote|your list|your reference/i);
    await expect(main.getByRole('link', { name: 'Request a quote' })).toHaveAttribute('href', '/quote/');
    await expect(main.getByRole('link', { name: configString('phone') })).toHaveAttribute('href', `tel:${configString('phoneE164')}`);
    // the same two cards as /quote/thanks/
    await expect(main.locator('.tcard')).toHaveCount(2);
    await expect(main.getByRole('heading', { level: 2 })).toHaveText(['What happens next', 'Need anything else?']);
    await expect(page.locator('footer .cta'), 'no "Need a part or a quote?" band on a thank-you page').toHaveCount(0);

    await page.goto('/quote/thanks/');
    await expect(page.locator('main .tcard')).toHaveCount(2);

    const sitemap = await (await request.get('/sitemap-0.xml')).text();
    expect(sitemap).not.toContain('/contact/thanks/');
    expect(sitemap).not.toContain('/quote/thanks/');
    expect(sitemap).toContain(`<loc>${SITE_ORIGIN}/contact/</loc>`);
  });
});

test.describe('quote thank-you page', () => {
  test('"Search by part number" goes to the number index, not to the same page as "Browse the catalog" (and no shop links with the shop off)', async ({ page }) => {
    await page.goto('/quote/thanks/');
    const more = page.locator('main .thanks__links');
    if (shopOn) {
      await expect(more.getByRole('link', { name: 'Browse the catalog' })).toHaveAttribute('href', '/shop/');
      await expect(more.getByRole('link', { name: 'Search by part number' })).toHaveAttribute('href', '/shop/part-numbers/');
    } else {
      await expect(page.locator('main a[href^="/shop"]')).toHaveCount(0);
      await expect(more.getByRole('link', { name: 'Search by part number' })).toHaveCount(0);
      await expect(more.getByRole('link', { name: 'Browse the catalog' })).toHaveCount(0);
    }
  });

  test('tells the visitor to keep the reference only when the reference is shown', async ({ page }) => {
    const hint = page.getByText('Keep your reference handy');
    // Opened directly (or after a send without JavaScript): no reference, so no line about it
    await page.goto('/quote/thanks/');
    await expect(page.locator('[data-ref-box]')).toBeHidden();
    await expect(hint).toBeHidden();

    // After a send the quote form saved the reference in this tab
    await page.evaluate(() => sessionStorage.setItem('last-quote-ref', 'Q-260101-TEST'));
    await page.reload();
    await expect(page.locator('[data-ref-box]')).toContainText('Q-260101-TEST');
    await expect(hint).toBeVisible();
  });
});

test.describe('food processing and agriculture page', () => {
  test('has a short title, one wording for shipping, and a first FAQ answer that does not repeat the hero', async ({ page }) => {
    await page.goto('/industries/food-processing-agriculture/');
    const title = await page.title();
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).not.toMatch(/\bAg\b/);
    expect(title).toContain('Food Processing & Agriculture');

    const main = page.getByRole('main');
    const text = squash(await main.textContent());
    const shipping = configString('shipping');
    expect(text.split(shipping).length - 1, 'the confirmed shipping wording: in the list and in the FAQ').toBeGreaterThanOrEqual(2);
    expect(text).not.toMatch(/ask about shipping/i);

    // The hero says "precision-engineered solutions"; the first answer answers the question instead
    await expect(main.locator('.lead')).toContainText('precision-engineered solutions');
    await expect(main.locator('details.faq').first().locator('p')).not.toContainText('precision-engineered');

    // visible FAQ and FAQPage JSON-LD say the same
    const visible = await main.locator('details.faq').evaluateAll((els) => els.map((el) => ({ q: el.querySelector('summary')?.textContent ?? '', a: el.querySelector('p')?.textContent ?? '' })));
    const faq = (await jsonLd(page)).find((d) => d['@type'] === 'FAQPage');
    expect(faq.mainEntity.map((e: { name: string; acceptedAnswer: { text: string } }) => ({ q: squash(e.name), a: squash(e.acceptedAnswer.text) }))).toEqual(
      visible.map((v) => ({ q: squash(v.q), a: squash(v.a) })),
    );
  });
});

test.describe('service quote box', () => {
  test('has no Quantity field for a service, and adding it makes one line', async ({ page }) => {
    await page.goto('/services/machining/');
    const box = page.locator('form[data-add-to-quote]');
    await expect(box.getByLabel('Quantity')).toHaveCount(0);
    await box.getByRole('button', { name: 'Add to Quote' }).click();
    await expect(box.locator('.add-form__status')).toContainText('Added.');

    await page.goto('/quote/');
    await expect(quoteRows(page)).toHaveCount(1);
    await expect(quoteRows(page).first().locator('.qi__qty')).toHaveValue('1');
  });
});
