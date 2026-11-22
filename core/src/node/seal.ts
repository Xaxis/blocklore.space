import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Sealed } from "../control.ts";

// The one secret the owner sends the brain through the control plane: the Claude subscription token.
// The site seals it under a key derived from CONTROL_KEY, which only the site and the devbox hold,
// so Redis, the command log and the job file only ever hold ciphertext. AES-256-GCM, with the
// purpose bound in as associated data, so a sealed token opens as nothing else.

const PURPOSE = "blocklore-subscription-token-1";

function keyFor(controlKey: string): Buffer {
  if (controlKey.length < 32) throw new Error("CONTROL_KEY must be at least 32 characters");
  return Buffer.from(hkdfSync("sha256", controlKey, "blocklore", PURPOSE, 32));
}

export function seal(controlKey: string, secret: string): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFor(controlKey), iv);
  c.setAAD(Buffer.from(PURPOSE));
  const data = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return {
    v: 1,
    iv: iv.toString("hex"),
    tag: c.getAuthTag().toString("hex"),
    data: data.toString("base64"),
  };
}

/** The secret, or a throw when the key differs or a byte was changed. */
export function open(controlKey: string, s: Sealed): string {
  const d = createDecipheriv("aes-256-gcm", keyFor(controlKey), Buffer.from(s.iv, "hex"));
  d.setAAD(Buffer.from(PURPOSE));
  d.setAuthTag(Buffer.from(s.tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(s.data, "base64")), d.final()]).toString("utf8");
}
