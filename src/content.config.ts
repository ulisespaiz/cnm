import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Parts catalog. One machine (VFFS packaging machines) split into sections (sections.json);
// every part has a C&M catalog number, and most also have an OEM
// number. A part with no OEM number is identified by its C&M number alone.
// Data: src/content/machines.json, sections.json, parts.json. Images live in
// src/assets/parts/. Validation runs at build time in src/lib/parts.ts.
const machines = defineCollection({
  loader: file('src/content/machines.json'),
  schema: z.object({
    name: z.string(), // "VFFS Packaging Machines"
    summary: z.string(),
    models: z.array(z.string()).default([]), // owner to fill once known
    order: z.number().default(0),
  }),
});

const sections = defineCollection({
  loader: file('src/content/sections.json'),
  schema: z.object({
    machine: reference('machines'),
    title: z.string(), // "Stagger Parts"
    blurb: z.string(), // unique 1-2 sentence intro (SEO)
    order: z.number(),
  }),
});

const PART_TYPES = [
  'spring',
  'shaft',
  'pulley',
  'bracket',
  'plate',
  'link',
  'bushing-bearing',
  'seal-face',
  'cylinder',
  'block',
  'fastener',
  'assembly',
  'insulator',
  'knife-gripper',
  'roller-hub',
  'gear',
  'insert-spacer',
  'bar',
  'guide-support',
  'other',
] as const;

const parts = defineCollection({
  loader: file('src/content/parts.json'),
  schema: ({ image }) =>
    z.object({
      machine: reference('machines'),
      section: reference('sections'),
      name: z.string(), // cleaned display name
      nameRaw: z.string(), // exactly as in the source catalog
      description: z.string().max(600).optional(), // plain-text product description for the part page (shown only when present)
      oem: z.string().optional(), // display form, e.g. 03187A0897; absent when the part has no OEM number
      oemKey: z.string().optional(), // normalized: uppercase A-Z0-9 only; set whenever oem is
      oemAlt: z.array(z.string()).default([]), // extra keys that must also match (typos as written in the source)
      oemVerify: z.boolean().default(false), // owner must confirm the number
      cm: z.string(), // C&M catalog number, CM-0001
      type: z.enum(PART_TYPES),
      attrs: z
        .object({
          width: z.enum(['14', '16']).optional(),
          side: z.enum(['LH', 'RH']).optional(),
          size: z.string().optional(),
        })
        .default({}),
      images: z.array(image()).default([]),
      imageAlt: z.string(),
      sharedPhoto: z.boolean().default(false), // photo also used for a similar part
      aka: z.array(z.string()).default([]), // other names the part is listed under
      note: z.string().optional(),
      availability: z.enum(['ask', 'in-stock', 'made-to-order']).default('ask'),
      featured: z.boolean().default(false),
      order: z.number(), // catalog order
      flags: z.array(z.string()).default([]), // data-quality notes for the owner (not shown)
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
    featuredParts: z.array(reference('parts')).default([]),
    faqs: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    draft: z.boolean().default(true),
  }),
});

// Shop services (machining, cutting, fabrication). Each service page links to the quote form
// (/quote/?service=<id>#details).
const services = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
  schema: ({ image }) =>
    z.object({
      // Short public name: cards, breadcrumbs, the footer, JSON-LD and the quote form.
      title: z.string(),
      // The service page's h1, carrying the words its seoTitle targets ("CNC Machining"). Falls back to title.
      heading: z.string().optional(),
      // The full description: shown once, on the service's own page (and in llms.txt and JSON-LD).
      summary: z.string().max(220),
      // One plain sentence for cards on other pages (services hub, "more services", industries, home).
      // Only facts already in the same file. Falls back to summary.
      teaser: z.string().max(120).optional(),
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
      // The service this machine performs, when the copy makes that plain. /our-machinery/ links the
      // machine to that service page, and the service page links back to the machine.
      service: reference('services').optional(),
      featuresLabel: z.string().default('Key Features'),
      features: z.array(z.object({ name: z.string(), text: z.string() })).default([]),
      order: z.number().default(0),
    }),
});

export const collections = { machines, sections, parts, areas, services, equipment };
