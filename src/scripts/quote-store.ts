// The quote list ("cart") lives in the visitor's browser until they submit it.
// Storage can be unavailable (private mode, blocked site data), so every
// access is guarded and the list falls back to memory for the visit.
//
// v2 adds part numbers, per-line notes, custom lines (parts not in the
// catalog) and a stable quote reference. v1 lists are migrated on first read.

import { showToast, type ToastPart } from './toast';

export type QuoteKind = 'part' | 'service' | 'custom';

export interface QuoteItem {
  key: string; // part: part id; service: "service:<slug>"; custom: "custom:<oem key>"
  kind: QuoteKind;
  id: string;
  title: string;
  oem?: string; // OEM part number, display form; absent for a catalog part that has none (use cm)
  cm?: string; // C&M catalog number
  section?: string; // "Stagger Parts"
  thumb?: string; // small image URL for the list
  url?: string; // absent for custom lines
  options: Record<string, string>;
  qty: number; // 1-999; a service has no quantity, so its line is always 1
  note?: string; // per-line note, max 300 chars
  noCatalog?: boolean; // custom line made while the parts shop is off: there is no catalog to be "not in"
}

interface QuoteState {
  ref: string; // Q-YYMMDD-XXXX, stable for this quote
  items: QuoteItem[];
}

export const STORAGE_KEY = 'quote-list-v2';
const LEGACY_KEY = 'quote-list-v1';
let memory: QuoteState | null = null;
// The last save was refused (private mode, quota): the copy in memory is the truth until a save works again.
let persistFailed = false;

const clampQty = (n: unknown) => Math.max(1, Math.min(999, Math.round(Number(n)) || 1));
// A service is asked for, not counted: its line stays at 1 whatever was stored or passed in.
const qtyFor = (kind: QuoteKind, n: unknown) => (kind === 'service' ? 1 : clampQty(n));
// A number that was typed, not picked from the catalog, is named by the number alone.
const customTitle = (oem: string) => `OEM # ${oem}`;

