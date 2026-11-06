/** Production geometry only. Never writes back to quoted costing. All dimensions are mm. */
export type ProductionPart = {
  id: string; kitchenId: string; kitchen: string; elevation: string; cabinet: string;
  panel: string; role: string; materialId: string; material: string; finish: string;
  thickness: number; length: number; width: number; qty: number; rate: number;
  kind: "board" | "foil" | "glass" | "stone" | "profile";
  edgeBand: string; drill: string; grainLocked: boolean;
  costingKey?: string;
  processingRate?: number;
  stockLengthMm?: number;
  stockWidthMm?: number;
};
export type ProductionSupply = {
  kitchen: string; elevation: string; cabinet: string; pack: string; itemCode: string;
  item: string; qty: number; unit: string; orderFrom: string;
};
export type ProductionInput = {
  id: string; name: string; version: number; parts: ProductionPart[];
  supplies: ProductionSupply[]; foilCosting: { role: string; quantity: number; rate: number; unit: string }[];
  bom?: Record<string, unknown>[];
  warnings: string[];
};
export type CuttingPriority = "auto" | "quantity" | "length";
export type StockSettings = { length: number; width: number; kerf: number; trim: number; grainLocked: boolean;
  priority?: CuttingPriority; overproduction?: boolean; enabled?: boolean; extraProcessingRate?: number };
export const DEFAULT_PRODUCTION_STOCK: StockSettings = { length: 2440, width: 1220, kerf: 3, trim: 10, grainLocked: false };
export type Rect = { x: number; y: number; length: number; width: number };
export type PlacedPart = Rect & { part: ProductionPart; piece: number; rotated: boolean; extraStock?: boolean; extraProcessingRate?: number };
export type CutLayout = { number: number; length: number; width: number; placements: PlacedPart[]; offcuts: Rect[]; repeatCount?: number };
export type ProductionGroup = {
  key: string; kind: ProductionPart["kind"]; material: string; finish: string; thickness: number;
  rate: number; parts: ProductionPart[];
};
export type OptimizedGroup = ProductionGroup & {
  optimizationNote?: string;
  skipped?: boolean;
  extraStockCount?: number;
  extraStockSqft?: number;
  extraStockMetres?: number;
  extraProcessingCost?: number;
  remainingWastePct?: number;
  stock: StockSettings; layouts: CutLayout[]; unplaced: { part: ProductionPart; reason: string }[];
  netSqft: number; purchasedSqft: number; wastePct: number; rollLengthMm: number;
};
export const PRODUCTION_SQMM_PER_SQFT = 92903.04;
export function isSheetMaterial(kind: ProductionPart["kind"]) { return ["board", "glass", "stone"].includes(kind); }
export function defaultStockForGroup(group: ProductionGroup): StockSettings {
  if (group.kind === "board") return { ...DEFAULT_PRODUCTION_STOCK, enabled: true, priority: "quantity" };
  if (group.kind === "foil") return { ...DEFAULT_PRODUCTION_STOCK, length: 2440, width: 1420, kerf: 0, trim: 0, enabled: true, priority: "quantity" };
  const p = group.parts[0];
  return { ...DEFAULT_PRODUCTION_STOCK, length: p?.stockLengthMm ?? 0, width: group.kind === "profile" ? 1 : p?.stockWidthMm ?? 0,
    kerf: group.kind === "glass" ? 0 : 3, trim: 0, enabled: false, priority: "quantity" };
}
export function validOptiSettings(value: unknown): value is Record<string, Partial<StockSettings>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).length <= 1000 && Object.entries(value).every(([key, v]) => key.length <= 10000 && v && typeof v === "object" && !Array.isArray(v) &&
    Object.entries(v).every(([field, n]) => ["enabled", "grainLocked", "overproduction"].includes(field) ? typeof n === "boolean"
      : field === "priority" ? ["auto", "quantity", "length"].includes(String(n))
      : ["length", "width", "kerf", "trim", "extraProcessingRate"].includes(field) && typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= (field === "extraProcessingRate" ? 1000000 : 50000)));
}
export function productionGroupKey(part: ProductionPart): string {
  // Foil roles stay separate; unlike costing, identical boards may share a production sheet.
  return JSON.stringify([part.kind, part.materialId, part.material, part.finish, part.thickness, part.rate,
    part.kind === "foil" ? part.role : ""]);
}
export function productionGroups(inputs: ProductionInput[]): ProductionGroup[] {
  const groups = new Map<string, ProductionGroup>();
  for (const part of inputs.flatMap(input => input.parts)) {
    const key = productionGroupKey(part);
    const group = groups.get(key);
    if (group) group.parts.push(part);
    else groups.set(key, { key, kind: part.kind, material: part.material, finish: part.finish,
      thickness: part.thickness, rate: part.rate, parts: [part] });
  }
  return [...groups.values()];
}
function validateStock(stock: StockSettings, linear = false) {
  if (![stock.length, stock.width, stock.kerf, stock.trim].every(Number.isFinite) ||
    stock.length <= 0 || stock.width <= 0 || stock.length > 50000 || stock.width > 50000 ||
    stock.kerf < 0 || stock.kerf > 30 || stock.trim < 0 || stock.trim * 2 >= (linear ? stock.length : Math.min(stock.length, stock.width)) ||
    (stock.extraProcessingRate !== undefined && (!Number.isFinite(stock.extraProcessingRate) || stock.extraProcessingRate < 0)) ||
    (stock.priority !== undefined && !["auto", "quantity", "length"].includes(stock.priority))) {
    throw new Error("Invalid stock size, saw-cut width or edge trim.");
  }
}

