// Small non-blocking notifications ("Added 2 x 03187A0897 · View quote").
// One region per page (Base.astro renders it, so a screen reader already knows it when the
// first toast arrives), role=status. A toast never takes focus unless the caller asks (focusAction).
//
// A toast goes away on its timer, on Escape, when the next toast arrives, and when the visitor taps or
// clicks anywhere but one of its own links or buttons: on a phone it sits over the page (it can cover the
// next Add button of a parts list), so a tap must be enough to get it out of the way.

export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  href?: string; // renders the action as a link instead of a button
  duration?: number; // ms, default 4000; a toast with an action stays at least 10000
  focusAction?: boolean; // move focus to the action once the toast shows (keyboard users reach Undo)
  onDismiss?: () => void; // runs once when the toast goes away, whatever the reason (timeout, Escape, action, a tap elsewhere, a newer toast)
  sticky?: boolean; // no timer: a notice that has to be read stays until it is closed, tapped away or replaced
}

/** A piece of the message: plain text, or a link inside the sentence. */
export type ToastPart = string | { label: string; href: string };

const TICK = 60; // ms between creating the toast and giving it text, so the live region announces the first message
const ACTION_MIN = 10000; // a toast with an action stays long enough to find and use it
const GRACE = 2000; // ms left after the pointer or focus leaves a toast whose timer had almost run out
const TAP_SLOP = 10; // px a pointer may move between down and up and still count as a tap (more is a scroll or a drag)

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
export function showToast(message: string | ToastPart[], opts: ToastOptions = {}): HTMLElement | undefined {
  closeCurrent?.();
  const host = region();
  const toast = document.createElement('div');
  toast.className = 'toast'; // hidden by CSS while empty
  const shownAt = performance.now();

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
    if (opts.sticky) return;
    started = Date.now();
    timer = window.setTimeout(dismiss, ms);
  };
  const sync = () => {
    if (done || opts.sticky) return;
    if (hovering || focused) {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
      left -= Date.now() - started;
    } else if (timer === undefined) {
      run(Math.max(left, GRACE));
    }
  };

  // ---------- A tap or click elsewhere ----------
  // Pointer taps are read from pointerdown + pointerup, so a scroll or a drag (the pointer moves, or the
  // browser cancels it) leaves the toast alone, and so does iOS, which sends no click for a tap on plain
  // text. A click with no pointer behind it (Enter or Space on a button, a scripted click) counts too.
  let down: { x: number; y: number } | null = null;
  const ownControl = (target: EventTarget | null) => target instanceof Element && toast.contains(target) && !!target.closest('a, button');
  // The click or tap that opened this toast is older than the toast: never let it close it.
  const older = (event: Event) => event.timeStamp <= shownAt;
  const onDown = (event: PointerEvent) => {
    down = event.button === 0 && !older(event) ? { x: event.clientX, y: event.clientY } : null;
  };
  const onUp = (event: PointerEvent) => {
    const tap = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= TAP_SLOP;
    down = null;
    if (tap && !ownControl(event.target)) dismiss();
  };
  const onCancel = () => {
    down = null;
  };
  const onClick = (event: MouseEvent) => {
    if (event.detail === 0 && !older(event) && !ownControl(event.target)) dismiss();
  };
  // Capture phase: this runs before the page's own handler, which may show the next toast.
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onCancel, true);
  document.addEventListener('click', onClick, true);

  function dismiss() {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onCancel, true);
    document.removeEventListener('click', onClick, true);
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
    for (const part of typeof message === 'string' ? [message] : message) {
      if (typeof part === 'string') {
        text.append(part);
        continue;
      }
      // A link inside the sentence. The toast is dark, so it takes the text colour (the site's link blue
      // is unreadable there) and, like the tel: links in running text, 44px of height to tap.
      const link = document.createElement('a');
      link.href = part.href;
      link.textContent = part.label;
      link.style.cssText = 'display:inline-block;padding-block:10px;margin-block:-10px;color:inherit;white-space:nowrap';
      text.append(link);
    }
    toast.append(text);
    if (action) toast.append(action);
    if (action && opts.focusAction) action.focus({ preventScroll: true });
  }, TICK);

  return action;
}
