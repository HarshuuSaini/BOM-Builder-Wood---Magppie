"use client";

import { useEffect, useMemo, useState } from "react";
import { ProductionOptiSummary } from "@/components/ProductionOptiSummary";
import { OptiMaterialOptions } from "@/components/OptiMaterialOptions";
import { productionCuttingBatches, cuttingBatchLabel, batchPreviewLayout, cuttingBatchParts, type CuttingBatch } from "@/lib/production-report";
import { cuttingChartHtml } from "@/lib/builder-opti";
import type { SavedCosting } from "@/lib/local-costing-store";
import { readKitchenWorkspace, type KitchenWorkspaceEntry } from "@/lib/kitchen-workspace";
import { defaultStockForGroup, optimizeRepeatedProductionGroup, productionGroups,
  type ProductionInput, type ProductionGroup, type OptimizedGroup, type StockSettings, type CutLayout } from "@/lib/production-optimizer";

type Kitchen = { id: string; name: string; owner: string; version: number };
const field = { padding: 8, border: "1px solid #bacbc1", borderRadius: 5, maxWidth: 150 };
const n = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const PANEL_COLORS = ["#d9e9df", "#e9dfc9", "#d7e2ee", "#e8d6df", "#dbe6c7", "#e3d9ee", "#cde6e5", "#eedbd0"];
export function LayoutDrawing({ layout, label, batch }: { layout: CutLayout; label: string; batch?: CuttingBatch }) {
  const linear = batch?.kind === "profile";
  const required = batch ? cuttingBatchParts(batch, "required") : [];
  const extras = batch ? cuttingBatchParts(batch, "stock") : [];
  return <figure className="cut-layout" style={{ margin: "16px 0", breakInside: "avoid" }}>
    <figcaption>{label} · {linear ? `${n(layout.length)} mm stock length` : `${n(layout.length)} × ${n(layout.width)} mm`} · {layout.placements.filter(p => !p.extraStock).length} required + {layout.placements.filter(p => p.extraStock).length} extra stock per layout{(layout.repeatCount ?? 1) > 1 ? ` · Repeat this layout ${layout.repeatCount} times` : ""}</figcaption>
    <svg role="img" aria-label={label} viewBox={`0 0 ${layout.length} ${linear ? 100 : layout.width}`} style={{ display: "block", width: "100%", minHeight: linear ? 100 : undefined, maxHeight: 600, border: "1px solid #596c61", background: "#f4f4f1", marginTop: 8 }}>
      <title>{label}</title>
      {layout.offcuts.map((r, i) => <rect key={`o${i}`} x={r.x} y={linear ? 20 : r.y} width={r.length} height={linear ? 60 : r.width} fill="#e3e6e1" stroke="#c4ccc4" />)}
      {layout.placements.map((p, i) => {
        const cx = p.x + p.length / 2, cy = linear ? 50 : p.y + p.width / 2;
        return <g key={`${p.part.id}:${p.piece}`}>
        <title>{`${p.part.kitchen} · ${p.part.elevation} · ${p.part.cabinet} · ${p.part.panel} · ${p.length} × ${p.width} mm · piece ${p.piece}`}</title>
        <rect x={p.x} y={linear ? 20 : p.y} width={p.length} height={linear ? 60 : p.width} fill={p.extraStock ? "#f7d77b" : PANEL_COLORS[i % PANEL_COLORS.length]} stroke="#405c4c" strokeWidth={2} />
        <text x={cx} y={cy} fill="#172b20" transform={!linear && p.width > p.length ? `rotate(90 ${cx} ${cy})` : undefined} textAnchor="middle" dominantBaseline="middle"
          fontSize={linear ? Math.min(38, p.length / 12) : Math.min(38, Math.min(p.width, p.length) / 3, Math.max(p.width, p.length) / 12)}>{`${i + 1}${p.extraStock ? " STOCK" : ""} · ${linear ? `${n(p.length)} mm` : `${n(p.length)} × ${n(p.width)} mm`}`}</text>
      </g>;
      })}
    </svg>
    <h4>Required kitchen panels / parts</h4><table className="production-table cut-parts-table" style={{ marginTop: 12, fontSize: 12 }}>
      <thead><tr><th>No.</th><th>Kitchen</th><th>Cabinet code</th><th>Panel</th><th>Length (mm)</th><th>Width (mm)</th>{batch && <th>Pieces in batch</th>}</tr></thead>
      <tbody>{batch ? required.map((p, i) => <tr key={i}><td>{p.position}</td><td>{p.kitchen}</td><td>{p.cabinet}</td><td>{p.panel}</td><td>{n(p.length)}</td><td>{linear ? "—" : n(p.width)}</td><td>{p.qty}</td></tr>)
        : layout.placements.filter(p => !p.extraStock).map((p, i) => <tr key={`${p.part.id}:${p.piece}`}><td>{i + 1}</td><td>{p.part.kitchen}</td><td>{p.part.cabinet}</td><td>{p.part.panel}</td><td>{n(p.length)}</td><td>{n(p.width)}</td></tr>)}</tbody>
    </table>
    {extras.length > 0 && <><h4>Extra stock panels / parts — not kitchen requirements</h4><table className="production-table"><thead><tr><th>No.</th><th>Source part</th><th>Length mm</th><th>Width mm</th><th>Extra stock quantity</th></tr></thead>
      <tbody>{extras.map((p, i) => <tr key={i}><td>{p.position}</td><td>{p.panel}</td><td>{p.length}</td><td>{linear ? "—" : p.width}</td><td>{p.qty}</td></tr>)}</tbody></table></>}
  </figure>;
}

