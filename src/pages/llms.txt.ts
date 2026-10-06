import type { APIRoute } from 'astro';
import { site, serviceAreas } from '../config/site';
import { getEquipment, getServices, serviceUrl } from '../lib/content';
import { getParts, getSections, machineUrl, partUrl, sectionUrl } from '../lib/parts';
import { hoursSentence } from '../lib/hours';

// llms.txt (https://llmstxt.org): a plain-Markdown map of the site for AI
// assistants. Generated from the same content as the pages so it never drifts.
// Every part is listed with its Hayssen part number so an assistant can map
// a number to a page.
export const GET: APIRoute = async () => {
  const abs = (path: string) => new URL(path, site.url).href;
  const services = await getServices();
  const sections = await getSections();
  const parts = await getParts();
  const machines = await getEquipment();

  const partsBySection = sections
    .map((s) => {
      const list = parts.filter((p) => p.data.section.id === s.id);
      return `### [${s.data.title}](${abs(sectionUrl(s))})\n\n${list
        .map((p) => `- [${p.data.name}](${abs(partUrl(p))}): Hayssen part ${p.data.oem}, C&M ${p.data.cm}`)
        .join('\n')}`;
    })
    .join('\n\n');

  const body = `# ${site.legalName}

> Family-owned machine shop in ${site.address.city}, California, founded in ${site.founded}. Custom CNC machining, water-jet and laser cutting, welding, metal work and custom fabrication, plus a catalog of ${parts.length} replacement parts for Hayssen VFFS packaging machines, searchable by Hayssen part number. Pricing is by quote.

- Address: ${site.address.street}, ${site.address.city}, ${site.address.region} ${site.address.postalCode}
- Phone: ${site.phone}
- Email: ${site.email}
- Hours (Pacific Time): ${hoursSentence()}
- Request a quote: ${abs('/quote/')}
- Reply time: ${site.replyTime}
- Service area: ${serviceAreas.join(', ')}

## Services

${services.map((s) => `- [${s.data.title}](${abs(serviceUrl(s))}): ${s.data.summary}`).join('\n')}

## Parts catalog: Hayssen VFFS replacement parts

Catalog home: ${abs(machineUrl('hayssen-vffs'))}. Search by part number: ${abs('/shop/')}. Machine-readable index: ${abs('/shop/search-index.json')}.

${site.store.disclaimer}

${partsBySection}

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
