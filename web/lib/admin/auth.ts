import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { PRODUCTION } from "@/lib/kv";
import { SITE } from "@/lib/site";
import { del, getJson, hit, setAdd, setJson, setMembers, takeJson } from "./store";

// Signing in to the admin (ADMIN.md, "Signing in"): one address, a one-time link by mail or from
// the devbox, and a session whose id only the browser holds (Redis keeps its hash).

const LINK_TTL_S = 15 * 60;
const SESSION_TTL_S = 30 * 24 * 3600;
export const COOKIE = PRODUCTION ? "__Host-bl_admin" : "bl_admin";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const linkKey = (token: string) => `adm:link:${sha(token)}`;
const sessionKey = (sid: string) => `adm:sess:${sha(sid)}`;
const SESSIONS = "adm:sessions";

export function ownerEmail(): string | null {
  const e = process.env.OWNER_EMAIL?.trim().toLowerCase();
  return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/** The origins a sign-in link may point at; anything else gets the canonical site. */
const ORIGINS = [
  SITE.url,
  "https://www.blocklore.space",
  "https://blocklore.vercel.app",
  ...(PRODUCTION ? [] : ["http://localhost:3721"]),
];

export function trustedOrigin(origin: string | null): string {
  return origin && ORIGINS.includes(origin) ? origin : SITE.url;
}

/** A state-changing request must come from one of the site's own pages. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  return origin !== null && ORIGINS.includes(origin);
}

export interface Session {
  email: string;
  at: string;
}

/** Makes a one-time sign-in link for the owner and returns it (the token rides in the fragment). */
export async function makeLink(origin: string): Promise<string> {
  const owner = ownerEmail();
  if (!owner) throw new Error("OWNER_EMAIL is not set");
  const token = randomBytes(32).toString("base64url");
  await setJson(linkKey(token), { email: owner, at: new Date().toISOString() }, LINK_TTL_S);
  return `${trustedOrigin(origin)}/admin/auth#t=${token}`;
}

/**
 * Mails a link when the address is the owner's. Answers the same either way, so the form does not
 * reveal the address. Limited to 5 links an hour from one visitor and 10 an hour in all.
 */
export async function requestLink(email: string, origin: string, ip: string): Promise<void> {
  const owner = ownerEmail();
  if (!owner || email.trim().toLowerCase() !== owner) return;
  if ((await hit(`adm:rl:ip:${sha(ip)}`, 3600)) > 5) return;
  if ((await hit("adm:rl:all", 3600)) > 10) return;
  const url = await makeLink(origin);
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (!PRODUCTION) console.log(`[admin] sign-in link (dev, no RESEND_API_KEY): ${url}`);
    return;
  }
  const text = `Sign in to the Blocklore admin:\n\n${url}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this mail: nobody can sign in without opening it.`;
  const html = `<div style="font:15px/1.6 -apple-system,Segoe UI,sans-serif;color:#0f1217;max-width:30rem">
<p style="font-weight:600;font-size:17px;margin:0 0 12px">Sign in to Blocklore</p>
<p style="margin:0 0 20px">Open the admin with this link. It works once and expires in 15 minutes.</p>
<p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:#0f1217;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:500">Open the admin</a></p>
<p style="margin:0;color:#646c7a;font-size:13px">If you did not ask for this, ignore it: nobody can sign in without opening the link.</p>
</div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Blocklore <login@blocklore.space>",
      to: [owner],
      subject: "Sign in to Blocklore",
      text,
      html,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) console.error(`[admin] Resend answered ${res.status}`);
}

/** Uses up a link and opens a session; null when the link is unknown, used or expired. */
export async function redeemLink(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const link = (await takeJson(linkKey(token))) as { email?: string } | null;
  const owner = ownerEmail();
  if (!link?.email || !owner || link.email !== owner) return null;
  const sid = randomBytes(32).toString("base64url");
  const session: Session = { email: owner, at: new Date().toISOString() };
  await setJson(sessionKey(sid), session, SESSION_TTL_S);
  await setAdd(SESSIONS, sha(sid));
  return sid;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: PRODUCTION,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_S,
  };
}

/** The signed-in owner, or null. */
export async function currentSession(): Promise<Session | null> {
  const sid = (await cookies()).get(COOKIE)?.value;
  if (!sid || sid.length > 100) return null;
  const s = (await getJson(sessionKey(sid))) as Session | null;
  const owner = ownerEmail();
  return s && owner && s.email === owner ? s : null;
}

/** For admin pages: the session, or off to the sign-in page. */
export async function requireOwner(): Promise<Session> {
  const s = await currentSession();
  if (!s) redirect("/admin/login");
  return s;
}

/** For admin routes: the session, after the same-origin check, or null. */
export async function ownerFor(req: Request): Promise<Session | null> {
  if (req.method !== "GET" && !sameOrigin(req)) return null;
  return currentSession();
}

export async function endSession(all: boolean): Promise<void> {
  const sid = (await cookies()).get(COOKIE)?.value;
  if (all) {
    for (const h of await setMembers(SESSIONS)) await del(`adm:sess:${h}`);
    await del(SESSIONS);
  } else if (sid) await del(sessionKey(sid));
}

export async function clientIpFromHeaders(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
