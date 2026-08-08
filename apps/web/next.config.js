const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  // Without this, Next.js walks up from apps/web looking for a lockfile and
  // finds an unrelated one in the user's home directory first, misdetecting
  // it as the monorepo root (see the "inferred your workspace root" build
  // warning). Pin it explicitly to the actual repo root instead.
  outputFileTracingRoot: path.join(__dirname, '../../')
};

module.exports = nextConfig;
