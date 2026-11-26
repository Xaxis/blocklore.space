// YAML as `pnpm lint` wants it, for every file the brain edits as a YAML document: the jobs that
// carry the owner's edits (brain/src/jobs.ts) and research's links to the threat map
// (brain/src/security/threatlinks.ts).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "./env.ts";

/**
 * YAML as `pnpm lint` wants it. The yaml library breaks long strings differently from biome, so an
 * agenda edit from the admin would otherwise land a file the next lint rejects.
 */
export function formatYaml(text: string, file: string): string {
  const r = spawnSync(
    path.join(ROOT, "node_modules", ".bin", "biome"),
    ["format", `--stdin-file-path=${path.relative(ROOT, file)}`],
    { cwd: ROOT, input: text, encoding: "utf8", timeout: 30_000 },
  );
  if (r.status !== 0) throw new Error(`biome could not format ${path.relative(ROOT, file)}`);
  return r.stdout;
}
