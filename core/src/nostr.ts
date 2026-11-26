// The Nostr channel (ORANGECHECK.md, "The Nostr channel"; API.md, "Nostr"): Blocklore's knowledge as
// notes people can follow, so it reaches them without the website. Every note is built here, by code,
// from the store and the bundle; no model writes any of it.
//
//   kind 0      the profile: who Blocklore is, its site and its NIP-05 address
//   kind 10002  the relays it posts to (NIP-65)
//   kind 30023  the daily digest as a long-form article (NIP-23), d tag = the date, posted once the
//               UTC day is over: corrections first, then new claims by topic, then other revisions,
//               each claim with its statement, its link and its sources' links
//   kind 1      a short note when an edition is sealed in a Bitcoin block, when a security watch
//               changes status, and for each lab run
//
// Every note passes a screen first (`noteScreen`): the disclosure gate (core/src/disclosure.ts) on
// each claim and on every text Blocklore wrote, anything that names an embargoed finding, a lab run
// with a failure, and the house style. What it stops waits, listed for the owner, and never goes out.
//
// Pure: time, the store, the embargo and the relays come in as arguments.
import { z } from "zod";
import type { Bundle, BundleSnapshot } from "./bundle.ts";
import { type DigestDay, digestDays } from "./digest.ts";
import { type DisclosureContext, embargoReasons, labEmbargo, mentionsAny } from "./disclosure.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { type ChangeEvent, claimAsOf } from "./replay.ts";
import type { Claim } from "./schema.ts";
import type { LabRun, WatchId, WatchLevel, WatchState } from "./security.ts";
import { hasDash } from "./style.ts";
import { watchSpec } from "./watch.ts";

/** The domain NIP-05 names live under; the same as OrangeCheck's `OC_DOMAIN` (a test pins it). */
export const NOSTR_DOMAIN = "blocklore.space";
export const NOSTR_SITE = `https://${NOSTR_DOMAIN}`;
/** The names `/.well-known/nostr.json` answers for (NIP-05): `_@blocklore.space` is the domain itself. */
export const NIP05_NAMES = ["_", "blocklore"] as const;
export const NIP05_RECORDS = "records";
export const NOSTR_KINDS = { profile: 0, note: 1, relays: 10002, article: 30023 } as const;
/** A note counts as published once this many relays serve it back, as OrangeCheck records do. */
export const NOSTR_QUORUM = 2;
/** At most this many notes go out on one tick; the rest wait for the next. */
export const NOSTR_PER_TICK = 10;
/**
 * An article's content stays under this many bytes, well inside the 64 KiB many relays accept for
 * one event. A day with more (a seed day) lists what fits and links the rest.
 */
export const ARTICLE_MAX_BYTES = 48_000;

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
const relayUrl = z
  .string()
  .max(200)
  .regex(/^wss?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[\w./-]*)?$/);

/** A relay on this machine: a development stub, never a public relay. */
export const isLoopbackRelay = (url: string): boolean =>
  /^wss?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(url);

/**
 * The public record of the channel, `knowledge/nostr.json`: the key people follow, the key that
 * carries OrangeCheck records, the relays, and whether the owner has posting on. The daemon writes
 * it when the owner flips the switch; the site serves NIP-05 and the Follow link from it.
 */
export const NostrChannel = z.strictObject({
  /** The channel key (x-only, hex) that signs every note people follow. */
  pubkey: hex64,
  /** The key that signs the Nostr events carrying OrangeCheck records (ORANGECHECK.md). */
  records: hex64,
  relays: z.array(relayUrl).min(1).max(10),
  /** Whether the owner has "Post to Nostr" on. */
  posting: z.boolean(),
  /** When the owner last turned it on or off. */
  changed: iso,
});
export type NostrChannel = z.infer<typeof NostrChannel>;

/** Problems with a record that must not ship: a relay that is neither wss:// nor on this machine. */
export function channelProblems(
  c: NostrChannel,
): { level: "error" | "warning"; message: string }[] {
  const out: { level: "error" | "warning"; message: string }[] = [];
  for (const r of c.relays) {
    if (isLoopbackRelay(r))
      out.push({
        level: "warning",
        message: `${r} is a relay on this machine: a development record`,
      });
    else if (!r.startsWith("wss://"))
      out.push({ level: "error", message: `${r} is not a wss:// relay` });
  }
  if (c.pubkey === c.records)
    out.push({ level: "error", message: "the channel key and the records key are the same key" });
  return out;
}

