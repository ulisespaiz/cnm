// Small non-blocking notifications ("Added 2 x 03187A0897 · View quote").
// One region per page, role=status, never steals focus.

interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  href?: string; // renders the action as a link instead of a button
  duration?: number; // ms, default 4000 (6000 when there is an action)
}

function region() {
  let el = document.getElementById('toast-region');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-region';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.className = 'toast-region';
    document.body.append(el);
  }
  return el;
}

export function showToast(message: string, opts: ToastOptions = {}) {
  const host = region();
  const toast = document.createElement('div');
  toast.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(text);

  if (opts.actionLabel && (opts.href || opts.onAction)) {
    const action = opts.href ? document.createElement('a') : document.createElement('button');
    action.className = 'toast__action';
    action.textContent = opts.actionLabel;
    if (opts.href) (action as HTMLAnchorElement).href = opts.href;
    else {
      (action as HTMLButtonElement).type = 'button';
      action.addEventListener('click', () => {
        opts.onAction?.();
        toast.remove();
      });
    }
    toast.append(action);
  }

  host.replaceChildren(toast);
  const ms = opts.duration ?? (opts.actionLabel ? 6000 : 4000);
  window.setTimeout(() => toast.remove(), ms);
}
