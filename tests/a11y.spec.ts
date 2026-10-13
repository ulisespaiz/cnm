import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Guards for the accessibility fixes (see /accessibility/ and README "Privacy policy and accessibility statement").
// They read the production build served by `astro preview` and send nothing anywhere: any request that leaves the
// local server is blocked, and no form is submitted.

const shopOn = existsSync('dist/shop/index.html');
const LOCAL_ORIGIN = `http://127.0.0.1:${Number(process.env.PW_PORT) || 4321}`; // same default as playwright.config.ts
const PART = '/shop/vffs/platen/03026d2836-platen-body-sii-5cr/';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === LOCAL_ORIGIN ? route.fallback() : route.abort()));
});

test('layout breakpoints are in em, so a larger default text size gets the phone layout', () => {
  const dir = 'dist/_astro';
  const css = readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
    .join('\n');
  expect(css.length).toBeGreaterThan(1000);
  // `(min-width: 768px)`, `(max-width:767px)` and the range form `(width >= 768px)`
  const px = css.match(/@media[^{]*(?:(?:min|max)-width\s*:\s*\d+(?:\.\d+)?px|width\s*[<>]=?\s*\d+(?:\.\d+)?px)/g) ?? [];
  expect(px, 'width media queries written in px').toEqual([]);
  expect(css).not.toMatch(/body\s*\{[^}]*overflow-x\s*:\s*hidden/);
});

test('the phone menu makes the page behind it inert, and a tap outside only closes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/');
  const behind = () => page.evaluate(() => ['main', 'footer', '.mobile-bar'].map((s) => document.querySelector<HTMLElement>(s)!.inert));
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('#mobile-menu')).toBeVisible();
  expect(await behind()).toEqual([true, true, true]);

  await page.mouse.click(200, 800); // on the page under the menu: closes it, does not follow a link there
  await expect(page.locator('#mobile-menu')).toBeHidden();
  expect(await behind()).toEqual([false, false, false]);
  expect(new URL(page.url()).pathname).toBe('/about/');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobile-menu')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
  expect(await behind()).toEqual([false, false, false]);
});

test('the current page is underlined in the menu, not only colored', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/about/');
  const current = page.locator('.nav-desktop a[aria-current="page"]');
  await expect(current).toHaveText('About');
  await expect(current).toHaveCSS('text-decoration-line', 'underline');
});

test('every form says what the asterisk means', async ({ page }) => {
  for (const url of ['/contact/', '/quote/']) {
    await page.goto(url);
    const note = page.locator('.quote-form .req-note').first();
    await expect(note, url).toBeVisible();
    await expect(note, url).toHaveText('* Required');
  }
});

test('the footer hours never print over each other when text is spaced out (WCAG 1.4.12)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/contact/');
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }' });
  const rows = page.locator('.hours > div');
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    const day = (await rows.nth(i).locator('dt').boundingBox())!;
    const time = (await rows.nth(i).locator('dd').boundingBox())!;
    const overlap = Math.min(day.x + day.width, time.x + time.width) > Math.max(day.x, time.x) && Math.min(day.y + day.height, time.y + time.height) > Math.max(day.y, time.y) + 1;
    expect(overlap, `hours row ${i}`).toBe(false);
  }
});

test('no page is wider than a 320px screen, and a very short window keeps the header out of the way', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const url of ['/', '/about/', '/contact/', '/how-to-order/', '/quote/', ...(shopOn ? ['/shop/', PART] : [])]) {
    await page.goto(url);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${url} at 320px`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 320, height: 256 }); // 400% zoom on a 1280 x 1024 window
  await page.goto('/about/');
  await expect(page.locator('.site-header')).toHaveCSS('position', 'relative');
});

test.describe('parts shop', () => {
  test.skip(!shopOn, 'the parts shop is off in this build');

  test('the Add to Quote label stays inside its button at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(PART);
    const button = (await page.locator('.addbar .padd__add').boundingBox())!;
    const label = (await page.locator('.addbar .padd__add [data-add-label]').boundingBox())!;
    expect(label.x).toBeGreaterThanOrEqual(button.x - 0.5);
    expect(label.x + label.width).toBeLessThanOrEqual(button.x + button.width + 0.5);
  });

  test('the Add button\'s accessible name follows its visible text while it reads "Added" (WCAG 2.5.3)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(PART);
    const add = page.locator('.part__add [data-add]');
    await expect(add).toHaveAttribute('aria-label', 'Add to Quote: 03026D2836');
    await add.click();
    await expect(add.locator('[data-add-label]')).toHaveText('✓ Added');
    await expect(add).toHaveAttribute('aria-label', 'Added: 03026D2836'); // contains the visible word "Added"
    await expect(add.locator('[data-add-label]')).toHaveText('Add to Quote', { timeout: 4000 });
    await expect(add).toHaveAttribute('aria-label', 'Add to Quote: 03026D2836');
  });

  test('the parts list on the shop home has a skip link that lands after it, and part names are underlined at rest', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/shop/');
    const skip = page.locator('.shop__skip');
    await expect(skip).toHaveText('Skip the parts list');
    // hidden (but focusable) until it has focus
    expect((await skip.boundingBox())!.width).toBeLessThanOrEqual(2);
    await skip.focus();
    expect((await skip.boundingBox())!.width).toBeGreaterThan(40);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#request$/);
    await page.keyboard.press('Tab');
    // the next stop is in the part request form, after the list, not in the rows
    expect(await page.evaluate(() => !!document.activeElement?.closest('#request'))).toBe(true);
    await expect(page.locator('.prow__name').first()).toHaveCSS('text-decoration-line', 'underline');
  });

  test('the search field has a solid focus ring, not a faint one (WCAG 1.4.11)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/shop/');
    await page.locator('#psearch-hero-input').click();
    await expect(page.locator('#psearch-hero-input')).toHaveCSS('outline-color', 'rgb(25, 60, 184)');
    await expect(page.locator('#psearch-hero-input')).toHaveCSS('outline-style', 'solid');
  });

  test('the quantity buttons and the copy button announce their result once, in a region that exists from the start', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(PART);
    const status = page.locator('#sr-status');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveText('');
    await page.locator('.part__add [data-step="1"]').click();
    await page.locator('.part__add [data-step="1"]').click();
    await expect(status).toHaveText('Quantity 3');
    await expect(page.locator('.ident__row .copybtn')).toHaveAttribute('aria-label', /^Copy OEM part number 03026D2836$/);
  });

  test('the search count is spoken after typing pauses, not on every key', async ({ page }) => {
    await page.goto('/shop/');
    const field = page.locator('#psearch-hero-input');
    await field.click();
    await page.keyboard.type('0318', { delay: 60 });
    await expect(page.locator('[data-ps-status]').first()).toHaveText('');
    await expect(page.locator('[data-ps-status]').first()).toHaveText(/\d+ results?/);
  });

  test('the OEM index drops its table, not just its rows, when nothing matches', async ({ page }) => {
    await page.goto('/shop/part-numbers/');
    await page.locator('#pn-filter').fill('zzqqxx');
    await expect(page.locator('[data-pn-empty]')).toBeVisible();
    await expect(page.locator('#pn-table')).toBeHidden();
    await page.locator('#pn-filter').fill('0318');
    await expect(page.locator('#pn-table')).toBeVisible();
  });

  test('a filter option reads as its label, then its count and the word parts', async ({ page }) => {
    await page.goto('/shop/vffs/platen/');
    const option = page.locator('.filters__opt').first();
    expect(squash(await option.textContent())).toMatch(/, \d+ parts?$/);
  });
});

const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
