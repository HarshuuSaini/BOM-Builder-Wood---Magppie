import {
  DRAWER_BRANDS, HANDLE_TYPES, HANDLE_ZONES, KITCHEN_ZONES, MATERIAL_FIELDS, handleZoneForCode, kitchenZoneForCode,
  type BoardPriceOverrides, type HandleSetting, type HandleType, type HandleZone, type KitchenMaterials, type KitchenZone, type MaterialChoice, type MaterialField, type ZoneMaterials,
} from "./kitchen-materials";

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
};

function choicesFromCabinet(config: ImportedCabinetMaterials): ZoneMaterials {
  const choice = (field: MaterialField, itemId: string, frontSheetPrice: string, backSheetPrice: string): MaterialChoice => {
    const savedBoardPrice = config.boardPrices?.[field];
    return {
      itemId, frontSheetPrice, backSheetPrice,
      ...(savedBoardPrice?.itemId === itemId ? { boardSheetPrice: savedBoardPrice.sheetPrice } : {}),
    };
  };
  return {
    carcass: choice("carcass", config.board, config.carcassLamFrontSheetPrice, config.carcassLamBackSheetPrice),
    back: choice("back", config.backBoardId, config.backLamFrontSheetPrice, config.backLamBackSheetPrice),
    drawer: choice("drawer", config.drawerBoardId, config.drawerLamFrontSheetPrice, config.drawerLamBackSheetPrice),
    shutter: choice("shutter", config.shType, config.shutterLamFrontSheetPrice, config.shutterLamBackSheetPrice),
    visible: choice("visible", config.visibleSideMaterialId, config.visibleLamFrontSheetPrice, config.visibleLamBackSheetPrice),
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
    const matching = configs.filter((config) => kitchenZoneForCode(config.zk, config.fk) === zone);
    const selected = matching.length ? choicesFromCabinet(matching[0]) : firstChoices;
    if (matching.some((config) => MATERIAL_FIELDS.some((field) =>
      JSON.stringify(choicesFromCabinet(config)[field]) !== JSON.stringify(selected[field])))) conflictingZones.push(zone);
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
  return { materials, conflictingZones, conflictingHandleZones, conflictingHinges, conflictingDrawerBrands };
}
