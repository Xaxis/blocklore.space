// `pnpm brain admin-link`: a one-time sign-in link to the admin, for when the mailed link does not
// arrive (ADMIN.md, "Signing in"). The request is signed under CONTROL_KEY, so only the devbox and
// the site can mint one; the site answers with the link, which works once, for 15 minutes.
import { randomBytes } from "node:crypto";
import { signLinkRequest } from "@blocklore/core/control";
import { SITE, SITE_HEADERS } from "./env.ts";

export async function adminLink(): Promise<number> {
  const key = process.env.CONTROL_KEY ?? "";
  if (key.length < 32) throw new Error("CONTROL_KEY is not in .env (tools/env.sh makes it)");
  const body = signLinkRequest(key, new Date().toISOString(), randomBytes(16).toString("hex"));
  const res = await fetch(`${SITE}/api/control/link`, {
    method: "POST",
    headers: { ...SITE_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let url: string | undefined;
  try {
    url = (JSON.parse(text) as { url?: string }).url;
  } catch {
    url = undefined;
  }
  if (!res.ok || !url?.startsWith("http"))
    throw new Error(`${SITE}/api/control/link answered ${res.status}: ${text.slice(0, 200)}`);
  console.log(`One-time sign-in link (15 minutes, works once):\n\n  ${url}\n`);
  return 0;
}
