export const KITCHEN_ZONES = ["Base", "Sink", "Wall", "Tall", "Loft", "Mid"] as const;
export type KitchenZone = (typeof KITCHEN_ZONES)[number];
export type MaterialSource = KitchenZone | "All" | "Own";

export const DEFAULT_MATERIAL_SOURCES: Record<KitchenZone, MaterialSource> = {
  Base: "Own", Sink: "Base", Wall: "Base", Tall: "Wall", Loft: "Tall", Mid: "Loft",
};

export function createsMaterialSourceCycle(zone: KitchenZone, source: MaterialSource,
  sources: Record<KitchenZone, MaterialSource>): boolean {
  if (source === "Own" || source === "All") return false;
  const seen = new Set<KitchenZone>([zone]);
  let current: MaterialSource = source;
  while (current !== "Own" && current !== "All") {
    if (seen.has(current)) return true;
    seen.add(current);
    current = sources[current];
  }
  return false;
}

export const MATERIAL_FIELDS = ["carcass", "back", "drawer", "shutter", "visible"] as const;
export type MaterialField = (typeof MATERIAL_FIELDS)[number];

export type MaterialChoice = {
  itemId: string;
  frontSheetPrice: string;
  backSheetPrice: string;
  boardSheetPrice?: string;
};


export type BoardPriceOverride = { itemId: string; sheetPrice: string };
export type BoardPriceOverrides = Partial<Record<MaterialField, BoardPriceOverride>>;

export function validBoardSheetPrice(value: unknown): value is string {
  return typeof value === "string" && /^(?:\d{1,7})(?:\.\d{1,6})?$/.test(value) && Number(value) <= 1000000;
}

export function boardPricesFromMaterials(choices?: ZoneMaterials): BoardPriceOverrides {
  return Object.fromEntries(MATERIAL_FIELDS.flatMap((field) => {
    const choice = choices?.[field];
    return choice && validBoardSheetPrice(choice.boardSheetPrice)
      ? [[field, { itemId: choice.itemId, sheetPrice: choice.boardSheetPrice }]] : [];
  }));
}

export function selectedBoardRate(item: { id: string; type: string; currentRate: number }, override?: BoardPriceOverride): number {
  return /^(?:prelam|postlam)$/i.test(item.type) && override?.itemId === item.id && validBoardSheetPrice(override.sheetPrice)
    ? Number(override.sheetPrice) / 32 : item.currentRate;
}

export type ZoneMaterials = Record<MaterialField, MaterialChoice>;
export const DRAWER_BRANDS = ["Lian", "Hettich", "Blum", "Hafele", "Grass"] as const;
export const HANDLE_ZONES = ["Base", "Wall", "Tall", "Loft"] as const;
export type HandleZone = (typeof HANDLE_ZONES)[number];
export const HANDLE_TYPES = ["XCJ", "PUSH", "KNOB", "HANDLE", "NONE"] as const;
export type HandleType = (typeof HANDLE_TYPES)[number];
export type HandleSetting = { type: HandleType; price: string; brand: string };
export type HandleDefaults = Partial<Record<HandleZone, HandleSetting | "STD" | "XCJ">>;
export function handleZoneForCode(code: string, family?: string): HandleZone {
  if (HANDLE_ZONES.includes(code as HandleZone)) return code as HandleZone;
  const zone = kitchenZoneForCode(code, family);
  return zone === "Sink" ? "Base" : zone === "Mid" ? "Wall" : zone;
}
export function handleSettingFor(materials: KitchenMaterials | undefined, code: string, family?: string): HandleSetting {
  const zone = handleZoneForCode(code, family);
  const saved = materials?._handleDefaults?.[zone];
  if (typeof saved === "string") return { type: saved === "XCJ" && zone !== "Wall" && zone !== "Loft" ? "XCJ" : "NONE", price: "", brand: "" };
  if (saved?.type === "XCJ" && (zone === "Wall" || zone === "Loft")) return { ...saved, type: "NONE" };
  return saved ?? { type: zone === "Base" || zone === "Tall" ? "XCJ" : "NONE", price: "", brand: "" };
}
export type KitchenMaterials = Record<KitchenZone, ZoneMaterials> & {
  _sources?: Partial<Record<KitchenZone, MaterialSource>>;
  _hingeChoice?: string;
  _drawerBrand?: string;
  _handleDefaults?: HandleDefaults;
};

export function kitchenZoneForCode(code: string, family?: string): KitchenZone {
  if (/^(BC|BCL|BB|BBL)$/.test(code) && family === "SK") return "Sink";
  if (/^(WC|WB)/.test(code)) return "Wall";
  if (/^(TC|TB|TCL)/.test(code)) return "Tall";
  if (/^(LO|LB)/.test(code)) return "Loft";
  if (code === "MD") return "Mid";
  return "Base";
}
