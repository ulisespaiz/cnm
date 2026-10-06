// Single source of truth for business details. Every page, the footer, the
// structured data and the quote form read from here.
//
// Placeholder values are flagged until the Simply Static export is extracted;
// `npm run prelaunch` lists every one still left.

export const site = {
  name: 'C&M Machine Shop',
  legalName: 'C&M Machine Shop Inc.',
  tagline: 'Precision machining, fabrication and parts in Salinas',
  description:
    'Family-owned machine shop in Salinas, CA since 2002. CNC machining, water-jet and laser cutting, welding, fabrication and a parts store.',
  url: 'https://cmmachshop.com',

  phone: '(831) 753-7092',
  phoneE164: '+18317537092',
  email: 'cmoreno@cmmachshop.com',
  quoteInbox: 'cmoreno@cmmachshop.com', // Web3Forms delivers here; set when creating the key

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

  // schema.org has no machine-shop type; LocalBusiness plus Service entries
  // on each service page describe it best.
  schemaType: 'LocalBusiness',

  social: {
    // Full URLs; empty strings are skipped
    googleBusiness: '',
    facebook: '',
    instagram: '',
    yelp: 'https://www.yelp.com/biz/c-and-m-machine-shop-salinas-2',
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
  { label: 'About', href: '/about/' },
  { label: 'Services', href: '/services/' },
  { label: 'Shop', href: '/shop/' },
  { label: 'Our Machinery', href: '/our-machinery/' },
  { label: 'Contact', href: '/contact/' },
] as const;

export const industries = ['Food processing', 'Agriculture'] as const;
