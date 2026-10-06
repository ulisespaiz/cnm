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
