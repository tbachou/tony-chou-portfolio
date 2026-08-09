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
  // apps/web and apps/api are separate origins; better-auth's own CSRF
  // origin check needs the frontend's origin(s) allowed, same list as
  // main.ts's CORS_ORIGIN.
  trustedOrigins: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
  advanced: {
    // Default SameSite=Lax cookies never reach the session-check request:
    // that's a cross-origin fetch, not a top-level navigation, so the
    // browser withholds a Lax cookie from it and the client never sees a
    // session despite sign-in succeeding. SameSite=None fixes that but
    // requires Secure, which local http://localhost dev can't satisfy —
    // so only flip it in production, where both apps are served over
    // HTTPS.
    defaultCookieAttributes:
      process.env.NODE_ENV === 'production'
        ? { sameSite: 'none', secure: true }
        : {},
  },
});
