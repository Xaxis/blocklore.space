// EDITORIAL.md's mechanical rules. Quotes from sources keep their own punctuation and are never
// passed here; everything Blocklore writes is.

const DASH_CHARS = [0x2013, 0x2014, 0x2015].map((c) => String.fromCharCode(c)).join("");
const DASH = new RegExp(`[${DASH_CHARS}]`);
const DASH_ALL = new RegExp(`[${DASH_CHARS}]`, "g");
const RANGE = new RegExp(`(\\d)\\s*[${DASH_CHARS}]\\s*(\\d)`, "g");
const SPACED = new RegExp(`\\s*[${DASH_CHARS}]\\s*`, "g");

export function hasDash(text: string): boolean {
  return DASH.test(text);
}

/**
 * Rewrites dashes in generated text: a numeric range becomes "2 to 4", any other dash a comma.
 * Used on model output before it is checked and stored; never on a source's quote.
 */
export function undash(text: string): string {
  return text.replace(RANGE, "$1 to $2").replace(SPACED, ", ").replace(DASH_ALL, ", ");
}

const BANNED: Array<[RegExp, string]> = [
  [/\bsimply\b/i, "simply"],
  [/\bjust\b/i, "just"],
  [/\bobviously\b/i, "obviously"],
  [/\bof course\b/i, "of course"],
  [/\bclearly\b/i, "clearly"],
  [/\bto the moon\b|\bmooning\b/i, "moon"],
  [/\bnumber go up\b/i, "number go up"],
  [/\bgame[- ]chang/i, "game-changing"],
  [/\brevolutionary\b/i, "revolutionary"],
];

/** Style problems in a sentence Blocklore writes: dashes, banned words, exclamation marks. */
export function styleIssues(text: string): string[] {
  const out: string[] = [];
  if (hasDash(text)) out.push("contains an em dash, en dash or horizontal bar");
  for (const [re, word] of BANNED) if (re.test(text)) out.push(`uses "${word}"`);
  if (text.includes("!")) out.push("uses an exclamation mark");
  return out;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Undated time words that EDITORIAL.md asks to anchor with a height or date. */
export function undatedTimeWords(text: string): string[] {
  const words = text.match(/\b(currently|recently|nowadays|these days|today)\b/gi) ?? [];
  const anchored = /\b(as of|since|block \d|\d{4})\b/i.test(text);
  return anchored ? [] : words.map((w) => w.toLowerCase());
}
