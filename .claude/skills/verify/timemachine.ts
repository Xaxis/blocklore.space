// Drives the time machine against a running site and fails on the first wrong answer: the API's
// ?at= and the pages at /at/<moment> for a height before the first claim, the height of the first
// sealed edition (every claim it sealed must come back with the hash it sealed), a date, refused
// moments, the forms without script, the live pages' controls, /verify's links and the MCP tools.
//
//   node .claude/skills/verify/timemachine.ts [base]     base defaults to http://localhost:3721
//
// Every request carries the check header, so the site's reach counts never count it.

const base = (process.argv[2] ?? "http://localhost:3721").replace(/\/$/, "");
const CHECK = { "X-Blocklore-Check": "1" };

function check(cond: unknown, what: string): void {
  if (!cond) {
    console.error(`timemachine FAILED: ${what}`);
    process.exit(1);
  }
  console.log(`  ok  ${what}`);
}

async function get(path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...CHECK, ...(init.headers ?? {}) },
  });
  return { res, text: await res.text() };
}
async function json<T>(path: string) {
  const { res, text } = await get(path);
  return { status: res.status, headers: res.headers, body: JSON.parse(text) as T };
}
const html = (text: string) => text.replaceAll("<!-- -->", "");
const fmt = (n: number) => n.toLocaleString("en-US");

type Brief = { id: string; url: string; statement: string };
type TopicAt = {
  as_of: { at: string; height?: number; date?: string; url: string };
  topic: { claims: number; lede: string | null; sections: { claims: Brief[] }[] };
  since: { added: string[]; revised: string[]; withdrawn: string[]; current: string };
};
type ClaimAt = {
  as_of: { at: string };
  claim: { id: string; hash: string; statement: string; url: string; revisions: unknown[] };
  since: { revisions: unknown[] };
};

const index = await json<{ edition: { generated: { time: string; height: number } } }>("/api/v1");
const latest = index.body.edition.generated;
const topics = (await json<{ topics: { slug: string; claims: number }[] }>("/api/v1/topics")).body
  .topics;
const snaps = (await json<{ snapshots: { n: number; at: { height: number } }[] }>("/api/v1/snapshots"))
  .body.snapshots;
const first = snaps[snaps.length - 1];
check(first, `the store has ${snaps.length} sealed edition(s)`);
const H = first.at.height;
const sealed = (await json<{ claims: { id: string; hash: string }[] }>(`/snapshots/${first.n}.json`))
  .body.claims;
const events = (await json<{ events: { claim: string; at: { time: string; height: number } }[] }>(
  "/api/v1/changes?since=0&limit=500",
)).body.events;
const start = Math.min(...events.map((e) => e.at.height));
const firstDay = events.map((e) => e.at.time).sort()[0]?.slice(0, 10) as string;
const slug = topics[0]?.slug as string;

// 1. Before the first claim: every topic is empty, and everything it has now came later.
for (const t of topics) {
  const r = await json<TopicAt>(`/api/v1/topics/${t.slug}?at=${start - 1}`);
  check(
    r.status === 200 &&
      r.body.topic.claims === 0 &&
      r.body.topic.sections.length === 0 &&
      r.body.topic.lede === null &&
      r.body.since.added.length === t.claims,
    `${t.slug} at block ${start - 1}, before the first claim (${start}): empty, ${t.claims} added since`,
  );
}

