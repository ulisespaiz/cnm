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
  const shop = nav.getByRole('link', { name: 'Parts', exact: true });
  if (shopOn) await expect(shop).toHaveAttribute('href', '/shop/');
  else await expect(shop).toHaveCount(0);
  await expect(page.locator('.cart-btn')).toHaveAttribute('href', '/quote/');
});

test.describe('home: services up top, a short parts block, quote paths and honest FAQ answers', () => {
  const SERVICE_IDS = ['cutting', 'machining', 'metal-work', 'custom-fabrication'];
  const siteConfig = readFileSync('src/config/site.ts', 'utf8');
  const replyTime = /replyTime: '([^']+)'/.exec(siteConfig)![1];
  const serviceFile = (id: string) => readFileSync(`src/content/services/${id}.md`, 'utf8');
  const teaser = (id: string) => /^teaser:\s*"(.*)"\s*$/m.exec(serviceFile(id))![1];

  test('the four service cards sit right under the hero on a phone, each linking to its page with its teaser', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const cards = page.locator('#services .svc__card');
    await expect(cards).toHaveCount(4);
    for (const [i, id] of SERVICE_IDS.entries()) {
      await expect(cards.nth(i)).toHaveAttribute('href', `/services/${id}/`);
      await expect(cards.nth(i)).toContainText(teaser(id));
    }
    expect((await cards.first().boundingBox())!.y + (await page.evaluate(() => scrollY)), 'first service card within 1,600 px').toBeLessThan(1600);
    expect(await page.evaluate(() => document.documentElement.scrollHeight), 'page height on a phone').toBeLessThan(8500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test('the hero keeps the headline and says what and where in the eyebrow and lead', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Precision machining since 2002\.\s*Still your machine shop\.$/);
    const hero = page.locator('.hero');
    await expect(hero.locator('.eyebrow')).toHaveText('Machine shop in Salinas, CA · Since 2002');
    const lead = hero.locator('.lead');
    for (const words of ['CNC machining', 'waterjet and laser cutting', 'welding and metal work', 'custom metal fabrication']) await expect(lead).toContainText(words);
  });

  test('buttons follow the colour contract: red Get a Quote, outline second button, blue Search, nothing black', async ({ page }) => {
    await page.goto('/');
    const actions = page.locator('.hero .hero__actions .btn');
    await expect(actions.first()).toHaveText('Get a Quote');
    await expect(actions.first()).toHaveClass(/\bbtn--red\b/);
    await expect(actions.nth(1)).toHaveClass(/\bbtn--outline\b/);
    await expect(actions.nth(1)).toHaveText(shopOn ? 'Browse parts' : 'Our Services');
    await expect(page.locator('main .btn--dark')).toHaveCount(0);
    if (shopOn) {
      const search = page.getByRole('button', { name: 'Search', exact: true });
      await expect(search).toHaveClass(/\bbtn\b/);
      await expect(search).not.toHaveClass(/\bbtn--red\b/);
      await expect(page.locator('.store__count .btn--red')).toHaveCount(0);
    }
  });

  test('a visitor whose part is not listed is sent to the quote page', async ({ page }) => {
    test.skip(!shopOn, 'the parts search and the parts block exist only with the shop on');
    await page.goto('/');
    const miss = page.locator('.part-search__miss');
    await expect(miss).toContainText('Part not listed?');
    await expect(miss).toContainText(`${replyTime}.`);
    await expect(miss.getByRole('link', { name: 'Send us the number, a sample or a print' })).toHaveAttribute('href', '/quote/');

    const parts = page.locator('#parts');
    await expect(parts.getByRole('link', { name: 'Browse all parts' })).toHaveCount(1);
    await expect(parts.getByRole('link', { name: 'Browse all parts' })).toHaveAttribute('href', '/shop/');
    await expect(parts.getByRole('list', { name: 'Parts sections' }).getByRole('link')).toHaveCount(8);
    await expect(parts.locator('.store__miss').getByRole('link', { name: 'Request a quote' })).toHaveAttribute('href', '/quote/');
    await expect(parts.locator('.store__miss')).toContainText(replyTime);
    await expect(parts).toContainText('not affiliated with or endorsed by any machine manufacturer');
  });

  test('with the shop off there is no parts block', async ({ page }) => {
    test.skip(shopOn, 'the parts shop is on in this build');
    await page.goto('/');
    await expect(page.locator('#parts')).toHaveCount(0);
    await expect(page.locator('#hero-q')).toHaveCount(0);
  });

  test('the FAQ names all four services, only listed materials, and an honest turnaround', async ({ page }) => {
    await page.goto('/');
    const answer = (q: string) => page.locator('details.faq', { has: page.locator('summary', { hasText: q }) }).locator('p');
    const services = await answer('What services do you offer?').textContent();
    for (const words of ['CNC machining', 'cutting', 'welding', 'fabrication']) expect(services).toContain(words);

    const materials = (await answer('What materials do you use?').textContent())!;
    expect(materials).not.toMatch(/titanium|polymer|alloy/i);
    const listed = SERVICE_IDS.flatMap((id) => JSON.parse(/^materials:\s*(\[.*\])\s*$/m.exec(serviceFile(id))![1]) as string[]).map((m) => m.toLowerCase());
    for (const m of new Set(listed)) expect(materials, m).toContain(m);

    const turnaround = (await answer('What is your typical turnaround time?').textContent())!;
    expect(turnaround.endsWith(`${replyTime}.`)).toBe(true);
    expect(turnaround).not.toMatch(/complexity/i);
  });

  test('the photo section says what it shows, the alt text does not double "shop", the banner loads lazily, "waterjet" is one word', async ({ page }) => {
    await page.goto('/');
    const main = page.getByRole('main');
    await expect(main).not.toContainText('Proof of our quality');
    await expect(main.locator('.eyebrow', { hasText: 'Inside our shop' })).toHaveCount(1);
    for (const alt of await main.locator('img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('alt') ?? ''))) expect(alt).not.toMatch(/shop shop/i);
    await expect(page.locator('.banner img')).toHaveAttribute('loading', 'lazy');
    await expect(main).not.toContainText(/water-jet|water jet/i);
  });
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

test.describe('shop: a visitor who does not find the part is asked for it', () => {
  test.skip(!shopOn, 'the parts shop is off in this build');

  interface ShopPart {
    id: string;
    machine: string;
    section: string;
    cm: string;
    oem?: string;
    name: string;
    aka?: string[];
    oemAlt?: string[];
  }
  const parts: ShopPart[] = JSON.parse(readFileSync('src/content/parts.json', 'utf8'));
  const byCm = (cm: string) => parts.find((p) => p.cm === cm)!;
  const pathOf = (cm: string) => {
    const p = byCm(cm);
    return `/shop/${p.machine}/${p.section}/${p.id}/`;
  };
  const MADE_TO = 'Made to match your part number, sample or print'; // site.store.madeTo
  const SHARED = '03027A9240'; // CM-0039 and CM-0046 share it (the owner marked both oemVerify)
  const named = (cm: string) => `${byCm(cm).name} (${cm})`;
  const requestNumber = (page: Page) => page.locator('#request #pr-number');

  test('the search panel ends with "Request a quote for <query>"; a search that finds nothing makes it the main button', async ({ page }) => {
    await page.goto('/shop/');
    const field = page.locator('.psearch--hero').getByRole('searchbox');
    await field.fill('gear');
    await expect(page.locator('.psearch--hero .ps-hit').first()).toBeVisible();
    const ask = page.locator('.psearch--hero .ps-ask');
    await expect(ask).toHaveText('Not the part you need? Request a quote for gear');
    await ask.click();
    await expect(requestNumber(page)).toHaveValue('gear');
    await expect(page.locator('#request #pr-name')).toBeFocused();
    await expect(page.locator('.psearch--hero [data-ps-panel]')).toBeHidden();

    await field.fill('10097A9999');
    const empty = page.locator('.psearch--hero .ps-empty');
    await expect(empty).toContainText(MADE_TO);
    await expect(empty).toContainText('We reply within');
    const main = empty.getByRole('button', { name: 'Request a quote for 10097A9999' });
    await expect(main).toHaveClass(/btn--red/);
    await main.click();
    await expect(requestNumber(page)).toHaveValue('10097A9999');
  });

  test('a page without the request form sends the number to the quote page', async ({ page }) => {
    await page.goto('/shop/vffs/');
    await page.evaluate(() => document.getElementById('request')?.remove());
    await page.locator('.storebar').getByRole('searchbox').fill('10097A9999');
    await page.locator('.storebar .ps-empty').getByRole('button', { name: 'Request a quote for 10097A9999' }).click();
    await expect(page).toHaveURL(/\/quote\/$/);
    await expect(quoteRows(page)).toHaveCount(1);
    await expect(quoteRows(page).first()).toContainText('10097A9999');
  });

  test('every parts list ends with "Don\'t see your part number?", and its button opens the request form with the search', async ({ page }) => {
    await page.goto('/shop/vffs/actuator/');
    const more = page.locator('[data-more]');
    await expect(more.getByRole('heading', { name: "Don't see your part number?" })).toBeVisible();
    await expect(more).toContainText(MADE_TO);
    await expect(more.getByRole('link', { name: 'Paste a list' })).toHaveAttribute('href', '/quote/#bulk');
    const ask = more.getByRole('link', { name: 'Request a quote' });
    await expect(ask).toHaveClass(/btn--red/);
    await ask.click();
    await expect(requestNumber(page)).toBeFocused();

    await page.goto('/shop/vffs/actuator/?q=link');
    await expect(page.locator('[data-rows] > li.prow:not([hidden])').first()).toBeVisible();
    await page.locator('[data-more]').getByRole('link', { name: 'Request a quote' }).click();
    await expect(requestNumber(page)).toHaveValue('link');
  });

  test('a search with no results asks for the number, and the empty filter box goes away', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/shop/vffs/actuator/');
    await expect(page.locator('.plist__side')).toBeVisible();
    await page.goto('/shop/vffs/actuator/?q=zzqqxx');
    const empty = page.locator('[data-empty]');
    await expect(empty).toContainText("Don't see your part number?");
    await expect(empty).toContainText(MADE_TO);
    await expect(empty.getByRole('link', { name: 'Paste a list' })).toHaveAttribute('href', '/quote/#bulk');
    await expect(page.locator('[data-more]')).toBeHidden();
    await expect(page.locator('.plist__side')).toBeHidden();
    await empty.getByRole('button', { name: 'Request a quote' }).click();
    await expect(requestNumber(page)).toHaveValue('zzqqxx');
  });

  test('the store home asks right after the section tiles', async ({ page }) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/shop/');
      const cant = page.locator('.shop__cant');
      await expect(cant.getByRole('heading', { name: "Can't find your part?" })).toBeVisible();
      await expect(cant).toContainText(MADE_TO);
      const tiles = (await page.locator('.shop__tiles').boundingBox())!;
      const box = (await cant.boundingBox())!;
      expect(box.y - (tiles.y + tiles.height), `${width}px: the call-out follows the tiles`).toBeGreaterThanOrEqual(0);
      expect(box.y - (tiles.y + tiles.height), `${width}px: nothing in between`).toBeLessThan(40);
    }
    await page.locator('.shop__cant').getByRole('link', { name: 'Request a quote' }).click();
    await expect(requestNumber(page)).toBeFocused();
  });

  test('a part page offers the request form and machining next to Add to Quote', async ({ page }) => {
    await page.goto(pathOf('CM-0111'));
    const other = page.locator('.part__other');
    await expect(other).toContainText('Not the part you need?');
    await expect(other.getByRole('link', { name: 'We machine parts to a sample or a print.' })).toHaveAttribute('href', '/services/machining/');
    await other.getByRole('link', { name: 'Send us your part number' }).click();
    await expect(page.locator('#request-details')).toHaveJSProperty('open', true);
    await expect(requestNumber(page)).toBeFocused();
    await expect(requestNumber(page)).toHaveValue('');
    // Button colours: the page's Add to Quote is its main quote action; a list row's Add is secondary
    await expect(page.getByRole('button', { name: `Add to Quote: ${PART}` })).toHaveClass(/btn--red/);
    await expect(page.locator('.rel .padd__add').first()).toHaveClass(/btn--outline/);
  });

  test('parts that share an OEM number link to each other; other names and spellings are in the specifications', async ({ page }) => {
    await page.goto(pathOf('CM-0039'));
    await expect(page.locator('.ident__shared')).toContainText('Another part uses this OEM part number');
    await expect(page.locator('.ident__shared a')).toHaveAttribute('href', pathOf('CM-0046'));
    await page.goto(pathOf('CM-0046'));
    await expect(page.locator('.ident__shared a')).toHaveAttribute('href', pathOf('CM-0039'));
    await page.goto(pathOf('CM-0111'));
    await expect(page.locator('.ident__shared')).toHaveCount(0);

    const alt = parts.find((p) => p.oemAlt?.length)!;
    await page.goto(pathOf(alt.cm));
    await expect(page.locator('.specs__row', { hasText: 'Also written as' })).toContainText(alt.oemAlt![0]);
    const aka = parts.find((p) => p.aka?.length)!;
    await page.goto(pathOf(aka.cm));
    await expect(page.locator('.specs__row', { hasText: 'Also called' })).toContainText(aka.aka![0]);

    await page.goto(pathOf(parts.find((p) => !p.oem)!.cm));
    await expect(page.locator('.ident__none')).toContainText('This part has no OEM part number.');
  });

  test('bulk paste: a shared number is a choice with nothing chosen, and a line of words is not ticked', async ({ page }) => {
    await page.goto('/quote/#bulk');
    const bulk = page.locator('#bulk');
    await bulk.locator('[data-bulk-text]').fill([`${SHARED} x2`, '03027A8608', '10097A9999', 'thanks for the help'].join('\n'));
    await bulk.getByRole('button', { name: 'Check list' }).click();
    await expect(bulk.locator('[data-bulk-summary]')).toContainText('0 matched · 2 not found · 2 to choose');

    const choose = bulk.locator('.bk__row--choose');
    await expect(choose).toHaveCount(2);
    await expect(choose.first().getByRole('group', { name: '2 parts share this OEM #: choose one' })).toBeVisible();
    await expect(choose.first().getByRole('radio')).toHaveCount(2);
    for (const radio of await choose.getByRole('radio').all()) await expect(radio).not.toBeChecked();

    const misses = bulk.locator('.bk__row--miss');
    const number = misses.filter({ hasText: '10097A9999' });
    await expect(number).toContainText("we'll check it and quote it");
    await expect(number.getByRole('checkbox', { name: 'Add anyway' })).toBeChecked();
    await expect(misses.filter({ hasText: 'thanks for the help' }).getByRole('checkbox', { name: 'Add anyway' })).not.toBeChecked();

    // The second number gets a choice; the first is left for the shop to confirm.
    await choose.nth(1).getByRole('radio', { name: new RegExp(byCm('CM-0044').name) }).check();
    await bulk.getByRole('button', { name: 'Add 3 lines to quote' }).click();
    await expect(quoteRows(page)).toHaveCount(3);
    const stored: Record<string, unknown>[] = await page.evaluate(() => JSON.parse(localStorage.getItem('quote-list-v2') ?? 'null').items);
    const shared = stored.find((i) => i.oem === SHARED)!;
    expect(shared).toMatchObject({ kind: 'custom', qty: 2, noCatalog: true });
    expect(shared.note).toContain(`${named('CM-0039')} or ${named('CM-0046')}`);
    expect(stored.find((i) => i.cm === 'CM-0044')).toMatchObject({ kind: 'part', oem: '03027A8608' });
    expect(stored.some((i) => i.cm === 'CM-0043'), 'never both parts of a shared number').toBe(false);
    await expect(quoteRows(page).filter({ hasText: SHARED })).toContainText("We'll check it and quote it.");
  });

  test('/quote/?part= with a shared number adds one line that names both parts, and a toast that says so', async ({ page }) => {
    await page.goto(`/quote/?part=${SHARED}&qty=2`);
    await expect(quoteRows(page)).toHaveCount(1);
    const row = quoteRows(page).first();
    await expect(row).toContainText(`OEM # ${SHARED}`);
    await expect(row.locator('.qi__qty')).toHaveValue('2');
    await expect(row.locator('.qi__note')).toHaveValue(`2 parts share this OEM #: ${named('CM-0039')} or ${named('CM-0046')}. We'll confirm which one you need.`);
    const toast = page.locator('#toast-region');
    await expect(toast).toContainText('2 parts share this number');
    await expect(toast).toContainText(named('CM-0039'));
    await expect(toast).toContainText(named('CM-0046'));
  });

  test('when the search index cannot load, the search says so where the visitor typed', async ({ page }) => {
    await page.route('**/shop/search-index.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'not json' }));
    await page.goto('/shop/');
    await page.locator('.psearch--hero').getByRole('searchbox').fill(PART);
    const down = page.locator('.psearch--hero [data-ps-down]');
    await expect(down).toContainText('Search is unavailable right now');
    await expect(down.getByRole('link', { name: configString('phone') })).toHaveAttribute('href', `tel:${configString('phoneE164')}`);
    await down.getByRole('button', { name: `Request a quote for ${PART}` }).click();
    await expect(requestNumber(page)).toHaveValue(PART);

    await page.goto(`/shop/vffs/actuator/?q=${PART}`);
    await expect(page.locator('[data-count]')).toHaveText(/^Search is unavailable right now/);
    const notice = page.locator('[data-search-down]');
    await expect(notice.getByRole('link', { name: 'OEM part number index' })).toHaveAttribute('href', '/shop/part-numbers/');
    await notice.getByRole('button', { name: 'Request a quote' }).click();
    await expect(requestNumber(page)).toHaveValue(PART);
  });

  test('without JavaScript, shop pages point to the part number index and the quote page', async ({ request }) => {
    for (const url of ['/shop/', '/shop/vffs/', '/shop/vffs/actuator/', pathOf('CM-0111')]) {
      const html = await (await request.get(url)).text();
      const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? '';
      expect(noscript, url).toContain('href="/shop/part-numbers/"');
      expect(noscript, url).toContain('href="/quote/"');
    }
  });

  test('phones: list rows have no stepper and are about 100px; the header scrolls away under the search bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/shop/vffs/actuator/');
    const rows = page.locator('[data-rows] > li.prow');
    const first = rows.first();
    await expect(first.locator('.qty')).toBeHidden();
    const add = first.getByRole('button', { name: /^Add to Quote: / });
    await expect(add).toBeVisible();
    // Add sits on the number line
    const addBox = (await add.boundingBox())!;
    const oemBox = (await first.locator('.prow__oem').boundingBox())!;
    expect(addBox.y).toBeLessThan(oemBox.y + oemBox.height);
    expect(addBox.y + addBox.height).toBeGreaterThan(oemBox.y);
    const heights = await rows.evaluateAll((els) => els.slice(0, 6).map((el) => el.getBoundingClientRect().height));
    expect(Math.max(...heights), heights.join(', ')).toBeLessThanOrEqual(125);
    expect(heights.reduce((a, b) => a + b, 0) / heights.length, heights.join(', ')).toBeLessThanOrEqual(112);
    await add.click();
    await expect(quoteBadge(page)).toHaveText('1');

    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => page.locator('.site-header').evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
    await expect.poll(() => page.locator('.storebar').evaluate((el) => el.getBoundingClientRect().top)).toBe(0);

    // The store home has no search bar, so its header stays; the part page keeps its stepper (in the add bar).
    await page.goto('/shop/');
    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => page.locator('.site-header').evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
    await page.goto(pathOf('CM-0111'));
    await expect(page.locator('.addbar .qty')).toBeVisible();
    await expect(page.locator('.addbar').getByRole('button', { name: `Add to Quote: ${PART}` })).toHaveClass(/btn--red/);
  });

  test('short screens: the search bar and the part page add bar scroll with the page', async ({ page }) => {
    await page.setViewportSize({ width: 740, height: 360 });
    await page.goto('/shop/vffs/actuator/');
    await expect(page.locator('.storebar')).toHaveCSS('position', 'static');
    await page.goto(pathOf('CM-0111'));
    await expect(page.locator('.addbar')).toHaveCSS('position', 'static');
    await page.setViewportSize({ width: 740, height: 800 });
    await expect(page.locator('.addbar')).toHaveCSS('position', 'fixed');
    await page.goto('/shop/vffs/actuator/');
    await expect(page.locator('.storebar')).toHaveCSS('position', 'sticky');
  });

  test('shop pages line up with the header; list thumbnails are not high priority and part links can prefetch', async ({ page }) => {
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/shop/vffs/actuator/');
      const header = (await page.locator('.site-header__inner').boundingBox())!;
      const main = (await page.locator('.sec').boundingBox())!;
      expect(main.x, `${width}px`).toBe(header.x);
      expect(main.width, `${width}px`).toBe(header.width);
      expect((await page.locator('.sec > .store-disclaimer').boundingBox())!.width, 'the disclaimer keeps a readable line').toBeLessThan(760);
    }
    const row = page.locator('[data-rows] > li.prow').first();
    await expect(row.locator('.padd__add')).toHaveClass(/btn--outline/);
    await expect(row.locator('a.prow__name')).toHaveAttribute('data-astro-prefetch', '');
    await expect(page.locator('[data-rows] img[fetchpriority]')).toHaveCount(0);
    await page.goto('/shop/');
    await expect(page.locator('.psearch__go'), 'search is blue, not the red quote colour').not.toHaveClass(/btn--red/);
  });
});

