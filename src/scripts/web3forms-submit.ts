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
  /** Keep the button locked after a successful send, for a form whose onSuccess leaves the page. */
  lockOnSuccess?: boolean;
}

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

// A form can ask for "at least one of" a few fields (the quote, contact and part request forms need an
// email or a phone number, neither required on its own): a <fieldset data-reach id="…"> around them.
// When all are empty, one error under the group is tied to every field in it.
const REACH_MESSAGE = 'Enter an email or a phone number so we can reply.';
const REACH_NAME = 'Email or phone'; // how the group is named in the "Please fix N fields" summary

const SEND_TIMEOUT = 20000; // ms: a send that has not answered by then is reported as unconfirmed
const MAILTO_MAX = 1800; // characters: longer mailto: links are cut or refused by browsers and mail apps
const MAILTO_MORE = '… (list continues, see the quote page)';

// `assertive` is for a problem the visitor has to notice at once (role=alert); everything else
// waits its turn in the polite live region.
export function setStatus(el: HTMLElement | null, kind: 'info' | 'error' | 'success' | 'none', message = '', assertive = false) {
  if (!el) return;
  el.setAttribute('role', assertive ? 'alert' : 'status');
  el.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
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

// What a field says about itself. A field can carry its own wording for "left empty" in
// data-required-message ("Enter your name"), which replaces the browser's "Please fill out this field."
// (that text is not tied to the field, and varies by browser and language). Every other problem, such as an
// email without an @, keeps the browser's own message.
function messageOf(field: Field) {
  return (field.validity.valueMissing && field.dataset.requiredMessage) || field.validationMessage;
}

// Scroll only when the element is under the sticky header or too close to the bottom edge.
function inView(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.top >= 88 && r.bottom <= window.innerHeight - 96;
}

function reveal(el: HTMLElement) {
  if (!inView(el)) el.scrollIntoView({ block: 'center' });
}

// ---------- Per-field errors ----------
// <p class="field-error" id="{field.id}-err"> right after the control, listed in its aria-describedby.

const fieldError = (field: Field) => {
  const next = field.nextElementSibling;
  return next instanceof HTMLElement && next.classList.contains('field-error') ? next : null;
};

function describedBy(field: Field) {
  return (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
}

function showFieldError(field: Field, message: string) {
  field.setAttribute('aria-invalid', 'true');
  if (!field.id) return;
  const id = `${field.id}-err`;
  let err = fieldError(field);
  if (!err) {
    err = document.createElement('p');
    err.className = 'field-error';
    err.id = id;
    field.after(err);
  }
  err.textContent = message;
  const ids = describedBy(field);
  if (!ids.includes(id)) field.setAttribute('aria-describedby', [...ids, id].join(' '));
}

function clearFieldError(field: Field) {
  field.removeAttribute('aria-invalid');
  fieldError(field)?.remove();
  const ids = describedBy(field).filter((id) => id !== `${field.id}-err`);
  if (ids.length) field.setAttribute('aria-describedby', ids.join(' '));
  else field.removeAttribute('aria-describedby');
}

export function bindWeb3Form({ form, prepare, fallbackBody, onSuccess, busyLabel = 'Sending…', lockOnSuccess = false }: SubmitConfig) {
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const button = form.querySelector<HTMLButtonElement>('[data-submit]');
  let sending = false;
  let locked = false; // sent, and the page is on its way elsewhere (lockOnSuccess)

  // ---------- "At least one of" group ----------
  // One error for the whole group, after its last child, listed in every field's aria-describedby.
  const reachBox = form.querySelector<HTMLElement>('fieldset[data-reach][id]');
  const reachFields = reachBox ? [...reachBox.querySelectorAll<Field>('input')] : [];
  const reachErrId = reachBox ? `${reachBox.id}-err` : '';
  const reachEmpty = () => reachFields.length > 0 && reachFields.every((f) => !f.value.trim());
  const reachError = () => (reachBox ? reachBox.querySelector<HTMLElement>(':scope > .field-error') : null);
  // The message under a field: its own, or the group's.
  const errorOf = (field: Field) => fieldError(field) ?? (reachFields.includes(field) ? reachError() : null);

  function showReachError() {
    if (!reachBox) return;
    let err = reachError();
    if (!err) {
      err = document.createElement('p');
      err.className = 'field-error';
      err.id = reachErrId;
      reachBox.append(err);
    }
    err.textContent = REACH_MESSAGE;
    for (const field of reachFields) {
      field.setAttribute('aria-invalid', 'true');
      const ids = describedBy(field);
      if (!ids.includes(reachErrId)) field.setAttribute('aria-describedby', [...ids, reachErrId].join(' '));
    }
  }

  function clearReachError() {
    reachError()?.remove();
    for (const field of reachFields) {
      field.removeAttribute('aria-invalid');
      const ids = describedBy(field).filter((id) => id !== reachErrId);
      if (ids.length) field.setAttribute('aria-describedby', ids.join(' '));
      else field.removeAttribute('aria-describedby');
    }
  }

  // Required-field errors: mark every invalid field and put its message under it, focus the
  // first one, and keep a summary in the status line, instead of relying on the browser bubble.
  // The browser fires "invalid" once per field in one go, so the first one schedules the report.
  // An empty "at least one of" group is reported with them, so a form with several problems shows
  // them all at once.
  let flagged: Field[] = [];
  let summary = false; // the status line currently shows that summary

  // True when something was reported (and focused).
  const report = () => {
    const problems = flagged.map((field) => ({ field, name: labelText(form, field), message: messageOf(field), reach: false, own: messageOf(field) !== field.validationMessage }));
    flagged = [];
    if (reachEmpty()) {
      showReachError();
      problems.push({ field: reachFields[0], name: REACH_NAME, message: REACH_MESSAGE, reach: true, own: true });
      // Document order, so the first problem on the page takes focus.
      problems.sort((a, b) => (a.field.compareDocumentPosition(b.field) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    }
    if (!problems.length) return false;
    const first = problems[0];
    const names = problems.map((p) => p.name).filter(Boolean);
    let message: string;
    // The browser's wording does not say which field it means, so the name goes in front; a message the field
    // wrote itself ("Enter your name") already does.
    if (problems.length === 1) message = first.own || !first.name ? first.message : `${first.name}: ${first.message}`;
    else message = `Please fix ${problems.length} fields${names.length === problems.length ? `: ${names.join(', ')}` : ''}.`;
    setStatus(status, 'error', message);
    summary = true;
    // The first field takes focus; its message (just below it) has to be on screen with it.
    first.field.focus({ preventScroll: true });
    const err = errorOf(first.field) ?? first.field;
    if (first.field.getBoundingClientRect().top < 88 || !inView(err)) err.scrollIntoView({ block: 'center' });
    return true;
  };

  form.addEventListener(
    'invalid',
    (event) => {
      event.preventDefault();
      const field = event.target as Field;
      showFieldError(field, messageOf(field));
      if (!flagged.length) window.setTimeout(report, 0);
      flagged.push(field);
    },
    true,
  );

  // The summary has nothing left to say once no field is marked invalid.
  const settleSummary = () => {
    if (summary && !form.querySelector('[aria-invalid="true"]')) {
      summary = false;
      setStatus(status, 'none');
    }
  };

  form.addEventListener('input', (event) => {
    const field = event.target as Field;
    // Any of the group's fields filled in answers the group error (a badly typed email is caught on send).
    if (reachError() && reachFields.includes(field) && !reachEmpty()) {
      clearReachError();
      settleSummary();
    }
    if (field.getAttribute?.('aria-invalid') !== 'true') return;
    if (!field.validity?.valid) {
      const err = fieldError(field);
      if (err) err.textContent = messageOf(field); // e.g. "fill out" has become "include an @"
      return;
    }
    clearFieldError(field);
    settleSummary();
  });

  // A submit button that is busy stays focusable (aria-disabled, not disabled), so focus
  // never drops to <body>; clicks and Enter in a field are ignored instead.
  button?.addEventListener('click', (event) => {
    if (sending || locked) event.preventDefault();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || locked) return;

    // Every field passed the browser's check to get here: earlier errors are out of date.
    clearReachError();
    form.querySelectorAll<Field>('[aria-invalid="true"]').forEach(clearFieldError);
    summary = false;

    const data = new FormData(form);

    // Honeypot: a human never ticks it. Pretend all is well and send nothing.
    if (data.get('botcheck')) {
      setStatus(status, 'success', 'Thanks!');
      return;
    }

    // At least one of the group's fields (email or phone) has to be filled in. The browser only checks
    // each field alone, so this is the group's own check; it reports like a required field.
    if (reachEmpty()) {
      report();
      return;
    }

    let problem: string | void;
    try {
      problem = prepare?.(data);
    } catch (err) {
      console.error('Form prepare failed', err);
      problem = 'Something went wrong with your quote list. Please reload the page, or call us.';
    }
    if (problem) {
      setStatus(status, 'error', problem, true);
      if (status) reveal(status);
      return;
    }
    data.delete('redirect'); // JS keeps the visitor on-site
    data.delete('botcheck');
    // Web3Forms uses "email" as the reply-to address: an empty one (phone only) is left out of the request.
    if (!String(data.get('email') ?? '').trim()) data.delete('email');

    sending = true;
    const label = button?.textContent ?? '';
    if (button) {
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-busy', 'true');
      button.textContent = busyLabel;
    }
    setStatus(status, 'info', 'Sending…');

    let delivered = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), SEND_TIMEOUT);
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: data,
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || `HTTP ${res.status}`);
      delivered = true;
      setStatus(status, 'none');
      onSuccess(data);
    } catch (err) {
      console.error('Form submit failed', err);
      // If onSuccess itself broke, the message did go out: do not tell the visitor it failed.
      if (!delivered) {
        let body = '';
        try {
          body = fallbackBody?.(data) ?? '';
        } catch (bodyErr) {
          console.error('Form fallback failed', bodyErr);
        }
        showFallback(form, status, data, body);
      }
    } finally {
      window.clearTimeout(timer);
      sending = false;
      locked = delivered && lockOnSuccess;
      if (button && !locked) {
        button.removeAttribute('aria-disabled');
        button.removeAttribute('aria-busy');
        button.textContent = label;
      }
    }
  });
}

