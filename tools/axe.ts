/**
 * Accessibility check of the running site with axe-core (WCAG 2.0, 2.1 and 2.2 A and AA rules plus
 * axe's best practices) and a reflow check (no sideways scrolling), at desktop and phone widths, in
 * light and dark. Chromium on SwiftShader,
 * never the box's GPU. Run under ~/.claude/claude-core/bin/heavy.
 *
 *   node tools/axe.ts [BASE_URL] [PATH...]
 *
 * With no paths it checks one page of every kind and every doc under /about. Exits 1 on any violation and prints each with
 * the selectors it hit.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

type Violation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[] }[];
};

const args = process.argv.slice(2);
const base = args[0]?.startsWith("http") ? args[0] : "http://localhost:3721";
const given = args[0]?.startsWith("http") ? args.slice(1) : args;

async function defaults(): Promise<string[]> {
  const claims = (await (await fetch(`${base}/api/v1/claims`)).json()) as {
    claims: { id: string }[];
  };
  const topics = (await (await fetch(`${base}/api/v1/topics`)).json()) as {
    topics: { slug: string }[];
  };
  // Every rendered doc, from the sitemap, so a new one is checked without editing this list.
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  const docs = [
    ...new Set(
      [...sitemap.matchAll(/<loc>[^<]*?(\/about\/[a-z-]+)<\/loc>/g)].map((m) => m[1] ?? ""),
    ),
  ];
  return [
    "/",
    // Every topic: one long word in one claim is enough to break a phone layout.
    ...topics.topics.map((t) => `/topics/${t.slug}`),
    `/claims/${claims.claims[0]?.id}`,
    "/connect",
    "/gaps",
    "/pulse",
    "/proposals",
    "/bips",
    "/changes",
    "/changes/corrections",
    "/log",
    "/digest",
    "/verify",
    "/about",
    ...docs,
    "/not-a-page",
  ];
}

const source = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const paths = given.length ? given : await defaults();
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
let failed = 0;
try {
  for (const p of paths)
    for (const size of [
      { name: "desk", width: 1280, height: 900 },
      { name: "phone", width: 390, height: 844 },
    ])
      for (const scheme of ["light", "dark"] as const) {
        const page = await browser.newPage({ viewport: size });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto(base + p, { waitUntil: "networkidle" });
        await page.addScriptTag({ content: source });
        const violations = (await page.evaluate(async () => {
          // biome-ignore lint/suspicious/noExplicitAny: axe is injected as a page global
          const axe = (globalThis as any).axe;
          const r = await axe.run(document, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
            },
          });
          return r.violations;
        })) as Violation[];
        // Not an axe rule, but the same reader harm at phone width: the page scrolls sideways
        // (WCAG 1.4.10 reflow). A long word in a 1fr grid column is the usual cause.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 0)
          violations.push({
            id: "page-overflow",
            impact: "serious",
            help: `the page is ${overflow}px wider than the viewport and scrolls sideways`,
            nodes: [],
          });
        await page.close();
        const label = `${p} ${size.name} ${scheme}`;
        if (!violations.length) {
          console.log(`  ok  ${label}`);
          continue;
        }
        failed++;
        console.log(`FAIL  ${label}`);
        for (const v of violations)
          console.log(
            `      ${v.impact ?? "?"} ${v.id}: ${v.help}\n        ${v.nodes
              .slice(0, 4)
              .map((n) => n.target.join(" "))
              .join(
                "\n        ",
              )}${v.nodes.length > 4 ? `\n        (${v.nodes.length - 4} more)` : ""}`,
          );
      }
} finally {
  await browser.close();
}
console.log(
  failed
    ? `axe: ${failed} of ${paths.length * 4} views have violations`
    : `axe ok: ${paths.length} pages, 4 views each, no violations`,
);
process.exitCode = failed ? 1 : 0;