function priorityComparator(group: ProductionGroup, priority?: CuttingPriority) {
  const quantities = new Map<string, number>();
  const key = (p: ProductionPart) => JSON.stringify([p.length, p.width, p.edgeBand, p.drill]);
  for (const p of group.parts) quantities.set(key(p), (quantities.get(key(p)) ?? 0) + p.qty);
  return (a: ProductionPart, b: ProductionPart) => {
    const qty = (quantities.get(key(b)) ?? 0) - (quantities.get(key(a)) ?? 0);
    return priority === "quantity" ? qty || b.length - a.length || b.width - a.width
      : priority === "length" ? b.length - a.length || qty || b.width - a.width : 0;
  };
}
function expandedParts(group: ProductionGroup) {
  const pieces: { part: ProductionPart; piece: number }[] = [];
  for (const part of group.parts) {
    if (!Number.isSafeInteger(part.qty) || part.qty < 1 || ![part.length, part.width].every(n => Number.isFinite(n) && n > 0))
      throw new Error(`Invalid cutting dimensions or quantity: ${part.kitchen} / ${part.panel}`);
    if (pieces.length + part.qty > 10000) throw new Error("Limit each material group to 10,000 pieces per batch.");
    for (let piece = 1; piece <= part.qty; piece++) pieces.push({ part, piece });
  }
  return pieces;
}

