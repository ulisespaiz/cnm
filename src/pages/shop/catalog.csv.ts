import type { APIRoute } from 'astro';
import { catalogCsv, getCatalogRows } from '../../lib/catalog';
import { site } from '../../config/site';

// The whole catalog as a spreadsheet: OEM part number, C&M number, part name, section and the part's URL,
// sorted like /shop/part-numbers/. Static file at /shop/catalog.csv (public/_headers sets its type and cache).
// Parts shop off (site.store.enabled): an empty file without loading any part; the build then deletes dist/shop/.
export const GET: APIRoute = async () => {
  const body = site.store.enabled ? catalogCsv(await getCatalogRows()) : '';
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
};
