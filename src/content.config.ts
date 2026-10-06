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
      summary: z.string().max(220),
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

// Shop services (machining, cutting, fabrication). Each page can be added to
// the quote list like a product.
const services = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string().max(220),
      image: image().optional(),
      imageAlt: z.string().optional(),
      // Sub-capabilities shown as cards on the service page and bullets on the home page.
      capabilities: z.array(z.object({ name: z.string(), text: z.string() })).default([]),
      materialsLabel: z.string().default('Materials'),
      materials: z.array(z.string()).default([]),
      // Short Q&A shown on the page and marked up as FAQPage. Facts only.
      faqs: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
      order: z.number().default(0),
      seoTitle: z.string().optional(),
      seoDescription: z.string().max(160).optional(),
      draft: z.boolean().default(false),
    }),
});

// Shop equipment shown on /our-machinery/.
const equipment = defineCollection({
  loader: file('src/content/equipment.json'),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      text: z.string(),
      image: image().optional(),
      featuresLabel: z.string().default('Key Features'),
      features: z.array(z.object({ name: z.string(), text: z.string() })).default([]),
      order: z.number().default(0),
    }),
});

export const collections = { categories, products, areas, services, equipment };
