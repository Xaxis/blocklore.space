import { readFileSync } from "node:fs";
import path from "node:path";
import { envelopeFile } from "@blocklore/core";
import { bundle } from "@/lib/data";

// The owner's signed records exactly as committed under knowledge/orangecheck/, for OrangeCheck's
// own command line tools, plus every revocation in one array (oc-agent verify --revocations).

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  const r = bundle.orangecheck;
  return [
    ...r.attestations.map((a) => ["attestations", `${a.attestation_id}.json`]),
    ...r.delegations.map((d) => ["delegations", `${d.id}.json`]),
    ...r.revocations.map((v) => ["revocations", `${v.id}.json`]),
    ["revocations.json"],
  ].map((p) => ({ path: p }));
}

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
};

export async function GET(_req: Request, ctx: RouteContext<"/orangecheck/[...path]">) {
  const { path: parts } = await ctx.params;
  if (parts.length === 1 && parts[0] === "revocations.json") {
    const all = bundle.orangecheck.revocations.map((v) => JSON.parse(envelopeFile(v)));
    return new Response(`${JSON.stringify(all, null, 2)}\n`, { headers });
  }
  const [kind, file] = parts;
  const bytes = readFileSync(
    path.join(process.cwd(), "..", "knowledge", "orangecheck", kind ?? "", file ?? ""),
  );
  return new Response(new Uint8Array(bytes), { headers });
}
