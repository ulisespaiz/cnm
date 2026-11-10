// /quote/ page behaviour: the items list, summary, reference, the bulk paste
// panel and the links that add a line: /quote/?part=<number> (the store) and
// /quote/?service=<id> (the service pages).
//
// Parts shop switch (site.store.enabled): the page root carries data-shop="off"
// while the shop is off. Then there is no catalog index to fetch (it would 302
// to this page), so a typed part number is added as a plain "look it up" line.

import { addCustom, addItem, countLabel, getItems, quoteRef, removeItem, restoreItem, setNote, setQty, type QuoteItem } from './quote-store';
import { showToast } from './toast';
import { scrollBehavior } from './scroll-to';
import { buildMatcher, parseBulk, sharedNote, type BulkResult, type IndexRecord, type Matcher } from './bulk-parse';

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

const placeholder = () => h('span', { class: 'qi__ph' }, placeholderIcon());

const shopOff = document.querySelector<HTMLElement>('.quote-page')?.dataset.shop === 'off';

// A catalog part with no OEM number is labelled by its C&M number.
const label = (item: QuoteItem) => item.oem ?? (item.kind === 'part' ? item.cm : undefined) ?? item.title;

// A number we do not list is still a request we want: say what happens to it. With the shop off there
// is no catalog to be missing from.
const NOT_LISTED = "Not in our catalog yet: we'll check it and quote it.";
const WILL_CHECK = "We'll check it and quote it.";

// updateRow() flatMaps this, so it is always a list.
function metaText(item: QuoteItem) {
  if (item.kind === 'service') return ['Service'];
  if (item.kind === 'custom') return [item.noCatalog ? WILL_CHECK : NOT_LISTED];
  return [item.oem && `OEM # ${item.oem}`, item.cm && `C&M # ${item.cm}`].filter(Boolean) as string[];
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

  const thumb = item.thumb ? h('img', { src: item.thumb, alt: '', width: 56, height: 75, loading: 'lazy', decoding: 'async' }) : placeholder();
  // A thumbnail that cannot load (stale URL in an old list) gives way to the placeholder, not a broken-image icon.
  if (thumb instanceof HTMLImageElement) thumb.addEventListener('error', () => thumb.replaceWith(placeholder()), { once: true });
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
    placeholder: 'Note (left-hand, material)', // short: a placeholder cannot wrap, and this row is only 220px wide inside at 320px
    'aria-label': `Note for ${name}`,
    autocomplete: 'off',
  });
  noteInput.hidden = true;
  noteInput.addEventListener('input', () => setNote(key, noteInput.value));

  // A service is asked for, not counted: its line has no quantity.
  let stepper: HTMLElement | null = null;
  if (item.kind !== 'service') {
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
    stepper = h('div', { class: 'qi__stepper', role: 'group', 'aria-label': `Quantity of ${name}` }, minus, qty, plus);
  }

  const remove = h('button', { type: 'button', class: 'qi__link qi__remove', 'data-action': 'remove', 'aria-label': `Remove ${name}`, text: 'Remove' });

  const li = h(
    'li',
    { class: `qi qi--${item.kind}`, 'data-key': key, tabindex: -1 }, // focusable by script: Undo lands on the restored row
    thumbBox,
    h('div', { class: 'qi__main' }, title, meta, options, noteToggle),
    h('div', { class: 'qi__controls' }, stepper, remove),
    noteInput, // last child: it gets a full-width row of its own (QuoteItems.astro)
  );
  li.dataset.noteId = noteId;
  return li;
}

function updateRow(li: HTMLLIElement, item: QuoteItem) {
  const q = <T extends HTMLElement>(sel: string) => li.querySelector<T>(sel)!;
  q('.qi__name').textContent = item.title;
  // Each code in its own no-wrap span so CM-0005 never splits at the hyphen. The sentence on a line
  // that is not a catalog part wraps like any text.
  const metaEl = q('.qi__meta:not(.qi__opts)');
  const codes = metaText(item);
  metaEl.replaceChildren(
    ...codes.flatMap((text, i) => {
      const span = document.createElement('span');
      if (item.kind === 'part') span.className = 'qi__code';
      span.textContent = text;
      return i ? [document.createTextNode(' · '), span] : [span];
    }),
  );
  const opts = q('.qi__opts');
  opts.textContent = Object.entries(item.options)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
  opts.hidden = !opts.textContent;

  const qty = li.querySelector<HTMLInputElement>('.qi__qty'); // none on a service line
  if (qty && document.activeElement !== qty) qty.value = String(item.qty);

  const note = q<HTMLInputElement>('.qi__note');
  const toggle = q<HTMLButtonElement>('[data-action="note"]');
  if (document.activeElement !== note) note.value = item.note ?? '';
  const open = !note.hidden || !!item.note;
  note.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'Hide note' : 'Add note';
  toggle.hidden = !!item.note; // a note that is set stays visible
}

