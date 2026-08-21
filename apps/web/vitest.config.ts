import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Tests for the web app's SAFETY-CRITICAL rendering, not for the UI at large.
 *
 * The api side is well covered (464 tests, including snapshots pinning the
 * clinical copy byte for byte), but several of Beta's guarantees live only
 * here: whether the educational framing actually reaches the screen, what the
 * clipboard carries, and whether the plan parser can drop or misfile content.
 * Every defect found in that parser during the predeploy gate was caught by a
 * human or an agent reading code, never by a test, because nothing could see
 * this layer.
 */
export default defineConfig({
  plugins: [react()],
  // Next's tsconfig sets `jsx: "preserve"` for its own compiler, which leaves
  // esbuild on the classic runtime and makes every component file demand a
  // React import. The app uses the automatic runtime, so say so here.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    globals: true,
  },
});
