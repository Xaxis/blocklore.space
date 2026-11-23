import { bundle } from "@/lib/data";
import { height } from "@/lib/format";

// Badges for the README and anyone citing Blocklore: each states one number the edition this build
// serves can prove; the README links each to the page that proves it. Blocklore serves them itself,
// so a reader's browser never asks a third party for them.

export type Tone = "pass" | "fail" | "info";

export interface Badge {
  label: string;
  message: string;
  tone: Tone;
}

const pass = (ok: boolean): Tone => (ok ? "pass" : "fail");

export const BADGES: Record<string, () => Badge | null> = {
  claims: () => ({
    label: "claims",
    message: `${bundle.stats.claims} cited and checked`,
    tone: "info",
  }),
  lab: () => {
    const runs = bundle.security.labReleases;
    if (!runs.length) return null;
    const tests = runs.flatMap((r) => r.tests);
    const ok = tests.filter((t) => t.ok).length;
    const verified = runs.every((r) => r.verified.sha256);
    return {
      label: "release lab",
      message: `${ok} of ${tests.length} passed${verified ? "" : ", not verified"}`,
      tone: pass(ok === tests.length && verified),
    };
  },
  evaluator: () => {
    const c = bundle.evaluator?.canaries;
    if (!c?.recent) return null;
    return {
      label: "evaluator",
      message: `caught ${c.recentCaught} of ${c.recent} planted errors`,
      tone: pass(c.recentCaught === c.recent && !bundle.evaluator?.paused),
    };
  },
  sealed: () => {
    const s = [...bundle.snapshots].sort((a, b) => b.n - a.n)[0];
    if (!s) return null;
    return {
      label: "sealed in Bitcoin",
      message: `edition ${s.n}, block ${height(s.at.height)}`,
      tone: "info",
    };
  },
};

const COLOR: Record<Tone, string> = { pass: "#1a7f37", fail: "#cf222e", info: "#24292f" };
// A monospace face, so a width is a count of characters and needs no font metrics.
const CHAR = 6.6;
const PAD = 8;

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A flat two-part badge, 20 px high, readable by a screen reader through its title. */
export function badgeSvg(b: Badge): string {
  const lw = Math.round(b.label.length * CHAR + 2 * PAD);
  const mw = Math.round(b.message.length * CHAR + 2 * PAD);
  const w = lw + mw;
  const title = esc(`${b.label}: ${b.message}`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    `<rect width="${lw}" height="20" fill="#57606a"/>`,
    `<rect x="${lw}" width="${mw}" height="20" fill="${COLOR[b.tone]}"/>`,
    `<g fill="#fff" font-family="DejaVu Sans Mono,Menlo,Consolas,monospace" font-size="11">`,
    `<text x="${PAD}" y="14">${esc(b.label)}</text>`,
    `<text x="${lw + PAD}" y="14">${esc(b.message)}</text>`,
    "</g></svg>",
  ].join("");
}
