// Instant parts search: part numbers (typed any way), C&M numbers, and words.
// The index is /shop/search-index.json (see src/pages/shop/search-index.json.ts).
// Matching rules: exact / prefix / substring on the Hayssen number (k, z, extra
// keys), C&M numbers via cmKey, and word-prefix matching on names, section and
// part type with a one-edit tolerance for typos ("pully").
import { cmKey, oemKey, queryVariants } from '../lib/partkey';
import { addPart } from './part-add';
import { scrollToEl } from './scroll-to';

export interface Rec {
  i: string;
  o: string;
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

const SYN: Record<string, string[]> = {
  lh: ['left'],
  left: ['lh'],
  rh: ['right'],
  right: ['rh'],
  ss: ['stainless'],
  stainless: ['ss'],
  assy: ['assembly'],
  mtg: ['mounting'],
  comp: ['compression'],
  adj: ['adjustable'],
};

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
        keys: [rec.k, rec.z, ...rec.a.map(oemKey)],
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

export function search(q: string): Hit[] {
  const query = q.trim();
  if (!query || !entries.length) return [];
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
        const alts = [t, ...(SYN[t] ?? [])];
        if (e.words.some((w) => alts.some((a) => w.startsWith(a)))) matched++;
        else if (t.length >= 5 && e.words.some((w) => w.length >= 5 && (within1(t, w) || within1(t, w.slice(0, t.length))))) {
          matched++;
          fuzzy = true;
        }
      }
      // Parts named for the query rank above parts that only match on
      // their section or type ("plate" vs the Platen section).
      const inName = tokens.every((t) => {
        const alts = [t, ...(SYN[t] ?? [])];
        return e.nameWords.some((w) => alts.some((a) => w.startsWith(a)));
      });
      if (matched === tokens.length) score = fuzzy ? 20 : 40 + matched + (inName ? 10 : 0);
    }

    if (score) hits.push({ rec: e.rec, score, at, len, idx: e.idx });
  }
  return hits.sort((a, b) => b.score - a.score || a.idx - b.idx);
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
let uid = 0;

