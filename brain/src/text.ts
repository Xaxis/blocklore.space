// Turning fetched bytes into the text a reader sees, and only that (SECURITY.md, T1): scripts,
// styles, comments, hidden elements and zero-width or bidi control characters are removed and
// counted before any model or quote check reads a page.
import { type DefaultTreeAdapterMap, parse } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export interface CleanText {
  text: string;
  removed: { hiddenElements: number; comments: number; invisibleChars: number };
}

const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "svg",
  "head",
  "canvas",
]);
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "br",
  "li",
  "ul",
  "ol",
  "tr",
  "td",
  "th",
  "table",
  "pre",
  "blockquote",
  "section",
  "article",
  "header",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "dd",
  "dt",
  "dl",
  "hr",
  "main",
  "aside",
  "nav",
  "figure",
  "figcaption",
]);
const HIDDEN_STYLE =
  /(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d])|opacity\s*:\s*0(?![.\d])|(?:^|;)\s*(?:width|height)\s*:\s*0(?:px)?\s*(?:;|$)|left\s*:\s*-\d{3,}px|text-indent\s*:\s*-\d{3,})/i;
const HIDDEN_CLASS = /\b(sr-only|visually-hidden|screen-reader-text)\b/;

// Zero-width, joiners, bidi embeddings and isolates, word joiner and invisible operators, BOM.
const INVISIBLE = new RegExp(
  `[${[
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2060, 0x2064],
    [0x2066, 0x2069],
    [0xfeff, 0xfeff],
    [0x00ad, 0x00ad],
  ]
    .map(([a, b]) => `${String.fromCharCode(a as number)}-${String.fromCharCode(b as number)}`)
    .join("")}]`,
  "g",
);

function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

function isHidden(el: Element): boolean {
  if (attr(el, "hidden") !== undefined) return true;
  if (attr(el, "aria-hidden") === "true") return true;
  const style = attr(el, "style");
  if (style && HIDDEN_STYLE.test(style)) return true;
  const cls = attr(el, "class");
  if (cls && HIDDEN_CLASS.test(cls)) return true;
  if (el.tagName === "input" && attr(el, "type") === "hidden") return true;
  return false;
}

export function htmlToText(html: string): CleanText {
  const removed = { hiddenElements: 0, comments: 0, invisibleChars: 0 };
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeName === "#comment") {
      removed.comments++;
      return;
    }
    if (node.nodeName === "#text") {
      parts.push((node as DefaultTreeAdapterMap["textNode"]).value);
      return;
    }
    if ("tagName" in node) {
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName)) return;
      if (isHidden(el)) {
        removed.hiddenElements++;
        return;
      }
      const block = BLOCK_TAGS.has(el.tagName);
      if (block) parts.push("\n");
      for (const child of el.childNodes) walk(child);
      if (el.tagName === "template") return;
      if (block) parts.push("\n");
      return;
    }
    if ("childNodes" in node) for (const child of (node as Element).childNodes) walk(child);
  };
  walk(parse(html) as unknown as Node);
  const raw = parts.join("");
  const text = stripInvisible(raw, removed);
  return {
    text: text
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim(),
    removed,
  };
}

export function stripInvisible(text: string, removed?: CleanText["removed"]): string {
  return text.replace(INVISIBLE, () => {
    if (removed) removed.invisibleChars++;
    return "";
  });
}

const fc = (...codes: number[]) => codes.map((c) => String.fromCharCode(c)).join("");
const SINGLE_QUOTES = new RegExp(`[${fc(0x2018, 0x2019, 0x201a, 0x201b, 0x2032)}]`, "g");
const DOUBLE_QUOTES = new RegExp(`[${fc(0x201c, 0x201d, 0x201e, 0x201f, 0x2033)}]`, "g");
const DASHES = new RegExp(`[${fc(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212)}]`, "g");
const ELLIPSIS = new RegExp(fc(0x2026), "g");
const NBSP = new RegExp(`[${fc(0x00a0, 0x2007, 0x202f)}]`, "g");

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * The form both a quote and a page are reduced to before matching: Unicode compatibility form,
 * straight quotes, plain hyphens, no markup emphasis or link syntax, lower case, single spaces.
 * The same function runs on both sides, so it can only make a real quote findable, never make a
 * missing one appear.
 */
export function normalizeForMatch(s: string): string {
  return stripInvisible(s.normalize("NFKC"))
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e.startsWith("#x")) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(Number.parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(ELLIPSIS, "...")
    .replace(NBSP, " ")
    .replace(/<\/?(code|tt|b|i|em|strong|sup|sub|span|a|var|kbd)\b[^>]*>/gi, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1") // [[Page|text]]
    .replace(/\[(https?:\/\/\S+)\s+([^\]]+)\]/g, "$2") // [url text]
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1") // [text](url)
    .replace(/'{2,}|\*\*|__|`/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface QuoteMatch {
  found: boolean;
  /** When not found: the share of the quote's words found in order in the best window, 0 to 1. */
  closeness: number;
  /** When not found: the page's closest passage, for the repair report. */
  nearest?: string;
}

export function findQuote(page: string, quote: string): QuoteMatch {
  const p = normalizeForMatch(page);
  const q = normalizeForMatch(quote).replace(/^["']|["']$/g, "");
  if (q.length === 0) return { found: false, closeness: 0 };
  if (p.includes(q)) return { found: true, closeness: 1 };
  // A ranked hint: the window of the page that shares the most of the quote's words in order.
  const qw = q.split(" ");
  const pw = p.split(" ");
  let best = 0;
  let bestAt = 0;
  for (let i = 0; i + 1 < pw.length; i++) {
    if (pw[i] !== qw[0] && pw[i] !== qw[1]) continue;
    let hits = 0;
    let j = i;
    for (const w of qw) {
      const at = pw.indexOf(w, j);
      if (at >= 0 && at - j < 4) {
        hits++;
        j = at + 1;
      }
    }
    if (hits > best) {
      best = hits;
      bestAt = i;
    }
  }
  return {
    found: false,
    closeness: best / qw.length,
    nearest: best > 0 ? pw.slice(bestAt, bestAt + qw.length + 4).join(" ") : undefined,
  };
}

const INJECTION = [
  /ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|prompts|rules)/i,
  /disregard (?:all |any |the |your )?(?:previous |prior )?(?:instructions|rules|guidelines)/i,
  /\byou are (?:now )?(?:an? |the )?(?:ai|assistant|language model|llm|chatbot)\b/i,
  /\b(?:system|developer) prompt\b/i,
  /^\s*(?:system|assistant)\s*:/im,
  /<\|im_start\|>|\[INST\]|<<SYS>>/i,
  /\b(?:note|message|instructions?) (?:to|for) (?:the )?(?:ai|llm|language model|assistant|claude|chatgpt|gpt)\b/i,
];

/** Excerpts of text that look addressed to a model rather than a reader, for the run log. */
export function suspectedInjections(text: string): string[] {
  const out: string[] = [];
  for (const re of INJECTION) {
    const m = re.exec(text);
    if (m) {
      const start = Math.max(0, m.index - 60);
      out.push(
        text
          .slice(start, m.index + m[0].length + 100)
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
  }
  return out;
}
