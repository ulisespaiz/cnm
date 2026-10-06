// The quote list lives in the visitor's browser (localStorage) until they
// submit it. Storage can be unavailable (private mode, blocked site data), so
// every access is guarded and the list falls back to memory for the visit.

export interface QuoteItem {
  key: string;
  id: string;
  title: string;
  url: string;
  options: Record<string, string>;
  qty: number;
}

const STORAGE_KEY = 'quote-list-v1';
let memory: QuoteItem[] = [];

export function getItems(): QuoteItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QuoteItem[]) : memory;
  } catch {
    return memory;
  }
}

function save(items: QuoteItem[]) {
  memory = items;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // memory copy still holds the list for this page view
  }
  renderCount();
  document.dispatchEvent(new CustomEvent('quote:change'));
}

const itemKey = (id: string, options: Record<string, string>) =>
  `${id}|${Object.entries(options)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(';')}`;

export function addItem(item: Omit<QuoteItem, 'key'>) {
  const items = getItems();
  const key = itemKey(item.id, item.options);
  const existing = items.find((i) => i.key === key);
  if (existing) existing.qty += item.qty;
  else items.push({ ...item, key });
  save(items);
}

export function setQty(key: string, qty: number) {
  const clamped = Math.max(1, Math.min(999, Math.round(qty) || 1));
  save(getItems().map((i) => (i.key === key ? { ...i, qty: clamped } : i)));
}

export function removeItem(key: string) {
  save(getItems().filter((i) => i.key !== key));
}

export function clearItems() {
  save([]);
}

export function totalCount() {
  return getItems().reduce((n, i) => n + i.qty, 0);
}

export function renderCount() {
  const n = totalCount();
  document.querySelectorAll<HTMLElement>('[data-quote-count]').forEach((el) => {
    el.textContent = String(n);
    el.hidden = n === 0;
  });
}

// Plain-text summary that goes into the email body.
export function summarize(items = getItems()) {
  if (!items.length) return 'No products selected.';
  return items
    .map((i, n) => {
      const opts = Object.entries(i.options)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      return `${n + 1}. ${i.title} x ${i.qty}${opts ? ` (${opts})` : ''}\n   ${location.origin}${i.url}`;
    })
    .join('\n');
}