function initBox(root: HTMLElement) {
  const input = root.querySelector<HTMLInputElement>('input')!;
  const form = root.querySelector<HTMLFormElement>('form')!;
  const clear = root.querySelector<HTMLButtonElement>('[data-ps-clear]')!;
  const panel = root.querySelector<HTMLElement>('[data-ps-panel]')!;
  const list = root.querySelector<HTMLElement>('[role="listbox"]')!;
  const status = root.querySelector<HTMLElement>('[data-ps-status]')!;
  const extra = root.querySelector<HTMLElement>('[data-ps-extra]')!;
  const id = `ps${++uid}`;
  let hits: Hit[] = [];
  let active = -1;

  const phone = { label: root.dataset.phone ?? '', tel: root.dataset.tel ?? '' };
  const reply = root.dataset.reply ?? '';

  const options = () => [...list.querySelectorAll<HTMLElement>('[role="option"]')];

  function setActive(n: number) {
    const opts = options();
    active = n >= 0 && n < opts.length ? n : -1;
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', opts[active].id);
      opts[active].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

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
    input.setAttribute('aria-expanded', String(open));
    if (!open) setActive(-1);
    else fit();
  }

  function oemHtml(h: Hit) {
    const o = h.rec.o;
    if (h.at < 0 || o !== h.rec.k) return esc(o);
    return `${esc(o.slice(0, h.at))}<mark>${esc(o.slice(h.at, h.at + h.len))}</mark>${esc(o.slice(h.at + h.len))}`;
  }

  function render() {
    const q = input.value.trim();
    clear.hidden = !input.value;
    if (!q) {
      list.innerHTML = '';
      extra.innerHTML = '';
      status.textContent = '';
      return show(false);
    }
    if (!entries.length) {
      // index still loading: results appear as soon as it arrives
      return;
    }
    hits = search(q);
    if (!hits.length) {
      list.innerHTML = '';
      if (q.length < 2) return show(false);
      status.textContent = `No match for ${q}`;
      extra.innerHTML = `<div class="ps-empty"><p class="ps-empty__title">No match for “${esc(q)}”</p>
        <p>Request this part by number. ${esc(reply)}</p>
        <div class="ps-empty__actions"><button type="button" class="btn btn--red" data-request-part data-query="${esc(q)}">Request this part</button>
        <a class="btn btn--outline" href="tel:${esc(phone.tel)}">Call ${esc(phone.label)}</a></div></div>`;
      return show(true);
    }
    list.innerHTML = hits
      .slice(0, MAX)
      .map(
        (h, n) => `<li role="option" id="${id}-${n}" aria-selected="false" class="ps-hit">
        <a class="ps-hit__link" href="${esc(h.rec.u)}" tabindex="-1">
          <span class="ps-hit__thumb">${h.rec.p ? `<img src="${esc(h.rec.p)}" width="36" height="48" alt="" loading="lazy" decoding="async">` : ''}</span>
          <span class="ps-hit__text"><span class="ps-hit__oem">${oemHtml(h)}</span><span class="ps-hit__name">${esc(h.rec.n)}</span><span class="ps-hit__sec">${esc(h.rec.st)}</span></span>
        </a>
        <button type="button" class="ps-hit__add" data-ps-add="${n}" aria-label="Add ${esc(h.rec.o)} ${esc(h.rec.n)} to quote">Add</button></li>`,
      )
      .join('');
    extra.innerHTML =
      hits.length > MAX
        ? `<button type="button" class="ps-more" data-ps-all>See all ${hits.length} results</button>`
        : '';
    status.textContent = `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`;
    show(true);
    setActive(-1);
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
    const opts = options();
    if (active >= 0 && opts[active]) return go(hits[active].rec.u);
    if (!entries.length) {
      void loadIndex().then(commit).catch(() => apply(value));
      return;
    }
    const top = search(value)[0];
    if (top && top.score >= 100) return go(top.rec.u);
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
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (panel.hidden && input.value.trim()) render();
      if (!options().length) return;
      e.preventDefault();
      const len = options().length;
      const down = e.key === 'ArrowDown';
      setActive(active < 0 ? (down ? 0 : len - 1) : (active + (down ? 1 : -1) + len) % len);
    } else if (e.key === 'Escape') {
      if (!panel.hidden) {
        e.preventDefault();
        show(false);
      }
    }
  });
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget as Node)) show(false);
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target as Node)) show(false);
  });
  panel.addEventListener('click', (e) => {
    const t = e.target as Element;
    const add = t.closest<HTMLElement>('[data-ps-add]');
    if (add) {
      const rec = hits[Number(add.dataset.psAdd)].rec;
      addPart({ id: rec.i, title: rec.n, oem: rec.o, cm: rec.c, section: rec.st, url: rec.u, thumb: rec.p }, 1);
      add.textContent = '✓ Added';
      window.setTimeout(() => (add.textContent = 'Add'), 1500);
      return;
    }
    if (t.closest('[data-ps-all]')) apply(input.value.trim());
  });
  // Hover keeps the highlight in sync with the pointer
  list.addEventListener('mousemove', (e) => {
    const opt = (e.target as Element).closest<HTMLElement>('[role="option"]');
    if (opt) setActive(options().indexOf(opt));
  });

  input.setAttribute('aria-controls', list.id || (list.id = `${id}-list`));
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
  // "/" jumps to the search field
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    document.querySelector<HTMLInputElement>('[data-part-search] input')?.focus();
  });
  // The store home loads the index when the browser is idle
  if (location.pathname === '/shop/' || new URLSearchParams(location.search).has('q')) {
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 600));
    idle(() => void loadIndex().catch(() => {}));
  }
}

initSearch();
