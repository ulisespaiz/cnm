import { expect, test, type Page } from '@playwright/test';

// The shop's machines come from one list (src/content/equipment.json). These tests check that the pages that
// show them agree, that no machine claim the photos do not support came back, and the phone layout of the
// home page machine gallery. They read the production build served by `astro preview` and send nothing
// anywhere: any request that leaves the local server is blocked.

const LOCAL_ORIGIN = `http://127.0.0.1:${Number(process.env.PW_PORT) || 4321}`; // same default as playwright.config.ts

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === LOCAL_ORIGIN ? route.fallback() : route.abort()));
});

const SERVICES = ['cutting', 'machining', 'metal-work', 'custom-fabrication'];

// Wording that is not backed by the shop's photos or the owner, removed on purpose. Case-insensitive.
const BANNED = [
  'Mach 500',
  'TB-2060',
  '60,000',
  /\bPSI\b/i,
  'state-of-the-art',
  'best tools',
  'flawless',
  'eco-friendly',
  'unmatched',
  'Large Work Capacity',
  'FANUC',
  'every deadline',
  'no compromises',
  'ahead of industry standards',
];

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

async function jsonLd(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((b) => {
    const data = JSON.parse(b);
    return Array.isArray(data) ? data : data['@graph'] ?? [data];
  });
}

