"use client";
import { useMemo } from "react";
import { productionReportSummary } from "@/lib/production-report";
import { isSheetMaterial, type OptimizedGroup } from "@/lib/production-optimizer";

const n = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
export function ProductionOptiSummary({ groups }: { groups: OptimizedGroup[] }) {
  const report = useMemo(() => productionReportSummary(groups), [groups]);
  return <>
    <p><strong>Total sheets: {n(report.totalSheets)}</strong> · Cutting batches: {report.totalBatches}. Required quantities exclude extra stock. Yellow panels are additional production for inventory; their processing estimates are not added to the kitchen quote.</p>
    <table className="production-table"><thead><tr><th>Material / finish</th><th>Thickness</th><th>Cutting batches</th><th>Stock used</th><th>Stock sqft / metres</th><th>Waste before stock</th><th>Extra stock pieces</th><th>Remaining waste</th><th>Extra processing estimate</th><th>Unplaced</th></tr></thead>
      <tbody>{report.materials.map(m => <tr key={m.key}><td>{m.material} · {m.finish}</td><td>{m.thickness || "—"} mm</td><td>{m.batches}</td>
        <td>{m.skipped ? "Not optimized — enable and set stock size" : isSheetMaterial(m.kind) ? `${n(m.sheets)} sheets` : m.kind === "profile" ? `${m.stockUnits} lengths × ${n(m.stockLengthMm / 1000)}m` : `${n(m.rollLengthMm / 1000)} m × 1420 mm roll`}</td>
        <td>{m.kind === "profile" ? `${n(m.stockSqft * 92903.04 / 1000)} m` : `${n(m.stockSqft)} sqft`}</td><td>{n(m.wastePct)}%</td><td>{n(m.extraStockCount)}</td><td>{n(m.remainingWastePct)}%</td>
        <td>{m.extraProcessingCost === undefined ? "Not defined" : `₹${n(m.extraProcessingCost)}`}</td><td>{m.unplaced}</td></tr>)}</tbody>
      <tfoot><tr><th colSpan={3}>Sheet-material totals</th><th>{n(report.totalSheets)} sheets</th><th>{n(report.totalStockSqft)} sqft</th><th>{n(report.wastePct)}%</th><th colSpan={4}>Rolls and linear stock are reported separately</th></tr></tfoot>
    </table>
    <h3>Cutting batch summary</h3>
    <p>Identical cutting charts are combined into one batch. Sheets in batch is the total number of sheets using that same layout—not a number of kitchens. Sheet numbering restarts for each material group.</p>
    <div style={{ overflowX: "auto" }}><table className="production-table"><thead><tr><th>Batch</th><th>Material / finish</th><th>Thickness</th><th>Stock references</th><th>Sheets in batch / lengths / roll segments</th><th>Required pieces / stock unit</th><th>Total required pieces</th><th>Extra stock pieces</th><th>Remaining waste</th></tr></thead>
      <tbody>{report.batches.map(b => <tr key={b.id}><td>{b.id}</td><td>{b.material} · {b.finish}</td><td>{b.thickness} mm</td><td>{b.sheetRanges}</td><td>{n(b.sheets)}</td><td>{b.piecesPerSheet}</td><td>{n(b.totalPieces)}</td><td>{n(b.extraStockPieces)}</td><td>{n(b.remainingWastePct)}%</td></tr>)}</tbody>
      <tfoot><tr><th colSpan={4}>Total sheets in cutting batches</th><th>{n(report.totalSheets)}</th><td /><th>{n(report.batches.reduce((sum, b) => sum + b.totalPieces, 0))}</th><th>{n(report.batches.reduce((sum, b) => sum + b.extraStockPieces, 0))}</th><td /></tr></tfoot>
    </table></div>
    <h3>Extra stock panels / parts — separate from kitchen requirements</h3>
    {!report.extraStock.length ? <p>No extra stock produced.</p> : <table className="production-table"><thead><tr><th>Material / finish</th><th>Part</th><th>Length mm</th><th>Width mm</th><th>Extra quantity</th><th>Stock sqft / metres</th><th>Processing estimate</th></tr></thead><tbody>
      {report.extraStock.map((p, i) => <tr key={i}><td>{p.material} · {p.finish}</td><td>{p.panel}</td><td>{p.length}</td><td>{p.kind === "profile" ? "—" : p.width}</td><td>{p.qty}</td><td>{p.kind === "profile" ? `${n(p.metres)}m` : `${n(p.areaSqft)} sqft`}</td><td>{p.processingCost === undefined ? "Not defined" : `₹${n(p.processingCost)}`}</td></tr>)}
    </tbody></table>}
  </>;
}
