import type { Metadata } from "next";
import { AuthConfirm } from "@/components/admin/AuthConfirm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default function AuthPage() {
  return (
    <div className="container">
      <div className="login">
        <h1>Sign in to the admin</h1>
        <AuthConfirm />
      </div>
    </div>
  );
}
