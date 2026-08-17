// Allow-list of Electron apps that have a beta-access gate on the portfolio
// site. A plain string column on AccessRequest (not a Prisma enum) so a new
// app can be added here without a migration.
export const APP_SLUGS = ['panel', 'carryover'] as const;

export type AppSlug = (typeof APP_SLUGS)[number];
