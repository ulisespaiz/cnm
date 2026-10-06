// schema.org JSON-LD builders. Validate changes at
// https://search.google.com/test/rich-results and https://validator.schema.org
import { site, serviceAreas } from '../config/site';

const abs = (path: string) => new URL(path, site.url).href;

// The business entity. Every page carries it; AI and search engines use it as
// the canonical description of the company.
export function localBusiness(services: { name: string; url: string }[] = []) {
  const sameAs = Object.values(site.social).filter(Boolean);
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
    priceRange: 'Quote',
    currenciesAccepted: 'USD',
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
    hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${site.address.street}, ${site.address.city}, ${site.address.region} ${site.address.postalCode}`,
    )}`,
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
      availableLanguage: ['English'],
    },
    areaServed: [
      { '@type': 'AdministrativeArea', name: 'Monterey County, CA' },
      ...serviceAreas.map((name) => ({ '@type': 'City', name: `${name}, CA` })),
    ],
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

// No `offers`: prices are quote-only, so this will not earn product rich
// results, but it describes the part to search and AI engines. No `brand`:
// most parts are not C&M-branded, and a wrong brand is worse than none.
export function product(p: {
  name: string;
  description: string;
  path: string;
  images: string[];
  category: string;
  specs: { label: string; value: string }[];
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description,
    url: abs(p.path),
    category: p.category,
    ...(p.images.length ? { image: p.images.map(abs) } : {}),
    ...(p.specs.length
      ? {
          additionalProperty: p.specs.map((s) => ({
            '@type': 'PropertyValue',
            name: s.label,
            value: s.value,
          })),
        }
      : {}),
    seller: { '@id': abs('/#business') },
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
