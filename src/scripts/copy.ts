// Copy buttons: <button data-copy="03187A0897">. Works with navigator.clipboard,
// falls back to execCommand, and announces the result for screen readers.

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the legacy path (insecure context, denied permission)
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function announce(message: string) {
  let el = document.getElementById('copy-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'copy-status';
    el.className = 'visually-hidden';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = '';
  window.setTimeout(() => (el!.textContent = message), 30);
}

const timers = new WeakMap<HTMLElement, number>();

document.addEventListener('click', async (event) => {
  const btn = (event.target as Element).closest<HTMLElement>('[data-copy]');
  if (!btn) return;
  const text = btn.dataset.copy!;
  const ok = await copyText(text);
  const label = btn.querySelector<HTMLElement>('[data-copy-label]');
  if (label && label.dataset.idle === undefined) label.dataset.idle = label.textContent ?? '';
  if (label) label.textContent = ok ? 'Copied ✓' : 'Copy failed';
  btn.dataset.copied = ok ? 'true' : 'false';
  announce(ok ? `Copied ${text}` : `Could not copy ${text}`);
  window.clearTimeout(timers.get(btn));
  timers.set(
    btn,
    window.setTimeout(() => {
      delete btn.dataset.copied;
      if (label) label.textContent = label.dataset.idle ?? 'Copy';
    }, 2000),
  );
});
