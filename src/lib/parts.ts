// Parts catalog access + build-time validation. Every store page goes
// through these helpers, so a bad catalog fails `astro build` instead of
// shipping.
import { getCollection, type CollectionEntry } from 'astro:content';
import { OEM_PATTERN, oemKey } from './partkey';

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
  'insert-spacer': 'Inserts, spacers & sleeves',
  bar: 'Bars',
  'guide-support': 'Guides & supports',
  other: 'Other',
};

let validated = false;

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
    if (oemKey(d.oem) !== d.oemKey) problems.push(`${p.id}: oemKey ${d.oemKey} does not match oem ${d.oem}`);
    if (!OEM_PATTERN.test(d.oemKey) && !d.oemVerify)
      problems.push(`${p.id}: OEM ${d.oem} is not in the 12345A6789 format (set oemVerify if intentional)`);
    keys.set(d.oemKey, [...(keys.get(d.oemKey) ?? []), p]);
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
