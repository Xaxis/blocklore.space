import type { Metadata } from "next";
import Link from "next/link";
import { CopyCommand } from "@/components/CopyCommand";
import { bundle } from "@/lib/data";
import { dateTime, height, plural } from "@/lib/format";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Verify the store",
  description:
    "Snapshots of every claim's hash under one Merkle root, timestamped on Bitcoin with OpenTimestamps, and how to check them yourself.",
};

export default function Verify() {
  const snapshots = bundle.snapshots;
  const newest = snapshots[0];
  const n = newest?.n ?? 1;
  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Verify the store</h1>
        <p className="lede">
          You do not have to trust this site. Every claim is a file in a public git repository. A
          snapshot fixes every claim&apos;s hash under one Merkle root, and the snapshot file is
          timestamped on Bitcoin with OpenTimestamps, so anyone can prove later what Blocklore said
          and that it said it by a given block.
        </p>
      </header>

      <article className="doc">
        <h2 id="snapshots">Snapshots</h2>
        {snapshots.length === 0 ? (
          <p className="callout">No snapshot has been taken yet.</p>
        ) : (
          <ol className="runs">
            {snapshots.map((s) => (
              <li key={s.n} id={`snapshot-${s.n}`}>
                <div className="when mono muted">
                  block {height(s.at.height)}, {dateTime(s.at.time)}
                </div>
                <div style={{ fontFamily: "var(--serif)", fontSize: "1.15rem" }}>
                  Snapshot {s.n}: {plural(s.count, "claim")}
                </div>
                <dl className="kv">
                  <dt>Root</dt>
                  <dd className="mono">{s.root}</dd>
                  <dt>Previous</dt>
                  <dd className="mono">
                    {s.previous ? (
                      <Link href={`#snapshot-${s.n - 1}`}>{s.previous}</Link>
                    ) : (
                      "none, this is the first"
                    )}
                  </dd>
                  <dt>Commit</dt>
                  <dd className="mono">
                    <a href={`${SITE.repo}/tree/${s.commit}/knowledge/claims`}>{s.commit}</a>
                  </dd>
                  <dt>Timestamp</dt>
                  <dd>
                    {!s.proof
                      ? "No proof yet."
                      : s.proof.blocks.length
                        ? s.proof.blocks.map((b) => (
                            <span key={b.height}>
                              In block {height(b.height)}: the file existed before that block was
                              mined. Its header&apos;s merkle root is{" "}
                              <span className="mono">{b.merkleRoot}</span>.{" "}
                            </span>
                          ))
                        : `Waiting for a block. ${plural(s.proof.pending.length, "calendar")} hold it (${s.proof.pending.map((u) => new URL(u).host).join(", ")}) and commit about once an hour; the completed proof is added to the repository when it arrives.`}
                  </dd>
                  <dt>Files</dt>
                  <dd>
                    <a href={`/snapshots/${s.file}`}>{s.file}</a>
                    {s.proof && (
                      <>
                        {", "}
                        <a href={`/snapshots/${s.proof.file}`}>{s.proof.file}</a> (SHA-256 of the
                        file: <span className="mono">{s.proof.digest}</span>)
                      </>
                    )}
                  </dd>
                </dl>
              </li>
            ))}
          </ol>
        )}

        <h2 id="check">Check a snapshot yourself</h2>
        <p>
          The verifier in the repository recomputes everything from the claim files and checks the
          proof against a Bitcoin block header, from your own node when <code>bitcoin-cli</code>{" "}
          answers, otherwise from two block explorers that must agree:
        </p>
        <CopyCommand
          command={`git clone ${SITE.repo} && cd blocklore.space && pnpm install && pnpm verify:snapshot ${n}`}
        />
        <ul>
          <li>
            Every claim file at the snapshot&apos;s commit is hashed again, and the list of ids and
            hashes must be exactly the snapshot&apos;s.
          </li>
          <li>
            The Merkle root over those hashes must be the snapshot&apos;s root, and each snapshot
            must name the previous one&apos;s root.
          </li>
          <li>
            The proof must start from the snapshot file&apos;s SHA-256 and arrive at the merkle root
            in the header of the block it names.
          </li>
        </ul>
        <p>
          With the OpenTimestamps client and a Bitcoin node of your own, the proof checks without
          any of Blocklore&apos;s code:
        </p>
        <CopyCommand
          command={`curl -sO ${SITE.url}/snapshots/${n}.json -sO ${SITE.url}/snapshots/${n}.json.ots && ots verify ${n}.json.ots`}
        />

        <h2 id="claim">Check one claim</h2>
        <p>
          Each claim page shows the claim&apos;s hash, its place in the newest snapshot and the
          audit path from its hash to the root. Hash the leaf as SHA-256 of a zero byte followed by
          the claim&apos;s hash, then combine upward: SHA-256 of a one byte, the left hash and the
          right hash. This is the Merkle tree of RFC 6962, and the path is checked as RFC 9162,
          section 2.1.3.2 describes; <code>verifyMerkleProof</code> in <code>core/src/hash.ts</code>{" "}
          does exactly that.
        </p>

        <h2 id="hashes">What a hash covers</h2>
        <p>
          A claim&apos;s hash is SHA-256 over its canonical JSON: keys sorted at every level, no
          spaces, UTF-8, with <code>last_verified</code> left out, so re-checking a claim does not
          change it. Any change to a statement, a source, a quote, a check or a revision does.{" "}
          <Link href="/about/claims">What a claim is</Link> has the whole schema.
        </p>

        <h2 id="limits">What a timestamp proves, and what it does not</h2>
        <ul>
          <li>
            It proves the snapshot file, and so every claim hash in it, existed before the block was
            mined. It does not make a claim true: that is what each claim&apos;s sources, quotes and
            checks are for.
          </li>
          <li>
            Snapshots are taken after each publish that changes claims. A claim that changed between
            two snapshots shows in the first that has its new hash; its revisions keep what it said
            before, and the publisher refuses rewritten history.
          </li>
          <li>Snapshots are not signed yet. The timestamp does not depend on a signature.</li>
        </ul>
      </article>
    </div>
  );
}
