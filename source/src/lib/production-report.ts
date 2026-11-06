import { PRODUCTION_SQMM_PER_SQFT, productionSheetCount, isSheetMaterial, extraStockMetrics, type CutLayout, type OptimizedGroup, type ProductionPart } from "./production-optimizer";

/** Ignore cabinet IDs/piece numbering, but preserve the actual cut geometry and machining. */
export function cuttingPatternKey(layout: CutLayout): string {
  const rects = layout.placements.map(p => [p.x, p.y, p.length, p.width, p.part.grainLocked || p.part.drill ? p.rotated : false, p.part.grainLocked, p.part.edgeBand, p.part.drill, !!p.extraStock]);
  return JSON.stringify([layout.length, layout.width, rects.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}

type LayoutSource = { layoutIndex: number; layout: CutLayout };
export type CuttingBatch = { id: string; groupKey: string; groupIndex: number; layoutIndex: number; sources: LayoutSource[];
  kind: ProductionPart["kind"];
  material: string; finish: string; thickness: number; sheetStart: number; sheetEnd: number; sheetRanges: string;
  sheets: number; stockSqft: number; netSqft: number; wastePct: number; piecesPerSheet: number; totalPieces: number;
  extraPiecesPerSheet: number; extraStockPieces: number; extraStockSqft: number; remainingWastePct: number };

function sourceSheetRanges(sources: LayoutSource[]) {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const { layout } of [...sources].sort((a, b) => a.layout.number - b.layout.number)) {
    const start = layout.number, end = start + (layout.repeatCount ?? 1) - 1;
    const previous = ranges.at(-1);
    if (previous && start === previous.end + 1) previous.end = end;
    else ranges.push({ start, end });
  }
  return ranges.map(r => r.start === r.end ? String(r.start) : `${r.start}–${r.end}`).join(", ");
}

/** A cutting batch is one layout repeated on its stated number of sheets, not a kitchen count. */
export function productionCuttingBatches(groups: OptimizedGroup[]) {
  let next = 1;
  const batches: CuttingBatch[] = [];
  groups.forEach((group, groupIndex) => {
    if (group.skipped) return;
    const patterns = new Map<string, LayoutSource[]>();
    group.layouts.forEach((layout, layoutIndex) => {
      const key = cuttingPatternKey(layout);
      const sources = patterns.get(key) ?? []; sources.push({ layoutIndex, layout }); patterns.set(key, sources);
    });
    for (const sources of patterns.values()) {
      const layout = sources[0].layout;
      const sheets = sources.reduce((sum, source) => sum + (source.layout.repeatCount ?? 1), 0);
      const stockSqft = layout.length * layout.width * sheets / PRODUCTION_SQMM_PER_SQFT;
      const netSqft = layout.placements.filter(p => !p.extraStock).reduce((sum, p) => sum + p.length * p.width, 0) * sheets / PRODUCTION_SQMM_PER_SQFT;
      const extraStockSqft = layout.placements.filter(p => p.extraStock).reduce((sum, p) => sum + p.length * p.width, 0) * sheets / PRODUCTION_SQMM_PER_SQFT;
      const requiredCount = layout.placements.filter(p => !p.extraStock).length, extraCount = layout.placements.length - requiredCount;
      batches.push({ id: `B${String(next++).padStart(3, "0")}`, groupKey: group.key, groupIndex, layoutIndex: sources[0].layoutIndex, sources,
        material: group.material, finish: group.finish, thickness: group.thickness,
        kind: group.kind,
        sheetStart: Math.min(...sources.map(s => s.layout.number)), sheetEnd: Math.max(...sources.map(s => s.layout.number + (s.layout.repeatCount ?? 1) - 1)), sheetRanges: sourceSheetRanges(sources), sheets,
        stockSqft, netSqft, wastePct: stockSqft ? 100 * (1 - netSqft / stockSqft) : 0,
        piecesPerSheet: requiredCount, totalPieces: requiredCount * sheets, extraPiecesPerSheet: extraCount, extraStockPieces: extraCount * sheets, extraStockSqft,
        remainingWastePct: stockSqft ? Math.max(0, 100 * (1 - (netSqft + extraStockSqft) / stockSqft)) : 0 });
    }
  });
  return batches;
}
export function cuttingBatchLabel(batch: CuttingBatch) {
  const unit = batch.kind === "profile" ? "stock lengths" : batch.kind === "foil" ? "roll segments" : "sheets";
  return `Cutting batch ${batch.id} · ${batch.sheets} ${unit} · References ${batch.sheetRanges}`;
}

/** Preserve every source cabinet when differently labelled pieces share a cutting chart. */
export function cuttingBatchParts(batch: CuttingBatch, purpose: "required" | "stock" | "all" = "all") {
  const rows = new Map<string, { position: number; kitchen: string; cabinet: string; panel: string; length: number; width: number; qty: number; purpose: "Required" | "Extra stock" }>();
  const order = (l: CutLayout) => [...l.placements].sort((a, b) => a.x - b.x || a.y - b.y || a.length - b.length || a.width - b.width);
  for (const { layout } of batch.sources) order(layout).forEach((p, index) => {
    if (purpose === "required" && p.extraStock || purpose === "stock" && !p.extraStock) return;
    const key = JSON.stringify([index, p.part.kitchen, p.part.cabinet, p.part.panel, p.length, p.width, !!p.extraStock]);
    const row = rows.get(key);
    if (row) row.qty += layout.repeatCount ?? 1;
    else rows.set(key, { position: index + 1, kitchen: p.part.kitchen, cabinet: p.part.cabinet, panel: p.part.panel,
      length: p.length, width: p.width, qty: layout.repeatCount ?? 1, purpose: p.extraStock ? "Extra stock" : "Required" });
  });
  return [...rows.values()];
}

export function batchPreviewLayout(batch: CuttingBatch): CutLayout {
  const first = batch.sources[0].layout;
  return { ...first, repeatCount: batch.sheets, placements: [...first.placements].sort((a, b) => a.x - b.x || a.y - b.y || a.length - b.length || a.width - b.width) };
}
export function productionReportSummary(groups: OptimizedGroup[]) {
  const batches = productionCuttingBatches(groups);
  const materials = groups.map(group => ({
    key: group.key, kind: group.kind, material: group.material, finish: group.finish, thickness: group.thickness,
    batches: batches.filter(b => b.groupKey === group.key).length,
    sheets: isSheetMaterial(group.kind) ? productionSheetCount(group) : 0,
    stockUnits: productionSheetCount(group), stockLengthMm: group.stock.length, skipped: !!group.skipped,
    rollLengthMm: group.rollLengthMm, stockSqft: group.purchasedSqft, netSqft: group.netSqft, wastePct: group.wastePct,
    unplaced: group.unplaced.reduce((sum, p) => sum + p.part.qty, 0),
    ...extraStockMetrics(group.layouts, group.kind, group.purchasedSqft, group.netSqft),
  }));
  const boards = materials.filter(m => isSheetMaterial(m.kind));
  const totalSheets = boards.reduce((sum, m) => sum + m.sheets, 0);
  const totalStockSqft = boards.reduce((sum, m) => sum + m.stockSqft, 0);
  const totalNetSqft = boards.reduce((sum, m) => sum + m.netSqft, 0);
  return { materials, batches, totalSheets, totalBatches: batches.length, totalStockSqft,
    extraStock: productionExtraStockRows(groups),
    wastePct: totalStockSqft ? 100 * (1 - totalNetSqft / totalStockSqft) : 0 };
}

export function productionExtraStockRows(groups: OptimizedGroup[]) {
  const rows = new Map<string, { material: string; finish: string; thickness: number; kind: ProductionPart["kind"]; panel: string; sourceCabinet: string;
    length: number; width: number; qty: number; areaSqft: number; metres: number; processingRate?: number; processingCost?: number }>();
  for (const g of groups) for (const l of g.layouts) for (const p of l.placements.filter(p => p.extraStock)) {
    const key = JSON.stringify([g.key, p.part.id, p.length, p.width, p.extraProcessingRate]);
    const qty = l.repeatCount ?? 1, area = p.length * p.width * qty / PRODUCTION_SQMM_PER_SQFT, metres = p.length * qty / 1000;
    const found = rows.get(key);
    if (found) { found.qty += qty; found.areaSqft += area; found.metres += metres;
      if (found.processingCost !== undefined) found.processingCost += (g.kind === "profile" ? metres : area) * p.extraProcessingRate!;
    } else rows.set(key, { material: g.material, finish: g.finish, thickness: g.thickness, kind: g.kind, panel: p.part.panel, sourceCabinet: p.part.cabinet,
      length: p.length, width: p.width, qty, areaSqft: area, metres, processingRate: p.extraProcessingRate,
      processingCost: p.extraProcessingRate === undefined ? undefined : (g.kind === "profile" ? metres : area) * p.extraProcessingRate });
  }
  return [...rows.values()];
}

