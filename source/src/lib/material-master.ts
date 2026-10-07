import masterJson from "@/data/material_master.json";
import { COSTING_ITEMS } from "@/lib/costing";

export type LaminateItem = { id: string; name: string; pricePerSheet: number };
export type MaterialMaster = {
  schemaVersion: 1;
  sheetAreaSqft: number;
  includedLaminateSheetPrice: number;
  laminates: LaminateItem[];
  postlam: {
    carcassFrontId: string;
    carcassBackId: string;
    shutterFrontId: string;
    shutterBackId: string;
  };
  visibleSideShutterMaterialId: string;
};

export const MATERIAL_MASTER = masterJson as MaterialMaster;

export function laminatePrice(id: string, master: MaterialMaster = MATERIAL_MASTER): number {
  return master.laminates.find((item) => item.id === id)?.pricePerSheet ?? master.includedLaminateSheetPrice;
}

export function validateMaterialMaster(value: unknown): MaterialMaster {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Material master must be an object.");
  const master = value as Partial<MaterialMaster>;
  if (master.schemaVersion !== 1 || master.sheetAreaSqft !== 32 || master.includedLaminateSheetPrice !== 550) {
    throw new Error("Unsupported material master schema or sheet basis.");
  }
  if (!Array.isArray(master.laminates) || master.laminates.length < 1 || master.laminates.length > 200) {
    throw new Error("Add at least one laminate (maximum 200).");
  }
  const ids = new Set<string>();
  for (const item of master.laminates) {
    if (!item || typeof item.id !== "string" || !/^[A-Z0-9-]{1,40}$/.test(item.id) || ids.has(item.id) ||
      typeof item.name !== "string" || !item.name.trim() || item.name.length > 160 ||
      typeof item.pricePerSheet !== "number" || !Number.isFinite(item.pricePerSheet) || item.pricePerSheet < 0 || item.pricePerSheet > 1000000) {
      throw new Error("A laminate has an invalid or duplicate ID, name, or sheet price.");
    }
    ids.add(item.id);
  }
  const assignments = master.postlam;
  if (!assignments || ![assignments.carcassFrontId, assignments.carcassBackId, assignments.shutterFrontId, assignments.shutterBackId].every((id) => typeof id === "string" && ids.has(id))) {
    throw new Error("Every Postlam face must use an existing laminate.");
  }
  const side = COSTING_ITEMS.find((item) => item.id === master.visibleSideShutterMaterialId);
  if (!side || side.group !== "Shutter Material" || side.thicknessMm !== 18) {
    throw new Error("Visible sides must use an 18mm shutter material from the Kitchen master.");
  }
  return master as MaterialMaster;
}
