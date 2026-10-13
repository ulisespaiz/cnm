// Filter field for the OEM part number index (/shop/part-numbers/). Every row is already in the HTML; this only hides
// the rows that do not match what is typed, so with no JavaScript the whole table is there (the field itself stays
// hidden until this script shows it). Numbers are read the way the shop search reads them (src/lib/partkey.ts): with
// or without spaces, dashes or the leading zero, with the letter O typed for zero, and with a word such as "OEM" or any
// other word in front of the number. A C&M number is read as a C&M number ("cm 2" is CM-0002). The matching is local:
// no request is made.
import { cmKey, noLead0, queryVariants, SYNONYMS } from '../lib/partkey';

interface Row {
  el: HTMLElement;
  keys: string[]; // OEM key, the key without leading zeros, extra keys (typos as written in the source)
  cm: string; // CM-0002
  words: string[]; // words of the name and the other names
}

// Words that only label a number ("OEM part number 03187A0897"): never matched against part names.
const FILLER = new Set(['oem', 'pn', 'part', 'no', 'number']);

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// A query word matches a part word that starts with it, or with one of its synonyms ("lh" is "left").
const wordMatches = (word: string, list: string[]) => {
  const alternatives = [word, ...(SYNONYMS[word] ?? [])];
  return list.some((w) => alternatives.some((a) => w.startsWith(a)));
};

// The C&M number in a query, as typed ("cm 2" -> "2", "acme CM-0111" -> "0111"), or null.
const cmDigits = (query: string) => /(?:^|[^a-z0-9])cm[\s#-]*(\d{1,4})(?![a-z0-9])/i.exec(query)?.[1] ?? null;

// The part of a query that has the shape of an OEM number: consecutive words with digits in them (a lone letter between
// two of them belongs to the number), at least three digits in all. "acme 03187 A0897 pulley" -> "03187 A0897".
function numberRun(tokens: string[]) {
  const digit = tokens.map((t) => /\d/.test(t));
  const inNumber = tokens.map((t, i) => digit[i] || (t.length === 1 && !!digit[i - 1] && !!digit[i + 1]));
  for (let i = 0; i < tokens.length; i++) {
    if (!inNumber[i]) continue;
    let end = i;
    while (inNumber[end + 1]) end++;
    const text = tokens.slice(i, end + 1).join(' ');
    if ((text.match(/\d/g) ?? []).length >= 3) return { text, from: i, to: end };
    i = end;
  }
  return null;
}

function init(root: HTMLElement) {
  const input = root.querySelector<HTMLInputElement>('input')!;
  const status = root.querySelector<HTMLElement>('[data-pn-status]')!;
  const empty = root.querySelector<HTMLElement>('[data-pn-empty]')!;
  const table = document.querySelector<HTMLTableElement>('[data-pn-table]');
  if (!table) return;

  const rows: Row[] = [...table.querySelectorAll<HTMLElement>('tbody tr')].map((el) => {
    const key = el.dataset.k ?? '';
    const alt = (el.dataset.a ?? '').split(/\s+/).filter(Boolean);
    return {
      el,
      keys: key ? [key, noLead0(key), ...alt.map((a) => a.toUpperCase().replace(/[^A-Z0-9]/g, ''))] : [],
      cm: el.dataset.c ?? '',
      words: words(el.dataset.w ?? ''),
    };
  });
  const known = (word: string) => rows.some((r) => wordMatches(word, r.words));
  const nameHas = (list: string[]) => (r: Row) => list.every((t) => wordMatches(t, r.words));

  // null: nothing typed. Otherwise a test for one row.
  function matcher(raw: string): ((r: Row) => boolean) | null {
    const query = raw.replace(/\s+/g, ' ').trim();
    if (!query) return null;

    // A C&M number inside a longer query is read as that number and nothing else: its digits are never tried as an OEM
    // number ("cm 2" is CM-0002, as in the shop search).
    const cm = cmDigits(query);
    if (cm !== null) {
      const exact = cmKey(`cm ${cm}`);
      return (r) => r.cm === exact;
    }

    const tokens = query.split(/[^A-Za-z0-9]+/).filter(Boolean);
    const lower = tokens.map((t) => t.toLowerCase());
    const byName = nameHas(lower.filter((t) => !FILLER.has(t)));

    // An OEM number. A word next to it must match the part only when some part uses it; a word nobody uses ("acme",
    // "oem") is ignored, so any word in front of a number still finds the part. The words alone are tried too, so a
    // size in a name ("roller 1.25") is found as well.
    const run = numberRun(tokens);
    const strict = !run
      ? byName
      : (() => {
          const variants = queryVariants(run.text);
          const beside = lower.filter((t, i) => (i < run.from || i > run.to) && !FILLER.has(t) && known(t));
          const near = nameHas(beside);
          return (r: Row) => (variants.some((v) => r.keys.some((k) => k.startsWith(v) || (v.length >= 4 && k.includes(v)))) && near(r)) || byName(r);
        })();
    if (rows.some(strict)) return strict;

    // Nothing matches: try again without the words that no part uses (a maker's name, a stray word). A word with a digit
    // in it is never dropped: a number that is not in the catalog must not be swapped for the other words.
    if (!lower.some((t) => /\d/.test(t))) {
      const keep = lower.filter((t) => !FILLER.has(t) && known(t));
      if (keep.length) return nameHas(keep);
    }
    return strict;
  }

  function apply() {
    const test = matcher(input.value);
    let shown = 0;
    for (const r of rows) {
      const show = !test || test(r);
      r.el.hidden = !show;
      if (show) shown++;
    }
    status.textContent = test ? `Showing ${shown} of ${rows.length} parts` : '';
    empty.hidden = !test || shown > 0;
  }

  input.addEventListener('input', apply);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      input.value = '';
      apply();
    }
  });
  root.hidden = false;
  if (input.value) apply(); // the browser may restore the field after a back navigation
}

document.querySelectorAll<HTMLElement>('[data-pn-filter]').forEach(init);
