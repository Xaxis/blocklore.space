// The disclosure gate (SECURITY.md, T9; EDITORIAL.md, "Security findings"): nothing undisclosed
// ever publishes. Code decides, not a model, and it decides before the gate and the evaluator:
//
//   a research candidate that may describe a weakness with no public advisory, and
//   a lab run in which any test failed or the release did not verify,
//
// are embargoed: they never reach knowledge/, the review counts, the run log, the feed, the site or
// Nostr. They go privately to the owner, in the admin, with the responsible-disclosure path of the
// project concerned. The owner alone may release one, after a look.
//
// The rule errs toward holding: a false hold costs the owner a minute; a false release could hurt
// people. Pure: everything comes in as arguments.
import type { Claim, Source } from "./schema.ts";

/** Each project's published way to report a vulnerability privately. */
export const DISCLOSURE = [
  {
    project: "Bitcoin Core",
    email: "security@bitcoincore.org",
    policy: "https://github.com/bitcoin/bitcoin/blob/master/SECURITY.md",
    advisories: "https://bitcoincore.org/en/security-advisories/",
    match: /bitcoin core|bitcoind|\bp2p\b|consensus|mempool|validation|regtest/i,
  },
  {
    project: "libsecp256k1",
    email: "secp256k1-security@bitcoincore.org",
    policy: "https://github.com/bitcoin-core/secp256k1/blob/master/SECURITY.md",
    advisories: "https://github.com/bitcoin-core/secp256k1/security/advisories",
    match: /secp256k1|schnorr|ecdsa|musig/i,
  },
  {
    project: "LND",
    email: "security@lightning.engineering",
    policy: "https://github.com/lightningnetwork/lnd/blob/master/SECURITY.md",
    advisories: "https://github.com/lightningnetwork/lnd/security/advisories",
    match: /\blnd\b/i,
  },
  {
    project: "Core Lightning",
    email: "security@blockstream.com",
    policy: "https://github.com/ElementsProject/lightning/blob/master/SECURITY.md",
    advisories: "https://github.com/ElementsProject/lightning/security/advisories",
    match: /core lightning|c-lightning|\bcln\b/i,
  },
  {
    project: "Eclair",
    email: "security@acinq.fr",
    policy: "https://github.com/ACINQ/eclair/blob/master/SECURITY.md",
    advisories: "https://github.com/ACINQ/eclair/security/advisories",
    match: /eclair/i,
  },
  {
    project: "LDK",
    email: "security@lightningdevkit.org",
    policy: "https://github.com/lightningdevkit/rust-lightning/blob/main/SECURITY.md",
    advisories: "https://github.com/lightningdevkit/rust-lightning/security/advisories",
    match: /\bldk\b|rust-lightning|lightning dev ?kit/i,
  },
] as const;

export interface DisclosureContact {
  project: string;
  email: string;
  policy: string;
  advisories: string;
}

/**
 * Where to report a finding privately: the projects its text names, and always Bitcoin Core,
 * whose security team also handles protocol-level issues.
 */
export function disclosurePath(text: string): DisclosureContact[] {
  const hits = DISCLOSURE.filter((d) => d.match.test(text));
  const core = DISCLOSURE[0];
  const list = hits.some((d) => d.project === core.project) ? hits : [core, ...hits];
  return list.map(({ project, email, policy, advisories }) => ({
    project,
    email,
    policy,
    advisories,
  }));
}

/** Words that make a statement a security finding. */
const SENSITIVE =
  /\b(vulnerab\w*|exploit\w*|CVE-\d{4}-\d+|GHSA(-[0-9a-z]{4}){3}|attack\w*|denial[ -]of[ -]service|DoS|crash\w*|remote code|security (flaw|bug|hole|issue|weakness)\w*|flaw\w*|weakness\w*|backdoor\w*|steal\w*|theft|inflation bug|consensus (bug|failure|split|flaw)\w*|chain split|memory exhaustion|out of memory|OOM|(node|block|download|peer|processing) stall\w*|stall(s|ed|ing)? (a |the )?(node|block|download|peer)\w*|malleat\w*|bypass\w*)\b/i;

/** Words that say a weakness is not fixed or not public: these need an advisory, whatever else. */
const UNPATCHED =
  /\b(unpatched|unfixed|not (yet )?(been )?(fixed|patched|disclosed|addressed|mitigated)|no (known )?(fix|patch|mitigation)|without (a )?(fix|patch)|zero[- ]day|0[- ]day|undisclosed|embargo\w*|(remains?|still|currently) (vulnerable|exploitable|affected|open to)|is vulnerable|are vulnerable|can be exploited|could be exploited)\b/i;

