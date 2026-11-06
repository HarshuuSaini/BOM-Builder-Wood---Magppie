import { COSTING_ITEMS, DEFAULT_BOARD_PROCESSING_RATES, SINK_STONE_BOARD_ID } from "./costing";
import { modernMembraneConstruction } from "./modern-membrane";
import type { KitchenWorkspaceEntry } from "./kitchen-workspace";
import accessoryCatalog from "@/data/accessory_catalog.json";
import { priceUnit, rateInUnit } from "./price-units";

export type PriceChange = { key: string; label: string; unit: string; defaultPrice: number | null; changedPrice: number; reason: string; legacy?: boolean; itemCode?: string; previousPrice?: number; materialName?: string; displayUnit?: string };
type Field = Omit<PriceChange, "reason" | "legacy"> & { sourceReason?: string };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown) => (typeof v === "number" || typeof v === "string" && v.trim() !== "") && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
const same = (a: number | null | undefined, b: number | null | undefined) => a === b || typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 0.00001;
const master = (id: unknown) => COSTING_ITEMS.find(i => i.id === id);
function isDerivedGlassPiece(change: Pick<PriceChange, "key" | "itemCode" | "label" | "unit">) {
  const piece = /(?:^|\/)(?:nos|pcs?|pieces?|each)$/i.test(change.unit.trim());
  const item = master(change.itemCode);
  return piece && (item?.group === "Glass Type" || /^(?:Glass shelf|Shutter glass)\b/i.test(change.label));
}
/** Normalize earlier precomputed rows too, without modifying the saved quote. */
function comparableChange(change: PriceChange): PriceChange | null {
  if (/\.profitPct$/.test(change.key)) return null;
  if (isDerivedGlassPiece(change)) return null;
  let result = change;
  if (change.key.startsWith("Purchase.")) {
    const m = master(change.itemCode?.replace(/-PROC$/, ""));
    const foil = /foil/i.test(`${change.itemCode} ${change.label}`);
    if (foil && priceUnit(change.unit) === "sheet") {
      result = { ...change, unit: "₹/sqft", defaultPrice: change.defaultPrice === 75 ? 75 : change.defaultPrice === null ? null : change.defaultPrice / 32,
        changedPrice: change.changedPrice / 32, ...(change.previousPrice !== undefined ? { previousPrice: change.previousPrice / 32 } : {}) };
    } else if (m && !/processing|surface finishing/i.test(change.label)) {
      const converted = rateInUnit(m.currentRate, m.rateBasis, change.unit, m.id === SINK_STONE_BOARD_ID ? 21 : 32);
      if (converted === undefined) return null;
      if (priceUnit(change.unit) !== priceUnit(m.rateBasis) && same(change.defaultPrice, m.currentRate)) result = { ...change, defaultPrice: converted };
    }
  }
  return same(result.defaultPrice, result.changedPrice) && result.previousPrice === undefined ? null : result;
}

