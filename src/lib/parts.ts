// Parts catalog access + build-time validation. Every store page goes
// through these helpers, so a bad catalog fails `astro build` instead of
// shipping.
import { getCollection, type CollectionEntry } from 'astro:content';
import { OEM_PATTERN, oemKey } from './partkey';
import { numberBeingConfirmed, partMetaDescription, partTitles, TITLE_LIMIT } from './partmeta';

export type Part = CollectionEntry<'parts'>;
export type Section = CollectionEntry<'sections'>;
export type Machine = CollectionEntry<'machines'>;

export const TYPE_LABELS: Record<Part['data']['type'], string> = {
  spring: 'Springs',
  shaft: 'Shafts',
  pulley: 'Pulleys',
  bracket: 'Brackets',
  plate: 'Plates',
  link: 'Links',
  'bushing-bearing': 'Bushings & bearings',
  'seal-face': 'Seal faces',
  cylinder: 'Cylinders',
  block: 'Blocks',
  fastener: 'Screws, bolts & pins',
  assembly: 'Assemblies',
  insulator: 'Insulators',
  'knife-gripper': 'Knife holders & grippers',
  'roller-hub': 'Rollers & hubs',
  gear: 'Gears & racks',
  'insert-spacer': 'Inserts, spacers & sleeves',
  bar: 'Bars',
  'guide-support': 'Guides & supports',
  other: 'Other',
};

// The one machine the catalog covers today (machines.json id; part URLs are /shop/<id>/...).
export const MAIN_MACHINE = 'vffs';

let validated = false;

const DESCRIPTION_WORDING: [RegExp, string][] = [
  [/\bfits\b/i, 'says "fits": fit is identified only by the OEM part number, write "a replacement for OEM part number ..." or "made to match ..."'],
  [/\ba OEM\b/i, 'says "a OEM", write "an OEM"'],
  [/\bmade to replace\b/i, 'says "made to replace": write "a replacement for OEM part number ..."'],
  [/\b(?:is|are) replaced by\b/i, 'says "is replaced by": write "a replacement for OEM part number ..."'],
  [/\bin place of\b/i, 'says "in place of": write "a replacement for OEM part number ..."'],
  [/\bis the pattern\b/i, 'says "is the pattern": write "made to match your part number, sample or print"'],
  [/\bon (?:a )?VFFS packaging machines?\b/i, 'says "on VFFS packaging machines" as a fit claim: write "for VFFS packaging machines, matched by OEM part number ..."'],
  [/\bfiled under\b|\blisted (?:under|in) (?!OEM\b)|\b(?:from|in) the [^.,;]{3,50}? section\b/i, 'reads like a database label ("filed under", "listed under", "from the ... section"): say what the part is and give its numbers'],
];

// The sizes in a part name: "1\"", "26.875", "5/16", "22" in "x 22 3/4 Long", but not the 2 of "2 Keyways".
function sizeTokens(name: string) {
  const tokens = name.split(/\s+/);
  const sizes: string[] = [];
  tokens.forEach((word, i) => {
    if (!/\d/.test(word)) return;
    const prev = (tokens[i - 1] ?? '').toLowerCase();
    const next = (tokens[i + 1] ?? '').toLowerCase();
    const count = /^\d+[,;]?$/.test(word) && prev !== 'x' && next !== 'x' && !/^(?:long|od|id|bore|stroke)\b/.test(next);
    if (!count) sizes.push(word.replace(/^\(|[,;)]$/g, ''));
  });
  return sizes;
}