export function ProductionBatch({ kitchens, browserWorkspace = false }: { kitchens: Kitchen[]; browserWorkspace?: boolean }) {
  const [browserKitchens, setBrowserKitchens] = useState<Kitchen[]>([]);
  useEffect(() => {
    if (browserWorkspace) setBrowserKitchens(readKitchenWorkspace().filter(entry => entry.rows.some(row => row["Record Type"] === "cabinet")).map(entry => ({
      id: entry.id, name: entry.name || "Untitled kitchen", owner: "This browser session", version: entry.savedCostingVersion ?? 0,
    })));
  }, [browserWorkspace]);
  const availableKitchens = browserWorkspace ? browserKitchens : kitchens;
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [inputs, setInputs] = useState<ProductionInput[]>([]);
  const [groups, setGroups] = useState<ProductionGroup[]>([]);
  const [settings, setSettings] = useState<Record<string, Partial<StockSettings>>>({});
  const [results, setResults] = useState<OptimizedGroup[]>([]);
  const [layoutPage, setLayoutPage] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const changed = () => { setStale(true); setResults([]); };
  async function loadKitchens() {
    setBusy(true); setError(""); setResults([]); setGroups([]); setInputs([]);
    try {
      const entries = Object.entries(selected).filter(([, count]) => count > 0);
      if (!entries.length || entries.length > 20) throw new Error("Select 1–20 saved kitchens for a batch.");
      if (entries.some(([, count]) => !Number.isSafeInteger(count) || count < 1)) throw new Error("Kitchen batch quantities must be positive whole numbers.");
      const [{ productionInputFromEntry }, ...saved] = await Promise.all([
        import("@/components/WoodBomBuilder"),
        ...entries.map(async ([id]) => {
          if (browserWorkspace) {
            const entry = readKitchenWorkspace().find(entry => entry.id === id);
            if (!entry) throw new Error("Kitchen is no longer in this browser session. Return to Builder and import it again.");
            return entry;
          }
          const response = await fetch(`/api/saved-costings/${encodeURIComponent(id)}`, { cache: "no-store" });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not load kitchen.");
          return (data.costing as SavedCosting).entry;
        }),
      ]);
      const loaded = (saved as KitchenWorkspaceEntry[]).map((entry, index) => {
        const input = productionInputFromEntry(entry);
        const count = entries[index][1];
        return { ...input, name: `${input.name} × ${count}`, parts: input.parts.map(p => ({ ...p, qty: p.qty * count })),
          supplies: input.supplies.map(p => ({ ...p, qty: p.qty * count })), foilCosting: input.foilCosting.map(p => ({ ...p, quantity: p.quantity * count })) };
      });
      setInputs(loaded); setGroups(productionGroups(loaded)); setSettings({}); setLayoutPage({}); setStale(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare production batch."); }
    finally { setBusy(false); }
  }
  function updateStock(key: string, patch: Partial<StockSettings>) {
    const group = groups.find(g => g.key === key);
    setSettings(old => ({ ...old, [key]: { ...(group ? defaultStockForGroup(group) : {}), ...old[key], ...patch } }));
    setResults([]); setLayoutPage({}); setError("");
  }
  async function optimize() {
    setError(""); setBusy(true); setResults([]);
    // Yield before CPU work so the running state is visible.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try { setResults(groups.map(group => optimizeRepeatedProductionGroup(group, settings[group.key]))); }
    catch (e) { setError(e instanceof Error ? e.message : "Optimization failed."); }
    finally { setBusy(false); }
  }
  async function exportBatch() {
    setBusy(true); setError("");
    try { const { exportProductionWorkbook } = await import("@/lib/production-export"); exportProductionWorkbook(inputs, results); }
    catch (e) { setError(e instanceof Error ? e.message : "Export failed."); }
    finally { setBusy(false); }
  }
  function downloadCharts() {
    const quantity = Object.values(selected).reduce((sum, value) => sum + value, 0);
    const html = cuttingChartHtml(results, inputs.map(input => input.name).join(" / "), quantity);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "Production_Opti_Cutting_Charts.html"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const layoutViews = useMemo(() => {
    const batches = productionCuttingBatches(results);
    return new Map<string, Array<{ layout: CutLayout; label: string; batch?: CuttingBatch }>>(results.map(g => [g.key,
      batches.filter(b => b.groupKey === g.key).map(batch => ({ layout: batchPreviewLayout(batch), label: cuttingBatchLabel(batch), batch }))]));
  }, [results]);
  const layoutCount = [...layoutViews.values()].reduce((sum, views) => sum + views.length, 0);
  return <main style={{ padding: 24, background: "#f4f6f3", color: "#1b2430", minHeight: "100vh", font: "14px system-ui,sans-serif" }}>
    <style>{`.production-table{border-collapse:collapse;width:100%}.production-table th,.production-table td{text-align:left;padding:9px;border-bottom:1px solid #d8e1d9}.production-table th{background:#e8f1eb}.print-only{display:none}@media print{@page{size:A4 landscape;margin:10mm}.no-print{display:none!important}.print-only{display:block}main{padding:0!important;background:white!important}.cut-layout{break-inside:avoid;page-break-inside:avoid}table{font-size:10px}}`}</style>
    <header><h1>Production batch · cutting &amp; hardware</h1><nav className="no-print" style={{ display: "flex", gap: 18 }}>{!browserWorkspace && <a href="/costings">Saved costings</a>}<a href="/builder">Builder</a><a href="/materials">Material selection</a></nav></header>
    <p>{browserWorkspace ? "Uses kitchens created or imported in this browser session. No shared cloud database is connected." : "Admin · uses locally saved kitchens."} Quoted costs and saved versions are never changed by optimization.</p>
    <section className="no-print" style={{ background: "white", padding: 18, margin: "20px 0" }}>
      <h2>1. Select kitchens</h2>
      <label>Search <input value={query} onChange={e => setQuery(e.target.value)} style={field} /></label>
      <table className="production-table"><thead><tr><th>Select</th><th>Kitchen</th><th>Created by</th><th>Batch quantity</th></tr></thead>
        <tbody>{availableKitchens.filter(k => `${k.name} ${k.owner}`.toLowerCase().includes(query.toLowerCase())).map(k => <tr key={k.id}>
          <td><input type="checkbox" aria-label={`Select ${k.name}`} checked={!!selected[k.id]} disabled={busy} onChange={e => { setSelected(old => ({ ...old, [k.id]: e.target.checked ? 1 : 0 })); changed(); }} /></td>
          <td>{k.name} · v{k.version}</td><td>{k.owner}</td>
          <td><input aria-label={`Batch quantity for ${k.name}`} type="number" min={1} step={1} style={field} value={selected[k.id] || 1} disabled={!selected[k.id] || busy}
            onChange={e => { setSelected(old => ({ ...old, [k.id]: Number(e.target.value) })); changed(); }} /></td>
        </tr>)}</tbody></table>
      {!availableKitchens.length && <p>{browserWorkspace ? "No kitchens in this browser session. Create or import a kitchen in Builder, then return here in the same tab." : "No saved kitchens. Save a kitchen in the builder first."}</p>}
      <button disabled={busy || !Object.values(selected).some(Boolean)} onClick={() => void loadKitchens()} style={{ marginTop: 14 }}>Load selected kitchens</button>
      {stale && <p>Selection changed. Reload selected kitchens before running.</p>}
    </section>
    {error && <p role="alert" style={{ color: "#a13520" }}>{error}</p>}
    {groups.length > 0 && !stale && <>
      <section className="no-print"><h2>2. Material cutting settings</h2>
        <p>Provisional defaults: 2440 × 1220 mm sheets, 3 mm saw kerf, 10 mm trimming on each edge. Confirm with your factory. Parts rotate automatically to fit an existing sheet before another sheet is opened. Thicknesses remain as defined in the builder.</p>
        <OptiMaterialOptions groups={groups} settings={settings} busy={busy} onChange={updateStock} />
        <p>Materials are never mixed on one stock item. Glass, stone and profiles need their actual stock dimensions before enabling optimization. Foil layouts do not include vacuum-press wrapping margins; review those allowances at the factory.</p>
        <button disabled={busy} onClick={() => void optimize()}>{busy ? "Working…" : "3. Generate cutting layouts"}</button>
      </section>
      {results.length > 0 && <section>
        <div className="no-print" style={{ display: "flex", gap: 12, margin: "20px 0" }}>
          <button disabled={busy} onClick={() => void exportBatch()}>Export factory workbook (.xlsx)</button>
          <button disabled={busy} onClick={downloadCharts}>Download cutting charts + summary</button>
          <button disabled={layoutCount > 300} onClick={() => window.print()}>Print cutting charts only</button>
          {layoutCount > 300 && <span>More than 300 layouts: use the Excel export or split the batch for printing.</span>}
        </div>
        <h2>Production summary</h2>
        <p>Guillotine/shelf heuristic—not a guaranteed global minimum. Sheet waste already includes the layout kerf, trim and offcuts; no standard board waste is added again. This report does not update costing.</p>
        <ProductionOptiSummary groups={results} />
        {results.some(g => g.unplaced.length) && <section role="alert"><h3>Unplaced parts — incomplete cutting plan</h3><ul>{results.flatMap(g => g.unplaced.map(({ part, reason }) => <li key={part.id}>{part.kitchen} / {part.cabinet}: {part.panel}, {part.length} × {part.width} mm × {part.qty}. {reason}</li>))}</ul></section>}
        {results.filter(g => g.layouts.length).map(g => {
          const views = layoutViews.get(g.key)!;
          const page = Math.min(layoutPage[g.key] ?? 0, views.length - 1);
          const current = views[page];
          return <section key={g.key}>
          <h3>{g.material} · {g.finish} · {g.thickness || "—"} mm {g.kind === "foil" ? `· ${g.parts[0].role} foil roll` : ""}</h3>
          <div className="no-print"><label>Preview {g.kind === "foil" ? "roll" : "cutting batch"} <select value={page} onChange={e => setLayoutPage(old => ({ ...old, [g.key]: Number(e.target.value) }))}>{views.map((view, i) => <option key={view.layout.number} value={i}>{view.label}</option>)}</select></label>
            <LayoutDrawing layout={current.layout} batch={current.batch} label={`${g.material} · ${g.finish} · ${current.label}`} />
          </div>
          {layoutCount <= 300 && <div className="print-only">{views.map(view => <LayoutDrawing key={view.layout.number} layout={view.layout} batch={view.batch} label={`${g.material} · ${g.finish} · ${view.label}`} />)}</div>}
        </section>; })}
        <p className="no-print">Hardware, other cut lists and foil costing remain in the Excel workbook, separate from these cutting charts.</p>
        <details className="no-print"><summary>Builder warnings / missing rates ({inputs.reduce((sum, input) => sum + input.warnings.length, 0)})</summary><ul>{inputs.flatMap(input => input.warnings.map((warning, i) => <li key={`${input.id}:${i}`}>{warning}</li>))}</ul></details>
      </section>}
    </>}
  </main>;
}
