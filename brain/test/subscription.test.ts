import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { seal } from "@blocklore/core/node/seal";
import { needsLock } from "../src/jobs.ts";
import { connect, readEnvToken, redact, writeEnvToken } from "../src/subscription.ts";

const KEY = "k".repeat(40);
const TOKEN = `sk-ant-oat01-${"a1B2_c3-".repeat(12)}`;
const dir = () => mkdtempSync(path.join(tmpdir(), "blocklore-sub-test-"));

test(".env gets the token at mode 600 and keeps every other line, comments and blanks included", () => {
  const file = path.join(dir(), ".env");
  writeFileSync(file, "# keys\nCONTROL_KEY=abc\n\nCLAUDE_CODE_OAUTH_TOKEN=old\nOTHER=1\n", {
    mode: 0o644,
  });
  writeEnvToken(TOKEN, file);
  assert.equal(
    readFileSync(file, "utf8"),
    `# keys\nCONTROL_KEY=abc\n\nOTHER=1\nCLAUDE_CODE_OAUTH_TOKEN=${TOKEN}\n`,
  );
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(readEnvToken(file), TOKEN);
  writeEnvToken(null, file);
  assert.equal(readEnvToken(file), null);
  assert.equal(readFileSync(file, "utf8"), "# keys\nCONTROL_KEY=abc\n\nOTHER=1\n");
});

test("connect saves the token only after a session ran on it", async () => {
  const saved: (string | null)[] = [];
  const deps = (ok: boolean, message = "") => ({
    key: KEY,
    check: async () => ({ ok, message }),
    write: (t: string | null) => {
      saved.push(t);
    },
  });
  const failed = await connect(seal(KEY, TOKEN), deps(false, `401 for ${TOKEN}`));
  assert.equal(failed.code, 1);
  assert.doesNotMatch(failed.message, /sk-ant/, "the token never reaches the result");
  assert.deepEqual(saved, []);
  const ok = await connect(seal(KEY, TOKEN), deps(true));
  assert.equal(ok.code, 0);
  assert.deepEqual(saved, [TOKEN]);
});

test("connect refuses an API key and a token sealed under another key, saving nothing", async () => {
  let checked = 0;
  const deps = {
    key: KEY,
    check: async () => {
      checked++;
      return { ok: true, message: "" };
    },
    write: () => assert.fail("nothing may be saved"),
  };
  const api = await connect(seal(KEY, `sk-ant-api03-${"x".repeat(60)}`), deps);
  assert.equal(api.code, 1);
  assert.match(api.message, /not a Claude subscription token/);
  const other = await connect(seal("o".repeat(40), TOKEN), deps);
  assert.equal(other.code, 1);
  assert.match(other.message, /CONTROL_KEY differs/);
  assert.equal(checked, 0, "neither reached a model session");
});

test("connecting never waits on the tick lock, and redact hides every copy", () => {
  assert.equal(needsLock("subscription.connect"), false);
  assert.equal(needsLock("subscription.disconnect"), false);
  assert.equal(needsLock("ship"), true);
  assert.equal(redact(`a ${TOKEN} b ${TOKEN}`, TOKEN), "a [token] b [token]");
});
