// The house style's one hard rule, enforced over everything we write: no em dash (U+2014), en dash
// (U+2013) or horizontal bar (U+2015). EDITORIAL.md, "Style rules a linter enforces".
//
//   node tools/style.ts            check every tracked and new file
//   node tools/style.ts FILE...    check these files
//
// Claim files are checked by `node core/cli.ts validate`, which knows that a source's quote keeps
// its original punctuation; they are skipped here.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0x2015)}]`);
const SKIP = [/^pnpm-lock\.yaml$/, /^knowledge\/claims\//, /\.(png|ico|jpg|jpeg|webp|woff2?|ots|pdf)$/];

const files =
  process.argv.length > 2
    ? process.argv.slice(2).map((f) => path.relative(root, path.resolve(f)))
    : execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
        cwd: root,
        encoding: "utf8",
      })
        .split("\n")
        .filter(Boolean);

let bad = 0;
for (const file of files) {
  if (SKIP.some((re) => re.test(file))) continue;
  let text: string;
  try {
    text = readFileSync(path.join(root, file), "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (DASHES.test(line)) {
      bad++;
      const col = line.search(DASHES) + 1;
      console.error(`${file}:${i + 1}:${col}: dash: ${line.trim().slice(0, 120)}`);
    }
  }
}
if (bad > 0) {
  console.error(`style: ${bad} line(s) with an em dash, en dash or horizontal bar (EDITORIAL.md)`);
  process.exit(1);
}
console.log(`style ok: ${files.length} files, no dashes`);