function validate(parts: Part[], sections: Section[]) {
  if (validated) return;
  const problems: string[] = [];
  const sectionIds = new Set(sections.map((s) => s.id));
  const cms = new Map<string, string>();
  const keys = new Map<string, Part[]>();
  for (const p of parts) {
    const d = p.data;
    if (!sectionIds.has(d.section.id)) problems.push(`${p.id}: unknown section ${d.section.id}`);
    if (!/^CM-\d{4}$/.test(d.cm)) problems.push(`${p.id}: bad CM number ${d.cm}`);
    if (cms.has(d.cm)) problems.push(`${p.id}: CM number ${d.cm} also used by ${cms.get(d.cm)}`);
    cms.set(d.cm, p.id);
    // The description quotes the part numbers as prose (and feeds the meta description and JSON-LD),
    // so it must be edited together with them: fail the build instead of publishing a mismatch.
    if (d.description && !d.description.includes(d.cm)) problems.push(`${p.id}: description does not mention ${d.cm}`);
    if (d.description && d.oem && !d.description.includes(d.oem))
      problems.push(`${p.id}: description does not mention OEM part number ${d.oem} (edit it when the number changes)`);
    // Wording the owner ruled out. Fit is identified only by the OEM part number, so a description never says "fits",
    // never claims a replacement by machine type ("... on VFFS packaging machines") and reads like a shop, not like
    // a database ("filed under", "from the ... section"). Approved: "a replacement for OEM part number X",
    // "made to match your part number, sample or print", "for VFFS packaging machines, matched by OEM part number".
    if (d.description) {
      for (const [pattern, advice] of DESCRIPTION_WORDING)
        if (pattern.test(d.description)) problems.push(`${p.id}: description ${advice}`);
      // A part whose OEM number is still being confirmed must not claim to replace or match it (its meta description
      // and Product JSON-LD say the number is being confirmed; see partmeta.ts).
      if (numberBeingConfirmed(d) && /\breplac(?:e|es|ed|ing|ement)\b|\bmatched by\b/i.test(d.description))
        problems.push(`${p.id}: the description says OEM ${d.oem} is being confirmed, so it must not call the part a replacement for it or matched by it`);
    }
    if (d.shortName !== undefined) {
      // A short name is the name with filler words left out: shorter, and every size in the name stays (a size is a
      // number with a decimal point, a fraction, a unit mark or an "x", "Long", "OD" ... next to it; a count such as
      // "2 Keyways" may go).
      if (d.shortName.length >= d.name.length) problems.push(`${p.id}: shortName must be shorter than name`);
      const missing = sizeTokens(d.name).filter((token) => !d.shortName!.includes(token));
      if (missing.length) problems.push(`${p.id}: shortName leaves out ${missing.join(', ')} from the name (keep every size)`);
    }
    // A part may have no OEM number: it is then found and quoted by its C&M number
    // (checked above), and carries neither oem nor oemKey nor oemAlt.
    if (d.oem === undefined && d.oemKey === undefined) {
      if (d.oemAlt.length) problems.push(`${p.id}: oemAlt is set but the part has no oem`);
      continue;
    }
    if (!d.oem || !d.oemKey) {
      problems.push(`${p.id}: oem and oemKey must be set together (or both left out for a part with no OEM number)`);
      continue;
    }
    if (oemKey(d.oem) !== d.oemKey) problems.push(`${p.id}: oemKey ${d.oemKey} does not match oem ${d.oem}`);
    if (!OEM_PATTERN.test(d.oemKey) && !d.oemVerify)
      problems.push(`${p.id}: OEM ${d.oem} is not in the 12345A6789 format (set oemVerify if intentional)`);
    keys.set(d.oemKey, [...(keys.get(d.oemKey) ?? []), p]);
  }
  // Titles and meta descriptions come from partmeta.ts; building them here means a part that cannot get a title
  // (65 characters) or a meta description (155) without cutting its name stops the build.
  try {
    const titles = partTitles(parts);
    const seen = new Map<string, string>();
    for (const p of parts) {
      const title = titles.get(p.id)!;
      if (seen.has(title)) problems.push(`${p.id}: page title "${title}" is also the title of ${seen.get(title)}`);
      seen.set(title, p.id);
      if (title.endsWith('…') || title.length > TITLE_LIMIT) problems.push(`${p.id}: page title "${title}" is cut or too long`);
    }
  } catch (e) {
    problems.push((e as Error).message);
  }
  for (const p of parts) {
    try {
      const meta = partMetaDescription(p.data);
      const need = [p.data.cm, ...(p.data.oem ? [p.data.oem] : [])];
      for (const text of need) if (!meta.includes(text)) problems.push(`${p.id}: meta description lacks "${text}"`);
      if (numberBeingConfirmed(p.data) && (!meta.includes('being confirmed') || /\breplacement\b|\bmatched by\b|\bmade to match\b/i.test(meta)))
        problems.push(`${p.id}: the OEM number is being confirmed, so the meta description must say so and must not state a match`);
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  for (const [k, list] of keys)
    if (list.length > 1 && !list.every((p) => p.data.oemVerify))
      problems.push(`OEM ${k} is used by ${list.map((p) => p.id).join(', ')} (mark oemVerify if intentional)`);
  if (problems.length) throw new Error(`Parts catalog is invalid:\n- ${problems.join('\n- ')}`);
  validated = true;
}

const byOrder = <T extends { data: { order: number } }>(a: T, b: T) => a.data.order - b.data.order;

export async function getMachines() {
  return (await getCollection('machines')).sort(byOrder);
}

export async function getSections(machineId?: string) {
  const all = (await getCollection('sections')).sort(byOrder);
  return machineId ? all.filter((s) => s.data.machine.id === machineId) : all;
}

// All parts in catalog order (section order, then catalog order).
export async function getParts(filter: { machine?: string; section?: string } = {}) {
  const sections = await getSections();
  const parts = await getCollection('parts');
  validate(parts, sections);
  const sectionOrder = new Map(sections.map((s) => [s.id, s.data.order]));
  return parts
    .filter((p) => (!filter.machine || p.data.machine.id === filter.machine) && (!filter.section || p.data.section.id === filter.section))
    .sort((a, b) => (sectionOrder.get(a.data.section.id)! - sectionOrder.get(b.data.section.id)!) || a.data.order - b.data.order);
}

// The part's main identifier: its OEM number, or its C&M number when it has none.
export const mainNumber = (d: Part['data']) => d.oem || d.cm;

// Parts that carry the same OEM number (the owner marked each of them oemVerify). Computed from the catalog,
// never listed by hand: every OEM key used by two or more parts.
export function sharedOemGroups(all: Part[]) {
  const groups = new Map<string, Part[]>();
  for (const p of all) if (p.data.oemKey) groups.set(p.data.oemKey, [...(groups.get(p.data.oemKey) ?? []), p]);
  for (const [key, list] of groups) if (list.length < 2) groups.delete(key);
  return groups;
}

// The other parts with this part's OEM number (an empty list for nearly every part).
export const sharedOemParts = (part: Part, all: Part[]) =>
  part.data.oemKey ? all.filter((p) => p.id !== part.id && p.data.oemKey === part.data.oemKey) : [];

export const machineUrl = (machineId: string) => `/shop/${machineId}/`;
export const sectionUrl = (s: Section) => `/shop/${s.data.machine.id}/${s.id}/`;
export const partUrl = (p: Part) => `/shop/${p.data.machine.id}/${p.data.section.id}/${p.id}/`;

// Same type in the same section first, then catalog neighbours.
export function relatedParts(part: Part, all: Part[], n = 4) {
  const same = all.filter((p) => p.data.section.id === part.data.section.id && p.id !== part.id);
  const idx = all.findIndex((p) => p.id === part.id);
  const byDistance = (p: Part) => Math.abs(all.findIndex((x) => x.id === p.id) - idx);
  const sameType = same.filter((p) => p.data.type === part.data.type).sort((a, b) => byDistance(a) - byDistance(b));
  const rest = same.filter((p) => p.data.type !== part.data.type).sort((a, b) => byDistance(a) - byDistance(b));
  return [...sameType, ...rest].slice(0, n);
}

// Previous / next part within the same section.
export function neighbours(part: Part, all: Part[]) {
  const same = all.filter((p) => p.data.section.id === part.data.section.id);
  const i = same.findIndex((p) => p.id === part.id);
  return { prev: same[i - 1], next: same[i + 1] };
}
