"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface Hit {
  id: string;
  statement: string;
  topics: string[];
  kind: string;
  sources: number;
}

/**
 * Search from anywhere: the header button, "/" or Ctrl/Cmd+K. Claims come from POST
 * /api/v1/search (the query stays out of URLs and logs); Enter on a question goes to Ask.
 */
export function Search({ claims }: { claims: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(-1);

  const open = useCallback(() => {
    dialog.current?.showModal();
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setError(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/v1/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, limit: 8 }),
          signal: ctl.signal,
        });
        const body = (await res.json()) as { results?: Hit[]; error?: string };
        setHits(body.results ?? []);
        setError(res.ok ? null : (body.error ?? "Search failed."));
        setSel(-1);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Search is not reachable right now.");
      }
    }, 140);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const go = (href: string) => {
    dialog.current?.close();
    router.push(href);
  };
  // A miss becomes a suggestion: the question rides in the fragment, which no server sees.
  const suggest = () => {
    const frag = `suggest=${encodeURIComponent(q.trim())}`;
    dialog.current?.close();
    if (window.location.pathname === "/gaps") window.location.hash = frag;
    else router.push(`/gaps#${frag}`);
  };

  return (
    <>
      <button
        type="button"
        className="search-trigger"
        onClick={open}
        aria-label={`Search ${claims.toLocaleString("en-US")} facts`}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="label">Search {claims.toLocaleString("en-US")} facts</span>
        <span className="kbd">/</span>
      </button>
      <dialog
        ref={dialog}
        className="search-dialog"
        aria-label="Search claims"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, -1));
          }
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const hit = hits[Math.max(sel, 0)];
            if (hit) go(`/claims/${hit.id}`);
            else if (q.trim().length >= 2) suggest();
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M11 11l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search every published fact"
            aria-label="Search every published claim"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="kbd">Esc</span>
        </form>
        {error ? (
          <p className="search-empty" role="alert">
            {error}
          </p>
        ) : q.trim().length >= 2 && hits.length === 0 ? (
          <p className="search-empty">
            No published claim matches yet. Press Enter to suggest it for research.
          </p>
        ) : hits.length === 0 ? (
          <p className="search-empty">
            Type to search every published claim: statements, sources and topics.
          </p>
        ) : (
          <ul className="search-results">
            {hits.map((h, i) => (
              <li key={h.id}>
                <Link
                  href={`/claims/${h.id}`}
                  aria-selected={i === sel}
                  onClick={(e) => {
                    e.preventDefault();
                    go(`/claims/${h.id}`);
                  }}
                >
                  <span className="hit-title">{h.statement}</span>
                  <span className="hit-meta">
                    {h.topics[0]} · {h.sources} {h.sources === 1 ? "source" : "sources"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="search-foot">
          <span>Enter opens the claim; with no match, suggests the question</span>
          <span>Up and down to move</span>
        </div>
      </dialog>
    </>
  );
}
