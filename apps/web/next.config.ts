import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@aaa/contracts', '@aaa/domain', '@aaa/adapters'],
  serverExternalPackages: ['better-sqlite3'],
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] }];
  },
};
export default config;
