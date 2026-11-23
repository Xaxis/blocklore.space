import { bundle } from "@/lib/data";
import { SITE } from "@/lib/site";

// Where to report a security problem (RFC 9116). The policy is SECURITY.md; reports go through
// GitHub's private vulnerability reporting, never a public issue. Expires is counted from the
// edition this build serves, so a deploy keeps it current without anyone editing a date.

export const dynamic = "force-static";

const VALID_DAYS = 180;

export function GET() {
  const expires = new Date(Date.parse(bundle.generated.time) + VALID_DAYS * 86_400_000);
  const text = [
    `Contact: ${SITE.repo}/security/advisories/new`,
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    `Policy: ${SITE.repo}/blob/main/SECURITY.md`,
    "Preferred-Languages: en",
    `Canonical: ${SITE.url}/.well-known/security.txt`,
    "",
  ].join("\n");
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
