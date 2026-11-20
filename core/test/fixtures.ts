import type { Claim } from "../src/schema.ts";

/** A valid claim to mutate in tests. */
export function claim(over: Partial<Claim> = {}): Claim {
  const at = { time: "2026-11-20T12:00:00Z", height: 976700 };
  return {
    id: "halvings.subsidy-840000",
    statement:
      "The block subsidy fell from 6.25 BTC to 3.125 BTC at block 840,000, the fourth halving, mined on 20 April 2024.",
    kind: "event",
    topics: ["halvings"],
    depth: "user",
    status: "established",
    confidence: "high",
    people: [],
    sources: [
      {
        tier: "T1",
        kind: "code",
        title: "Bitcoin Core validation.cpp, GetBlockSubsidy",
        url: "https://github.com/bitcoin/bitcoin/blob/0123456789abcdef0123456789abcdef01234567/src/validation.cpp#L1",
        locator: "GetBlockSubsidy",
        quote: "nSubsidy >>= halvings;",
        accessed: "2026-11-20",
        supports: "direct",
      },
    ],
    checks: [{ type: "chain.subsidy", height: 840000, expect_sats: 312500000 }],
    first_seen: at,
    last_verified: { ...at, run: "2026-11-20-seed", method: "quotes 1/1, chain 1/1" },
    run: "2026-11-20-seed",
    revisions: [{ rev: 1, at, run: "2026-11-20-seed", change: "created" }],
    ...over,
  };
}
