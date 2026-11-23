/**
 * Keeps the OpenAPI description (web/lib/openapi.ts) in step with the API: every route under
 * web/app/api/v1 and each method it exports must be in the description, or be one of its INTERNAL
 * routes, and the description may name no route that does not exist. Every {param} in a path must be
 * a required path parameter of each of its operations. Part of `pnpm lint`.
 *
 *   node tools/openapi-check.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { INTERNAL, openapi } from "../web/lib/openapi.ts";

const API = path.join(import.meta.dirname, "..", "web", "app", "api", "v1");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Each route file's URL path, in OpenAPI's {param} form, with the HTTP methods it exports. */
function routes(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of readdirSync(API, { recursive: true }).map(String)) {
    if (path.basename(f) !== "route.ts") continue;
    const dir = path.dirname(f) === "." ? "" : `/${path.dirname(f).split(path.sep).join("/")}`;
    const url = `/api/v1${dir}`.replace(/\[([^\]]+)\]/g, "{$1}");
    const src = readFileSync(path.join(API, f), "utf8");
    const methods = METHODS.filter((m) =>
      new RegExp(`export (async )?function ${m}\\b|export const ${m}\\b`).test(src),
    );
    out.set(url, methods);
  }
  return out;
}

type Op = { parameters?: { name: string; in: string; required?: boolean }[] };
const spec = openapi("https://example.invalid");
const paths = spec.paths as Record<string, Record<string, Op>>;
const problems: string[] = [];

const found = routes();
for (const [url, methods] of found) {
  if (INTERNAL.includes(url)) continue;
  const entry = paths[url];
  if (!entry) {
    problems.push(
      `${url} is a route but not in web/lib/openapi.ts (add it, or list it in INTERNAL)`,
    );
    continue;
  }
  for (const m of methods)
    if (!entry[m.toLowerCase()]) problems.push(`${m} ${url} is exported but not described`);
  for (const m of Object.keys(entry))
    if (!methods.includes(m.toUpperCase() as (typeof METHODS)[number]))
      problems.push(`${m.toUpperCase()} ${url} is described but the route does not export it`);
}
for (const url of Object.keys(paths))
  if (!found.has(url)) problems.push(`${url} is described but no route serves it`);
for (const url of INTERNAL)
  if (!found.has(url)) problems.push(`${url} is listed as internal but no route serves it`);

for (const [url, entry] of Object.entries(paths))
  for (const name of [...url.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string))
    for (const [m, op] of Object.entries(entry))
      if (!op.parameters?.some((p) => p.name === name && p.in === "path" && p.required))
        problems.push(`${m.toUpperCase()} ${url} does not declare its path parameter ${name}`);

for (const p of problems) console.error(`openapi: ${p}`);
console.log(
  problems.length
    ? `openapi: ${problems.length} problems`
    : `openapi ok: ${Object.keys(paths).length} paths match the routes, ${INTERNAL.length} internal`,
);
process.exit(problems.length ? 1 : 0);