const root = document.documentElement;

// ---------- Links that add a line: ?service=<id> and ?part=<number>[&qty=n] ----------
// Read here, added further down. The parameters leave the address at once, so a reload does not add the
// line again; the hash stays (a service page links to /quote/?service=<id>#details), and so does any
// other parameter.
const params = new URLSearchParams(location.search);
// 40 characters is longer than any part number; a longer value is junk or an attempt to overflow the list.
const urlPart = [...(params.get('part') ?? '').trim()].slice(0, 40).join('').trim();
const urlQty = Math.max(1, Math.min(999, Math.round(Number(params.get('qty'))) || 1));
const urlService = params.get('service') ?? '';
const ADD_PARAMS = ['part', 'qty', 'service'];
if (ADD_PARAMS.some((name) => params.has(name))) {
  ADD_PARAMS.forEach((name) => params.delete(name));
  const rest = params.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
}
// A ?part= number is looked up in the catalog index, which has to load first. Until it has, the page
// stays drawn as public/quote-early.js flagged it, with the list's blocks and room for the row, so an
// empty list does not show its short note first and then push the form down.
let lookingUp = !!urlPart && !shopOff;

function render() {
  const items = getItems();
  const filled = items.length > 0 || lookingUp;
  root.dataset.quote = filled ? 'filled' : 'empty'; // public/quote-early.js sets it before first paint
  emptyState.hidden = filled;
  filledStates.forEach((el) => (el.hidden = !filled));
  countLine.textContent = items.length || !lookingUp ? countLabel(items) : 'Adding your part…';

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
      // The focused button's row is gone: park focus on the next line's Remove button, or the empty-state
      // heading. The toast then moves it to Undo and, if Undo is dismissed unused, back to this spot.
      const next = neighbour?.isConnected ? neighbour.querySelector<HTMLElement>('[data-action="remove"]') : null;
      (next ?? document.querySelector<HTMLElement>('[data-quote-empty-title]'))?.focus({ preventScroll: true });
      showToast(`Removed ${label(removed.item)}`, {
        actionLabel: 'Undo',
        focusAction: true,
        onAction: () => {
          restoreItem(removed.item, removed.index);
          rows.get(removed.item.key)?.focus();
        },
      });
    }
  }
});

document.querySelector('[data-clear-all]')?.addEventListener('click', () => {
  const before = getItems();
  if (!before.length) return;
  before.forEach((i) => removeItem(i.key));
  // The button left with the list: park focus on the empty-state heading, as after removing the last line.
  document.querySelector<HTMLElement>('[data-quote-empty-title]')?.focus({ preventScroll: true });
  showToast(`Removed ${before.length} ${before.length === 1 ? 'item' : 'items'}`, {
    actionLabel: 'Undo',
    focusAction: true,
    onAction: () => {
      before.forEach((item, index) => restoreItem(item, index));
      rows.get(before[0].key)?.focus();
    },
  });
});

// A list saved while the shop was on can hold catalog lines. Their /shop/ pages now
// redirect here, so turn each into a plain part-number line (no link, no thumbnail).
if (shopOff) {
  for (const item of getItems().filter((i) => i.kind === 'part')) {
    removeItem(item.key);
    addCustom({ oem: item.oem ?? item.cm ?? item.title, qty: item.qty, note: item.note, catalog: false });
  }
}

// ---------- /quote/?service=<id> ----------
// A service page's "Request a quote" link. The service becomes a line of the list, once: asking again
// (a second visit, the Back button) adds nothing and says nothing. Only an id of the services
// collection is taken, which src/pages/quote/index.astro renders with its title on the early script.
function addServiceFromUrl() {
  if (!urlService) return;
  let titles: Record<string, unknown> = {};
  try {
    titles = JSON.parse(document.querySelector<HTMLElement>('script[data-services]')?.dataset.services ?? '{}');
  } catch {
    // no list of services on the page: nothing is added
  }
  const title = Object.prototype.hasOwnProperty.call(titles, urlService) ? titles[urlService] : undefined;
  if (typeof title !== 'string') return;
  const id = `service:${urlService}`;
  if (getItems().some((i) => i.id === id)) return;
  addItem({ kind: 'service', id, title, url: `/services/${urlService}/`, qty: 1 });
  showToast(`${title} added to your request`);
}
addServiceFromUrl(); // before the first render: the line is there when the list is first drawn

