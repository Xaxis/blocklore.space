import type { Metadata } from "next";
import { Agenda } from "@/components/admin/Agenda";
import { readPolicy, readState } from "@/lib/admin/control";
import { readProposals } from "@/lib/admin/proposed";

export const metadata: Metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const [{ state, online }, policy] = await Promise.all([readState(), readPolicy()]);
  // Topics the gate policy does not list count as contested: every claim on them waits.
  const unlisted = (policy?.topics ?? []).filter((t) => !t.listed).map((t) => t.slug);
  return <Agenda initial={state} online={online} proposed={readProposals()} unlisted={unlisted} />;
}
