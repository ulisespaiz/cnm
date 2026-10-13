// A short spoken update for screen readers: "Copied 03187A0897", "Quantity 3".
// Base.astro renders the region (#sr-status, role=status, visually hidden) before any script runs, so a screen reader
// already knows it when the first message arrives; a region created at that moment is often missed.
// The text is cleared first and set a moment later so the same message twice in a row is announced twice.

export function announce(message: string) {
  let el = document.getElementById('sr-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sr-status';
    el.className = 'visually-hidden';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  const region = el;
  region.textContent = '';
  window.setTimeout(() => (region.textContent = message), 30);
}
