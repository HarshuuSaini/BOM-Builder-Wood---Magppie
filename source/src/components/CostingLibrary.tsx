"use client";
import { costingFetch as fetch } from "@/lib/costing-client";
import { browserCostingsEnabled, cloudCostingsEnabled } from "@/lib/costing-storage-mode";

import { useEffect, useRef, useState } from "react";
import { UserSignOut } from "@/components/UserSignOut";
import { ensureWorkspaceUser, readKitchenWorkspace, writeKitchenWorkspace, setActiveKitchenId, startNewKitchenDraft } from "@/lib/kitchen-workspace";
import type { SavedCosting, SavedCostingSummary, CostingActor } from "@/lib/local-costing-store";
import { costingLibraryPricing } from "@/lib/costing-library-pricing";
import { CostingComparison } from "@/components/CostingComparison";
import type { CostingComparisonData } from "@/lib/costing-comparison";
import { CostingActions } from "@/components/CostingActions";
import { PriceChangeSummary } from "@/components/PriceChangeSummary";
import { priceChangesFor } from "@/lib/price-change-audit";

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
const date = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

export function CostingLibrary({ initial, actor }: { initial: SavedCostingSummary[]; actor: CostingActor }) {
  const admin = actor.role === "admin";
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<SavedCosting | null>(null);
  const [costings, setCostings] = useState(initial);
  const [bin, setBin] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [copies, setCopies] = useState(1);
  const [message, setMessage] = useState("");
  const [comparison, setComparison] = useState<CostingComparisonData | null>(null);
  const detailsHeading = useRef<HTMLHeadingElement>(null);
  const comparisonPanel = useRef<HTMLDivElement>(null);
  const viewTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!browserCostingsEnabled()) return;
    let alive = true;
    void fetch("/api/saved-costings").then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load browser costings.");
      if (alive) setCostings(result.costings);
    }).catch(error => { if (alive) setError(error instanceof Error ? error.message : "Could not load browser costings."); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (viewing) detailsHeading.current?.focus(); }, [viewing]);
  useEffect(() => { if (comparison) comparisonPanel.current?.focus(); }, [comparison]);
  const filtered = costings.filter((costing) => `${costing.name} ${costing.owner} ${costing.sourceName ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  async function refresh(targetBin: boolean) {
    const response = await fetch(`/api/saved-costings${targetBin ? "?bin=1" : ""}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load costings.");
    setCostings(data.costings); setBin(targetBin); setSelected([]); setViewing(null); setComparison(null);
  }
  async function switchList(targetBin: boolean) {
    setBusy("list"); setError(""); setMessage("");
    try { await refresh(targetBin); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load costings."); }
    finally { setBusy(""); }
  }
  async function action(action: "bin" | "restore" | "clone", ids: string[], count = 1) {
    setBusy("action"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/saved-costings/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids, copies: count }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not apply this action.");
      await refresh(bin);
      setMessage(action === "clone" ? `${data.costings.length} independent kitchen copies created.` : action === "restore" ? `${ids.length} costing(s) restored.` : `${ids.length} costing(s) moved to the bin. You can restore them anytime.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply this action."); }
    finally { setBusy(""); }
  }
  async function compare() {
    setBusy("compare"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/saved-costings/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: selected }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not compare these kitchens.");
      setComparison(data.comparison);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not compare these kitchens."); }
    finally { setBusy(""); }
  }
  function addCosting() {
    setError("");
    try {
      ensureWorkspaceUser(actor.username);
      startNewKitchenDraft(crypto.randomUUID());
      window.location.assign("/materials?new=1");
    } catch { setError("Could not start a costing. Allow session storage in this browser and try again."); }
  }
  async function refreshComparisonPricing() {
    if (!comparison) return;
    const responses = await Promise.all([
      fetch("/api/saved-costings/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: comparison.columns.map(column => column.id) }) }),
      fetch("/api/saved-costings", { cache: "no-store" }),
    ]);
    const [report, list] = await Promise.all(responses.map(response => response.json()));
    if (!responses[0].ok || !responses[1].ok) throw new Error("Could not refresh updated comparison.");
    setComparison(report.comparison); setCostings(list.costings);
    setMessage("Comparison refreshed with the latest saved prices. Reopen a saved kitchen to load its latest pricing into the Builder.");
  }
  async function load(id: string, edit: boolean) {
    setBusy(id); setError("");
    try {
      const response = await fetch(`/api/saved-costings/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not open this costing.");
      const costing = data.costing as SavedCosting;
      if (!edit) { viewTrigger.current = document.activeElement as HTMLElement | null; setViewing(costing); return; }
      ensureWorkspaceUser(actor.username);
      const existing = readKitchenWorkspace().find((entry) => entry.id === costing.entry.id);
      const draftContent = (entry: SavedCosting["entry"]) => ({ name: entry.name, rows: entry.rows, materials: entry.materials, boardSheetInputs: entry.boardSheetInputs, manualCosting: entry.manualCosting });
      if (existing && JSON.stringify(draftContent(existing)) !== JSON.stringify(draftContent(costing.entry)) &&
          !window.confirm("There is a different local draft for this kitchen. Replace it with the saved version? Cancel keeps your current draft unchanged.")) return;
      if (costing.entry.materials) {
        const applied = await fetch("/api/kitchen-materials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(costing.entry.materials) });
        if (!applied.ok) { const result = await applied.json().catch(() => ({})); throw new Error(result.error || "Could not restore saved materials."); }
      }
      const entries = readKitchenWorkspace().filter((entry) => entry.id !== costing.entry.id);
      writeKitchenWorkspace([...entries, costing.entry]);
      setActiveKitchenId(costing.entry.id);
      const destination = costing.entry.materials ? "/builder" : "/materials";
      window.location.assign(`${destination}?saved=${encodeURIComponent(id)}${actor.role === "admin" ? "&pricing=1" : ""}`);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not open this costing."); }
    finally { setBusy(""); }
  }
  return <main className="costing-library" style={{ padding: 24, minHeight: "100vh", background: "#f3f5f3", color: "#1b2430", font: "14px system-ui,sans-serif" }}>
    <style>{`.costing-comparison{width:100%;border-collapse:collapse}.costing-comparison td,.costing-comparison th{padding:10px;border:1px solid #d9e0dc;text-align:left;white-space:nowrap}.costing-comparison thead{background:#eef4f0}
      .costing-library button:not(.costing-menu-trigger):not(.costing-menu-item){appearance:none;padding:10px 15px;border:1px solid #c7d8cd;border-radius:8px;background:#fff;color:#24594b;font:600 13px system-ui;line-height:20px;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s;box-shadow:0 1px 2px #183f2510}
      .costing-library button:not(.costing-menu-trigger):not(.costing-menu-item):hover{background:#edf5ef;border-color:#8eaf9b}
      .costing-library button:not(.costing-menu-trigger):not(.costing-menu-item):focus-visible{outline:2px solid #15645a;outline-offset:3px}
      .costing-library button[aria-pressed=true],.costing-library button.library-primary{background:#15645a!important;color:white!important;border-color:#15645a!important}
      .costing-library button.library-primary:hover{background:#104e46!important}.costing-library button.library-danger{color:#9f4939!important;background:#fffaf8!important;border-color:#e0c7bf!important}
      .costing-library button:disabled{opacity:.45;cursor:not-allowed!important;box-shadow:none!important}
      .costing-library input[type=number]{padding:9px;border:1px solid #c7d8cd;border-radius:7px;background:#fff;color:#253b30;font:inherit}.costing-library input[type=checkbox]{accent-color:#15645a;width:16px;height:16px}
      .costing-menu-trigger{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:1px solid transparent;border-radius:50%;background:transparent;color:#53665d;cursor:pointer;flex-shrink:0}
      .costing-menu-trigger:hover,.costing-menu-trigger[aria-expanded=true]{background:#e7efea;border-color:#d9e4dd;color:#15645a}
      .costing-menu-trigger:focus-visible{outline:2px solid #15645a;outline-offset:2px}.costing-menu-trigger:disabled{opacity:.45;cursor:wait}
      .costing-menu[popover]{position:fixed;inset:auto;margin:0;padding:7px;width:218px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);box-sizing:border-box;overflow-y:auto;border:1px solid #dce5df;border-radius:14px;background:#fff;color:#26382e;box-shadow:0 12px 36px #1c382426,0 2px 8px #1c382414;font:14px system-ui,sans-serif}
      .costing-menu::backdrop{background:transparent}.costing-menu:popover-open{display:grid;gap:2px}
      .costing-menu-item{appearance:none;display:flex;align-items:center;gap:12px;width:100%;min-height:40px;padding:10px 12px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;font:inherit;line-height:20px;cursor:pointer;white-space:nowrap}
      .costing-menu-item svg{flex-shrink:0;color:#708478}.costing-menu-item:hover,.costing-menu-item:focus-visible{background:#edf4ef;color:#15645a;outline:0}.costing-menu-item:focus-visible{box-shadow:inset 0 0 0 2px #15645a55}
      .costing-menu-item.costing-menu-danger{margin-top:6px;border-top:1px solid #e3eae5;border-radius:0 0 8px 8px;padding-top:13px;color:#a44135}.costing-menu-danger svg{color:inherit}.costing-menu-danger:hover,.costing-menu-danger:focus-visible{background:#fcf0ed;color:#993d31}
      .costing-menu-item:disabled{opacity:.45;cursor:wait}
      .costing-print-link{display:inline-flex;align-items:center;padding:8px 12px;border:1px solid #c7d8cd;border-radius:8px;background:white;color:#24594b;font-weight:600;text-decoration:none;white-space:nowrap}
      .costing-print-link:hover{background:#edf5ef;border-color:#8eaf9b}.costing-print-link:focus-visible{outline:2px solid #15645a;outline-offset:3px}
    `}</style>
    <section style={{ maxWidth: 1400, margin: "0 auto", background: "white", border: "1px solid #d9e0dc", borderRadius: 12, padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div><h1 style={{ margin: "0 0 6px" }}>{actor.role === "admin" ? "Admin — saved costings" : "My saved costings"}</h1>
          <p style={{ margin: 0, color: "#607168" }}>Signed in as {actor.username} · {actor.role === "admin" ? "All users’ costings" : "Your costings only"} · {cloudCostingsEnabled() ? "Saved securely online · latest 5 versions" : browserCostingsEnabled() ? "Saved in this browser on this computer" : "Saved on this computer"}</p></div>
        <nav style={{ display: "flex", alignItems: "center", gap: 18 }}><button type="button" disabled={!!busy} onClick={addCosting}>+ Add costing</button>{admin && <a href="/production">Production batch / Opti</a>}<a href="/materials">Material selection</a><a href="/builder">Builder</a><UserSignOut /></nav>
      </header>
      <p>Saved totals and rates remain as quoted. Edit costing restores its cabinets, materials, accessories and pricing settings.</p>
      {browserCostingsEnabled() && <p>Kitchen data stays in this browser. Keep exported PDFs as backups; clearing site data removes saved kitchens. Other browsers and computers have separate lists.</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", margin: "16px 0" }}>
        <button disabled={!!busy} aria-pressed={!bin} onClick={() => void switchList(false)}>Active costings</button>
        <button disabled={!!busy} aria-pressed={bin} onClick={() => void switchList(true)}>Bin</button>
        <span>{selected.length} selected</span>
        {bin ? <button disabled={!!busy || !selected.length} onClick={() => void action("restore", selected)}>Restore selected</button> : <>
          <label>Copies per kitchen <input aria-label="Copies per kitchen" type="number" min={1} step={1} value={copies} disabled={!!busy} style={{ width: 70 }} onChange={e => setCopies(Number(e.target.value))} /></label>
          <button disabled={!!busy || !selected.length || !Number.isSafeInteger(copies) || copies < 1} onClick={() => void action("clone", selected, copies)}>Clone selected</button>
          <button className="library-danger" disabled={!!busy || !selected.length} onClick={() => void action("bin", selected)}>Move selected to bin</button>
          {admin && <button className="library-primary" disabled={!!busy || selected.length < 2} onClick={() => void compare()}>Compare selected kitchens</button>}
        </>}
      </div>
      {bin && <p>Bin costings are retained indefinitely. Restore them to edit, clone or compare them.</p>}
      <label>Search costings <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kitchen name, creator or PDF name" style={{ padding: 10, width: "min(400px,90%)", border: "1px solid #becbc4", borderRadius: 6, margin: "12px 0" }} /></label>
      {error && <p role="alert" style={{ color: "#a4412e" }}>{error}</p>}
      {message && <p role="status">{message}</p>}
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: admin ? 1700 : 900 }}>
        <thead><tr><th style={{ textAlign: "left", padding: 12, background: "#eef4f0" }}>Actions / select <input type="checkbox" aria-label="Select all visible kitchens" disabled={!!busy || !filtered.length} checked={!!filtered.length && filtered.every(c => selected.includes(c.id))}
          onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...filtered.map(c => c.id)])] : selected.filter(id => !filtered.some(c => c.id === id)))} /></th>{["Kitchen", "Created by", "Visible sqft", ...costingLibraryPricing({}, admin).map(([label]) => label), "Last saved", "Version"].map((label) => <th key={label} style={{ textAlign: "left", padding: 12, background: "#eef4f0" }}>{label}</th>)}</tr></thead>
        <tbody>{filtered.map((costing) => <tr key={costing.id}>
          <td style={{ verticalAlign: "top", padding: 10, minWidth: 100 }}><div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input type="checkbox" aria-label={`Select ${costing.name}`} disabled={!!busy} checked={selected.includes(costing.id)} onChange={e => setSelected(old => e.target.checked ? [...old, costing.id] : old.filter(id => id !== costing.id))} />
            <CostingActions name={costing.name} busy={!!busy} bin={bin} editLabel={admin ? "Admin edit" : "Edit costing"}
              onView={() => void load(costing.id, false)} onEdit={() => void load(costing.id, true)} onClone={() => void action("clone", [costing.id])}
              onBin={() => void action("bin", [costing.id])} onRestore={() => void action("restore", [costing.id])} />
            {!bin && <a className="costing-print-link" href={`/costings/${encodeURIComponent(costing.id)}/print`} target="_blank" rel="noopener noreferrer" aria-label={`Print PDF of ${costing.name}`}>Print PDF</a>}
          </div></td>
          <td style={{ padding: 12, borderBottom: "1px solid #e4e9e5" }}><strong>{costing.name}</strong>{costing.sourceName && <small style={{ display: "block", color: "#607168" }}>{costing.sourceName}</small>}</td>
          <td>{costing.owner}</td><td>{costing.areaSqft.toFixed(2)}</td>
          {costingLibraryPricing(costing, admin).map(([label, value]) => <td key={label} style={{ padding: 12, whiteSpace: "nowrap" }}>{money(value)}</td>)}
          <td>{date(costing.updatedAt)}<small style={{ display: "block" }}>by {costing.updatedBy}</small></td><td>{costing.version}</td>
        </tr>)}</tbody>
      </table></div>
      {!filtered.length && <p style={{ padding: 24 }}>{bin ? "The bin is empty." : query ? "No matching costings." : "No saved costings yet. Add or import a kitchen in the builder; it will save automatically."}</p>}
      {admin && comparison && <div ref={comparisonPanel} tabIndex={-1}><CostingComparison data={comparison} onClose={() => setComparison(null)} onPricingUpdated={refreshComparisonPricing}
        onRefresh={() => void refreshComparisonPricing().catch(e => setError(e instanceof Error ? e.message : "Could not refresh comparison."))} /></div>}
      {viewing && <section aria-labelledby="saved-costing-details-heading" style={{ marginTop: 24, padding: 20, border: "1px solid #cbd8d0", borderRadius: 8 }}>
        <button onClick={() => { setViewing(null); requestAnimationFrame(() => viewTrigger.current?.focus()); }} style={{ float: "right" }}>Close</button><h2 id="saved-costing-details-heading" tabIndex={-1} ref={detailsHeading}>{viewing.name} · saved version {viewing.version}</h2>
        <p>Created by {viewing.owner} on {date(viewing.createdAt)}. Last edited by {viewing.updatedBy}.</p>
        {viewing.entry.costing && <><table><tbody>{costingLibraryPricing(viewing.entry.costing, admin)
          .map(([label, value]) => <tr key={label}><th style={{ textAlign: "left", paddingRight: 24 }}>{label}</th><td>{money(value)}</td></tr>)}</tbody></table>
          {!!viewing.entry.costing.unpriced.length && <p>Items awaiting a rate: {viewing.entry.costing.unpriced.join(", ")}</p>}</>}
        <PriceChangeSummary changes={priceChangesFor(viewing.entry, viewing.entry)} />
      </section>}
    </section>
  </main>;
}
