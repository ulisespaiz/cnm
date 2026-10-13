// Store home, opened with a search (/shop/?q=...): flag it before first paint so the browse blocks
// are never drawn and the page does not jump when the results arrive. See html[data-q] in
// src/styles/store.css and src/scripts/part-filter.ts. A classic script on purpose: it runs in
// <head> before the page is painted (the site's CSP allows scripts from 'self' only).
if (new URLSearchParams(location.search).get('q')?.slice(0, 80).trim()) {
  document.documentElement.dataset.q = '1';
  // part-filter.ts says when the results are in. If it never does, do not leave the page waiting.
  setTimeout(() => (document.documentElement.dataset.qReady = ''), 6000);
}
