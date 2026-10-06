// Kept separate from site.ts because astro.config.mjs imports site.ts and
// import.meta.env is not available there.

// Web3Forms access key for cmoreno@cmmachshop.com (form "C&M Shop"). It is
// public by design: it ships in every form's HTML and can only send mail to
// that inbox. PUBLIC_WEB3FORMS_KEY overrides it, e.g. to test with another inbox.
export const WEB3FORMS_KEY = '61d7ceb3-cfc5-4e25-b31a-dcbf71ea9099';

export const forms = {
  endpoint: 'https://api.web3forms.com/submit',
  accessKey: import.meta.env.PUBLIC_WEB3FORMS_KEY || WEB3FORMS_KEY,
};
