import type { Metadata } from "next";
import Link from "next/link";
import { Flow } from "@/components/Flow";
import { Block, Page, PageHeader } from "@/components/ui";
import { bundle, followChannel } from "@/lib/data";
import { DOCS } from "@/lib/docs";
import { height, plural } from "@/lib/format";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "How Blocklore works",
  description:
    "How a sentence gets onto Blocklore, how to check it yourself, and what Blocklore never does.",
  alternates: { canonical: "/about" },
};

const SECTIONS = [
  { id: "claims", title: "Claims, not pages" },
  { id: "steps", title: "Each step in detail" },
  { id: "check", title: "How to check Blocklore yourself" },
  { id: "evenhanded", title: "Facts and values" },
  { id: "never", title: "What Blocklore never does" },
  { id: "bot", title: "BlockloreBot" },
];

export default function About() {
  const s = bundle.stats;
  const channel = followChannel();
  const sections = channel
    ? SECTIONS.flatMap((x) =>
        x.id === "check" ? [x, { id: "nostr", title: "Follow it on Nostr" }] : [x],
      )
    : SECTIONS;
  return (
    <Page>
      <PageHeader
        title="How Blocklore works"
        lede={`${SITE.promise} A research system reads the primary record of Bitcoin every day, and nothing it writes reaches this site until code has checked every quote and a second model has tried to break it. The owner can withdraw anything.`}
        meta={
          <>
            <span>{plural(s.claims, "claim")}</span>
            <span>{plural(s.checks, "machine check")}</span>
            <span>
              Edition at block <span className="mono">{height(bundle.generated.height)}</span>
            </span>
          </>
        }
      />

      <Block
        id="flow"
        title="How a claim gets here"
        aside={<Link href="/log">Every run, in public</Link>}
      >
        <Flow />
      </Block>

      <div className="with-rail block">
        <article className="prose">
          <h2 id="claims">Claims, not pages</h2>
          <p>
            Every sentence you read on a topic page is a claim: a single statement with its own
            sources, its own status (established, contested, speculative or superseded), its own
            confidence and its own history. Pages are only an order to read claims in. That is what
            lets every sentence carry its evidence, and lets a correction change one sentence
            without rewriting an article around it.
          </p>
          <p>
            Sources come in four tiers. T1 is the primary record: the code at a commit, the BIPs and
            BOLTs, the chain, and people&apos;s own words in the mailing list archives, Delving
            Bitcoin and pull requests. T2 is expert secondary writing such as Bitcoin Optech. T3 is
            reputable general coverage, and T4, social media, never supports a claim on its own.{" "}
            <Link href="/about/sources">The sources page</Link> lists every one.
          </p>

          <h2 id="steps">Each step in detail</h2>
          <ol>
            <li>
              <strong>Research.</strong> A model, Claude, reads the sources for a topic and drafts
              candidate claims, each with an exact quote of at most 50 words from each source it
              cites. It works in a sealed folder: no shell, no secrets, no way to write anywhere
              else, and no ability to publish.
            </li>
            <li>
              <strong>Check.</strong> Deterministic code fetches every link and looks for every
              quote. Hidden text is stripped first, so a page cannot smuggle words in. Code checks
              read the file at the cited commit; chain checks ask two independent block explorers
              and need them to agree. A quote that is not found does not publish.
            </li>
            <li>
              <strong>Falsify.</strong> A second model, in a fresh session that never saw the
              research, tries to break each claim: is the statement stronger than its evidence, is
              every number exact, is it neutral. When in doubt, it rejects.
            </li>
            <li>
              <strong>Gate.</strong> Code, not a model, decides what needs closer checks: anything
              on a contested subject, safety advice, stances, arguments, and anything that names a
              person.
            </li>
            <li>
              <strong>Evaluate.</strong> A program decides what the gate held. It checks every quote
              and chain fact again, applies rules written from the editorial policy, and asks two
              verifiers on different models, which must both accept. Test claims, copies of
              published ones with one thing made false, prove it still catches errors; if it misses
              too many, nothing publishes. Until a claim passes, its text stays private and only a
              count appears on the topic. The owner can withdraw any claim, or keep gated claims for
              their own approval. <Link href="/verify/evaluator">The evaluator&apos;s record</Link>{" "}
              is public.
            </li>
            <li>
              <strong>Publish.</strong> Code writes the claim to the store, a folder of YAML files
              in git, and recompiles everything. A change to a published claim is appended as a
              revision that keeps what it said before. Nothing is edited silently.
            </li>
          </ol>
          <p>
            Every run is in the public <Link href="/log">research log</Link>: what it read,
            published and rejected, and any text that tried to give the brain orders.
          </p>

          <h2 id="check">How to check Blocklore yourself</h2>
          <ul>
            <li>
              Open any sentence. Each source shows the quote code found at the link, and when it was
              read.
            </li>
            <li>
              Each machine check shows the command to repeat it: <code>bitcoin-cli</code> against
              your own node, or <code>git</code> against your own clone. You do not have to trust
              our explorers.
            </li>
            <li>
              The whole store is in a public git repository. Each claim page shows its SHA-256 hash,
              and every change is a commit you can read.
            </li>
            <li>
              Snapshots fix every claim&apos;s hash under one Merkle root, timestamped on Bitcoin
              with OpenTimestamps. <Link href="/verify">The snapshots page</Link> lists them and
              shows how to check one with a single command.
            </li>
            <li>
              Each edition is also signed with OrangeCheck by Blocklore&apos;s publisher key, and
              the owner&apos;s own Bitcoin key can vouch for that key or withdraw it.{" "}
              <Link href="/verify/keys">The signatures page</Link> shows who stands behind each
              edition and how to check it offline.
            </li>
          </ul>

          {channel && (
            <>
              <h2 id="nostr">Follow it on Nostr</h2>
              <p>
                Blocklore also posts to Nostr, so what it learns reaches you without this website:
                the daily digest as a long-form article, a note each time an edition is sealed in a
                Bitcoin block, and the security watch&apos;s changes. Code builds every note from
                the published claims, each claim with its link and its sources; no model writes
                them, and nothing the disclosure gate holds is ever posted. Follow{" "}
                <a href={`nostr:${channel.npub}`}>blocklore.space</a> in any Nostr client, or see{" "}
                <Link href="/connect#nostr">how to follow it</Link>.
              </p>
            </>
          )}

          <h2 id="evenhanded">Facts and values</h2>
          <p>
            Bitcoin has real disagreements, and many are about values rather than facts. Blocklore
            keeps the two apart. A fact gets checked. A value question gets each side&apos;s
            position, attributed to the people who hold it, dated, linked and in their own words,
            and Blocklore&apos;s own voice never declares a winner. Where the owner has an opinion,
            it is labeled as the owner&apos;s and kept off the claims.{" "}
            <Link href="/about/editorial">The editorial rules</Link> say how.
          </p>

          <h2 id="never">What Blocklore never does</h2>
          <ul>
            <li>Hold, move or ask for coins, keys, seed phrases, xpubs or addresses.</li>
            <li>Predict prices or give financial advice.</li>
            <li>Track you. Page counts are cookieless and nothing is stored in your browser.</li>
            <li>
              Publish a contested, safety or named-person claim that has not passed the closer
              checks.
            </li>
            <li>Let a model publish anything.</li>
          </ul>

          <h2 id="bot">BlockloreBot</h2>
          <p>
            The research system fetches pages as{" "}
            <code>BlockloreBot/0.1 (+https://blocklore.space/about#bot)</code>. It makes at most one
            request a second to a host, caches what it reads, backs off when a server asks it to,
            and respects <code>robots.txt</code>. It reads Bitcoin sources only: code,
            specifications, mailing lists, forums, newsletters and transcripts. To ask it to stop or
            slow down, open an issue on <a href={SITE.repo}>the repository</a>.
          </p>
        </article>

        <aside className="rail" aria-label="On this page and the rules in full">
          <section className="rail-block" aria-label="On this page">
            <h3>On this page</h3>
            <ul className="toc">
              <li>
                <a href="#flow">How a claim gets here</a>
              </li>
              {sections.map((x) => (
                <li key={x.id}>
                  <a href={`#${x.id}`}>{x.title}</a>
                </li>
              ))}
            </ul>
          </section>
          <section className="rail-block" aria-label="The rules in full">
            <h3>The rules in full</h3>
            <ul>
              {Object.entries(DOCS).map(([slug, d]) => (
                <li key={slug}>
                  <Link href={`/about/${slug}`}>{d.title}</Link>
                  <p className="small">{d.blurb}</p>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </Page>
  );
}
