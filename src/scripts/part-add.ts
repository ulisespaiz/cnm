// Add-to-quote controls shared by every store surface: list rows, part page,
// sticky bar and the search dropdown. One delegated listener handles the
// quantity stepper and the Add buttons, so rows need no script of their own.
import { addItem, lineCount } from './quote-store';
import { showToast } from './toast';
import './copy';

export interface PartData {
  id: string;
  title: string;
  oem: string;
  cm: string;
  section: string;
  url: string;
  thumb?: string;
}

export const clampQty = (n: number) => Math.max(1, Math.min(999, Math.round(n) || 1));

export function addPart(d: PartData, qty: number) {
  const q = clampQty(qty);
  const line = addItem({
    kind: 'part',
    id: d.id,
    title: d.title,
    oem: d.oem,
    cm: d.cm,
    section: d.section,
    thumb: d.thumb || undefined,
    url: d.url,
    qty: q,
  });
  showToast(`Added ${q} × ${d.oem} ${d.title}`, { actionLabel: `View quote (${lineCount()})`, href: '/quote/' });
  return line;
}

const dataOf = (el: HTMLElement): PartData => ({
  id: el.dataset.id!,
  title: el.dataset.title!,
  oem: el.dataset.oem!,
  cm: el.dataset.cm!,
  section: el.dataset.section!,
  url: el.dataset.url!,
  thumb: el.dataset.thumb,
});

const timers = new WeakMap<HTMLElement, number>();

function flash(btn: HTMLElement) {
  const label = btn.querySelector<HTMLElement>('[data-add-label]');
  if (label && label.dataset.idle === undefined) label.dataset.idle = label.textContent ?? '';
  if (label) label.textContent = '✓ Added';
  btn.dataset.state = 'added';
  window.clearTimeout(timers.get(btn));
  timers.set(
    btn,
    window.setTimeout(() => {
      delete btn.dataset.state;
      if (label) label.textContent = label.dataset.idle ?? 'Add to Quote';
    }, 1500),
  );
}

function readQty(host: HTMLElement) {
  const input = host.querySelector<HTMLInputElement>('[data-qty]');
  return clampQty(Number(input?.value));
}

document.addEventListener('click', (event) => {
  const target = event.target as Element;

  const step = target.closest<HTMLElement>('[data-step]');
  if (step) {
    const input = step.closest('[data-qtybox]')?.querySelector<HTMLInputElement>('[data-qty]');
    if (input) input.value = String(clampQty(Number(input.value) + Number(step.dataset.step)));
    return;
  }

  const again = target.closest<HTMLElement>('[data-add-another]');
  if (again) {
    again.closest<HTMLElement>('[data-addbar]')?.removeAttribute('data-state');
    return;
  }

  const add = target.closest<HTMLElement>('[data-add]');
  if (add) {
    const host = add.closest<HTMLElement>('[data-part]');
    if (!host) return;
    addPart(dataOf(host), readQty(host));
    flash(add);
    const bar = add.closest<HTMLElement>('[data-addbar]');
    if (bar) bar.dataset.state = 'added';
  }
});

// Keep the quantity a clean number; Enter in the field adds the part.
document.addEventListener('input', (event) => {
  const el = event.target as HTMLInputElement;
  if (el.matches?.('[data-qty]')) el.value = el.value.replace(/\D/g, '').slice(0, 3);
});

document.addEventListener(
  'blur',
  (event) => {
    const el = event.target as HTMLInputElement;
    if (el.matches?.('[data-qty]')) el.value = String(clampQty(Number(el.value)));
  },
  true,
);

document.addEventListener('keydown', (event) => {
  const el = event.target as HTMLInputElement;
  if (event.key === 'Enter' && el.matches?.('[data-qty]')) {
    event.preventDefault();
    el.closest<HTMLElement>('[data-part]')?.querySelector<HTMLElement>('[data-add]')?.click();
  }
});
