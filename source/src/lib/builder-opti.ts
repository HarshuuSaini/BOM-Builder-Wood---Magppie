import { productionGroups, optimizeRepeatedProductionGroup, productionSheetCount, isSheetMaterial, type ProductionInput, type OptimizedGroup, type StockSettings } from "./production-optimizer";
import { productionReportSummary, cuttingBatchLabel, batchPreviewLayout, cuttingBatchParts } from "./production-report";

export type OptiAllocation = { sheets: number; netSqft: number; wastePct: number; batchSheets: number };
export type BuilderOpti = { fingerprint: string; batch: number; allocations: Record<string, OptiAllocation> };
export function optiFingerprint(source: unknown): string {
  const text = JSON.stringify(source);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
export function runBuilderOpti(input: ProductionInput, batch: number, fingerprint: string, options: Record<string, Partial<StockSettings>> = {}) {
  if (!Number.isSafeInteger(batch) || batch < 1) throw new Error("Batch quantity must be a positive whole number.");
  const scaled: ProductionInput = { ...input, name: `${input.name} × ${batch}`, parts: input.parts.map(p => ({ ...p, qty: p.qty * batch })),
    supplies: input.supplies.map(p => ({ ...p, qty: p.qty * batch })), foilCosting: input.foilCosting.map(p => ({ ...p, quantity: p.quantity * batch })) };
  const groups = productionGroups([scaled]).map(g => optimizeRepeatedProductionGroup(g, options[g.key]));
  if (!groups.some(g => !g.skipped)) throw new Error("Enable a raw material and enter its stock dimensions before running Opti.");
  const unplaced = groups.flatMap(g => g.unplaced);
  if (unplaced.length) throw new Error(`Opti not applied: ${unplaced.length} panel types do not fit the stock. ${unplaced[0].part.panel}: ${unplaced[0].reason}. Review stock sizes on the production page.`);
  const allocations: Record<string, OptiAllocation> = {};
  for (const g of groups) {
    if (g.kind !== "board" || g.skipped) continue;
    const areas = new Map<string, number>();
    for (const p of g.parts) {
      if (!p.costingKey) throw new Error(`Costing link missing for ${p.panel}.`);
      areas.set(p.costingKey, (areas.get(p.costingKey) ?? 0) + p.length * p.width * p.qty);
    }
    const area = [...areas.values()].reduce((a, b) => a + b, 0);
    for (const [key, net] of areas) allocations[key] = {
      sheets: productionSheetCount(g) * net / area / batch, netSqft: net / batch / 92903.04,
      wastePct: g.wastePct, batchSheets: productionSheetCount(g) * net / area,
    };
  }
  return { input: scaled, groups, saved: { fingerprint, batch, allocations } satisfies BuilderOpti };
}

/** Standalone printable chart: only actual panels, dimensions and cutting layouts. */
export function cuttingChartHtml(groups: OptimizedGroup[], kitchen: string, batch: number) {
  const esc = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const n = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const report = productionReportSummary(groups);
  const table = (headers: string[], rows: unknown[][]) => `<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const productionSummary = `<section><h2>Production summary</h2>${report.materials.some(m => m.unplaced > 0) ? '<p style="color:#a13520"><strong>Incomplete cutting plan: unplaced parts must be reviewed before factory cutting.</strong></p>' : ""}<p>Kitchen quantity: ${batch} · Total sheet material sheets: ${n(report.totalSheets)} · Cutting batches: ${report.totalBatches}</p>
    <p>Extra stock uses existing offcuts only. Yellow parts are extra stock, excluded from required kitchen quantities and costing. Processing estimates are separate; undefined rates require review.</p>
    ${table(["Material / finish", "Thickness", "Cutting batches", "Sheets / roll length", "Layout stock sqft", "Waste before extra stock", "Extra stock pieces", "Remaining waste", "Extra processing Rs", "Unplaced"], report.materials.map(m => [
      `${m.material} · ${m.finish}`, `${m.thickness} mm`, m.batches, m.skipped ? "Cut list only — enable stock to optimize" : isSheetMaterial(m.kind) ? `${n(m.sheets)} sheets` : m.kind === "profile" ? `${n(m.stockUnits)} lengths × ${m.stockLengthMm}mm` : `${n(m.rollLengthMm / 1000)} m × 1420 mm roll`, m.kind === "profile" ? "—" : n(m.stockSqft), `${n(m.wastePct)}%`, m.extraStockCount, `${n(m.remainingWastePct)}%`, m.extraProcessingCost === undefined ? "Not defined" : n(m.extraProcessingCost), m.unplaced]))}
    <p><strong>Sheet material totals: ${n(report.totalSheets)} sheets · Stock ${n(report.totalStockSqft)} sqft · Weighted waste before extra stock ${n(report.wastePct)}%</strong></p>
    <h2>Cutting batch summary</h2><p>Identical cutting charts are combined into one batch. Sheets in batch is the number of sheets using that same layout, not a number of kitchens. Sheet references restart for each material group.</p>
    ${table(["Batch", "Material / finish", "Thickness", "Stock references", "Sheets in batch / lengths / roll segments", "Required pieces / layout", "Total required pieces", "Extra stock pieces", "Waste before stock", "Remaining waste"], report.batches.map(b => [
      b.id, `${b.material} · ${b.finish}`, `${b.thickness} mm`, b.sheetRanges, b.sheets, b.piecesPerSheet, n(b.totalPieces), b.extraStockPieces, `${n(b.wastePct)}%`, `${n(b.remainingWastePct)}%`]))}
    <h2>Extra stock panels / parts</h2>${table(["Material / finish", "Thickness", "Source cabinet", "Panel", "Length mm", "Width mm", "Extra pieces", "Processing estimate Rs"], report.extraStock.map(p => [
      `${p.material} · ${p.finish}`, p.thickness, p.sourceCabinet, p.panel, p.length, p.kind === "profile" ? "—" : p.width, p.qty, p.processingCost === undefined ? "Not defined" : n(p.processingCost)]))}
    <p><strong>Total sheets in cutting batches: ${n(report.totalSheets)}</strong></p></section>`;
  const charts = report.batches.map(cuttingBatch => {
    const g = groups[cuttingBatch.groupIndex];
    const l = batchPreviewLayout(cuttingBatch);
    const repeats = cuttingBatch.sheets;
    const sheetLabel = `Sheet references ${cuttingBatch.sheetRanges} · Repeat this layout ${repeats} time${repeats === 1 ? "" : "s"}`;
    const linear = g.kind === "profile";
    const drawing = l.placements.map((p, i) => {
      const y = linear ? 20 : p.y, height = linear ? 60 : p.width;
      return `<rect x="${p.x}" y="${y}" width="${p.length}" height="${height}" fill="${p.extraStock ? "#f7d77b" : "#d9e9df"}" stroke="#405c4c"/><text x="${p.x + p.length / 2}" y="${y + height / 2}" text-anchor="middle" font-size="${Math.min(30, Math.min(p.length, height) / 5)}" ${!linear && p.width > p.length ? `transform="rotate(90 ${p.x + p.length / 2} ${y + height / 2})"` : ""}>${i + 1} · ${p.length}${linear ? "" : ` × ${p.width}`}mm${p.extraStock ? " STOCK" : ""}</text>`;
    }).join("");
    const partTable = (purpose: "required" | "stock") => table(["No.", "Kitchen", "Cabinet code", "Panel", "Length (mm)", "Width (mm)", "Pieces in batch"], cuttingBatchParts(cuttingBatch, purpose).map(p => [p.position, p.kitchen, p.cabinet, p.panel, p.length, linear ? "—" : p.width, p.qty]));
    return `<section id="${cuttingBatch.id}"><h2>${esc(cuttingBatchLabel(cuttingBatch))}</h2><h3>${esc(g.material)} · ${esc(g.finish)} · ${g.thickness}mm · ${sheetLabel}</h3>
      <p>${l.length}${linear ? "" : ` × ${l.width}`}mm · Total material stock units ${productionSheetCount(g)} · Waste before stock ${g.wastePct.toFixed(2)}% · Kerf ${g.stock.kerf}mm · Trim ${g.stock.trim}mm · Grain ${g.stock.grainLocked ? "locked" : "rotation allowed"} · Priority ${esc(g.stock.priority ?? "auto")} · Overproduction ${g.stock.overproduction ? "on" : "off"}</p>
      ${g.optimizationNote ? `<p>${esc(g.optimizationNote)}</p>` : ""}
      <svg viewBox="0 0 ${l.length} ${linear ? 100 : l.width}">${drawing}</svg><h3>Required kitchen parts</h3>${partTable("required")}${cuttingBatch.extraStockPieces ? `<h3>Extra stock — yellow parts</h3>${partTable("stock")}` : ""}</section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Opti cutting chart</title><style>body{font:14px Arial;margin:24px}section{break-after:page}svg{width:100%;max-height:60vh;border:1px solid #555}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #ccc;padding:6px;text-align:left}th{background:#e6eee9}tr{break-inside:avoid}thead{display:table-header-group}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print / Save as PDF</button><h1>${esc(kitchen)} · Kitchen quantity ${batch}</h1>${productionSummary}${charts}</body></html>`;
}
