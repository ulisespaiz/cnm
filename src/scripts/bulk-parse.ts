// "Paste a list of part numbers": parser and matcher. No DOM, no dependencies
// beyond partkey, so it can be tested in isolation.
//
// Accepted line shapes (case-insensitive):
//   03187A0897            03187A0897 x2         03187A0897, 2
//   2 x 03187A0897        03187A0897<TAB>2      OEM# 03187 A0897 qty 4
//   <any maker's name> 03187A0897   (up to two words of letters in front of a number are skipped)
//   CM-0002 3             03187A0897 Rail guide (trailing words are a note)
//   Rail guide, 03187A0897, 4   (spreadsheet cells in any order; the cell that is a part number wins)

import { cmKey, noLead0, oemKey, queryVariants, OEM_PATTERN, SYNONYMS } from '../lib/partkey';

export const MAX_LINES = 200;

/** One record of /shop/search-index.json (see src/pages/shop/search-index.json.ts). */
export interface IndexRecord {
  i: string;
  o: string; // OEM number; "" for a part that has none
  k: string; // "" for a part that has none: it is matched by its C&M number or its name
  z: string;
  a: string[];
  c?: string;
  n: string;
  w: string[];
  s: string;
  st: string;
  y: string;
  u: string;
  p: string;
}

export interface ParsedLine {
  line: number; // 1-based line number in the pasted text
  raw: string;
  qty: number;
  text: string; // the part text, best guess
  note?: string; // trailing free text
}

export interface Matcher {
  find(text: string): IndexRecord | null;
}

const nameKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// A word of letters with a separator after it: "OEM#", "acme ", "maker-". Up to two of them in front of
// a number are skipped when the whole text matches nothing, whatever the word is: no brand is listed.
const LEAD_WORD = /^[A-Za-z]{2,}\.?[\s#:;/_-]+(?=\S)/;
const MAX_LEAD_WORDS = 2;
const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export function buildMatcher(index: IndexRecord[]): Matcher {
  const byKey = new Map<string, IndexRecord>();
  const numberKeys = new Set<string>();
  const byCm = new Map<string, IndexRecord>();
  const known = new Set<string>(); // every word some part name, other name or section uses
  const put = (key: string, rec: IndexRecord, isNumber = false) => {
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, rec);
    if (isNumber) numberKeys.add(key);
  };
  // Part numbers first so a name can never shadow a number. A part with no OEM
  // number (empty k) is reached through its C&M number, then its name.
  for (const r of index) {
    if (r.k) {
      put(r.k, r, true);
      put(r.z || noLead0(r.k), r, true);
    }
    for (const a of r.a ?? []) {
      const k = oemKey(a);
      put(k, r, true);
      put(noLead0(k), r, true);
    }
    if (r.c) byCm.set(r.c.toUpperCase(), r);
  }
  for (const r of index) {
    put(nameKey(r.n), r);
    for (const w of r.w ?? []) put(nameKey(w), r);
    for (const w of wordsOf(`${r.n} ${(r.w ?? []).join(' ')} ${r.st}`)) {
      known.add(w);
      for (const alt of SYNONYMS[w] ?? []) known.add(alt); // "left" is a word parts use, as "LH"
    }
  }

  return {
    find(text) {
      const full = text.trim();
      let rest = full;
      for (let skipped = 0; ; skipped++) {
        const cm = cmKey(rest);
        if (cm) return byCm.get(cm) ?? null;
        // A name may be matched after skipping words only when no part uses those words; a number always may.
        const nameOk = wordsOf(full.slice(0, full.length - rest.length)).every((w) => !known.has(w));
        for (const v of queryVariants(rest)) {
          const hit = byKey.get(v);
          if (hit && (nameOk || numberKeys.has(v))) return hit;
        }
        const nk = nameKey(rest);
        const byName = nameOk && nk ? byKey.get(nk) : undefined;
        if (byName) return byName;
        const next = rest.replace(LEAD_WORD, '');
        if (skipped >= MAX_LEAD_WORDS || next === rest) return null;
        rest = next;
      }
    },
  };
}

interface Candidate {
  qty: number;
  text: string;
  note?: string;
  prefix: boolean; // allow matching a leading run of words (the rest is a note)
  glued?: boolean; // qty glued to the number with an "x", e.g. 03186D0379x2
  whole?: boolean; // the whole line taken as the part, no quantity split
}