// --- NIP-19 and NIP-05 -------------------------------------------------------------------------

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i] as number;
  }
  return chk;
}

/** A 32-byte hex key as NIP-19 bech32 with the given prefix (npub for a public key). */
export function bech32Key(hrp: "npub", hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("not a 32-byte hex key");
  const bytes = hex.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? [];
  const data: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) data.push((acc << (5 - bits)) & 31);
  const expand = [
    ...[...hrp].map((c) => c.charCodeAt(0) >> 5),
    0,
    ...[...hrp].map((c) => c.charCodeAt(0) & 31),
  ];
  const mod = polymod([...expand, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const check = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...check].map((d) => BECH32[d]).join("")}`;
}

export const npub = (hex: string): string => bech32Key("npub", hex);

/** `/.well-known/nostr.json` (NIP-05): the names and the relays, or no names before a record. */
export function nip05Document(c: NostrChannel | null): {
  names: Record<string, string>;
  relays?: Record<string, string[]>;
} {
  if (!c) return { names: {} };
  return {
    names: {
      ...Object.fromEntries(NIP05_NAMES.map((n) => [n, c.pubkey])),
      [NIP05_RECORDS]: c.records,
    },
    relays: { [c.pubkey]: [...c.relays], [c.records]: [...c.relays] },
  };
}

// --- notes -------------------------------------------------------------------------------------

/** A note before its pubkey, time, id and signature: exactly what the channel would send. */
export interface ChannelNote {
  /** The key its log entry has: profile:, relays:, digest:, edition:, watch:, lab:. */
  id: string;
  kind: number;
  /** A short line for the owner's preview. */
  label: string;
  /** The moment it is about, for ordering. */
  at: string;
  tags: string[][];
  content: string;
}

/** A note, or a claim inside one, that the screen stopped, and why. */
export interface HeldNote {
  id: string;
  label: string;
  reasons: string[];
}

/** What may go out. Each returns the reasons something may not; nothing means it may. */
export interface NoteScreen {
  /** A published claim, as the digest would carry it, with its sources. */
  claim(c: Claim): string[];
  /** A note in Blocklore's own words: the disclosure gate, the embargo and the house style. */
  text(t: string): string[];
  /** A whole article whose claims were screened one by one: the embargo and the house style. */
  note(t: string): string[];
}

/**
 * The screen every note passes (SECURITY.md, T9): the disclosure gate on each claim (unless the
 * owner released it from the embargo) and on every text Blocklore wrote, anything that names an
 * embargoed finding, and the house style.
 */
export function noteScreen(input: {
  disclosure: DisclosureContext;
  /** Ids, CVE and GHSA ids and test names of everything held in the embargo now. */
  embargoed: readonly string[];
  /** Whether the owner released this claim from the embargo after a look. */
  released: (c: Claim) => boolean;
}): NoteScreen {
  const named = (t: string) =>
    mentionsAny(t, input.embargoed) ? ["names something the embargo holds"] : [];
  const style = (t: string) => (hasDash(t) ? ["has a dash the house style refuses"] : []);
  return {
    claim: (c) => [
      ...(input.released(c) ? [] : embargoReasons(c, input.disclosure)),
      ...named(`${c.id}\n${c.statement}`),
    ],
    text: (t) => [
      ...embargoReasons({ statement: t, sources: [] }, input.disclosure),
      ...named(t),
      ...style(t),
    ],
    note: (t) => [...named(t), ...style(t)],
  };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const dateLong = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const plural = (n: number, one: string, many = `${one}s`) =>
  `${grouped(n)} ${n === 1 ? one : many}`;
const unix = (isoTime: string) => Math.floor(Date.parse(isoTime) / 1000);
const short = (content: string) => sha256Hex(content).slice(0, 16);

const PROFILE = {
  name: "Blocklore",
  display_name: "Blocklore",
  about:
    "A library of Bitcoin facts that checks itself. Code posts here from Blocklore's published claims: the daily digest, each edition sealed in a Bitcoin block, and the security watch. Every claim links to its sources. No model writes these notes.",
  website: NOSTR_SITE,
  nip05: `_@${NOSTR_DOMAIN}`,
  picture: `${NOSTR_SITE}/apple-icon`,
  bot: true,
};

/** The kind 0 profile. Replaceable: a new one goes out only when its content changes. */
export function profileNote(): ChannelNote {
  const content = JSON.stringify(PROFILE);
  return {
    id: `profile:${short(content)}`,
    kind: NOSTR_KINDS.profile,
    label: "The profile: name, about, website and NIP-05",
    at: "2009-01-03T18:15:05Z",
    tags: [],
    content,
  };
}

/** The kind 10002 relay list (NIP-65), so clients know where to read the channel. */
export function relayListNote(relays: readonly string[]): ChannelNote {
  const tags = relays.map((r) => ["r", r]);
  return {
    id: `relays:${short(canonicalJson(tags))}`,
    kind: NOSTR_KINDS.relays,
    label: `The relay list: ${relays.join(", ")}`,
    at: "2009-01-03T18:15:05Z",
    tags,
    content: "",
  };
}

type ClaimSource = Pick<Bundle, "claims" | "withdrawn">;

/** The claim as it stood at its event, from the current or the withdrawn claims. */
function claimAt(e: ChangeEvent, b: ClaimSource): Claim | null {
  const c = b.claims[e.claim] ?? b.withdrawn[e.claim];
  return c ? claimAsOf(c, { time: e.at.time }) : null;
}

/** One claim as an article lists it: the statement, then what changed, its link and its sources. */
function claimLines(e: ChangeEvent, c: Claim, b: ClaimSource, withBefore: boolean): string {
  const lines = [`- ${e.statement}`];
  if (withBefore && e.before?.statement && e.before.statement !== e.statement)
    lines.push(`  - Before: ${e.before.statement}`);
  if (withBefore && e.note) lines.push(`  - Note: ${e.note}`);
  lines.push(`  - Claim: ${NOSTR_SITE}/claims/${e.claim}`);
  for (const u of new Set(c.sources.flatMap((s) => (s.url ? [s.url] : []))))
    lines.push(`  - Source: ${u}`);
  if (b.withdrawn[e.claim] && e.change !== "withdrawn")
    lines.push("  - Since withdrawn by the owner");
  return lines.join("\n");
}

/**
 * The digest of one UTC day as a NIP-23 article, from the same data as `/digest/<date>`:
 * corrections first, then new claims by topic in the site's topic order, then other revisions.
 * Each claim the screen stops is left out and listed in `held`. Null when nothing is left.
 */
export function digestArticle(
  day: DigestDay,
  b: ClaimSource & Pick<Bundle, "topics">,
  screen: NoteScreen,
): { note: ChannelNote | null; held: HeldNote[] } {
  const url = `${NOSTR_SITE}/digest/${day.date}`;
  const held: HeldNote[] = [];
  const keep = (events: ChangeEvent[]) =>
    events.flatMap((e) => {
      const c = claimAt(e, b);
      const reasons = c ? screen.claim(c) : ["the claim is not in the bundle"];
      if (reasons.length) {
        held.push({
          id: `digest:${day.date}:${e.claim}`,
          label: `${e.claim} in the digest of ${day.date}`,
          reasons,
        });
        return [];
      }
      return [{ e, c: c as Claim }];
    });
  const corrections = keep(day.corrections);
  const created = day.created
    .map((g) => ({ topic: g.topic, items: keep(g.events) }))
    .filter((g) => g.items.length);
  const revisions = keep(day.revisions);
  const newCount = created.reduce((n, g) => n + g.items.length, 0);
  if (!corrections.length && !newCount && !revisions.length) return { note: null, held };

  const parts = [
    newCount && plural(newCount, "new claim"),
    corrections.length && plural(corrections.length, "correction"),
    revisions.length && plural(revisions.length, "other revision"),
  ].filter((p): p is string => Boolean(p));
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  const lede = `${said?.charAt(0).toUpperCase()}${said?.slice(1)}. Every line links to its evidence.`;
  const head = [
    lede,
    `Blocks ${grouped(day.heights.from)} to ${grouped(day.heights.to)}. The digest on the site: ${url}`,
  ];
  const sections: { title: string; intro: string; blocks: string[] }[] = [];
  if (corrections.length)
    sections.push({
      title: "Corrections",
      intro: "These replace something Blocklore said before.",
      blocks: corrections.map(({ e, c }) => claimLines(e, c, b, true)),
    });
  for (const g of created) {
    const t = b.topics.find((x) => x.slug === g.topic);
    sections.push({
      title: t?.title ?? g.topic,
      intro: `${plural(g.items.length, "new claim")} on the topic page: ${NOSTR_SITE}/topics/${g.topic}`,
      blocks: g.items.map(({ e, c }) => claimLines(e, c, b, false)),
    });
  }
  if (revisions.length)
    sections.push({
      title: "Other revisions",
      intro: "What changed in claims published before.",
      blocks: revisions.map(({ e, c }) => claimLines(e, c, b, true)),
    });

  // Fit the budget: whole claims only, in order, and a line that links the rest.
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const reserve = 300;
  let text = head.join("\n\n");
  let omitted = 0;
  for (const s of sections) {
    const top = `\n\n## ${s.title}\n\n${s.intro}`;
    if (omitted || bytes(text + top) + reserve > ARTICLE_MAX_BYTES) {
      omitted += s.blocks.length;
      continue;
    }
    text += top;
    let first = true;
    for (const blk of s.blocks) {
      const add = `${first ? "\n\n" : "\n"}${blk}`;
      if (omitted || bytes(text + add) + reserve > ARTICLE_MAX_BYTES) {
        omitted++;
        continue;
      }
      text += add;
      first = false;
    }
  }
  if (omitted)
    text += `\n\nThe rest of this day, ${plural(omitted, "more claim")}, is on the site: ${url}`;

  const end = new Date(Date.parse(`${day.date}T00:00:00Z`) + 86_400_000).toISOString();
  const title = `Blocklore digest, ${dateLong(day.date)}`;
  return {
    note: {
      id: `digest:${day.date}`,
      kind: NOSTR_KINDS.article,
      label: `The digest of ${day.date}: ${said}`,
      at: end.replace(/\.\d{3}Z$/, "Z"),
      tags: [
        ["d", day.date],
        ["title", title],
        ["summary", lede],
        ["published_at", String(unix(end))],
        ["t", "bitcoin"],
        ["r", url],
        ["alt", `Long-form article: ${title}, ${url}`],
      ],
      content: text,
    },
    held,
  };
}

