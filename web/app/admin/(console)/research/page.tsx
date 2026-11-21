import type { Metadata } from "next";
import { Research } from "@/components/admin/Research";
import { readState } from "@/lib/admin/control";

export const metadata: Metadata = { title: "Research" };
export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const { state, online } = await readState();
  return <Research initial={state} online={online} />;
}