const UNIT = '(?:x|×|pcs?\\.?|pieces?|ea\\.?|each)';
const LEAD = new RegExp(`^(?:qty\\.?\\s*:?\\s*)?(\\d{1,3})(?:(\\s*[x×]\\s*)|\\s*${UNIT}\\s+|[\\s,;:]+)(\\S.*)$`, 'i');
const TRAIL = new RegExp(
  `^(.*?\\S)(?:[\\s,;:]+(?:qty\\.?\\s*:?\\s*|quantity\\s*:?\\s*|@\\s*)?|(\\s*[x×]\\s*))(\\d{1,3})\\s*${UNIT}?$`,
  'i',
);
const QTY_CELL = /^(?:qty\.?\s*:?\s*)?(\d{1,3})\s*(?:x|×|pcs?\.?|ea\.?)?$/i;

const clampQty = (n: number) => Math.max(1, Math.min(999, n));

function candidates(raw: string): Candidate[] {
  const out: Candidate[] = [];
  const flat = raw.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();

  // Spreadsheet and CSV rows: part, qty, description in any order. Each cell that is not the
  // quantity gets a turn as the part (the others become its note), cells that look like a part
  // number first, so "Rail guide, 03187A0897, 4" is the part 03187A0897 with the note "Rail guide".
  const cells = raw.split(/[\t,;]+/).map((c) => c.trim()).filter(Boolean);
  if (cells.length >= 2) {
    const q = cells.findIndex((c) => QTY_CELL.test(c));
    if (q >= 0) {
      const qty = Number(QTY_CELL.exec(cells[q])![1]);
      const rest = cells.filter((_, i) => i !== q);
      const looksLikeNumber = (c: string) => !!cmKey(c) || OEM_PATTERN.test(oemKey(c));
      const order = rest.map((_, i) => i).sort((a, b) => Number(looksLikeNumber(rest[b])) - Number(looksLikeNumber(rest[a])));
      for (const i of order) {
        out.push({
          qty,
          text: rest[i],
          note: rest.filter((_, j) => j !== i).join(' ') || undefined,
          prefix: false,
        });
      }
    }
  }

  out.push({ qty: 1, text: flat, prefix: false, whole: true }); // e.g. "CM 2" is a number, not a quantity

  const lead = LEAD.exec(flat);
  if (lead) {
    out.push({ qty: Number(lead[1]), text: lead[3], prefix: true, glued: !!lead[2] && !/\s$/.test(lead[2]) });
  }
  const trail = TRAIL.exec(flat);
  if (trail) {
    out.push({ qty: Number(trail[3]), text: trail[1], prefix: true, glued: !!trail[2] && !/^\s/.test(trail[2]) });
  }
  out.push({ qty: 1, text: flat, prefix: true, whole: true });
  return out;
}

// Longest run of leading words that is a known part ("03187 A0897 Rail guide").
function matchCandidate(c: Candidate, matcher: Matcher): { rec: IndexRecord; note?: string; qty: number } | null {
  const whole = matcher.find(c.text);
  if (whole) return { rec: whole, note: c.note, qty: c.qty };
  if (!c.prefix) return null;
  const words = c.text.split(/\s+/);
  for (let n = Math.min(words.length - 1, 4); n >= 1; n--) {
    const rec = matcher.find(words.slice(0, n).join(' '));
    if (!rec) continue;
    let rest = words.slice(n);
    let qty = c.qty;
    // "03187A0897 x2, Rail guide": a quantity right after the number
    const q = rest[0] && /^(?:[x×]\s*)?(\d{1,3})[,;]?$/i.exec(rest[0]);
    if (q && c.whole) {
      qty = Number(q[1]);
      rest = rest.slice(1);
    }
    return { rec, qty, note: [rest.join(' '), c.note].filter(Boolean).join(' ') || undefined };
  }
  return null;
}

export interface MatchedLine {
  kind: 'match';
  rec: IndexRecord;
  qty: number;
  note?: string;
  lines: number[]; // source line numbers merged into this row
}

export interface UnmatchedLine {
  kind: 'miss';
  /** The part number as typed (what "Add anyway" will use). */
  text: string;
  qty: number;
  note?: string;
  lines: number[];
}

