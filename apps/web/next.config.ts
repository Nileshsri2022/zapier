import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: false,
  async headers() {
    return [
      {
        // Vendored app icons (public/apps-v2) — versioned folder, cache hard
        // so browsers never re-request (or negative-cache) them per page load.
        source: '/apps-v2/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
