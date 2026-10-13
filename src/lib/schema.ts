// schema.org JSON-LD builders. Validate changes at
// https://search.google.com/test/rich-results and https://validator.schema.org
import { site, serviceAreas } from '../config/site';

const abs = (path: string) => new URL(path, site.url).href;

// Where the shop works: the counties its service-area cities are in, then the cities.
// Used by the business and by every Service so they always agree.
const counties = ['Monterey', 'San Benito', 'Santa Cruz', 'Santa Clara'];
export const areaServed = () => [
  ...counties.map((county) => ({ '@type': 'AdministrativeArea', name: `${county} County, CA` })),
  ...serviceAreas.map((name) => ({ '@type': 'City', name: `${name}, CA` })),
];

// The business entity. Every page carries it; AI and search engines use it as
// the canonical description of the company.
export function localBusiness(services: { name: string; url: string }[] = []) {
  // Identity profiles: the owner's Google Business Profile listing (site.maps) and the social links.
  const sameAs = [site.maps, ...Object.values(site.social)].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': site.schemaType,
    '@id': abs('/#business'),
    name: site.name,
    legalName: site.legalName,
    alternateName: ['C & M Machine Shop', 'C&M Machine Shop Salinas'],
    description: site.description,
    slogan: site.tagline,
    foundingDate: String(site.founded),
    url: abs('/'),
    logo: abs('/logo.png'),
    image: [abs('/og.jpg'), abs('/logo.png')],
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
    // No `geo`: the exact pin coordinates are not known and are never guessed.
    hasMap: site.maps,
    openingHoursSpecification: site.hours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days.map((d) => `https://schema.org/${dayNames[d]}`),
      opens: h.opens,
      closes: h.closes,
    })),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'sales',
      telephone: site.phoneE164,
      email: site.email,
      areaServed: 'US-CA',
    },
    areaServed: areaServed(),
    knowsAbout: site.expertise,
    ...(services.length
      ? {
          hasOfferCatalog: {
            '@type': 'OfferCatalog',
            name: 'Machining and fabrication services',
            itemListElement: services.map((sv) => ({
              '@type': 'Offer',
              itemOffered: { '@type': 'Service', name: sv.name, url: abs(sv.url) },
            })),
          },
        }
      : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function website() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': abs('/#website'),
    name: site.name,
    url: abs('/'),
    publisher: { '@id': abs('/#business') },
    inLanguage: 'en-US',
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

// A replacement part. No `offers` (prices are quote-only) and deliberately no
// `brand`, `mpn` or `seller`: the OEM number, when the part has one, is listed
// as a plain "OEM part number" property and the part is tied to the kind of machine it
// replaces through isAccessoryOrSparePartFor, so nothing claims the part is
// made by, or sold on behalf of, the machine's manufacturer.
export function product(p: {
  name: string;
  description: string;
  path: string;
  images: string[];
  category: string;
  sku: string; // C&M number
  oem?: string; // OEM part number; leave out when the part has none
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description,
    url: abs(p.path),
    sku: p.sku,
    category: p.category,
    ...(p.images.length ? { image: p.images.map(abs) } : {}),
    ...(p.oem ? { additionalProperty: [{ '@type': 'PropertyValue', name: 'OEM part number', value: p.oem }] } : {}),
    isAccessoryOrSparePartFor: { '@type': 'Product', name: 'VFFS packaging machine' },
  };
}

// A list of pages (a section's parts, for example).
export function itemList(items: { name: string; path: string }[], name?: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    ...(name ? { name } : {}),
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      url: abs(item.path),
    })),
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
