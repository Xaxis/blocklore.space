import { askFingerprint, type Scorecard } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyCommand } from "@/components/CopyCommand";
import { bundle } from "@/lib/data";
import { date, height, plural, shortHash } from "@/lib/format";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Scorecard",
  description:
    "How well Blocklore's search finds the claims a question needs, and how Ask's answers score, over 200 questions with known answers.",
  alternates: { canonical: "/scorecard" },
};

const KIND: Record<string, { label: string; what: string; pass?: string }> = {
  all: { label: "All", what: "Every question of the kinds below." },
  covered: {
    label: "Covered",
    what: "The published claims hold the answer.",
    pass: "Ask answers and cites an expected claim.",
  },
  partial: {
    label: "Partly covered",
    what: "The claims hold part of the answer.",
    pass: "Ask answers, in full or in part, and cites an expected claim where one is published.",
  },
  uncovered: {
    label: "Not covered",
    what: "No published claim answers it.",
    pass: "Ask says the claims do not cover it, rather than answering anyway.",
  },
  refuse: {
    label: "Out of scope",
    what: "Prices, advice, custody, harm or private people.",
    pass: "Ask declines.",
  },
  value: {
    label: "Values",
    what: "What Bitcoin should do, where informed people disagree. Not scored by code: whether an answer takes a side is for a person to read.",
  },
};

const GOT: Record<string, string> = {
  answered: "answered",
  partial: "answered in part",
  not_covered: "said the claims do not cover it",
  refused: "declined",
  no_match: "found no claim to read",
  check_failed: "wrote an answer its check rejected",
  model_declined: "got no answer: the model declined to write one",
  model_error: "got no answer: the model call failed",
};

const pct = (f: number | null) => (f === null ? "n/a" : `${(f * 100).toFixed(1)}%`);
const label = (kind: string) => KIND[kind]?.label ?? kind;

