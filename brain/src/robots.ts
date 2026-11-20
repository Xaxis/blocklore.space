// robots.txt, as SOURCES.md promises: the brain reads a host's rules before any page on it, obeys
// the group for BlockloreBot (or "*"), and waits the host's Crawl-delay between requests. APIs
// (api.* hosts and /api/ paths) are services, not pages, and are exempt, as SOURCES.md says.
//
// Matching follows RFC 9309: the longest matching rule wins, Allow wins a tie, "*" matches any run
// of characters and "$" anchors the end.

export interface RobotsRules {
  rules: { allow: boolean; pattern: string }[];
  crawlDelay?: number;
}

const BOT = "blocklorebot";

/** The rules in a robots.txt body that apply to BlockloreBot. */
export function parseRobots(body: string): RobotsRules {
  type Group = { agents: string[]; rules: RobotsRules["rules"]; crawlDelay?: number };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = (m[1] as string).toLowerCase();
    const value = (m[2] as string).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) current.crawlDelay = n;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && BOT.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelay: chosen.find((g) => g.crawlDelay)?.crawlDelay,
  };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${re}${anchored ? "$" : ""}`).test(path);
}

/** Whether BlockloreBot may fetch this path (with its query) under these rules. */
export function allowed(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { allow: boolean; length: number } | null = null;
  for (const r of rules.rules) {
    if (!matches(r.pattern, pathAndQuery)) continue;
    const length = r.pattern.length;
    if (!best || length > best.length || (length === best.length && r.allow))
      best = { allow: r.allow, length };
  }
  return best ? best.allow : true;
}

/** APIs are services, not pages: robots.txt does not govern them. */
export function isApi(u: URL): boolean {
  return u.hostname.startsWith("api.") || u.pathname.startsWith("/api/");
}
