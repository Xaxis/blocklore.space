import { ASK } from "@blocklore/core";
import type { Metadata } from "next";
import Link from "next/link";
import { AskBox } from "@/components/AskBox";
import { VISITOR_LIMIT } from "@/lib/ask";
import { bundle } from "@/lib/data";
import { height, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Ask the Brain",
  description:
    "Questions about Bitcoin answered only from Blocklore's published claims, every sentence citing the claims it rests on.",
};

// Questions the published store answers well; the golden set (brain/bench/golden.yaml) keeps them
// honest.
const EXAMPLES = [
  "How many bitcoin will there ever be?",
  "Why do fees go up when the mempool fills?",
  "What did SegWit change about block size?",
  "How does a Lightning payment find its way?",
];

export default function AskPage() {
  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Ask the Brain</h1>
        <p className="lede">
          Answers written only from Blocklore&apos;s{" "}
          {plural(bundle.stats.claims, "published claim")}. Every sentence cites the claims it rests
          on, and when they do not cover a question the answer says so instead of guessing.
        </p>
      </header>

      <AskBox examples={EXAMPLES} initialDepth="user" />

      <article className="doc ask-how">
        <h2 id="how">How an answer is made</h2>
        <ol>
          <li>
            Search ranks the published claims for your question, the same ranking as the{" "}
            <Link href="/about/api">API</Link>, and the best {ASK.claims} are read.
          </li>
          <li>
            A model ({ASK.model}) writes up to {ASK.sentencesMax} sentences from those claims alone,
            for the depth you chose, and lists the claims behind each sentence.
          </li>
          <li>
            Code checks the result before you see it: every sentence cites at least one claim it was
            given and no other, the house style holds, and nothing in it looks like a key or a link.
            An answer that fails is not shown; the claims are.
          </li>
          <li>
            Questions about prices, investing or taking anyone&apos;s coins are declined. Where
            people disagree about what Bitcoin should do, the answer reports who holds which
            position and does not pick a side.
          </li>
        </ol>
        <h2 id="limits">Limits and privacy</h2>
        <ul>
          <li>
            Written answers share a daily budget; when it is spent you get the matching claims until
            00:00 UTC. Each visitor gets {VISITOR_LIMIT.hour} written answers an hour and{" "}
            {VISITOR_LIMIT.day} a day.
          </li>
          <li>
            Your question travels in the request body, never the URL, and is not logged. A hash of
            it keys a cached answer for a day, so the same question costs nothing twice. Your
            address only feeds a salted hash that counts your answers, and is not stored.
          </li>
          <li>
            A question that looks like it holds a seed, a private key or an address is refused
            before anything reads it.
          </li>
          <li>
            When the claims do not cover a question about Bitcoin, the answer offers to put it on
            the <Link href="/queue">research queue</Link>, with links and contacts removed.
          </li>
          <li>
            This edition was compiled at block {height(bundle.generated.height)}. Answers change as
            the claims do.
          </li>
        </ul>
      </article>
    </div>
  );
}
