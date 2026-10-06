// /quote/ page behaviour: the items list, summary, reference, the bulk paste
// panel and the /quote/?part=<number> link the store uses.

import {
  addCustom,
  addItem,
  countLabel,
  getItems,
  quoteRef,
  removeItem,
  restoreItem,
  setNote,
  setQty,
  type QuoteItem,
} from './quote-store';
import { showToast } from './toast';
import { buildMatcher, parseBulk, type BulkResult, type IndexRecord, type Matcher } from './bulk-parse';

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: Child[]
) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...(children.filter(Boolean) as (Node | string)[]));
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function placeholderIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M12 3l7 4v10l-7 4-7-4V7l7-4zm0 0v18M5 7l7 4 7-4');
  svg.append(path);
  return svg;
}

const label = (item: QuoteItem) => item.oem ?? item.title;

function metaText(item: QuoteItem) {
  if (item.kind === 'service') return 'Service';
  if (item.kind === 'custom') return 'Not in catalog';
  return [item.oem && `Hayssen # ${item.oem}`, item.cm && `C&M # ${item.cm}`].filter(Boolean) as string[];
}

// ---------- Items list ----------

const list = document.querySelector<HTMLUListElement>('[data-quote-items]')!;
const emptyState = document.querySelector<HTMLElement>('[data-quote-empty]')!;
const filledStates = document.querySelectorAll<HTMLElement>('[data-quote-filled]');
const countLine = document.querySelector<HTMLElement>('[data-count-line]')!;
const rows = new Map<string, HTMLLIElement>();

function buildRow(item: QuoteItem) {
  const key = item.key;
  const name = label(item);

  const thumb = item.thumb
    ? h('img', { src: item.thumb, alt: '', width: 56, height: 75, loading: 'lazy', decoding: 'async' })
    : h('span', { class: 'qi__ph' }, placeholderIcon());
  const thumbBox = item.url
    ? h('a', { class: 'qi__thumb', href: item.url, tabindex: -1, 'aria-hidden': 'true' }, thumb)
    : h('span', { class: 'qi__thumb' }, thumb);

  const title = item.url ? h('a', { class: 'qi__name', href: item.url, text: item.title }) : h('span', { class: 'qi__name', text: item.title });
  const meta = h('p', { class: 'qi__meta' });
  const options = h('p', { class: 'qi__meta qi__opts' });

  const noteId = `note-${key.replace(/[^\w-]/g, '_')}`;
  const noteToggle = h('button', { type: 'button', class: 'qi__link', 'aria-expanded': 'false', 'aria-controls': noteId, 'data-action': 'note' });
  const noteInput = h('input', {
    id: noteId,
    class: 'qi__note',
    type: 'text',
    maxlength: 300,
    placeholder: 'Note for this item (left-hand, material, etc.)',
    'aria-label': `Note for ${name}`,
    autocomplete: 'off',
  });
  noteInput.hidden = true;
  noteInput.addEventListener('input', () => setNote(key, noteInput.value));

  const minus = h('button', { type: 'button', class: 'qi__step', 'data-action': 'minus', 'aria-label': `Decrease quantity of ${name}`, text: '−' });
  const plus = h('button', { type: 'button', class: 'qi__step', 'data-action': 'plus', 'aria-label': `Increase quantity of ${name}`, text: '+' });
  const qty = h('input', {
    class: 'qi__qty',
    type: 'number',
    min: 1,
    max: 999,
    inputmode: 'numeric',
    'aria-label': `Quantity of ${name}`,
  });
  qty.addEventListener('change', () => setQty(key, Number(qty.value)));

  const remove = h('button', { type: 'button', class: 'qi__link qi__remove', 'data-action': 'remove', 'aria-label': `Remove ${name}`, text: 'Remove' });

  const li = h(
    'li',
    { class: 'qi', 'data-key': key },
    thumbBox,
    h('div', { class: 'qi__main' }, title, meta, options, noteToggle, noteInput),
    h('div', { class: 'qi__controls' }, h('div', { class: 'qi__stepper', role: 'group', 'aria-label': `Quantity of ${name}` }, minus, qty, plus), remove),
  );
  li.dataset.noteId = noteId;
  return li;
}

function updateRow(li: HTMLLIElement, item: QuoteItem) {
  const q = <T extends HTMLElement>(sel: string) => li.querySelector<T>(sel)!;
  q('.qi__name').textContent = item.title;
  // Each code in its own no-wrap span so CM-0005 never splits at the hyphen.
  const metaEl = q('.qi__meta:not(.qi__opts)');
  const codes = metaText(item);
  metaEl.replaceChildren(
    ...codes.flatMap((text, i) => {
      const span = document.createElement('span');
      span.className = 'qi__code';
      span.textContent = text;
      return i ? [document.createTextNode(' · '), span] : [span];
    }),
  );
  const opts = q('.qi__opts');
  opts.textContent = Object.entries(item.options)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
  opts.hidden = !opts.textContent;

  const qty = q<HTMLInputElement>('.qi__qty');
  if (document.activeElement !== qty) qty.value = String(item.qty);

  const note = q<HTMLInputElement>('.qi__note');
  const toggle = q<HTMLButtonElement>('[data-action="note"]');
  if (document.activeElement !== note) note.value = item.note ?? '';
  const open = !note.hidden || !!item.note;
  note.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'Hide note' : 'Add note';
  toggle.hidden = !!item.note; // a note that is set stays visible
}

