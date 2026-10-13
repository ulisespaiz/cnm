// Instant parts search: part numbers (typed any way), C&M numbers, and words.
// The index is /shop/search-index.json (see src/pages/shop/search-index.json.ts).
// Matching rules: exact / prefix / substring on the OEM number (k, z, extra
// keys), C&M numbers via cmKey, and word-prefix matching on names, section and
// part type with a one-edit tolerance for typos ("pully"). When nothing matches,
// the query is tried again without the words that no part uses and around the
// part-number-shaped run of words, so "OEM # 03187A0897", "<maker> 03187A0897" or
// "03187A0897 pulley" still find the part, whatever the extra word is. No brand
// name is listed anywhere.
import { cmKey, oemKey, queryVariants, SYNONYMS } from '../lib/partkey';
import { addPart } from './part-add';
import { scrollToEl } from './scroll-to';

export interface Rec {
  i: string;
  o: string; // OEM number; "" for a part that has none (k and z are then "" too)
  k: string;
  z: string;
  a: string[];
  c: string;
  n: string;
  w: string[];
  s: string;
  st: string;
  y: string;
  u: string;
  p: string;
}

export interface Hit {
  rec: Rec;
  score: number;
  at: number; // match position in rec.k (-1: none)
  len: number;
  idx: number; // catalog order
}

interface Entry {
  rec: Rec;
  idx: number;
  keys: string[];
  words: string[];
  nameWords: string[];
}