// 2. The first edition's height: exactly the claims it sealed, each with the hash it sealed.
let same = 0;
for (const s of sealed) {
  const r = await json<ClaimAt>(`/api/v1/claims/${s.id}?at=${H}`);
  if (r.status === 200 && r.body.claim.hash === s.hash) same++;
  else check(false, `${s.id} at block ${H}: ${r.status}, hash ${r.body.claim?.hash}`);
}
check(same === sealed.length, `all ${same} claims of snapshot ${first.n} come back at block ${H} with the hash it sealed`);
const claimsNow = (await json<{ claims: { id: string }[] }>("/api/v1/claims")).body.claims;
const sealedIds = new Set(sealed.map((s) => s.id));
const later = claimsNow.filter((c) => !sealedIds.has(c.id));
for (const c of later) {
  const r = await json<{ first_seen: { height: number } }>(`/api/v1/claims/${c.id}?at=${H}`);
  check(
    r.status === 404 && r.body.first_seen.height > H,
    `${c.id}, published at block ${r.body.first_seen?.height}, is 404 at block ${H}`,
  );
}
const shown = new Set<string>();
for (const t of topics) {
  const r = await json<TopicAt>(`/api/v1/topics/${t.slug}?at=${H}`);
  for (const s of r.body.topic.sections) for (const c of s.claims) shown.add(c.id);
  if (t.slug === slug)
    check(
      r.headers.get("cache-control")?.includes("s-maxage=86400") &&
        r.body.topic.sections.every((s) => s.claims.every((c) => c.url.endsWith(`/at/${H}`))),
      `${slug} at block ${H}: cached for a day, each claim's url is its page at that moment`,
    );
}
check(
  [...shown].every((id) => sealedIds.has(id)),
  `the topics at block ${H} show ${shown.size} claims, all from snapshot ${first.n}`,
);

// 3. A date: the end of the first day claims were published.
const day = await json<TopicAt>(`/api/v1/topics/${slug}?at=${firstDay}`);
check(
  day.status === 200 && day.body.as_of.date === firstDay && day.body.topic.claims > 0,
  `${slug} at ${firstDay}: ${day.body.topic.claims} claims as of the end of that day`,
);

// 4. A revised claim, before and after its revision.
const all = (await get("/exports/claims.jsonl")).text
  .trim()
  .split("\n")
  .map(
    (l) =>
      JSON.parse(l) as {
        id: string;
        statement: string;
        revisions: { at: { height: number }; before?: { statement?: string } }[];
      },
  );
const revised = all.find((c) => c.revisions.length > 1 && c.revisions[1]?.before?.statement);
if (!revised)
  console.log(
    "  --  no published claim has a revision that changed its statement yet; core/test/replay.test.ts builds that case",
  );
else {
  const h = revised.revisions[1]?.at.height as number;
  const then = await json<ClaimAt>(`/api/v1/claims/${revised.id}?at=${h - 1}`);
  const now = await json<ClaimAt>(`/api/v1/claims/${revised.id}?at=${h}`);
  check(
    then.body.claim.statement === revised.revisions[1]?.before?.statement &&
      now.body.claim.statement !== then.body.claim.statement,
    `${revised.id} before its revision at block ${h} says what it said then`,
  );
}

// 5. Moments the store cannot show are 400, saying what a moment looks like.
const nextDay = new Date(Date.parse(`${latest.time.slice(0, 10)}T00:00:00Z`) + 86_400_000)
  .toISOString()
  .slice(0, 10);
const xprv =
  "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";
for (const [at, why] of [
  [String(latest.height + 1), "a height past the edition"],
  [nextDay, "a date after the edition's day"],
  ["yesterday", "garbage"],
  ["2026-02-30", "a date not on the calendar"],
  [xprv, "an extended private key"],
]) {
  for (const path of [`/api/v1/topics/${slug}`, `/api/v1/claims/${sealed[0]?.id}`]) {
    const { res, text } = await get(`${path}?at=${encodeURIComponent(at as string)}`);
    check(
      res.status === 400 &&
        (text.includes("A moment is a block height") || text.includes("never accepts")) &&
        !text.includes(xprv.slice(0, 16)) &&
        (at === xprv || !text.includes("yesterday")),
      `${why} is 400 at ${path}`,
    );
  }
}

