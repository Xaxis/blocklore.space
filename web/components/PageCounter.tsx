"use client";

import { useEffect } from "react";

/**
 * Overlook's cookieless page counts, loaded only when the page is served from the origin's own
 * host. A mirror builds this same code, and its readers are its own: counted under the origin's
 * site id they would inflate the origin's numbers.
 */
export function PageCounter({ site, host }: { site: string; host: string }) {
  useEffect(() => {
    if (window.location.hostname !== host) return;
    if (document.querySelector("script[data-page-counter]")) return;
    const s = document.createElement("script");
    s.src = "https://overlook.technology/s.js";
    s.async = true;
    s.dataset.site = site;
    s.dataset.pageCounter = "";
    document.body.appendChild(s);
  }, [site, host]);
  return null;
}
