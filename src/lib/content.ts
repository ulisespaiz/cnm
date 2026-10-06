import { getCollection, type CollectionEntry } from 'astro:content';

// SHOW_DRAFTS=1 lets a production build include drafts for review.
const showDrafts = import.meta.env.DEV || process.env.SHOW_DRAFTS === '1';
const visible = (entry: { data: { draft?: boolean } }) => showDrafts || !entry.data.draft;

const byOrder = <T extends { data: { order: number; title: string } }>(a: T, b: T) =>
  a.data.order - b.data.order || a.data.title.localeCompare(b.data.title);

export async function getServices() {
  return (await getCollection('services', visible)).sort(byOrder);
}

export async function getEquipment() {
  return (await getCollection('equipment')).sort(
    (a, b) => a.data.order - b.data.order || a.data.name.localeCompare(b.data.name),
  );
}

export async function getAreas() {
  return (await getCollection('areas', visible)).sort((a, b) =>
    a.data.city.localeCompare(b.data.city),
  );
}

export const serviceUrl = (s: CollectionEntry<'services'>) => `/services/${s.id}/`;

export const areaUrl = (a: CollectionEntry<'areas'>) => `/service-areas/${a.id}/`;
