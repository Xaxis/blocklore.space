import Link from "next/link";
import type { ReactNode } from "react";

// The page vocabulary. Every page opens with PageHeader and groups its content in Blocks, so pages
// differ in what they say, not in how they are put together.

export interface Crumb {
  href?: string;
  label: string;
}

export function PageHeader({
  crumbs,
  title,
  lede,
  meta,
  actions,
  bare,
}: {
  crumbs?: Crumb[];
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  bare?: boolean;
}) {
  return (
    <header className={bare ? "page-header bare" : "page-header"}>
      {crumbs && crumbs.length > 0 && (
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} style={{ display: "contents" }}>
              {i > 0 && <span aria-hidden="true">/</span>}
              {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <h1>{title}</h1>
      {lede && <div className="lede">{lede}</div>}
      {meta && <div className="meta">{meta}</div>}
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** A titled part of a page, with an optional note or link on the right. */
export function Block({
  id,
  title,
  aside,
  children,
  level = 2,
}: {
  id?: string;
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  level?: 2 | 3;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <section className="block" id={id} aria-labelledby={id && title ? `${id}-h` : undefined}>
      {title && (
        <div className="block-head">
          <H id={id ? `${id}-h` : undefined}>{title}</H>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** The page body: one centered column of the page's width. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="container page">{children}</div>;
}

export function Stat({
  value,
  label,
  note,
}: {
  value: ReactNode;
  label: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
      {note && <small>{note}</small>}
    </div>
  );
}

/** A feed entry: when (time and block) in the gutter, what happened beside it. */
export function FeedItem({
  when,
  block,
  blockHref,
  children,
}: {
  when: ReactNode;
  block?: number;
  blockHref?: string;
  children: ReactNode;
}) {
  return (
    <li>
      <div className="feed-when">
        <span>{when}</span>
        {block !== undefined &&
          (blockHref ? (
            <Link href={blockHref}>block {block.toLocaleString("en-US")}</Link>
          ) : (
            <span>block {block.toLocaleString("en-US")}</span>
          ))}
      </div>
      <div className="feed-body">{children}</div>
    </li>
  );
}

/** Depth coverage: one bar per depth, shallow to deep, thin where a depth has few claims. */
export function Coverage({ counts, thinAt = 3 }: { counts: number[]; thinAt?: number }) {
  const max = Math.max(...counts, 1);
  const labels = ["Curious", "User", "Holder", "Builder", "Researcher"];
  return (
    <span
      className="coverage"
      role="img"
      aria-label={counts.map((n, i) => `${labels[i]} ${n}`).join(", ")}
      title={counts.map((n, i) => `${labels[i]}: ${n}`).join("\n")}
    >
      {counts.map((n, i) => (
        <i
          key={labels[i]}
          className={n < thinAt ? "thin" : undefined}
          style={{ height: `${Math.max(18, (n / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}