test('the quote form posts to Web3Forms and lands on the thank-you page', async ({ page, web3forms }) => {
  await page.goto(`/quote/?part=${PART}&qty=2`);
  await expect(quoteRows(page)).toHaveCount(1);

  const form = page.locator('form[data-kind="quote"]');
  await form.getByLabel(/Full Name/).fill('Test Customer');
  await form.getByLabel(/Email Address/).fill('test.customer@example.com');
  await form.getByLabel(/Phone Number/).fill('(831) 555-0100');
  await form.getByLabel(/Describe the job/).fill('Smoke test, please ignore.');
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

test.describe('quote-flow: a clear form, with or without a list', () => {
  const PHONE = { width: 390, height: 844 };
  const seed = (page: Page, items: object[]) =>
    page.evaluate((list) => localStorage.setItem('quote-list-v2', JSON.stringify({ ref: 'Q-260101-TEST', items: list })), items);
  // A number typed by hand: the same kind of line in both shop states.
  const custom = (n: number, note = '') => ({
    key: `custom:9999${n}`,
    kind: 'custom',
    id: `custom:9999${n}`,
    title: `OEM # 9999${n}`,
    oem: `9999${n}`,
    options: {},
    qty: 2,
    ...(note && { note }),
  });
  const fillContact = async (form: Locator) => {
    await form.getByLabel(/Full Name/).fill('Test Customer');
    await form.getByLabel(/Email Address/).fill(CUSTOMER_EMAIL);
  };

  test('an empty list is one short note on a phone, and the form starts on the first screen', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/quote/');
    const empty = page.locator('[data-quote-empty]');
    await expect(empty).toContainText('A part number, a sample or a print is enough');
    await expect(empty.getByRole('link', { name: 'Our services' })).toHaveAttribute('href', '/services/');
    if (shopOn) {
      await expect(empty.getByRole('link', { name: 'Browse parts' })).toHaveAttribute('href', '/shop/');
      await expect(empty.getByRole('link', { name: 'Paste a list' })).toHaveAttribute('href', '#bulk');
    } else {
      await expect(empty.locator('a[href^="/shop"], a[href="#bulk"]')).toHaveCount(0);
    }

    const form = page.locator('form[data-kind="quote"]');
    const first = (await form.getByLabel(/Full Name/).boundingBox())!;
    expect(first.y, 'first form field on the first 844px screen').toBeLessThan(700);
    const notes = form.getByLabel('Describe the job or notes');
    await expect(notes).toHaveAttribute('name', 'message');
    await expect(notes).toHaveAttribute('placeholder', /No part number\?/);
    // The drawing advice follows the form instead
    await expect(form.getByText('Have a drawing or photo of the part?')).toBeVisible();

    if (shopOn) {
      await empty.getByRole('link', { name: 'Paste a list' }).click();
      await expect(page.locator('#bulk')).toHaveJSProperty('open', true);
      await expect(page.locator('#bulk [data-bulk-text]')).toBeVisible();
    }
  });

  test('/quote/?service=<id> adds that service once, with no quantity, and opens at the form', async ({ page }) => {
    await page.goto('/quote/?service=machining#details');
    await expect(quoteRows(page)).toHaveCount(1);
    await expect(quoteRows(page).first()).toContainText('Machining');
    await expect(quoteRows(page).first().locator('.qi__qty, .qi__stepper')).toHaveCount(0);
    await expect(page).toHaveURL(/\/quote\/#details$/);
    await expect(page.locator('#details')).toBeInViewport();
    await expect(page.locator('[data-count-line]')).toHaveText('1 item');

    // Again, and with an id that is not a service: nothing more is added
    await page.goto('/quote/?service=machining#details');
    await page.goto('/quote/?service=not-a-service');
    await expect(page).toHaveURL(/\/quote\/$/);
    await expect(quoteRows(page)).toHaveCount(1);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('quote-list-v2')!).items);
    expect(stored).toEqual([expect.objectContaining({ kind: 'service', id: 'service:machining', qty: 1 })]);
  });

  test('a long list has "Skip to your details" in its header on a phone', async ({ page }) => {
    await page.goto('/');
    await seed(page, Array.from({ length: 12 }, (_, n) => custom(n)));
    await page.setViewportSize(PHONE);
    await page.goto('/quote/');
    const skip = page.getByRole('link', { name: 'Skip to your details' });
    await expect(skip).toBeVisible();
    await expect(page.locator('#details')).not.toBeInViewport();
    await skip.click();
    await expect(page.locator('#info-title')).toBeInViewport();
  });

  test('the request posts contact details and message first, the list last, and no empty fields', async ({ page, web3forms }) => {
    await page.goto('/quote/?service=cutting');
    const form = page.locator('form[data-kind="quote"]');
    await fillContact(form);
    await form.getByLabel('Describe the job or notes').fill('Smoke test, please ignore.');
    await form.getByRole('button', { name: /Send Quote Request/ }).click();
    await expect(page).toHaveURL(/\/quote\/thanks\/$/);

    const fields = Object.keys(web3forms[0].fields);
    expect(fields.slice(-2)).toEqual(['products', 'quote_ref']);
    expect(fields.indexOf('name')).toBeLessThan(fields.indexOf('message'));
    for (const empty of ['phone', 'company', 'po', 'needed_by']) expect(fields).not.toContain(empty);
    expect(web3forms[0].fields.products).toContain('SERVICE | Cutting Services');

    // A described job with no list sends no products field
    await page.goto('/quote/');
    await fillContact(form);
    await form.getByLabel('Describe the job or notes').fill('A bracket like the one in my photo, 4 pieces.');
    await form.getByRole('button', { name: /Send Quote Request/ }).click();
    await expect(page).toHaveURL(/\/quote\/thanks\/$/);
    expect(Object.keys(web3forms[1].fields)).not.toContain('products');
    expect(web3forms[1].fields.subject).toMatch(/^Quote request Q-\d{6}-[A-Z0-9]{4} from Test Customer$/);

    // The contact form has no list to send
    await page.goto('/contact/');
    const contact = page.locator('form[data-kind="contact"]');
    await contact.getByLabel(/^Name/).fill('Test Customer');
    await contact.getByLabel(/^Email/).fill(CUSTOMER_EMAIL);
    await contact.getByLabel(/^Message/).fill('Smoke test, please ignore.');
    await contact.getByRole('button', { name: /Send Message/ }).click();
    await expect(contact.locator('[data-form-status]')).toContainText('Thanks, we got your message');
    expect(Object.keys(web3forms[2].fields)).not.toContain('products');
    expect(Object.keys(web3forms[2].fields)).not.toContain('quote_ref');
  });

  test('after a failed send, the email link keeps the message and counts the list lines left out', async ({ page, problems }) => {
    await page.route('https://api.web3forms.com/**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"success":false}' }),
    );
    await page.goto('/');
    await seed(page, Array.from({ length: 30 }, (_, n) => custom(n, 'Same as the one we ordered last spring, please')));
    await page.goto('/quote/');
    const form = page.locator('form[data-kind="quote"]');
    await fillContact(form);
    await form.getByLabel('Describe the job or notes').fill('MESSAGE FIRST');
    await form.getByRole('button', { name: /Send Quote Request/ }).click();

    const status = form.locator('[data-form-status]');
    const link = status.getByRole('link', { name: 'email your request' });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href'))!;
    expect(href.length).toBeLessThanOrEqual(1800);
    const body = decodeURIComponent(/[?&]body=([^&]*)/.exec(href)![1]);
    expect(body.indexOf('MESSAGE FIRST')).toBeGreaterThan(-1);
    expect(body.indexOf('MESSAGE FIRST')).toBeLessThan(body.indexOf('Items (30):'));
    expect(body).toContain('1. 2 x OEM # 99990');
    const left = Number(/\[(\d+) more lines did not fit in this email link\. Please paste the rest of your list here/.exec(body)?.[1]);
    expect(left).toBeGreaterThan(0);
    expect(body).not.toContain(`${30 - left + 1}. 2 x`);
    await expect(status).toContainText(`${left} lines are left out`);
    expect(body).not.toContain('quote page');

    // The failure is the point of this test
    const expected = /Form submit failed|status of 500/;
    problems.splice(0, problems.length, ...problems.filter((p) => !expected.test(p)));
  });

  test('a browser that cannot save the list says so once, with the phone number and the part request form', async ({ page }) => {
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (this === window.localStorage) throw new DOMException('blocked', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
    });
    await page.goto('/quote/?service=machining');
    const toast = page.locator('#toast-region .toast');
    await expect(toast).toContainText('This browser is not saving your quote list');
    await expect(toast.getByRole('link', { name: configString('phone') })).toHaveAttribute('href', `tel:${configString('phoneE164')}`);
    await expect(toast.getByRole('link', { name: 'send us the part number' })).toHaveAttribute('href', '/quote/#cant-find');
    await toast.getByRole('link', { name: 'send us the part number' }).click();
    await expect(page.locator('#cant-find')).toHaveJSProperty('open', true);

    // Once per visit: another line on another page view says nothing more
    await page.goto('/quote/?service=cutting');
    await expect(toast).toContainText('Cutting Services added');
    await page.waitForTimeout(300);
    await expect(page.locator('#toast-region')).not.toContainText('not saving');
  });

  test('a toast goes away on a tap outside it, and the region still announces', async ({ page }) => {
    await page.goto('/quote/?service=metal-work');
    const toast = page.locator('#toast-region .toast');
    await expect(toast).toContainText('Metal Work added to your request');
    await expect(page.locator('#toast-region')).toHaveAttribute('role', 'status');
    await page.getByRole('heading', { level: 1 }).click();
    // Well before its own 4 seconds are up
    await expect(toast).toHaveCount(0, { timeout: 1500 });
  });

  test('another tab sees the list change', async ({ page }) => {
    await page.goto('/');
    await expect(quoteBadge(page)).toBeHidden();
    const other = await page.context().newPage();
    await other.goto('/quote/?service=machining');
    await expect(other.locator('[data-quote-items] .qi')).toHaveCount(1);
    await expect(quoteBadge(page)).toHaveText('1');
    await other.close();
  });

  test('a number that is not in the catalog is still quoted, in plain words', async ({ page }) => {
    await page.goto('/quote/?part=99999Z9999');
    await expect(quoteRows(page)).toHaveCount(1);
    const row = quoteRows(page).first();
    await expect(row).toContainText(/we'll check it and quote it\./i);
    if (shopOn) await expect(row).toContainText('Not in our catalog yet');
    await expect(row).not.toContainText(/fits|in stock/i);
  });

  test('the thank-you page offers parts (shop on), services and home', async ({ page }) => {
    await page.goto('/quote/thanks/');
    const links = page.locator('.thanks__links a');
    await expect(links).toHaveText(shopOn ? ['Browse parts', 'Our services', 'Back to home'] : ['Our services', 'Back to home']);
    const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual(shopOn ? ['/shop/', '/services/', '/'] : ['/services/', '/']);
  });

  test('with reduced motion, adding a pasted list jumps to it without animating', async ({ page }) => {
    test.skip(!shopOn, 'bulk paste is part of the parts shop');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(PHONE);
    await page.goto('/quote/#bulk');
    await page.locator('#bulk [data-bulk-text]').fill(PART);
    await page.locator('#bulk').getByRole('button', { name: 'Check list' }).click();
    await expect(page.locator('#bulk').getByRole('button', { name: /Add 1 line to quote/ })).toBeVisible();
    const inView = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      [...document.querySelectorAll<HTMLButtonElement>('#bulk button')].find((b) => /Add 1 line/.test(b.textContent ?? ''))!.click();
      // Measured at once: a smooth scroll would not have moved yet
      const box = document.querySelector('[data-quote-items]')!.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight;
    });
    expect(inView).toBe(true);
  });
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
      await form.getByLabel(/Describe the job/).fill('Smoke test, please ignore.');
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
  expect(web3forms).toHaveLength(0);
});

