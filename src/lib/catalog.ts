// The public catalog list: one row per part, in OEM-number order. Shared by the OEM part number index
// page (/shop/part-numbers/) and the CSV download (/shop/catalog.csv) so both always agree.
//
// Only fields that are already public on the part pages go in here. Never add `flags` (owner notes),
// `nameRaw` (the name as written in the source catalog) or any other owner-only field.
import { getParts, getSections, partUrl, type Part } from './parts';
import { site } from '../config/site';

export interface CatalogRow {
  /** OEM part number as displayed; "" when the part has none. */
  oem: string;
  /** C&M number, CM-0111. */
  cm: string;
  name: string;
  /** Section title. */
  section: string;
  /** Page path, /shop/vffs/<section>/<id>/. */
  path: string;
  /** Page URL with the site origin, for the CSV. */
  url: string;
  /** The part, for the page (photos and so on); not for the CSV. */
  part: Part;
}

// Sorted by OEM number as text, so leading zeros count and 03187A0897 sits with the other 0318… numbers
// (this is how a person scans for a number). Two parts that share an OEM number (the owner marked
// them oemVerify) then go by C&M number. Parts without an OEM number come last, by C&M number.
export function compareCatalog(a: Part['data'], b: Part['data']) {
  const ka = a.oemKey ?? '';
  const kb = b.oemKey ?? '';
  if (!ka !== !kb) return ka ? -1 : 1;
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.cm < b.cm ? -1 : a.cm > b.cm ? 1 : 0;
}

export async function getCatalogRows(): Promise<CatalogRow[]> {
  const titles = new Map((await getSections()).map((s) => [s.id, s.data.title]));
  return (await getParts())
    .sort((a, b) => compareCatalog(a.data, b.data))
    .map((part) => {
      const d = part.data;
      const path = partUrl(part);
      return {
        oem: d.oem ?? '',
        cm: d.cm,
        name: d.name,
        section: titles.get(d.section.id) ?? d.section.id,
        path,
        url: new URL(path, site.url).href,
        part,
      };
    });
}

export const CSV_HEADER = ['OEM part number', 'C&M number', 'Part name', 'Section', 'URL'] as const;

// RFC 4180: a field is quoted when it holds a comma, a double quote or a line break, and a quote inside
// it is doubled. A leading = + - @ (or a tab or carriage return) would make a spreadsheet run the cell
// as a formula, so a catalog value like that stops the build instead of reaching a customer's Excel.
const csvField = (value: string) => {
  if (/^[=+\-@\t\r]/.test(value)) throw new Error(`catalog.csv: "${value}" starts with a character a spreadsheet reads as a formula`);
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

// UTF-8 with a byte order mark (U+FEFF), so Excel opens it as UTF-8 and not as the local code page.
// Records end in CRLF, as RFC 4180 says; the last one ends in CRLF too, so `wc -l` counts header + parts.
export function catalogCsv(rows: CatalogRow[]) {
  const records = [CSV_HEADER as readonly string[], ...rows.map((r) => [r.oem, r.cm, r.name, r.section, r.url])];
  return '﻿' + records.map((record) => record.map(csvField).join(',') + '\r\n').join('');
}
