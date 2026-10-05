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

export async function getAreas() {
  return (await getCollection('areas', visible)).sort((a, b) =>
    a.data.city.localeCompare(b.data.city),
  );
}

export const productUrl = (p: CollectionEntry<'products'>) =>
  `/products/${p.data.category.id}/${p.id}/`;

export const categoryUrl = (id: string) => `/products/${id}/`;

export const areaUrl = (a: CollectionEntry<'areas'>) => `/service-areas/${a.id}/`;
