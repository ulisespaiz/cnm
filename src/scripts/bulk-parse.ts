// "Paste a list of part numbers": parser and matcher. No DOM, no dependencies
// beyond partkey, so it can be tested in isolation.
//
// Accepted line shapes (case-insensitive):
//   03187A0897            03187A0897 x2         03187A0897, 2
//   2 x 03187A0897        03187A0897<TAB>2      OEM# 03187 A0897 qty 4
//   CM-0002 3             03187A0897 Rail guide (trailing words are a note)

import { cmKey, noLead0, oemKey, queryVariants, OEM_PATTERN } from '../lib/partkey';

export const MAX_LINES = 200;

/** One record of /shop/search-index.json (see src/pages/shop/search-index.json.ts). */
export interface IndexRecord {
  i: string;
  o: string;
  k: string;
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

export function buildMatcher(index: IndexRecord[]): Matcher {
  const byKey = new Map<string, IndexRecord>();
  const byCm = new Map<string, IndexRecord>();
  const put = (key: string, rec: IndexRecord) => {
    if (key && !byKey.has(key)) byKey.set(key, rec);
  };
  // Part numbers first so a name can never shadow a number.
  for (const r of index) {
    put(r.k, r);
    put(r.z || noLead0(r.k), r);
    for (const a of r.a ?? []) {
      const k = oemKey(a);
      put(k, r);
      put(noLead0(k), r);
    }
    if (r.c) byCm.set(r.c.toUpperCase(), r);
  }
  for (const r of index) {
    put(nameKey(r.n), r);
    for (const w of r.w ?? []) put(nameKey(w), r);
  }

  return {
    find(text) {
      const cm = cmKey(text);
      if (cm) return byCm.get(cm) ?? null;
      const cleaned = text.replace(/\bhayssen\b/gi, ' ');
      for (const v of queryVariants(cleaned)) {
        const hit = byKey.get(v);
        if (hit) return hit;
      }
      const nk = nameKey(cleaned);
      return (nk && byKey.get(nk)) || null;
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

  // Spreadsheet and CSV rows: part, qty, description in any order.
  const cells = raw.split(/[\t,;]+/).map((c) => c.trim()).filter(Boolean);
  if (cells.length >= 2) {
    const q = cells.findIndex((c) => QTY_CELL.test(c));
    if (q >= 0) {
      const rest = cells.filter((_, i) => i !== q);
      out.push({
        qty: Number(QTY_CELL.exec(cells[q])![1]),
        text: rest[0],
        note: rest.slice(1).join(' ') || undefined,
        prefix: false,
      });
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

// Best guess at the part number in a line we could not match.
function guessText(raw: string, cands: Candidate[]): { text: string; qty: number; note?: string } {
  const flat = raw.replace(/\s+/g, ' ').trim();
  const pick = cands.find((c) => !c.whole && !(c.glued && !OEM_PATTERN.test(oemKey(c.text)))) ?? null;
  const qty = pick ? clampQty(pick.qty) : 1;
  const text = (pick ? pick.text : flat).trim();
  const words = text.split(/\s+/);
  // Two words that together look like a number: "03187 A0897".
  if (words.length >= 2 && OEM_PATTERN.test(oemKey(words.slice(0, 2).join(' ')))) {
    return { text: words.slice(0, 2).join(' '), qty, note: [words.slice(2).join(' '), pick?.note].filter(Boolean).join(' ') || undefined };
  }
  if (words.length > 1 && /[A-Za-z]/.test(words[0]) && /\d/.test(words[0])) {
    return { text: words[0], qty, note: [words.slice(1).join(' '), pick?.note].filter(Boolean).join(' ') || undefined };
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
