"use client";

import type { Activity, BrainFeed } from "@blocklore/core/feed";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

// The brain's live feed (/api/v1/brain), read once for the whole app: the Brain view and the scene
// share one copy. It polls while the tab is visible and the reader is not in the admin (which has
// its own, richer channel), and stops when the tab is hidden.

export interface Live {
  /** null until the first answer arrives. */
  feed: BrainFeed | null;
  online: boolean;
  /** True once the first request finished, whatever it found. */
  loaded: boolean;
  /** Titles of the topics that have a page, by slug: the brain also works on topics that do not yet. */
  topics: Readonly<Record<string, string>>;
}

const EMPTY: Live = { feed: null, online: false, loaded: false, topics: {} };
const Ctx = createContext<Live>(EMPTY);
const EVERY_MS = 12_000;

export function BrainFeedProvider({
  children,
  topics,
}: {
  children: ReactNode;
  topics: Readonly<Record<string, string>>;
}) {
  const path = usePathname();
  const admin = path.startsWith("/admin");
  const [live, setLive] = useState<Omit<Live, "topics">>(EMPTY);

  useEffect(() => {
    if (admin) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await fetch("/api/v1/brain", { cache: "no-store" });
        const body = (await res.json()) as { online: boolean; feed: BrainFeed | null };
        if (!stop) setLive({ feed: body.feed, online: body.online, loaded: true });
      } catch {
        if (!stop) setLive((l) => ({ ...l, online: false, loaded: true }));
      }
    };
    const loop = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") await load();
      timer = setTimeout(loop, EVERY_MS);
    };
    const wake = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        loop();
      }
    };
    loop();
    document.addEventListener("visibilitychange", wake);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [admin]);

  const value = useMemo(() => ({ ...live, topics }), [live, topics]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrainFeed(): Live {
  return useContext(Ctx);
}

/** Plain words for each thing the brain does, as a reader would say it. */
export const ACTIVITY_WORD: Record<Activity, string> = {
  idle: "Waiting",
  ingest: "Reading",
  research: "Researching",
  verify: "Verifying",
  evaluate: "Evaluating",
  recheck: "Rechecking",
  watch: "Watching",
  lab: "Testing",
  snapshot: "Sealing",
  publish: "Publishing",
  paused: "Paused",
};

/** "4 min", "2 h", "3 d": how long ago (or, for a future time, how soon). */
export function span(iso: string, now: number): string {
  const s = Math.abs(now - Date.parse(iso)) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} d`;
}

/** The current time, refreshed every 20 seconds after mount (null on the server and first paint). */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
