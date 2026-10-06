// Single source of truth for business details. Every page, the footer, the
// structured data and the quote form read from here.
//
// Placeholder values are flagged until the Simply Static export is extracted;
// `npm run prelaunch` lists every one still left.

export const site = {
  name: 'TODO Business Name',
  legalName: 'TODO Business Legal Name',
  tagline: 'TODO one-line value proposition',
  description:
    'TODO 150-160 character description used on the home page and as the default meta description.',
  url: 'https://example.com', // TODO production domain, no trailing slash

  phone: 'TODO', // display format, e.g. (831) 555-0100
  phoneE164: 'TODO', // e.g. +18315550100, used for tel: links and schema
  email: 'TODO', // public contact address
  quoteInbox: 'TODO', // where Web3Forms delivers; set when creating the key

  address: {
    street: 'TODO',
    city: 'Salinas',
    region: 'CA',
    postalCode: 'TODO',
    country: 'US',
  },
  geo: { lat: 0, lng: 0 }, // TODO from the Google Business Profile pin

  hours: [
    // TODO confirm, schema.org format
    { days: ['Mo', 'Tu', 'We', 'Th', 'Fr'], opens: '08:00', closes: '17:00' },
  ],

  // schema.org LocalBusiness subtype that best fits. TODO pick once the
  // product line is known (e.g. HomeAndConstructionBusiness, Store).
  schemaType: 'LocalBusiness',

  social: {
    // TODO full URLs; empty strings are skipped
    googleBusiness: '',
    facebook: '',
    instagram: '',
    yelp: '',
  },
} as const;

// Cities shown on the service-area hub and offered in the quote form.
// A city only gets its own page when src/content/areas/<slug>.md exists with
// `draft: false` and genuinely local content (see README).
export const serviceAreas = [
  'Salinas',
  'Monterey',
  'Carmel-by-the-Sea',
  'Pacific Grove',
  'Seaside',
  'Marina',
  'Castroville',
  'Prunedale',
  'Gonzales',
  'Soledad',
  'Hollister',
  'Watsonville',
  'Gilroy',
  'Morgan Hill',
  'San Jose',
] as const;

export const nav = [
  { label: 'Products', href: '/products/' },
  { label: 'Service Areas', href: '/service-areas/' },
  { label: 'About', href: '/about/' },
  { label: 'Contact', href: '/contact/' },
] as const;
