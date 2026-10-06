import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Product categories: one JSON array, ordered as listed.
const categories = defineCollection({
  loader: file('src/content/categories.json'),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string(),
      image: image().optional(),
      order: z.number().default(0),
    }),
});

// One Markdown file per product. The body is the long description.
const products = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/products' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      category: reference('categories'),
      summary: z.string().max(200),
      images: z.array(z.object({ src: image(), alt: z.string() })).default([]),
      // Choices the customer picks before adding to the quote (size, finish, ...).
      options: z
        .array(z.object({ name: z.string(), values: z.array(z.string()).min(1) }))
        .default([]),
      specs: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
      featured: z.boolean().default(false),
      order: z.number().default(0),
      seoTitle: z.string().optional(),
      seoDescription: z.string().max(160).optional(),
      // Drafts render in `astro dev` only, never in a production build.
      draft: z.boolean().default(false),
    }),
});

// One Markdown file per city page. Kept as drafts until they carry real
// local content: thin city-swap pages are treated as doorway pages by Google.
const areas = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/areas' }),
  schema: z.object({
    city: z.string(),
    county: z.string(),
    summary: z.string().max(200),
    seoTitle: z.string().optional(),
    seoDescription: z.string().max(160).optional(),
    nearby: z.array(z.string()).default([]),
    featuredProducts: z.array(reference('products')).default([]),
    faqs: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    draft: z.boolean().default(true),
  }),
});

export const collections = { categories, products, areas };
