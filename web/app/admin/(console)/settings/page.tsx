import type { Metadata } from "next";
import { SettingsPanel } from "@/components/admin/SettingsPanel";
import { requireOwner } from "@/lib/admin/auth";
import { readNostr, readState } from "@/lib/admin/control";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireOwner();
  const [{ state, online }, nostr] = await Promise.all([readState(), readNostr()]);
  return (
    <>
      <header className="page-header">
        <h1>Settings</h1>
        <p className="lede">
          The master switch, the upkeep ticks, posting to Nostr, and your session. Research
          schedule, model and budget are on <a href="/admin/research">Research</a>.
        </p>
      </header>
      <SettingsPanel initial={state} online={online} nostr={nostr} email={session.email} />
    </>
  );
}
