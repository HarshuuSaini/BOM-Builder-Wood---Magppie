import { COSTING_ITEMS, SINK_STONE_BOARD_ID, SINK_STONE_SLAB_SQFT } from "@/lib/costing";

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
  boardFinish?: string;
  slabSqft?: string;
  slabLengthMm?: string;
  slabWidthMm?: string;
};

export type EdgeBandChoice = {
  finish: string;
  carcassPricePerRmt: string;
  shutterPricePerRmt: string;
  byMaterial?: Partial<Record<MaterialField, { finish: string; pricePerRmt: string }>>;
};

export function edgeBandForMaterial(choice: EdgeBandChoice | undefined, field: MaterialField) {
  return choice?.byMaterial?.[field] ?? {
    finish: choice?.finish ?? "White 0.8mm",
    pricePerRmt: field === "shutter" || field === "visible"
      ? choice?.shutterPricePerRmt ?? "10.3" : choice?.carcassPricePerRmt ?? "6",
  };
}


export type BoardPriceOverride = { itemId: string; sheetPrice: string; finish?: string; slabSqft?: string; slabLengthMm?: string; slabWidthMm?: string };
export type BoardPriceOverrides = Partial<Record<MaterialField, BoardPriceOverride>>;

export function validBoardSheetPrice(value: unknown): value is string {
  return typeof value === "string" && /^(?:\d{1,7})(?:\.\d{1,6})?$/.test(value) && Number(value) <= 1000000;
}

export function stoneSlabSqft(value: unknown): number {
  const number = Number(value);
  return typeof value === "string" && Number.isFinite(number) && number > 0 && number <= 1000 ? number : SINK_STONE_SLAB_SQFT;
}

export function stoneSlabAreaFromDimensions(lengthMm: number, widthMm: number): string {
  return String(Math.max(1, Math.round(lengthMm * widthMm / 92903.04)));
}

export function validStoneDimension(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,5}$/.test(value) && Number(value) > 0 && Number(value) <= 10000;
}

export function boardPricesFromMaterials(choices?: ZoneMaterials): BoardPriceOverrides {
  return Object.fromEntries(MATERIAL_FIELDS.flatMap((field) => {
    const choice = choices?.[field];
    if (!choice) return [];
    const sheetPrice = validBoardSheetPrice(choice.boardSheetPrice) ? choice.boardSheetPrice
      : choice.boardFinish || choice.slabSqft ? String((COSTING_ITEMS.find((item) => item.id === choice.itemId)?.currentRate ?? 0) *
          (choice.itemId === SINK_STONE_BOARD_ID ? SINK_STONE_SLAB_SQFT : 32)) : undefined;
    return sheetPrice !== undefined
      ? [[field, { itemId: choice.itemId, sheetPrice,
        ...(choice.boardFinish ? { finish: choice.boardFinish } : {}),
        ...(choice.itemId === SINK_STONE_BOARD_ID && choice.slabSqft ? { slabSqft: choice.slabSqft } : {}),
        ...(choice.itemId === SINK_STONE_BOARD_ID && choice.slabLengthMm ? { slabLengthMm: choice.slabLengthMm } : {}),
        ...(choice.itemId === SINK_STONE_BOARD_ID && choice.slabWidthMm ? { slabWidthMm: choice.slabWidthMm } : {}) }]] : [];
  }));
}

export function selectedBoardFinish(itemId: string, override: BoardPriceOverride | undefined, fallback: string): string {
  return override?.itemId === itemId && override.finish?.trim() ? override.finish.trim()
    : itemId === SINK_STONE_BOARD_ID ? "Pearl White HG" : fallback;
}

export function selectedBoardRate(item: { id: string; type: string; currentRate: number }, override?: BoardPriceOverride): number {
  return /^(?:prelam|postlam)$/i.test(item.type) && override?.itemId === item.id && validBoardSheetPrice(override.sheetPrice)
    ? Number(override.sheetPrice) / (item.id === SINK_STONE_BOARD_ID ? stoneSlabSqft(override.slabSqft) : 32) : item.currentRate;
}

export type ZoneMaterials = Record<MaterialField, MaterialChoice> & {
  /** Glass-shutter cabinets use the same carcass board, but may laminate its faces differently. */
  glassCarcassLaminate?: { frontSheetPrice: string; backSheetPrice: string };
  edgeBand?: EdgeBandChoice;
};

export type SpecialWallMaterials = {
  carcass: MaterialChoice;
  back: MaterialChoice;
  visible: MaterialChoice;
  glass?: { itemId: string; pricePerSqft: string };
  edgeBand?: EdgeBandChoice;
};
export type SpecialWallSource = "Wall" | "Own";

const GLASS_CABINET_FAMILIES = new Set(["WGL", "SHFG", "DPNG", "PPNG", "BLNG", "LOWSG", "LGL"]);
export const isGlassCabinetFamily = (family?: string) => !!family && GLASS_CABINET_FAMILIES.has(family);

export function carcassLaminateForCabinet(choices: ZoneMaterials, glassCabinet: boolean) {
  return glassCabinet
    ? { front: choices.glassCarcassLaminate?.frontSheetPrice ?? choices.carcass.frontSheetPrice,
        back: choices.glassCarcassLaminate?.backSheetPrice ?? choices.carcass.frontSheetPrice }
    : { front: choices.carcass.frontSheetPrice, back: choices.carcass.frontSheetPrice };
}
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
  _wallOpen?: SpecialWallMaterials;
  _wallGlass?: SpecialWallMaterials;
  _wallSpecialSources?: { open: SpecialWallSource; glass: SpecialWallSource };
  _sinkStoneFullBack?: boolean;
};

export function materialChoicesForCabinet(materials: KitchenMaterials | undefined, code: string, family: string): ZoneMaterials | undefined {
  if (!materials) return undefined;
  const zone = materials[kitchenZoneForCode(code, family)] ?? materials.Base;
  const special = code === "WC" && family === "WOP" ? materials._wallOpen
    : code === "WC" && family === "WGL" ? materials._wallGlass : undefined;
  return special ? { ...zone, carcass: special.carcass, back: special.back, visible: special.visible,
    edgeBand: special.edgeBand ?? zone.edgeBand,
    glassCarcassLaminate: undefined } : zone;
}

export function kitchenZoneForCode(code: string, family?: string): KitchenZone {
  if (/^(BC|BCL|BB|BBL)$/.test(code) && family === "SK") return "Sink";
  if (/^(WC|WB)/.test(code)) return "Wall";
  if (/^(TC|TB|TCL)/.test(code)) return "Tall";
  if (/^(LO|LB)/.test(code)) return "Loft";
  if (code === "MD") return "Mid";
  return "Base";
}