/** Multi-start guillotine search: four part orders, two cut patterns, two fit strategies. */
function boardLayouts(group: ProductionGroup, stock: StockSettings) {
  const widthTrim = group.kind === "profile" ? 0 : stock.trim;
  const pieces = expandedParts(group);
  const orderCount = stock.priority && stock.priority !== "auto" ? 1 : 4;
  const compare = priorityComparator(group, stock.priority);
  const trials = Array.from({ length: orderCount * 4 }, (_, trial) => {
    const order = trial % orderCount;
    const splitAcrossLength = Math.floor(trial / orderCount) % 2 === 1;
    const shortSideFit = trial >= orderCount * 2;
    const sorted = [...pieces].sort((a, b) => {
      const score = (p: ProductionPart) => order === 0 ? p.length * p.width : order === 1 ? Math.max(p.length, p.width) : order === 2 ? p.width : p.length;
      return compare(a.part, b.part) || (orderCount === 1 ? 0 : score(b.part) - score(a.part)) || a.part.id.localeCompare(b.part.id) || a.piece - b.piece;
    });
    const layouts: CutLayout[] = [];
    const unplaced: OptimizedGroup["unplaced"] = [];
    for (const { part, piece } of sorted) {
      const shapes = [{ length: part.length, width: part.width, rotated: false },
        ...(!stock.grainLocked && !part.grainLocked && group.kind !== "profile" ? [{ length: part.width, width: part.length, rotated: true }] : [])];
      if (!shapes.some(s => s.length <= stock.length - 2 * stock.trim && s.width <= stock.width - 2 * widthTrim)) {
        if (!unplaced.some(p => p.part.id === part.id)) unplaced.push({ part, reason: "Part exceeds usable sheet dimensions / grain direction" });
        continue;
      }
      let best: { bin: number; rect: number; shape: typeof shapes[number]; score: number } | undefined;
      const choose = (bin: number) => layouts[bin].offcuts.forEach((r, rect) => shapes.forEach(shape => {
        if (shape.length <= r.length && shape.width <= r.width) {
          const areaRemainder = r.length * r.width - shape.length * shape.width;
          const score = shortSideFit ? Math.min(r.length - shape.length, r.width - shape.width) * 1e10 + areaRemainder : areaRemainder;
          if (!best || score < best.score) best = { bin, rect, shape, score };
        }
      }));
      for (let bin = 0; bin < layouts.length; bin++) choose(bin);
      if (!best) {
        layouts.push({ number: layouts.length + 1, length: stock.length, width: stock.width, placements: [],
          offcuts: [{ x: stock.trim, y: widthTrim, length: stock.length - 2 * stock.trim, width: stock.width - 2 * widthTrim }] });
        choose(layouts.length - 1);
      }
      if (!best) throw new Error("Could not place a validated panel.");
      const choice = best as { bin: number; rect: number; shape: typeof shapes[number]; score: number };
      const layout = layouts[choice.bin];
      const r = layout.offcuts.splice(choice.rect, 1)[0];
      const { length, width, rotated } = choice.shape;
      layout.placements.push({ part, piece, x: r.x, y: r.y, length, width, rotated });
      // Try both guillotine cut orders; kerf belongs to neither offcut.
      const remainderWidth = r.width - width - stock.kerf;
      const remainderLength = r.length - length - stock.kerf;
      if (remainderLength > 0) layout.offcuts.push({ x: r.x + length + stock.kerf, y: r.y, length: remainderLength, width: splitAcrossLength ? r.width : width });
      if (remainderWidth > 0) layout.offcuts.push({ x: r.x, y: r.y + width + stock.kerf, length: splitAcrossLength ? length : r.length, width: remainderWidth });
    }
    return { layouts, unplaced };
  });
  const largestOffcut = (plan: typeof trials[number]) => Math.max(0, ...plan.layouts.flatMap(l => l.offcuts.map(r => r.length * r.width)));
  return trials.sort((a, b) => a.unplaced.length - b.unplaced.length || a.layouts.length - b.layouts.length || largestOffcut(b) - largestOffcut(a))[0];
}

