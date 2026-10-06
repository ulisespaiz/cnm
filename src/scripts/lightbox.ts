// Part photo lightbox (Lightbox.astro): <dialog> opened from the photo,
// Escape / backdrop / close button to leave, thumbnails switch the photo.
// The import keeps this a separate file: the site's CSP (script-src 'self')
// blocks the inline <script> Astro would otherwise emit for a tiny script.
import './copy';

document.querySelectorAll<HTMLElement>('[data-photo]').forEach((root) => {
  const dialog = root.querySelector<HTMLDialogElement>('[data-lightbox]');
  if (!dialog) return;
  const main = root.querySelector<HTMLImageElement>('[data-photo-main]')!;
  const big = root.querySelector<HTMLImageElement>('[data-lightbox-img]')!;
  const scroller = root.querySelector<HTMLElement>('.lightbox__scroll')!;

  root.querySelector('[data-lightbox-open]')?.addEventListener('click', () => {
    // 2x the file's own size at most: no pretend sharpness
    big.style.width = `min(100%, ${Number(main.getAttribute('width')) * 2}px)`;
    big.src = main.src;
    scroller.scrollTo(0, 0);
    dialog.showModal();
  });
  root.querySelector('[data-lightbox-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target === scroller) dialog.close();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-photo-thumb]').forEach((btn) => {
    btn.addEventListener('click', () => {
      main.src = btn.dataset.src!;
      main.width = Number(btn.dataset.w);
      main.height = Number(btn.dataset.h);
      root.querySelectorAll('[data-photo-thumb]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
  });
});
