// "How to check it yourself": the command a reader runs against their own node or clone to repeat
// each machine check (CLAIMS.md, Checks). Shown on every claim page beside the check's result.
import type { Check } from "./schema.ts";

const sq = (s: string) => `'${s.replaceAll("'", `'"'"'`)}'`;

export function bipFileCandidates(bip: number): string[] {
  const n = String(bip).padStart(4, "0");
  return [`bip-${n}.mediawiki`, `bip-${n}.md`];
}

export function readerCommand(c: Check): string {
  switch (c.type) {
    case "chain.block-hash":
      return `bitcoin-cli getblockhash ${c.height}`;
    case "chain.subsidy":
      return `bitcoin-cli getblockstats ${c.height} '["subsidy"]'`;
    case "chain.header":
      return `bitcoin-cli getblockheader $(bitcoin-cli getblockhash ${c.height}) | grep '"${c.field}"'`;
    case "code.contains": {
      const repo = c.repo.split("/")[1];
      return `git clone https://github.com/${c.repo} && git -C ${repo} show ${c.ref}:${c.path} | grep -nF ${sq(c.text)}`;
    }
    case "bip.field":
      return `curl -s https://raw.githubusercontent.com/bitcoin/bips/master/${bipFileCandidates(c.bip)[0]} | grep -m1 -E '^ *${c.field}s?:'`;
  }
}

/** What a passing check proves, in a sentence. */
export function checkMeaning(c: Check): string {
  switch (c.type) {
    case "chain.block-hash":
      return `Block ${c.height.toLocaleString("en-US")} has hash ${c.expect.slice(0, 16)}...`;
    case "chain.subsidy":
      return `Block ${c.height.toLocaleString("en-US")} created ${c.expect_sats.toLocaleString("en-US")} sats of new coins`;
    case "chain.header":
      return `Block ${c.height.toLocaleString("en-US")}'s header has ${c.field} = ${c.expect}`;
    case "code.contains":
      return `${c.repo} at ${c.ref.slice(0, 10)} contains this text in ${c.path}${c.live ? ", and still does on the default branch" : ""}`;
    case "bip.field":
      return `BIP ${c.bip}'s ${c.field} is "${c.expect}" on the default branch`;
  }
}
