import { changes, edition, json } from "@/lib/api";

/** Change events newest first; `since` keeps only those stamped after that block height. */
export function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const since = p.get("since");
  const limit = p.get("limit");
  if (since !== null && !/^\d{1,8}$/.test(since))
    return json({ error: "since is a block height." }, { status: 400 });
  if (limit !== null && !/^\d{1,3}$/.test(limit))
    return json({ error: "limit is 1 to 500." }, { status: 400 });
  const events = changes({
    since: since === null ? undefined : Number(since),
    limit: limit === null ? undefined : Number(limit),
  });
  return json({ edition: edition(), since: since === null ? null : Number(since), events });
}