/** A kind 1 note for an edition once its OpenTimestamps proof reaches a Bitcoin block. */
export function editionNote(s: BundleSnapshot): ChannelNote | null {
  const block = s.proof?.blocks[0]?.height;
  if (block === undefined) return null;
  const file = `${NOSTR_SITE}/snapshots/${s.file}`;
  const check = `${NOSTR_SITE}/verify#snapshot-${s.n}`;
  return {
    id: `edition:${s.n}`,
    kind: NOSTR_KINDS.note,
    label: `Edition ${s.n}, sealed in block ${grouped(block)}`,
    at: s.at.time,
    tags: [
      ["r", file],
      ["r", check],
    ],
    content: [
      `Edition ${s.n} of Blocklore's store is sealed in Bitcoin block ${grouped(block)}: ${plural(s.count, "claim")} under Merkle root ${s.root}, timestamped with OpenTimestamps.`,
      `The snapshot: ${file}\nCheck it yourself: ${check}`,
    ].join("\n\n"),
  };
}

export interface WatchChange {
  watch: WatchId;
  at: string;
  from: WatchLevel;
  to: WatchLevel;
  value: number | null;
}

/**
 * Every change of a watch's status in its history, oldest first. A reading that failed (unknown)
 * is no change: the status before it still stands.
 */
