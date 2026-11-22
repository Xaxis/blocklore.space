import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";
import { Mark } from "@/components/bits";
import { BrainFeedProvider } from "@/components/brain/feed";
import { Panel } from "@/components/Panel";
import { Search } from "@/components/Search";
import { ConnectButton, ViewNav } from "@/components/SiteNav";
import { Scene } from "@/components/scene/Scene";
import { bundle } from "@/lib/data";
import { date, height } from "@/lib/format";
import { sceneData } from "@/lib/graph";
import { BUILD, OVERLOOK_SITE, SITE } from "@/lib/site";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-plex-sans",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
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
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d11" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const g = bundle.generated;
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to the content
        </a>
        <header className="bar">
          <Link href="/" className="brand" aria-label="Blocklore, the brain">
            <Mark />
            <span className="brand-name">Blocklore</span>
          </Link>
          <ViewNav />
          <div className="bar-tools">
            <Search claims={bundle.stats.claims} />
            <ConnectButton />
            <Link
              href="/pulse"
              className="tip"
              title="The block this edition of the store was compiled at"
              aria-label={`Edition at block ${height(g.height)}`}
            >
              <span className="dot" aria-hidden="true" />
              <span>{height(g.height)}</span>
            </Link>
          </div>
        </header>
        <BrainFeedProvider>
          <Scene data={sceneData()} />
          <Panel
            foot={
              <>
                <p>{SITE.promise} Not financial advice: no custody, no keys, no price talk.</p>
                <p>
                  Edition at block <span className="mono">{height(g.height)}</span>, {date(g.time)}.
                  Build <span className="mono">{BUILD}</span>. Claims{" "}
                  <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, code{" "}
                  <a href={`${SITE.repo}/blob/main/LICENSE`}>MIT</a>. <a href={SITE.repo}>Source</a>
                  . <Link href="/changes.xml">Feed</Link>.
                </p>
              </>
            }
          >
            {children}
          </Panel>
        </BrainFeedProvider>
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