/** Fixed-width roll, variable-length shelves. No sheet conversion and no board kerf. */
function foilLayoutTrial(group: ProductionGroup, stock: StockSettings, preferShortLength: boolean) {
  const width = 1420;
  const shelves: { y: number; length: number; usedWidth: number }[] = [];
  const placements: PlacedPart[] = [];
  const unplaced: OptimizedGroup["unplaced"] = [];
  let totalLength = 0;
  const compare = priorityComparator(group, stock.priority);
  for (const { part, piece } of expandedParts(group).sort((a, b) => compare(a.part, b.part) || b.part.length - a.part.length || a.part.id.localeCompare(b.part.id))) {
    const shapes = [{ length: part.length, width: part.width, rotated: false },
      ...(!stock.grainLocked && !part.grainLocked ? [{ length: part.width, width: part.length, rotated: true }] : [])].filter(p => p.width <= width);
    if (!shapes.length) {
      if (!unplaced.some(p => p.part.id === part.id)) unplaced.push({ part, reason: "Panel width exceeds 1420 mm roll / grain direction" });
      continue;
    }
    let shelf = shelves.find(s => shapes.some(p => p.length <= s.length && p.width <= width - s.usedWidth));
    const shape = shelf ? shapes.find(p => p.length <= shelf!.length && p.width <= width - shelf!.usedWidth)!
      : preferShortLength ? shapes.sort((a, b) => a.length - b.length)[0] : shapes[0];
    if (!shelf) {
      shelf = { y: totalLength, length: shape.length, usedWidth: 0 };
      shelves.push(shelf); totalLength += shape.length;
    }
    placements.push({ part, piece, x: shelf.y, y: shelf.usedWidth, length: shape.length, width: shape.width, rotated: shape.rotated });
    shelf.usedWidth += shape.width;
  }
  const offcuts = shelves.filter(s => s.usedWidth < width).map(s => ({ x: s.y, y: s.usedWidth, length: s.length, width: width - s.usedWidth }));
  return { layouts: placements.length ? [{ number: 1, length: totalLength, width, placements, offcuts }] : [], unplaced };
}
function foilLayouts(group: ProductionGroup, stock: StockSettings) {
  return [false, true].map(preferShort => foilLayoutTrial(group, stock, preferShort))
    .sort((a, b) => a.unplaced.length - b.unplaced.length || (a.layouts[0]?.length ?? 0) - (b.layouts[0]?.length ?? 0))[0];
}

