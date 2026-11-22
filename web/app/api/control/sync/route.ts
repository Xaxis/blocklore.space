import { KEYS, SYNC_MAX_COMMANDS, SyncRequest, type SyncResponse } from "@blocklore/core/control";
import { controlAvailable, getJson, popHead, pushLive, setJson, TTL } from "@/lib/admin/store";
import { sameSecret } from "@/lib/kv";

// The brain daemon's one call (ADMIN.md, "Control plane"): it posts its state, the review queue
// when it changed, live events and command results, and takes the owner's queued commands. Bearer
// BRAIN_SYNC_TOKEN. The commands it gets back are still only as good as their HMAC, which the
// daemon checks under CONTROL_KEY before it applies any.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 4 * 1024 * 1024;

const reply = (data: unknown, status = 200) =>
  new Response(`${JSON.stringify(data)}\n`, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

function authorized(req: Request): boolean {
  const token = process.env.BRAIN_SYNC_TOKEN;
  const got = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  return !!token && sameSecret(got, token);
}

export async function POST(req: Request) {
  if (!authorized(req)) return reply({ error: "Not authorized." }, 401);
  if (!controlAvailable()) return reply({ error: "The control store is not available." }, 503);
  const size = Number(req.headers.get("content-length") ?? 0);
  if (size > MAX_BODY) return reply({ error: "Too large." }, 413);
  const text = await req.text();
  if (text.length > MAX_BODY) return reply({ error: "Too large." }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return reply({ error: "Not JSON." }, 400);
  }
  const parsed = SyncRequest.safeParse(raw);
  if (!parsed.success)
    return reply(
      { error: "Does not match SyncRequest.", issues: parsed.error.issues.slice(0, 5) },
      400,
    );
  const body = parsed.data;

  await setJson(KEYS.state, body.state, TTL.state);
  if (body.review) await setJson(KEYS.review, body.review);
  if (body.embargo) await setJson(KEYS.embargo, body.embargo);
  if (body.live.length || body.liveReset) await pushLive(body.live, body.liveReset);
  for (const r of body.results) await setJson(KEYS.result(r.id), r, TTL.result);

  const commands = await popHead(KEYS.commands, SYNC_MAX_COMMANDS);
  const watch = (await getJson(KEYS.watch)) !== null;
  const out: SyncResponse = { commands, watch, at: new Date().toISOString() };
  return reply(out);
}
