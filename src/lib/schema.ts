// schema.org JSON-LD builders. Validate changes at
// https://search.google.com/test/rich-results and https://validator.schema.org
import { site, serviceAreas } from '../config/site';

const abs = (path: string) => new URL(path, site.url).href;

export function localBusiness() {
  const sameAs = Object.values(site.social).filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': site.schemaType,
    '@id': abs('/#business'),
    name: site.name,
    legalName: site.legalName,
    description: site.description,
    url: abs('/'),
    telephone: site.phoneE164,
    email: site.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address.street,
      addressLocality: site.address.city,
      addressRegion: site.address.region,
      postalCode: site.address.postalCode,
      addressCountry: site.address.country,
    },
    ...(site.geo.lat
      ? { geo: { '@type': 'GeoCoordinates', latitude: site.geo.lat, longitude: site.geo.lng } }
      : {}),
    openingHoursSpecification: site.hours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days.map((d) => `https://schema.org/${dayNames[d]}`),
      opens: h.opens,
      closes: h.closes,
    })),
    areaServed: serviceAreas.map((name) => ({ '@type': 'City', name: `${name}, CA` })),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

const dayNames: Record<string, string> = {
  Mo: 'Monday',
  Tu: 'Tuesday',
  We: 'Wednesday',
  Th: 'Thursday',
  Fr: 'Friday',
  Sa: 'Saturday',
  Su: 'Sunday',
};

export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: abs(item.path),
    })),
  };
}

// No `offers`: prices are quote-only, so this will not earn product rich
// results, but it still describes the page to search engines.
export function product(p: { name: string; description: string; path: string; images: string[] }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description,
    url: abs(p.path),
    ...(p.images.length ? { image: p.images.map(abs) } : {}),
    brand: { '@type': 'Brand', name: site.name },
  };
}

export function faqPage(faqs: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