// Any change to the list, in this tab or (through the storage event quote-store.ts listens for) another.
document.addEventListener('quote:change', render);
render();
// quote-early.js reserved room for the rows until they were drawn; a part still being looked up for an
// empty list keeps its row until it arrives.
const releaseRows = () => root.style.removeProperty('--quote-rows');
if (!lookingUp || getItems().length) releaseRows();

// Back or forward can restore this page from memory with a list that has since been sent or changed.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});

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
  oem: rec.o || undefined, // a part with no OEM number is quoted by its C&M number
  cm: rec.c || undefined,
  section: rec.st,
  thumb: rec.p || undefined,
  url: rec.u,
  qty,
  note,
});

// ---------- /quote/?part=<number>[&qty=n] ----------

async function addFromUrl() {
  const part = urlPart;
  if (!part) return;
  const qty = urlQty;
  const added = `Added ${qty} × OEM # ${part.toUpperCase()}`;
  if (shopOff) {
    addCustom({ oem: part, qty, catalog: false });
    showToast(`${added}. ${WILL_CHECK}`);
    return;
  }
  // From here on a line is always added, so the list is never empty once the look-up is over.
  const found = await loadIndex().then(
    (index) => ({ recs: index.findAll(part) }),
    () => null, // the index could not load: keep the number rather than lose it
  );
  lookingUp = false;
  if (found && found.recs.length > 1) {
    // A number several parts share: never pick one silently. One line for the number, with a note that
    // names every part it could be, and a toast that says so.
    const recs = found.recs;
    addCustom({ oem: recs[0].o, qty, note: sharedNote(recs), catalog: false });
    showToast(`Added ${qty} × OEM # ${recs[0].o}. ${recs.length} parts share this number: ${recs.map((r) => `${r.n} (${r.c})`).join(' and ')}. We'll confirm which one you need.`, {
      duration: 10000,
    });
  } else if (found?.recs.length) {
    const rec = found.recs[0];
    addItem(lineFromRecord(rec, qty));
    showToast(`Added ${qty} × ${rec.o ? `OEM # ${rec.o}` : `C&M # ${rec.c}`} · ${rec.n}`);
  } else {
    addCustom({ oem: part, qty });
    showToast(found ? `${added}. ${NOT_LISTED}` : added);
  }
  releaseRows();
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
  const picks: number[] = []; // a shared number: the index of the part chosen, -1 while none is

  const openBulk = (scroll: boolean) => {
    bulk.open = true;
    if (scroll) bulk.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
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
    if (check.getAttribute('aria-disabled') === 'true') return; // busy: aria-disabled keeps focus on the button
    if (!text.value.trim()) return showError('Paste at least one part number first.');
    check.setAttribute('aria-disabled', 'true');
    try {
      const matcher = await loadIndex();
      const res = parseBulk(text.value, matcher);
      if (res.tooMany) return showError(`That is ${res.total} lines. Please paste 200 lines or fewer at a time.`);
      result = res;
      message.hidden = true;
      qtys.length = 0;
      included.length = 0;
      picks.length = 0;
      tbody.replaceChildren(
        ...res.rows.map((row, i) => {
          qtys[i] = row.qty;
          // A line that is not in the catalog is ticked when it looks like a part number (it is checked and
          // quoted); a line of words is not, so stray text from a pasted email stays out of the quote.
          included[i] = row.kind !== 'miss' || row.likely;
          picks[i] = -1;
          const qty = h('input', { class: 'bk__qty', type: 'number', min: 1, max: 999, inputmode: 'numeric', value: row.qty });
          const qtyName = row.kind === 'match' ? row.rec.o || row.rec.c : row.kind === 'choose' ? row.recs[0].o : row.text;
          qty.setAttribute('aria-label', `Quantity of ${qtyName}`);
          qty.addEventListener('change', () => {
            qtys[i] = Math.max(1, Math.min(999, Math.round(Number(qty.value)) || 1));
            qty.value = String(qtys[i]);
          });
          const dup = row.lines.length > 1 ? h('span', { class: 'bk__dup', text: `${row.lines.length} lines merged` }) : null;
          const note = row.note ? h('span', { class: 'bk__note', text: `Note: ${row.note}` }) : null;
          if (row.kind === 'match') {
            const rec = row.rec;
            return h(
              'li',
              { class: 'bk__row bk__row--ok' },
              rec.p ? h('img', { src: rec.p, alt: '', width: 36, height: 48, loading: 'lazy' }) : h('span', { class: 'bk__ph' }),
              h('div', { class: 'bk__what' }, h('strong', { text: rec.o || rec.c || '' }), h('span', { text: rec.n }), note, dup),
              h('span', { class: 'bk__state', text: 'Matched' }),
              qty,
            );
          }
          if (row.kind === 'choose') {
            // Several parts share this number: list them all, choose none. A row left unchosen is still added,
            // as one line that names them all (sharedNote), and the shop confirms which.
            const oem = row.recs[0].o;
            const group = `bulk-pick-${i}`;
            const legend = h('legend', { class: 'bk__legend', text: `${row.recs.length} parts share this OEM #: choose one` });
            const options = row.recs.map((rec, n) => {
              const radio = h('input', { type: 'radio', name: group, value: n, id: `${group}-${n}` });
              radio.addEventListener('change', () => {
                if ((radio as HTMLInputElement).checked) picks[i] = n;
              });
              return h(
                'label',
                { class: 'bk__opt', for: `${group}-${n}` },
                radio,
                rec.p ? h('img', { src: rec.p, alt: '', width: 27, height: 36, loading: 'lazy' }) : h('span', { class: 'bk__ph bk__ph--sm' }),
                h('span', { class: 'bk__optname' }, h('span', { text: rec.n }), h('span', { class: 'bk__optcm', text: `C&M # ${rec.c ?? ''}` })),
              );
            });
            return h(
              'li',
              { class: 'bk__row bk__row--choose' },
              h('span', { class: 'bk__ph' }),
              h('div', { class: 'bk__what' }, h('strong', { text: oem }), h('span', { text: 'Not sure which? Leave it and we will confirm.' }), note, dup),
              qty,
              h('fieldset', { class: 'bk__pick' }, legend, ...options),
            );
          }
          const box = h('input', { type: 'checkbox', checked: included[i], id: `bulk-add-${i}` });
          box.addEventListener('change', () => {
            included[i] = (box as HTMLInputElement).checked;
            updateAdd();
          });
          return h(
            'li',
            { class: `bk__row bk__row--miss${row.likely ? '' : ' bk__row--junk'}` },
            h('span', { class: 'bk__ph' }),
            h(
              'div',
              { class: 'bk__what' },
              h('strong', { text: row.text }),
              h('span', { text: row.likely ? "Not in our catalog yet: we'll check it and quote it." : "This doesn't look like a part number." }),
              note,
              dup,
            ),
            h('label', { class: 'bk__anyway', for: `bulk-add-${i}` }, box, ' Add anyway'),
            qty,
          );
        }),
      );
      const parts = [`${res.matched} matched`, `${res.missing} not found`];
      if (res.choose) parts.push(`${res.choose} to choose`);
      if (res.merged) parts.push(`${res.merged} duplicate ${res.merged === 1 ? 'line' : 'lines'} merged`);
      summary.textContent = parts.join(' · ');
      preview.hidden = false;
      updateAdd();
      summary.focus(); // the button stays enabled and focused, but the result is below it: read it out and bring it into view
    } catch {
      showError('We could not load the parts list. Please try again, or describe the parts in the form.');
    } finally {
      check.removeAttribute('aria-disabled');
    }
  });

  addBtn.addEventListener('click', () => {
    if (!result) return;
    let n = 0;
    result.rows.forEach((row, i) => {
      if (!included[i]) return;
      if (row.kind === 'match') addItem(lineFromRecord(row.rec, qtys[i], row.note));
      else if (row.kind === 'choose') {
        const rec = row.recs[picks[i]];
        if (rec) addItem(lineFromRecord(rec, qtys[i], row.note));
        else addCustom({ oem: row.recs[0].o, qty: qtys[i], note: [sharedNote(row.recs), row.note].filter(Boolean).join(' '), catalog: false });
      } else addCustom({ oem: row.text, qty: qtys[i], note: row.note });
      n++;
    });
    showToast(`Added ${n} ${n === 1 ? 'line' : 'lines'} to your quote`);
    text.value = '';
    result = null;
    preview.hidden = true;
    message.hidden = true;
    bulk.open = false; // the button that had focus is now hidden: take focus to the list it added to
    document.getElementById('items-title')?.focus({ preventScroll: true });
    document.querySelector('[data-quote-items]')?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  });
}

// ---------- "Can't find your part?" (#cant-find, or the form's own #request inside it) ----------
// A link to the closed panel opens it: the notice quote-store.ts shows when the list cannot be saved,
// and the how-to-order page, point here.
const request = document.getElementById('cant-find') as HTMLDetailsElement | null;
const openRequest = () => {
  if (request && (location.hash === '#cant-find' || location.hash === '#request')) request.open = true;
};
openRequest();
window.addEventListener('hashchange', openRequest);

addFromUrl();