test.describe('one machine list', () => {
  test('the home page cards, the "Key machines" count and /our-machinery/ list the same 5 machines', async ({ page }) => {
    await page.goto('/our-machinery/');
    const machinery = (await page.locator('article.machine h2').allTextContents()).map(squash);
    expect(machinery).toEqual([
      'Akira-Seiki Performa CNC Vertical Machining Center',
      'Sharp 22120B Engine Lathe',
      'Flow Mach 3 4020b Waterjet',
      'Fiber Laser Cutting System',
      'Timesavers 32 RB Series Wide-Belt Finishing Machine',
    ]);

    await page.goto('/');
    const cards = (await page.locator('.gallery li h3').allTextContents()).map(squash);
    expect(cards, 'one home card per machine, in the same order').toEqual(machinery);
    const stat = page.locator('.stats div', { has: page.locator('dt', { hasText: 'Key machines' }) }).locator('dd');
    await expect(stat).toHaveText(String(machinery.length));
  });

  test('the hero banner and the machine cards use different photos, and every machine card has its photo', async ({ page }) => {
    await page.goto('/');
    const photoName = (selector: string) =>
      page.locator(selector).evaluateAll((imgs) =>
        imgs.map((img) => {
          const name = new URL((img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src).pathname.split('/').pop() ?? '';
          return name.split('.')[0]; // "our-work-2" from "our-work-2.5p1LuBaZ_Z1uoLkV.webp"
        }),
      );
    const banner = await photoName('.banner img');
    const cards = await photoName('.gallery li img');
    expect(cards, 'one photo per machine card').toHaveLength(5);
    expect(new Set(cards).size, `a card photo repeats: ${cards.join(', ')}`).toBe(cards.length);
    expect(cards, 'the banner photo is not also a card').not.toContain(banner[0]);
  });

  test('llms.txt, the machinery page and the service pages name the same machines', async ({ request }) => {
    const llms = await (await request.get('/llms.txt')).text();
    const equipment = llms.split('## Equipment')[1].split('\n## ')[0];
    const lines = equipment.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(5);
    for (const name of ['Akira-Seiki Performa', 'Sharp 22120B', 'Flow Mach 3 4020b', 'Fiber Laser', 'Timesavers 32 RB Series']) {
      expect(equipment, name).toContain(name);
    }

    const machining = await (await request.get('/services/machining/')).text();
    expect(machining).toContain('Akira-Seiki Performa');
    expect(machining).toContain('Sharp 22120B');
    const cutting = await (await request.get('/services/cutting/')).text();
    expect(cutting).toContain('Flow Mach 3 4020b');
  });

  test('no removed machine or claim comes back on any page that shows machines', async ({ request }) => {
    const paths = ['/', '/about/', '/our-machinery/', '/services/', '/llms.txt', ...SERVICES.map((s) => `/services/${s}/`)];
    for (const path of paths) {
      const response = await request.get(path);
      expect(response.ok(), path).toBe(true);
      const body = await response.text();
      for (const banned of BANNED) {
        const found = typeof banned === 'string' ? body.toLowerCase().includes(banned.toLowerCase()) : banned.test(body);
        expect(found, `${path} contains ${banned}`).toBe(false);
      }
    }
  });
});

test.describe('home page copy', () => {
  test('the services FAQ names the four services, in sync with the FAQPage JSON-LD', async ({ page }) => {
    await page.goto('/');
    const item = page.locator('details.faq', { has: page.locator('summary', { hasText: 'What services do you offer?' }) });
    const answer = squash(await item.locator('p').innerText());
    for (const word of ['cutting', 'laser', 'water-jet', 'shearing', 'machining', 'metal work', 'welding', 'rolling', 'forming', 'custom fabrication']) {
      expect(answer.toLowerCase(), word).toContain(word);
    }
    const faq = (await jsonLd(page)).find((d) => d['@type'] === 'FAQPage');
    expect(faq, 'FAQPage JSON-LD').toBeTruthy();
    const ld = faq.mainEntity.find((e: { name: string }) => e.name === 'What services do you offer?');
    expect(squash(ld.acceptedAnswer.text)).toBe(answer);
    const visible = (await page.locator('details.faq summary').allTextContents()).map(squash);
    expect(faq.mainEntity.map((e: { name: string }) => squash(e.name))).toEqual(visible);
  });

  test('the Proof heading makes no delivery promise', async ({ page }) => {
    await page.goto('/');
    const heading = page.locator('section', { has: page.locator('.gallery') }).getByRole('heading', { level: 2 });
    await expect(heading).toContainText('exact specifications');
    await expect(heading).not.toContainText(/deadline/i);
  });
});

test.describe('phone layout at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the first machine card sits on the 16px gutter, also after the gallery snaps', async ({ page }) => {
    await page.goto('/');
    const gallery = page.locator('.gallery');
    await gallery.scrollIntoViewIfNeeded();
    const firstLeft = () => page.locator('.gallery li').first().evaluate((li) => Math.round(li.getBoundingClientRect().left));
    expect(await firstLeft()).toBe(16);

    // Scroll to the second card and back to the start: snapping must land on the gutter, not the screen edge
    await gallery.evaluate((el) => el.scrollTo({ left: 400 }));
    await gallery.evaluate((el) => el.scrollTo({ left: 0 }));
    await expect.poll(firstLeft).toBe(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal page scroll').toBe(true);
  });

  test('the hero headline does not leave a lone word on its last line', async ({ page }) => {
    await page.goto('/');
    const lastLineWords = await page.locator('.hero h1').evaluate((h1) => {
      const words: { top: number }[] = [];
      const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (const match of text.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index ?? 0);
          range.setEnd(node, (match.index ?? 0) + match[0].length);
          const rect = range.getClientRects()[0];
          if (rect) words.push({ top: Math.round(rect.top) });
        }
      }
      const last = Math.max(...words.map((w) => w.top));
      return words.filter((w) => w.top === last).length;
    });
    expect(lastLineWords, 'words on the last line of the h1').toBeGreaterThanOrEqual(2);
  });
});

test.describe('service pages and machinery page', () => {
  for (const slug of ['cutting', 'metal-work']) {
    test(`/services/${slug}/ shows each process once`, async ({ page }) => {
      await page.goto(`/services/${slug}/`);
      const headings = (await page.locator('main h2').allTextContents()).map(squash);
      expect(new Set(headings).size, `a heading repeats: ${headings.join(' | ')}`).toBe(headings.length);
    });
  }

  test('/our-machinery/ has a title of at most 60 characters and a meta description that is a sentence', async ({ page }) => {
    await page.goto('/our-machinery/');
    const title = await page.title();
    expect(title.length, title).toBeLessThanOrEqual(60);
    const description = (await page.locator('meta[name="description"]').getAttribute('content')) ?? '';
    expect(description).toMatch(/^[A-Z].*\b(runs|run|has|uses)\b.*\.$/);
    expect(description.length).toBeLessThanOrEqual(160);
  });
});
