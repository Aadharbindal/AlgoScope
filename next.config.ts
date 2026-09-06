import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge sits over the bottom-left of the page and reads as
  // part of the design when it isn't. Compile and runtime errors still surface.
  devIndicators: false,

  async headers() {
    return [
      {
        // The embed exists to be framed, so it is the one route that says so.
        // `frame-ancestors *` is the whole permission it grants: the page has
        // no session, no storage the host shares, and nothing to act on the
        // reader's behalf, so a hostile framer gains a step-through player.
        source: '/embed/:path*',
        // Only CSP is set. `X-Frame-Options` has no "allow any origin" value —
        // an empty one is invalid and merely ignored — so emitting it here
        // would be noise that a proxy might later normalise into a refusal.
        headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
      },
      {
        // Everything else refuses to be framed. Without this an attacker could
        // overlay the workbench — including the code lab, which runs what is
        // typed into it — inside a page of their own.
        source: '/((?!embed).*)',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
