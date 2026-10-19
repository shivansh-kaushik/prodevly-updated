import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Security headers.
 *
 * The CSP is pragmatic rather than nonce-based. Next injects inline bootstrap
 * scripts, and a nonce CSP would force every page dynamic, which would remove
 * static generation from the marketing site. 'unsafe-inline' for scripts is the
 * cost. Everything else (frame-ancestors, object-src, base-uri, form-action) is
 * locked down, which closes the attack paths that matter for a lead-gen site.
 */
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is needed by the Turbopack dev runtime only.
  isProd ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Web3Forms is the only third-party endpoint the browser talks to.
  "connect-src 'self' https://api.web3forms.com",
  // three.js can compile shaders in workers created from blob URLs.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://api.web3forms.com",
  "frame-ancestors 'none'",
  ...(isProd ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

const nextConfig: NextConfig = {
  // Classic caching model: the public home page uses ISR through `revalidate`,
  // and the admin is dynamic. `cacheComponents` would force 'use cache'
  // boundaries around every database read.
  cacheComponents: false,

  images: {
    formats: ['image/avif', 'image/webp'],
    qualities: [60, 75, 90],
  },

  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Admin screens and the admin API must never be cached by a shared proxy or indexed.
        source: '/admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },

  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
