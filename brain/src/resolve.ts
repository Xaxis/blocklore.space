// LocatorResolver (ARCHITECTURE.md, Interfaces): the readable text behind a source URL, read the
// way CLAIMS.md's source table says, so a quote check compares against what the author wrote.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Fetched, get } from "./http.ts";
import { type CleanText, htmlToText, stripInvisible } from "./text.ts";

export interface Resolved {
  ok: boolean;
  url: string;
  /** What was actually read (an API or raw URL), for the record. */
  read: string;
  status: number;
  text: string;
  /** Line-numbered text for git files, to check #L anchors. */
  lines?: string[];
  removed?: CleanText["removed"];
  error?: string;
}

const GH_BLOB = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([0-9a-f]{40})\/([^#?]+)/;
const GH_COMMIT = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{40})/;
const GH_ISSUE =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)(?:\/[a-z]+)?\/?(?:#(.+))?$/;
const GH_RELEASE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^#?]+)/;
const DELVING = /^https:\/\/delvingbitcoin\.org\/t\/(?:[^/]+\/)?(\d+)(?:\/(\d+))?/;
const SE =
  /^https:\/\/bitcoin\.stackexchange\.com\/(?:a\/(\d+)|q\/(\d+)|questions\/(\d+)(?:\/[^/#?]*)?(?:\/(\d+))?)/;

function fail(url: string, read: string, r: Fetched | null, error: string): Resolved {
  return { ok: false, url, read, status: r?.status ?? 0, text: "", error };
}

async function viaApi(
  url: string,
  api: string,
  pick: (j: Record<string, unknown>) => string,
): Promise<Resolved> {
  const r = await get(api, { accept: "application/vnd.github+json", maxAge: 30 * 86400 });
  if (r.status === 403 || r.status === 429) {
    // Out of API quota: read the page people see instead.
    const page = await get(url.split("#")[0] as string, { maxAge: 7 * 86400 });
    if (page.status !== 200) return fail(url, url, page, `HTTP ${page.status} (API ${r.status})`);
    const c = htmlToText(page.body);
    return { ok: true, url, read: page.finalUrl, status: 200, text: c.text, removed: c.removed };
  }
  if (r.status !== 200) return fail(url, api, r, `HTTP ${r.status}`);
  const j = JSON.parse(r.body) as Record<string, unknown>;
  return { ok: true, url, read: api, status: 200, text: stripInvisible(pick(j)) };
}

function decodeBody(r: Fetched): { text: string; removed?: CleanText["removed"] } {
  if (/html/.test(r.contentType) || /^\s*<!doctype html|^\s*<html/i.test(r.body)) {
    const c = htmlToText(r.body);
    return { text: c.text, removed: c.removed };
  }
  return { text: stripInvisible(r.body) };
}

function pdfText(base64: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "blocklore-pdf-"));
  try {
    const file = path.join(dir, "doc.pdf");
    writeFileSync(file, Buffer.from(base64, "base64"));
    return execFileSync("pdftotext", ["-layout", file, "-"], {
      encoding: "utf8",
      maxBuffer: 64 << 20,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function resolveLocator(url: string): Promise<Resolved> {
  let m = GH_BLOB.exec(url);
  if (m) {
    const [, org, repo, sha, file] = m;
    const raw = `https://raw.githubusercontent.com/${org}/${repo}/${sha}/${decodeURIComponent(file as string)}`;
    const r = await get(raw, { maxAge: 365 * 86400 }); // a file at a commit never changes
    if (r.status !== 200) return fail(url, raw, r, `HTTP ${r.status}`);
    const text = stripInvisible(r.body);
    return { ok: true, url, read: raw, status: 200, text, lines: text.split("\n") };
  }
  m = GH_COMMIT.exec(url);
  if (m) {
    const [, org, repo, sha] = m;
    return viaApi(url, `https://api.github.com/repos/${org}/${repo}/commits/${sha}`, (j) => {
      const commit = j.commit as { message: string; author?: { date?: string } };
      const files = (j.files as { filename: string; patch?: string }[] | undefined) ?? [];
      return [commit.message, ...files.map((f) => `${f.filename}\n${f.patch ?? ""}`)].join("\n\n");
    });
  }
  m = GH_ISSUE.exec(url);
  if (m) {
    const [, org, repo, , num, anchor] = m;
    const base = `https://api.github.com/repos/${org}/${repo}`;
    const issue = await viaApi(url, `${base}/issues/${num}`, (j) =>
      [
        j.title,
        j.body ?? "",
        j.pull_request
          ? `merged_at: ${(j.pull_request as { merged_at?: string }).merged_at ?? "not merged"}`
          : "",
      ].join("\n\n"),
    );
    if (!issue.ok || !anchor) return issue;
    let api = "";
    let a = /^issuecomment-(\d+)$/.exec(anchor);
    if (a) api = `${base}/issues/comments/${a[1]}`;
    a = /^discussion_r(\d+)$/.exec(anchor);
    if (a) api = `${base}/pulls/comments/${a[1]}`;
    a = /^pullrequestreview-(\d+)$/.exec(anchor);
    if (a) api = `${base}/pulls/${num}/reviews/${a[1]}`;
    if (!api) return issue;
    const c = await viaApi(url, api, (j) => String(j.body ?? ""));
    return c.ok ? { ...c, text: `${issue.text}\n\n${c.text}` } : c;
  }
  m = GH_RELEASE.exec(url);
  if (m) {
    const [, org, repo, tag] = m;
    return viaApi(
      url,
      `https://api.github.com/repos/${org}/${repo}/releases/tags/${tag}`,
      (j) => `${j.name ?? ""}\n\n${j.body ?? ""}`,
    );
  }
  m = DELVING.exec(url);
  if (m) {
    const [, topic, post] = m;
    const api = `https://delvingbitcoin.org/posts/by_number/${topic}/${post ?? 1}.json`;
    const r = await get(api, { accept: "application/json" });
    if (r.status !== 200) return fail(url, api, r, `HTTP ${r.status}`);
    const j = JSON.parse(r.body) as {
      raw?: string;
      cooked?: string;
      username?: string;
      created_at?: string;
    };
    const cooked = j.cooked ? htmlToText(j.cooked) : null;
    return {
      ok: true,
      url,
      read: api,
      status: 200,
      text: [
        `${j.username ?? ""} ${j.created_at ?? ""}`,
        stripInvisible(j.raw ?? ""),
        cooked?.text ?? "",
      ].join("\n\n"),
      removed: cooked?.removed,
    };
  }
  m = SE.exec(url);
  if (m) {
    const [, answer, q1, q2, answer2] = m;
    const id = answer ?? answer2;
    const api = id
      ? `https://api.stackexchange.com/2.3/answers/${id}?site=bitcoin&filter=withbody`
      : `https://api.stackexchange.com/2.3/questions/${q1 ?? q2}?site=bitcoin&filter=withbody`;
    const r = await get(api, { accept: "application/json", maxAge: 7 * 86400 });
    if (r.status !== 200) return fail(url, api, r, `HTTP ${r.status}`);
    const item = (
      JSON.parse(r.body) as {
        items: { title?: string; body?: string; owner?: { display_name?: string } }[];
      }
    ).items[0];
    if (!item) return fail(url, api, r, "no such post");
    const body = htmlToText(item.body ?? "");
    return {
      ok: true,
      url,
      read: api,
      status: 200,
      text: `${item.title ?? ""}\n\n${body.text}`,
      removed: body.removed,
    };
  }

  const head = await get(url, { binary: /\.pdf($|\?)/i.test(url) });
  if (head.status !== 200) return fail(url, url, head, `HTTP ${head.status}`);
  if (/application\/pdf/.test(head.contentType) || /\.pdf($|\?)/i.test(url)) {
    const binary = /\.pdf($|\?)/i.test(url) ? head : await get(url, { binary: true });
    try {
      return { ok: true, url, read: url, status: 200, text: stripInvisible(pdfText(binary.body)) };
    } catch (e) {
      return fail(url, url, binary, `could not read PDF: ${String(e)}`);
    }
  }
  const body = decodeBody(head);
  return {
    ok: true,
    url,
    read: head.finalUrl,
    status: 200,
    text: body.text,
    removed: body.removed,
  };
}

/** The 1-based line range in a #L10-L20 anchor, if the URL has one. */
export function lineAnchor(url: string): [number, number] | null {
  const m = /#L(\d+)(?:-L(\d+))?$/.exec(url);
  if (!m) return null;
  const a = Number(m[1]);
  return [a, m[2] ? Number(m[2]) : a];
}