let types: Record<string, string> = {};
let entries: Entry[] = [];
let loading: Promise<Entry[]> | null = null;

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export function loadIndex(): Promise<Entry[]> {
  loading ??= fetch('/shop/search-index.json')
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<Rec[]>;
    })
    .then((recs) => {
      entries = recs.map((rec, idx) => ({
        rec,
        idx,
        keys: rec.k ? [rec.k, rec.z, ...rec.a.map(oemKey)] : [], // a part with no OEM number has no number keys; its C&M number is matched separately
        words: words(`${rec.n} ${rec.w.join(' ')} ${rec.st} ${types[rec.y] ?? rec.y}`),
        nameWords: words(`${rec.n} ${rec.w.join(' ')}`),
      }));
      return entries;
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

// True when the two strings are at most one edit apart.
function within1(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.slice(i) === long.slice(i + 1);
}

// How a query word relates to a list of part words: 0 none, 1 word-prefix (or synonym), 2 one typo away.
function wordMatch(t: string, list: string[]): 0 | 1 | 2 {
  const alts = [t, ...(SYNONYMS[t] ?? [])];
  if (list.some((w) => alts.some((a) => w.startsWith(a)))) return 1;
  if (t.length >= 5 && list.some((w) => w.length >= 5 && (within1(t, w) || within1(t, w.slice(0, t.length))))) return 2;
  return 0;
}

function run(query: string): Hit[] {
  const k = oemKey(query);
  const digits = (k.match(/\d/g) ?? []).length;
  const numeric = k.length >= 3 && digits >= 3;
  const variants = numeric ? queryVariants(query) : [];
  const cm = cmKey(query);
  const tokens = words(query);
  const hits: Hit[] = [];

  for (const e of entries) {
    let score = 0;
    let at = -1;
    let len = 0;

    if (cm && e.rec.c === cm) score = 100;

    for (const v of variants) {
      for (let n = 0; n < e.keys.length; n++) {
        const key = e.keys[n];
        const pos = key.indexOf(v);
        let s = 0;
        if (key === v) s = 100;
        else if (pos === 0) s = 80;
        else if (pos > 0 && v.length >= 4) s = 60;
        if (s > score) {
          score = s;
          at = n < 2 ? pos + (n === 1 ? e.rec.k.length - e.rec.z.length : 0) : -1;
          len = v.length;
        }
      }
    }

    if (score < 40 && tokens.length) {
      let matched = 0;
      let fuzzy = false;
      for (const t of tokens) {
        const m = wordMatch(t, e.words);
        if (m) matched++;
        if (m === 2) fuzzy = true;
      }
      // Parts named for the query rank above parts that only match on
      // their section or type ("plate" vs the Platen section).
      const inName = tokens.every((t) => wordMatch(t, e.nameWords) === 1);
      if (matched === tokens.length) score = fuzzy ? 20 : 40 + matched + (inName ? 10 : 0);
    }

    if (score) hits.push({ rec: e.rec, score, at, len, idx: e.idx });
  }
  return hits.sort((a, b) => b.score - a.score || a.idx - b.idx);
}

// Other ways to read a query that found nothing: the run of words that has the shape of a part number
// on its own, and the query without the words that no part uses (a maker's name, "OEM", a stray word).
function otherReadings(query: string): string[] {
  const out: string[] = [];
  // A C&M number inside a longer query ("acme CM-0111", "cm 111 pulley") is read as that exact key and
  // nothing else: its digits must never be tried as a part-number run, where "0111" would match another
  // part by prefix. (A C&M number that is not in the catalog finds nothing, which is the right answer.)
  const cmRun = /\bcm[\s#-]*\d{1,4}\b/i.exec(query);
  if (cmRun && cmKey(cmRun[0])) return [cmRun[0]].filter((t) => t !== query);
  const tokens = query.split(/[^A-Za-z0-9]+/).filter(Boolean);
  // "acme 03187 A0897 pulley" -> "03187 A0897": consecutive words with digits in them (a lone letter
  // between two of them belongs to the number), at least three digits in all.
  const digit = tokens.map((t) => /\d/.test(t));
  const inNumber = tokens.map((t, i) => digit[i] || (t.length === 1 && !!digit[i - 1] && !!digit[i + 1]));
  for (let i = 0; i < tokens.length; i++) {
    if (!inNumber[i]) continue;
    let end = i;
    while (inNumber[end + 1]) end++;
    const text = tokens.slice(i, end + 1).join(' ');
    if ((text.match(/\d/g) ?? []).length >= 3) out.push(text);
    i = end;
  }
  // A word with digits in it is never dropped: a number that is not in the catalog must not be
  // swapped for the other words ("acme 10097A9999" must not list the parts that have "acme" in their name).
  const all = words(query);
  const known = all.filter((t) => entries.some((e) => wordMatch(t, e.words)));
  const dropped = all.filter((t) => !known.includes(t));
  if (known.length && dropped.length && !dropped.some((t) => /\d/.test(t))) out.push(known.join(' '));
  return out.filter((text) => text !== query);
}

export function search(q: string): Hit[] {
  const query = q.replace(/\s+/g, ' ').trim();
  if (!query || !entries.length) return [];
  const hits = run(query);
  if (hits.length) return hits;
  for (const other of otherReadings(query)) {
    const found = run(other);
    if (found.length) return found;
  }
  return [];
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/* ---------- "Request this part" ---------- */

export function requestPart(query: string) {
  document.dispatchEvent(new CustomEvent('part-request:prefill', { detail: { query } }));
  const target = document.getElementById('request');
  target?.closest('details')?.setAttribute('open', '');
  scrollToEl(target);
}

document.addEventListener('click', (event) => {
  const btn = (event.target as Element).closest<HTMLElement>('[data-request-part]');
  if (!btn) return;
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>('[data-part-search] input');
  requestPart(btn.dataset.query ?? input?.value ?? '');
});

/* ---------- search box ---------- */

const MAX = 8;

function initBox(root: HTMLElement) {
  const input = root.querySelector<HTMLInputElement>('input')!;
  const form = root.querySelector<HTMLFormElement>('form')!;
  const clear = root.querySelector<HTMLButtonElement>('[data-ps-clear]')!;
  const panel = root.querySelector<HTMLElement>('[data-ps-panel]')!;
  const list = root.querySelector<HTMLElement>('[data-ps-list]')!;
  const status = root.querySelector<HTMLElement>('[data-ps-status]')!;
  const extra = root.querySelector<HTMLElement>('[data-ps-extra]')!;
  let hits: Hit[] = [];

  // The list on screen updates on every key; the spoken count waits until typing pauses, so a screen reader says
  // "4 results", not "4 results", "No match for 03", "9 results", "8 results" for four keystrokes (WCAG 4.1.3).
  let statusTimer: number | undefined;
  const say = (text: string) => {
    window.clearTimeout(statusTimer);
    if (!text) status.textContent = '';
    else statusTimer = window.setTimeout(() => (status.textContent = text), 600);
  };

  const phone = { label: root.dataset.phone ?? '', tel: root.dataset.tel ?? '' };
  const reply = root.dataset.reply ?? '';

  const links = () => [...list.querySelectorAll<HTMLElement>('.ps-hit__link')];

  // Phones: a fixed bottom bar (call/quote) covers the page bottom, so cap the
  // panel to the space between its top edge and that bar.
  function fit() {
    if (panel.hidden) return;
    const bar = document.querySelector<HTMLElement>('.mobile-bar, .addbar');
    const barOn = bar && getComputedStyle(bar).display !== 'none';
    const floor = barOn ? bar.getBoundingClientRect().top : window.innerHeight;
    const room = Math.floor(floor - panel.getBoundingClientRect().top - 8);
    if (barOn) panel.style.setProperty('--ps-room', `${Math.max(room, 140)}px`);
    else panel.style.removeProperty('--ps-room');
  }
  window.addEventListener('resize', fit);
  window.addEventListener('scroll', fit, { passive: true });

  function show(open: boolean) {
    panel.hidden = !open;
    if (open) fit();
    // The panel floats over the page under the search box: while any panel is open, the page regions marked
    // data-ps-under are hidden (store.css), so no sliver of a link shows below the panel's bottom edge.
    document.documentElement.toggleAttribute('data-ps-open', !!document.querySelector('[data-ps-panel]:not([hidden])'));
  }

  function oemHtml(h: Hit) {
    const o = h.rec.o || h.rec.c; // a part with no OEM number shows its C&M number
    if (h.at < 0 || o !== h.rec.k) return esc(o);
    return `${esc(o.slice(0, h.at))}<mark>${esc(o.slice(h.at, h.at + h.len))}</mark>${esc(o.slice(h.at + h.len))}`;
  }

  function render() {
    const q = input.value.trim();
    clear.hidden = !input.value;
    if (!q) {
      list.innerHTML = '';
      list.hidden = true;
      extra.innerHTML = '';
      say('');
      return show(false);
    }
    if (!entries.length) {
      // index still loading: results appear as soon as it arrives
      return;
    }
    hits = search(q);
    list.hidden = !hits.length;
    if (!hits.length) {
      list.innerHTML = '';
      if (q.length < 2) return show(false);
      say(`No match for ${q}`);
      extra.innerHTML = `<div class="ps-empty"><p class="ps-empty__title">No match for “${esc(q)}”</p>
        <p>Request this part by number. ${esc(reply)}</p>
        <div class="ps-empty__actions"><button type="button" class="btn btn--red" data-request-part data-query="${esc(q)}">Request this part</button>
        <a class="btn btn--outline" href="tel:${esc(phone.tel)}">Call ${esc(phone.label)}</a></div></div>`;
      return show(true);
    }
    // A plain list: each result is a link plus its own Add button, both reached with Tab;
    // Arrow Down / Arrow Up move between the links.
    list.innerHTML = hits
      .slice(0, MAX)
      .map(
        (h, n) => `<li class="ps-hit">
        <a class="ps-hit__link" href="${esc(h.rec.u)}">
          <span class="ps-hit__thumb">${h.rec.p ? `<img src="${esc(h.rec.p)}" width="36" height="48" alt="" loading="lazy" decoding="async">` : ''}</span>
          <span class="ps-hit__text"><span class="ps-hit__oem">${oemHtml(h)}</span><span class="ps-hit__name">${esc(h.rec.n)}</span><span class="ps-hit__sec">${esc(h.rec.st)}</span></span>
        </a>
        <button type="button" class="ps-hit__add" data-ps-add="${n}" aria-label="Add ${esc(h.rec.o || h.rec.c)} ${esc(h.rec.n)} to quote">Add</button></li>`,
      )
      .join('');
    extra.innerHTML =
      hits.length > MAX
        ? `<button type="button" class="ps-more" data-ps-all>See all ${hits.length} results</button>`
        : '';
    say(`${hits.length} ${hits.length === 1 ? 'result' : 'results'}`);
    show(true);
  }

  function go(url: string) {
    location.href = url;
  }

  function apply(value: string) {
    // Filter the page's list when there is one, else open the store with ?q=
    if (document.querySelector('[data-plist]')) {
      show(false);
      document.dispatchEvent(new CustomEvent('partsearch:apply', { detail: { query: value } }));
    } else go(`/shop/?q=${encodeURIComponent(value)}`);
  }

  function commit() {
    const value = input.value.trim();
    if (!value) return;
    if (!entries.length) {
      void loadIndex().then(commit).catch(() => apply(value));
      return;
    }
    // Go straight to a part only when exactly one part has that number: a number
    // that two parts share lists both. A focused result link navigates by itself.
    const exact = search(value).filter((h) => h.score >= 100);
    if (exact.length === 1) return go(exact[0].rec.u);
    apply(value);
  }

  // Load the index once and render when it arrives. Never re-render for a
  // pointerdown on an already loaded index: that would swap the button out
  // from under the pointer mid-click.
  const ensure = () => {
    if (entries.length) return;
    void loadIndex().then(render).catch(() => {});
  };

  input.addEventListener('focus', () => {
    ensure();
    if (input.value.trim() && entries.length) render();
  });
  root.addEventListener('pointerdown', ensure, { once: true });
  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    if (!entries.length) ensure();
    else render();
    if (!input.value) document.dispatchEvent(new CustomEvent('partsearch:apply', { detail: { query: '', fromInput: true } }));
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    commit();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    input.focus();
    render();
    document.dispatchEvent(new CustomEvent('partsearch:apply', { detail: { query: '', fromInput: true } }));
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    if (panel.hidden && input.value.trim()) render();
    const first = links()[0];
    if (!first || panel.hidden) return;
    e.preventDefault();
    first.focus();
  });
  // Arrow keys walk the result links (also from an Add button); Arrow Up on the first goes back to the field.
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const hit = (e.target as Element).closest('.ps-hit');
    if (!hit) return;
    e.preventDefault();
    const all = links();
    const at = all.indexOf(hit.querySelector<HTMLElement>('.ps-hit__link')!);
    const to = all[at + (e.key === 'ArrowDown' ? 1 : -1)];
    if (to) to.focus();
    else if (e.key === 'ArrowUp') input.focus();
  });
  // Tab out of the last control leaves the box. Close the panel first, so the page behind it is back in
  // the tab order before the browser picks the next stop (it would skip the hidden regions).
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.shiftKey || panel.hidden) return;
    const stops = [...root.querySelectorAll<HTMLElement>('input, button, a[href]')].filter((el) => !el.hidden && !el.closest('[hidden]'));
    if (e.target === stops[stops.length - 1]) show(false);
  });
  // Escape closes the panel from anywhere inside it and puts focus back in the field.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    e.preventDefault();
    input.focus(); // its focus handler redraws the list, so close afterwards
    show(false);
  });
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget as Node)) show(false);
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target as Node)) show(false);
  });
  // Safari and Firefox on macOS do not focus a button when it is clicked: without this the field
  // would lose focus, the panel would close on focusout, and the click would never land.
  panel.addEventListener('mousedown', (e) => e.preventDefault());
  panel.addEventListener('click', (e) => {
    const t = e.target as Element;
    const add = t.closest<HTMLElement>('[data-ps-add]');
    if (add) {
      const rec = hits[Number(add.dataset.psAdd)].rec;
      addPart({ id: rec.i, title: rec.n, oem: rec.o || undefined, cm: rec.c, section: rec.st, url: rec.u, thumb: rec.p }, 1);
      add.textContent = '✓ Added';
      window.setTimeout(() => (add.textContent = 'Add'), 1500);
      return;
    }
    if (t.closest('[data-ps-all]')) apply(input.value.trim());
  });

  // exposed so the list filter can mirror a deep link into the field
  root.addEventListener('partsearch:set', ((e: CustomEvent<string>) => {
    input.value = e.detail;
    clear.hidden = !input.value;
  }) as EventListener);
}

export function initSearch() {
  const first = document.querySelector<HTMLElement>('[data-part-search]');
  if (first?.dataset.types) types = JSON.parse(first.dataset.types);
  document.querySelectorAll<HTMLElement>('[data-part-search]').forEach(initBox);
  // The store home loads the index when the browser is idle, after the page has loaded
  if (location.pathname === '/shop/' || new URLSearchParams(location.search).has('q')) {
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 600));
    const warm = () => idle(() => void loadIndex().catch(() => {}));
    if (document.readyState === 'complete') warm();
    else window.addEventListener('load', warm, { once: true });
  }
}

initSearch();
