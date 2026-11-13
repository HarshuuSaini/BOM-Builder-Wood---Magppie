"use client";
import { useEffect, useState } from "react";
import type { SavedCosting } from "@/lib/local-costing-store";
import { costingFetch } from "@/lib/costing-client";
import { SavedCostingPrint } from "./SavedCostingPrint";

export function BrowserCostingPrint({ id, admin }: { id: string; admin: boolean }) {
  const [costing, setCosting] = useState<SavedCosting | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void costingFetch(`/api/saved-costings/${encodeURIComponent(id)}`).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load this saved costing.");
      if (alive) setCosting(result.costing);
    }).catch(error => { if (alive) setError(error instanceof Error ? error.message : "Could not load costing."); });
    return () => { alive = false; };
  }, [id]);
  return costing ? <SavedCostingPrint costing={costing} admin={admin} /> : <main style={{ padding: 32 }}><p role={error ? "alert" : "status"}>{error || "Loading saved costing…"}</p><a href="/costings">Back to saved costings</a></main>;
}
