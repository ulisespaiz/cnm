// /quote/ for a returning visitor: flag the saved list before first paint, so the page is drawn with
// the list's blocks instead of the empty state and nothing jumps when src/scripts/quote-page.ts
// draws the rows. See html[data-quote] and --quote-rows in src/components/QuoteItems.astro. A
// classic script on purpose: it runs in <head> before the page is painted (the site's CSP allows
// scripts from 'self' only). Without it, or without JavaScript, the empty state is simply shown.
try {
  var state = JSON.parse(localStorage.getItem('quote-list-v2') || 'null');
  var n = 0;
  if (state && typeof state === 'object' && typeof state.ref === 'string' && state.ref && Array.isArray(state.items)) {
    // The same test quote-store.ts applies to a stored line.
    n = state.items.filter(function (i) {
      return i && typeof i === 'object' && typeof i.key === 'string' && typeof i.id === 'string' && typeof i.title === 'string';
    }).length;
  }
  document.documentElement.dataset.quote = n ? 'filled' : 'empty';
  document.documentElement.style.setProperty('--quote-rows', String(Math.min(n, 6)));
} catch (e) {
  // storage blocked or unreadable: leave the page as the empty state
}