function render() {
  const items = getItems();
  emptyState.hidden = items.length > 0;
  filledStates.forEach((el) => (el.hidden = items.length === 0));
  countLine.textContent = countLabel(items);

  const live = new Set(items.map((i) => i.key));
  for (const [key, li] of rows) {
    if (!live.has(key)) {
      li.remove();
      rows.delete(key);
    }
  }
  const ordered = items.map((item) => {
    let li = rows.get(item.key);
    if (!li) {
      li = buildRow(item);
      rows.set(item.key, li);
    }
    updateRow(li, item);
    return li;
  });
  const current = [...list.children];
  if (current.length !== ordered.length || current.some((c, i) => c !== ordered[i])) list.replaceChildren(...ordered);

  document.querySelectorAll<HTMLElement>('[data-quote-ref]').forEach((el) => (el.textContent = quoteRef()));
  document.querySelectorAll<HTMLAnchorElement>('[data-ref-mailto]').forEach((a) => {
    a.href = `mailto:${a.dataset.refMailto}?subject=${encodeURIComponent(`Quote ${quoteRef()}: drawing or photo`)}`;
  });
}

list.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  const li = btn?.closest<HTMLLIElement>('li[data-key]');
  if (!btn || !li) return;
  const key = li.dataset.key!;
  const item = getItems().find((i) => i.key === key);
  if (!item) return;
  const action = btn.dataset.action;

  if (action === 'plus') setQty(key, item.qty + 1);
  else if (action === 'minus') setQty(key, item.qty - 1);
  else if (action === 'note') {
    const note = li.querySelector<HTMLInputElement>('.qi__note')!;
    const open = note.hidden;
    note.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Hide note' : 'Add note';
    if (open) note.focus();
  } else if (action === 'remove') {
    const neighbour = li.nextElementSibling ?? li.previousElementSibling;
    const removed = removeItem(key);
    if (removed) {
      // The focused button's row is gone: hand focus to the next line's Remove button, or the empty-state heading.
      const next = neighbour?.isConnected ? neighbour.querySelector<HTMLElement>('[data-action="remove"]') : null;
      (next ?? document.querySelector<HTMLElement>('[data-quote-empty-title]'))?.focus({ preventScroll: true });
      showToast(`Removed ${label(removed.item)}`, {
        actionLabel: 'Undo',
        onAction: () => restoreItem(removed.item, removed.index),
      });
    }
  }
});

document.querySelector('[data-clear-all]')?.addEventListener('click', () => {
  const before = getItems();
  if (!before.length) return;
  before.forEach((i) => removeItem(i.key));
  showToast(`Removed ${before.length} ${before.length === 1 ? 'item' : 'items'}`, {
    actionLabel: 'Undo',
    onAction: () => before.forEach((item, index) => restoreItem(item, index)),
  });
});

document.addEventListener('quote:change', render);
render();

// ---------- Search index (shared by bulk paste and ?part=) ----------

let indexPromise: Promise<Matcher & { records: IndexRecord[] }> | null = null;
function loadIndex() {
  indexPromise ??= fetch('/shop/search-index.json')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<IndexRecord[]>;
    })
    .then((records) => ({ ...buildMatcher(records), records }))
    .catch((err) => {
      indexPromise = null;
      throw err;
    });
  return indexPromise;
}

const lineFromRecord = (rec: IndexRecord, qty: number, note?: string) => ({
  id: rec.i,
  title: rec.n,
  oem: rec.o,
  cm: rec.c || undefined,
  section: rec.st,
  thumb: rec.p || undefined,
  url: rec.u,
  qty,
  note,
});

// ---------- /quote/?part=<number>[&qty=n] ----------

async function addFromUrl() {
  const params = new URLSearchParams(location.search);
  const part = params.get('part')?.trim();
  if (!part) return;
  const qty = Math.max(1, Math.min(999, Math.round(Number(params.get('qty'))) || 1));
  // Drop the parameters first so a reload does not add the part again.
  history.replaceState(null, '', location.pathname + location.hash);
  try {
    const rec = (await loadIndex()).find(part);
    if (rec) {
      addItem(lineFromRecord(rec, qty));
      showToast(`Added ${qty} × ${rec.o} · ${rec.n}`);
    } else {
      addCustom({ oem: part, qty });
      showToast(`Added ${qty} × ${part.toUpperCase()} (not in catalog, we'll look it up)`);
    }
  } catch {
    // The index could not load: keep the number rather than lose it.
    addCustom({ oem: part, qty });
    showToast(`Added ${qty} × ${part.toUpperCase()}`);
  }
}

// ---------- Bulk paste ----------

