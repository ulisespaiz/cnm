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
      // Optional shorter display name, only for a name too long for a page title (65 characters) or a card. Written from the
      // name by removing filler words, never by cutting a size; the page heading and specifications keep the full name.
      shortName: z.string().optional(),
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

// Shop services (machining, cutting, fabrication). Each page can be added to
// the quote list like a product.
const services = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string().max(220),
      // One line for the "More services" cards on the other service pages, written for this service alone (the summary
      // is the page's own intro and also shows on /services/, so it must not be the card text on every page).
      teaser: z.string().max(110).optional(),
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

// Shop equipment: the one list behind /our-machinery/, the machine cards and the "Key machines" count
// on the home page, the About page and llms.txt. Only machines that are in the shop's own photos.
const equipment = defineCollection({
  loader: file('src/content/equipment.json'),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      blurb: z.string().optional(), // one line for the home page card (what the machine does)
      text: z.string(),
      image: image().optional(),
      imageAlt: z.string().optional(), // what the photo looks like; the heading beside it already names the machine
      featuresLabel: z.string().default('Key Features'),
      features: z.array(z.object({ name: z.string(), text: z.string() })).default([]),
      order: z.number().default(0),
    }),
});

export const collections = { machines, sections, parts, areas, services, equipment };
