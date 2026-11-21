"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";
import { ViewTabs } from "./SiteNav";

/**
 * The panel every view renders into, beside the scene. It scrolls on its own on a desk, so it
 * starts each view at the top; the admin gets the whole width instead.
 */
export function Panel({ children, foot }: { children: ReactNode; foot: ReactNode }) {
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new path is the trigger
  useEffect(() => {
    const el = ref.current;
    if (el && !window.location.hash) el.scrollTop = 0;
  }, [path]);
  if (path.startsWith("/admin"))
    return (
      <main id="main" className="admin-frame">
        {children}
      </main>
    );
  return (
    <main id="main" className="dock" ref={ref}>
      <ViewTabs />
      {/* keyed by path so each view enters with the camera's move, not before or after it */}
      <div className="dock-body" key={path}>
        {children}
      </div>
      <footer className="dock-foot">{foot}</footer>
    </main>
  );
}
