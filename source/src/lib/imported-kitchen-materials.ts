import {
  DRAWER_BRANDS, HANDLE_TYPES, HANDLE_ZONES, KITCHEN_ZONES, MATERIAL_FIELDS, handleZoneForCode, isGlassCabinetFamily, kitchenZoneForCode, validBoardSheetPrice,
  type BoardPriceOverrides, type EdgeBandChoice, type HandleSetting, type HandleType, type HandleZone, type KitchenMaterials, type KitchenZone, type MaterialChoice, type MaterialField, type ZoneMaterials,
} from "./kitchen-materials";
import { COSTING_ITEMS } from "./costing";

const MATERIAL_GROUPS: Record<MaterialField, string> = {
  carcass: "Carcass/ Shelf Material", back: "Carcass Back Material", drawer: "Drawer Material",
  shutter: "Shutter Material", visible: "Shutter Material",
};
const DEFAULT_MATERIAL_IDS: Record<MaterialField, string> = {
  carcass: "KITCHEN-007", back: "KITCHEN-035", drawer: "KITCHEN-029", shutter: "KITCHEN-014", visible: "KITCHEN-014",
};
const validLaminate = (value: unknown): value is string => typeof value === "string" &&
  /^(?:\d{1,7})(?:\.\d{1,2})?$/.test(value) && Number(value) <= 1_000_000;
function validMaterialId(field: MaterialField, id: unknown): id is string {
  return typeof id === "string" && COSTING_ITEMS.some((item) => item.id === id && item.group === MATERIAL_GROUPS[field] &&
    (field !== "visible" || [18, 25].includes(item.thicknessMm ?? 0)));
}
function normalizedChoice(field: MaterialField, candidate: MaterialChoice | undefined, fallback?: MaterialChoice): MaterialChoice {
  const candidateValid = validMaterialId(field, candidate?.itemId);
  const itemId = candidateValid ? candidate!.itemId
    : validMaterialId(field, fallback?.itemId) ? fallback.itemId : DEFAULT_MATERIAL_IDS[field];
  const frontSheetPrice = candidateValid && validLaminate(candidate?.frontSheetPrice) ? candidate.frontSheetPrice
    : validLaminate(fallback?.frontSheetPrice) ? fallback.frontSheetPrice : "550";
  const backSheetPrice = candidateValid && validLaminate(candidate?.backSheetPrice) ? candidate.backSheetPrice
    : validLaminate(fallback?.backSheetPrice) ? fallback.backSheetPrice : frontSheetPrice;
  const boardSheetPrice = candidateValid && candidate?.itemId === itemId && validBoardSheetPrice(candidate?.boardSheetPrice)
    ? candidate.boardSheetPrice : fallback?.itemId === itemId && validBoardSheetPrice(fallback?.boardSheetPrice)
      ? fallback.boardSheetPrice : undefined;
  const boardFinish = candidateValid && candidate?.itemId === itemId ? candidate?.boardFinish
    : fallback?.itemId === itemId ? fallback?.boardFinish : undefined;
  const slabSqft = candidateValid && candidate?.itemId === itemId ? candidate?.slabSqft
    : fallback?.itemId === itemId ? fallback?.slabSqft : undefined;
  const slabLengthMm = candidateValid && candidate?.itemId === itemId ? candidate?.slabLengthMm
    : fallback?.itemId === itemId ? fallback?.slabLengthMm : undefined;
  const slabWidthMm = candidateValid && candidate?.itemId === itemId ? candidate?.slabWidthMm
    : fallback?.itemId === itemId ? fallback?.slabWidthMm : undefined;
  return { itemId, frontSheetPrice, backSheetPrice, ...(boardSheetPrice === undefined ? {} : { boardSheetPrice }),
    ...(boardFinish ? { boardFinish } : {}), ...(slabSqft ? { slabSqft } : {}),
    ...(slabLengthMm ? { slabLengthMm } : {}), ...(slabWidthMm ? { slabWidthMm } : {}) };
}

