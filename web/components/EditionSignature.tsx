import type { EditionSignature as Sig } from "@blocklore/core";
import Link from "next/link";
import { dateTime } from "@/lib/format";
import { OC_HOME, stampVerifierUrl } from "@/lib/orangecheck";

// One edition's signature on /verify: who signed it, when, and whether the owner stood behind the
// key then. Reuses the global badge and list classes.

/** The badge beside an edition's title. */
export function SignatureBadge({ signature }: { signature: Sig | null }) {
  if (!signature) return <span className="badge">Not signed</span>;
  if (!signature.ok) return <span className="badge badge-bad">Signature does not check</span>;
  return signature.authority.state === "delegated" ? (
    <span className="badge badge-ok">
      <span className="dot" />
      Signed, owner&apos;s key behind it
    </span>
  ) : (
    <span className="badge badge-warn">Signed by the publisher key alone</span>
  );
}

/** The rows for an edition's definition list: Signature and, when signed, the stamp file. */
export function SignatureRows({ n, signature }: { n: number; signature: Sig | null }) {
  if (!signature)
    return (
      <>
        <dt>Signature</dt>
        <dd>Not signed yet.</dd>
      </>
    );
  const verifier = stampVerifierUrl(n);
  const a = signature.authority;
  return (
    <>
      <dt>Signature</dt>
      <dd>
        {signature.ok ? (
          <>
            <a href={OC_HOME}>Signed with OrangeCheck</a> by the publisher key{" "}
            <span className="hash">{signature.signer}</span> at {dateTime(signature.signedAt)}
            {signature.backSigned && " (signed after the edition was taken)"}.{" "}
            {a.state === "delegated" ? (
              <>
                The owner&apos;s key <span className="hash">{a.owner}</span> stood behind it then.
              </>
            ) : (
              a.why
            )}{" "}
            <Link href="/verify/keys">The keys</Link>
            {verifier && (
              <>
                {", "}
                <a href={verifier}>check it in OrangeCheck&apos;s verifier</a>
              </>
            )}
            .
          </>
        ) : (
          <>The stamp does not check: {signature.problem}.</>
        )}
      </dd>
    </>
  );
}
