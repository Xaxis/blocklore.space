import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/LoginForm";
import { currentSession } from "@/lib/admin/auth";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentSession()) redirect("/admin");
  return (
    <div className="container">
      <div className="login">
        <h1>Sign in to the admin</h1>
        <p className="muted">
          Enter the owner&apos;s address and a one-time link arrives by mail. It works once, for 15
          minutes.
        </p>
        <LoginForm />
        <p className="small muted">
          Mail not arriving? On the devbox, <code>pnpm brain admin-link</code> prints the same kind
          of link.
        </p>
      </div>
    </div>
  );
}
