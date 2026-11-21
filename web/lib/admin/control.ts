import "server-only";
import { randomUUID } from "node:crypto";
import {
  type Command,
  CommandResult,
  DaemonState,
  KEYS,
  LiveEvent,
  ReviewItem,
  signCommand,
} from "@blocklore/core/control";
import { z } from "zod";
import type { Session } from "./auth";
import { getJson, pushTail, readLive, setJson, TTL } from "./store";

// The admin's side of the control plane (ADMIN.md): read what the daemon last sent, and queue the
// owner's commands signed under CONTROL_KEY.

/** The daemon counts as online when it synced within this window (it syncs every 20 s at most). */
export const ONLINE_MS = 75_000;

export async function readState(): Promise<{ state: DaemonState | null; online: boolean }> {
  const raw = await getJson(KEYS.state);
  const p = DaemonState.safeParse(raw);
  if (!p.success) return { state: null, online: false };
  return { state: p.data, online: Date.now() - Date.parse(p.data.at) < ONLINE_MS };
}

export async function readReview(): Promise<ReviewItem[]> {
  const p = z.array(ReviewItem).safeParse(await getJson(KEYS.review));
  return p.success ? p.data : [];
}

export async function readResults(ids: string[]): Promise<Record<string, CommandResult>> {
  const out: Record<string, CommandResult> = {};
  for (const id of ids.slice(0, 20)) {
    if (!/^[0-9a-f-]{36}$/.test(id)) continue;
    const p = CommandResult.safeParse(await getJson(KEYS.result(id)));
    if (p.success) out[id] = p.data;
  }
  return out;
}

export async function readLiveEvents(n = 200): Promise<LiveEvent[]> {
  return (await readLive(n)).flatMap((e) => {
    const p = LiveEvent.safeParse(e);
    return p.success ? [p.data] : [];
  });
}

/** Marks the admin as open, so the daemon syncs every few seconds. */
export async function watch(): Promise<void> {
  await setJson(KEYS.watch, 1, TTL.watch);
}

export async function sendCommand(session: Session, cmd: Command): Promise<string> {
  const key = process.env.CONTROL_KEY ?? "";
  if (key.length < 32) throw new Error("CONTROL_KEY is not set on the site");
  const id = randomUUID();
  const envelope = signCommand(key, { id, at: new Date().toISOString(), by: session.email, cmd });
  await pushTail(KEYS.commands, envelope);
  await watch();
  return id;
}
