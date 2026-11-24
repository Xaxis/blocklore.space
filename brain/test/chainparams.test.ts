import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bipsNamed, parseChainparams, refreshChainparams } from "../src/chainparams.ts";

// Real lines of Bitcoin Core v22.0's src/chainparams.cpp (CMainParams, which still defined Taproot,
// and the start of CTestNetParams, whose deployments must not be read as mainnet's).
const V22 = `class CMainParams : public CChainParams {
public:
    CMainParams() {
        consensus.nMinerConfirmationWindow = 2016; // nPowTargetTimespan / nPowTargetSpacing
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].bit = 28;
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nStartTime = Consensus::BIP9Deployment::NEVER_ACTIVE;
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nTimeout = Consensus::BIP9Deployment::NO_TIMEOUT;
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].min_activation_height = 0; // No activation delay

        // Deployment of Taproot (BIPs 340-342)
        consensus.vDeployments[Consensus::DEPLOYMENT_TAPROOT].bit = 2;
        consensus.vDeployments[Consensus::DEPLOYMENT_TAPROOT].nStartTime = 1619222400; // April 24th, 2021
        consensus.vDeployments[Consensus::DEPLOYMENT_TAPROOT].nTimeout = 1628640000; // August 11th, 2021
        consensus.vDeployments[Consensus::DEPLOYMENT_TAPROOT].min_activation_height = 709632; // Approximately November 12th, 2021
    }
};

class CTestNetParams : public CChainParams {
public:
    CTestNetParams() {
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].bit = 27;
        consensus.vDeployments[Consensus::DEPLOYMENT_SIGNET_ONLY].bit = 3;
`;

test("CMainParams' deployments, in file order, with their lines, start and the BIPs their comment names", () => {
  assert.deepEqual(parseChainparams(V22), [
    {
      name: "DEPLOYMENT_TESTDUMMY",
      bit: 28,
      bips: [],
      start: "Consensus::BIP9Deployment::NEVER_ACTIVE",
      lines: [5, 8],
    },
    {
      name: "DEPLOYMENT_TAPROOT",
      bit: 2,
      bips: [340, 341, 342],
      start: "1619222400",
      lines: [11, 14],
    },
  ]);
});

test("a reading that cannot be trusted throws instead of writing", () => {
  assert.throws(() => parseChainparams("class CTestNetParams {\n};\n"), /no class CMainParams/);
  assert.throws(
    () =>
      parseChainparams(
        V22.replace("DEPLOYMENT_TAPROOT].bit = 2;", "DEPLOYMENT_TAPROOT].bit = 30;"),
      ),
    /DEPLOYMENT_TAPROOT has no bit 0 to 28/,
  );
  assert.throws(
    () => parseChainparams(V22.replace(/^.*TAPROOT\]\.nStartTime.*$/m, "")),
    /DEPLOYMENT_TAPROOT has no nStartTime/,
  );
});

test("the BIPs a comment names: single, ranges, lists, and written without a space", () => {
  assert.deepEqual(bipsNamed("// Deployment of Taproot (BIPs 340-342)"), [340, 341, 342]);
  assert.deepEqual(bipsNamed("// Deployment of BIP68, BIP112, and BIP113."), [68, 112, 113]);
  assert.deepEqual(bipsNamed("// BIPs 340, 341, and 342"), [340, 341, 342]);
  assert.deepEqual(bipsNamed("// BIP 9 and 320"), [9, 320]);
  assert.deepEqual(bipsNamed("// No activation delay"), []);
  assert.deepEqual(
    bipsNamed("// BIPs 1-900"),
    [1],
    "a range too wide to be a deployment's is not read as one",
  );
});

test("the step reads nothing while the newest release is the one recorded", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "chainparams-"));
  const file = path.join(dir, "chainparams.json");
  const before = process.env.BLOCKLORE_CHAINPARAMS_FILE;
  process.env.BLOCKLORE_CHAINPARAMS_FILE = file;
  try {
    const recorded = {
      release: "v32.1",
      commit: "f0de87f040621468b956f01f526a43a010310501",
      file: "src/kernel/chainparams.cpp",
      read: { time: "2026-11-24T06:00:00Z", height: 977330 },
      deployments: [],
    };
    writeFileSync(file, `${JSON.stringify(recorded, null, 1)}\n`);
    const text = readFileSync(file, "utf8");
    const code = await refreshChainparams(
      { commit: false, push: false },
      {
        newest: () => "32.1",
        commitOf: () => {
          throw new Error("must not resolve a tag when nothing changed");
        },
      },
    );
    assert.equal(code, 0);
    assert.equal(readFileSync(file, "utf8"), text);
  } finally {
    if (before === undefined) delete process.env.BLOCKLORE_CHAINPARAMS_FILE;
    else process.env.BLOCKLORE_CHAINPARAMS_FILE = before;
    rmSync(dir, { recursive: true, force: true });
  }
});
