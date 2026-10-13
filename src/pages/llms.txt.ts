import type { APIRoute } from 'astro';
import { site, serviceAreas } from '../config/site';
import { getEquipment, getServices, serviceUrl } from '../lib/content';
import { getParts, getSections, machineUrl, MAIN_MACHINE, partUrl, sectionUrl } from '../lib/parts';
import { hoursSentence } from '../lib/hours';

// llms.txt (https://llmstxt.org): a plain-Markdown map of the site for AI
// assistants. Generated from the same content as the pages so it never drifts.
// The main sections stay short: the pitch, the hubs and the catalog sections. Every part is
// listed under "## Optional" (llmstxt.org: the part an assistant may skip when short of room)
// with its OEM part number (parts that have none are listed by C&M number) so it can map a
// number to a page. With the parts shop off (site.store.enabled) the whole parts catalog, and
// every mention of it, is left out.
export const GET: APIRoute = async () => {
  const abs = (path: string) => new URL(path, site.url).href;
  const shopOn = site.store.enabled;
  const services = await getServices();
  const sections = shopOn ? await getSections() : [];
  const parts = shopOn ? await getParts() : [];
  const machines = await getEquipment();

  const sectionLinks = sections
    .map((s) => `- [${s.data.title}](${abs(sectionUrl(s))}): ${parts.filter((p) => p.data.section.id === s.id).length} parts`)
    .join('\n');

  const partsBySection = sections
    .map((s) => {
      const list = parts.filter((p) => p.data.section.id === s.id);
      return `### ${s.data.title}\n\n${list
        .map((p) =>
          p.data.oem
            ? `- [${p.data.name}](${abs(partUrl(p))}): OEM part number ${p.data.oem}, C&M ${p.data.cm}`
            : `- [${p.data.name}](${abs(partUrl(p))}): C&M ${p.data.cm} (no OEM part number listed)`,
        )
        .join('\n')}`;
    })
    .join('\n\n');

  const catalogPitch = shopOn
    ? `, plus a catalog of ${parts.length} replacement parts for vertical form fill seal (VFFS) packaging machines, searchable by OEM part number or C&M number`
    : '';
  const catalogSection = shopOn
    ? `## Parts catalog: VFFS packaging machine replacement parts

- [Parts store](${abs('/shop/')}): search by OEM part number or C&M number
- [VFFS packaging machine parts](${abs(machineUrl(MAIN_MACHINE))}): how to find your part number
${sectionLinks}

${site.store.disclaimer}

`
    : '';
  const optionalSection = shopOn
    ? `
## Optional

Every replacement part, by section.

${partsBySection}
`
    : '';

  const body = `# ${site.legalName}

> Family-owned machine shop in ${site.address.city}, California, founded in ${site.founded}. Custom CNC machining, water-jet and laser cutting, welding, metal work and custom fabrication${catalogPitch}. Pricing is by quote.

- Address: ${site.address.street}, ${site.address.city}, ${site.address.region} ${site.address.postalCode}
- Phone: ${site.phone}
- Email: ${site.email}
- Hours (Pacific Time): ${hoursSentence()}
- Request a quote: ${abs('/quote/')}
- Reply time: ${site.replyTime}
- Service area: ${serviceAreas.join(', ')}

## Services

- [All services](${abs('/services/')})
${services.map((s) => `- [${s.data.title}](${abs(serviceUrl(s))}): ${s.data.summary}`).join('\n')}

${catalogSection}## Equipment

${machines.map((m) => `- ${m.data.name}`).join('\n')}

## About

- [About ${site.name}](${abs('/about/')})
- [Our machinery](${abs('/our-machinery/')})
- [Industries: food processing & agriculture](${abs('/industries/food-processing-agriculture/')})
- [Service areas](${abs('/service-areas/')})
- [Contact](${abs('/contact/')})
- [Privacy policy](${abs('/privacy/')})
${optionalSection}`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
