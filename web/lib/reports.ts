import "server-only";
import {
  applyOwnerAction,
  applyReportUpdate,
  intakeReport,
  type PublicReport,
  publicReport,
  type ReportItem,
  type ReportOwnerAction,
  type ReportResult,
  type ReportStore,
  type ReportUpdate,
  reportOrder,
  reportUpdateProblem,
} from "@blocklore/core";
import type { Redis } from "@upstash/redis";
import { getClaim } from "./data";
import { countDay, devMemory, kv, PRODUCTION, salt, utcDay, visitorHash } from "./kv";

// Reader reports, the site's half (core/src/report.ts holds the rules): a reader says a published
// claim is wrong, outdated, unsupported by its source, has a broken link or is unclear. No model
// reads it on the site. The brain pulls new reports with a bearer token (brainAuthorized), rechecks
// each claim and reports the outcome back; the public sees every report's kind, date and outcome,
// never a reader's note. The owner sees the notes in the admin and can dismiss a report as abuse.

interface Store extends ReportStore {
  all(): Promise<ReportItem[]>;
  forClaim(claim: string): Promise<ReportItem[]>;
  /** Reports filed or changed since the last pull, removed from the new set as they are returned. */
  takeNew(): Promise<ReportItem[]>;
}

function redisStore(r: Redis): Store {
  const key = (id: string) => `report:item:${id}`;
  const many = async (ids: string[]) =>
    ids.length
      ? (await r.mget<(ReportItem | null)[]>(...ids.map(key))).filter((x): x is ReportItem => !!x)
      : [];
  return {
    get: async (id) => (await r.get<ReportItem>(key(id))) ?? null,
    async put(item, fresh) {
      const p = r
        .pipeline()
        .set(key(item.id), item)
        .sadd("report:ids", item.id)
        .sadd(`report:claim:${item.claim}`, item.id);
      if (fresh) p.sadd("report:new", item.id);
      await p.exec();
    },
    count: (who, day) => countDay("report", who, day),
    all: async () => many(await r.smembers("report:ids")),
    forClaim: async (claim) => many(await r.smembers(`report:claim:${claim}`)),
    async takeNew() {
      const ids = await r.smembers("report:new");
      if (!ids.length) return [];
      const items = await many(ids);
      await r.srem("report:new", ...ids);
      return items;
    },
  };
}

function memoryStore(): Store {
  const m = devMemory("reports", () => ({
    items: new Map<string, ReportItem>(),
    fresh: new Set<string>(),
  }));
  return {
    get: async (id) => m.items.get(id) ?? null,
    async put(item, fresh) {
      m.items.set(item.id, item);
      if (fresh) m.fresh.add(item.id);
    },
    count: (who, day) => countDay("report", who, day),
    all: async () => [...m.items.values()],
    forClaim: async (claim) => [...m.items.values()].filter((i) => i.claim === claim),
    async takeNew() {
      const items = [...m.fresh].flatMap((id) => m.items.get(id) ?? []);
      m.fresh.clear();
      return items;
    },
  };
}

function store(): Store | null {
  const r = kv();
  if (r) return redisStore(r);
  return PRODUCTION ? null : memoryStore();
}

/** Takes a reader's report on a published claim (withdrawn claims take none). */
export async function fileReport(input: {
  claim: string;
  body: unknown;
  ip: string;
}): Promise<ReportResult | { ok: false; status: 503; error: string }> {
  const key = salt();
  const s = store();
  if (!key || !s) return { ok: false, status: 503, error: "Reports are not available right now." };
  const now = new Date();
  const c = getClaim(input.claim);
  return intakeReport(
    {
      claim: c ? { id: c.id, hash: c.hash } : null,
      body: input.body,
      visitor: visitorHash(key, input.ip, utcDay(now)),
      now,
    },
    s,
  );
}

/** Every report on one claim, as anyone may see it: no notes. */
export async function claimReports(claim: string): Promise<PublicReport[] | null> {
  const s = store();
  if (!s) return null;
  return (await s.forClaim(claim)).map(publicReport).sort(reportOrder);
}

/** Every report, as anyone may see it, with the claim's statement in this edition. */
export async function publicReports(): Promise<
  (PublicReport & { statement: string | null })[] | null
> {
  const s = store();
  if (!s) return null;
  return (await s.all())
    .map(publicReport)
    .sort(reportOrder)
    .map((r) => ({ ...r, statement: getClaim(r.claim)?.statement ?? null }));
}

/** For the brain and the owner: new reports since the last pull, or every one with `all`. */
export async function pullReports(all: boolean): Promise<ReportItem[] | null> {
  const s = store();
  if (!s) return null;
  const items = all ? await s.all() : await s.takeNew();
  return items.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export type Changed = { ok: true; item: ReportItem } | { ok: false; status: number; error: string };

/** The brain's outcome for one report (checked by reportUpdateProblem: dismissals win). */
export async function updateReport(u: ReportUpdate): Promise<Changed> {
  const s = store();
  if (!s) return { ok: false, status: 503, error: "Reports are not available." };
  const old = await s.get(u.id);
  const problem = reportUpdateProblem(old, u);
  if (!old || problem)
    return {
      ok: false,
      status: !old ? 404 : old.status === "dismissed" ? 409 : 400,
      error: problem ?? "",
    };
  const item = applyReportUpdate(old, u, new Date().toISOString());
  await s.put(item, false);
  return { ok: true, item };
}

/**
 * The owner's action from the admin. Either one goes back to the brain's next pull: a dismissal so
 * research drops it, a reopening so the brain rechecks the claim again.
 */
export async function ownerReport(a: ReportOwnerAction): Promise<Changed> {
  const s = store();
  if (!s) return { ok: false, status: 503, error: "Reports are not available." };
  const old = await s.get(a.id);
  if (!old) return { ok: false, status: 404, error: `No report ${a.id}.` };
  const item = applyOwnerAction(old, a, new Date().toISOString());
  await s.put(item, true);
  return { ok: true, item };
}