const bulk = document.getElementById('bulk') as HTMLDetailsElement | null;
if (bulk) {
  const text = bulk.querySelector<HTMLTextAreaElement>('[data-bulk-text]')!;
  const check = bulk.querySelector<HTMLButtonElement>('[data-bulk-check]')!;
  const message = bulk.querySelector<HTMLElement>('[data-bulk-message]')!;
  const preview = bulk.querySelector<HTMLElement>('[data-bulk-preview]')!;
  const tbody = bulk.querySelector<HTMLElement>('[data-bulk-rows]')!;
  const summary = bulk.querySelector<HTMLElement>('[data-bulk-summary]')!;
  const addBtn = bulk.querySelector<HTMLButtonElement>('[data-bulk-add]')!;
  let result: BulkResult | null = null;
  const qtys: number[] = [];
  const included: boolean[] = [];

  const openBulk = (scroll: boolean) => {
    bulk.open = true;
    if (scroll) bulk.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (location.hash === '#bulk') openBulk(false);
  window.addEventListener('hashchange', () => location.hash === '#bulk' && openBulk(true));
  document.addEventListener('click', (event) => {
    const a = (event.target as HTMLElement).closest('a[href="#bulk"]');
    if (a) {
      event.preventDefault();
      openBulk(true);
      text.focus({ preventScroll: true });
    }
  });

  const updateAdd = () => {
    const n = result ? result.rows.filter((_, i) => included[i]).length : 0;
    addBtn.textContent = n === 1 ? 'Add 1 line to quote' : `Add ${n} lines to quote`;
    addBtn.disabled = n === 0;
  };

  const showError = (msg: string) => {
    message.textContent = msg;
    message.hidden = !msg;
    preview.hidden = true;
    result = null;
  };

  check.addEventListener('click', async () => {
    if (!text.value.trim()) return showError('Paste at least one part number first.');
    check.disabled = true;
    try {
      const matcher = await loadIndex();
      const res = parseBulk(text.value, matcher);
      if (res.tooMany) return showError(`That is ${res.total} lines. Please paste 200 lines or fewer at a time.`);
      result = res;
      message.hidden = true;
      qtys.length = 0;
      included.length = 0;
      tbody.replaceChildren(
        ...res.rows.map((row, i) => {
          qtys[i] = row.qty;
          included[i] = true;
          const qty = h('input', { class: 'bk__qty', type: 'number', min: 1, max: 999, inputmode: 'numeric', value: row.qty });
          qty.setAttribute('aria-label', `Quantity of ${row.kind === 'match' ? row.rec.o : row.text}`);
          qty.addEventListener('change', () => {
            qtys[i] = Math.max(1, Math.min(999, Math.round(Number(qty.value)) || 1));
            qty.value = String(qtys[i]);
          });
          const dup = row.lines.length > 1 ? h('span', { class: 'bk__dup', text: `${row.lines.length} lines merged` }) : null;
          if (row.kind === 'match') {
            const rec = row.rec;
            return h(
              'li',
              { class: 'bk__row bk__row--ok' },
              rec.p ? h('img', { src: rec.p, alt: '', width: 36, height: 48, loading: 'lazy' }) : h('span', { class: 'bk__ph' }),
              h('div', { class: 'bk__what' }, h('strong', { text: rec.o }), h('span', { text: rec.n }), dup),
              h('span', { class: 'bk__state', text: 'Matched' }),
              qty,
            );
          }
          const box = h('input', { type: 'checkbox', checked: true, id: `bulk-add-${i}` });
          box.addEventListener('change', () => {
            included[i] = (box as HTMLInputElement).checked;
            updateAdd();
          });
          return h(
            'li',
            { class: 'bk__row bk__row--miss' },
            h('span', { class: 'bk__ph' }),
            h('div', { class: 'bk__what' }, h('strong', { text: row.text }), h('span', { text: 'Not in the catalog' }), dup),
            h('label', { class: 'bk__anyway', for: `bulk-add-${i}` }, box, ' Add anyway'),
            qty,
          );
        }),
      );
      const parts = [`${res.matched} matched`, `${res.missing} not found`];
      if (res.merged) parts.push(`${res.merged} duplicate ${res.merged === 1 ? 'line' : 'lines'} merged`);
      summary.textContent = parts.join(' · ');
      preview.hidden = false;
      updateAdd();
    } catch {
      showError('We could not load the parts list. Please try again, or describe the parts in the form.');
    } finally {
      check.disabled = false;
    }
  });

  addBtn.addEventListener('click', () => {
    if (!result) return;
    let n = 0;
    result.rows.forEach((row, i) => {
      if (!included[i]) return;
      if (row.kind === 'match') addItem(lineFromRecord(row.rec, qtys[i], row.note));
      else addCustom({ oem: row.text, qty: qtys[i], note: row.note });
      n++;
    });
    showToast(`Added ${n} ${n === 1 ? 'line' : 'lines'} to your quote`);
    text.value = '';
    result = null;
    preview.hidden = true;
    message.hidden = true;
    bulk.open = false;
    document.querySelector('[data-quote-items]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

addFromUrl();
