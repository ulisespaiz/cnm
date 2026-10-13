// Add-to-quote controls shared by every store surface: list rows, part page,
// sticky bar and the search dropdown. One delegated listener handles the
// quantity stepper and the Add buttons, so rows need no script of their own.
// The sticky bar swaps its Add button for "View quote" / "+ Add more", which
// hides the control that had focus, so focus is moved to the one that replaces it.
import { addItem, lineCount } from './quote-store';
import { showToast } from './toast';
import { announce } from './announce';
import './copy';

export interface PartData {
  id: string;
  title: string;
  oem?: string; // OEM number; absent for parts that have none
  cm: string;
  section: string;
  url: string;
  thumb?: string;
}

export const clampQty = (n: number) => Math.max(1, Math.min(999, Math.round(n) || 1));

// toast: false when the page already shows the result (the sticky bar turns into "View quote").
export function addPart(d: PartData, qty: number, { toast = true } = {}) {
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
  if (toast) showToast(`Added ${q} × ${d.oem ? `OEM # ${d.oem}` : `C&M # ${d.cm}`} ${d.title}`, { actionLabel: `View quote (${lineCount()})`, href: '/quote/' });
  return line;
}

const dataOf = (el: HTMLElement): PartData => ({
  id: el.dataset.id!,
  title: el.dataset.title!,
  oem: el.dataset.oem || undefined,
  cm: el.dataset.cm!,
  section: el.dataset.section!,
  url: el.dataset.url!,
  thumb: el.dataset.thumb,
});

const timers = new WeakMap<HTMLElement, number>();
let qtyTimer: number | undefined;

// The + and - buttons keep focus and the number changes next to them: say the new quantity once the presses stop.
function announceQty(input: HTMLInputElement) {
  window.clearTimeout(qtyTimer);
  qtyTimer = window.setTimeout(() => announce(`Quantity ${input.value}`), 400);
}

// For 1.5 s the button reads "✓ Added". Its accessible name changes with it ("Added: <number>"), so what a voice-control user
// sees and can say ("click Added") is part of the name (WCAG 2.5.3, Label in Name); the idle name comes back with the label.
function flash(btn: HTMLElement, number: string) {
  const label = btn.querySelector<HTMLElement>('[data-add-label]');
  if (label && label.dataset.idle === undefined) label.dataset.idle = label.textContent ?? '';
  if (btn.dataset.idleName === undefined) btn.dataset.idleName = btn.getAttribute('aria-label') ?? '';
  if (label) label.textContent = '✓ Added';
  btn.setAttribute('aria-label', `Added: ${number}`);
  btn.dataset.state = 'added';
  window.clearTimeout(timers.get(btn));
  timers.set(
    btn,
    window.setTimeout(() => {
      delete btn.dataset.state;
      if (label) label.textContent = label.dataset.idle ?? 'Add to Quote';
      if (btn.dataset.idleName) btn.setAttribute('aria-label', btn.dataset.idleName);
      else btn.removeAttribute('aria-label');
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
    if (input) {
      input.value = String(clampQty(Number(input.value) + Number(step.dataset.step)));
      announceQty(input);
    }
    return;
  }

  const again = target.closest<HTMLElement>('[data-add-another]');
  if (again) {
    const bar = again.closest<HTMLElement>('[data-addbar]');
    bar?.removeAttribute('data-state');
    bar?.querySelector<HTMLElement>('[data-add]')?.focus();
    return;
  }

  const add = target.closest<HTMLElement>('[data-add]');
  if (add) {
    const host = add.closest<HTMLElement>('[data-part]');
    if (!host) return;
    const bar = add.closest<HTMLElement>('[data-addbar]');
    const barShown = !!bar && getComputedStyle(bar).display !== 'none';
    const part = dataOf(host);
    addPart(part, readQty(host), { toast: !barShown });
    flash(add, part.oem || part.cm);
    if (bar) {
      bar.dataset.state = 'added';
      bar.querySelector<HTMLElement>('.addbar__view')?.focus();
    }
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