// mailto: link with the request in the body. Over MAILTO_MAX the body is cut at a whole line
// and says so, because a link that is too long opens nothing.
function mailtoHref(to: string, subject: string, body: string) {
  const build = (text: string) => `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  const full = build(body);
  if (full.length <= MAILTO_MAX) return full;

  const cut = (text: string) => [text.trimEnd(), MAILTO_MORE].filter(Boolean).join('\n');
  const chars = Array.from(body); // by code point: a cut never splits a surrogate pair
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (build(cut(chars.slice(0, mid).join(''))).length <= MAILTO_MAX) lo = mid;
    else hi = mid - 1;
  }
  let kept = chars.slice(0, lo).join('');
  const lastLine = kept.lastIndexOf('\n');
  if (lastLine > 0) kept = kept.slice(0, lastLine);
  return build(cut(kept));
}

function showFallback(form: HTMLFormElement, status: HTMLElement | null, data: FormData, body: string) {
  if (!status) return;
  const link = document.createElement('a');
  link.href = mailtoHref(form.dataset.fallbackEmail ?? '', String(data.get('subject') ?? ''), body);
  link.textContent = 'email your request';
  // An aborted send may still have been delivered, so this does not say it failed.
  setStatus(status, 'error', '', true);
  status.replaceChildren('We could not confirm that this was sent. Please call us or ', link, '.');
  reveal(status);
}
