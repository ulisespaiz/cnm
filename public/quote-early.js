// /quote/ for a returning visitor: flag the saved list before first paint, so the page is drawn with
// the list's blocks instead of the empty state and nothing jumps when src/scripts/quote-page.ts
// draws the rows. See html[data-quote] and --quote-rows in src/components/QuoteItems.astro. A
// classic script on purpose: it runs in <head> before the page is painted (the site's CSP allows
// scripts from 'self' only). Without it, or without JavaScript, the empty state is simply shown.
//
// A link that adds a line counts too, since quote-page.ts adds it as soon as it runs:
// /quote/?service=<id> for an id in this script's data-services (src/pages/quote/index.astro) that is
// not in the list yet, and /quote/?part=<number> on an empty list (the row is then held until the
// catalog has been searched).
(function () {
  var root = document.documentElement;
  var items = [];
  try {
    var state = JSON.parse(localStorage.getItem('quote-list-v2') || 'null');
    if (state && typeof state === 'object' && typeof state.ref === 'string' && state.ref && Array.isArray(state.items)) {
      // The same test quote-store.ts applies to a stored line.
      items = state.items.filter(function (i) {
        return i && typeof i === 'object' && typeof i.key === 'string' && typeof i.id === 'string' && typeof i.title === 'string';
      });
    }
  } catch (e) {
    // storage blocked or unreadable: an empty list
  }
  var n = items.length;
  try {
    var params = new URLSearchParams(location.search);
    var service = params.get('service');
    var known = JSON.parse(document.currentScript.dataset.services || '{}');
    var listed = items.some(function (i) {
      return i.id === 'service:' + service;
    });
    if (service && Object.prototype.hasOwnProperty.call(known, service) && typeof known[service] === 'string' && !listed) n++;
    if (!n && (params.get('part') || '').trim()) n = 1;
  } catch (e) {
    // no usable address or service list: the saved list alone decides
  }
  root.dataset.quote = n ? 'filled' : 'empty';
  root.style.setProperty('--quote-rows', String(Math.min(n, 6)));
})();
