import path from "node:path";
import type { NextConfig } from "next";

// The workspace root holds the lockfile, knowledge/ and the docs the site renders.
const workspaceRoot = path.join(import.meta.dirname, "..");

/** The owner's cookieless analytics: s.js and the v.js it loads, posting hits back. */
const ANALYTICS = "https://overlook.technology";

const CSP = [
  "default-src 'self'",
  // Next's inline bootstrap and the theme script run inline; nothing else is allowed in.
  `script-src 'self' 'unsafe-inline' ${ANALYTICS}${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${ANALYTICS}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Inlined at build time, so functions that run per request (search, changes) name the same build
  // as the static pages; Vercel's build env is not present at run time.
  env: { BLOCKLORE_BUILD: process.env.BLOCKLORE_BUILD ?? "dev" },
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@blocklore/core"],
  outputFileTracingIncludes: {
    "/**": [
      "../API.md",
      "../EDITORIAL.md",
      "../SOURCES.md",
      "../SECURITY.md",
      "../CLAIMS.md",
      "../ARCHITECTURE.md",
      "../brain/agenda/proposed.yaml",
      "../brain/agenda/seed.yaml",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
