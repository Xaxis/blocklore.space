import type { MetadataRoute } from "next";
import { allClaims, bundle, digests } from "@/lib/data";
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
    page("/digest"),
    page("/ask"),
    page("/queue"),
    page("/scorecard"),
    page("/verify"),
    page("/about"),
    ...Object.keys(DOCS).map((d) => page(`/about/${d}`)),
    ...bundle.topics.map((t) => page(`/topics/${t.slug}`, t.updated.time)),
    ...allClaims().map((c) =>
      page(`/claims/${c.id}`, c.revisions[c.revisions.length - 1]?.at.time ?? at),
    ),
    ...bundle.runs.map((r) => page(`/log/${r.id}`, r.finished.time)),
    ...digests().map((d) => page(`/digest/${d.date}`)),
  ];
}