export function watchChanges(watches: readonly WatchState[]): WatchChange[] {
  const out: WatchChange[] = [];
  for (const w of watches) {
    let prev: WatchLevel | null = null;
    for (const p of w.history) {
      if (p.status === "unknown") continue;
      if (prev && p.status !== prev)
        out.push({ watch: w.id, at: p.at, from: prev, to: p.status, value: p.value });
      prev = p.status;
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.watch.localeCompare(b.watch));
}

function measured(c: WatchChange): string {
  const spec = watchSpec(c.watch);
  if (c.value === null) return "";
  const v =
    spec.unit === "%"
      ? `${c.value}%`
      : spec.unit === "minutes"
        ? plural(c.value, "minute")
        : spec.unit === "blocks"
          ? plural(c.value, "block")
          : plural(c.value, "advisory", "advisories");
  return ` ${spec.measures}: ${v}.`;
}

/** A kind 1 note for a watch whose status changed. */
export function watchNote(c: WatchChange): ChannelNote {
  const spec = watchSpec(c.watch);
  const link = `${NOSTR_SITE}/security#watch-${c.watch}`;
  return {
    id: `watch:${c.watch}:${c.at}`,
    kind: NOSTR_KINDS.note,
    label: `${spec.title}: ${c.from} to ${c.to}`,
    at: c.at,
    tags: [["r", link]],
    content: `Blocklore's security watch: ${spec.title} went from ${c.from} to ${c.to}.${measured(c)}\n\nIts thresholds and history: ${link}`,
  };
}

/** A kind 1 note for a lab run; one with any failure is never posted (`channelNotes` holds it). */
export function labNote(run: LabRun): ChannelNote {
  const n = run.tests.length;
  const passed = run.tests.filter((t) => t.ok).length;
  const sigs = run.verified.signatures;
  const link = `${NOSTR_SITE}/security#lab`;
  const result = passed === n ? `all ${grouped(n)} passed` : `${grouped(passed)} passed`;
  if (run.project === "lnd")
    return {
      id: `lab:lnd:${run.at}`,
      kind: NOSTR_KINDS.note,
      label: `The lab on LND ${run.version}: ${passed} of ${n} passed`,
      at: run.at,
      tags: [["r", link]],
      content: [
        `Blocklore's security lab built LND ${run.version} from its source and ran its own unit tests of ${plural(n, "package")}: ${result}. ${run.verified.sha256 ? "The source matched the release's signed manifest" : "The source did not match the release's signed manifest"}${sigs === null ? ", and maintainer signatures were not checked." : `, with ${plural(sigs, "good maintainer signature")}.`}`,
        `The tests and what they cover: ${link}`,
      ].join("\n\n"),
    };
  if (run.project === "ldk")
    return {
      id: `lab:ldk:${run.at}`,
      kind: NOSTR_KINDS.note,
      label: `The lab on LDK ${run.version}: ${passed} of ${n} passed`,
      at: run.at,
      tags: [["r", link]],
      content: [
        `Blocklore's security lab built LDK ${run.version} from its release tag and ran its own tests of ${plural(n, "module")} of the lightning crate: ${result}. ${run.verified.sha256 ? "The source was the commit the tag names" : "The source was not the commit the tag names"}${sigs === null ? ", and the tag's signature was not checked." : sigs > 0 ? ", and the tag's signature was good, by a maintainer LDK's SECURITY.md lists." : ", and the tag's signature was not good."}`,
        `The tests and what they cover: ${link}`,
      ].join("\n\n"),
    };
  if (run.project === "eclair")
    return {
      id: `lab:eclair:${run.at}`,
      kind: NOSTR_KINDS.note,
      label: `The lab on Eclair ${run.version}: ${passed} of ${n} passed`,
      at: run.at,
      tags: [["r", link]],
      content: [
        `Blocklore's security lab built Eclair ${run.version} from its source and ran its own tests of eclair-core in ${plural(n, "group")} of suites: ${result}. ${run.verified.sha256 ? "The source was the commit its signed release zip names" : "The source was not the commit its signed release zip names"}${sigs === null ? ", and the release's signature was not checked." : sigs > 0 ? ", and the release's SHA256SUMS signature was good, by the key its release notes name." : ", and the release's SHA256SUMS signature was not good."}`,
        `The tests and what they cover: ${link}`,
      ].join("\n\n"),
    };
  return {
    id: `lab:${run.at}`,
    kind: NOSTR_KINDS.note,
    label: `The lab on Bitcoin Core ${run.version}: ${passed} of ${n} passed`,
    at: run.at,
    tags: [["r", link]],
    content: [
      `Blocklore's security lab ran ${plural(n, "functional test")} from Bitcoin Core ${run.version} in regtest, against the release binaries: ${result}. ${run.verified.sha256 ? "The release matched its SHA256SUMS" : "The release did not match its SHA256SUMS"}${sigs === null ? ", and builder signatures were not checked." : `, with ${plural(sigs, "good builder signature")}.`}`,
      `The tests and what they cover: ${link}`,
    ].join("\n\n"),
  };
}

/** The start of the UTC day before `since`: the channel's first day is the one before it began. */
export function channelStart(since: string): string {
  const d = new Date(since);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1))
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

