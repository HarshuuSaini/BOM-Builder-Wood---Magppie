"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function UserSignOut({ hasUnsavedWork = false }: { hasUnsavedWork?: boolean }) {
  const router = useRouter();
  const [openAccess, setOpenAccess] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/user-session", { cache: "no-store" }).then(r => r.json()).then(data => { if (alive) setOpenAccess(data.openAccess === true); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (openAccess) return null;
  return <button type="button" onClick={async () => {
    if (hasUnsavedWork && !window.confirm("Your current kitchen has not been saved. Sign out and discard it?")) return;
    await fetch("/api/user-session", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }} style={{ border: "1px solid #bdcbc4", borderRadius: 5, padding: "6px 10px", background: "white", cursor: "pointer" }}>Sign out</button>;
}