test('pages load without console errors', async ({ page, request, problems }) => {
  const urls = ['/', '/services/', '/contact/', '/quote/', '/quote/thanks/', '/how-to-order/'];
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
  nameRaw?: string;
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
    await expect(page.getByRole('link', { name: 'Paste it on the quote page' })).toHaveAttribute('href', '/quote/#bulk');
    await expect(page.getByRole('link', { name: 'Send us the part number' }).first()).toHaveAttribute('href', '#request');
    await expect(page.locator('#request form[data-part-request]')).toHaveCount(1);
    await expect(page.locator('.store-disclaimer')).toContainText('not affiliated with or endorsed by any machine manufacturer');
    await expect(page.getByRole('link', { name: 'Download the catalog (CSV)' })).toHaveAttribute('href', '/shop/catalog.csv');

    for (const url of ['/shop/', '/shop/vffs/']) {
      await page.goto(url);
      await expect(page.locator('main').getByRole('link', { name: /OEM part number index/ }).first(), url).toHaveAttribute('href', '/shop/part-numbers/');
    }
    await page.goto('/');
    await expect(page.locator('footer').getByRole('navigation', { name: 'Parts' }).getByRole('link', { name: 'OEM part number index' })).toHaveAttribute('href', '/shop/part-numbers/');
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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('How to get a part or job quoted');
    expect((await page.title()).length).toBeLessThanOrEqual(65);
    expect((await page.locator('meta[name="description"]').getAttribute('content'))!.length).toBeLessThanOrEqual(160);
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
    const how = page.getByRole('link', { name: 'How ordering works' });
    await expect(how).toHaveAttribute('href', '/how-to-order/');
    await expect(how, 'near the top of the quote page').toBeVisible();
    expect((await how.boundingBox())!.y).toBeLessThan(450);

    if (shopOn) {
      await page.goto('/shop/');
      await expect(page.getByRole('link', { name: 'How ordering works' })).toHaveAttribute('href', '/how-to-order/');
    }

    const llms = await (await request.get('/llms.txt')).text();
    expect(llms).toContain(`${SITE_ORIGIN}/how-to-order/`);
    const sitemap = await (await request.get('/sitemap-0.xml')).text();
    expect(sitemap).toContain(`<loc>${SITE_ORIGIN}/how-to-order/</loc>`);
  });
});

