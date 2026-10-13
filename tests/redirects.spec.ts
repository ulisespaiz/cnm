import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// public/_redirects checks that need no browser. astro preview does not apply _redirects, so the rules
// are read as data: the old catalog path must move to /shop/vffs/ (with the rest of the path carried
// over), renamed part ids must point straight at their final URL, and nothing may point at a part
// page that does not exist. With the shop off, dist/_redirects must send all of it to /quote/ (302).

interface Rule {
  from: string;
  to: string;
  status: number;
  line: number;
}

function rulesOf(file: string): Rule[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((text, i) => {
      const [from, to, status = '301'] = text.trim().split(/\s+/);
      return !text.trim() || text.trim().startsWith('#') || !to ? [] : [{ from, to, status: Number(status), line: i + 1 }];
    });
}

const shopOn = existsSync('dist/shop/index.html');
const source = rulesOf('public/_redirects');
const parts: { id: string; section: string; machine: string }[] = JSON.parse(readFileSync('src/content/parts.json', 'utf8'));
const partUrls = new Set(parts.map((p) => `/shop/${p.machine}/${p.section}/${p.id}/`));

// the rule that moves the whole old catalog path to /shop/vffs/
const splat = source.find((r) => r.to === '/shop/vffs/:splat');

test.describe('public/_redirects', () => {
  test('the old catalog path moves to /shop/vffs/ with a 301, keeping the rest of the path', () => {
    expect(splat, 'a rule to /shop/vffs/:splat').toBeTruthy();
    expect(splat!.status).toBe(301);
    expect(splat!.from).toMatch(/^\/shop\/[a-z-]+-vffs\/\*$/);
    const base = splat!.from.replace(/\/\*$/, '');
    for (const from of [base, `${base}/`]) {
      const rule = source.find((r) => r.from === from);
      expect(rule, `a rule for ${from}`).toMatchObject({ to: '/shop/vffs/', status: 301 });
    }
  });

  test('renamed part pages go straight to their final URL, before the wildcard', () => {
    const base = splat!.from.replace(/\*$/, '');
    const specific = source.filter((r) => r.from.startsWith(base) && r.from !== base && !r.from.includes(':'));
    expect(specific.length, 'rules for renamed part ids').toBeGreaterThanOrEqual(4);
    for (const rule of specific.filter((r) => r !== splat)) {
      expect(rule.line, `${rule.from} must come before the wildcard`).toBeLessThan(splat!.line);
      expect(rule.status).toBe(301);
      expect(partUrls.has(rule.to), `${rule.from} -> ${rule.to} is a real part page`).toBe(true);
    }
  });

  test('old section and part URLs without a trailing slash get one 301 (placeholder rules before the wildcard)', () => {
    const base = splat!.from.replace(/\*$/, '');
    const rules = [
      { from: `${base}:section/:slug`, to: '/shop/vffs/:section/:slug/' },
      { from: `${base}:section`, to: '/shop/vffs/:section/' },
    ];
    for (const want of rules) {
      const rule = source.find((r) => r.from === want.from);
      expect(rule, `a rule for ${want.from}`).toMatchObject({ to: want.to, status: 301 });
      expect(rule!.line, `${want.from} must come before the wildcard`).toBeLessThan(splat!.line);
    }
    // the renamed ids (rules with no placeholder) come first, so they keep their one-hop 301 to the final URL
    const placeholderLine = source.find((r) => r.from === rules[0].from)!.line;
    const renamed = source.filter((r) => r.from.startsWith(base) && r !== splat && !r.from.includes(':'));
    for (const rule of renamed) expect(rule.line, `${rule.from} must come before the placeholders`).toBeLessThan(placeholderLine);
  });

  test('no rule points at the old catalog path or at a page that does not exist', () => {
    const base = splat!.from.replace(/\/\*$/, '');
    for (const rule of source) {
      expect(rule.to, rule.from).not.toContain(base);
      if (!rule.to.startsWith('/shop/') || rule.to.includes(':')) continue;
      if (rule.to === '/shop/' || rule.to === '/shop/vffs/') continue;
      expect(partUrls.has(rule.to), `${rule.from} -> ${rule.to}`).toBe(true);
    }
  });

  test('with the shop off, every shop rule in dist/_redirects is a 302 to /quote/', () => {
    test.skip(shopOn || !existsSync('dist/_redirects'), 'the parts shop is on in this build');
    const built = rulesOf('dist/_redirects');
    const base = splat!.from.replace(/\*$/, '');
    for (const from of [splat!.from, `${base}:section/:slug`, `${base}:section`, '/shop', '/shop/*']) {
      expect(built.find((r) => r.from === from), from).toMatchObject({ to: '/quote/', status: 302 });
    }
    for (const rule of built) expect(rule.to, `${rule.from} must not name a shop page`).not.toMatch(/^\/shop/);
  });
});
