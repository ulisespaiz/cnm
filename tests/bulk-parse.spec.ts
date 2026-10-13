import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { buildMatcher, parseBulk, type IndexRecord, type MatchedLine } from '../src/scripts/bulk-parse';

// Unit-level checks for the bulk-paste parser (src/scripts/bulk-parse.ts, no DOM) against the real
// built search index. No browser is used. The parser must stay brand-agnostic: a customer may type a
// maker's name or "OEM" in front of a part number, and no maker's name is listed in the code. These
// tests use a made-up word ("acmeco") to prove it works for any word.

const indexFile = 'dist/shop/search-index.json';
const shopOn = existsSync(indexFile);
const NOISE = 'acmeco';

test.describe('bulk paste parser', () => {
  test.skip(!shopOn, 'the parts shop is off in this build');

  const index: IndexRecord[] = shopOn ? JSON.parse(readFileSync(indexFile, 'utf8')) : [];
  const matcher = buildMatcher(index);
  const idOf = (text: string) => matcher.find(text)?.i;
  const gear = '10097a2083-gear-spur'; // OEM 10097A2083, CM-0111

  test('finds a part by its number however it is typed', () => {
    for (const text of ['10097A2083', '10097-A2083', '10097 A2083', 'OEM# 10097A2083', 'oem 10097-A2083', 'P/N 10097A2083', 'cm-0111', 'CM 111']) {
      expect(idOf(text), text).toBe(gear);
    }
    expect(idOf('3186D0379')?.startsWith('03186d0379'), 'without the leading zero').toBe(true);
    expect(matcher.find('030487C3142')?.o, 'a typo kept in oemAlt').toBe('03487B2446');
  });

  test('ignores a word in front of a number, whatever the word is', () => {
    for (const text of [`${NOISE} 10097A2083`, `${NOISE} OEM# 10097A2083`, `${NOISE}-10097A2083`, `${NOISE}: 10097 A2083`, `${NOISE} cm-0111`, 'Plastic 10097A2083']) {
      expect(idOf(text), text).toBe(gear);
    }
    expect(matcher.find(`${NOISE} 10097A2084`), 'a number that is not in the catalog stays unmatched').toBeNull();
    expect(matcher.find('10097A2084')).toBeNull();
  });

  test('finds a part by name, and skips only words no part uses', () => {
    expect(idOf('Gear Spur')).toBe(gear);
    expect(idOf(`${NOISE} Gear Spur`)).toBe(gear);
    // "Plate" is a word parts use, and "left" is how parts say LH, so neither may be dropped to make the name match
    expect(matcher.find('Plate Gear Spur')).toBeNull();
    expect(matcher.find('left Gear Spur')).toBeNull();
  });

  test('reads quantities and notes around a branded number', () => {
    const result = parseBulk([`${NOISE} 10097A2083 x2`, 'OEM# 10097A2083 3', `2 x ${NOISE} 10097A2083`, `${NOISE} 10097A2083, 4`, 'Rail guide, 03187A0897, 4'].join('\n'), matcher);
    expect(result.missing).toBe(0);
    expect(result.rows).toHaveLength(2);
    const [spur, rail] = result.rows as MatchedLine[];
    expect(spur.rec.i).toBe(gear);
    expect(spur.qty).toBe(2 + 3 + 2 + 4);
    expect(spur.lines).toEqual([1, 2, 3, 4]);
    expect(rail.rec.o).toBe('03187A0897');
    expect(rail.qty).toBe(4);
    expect(rail.note).toBe('Rail guide');
  });

  test('a trailing note stays a note', () => {
    const [row] = parseBulk(`${NOISE} 10097A2083 Rail guide`, matcher).rows as MatchedLine[];
    expect(row.rec.i).toBe(gear);
    expect(row.note).toBe('Rail guide');
  });

  test('a number that is not in the catalog is reported, not guessed', () => {
    const result = parseBulk(`${NOISE} 10097A2084 x2`, matcher);
    expect(result.matched).toBe(0);
    expect(result.rows[0]).toMatchObject({ kind: 'miss', qty: 2 });
  });

  test('an unmatched line keeps only the number as the part; the words around it become the note', () => {
    const miss = (line: string) => parseBulk(line, matcher).rows[0];
    // the word in front never becomes part of the saved text
    expect(miss(`${NOISE} 10097A9999 x2`)).toMatchObject({ kind: 'miss', text: '10097A9999', qty: 2, note: NOISE });
    expect(miss(`${NOISE}`)).toMatchObject({ kind: 'miss', text: NOISE });
    // a label word is not kept at all
    expect(miss('OEM# 10097A9999')).toMatchObject({ kind: 'miss', text: '10097A9999', note: undefined });
    expect(miss('P/N 10097 A9999')).toMatchObject({ kind: 'miss', text: '10097 A9999', note: undefined });
    // a number with a typo, a number split in two, and a note after the number
    expect(miss(`${NOISE} 10097A999`)).toMatchObject({ kind: 'miss', text: '10097A999', note: NOISE });
    expect(miss(`${NOISE} 10097 A9999 Rail guide`)).toMatchObject({ kind: 'miss', text: '10097 A9999', note: `${NOISE} Rail guide` });
    expect(miss('10097A9999 Rail guide')).toMatchObject({ kind: 'miss', text: '10097A9999', note: 'Rail guide' });
    // the same number typed two ways is one row
    expect(parseBulk(`${NOISE} 10097A9999 x2\nOEM# 10097-A9999`, matcher).rows).toHaveLength(1);
  });
});
