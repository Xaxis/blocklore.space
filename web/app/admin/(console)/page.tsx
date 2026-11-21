import { Overview } from "@/components/admin/Overview";
import { readState } from "@/lib/admin/control";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const { state, online } = await readState();
  return <Overview initial={state} online={online} />;
}
