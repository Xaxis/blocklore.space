import { edition, json, signalingJson } from "@/lib/api";

export const dynamic = "force-static";

/** The version bits blocks set this difficulty period and the last (API.md, "Version bits"). */
export function GET() {
  return json({ edition: edition(), signaling: signalingJson() });
}
