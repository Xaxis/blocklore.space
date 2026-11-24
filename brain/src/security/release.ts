// Downloading and unpacking a release for the lab (brain/src/security/lab.ts, lnd.ts): everything
// downloaded is untrusted until its hash matches a signed list, and nothing is extracted before it
// did. Extraction refuses entries and links that could leave the folder they are extracted into.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { USER_AGENT } from "../env.ts";

/**
 * A list of SHA-256 sums (Bitcoin Core's SHA256SUMS, LND's manifest) as file name to hex digest.
 * LND's manifest also lists the binaries inside each archive (lnd-linux-amd64-v0.21.8-beta/lnd);
 * they are names like any other.
 */
export function parseSums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (m) out.set(m[2] as string, m[1] as string);
  }
  return out;
}

/** Tar entry names that could write outside the folder they are extracted into. */
export function unsafeEntries(names: string[]): string[] {
  return names.filter(
    (n) => n.startsWith("/") || n.split("/").includes("..") || /^[A-Za-z]:/.test(n),
  );
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/**
 * Streams one file to disk under a temporary name, renamed only when complete. With `optional`, a
 * 404 is no file (false) rather than an error.
 */
export async function download(
  url: string,
  dest: string,
  opts: { optional?: boolean } = {},
): Promise<boolean> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
  if (opts.optional && res.status === 404) {
    await res.body?.cancel();
    return false;
  }
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const part = `${dest}.part`;
  await pipeline(
    Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
    createWriteStream(part),
  );
  renameSync(part, dest);
  return true;
}

/** Every symlink under a folder must resolve inside it. */
function linksStayInside(dir: string): boolean {
  const root = realpathSync(dir);
  const walk = (d: string): boolean => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) {
        const target = path.resolve(path.dirname(p), readlinkSync(p));
        if (!target.startsWith(`${root}${path.sep}`) && target !== root) return false;
      } else if (e.isDirectory() && !walk(p)) return false;
    }
    return true;
  };
  return walk(root);
}

/**
 * Extracts a verified tarball (gzip, or xz for a `.tar.xz` such as Rust's) into a fresh folder and
 * returns its single top directory.
 */
export function extract(tarball: string, dest: string): string {
  const z = tarball.endsWith(".tar.xz") ? "J" : "z";
  const names = execFileSync("tar", [`-t${z}f`, tarball], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  const bad = unsafeEntries(names);
  if (bad.length)
    throw new Error(`${path.basename(tarball)} has unsafe entries: ${bad.slice(0, 3)}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  execFileSync("tar", [`-x${z}f`, tarball, "-C", dest, "--no-same-owner"], { stdio: "pipe" });
  if (!linksStayInside(dest)) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error(`${path.basename(tarball)} has links that leave its folder`);
  }
  const tops = readdirSync(dest);
  if (tops.length !== 1) throw new Error(`${path.basename(tarball)} does not hold one folder`);
  return path.join(dest, tops[0] as string);
}
