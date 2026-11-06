"use client";
import { costingFetch as fetch } from "@/lib/costing-client";
import { useState } from "react";
import type { CostingComparisonData } from "@/lib/costing-comparison";
import { validServiceRates, servicePriceTotals, type ProjectServiceRates } from "@/lib/project-service-rates";
import { PriceReasonInput } from "./PriceChangeReview";
type RateKey = "transportation" | "installation" | "loading" | "conversionPct";
type Draft = Record<RateKey, string> & { includeTax: boolean; modes: Required<NonNullable<ProjectServiceRates["modes"]>> };
type Column = CostingComparisonData["columns"][number];
const money = (value: number) => value.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const rowDefinitions = [
  ["transportation", "Transportation"], ["installation", "Installation"], ["loading", "Loading / unloading"],
  ["combined", "Items + services subtotal"], ["conversion", "Conversion margin"],
  ["subtotal", "Subtotal before tax"], ["tax", "GST (18%)"], ["total", "Final project price"],
] as const;
function initialDraft(column: Column): Draft {
  const p = column.projectPricing;
  const service = (key: "transportation" | "installation" | "loading") => p.rates[key] ?? { mode: "direct" as const, value: p[key] };
  return { transportation: String(service("transportation").value), installation: String(service("installation").value), loading: String(service("loading").value),
    modes: { transportation: service("transportation").mode, installation: service("installation").mode, loading: service("loading").mode },
    conversionPct: String(p.rates.conversionPct ?? 0), includeTax: p.rates.includeTax };
}
function parseDraft(draft: Draft): ProjectServiceRates {
  const value = (key: RateKey) => draft[key].trim() ? Number(draft[key]) : NaN;
  return { transportation: value("transportation"), installation: value("installation"), loading: value("loading"),
    conversionPct: value("conversionPct"), includeTax: draft.includeTax, modes: draft.modes };
}
export function ComparisonServiceRateEditor({ data, onUpdated }: { data: CostingComparisonData; onUpdated: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(data.columns.map(column => [column.id, initialDraft(column)])));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const rates = Object.fromEntries(data.columns.map(column => [column.id, parseDraft(drafts[column.id])]));
  const valid = data.columns.every(column => column.hasSnapshot && validServiceRates(rates[column.id]));
  const changed = data.columns.filter(column => JSON.stringify(rates[column.id]) !== JSON.stringify(parseDraft(initialDraft(column))));
  function update(id: string, patch: Partial<Draft>) { setDrafts(old => ({ ...old, [id]: { ...old[id], ...patch } })); }
  function cancel() {
    setDrafts(Object.fromEntries(data.columns.map(column => [column.id, initialDraft(column)])));
    setReason(""); setError(""); setEditing(false);
  }
  async function submit() {
    if (!valid || !changed.length || !reason.trim() || saved) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/saved-costings/project-pricing", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, kitchens: changed.map(column => ({ id: column.id, version: column.version, rates: rates[column.id] })) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update kitchen rates.");
      setSaved(true);
      try { await onUpdated(); } catch { setError("Rates were saved. Refresh comparison to load the latest totals before editing again."); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update kitchen rates."); }
    finally { setBusy(false); }
  }
  const preview = data.columns.map(column => {
    if (!editing || !valid) return column.projectPricing;
    const values = servicePriceTotals(column.itemCost, column.areaSqft, rates[column.id]);
    const combined = column.itemCost + values.transportation + values.installation + values.loading;
    return { ...values, combined, subtotal: combined + values.conversion };
  });
  return <tbody aria-label="Services and final price">
    <tr><th colSpan={data.columns.length + 2} style={{ background: "#eef4f0", whiteSpace: "normal" }}>Services & final price
      {!editing ? <button type="button" style={{ float: "right" }} disabled={!data.columns.every(column => column.hasSnapshot)} onClick={() => setEditing(true)}>Edit rates</button>
        : <small style={{ display: "block", fontWeight: 400, marginTop: 6 }}>Edit rates under each kitchen. Totals preview automatically; Save updates only changed kitchens. Future defaults remain unchanged.</small>}
    </th></tr>
    {rowDefinitions.map(([key, label]) => {
      const amounts = preview.map(value => value[key]);
      const different = data.columns.every(column => column.hasSnapshot) && Math.max(...amounts) - Math.min(...amounts) > 0.005;
      return <tr key={key} className={key === "total" ? "comparison-item-total" : undefined}><th>{label}</th>
        {data.columns.map((column, index) => {
          const draft = drafts[column.id];
          const service = key === "transportation" || key === "installation" || key === "loading" ? key : null;
          const percent = key === "conversion" ? "conversionPct" : null;
          const rateKey = service ?? percent;
          return <td key={column.id} className={different ? "comparison-different" : undefined}>
            {editing && rateKey && <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <input aria-label={`${column.name} ${label} rate`} type="number" min={0} max={percent ? 99.999999 : undefined} step="any" value={draft[rateKey]} disabled={busy || saved} style={{ width: 100 }}
                onChange={event => update(column.id, { [rateKey]: event.target.value })} />
              {service ? <select aria-label={`${column.name} ${label} calculation method`} value={draft.modes[service]} disabled={busy || saved}
                onChange={event => update(column.id, { modes: { ...draft.modes, [service]: event.target.value as "sqft" | "direct" } })}>
                <option value="sqft">₹ / sqft</option><option value="direct">Direct ₹</option></select> : <span>%</span>}
            </div>}
            {editing && key === "tax" && <label style={{ display: "block", marginBottom: 6 }}><input type="checkbox" aria-label={`${column.name} include GST`} checked={draft.includeTax} disabled={busy || saved}
              onChange={event => update(column.id, { includeTax: event.target.checked })} /> Include GST</label>}
            {column.hasSnapshot ? <>{money(preview[index][key])}{!editing && rateKey && <small style={{ display: "block", fontWeight: 400 }}>{draft[rateKey]}{service ? draft.modes[service] === "sqft" ? " ₹/sqft" : " ₹ direct" : "%"}</small>}
              {!editing && key === "tax" && <small style={{ display: "block", fontWeight: 400 }}>{draft.includeTax ? "Included" : "Not included"}</small>}</> : "Not available"}
          </td>;
        })}<td className={different ? "comparison-different" : undefined}>{data.columns.every(column => column.hasSnapshot) ? money(Math.max(...amounts) - Math.min(...amounts)) : "—"}</td>
      </tr>;
    })}
    {editing && <tr><td colSpan={data.columns.length + 2} style={{ whiteSpace: "normal" }}>
      <label style={{ display: "grid", gap: 6 }}>Reason for rate changes (required)<PriceReasonInput label="Reason for service rate changes" required value={reason} onChange={setReason} /></label>
      {!valid && <p role="status">Enter valid non-negative rates. Conversion margin must be below 100%.</p>}
      {error && <p role="alert" style={{ color: "#a4412e" }}>{error}</p>}
      {saved && <p role="status">Kitchen rates saved.</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button type="button" disabled={busy || saved || !valid || !reason.trim() || !changed.length} onClick={() => void submit()}>{busy ? "Saving…" : "Save rate changes"}</button>
        <button type="button" disabled={busy || saved} onClick={cancel}>Cancel</button></div>
    </td></tr>}
  </tbody>;
}
