"use client";

import { useRouter } from "next/navigation";

export function UserSignOut({ hasUnsavedWork = false }: { hasUnsavedWork?: boolean }) {
  const router = useRouter();
  return <button type="button" onClick={async () => {
    if (hasUnsavedWork && !window.confirm("Your current kitchen has not been saved. Sign out and discard it?")) return;
    await fetch("/api/user-session", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }} style={{ border: "1px solid #bdcbc4", borderRadius: 5, padding: "6px 10px", background: "white", cursor: "pointer" }}>Sign out</button>;
}