/**
 * A source that records a disclosure: a published security advisory or CVE record. A finding that
 * cites one is about something the responsible party has already made public.
 */
export function isDisclosureSource(url: string | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^www\./, "");
  const p = u.pathname;
  if (host === "bitcoincore.org")
    return (
      /^\/en\/security-advisories\/?$/.test(p) ||
      /^\/en\/\d{4}\/\d{2}\/\d{2}\/(disclose|notice|cb-stall)[a-z0-9-]*\/?$/.test(p)
    );
  if (host === "github.com")
    return /^\/[\w.-]+\/[\w.-]+\/security\/advisories\/GHSA(-[0-9a-z]{4}){3}\/?$/.test(p);
  if (host === "nvd.nist.gov") return /^\/vuln\/detail\/CVE-\d{4}-\d{4,}\/?$/.test(p);
  if (host === "cve.org")
    return p === "/CVERecord" && /^CVE-\d{4}-\d{4,}$/.test(u.searchParams.get("id") ?? "");
  if (host === "cve.mitre.org") return /^CVE-\d{4}-\d{4,}$/.test(u.searchParams.get("name") ?? "");
  if (host === "en.bitcoin.it") return p === "/wiki/Common_Vulnerabilities_and_Exposures";
  return false;
}

/** The identifiers a text names: CVE and GHSA ids. */
export function advisoryIds(text: string): string[] {
  return [...text.matchAll(/\b(CVE-\d{4}-\d{4,}|GHSA(-[0-9a-z]{4}){3})\b/gi)].map((m) =>
    (m[1] as string).toUpperCase(),
  );
}

export interface DisclosureContext {
  /** Names under which a weakness is public knowledge: the threat map's terms and history refs. */
  knownTerms: readonly string[];
  /** CVE and GHSA ids that are public: from published advisories and the threat map. */
  knownIds: ReadonlySet<string>;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = (text: string, term: string) =>
  new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(term)}($|[^A-Za-z0-9_])`, "i").test(text);

/**
 * Why a candidate must be embargoed, or nothing when it may go on to the gate and the evaluator.
 * Held when it reads as a security finding and either
 *   says the weakness is unpatched or undisclosed, without citing an advisory, or
 *   names no advisory, no publicly known threat and no public CVE.
 * A CVE or GHSA id that no published advisory lists holds it too, unless it cites an advisory.
 */
export function embargoReasons(
  c: Pick<Claim, "statement"> & { sources: Pick<Source, "url">[] },
  ctx: DisclosureContext,
): string[] {
  const text = c.statement;
  if (!SENSITIVE.test(text)) return [];
  const disclosed = c.sources.some((s) => isDisclosureSource(s.url));
  const ids = advisoryIds(text);
  const reasons: string[] = [];
  const unknownIds = ids.filter((id) => !ctx.knownIds.has(id));
  if (unknownIds.length && !disclosed)
    reasons.push(`names ${unknownIds.join(", ")}, which no published advisory lists`);
  if (UNPATCHED.test(text) && !disclosed)
    reasons.push("says a weakness is unfixed or undisclosed, and cites no advisory");
  const known =
    ids.some((id) => ctx.knownIds.has(id)) || ctx.knownTerms.some((t) => names(text, t));
  if (!disclosed && !known && !reasons.length)
    reasons.push("reads as a security finding, and names no advisory or publicly known threat");
  return reasons;
}

export interface LabOutcome {
  verified: { sha256: boolean; signatures: number | null };
  tests: { name: string; ok: boolean }[];
}

/** Why a lab run must be embargoed: any failed test, or a release that did not verify. */
export function labEmbargo(run: LabOutcome): string[] {
  const reasons: string[] = [];
  if (!run.verified.sha256) reasons.push("the release tarball did not match SHA256SUMS");
  if (run.verified.signatures === 0) reasons.push("no builder signature over SHA256SUMS was good");
  const failed = run.tests.filter((t) => !t.ok).map((t) => t.name);
  if (failed.length) reasons.push(`failed: ${failed.join(", ")}`);
  return reasons;
}

/**
 * True when a text names any of the needles (claim ids, CVE ids): the publisher uses it to keep an
 * embargoed finding's traces out of a run's public log.
 */
export function mentionsAny(text: string, needles: readonly string[]): boolean {
  return needles.some((n) => n.length >= 3 && names(text, n));
}
