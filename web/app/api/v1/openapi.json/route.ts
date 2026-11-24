import { json } from "@/lib/api";
import { openapi } from "@/lib/openapi";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

/** The public API as OpenAPI 3.1 (web/lib/openapi.ts). */
export function GET() {
  return json(openapi(SITE.url));
}
