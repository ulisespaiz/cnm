// Jump to an element and keep it in place while the page settles.
// Long lists use content-visibility, so row heights can still shift a little
// after the jump. Jump instantly, then correct once layout has settled.

export function scrollToEl(el: HTMLElement | null) {
  if (!el) return;
  const jump = () => el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' });
  jump();
  requestAnimationFrame(() => requestAnimationFrame(jump));
  window.setTimeout(jump, 250);
}

// The behaviour for every animated scrollIntoView or scrollTo: no animation for a visitor who asked the
// system for reduced motion ('auto' jumps there, as the page has no CSS scroll-behavior).
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
