import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Admin app is server-only; no static export
  output: 'standalone',
  // Lets several `next dev` processes run in parallel with separate caches:
  // NEXT_DIST_DIR=.next-foo npx next dev -p 3102
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
