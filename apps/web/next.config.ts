import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: false,
  async headers() {
    return [
      {
        // Vendored app icons (public/apps) — cache hard
        // so browsers never re-request (or negative-cache) them per page load.
        source: '/apps/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