// 6. The pages.
const page = html((await get(`/topics/${slug}/at/${H}`)).text);
const atH = await json<TopicAt>(`/api/v1/topics/${slug}?at=${H}`);
const unique = new Set(atH.body.topic.sections.flatMap((s) => s.claims.map((c) => c.id)));
check(
  page.includes(`As of block ${fmt(H)}`) &&
    (page.match(/class="claim"/g) ?? []).length === unique.size - 1 &&
    page.includes(`href="/claims/`) &&
    page.includes(`/at/${H}"`),
  `/topics/${slug}/at/${H} names the moment and shows its ${unique.size - 1} claims after the lede`,
);
const empty = html((await get(`/topics/${slug}/at/${start - 1}`)).text);
check(empty.includes("published no claims on this topic yet"), `/topics/${slug}/at/${start - 1} says it had none yet`);
const claimPage = html((await get(`/claims/${sealed[0]?.id}/at/${H}`)).text);
check(
  claimPage.includes(sealed[0]?.hash as string) && claimPage.includes(`As of block ${fmt(H)}`),
  `/claims/${sealed[0]?.id}/at/${H} shows the hash snapshot ${first.n} sealed`,
);
if (later[0]) {
  const notYet = html((await get(`/claims/${later[0].id}/at/${H}`)).text);
  check(notYet.includes("Not published yet"), `/claims/${later[0].id}/at/${H} says it was not published yet`);
}
const knowledge = html((await get(`/topics/at/${H}`)).text);
check(
  topics.every((t) => knowledge.includes(`href="/topics/${t.slug}/at/${H}"`)),
  `/topics/at/${H} links every topic at that moment`,
);
for (const path of [`/topics/${slug}/at/yesterday`, `/claims/${sealed[0]?.id}/at/${latest.height + 1}`, `/topics/no-such-topic/at/${H}`]) {
  const { res, text } = await get(path);
  check(res.status === 404 && html(text).includes("A moment is a block height"), `${path} is 404 and says what a moment is`);
}

// 7. The forms work without script: ?moment= redirects to the page.
for (const [from, to] of [
  [`/topics/${slug}/at?moment=${encodeURIComponent(`block ${fmt(H)}`)}`, `/topics/${slug}/at/${H}`],
  [`/claims/${sealed[0]?.id}/at?moment=${firstDay}`, `/claims/${sealed[0]?.id}/at/${firstDay}`],
  [`/topics/at?moment=${H}`, `/topics/at/${H}`],
]) {
  const { res } = await get(from as string, { redirect: "manual" });
  check(
    res.status === 303 && new URL(res.headers.get("location") ?? "", base).pathname === to,
    `${from} redirects to ${to}`,
  );
}

// 8. The live pages carry the control, and /verify links each edition's topics.
const live = (await get(`/topics/${slug}`)).text;
check(live.includes(`action="/topics/${slug}/at"`), `/topics/${slug} has the as-of form`);
const liveClaim = (await get(`/claims/${sealed[0]?.id}`)).text;
check(liveClaim.includes(`action="/claims/${sealed[0]?.id}/at"`), `/claims/${sealed[0]?.id} has the as-of form`);
const verify = (await get("/verify")).text;
check(
  snaps.every((s) => verify.includes(`href="/topics/at/${s.at.height}"`)),
  "/verify links the topics as of each edition's height",
);

// 9. The MCP tools take at.
const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "blocklore-timemachine", version: "1.0.0" },
};
async function tool(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      ...CHECK,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": name,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args, _meta: meta },
    }),
  });
  const body = (await res.json()) as {
    result: { isError?: boolean; structuredContent?: TopicAt & ClaimAt; content: { text: string }[] };
  };
  return body.result;
}
const t = await tool("get_topic", { slug, at: String(H) });
check(
  !t.isError && t.structuredContent?.topic.claims === atH.body.topic.claims,
  `MCP get_topic ${slug} at ${H}: ${t.structuredContent?.topic.claims} claims, as the API says`,
);
const c = await tool("get_claim", { id: sealed[0]?.id, at: H });
check(
  !c.isError && c.structuredContent?.claim.hash === sealed[0]?.hash,
  `MCP get_claim at ${H} (a number) gives the sealed hash`,
);
const bad = await tool("get_topic", { slug, at: "last tuesday" });
check(
  bad.isError === true && bad.content[0]?.text.includes("A moment is a block height"),
  "MCP get_topic with a bad at is a tool error saying what a moment is",
);
console.log(`timemachine passed against ${base}`);
