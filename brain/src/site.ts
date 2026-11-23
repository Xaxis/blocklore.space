// The brain's calls to the site's bearer routes: the suggestion queue and reader reports, both under
// QUEUE_PULL_TOKEN. BLOCKLORE_SITE points a devbox at a preview or a local server.
import { SITE, SITE_HEADERS } from "./env.ts";

export { SITE };

function token(): string {
  const t = process.env.QUEUE_PULL_TOKEN;
  if (!t) throw new Error("QUEUE_PULL_TOKEN is not set (.env; tools/env.sh makes it)");
  return t;
}

/** An HTTP error from the site, with its status, so a caller can tell a refusal from an outage. */
export class SiteError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function siteCall(
  method: "GET" | "POST",
  route: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${SITE}${route}`, {
    method,
    headers: {
      ...SITE_HEADERS,
      Authorization: `Bearer ${token()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok)
    throw new SiteError(`${method} ${route}: ${res.status} ${data.error ?? ""}`.trim(), res.status);
  return data;
}
