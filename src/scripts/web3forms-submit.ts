// Shared Web3Forms submit handler for every form on the site (quote, contact,
// part request). With JavaScript the form posts in the background and the
// page decides what success looks like; without it the form posts normally
// and Web3Forms redirects to the thank-you page (the "redirect" field).

export interface SubmitConfig {
  form: HTMLFormElement;
  /** Validate and enrich the data. Return an error message to stop the send. */
  prepare?: (data: FormData) => string | void;
  /** Plain-text body for the mailto fallback shown when the send fails. */
  fallbackBody?: (data: FormData) => string;
  /** Called after Web3Forms accepted the message. */
  onSuccess: (data: FormData) => void;
  /** Button label while sending. */
  busyLabel?: string;
}

export function setStatus(el: HTMLElement | null, kind: 'info' | 'error' | 'success' | 'none', message = '') {
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('form-alert--error', kind === 'error');
  el.classList.toggle('form-alert--success', kind === 'success');
}

function labelText(form: HTMLFormElement, field: HTMLElement) {
  const label = field.id ? form.querySelector<HTMLElement>(`label[for="${field.id}"]`) : null;
  if (!label) return '';
  const copy = label.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.req, .opt').forEach((el) => el.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function bindWeb3Form({ form, prepare, fallbackBody, onSuccess, busyLabel = 'Sending…' }: SubmitConfig) {
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const button = form.querySelector<HTMLButtonElement>('[data-submit]');
  let sending = false;

  // Required-field errors: write them to the polite live region, mark the field
  // invalid and focus the first one, instead of relying on the browser bubble.
  let reported = false;
  form.addEventListener(
    'invalid',
    (event) => {
      event.preventDefault();
      const field = event.target as HTMLInputElement;
      field.setAttribute('aria-invalid', 'true');
      if (reported) return;
      reported = true;
      window.setTimeout(() => (reported = false), 0);
      const label = labelText(form, field);
      setStatus(status, 'error', label ? `${label}: ${field.validationMessage}` : field.validationMessage);
      field.focus();
    },
    true,
  );
  form.addEventListener('input', (event) => {
    const field = event.target as HTMLElement;
    if (field.getAttribute('aria-invalid') === 'true' && (field as HTMLInputElement).validity?.valid) {
      field.removeAttribute('aria-invalid');
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;

    const data = new FormData(form);

    // Honeypot: a human never ticks it. Pretend all is well and send nothing.
    if (data.get('botcheck')) {
      setStatus(status, 'success', 'Thanks!');
      return;
    }

    const problem = prepare?.(data);
    if (problem) {
      setStatus(status, 'error', problem);
      return;
    }
    data.delete('redirect'); // JS keeps the visitor on-site
    data.delete('botcheck');

    sending = true;
    const label = button?.textContent ?? '';
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = busyLabel;
    }
    setStatus(status, 'info', 'Sending…');

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: data,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || `HTTP ${res.status}`);
      setStatus(status, 'none');
      onSuccess(data);
    } catch (err) {
      console.error('Form submit failed', err);
      showFallback(form, status, data, fallbackBody?.(data) ?? '');
    } finally {
      sending = false;
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = label;
      }
    }
  });
}

function showFallback(form: HTMLFormElement, status: HTMLElement | null, data: FormData, body: string) {
  if (!status) return;
  const to = form.dataset.fallbackEmail ?? '';
  const subject = String(data.get('subject') ?? '');
  const href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const link = document.createElement('a');
  link.href = href;
  link.textContent = 'email your request';
  status.replaceChildren("Sorry, that didn't send. Please call us or ", link, '.');
  status.classList.add('form-alert--error');
  status.classList.remove('form-alert--success');
}
