// Filters, sort and the result count for the parts list (PartTable.astro).
// All rows are in the HTML; this script only hides, reorders and counts them,
// and mirrors the state into the URL (?q=&section=&type=&width=&side=&sort=).
import { loadIndex, search } from './part-search';

const FACETS = ['section', 'type', 'width', 'side'] as const;
type Facet = (typeof FACETS)[number];

interface Row {
  el: HTMLElement;
  id: string;
  idx: number;
  oem: string;
  name: string;
  section: string;
  type: string;
  width: string;
  side: string;
}

function init(root: HTMLElement) {
  const rowsEl = root.querySelector<HTMLElement>('[data-rows]')!;
  const items = [...rowsEl.children] as HTMLElement[];
  const rows: Row[] = items
    .filter((el) => el.classList.contains('prow'))
    .map((el, idx) => ({
      el,
      idx,
      id: el.dataset.id!,
      oem: el.dataset.oem ?? '',
      name: el.dataset.name ?? '',
      section: el.dataset.section ?? '',
      type: el.dataset.type ?? '',
      width: el.dataset.width ?? '',
      side: el.dataset.side ?? '',
    }));
  const heads = items.filter((el) => el.classList.contains('phead'));
  const total = rows.length;

  const form = root.querySelector<HTMLFormElement>('[data-filters]');
  const countEl = root.querySelector<HTMLElement>('[data-count]')!;
  const sortEl = root.querySelector<HTMLSelectElement>('[data-sort]')!;
  const chipsEl = root.querySelector<HTMLElement>('[data-chips]')!;
  const emptyEl = root.querySelector<HTMLElement>('[data-empty]')!;
  const emptyTitle = root.querySelector<HTMLElement>('[data-empty-title]')!;
  const emptyRequest = root.querySelector<HTMLElement>('[data-empty-request]')!;
  const filterN = root.querySelector<HTMLElement>('[data-filter-n]');
  const sheet = root.querySelector<HTMLDialogElement>('[data-sheet]');
  const showBtn = root.querySelector<HTMLElement>('[data-sheet-show]');

  const state = {
    q: '',
    sort: null as string | null,
    section: new Set<string>(),
    type: new Set<string>(),
    width: new Set<string>(),
    side: new Set<string>(),
  };

  let ready = false;
  let reordered = false;

  const hasFacet = (f: Facet) => !!form?.querySelector(`input[name="${f}"]`);

  function pass(r: Row, ranks: Map<string, number> | null, skip?: Facet) {
    for (const f of FACETS) if (f !== skip && state[f].size && !state[f].has(r[f])) return false;
    return !ranks || ranks.has(r.id);
  }

  function update() {
    let ranks: Map<string, number> | null = null;
    if (state.q && ready) ranks = new Map(search(state.q).map((h, n) => [h.rec.i, n]));
    const visible = rows.filter((r) => pass(r, ranks));
    const shown = new Set(visible);
    for (const r of rows) r.el.hidden = !shown.has(r);

    // facet counts (each group ignores its own selection)
    if (form) {
      for (const f of FACETS) {
        const group = form.querySelector<HTMLElement>(`[data-fgroup="${f}"]`);
        if (!group) continue;
        let any = 0;
        group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
          const n = rows.filter((r) => r[f] === box.value && pass(r, ranks, f)).length;
          const label = box.closest<HTMLElement>('label')!;
          label.querySelector('[data-fcount]')!.textContent = String(n);
          label.hidden = n === 0 && !box.checked;
          if (!label.hidden) any++;
        });
        group.hidden = any === 0;
      }
    }

    // order
    const sort = state.sort ?? (state.q ? 'best' : 'catalog');
    sortEl.value = sort;
    const bestOpt = sortEl.querySelector<HTMLOptionElement>('option[value="best"]');
    if (bestOpt) bestOpt.hidden = !state.q;
    let ordered = visible;
    if (sort === 'best' && ranks) ordered = [...visible].sort((a, b) => ranks!.get(a.id)! - ranks!.get(b.id)!);
    else if (sort === 'pn') ordered = [...visible].sort((a, b) => a.oem.localeCompare(b.oem));
    else if (sort === 'name') ordered = [...visible].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const flat = sort !== 'catalog' && !(sort === 'best' && !ranks);
    if (flat) {
      rowsEl.dataset.flat = 'true';
      rowsEl.append(...ordered.map((r) => r.el), ...rows.filter((r) => !shown.has(r)).map((r) => r.el));
      reordered = true;
    } else {
      delete rowsEl.dataset.flat;
      if (reordered) {
        rowsEl.append(...items);
        reordered = false;
      }
    }
    for (const h of heads) {
      const n = visible.filter((r) => r.section === h.dataset.head).length;
      h.hidden = n === 0 || flat;
      const c = h.querySelector('[data-gcount]');
      if (c) c.textContent = String(n);
    }

    // count, empty state, chips
    const n = visible.length;
    const noun = (k: number) => (k === 1 ? 'part' : 'parts');
    const filtered = n !== total;
    countEl.textContent = filtered ? `Showing ${n} of ${total} ${noun(total)}` : `Showing all ${total} ${noun(total)}`;
    if (showBtn) showBtn.textContent = n ? `Show ${n} ${noun(n)}` : 'No parts match';
    emptyEl.hidden = n > 0;
    if (!n) {
      emptyTitle.textContent = state.q ? `No match for “${state.q}”` : 'No parts match these filters';
      emptyRequest.dataset.query = state.q;
    }
    renderChips();
    const active = FACETS.reduce((k, f) => k + state[f].size, 0);
    if (filterN) filterN.textContent = active ? `(${active})` : '';
    syncUrl();
  }

  function labelOf(f: Facet, value: string) {
    const box = form?.querySelector<HTMLInputElement>(`input[name="${f}"][value="${CSS.escape(value)}"]`);
    return box?.closest('label')?.querySelector('[data-flabel]')?.textContent?.trim() ?? value;
  }

  function renderChips() {
    const chips: { text: string; remove: () => void }[] = [];
    if (state.q) chips.push({ text: `Search: “${state.q}”`, remove: () => setQuery('') });
    for (const f of FACETS)
      for (const v of state[f])
        chips.push({
          text: labelOf(f, v),
          remove: () => {
            state[f].delete(v);
            syncForm();
            update();
          },
        });
    chipsEl.replaceChildren();
    chipsEl.hidden = !chips.length;
    if (!chips.length) return;
    for (const c of chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = c.text;
      const x = document.createElement('span');
      x.setAttribute('aria-hidden', 'true');
      x.textContent = '×';
      const sr = document.createElement('span');
      sr.className = 'visually-hidden';
      sr.textContent = ' (remove filter)';
      b.append(x, sr);
      b.addEventListener('click', c.remove);
      chipsEl.append(b);
    }
    if (chips.length > 1) {
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'chip chip--clear';
      all.textContent = 'Clear all';
      all.addEventListener('click', clearAll);
      chipsEl.append(all);
    }
  }

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    for (const f of FACETS) if (state[f].size) p.set(f, [...state[f]].join(','));
    if (state.sort) p.set('sort', state.sort);
    const qs = p.toString();
    try {
      history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
    } catch {
      // ignore (sandboxed frames)
    }
  }

  function syncForm() {
    form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
      box.checked = state[box.name as Facet]?.has(box.value) ?? false;
    });
  }

  const searchRoot = () => document.querySelector<HTMLElement>('[data-part-search]');
  const searchInput = () => searchRoot()?.querySelector<HTMLInputElement>('input');

  function setQuery(q: string, mirror = true) {
    state.q = q.trim();
    if (!state.q && state.sort === 'best') state.sort = null;
    if (mirror) {
      searchRoot()?.dispatchEvent(new CustomEvent('partsearch:set', { detail: state.q }));
    }
    if (state.q && !ready) void loadIndex().then(() => ((ready = true), update())).catch(() => {});
    update();
  }

  function clearAll() {
    for (const f of FACETS) state[f].clear();
    state.sort = null;
    syncForm();
    setQuery('');
    searchInput()?.focus({ preventScroll: true });
  }

  form?.addEventListener('change', () => {
    for (const f of FACETS) state[f] = new Set([...form.querySelectorAll<HTMLInputElement>(`input[name="${f}"]:checked`)].map((b) => b.value));
    update();
  });
  sortEl.addEventListener('change', () => {
    state.sort = sortEl.value;
    update();
  });
  root.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', clearAll));

  document.addEventListener('partsearch:apply', ((e: CustomEvent<{ query: string; fromInput?: boolean }>) => {
    setQuery(e.detail.query, false);
    if (e.detail.query && !e.detail.fromInput) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }) as EventListener);

  // Mobile: the filter panel lives in a bottom sheet; desktop: in the sidebar.
  if (form && sheet) {
    const sideHost = root.querySelector<HTMLElement>('[data-side-host]')!;
    const sheetHost = root.querySelector<HTMLElement>('[data-sheet-host]')!;
    const mq = matchMedia('(min-width: 1024px)');
    const place = () => {
      (mq.matches ? sideHost : sheetHost).append(form);
      if (mq.matches && sheet.open) sheet.close();
    };
    place();
    mq.addEventListener('change', place);
    root.querySelector('[data-open-filters]')?.addEventListener('click', () => sheet.showModal());
    root.querySelectorAll('[data-sheet-close]').forEach((b) => b.addEventListener('click', () => sheet.close()));
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) sheet.close();
    });
  }

  // Deep link: /shop/?q=03186D0379&section=stagger
  const params = new URLSearchParams(location.search);
  for (const f of FACETS) {
    if (f === 'section' && root.hasAttribute('data-lock-section')) continue;
    const v = params.get(f);
    if (v && hasFacet(f)) state[f] = new Set(v.split(',').filter(Boolean));
  }
  if (params.get('sort')) state.sort = params.get('sort');
  syncForm();
  const q = params.get('q')?.slice(0, 80).trim() ?? '';
  update();
  if (q) {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.append(meta);
    setQuery(q);
    void loadIndex()
      .then(() => {
        ready = true;
        update();
        root.scrollIntoView({ block: 'start' });
      })
      .catch(() => {});
  } else void loadIndex().then(() => (ready = true)).catch(() => {});
}

const root = document.querySelector<HTMLElement>('[data-plist]');
if (root) init(root);
