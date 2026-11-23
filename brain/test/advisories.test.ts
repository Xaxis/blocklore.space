import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { NvdRecord } from "@blocklore/core";
import {
  inboxAdvisoryRecords,
  mergeAdvisories,
  refreshAdvisories,
} from "../src/security/advisorylog.ts";
import { nvdDue, nvdQueue, nvdTime, parseNvd } from "../src/security/nvd.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "blocklore-advisories-"));

// The shape NVD's CVE API 2.0 answered for CVE-2018-17144 on 2026-11-23, trimmed.
const found = {
  totalResults: 1,
  vulnerabilities: [
    {
      cve: {
        id: "CVE-2018-17144",
        published: "2018-09-19T08:29:00.333",
        vulnStatus: "Modified",
        descriptions: [
          { lang: "es", value: "Bitcoin Core 0.14.x" },
          {
            lang: "en",
            value:
              "Bitcoin Core 0.14.x before 0.14.3 and Bitcoin Knots 0.14.x through 0.16.x before 0.16.3 allow a remote denial of service.",
          },
        ],
        configurations: [
          {
            nodes: [
              {
                cpeMatch: [
                  { vulnerable: true, criteria: "cpe:2.3:a:bitcoin:bitcoin_core:*:*:*:*:*:*:*:*" },
                  {
                    vulnerable: true,
                    criteria: "cpe:2.3:a:bitcoinknots:bitcoin_knots:*:*:*:*:*:*:*:*",
                  },
                  { vulnerable: false, criteria: "cpe:2.3:o:microsoft:windows:-:*:*:*:*:*:*:*" },
                ],
              },
            ],
          },
        ],
        affected: [{ affectedData: [{ vendor: "n/a", product: "n/a" }] }],
      },
    },
  ],
};

test("an NVD answer becomes the record Blocklore keeps; an empty one says NVD has none", () => {
  const r = parseNvd("CVE-2018-17144", found, "2026-11-23T13:50:00Z");
  assert.deepEqual(r, {
    id: "CVE-2018-17144",
    checked: "2026-11-23T13:50:00Z",
    found: true,
    status: "Modified",
    published: "2018-09-19T08:29:00Z",
    products: ["bitcoin:bitcoin_core", "bitcoinknots:bitcoin_knots"],
    description:
      "Bitcoin Core 0.14.x before 0.14.3 and Bitcoin Knots 0.14.x through 0.16.x before 0.16.3 allow a remote denial of service.",
  });
  const none = parseNvd(
    "CVE-2026-117348",
    { totalResults: 0, vulnerabilities: [] },
    "2026-11-23T13:50:00Z",
  );
  assert.equal(none.found, false);
  assert.deepEqual(none.products, []);
  // A dash in NVD's words never reaches the store.
  const dashed = parseNvd(
    "CVE-2018-17144",
    {
      ...found,
      vulnerabilities: [
        {
          cve: {
            ...found.vulnerabilities[0]?.cve,
            id: "CVE-2018-17144",
            descriptions: [{ lang: "en", value: `0.14${String.fromCharCode(0x2013)}0.16 crash` }],
          },
        },
      ],
    },
    "2026-11-23T13:50:00Z",
  );
  assert.equal(dashed.description, "0.14 to 0.16 crash");
  assert.equal(nvdTime("2024-07-03T04:00:00.000Z"), "2024-07-03T04:00:00Z");
  assert.equal(nvdTime(undefined), null);
});

