// Kept separate from site.ts because astro.config.mjs imports site.ts and
// import.meta.env is not available there.
export const forms = {
  endpoint: 'https://api.web3forms.com/submit',
  accessKey: import.meta.env.PUBLIC_WEB3FORMS_KEY ?? '',
};