function fields(entry: Pick<KitchenWorkspaceEntry, "materials" | "rows" | "costing">): Field[] {
  const out: Field[] = [];
  function walk(value: unknown, path: string, inheritedId?: string) {
    if (!record(value)) return;
    const id = typeof value.itemId === "string" ? value.itemId : typeof value.sourceItemId === "string" ? value.sourceItemId : inheritedId;
    const item = master(id), board = modernMembraneConstruction(item)?.board ?? item;
    const catalogItem = accessoryCatalog.find(i => i.id === (id ?? value.sourceItemId));
    const approval = record(value._serviceRateApproval) && record(value._serviceRateApproval.rates) && typeof value._serviceRateApproval.reason === "string" ? value._serviceRateApproval : undefined;
    const serviceReason = (key: string, actual: unknown) => approval && (approval.rates as Record<string, unknown>)[key] === actual ? { sourceReason: approval.reason as string } : {};
    for (const [key, v] of Object.entries(value)) {
      if (/^profit(Pct)?$|^_?priceChanges$|^_serviceRateApproval$|^priceChangeReason$|^costing$|^boardOpti$|^boardSheetInputs$/.test(key)) continue;
      const at = `${path}.${key}`;
      if (record(v)) {
        if (["transportation", "installation", "loading"].includes(key) && number(v.value) !== undefined) {
          out.push({ key: `${at}.value`, label: `${key} charge`, unit: v.mode === "direct" ? "₹" : "₹/sqft",
            defaultPrice: v.mode === "direct" ? 0 : key === "transportation" ? 15 : key === "installation" ? 95 : 5, changedPrice: Number(v.value),
            ...((approval && ((approval.rates as Record<string, any>).modes?.[key] ?? "sqft") === v.mode) ? serviceReason(key, v.value) : {}) });
        }
        if (key === "processingRates" || key === "itemProcessingRates") {
          for (const [rateKey, rate] of Object.entries(v)) {
            const n = number(rate); if (n === undefined) continue;
            out.push({ key: `${at}.${rateKey}`, itemCode: `processing:${rateKey}`, label: `Processing · ${rateKey}`, unit: "₹/sqft", defaultPrice: DEFAULT_BOARD_PROCESSING_RATES[rateKey] ?? null, changedPrice: n });
          }
        } else if (key === "_counterPlyRates") {
          for (const [itemId, rate] of Object.entries(v)) {
            const n = number(rate); if (n === undefined) continue;
            out.push({ key: `${at}.${itemId}`, itemCode: itemId, label: `Counter ply · ${master(itemId)?.materialDescription ?? itemId}`, unit: "₹/sheet", defaultPrice: master(itemId) ? master(itemId)!.currentRate * 32 : null, changedPrice: n * 32 });
          }
        } else walk(v, at, id);
        continue;
      }
      if (/\.pricing$/.test(path) && ["conversionPct", "includeTax"].includes(key)) {
        const actual = key === "includeTax" ? typeof v === "boolean" ? v ? 18 : 0 : undefined : number(v);
        if (actual !== undefined) out.push({ key: at, label: key === "conversionPct" ? "Conversion margin" : "GST", unit: "%", defaultPrice: key === "conversionPct" ? 40 : 0, changedPrice: actual, ...serviceReason(key, v) });
        continue;
      }
      const n = number(v);
      if (n === undefined || !/price|rate/i.test(key)) continue;
      let base: number | null = null, unit = "₹/unit";
      if (/pvcFoilRate/i.test(key)) { base = 75; unit = "₹/sqft"; }
      else if (/Lam.*SheetPrice|frontSheetPrice|backSheetPrice/i.test(key)) { base = 550; unit = "₹/sheet"; }
      else if (/boardSheetPrice|sheetPrice/i.test(key)) { base = board ? board.currentRate * (board.id === SINK_STONE_BOARD_ID ? 21 : 32) : null; unit = board?.id === SINK_STONE_BOARD_ID ? "₹/slab" : "₹/sheet"; }
      else if (/pricePerRmt|carcassPricePerRmt|shutterPricePerRmt/i.test(key)) {
        base = COSTING_ITEMS.find(i => i.group === "Edge Band" && i.subgroup === (/shutter|visible/i.test(at) ? "Shutter" : "Carcass"))?.currentRate ?? null; unit = "₹/m";
      } else if (/glassPricePerSqft|pricePerSqft/i.test(key)) { base = master(value.glassType ?? id)?.currentRate ?? null; unit = "₹/sqft"; }
      else if (/ratePerSqft/i.test(key)) { base = item?.currentRate ?? null; unit = "₹/sqft"; }
      else if (/manualRate|^rate$|^price$|handlePrice/i.test(key)) base = item?.currentRate ?? null;
      const code = /pvcFoilRate/i.test(key) ? "PVC-FOIL-MODERN" : /Lam.*SheetPrice|frontSheetPrice|backSheetPrice/i.test(key) ? `laminate:${id ?? "default"}` : /boardSheetPrice|sheetPrice/i.test(key) ? board?.id : id;
      out.push({ key: at, itemCode: code, materialName: /pricePerRmt|carcassPricePerRmt|shutterPricePerRmt/i.test(key) ? `Edge band · ${typeof value.finish === "string" ? value.finish : "Selected finish"}`
          : /glassPricePerSqft|pricePerSqft/i.test(key) ? master(value.glassType ?? id)?.materialDescription ?? "Glass"
          : typeof value.customName === "string" && value.customName.trim() ? [value.customName.trim(), typeof value.customBrand === "string" ? value.customBrand.trim() : ""].filter(Boolean).join(" · ") : catalogItem?.name,
        displayUnit: unit === "₹/unit" ? `₹/${item?.rateBasis ?? catalogItem?.unit ?? value.customUnit ?? "unit"}` : undefined,
        label: `${path.replace(/\./g, " · ")} · ${item?.materialDescription ?? key}`, unit, defaultPrice: base, changedPrice: n,
        ...(key === "manualRate" && /^(accessory|linked-accessory-edit)\./.test(path) && typeof value.priceChangeReason === "string" ? { sourceReason: value.priceChangeReason } : {}) });
    }
  }
  walk(entry.materials, "Materials");
  for (const row of entry.rows ?? []) {
    try {
      const data = JSON.parse(row.Data);
      if (!record(data)) continue;
      const kind = row["Record Type"];
      if (["format", "raw-selection"].includes(kind)) continue;
      // The unsaved configure-unit draft is not part of a kitchen's costing.
      const { current: _current, ...saved } = data;
      walk(saved, `${kind}.${data.id ?? data.linkedLineId ?? "settings"}`);
    } catch { /* The normal project parser reports invalid project data. */ }
  }
  // Catch every priced purchase, including hardware and custom accessories which
  // do not have a separate material-selection field.
  const occurrences = new Map<string, number>();
  for (const item of entry.costing?.items ?? []) {
    // Glass is quoted by cut piece; its effective piece amount is not a new
    // per-sqft rate. The editable glass rate is audited in the material/config.
    if (isDerivedGlassPiece({ key: "Purchase", itemCode: item.itemCode, label: item.category, unit: item.unit })) continue;
    const identity = JSON.stringify([item.category, item.itemCode, item.item, item.unit]);
    const occurrence = occurrences.get(identity) ?? 0; occurrences.set(identity, occurrence + 1);
    const m = master(item.itemCode.replace(/-PROC$/, ""));
    let sourceRate: number | undefined = m?.currentRate, sourceUnit = m?.rateBasis;
    let changedPrice = item.rate, unit = item.unit;
    const stockArea = m?.id === SINK_STONE_BOARD_ID ? 21 : 32;
    if (/foil/i.test(item.category)) {
      sourceRate = 75; sourceUnit = "SQFT";
      // Older exports represented foil using 32-sqft sheet equivalents. Convert
      // that legacy price back to sqft; current foil remains a variable roll.
      if (priceUnit(unit) === "sheet") { changedPrice /= 32; unit = "sqft"; }
    }
    if (/laminate/i.test(item.category) && !/foil/i.test(item.category) && !m) { sourceRate = 550 / 32; sourceUnit = "SQFT"; }
    if (/processing$/i.test(item.category)) {
      const type = /prelam/i.test(m?.type ?? item.item) ? "Prelam" : /postlam/i.test(m?.type ?? item.item) ? "Postlam" : "";
      sourceRate = item.category === "Counter Ply processing" ? 10 : DEFAULT_BOARD_PROCESSING_RATES[`${item.category.replace(/ processing$/i, "")}|${type}`];
      sourceUnit = "SQFT";
    }
    if (/surface finishing/i.test(item.category)) { sourceRate = /Anodised/i.test(item.itemCode) ? 40 : 80; sourceUnit = "SQFT"; }
    const base = sourceRate === undefined || !sourceUnit ? null : rateInUnit(sourceRate, sourceUnit, unit, stockArea);
    // Area/mass/length-based items priced as pieces or packs are derived costs.
    // Without a defined conversion, audit their editable source rate instead.
    if (base === undefined) continue;
    out.push({ key: `Purchase.${identity}.${occurrence}`, itemCode: /foil/i.test(item.category) ? "PVC-FOIL-MODERN" : item.itemCode, label: `${item.category} · ${item.item}`, unit: `₹/${unit}`, defaultPrice: base, changedPrice });
  }
  return out;
}

