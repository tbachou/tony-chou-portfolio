// VERCEL_PROJECT_PRODUCTION_URL tracks whatever domain is currently
// configured as this project's production domain on Vercel - a
// vercel.app URL until a custom domain is added, then that domain
// automatically, with no redeploy or code change needed either way.
export const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'http://localhost:3000';

export const siteName = 'Tony Chou — Interactive Portfolio';
export const siteDescription =
  'An interactive portfolio featuring an AI-driven interview about Tony Chou’s engineering work — Product Forge, Mailchimp, Topstep, and more — plus resume, about, and contact.';
