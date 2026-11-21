import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Page, PageHeader } from "@/components/ui";
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
  const slug = (await params).doc as DocSlug;
  const d = DOCS[slug];
  return d
    ? { title: d.title, description: d.blurb, alternates: { canonical: `/about/${slug}` } }
    : {};
}

/** Links between the docs stay on the site; links to code go to the repository. */
function href(url: string | undefined): string | undefined {
  if (!url) return url;
  const doc = Object.entries(DOCS).find(([, d]) => url === d.file || url.startsWith(`${d.file}#`));
  if (doc) return `/about/${doc[0]}${url.includes("#") ? url.slice(url.indexOf("#")) : ""}`;
  if (/^[a-z]+:/i.test(url) || url.startsWith("#") || url.startsWith("/")) return url;
  return `${SITE.repo}/blob/main/${url}`;
}

/** A heading's anchor as GitHub makes it, so links written for the repository work here too. */
function anchor(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, "")
      .replace(/ /g, "-") || "section"
  );
}

/** The plain text of rendered markdown children. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** The document's second-level headings, outside code fences, as plain text. */
function headings(md: string): string[] {
  let fenced = false;
  const out: string[] = [];
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && line.startsWith("## "))
      out.push(
        line
          .slice(3)
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/[`*_]/g, "")
          .trim(),
      );
  }
  return out;
}

/** Gives repeated anchors a number, in document order, the same way for the toc and the page. */
function uniquer() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const a = anchor(text);
    const n = (seen.get(a) ?? 0) + 1;
    seen.set(a, n);
    return n === 1 ? a : `${a}-${n}`;
  };
}

export default async function DocPage({ params }: { params: Promise<{ doc: string }> }) {
  const slug = (await params).doc as DocSlug;
  const d = DOCS[slug];
  if (!d) notFound();
  const md = readDoc(slug);
  const tocId = uniquer();
  const toc = headings(md).map((t) => ({ text: t, id: tocId(t) }));
  const h2Id = uniquer();
  let tables = 0;
  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/about", label: "How it works" }, { label: d.title }]}
        title={d.title}
        lede={d.blurb}
        meta={
          <span>
            Rendered from <a href={`${SITE.repo}/blob/main/${d.file}`}>{d.file}</a> in the
            repository, as it was at this build
          </span>
        }
      />
      <div className="with-rail">
        <article className="prose">
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              // The page header already carries the document's title.
              h1: () => null,
              h2: ({ children }) => <h2 id={h2Id(textOf(children))}>{children}</h2>,
              a: ({ href: h, children }) => <a href={href(h)}>{children}</a>,
              pre: ({ children }) => (
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a wide code block scrolls sideways, and WCAG 2.1.1 needs a keyboard stop to scroll it (axe scrollable-region-focusable)
                <pre tabIndex={0}>{children}</pre>
              ),
              table: ({ children }) => {
                tables++;
                return (
                  <section
                    className="table-wrap"
                    aria-label={`${d.title}, table ${tables}`}
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: a wide table scrolls sideways in this named region, and WCAG 2.1.1 needs a keyboard stop to scroll it (axe scrollable-region-focusable)
                    tabIndex={0}
                  >
                    <table className="table">{children}</table>
                  </section>
                );
              },
            }}
          >
            {md}
          </Markdown>
        </article>
        <aside className="rail" aria-label="On this page and the other rules">
          {toc.length > 0 && (
            <section className="rail-block" aria-label="On this page">
              <h3>On this page</h3>
              <ul className="toc">
                {toc.map((t) => (
                  <li key={t.id}>
                    <a href={`#${t.id}`}>{t.text}</a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="rail-block" aria-label="The other rules">
            <h3>The other rules</h3>
            <ul>
              {Object.entries(DOCS)
                .filter(([s]) => s !== slug)
                .map(([s, o]) => (
                  <li key={s}>
                    <Link href={`/about/${s}`}>{o.title}</Link>
                  </li>
                ))}
            </ul>
          </section>
          <section className="rail-block" aria-label="Change this document">
            <h3>Change this document</h3>
            <p>
              The rules change only through reviewed pull requests.{" "}
              <a href={`${SITE.repo}/commits/main/${d.file}`}>Its history</a>
            </p>
          </section>
        </aside>
      </div>
    </Page>
  );
}
