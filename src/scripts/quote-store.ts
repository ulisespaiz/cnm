// The quote list ("cart") lives in the visitor's browser until they submit it.
// Storage can be unavailable (private mode, blocked site data), so every
// access is guarded and the list falls back to memory for the visit.
//
// v2 adds part numbers, per-line notes, custom lines (parts not in the
// catalog) and a stable quote reference. v1 lists are migrated on first read.

export type QuoteKind = 'part' | 'service' | 'custom';

export interface QuoteItem {
  key: string; // part: part id; service: "service:<slug>"; custom: "custom:<oem key>"
  kind: QuoteKind;
  id: string;
  title: string;
  oem?: string; // Hayssen part number, display form
  cm?: string; // C&M catalog number
  section?: string; // "Stagger Parts"
  thumb?: string; // small image URL for the list
  url?: string; // absent for custom lines
  options: Record<string, string>;
  qty: number; // 1-999
  note?: string; // per-line note, max 300 chars
}

interface QuoteState {
  ref: string; // Q-YYMMDD-XXXX, stable for this quote
  items: QuoteItem[];
}

const STORAGE_KEY = 'quote-list-v2';
const LEGACY_KEY = 'quote-list-v1';
let memory: QuoteState | null = null;

const clampQty = (n: number) => Math.max(1, Math.min(999, Math.round(Number(n)) || 1));

function newRef() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `Q-${ymd}-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

function read(): QuoteState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as QuoteState;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const items = (JSON.parse(legacy) as Omit<QuoteItem, 'kind'>[]).map((i) => ({
        ...i,
        kind: (i.id.startsWith('service:') ? 'service' : 'part') as QuoteKind,
      }));
      const state = { ref: newRef(), items };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.removeItem(LEGACY_KEY);
      return state;
    }
  } catch {
    return (memory ??= { ref: newRef(), items: [] });
  }
  // Nothing stored yet: start a quote and persist its reference right away
  // so it stays the same across pages.
  const fresh = (memory ??= { ref: newRef(), items: [] });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    // memory only
  }
  return fresh;
}

function write(state: QuoteState) {
  memory = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // memory copy still holds the list for this page view
  }
  renderCount();
  document.dispatchEvent(new CustomEvent('quote:change'));
}

const save = (items: QuoteItem[]) => write({ ...read(), items });

export const getItems = (): QuoteItem[] => read().items;

// Stable reference for this quote; shown to the customer before and after
// sending so emailed drawings can be matched to the request.
export const quoteRef = () => read().ref;

const itemKey = (id: string, options: Record<string, string>) => {
  const opts = Object.entries(options)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(';');
  return opts ? `${id}|${opts}` : id;
};

// Adds (or merges into) a line. Returns the resulting line.
export function addItem(item: Omit<QuoteItem, 'key' | 'kind' | 'options'> & { kind?: QuoteKind; options?: Record<string, string> }) {
  const items = getItems();
  const options = item.options ?? {};
  const kind: QuoteKind = item.kind ?? (item.id.startsWith('service:') ? 'service' : 'part');
  const key = itemKey(item.id, options);
  const existing = items.find((i) => i.key === key);
  let line: QuoteItem;
  if (existing) {
    existing.qty = clampQty(existing.qty + item.qty);
    line = existing;
  } else {
    line = { ...item, kind, options, key, qty: clampQty(item.qty) };
    items.push(line);
  }
  save(items);
  return line;
}

// A part that is not in the catalog, identified only by the number typed.
export function addCustom({ oem, qty = 1, note }: { oem: string; qty?: number; note?: string }) {
  const clean = oem.trim().toUpperCase();
  return addItem({
    kind: 'custom',
    id: `custom:${clean.replace(/[^A-Z0-9]/g, '')}`,
    title: `Part # ${clean} (not in catalog)`,
    oem: clean,
    qty,
    note,
  });
}

export function setQty(key: string, qty: number) {
  save(getItems().map((i) => (i.key === key ? { ...i, qty: clampQty(qty) } : i)));
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

// "3 parts (7 pieces)"
export function countLabel(items = getItems()) {
  const lines = items.length;
  const units = items.reduce((n, i) => n + i.qty, 0);
  return `${lines} ${lines === 1 ? 'item' : 'items'} (${units} ${units === 1 ? 'piece' : 'pieces'})`;
}

// Plain-text summary that goes into the email body. Part numbers first so
// the shop can read the order without opening links.
export function summarize(items = getItems()) {
  if (!items.length) return 'No items selected.';
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return items
    .map((i, n) => {
      const head =
        i.kind === 'custom'
          ? `${n + 1}. [NOT IN CATALOG] ${i.oem ?? i.title} | qty ${i.qty}`
          : i.kind === 'service'
            ? `${n + 1}. SERVICE | ${i.title} | qty ${i.qty}`
            : `${n + 1}. ${i.oem ?? ''} | ${i.cm ?? ''} | ${i.title} | qty ${i.qty}`;
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
