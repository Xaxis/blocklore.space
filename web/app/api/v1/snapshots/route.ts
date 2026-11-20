import { edition, json } from "@/lib/api";
import { bundle } from "@/lib/data";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

/** Every snapshot, newest first, with what its proof says and where its files are. */
export function GET() {
  return json({
    edition: edition(),
    how_to_verify: `${SITE.url}/verify`,
    snapshots: bundle.snapshots.map((s) => ({
      ...s,
      file: `${SITE.url}/snapshots/${s.file}`,
      proof: s.proof && { ...s.proof, file: `${SITE.url}/snapshots/${s.proof.file}` },
    })),
  });
}
