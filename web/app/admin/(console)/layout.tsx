import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireOwner } from "@/lib/admin/auth";
import { readState } from "@/lib/admin/control";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · Blocklore" },
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireOwner();
  const { state } = await readState();
  return (
    <div className="admin-shell">
      <AdminNav review={state?.review.count ?? 0} />
      <div className="admin-main">{children}</div>
    </div>
  );
}
