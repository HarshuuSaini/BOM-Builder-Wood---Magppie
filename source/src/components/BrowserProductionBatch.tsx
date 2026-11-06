"use client";
import { useEffect, useState } from "react";
import { costingFetch } from "@/lib/costing-client";
import { ProductionBatch } from "./ProductionBatch";
export function BrowserProductionBatch() {
  const [kitchens, setKitchens] = useState<Array<{ id: string; name: string; owner: string; version: number }> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void costingFetch("/api/saved-costings").then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load browser kitchens.");
      if (alive) setKitchens(result.costings);
    }).catch(error => { if (alive) setError(error instanceof Error ? error.message : "Could not load kitchens."); });
    return () => { alive = false; };
  }, []);
  return kitchens ? <ProductionBatch kitchens={kitchens} /> : <p role={error ? "alert" : "status"}>{error || "Loading saved kitchens from this browser…"}</p>;
}
