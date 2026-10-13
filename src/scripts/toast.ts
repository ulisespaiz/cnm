// Small non-blocking notifications ("Added 2 x 03187A0897 · View quote").
// One region per page (Base.astro renders it, so a screen reader already knows it when the
// first toast arrives), role=status. A toast never takes focus unless the caller asks (focusAction).

export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  href?: string; // renders the action as a link instead of a button
  duration?: number; // ms, default 4000; a toast with an action stays at least 10000
  focusAction?: boolean; // move focus to the action once the toast shows (keyboard users reach Undo)
  onDismiss?: () => void; // runs once when the toast goes away, whatever the reason (timeout, Escape, action, a newer toast)
}

const TICK = 60; // ms between creating the toast and giving it text, so the live region announces the first message
const ACTION_MIN = 10000; // a toast with an action stays long enough to find and use it
const GRACE = 2000; // ms left after the pointer or focus leaves a toast whose timer had almost run out

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

let closeCurrent: (() => void) | undefined;

// Returns the action button or link (undefined when there is none) so the caller can point focus at it.
export function showToast(message: string, opts: ToastOptions = {}): HTMLElement | undefined {
  closeCurrent?.();
  const host = region();
  const toast = document.createElement('div');
  toast.className = 'toast'; // hidden by CSS while empty

  let action: HTMLAnchorElement | HTMLButtonElement | undefined;
  if (opts.actionLabel && (opts.href || opts.onAction)) {
    action = opts.href ? document.createElement('a') : document.createElement('button');
    action.className = 'toast__action';
    action.textContent = opts.actionLabel;
    if (opts.href) (action as HTMLAnchorElement).href = opts.href;
    else {
      (action as HTMLButtonElement).type = 'button';
      action.addEventListener('click', () => {
        opts.onAction?.();
        dismiss();
      });
    }
  }

  // The clock stops while a pointer or focus is on the toast and carries on with what was left.
  let left = action ? Math.max(opts.duration ?? ACTION_MIN, ACTION_MIN) : (opts.duration ?? 4000);
  let started = 0;
  let timer: number | undefined;
  let hovering = false;
  let focused = false;
  let returnTo: HTMLElement | null = null;
  let done = false;

  const run = (ms: number) => {
    started = Date.now();
    timer = window.setTimeout(dismiss, ms);
  };
  const sync = () => {
    if (done) return;
    if (hovering || focused) {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
      left -= Date.now() - started;
    } else if (timer === undefined) {
      run(Math.max(left, GRACE));
    }
  };

  function dismiss() {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    if (closeCurrent === dismiss) closeCurrent = undefined;
    const hadFocus = toast.contains(document.activeElement);
    toast.remove();
    // Focus was on the toast: hand it back to where it came from instead of dropping it on the page.
    if (hadFocus && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    opts.onDismiss?.();
  }

  toast.addEventListener('mouseenter', () => {
    hovering = true;
    sync();
  });
  toast.addEventListener('mouseleave', () => {
    hovering = false;
    sync();
  });
  toast.addEventListener('focusin', (e) => {
    const from = e.relatedTarget as HTMLElement | null;
    if (from && !toast.contains(from)) returnTo = from;
    focused = true;
    sync();
  });
  toast.addEventListener('focusout', (e) => {
    focused = toast.contains(e.relatedTarget as Node | null);
    sync();
  });
  toast.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    dismiss();
  });

  closeCurrent = dismiss;
  host.replaceChildren(toast);
  run(left);

  window.setTimeout(() => {
    if (done) return;
    const text = document.createElement('span');
    text.textContent = message;
    toast.append(text);
    if (action) toast.append(action);
    if (action && opts.focusAction) action.focus({ preventScroll: true });
  }, TICK);

  return action;
}
