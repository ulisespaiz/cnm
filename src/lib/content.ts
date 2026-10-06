import { getCollection, type CollectionEntry } from 'astro:content';

// SHOW_DRAFTS=1 lets a production build include drafts for review.
const showDrafts = import.meta.env.DEV || process.env.SHOW_DRAFTS === '1';
const visible = (entry: { data: { draft?: boolean } }) => showDrafts || !entry.data.draft;

const byOrder = <T extends { data: { order: number; title: string } }>(a: T, b: T) =>
  a.data.order - b.data.order || a.data.title.localeCompare(b.data.title);

export async function getCategories() {
  return (await getCollection('categories')).sort(byOrder);
}

export async function getProducts(categoryId?: string) {
  const products = await getCollection(
    'products',
    (p) => visible(p) && (!categoryId || p.data.category.id === categoryId),
  );
  return products.sort(byOrder);
}

export async function getServices() {
  return (await getCollection('services', visible)).sort(byOrder);
}

export async function getEquipment() {
  return (await getCollection('equipment')).sort(
    (a, b) => a.data.order - b.data.order || a.data.name.localeCompare(b.data.name),
  );
}

// Categories that have at least one visible product.
export async function getActiveCategories() {
  const categories = await getCategories();
  const counts = await Promise.all(categories.map(async (c) => (await getProducts(c.id)).length));
  return categories.filter((_, i) => counts[i] > 0);
}

export async function getAreas() {
  return (await getCollection('areas', visible)).sort((a, b) =>
    a.data.city.localeCompare(b.data.city),
  );
}

export const productUrl = (p: CollectionEntry<'products'>) =>
  `/shop/${p.data.category.id}/${p.id}/`;

export const categoryUrl = (id: string) => `/shop/${id}/`;

export const serviceUrl = (s: CollectionEntry<'services'>) => `/services/${s.id}/`;

export const areaUrl = (a: CollectionEntry<'areas'>) => `/service-areas/${a.id}/`;