export interface ChannelInput {
  bundle: Pick<
    Bundle,
    "events" | "runs" | "bips" | "topics" | "claims" | "withdrawn" | "snapshots" | "security"
  >;
  relays: readonly string[];
  /** Now: a digest goes out once its UTC day is over. */
  at: string;
  /**
   * When the owner turned posting on (or now, for a preview while it is off). The channel covers
   * the day before that and everything after, so turning it on never floods followers with history.
   */
  since: string;
  screen: NoteScreen;
}

/**
 * Every note the channel would send now, in the order it would send them (the profile and relay
 * list first, then by time), and everything the screen stopped. Which of them already went out is
 * the brain's log's business, not this function's.
 */
export function channelNotes(i: ChannelInput): { notes: ChannelNote[]; held: HeldNote[] } {
  const start = channelStart(i.since);
  const today = i.at.slice(0, 10);
  const held: HeldNote[] = [];
  const out: ChannelNote[] = [];
  const days = digestDays(
    i.bundle.events,
    i.bundle.runs,
    i.bundle.bips?.changes ?? [],
    i.bundle.topics.map((t) => t.slug),
  );
  for (const d of [...days].reverse()) {
    if (d.date < start.slice(0, 10) || d.date >= today) continue;
    const a = digestArticle(d, i.bundle, i.screen);
    held.push(...a.held);
    if (a.note) out.push(a.note);
  }
  for (const s of [...i.bundle.snapshots].sort((a, b) => a.n - b.n)) {
    if (s.at.time < start) continue;
    const n = editionNote(s);
    if (n) out.push(n);
  }
  for (const c of watchChanges(i.bundle.security.watches))
    if (c.at >= start) out.push(watchNote(c));
  for (const run of [...i.bundle.security.labRuns].sort((a, b) => a.at.localeCompare(b.at))) {
    if (run.at < start) continue;
    const n = labNote(run);
    const failed = labEmbargo(run);
    if (failed.length) held.push({ id: n.id, label: n.label, reasons: failed });
    else out.push(n);
  }
  const sorted = out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const notes: ChannelNote[] = [];
  for (const n of [profileNote(), relayListNote(i.relays), ...sorted]) {
    // An article's claims were screened one by one with their sources; every other note is
    // Blocklore's own words, which pass the disclosure gate as they stand.
    const reasons =
      n.kind === NOSTR_KINDS.article ? i.screen.note(n.content) : i.screen.text(n.content);
    if (reasons.length) held.push({ id: n.id, label: n.label, reasons });
    else notes.push(n);
  }
  return { notes, held };
}

