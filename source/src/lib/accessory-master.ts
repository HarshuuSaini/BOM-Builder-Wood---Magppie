import catalog from "@/data/accessory_catalog.json";
import { COSTING_ITEMS } from "./costing";
import type { KitchenWorkspaceEntry } from "./kitchen-workspace";
export type SavedAccessoryItem = { id: string; name: string; brand: string; unit: "PCS" | "SET" | "MTR"; rate: number; reason: string; sourceItemId?: string };
const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
export function savedAccessorySelection(item: SavedAccessoryItem) {
  return { itemId: item.sourceItemId ?? "CUSTOM", customMasterId: item.id,
    customName: item.sourceItemId ? undefined : item.name, customBrand: item.sourceItemId ? undefined : item.brand,
    customUnit: item.sourceItemId ? undefined : item.unit, manualRate: String(item.rate), priceChangeReason: item.reason };
}
export function accessoryMasterCandidates(entry: KitchenWorkspaceEntry): SavedAccessoryItem[] {
  return entry.rows.flatMap(row => {
    if (!["accessory", "linked-accessory-edit"].includes(row["Record Type"])) return [];
    try {
      const data = JSON.parse(row.Data);
      if (data.disabled || data.qty === 0 || data.manualRate === undefined || String(data.manualRate).trim() === "" || !Number.isFinite(Number(data.manualRate)) || Number(data.manualRate) < 0) return [];
      const sourceItemId = data.itemId ?? data.sourceItemId;
      const master = COSTING_ITEMS.find(item => item.id === sourceItemId);
      const reference = catalog.find(item => item.id === sourceItemId);
      const custom = sourceItemId === "CUSTOM";
      const name = custom ? data.customName : master?.materialDescription ?? reference?.name;
      if (typeof name !== "string" || !name.trim()) return [];
      const brand = custom && typeof data.customBrand === "string" ? data.customBrand : master?.brand ?? "";
      const rawUnit = String(custom ? data.customUnit ?? "PCS" : master?.rateBasis ?? reference?.unit).toUpperCase();
      if (!["PCS", "PCS.", "NOS", "SET", "MTR"].includes(rawUnit)) return [];
      const unit = rawUnit === "SET" ? "SET" as const : rawUnit === "MTR" ? "MTR" as const : "PCS" as const;
      const id = custom ? `CUSTOM:${JSON.stringify([normalize(name), normalize(brand), unit])}` : `ITEM:${sourceItemId}`;
      const key = `${row["Record Type"]}.${data.id ?? data.linkedLineId}.manualRate`;
      const audit = entry.priceChanges?.find(change => change.key === key && change.itemCode === sourceItemId && change.changedPrice === Number(data.manualRate));
      return [{ id, name: name.trim(), brand: brand.trim(), unit, rate: Number(data.manualRate),
        reason: typeof data.priceChangeReason === "string" ? data.priceChangeReason : audit?.reason ?? "", ...(!custom ? { sourceItemId } : {}) }];
    } catch { return []; }
  });
}
