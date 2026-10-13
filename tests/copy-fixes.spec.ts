import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Checks for the fixes that came out of the site scan: the header labels on a phone, the part page's closing line for a
// part with no OEM number, the thank-you page's reference line, one closing call to action per page, page-specific
// teasers on the "More services" cards, the machine copy, and the shop's section titles. They read the production
// build served by `astro preview` and send nothing anywhere: any request that leaves the local server is blocked.

const shopOn = existsSync('dist/shop/index.html');
const LOCAL_ORIGIN = `http://127.0.0.1:${Number(process.env.PW_PORT) || 4321}`; // same default as playwright.config.ts

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === LOCAL_ORIGIN ? route.fallback() : route.abort()));
});

const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

interface CatalogPart {
  id: string;
  machine: string;
  section: string;
  oem?: string;
  cm: string;
}
const catalog: CatalogPart[] = JSON.parse(readFileSync('src/content/parts.json', 'utf8'));
const partPath = (p: CatalogPart) => `/shop/${p.machine}/${p.section}/${p.id}/`;

test.describe('header on a phone', () => {
  for (const width of [360, 390]) {
    test(`shows a label under the Quote list and Shop icons at ${width}px, with no overlap and no sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/how-to-order/');
      const cart = page.locator('.cart-btn');
      await expect(cart.locator('.label-short')).toBeVisible();
      await expect(cart.locator('.label-short')).toHaveText('Quote');
      await expect(cart.locator('.label-long')).toBeHidden();
      const boxes = [(await cart.boundingBox())!];
      if (shopOn) {
        await expect(page.locator('.shop-btn__label')).toBeVisible();
        await expect(page.locator('.shop-btn__label')).toHaveText('Shop');
        boxes.push((await page.locator('.shop-btn').boundingBox())!);
      }
      boxes.push((await page.locator('.burger-btn').boundingBox())!);
      for (const box of boxes) {
        expect(box.width, 'a 44px tap target').toBeGreaterThanOrEqual(44);
        expect(box.height, 'a 44px tap target').toBeGreaterThanOrEqual(44);
      }
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].x, 'buttons do not overlap').toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'no horizontal scroll').toBeLessThanOrEqual(0);
    });
  }

  test('keeps the full names beside the icons on a wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.locator('.cart-btn .label-long')).toBeVisible();
    await expect(page.locator('.cart-btn .label-short')).toBeHidden();
    await expect(page.locator('.cart-btn')).toContainText(shopOn ? 'Quote list' : 'Get a Quote');
    if (shopOn) await expect(page.locator('.shop-btn')).toContainText('Shop');
  });

  test('uses one name for the list in the header, the menu and the ordering guide', async ({ page }) => {
    test.skip(!shopOn, 'the quote list is named only while the parts shop is on');
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/how-to-order/');
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.locator('#mobile-menu').getByRole('link', { name: /^Quote list/ })).toBeVisible();
    await expect(page.locator('main')).toContainText('The Quote list button in the header');
  });
});

test.describe('part pages', () => {
  test.skip(!shopOn, 'the parts shop is off in this build');

  test('a part with no OEM number tells the buyer to send a sample, print or photo, not to confirm a part number', async ({ page }) => {
    const none = catalog.filter((p) => !p.oem);
    expect(none.length).toBeGreaterThan(0);
    for (const p of none) {
      await page.goto(partPath(p));
      const fit = squash(await page.locator('.part__fit').textContent());
      expect(fit, p.cm).toContain('Send a sample, print or photo of the part with your quote');
      expect(fit, p.cm).not.toMatch(/confirm fitment by part number/i);
    }
    const own = catalog.find((p) => p.oem)!;
    await page.goto(partPath(own));
    await expect(page.locator('.part__fit')).toContainText('Confirm fitment by part number');
  });

  test('no description opens with an awkward sentence or says a size twice', async ({ request }) => {
    for (const p of catalog) {
      const text = (await (await request.get(partPath(p))).text()).replace(/<[^>]+>/g, ' ');
      expect(text, p.cm).not.toContain('it is quoted by');
    }
    const washer = catalog.find((p) => p.cm === 'CM-0131')!;
    const html = await (await request.get(partPath(washer))).text();
    expect(html).not.toContain('inside diameter)');
  });

  test('the shop section titles stay within 60 characters, and the eyebrows and headings use lower-case "packaging machines"', async ({ page }) => {
    const sections: { id: string }[] = JSON.parse(readFileSync('src/content/sections.json', 'utf8'));
    for (const url of ['/shop/vffs/', ...sections.map((s) => `/shop/vffs/${s.id}/`)]) {
      await page.goto(url);
      expect((await page.title()).length, `${url}: ${await page.title()}`).toBeLessThanOrEqual(60);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('VFFS packaging machines');
    }
    await page.goto(`/shop/vffs/${sections[0].id}/`);
    await expect(page.locator('main .eyebrow')).toHaveText('Replacement parts for VFFS packaging machines');
  });

  test('"Parts Store" is not repeated as a pill above the heading of the index and the machine hub', async ({ page }) => {
    for (const url of ['/shop/part-numbers/', '/shop/vffs/']) {
      await page.goto(url);
      await expect(page.locator('main .eyebrow', { hasText: /^Parts Store$/ }), url).toHaveCount(0);
    }
  });
});

test.describe('thank-you page', () => {
  test('shows the "keep your reference" line only when a reference is saved', async ({ page }) => {
    await page.goto('/quote/thanks/');
    await expect(page.locator('[data-ref-hint]')).toBeHidden();
    await expect(page.locator('[data-ref-box]')).toBeHidden();
    await page.evaluate(() => sessionStorage.setItem('last-quote-ref', 'CM-TEST-0001'));
    await page.reload();
    await expect(page.locator('[data-ref-hint]')).toBeVisible();
    await expect(page.locator('[data-ref-box]')).toContainText('CM-TEST-0001');
  });
});

test.describe('one closing call to action per page', () => {
  for (const path of ['/services/', '/service-areas/', '/our-machinery/', '/industries/food-processing-agriculture/']) {
    test(`${path} ends with the footer band only`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('main .cta-band')).toHaveCount(0);
      await expect(page.locator('footer .cta')).toHaveCount(1);
    });
  }
});

test.describe('services copy', () => {
  test('the "More services" cards carry a teaser that is not the summary shown on /services/', async ({ page }) => {
    await page.goto('/services/');
    const summaries = (await page.locator('.service-row__body p.muted').allTextContents()).map(squash);
    expect(summaries).toHaveLength(4);
    const h1 = squash(await page.getByRole('heading', { level: 1 }).textContent());
    expect(h1).toContain('Salinas');
    expect(h1).not.toMatch(/done right/i);
    expect(squash(await page.locator('main .lead').first().textContent())).toContain('since 2002');

    for (const slug of ['cutting', 'machining', 'metal-work', 'custom-fabrication']) {
      await page.goto(`/services/${slug}/`);
      const cards = (await page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'More services' }) }).locator('.card p').allTextContents()).map(squash);
      expect(cards, slug).toHaveLength(3);
      for (const text of cards) expect(summaries, `${slug}: "${text}" repeats a summary`).not.toContain(text);
      expect(new Set(cards).size).toBe(cards.length);
    }
  });

  test('a service page gives the drawing address next to the quote button', async ({ page }) => {
    await page.goto('/services/cutting/');
    await expect(page.locator('.service__quote').getByRole('link', { name: /@cmmachshop\.com$/ })).toHaveAttribute('href', /^mailto:/);
  });

  test('the service areas page names where the shop serves, not a bay', async ({ page }) => {
    await page.goto('/service-areas/');
    const title = await page.title();
    expect(title).not.toMatch(/bay/i);
    expect(title.length).toBeLessThanOrEqual(60);
    const description = (await page.locator('meta[name="description"]').getAttribute('content')) ?? '';
    expect(description.length).toBeLessThanOrEqual(155);
  });
});

test.describe('machine copy', () => {
  test('/our-machinery/ names no feature the photos do not show and does not claim to list every machine', async ({ page }) => {
    await page.goto('/our-machinery/');
    const text = squash(await page.locator('main').textContent());
    expect(text).not.toMatch(/shuttle|DXF|tapping|These are the \d+ machines/i);
    const laser = page.locator('article.machine', { has: page.getByRole('heading', { name: 'Fiber Laser Cutting System' }) });
    await expect(laser).toContainText('Slatted cutting table');
    await expect(laser).toContainText('Dust collection');
    const mill = page.locator('article.machine', { has: page.getByRole('heading', { name: /Akira-Seiki Performa/ }) });
    await expect(mill).toContainText('Milling');
    await expect(mill).toContainText('Drilling');
    await expect(mill).not.toContainText(/taps|boring/i);
  });

  test('the home page and About say "Since 2002", never "Founded", and the footer spells out Agriculture', async ({ page }) => {
    await page.goto('/');
    const text = squash(await page.locator('main').textContent());
    expect(text).not.toMatch(/\bFounded\b/);
    await expect(page.locator('main .eyebrow').first()).toContainText('Since 2002');
    await expect(page.locator('footer').getByRole('link', { name: 'Food Processing & Agriculture' })).toBeVisible();
    await page.goto('/about/');
    expect(squash(await page.locator('main').textContent())).not.toMatch(/Our shop runs \d+ machines/);
  });
});