export type ImportedCabinetMaterials = {
  zk: string;
  fk: string;
  board: string;
  backBoardId: string;
  drawerBoardId: string;
  shType: string;
  visibleSideMaterialId: string;
  hingeChoice: string;
  drawerModel: string;
  handle: string;
  handlePrice?: string;
  handleBrand?: string;
  boardPrices?: BoardPriceOverrides;
  carcassLamFrontSheetPrice: string;
  carcassLamBackSheetPrice: string;
  backLamFrontSheetPrice: string;
  backLamBackSheetPrice: string;
  drawerLamFrontSheetPrice: string;
  drawerLamBackSheetPrice: string;
  shutterLamFrontSheetPrice: string;
  shutterLamBackSheetPrice: string;
  visibleLamFrontSheetPrice: string;
  visibleLamBackSheetPrice: string;
  glassType?: string;
  glassPricePerSqft?: string;
  sinkStoneFullBack?: boolean;
  edgeBand?: EdgeBandChoice;
};

function choicesFromCabinet(config: ImportedCabinetMaterials): ZoneMaterials {
  const choice = (field: MaterialField, itemId: string, frontSheetPrice: string, backSheetPrice: string): MaterialChoice => {
    const savedBoardPrice = config.boardPrices?.[field];
    return {
      itemId, frontSheetPrice, backSheetPrice,
      ...(savedBoardPrice && savedBoardPrice.itemId === itemId ? { boardSheetPrice: savedBoardPrice.sheetPrice } : {}),
      ...(savedBoardPrice?.itemId === itemId && savedBoardPrice?.finish ? { boardFinish: savedBoardPrice.finish } : {}),
      ...(savedBoardPrice?.itemId === itemId && savedBoardPrice?.slabSqft ? { slabSqft: savedBoardPrice.slabSqft } : {}),
      ...(savedBoardPrice?.itemId === itemId && savedBoardPrice?.slabLengthMm ? { slabLengthMm: savedBoardPrice.slabLengthMm } : {}),
      ...(savedBoardPrice?.itemId === itemId && savedBoardPrice?.slabWidthMm ? { slabWidthMm: savedBoardPrice.slabWidthMm } : {}),
    };
  };
  return {
    carcass: choice("carcass", config.board, config.carcassLamFrontSheetPrice, config.carcassLamBackSheetPrice),
    back: choice("back", config.backBoardId, config.backLamFrontSheetPrice, config.backLamBackSheetPrice),
    drawer: choice("drawer", config.drawerBoardId, config.drawerLamFrontSheetPrice, config.drawerLamBackSheetPrice),
    shutter: choice("shutter", config.shType, config.shutterLamFrontSheetPrice, config.shutterLamBackSheetPrice),
    visible: choice("visible", config.visibleSideMaterialId, config.visibleLamFrontSheetPrice, config.visibleLamBackSheetPrice),
    edgeBand: config.edgeBand ? { ...config.edgeBand } : undefined,
  };
}