test("a record is asked for again a day after NVD lacked it, a week in analysis, else a month", () => {
  const now = "2026-11-23T12:00:00Z";
  const rec = (checked: string, over: Partial<NvdRecord> = {}): NvdRecord => ({
    id: "CVE-2018-17144",
    checked,
    found: true,
    status: "Analyzed",
    published: null,
    products: [],
    description: null,
    ...over,
  });
  assert.equal(nvdDue(undefined, now), true);
  assert.equal(nvdDue(rec("2026-11-23T00:00:00Z", { found: false }), now), false);
  assert.equal(nvdDue(rec("2026-11-22T11:00:00Z", { found: false }), now), true);
  assert.equal(nvdDue(rec("2026-11-20T00:00:00Z", { status: "Awaiting Analysis" }), now), false);
  assert.equal(nvdDue(rec("2026-11-15T00:00:00Z", { status: "Awaiting Analysis" }), now), true);
  assert.equal(nvdDue(rec("2026-11-01T00:00:00Z"), now), false);
  assert.equal(nvdDue(rec("2026-10-20T00:00:00Z"), now), true);
  const records = new Map([
    ["CVE-2010-5139", rec("2026-10-01T00:00:00Z", { id: "CVE-2010-5139" })],
    ["CVE-2012-1909", rec("2026-09-01T00:00:00Z", { id: "CVE-2012-1909" })],
    ["CVE-2013-5700", rec("2026-11-22T00:00:00Z", { id: "CVE-2013-5700" })],
  ]);
  // Never asked first, then the longest unasked; fresh ones wait; at most the limit.
  assert.deepEqual(
    nvdQueue(["CVE-2010-5139", "CVE-2012-1909", "CVE-2013-5700", "CVE-2099-0001"], records, now, 2),
    ["CVE-2099-0001", "CVE-2012-1909"],
  );
});

const line = (o: Record<string, unknown>) =>
  JSON.stringify({ tier: "T1", severity: null, published: "2024-07-03T04:00:00.000Z", ...o });

test("the log keeps every advisory once with its ids, and keeps what the inbox has lost", async () => {
  const inbox = path.join(tmp, "inbox");
  mkdirSync(inbox, { recursive: true });
  writeFileSync(
    path.join(inbox, "core-advisories.jsonl"),
    [
      line({
        source: "core-advisories",
        id: "https://bitcoincore.org/en/2024/07/03/disclose-orphan-dos/",
        url: "https://bitcoincore.org/en/2024/07/03/disclose-orphan-dos/",
        title: "CVE-2024-52914 - Significant DoS due to orphan handling",
        severity: "high",
      }),
      line({
        source: "core-advisories",
        id: "https://bitcoincore.org/en/2024/07/03/disclose-orphan-dos",
        url: "https://bitcoincore.org/en/2024/07/03/disclose-orphan-dos",
        title: "the same page again",
      }),
    ].join("\n"),
  );
  writeFileSync(
    path.join(inbox, "gh-advisories-lnd.jsonl"),
    line({
      source: "gh-advisories-lnd",
      id: "GHSA-9gxx-58q6-42p7",
      url: "https://github.com/lightningnetwork/lnd/security/advisories/GHSA-9gxx-58q6-42p7",
      title: "lightningnetwork/lnd: CVE-2024-38359 LND Onion Bomb",
      published: "2024-06-20T19:07:16.000Z",
    }),
  );
  const items = inboxAdvisoryRecords(inbox);
  assert.deepEqual(
    items.map((a) => [a.source, a.ids, a.severity]),
    [
      ["Bitcoin Core", ["CVE-2024-52914"], "high"],
      ["LND", ["CVE-2024-38359", "GHSA-9gxx-58q6-42p7"], null],
    ],
  );
  const old = {
    ...items[0],
    url: "https://bitcoincore.org/en/2018/09/20/notice/",
    title: "Disclosure of CVE-2018-17144",
    published: "2018-09-20T00:00:00Z",
    ids: ["CVE-2018-17144"],
  } as (typeof items)[number];
  assert.deepEqual(
    mergeAdvisories([old], items).map((a) => a.published.slice(0, 10)),
    ["2024-07-03", "2024-06-20", "2018-09-20"],
    "newest first, the one the inbox lost still there",
  );

  const file = path.join(tmp, "advisories.json");
  const first = await refreshAdvisories({ now: "2026-11-23T12:00:00Z", nvd: 0, inbox, file });
  assert.equal(first.written, true);
  assert.equal(first.added, 2);
  assert.equal(first.asked, 0, "no NVD allowance, no request");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(saved.updated, "2026-11-23T12:00:00Z");
  assert.equal(saved.advisories.length, 2);
  const mtime = statSync(file).mtimeMs;
  const again = await refreshAdvisories({ now: "2026-11-23T18:00:00Z", nvd: 0, inbox, file });
  assert.equal(again.written, false, "nothing new: the file is left alone");
  assert.equal(again.log.updated, "2026-11-23T12:00:00Z");
  assert.equal(statSync(file).mtimeMs, mtime);
});
