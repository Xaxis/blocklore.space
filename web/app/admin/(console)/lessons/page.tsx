import type { Metadata } from "next";
import { Lessons } from "@/components/admin/Lessons";
import { readState } from "@/lib/admin/control";

export const metadata: Metadata = { title: "Lessons and focus" };
export const dynamic = "force-dynamic";

export default async function LessonsPage() {
  const { state, online } = await readState();
  return <Lessons initial={state} online={online} />;
}