function newRef() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `Q-${ymd}-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

// ---------- Reading what is stored ----------
// The stored value is only trusted after it is checked: old versions, hand edits and other
// scripts on the origin can leave anything there.

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const KINDS: readonly unknown[] = ['part', 'service', 'custom'];

// One stored line, repaired where it can be. Only an object with a string key, id and title is a line.
function cleanItem(raw: unknown): QuoteItem | null {
  if (!isObject(raw) || typeof raw.key !== 'string' || typeof raw.id !== 'string' || typeof raw.title !== 'string') return null;
  const options: Record<string, string> = {};
  if (isObject(raw.options)) {
    for (const [k, v] of Object.entries(raw.options)) if (typeof v === 'string' || typeof v === 'number') options[k] = String(v);
  }
  const kind: QuoteKind = KINDS.includes(raw.kind) ? (raw.kind as QuoteKind) : raw.id.startsWith('service:') ? 'service' : raw.id.startsWith('custom:') ? 'custom' : 'part';
  const item: QuoteItem = {
    key: raw.key,
    kind,
    id: raw.id,
    title: raw.title,
    options,
    qty: qtyFor(kind, raw.qty),
  };
  for (const field of ['oem', 'cm', 'section', 'thumb', 'url', 'note'] as const) {
    const v = raw[field];
    if (typeof v === 'string' && v) item[field] = v;
  }
  if (item.url) item.url = currentPartUrl(item.url);
  // Lines saved earlier carried "(not in catalog)" in the title.
  if (kind === 'custom' && item.oem) item.title = customTitle(item.oem);
  if (raw.noCatalog === true) item.noCatalog = true;
  return item;
}

// A list saved before the machine was renamed holds part pages under the old machine folder. The old
// address still works (a 301), but the list and the quote email should carry the current one: whatever the
// machine folder was called, a part page lives at /shop/vffs/<section>/<id>/ now.
function currentPartUrl(url: string) {
  return url.replace(/^\/shop\/[^/]+\/(?=[^/]+\/[^/]+\/?$)/, '/shop/vffs/');
}

// Two lines are the same catalog part when they share a C&M number (unique per part) and options, even
// when the part page was renamed since the line was saved (its id, so its key, changed); any other
// line is the same only when the keys match.
const optionsKey = (options: Record<string, string>) =>
  Object.entries(options)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(';');
const identity = (i: Pick<QuoteItem, 'key' | 'kind' | 'cm' | 'options'>) => (i.kind === 'part' && i.cm ? `cm:${i.cm}|${optionsKey(i.options)}` : i.key);

// Lines that repeat a key or a catalog part (a broken list, a part renamed since it was saved) are folded
// into the first one.
function cleanItems(list: unknown[]): QuoteItem[] {
  const byIdentity = new Map<string, QuoteItem>();
  for (const raw of list) {
    const item = cleanItem(raw);
    if (!item) continue;
    const prev = byIdentity.get(identity(item));
    if (prev) prev.qty = qtyFor(prev.kind, prev.qty + item.qty);
    else byIdentity.set(identity(item), item);
  }
  return [...byIdentity.values()];
}

// `fixed`: the stored text differs from the clean state, so the caller writes the repair back.
function parseState(raw: string): { state: QuoteState; fixed: boolean } | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || typeof data.ref !== 'string' || !data.ref || !Array.isArray(data.items)) return null;
  const items = cleanItems(data.items);
  const tidy = (i: unknown) =>
    isObject(i) &&
    isObject(i.options) &&
    i.qty === clampQty(i.qty) &&
    KINDS.includes(i.kind) &&
    (i.kind !== 'service' || i.qty === 1) &&
    (typeof i.url !== 'string' || i.url === currentPartUrl(i.url));
  return { state: { ref: data.ref, items }, fixed: items.length !== data.items.length || !data.items.every(tidy) };
}

// v1 lists had no kind and no reference, and their keys differ from v2's: rebuild each key so the
// same part added later merges into the migrated line.
function migrateV1(legacy: string): QuoteState {
  let items: QuoteItem[] = [];
  try {
    const parsed: unknown = JSON.parse(legacy);
    if (Array.isArray(parsed)) {
      items = cleanItems(
        parsed.flatMap((i) => {
          if (!isObject(i) || typeof i.id !== 'string') return [];
          const options = isObject(i.options) ? (i.options as Record<string, string>) : {};
          return [{ ...i, key: itemKey(i.id, options), title: typeof i.title === 'string' ? i.title : i.id, options }];
        }),
      );
    }
  } catch {
    // an unreadable v1 list is dropped: the quote starts empty
  }
  return { ref: newRef(), items };
}

function persist(state: QuoteState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    persistFailed = false;
  } catch {
    persistFailed = true; // the memory copy holds the list for this page view
  }
}

function read(): QuoteState {
  if (persistFailed && memory) return memory;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? parseState(raw) : null;
    if (stored) {
      if (stored.fixed) {
        memory = stored.state;
        persist(stored.state); // write the repair back
      }
      return stored.state;
    }
    // A value that fails the check counts as missing: it is overwritten below.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy !== null) {
      const state = (memory = migrateV1(legacy));
      persist(state);
      // Keep the old list when the new one could not be saved; otherwise it has served its purpose.
      if (!persistFailed) localStorage.removeItem(LEGACY_KEY);
      return state;
    }
  } catch {
    return (memory ??= { ref: newRef(), items: [] });
  }
  // Nothing usable stored yet: start a quote and persist its reference right away
  // so it stays the same across pages.
  const fresh = (memory ??= { ref: newRef(), items: [] });
  persist(fresh);
  return fresh;
}

function write(state: QuoteState) {
  memory = state;
  persist(state);
  if (persistFailed && state.items.length) warnNotSaved();
  renderCount();
  document.dispatchEvent(new CustomEvent('quote:change'));
}

// ---------- A list this browser will not keep ----------
// With site storage blocked or full the list lives in this page only: the next page starts empty, so
// "Added" followed by "View quote" would lead to nothing. Say so, once, and offer the two ways that do
// not need the list: the phone and the part request form on the quote page.
const WARNED_KEY = 'quote-not-saved-told';
let warned = false;

// The phone number as the page shows it (header and footer render it from src/config/site.ts).
function pagePhone(): ToastPart | null {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"]')];
  for (const a of links) {
    const shown = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.exec(a.textContent ?? '')?.[0];
    if (shown) return { label: shown, href: a.getAttribute('href')! };
  }
  return links.length ? { label: links[0].getAttribute('href')!.slice(4), href: links[0].getAttribute('href')! } : null;
}

function warnNotSaved() {
  if (warned) return;
  warned = true;
  try {
    // Session storage can still work when the list cannot be saved (a full quota): then once per visit, not per page.
    if (sessionStorage.getItem(WARNED_KEY)) return;
    sessionStorage.setItem(WARNED_KEY, '1');
  } catch {
    // no storage at all: once per page is the best there is
  }
  const phone = pagePhone();
  const message: ToastPart[] = [
    'This browser is not saving your quote list, so it will be gone when you leave this page. ',
    ...(phone ? ['Call ', phone, ' or '] : ['You can ']),
    { label: 'send us the part number', href: '/quote/#cant-find' },
    '.',
  ];
  // After the click that caused it has run its course: the page's own "Added … View quote" toast comes
  // first, and this notice takes its place.
  window.setTimeout(() => showToast(message, { sticky: true, actionLabel: 'Close', onAction: () => {} }), 0);
}

const save = (items: QuoteItem[]) => write({ ...read(), items });

export const getItems = (): QuoteItem[] => read().items;

// Stable reference for this quote; shown to the customer before and after
// sending so emailed drawings can be matched to the request.
export const quoteRef = () => read().ref;

const itemKey = (id: string, options: Record<string, string>) => {
  const opts = optionsKey(options);
  return opts ? `${id}|${opts}` : id;
};

// Adds (or merges into) a line. Returns the resulting line.
export function addItem(item: Omit<QuoteItem, 'key' | 'kind' | 'options'> & { kind?: QuoteKind; options?: Record<string, string> }) {
  const items = getItems();
  const options = item.options ?? {};
  const kind: QuoteKind = item.kind ?? (item.id.startsWith('service:') ? 'service' : 'part');
  const key = itemKey(item.id, options);
  const wanted = identity({ key, kind, cm: item.cm, options });
  const existing = items.find((i) => i.key === key) ?? items.find((i) => identity(i) === wanted);
  let line: QuoteItem;
  if (existing) {
    existing.qty = qtyFor(existing.kind, existing.qty + item.qty);
    // The same part added again from its current page: point the line at that page.
    if (existing.key !== key && item.url) existing.url = currentPartUrl(item.url);
    line = existing;
  } else {
    line = { ...item, kind, options, key, qty: qtyFor(kind, item.qty) };
    items.push(line);
  }
  save(items);
  return line;
}

// A part that is not in the catalog, identified only by the number typed.
// `catalog: false` is for the parts shop being off: the line is just the number
// to look up, with no "not in catalog" wording (src/scripts/quote-page.ts words both).
export function addCustom({ oem, qty = 1, note, catalog = true }: { oem: string; qty?: number; note?: string; catalog?: boolean }) {
  const clean = [...oem.trim().toUpperCase()].slice(0, 40).join('').trim(); // 40 characters is longer than any part number
  // A number with no letters or digits in it (only accents, symbols) still gets a line of its own.
  const k = clean.replace(/[^A-Z0-9]/g, '') || clean;
  return addItem({
    kind: 'custom',
    id: `custom:${k}`,
    title: customTitle(clean),
    oem: clean,
    qty,
    note,
    ...(catalog ? {} : { noCatalog: true }),
  });
}

export function setQty(key: string, qty: number) {
  save(getItems().map((i) => (i.key === key ? { ...i, qty: qtyFor(i.kind, qty) } : i)));
}

export function setNote(key: string, note: string) {
  const text = note.slice(0, 300).trim();
  save(getItems().map((i) => (i.key === key ? { ...i, note: text || undefined } : i)));
}

// Returns the removed line (and its position) so the caller can offer Undo.
export function removeItem(key: string) {
  const items = getItems();
  const index = items.findIndex((i) => i.key === key);
  const removed = index >= 0 ? items[index] : undefined;
  save(items.filter((i) => i.key !== key));
  return removed ? { item: removed, index } : undefined;
}

export function restoreItem(item: QuoteItem, index: number) {
  const items = getItems().filter((i) => i.key !== item.key);
  items.splice(Math.min(index, items.length), 0, item);
  save(items);
}

// Clears the list and starts a new quote reference (after a successful send).
export function clearItems() {
  write({ ref: newRef(), items: [] });
}

export const lineCount = () => getItems().length;
export const unitCount = () => getItems().reduce((n, i) => n + i.qty, 0);
/** @deprecated use lineCount / unitCount */
export const totalCount = unitCount;

// Header badge, mobile bar and any [data-quote-count] element show the
// number of lines (distinct parts/services), not pieces.
export function renderCount() {
  const n = lineCount();
  document.querySelectorAll<HTMLElement>('[data-quote-count]').forEach((el) => {
    el.textContent = String(n);
    el.hidden = n === 0;
  });
  document.querySelectorAll<HTMLElement>('[data-quote-has-items]').forEach((el) => {
    el.dataset.quoteHasItems = n > 0 ? 'true' : 'false';
  });
}

// "3 items (7 pieces)". Services are lines but not pieces: a list of services alone is "1 item".
export function countLabel(items = getItems()) {
  const lines = items.length;
  const counted = items.filter((i) => i.kind !== 'service');
  const units = counted.reduce((n, i) => n + i.qty, 0);
  const head = `${lines} ${lines === 1 ? 'item' : 'items'}`;
  return counted.length || !lines ? `${head} (${units} ${units === 1 ? 'piece' : 'pieces'})` : head;
}

// Plain-text summary that goes into the email body. Part numbers first so
// the shop can read the order without opening links.
export function summarize(items = getItems()) {
  if (!items.length) return 'No items in the list: see the message.';
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return items
    .map((i, n) => {
      const head =
        i.kind === 'custom'
          ? `${n + 1}. [${i.noCatalog ? 'OEM # TO LOOK UP' : 'NOT IN CATALOG'}] ${i.oem ? `OEM # ${i.oem}` : i.title} | qty ${i.qty}`
          : i.kind === 'service'
            ? `${n + 1}. SERVICE | ${i.title}`
            : `${n + 1}. ${i.oem ? `OEM # ${i.oem}` : 'no OEM #'} | ${i.cm ? `C&M # ${i.cm}` : 'no C&M #'} | ${i.title} | qty ${i.qty}`;
      const opts = Object.entries(i.options)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      return [
        head,
        i.section ? `   Section: ${i.section}` : '',
        opts ? `   Options: ${opts}` : '',
        i.note ? `   Note: ${i.note}` : '',
        i.url ? `   ${origin}${i.url}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

// The same list with one short line per item, for the mailto: fallback after a failed send (the link
// holds about 1,800 characters in all, and a line that does not fit is counted as left out). Plain ASCII
// "x": a multiplication sign costs six characters once it is in a URL.
export function summaryLines(items = getItems()): string[] {
  return items.map((i) => {
    const what =
      i.kind === 'service'
        ? `Service: ${i.title}`
        : i.kind === 'custom'
          ? `${i.qty} x ${i.oem ? `OEM # ${i.oem}` : i.title} (${i.noCatalog ? 'to look up' : 'not in catalog'})`
          : `${i.qty} x ${[i.oem && `OEM # ${i.oem}`, i.cm && `C&M # ${i.cm}`, i.title].filter(Boolean).join(' | ')}`;
    const opts = Object.entries(i.options)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    return [what, opts, i.note && `Note: ${i.note}`].filter(Boolean).join(' | ');
  });
}

// Another tab changed the list (a null key means all site data was cleared): bring this tab's counts up
// to date and tell the page, so whatever draws the list (src/scripts/quote-page.ts) draws it again.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    renderCount();
    document.dispatchEvent(new CustomEvent('quote:change'));
  });
}