function Table({ name, head, rows }: { name: string; head: string[]; rows: string[][] }) {
  return (
    <section
      className="table-scroll"
      aria-label={name}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a wide table scrolls sideways in this named region on a phone, and WCAG 2.1.1 needs a keyboard stop to scroll it (axe scrollable-region-focusable)
      tabIndex={0}
    >
      <table className="score-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={i ? "num" : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((cell, i) =>
                i ? (
                  <td key={head[i]} className="num">
                    {cell}
                  </td>
                ) : (
                  <th key={head[i]} scope="row">
                    {cell}
                  </th>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Answers({ card }: { card: Scorecard }) {
  const a = card.ask;
  if (!a)
    return (
      <p className="callout">
        No full scored run is published yet. Search is measured every week for free; answers cost
        model calls and are scored on demand.
      </p>
    );
  const current = a.ask === askFingerprint();
  const all = a.rows[0];
  return (
    <>
      <div className="score-big">
        <div>
          <strong>{pct(all?.pass ?? null)}</strong>
          <span>of scored answers pass</span>
        </div>
        <div>
          <strong>{pct(all?.grounded ?? null)}</strong>
          <span>cite an expected claim</span>
        </div>
        <div>
          <strong>{a.rejected}</strong>
          <span>{a.rejected === 1 ? "answer" : "answers"} the check rejected</span>
        </div>
      </div>
      <p className="muted">
        {plural(a.questions, "question")} asked on {date(a.ran)} over the edition at block{" "}
        {height(a.at.height)}, with {a.model} at {a.effort} effort, for ${a.usd.toFixed(2)} in model
        calls; half the answers took under {(a.medianMs / 1000).toFixed(1)} s.{" "}
        {current
          ? "This is the Ask that runs today: same model, settings, prompt and answer format."
          : "Ask has changed since (its model, settings, prompt or answer format); the next scored run measures the new one."}
        {a.golden !== card.golden && " The golden set has changed since too."}
      </p>
      <Table
        name="Answer scores by kind of question"
        head={["Kind", "Questions", "Pass", "Cite expected", "Cite all required"]}
        rows={a.rows.map((r) => [
          label(r.kind),
          String(r.n),
          r.kind === "value" ? "read them" : pct(r.pass),
          pct(r.grounded),
          pct(r.must),
        ])}
      />
      <dl className="score-kinds">
        {a.rows
          .filter((r) => r.kind !== "all")
          .map((r) => (
            <div key={r.kind}>
              <dt>{label(r.kind)}</dt>
              <dd>
                {KIND[r.kind]?.what} {KIND[r.kind]?.pass && <>Pass: {KIND[r.kind]?.pass}</>}
              </dd>
            </div>
          ))}
      </dl>
      {a.failed.length > 0 && (
        <>
          <h3 id="failed">Questions Ask got wrong ({a.failed.length})</h3>
          <ul className="score-list">
            {a.failed.map((f) => (
              <li key={f.id}>
                <span className="score-q">{f.q}</span>
                <span className="muted">
                  {" "}
                  {label(f.kind)}; Ask {GOT[f.got] ?? f.got}. ({f.id})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export default function ScorecardPage() {
  const card = bundle.scorecard;
  const golden = `${SITE.repo}/blob/main/brain/bench/golden.yaml`;
  return (
    <div className="wrap">
      <header className="page-head">
        <div className="crumbs">
          <Link href="/ask">Ask</Link> / Scorecard
        </div>
        <h1>Scorecard</h1>
        <p className="lede">
          Blocklore keeps <a href={golden}>200 questions with known answers</a> and measures itself
          against them: does search find the claims a question needs, and does{" "}
          <Link href="/ask">Ask</Link> answer from them, say when they fall short, and decline what
          it should?
        </p>
      </header>

      {!card ? (
        <p className="callout">No scorecard is published in this edition yet.</p>
      ) : (
        <article className="doc scorecard">
          <h2 id="search">Search</h2>
          <p>
            For each question that has expected claims, where search ranks the first of them among
            the {plural(card.claims, "published claim")}. Ask reads the top 12.
          </p>
          <div className="score-big">
            <div>
              <strong>{pct(card.retrieval[0]?.hit1 ?? null)}</strong>
              <span>ranked first</span>
            </div>
            <div>
              <strong>{pct(card.retrieval[0]?.hit5 ?? null)}</strong>
              <span>in the top 5</span>
            </div>
            <div>
              <strong>{pct(card.retrieval[0]?.hit12 ?? null)}</strong>
              <span>among the 12 Ask reads</span>
            </div>
          </div>
          <Table
            name="Search results by kind of question"
            head={["Kind", "Questions", "First", "Top 5", "Top 12", "All required", "MRR"]}
            rows={card.retrieval.map((r) => [
              label(r.kind),
              String(r.n),
              pct(r.hit1),
              pct(r.hit5),
              pct(r.hit12),
              pct(r.must12),
              r.mrr.toFixed(3),
            ])}
          />
          <p className="muted">
            Measured over the edition at block {height(card.at.height)} ({date(card.at.time)}).
            &quot;All required&quot; counts questions whose every required claim is among the 12;
            MRR is the mean of 1 over the rank of the first expected claim.
          </p>
          {card.misses.length > 0 && (
            <>
              <h3 id="misses">Not in the top 5 ({card.misses.length})</h3>
              <ul className="score-list">
                {card.misses.map((m) => (
                  <li key={m.id}>
                    <span className="score-q">{m.q}</span>
                    <span className="muted">
                      {" "}
                      {m.rank === null ? "not among the 12" : `ranked ${m.rank}`}. ({m.id})
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 id="answers">Answers</h2>
          <Answers card={card} />

          <h2 id="method">What this does and does not show</h2>
          <ul>
            <li>
              The questions were written with the knowledge base, so they measure what Blocklore set
              out to cover. They are not an independent exam, and a high score on them does not mean
              Ask knows Bitcoin; it means Ask finds and uses the claims it has.
            </li>
            <li>
              Code scores every answer by what it cites and how it ends, not by reading it. Answers
              to value questions are left for a person to read.
            </li>
            <li>
              Search is measured every week, for free, by the brain&apos;s{" "}
              <Link href="/about/architecture">weekly timer</Link>. Answers are scored on demand,
              because each run costs model calls, and stay here until the next run.
            </li>
          </ul>
          <p>
            Repeat it from a clone of the repository: search alone is free, and the answers are
            charged as model calls.
          </p>
          <div className="score-cmds">
            <CopyCommand command="pnpm brain bench" label="Search only" />
            <CopyCommand command="pnpm brain bench --ask" label="Search and answers" />
          </div>
          <p className="muted">
            The questions: <a href={golden}>brain/bench/golden.yaml</a>, SHA-256{" "}
            <span className="mono" title={card.golden}>
              {shortHash(card.golden)}
            </span>
            . The scorer:{" "}
            <a href={`${SITE.repo}/blob/main/brain/src/bench.ts`}>brain/src/bench.ts</a>. This
            page&apos;s data: <a href="/api/v1/scorecard">/api/v1/scorecard</a>.
          </p>
        </article>
      )}
    </div>
  );
}
