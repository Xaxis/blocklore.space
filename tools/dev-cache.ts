// Turbopack's dev cache (web/.next/dev) goes stale when `pnpm install` moves Next's folder; next dev
// then reloads every page in a loop ("Compiled" before each request) and no browser check can sign
// in. `pnpm dev` runs this first: when the install is not the one the cache was built against, it
// drops the cache, so the next start compiles cold instead of looping.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const cache = path.join(root, "web/.next/dev");
const stamp = path.join(root, "web/.next/dev-deps.txt");
const installed = path.join(root, "node_modules/.modules.yaml");

const now = existsSync(installed) ? String(statSync(installed).mtimeMs) : "none";
const was = existsSync(stamp) ? readFileSync(stamp, "utf8") : null;
if (was !== now && existsSync(cache)) {
  rmSync(cache, { recursive: true, force: true });
  console.log("dev: dependencies changed since the dev cache was built; cleared web/.next/dev");
}
mkdirSync(path.dirname(stamp), { recursive: true });
writeFileSync(stamp, now);
