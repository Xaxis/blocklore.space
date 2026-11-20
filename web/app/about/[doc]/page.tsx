import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DOCS, type DocSlug, readDoc } from "@/lib/docs";
import { SITE } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>;
}): Promise<Metadata> {
  const d = DOCS[(await params).doc as DocSlug];
  return d ? { title: d.title, description: d.blurb } : {};
}

/** Links between the docs stay on the site; links to code go to the repository. */
function href(url: string | undefined): string | undefined {
  if (!url) return url;
  const doc = Object.entries(DOCS).find(([, d]) => url === d.file || url.startsWith(`${d.file}#`));
  if (doc) return `/about/${doc[0]}${url.includes("#") ? url.slice(url.indexOf("#")) : ""}`;
  if (/^[a-z]+:/i.test(url) || url.startsWith("#") || url.startsWith("/")) return url;
  return `${SITE.repo}/blob/main/${url}`;
}

export default async function DocPage({ params }: { params: Promise<{ doc: string }> }) {
  const slug = (await params).doc as DocSlug;
  const d = DOCS[slug];
  if (!d) notFound();
  let tables = 0;
  return (
    <div className="wrap">
      <header className="page-head">
        <div className="crumbs">
          <Link href="/about">About</Link> / {d.file}
        </div>
        <h1>{d.title}</h1>
        <p className="lede">{d.blurb}</p>
        <p className="muted" style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}>
          This page is <a href={`${SITE.repo}/blob/main/${d.file}`}>{d.file}</a> in the repository,
          rendered as it was at this build.
        </p>
      </header>
      <article className="doc">
        <Markdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            a: ({ href: h, children }) => <a href={href(h)}>{children}</a>,
            table: ({ children }) => {
              tables++;
              return (
                <section
                  className="table-scroll"
                  aria-label={`${d.title}, table ${tables}`}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a wide table scrolls sideways in this named region, and WCAG 2.1.1 needs a keyboard stop to scroll it (axe scrollable-region-focusable)
                  tabIndex={0}
                >
                  <table>{children}</table>
                </section>
              );
            },
          }}
        >
          {readDoc(slug)}
        </Markdown>
      </article>
    </div>
  );
}
