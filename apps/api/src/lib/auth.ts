import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from './prisma';

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    // Sign up is permanently closed: the single admin account is seeded
    // directly (prisma/seed.ts), never created through this app's own API.
    disableSignUp: true,
  },
});
