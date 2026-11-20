import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Blocklore",
    short_name: "Blocklore",
    description: SITE.promise,
    start_url: "/",
    display: "browser",
    background_color: "#f6f3ec",
    theme_color: "#f6f3ec",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };
}
