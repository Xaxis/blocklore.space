import type { Metadata } from "next";
import { Runs } from "@/components/admin/Runs";
import { readState } from "@/lib/admin/control";

export const metadata: Metadata = { title: "Runs and spend" };
export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const { state, online } = await readState();
  return (
    <>
      <header className="page-header">
        <h1>Runs and spend</h1>
        <p className="lede">
          Every research session the brain ran, what it published and held, and what the models
          cost.
        </p>
      </header>
      <Runs initial={state} online={online} />
    </>
  );
}
