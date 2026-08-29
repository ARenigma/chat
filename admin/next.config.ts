import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Admin app is server-only; no static export
  output: 'standalone',
};

export default nextConfig;
