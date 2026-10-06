// Build-time helpers shared by the parts store components.
import { getImage } from 'astro:assets';
import { site } from '../config/site';
import { hoursRows } from '../lib/hours';
import { partUrl, TYPE_LABELS, type Part } from '../lib/parts';

type Img = Part['data']['images'][number];

export interface Thumb {
  src: string;
  width: number;
  height: number;
}

// 120x160 webp, shown at 60x80 (2x). The arguments match the search index so
// the same file is used for the list and for the dropdown.
export async function thumbOf(img: Img | undefined): Promise<Thumb | null> {
  if (!img) return null;
  const t = await getImage({ src: img, width: 120, height: 160, fit: 'contain', format: 'webp', quality: 72 });
  return { src: t.src, width: 120, height: 160 };
}

// Part photo at its native size (never scaled up), webp.
export async function photoOf(img: Img): Promise<Thumb> {
  const width = Math.min(img.width, 250);
  const height = Math.round((img.height * width) / img.width);
  const t = await getImage({ src: img, width, height, format: 'webp', quality: 82 });
  return { src: t.src, width, height };
}

// Everything the add-to-quote button needs, as data attributes.
export async function addData(part: Part, sectionTitle: string) {
  const thumb = await thumbOf(part.data.images[0]);
  return {
    'data-id': part.id,
    'data-title': part.data.name,
    'data-oem': part.data.oem,
    'data-cm': part.data.cm,
    'data-section': sectionTitle,
    'data-url': partUrl(part),
    'data-thumb': thumb?.src ?? '',
  };
}

// "Mon–Fri 7:00am – 4:00pm · Saturday 10:00am – 2:00pm" (open days only)
export const openHours = () =>
  hoursRows()
    .filter((r) => !r.closed)
    .map((r) => `${r.label} ${r.value}`)
    .join(' · ');

export const typeLabels = TYPE_LABELS;
export const leadTime = () => site.store.leadTime ?? site.store.leadTimeFallback;

// Compact attribute chips for a row: width, side, size.
export function attrChips(part: Part) {
  const a = part.data.attrs;
  return [a.width ? `${a.width}″` : '', a.side ?? '', a.size ?? ''].filter(Boolean);
}

export const SHOP_DESCRIPTION_SUFFIX = 'Replacement part for Hayssen VFFS machines. Request a quote.';
