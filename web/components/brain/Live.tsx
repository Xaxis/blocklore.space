"use client";

import type { FeedEvent } from "@blocklore/core/feed";
import Link from "next/link";
import { ACTIVITY_WORD, span, useBrainFeed, useNow } from "./feed";

const TOPIC = (slug: string) => slug.replace(/-/g, " ");

/** The status chip: live, offline, or still connecting. */
export function BrainStatus() {
  const { feed, online, loaded } = useBrainFeed();
  const now = useNow();
  const word = !loaded ? "Connecting" : online ? "Live" : "Offline";
  return (
    <span className="brain-status" data-state={!loaded ? "loading" : online ? "live" : "off"}>
      <span className="brain-pulse" aria-hidden="true" />
      {word}
      {loaded && !online && feed && now !== null && (
        <span className="muted"> · last heard {span(feed.at, now)} ago</span>
      )}
    </span>
  );
}

/** What the brain is doing this minute, and what it does next. */
export function BrainNow() {
  const { feed, online, loaded } = useBrainFeed();
  const now = useNow();
  if (!loaded)
    return (
      <div className="brain-now" aria-busy="true">
        <p className="brain-now-kind">Connecting to the brain</p>
        <p className="brain-now-text">&nbsp;</p>
      </div>
    );
  if (!feed)
    return (
      <div className="brain-now" data-kind="offline">
        <p className="brain-now-kind">Not reporting yet</p>
        <p className="brain-now-text">
          The research brain runs on a machine of its own and reports here every few seconds.
        </p>
      </div>
    );
  const next = feed.next[0];
  return (
    <div className="brain-now" data-kind={online ? feed.now.kind : "offline"} aria-live="polite">
      <p className="brain-now-kind">
        {online ? ACTIVITY_WORD[feed.now.kind] : "Offline"}
        {online && now !== null && feed.now.kind !== "idle" && (
          <span className="muted"> · for {span(feed.now.since, now)}</span>
        )}
      </p>
      <p className="brain-now-text">
        {online ? feed.now.text : "The brain has not reported for a few minutes."}
        {online && feed.now.topic && (
          <>
            {" "}
            <Link href={`/topics/${feed.now.topic}`}>Open {TOPIC(feed.now.topic)}</Link>
          </>
        )}
      </p>
      {next && (
        <p className="brain-next">
          <span className="muted">Next</span> {next.text}
          {now !== null && <span className="muted"> · in {span(next.at, now)}</span>}
        </p>
      )}
      {online && feed.research && feed.research.state !== "scheduled" && (
        <p className="brain-next" data-research={feed.research.state}>
          <span className="muted">Research</span> {feed.research.text}
          {feed.research.until && now !== null && (
            <span className="muted"> · about {span(feed.research.until, now)}</span>
          )}
        </p>
      )}
    </div>
  );
}

const DAY: Array<[keyof NonNullable<ReturnType<typeof useBrainFeed>["feed"]>["day"], string]> = [
  ["read", "new items read"],
  ["rechecked", "facts checked again"],
  ["drafted", "facts drafted"],
  ["published", "published"],
  ["rejected", "rejected"],
  ["sessions", "research sessions"],
];

/** The last 24 hours in six numbers. */
export function BrainDay() {
  const { feed, loaded } = useBrainFeed();
  if (loaded && !feed) return null;
  return (
    <dl className="brain-day" aria-busy={!loaded}>
      {DAY.map(([k, label]) => (
        <div key={k}>
          <dt>{label}</dt>
          <dd>{feed ? feed.day[k].toLocaleString("en-US") : " "}</dd>
        </div>
      ))}
    </dl>
  );
}

function Event({ e, now }: { e: FeedEvent; now: number | null }) {
  return (
    <li className="brain-event" data-kind={e.kind} data-outcome={e.outcome}>
      <span className="brain-event-when">{now === null ? "" : span(e.at, now)}</span>
      <span className="brain-event-kind">{ACTIVITY_WORD[e.kind]}</span>
      <span className="brain-event-text">
        {e.text}
        {e.topic && (
          <>
            {" "}
            <Link href={`/topics/${e.topic}`}>{TOPIC(e.topic)}</Link>
          </>
        )}
        {e.claims?.length === 1 && e.claims[0] && (
          <>
            {" "}
            <Link href={`/claims/${e.claims[0]}`}>the fact</Link>
          </>
        )}
      </span>
    </li>
  );
}

/** What the brain did lately, newest first. */
export function BrainEvents({ max = 10 }: { max?: number }) {
  const { feed, loaded } = useBrainFeed();
  const now = useNow();
  if (!loaded) return <p className="empty">Loading what the brain did lately.</p>;
  const events = feed?.events.slice(0, max) ?? [];
  if (!events.length) return <p className="empty">Nothing reported in the last day yet.</p>;
  return (
    <ol className="brain-events">
      {events.map((e) => (
        <Event key={`${e.at}-${e.kind}-${e.text}`} e={e} now={now} />
      ))}
    </ol>
  );
}

/** What is scheduled, soonest first. */
export function BrainNext() {
  const { feed } = useBrainFeed();
  const now = useNow();
  const next = feed?.next ?? [];
  if (!next.length) return null;
  return (
    <ul className="brain-schedule">
      {next.slice(0, 4).map((n) => (
        <li key={`${n.at}-${n.text}`}>
          <span className="brain-event-when">{now === null ? "" : `in ${span(n.at, now)}`}</span>
          <span>{n.text}</span>
        </li>
      ))}
    </ul>
  );
}