// --- the owner's preview -----------------------------------------------------------------------

export const NotePreview = z.object({
  id: z.string().max(200),
  kind: z.number().int(),
  label: z.string().max(300),
  at: iso,
  tags: z.array(z.array(z.string().max(2000)).max(10)).max(100),
  content: z.string().max(70_000),
  /** Relays that serve back an earlier send of it; it counts once NOSTR_QUORUM do. */
  relays: z.array(z.string().max(200)).max(20),
  /** The id of the event already signed for it, resent as it is until enough relays hold it. */
  event: hex64.nullable(),
});
export type NotePreview = z.infer<typeof NotePreview>;

/** The channel as the owner's admin shows it under the switch (sent on the daemon's sync). */
export const NostrView = z.object({
  at: iso,
  posting: z.boolean(),
  changed: iso.nullable(),
  /** The channel key, hex and npub; null before the devbox has a publisher key. */
  pubkey: hex64.nullable(),
  npub: z.string().max(100).nullable(),
  relays: z.array(z.string().max(200)).max(20),
  /** Why nothing could go out even with the switch on, when something stands in the way. */
  problem: z.string().max(300).nullable(),
  /** The next notes, exactly as they would be sent, in order. */
  next: z.array(NotePreview).max(60),
  /** Further notes waiting beyond `next`. */
  more: z.number().int().min(0),
  held: z
    .array(
      z.object({
        id: z.string().max(200),
        label: z.string().max(300),
        reasons: z.array(z.string().max(300)).max(10),
      }),
    )
    .max(60),
  /** Notes two relays hold. */
  published: z.number().int().min(0),
  recent: z
    .array(
      z.object({
        id: z.string().max(200),
        kind: z.number().int(),
        label: z.string().max(300),
        at: iso,
        event: hex64,
        relays: z.array(z.string().max(200)).max(20),
      }),
    )
    .max(10),
  perTick: z.number().int(),
});
export type NostrView = z.infer<typeof NostrView>;
