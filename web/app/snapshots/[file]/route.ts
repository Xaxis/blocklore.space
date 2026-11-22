import { readFileSync } from "node:fs";
import path from "node:path";
import { bundle } from "@/lib/data";

// The snapshot files exactly as committed: a proof and a stamp commit to the manifest's bytes, so
// they are served unchanged, never re-encoded from the bundle.

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return bundle.snapshots.flatMap((s) => [
    { file: s.file },
    ...(s.proof ? [{ file: s.proof.file }] : []),
    ...(s.signature ? [{ file: s.signature.file }] : []),
  ]);
}

export async function GET(_req: Request, ctx: RouteContext<"/snapshots/[file]">) {
  const { file } = await ctx.params;
  const bytes = readFileSync(path.join(process.cwd(), "..", "knowledge", "snapshots", file));
  const proof = file.endsWith(".ots");
  const stamp = file.endsWith(".stamp");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": proof
        ? "application/vnd.opentimestamps.v1"
        : stamp
          ? "application/vnd.oc-stamp+json"
          : "application/json; charset=utf-8",
      "Content-Disposition": `${proof ? "attachment" : "inline"}; filename="blocklore-snapshot-${file}"`,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}
