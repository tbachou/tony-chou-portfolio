const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  // Without this, Next.js walks up from apps/web looking for a lockfile and
  // finds an unrelated one in the user's home directory first, misdetecting
  // it as the monorepo root (see the "inferred your workspace root" build
  // warning). Pin it explicitly to the actual repo root instead.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // sharp ships a precompiled libvips binary, ~15 MB, and the tracer was
  // copying it into all 23 functions of every deployment: 393 MB of the
  // 526 MB traced here. Nothing in web calls it. The only real use in this
  // repo is the grade photo pipeline in apps/api, which deploys to Render,
  // and it reaches web only because npm hoists it to the root node_modules.
  // Next also declares it optionally for next/image, but on Vercel image
  // optimization runs as a managed service outside the function, so the copy
  // in the bundle serves no request either.
  //
  // The `../../` is load bearing and is NOT the same base as
  // outputFileTracingRoot above. Excludes are resolved against the project
  // directory, not the tracing root — collect-build-traces.js does
  // `path.join(dir, exclude)` where `dir` is apps/web. A `**/node_modules/`
  // pattern therefore resolves to `apps/web/**/node_modules/` and silently
  // matches nothing at all, since the hoisted copy is two levels up. That
  // failure is invisible: the build succeeds and the bundle is unchanged.
  // Verify by size, never by a green build. Both patterns are kept so this
  // still works if npm ever stops hoisting and installs into apps/web.
  outputFileTracingExcludes: {
    '*': [
      '../../node_modules/sharp/**',
      '../../node_modules/@img/**',
      '**/node_modules/sharp/**',
      '**/node_modules/@img/**'
    ]
  }
};

module.exports = nextConfig;
