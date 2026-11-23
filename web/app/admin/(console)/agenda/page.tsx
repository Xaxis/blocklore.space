import type { Metadata } from "next";
import { Agenda } from "@/components/admin/Agenda";
import { readState } from "@/lib/admin/control";
import { readProposals } from "@/lib/admin/proposed";

export const metadata: Metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const { state, online } = await readState();
  return <Agenda initial={state} online={online} proposed={readProposals()} />;
}