/** A printed PDF stores each cabinet separately; the selection page has one choice per zone. */
export function materialsFromImportedCabinets(configs: ImportedCabinetMaterials[], previous?: KitchenMaterials): {
  materials: KitchenMaterials; conflictingZones: KitchenZone[]; conflictingHandleZones: HandleZone[]; conflictingHinges: boolean; conflictingDrawerBrands: boolean;
} {
  if (!configs.length) throw new Error("The PDF contains no cabinet materials to restore.");
  const firstChoices = choicesFromCabinet(configs[0]);
  const conflictingZones: KitchenZone[] = [];
  const zones = Object.fromEntries(KITCHEN_ZONES.map((zone) => {
    const matching = configs.filter((config) => kitchenZoneForCode(config.zk, config.fk) === zone &&
      !(zone === "Wall" && config.zk === "WC" && ["WOP", "WGL"].includes(config.fk)));
    const regular = matching.find((config) => !isGlassCabinetFamily(config.fk));
    const glass = matching.find((config) => isGlassCabinetFamily(config.fk));
    const candidate = matching.length ? choicesFromCabinet(regular ?? matching[0]) : previous?.[zone] ?? firstChoices;
    const selected = Object.fromEntries(MATERIAL_FIELDS.map((field) =>
      [field, normalizedChoice(field, candidate[field], previous?.[zone]?.[field])])) as unknown as ZoneMaterials;
    selected.edgeBand = candidate.edgeBand ?? previous?.[zone]?.edgeBand;
    if (glass) selected.glassCarcassLaminate = {
      frontSheetPrice: validLaminate(glass.carcassLamFrontSheetPrice) ? glass.carcassLamFrontSheetPrice : selected.carcass.frontSheetPrice,
      backSheetPrice: validLaminate(glass.carcassLamBackSheetPrice) ? glass.carcassLamBackSheetPrice : selected.carcass.frontSheetPrice,
    };
    else if (previous?.[zone]?.glassCarcassLaminate) selected.glassCarcassLaminate = { ...previous[zone].glassCarcassLaminate };
    if (matching.some((config) => MATERIAL_FIELDS.some((field) => {
      const candidate = choicesFromCabinet(config)[field];
      const expected = selected[field];
      // Glass cabinets intentionally use different carcass laminate prices.
      if (field === "carcass" && isGlassCabinetFamily(config.fk))
        return candidate.itemId !== expected.itemId || candidate.boardSheetPrice !== expected.boardSheetPrice;
      return JSON.stringify(candidate) !== JSON.stringify(expected);
    }))) conflictingZones.push(zone);
    return [zone, selected];
  })) as Record<KitchenZone, ZoneMaterials>;
  const handleSetting = (config: ImportedCabinetMaterials): HandleSetting => ({
    type: HANDLE_TYPES.includes(config.handle as HandleType) ? config.handle as HandleType : "NONE",
    price: config.handlePrice ?? "",
    brand: config.handleBrand ?? "",
  });
  const conflictingHandleZones: HandleZone[] = [];
  const handleDefaults = Object.fromEntries(HANDLE_ZONES.map((zone) => {
    const matching = configs.filter((config) => handleZoneForCode(config.zk, config.fk) === zone);
    const selected = handleSetting(matching[0] ?? configs[0]);
    if (matching.some((config) => JSON.stringify(handleSetting(config)) !== JSON.stringify(selected))) conflictingHandleZones.push(zone);
    return [zone, selected];
  })) as KitchenMaterials["_handleDefaults"];
  const conflictingHinges = configs.some((config) => config.hingeChoice !== configs[0].hingeChoice);
  const conflictingDrawerBrands = configs.some((config) => config.drawerModel !== configs[0].drawerModel);
  const materials: KitchenMaterials = {
    ...zones,
    _sources: Object.fromEntries(KITCHEN_ZONES.map((zone) => [zone, "Own"])) as KitchenMaterials["_sources"],
    _hingeChoice: configs[0].hingeChoice || previous?._hingeChoice,
    _drawerBrand: DRAWER_BRANDS.some((brand) => brand === configs[0].drawerModel) ? configs[0].drawerModel : previous?._drawerBrand,
    _handleDefaults: handleDefaults,
  };
  const wallOpen = configs.find((config) => config.zk === "WC" && config.fk === "WOP");
  const wallGlass = configs.find((config) => config.zk === "WC" && config.fk === "WGL");
  const special = (config: ImportedCabinetMaterials) => {
    const choices = choicesFromCabinet(config);
    // Older prints used an ordinary carcass board for these wall families.
    // Keep the cabinet and its other selections, but use the wall shutter
    // default when that board is not offered by the newer special-unit picker.
    return {
      carcass: normalizedChoice("shutter", choices.carcass, materials.Wall.shutter),
      back: normalizedChoice("back", choices.back, materials.Wall.back),
      visible: normalizedChoice("visible", choices.visible, materials.Wall.visible),
      edgeBand: choices.edgeBand ?? materials.Wall.edgeBand,
    };
  };
  materials._wallOpen = wallOpen ? special(wallOpen) : previous?._wallOpen;
  if (wallGlass) {
    const savedGlass = COSTING_ITEMS.find((item) => item.id === wallGlass.glassType && item.group === "Glass Type" && item.thicknessMm === 5);
    const previousGlass = previous?._wallGlass?.glass;
    const defaultGlass = COSTING_ITEMS.find((item) => item.id === "KITCHEN-GLASS-5-TINTED")
      ?? COSTING_ITEMS.find((item) => item.group === "Glass Type" && item.thicknessMm === 5);
    materials._wallGlass = { ...special(wallGlass), glass: savedGlass ? {
      itemId: savedGlass.id, pricePerSqft: wallGlass.glassPricePerSqft || String(savedGlass.currentRate),
    } : previousGlass ?? (defaultGlass ? { itemId: defaultGlass.id, pricePerSqft: String(defaultGlass.currentRate) } : undefined) };
  } else materials._wallGlass = previous?._wallGlass;
  const stoneSink = configs.find((config) => config.fk === "SK" && config.sinkStoneFullBack !== undefined);
  materials._sinkStoneFullBack = stoneSink?.sinkStoneFullBack ?? previous?._sinkStoneFullBack;
  return { materials, conflictingZones, conflictingHandleZones, conflictingHinges, conflictingDrawerBrands };
}
