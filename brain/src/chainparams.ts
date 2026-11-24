// Bitcoin Core's mainnet version bits deployments, read from its own source at its newest release
// (BACKLOG 16). The version bits table names a bit only when Core's mainnet parameters define a
// deployment on it, so when a release defines a new one (a soft fork's activation client), its
// name, bit and start time reach /proposals and the BIP's page within the hour, with no one
// re-pinning anything. The parser reads CMainParams in chainparams.cpp: every
// `consensus.vDeployments[Consensus::DEPLOYMENT_X].field = value;` line, grouped by deployment,
// and the BIPs a comment directly above a deployment's first line names ("Deployment of Taproot
// (BIPs 340-342)"). It reads; it never judges whether a deployment will activate.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Chainparams, type Deployment } from "@blocklore/core";
import { type ChainSource, chainSource } from "./chain.ts";
import { ROOT } from "./env.ts";
import { commitAsOwner } from "./git.ts";
import { get } from "./http.ts";
import { newestRelease } from "./security/watches.ts";
import { CHAINPARAMS_FILE, readChainparams } from "./signaling.ts";
import { nowStamp } from "./store.ts";

/** Where releases keep the file: src/kernel/ since v28, src/ before. */
const FILES = ["src/kernel/chainparams.cpp", "src/chainparams.cpp"] as const;

const LINE =
  /^\s*consensus\.vDeployments\[Consensus::(DEPLOYMENT_[A-Z0-9_]+)\]\.(\w+)\s*=\s*(.+?);/;

/** BIP numbers a comment names: "BIP 9", "BIPs 340-342", "BIPs 68, 112 and 113". */
export function bipsNamed(comment: string): number[] {
  const out: number[] = [];
  for (const m of comment.matchAll(/\bBIPs?\s*(\d+(?:\s*(?:-|,\s*and|,|and)\s*\d+)*)/g)) {
    for (const part of (m[1] ?? "").split(/\s*(?:,|\band\b)\s*/)) {
      if (!/^\d+(\s*-\s*\d+)?$/.test(part.trim())) continue;
      const [a, b] = part.split("-").map((x) => Number(x.trim()));
      if (a === undefined || !Number.isInteger(a)) continue;
      if (b !== undefined && Number.isInteger(b) && b >= a && b - a <= 10)
        for (let n = a; n <= b; n++) out.push(n);
      else out.push(a);
    }
  }
  return [...new Set(out)];
}

/**
 * The deployments CMainParams defines, in the order the file defines them. Throws when the class is
 * missing or a deployment lacks its bit or start time, so a reading that cannot be trusted writes
 * nothing.
 */
export function parseChainparams(cpp: string): Deployment[] {
  const lines = cpp.split("\n");
  const from = lines.findIndex((l) => /^class CMainParams\b/.test(l));
  if (from < 0) throw new Error("chainparams: no class CMainParams");
  const next = lines.findIndex((l, i) => i > from && /^class C\w+Params\b/.test(l));
  const to = next < 0 ? lines.length : next;
  const found = new Map<
    string,
    { first: number; last: number; fields: Map<string, string>; bips: number[] }
  >();
  for (let i = from; i < to; i++) {
    const m = LINE.exec(lines[i] ?? "");
    if (!m) continue;
    const [, name = "", field = "", value = ""] = m;
    let d = found.get(name);
    if (!d) {
      const above = (lines[i - 1] ?? "").trim();
      d = {
        first: i + 1,
        last: i + 1,
        fields: new Map(),
        bips: above.startsWith("//") ? bipsNamed(above) : [],
      };
      found.set(name, d);
    }
    d.last = i + 1;
    d.fields.set(field, value.trim());
  }
  return [...found].map(([name, d]) => {
    const bit = Number(d.fields.get("bit"));
    const start = d.fields.get("nStartTime");
    if (!Number.isInteger(bit) || bit < 0 || bit > 28)
      throw new Error(`chainparams: ${name} has no bit 0 to 28`);
    if (!start) throw new Error(`chainparams: ${name} has no nStartTime`);
    return { name, bit, bips: d.bips, start, lines: [d.first, d.last] as [number, number] };
  });
}

/** The commit a release's tag points to, from git (no API quota). */
export function tagCommit(release: string): string {
  const out = execFileSync(
    "git",
    ["ls-remote", "https://github.com/bitcoin/bitcoin", `refs/tags/${release}^{}`],
    { encoding: "utf8", timeout: 30_000 },
  );
  const sha = out.trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`chainparams: no commit for tag ${release}`);
  return sha;
}

/**
 * The hourly `chainparams` step and part of `pnpm brain bips`: when Core's newest release is not the
 * one recorded, read chainparams.cpp at its tag's commit and write knowledge/chain/chainparams.json.
 */
export async function refreshChainparams(
  opts: { commit: boolean; push: boolean },
  deps: {
    newest?: () => string;
    commitOf?: (release: string) => string;
    chain?: ChainSource;
  } = {},
): Promise<number> {
  const release = `v${(deps.newest ?? newestRelease)()}`;
  const file = CHAINPARAMS_FILE();
  const prev = readChainparams();
  if (prev?.release === release) {
    console.log(`chainparams: unchanged at ${release}`);
    return 0;
  }
  const commit = (deps.commitOf ?? tagCommit)(release);
  let read: { path: string; body: string } | null = null;
  for (const p of FILES) {
    const r = await get(`https://raw.githubusercontent.com/bitcoin/bitcoin/${commit}/${p}`, {
      maxAge: 365 * 86400,
    });
    if (r.status === 200) {
      read = { path: p, body: r.body };
      break;
    }
  }
  if (!read) throw new Error(`chainparams: no chainparams.cpp at ${release} (${commit})`);
  const deployments = parseChainparams(read.body);
  const out: Chainparams = Chainparams.parse({
    release,
    commit,
    file: read.path,
    read: await nowStamp(deps.chain ?? chainSource()),
    deployments,
  });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  const named = deployments.map((d) => `${d.name} on bit ${d.bit}`).join(", ") || "none";
  console.log(`chainparams: ${release} (${commit.slice(0, 10)}) defines ${named}`);
  if (!opts.commit) return 0;
  const before = prev ? JSON.stringify(prev.deployments.map(({ lines: _, ...d }) => d)) : null;
  const same = before === JSON.stringify(deployments.map(({ lines: _, ...d }) => d));
  commitAsOwner(
    [path.relative(ROOT, file)],
    prev
      ? `Read Bitcoin Core ${release}'s mainnet deployments${same ? ", the same as " : " in place of "}${prev.release}'s, so the version bits name each bit as the newest release defines it.`
      : `Read Bitcoin Core ${release}'s mainnet deployments from its chainparams.cpp, so the version bits name each bit as the newest release defines it.`,
    opts.push,
  );
  return 0;
}
