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
  oem?: string; // OEM part number, display form; absent for a catalog part that has none (use cm)
  cm?: string; // C&M catalog number
  section?: string; // "Stagger Parts"
  thumb?: string; // small image URL for the list
  url?: string; // absent for custom lines
  options: Record<string, string>;
  qty: number; // 1-999
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
  const item: QuoteItem = {
    key: raw.key,
    kind: KINDS.includes(raw.kind) ? (raw.kind as QuoteKind) : raw.id.startsWith('service:') ? 'service' : raw.id.startsWith('custom:') ? 'custom' : 'part',
    id: raw.id,
    title: raw.title,
    options,
    qty: clampQty(raw.qty),
  };
  for (const field of ['oem', 'cm', 'section', 'thumb', 'url', 'note'] as const) {
    const v = raw[field];
    if (typeof v === 'string' && v) item[field] = v;
  }
  if (item.url) item.url = currentPartUrl(item.url);
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
    if (prev) prev.qty = clampQty(prev.qty + item.qty);
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
    isObject(i) && isObject(i.options) && i.qty === clampQty(i.qty) && KINDS.includes(i.kind) && (typeof i.url !== 'string' || i.url === currentPartUrl(i.url));
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
  renderCount();
  document.dispatchEvent(new CustomEvent('quote:change'));
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
    existing.qty = clampQty(existing.qty + item.qty);
    // The same part added again from its current page: point the line at that page.
    if (existing.key !== key && item.url) existing.url = currentPartUrl(item.url);
    line = existing;
  } else {
    line = { ...item, kind, options, key, qty: clampQty(item.qty) };
    items.push(line);
  }
  save(items);
  return line;
}

// A part that is not in the catalog, identified only by the number typed.
// `catalog: false` is for the parts shop being off: the line is just the number
// to look up, with no "not in catalog" wording.
export function addCustom({ oem, qty = 1, note, catalog = true }: { oem: string; qty?: number; note?: string; catalog?: boolean }) {
  const clean = [...oem.trim().toUpperCase()].slice(0, 40).join('').trim(); // 40 characters is longer than any part number
  // A number with no letters or digits in it (only accents, symbols) still gets a line of its own.
  const k = clean.replace(/[^A-Z0-9]/g, '') || clean;
  return addItem({
    kind: 'custom',
    id: `custom:${k}`,
    title: catalog ? `OEM # ${clean} (not in catalog)` : `OEM # ${clean}`,
    oem: clean,
    qty,
    note,
    ...(catalog ? {} : { noCatalog: true }),
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
// the shop can read the order without opening links. `links: false` leaves the
// page address of each line out (the mailto: fallback has little room).
export function summarize(items = getItems(), { links = true } = {}) {
  if (!items.length) return 'No items selected.';
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return items
    .map((i, n) => {
      const head =
        i.kind === 'custom'
          ? `${n + 1}. [${i.noCatalog ? 'OEM # TO LOOK UP' : 'NOT IN CATALOG'}] ${i.oem ? `OEM # ${i.oem}` : i.title} | qty ${i.qty}`
          : i.kind === 'service'
            ? `${n + 1}. SERVICE | ${i.title} | qty ${i.qty}`
            : `${n + 1}. ${i.oem ? `OEM # ${i.oem}` : 'no OEM #'} | ${i.cm ? `C&M # ${i.cm}` : 'no C&M #'} | ${i.title} | qty ${i.qty}`;
      const opts = Object.entries(i.options)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      return [
        head,
        i.section ? `   Section: ${i.section}` : '',
        opts ? `   Options: ${opts}` : '',
        i.note ? `   Note: ${i.note}` : '',
        links && i.url ? `   ${origin}${i.url}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}
