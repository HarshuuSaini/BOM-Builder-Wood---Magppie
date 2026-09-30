import masterJson from "@/data/costing_master.json";

export type RateBasis = "SQFT" | "MTR" | "KG" | "SET" | "PCS";
export type CostingMasterItem = {
  id: string; sNo: number; elevation: string; sourceSubgroup: string;
  materialDescription: string; remark: string; unitCost: number | null; unit: string;
  sqft: number | null; price: number | null; sqftPrice: number | null;
  group: string; subgroup: string; type: string; brand: string;
  thicknessMm: number | null; rateBasis: RateBasis; previousRate: number | null;
  currentRate: number; rateChange: number | null; rateChangePercent: number | null;
};
export type CostingMaster = {
  schemaVersion: number; source: string; generatedAt: string; currency: string;
  items: CostingMasterItem[];
};

export const COSTING_MASTER = masterJson as CostingMaster;
export const COSTING_ITEMS = COSTING_MASTER.items;

export function findCostingItem(match: Partial<Pick<CostingMasterItem,
  "group" | "subgroup" | "type" | "brand" | "thicknessMm" | "rateBasis"
>>): CostingMasterItem | undefined {
  return COSTING_ITEMS.find((item) => Object.entries(match).every(([key, value]) =>
    item[key as keyof CostingMasterItem] === value));
}

/* Compatibility keys used by the cabinet calculator. Every available value is
 * selected from the bundled master; rates are not maintained separately. */
export const RATE_KEYS = [
  "CARCASS_POSTLAM_PLY", "CARCASS_PRELAM_MDF", "CARCASS_PRELAM_PB", "CARCASS_PRELAM_HDHMR",
  "SHUTTER_PRELAM_PB", "SHUTTER_PRELAM_MDF", "SHUTTER_PRELAM_HDHMR", "SHUTTER_UV_HDHMR",
  "SHUTTER_POSTLAM_PLY", "SHUTTER_MEMBRANE", "SHUTTER_PU_SINGLE", "SHUTTER_PU_DOUBLE",
  "EDGEBAND_PER_RMT", "DRAWER_LB", "DRAWER_HB", "HINGE", "ACC_GALLERY_TRAY", "ACC_BIN",
] as const;
export type RateKey = (typeof RATE_KEYS)[number];
export type CostingRates = Record<RateKey, number>;
const rate = (match: Parameters<typeof findCostingItem>[0]) => findCostingItem(match)?.currentRate ?? 0;

export const DEFAULT_RATES: CostingRates = {
  CARCASS_POSTLAM_PLY: rate({ group: "Board", subgroup: "BWP Ply BSL", type: "Carcass Postlam", thicknessMm: 18 }),
  CARCASS_PRELAM_MDF: rate({ group: "Board", subgroup: "MDF BSL", type: "Carcass Prelam", thicknessMm: 18 }),
  CARCASS_PRELAM_PB: rate({ group: "Board", subgroup: "Particle Board BSL", type: "Carcass Prelam", thicknessMm: 18 }),
  CARCASS_PRELAM_HDHMR: rate({ group: "Board", subgroup: "HDHMR BSL", type: "Carcass Prelam", thicknessMm: 18 }),
  SHUTTER_PRELAM_PB: rate({ group: "Board", subgroup: "Particle Board OSL", type: "Shutter Prelam", thicknessMm: 18 }),
  SHUTTER_PRELAM_MDF: rate({ group: "Board", subgroup: "MDF OSL", type: "Shutter Prelam", thicknessMm: 18 }),
  SHUTTER_PRELAM_HDHMR: rate({ group: "Board", subgroup: "HDHMR OSL", type: "Shutter Prelam", thicknessMm: 18 }),
  SHUTTER_UV_HDHMR: 0,
  SHUTTER_POSTLAM_PLY: rate({ group: "Board", subgroup: "BWP Ply OSL", type: "Shutter Postlam", thicknessMm: 18 }),
  SHUTTER_MEMBRANE: 0, SHUTTER_PU_SINGLE: 0, SHUTTER_PU_DOUBLE: 0,
  EDGEBAND_PER_RMT: rate({ group: "Edge Band", subgroup: "Carcass", rateBasis: "MTR" }),
  DRAWER_LB: rate({ group: "Drawer System", subgroup: "Low Back", brand: "Blum" }),
  DRAWER_HB: rate({ group: "Drawer System", subgroup: "High Back", brand: "Blum" }),
  HINGE: rate({ group: "Hinge", subgroup: "0 CRANK", type: "100° Soft Close", brand: "Hettich" }),
  ACC_GALLERY_TRAY: 0, ACC_BIN: 0,
};

export const CARCASS_RATE_KEY: Record<string, RateKey> = {
  A: "CARCASS_POSTLAM_PLY", B: "CARCASS_PRELAM_MDF", C: "CARCASS_PRELAM_PB",
};
export const SHUTTER_RATE_KEY: Record<string, RateKey> = {
  PRELAM: "SHUTTER_PRELAM_PB", POSTLAM: "SHUTTER_POSTLAM_PLY",
  MEMBRANE: "SHUTTER_MEMBRANE", PU1: "SHUTTER_PU_SINGLE", PU2: "SHUTTER_PU_DOUBLE",
};

export function sanitizeRates(input: unknown): CostingRates {
  const out = { ...DEFAULT_RATES };
  if (input && typeof input === "object") for (const key of RATE_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
    if (typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0) out[key] = parsed;
  }
  return out;
}
