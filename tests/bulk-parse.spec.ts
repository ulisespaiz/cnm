import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { buildMatcher, looksLikePartNumber, parseBulk, sharedNote, type ChoiceLine, type IndexRecord, type MatchedLine, type UnmatchedLine } from '../src/scripts/bulk-parse';

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

  // Three OEM numbers each belong to two parts (the owner marked them oemVerify). Every part of a number is kept,
  // in catalog order, and a pasted line for such a number is a row to choose from, never one of them picked.
  const SHARED: Record<string, string[]> = {
    '03027A9240': ['CM-0039', 'CM-0046'],
    '03027A8608': ['CM-0043', 'CM-0044'],
    '03027A9275': ['CM-0092', 'CM-0100'],
  };

  test('keeps every part that shares an OEM number', () => {
    for (const [oem, cms] of Object.entries(SHARED)) {
      for (const text of [oem, oem.replace(/^0/, ''), `${NOISE} ${oem}`, `OEM# ${oem.slice(0, 5)}-${oem.slice(5)}`]) {
        expect(matcher.findAll(text).map((r) => r.c), text).toEqual(cms);
      }
      expect(matcher.find(oem)?.c, 'find() still gives the first, for callers that need one').toBe(cms[0]);
      // a C&M number is one part, even when its OEM number is shared
      expect(matcher.findAll(cms[1]).map((r) => r.c)).toEqual([cms[1]]);
    }
    expect(matcher.findAll('10097A2083').map((r) => r.i), 'a number one part has stays one part').toEqual([gear]);
    expect(matcher.findAll('10097A2084')).toEqual([]);
  });

  test('a shared number pasted twice is one row to choose from, with nothing chosen', () => {
    const result = parseBulk(['03027A9240 x2', `${NOISE} 03027-A9240, 3`, 'CM-0046', '10097A2083'].join('\n'), matcher);
    expect(result).toMatchObject({ matched: 2, choose: 1, missing: 0, merged: 1 });
    const choose = result.rows.find((r) => r.kind === 'choose') as ChoiceLine;
    expect(choose.recs.map((r) => r.c)).toEqual(['CM-0039', 'CM-0046']);
    expect(choose.qty).toBe(5);
    expect(choose.lines).toEqual([1, 2]);
    // CM-0046 typed as its C&M number is that part alone, a row of its own
    expect(result.rows.filter((r) => r.kind === 'match').map((r) => (r as MatchedLine).rec.c)).toEqual(['CM-0046', 'CM-0111']);
  });

  test('the note for an unchosen shared number names every part it could be', () => {
    const recs = matcher.findAll('03027A8608');
    const note = sharedNote(recs);
    expect(note).toContain('2 parts share this OEM #');
    for (const r of recs) expect(note).toContain(`${r.n} (${r.c})`);
    expect(note).toContain("We'll confirm which");
  });

  test('a line not in the catalog is offered ticked only when it looks like a part number', () => {
    for (const text of ['10097A9999', '10097 A9999', '10097A999', 'CM-0999', '3186-D0379X', 'AB12345']) {
      expect(looksLikePartNumber(text), text).toBe(true);
    }
    for (const text of ['thanks', 'see attached', 'Rail guide', 'x2', '123', 'please call me back at 4']) {
      expect(looksLikePartNumber(text), text).toBe(false);
    }
    const rows = parseBulk([`${NOISE} 10097A9999`, 'thanks for the help'].join('\n'), matcher).rows as UnmatchedLine[];
    expect(rows.map((r) => [r.text, r.likely])).toEqual([
      ['10097A9999', true],
      ['thanks for the help', false],
    ]);
  });
});
