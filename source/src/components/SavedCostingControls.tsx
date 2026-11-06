"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readKitchenWorkspace, writeKitchenWorkspace, type KitchenWorkspaceEntry } from "@/lib/kitchen-workspace";
import { priceChangesFor, missingPriceReasons, type PriceChange } from "@/lib/price-change-audit";
import { PriceChangeReview } from "@/components/PriceChangeReview";
import { PriceChangeReviewDialog } from "@/components/PriceChangeReviewDialog";

function contentKey(entry: KitchenWorkspaceEntry) {
  const { savedCostingId: _id, savedCostingVersion: _version, ...content } = entry;
  return JSON.stringify(content);
}
function hasItems(entry: KitchenWorkspaceEntry) {
  return entry.rows.some((row) => row["Record Type"] !== "format" && row["Record Type"] !== "settings");
}

export function SavedCostingControls({ entries, admin, username, activeKitchenId }: { entries: KitchenWorkspaceEntry[]; admin: boolean; username: string; activeKitchenId?: string }) {
  const latest = useRef(entries);
  const baseline = useRef(new Map(entries.filter(e => e.savedCostingId).map(e => [e.id, e])));
  const [remarks, setRemarks] = useState<Record<string, PriceChange[]>>({});
  const binned = useRef(new Map<string, string>());
  const [binNames, setBinNames] = useState<string[]>([]);
  const saved = useRef(new Map<string, { id: string; version: number; key: string }>());
  const flight = useRef<Promise<void> | null>(null);
  const leaving = useRef(false);
  const [status, setStatus] = useState("Changes save automatically on this computer.");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const workspace = readKitchenWorkspace();
  for (const entry of entries) if (entry.savedCostingId && !baseline.current.has(entry.id)) baseline.current.set(entry.id, workspace.find(e => e.id === entry.id) ?? entry);
  latest.current = entries.map(entry => ({ ...entry, priceChanges: priceChangesFor({ ...entry,
    priceChanges: remarks[entry.id] ?? entry.priceChanges ?? workspace.find(e => e.id === entry.id)?.priceChanges }, baseline.current.get(entry.id)) }));
  const pendingReasons = latest.current.filter(entry => !binned.current.has(entry.id)).flatMap(entry => missingPriceReasons(entry.priceChanges ?? []));
  const reviewEntries = latest.current.filter(entry => entry.id === (activeKitchenId ?? entries[0]?.id) && !binned.current.has(entry.id) && entry.priceChanges?.length);
  const savedLinks = entries.map(entry => entry.savedCostingId ?? "").join("|");
  useEffect(() => {
    let alive = true;
    void fetch("/api/saved-costings?bin=1", { cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (!alive || !Array.isArray(data.costings)) return;
      const ids = new Set(data.costings.map((c: { id: string }) => c.id));
      for (const entry of latest.current) if (ids.has(entry.savedCostingId ?? saved.current.get(entry.id)?.id)) binned.current.set(entry.id, entry.name || "Unnamed kitchen");
      setBinNames([...binned.current.values()]);
    }).catch(() => { /* POST also checks bin status; drafts remain safe if this read fails. */ });
    return () => { alive = false; };
  }, [username, savedLinks]);

  const persistDrafts = useCallback(() => {
    const workspace = new Map(readKitchenWorkspace().map((entry) => [entry.id, entry]));
    for (const entry of latest.current) {
      const stored = workspace.get(entry.id);
      const previous = saved.current.get(entry.id);
      const metadata = [entry, stored, previous && { savedCostingId: previous.id, savedCostingVersion: previous.version }]
        .filter((item) => item?.savedCostingId)
        .sort((a, b) => (b?.savedCostingVersion ?? 0) - (a?.savedCostingVersion ?? 0))[0];
      workspace.set(entry.id, { ...entry, ...(metadata && {
        savedCostingId: metadata.savedCostingId, savedCostingVersion: metadata.savedCostingVersion,
      }) });
    }
    writeKitchenWorkspace([...workspace.values()]);
  }, []);

  const save = useCallback(async () => {
    // Serialize saves so successive edits cannot overwrite a newer saved version.
    const task = async () => {
      setBusy(true); setFailed(false);
      try {
        persistDrafts();
        const errors = new Map<string, string>();
        // A failed kitchen is attempted once per task. Other kitchens, including
        // edits arriving during requests, continue draining without retry loops.
        while (true) {
          const pending = latest.current.filter((item) =>
            (hasItems(item) || item.savedCostingId || saved.current.has(item.id)) &&
            !binned.current.has(item.id) &&
            !errors.has(item.id) && saved.current.get(item.id)?.key !== contentKey(item));
          if (!pending.length) break;
          for (const candidate of pending) {
            const entry = latest.current.find((item) => item.id === candidate.id);
            if (!entry || binned.current.has(entry.id)) continue;
            const key = contentKey(entry);
            const previous = saved.current.get(entry.id);
            if (previous?.key === key) continue;
            try {
              const missing = missingPriceReasons(entry.priceChanges ?? []);
              if (missing.length) throw new Error(`Use Review price changes to enter a reason for ${missing[0].label}.`);
              const usePrevious = previous && previous.version >= (entry.savedCostingVersion ?? 0);
              const payload = usePrevious ? { ...entry, savedCostingId: previous.id, savedCostingVersion: previous.version } : entry;
              const response = await fetch("/api/saved-costings", { method: "POST", headers: { "Content-Type": "application/json", "x-costing-user": username }, body: JSON.stringify(payload) });
              const data = await response.json();
              if (!response.ok && data.code === "COSTING_IN_BIN") {
                binned.current.set(entry.id, entry.name || "Unnamed kitchen");
                setBinNames([...binned.current.values()]);
                continue;
              }
              if (!response.ok) throw new Error(data.error || "Could not save costing.");
              const meta = { id: data.costing.id as string, version: data.costing.version as number, key };
              saved.current.set(entry.id, meta);
              persistDrafts();
              window.dispatchEvent?.(new Event("wood-bom-accessory-master-updated"));
            } catch (error) {
              errors.set(entry.id, `${entry.name || "Unnamed kitchen"}: ${error instanceof Error ? error.message : "Could not save costing."}`);
            }
          }
        }
        persistDrafts();
        const failures = latest.current.flatMap((entry) => !binned.current.has(entry.id) && errors.has(entry.id) ? [errors.get(entry.id)!] : []);
        if (failures.length) throw new Error(`Some kitchens could not be saved; local drafts are preserved. ${failures.join("; ")}`);
        setStatus(binned.current.size ? "All active kitchens saved. Binned kitchens are excluded from automatic saving." : "All kitchens saved on this computer.");
      } catch (error) {
        setFailed(true); setStatus(error instanceof Error ? error.message : "Could not save costing.");
        throw error;
      } finally { setBusy(false); }
    };
    const running = (flight.current ?? Promise.resolve()).catch(() => {}).then(task);
    flight.current = running;
    try { await running; } finally { if (flight.current === running) flight.current = null; }
  }, [username, persistDrafts]);

  const openLibrary = async () => {
    let saveFailed = false;
    try { await save(); } catch { saveFailed = true; }
    try {
      persistDrafts();
      if (saveFailed && !window.confirm("Some kitchens could not be saved. Your latest drafts are preserved on this browser. Open saved costings to recover?")) return;
      leaving.current = true;
      window.location.assign(admin ? "/admin/costings" : "/costings");
    } catch (error) {
      leaving.current = false;
      setFailed(true); setStatus(error instanceof Error ? error.message : "Could not preserve local drafts.");
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void save().catch(() => {}); }, 1500);
    return () => window.clearTimeout(timer);
  }, [entries, save, remarks]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      if (flight.current || latest.current.some((entry) => !binned.current.has(entry.id) && (hasItems(entry) || entry.savedCostingId || saved.current.has(entry.id)) && saved.current.get(entry.id)?.key !== contentKey(entry))) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  return <aside style={{ padding: "10px 20px", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", background: "#e9f3ed" }}>
    <style>{`.saved-costing-button{font:600 13px system-ui;padding:9px 15px;border:1px solid #bad0c2;border-radius:8px;background:white;color:#245a49;cursor:pointer}.saved-costing-button:hover{background:#e0ede5}.saved-costing-button:disabled{opacity:.5;cursor:not-allowed}`}</style>
    <button className="saved-costing-button" type="button" disabled={busy || !!pendingReasons.length} onClick={() => void save().catch(() => {})}>{busy ? "Saving…" : "Save costings"}</button>
    <button className="saved-costing-button" type="button" disabled={busy || !!pendingReasons.length} onClick={() => void openLibrary()}>{admin ? "Admin · saved costings" : "My saved costings"}</button>
    <span role={failed && !pendingReasons.length ? "alert" : "status"} style={{ color: pendingReasons.length ? "#965c2e" : failed ? "#a13b28" : "#345c4c" }}>{pendingReasons.length ? "Price-change reasons required before saving. Enter accessory reasons beside their prices; use Review price changes for other rates." : status}</span>
    {binNames.length > 0 && <p role="status" style={{ width: "100%", margin: 0, color: "#6a6747" }}>{binNames.join(", ")} — in the bin; local drafts are retained. Open Saved costings → Bin and restore the kitchen, then reopen it to edit.</p>}
    <PriceChangeReviewDialog hasChanges={!!reviewEntries.length} required={reviewEntries.some(entry => missingPriceReasons(entry.priceChanges ?? []).length > 0)}>
    {reviewEntries.map(entry => <div key={entry.id} style={{ width: "100%", marginTop: 16 }}><strong>{entry.name || "Kitchen"}</strong>
      <PriceChangeReview accessoriesReadOnly changes={entry.priceChanges!} onReason={(keys, reason) => setRemarks(old => ({ ...old, [entry.id]: latest.current.find(e => e.id === entry.id)!.priceChanges!.map(c => keys.includes(c.key) ? { ...c, reason } : c) }))} /></div>)}
    </PriceChangeReviewDialog>
  </aside>;
}
