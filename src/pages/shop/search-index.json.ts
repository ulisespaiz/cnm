import type { APIRoute } from 'astro';
import { getImage } from 'astro:assets';
import { getEntry } from 'astro:content';
import { getParts, partUrl } from '../../lib/parts';
import { noLead0 } from '../../lib/partkey';

// Static search index for the parts store, bulk paste and ?part= links.
// One compact record per part (shared contract, do not rename fields):
//   i  part id            o  OEM display      k  OEM key (A-Z0-9)
//   z  key without leading zeros               a  extra keys (typos as written in the source)
//   c  C&M number         n  name             w  other names (aka)
//   s  section id         st section title    y  part type
//   u  page URL           p  thumbnail URL (120x160 webp) or ""
export const GET: APIRoute = async () => {
  const parts = await getParts();
  const titles = new Map<string, string>();
  const records = await Promise.all(
    parts.map(async (part) => {
      const d = part.data;
      if (!titles.has(d.section.id)) titles.set(d.section.id, (await getEntry(d.section))?.data.title ?? d.section.id);
      const img = d.images[0];
      const thumb = img ? (await getImage({ src: img, width: 120, height: 160, fit: 'contain', format: 'webp', quality: 72 })).src : '';
      return {
        i: part.id,
        o: d.oem,
        k: d.oemKey,
        z: noLead0(d.oemKey),
        a: d.oemAlt,
        c: d.cm,
        n: d.name,
        w: d.aka,
        s: d.section.id,
        st: titles.get(d.section.id)!,
        y: d.type,
        u: partUrl(part),
        p: thumb,
      };
    }),
  );
  return new Response(JSON.stringify(records), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
