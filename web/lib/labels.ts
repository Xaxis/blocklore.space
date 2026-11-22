import type { Confidence, Depth, Kind, SourceKind, Status } from "@blocklore/core";

export const STATUS_LABEL: Record<Status, string> = {
  established: "Established",
  contested: "Contested",
  speculative: "Speculative",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
};

export const STATUS_HINT: Record<Status, string> = {
  established: "Informed people agree on this, and the evidence settles it.",
  contested: "Informed people disagree. Each side is attributed in its own words.",
  speculative: "A projection, a proposal or an open question; not settled fact.",
  superseded: "Was true or held; a newer claim replaces it.",
  withdrawn: "The owner withdrew it. It is kept here with its history, and shown nowhere else.",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export const CONFIDENCE_BARS: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

export const KIND_LABEL: Record<Kind, string> = {
  definition: "Definition",
  fact: "Fact",
  mechanism: "How it works",
  event: "Event",
  trace: "Trace",
  stance: "Stance",
  argument: "Argument",
  "open-question": "Open question",
};

export const DEPTH_HINT: Record<Depth, string> = {
  curious: "What it is, in plain words.",
  user: "What it means when you use Bitcoin.",
  holder: "What matters when you hold your own coins.",
  builder: "How it works in the protocol and the code.",
  researcher: "Edge cases, history, open questions and the primary record.",
};

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  bip: "BIP",
  bolt: "BOLT",
  code: "Source code",
  commit: "Commit",
  pr: "Pull request",
  issue: "Issue",
  "release-notes": "Release notes",
  "mailing-list": "Mailing list",
  delving: "Delving Bitcoin",
  chain: "The chain",
  optech: "Bitcoin Optech",
  stackexchange: "Stack Exchange",
  transcript: "Transcript",
  paper: "Paper",
  docs: "Documentation",
  media: "Media",
  social: "Social",
};

export const TIER_HINT: Record<string, string> = {
  T1: "Primary: the code, the specification, the chain, or the author's own words.",
  T2: "Expert secondary: reviewed technical writing such as Optech.",
  T3: "Reputable general coverage.",
  T4: "Social and unreviewed; never supports a claim alone.",
};

export const SUPPORTS_LABEL = {
  direct: "says this directly",
  partial: "supports part of it",
  background: "background",
} as const;
