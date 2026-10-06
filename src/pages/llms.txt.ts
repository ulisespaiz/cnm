import type { APIRoute } from 'astro';
import { site, serviceAreas } from '../config/site';
import {
  getActiveCategories,
  getEquipment,
  getProducts,
  getServices,
  categoryUrl,
  productUrl,
  serviceUrl,
} from '../lib/content';

// llms.txt (https://llmstxt.org): a plain-Markdown map of the site for AI
// assistants. Generated from the same content as the pages so it never drifts.
export const GET: APIRoute = async () => {
  const abs = (path: string) => new URL(path, site.url).href;
  const services = await getServices();
  const categories = await getActiveCategories();
  const products = await getProducts();
  const machines = await getEquipment();

  const body = `# ${site.legalName}

> Family-owned machine shop in ${site.address.city}, California, founded in ${site.founded}. Custom CNC machining, water-jet and laser cutting, welding, metal work and custom fabrication, plus a parts store. Serves food processing, agriculture and industrial customers across Monterey County. Pricing is by quote.

- Address: ${site.address.street}, ${site.address.city}, ${site.address.region} ${site.address.postalCode}
- Phone: ${site.phone}
- Email: ${site.email}
- Hours: Monday–Friday 7:00 AM–4:00 PM Pacific; closed Saturday and Sunday
- Request a quote: ${abs('/quote/')}
- Service area: ${serviceAreas.join(', ')}

## Services

${services.map((s) => `- [${s.data.title}](${abs(serviceUrl(s))}): ${s.data.summary}`).join('\n')}

## Parts store

${categories.map((c) => `- [${c.data.title}](${abs(categoryUrl(c.id))})`).join('\n')}
${products.map((p) => `- [${p.data.title}](${abs(productUrl(p))}): ${p.data.summary}`).join('\n')}

## Equipment

${machines.map((m) => `- ${m.data.name}`).join('\n')}

## About

- [About ${site.name}](${abs('/about/')})
- [Our machinery](${abs('/our-machinery/')})
- [Industries: food processing & agriculture](${abs('/industries/food-processing-agriculture/')})
- [Contact](${abs('/contact/')})
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
