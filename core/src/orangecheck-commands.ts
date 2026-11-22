// The owner's OrangeCheck commands and the daemon's key state (ORANGECHECK.md), on their own so the
// control plane (control.ts) takes them without the signature libraries. orangecheck.ts builds and
// checks the records these commands carry.
import { decodeAddress, normalizeAddress } from "@orangecheck/bip322";
import { z } from "zod";

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

/** One-second UTC time, the form every message here uses. */
export const SecondTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "a UTC time to the second, ending in Z")
  .refine((s) => Number.isFinite(Date.parse(s)), "a real time");

/** Owner addresses OrangeCheck attests (SPEC section 1): mainnet P2WPKH, P2TR or P2PKH. */
export const OwnerAddress = z
  .string()
  .max(100)
  .transform((s, ctx) => {
    const a = normalizeAddress(s);
    const d = a ? decodeAddress(a) : null;
    if (!a || !d || d.network !== "mainnet" || !["p2wpkh", "p2tr", "p2pkh"].includes(d.type)) {
      ctx.addIssue({
        code: "custom",
        message: "a mainnet bc1q, bc1p or 1 address (one key, as OrangeCheck attests)",
      });
      return z.NEVER;
    }
    return a;
  });

/** The publisher key's address: P2WPKH, so its signatures are deterministic. */
export const PublisherAddress = z
  .string()
  .max(100)
  .refine((a) => decodeAddress(a)?.type === "p2wpkh" && decodeAddress(a)?.network === "mainnet", {
    message: "a mainnet bc1q address",
  });

/** A signature as a wallet gives it: base64, optionally with the finalized BIP-322 "smp" prefix. */
export const PastedSignature = z
  .string()
  .transform((s) => s.replace(/\s+/g, ""))
  .pipe(
    z
      .string()
      .min(80)
      .max(1400)
      .regex(/^(smp)?[A-Za-z0-9+/]+={0,2}$/, "a base64 signature, as the wallet shows it"),
  );

const RevocationReason = z
  .string()
  .max(128)
  .regex(/^[\x20-\x7e]*$/, "plain ASCII letters, digits and punctuation, on one line");

// --- the owner's commands (sent from the admin, applied by the daemon) ----------------------------

/** Binds the owner's address to the domain and/or delegates the stamping scope to the publisher. */
export const OcAuthorizeCommand = z.strictObject({
  type: z.literal("orangecheck.authorize"),
  owner: OwnerAddress,
  agent: PublisherAddress,
  attestation: z
    .strictObject({
      nonce: z.string().regex(HEX32),
      issuedAt: SecondTime,
      sig: PastedSignature,
    })
    .nullable(),
  delegation: z
    .strictObject({
      nonce: z.string().regex(HEX32),
      issuedAt: SecondTime,
      expiresAt: SecondTime,
      sig: PastedSignature,
    })
    .nullable(),
});
export type OcAuthorizeCommand = z.infer<typeof OcAuthorizeCommand>;

/** Burns a delegation before it expires, signed by the owner (or the publisher key). */
export const OcRevokeCommand = z.strictObject({
  type: z.literal("orangecheck.revoke"),
  delegationId: z.string().regex(HEX64),
  signer: OwnerAddress,
  reason: RevocationReason,
  signedAt: SecondTime,
  sig: PastedSignature,
});
export type OcRevokeCommand = z.infer<typeof OcRevokeCommand>;

/** The commands core/src/control.ts takes into its Command union. */
export const OC_COMMANDS = [OcAuthorizeCommand, OcRevokeCommand] as const;
export type OcCommand = OcAuthorizeCommand | OcRevokeCommand;

/** What the daemon tells the admin about its keys: public values only. */
export const OcDaemonState = z.object({
  /** The publisher key's address, or null when .env has no publisher key. */
  publisher: z.string().nullable(),
  /** The Nostr public key (hex) the brain publishes under, derived from the publisher key. */
  nostr: z.string().nullable(),
});
export type OcDaemonState = z.infer<typeof OcDaemonState>;
