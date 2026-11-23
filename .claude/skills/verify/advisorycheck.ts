// Drives the advisories (BACKLOG 36) and the NVD check (38) on a running site against the bundle
// it was compiled from, and fails on the first page that disagrees:
//   - every threat with advisories lists each one on /security/<id>, with the words of any match
//     made by words quoted in <q>, and every threat with CVE ids shows its NVD check with one
//     "For the owner" line per finding;
//   - /gaps lists every advisory no rule files, and /api/v1/gaps carries the same list;
//   - /security counts what was read, filed and left to map.
//
//   node .claude/skills/verify/advisorycheck.ts [base]     base defaults to http://localhost:3721
import { readFileSync } from "node:fs";
import path from "node:path";

const base = (process.argv[2] ?? "http://localhost:3721").replace(/\/$/, "");
const root = path.join(import.meta.dirname, "../../..");

interface Advisory {
  title: string;
  url: string;
  rule?: string;
  by?: string[];
}
interface Cve {
  id: string;
  finding: string | null;
  nvd: { state: string };
}
interface Threat {
  id: string;
  advisories: Advisory[];
  cves: Cve[];
}
const bundle = JSON.parse(readFileSync(path.join(root, "web/.generated/bundle.json"), "utf8"));
const threats: Threat[] = bundle.security.layers.flatMap((l: { threats: Threat[] }) => l.threats);
const report = bundle.security.advisories as {
  counts: Record<string, number>;
  unmatched: Advisory[];
};

function check(cond: unknown, what: string): void {
  if (!cond) {
    console.error(`advisorycheck FAILED: ${what}`);
    process.exit(1);
  }
  console.log(`  ok  ${what}`);
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

/** The page as a reader sees it: the server-rendered HTML without the scripts that rehydrate it. */
async function page(p: string): Promise<string> {
  const res = await fetch(base + p, { headers: { "X-Blocklore-Check": "1" } });
  check(res.status === 200, `${p} answers 200`);
  return (await res.text()).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!-- -->/g, "");
}

const count = (html: string, s: string) => html.split(s).length - 1;

let shown = 0;
for (const t of threats.filter((x) => x.advisories.length || x.cves.length)) {
  const html = await page(`/security/${t.id}`);
  for (const a of t.advisories) {
    check(html.includes(escape(a.title)), `${t.id} lists "${a.title}" (${a.rule})`);
    if (a.rule === "term" || a.rule === "keyword")
      for (const w of a.by ?? [])
        check(new RegExp(`<q[^>]*>${escape(w)}</q>`).test(html), `${t.id} quotes the matched words "${w}"`);
    shown++;
  }
  if (t.cves.length) {
    check(html.includes('id="nvd"'), `${t.id} has its NVD check`);
    for (const c of t.cves) check(html.includes(`>${c.id}</a>`), `${t.id} shows ${c.id} (${c.nvd.state})`);
    const findings = t.cves.filter((c) => c.finding).length;
    check(
      count(html, "For the owner:") === findings,
      `${t.id} shows ${findings} NVD finding(s) for the owner`,
    );
  }
}

const gaps = await page("/gaps");
const block = gaps.slice(gaps.indexOf('id="advisories"'));
for (const a of report.unmatched) check(block.includes(escape(a.title)), `/gaps lists "${a.title}"`);
const api = await (await fetch(`${base}/api/v1/gaps`, { headers: { "X-Blocklore-Check": "1" } })).json();
check(
  api.gaps.advisories.length === report.unmatched.length,
  `/api/v1/gaps carries the ${report.unmatched.length} advisories to map`,
);
const index = await page("/security");
const c = report.counts;
check(
  index.includes(`${c.advisories} read, ${c.matched} filed under a threat`),
  `/security says ${c.advisories} read, ${c.matched} filed`,
);
console.log(
  `advisorycheck passed against ${base}: ${shown} advisory rows on threat pages, ${report.unmatched.length} to map, NVD ${c.checked} of ${c.cves} checked, ${c.found} found, ${c.mismatched} mismatched`,
);
