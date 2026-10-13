// Wording a part page puts in front of search engines: the <title>, the meta description and the Product JSON-LD
// description. One template for every part, built from the catalog data only (no business facts are added here).
// src/lib/parts.ts runs these for every part when the catalog is validated, so a title or description that cannot
// be written within its limit fails `astro build` instead of being cut mid-word on the page.
import type { Part } from './parts';
import { site } from '../config/site';

export type PartData = Part['data'];

export const TITLE_LIMIT = 65; // search results cut a title off after about this many characters
export const META_LIMIT = 155; // ... and a meta description after about this many

const length = (text: string) => [...text].length;

/** The name shown in cards and used when the full name is too long for a title: `shortName`, else `name`. */
export const displayName = (d: PartData) => d.shortName ?? d.name;

/**
 * True when the part's OEM number is still being confirmed: the owner flagged it (oemVerify) and the description
 * says so ("... which we are confirming"). Such a part is never described as a replacement for, or matched by,
 * that number: its meta description says the number is being confirmed (see partMetaDescription).
 */
export const numberBeingConfirmed = (d: PartData) => !!d.oem && d.oemVerify && /confirm/i.test(d.description ?? '');

// ---------- <title> ----------

// One template for every part: "<number> <name> | C&M Machine Shop". The number is the OEM number, or the C&M number
// of a part that has none, so a search by number lands on the part and every title starts with it. The part name
// is never cut: a name too long for the limit uses the part's `shortName` (parts.json), and a part with no shortName
// and a long name stops the build.
const titleOf = (d: PartData, name: string) => `${d.oem || d.cm} ${name} | ${site.name}`;

/** Every part's page title, by part id. Throws when a title cannot fit the limit (add a `shortName`). */
export function partTitles(parts: Part[]) {
  const titles = new Map<string, string>();
  for (const p of parts) {
    const d = p.data;
    const found = (d.shortName ? [d.name, d.shortName] : [d.name]).map((name) => titleOf(d, name)).find((t) => length(t) <= TITLE_LIMIT);
    if (!found) throw new Error(`${p.id}: the page title cannot fit ${TITLE_LIMIT} characters without cutting the name (add a shortName in parts.json)`);
    titles.set(p.id, found);
  }
  return titles;
}

// ---------- meta description ----------

// A complete sentence about the part: name, OEM number and C&M number ("C&M number", the label the page text
// uses). The shop name is already in the title. The first form that fits META_LIMIT is used, longest first; a very
// long name falls back to the part's shortName. A part is never called a replacement for every VFFS machine: the
// OEM number says which parts it replaces.
function metaForms(d: PartData, name: string) {
  // The number is being confirmed: say so, and do not call the part a replacement for it or matched by it.
  if (numberBeingConfirmed(d))
    return [
      `${name} is listed under OEM # ${d.oem} (being confirmed). C&M number ${d.cm}. Send the number from your part or a photo with your quote.`,
      `${name} is listed under OEM # ${d.oem} (being confirmed). C&M number ${d.cm}. Request a quote.`,
      `${name} is listed under OEM # ${d.oem} (being confirmed). C&M number ${d.cm}.`,
    ];
  if (d.oem)
    return [
      `${name}: a replacement for OEM part number ${d.oem} for VFFS packaging machines that use that number. C&M number ${d.cm}.`,
      `${name}: a replacement for OEM part number ${d.oem} for VFFS packaging machines. C&M number ${d.cm}.`,
    ];
  return [
    `${name} (C&M number ${d.cm}) is made to match your sample or print for VFFS packaging machines. No OEM part number is listed.`,
    `${name} (C&M number ${d.cm}) is made to match your sample or print. No OEM part number is listed.`,
  ];
}

/** The part's meta description (at most META_LIMIT characters). Throws when none fits (add a `shortName`). */
export function partMetaDescription(d: PartData) {
  for (const name of d.shortName ? [d.name, d.shortName] : [d.name]) {
    const found = metaForms(d, name).find((text) => length(text) <= META_LIMIT);
    if (found) return found;
  }
  throw new Error(`${d.cm}: the meta description cannot fit ${META_LIMIT} characters (add a shortName in parts.json)`);
}

// ---------- Product JSON-LD description ----------

/**
 * The description in the part's Product JSON-LD: the catalog description (a part whose OEM number is being
 * confirmed has a description that says so and claims no replacement, which parts.ts checks), or, for a part
 * without one, a plain line from the part numbers.
 */
export function partJsonLdDescription(d: PartData) {
  return d.description?.trim() || `${d.name}. Replacement part for VFFS packaging machines, ${d.oem ? `OEM part number ${d.oem}, ` : ''}C&M number ${d.cm}.`;
}
