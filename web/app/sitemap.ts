import { progressMonths } from "@blocklore/core";
import type { MetadataRoute } from "next";
import { bipNumbers } from "@/lib/bips";
import { allClaims, bundle, digests, progressInput } from "@/lib/data";
import { DOCS } from "@/lib/docs";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const at = bundle.generated.time;
  const page = (path: string, lastModified = at) => ({ url: `${SITE.url}${path}`, lastModified });
  return [
    page(""),
    page("/topics"),
    page("/changes"),
    page("/changes/corrections"),
    page("/log"),
    page("/pulse"),
    page("/proposals"),
    page("/bips"),
    ...bipNumbers().map((n) => page(`/proposals/${n}`)),
    page("/digest"),
    page("/progress"),
    page("/gaps"),
    page("/connect"),
    page("/verify"),
    page("/verify/keys"),
    page("/verify/evaluator"),
    page("/security"),
    ...bundle.security.layers.flatMap((l) => l.threats.map((t) => page(`/security/${t.id}`))),
    page("/about"),
    ...Object.keys(DOCS).map((d) => page(`/about/${d}`)),
    ...bundle.topics.map((t) => page(`/topics/${t.slug}`, t.updated.time)),
    ...allClaims().map((c) =>
      page(`/claims/${c.id}`, c.revisions[c.revisions.length - 1]?.at.time ?? at),
    ),
    ...bundle.runs.map((r) => page(`/log/${r.id}`, r.finished.time)),
    ...digests().map((d) => page(`/digest/${d.date}`)),
    ...progressMonths(progressInput()).map((m) => page(`/progress/${m}`)),
  ];
}
