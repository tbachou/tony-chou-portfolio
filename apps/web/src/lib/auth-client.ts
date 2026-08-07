import { createAuthClient } from 'better-auth/react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/api/auth',
  // apps/web and apps/api are separate origins; the session cookie only
  // gets sent/stored cross origin with credentials explicitly included.
  fetchOptions: { credentials: 'include' },
});

export const { signIn, signOut, useSession } = authClient;
