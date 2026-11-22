import type { Metadata } from "next";
import { Signing } from "@/components/admin/Signing";
import { readState } from "@/lib/admin/control";
import { signing } from "@/lib/orangecheck";

export const metadata: Metadata = { title: "Signing" };
export const dynamic = "force-dynamic";

export default async function SigningPage() {
  const { state, online } = await readState();
  const s = signing();
  return (
    <Signing
      initial={state}
      online={online}
      records={{
        attestation: s.attestation,
        delegations: s.delegations.map((d) => ({
          id: d.record.id,
          principal: d.record.principal.address,
          agent: d.record.agent.address,
          issuedAt: d.record.issued_at,
          expiresAt: d.record.expires_at,
          status: d.status,
        })),
        signed: s.signed,
        editions: s.editions.length,
        signatures: s.editions.flatMap((e) =>
          e.signature?.ok ? [{ signer: e.signature.signer, at: e.signature.signedAt }] : [],
        ),
      }}
    />
  );
}