export interface BulkResult {
  rows: (MatchedLine | UnmatchedLine)[];
  matched: number;
  missing: number;
  merged: number; // lines folded into an earlier duplicate
  tooMany: boolean;
  total: number; // non-empty lines pasted
}

// Words that only label a number ("OEM#", "P/N", "part no."): kept out of the note.
const LABEL_WORD = /^(?:oem|p\/?n|part|no|number|#)[.:#]*$/i;

// Where the part number is in a line of words: a word or two adjacent words shaped like a number
// ("acme 03187 A0897 pulley" -> words 1-2), else a word that mixes letters with digits.
function numberRun(words: string[]): { start: number; len: number } | null {
  const isNumber = (text: string) => OEM_PATTERN.test(oemKey(text)) || !!cmKey(text);
  for (let i = 0; i < words.length; i++) {
    if (i + 1 < words.length && !LABEL_WORD.test(words[i]) && isNumber(`${words[i]} ${words[i + 1]}`)) return { start: i, len: 2 };
    if (isNumber(words[i])) return { start: i, len: 1 };
  }
  // A number with a typo is still a number: the first word is taken with any digits in it, later ones need four.
  for (let i = 0; i < words.length; i++) {
    const digits = (words[i].match(/\d/g) ?? []).length;
    if (/[A-Za-z]/.test(words[i]) && digits >= (i === 0 ? 1 : 4)) return { start: i, len: 1 };
  }
  return null;
}

// Best guess at the part number in a line we could not match. Only the number is saved as the part; any
// other words in the line (a maker's name typed in front, a description after) go to the note.
function guessText(raw: string, cands: Candidate[]): { text: string; qty: number; note?: string } {
  const flat = raw.replace(/\s+/g, ' ').trim();
  const pick = cands.find((c) => !c.whole && !(c.glued && !OEM_PATTERN.test(oemKey(c.text)))) ?? null;
  const qty = pick ? clampQty(pick.qty) : 1;
  const text = (pick ? pick.text : flat).trim();
  const words = text.split(/\s+/);
  const run = numberRun(words);
  if (run && words.length > 1) {
    const around = [...words.slice(0, run.start).filter((w) => !LABEL_WORD.test(w)), ...words.slice(run.start + run.len)];
    return { text: words.slice(run.start, run.start + run.len).join(' '), qty, note: [around.join(' '), pick?.note].filter(Boolean).join(' ') || undefined };
  }
  return { text: text.slice(0, 80), qty, note: pick?.note };
}

export function parseBulk(text: string, matcher: Matcher): BulkResult {
  const lines = text
    .split(/\r?\n/)
    .map((raw, i) => ({ raw: raw.trim(), line: i + 1 }))
    .filter((l) => l.raw);
  const result: BulkResult = { rows: [], matched: 0, missing: 0, merged: 0, tooMany: lines.length > MAX_LINES, total: lines.length };
  if (result.tooMany) return result;

  const byRec = new Map<string, MatchedLine>();
  const byText = new Map<string, UnmatchedLine>();

  for (const { raw, line } of lines) {
    const cands = candidates(raw);
    let hit: ReturnType<typeof matchCandidate> = null;
    for (const c of cands) {
      hit = matchCandidate(c, matcher);
      if (hit) break;
    }

    if (hit) {
      const q = clampQty(hit.qty);
      const prev = byRec.get(hit.rec.i);
      if (prev) {
        prev.qty = clampQty(prev.qty + q);
        prev.lines.push(line);
        result.merged++;
      } else {
        const row: MatchedLine = { kind: 'match', rec: hit.rec, qty: q, note: hit.note, lines: [line] };
        byRec.set(hit.rec.i, row);
        result.rows.push(row);
      }
      continue;
    }

    const g = guessText(raw, cands);
    const key = oemKey(g.text) || g.text.toUpperCase();
    const prev = byText.get(key);
    if (prev) {
      prev.qty = clampQty(prev.qty + g.qty);
      prev.lines.push(line);
      result.merged++;
    } else {
      const row: UnmatchedLine = { kind: 'miss', text: g.text, qty: clampQty(g.qty), note: g.note, lines: [line] };
      byText.set(key, row);
      result.rows.push(row);
    }
  }

  result.matched = result.rows.filter((r) => r.kind === 'match').length;
  result.missing = result.rows.length - result.matched;
  return result;
}
