import assert from "node:assert/strict";
import { hkdfSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { EMPTY_RECORDS, npub, type Store } from "@blocklore/core";
import {
  type Command,
  DEFAULT_SETTINGS,
  migrateSettings,
  type NostrSettings,
  signCommand,
} from "@blocklore/core/control";
import { schnorr } from "@noble/curves/secp256k1.js";
import { claim } from "../../core/test/fixtures.ts";
import { controlStore } from "../src/control.ts";
import { dispatch } from "../src/daemon.ts";
import { LONG } from "../src/jobs.ts";
import {
  type ChannelLog,
  channelPost,
  channelState,
  nostrView,
  postPending,
  readLog,
  relayProblem,
} from "../src/nostr.ts";
import { NOSTR_KEY_LABELS, PUBLISHER_KEY_VAR, publisherFrom } from "../src/orangecheck.ts";
import { checkStubEvent, type Relay, type StubEvent, startRelay } from "./relay.ts";

// Throwaway key for tests only. Every relay here is a stub on 127.0.0.1 (./relay.ts); postPending
// refuses any other relay while node:test runs, which the last test proves.
const KEY = "33".repeat(32);
const AT = new Date("2026-11-21T12:00:00Z");
const ON: NostrSettings = { post: true, changed: "2026-11-21T06:00:00Z" };
const OFF: NostrSettings = { post: false, changed: null };

const store = (): Store => {
  const c = claim();
  return {
    wire: null,
    bips: null,
    claims: [c],
    topics: [
      {
        slug: "halvings",
        title: "Halvings and supply",
        lede: c.id,
        contested: false,
        safety: false,
        group: "foundations",
        sections: [{ id: "main", title: "The main section", depth: "user", claims: [c.id] }],
      },
    ],
    proposals: [],
    debates: [],
    runs: [],
    snapshots: [],
    orangecheck: EMPTY_RECORDS,
    review: [],
  };
};

let a: Relay;
let b: Relay;
let dir: string;
before(async () => {
  [a, b] = await Promise.all([startRelay(), startRelay()]);
  dir = mkdtempSync(path.join(tmpdir(), "bl-nostr-"));
});
after(async () => {
  await Promise.all([a.close(), b.close()]);
  rmSync(dir, { recursive: true, force: true });
});

const state = (settings: NostrSettings, log: ChannelLog = {}, relays = [a.url, b.url]) =>
  channelState({
    at: AT,
    store: store(),
    settings,
    env: { [PUBLISHER_KEY_VAR]: KEY, BLOCKLORE_NOSTR_RELAYS: relays.join(",") },
    embargo: [],
    log,
  });

/** NIP-01, independently of the code under test (./relay.ts: node's sha256, noble's schnorr). */
const checkEvent = (e: StubEvent, pubkey: string) =>
  assert.deepEqual(checkStubEvent(e, pubkey), []);

test("the channel key is HKDF of the publisher key under its own label, a sibling of the records key", () => {
  const p = publisherFrom({ [PUBLISHER_KEY_VAR]: KEY });
  assert.ok(p);
  const derive = (info: string) =>
    Buffer.from(
      schnorr.getPublicKey(
        new Uint8Array(hkdfSync("sha256", Buffer.from(KEY, "hex"), "blocklore", info, 32)),
      ),
    ).toString("hex");
  assert.equal(p.channel.pubkey, derive("nostr-channel-key/v1"));
  assert.equal(p.nostr.pubkey, derive("nostr-service-key/v1"), "the records key is unchanged");
  assert.deepEqual(NOSTR_KEY_LABELS, {
    records: "nostr-service-key/v1",
    channel: "nostr-channel-key/v1",
  });
  assert.notEqual(p.channel.pubkey, p.nostr.pubkey);
});

test("while the switch is off nothing is sent, and the preview shows what turning it on would send", async () => {
  const s = state(OFF);
  let sends = 0;
  const r = await postPending(s, {
    send: async () => {
      sends++;
      return [];
    },
    logFile: path.join(dir, "off.json"),
  });
  assert.deepEqual(r, { off: true, published: [], waiting: [], left: 0 });
  assert.equal(
    await channelPost(s, { logFile: path.join(dir, "off.json") }),
    "posting is off, so nothing was sent",
  );
  assert.equal(sends, 0);
  assert.equal(a.received.length + b.received.length, 0, "no relay heard a thing");
  assert.deepEqual(readLog(path.join(dir, "off.json")), {});

  const v = nostrView(s, "https://blocklore.space");
  assert.equal(v.posting, false);
  assert.equal(v.npub, npub(publisherFrom({ [PUBLISHER_KEY_VAR]: KEY })?.channel.pubkey ?? ""));
  assert.deepEqual(
    v.next.map((n) => n.kind),
    [0, 10002, 30023],
    "turned on now, it would send its profile, its relays and the digest of the day before",
  );
  assert.equal(v.next[2]?.id, "digest:2026-11-20");
  assert.equal(nostrView(s, "http://localhost:3723").problem, null);
  assert.match(v.problem ?? "", /wss/, "the admin warns when production would post to a stub");
});

test("a note is published once two relays serve it back; until then the tick resends the same event", async () => {
  const file = path.join(dir, "published.json");
  const key = publisherFrom({ [PUBLISHER_KEY_VAR]: KEY });
  assert.ok(key);
  b.mode.forget = true;
  const first = await postPending(state(ON), { logFile: file, now: () => AT });
  assert.deepEqual(first.published, []);
  assert.deepEqual(
    first.waiting.map((id) => id.replace(/:[0-9a-f]{16}$/, "")),
    ["profile", "relays", "digest:2026-11-20"],
    "the profile, the relay list, and the digest of the day before the channel began",
  );
  const log1 = readLog(file);
  for (const e of Object.values(log1))
    assert.deepEqual(e.relays, [a.url], "one relay is not enough");
  assert.equal(nostrView(state(ON, log1)).published, 0);

  b.mode.forget = false;
  const later = new Date("2026-11-21T13:00:00Z");
  const second = await postPending(state(ON, log1), { logFile: file, now: () => later });
  assert.equal(second.published.length, 3);
  const log2 = readLog(file);
  for (const [id, e] of Object.entries(log2)) {
    assert.deepEqual(e.relays, [a.url, b.url].sort());
    assert.equal(
      e.event.id,
      log1[id]?.event.id,
      "the same event, so a follower never sees it twice",
    );
    assert.equal(e.event.created_at, AT.getTime() / 1000);
  }
  // Every event either relay heard is valid NIP-01 from the channel key, never the records key.
  for (const e of [...a.received, ...b.received]) checkEvent(e, key.channel.pubkey);
  const one = a.received[0] as StubEvent;
  assert.deepEqual(checkStubEvent({ ...one, content: `${one.content} ` }, key.channel.pubkey), [
    "id",
  ]);
  assert.deepEqual(checkStubEvent({ ...one, sig: "00".repeat(64) }, key.channel.pubkey), [
    "signature",
  ]);
  assert.deepEqual(checkStubEvent(one, key.nostr.pubkey), ["pubkey"], "never the records key");
  assert.equal(new Set(b.received.map((e) => e.id)).size, 3);
  const article = a.received.find((e) => e.kind === 30023);
  assert.ok(article);
  assert.deepEqual(article.tags[0], ["d", "2026-11-20"]);
  assert.match(article.content, /^1 new claim\. Every line links to its evidence\./);
  assert.ok(article.content.includes("https://blocklore.space/claims/halvings.subsidy-840000"));
  const profile = JSON.parse(a.received.find((e) => e.kind === 0)?.content ?? "{}");
  assert.equal(profile.nip05, "_@blocklore.space");

  // Published notes are never sent again.
  const heard = a.received.length;
  const third = await postPending(state(ON, log2), { logFile: file });
  assert.deepEqual([third.published, third.waiting], [[], []]);
  assert.equal(a.received.length, heard);
  assert.equal(nostrView(state(ON, log2)).published, 3);
});

test("a relay that refuses a note does not count", async () => {
  const file = path.join(dir, "refused.json");
  b.mode.refuse = true;
  try {
    b.held.clear();
    a.held.clear();
    const r = await postPending(state(ON), { logFile: file, now: () => AT, max: 1 });
    assert.equal(r.waiting.length, 1);
    assert.equal(r.left, 2, "the rest wait for the next tick");
    assert.deepEqual(Object.values(readLog(file))[0]?.relays, [a.url]);
  } finally {
    b.mode.refuse = false;
  }
});

test("a test, and a development daemon, reach only relays on this machine", async () => {
  const s = state(ON, {}, ["wss://relay.damus.io", "wss://nos.lol"]);
  let sends = 0;
  await assert.rejects(
    postPending(s, {
      send: async () => {
        sends++;
        return [];
      },
      logFile: path.join(dir, "public.json"),
    }),
    /a test may reach only relays on this machine/,
  );
  assert.equal(sends, 0);
  assert.match(
    relayProblem(["wss://nos.lol"], { site: "http://localhost:3723", test: false }) ?? "",
    /development daemon/,
  );
  assert.equal(
    relayProblem(["wss://nos.lol", "wss://relay.primal.net"], {
      site: "https://blocklore.space",
      test: false,
    }),
    null,
  );
  assert.match(
    relayProblem(["ws://relay.example"], { site: "https://blocklore.space", test: false }) ?? "",
    /wss/,
  );
});

test("the owner's nostr.post command saves the switch at once and queues the job that posts", () => {
  const control = controlStore(mkdtempSync(path.join(tmpdir(), "bl-control-")));
  const now = new Date("2026-11-21T12:00:00.000Z");
  const deps = {
    control,
    key: "c".repeat(64),
    now: () => now,
    pending: () => [],
    stopSession: () => ({ ok: true, message: "stopping" }),
    host: "devbox",
    head: () => "abc123",
  };
  const cmd = (on: boolean, id: number): unknown =>
    signCommand(deps.key, {
      id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
      at: "2026-11-21T11:59:30.000Z",
      by: "owner@example.com",
      cmd: { type: "nostr.post", on } satisfies Command,
    });
  assert.equal(control.settings().nostr.post, false, "off by default");
  assert.ok(LONG.has("nostr.post"));
  const [r] = dispatch(cmd(true, 1), deps);
  assert.equal(r?.phase, "received");
  assert.deepEqual(control.settings().nostr, { post: true, changed: "2026-11-21T12:00:00Z" });
  assert.deepEqual(
    control.jobs().map((j) => j.type),
    ["nostr.post"],
  );
  dispatch(cmd(false, 2), deps);
  assert.deepEqual(control.settings().nostr, { post: false, changed: "2026-11-21T12:00:00Z" });
});

test("settings saved before the channel existed read as posting off", () => {
  const { nostr: _, ...old } = DEFAULT_SETTINGS;
  assert.deepEqual(migrateSettings(old)?.nostr, { post: false, changed: null });
  assert.deepEqual(DEFAULT_SETTINGS.nostr, { post: false, changed: null });
});
