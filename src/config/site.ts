// Single source of truth for business details. Every page, the footer, the
// structured data and the quote form read from here.
//
// Placeholder values are flagged until the Simply Static export is extracted;
// `npm run prelaunch` lists every one still left.

export const site = {
  name: 'C&M Machine Shop',
  legalName: 'C&M Machine Shop Inc.',
  tagline: 'TODO one-line value proposition',
  description:
    'TODO 150-160 character description used on the home page and as the default meta description.',
  url: 'https://cmmachshop.com',

  phone: '(831) 753-7092',
  phoneE164: '+18317537092',
  email: 'TODO', // public contact address
  quoteInbox: 'TODO', // where Web3Forms delivers; set when creating the key

  address: {
    street: '772 Vertin Ave',
    city: 'Salinas',
    region: 'CA',
    postalCode: '93901',
    country: 'US',
  },
  geo: { lat: 0, lng: 0 }, // TODO from the Google Business Profile pin

  hours: [
    { days: ['Mo', 'Tu', 'We', 'Th', 'Fr'], opens: '07:00', closes: '16:00' },
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
