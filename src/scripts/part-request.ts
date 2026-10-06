// "Can't find your part?" form: prefill from search / ?part=, validation and
// the inline success message. Sending is the shared Web3Forms handler.

import { bindWeb3Form } from './web3forms-submit';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function forms() {
  return [...document.querySelectorAll<HTMLFormElement>('[data-part-request]')];
}

function field(form: HTMLFormElement, name: string) {
  return form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
}

function prefill(query: string, focus = true) {
  const q = query.trim();
  if (!q) return;
  for (const form of forms()) {
    field(form, 'part_number').value = q;
    field(form, 'searched_for').value = q;
    form.hidden = false;
    form.closest<HTMLElement>('[data-part-request-box]')?.querySelector<HTMLElement>('[data-pr-success]')?.setAttribute('hidden', '');
    // On part pages the form sits in a collapsed <details>.
    for (let el = form.parentElement; el; el = el.parentElement) {
      if (el instanceof HTMLDetailsElement) el.open = true;
    }
  }
  const first = forms()[0];
  if (!first) return;
  const box = first.closest<HTMLElement>('[data-part-request-box]') ?? first;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (focus) {
    // The part number is already filled in, so move to the first empty field.
    const next = field(first, 'name');
    next.focus({ preventScroll: true });
  }
}

document.addEventListener('part-request:prefill', (event) => {
  prefill(String((event as CustomEvent<{ query?: string }>).detail?.query ?? ''));
});

for (const form of forms()) {
  const box = form.closest<HTMLElement>('[data-part-request-box]')!;
  const success = box.querySelector<HTMLElement>('[data-pr-success]')!;
  const message = success.querySelector<HTMLElement>('[data-pr-message]')!;

  bindWeb3Form({
    form,
    prepare(data) {
      const number = String(data.get('part_number') || '').trim();
      const description = String(data.get('description') || '').trim();
      if (!number && !description) return 'Enter the part number, or describe the part you need.';

      const contact = String(data.get('contact') || '').trim();
      if (EMAIL.test(contact)) data.set('email', contact);
      else if (contact.replace(/\D/g, '').length >= 7) data.set('phone', contact);
      else return 'Enter a phone number or an email address so we can reply.';

      const name = String(data.get('name') || '').trim();
      data.set('page', location.href);
      if (!String(data.get('searched_for') || '').trim()) data.set('searched_for', number);
      data.set('subject', `Part request: ${number || 'see description'} from ${name}`);
      return;
    },
    fallbackBody(data) {
      return [
        `Part number: ${data.get('part_number') ?? ''}`,
        data.get('description') ? `Description: ${data.get('description')}` : '',
        data.get('machine') ? `Machine: ${data.get('machine')}` : '',
        `Qty: ${data.get('qty') ?? 1}`,
        `Name: ${data.get('name') ?? ''}`,
        `Contact: ${data.get('contact') ?? ''}`,
        `Searched for: ${data.get('searched_for') ?? ''}`,
        `Page: ${data.get('page') ?? ''}`,
      ]
        .filter(Boolean)
        .join('\n');
    },
    onSuccess(data) {
      const number = String(data.get('part_number') || '').trim();
      message.textContent = `Thanks. We'll check for ${number || 'your part'} and get back to you. ${form.dataset.replyTime ?? ''}.`;
      form.hidden = true;
      success.hidden = false;
      success.focus();
    },
  });
}

// ?part=<number> prefills the form (the quote page uses the same parameter to
// add the part to the quote list instead, so it opts out).
const fromUrl = new URLSearchParams(location.search).get('part');
if (fromUrl && forms().some((f) => f.dataset.urlPrefill !== 'false')) prefill(fromUrl);
