// node core/cli.ts validate        check every file in knowledge/; exit 1 on any error
// node core/cli.ts bundle [OUT]    compile knowledge/ to OUT (default web/.generated/bundle.json)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compile } from "./src/bundle.ts";
import { loadStore, REPO_ROOT, storeMoment } from "./src/node/index.ts";

const [cmd, out] = process.argv.slice(2);
const { store, issues: loadIssues } = loadStore();
const { bundle, issues: compileIssues } = compile(store, storeMoment(store));
const issues = [...loadIssues, ...compileIssues];
const errors = issues.filter((i) => i.level === "error");
const warnings = issues.filter((i) => i.level === "warning");

for (const i of [...errors, ...warnings])
  console.error(`${i.level === "error" ? "error" : "warn "}  ${i.file}  ${i.where}: ${i.message}`);

if (cmd === "validate") {
  const s = bundle.stats;
  console.log(
    `knowledge: ${s.claims} claims, ${s.topics} topics, ${bundle.proposals.length} proposals, ${bundle.debates.length} debates, ${bundle.runs.length} runs; ${errors.length} errors, ${warnings.length} warnings`,
  );
  process.exit(errors.length > 0 ? 1 : 0);
} else if (cmd === "bundle") {
  if (errors.length > 0) {
    console.error(`bundle: ${errors.length} errors; not written`);
    process.exit(1);
  }
  const file = path.resolve(out ?? path.join(REPO_ROOT, "web", ".generated", "bundle.json"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(bundle)}\n`);
  console.log(
    `bundle: ${bundle.stats.claims} claims, ${bundle.events.length} events -> ${path.relative(process.cwd(), file)}`,
  );
} else {
  console.error("usage: node core/cli.ts validate | bundle [OUT]");
  process.exit(2);
}
