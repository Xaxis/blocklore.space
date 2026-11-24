import type { Metadata } from "next";
import { DebateMaps } from "@/components/admin/DebateMaps";
import { readState } from "@/lib/admin/control";
import { allDebates, withdrawnDebates } from "@/lib/debates";

export const metadata: Metadata = { title: "Debate maps" };
export const dynamic = "force-dynamic";

export default async function DebateMapsPage() {
  const { state, online } = await readState();
  const shown = allDebates().map((d) => ({
    slug: d.slug,
    question: d.question,
    positions: d.positions.map((p) => p.label),
    claims: d.claims.length,
  }));
  const withdrawn = withdrawnDebates().map((d) => ({
    slug: d.slug,
    question: d.question,
    at: d.withdrawn.at.time,
    note: d.withdrawn.note,
  }));
  return <DebateMaps initial={state} online={online} shown={shown} withdrawn={withdrawn} />;
}