/** Defaults come from the master, never from client-submitted default values. */
export function priceChangesFor(entry: Pick<KitchenWorkspaceEntry, "materials" | "rows" | "costing" | "priceChanges">,
  previous?: Pick<KitchenWorkspaceEntry, "materials" | "rows" | "costing" | "priceChanges">): PriceChange[] {
  const previousFields = new Map(previous ? fields(previous).map(f => [f.key, f]) : []);
  const oldAudits = [...previous?.priceChanges ?? [], ...previous?.materials?._priceChanges ?? []];
  // Current editor remarks must win over older copies in material selections.
  const proposed = [...entry.priceChanges ?? [], ...entry.materials?._priceChanges ?? []];
  const currentFields = fields(entry);
  const inlineReasons = currentFields.filter(f => f.sourceReason?.trim());
  return currentFields.flatMap(({ sourceReason, ...f }) => {
    const old = oldAudits.find(a => a.key === f.key && a.itemCode === f.itemCode && a.unit === f.unit);
    const m = master(f.itemCode);
    const oldUnitMismatch = old && m && priceUnit(old.unit) !== priceUnit(m.rateBasis) && same(old.defaultPrice, m.currentRate) && !same(old.defaultPrice, f.defaultPrice);
    const defaultPrice = old && !oldUnitMismatch ? old.defaultPrice : f.defaultPrice;
    const previousField = previousFields.get(f.key);
    const prior = previousField?.itemCode === f.itemCode && previousField?.unit === f.unit ? previousField : undefined;
    const edited = prior && !same(prior.changedPrice, f.changedPrice);
    if ((same(defaultPrice, f.changedPrice) && !edited && old?.previousPrice === undefined) ||
        (defaultPrice === null && f.changedPrice === 0 && !edited && f.key.startsWith("Purchase."))) return [];
    const supplied = proposed.find(a => a.key === f.key && a.itemCode === f.itemCode && a.unit === f.unit && same(a.changedPrice, f.changedPrice));
    const sharedReason = f.itemCode && proposed.find(a => a.itemCode === f.itemCode && a.unit === f.unit && same(a.defaultPrice, defaultPrice) && same(a.changedPrice, f.changedPrice) && a.reason.trim());
    const inlineReason = f.key.startsWith("Purchase.") && inlineReasons.find(a =>
      (a.itemCode === f.itemCode || a.itemCode === "CUSTOM" && f.itemCode === "CUSTOM-ACCESSORY" && !!a.materialName && f.label.endsWith(` · ${a.materialName}`)) &&
      priceUnit(a.displayUnit ?? a.unit) === priceUnit(f.unit) && same(a.changedPrice, f.changedPrice));
    const retained = old && same(old.changedPrice, f.changedPrice) ? old : undefined;
    const recordedServiceReason = /\.pricing\./.test(f.key) && !edited ? supplied?.reason || retained?.reason : undefined;
    const legacy = !!prior && same(prior.changedPrice, f.changedPrice) && (!old || old.legacy);
    return [{ ...f, defaultPrice, reason: (recordedServiceReason || sourceReason) ?? (inlineReason ? inlineReason.sourceReason! : supplied ? supplied.reason : retained?.reason ?? (sharedReason ? sharedReason.reason : "")),
      ...(edited ? { previousPrice: prior.changedPrice } : old?.previousPrice !== undefined ? { previousPrice: old.previousPrice } : {}), ...(legacy ? { legacy: true } : {}) }];
  });
}
export function missingPriceReasons(changes: PriceChange[]) { return changes.filter(c => !!comparableChange(c) && !c.legacy && !c.reason.trim()); }
export function validPriceChanges(value: unknown): value is PriceChange[] {
  return Array.isArray(value) && value.length <= 5000 && value.every(c => record(c) && typeof c.key === "string" && c.key.length <= 2000 && typeof c.label === "string" &&
    typeof c.unit === "string" && (c.defaultPrice === null || number(c.defaultPrice) !== undefined) && number(c.changedPrice) !== undefined && typeof c.reason === "string");
}

