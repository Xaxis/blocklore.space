import "server-only";
import type { DebateView, WithdrawnDebate } from "@blocklore/core";
import { bundle, getTopic } from "./data";

// Debate maps as the compiler left them (core/src/debateview.ts): only debates that keep every rule
// against the current claims are in the bundle, so a page never shows one that does not.

/** Every shown debate, newest change first. */
export function allDebates(): DebateView[] {
  return [...bundle.debates].sort(
    (a, b) => b.updated.time.localeCompare(a.updated.time) || a.slug.localeCompare(b.slug),
  );
}

export function getDebate(slug: string): DebateView | undefined {
  return bundle.debates.find((d) => d.slug === slug);
}

/** Maps the owner withdrew, newest first: only their own pages and the API's answers name them. */
export function withdrawnDebates(): WithdrawnDebate[] {
  return [...bundle.withdrawnDebates].sort((a, b) =>
    b.withdrawn.at.time.localeCompare(a.withdrawn.at.time),
  );
}

export function getWithdrawnDebate(slug: string): WithdrawnDebate | undefined {
  return bundle.withdrawnDebates.find((d) => d.slug === slug);
}

/** The debates filed under a topic, for its page's link. */
export function debatesOnTopic(slug: string): DebateView[] {
  return allDebates().filter((d) => d.topics.includes(slug));
}

/** A debate's topics that are published, with their titles, in the debate's order. */
export function debateTopics(d: DebateView): { slug: string; title: string }[] {
  return d.topics.flatMap((slug) => {
    const t = getTopic(slug);
    return t ? [{ slug, title: t.title }] : [];
  });
}
