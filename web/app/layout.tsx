import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";
import { Mark } from "@/components/bits";
import { NavLinks } from "@/components/NavLinks";
import { bundle } from "@/lib/data";
import { date, height } from "@/lib/format";
import { BUILD, OVERLOOK_SITE, SITE } from "@/lib/site";

const serif = Newsreader({
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `Blocklore: ${SITE.promise}`, template: "%s · Blocklore" },
  description: SITE.promiseLong,
  applicationName: "Blocklore",
  openGraph: {
    type: "website",
    siteName: "Blocklore",
    title: "Blocklore",
    description: SITE.promise,
    url: SITE.url,
  },
  twitter: { card: "summary_large_image" },
  alternates: {
    types: { "application/atom+xml": "/changes.xml", "application/rss+xml": "/rss.xml" },
  },
  other: { "blocklore-build": BUILD },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#13120f" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const g = bundle.generated;
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to the content
        </a>
        <header className="masthead">
          <div className="wrap">
            <Link href="/" className="wordmark" aria-label="Blocklore, home">
              <Mark />
              Blocklore
            </Link>
            <NavLinks />
            <Link
              href="/pulse"
              className="tip"
              title="The block height this edition of the store was compiled at; Pulse has the chain now"
            >
              <span className="dot" aria-hidden="true" />
              <span>
                <span className="visually-hidden">Store as of block </span>
                {height(g.height)}
              </span>
            </Link>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="colophon">
          <div className="wrap">
            <div>
              <p>
                <strong>Blocklore</strong> is{" "}
                {SITE.promise.charAt(0).toLowerCase() + SITE.promise.slice(1)} Every sentence is a
                claim with sources, and every change is logged.
              </p>
              <p style={{ marginTop: "0.75rem" }}>
                This edition was compiled at block {height(g.height)} on {date(g.time)}. Build{" "}
                <span className="mono">{BUILD}</span>.
              </p>
              <p style={{ marginTop: "0.75rem" }}>
                Not financial advice. No custody, no keys, no price talk.
              </p>
            </div>
            <div>
              <h2>Read</h2>
              <ul>
                <li>
                  <Link href="/topics">Topics</Link>
                </li>
                <li>
                  <Link href="/changes">Changes</Link>
                </li>
                <li>
                  <Link href="/changes/corrections">Corrections</Link>
                </li>
                <li>
                  <Link href="/log">Research log</Link>
                </li>
              </ul>
            </div>
            <div>
              <h2>Check</h2>
              <ul>
                <li>
                  <Link href="/about">How Blocklore works</Link>
                </li>
                <li>
                  <Link href="/about/editorial">Editorial rules</Link>
                </li>
                <li>
                  <Link href="/about/sources">Sources</Link>
                </li>
                <li>
                  <Link href="/verify">Verify the store</Link>
                </li>
                <li>
                  <Link href="/about/api">API and data</Link>
                </li>
                <li>
                  <a href={SITE.repo}>The store on GitHub</a>
                </li>
              </ul>
            </div>
          </div>
        </footer>
        {/* Overlook: cookieless page counts, nothing stored in the browser. */}
        {OVERLOOK_SITE && (
          <Script
            src="https://overlook.technology/s.js"
            data-site={OVERLOOK_SITE}
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