const roles: Record<string, string> = { carcass: "Carcass / shelf", back: "Carcass back", drawer: "Drawer", shutter: "Shutter", visible: "Visible side" };
/** Presentation only: retain every source key and distinct price/reason for validation. */
export function groupPriceChanges(changes: PriceChange[]) {
  const groups = new Map<string, { id: string; material: string; rateType: string; unit: string; defaultPrice: number | null; changedPrice: number;
    reason: string; previousPrice?: number; usages: string[]; keys: string[]; required: boolean }>();
  for (const raw of changes) {
    if (/\.profitPct$/.test(raw.key)) continue;
    // Also discard old, precomputed audit rows. Their per-piece costs cannot be
    // compared to the glass master's per-sqft rate and require no price remark.
    const c = comparableChange(raw);
    if (!c) continue;
    const purchase = c.key.startsWith("Purchase.");
    let category = "", purchaseName = "";
    if (purchase) { try { const parts = JSON.parse(c.key.slice(9, c.key.lastIndexOf("."))); category = parts[0]; purchaseName = parts[2]; } catch { /* old audit label is retained below */ } }
    const laminate = /(?:Lam.*SheetPrice|frontSheetPrice|backSheetPrice)/i.test(c.key) || /laminate/i.test(category) && !/foil/i.test(category);
    const foil = /foil/i.test(c.key + category);
    const edge = /edgeBand|PricePerRmt/i.test(c.key) || /edge band/i.test(category);
    const processing = /processingRates|itemProcessingRates/i.test(c.key) || /processing$/i.test(category);
    const board = /boardSheetPrice|\.sheetPrice|_counterPlyRates/i.test(c.key) || /board$|^Counter Ply$/i.test(category);
    let rateType = foil ? "PVC foil" : laminate ? "Laminate" : edge ? "Edge band" : processing ? "Processing" : board ? "Board" : /surface finishing/i.test(category) ? "Surface finishing" : "Item rate";
    const code = c.itemCode?.replace(/-PROC$/, "");
    let material = foil ? "PVC membrane foil" : laminate ? "Laminate 0.8 mm" : c.materialName ?? master(code)?.materialDescription ?? purchaseName;
    if (edge && purchase && purchaseName.includes(" · ")) material = `Edge band · ${purchaseName.split(" · ").at(-1)}`;
    if (processing) {
      const definition = c.itemCode?.startsWith("processing:") ? c.itemCode.slice(11) : category.replace(/ processing$/i, "");
      const type = definition.split("|")[1] ?? (/prelam/i.test(master(code)?.type ?? purchaseName) ? "Prelam" : /postlam/i.test(master(code)?.type ?? purchaseName) ? "Postlam" : "");
      material = type ? `Board processing — ${type}` : /counter ply/i.test(definition) ? "Counter ply processing" : "Board processing";
      rateType = definition.split("|")[0] || "Processing";
    }
    if (!material) material = edge ? "Edge band · Selected finish" : /handlePrice|_handleDefaults/i.test(c.key) ? "Selected handle" : c.label.includes(" · ") ? c.label.split(" · ").at(-1)! : c.label;
    const zone = c.key.match(/^Materials\.(Base|Sink|Wall|Tall|Loft|Mid|_wallOpen|_wallGlass)\./)?.[1]?.replace("_wallOpen", "Wall open shelf").replace("_wallGlass", "Wall glass");
    const role = c.key.match(/\.(carcass|back|drawer|shutter|visible)(?:\.|$)/)?.[1] ?? c.key.match(/\.(carcass|back|drawer|shutter|visible)Lam/i)?.[1];
    const face = /frontSheetPrice|LamFrontSheetPrice/i.test(c.key) ? "Front face" : /backSheetPrice|LamBackSheetPrice/i.test(c.key) ? "Back face" : "";
    const usage = [zone, role ? roles[role] : "", face].filter(Boolean).join(" · ") || (purchase ? category : /^cabinet\./.test(c.key) ? "Cabinets" : /accessory/.test(c.key) ? "Accessories" : "Kitchen");
    const unit = (c.displayUnit ?? (c.unit === "₹/unit" && master(code) ? `₹/${master(code)!.rateBasis}` : c.unit))
      .replace(/₹\/(?:rmt|mtr)$/i, "₹/m").replace(/₹\/(?:pcs|nos|piece)$/i, "₹/piece").replace(/₹\/set$/i, "₹/set");
    const identity = JSON.stringify([material, rateType, unit, c.defaultPrice === null ? null : Number(c.defaultPrice.toFixed(5)), Number(c.changedPrice.toFixed(5)), c.reason, c.previousPrice]);
    const found = groups.get(identity);
    if (found) { found.keys.push(c.key); if (!found.usages.includes(usage)) found.usages.push(usage); found.required ||= !c.legacy; }
    else groups.set(identity, { id: identity, material, rateType, unit, defaultPrice: c.defaultPrice, changedPrice: c.changedPrice, previousPrice: c.previousPrice,
      reason: c.reason, usages: [usage], keys: [c.key], required: !c.legacy });
  }
  return [...groups.values()].sort((a, b) => a.material.localeCompare(b.material) || a.rateType.localeCompare(b.rateType));
}