function fillExtraStock(layouts: CutLayout[], group: ProductionGroup, stock: StockSettings): boolean {
  const compare = priorityComparator(group, stock.priority ?? "quantity");
  // Filler strips can be very frequent or long, but reusable cabinet panels
  // take precedence whenever one fits an existing offcut.
  const fillerTier = (part: ProductionPart) => /\bfillers?\b/i.test(part.panel) ? 1 : 0;
  const seen = new Set<string>();
  const candidates = [...group.parts].sort((a, b) => fillerTier(a) - fillerTier(b) || compare(a, b) || a.id.localeCompare(b.id)).filter(p => {
    const key = JSON.stringify([p.length, p.width, p.grainLocked, p.edgeBand, p.drill, p.processingRate]);
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  const kerf = group.kind === "foil" ? 0 : stock.kerf;
  let limited = false;
  for (const layout of layouts) {
    // Match the actual cut length on this sheet, including rotated required parts.
    // Extra copies must not introduce new preferred lengths while filling.
    const cutLengths = new Set(layout.placements.filter(p => !p.extraStock).map(p => p.length));
    let added = 0;
    while (added < 5000) {
      let match: { part: ProductionPart; rect: number; length: number; width: number; rotated: boolean } | undefined;
      for (const tier of [0, 1, 2]) {
        for (const part of candidates) {
          if ((tier === 2) !== (fillerTier(part) === 1)) continue;
          const shapes = [{ length: part.length, width: part.width, rotated: false },
            ...(!stock.grainLocked && !part.grainLocked && group.kind !== "profile" ? [{ length: part.width, width: part.length, rotated: true }] : [])]
            .filter(s => tier !== 0 || cutLengths.has(s.length));
          for (let rect = 0; rect < layout.offcuts.length && !match; rect++) {
            const r = layout.offcuts[rect];
            const shape = shapes.find(s => s.length <= r.length && s.width <= r.width);
            if (shape) match = { part, rect, ...shape };
          }
          if (match) break;
        }
        if (match) break;
      }
      if (!match) break;
      const r = layout.offcuts.splice(match.rect, 1)[0];
      layout.placements.push({ part: match.part, piece: match.part.qty + ++added, x: r.x, y: r.y, length: match.length, width: match.width,
        rotated: match.rotated, extraStock: true, extraProcessingRate: stock.extraProcessingRate ?? match.part.processingRate });
      const right = r.length - match.length - kerf, below = r.width - match.width - kerf;
      if (right > 0) layout.offcuts.push({ x: r.x + match.length + kerf, y: r.y, length: right, width: match.width });
      if (below > 0) layout.offcuts.push({ x: r.x, y: r.y + match.width + kerf, length: r.length, width: below });
    }
    if (added === 5000) limited = true;
  }
  return limited;
}

export function extraStockMetrics(layouts: CutLayout[], kind: ProductionPart["kind"], stockAreaSqft: number, requiredSqft: number) {
  let count = 0, area = 0, metres = 0, cost = 0, missingRate = false;
  for (const l of layouts) for (const p of l.placements.filter(p => p.extraStock)) {
    const qty = l.repeatCount ?? 1;
    count += qty; area += p.length * p.width * qty / PRODUCTION_SQMM_PER_SQFT; metres += p.length * qty / 1000;
    if (p.extraProcessingRate === undefined) missingRate = true;
    else cost += (kind === "profile" ? p.length / 1000 : p.length * p.width / PRODUCTION_SQMM_PER_SQFT) * qty * p.extraProcessingRate;
  }
  return { extraStockCount: count, extraStockSqft: area, extraStockMetres: metres,
    extraProcessingCost: missingRate ? undefined : cost,
    remainingWastePct: stockAreaSqft ? Math.max(0, 100 * (1 - (requiredSqft + area) / stockAreaSqft)) : 0 };
}

export function optimizeProductionGroup(group: ProductionGroup, settings?: Partial<StockSettings>): OptimizedGroup {
  const stock = { ...defaultStockForGroup(group), ...settings };
  if (group.kind === "profile") stock.width = 1;
  if (group.kind === "foil") { stock.width = 1420; stock.kerf = 0; stock.trim = 0; }
  if (stock.enabled === false) return { ...group, stock, skipped: true, layouts: [], unplaced: [], netSqft: 0, purchasedSqft: 0, wastePct: 0, rollLengthMm: 0 };
  validateStock(stock, group.kind === "profile");
  const result = group.kind === "foil" ? foilLayouts(group, stock) : boardLayouts(group, stock);
  const limited = stock.overproduction && !result.unplaced.length ? fillExtraStock(result.layouts, group, stock) : false;
  const area = result.layouts.reduce((sum, l) => sum + l.length * l.width, 0);
  const net = result.layouts.flatMap(l => l.placements).filter(p => !p.extraStock).reduce((sum, p) => sum + p.length * p.width, 0);
  return { ...group, stock, ...result, netSqft: net / PRODUCTION_SQMM_PER_SQFT,
    purchasedSqft: area / PRODUCTION_SQMM_PER_SQFT, wastePct: area ? 100 * (1 - net / area) : 0,
    ...extraStockMetrics(result.layouts, group.kind, area / PRODUCTION_SQMM_PER_SQFT, net / PRODUCTION_SQMM_PER_SQFT),
    ...(limited ? { optimizationNote: "Extra-stock filling stopped at 5,000 extra pieces per layout for browser safety; remaining offcuts are retained." } : {}),
    rollLengthMm: group.kind === "foil" ? result.layouts[0]?.length ?? 0 : 0 };
}

export function productionSheetCount(group: Pick<OptimizedGroup, "layouts">): number {
  return group.layouts.reduce((sum, layout) => sum + (layout.repeatCount ?? 1), 0);
}

/** Large identical-kitchen jobs reuse bounded sub-batch patterns, with exact repeat counts. */
export function optimizeRepeatedProductionGroup(group: ProductionGroup, settings?: Partial<StockSettings>): OptimizedGroup {
  const total = group.parts.reduce((sum, p) => sum + p.qty, 0);
  if (total <= 2000 || (settings?.enabled ?? defaultStockForGroup(group).enabled) === false) return optimizeProductionGroup(group, settings);
  const gcd = (a: number, b: number): number => { while (b) { const next = a % b; a = b; b = next; } return a; };
  if (!Number.isSafeInteger(total) || group.parts.some(p => !Number.isSafeInteger(p.qty) || p.qty < 1)) throw new Error("Cut quantities exceed exact whole-number precision.");
  const copies = group.parts.reduce((value, p) => gcd(value, p.qty), 0);
  const unitPieces = total / copies;
  const chunk = Math.max(1, Math.min(copies, Math.floor(2000 / unitPieces)));
  if (copies === 1 || chunk === copies) return optimizeProductionGroup(group, settings);
  const plan = (count: number) => optimizeProductionGroup({ ...group, parts: group.parts.map(p => ({ ...p, qty: p.qty / copies * count })) }, settings);
  const initial = plan(chunk);
  // Also try dropping enough complete pattern units to eliminate the final,
  // partially filled sheet. Compare full-job sheets including the remainder.
  const finalCounts = new Map<string, number>();
  for (const p of initial.layouts.at(-1)?.placements.filter(p => !p.extraStock) ?? []) finalCounts.set(p.part.id, (finalCounts.get(p.part.id) ?? 0) + 1);
  const drop = Math.max(1, ...group.parts.map(p => Math.ceil((finalCounts.get(p.id) ?? 0) / (p.qty / copies))));
  const sizes = [...new Set([chunk, ...(chunk > drop && !initial.unplaced.length ? [chunk - drop] : [])])];
  const candidates = sizes.map(size => {
    const main = size === chunk ? initial : plan(size);
    const repetitions = Math.floor(copies / size), remainder = copies % size;
    const tail = remainder ? plan(remainder) : undefined;
    return { main, tail, repetitions, sheets: main.layouts.length * repetitions + (tail?.layouts.length ?? 0),
      missing: main.unplaced.length + (tail?.unplaced.length ?? 0) };
  }).sort((a, b) => a.missing - b.missing || a.sheets - b.sheets);
  const { main, tail, repetitions } = candidates[0];
  const layouts: CutLayout[] = [];
  let sheet = 1;
  for (const [result, repeats] of [[main, repetitions], ...(tail ? [[tail, 1] as const] : [])] as const) {
    for (const layout of result.layouts) {
      layouts.push({ ...layout, number: sheet, repeatCount: repeats });
      sheet += repeats;
    }
  }
  const netSqft = main.netSqft * repetitions + (tail?.netSqft ?? 0);
  const purchasedSqft = main.purchasedSqft * repetitions + (tail?.purchasedSqft ?? 0);
  return { ...group, stock: main.stock, layouts, netSqft, purchasedSqft,
    ...extraStockMetrics(layouts, group.kind, purchasedSqft, netSqft),
    wastePct: purchasedSqft ? 100 * (1 - netSqft / purchasedSqft) : 0, rollLengthMm: main.rollLengthMm * repetitions + (tail?.rollLengthMm ?? 0),
    unplaced: [...main.unplaced.map(p => ({ ...p, part: { ...p.part, qty: p.part.qty * repetitions } })), ...(tail?.unplaced ?? [])],
    optimizationNote: ["Large batch: repeating sub-batch layouts plus a separately optimized remainder. Stock repeat counts are included in all totals. Offcuts are not shared between sub-batches; not a guaranteed global minimum.", main.optimizationNote, tail?.optimizationNote].filter(Boolean).join(" ") };
}

export function consolidateProductionSupplies(inputs: ProductionInput[]) {
  const groups = new Map<string, ProductionSupply & { kitchens: string[] }>();
  for (const item of inputs.flatMap(input => input.supplies)) {
    const key = JSON.stringify([item.itemCode, item.item, item.unit, item.orderFrom]);
    const found = groups.get(key);
    if (found) { found.qty += item.qty; if (!found.kitchens.includes(item.kitchen)) found.kitchens.push(item.kitchen); }
    else groups.set(key, { ...item, kitchens: [item.kitchen] });
  }
  return [...groups.values()];
}
