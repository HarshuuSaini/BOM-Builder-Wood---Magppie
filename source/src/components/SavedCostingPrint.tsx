"use client";

import { useEffect, useMemo, useRef } from "react";
import type { SavedCosting } from "@/lib/local-costing-store";
import { encodeProjectPrintData } from "@/lib/print-project";
import { comparisonProjectPricing } from "@/lib/comparison-project-pricing";
import { PriceChangeSummary } from "@/components/PriceChangeSummary";
import { priceChangesFor } from "@/lib/price-change-audit";

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
const number = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);

/** Print the saved quote without opening an editor or changing any browser drafts. */
export function SavedCostingPrint({ costing, admin }: { costing: SavedCosting; admin: boolean }) {
  const snapshot = costing.entry.costing;
  const printed = useRef(false);
  const restoreLines = useMemo(() => encodeProjectPrintData(costing.entry.rows), [costing.entry.rows]);
  const pricing = comparisonProjectPricing(costing.entry);
  const categories = [...new Set(snapshot?.items.map(item => item.category) ?? [])];
  useEffect(() => {
    document.title = `${costing.name} — Costing`;
    if (!snapshot) return;
    let cancelled = false;
    void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!cancelled && !printed.current) { printed.current = true; window.print(); }
    })));
    return () => { cancelled = true; };
  }, [costing.name, snapshot]);
  return <main className="saved-costing-print">
    <style>{`
      .saved-costing-print{max-width:1100px;margin:24px auto;padding:28px;background:white;color:#1b2430;font:14px system-ui,sans-serif}
      .saved-costing-print h1{margin:0 0 8px}.saved-costing-print h2{font-size:18px;margin-top:28px}
      .saved-costing-print .print-tools{display:flex;align-items:center;gap:18px;margin-bottom:24px}
      .saved-costing-print button{border:1px solid #15645a;border-radius:8px;background:#15645a;color:white;padding:10px 18px;font:600 14px system-ui;cursor:pointer}
      .saved-costing-print a{color:#15645a}.saved-costing-print table{border-collapse:collapse;width:100%;margin-top:12px}
      .saved-costing-print th,.saved-costing-print td{padding:9px 10px;border:1px solid #d9e0dc;text-align:left;vertical-align:top}
      .saved-costing-print thead,.saved-costing-print .print-total{background:#e9f3ed;font-weight:700}
      .saved-costing-print .numeric{text-align:right;white-space:nowrap}.saved-costing-print .print-restore{margin-top:32px;break-before:page}
      .saved-costing-print .restore-line{font:8px/1.5 monospace;white-space:nowrap}.saved-costing-print .quote-summary{max-width:700px;margin-left:auto}
      @page{size:A4 portrait;margin:12mm}
      @media print{
        body:has(.saved-costing-print) .ai-copilot-trigger,body:has(.saved-costing-print) .ai-copilot-window{display:none!important}
        .saved-costing-print{max-width:none;margin:0;padding:0;font-size:9pt}.saved-costing-print .print-tools{display:none}
        .saved-costing-print thead{display:table-header-group}.saved-costing-print tr{break-inside:avoid}.saved-costing-print h2{break-after:avoid}
        .saved-costing-print th,.saved-costing-print td{padding:5px}.saved-costing-print .restore-line{font-size:6pt}
        .saved-costing-print .costing-comparison th,.saved-costing-print .costing-comparison td{min-width:0!important;white-space:normal!important;overflow-wrap:anywhere}
      }
    `}</style>
    <div className="print-tools"><button type="button" disabled={!snapshot} onClick={() => window.print()}>Print / Save as PDF</button><a href="/costings">Saved costings</a><span>Choose “Save as PDF” and include every page to keep the kitchen importable.</span></div>
    <h1>{costing.name}</h1>
    <p>Kitchen costing · Saved version {costing.version} · Created by {costing.owner}</p>
    <p>Last saved {new Date(costing.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · Total sqft: <strong>{number(costing.areaSqft)}</strong></p>
    {!snapshot ? <p role="alert">This kitchen has no saved costing breakdown. Open it in the Builder and save its costing before printing.</p> : <>
      {categories.map(category => <section key={category}><h2>{category}</h2><table><thead><tr><th>Material / item</th><th>Quantity</th><th>Unit</th><th>Rate</th><th>Cost</th></tr></thead><tbody>
        {snapshot.items.filter(item => item.category === category).map((item, index) => <tr key={`${item.itemCode}-${index}`}><td>{item.item}<small style={{ display: "block", color: "#607168" }}>{item.itemCode}</small></td><td className="numeric">{number(item.quantity)}</td><td>{item.unit}</td><td className="numeric">{money(item.rate)}</td><td className="numeric">{money(item.amount)}</td></tr>)}
        <tr><th colSpan={4}>Category total</th><td className="numeric">{money(snapshot.items.filter(item => item.category === category).reduce((sum, item) => sum + item.amount, 0))}</td></tr>
      </tbody></table></section>)}
      <h2>Costing summary</h2><table className="quote-summary"><tbody>
        <tr><th>Item cost</th><td className="numeric">{money(snapshot.materialCost)}</td></tr>
        {admin && <>
          <tr><th>Transportation</th><td className="numeric">{money(pricing.transportation)}</td></tr>
          <tr><th>Installation</th><td className="numeric">{money(pricing.installation)}</td></tr>
          <tr><th>Loading / unloading</th><td className="numeric">{money(pricing.loading)}</td></tr>
          <tr><th>Items + services subtotal</th><td className="numeric">{money(pricing.combined)}</td></tr>
          <tr><th>Conversion{pricing.rates.conversionPct !== null ? ` (${number(pricing.rates.conversionPct)}% margin)` : ""}</th><td className="numeric">{money(pricing.conversion)}</td></tr>
          <tr><th>Subtotal before tax</th><td className="numeric">{money(pricing.subtotal)}</td></tr>
          <tr><th>GST (18%){pricing.rates.includeTax ? "" : " — not included"}</th><td className="numeric">{money(pricing.tax)}</td></tr>
          <tr className="print-total"><th>Final project price</th><td className="numeric">{money(pricing.total)}</td></tr>
        </>}
      </tbody></table>
      {!!snapshot.unpriced.length && <p>Rates awaiting definition: {snapshot.unpriced.join(", ")}</p>}
      <PriceChangeSummary changes={priceChangesFor(costing.entry, costing.entry)} />
      <section className="print-restore"><h2>Project restore data</h2><p>Keep this final section when saving the PDF. Import this PDF in the Builder to restore the saved kitchen.</p>{restoreLines.map(line => <div key={line.slice(0, 11)} className="restore-line">{line}</div>)}</section>
    </>}
  </main>;
}