test.describe('content: service pages, machinery, about, 404 and privacy', () => {
  // title: cards, breadcrumbs, the footer and JSON-LD. heading: the service page's h1.
  const SERVICES = [
    { id: 'cutting', title: 'Cutting Services', heading: 'Waterjet & Laser Cutting' },
    { id: 'machining', title: 'Machining', heading: 'CNC Machining' },
    { id: 'metal-work', title: 'Metal Work', heading: 'Welding & Metal Work' },
    { id: 'custom-fabrication', title: 'Custom Fabrication', heading: 'Custom Metal Fabrication' },
  ];
  // A quoted front-matter value from a service's Markdown file.
  const frontMatter = (id: string, field: string) => new RegExp(`^${field}:\\s*"(.*)"\\s*$`, 'm').exec(readFileSync(`src/content/services/${id}.md`, 'utf8'))?.[1] ?? '';
  const times = (text: string, part: string) => text.split(part).length - 1;
  const mainText = async (page: Page) => squash(await page.getByRole('main').textContent());
  // Claims nothing in the repo records: removed until the owner confirms them.
  const UNCONFIRMED = /titanium|high-performance polymers|exotic alloys|specialty alloys|strict quality control|eco-friendly|any scale and complexity|ahead of industry standards|trusted by businesses across multiple industries/i;
  const OLD_SPELLING = /water[- ]jet/i; // "waterjet" is one word

  for (const s of SERVICES) {
    test(`/services/${s.id}/ leads with "${s.heading}", lists each capability once and sends the visitor to the quote form`, async ({ page }) => {
      await page.goto(`/services/${s.id}/`);
      const main = page.getByRole('main');

      // The h1 carries the words the title targets, the eyebrow names the city, the breadcrumb and JSON-LD keep the short title
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.heading);
      expect(await page.title()).toContain(`${s.heading} in Salinas, CA`);
      await expect(main.locator('.eyebrow').first()).toHaveText('Services · Salinas, CA');
      const data = await jsonLd(page);
      expect(data.find((d) => d['@type'] === 'BreadcrumbList').itemListElement.map((i: { name: string }) => i.name)).toEqual(['Home', 'Services', s.title]);
      const service = data.find((d) => d['@type'] === 'Service');
      expect(service, 'Service JSON-LD').toBeTruthy();
      expect(service.name).toBe(s.title);
      expect(service.url).toBe(`${SITE_ORIGIN}/services/${s.id}/`);
      const summary = frontMatter(s.id, 'summary');
      expect(summary.length).toBeGreaterThan(40);
      expect(service.description).toBe(summary);

      // The summary is on the page once (the lead), and every heading, capability names included, appears once
      const text = await mainText(page);
      expect(times(text, summary), 'the summary is shown once').toBe(1);
      await expect(main.locator('.lead')).toHaveText(summary);
      await expect(main.getByRole('heading', { level: 2, name: 'Capabilities', exact: true })).toHaveCount(1);
      const capabilities = (await main.locator('.capabilities h3').allTextContents()).map(squash);
      expect(capabilities.length).toBeGreaterThanOrEqual(2);
      expect(service.hasOfferCatalog.itemListElement.map((o: { itemOffered: { name: string } }) => o.itemOffered.name)).toEqual(capabilities);
      const headings = (await main.getByRole('heading').allTextContents()).map(squash);
      expect(new Set(headings).size, `a heading is repeated: ${headings.join(' | ')}`).toBe(headings.length);
      await expect(main.getByRole('heading', { name: `${s.heading}: common questions` })).toBeVisible();

      // One red quote button and a full-size call button, with the reply time; no quote-list stepper
      const aside = main.locator('.service__quote');
      const quote = aside.getByRole('link', { name: 'Request a quote', exact: true });
      await expect(quote).toHaveAttribute('href', `/quote/?service=${s.id}#details`);
      await expect(quote).toHaveClass(/btn--red/);
      const call = aside.getByRole('link', { name: `Call ${configString('phone')}` });
      await expect(call).toHaveAttribute('href', `tel:${configString('phoneE164')}`);
      await expect(call).toHaveClass(/btn--outline/);
      await expect(aside).toContainText(`${configString('replyTime')}.`);
      const [quoteBox, callBox] = [(await quote.boundingBox())!, (await call.boundingBox())!];
      expect(quoteBox.height).toBeGreaterThanOrEqual(44);
      expect(callBox.height).toBe(quoteBox.height);
      expect(callBox.y, 'Call sits beside Request a quote on a desktop').toBe(quoteBox.y);
      await expect(main.getByRole('button', { name: /add|quote/i })).toHaveCount(0);
      await expect(main.locator('input, select, form')).toHaveCount(0);
      await expect(main).not.toContainText(/add (this service )?to (your )?quote/i);

      // Cross-links: the machinery page, the industries page, and the other services by their short teaser
      await expect(main.locator('a[href="/our-machinery/"]')).toHaveCount(1);
      await expect(main.locator('a[href="/industries/food-processing-agriculture/"]')).toHaveCount(1);
      for (const other of SERVICES.filter((o) => o.id !== s.id)) {
        const card = main.locator(`a.card[href="/services/${other.id}/"]`);
        await expect(card.getByRole('heading')).toHaveText(other.title);
        await expect(card).toContainText(frontMatter(other.id, 'teaser'));
      }

      expect(text).not.toMatch(UNCONFIRMED);
      expect(text).not.toMatch(OLD_SPELLING);
      expect(await page.locator('meta[name="description"]').getAttribute('content')).not.toMatch(OLD_SPELLING);

      await quote.click();
      await expect(page).toHaveURL(new RegExp(`/quote/\\?service=${s.id}#details$`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }

  test('the services hub and the industries page show each service by its one-sentence teaser, not its full summary', async ({ page }) => {
    for (const s of SERVICES) {
      const teaser = frontMatter(s.id, 'teaser');
      expect(teaser, `${s.id}: one plain sentence`).toMatch(/^[A-Z][^.!?]+\.$/);
      expect(teaser.length).toBeLessThanOrEqual(120);
    }
    for (const url of ['/services/', '/industries/food-processing-agriculture/']) {
      await page.goto(url);
      const main = page.getByRole('main');
      const text = await mainText(page);
      for (const s of SERVICES) {
        const card = main.locator(`a[href="/services/${s.id}/"]`);
        await expect(card, url).toHaveCount(1);
        await expect(card.getByRole('heading'), url).toHaveText(s.title);
        await expect(card, url).toContainText(frontMatter(s.id, 'teaser'));
        expect(times(text, frontMatter(s.id, 'summary')), `${url}: the ${s.id} summary`).toBe(0);
      }
      expect(text, url).not.toMatch(UNCONFIRMED);
      expect(text, url).not.toMatch(OLD_SPELLING);
      expect(await page.locator('meta[name="description"]').getAttribute('content'), url).not.toMatch(OLD_SPELLING);
      // the band's quote link is the page's quote action: red
      await expect(main.locator('.cta-band a[href="/quote/"]'), url).toHaveClass(/btn--red/);
    }

    // industries page: the title has its comma, and a visitor whose part is not listed is sent to the part request form
    expect(await page.title()).toContain('Salinas, CA');
    const main = page.getByRole('main');
    if (shopOn) {
      const line = main.locator('.not-listed');
      await expect(line).toContainText(configString('madeTo').replace(/^Made/, 'made'));
      await expect(line).toContainText(configString('replyTime'));
      await expect(line.getByRole('link', { name: 'Send us the part number' })).toHaveAttribute('href', '/shop/#request');
      await expect(main).toContainText(/C&M number: \S/); // a space before the first section link
    } else {
      await expect(main.locator('a[href^="/shop"]')).toHaveCount(0);
    }
  });

  test('/our-machinery/ links each machine to the service it performs and back, and fetches its first photo first', async ({ page }) => {
    await page.goto('/our-machinery/');
    const serviceOf: Record<string, string> = {
      'sharp-22120b-lathe': 'machining',
      'cnc-vertical-milling-machine': 'machining',
      'tb-2060vs-cnc-turning': 'machining',
      'flow-mach-500-waterjet': 'cutting',
      'fiber-laser-cutting-system': 'cutting',
    };
    await expect(page.locator('.machine')).toHaveCount(Object.keys(serviceOf).length);
    for (const [machine, service] of Object.entries(serviceOf)) {
      const link = page.locator(`#${machine} a[href^="/services/"]`);
      await expect(link, machine).toHaveCount(1);
      await expect(link, machine).toHaveAttribute('href', `/services/${service}/`);
      await expect(link, machine).toContainText(SERVICES.find((s) => s.id === service)!.heading);
    }

    // The first photo is the page's largest element: eager and high priority; the others wait until they are scrolled to
    const photos = page.locator('.machine img');
    await expect(photos.first()).toHaveAttribute('loading', 'eager');
    await expect(photos.first()).toHaveAttribute('fetchpriority', 'high');
    for (const photo of (await photos.all()).slice(1)) {
      await expect(photo).toHaveAttribute('loading', 'lazy');
      await expect(photo).not.toHaveAttribute('fetchpriority', 'high');
    }

    const text = await mainText(page);
    expect(text).not.toMatch(/exceptional|state-of-the-art|indispensable|cornerstone|seamlessly/i);
    expect(text).not.toMatch(UNCONFIRMED);
    expect(text).toContain('60,000 PSI'); // the facts stay

    // and back: a service page links to its machines, at anchors that exist
    for (const service of ['cutting', 'machining']) {
      await page.goto(`/services/${service}/`);
      const back = page.getByRole('main').locator('a[href^="/our-machinery/#"]');
      const expected = Object.keys(serviceOf).filter((m) => serviceOf[m] === service).map((m) => `/our-machinery/#${m}`);
      expect((await back.evaluateAll((els) => els.map((el) => el.getAttribute('href')))).sort(), service).toEqual(expected.sort());
    }
    await page.getByRole('main').getByRole('link', { name: 'Sharp 22120B Lathe' }).click();
    await expect(page).toHaveURL(/\/our-machinery\/#sharp-22120b-lathe$/);
    await expect(page.locator('#sharp-22120b-lathe')).toBeInViewport();
  });

  test('/about/ links to the services and the machinery, drops the unconfirmed claims and loads the office photo lazily', async ({ page }) => {
    await page.goto('/about/');
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: /^See our services/ })).toHaveAttribute('href', '/services/');
    await expect(main.getByRole('link', { name: /^See our machinery/ })).toHaveAttribute('href', '/our-machinery/');
    await expect(main.locator('.intro img')).toHaveAttribute('loading', 'lazy');
    const text = await mainText(page);
    expect(text).not.toMatch(UNCONFIRMED);
    expect(text).not.toMatch(OLD_SPELLING);
    expect(text).toContain('waterjet cutting, laser cutting, and shearing');
  });

  test('the business JSON-LD and llms.txt spell waterjet as one word and name no unconfirmed material', async ({ page, request }) => {
    await page.goto('/services/');
    const business = (await jsonLd(page)).find((d) => d['@type'] === 'LocalBusiness');
    expect(JSON.stringify(business)).not.toMatch(OLD_SPELLING);
    expect(business.knowsAbout).toContain('Waterjet cutting');
    expect(business.description).toContain('waterjet and laser cutting');
    const llms = await (await request.get('/llms.txt')).text();
    expect(llms).not.toMatch(OLD_SPELLING);
    expect(llms).not.toMatch(UNCONFIRMED);
    for (const s of SERVICES) expect(llms).toContain(`- [${s.title}](${SITE_ORIGIN}/services/${s.id}/): ${frontMatter(s.id, 'summary')}`);
  });

  test('the 404 page offers the services, a quote and the phone, and the part search only with the shop on', async ({ page, request }) => {
    // Any unknown address answers 404 with this page. The checks below load it at /404.html (status 200),
    // because Chromium reports a 404 document as a console error and the page fixture fails on those.
    const missing = await request.get('/no-such-page/');
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain('Page not found');

    await page.goto('/404.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

    const main = page.getByRole('main');
    const quote = main.getByRole('link', { name: 'Get a Quote', exact: true });
    await expect(quote).toHaveAttribute('href', '/quote/');
    await expect(quote).toHaveClass(/btn--red/);
    await expect(main.getByRole('link', { name: 'Our services', exact: true })).toHaveAttribute('href', '/services/');
    await expect(main.getByRole('link', { name: `Call ${configString('phone')}` })).toHaveAttribute('href', `tel:${configString('phoneE164')}`);
    // For a visitor who was looking for a part: the facts in src/config/site.ts, and the part request form
    await expect(main).toContainText(configString('madeTo').replace(/^Made/, 'made'));
    await expect(main).toContainText(configString('replyTime'));
    const send = main.getByRole('link', { name: 'Send us the part number' });

    // The meta description says what the page offers
    const description = (await page.locator('meta[name="description"]').getAttribute('content'))!;
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description).toMatch(/services/);
    expect(description).toMatch(/request a quote/);
    expect(description).toContain(configString('phone'));

    const search = main.getByRole('search');
    if (shopOn) {
      expect(description).toMatch(/search parts by number/i);
      await expect(main.getByRole('link', { name: 'Browse parts', exact: true })).toHaveAttribute('href', '/shop/');
      await expect(send).toHaveAttribute('href', '/shop/#request');
      // the same plain GET form as the home page hero: the shop page runs the search
      await search.getByLabel('Search by OEM or C&M part number').fill(PART);
      await search.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/shop/\\?q=${PART}$`));
      const visibleRows = page.locator('[data-rows] > li.prow:not([hidden])');
      await expect(visibleRows).toHaveCount(1);
      await expect(visibleRows.first()).toContainText(PART);
    } else {
      expect(description).not.toMatch(/search|parts/i);
      await expect(search).toHaveCount(0);
      await expect(main.locator('a[href^="/shop"]')).toHaveCount(0);
      await expect(send).toHaveAttribute('href', '/quote/#cant-find');
    }
  });

  test('/how-to-order/ quotes the form choices with straight quotes', async ({ page }) => {
    await page.goto('/how-to-order/');
    const text = await mainText(page);
    expect(text).toContain('"ASAP / rush", "This week", "2–4 weeks" or "Flexible"');
    expect(text).not.toMatch(/[“”]/);
  });

  test('the privacy page says what the code does: no tracking cookies, the quote list in the browser, delivery by Cloudflare', async ({ page }) => {
    await page.goto('/privacy/');
    const main = page.getByRole('main');
    await expect(main).toContainText('sets no analytics or advertising cookies');
    await expect(main).toContainText('"Do Not Track" signal');
    await expect(main).toContainText("kept in your own browser's storage");
    await expect(main).toContainText('delivered by Cloudflare');
    await expect(main).toContainText('IP address');
    // the owner's open points (an effective date, a retention period) are a code comment, not page text
    await expect(main).not.toContainText(/CONFIRM|effective date|retention/i);
    // and the page keeps its word: it sets no cookie (a request to any other host fails the test in the page fixture)
    await page.waitForLoadState('networkidle');
    expect(await page.context().cookies()).toEqual([]);
  });

  test('the changed pages fit a phone without sideways scrolling, with the service buttons stacked full width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const url of ['/services/', '/services/cutting/', '/services/metal-work/', '/our-machinery/', '/about/', '/privacy/', '/404.html']) {
      await page.goto(url);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), url).toBeLessThanOrEqual(0);
    }
    await page.goto('/services/machining/');
    const boxes = await page.locator('.service__actions .btn').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    expect(boxes).toHaveLength(2);
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
    expect(boxes[0].width).toBe(boxes[1].width);
    expect(boxes[0].width).toBeGreaterThan(280);
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

test.describe('chrome: header buttons, print, short screens and reduced motion', () => {
  const header = (page: Page) => page.locator('header.site-header');
  const saveOneLine = (page: Page) =>
    page.evaluate(() =>
      localStorage.setItem('quote-list-v2', JSON.stringify({ ref: 'Q-261110-TEST', items: [{ key: 'x', id: 'x', title: 'Test line', qty: 1, kind: 'service' }] })),
    );

  test('desktop: one coloured button, "Get a Quote" when the list is empty and "Quote list" with the count when it is not', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/about/');
    const quote = header(page).locator('.cart-btn');
    await expect(quote).toBeVisible();
    await expect(header(page).getByRole('link', { name: 'Get a Quote', exact: true })).toBeVisible();
    await expect(header(page).locator('.shop-btn')).toBeHidden(); // the nav link is enough
    if (shopOn) await expect(page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Parts', exact: true })).toBeVisible();
    const empty = await quote.boundingBox();

    await saveOneLine(page);
    await page.reload();
    await expect(quote).toHaveAttribute('data-quote-has-items', 'true');
    await expect(header(page).getByRole('link', { name: 'Quote list 1', exact: true })).toBeVisible();
    await expect(quoteBadge(page)).toHaveText('1');
    expect((await quote.boundingBox())!.width, 'the button keeps its width').toBe(empty!.width);
  });

  test('a saved list is flagged before first paint, so the header word is right before quote-store runs', async ({ page }) => {
    await page.goto('/about/');
    await saveOneLine(page);
    // Empty the bundled scripts, so quote-store never runs: only public/quote-early.js may set the state.
    await page.route('**/_astro/*.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-quote', 'filled');
    await expect(header(page).locator('.cart-btn')).toHaveAttribute('data-quote-has-items', '');
    await expect(header(page).locator('.cart-btn .qlabel__full')).toBeVisible();
    await expect(header(page).locator('.cart-btn .qlabel__empty')).toBeHidden();
  });

  test('phones: no quote button in the header, a labelled Parts button and the menu link names the list', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/about/');
    await expect(header(page).locator('.cart-btn')).toBeHidden();
    await expect(page.locator('.mobile-bar').getByRole('link', { name: 'Get a Quote' })).toBeVisible();
    const parts = header(page).locator('.shop-btn');
    if (shopOn) {
      await expect(parts).toBeVisible();
      await expect(parts).toHaveText('Parts');
      await expect(parts).toHaveClass(/btn--outline/);
    } else await expect(parts).toHaveCount(0);

    await page.getByRole('button', { name: 'Menu' }).click();
    const menu = page.getByRole('navigation', { name: 'Main mobile' });
    await expect(menu.getByRole('link', { name: 'Get a Quote', exact: true })).toBeVisible();
    if (shopOn) await expect(menu.getByRole('link', { name: 'Parts', exact: true })).toHaveAttribute('href', '/shop/');

    await saveOneLine(page);
    await page.reload();
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(menu.getByRole('link', { name: 'Quote list (1)', exact: true })).toBeVisible();
  });

  test('the footer parts column is labelled Parts and goes with the shop', async ({ page }) => {
    await page.goto('/');
    const column = page.locator('footer').getByRole('navigation', { name: 'Parts', exact: true });
    if (shopOn) await expect(column.getByRole('link', { name: 'Parts catalog' })).toHaveAttribute('href', '/shop/');
    else await expect(column).toHaveCount(0);
    await expect(page.locator('footer .cta .btn--red')).toHaveCount(1);
    await expect(page.locator('footer').locator('.btn--dark, .btn--light')).toHaveCount(0);
  });

  test('print hides the header, bars, footer band and buttons and keeps the content on white', async ({ page, request }) => {
    const urls = ['/quote/'];
    if (shopOn) urls.push((await findPart(request)).u);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of urls) {
      await page.goto(url);
      await page.emulateMedia({ media: 'print' });
      for (const sel of ['.site-header', '.storebar', '.mobile-bar', '.addbar', 'main .btn']) {
        for (const el of await page.locator(sel).all()) await expect(el, `${url} ${sel}`).toBeHidden();
      }
      await expect(page.locator('body')).toHaveCSS('background-image', 'none');
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (url !== '/quote/') await expect(page.locator('.ident__oem')).toBeVisible();
      await page.emulateMedia({ media: 'screen' });
    }
  });

  for (const size of [
    { width: 320, height: 256 },
    { width: 844, height: 390 },
  ]) {
    test(`short screens (${size.width}x${size.height}): the header and the bottom bar scroll with the page`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/about/');
      await expect(page.locator('.site-header')).toHaveCSS('position', 'static');
      await expect(page.locator('.mobile-bar')).toHaveCSS('position', 'static');
      await expect(page.locator('body')).toHaveCSS('padding-bottom', '0px');
      await expect(page.locator('html')).toHaveCSS('scroll-padding-top', 'auto');
    });
  }

  test('reduced motion: no transitions and no smooth scrolling', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/industries/food-processing-agriculture/');
    await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
    await expect(page.locator('.card').first()).toHaveCSS('transition-duration', '0s');
  });
});

test.describe('shared pages follow the parts shop switch', () => {
  test('llms.txt and the footer list the number index and the CSV only with the shop on', async ({ page, request }) => {
    const llms = await (await request.get('/llms.txt')).text();
    await page.goto('/');
    const shopColumn = page.locator('footer').getByRole('navigation', { name: 'Parts' });
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
