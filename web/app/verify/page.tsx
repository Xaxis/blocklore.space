import type { Metadata } from "next";
import Link from "next/link";
import { CopyCommand } from "@/components/CopyCommand";
import { SignatureBadge, SignatureRows } from "@/components/EditionSignature";
import { Block, Page, PageHeader } from "@/components/ui";
import { bundle } from "@/lib/data";
import { dateTime, height, plural } from "@/lib/format";
import { OC_HOME, ocCommand, SIGNATURE_MEANS, signing } from "@/lib/orangecheck";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Snapshots",
  description:
    "Snapshots of every claim's hash under one Merkle root, timestamped on Bitcoin with OpenTimestamps and signed with OrangeCheck, and how to check them yourself.",
  alternates: { canonical: "/verify" },
};

const PARTS = [
  { id: "snapshots", title: "Every snapshot" },
  { id: "check", title: "Check a snapshot yourself" },
  { id: "signed", title: "Who signed it" },
  { id: "claim", title: "Check one claim" },
  { id: "hashes", title: "What a hash covers" },
  { id: "limits", title: "What a timestamp proves" },
];

export default function Verify() {
  const snapshots = bundle.snapshots;
  const newest = snapshots[0];
  const n = newest?.n ?? 1;
  const anchored = newest?.proof?.blocks[0]?.height;
  const sig = signing();
  return (
    <Page>
      <PageHeader
        title="Snapshots"
        lede="You do not have to trust this site. A snapshot fixes every claim's hash under one Merkle root, and the snapshot file is timestamped on Bitcoin with OpenTimestamps, so anyone can prove later what Blocklore said and that it said it by a given block."
        meta={
          <>
            <span>{plural(snapshots.length, "snapshot")}</span>
            {newest && <span>Newest covers {plural(newest.count, "claim")}</span>}
            {snapshots.length > 0 && (
              <span>
                {sig.signed} of {snapshots.length} signed
              </span>
            )}
            {anchored && (
              <span>
                Anchored in block <span className="mono">{height(anchored)}</span>
              </span>
            )}
          </>
        }
      />

      <div className="with-rail">
        <div>
          <Block id="snapshots" title="Every snapshot">
            {snapshots.length === 0 ? (
              <p className="empty">No snapshot has been taken yet.</p>
            ) : (
              <div className="stack">
                {snapshots.map((s) => {
                  const blocks = s.proof?.blocks ?? [];
                  return (
                    <section
                      key={s.n}
                      id={`snapshot-${s.n}`}
                      className="panel"
                      aria-labelledby={`snapshot-${s.n}-h`}
                    >
                      <div className="panel-head">
                        <h3 id={`snapshot-${s.n}-h`}>
                          Snapshot {s.n}: {plural(s.count, "claim")}
                        </h3>
                        <span className="toolbar">
                          {blocks.length ? (
                            <span className="badge badge-ok">
                              <span className="dot" />
                              In block {height(blocks[0]?.height ?? 0)}
                            </span>
                          ) : s.proof ? (
                            <span className="badge badge-warn">Waiting for a block</span>
                          ) : (
                            <span className="badge">No proof yet</span>
                          )}
                          <SignatureBadge signature={s.signature} />
                        </span>
                      </div>
                      <div className="panel-body">
                        <dl className="dl stacked">
                          <dt>Taken</dt>
                          <dd>
                            {dateTime(s.at.time)}, block{" "}
                            <span className="mono">{height(s.at.height)}</span>
                          </dd>
                          <dt>Root</dt>
                          <dd className="hash">{s.root}</dd>
                          <dt>Previous</dt>
                          <dd className="hash">
                            {s.previous ? (
                              <Link href={`#snapshot-${s.n - 1}`}>{s.previous}</Link>
                            ) : (
                              "None, this is the first"
                            )}
                          </dd>
                          <dt>Commit</dt>
                          <dd className="hash">
                            <a href={`${SITE.repo}/tree/${s.commit}/knowledge/claims`}>
                              {s.commit}
                            </a>
                          </dd>
                          <dt>Timestamp</dt>
                          <dd>
                            {!s.proof
                              ? "No proof yet."
                              : blocks.length
                                ? blocks.map((b) => (
                                    <span key={b.height}>
                                      In block {height(b.height)}: the file existed before that
                                      block was mined. Its header&apos;s merkle root is{" "}
                                      <span className="hash">{b.merkleRoot}</span>.{" "}
                                    </span>
                                  ))
                                : `Waiting for a block. ${plural(s.proof.pending.length, "calendar")} hold it (${s.proof.pending.map((u) => new URL(u).host).join(", ")}) and commit about once an hour; the completed proof is added to the repository when it arrives.`}
                          </dd>
                          <SignatureRows n={s.n} signature={s.signature} />
                          <dt>Files</dt>
                          <dd>
                            <a href={`/snapshots/${s.file}`}>{s.file}</a>
                            {s.signature && (
                              <>
                                {", "}
                                <a href={`/snapshots/${s.signature.file}`}>{s.signature.file}</a>
                              </>
                            )}
                            {s.proof && (
                              <>
                                {", "}
                                <a href={`/snapshots/${s.proof.file}`}>{s.proof.file}</a>
                                <span className="small muted">
                                  {" "}
                                  (SHA-256 of the file:{" "}
                                  <span className="hash">{s.proof.digest}</span>)
                                </span>
                              </>
                            )}
                          </dd>
                        </dl>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </Block>

          <div className="prose block">
            <h2 id="check">Check a snapshot yourself</h2>
            <p>
              The verifier in the repository recomputes everything from the claim files and checks
              the proof against a Bitcoin block header, from your own node when{" "}
              <code>bitcoin-cli</code> answers, otherwise from two block explorers that must agree:
            </p>
            <CopyCommand
              command={`git clone ${SITE.repo} && cd blocklore.space && pnpm install && pnpm verify:snapshot ${n}`}
            />
            <ul>
              <li>
                Every claim file at the snapshot&apos;s commit is hashed again, and the list of ids
                and hashes must be exactly the snapshot&apos;s.
              </li>
              <li>
                The Merkle root over those hashes must be the snapshot&apos;s root, and each
                snapshot must name the previous one&apos;s root.
              </li>
              <li>
                The proof must start from the snapshot file&apos;s SHA-256 and arrive at the merkle
                root in the header of the block it names.
              </li>
            </ul>
            <p>
              With the OpenTimestamps client and a Bitcoin node of your own, the proof checks
              without any of Blocklore&apos;s code:
            </p>
            <CopyCommand
              command={`curl -sO ${SITE.url}/snapshots/${n}.json -sO ${SITE.url}/snapshots/${n}.json.ots && ots verify ${n}.json.ots`}
            />

            <h2 id="signed">Who signed it</h2>
            <p>
              {SIGNATURE_MEANS} Each edition is <a href={OC_HOME}>signed with OrangeCheck</a>: a
              BIP-322 signature by the publisher key over the snapshot file&apos;s exact bytes, in
              the <span className="mono">.stamp</span> file beside it. OrangeCheck&apos;s own tool
              checks it:
            </p>
            <CopyCommand command={ocCommand.stamp(n)} />
            <p>
              <Link href="/verify/keys">The keys</Link> shows the chain from the owner&apos;s
              Bitcoin key to the publisher key, and the command that checks all of it at once.
            </p>

            <h2 id="claim">Check one claim</h2>
            <p>
              Each claim page shows the claim&apos;s hash, its place in the newest snapshot and the
              audit path from its hash to the root. Hash the leaf as SHA-256 of a zero byte followed
              by the claim&apos;s hash, then combine upward: SHA-256 of a one byte, the left hash
              and the right hash. This is the Merkle tree of RFC 6962, and the path is checked as
              RFC 9162, section 2.1.3.2 describes; <code>verifyMerkleProof</code> in{" "}
              <code>core/src/hash.ts</code> does exactly that.
            </p>

            <h2 id="hashes">What a hash covers</h2>
            <p>
              A claim&apos;s hash is SHA-256 over its canonical JSON: keys sorted at every level, no
              spaces, UTF-8, with <code>last_verified</code> left out, so re-checking a claim does
              not change it. Any change to a statement, a source, a quote, a check or a revision
              does. <Link href="/about/claims">The claim format</Link> has the whole schema.
            </p>

            <h2 id="limits">What a timestamp proves, and what it does not</h2>
            <ul>
              <li>
                It proves the snapshot file, and so every claim hash in it, existed before the block
                was mined. It does not make a claim true: that is what each claim&apos;s sources,
                quotes and checks are for.
              </li>
              <li>
                Snapshots are taken after each publish that changes claims. A claim that changed
                between two snapshots shows in the first that has its new hash; its revisions keep
                what it said before, and the publisher refuses rewritten history.
              </li>
              <li>
                The timestamp and the signature check apart. The timestamp fixes when the file
                existed; the signature says who put their name to it, at a time the signer states.
              </li>
            </ul>
          </div>
        </div>

        <aside className="rail" aria-label="On this page">
          <section className="rail-block" aria-label="On this page">
            <h3>On this page</h3>
            <ul className="toc">
              {PARTS.map((p) => (
                <li key={p.id}>
                  <a href={`#${p.id}`}>{p.title}</a>
                </li>
              ))}
            </ul>
          </section>
          <section className="rail-block" aria-label="The files">
            <h3>The files</h3>
            <p>
              Every snapshot and proof is served from <span className="mono">/snapshots/</span> and
              kept in the repository under{" "}
              <a href={`${SITE.repo}/tree/main/knowledge/snapshots`}>knowledge/snapshots</a>.
            </p>
          </section>
        </aside>
      </div>
    </Page>
  );
}
