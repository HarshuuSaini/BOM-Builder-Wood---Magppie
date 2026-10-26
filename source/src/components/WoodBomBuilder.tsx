"use client";

/**
 * WoodBomBuilder — plywood/carcass kitchens.
 *
 * Ported from CarcassBomBuilder.tsx. The catalog (zones, families, variants,
 * elevations) and the BOM pipeline (Panel → pack → tree → FullBomRow) are the
 * stone versions verbatim. Only construction logic differs.
 *
 * Pipeline, unchanged from stone:
 *   buildCarcassInnerRaw → mergeCarcassPanels → buildModel
 *   → buildRawRows / buildCSV
 *   → buildFullBomData → buildOosData → buildOptiData
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx-js-style";
import { searchBoardItems, searchLaminateItems, searchHardwareItems } from "@/lib/rawmaterial";
import boardFinishesData from "@/data/board_finishes.json";
import laminateFinishesData from "@/data/laminate_finishes.json";
import edgebandFinishesData from "@/data/edgeband_finishes.json";
import accessoryCatalogData from "@/data/accessory_catalog.json";
import hardwarePacksData from "@/data/hardware_packs.json";
import { getPartBaseName, getPanelBaseName, normalizePartOrPanelName } from "@/lib/naming";
import { exportBomWorkbook, exportBomCsv, exportCostingWorkbook, exportBulkCostingWorkbook, type AccessoryExportRow, type ProjectSetupRow } from "@/lib/export";
import { COSTING_ITEMS, DEFAULT_RATES, DEFAULT_BOARD_PROCESSING_RATES, SINK_STONE_BOARD_ID, findCostingItem, costingItemNames, type CostingMasterItem, type CostingRates } from "@/lib/costing";
import { quantityWithWaste } from "@/lib/wastage";
import { MATERIAL_MASTER, laminatePrice } from "@/lib/material-master";
import { boardPricesFromMaterials, selectedBoardRate, selectedBoardFinish, stoneSlabSqft, validStoneDimension, validBoardSheetPrice, edgeBandForMaterial, MATERIAL_FIELDS, HANDLE_TYPES, DRAWER_BRANDS, handleSettingFor, carcassLaminateForCabinet, materialChoicesForCabinet, isGlassCabinetFamily, type BoardPriceOverride, type BoardPriceOverrides, type EdgeBandChoice, type MaterialField, kitchenZoneForCode, type KitchenMaterials, type ZoneMaterials } from "@/lib/kitchen-materials";
import { materialsFromImportedCabinets } from "@/lib/imported-kitchen-materials";
import { UserSignOut } from "@/components/UserSignOut";
import { encodeProjectPrintData, readPrintedProjectPdf } from "@/lib/print-project";
import type { BomReportRow } from "@/lib/types";
import { allocatePurchaseCosts, roundQuantity, sheetQuantityInput, type PurchaseTotal } from "@/lib/purchase-rounding";
import { activeKitchenId, kitchenNameFromPdfFilename, readKitchenWorkspace, setActiveKitchenId, writeKitchenWorkspace, type KitchenWorkspaceEntry, type KitchenCostingSnapshot } from "@/lib/kitchen-workspace";
import { parseManualCosting, type ManualCostingImport } from "@/lib/manual-costing-import";
import { blindOpeningLimits, isDoubleShutterWidth, shelfCodeToken, tallApplianceDrawerCode } from "@/lib/cabinet-rules";

/* ------------------------------------------------------------------ */
/*  Types & Interfaces  (identical shapes to stone)                    */
/* ------------------------------------------------------------------ */

interface Panel {
  name: string;
  w: number;
  h: number;
  qty: number;
  drill: string | null;
  pack: string;
  t?: number;
  /** wood addition: material key so the raw layer can group by board */
  mat?: string;
  /** wood addition: 0.8mm band on all four edges? backs are false */
  band?: boolean;
  /** A structural cabinet side made from the admin-selected visible shutter board. */
  visibleSide?: boolean;
  materialId?: string;
  /** Laminate sheet prices for an extra carcass panel outside a cabinet. */
  extraCarcassLaminate?: { front: string; back: string };
  /** Postlam prices for a filler or visible panel outside a cabinet. */
  extraLaminate?: { front: string; back: string };
  extraEdgeBand?: EdgeBandChoice;
  extraBoardPrice?: BoardPriceOverride;
  extraMaterialRole?: "shutter" | "visible";
  extraFinish?: string;
}

interface Profile {
  name: string;
  len: number;
  qty: number;
  type: string;
  orientation?: "vertical" | "horizontal";
  pack: string;
}

interface Hardware {
  name: string;
  qty: number;
  uom?: string;
  pack?: string;
  hingeItemName?: string;
  components?: HardwarePackDefinition[];
}

interface Consumable {
  name: string;
  qty: number;
  uom: string;
  pack: string;
}

interface FillerRow {
  id: number;
  /** Cabinet-created fillers follow the linked cabinet's height and quantity. */
  linkedLineId?: number;
  fillerSide?: "LH" | "RH";
  fillerType?: "filler" | "top-filler" | "cover-panel" | "chimney-panel" | "dishwasher-panel";
  zone: string;
  customShade: string;
  qty: number;
  customHeight: string;
  customWidth: string;
  customDepth?: string;
  elevation: string;
}

interface LinkedFillerEdit {
  linkedLineId: number;
  fillerSide?: "LH" | "RH";
  disabled?: boolean;
  fillerType?: FillerRow["fillerType"];
  zone?: string;
  customShade?: string;
  qty?: number;
  customHeight?: string;
  customWidth?: string;
  customDepth?: string;
  elevation?: string;
}

interface VisiblePanelRow extends FillerRow {
  shutterType: string;
}

/** Countertop is now a bought-in single line: L × D × T × material × qty. */
interface CountertopRow {
  id: number;
  length: string;
  depth: string;
  thickness: string;
  material: string;
  /** Empty follows the kitchen shutter board; CUSTOM preserves older free-text rows. */
  materialId?: string;
  ratePerSqft?: string;
  qty: number;
}

function counterPlyThickness(row: CountertopRow, defaultShutterType: string): number {
  return row.thickness.trim() === ""
    ? countertopMaterialItem(row, defaultShutterType)?.thicknessMm ?? 0
    : Number(row.thickness);
}

function counterPlyAreaSqft(row: CountertopRow, defaultShutterType = ""): number {
  const length = Number(row.length);
  const thickness = counterPlyThickness(row, defaultShutterType);
  return length > 0 && thickness > 0 ? length * thickness * Math.max(1, row.qty || 1) / 92903 : 0;
}

function counterPlyCostSqft(row: CountertopRow): number {
  const length = Number(row.length);
  const depth = Number(row.depth || 600);
  return length > 0 && depth > 0 ? length * depth * Math.max(1, row.qty || 1) / 92903 : 0;
}

type CarcassModel = {
  boardPrices?: BoardPriceOverrides;
  code: string;
  zk: string;
  fk: string;
  vid: string;
  hand: string;
  handle: string;
  handlePrice?: string;
  handleBrand?: string;
  board: string;
  backBoardId: string;
  drawerBoardId: string;
  shType: string;
  visibleSides: VisibleSides;
  visibleSideMaterialId: string;
  carcassLamFrontSheetPrice: string;
  carcassLamBackSheetPrice: string;
  backLamFrontSheetPrice: string;
  backLamBackSheetPrice: string;
  drawerLamFrontSheetPrice: string;
  drawerLamBackSheetPrice: string;
  visibleLamFrontSheetPrice: string;
  visibleLamBackSheetPrice: string;
  shutterLamFrontSheetPrice: string;
  shutterLamBackSheetPrice: string;
  glassType: string;
  glassPricePerSqft?: string;
  sinkStoneFullBack?: boolean;
  edgeBand?: EdgeBandChoice;
  finish: string;
  hingeChoice: HingeChoice;
  neon: string;
  drawerModel: string;
  W: number;
  H: number;
  D: number;
  shelfQty: number;
  fillerWidth?: number;
  fillerSides?: "LH" | "RH" | "BOTH";
  fillerWidthRH?: number;
  blindOpeningWidth?: number;
  spotLight?: boolean;
  panels: Panel[];
  profiles: Profile[];
  hardware: Hardware[];
  cons: Consumable[];
  pkRows: PkRow[];
  stubs: string[];
};

type PkRow = { pack: string; type: string; qty: number };
type ProjectLine = { id: number; m: CarcassModel; qty: number; elevation: string };
type VisibleSides = "" | "LH" | "RH" | "BOTH";
type CabinetConfig = Pick<CarcassModel, "boardPrices" | "zk" | "fk" | "vid" | "hand" | "handle" | "handlePrice" | "handleBrand" | "board" | "backBoardId" | "drawerBoardId" | "shType" | "visibleSides" | "visibleSideMaterialId" | "carcassLamFrontSheetPrice" | "carcassLamBackSheetPrice" | "backLamFrontSheetPrice" | "backLamBackSheetPrice" | "drawerLamFrontSheetPrice" | "drawerLamBackSheetPrice" | "visibleLamFrontSheetPrice" | "visibleLamBackSheetPrice" | "shutterLamFrontSheetPrice" | "shutterLamBackSheetPrice" | "glassType" | "glassPricePerSqft" | "sinkStoneFullBack" | "edgeBand" | "hingeChoice" | "neon" | "W" | "H" | "D" | "drawerModel" | "finish"> & { shelfQty?: number; fillerWidth?: number; fillerSides?: "LH" | "RH" | "BOTH"; fillerWidthRH?: number; blindOpeningWidth?: number; spotLight?: boolean };

type FullBomRow = {
  SO: string;
  Elevation: string;
  "Main Group": string;
  "Sub Group": string;
  Level: number;
  Item: string;
  SKU: string;
  Type: string;
  Height: string;
  Width: string;
  Depth: string;
  Thickness: string;
  Finish: string;
  Grain: string;
  "CF Type": string;
  "Profile Code": string;
  "SO Qty": number;
  "Waste %": number;
  "Actual Qty": number;
  Pcs: number | string;
  "In Stock": number;
  "Eff. Stock": number;
  Deficit: number;
  Unit: string;
  Status: string;
  /** Internal — applyRowColors() in export.ts keys the row fill off this. */
  _type: string;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SQDIV = 92903.04;
const SHEET_W = 2440;
const SHEET_H = 1220;
const SHEET_SQFT = (SHEET_W * SHEET_H) / SQDIV; // 32.03
/** Kitchen Postlam master rates are finished-board rates with the default laminate already included. */
const LAMINATE_PRICE_SHEET_SQFT = 32;
const DEFAULT_LAMINATE_SHEET_PRICE = String(MATERIAL_MASTER.includedLaminateSheetPrice);
const laminateSqftRate = (sheetPrice: string) => Number(sheetPrice) / LAMINATE_PRICE_SHEET_SQFT;
const isValidLaminatePrice = (value: string) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
const isPostlamItem = (item?: CostingMasterItem) => item?.type.toUpperCase() === "POSTLAM";

/** Carcass nominal thickness. Option A is a 16mm core + 0.8mm laminate x2. */
const T = 18;
/** Back nominal thickness. Option A is a 6mm core + 0.8mm laminate x2. */
const T_BACK = 8;
/** Back groove allowance: 5mm groove per side less 1mm total clearance. */
const GROOVE = 9;
/** Gola cuts this off the top panel depth. Unchanged from stone. */
const CJ_CUT = 23;
const SHELF_W_CLR = 1;
const SHELF_D_OFF = 28;
/** Edge band is 0.8mm on all four edges of every panel except the back. */
const BAND_T = 0.8;
/** Add 50mm to each edge-band strip for cutting allowance. */
const BAND_EDGE_ALLOWANCE = 50;

const LAM_ADH = 25;                                  // g/sqft/side
const EDGE_ADH_G_PER_M = 6;                           // g/running metre
const PU_RATE = { epoxy: 15, primer: 30, top: 50 };  // g/sqft/side
const MEMB_OVER = 50;                                // mm per edge
const MEMB_ADH: number | null = null;                // rate not yet supplied

const WASTE = { carcass: 10, shutter: 20, profile: 20, edgeBand: 3 };

const ELEVATIONS = ["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "JJ", "KK"];
const DRAWER_MODELS: string[] = [...DRAWER_BRANDS];
const HINGE_CHOICES = [
  "Hettich Soft Close", "Hettich Non Soft Close",
  "Hafele Soft Close", "Hafele Non Soft Close",
  "Blum Soft Close", "Blum Non Soft Close",
  "Magppie Soft Close", "Magppie Non Soft Close",
] as const;
type HingeChoice = (typeof HINGE_CHOICES)[number];
type HingeMode = "standard" | "blind" | "wide";

function hingeModeFor(zk: string, fk: string): HingeMode {
  if (ZONES[zk].blind) return "blind";
  return ["BPO", "WBP", "PPN"].includes(fk) ? "wide" : "standard";
}

function hingeItemFor(choice: HingeChoice, mode: HingeMode): string {
  const [brand] = choice.split(" ");
  const soft = !choice.includes("Non Soft");
  const candidates = COSTING_ITEMS.filter((item) => item.group === "Hinge" && item.brand.toLowerCase() === brand.toLowerCase())
    .filter((item) => mode === "blind" ? item.subgroup === "BLIND" : mode === "wide" ? item.subgroup.includes("165") : item.subgroup === "0 CRANK");
  const selected = candidates.find((item) => soft ? !/WITHOUT|W\/OUT|NON SOFT/i.test(item.type) : /WITHOUT|W\/OUT|NON SOFT/i.test(item.type));
  if (selected) return selected.materialDescription;
  const angle = mode === "blind" ? "BLIND" : mode === "wide" ? "165 DEGREE" : "95-110 DEGREE";
  return `${brand.toUpperCase()} ${soft ? "SOFT CLOSE" : "NON SOFT CLOSE"} HINGE ${angle}`;
}

const sqft = (w: number, h: number) => (w * h) / SQDIV;

/** Pricing area includes the 100mm plinth allowance for leg-mounted Base and Tall units. */
const cabinetAreaHeight = (zoneKey: string, height: number) =>
  height + (ZONES[zoneKey]?.mount === "legs" ? 100 : 0);
const perim = (w: number, h: number) => (2 * (w + h) + 4 * BAND_EDGE_ALLOWANCE) / 1000;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const legCount = (w: number) => (w <= 150 ? 2 : w >= 1050 ? 6 : 4);
const hingePackCount = (h: number) => (h <= 720 ? 2 : h <= 1050 ? 3 : 5);

type HardwareComponent = { name: string; qty: number; uom: string; pack: string };
type HardwarePackDefinition = { component: string; qty: number; uom: string };
const HARDWARE_PACK_DEFINITIONS = hardwarePacksData.definitions as Record<string, HardwarePackDefinition[]>;

/** Exact pack contents from the approved costing workbook's pack sheet. */
function expandHardwarePack(h: Hardware): HardwareComponent[] {
  const pack = h.name;
  const wideCount = pack.match(/^HARDWARE PACK HINGE 165 DEGREE Set\/(\d+)$/i)?.[1];
  const definition = h.components ?? HARDWARE_PACK_DEFINITIONS[pack]
    ?? (wideCount ? HARDWARE_PACK_DEFINITIONS[`HARDWARE PACK HINGE 0 CRANK Set/${wideCount}`] : undefined);
  if (definition) return definition.map((component) => ({
    name: h.hingeItemName && /^HINGE\b/i.test(component.component) ? h.hingeItemName : component.component,
    qty: component.qty * h.qty,
    uom: component.uom,
    pack,
  }));
  return [{ name: h.name, qty: h.qty, uom: h.uom ?? "nos", pack: h.pack ?? "Hardware Pack" }];
}

/* ------------------------------------------------------------------ */
/*  Boards & shutter types                                             */
/* ------------------------------------------------------------------ */

const CARCASS_BOARD_ITEMS = COSTING_ITEMS.filter((item) => item.group === "Carcass/ Shelf Material");
const CARCASS_BACK_ITEMS = COSTING_ITEMS.filter((item) => item.group === "Carcass Back Material");
const SHUTTER_BOARD_ITEMS = COSTING_ITEMS.filter((item) => item.group === "Shutter Material");
const COUNTER_PLY_GROUPS = ["Countertop Base PLY", "Carcass/ Shelf Material", "Shutter Material"];
const COUNTER_PLY_ITEMS = COSTING_ITEMS.filter((item) => COUNTER_PLY_GROUPS.includes(item.group));
const GLASS_SHUTTER_ITEMS = COSTING_ITEMS.filter((item) => item.group === "Glass Type" && item.type === "Shutter Glass" && item.thicknessMm === 5);
const GLASS_SHELF_ITEM = COSTING_ITEMS.find((item) => item.id === "KITCHEN-GLASS-6-CLEAR");
const CARCASS_EDGE_BAND_ITEM = COSTING_ITEMS.find((item) => item.group === "Edge Band" && item.subgroup === "Carcass");
const SHUTTER_EDGE_BAND_ITEM = COSTING_ITEMS.find((item) => item.group === "Edge Band" && item.subgroup === "Shutter");
function defaultEdgeBandChoice(): EdgeBandChoice {
  return { finish: (edgebandFinishesData as string[])[0] ?? "White 0.8mm",
    carcassPricePerRmt: String(CARCASS_EDGE_BAND_ITEM?.currentRate ?? 6),
    shutterPricePerRmt: String(SHUTTER_EDGE_BAND_ITEM?.currentRate ?? 10.3) };
}
function validEdgeBandChoice(choice: unknown): boolean {
  if (choice === undefined) return true;
  if (!choice || typeof choice !== "object") return false;
  const value = choice as Partial<EdgeBandChoice>;
  return typeof value.finish === "string" && /^(?=.{1,80}$)[\p{L}\p{N} ._()+&/-]+$/u.test(value.finish) &&
    validBoardSheetPrice(value.carcassPricePerRmt) && validBoardSheetPrice(value.shutterPricePerRmt) &&
    (value.byMaterial === undefined || Object.entries(value.byMaterial).every(([field, selection]) =>
      MATERIAL_FIELDS.includes(field as MaterialField) && !!selection &&
      typeof selection.finish === "string" && /^(?=.{1,80}$)[\p{L}\p{N} ._()+&/-]+$/u.test(selection.finish) &&
      validBoardSheetPrice(selection.pricePerRmt)));
}
const DEFAULT_BOARD_ID = CARCASS_BOARD_ITEMS.find((item) => item.elevation === "CARCASS POSTLAM BWP PLY")?.id
  ?? CARCASS_BOARD_ITEMS[0]?.id ?? "";
const DEFAULT_SHTYPE = SHUTTER_BOARD_ITEMS.find((item) => item.elevation === "SHUTTER POSTLAM BWP PLY")?.id
  ?? SHUTTER_BOARD_ITEMS[0]?.id ?? "";
const DEFAULT_BACK_ID = CARCASS_BACK_ITEMS.find((item) => item.id === "KITCHEN-035")?.id ?? CARCASS_BACK_ITEMS[0]?.id ?? "";
const DRAWER_BOARD_ITEMS = COSTING_ITEMS.filter((item) => item.group === "Drawer Material");
const DEFAULT_DRAWER_ID = DRAWER_BOARD_ITEMS.find((item) => item.id === "KITCHEN-029")?.id ?? DRAWER_BOARD_ITEMS[0]?.id ?? "";
const DEFAULT_GLASS_TYPE = GLASS_SHUTTER_ITEMS.find((item) => item.id === "KITCHEN-GLASS-5-TINTED")?.id
  ?? GLASS_SHUTTER_ITEMS[0]?.id ?? "";
const DEFAULT_LAMINATE_PRICES = {
  carcassLamFrontSheetPrice: String(laminatePrice(MATERIAL_MASTER.postlam.carcassFrontId)),
  carcassLamBackSheetPrice: String(laminatePrice(MATERIAL_MASTER.postlam.carcassBackId)),
  shutterLamFrontSheetPrice: String(laminatePrice(MATERIAL_MASTER.postlam.shutterFrontId)),
  shutterLamBackSheetPrice: String(laminatePrice(MATERIAL_MASTER.postlam.shutterBackId)),
};

function glassShutterItemOf(id: string): CostingMasterItem {
  return GLASS_SHUTTER_ITEMS.find((item) => item.id === id) ?? GLASS_SHUTTER_ITEMS[0];
}

function carcassBoardOf(id: string, backBoardId?: string) {
  const item = CARCASS_BOARD_ITEMS.find((candidate) => candidate.id === id)
    ?? SHUTTER_BOARD_ITEMS.find((candidate) => candidate.id === id) ?? CARCASS_BOARD_ITEMS[0];
  const backItem = (backBoardId ? CARCASS_BACK_ITEMS.find((candidate) => candidate.id === backBoardId) : undefined)
    ?? CARCASS_BACK_ITEMS.find((candidate) => candidate.elevation === item?.elevation)
    ?? CARCASS_BACK_ITEMS[0];
  return {
    item, backItem,
    label: item?.subgroup ?? "Carcass board",
    core: item?.materialDescription ?? "Carcass board",
    coreT: item?.thicknessMm ?? T,
    lam: false,
    back: backItem?.materialDescription ?? "Carcass back board",
    backCoreT: backItem?.thicknessMm ?? T_BACK,
  };
}

/**
 * Shutter material matrix — every row of Shutter_Material.xlsx (Sep 2026), one
 * selectable option each. `mat` is the sheet's NOTES column verbatim; `t` is
 * its USE BOARD THICKNESS (all shutters are 18mm nominal, but a post-lam core
 * is cut at 16 and the 0.8mm laminate per face restores 18).
 *
 * `fam` groups rows for the consumable rules (laminate / membrane / PU) and
 * `rate` names the costing key on /admin.
 */
type ShFamily = "PRELAM" | "POSTLAM" | "MEMBRANE" | "PU1" | "PU2" | "GLASS";
type ShutterSpec = { label: string; band: boolean; mat: string; t: number; fam: ShFamily };
const GLASS_SHUTTER_SPEC: ShutterSpec = { label: "Glass", band: false, mat: "5mm Toughened Glass", t: 5, fam: "GLASS" };
function shutterFamily(item: CostingMasterItem): ShFamily {
  const text = `${item.elevation} ${item.subgroup}`.toUpperCase();
  if (text.includes("MEMBRANE")) return "MEMBRANE";
  if (text.includes("SHUTTER PU") || text.startsWith("PU ")) return text.includes("BSP") ? "PU2" : "PU1";
  return text.includes("POSTLAM") ? "POSTLAM" : "PRELAM";
}
const shOf = (st: string): ShutterSpec => {
  if (st === "GLASS") return GLASS_SHUTTER_SPEC;
  const item = SHUTTER_BOARD_ITEMS.find((candidate) => candidate.id === st)
    ?? SHUTTER_BOARD_ITEMS.find((candidate) => candidate.id === DEFAULT_SHTYPE);
  const fam = item ? shutterFamily(item) : "PRELAM";
  return item ? { label: item.subgroup, band: fam === "PRELAM" || fam === "POSTLAM", mat: item.materialDescription, t: item.thicknessMm ?? 18, fam } : GLASS_SHUTTER_SPEC;
};
const shFamOf = (st: string): ShFamily => shOf(st).fam;

function countertopMaterialId(row: CountertopRow): string {
  if (row.materialId !== undefined) return row.materialId && !COUNTER_PLY_ITEMS.some((item) => item.id === row.materialId) ? "CUSTOM" : row.materialId;
  if (!row.material.trim()) return "";
  return COUNTER_PLY_ITEMS.find((item) =>
    [item.id, ...costingItemNames(item), item.subgroup].some((value) => value.toLowerCase() === row.material.trim().toLowerCase()))?.id ?? "CUSTOM";
}

function countertopMaterialItem(row: CountertopRow, defaultShutterType: string): CostingMasterItem | undefined {
  const id = countertopMaterialId(row);
  return id === "CUSTOM" ? undefined : COUNTER_PLY_ITEMS.find((item) => item.id === (id || defaultShutterType));
}

/** Only the glass branch keeps the stone frame machinery. */
const SH_INSET: Record<string, number> = { NEON20: 5, NEON50: 8 };
const SH_FRAME: Record<string, number> = { NEON20: 25, NEON50: 50 };
const NEON_LABEL: Record<string, string> = { NEON20: "Neon 20", NEON50: "Neon 50" };
const GLASS_T = 5;
const GLASS_SHELF_T = 6;

const isGlassShutterFam = isGlassCabinetFamily;

/* ------------------------------------------------------------------ */
/*  Catalog — families (ported from stone verbatim)                    */
/* ------------------------------------------------------------------ */

const V = (id: string, label: string, o: Record<string, unknown> = {}) => ({ id, label, ...o });

const BASE_FAMILIES: Record<string, any> = {
  DW:  { name: "Base Drawer", p2: "DW", top: "panel", drawers: true,
         variants: [V("2dr", "2 Drawers (2 HB)", { p3: "XXX", p4: "2HB", side: "2HB" }),
                    V("2dr-mixed", "2 Drawers (1 HB + 1 LB)", { p3: "1LB", p4: "1HB", side: "1LB+1HB" }),
                    V("3dr", "3 Drawers", { p3: "2LB", p4: "1HB", side: "2LB+1HB" })] },
  HO:  { name: "Base Hob", p2: "HO", top: "frame", drawers: true,
         variants: [V("2dr", "2 Drawers", { p3: "XXX", p4: "2HB", side: "2HB" }),
                    V("3dr", "3 Drawers", { p3: "2LB", p4: "1HB", side: "2LB+1HB" })] },
  SK:  { name: "Base Sink", p2: "SK", top: "frame",
         variants: [V("single", "Single bowl (handed)", { p3: "XXX", handed: true }),
                    V("double", "Double bowl", { p3: "XXX", p4: "2HS", both: true })] },
  SH:  { name: "Base Shutter", p2: "SH", top: "panel", shelf: 1,
         variants: [V("single", "Single door (handed)", { p3: "1SX", handed: true }),
                    V("double", "Double door", { p3: "1SX", p4: "2HS", both: true })] },
  GD:  { name: "Base Grain Drawer", p2: "GD", top: "panel", drawers: true,
         variants: [V("std", "Grain Drawer", { p3: "1BL", p4: "1HF", side: "1HB" })] },
  AP:  { name: "Base Appliance (Oven)", p2: "AP", top: "panel", backStrips: true,
         variants: [V("ovn", "Oven", { p3: "OVN", p4: "1FP", side: "APP" })] },
  BPO: { name: "Base Bottle Pullout", p2: "AC", top: "panel",
         variants: [V("po", "Bottle Pullout (handed)", { p3: "BPO", handed: true })] },
  WBP: { name: "Base Waste Bin Pullout", p2: "AC", top: "panel",
         variants: [V("wb", "Waste Bin Pullout", { p3: "WBP", p4: "1HF", both: true })] },
};

const BLIND_FAMILIES: Record<string, any> = {
  MGC: { name: "Magic Corner", p2: "AC", top: "panel",
         variants: [V("mgc", "Magic Corner (handed)", { p3: "MGC", handed: true, blind: true })] },
  LMC: { name: "LeMans Corner", p2: "AC", top: "panel",
         variants: [V("lmc", "LeMans (handed)", { p3: "LMC", handed: true, blind: true })] },
  BSH: { name: "Blind + Shelf", p2: "SH", top: "panel", shelf: 1,
         variants: [V("bsh", "Blind shelf (handed)", { p3: "1SX", handed: true, blind: true })] },
  PLB: { name: "Plain Blind", p2: "SH", top: "panel",
         variants: [V("plb", "Plain blind (handed)", { p3: "XXX", handed: true, blind: true })] },
};

const WALL_FAMILIES: Record<string, any> = {
  WST: { name: "Wall Solid Shutter", p2: "SH",
         variants: [V("sgl", "Single door (handed)", { p3: "1SX", handed: true }),
                    V("dbl", "Double door", { p3: "1SX", p4: "2HS", both: true })] },
  WGL: { name: "Wall Glass Shutter", p2: "SH", glassFam: true,
         variants: [V("sgl", "Single door (handed)", { p3: "3SG", handed: true }),
                    V("dbl", "Double door", { p3: "3SG", p4: "2HS", both: true })] },
  WOP: { name: "Wall Open Shelf", p2: "OP", noShutter: true,
         variants: [V("op", "Open (no door)", { p3: "3SX", p4: "XXX", both: true })] },
  WDR: { name: "Wall Dish Rack", p2: "AC", noBottom: true, top: "frame",
         variants: [V("sgl", "Single door (handed)", { p3: "2SX", handed: true }),
                    V("dbl", "Double door", { p3: "2SX", p4: "2HS", both: true })] },
};

const TALL_FAMILIES: Record<string, any> = {
  SHF:  { name: "Tall Shelf (full shutter)", p2: "SH", bracket: "TCS", holes: "6H", shelf: 4,
          variants: [V("sgl", "Single door (handed)", { p3: "6SX", handed: true }),
                     V("dbl", "Double door", { p3: "6SX", p4: "2HS", both: true })] },
  SHFG: { name: "Tall Shelf Glass (full shutter)", p2: "SH", bracket: "TCS", holes: "6H", shelf: 4, glassFam: true,
          variants: [V("sgl", "Single door (handed)", { p3: "6SG", handed: true }),
                     V("dbl", "Double door", { p3: "6SG", p4: "2HS", both: true })] },
  APP:  { name: "Tall Appliance + DW", p2: "AP", bracket: "TMO", holes: "4H", special: "APP", drawers: true,
          variants: [V("1dw", "+ 1 Low Back Drawer (handed)", { p4: tallApplianceDrawerCode(1), handed: true }),
                     V("2dw", "+ 2 Low Back Drawers (handed)", { p4: tallApplianceDrawerCode(2), handed: true })] },
  PAN:  { name: "Tall Tandem Pantry", p2: "AC", bracket: "TTP", holes: "6H",
          variants: [V("h", "Pantry (handed)", { p3: "1SX", p5: "TPT", handed: true })] },
  DPN:  { name: "Tall Drawer Pantry", p2: "DW", bracket: "T3A", holes: "4H", drawers: true, fixedDpn: true,
          variants: [V("h", "Drawer pantry (handed)", { p3: "1SX", p5: "5BD", handed: true })] },
  DPNG: { name: "Tall Drawer Pantry Glass", p2: "DW", bracket: "T3A", holes: "4H", drawers: true, fixedDpn: true, glassFam: true,
          variants: [V("h", "Drawer pantry (handed)", { p3: "1SG", p5: "5BD", handed: true })] },
  PPN:  { name: "Tall PO Shelf Pantry", p2: "PO", bracket: "TPO", holes: "6H",
          variants: [V("h", "Pullout pantry (handed)", { p3: "2SX", p5: "4PO", handed: true })] },
  PPNG: { name: "Tall PO Shelf Pantry Glass", p2: "PO", bracket: "TPO", holes: "6H", glassFam: true,
          variants: [V("h", "Pullout pantry (handed)", { p3: "2SG", p5: "4PO", handed: true })] },
  REF:  { name: "Tall Refrigerator", p2: "REF", bracket: "TRC", holes: "3H", special: "REF",
          variants: [V("h", "Fridge (handed)", { p3: "1SX", handed: true })] },
};

const TALL_BLIND_FAMILIES: Record<string, any> = {
  BLND: { name: "Tall Blind Shelf", p2: "SH", bracket: "TBC", holes: "JD", shelf: 4,
          variants: [V("h", "Blind shelf (handed)", { p3: "6SX", handed: true })] },
};

const TALL_LOW_FAMILIES: Record<string, any> = {
  LOWS:  { name: "Tall Shelf (Low)", p2: "SH", bracket: "TLD", holes: "6H", shelf: 4,
           variants: [V("h", "Shelf low (handed)", { p3: "6SX", handed: true })] },
  LOWSG: { name: "Tall Shelf Glass (Low)", p2: "SH", bracket: "TLD", holes: "6H", shelf: 4, glassFam: true,
           variants: [V("h", "Shelf low (handed)", { p3: "6SG", handed: true })] },
};

const LOFT_FAMILIES: Record<string, any> = {
  LST: { name: "Loft Solid Shutter", p2: "SH", shelf: 1,
         variants: [V("sgl", "Single door (handed)", { p3: "1SX", handed: true }),
                    V("dbl", "Double door", { p3: "1SX", p4: "2HS", both: true })] },
  LGL: { name: "Loft Glass Shutter", p2: "SH", shelf: 1, glassFam: true,
         variants: [V("sgl", "Single door (handed)", { p3: "1SG", handed: true }),
                    V("dbl", "Double door", { p3: "1SG", p4: "2HS", both: true })] },
};

const MD_FAMILIES: Record<string, any> = {
  MDR: { name: "Rolling Shutter", p2: "RS", noBottom: true, noShutter: true, special: "MD",
         variants: [V("rs", "Rolling shutter", { p3: "3SG", p4: "1SX", both: true })] },
};

const ZONES: Record<string, {
  name: string; p1: string; mount: string;
  low?: boolean; blind?: boolean; tall?: boolean; full?: boolean; kind?: string; fams: string;
}> = {
  BC:  { name: "Base", p1: "BC", mount: "legs", low: false, blind: false, fams: "base" },
  BCL: { name: "Base — Low Depth", p1: "BCL", mount: "legs", low: true, fams: "base" },
  BB:  { name: "Base Blind", p1: "BB", mount: "legs", blind: true, fams: "blind" },
  BBL: { name: "Base Blind — Low Depth", p1: "BBL", mount: "legs", low: true, blind: true, fams: "blind" },
  WC:  { name: "Wall", p1: "WC", mount: "wall", kind: "wall", fams: "wall" },
  WB:  { name: "Wall Blind", p1: "WB", mount: "wall", kind: "wall", blind: true, fams: "wall" },
  TC:  { name: "Tall", p1: "TC", mount: "legs", tall: true, fams: "tall" },
  TB:  { name: "Tall Blind", p1: "TB", mount: "legs", tall: true, blind: true, fams: "tallblind" },
  TCL: { name: "Tall — Low Depth", p1: "TCL", mount: "legs", tall: true, low: true, fams: "talllow" },
  LO:  { name: "Loft", p1: "LO", mount: "wall", kind: "loft", fams: "loft" },
  LB:  { name: "Loft Blind", p1: "LB", mount: "wall", kind: "loft", blind: true, fams: "loft" },
  LBF: { name: "Loft Blind — Full Depth", p1: "LBF", mount: "wall", kind: "loft", blind: true, full: true, fams: "loft" },
  LOF: { name: "Loft — Full Depth", p1: "LOF", mount: "wall", kind: "loft", full: true, fams: "loft" },
  MD:  { name: "Mid Rolling Shutter", p1: "MD", mount: "wall", kind: "md", fams: "md" },
};

const famSetOf = (z: string) => {
  if (z === "BCL") return { SH: BASE_FAMILIES.SH };
  if (z === "BB") return { BSH: BLIND_FAMILIES.BSH, MGC: BLIND_FAMILIES.MGC, LMC: BLIND_FAMILIES.LMC };
  if (z === "BBL") return { BSH: BLIND_FAMILIES.BSH };
  if (z === "WB") return { WST: WALL_FAMILIES.WST };
  if (z === "LB" || z === "LBF") return { LST: LOFT_FAMILIES.LST };
  const k = ZONES[z]?.fams;
  return k === "blind" ? BLIND_FAMILIES
    : k === "wall" ? WALL_FAMILIES
    : k === "tall" ? TALL_FAMILIES
    : k === "tallblind" ? TALL_BLIND_FAMILIES
    : k === "talllow" ? TALL_LOW_FAMILIES
    : k === "loft" ? LOFT_FAMILIES
    : k === "md" ? MD_FAMILIES
    : BASE_FAMILIES;
};

/* ------------------------------------------------------------------ */
/*  Standard widths — the wood table                                   */
/* ------------------------------------------------------------------ */

const WIDTHS: Record<string, number[]> = {
  DW:  [450, 600, 800, 900, 1000],
  HO:  [600, 750, 800, 900],
  GD:  [450, 500, 550, 600],
  AP:  [600],
  SH:  [400, 450, 500, 550, 600, 800, 850, 900, 950, 1000],
  SK:  [500, 600, 900, 1000, 1050, 1100, 1150, 1200],
  BPO: [150, 200, 300],
  WBP: [300, 600],
  LMC: [1050, 1100, 1150], BSH: [1050, 1100, 1150], PLB: [1050, 1100, 1150],
  WGL: [300, 400, 450, 500, 550, 600, 800, 850, 900, 1000],
  WST: [300, 400, 450, 500, 550, 600, 800, 850, 900, 1000],
  WOP: [300],
  WDR: [600, 900],
  LST: [300, 400, 450, 500, 550, 600, 800, 850, 900, 1000],
  LGL: [300, 400, 450, 500, 550, 600, 800, 850, 900, 1000],
  BLND: [1050, 1100, 1150], BLNG: [1050, 1100, 1150],
  MDR: [600],
};
const TALL_W = [450, 600];

function defSizes(zoneKey: string, fk: string) {
  const z = ZONES[zoneKey];
  const w = WIDTHS[fk] ?? (z.tall ? TALL_W : [300, 450, 600, 900]);
  const h = z.tall ? [2400, 2040]
    : z.kind === "wall" ? [900, 720, 1085]
    : z.kind === "loft" ? [600]
    : z.kind === "md" ? [1650, 1290]
    : [720];
  const d = z.full ? 560 : (z.low || z.kind) ? 336 : 560;
  return { w, h, d };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Wood: 3mm normal gap; a gola base cabinet loses 33mm (3 + 30 finger gap). */
function shDeduct(isBase: boolean, handle: string, loc: string): number {
  if (!isBase) return 3;
  if (handle === "XCJ") return loc === "ML" ? 3 : 33;
  return 3;
}

/** Share the extra 30mm Gola clearance across both low drawer fronts. */
function drawerFrontHeight(cls: DrawerClass, loc: string, lowFrontCount: number, isBase: boolean, handle: string, cabinetHeight: number): number {
  const slotHeight = loc === "FH" ? cabinetHeight : cls === "LOW" ? 180 : 360;
  if (cls === "LOW" && lowFrontCount === 2 && isBase && handle === "XCJ") {
    return slotHeight - 3 - 30 / lowFrontCount;
  }
  return slotHeight - shDeduct(isBase, handle, loc);
}

function widthVariant(zoneKey: string, fam: any, variantId: string, width: number): string {
  const single = fam.variants.find((variant: any) => variant.id === "single" || variant.id === "sgl");
  const double = fam.variants.find((variant: any) => variant.id === "double" || variant.id === "dbl");
  if (!single || !double) return variantId;
  return isDoubleShutterWidth(width) ? double.id : single.id;
}

/** Shelf material is derived from the shutter type, not the zone. */
function shelfMaterialOf(fk: string, board: string): { mat: string; t: number; band: boolean } {
  if (isGlassShutterFam(fk)) return { mat: GLASS_SHELF_ITEM?.materialDescription ?? `${GLASS_SHELF_T}mm Clear Glass`, t: GLASS_SHELF_T, band: false };
  const selected = carcassBoardOf(board);
  return { mat: selected.core, t: selected.coreT, band: board !== SINK_STONE_BOARD_ID };
}

function shelfCount(zk: string, fk: string, fam: any, H: number): number {
  const z = ZONES[zk];
  if (z.kind === "wall") {
    if (fk === "WDR") return H >= 1085 ? 2 : 0;
    if (fk === "WOP" || fk === "WGL" || fk === "WST") return H >= 1085 ? 3 : H >= 900 ? 2 : 1;
    return 0;
  }
  return fam.shelf ?? 0;
}

function shutSpec(zk: string, fk: string, v: any) {
  const fam = famSetOf(zk)[fk];
  if (fam?.noShutter) return { leaves: 0 };
  const leaves = v.both || v.double ? 2 : 1;
  return { leaves };
}

/* ------------------------------------------------------------------ */
/*  Drawer boxes — metal box bought-in, bottom & back cut by us        */
/* ------------------------------------------------------------------ */

type DrawerClass = "LOW" | "HIGH";

type DrawerDed = {
  line: string;
  code: string;
  backH: number;
  botWded: number;
  botDded: number;
  backWded: number;
  botT: number;
  backT: number;
};

/**
 * Per-model panel deductions.
 *
 *   Bottom panel = (W − botWded) × (D − botDded)
 *   Back panel   = (W − backWded) × backH
 *
 * Wood offers two height classes only. Stone's Semi-High is not used.
 */
const DRAWER_DED: Record<string, Partial<Record<DrawerClass, DrawerDed>>> = {
  Hettich: {
    LOW:  { line: "INNOTECH / ATIRA", code: "H70",  backH: 68,  botWded: 108, botDded: 80, backWded: 120, botT: 16, backT: 16 },
    HIGH: { line: "INNOTECH / ATIRA", code: "H144", backH: 144, botWded: 108, botDded: 80, backWded: 120, botT: 16, backT: 16 },
  },
  Blum: {
    LOW:  { line: "ANTARO", code: "H69",  backH: 69,  botWded: 111, botDded: 69, backWded: 123, botT: 16, backT: 16 },
    HIGH: { line: "ANTARO", code: "H183", backH: 183, botWded: 111, botDded: 69, backWded: 123, botT: 16, backT: 16 },
  },
  Hafele: {
    LOW:  { line: "MATRIX", code: "H69",  backH: 69,  botWded: 111, botDded: 69, backWded: 123, botT: 16, backT: 16 },
    HIGH: { line: "MATRIX", code: "H164", backH: 164, botWded: 111, botDded: 69, backWded: 123, botT: 16, backT: 16 },
  },
  Grass: {
    LOW:  { line: "DWD", code: "H68",  backH: 68,  botWded: 111, botDded: 69, backWded: 111, botT: 16, backT: 16 },
    HIGH: { line: "DWD", code: "H164", backH: 164, botWded: 111, botDded: 69, backWded: 111, botT: 16, backT: 16 },
  },
  // Lian follows the established stone-app drawer construction, confirmed as
  // the fallback for wood where no separate construction was supplied.
  Lian: {
    LOW:  { line: "TANDEM", code: "H90",  backH: 63,  botWded: 50, botDded: 77, backWded: 72, botT: 6, backT: 15 },
    HIGH: { line: "TANDEM", code: "H239", backH: 212, botWded: 50, botDded: 77, backWded: 72, botT: 6, backT: 15 },
  },
};

/** Material for the bottom/back was not specified; BWP ply is assumed. */
const DRAWER_PANEL_MAT = (t: number) => `${t}mm BWP Plywood`;

/**
 * Drawer height mix per variant.
 *   2dr         → 2 High
 *   Tall APP    → 1 or 2 Low
 *   2dr-mixed  → 1 Low + 1 High
 *   3dr        → 2 Low + 1 High
 *   fixed_dpn  → 2 Low + 3 High   (stone had 2 Low + 3 Semi-High; wood has no
 *                                  Semi-High, so those three go High)
 */
function drawerBreakdown(fam: any, v: any): Array<{ cls: DrawerClass; n: number }> {
  if (fam.fixedDpn) return [{ cls: "LOW", n: 2 }, { cls: "HIGH", n: 3 }];
  if (fam.special === "APP") return [{ cls: "LOW", n: v.id === "2dw" ? 2 : 1 }];
  if (/^3dr$/.test(v.id)) return [{ cls: "LOW", n: 2 }, { cls: "HIGH", n: 1 }];
  if (v.id === "2dr-mixed") return [{ cls: "LOW", n: 1 }, { cls: "HIGH", n: 1 }];
  if (/^(2dr|2dw)$/.test(v.id)) return [{ cls: "HIGH", n: 2 }];
  return [{ cls: "HIGH", n: 1 }];
}

function drawerSystemItem(model: string, cls: DrawerClass): CostingMasterItem | undefined {
  const subgroup = cls === "LOW" ? "Low Back" : "High Back";
  return COSTING_ITEMS.find((item) => item.group === "Drawer System" &&
    item.brand.toLowerCase() === model.toLowerCase() && item.subgroup.toLowerCase().includes(subgroup.toLowerCase()));
}

function addDrawerBoxes(
  fk: string,
  v: any,
  W: number,
  D: number,
  drawerModel: string,
  drawerBoardId: string,
  panels: Panel[],
  hardware: Hardware[],
  pkRows: PkRow[],
  stubs: string[],
): void {
  const fam = famSetOf(zoneOfFam(fk))[fk];
  if (!fam?.drawers) return;

  const mix = drawerBreakdown(fam, v);
  const total = mix.reduce((a, m) => a + m.n, 0);
  const table = DRAWER_DED[drawerModel];
  const drawerBoard = DRAWER_BOARD_ITEMS.find((item) => item.id === drawerBoardId);

  if (v.id === "2dr-mixed" || fam.special === "APP") {
    // Show the actual LB and HB drawer/channel sets in the BOM. A brand with no
    // Kitchen-master row keeps an explicit class-labelled fallback instead.
    mix.forEach(({ cls, n }) => hardware.push({
      name: drawerSystemItem(drawerModel, cls)?.materialDescription ??
        `DRAWER BOX SET ${drawerModel.toUpperCase()} ${cls === "LOW" ? "LOW" : "HIGH"} BACK`,
      qty: n, uom: "set", pack: "Drawer Pack",
    }));
  } else {
    hardware.push({
      name: `DRAWER BOX SET ${drawerModel.toUpperCase()}`,
      qty: total, uom: "set", pack: "Drawer Pack",
    });
  }
  pkRows.push({ pack: "Drawer Pack", type: "sub_bom", qty: total });

  if (!table) {
    stubs.push(
      `${drawerModel} deductions not supplied — bottom and back panels withheld for all ` +
      `${total} drawer${total > 1 ? "s" : ""}. The box set is still costed.`,
    );
    return;
  }

  mix.forEach(({ cls, n }) => {
    const d = table[cls];
    if (!d) {
      stubs.push(
        `${drawerModel} has no "${cls}" row — ` +
        `${n} drawer${n > 1 ? "s" : ""} on this cabinet have no bottom or back panel.`,
      );
      return;
    }
    if (drawerBoard && (drawerBoard.thicknessMm !== d.botT || drawerBoard.thicknessMm !== d.backT)) {
      stubs.push(`Drawer material ${drawerBoard.id} is ${drawerBoard.thicknessMm}mm, but ${drawerModel} ${cls.toLowerCase()} drawer construction calls for ${d.botT}mm bottom and ${d.backT}mm back. Review the panel specification before manufacturing.`);
    }
    const botW = W - d.botWded;
    const botD = D - d.botDded;
    const bakW = W - d.backWded;

    panels.push({
      name: `Panels- DR Bottom ${d.botT}mm ${botW}x${botD}`,
      w: botW, h: botD, qty: n, drill: null, pack: "Drawer Pack",
      t: d.botT, mat: drawerBoard?.materialDescription ?? DRAWER_PANEL_MAT(d.botT), band: true,
      materialId: drawerBoard?.id,
    });
    panels.push({
      name: `Panels- DR Back ${d.backT}mm ${bakW}x${d.backH}`,
      w: bakW, h: d.backH, qty: n, drill: null, pack: "Drawer Pack",
      t: d.backT, mat: drawerBoard?.materialDescription ?? DRAWER_PANEL_MAT(d.backT), band: true,
      materialId: drawerBoard?.id,
    });
  });
}

/** Reverse lookup so addDrawerBoxes can reach the family record. */
function zoneOfFam(fk: string): string {
  for (const zk of Object.keys(ZONES)) if (famSetOf(zk)[fk]) return zk;
  return "BC";
}

/* ------------------------------------------------------------------ */
/*  Shutters                                                           */
/* ------------------------------------------------------------------ */

function defaultBlindOpeningWidth(zk: string): number {
  return blindOpeningLimits(zk).defaultWidth;
}
function blindOpeningError(zk: string, cabinetWidth: number, openingWidth: number): string {
  if (!ZONES[zk]?.blind) return "";
  const { min, max } = blindOpeningLimits(zk);
  if (!Number.isSafeInteger(openingWidth) || openingWidth < min || openingWidth > max) {
    return `Opening shutter width must be between ${min} and ${max} mm.`;
  }
  if (cabinetWidth - openingWidth - 3 <= 0) return "Cabinet width must leave room for the fixed panel after the opening shutter and 3 mm gap.";
  return "";
}

function buildShutters(
  zk: string,
  fk: string,
  v: any,
  handle: string,
  hand: string,
  shType: string,
  glassType: string,
  hingeChoice: HingeChoice,
  neon: string,
  W: number,
  H: number,
  blindOpeningWidth: number,
  panels: Panel[],
  profiles: Profile[],
  hardware: Hardware[],
  pkRows: PkRow[],
  stubs: string[],
): { leaves: number; leafW: number; leafH: number } {
  const z = ZONES[zk];
  const isBase = !z.tall && !z.kind;
  const fam = famSetOf(zk)[fk];

  // Drawer-front slots follow the stone construction: Low = 180mm, High =
  // 360mm. Two low fronts share the additional Gola clearance equally.
  // DPN/DPNG are hinged pantry doors with internal drawers, not five external
  // drawer fronts, so fixedDpn deliberately continues to the hinged branch.
  if (fam.drawers && !fam.fixedDpn) {
    const st = isGlassShutterFam(fk) ? "GLASS" : shType;
    const S = shOf(st);
    const fronts: Array<{ cls: DrawerClass; loc: string; fixed?: boolean }> = fk === "APP"
      ? Array.from({ length: v.id === "2dw" ? 2 : 1 }, (_, index) => ({ cls: "LOW" as const, loc: index === 0 ? "UL" : "ML" }))
      : v.id === "3dr"
      ? [{ cls: "LOW", loc: "UL" }, { cls: "LOW", loc: "ML" }, { cls: "HIGH", loc: "BH" }]
      : v.id === "2dr-mixed"
        ? [{ cls: "LOW", loc: "UL" }, { cls: "LOW", loc: "UL", fixed: true }, { cls: "HIGH", loc: "BH" }]
      : /^(2dr|2dw)$/.test(v.id)
        ? [{ cls: "HIGH", loc: "UH" }, { cls: "HIGH", loc: "BH" }]
        : [{ cls: "HIGH", loc: fk === "GD" ? "FH" : "BH" }];
    if (v.id === "2dr-mixed" && H !== 720) {
      stubs.push(`1 HB + 1 LB drawer fronts plus the matching fixed low panel occupy 720mm of a ${H}mm cabinet; review the remaining ${H - 720}mm front space.`);
    }
    const lowFrontCount = fronts.filter((front) => front.cls === "LOW").length;
    fronts.forEach(({ cls, loc, fixed }) => {
      const frontH = drawerFrontHeight(cls, loc, lowFrontCount, isBase, handle, H);
      panels.push({
        name: `Panels- SH ${fixed ? "Fixed Panel" : "Drawer Front"} ${cls} ${S.t}mm ${W - 3}x${frontH}`,
        w: W - 3, h: frontH, qty: 1, drill: null, pack: "Shutter Pack",
        t: S.t, mat: S.mat, band: S.band,
      });
    });
    // Tall APP keeps the stone upper appliance door above its drawer fronts.
    if (z.tall && fk === "APP") {
      const upperSlotH = H >= 2400 ? 1085 : 720;
      const upperH = upperSlotH - shDeduct(false, handle, "RH");
      panels.push({
        name: `Panels- SH Upper Door ${S.t}mm ${W - 3}x${upperH}`,
        w: W - 3, h: upperH, qty: 1, drill: null, pack: "Shutter Pack",
        t: S.t, mat: S.mat, band: S.band,
      });
      const upperHinges = hingePackCount(upperH);
      hardware.push({ name: `HARDWARE PACK HINGE 0 CRANK Set/${upperHinges}`, qty: 1, uom: "set", pack: "Shutter Pack", hingeItemName: hingeItemFor(hingeChoice, "standard") });
    }
    pkRows.push({ pack: "Shutter Pack", type: "sub_bom", qty: fronts.length + (z.tall && fk === "APP" ? 1 : 0) });
    const totalArea = fronts.reduce((sum, front) => {
      return sum + sqft(W - 3, drawerFrontHeight(front.cls, front.loc, lowFrontCount, isBase, handle, H));
    }, 0);
    return { leaves: fronts.length, leafW: W - 3, leafH: totalArea * SQDIV / Math.max(1, (W - 3) * fronts.length) };
  }

  const { leaves } = shutSpec(zk, fk, v);
  if (!leaves) return { leaves: 0, leafW: 0, leafH: 0 };

  const leafW = W / leaves;
  const leafH = H - shDeduct(isBase, handle, "SH");
  const st = isGlassShutterFam(fk) ? "GLASS" : shType;
  const S = shOf(st);
  const glassItem = glassShutterItemOf(glassType);
  const glassMat = glassItem?.materialDescription ?? `${GLASS_T}mm Tinted Glass`;

  // Blind cabinets have one user-sized functional shutter plus the remaining
  // fixed dummy shutter. The fixed panel is always a solid selected shutter board,
  // even when the functional shutter is glass.
  if (z.blind) {
    const blindW = blindOpeningWidth;
    const activeW = Math.max(0, blindW - 3);
    const fixedW = Math.max(0, W - blindW - 3);
    const activeH = H - shDeduct(isBase, handle, "RH");
    const fixedH = H - 3;

    if (st === "GLASS") {
      const frame = SH_FRAME[neon];
      panels.push({ name: `Panels- SH Blind Active ${glassItem?.subgroup ?? "Glass"} ${GLASS_T}mm ${activeW}x${activeH}`, w: activeW, h: activeH, qty: 1, drill: hand, pack: "Shutter Pack", t: GLASS_T, mat: glassMat, band: false });
      profiles.push({ name: `ALU PROF ${NEON_LABEL[neon].toUpperCase()} ${frame}MM`, len: activeH, qty: 2, type: "V", pack: "Shutter Pack" });
      profiles.push({ name: `ALU PROF ${NEON_LABEL[neon].toUpperCase()} ${frame}MM`, len: activeW, qty: 2, type: "H", pack: "Shutter Pack" });
      hardware.push({ name: "CORNER CONNECTOR FOR GLASS SHUTTER", qty: 4, uom: "nos", pack: "Shutter Pack" });
    } else {
      panels.push({ name: `Panels- SH Blind Active ${S.t}mm ${activeW}x${activeH}`, w: activeW, h: activeH, qty: 1, drill: hand, pack: "Shutter Pack", t: S.t, mat: S.mat, band: S.band });
    }

    if (fixedW > 0) {
      const fixed = shOf(shType);
      panels.push({ name: `Panels- SH Blind Fixed ${fixed.t}mm ${fixedW}x${fixedH}`, w: fixedW, h: fixedH, qty: 1, drill: "FIXED", pack: "Shutter Pack", t: fixed.t, mat: fixed.mat, band: fixed.band });
      hardware.push({ name: "HARDWARE PACK L BRACKET (fixed dummy)", qty: 1, uom: "set", pack: "Shutter Pack" });
    }

    const hinges = hingePackCount(activeH);
    const hingePack = `HARDWARE PACK HINGE BLIND Set/${hinges}`;
    hardware.push({ name: hingePack, qty: 1, uom: "set", pack: "Shutter Pack", hingeItemName: hingeItemFor(hingeChoice, "blind") });
    pkRows.push({ pack: "Shutter Pack", type: "sub_bom", qty: fixedW > 0 ? 2 : 1 });
    const totalArea = activeW * activeH + fixedW * fixedH;
    return { leaves: fixedW > 0 ? 2 : 1, leafW: totalArea / Math.max(1, activeH * (fixedW > 0 ? 2 : 1)), leafH: activeH };
  }

  if (st === "GLASS") {
    const inset = SH_INSET[neon];
    const frame = SH_FRAME[neon];
    panels.push({
      name: `Panels- SH Glass ${GLASS_T}mm ${Math.round(leafW - inset)}x${Math.round(leafH - inset)}`,
      w: Math.round(leafW - inset), h: Math.round(leafH - inset), qty: leaves,
      drill: null, pack: "Shutter Pack", t: GLASS_T,
      mat: glassMat, band: false,
    });
    if (z.tall && leaves === 2) {
      // Each tall double-glass leaf has the handle profile on its meeting-side
      // vertical edge. The outer vertical edge and both horizontal edges use
      // the normal shutter profile.
      profiles.push({ name: `ALU PROF ${NEON_LABEL[neon].toUpperCase()} ${frame}MM`, len: Math.round(leafH), qty: leaves, type: "V", orientation: "vertical", pack: "Shutter Pack" });
      profiles.push({ name: `ALU PROF ${NEON_LABEL[neon].toUpperCase()} ${frame}MM`, len: Math.round(leafH), qty: leaves, type: "H", orientation: "vertical", pack: "Shutter Pack" });
      profiles.push({ name: `ALU PROF ${NEON_LABEL[neon].toUpperCase()} ${frame}MM`, len: Math.round(leafW), qty: 2 * leaves, type: "V", orientation: "horizontal", pack: "Shutter Pack" });
    } else {
      profiles.push({
        name: `ALU PROF ${NEON_LABEL[neon].toUpperCase()} ${frame}MM`,
        len: Math.round(leafH), qty: 2 * leaves, type: "V", orientation: "vertical", pack: "Shutter Pack",
      });
      profiles.push({
        name: `ALU PROF ${NEON_LABEL[neon].toUpperCase()} ${frame}MM`,
        len: Math.round(leafW), qty: 2 * leaves, type: "H", orientation: "horizontal", pack: "Shutter Pack",
      });
    }
    hardware.push({ name: "CORNER CONNECTOR FOR GLASS SHUTTER", qty: 4 * leaves, uom: "nos", pack: "Shutter Pack" });
  } else {
    panels.push({
      name: `Panels- SH ${S.t}mm ${Math.round(leafW)}x${Math.round(leafH)}`,
      w: Math.round(leafW), h: Math.round(leafH), qty: leaves,
      drill: null, pack: "Shutter Pack", t: S.t,
      mat: S.mat, band: S.band,
    });
  }

  const hingesPerLeaf = hingePackCount(H);
  if (isGlassShutterFam(fk)) {
    hardware.push({ name: hingeItemFor(hingeChoice, hingeModeFor(zk, fk)), qty: hingesPerLeaf * leaves, uom: "PCS", pack: "Shutter Pack" });
  } else {
    const hingeMode = hingeModeFor(zk, fk);
    const packType = hingeMode === "blind" ? "BLIND" : hingeMode === "wide" ? "165 DEGREE" : "0 CRANK";
    const hingePack = `HARDWARE PACK HINGE ${packType} Set/${hingesPerLeaf}`;
    hardware.push({ name: hingePack, qty: leaves, uom: "set", pack: "Shutter Pack", hingeItemName: hingeItemFor(hingeChoice, hingeMode) });
  }
  pkRows.push({ pack: "Shutter Pack", type: "sub_bom", qty: leaves });

  return { leaves, leafW, leafH };
}

/* ------------------------------------------------------------------ */
/*  Panel merge — LH/RH pairing, identical to stone                    */
/* ------------------------------------------------------------------ */

function mergeCarcassPanels(panels: Panel[]): Panel[] {
  const out: Panel[] = [];
  const key = (p: Panel) => [p.pack, /\bCR Side (LH|RH)\b/.test(p.name) ? p.name : p.name.replace(/\b(LH|RH)\b/g, "").trim(), p.w, p.h, p.t, p.mat, p.band, p.visibleSide, p.materialId].join("|");
  const map = new Map<string, Panel>();
  panels.forEach((p) => {
    const k = key(p);
    const hit = map.get(k);
    if (hit) {
      hit.qty += p.qty;
      if (hit.drill && p.drill && hit.drill !== p.drill) hit.drill = "LH/RH";
    } else {
      const c = { ...p };
      map.set(k, c);
      out.push(c);
    }
  });
  return out;
}

/* ------------------------------------------------------------------ */
/*  Tree explode — panel → part → raw material                         */
/* ------------------------------------------------------------------ */

type TreeItem = { level: number; name: string; qty: number; uom: string; mat?: string; sqftVal?: number };

function explodePanelForTree(p: Panel, finish: string, edgeBandFinish = finish): TreeItem[] {
  const area = sqft(p.w, p.h) * p.qty;
  const out: TreeItem[] = [];
  out.push({ level: 2, name: getPanelBaseName(p.name, p.drill, finish), qty: p.qty, uom: "nos" });
  out.push({ level: 3, name: getPartBaseName(p.name, p.drill, finish), qty: p.qty, uom: "nos" });
  out.push({ level: 4, name: `${p.mat ?? "Board"} ${finish}`.trim(), qty: r3(area), uom: "sqft", mat: p.mat, sqftVal: area });
  if (p.band) {
    const m = perim(p.w, p.h) * p.qty;
    out.push({ level: 4, name: `EDGE BAND ${BAND_T}MM ${edgeBandFinish}`.trim(), qty: r3(m), uom: "RMT" });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Carcass build                                                      */
/* ------------------------------------------------------------------ */

function buildCarcassInnerRaw(cfg: {
  zk: string; fk: string; v: any; hand: string; handle: string;
  board: string; backBoardId: string; drawerBoardId: string; shType: string; visibleSides: VisibleSides; visibleSideMaterialId: string;
  glassType: string; hingeChoice: HingeChoice; neon: string;
  W: number; H: number; D: number; shelfQty: number; drawerModel: string; blindOpeningWidth?: number; sinkStoneFullBack?: boolean; edgeBand?: EdgeBandChoice;
}) {
  const { zk, fk, v, hand, handle, board, backBoardId, drawerBoardId, shType, visibleSides, visibleSideMaterialId, glassType, hingeChoice, neon, W, H, D, drawerModel } = cfg;
  const z = ZONES[zk];
  const isBase = !z.tall && !z.kind;
  const fam = famSetOf(zk)[fk];
  const B = carcassBoardOf(board, backBoardId);
  const stoneSink = fk === "SK" && board === SINK_STONE_BOARD_ID;
  const carcassT = stoneSink ? B.coreT : T;

  const panels: Panel[] = [];
  const profiles: Profile[] = [];
  const hardware: Hardware[] = [];
  const cons: Consumable[] = [];
  const pkRows: PkRow[] = [];
  const stubs: string[] = [];

  const carc = B.core;
  const PK = "Carcass Pack";
  const visibleBoard = visibleSides ? SHUTTER_BOARD_ITEMS.find((item) => item.id === visibleSideMaterialId && [18, 25].includes(item.thicknessMm ?? 0)) : undefined;
  const leftSideT = visibleBoard && (visibleSides === "LH" || visibleSides === "BOTH") ? visibleBoard.thicknessMm ?? carcassT : carcassT;
  const rightSideT = visibleBoard && (visibleSides === "RH" || visibleSides === "BOTH") ? visibleBoard.thicknessMm ?? carcassT : carcassT;
  const insideW = W - leftSideT - rightSideT;
  const add = (name: string, w: number, h: number, qty: number, t: number, mat: string, band: boolean, drill: string | null = null) =>
    panels.push({ name, w: Math.round(w), h: Math.round(h), qty, drill, pack: PK, t, mat, band: band && !stoneSink });

  /* --- sides run full height; base cabinets have no top panel --- */
  if (!visibleSides) {
    add(`Panels- CR Side ${carcassT}mm ${D}x${H}`, D, H, 2, carcassT, carc, true, hand === "LHS" ? "LH" : "RH");
  } else {
    for (const side of ["LH", "RH"] as const) {
      const visible = (visibleSides === "BOTH" || visibleSides === side) && !!visibleBoard;
      const sideT = side === "LH" ? leftSideT : rightSideT;
      panels.push({
        name: `Panels- CR Side ${side} ${sideT}mm ${D}x${H}`,
        w: D, h: H, qty: 1, drill: side, pack: PK, t: sideT,
        mat: visible ? visibleBoard.materialDescription : carc, band: visible || !stoneSink,
        visibleSide: visible, materialId: visible ? visibleBoard.id : undefined,
      });
    }
    if (!visibleBoard) stubs.push("Visible-side material is not an 18mm or 25mm Kitchen-master shutter board; selected side replacement withheld.");
  }

  if (!isBase) {
    const topD = handle === "XCJ" ? D - CJ_CUT : D;
    add(`Panels- CR Top ${carcassT}mm ${insideW}x${topD}`, insideW, topD, 1, carcassT, carc, true);
  }

  if (fk !== "WDR" && !fam.noBottom) add(`Panels- CR Bottom ${carcassT}mm ${insideW}x${D}`, insideW, D, 1, carcassT, carc, true);

  /* --- back: grooved, +9 allowance, never banded --- */
  const bw = insideW + GROOVE;
  const bh = H - 2 * carcassT + GROOVE;
  if (fk === "SK") {
    // Stone sinks use an optional full stone back; wood sinks retain the 100mm rail.
    if (stoneSink && cfg.sinkStoneFullBack !== false) {
      add(`Panels- CR Stone Back ${B.coreT}mm ${bw}x${bh}`, bw, bh, 1, B.coreT, carc, false);
    }
  } else if (fam.special === "MD") {
    stubs.push("MD back panel height — parked at the construction stage. With no bottom panel the back is grooved on three edges only, so the +9 allowance does not apply symmetrically.");
  } else if (fam.backStrips) {
    add(`Panels- CR Back Strip ${B.backCoreT}mm ${bw}x75`, bw, 75, 2, B.backCoreT, B.back, false);
  } else {
    if (fam.special === "REF") stubs.push("REF short back wall — stone uses H − 1874 to clear the fridge recess. Wood equivalent not yet defined; a full-height back is emitted meanwhile.");
    if (fam.special === "APP") stubs.push("APP twin back walls — stone splits upper/lower at H − 1349. Wood equivalent not yet defined; a single back is emitted meanwhile.");
    add(`Panels- CR Back ${B.backCoreT}mm ${bw}x${bh}`, bw, bh, 1, B.backCoreT, B.back, false);
  }

  /* --- framed units: hob has no rails; sink keeps only the back rail --- */
  if (fam.top === "frame") {
    if (fk !== "HO" && fk !== "SK") {
      add(`Panels- CR Top Rail Front ${T}mm ${insideW}x100`, insideW, 100, 1, T, carc, true);
    }
    if (fk !== "HO" && !stoneSink) {
      add(`Panels- CR Back ${T}mm ${insideW}x100`, insideW, 100, 1, T, carc, true);
    }
  }

  /* --- shelves: material follows the shutter type --- */
  const nsh = cfg.shelfQty;
  if (nsh > 0) {
    const sm = shelfMaterialOf(fk, board);
    add(`Panels- CR Shelf ${sm.t}mm ${insideW - SHELF_W_CLR}x${D - SHELF_D_OFF}`,
        insideW - SHELF_W_CLR, D - SHELF_D_OFF, nsh, sm.t, sm.mat, sm.band);
    hardware.push({ name: "SHELF PIN", qty: nsh * 4, uom: "nos", pack: PK });
  }

  pkRows.push({ pack: PK, type: "sub_bom", qty: 1 });

  /* --- approved workbook hardware packs --- */
  const jointPack = z.tall
    ? "HARDWARE PACK CABINET JOINT TALL"
    : z.kind === "wall" || z.kind === "loft"
      ? "HARDWARE PACK CABINET JOINT WALL / LOFT"
      : !z.kind
        ? "HARDWARE PACK CABINET JOINT BASE"
        : "";
  if (jointPack) hardware.push({ name: jointPack, qty: 1, uom: "set", pack: PK });

  const baseProfilePack = `HARDWARE PACK BASE CABINET ${W}MM TOP PROFILE`;
  if (!z.tall && !z.kind) {
    const topProfileCut = insideW - 10;
    profiles.push({
      name: "ALU PROF FOR SINK 3000X20X20 ANODISED 2412 OML",
      len: topProfileCut, qty: 2, type: "TOP", orientation: "horizontal", pack: baseProfilePack,
    });
    hardware.push({
      name: baseProfilePack, qty: 1, uom: "set", pack: baseProfilePack,
      components: [
        { component: "END CONNECTOR FOR SINK PROF XX BLACK UTA", qty: 4, uom: "PCS" },
        { component: "PVC INSERT 13XX5 ID 5 UTA", qty: 4, uom: "PCS" },
        { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 8, uom: "PCS" },
      ],
    });
    pkRows.push({ pack: baseProfilePack, type: "hardware", qty: 1 });
  }
  const dishRackProfilePack = `HARDWARE PACK WALL DISHRACK CABINET ${W}MM BOTTOM PROFILE`;
  if (fk === "WDR" && HARDWARE_PACK_DEFINITIONS[dishRackProfilePack]) {
    hardware.push({ name: dishRackProfilePack, qty: 1, uom: "set", pack: dishRackProfilePack });
    pkRows.push({ pack: dishRackProfilePack, type: "hardware", qty: 1 });
  }

  /* --- shutters --- */
  const sh = buildShutters(zk, fk, v, handle, hand, shType, glassType, hingeChoice, neon, W, H,
    cfg.blindOpeningWidth ?? defaultBlindOpeningWidth(zk), panels, profiles, hardware, pkRows, stubs);

  /* --- drawers --- */
  addDrawerBoxes(fk, v, insideW + 2 * T, D, drawerModel, drawerBoardId, panels, hardware, pkRows, stubs);

  /* --- rolling shutter is a bought-in unit --- */
  if (fam.special === "MD") {
    hardware.push({ name: `ROLLING SHUTTER UNIT ${W}X${H}`, qty: 1, uom: "set", pack: "Hardware Pack" });
  }

  /* --- legs --- */
  if (z.mount === "legs") {
    hardware.push({ name: `HARDWARE PACK PVC LEG SET/${legCount(W)}`, qty: 1, uom: "set", pack: "Hardware Pack" });
  }

  /* --- consumables --- */
  const merged = mergeCarcassPanels(panels);
  const carcLamSqft = merged.filter((p) => p.pack === PK && !p.visibleSide &&
    isPostlamItem(carcassMasterItem(board, backBoardId, drawerBoardId, p)))
    .reduce((a, p) => a + sqft(p.w, p.h) * p.qty, 0);
  const glassCarcassLamSqft = isGlassShutterFam(fk) ? merged.filter((p) => p.pack === PK && !p.visibleSide &&
    carcassMasterItem(board, backBoardId, drawerBoardId, p)?.group !== "Carcass Back Material" &&
    isPostlamItem(carcassMasterItem(board, backBoardId, drawerBoardId, p)))
    .reduce((a, p) => a + sqft(p.w, p.h) * p.qty, 0) : 0;
  const drawerSqft = merged.filter((p) => p.pack === "Drawer Pack").reduce((a, p) => a + sqft(p.w, p.h) * p.qty, 0);
  const shSqft = merged.filter((p) => p.pack === "Shutter Pack").reduce((a, p) => a + sqft(p.w, p.h) * p.qty, 0);
  const visibleSqft = merged.filter((p) => p.visibleSide).reduce((a, p) => a + sqft(p.w, p.h) * p.qty, 0);

  if (stoneSink) {
    cons.push({ name: "GLUE BONDTITE FAST & CLEAR FOR STONE XX AGG", qty: 0.05, uom: "pcs", pack: "Stone pasting" });
    cons.push({ name: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: 0.5, uom: "pcs", pack: "Stone pasting" });
  }

  const bandGroups = new Map<string, { pack: string; finish: string; metres: number }>();
  merged.filter((panel) => panel.band).forEach((panel) => {
    const field = edgeBandFieldForPanel(panel, board, backBoardId, drawerBoardId);
    const finish = edgeBandForMaterial(cfg.edgeBand, field).finish;
    const pack = panel.visibleSide ? "Shutter Pack" : panel.pack;
    const key = `${pack}|${finish}`;
    const existing = bandGroups.get(key) ?? { pack, finish, metres: 0 };
    existing.metres += perim(panel.w, panel.h) * panel.qty;
    bandGroups.set(key, existing);
  });
  bandGroups.forEach(({ pack, finish, metres }) => {
    cons.push({ name: `EDGE BAND ${BAND_T}MM ${finish}`, qty: r3(metres), uom: "RMT", pack });
    cons.push({ name: "EDGEBAND ADHESIVE", qty: r3(metres * EDGE_ADH_G_PER_M), uom: "gm", pack });
  });
  if (carcLamSqft > 0) {
    if (glassCarcassLamSqft > 0) {
      cons.push({ name: "CARCASS FRONT LAMINATE 0.8MM", qty: r3(glassCarcassLamSqft), uom: "sqft", pack: PK });
      cons.push({ name: "CARCASS BACK LAMINATE 0.8MM", qty: r3(glassCarcassLamSqft), uom: "sqft", pack: PK });
    }
    if (carcLamSqft > glassCarcassLamSqft) cons.push({ name: "CARCASS LAMINATE 0.8MM", qty: r3((carcLamSqft - glassCarcassLamSqft) * 2), uom: "sqft", pack: PK });
    cons.push({ name: "LAMINATE ADHESIVE", qty: r3(carcLamSqft * LAM_ADH * 2), uom: "gm", pack: PK });
  }
  if (drawerSqft > 0 && isPostlamItem(DRAWER_BOARD_ITEMS.find((item) => item.id === drawerBoardId))) {
    cons.push({ name: "DRAWER LAMINATE 0.8MM", qty: r3(drawerSqft * 2), uom: "sqft", pack: "Drawer Pack" });
    cons.push({ name: "LAMINATE ADHESIVE", qty: r3(drawerSqft * LAM_ADH * 2), uom: "gm", pack: "Drawer Pack" });
  }

  const st = isGlassShutterFam(fk) ? "GLASS" : shType;
  if (shSqft > 0) {
    if (shFamOf(st) === "POSTLAM") {
      cons.push({ name: "SHUTTER LAMINATE 0.8MM", qty: r3(shSqft * 2), uom: "sqft", pack: "Shutter Pack" });
      cons.push({ name: "LAMINATE ADHESIVE", qty: r3(shSqft * LAM_ADH * 2), uom: "gm", pack: "Shutter Pack" });
    }
    if (shFamOf(st) === "MEMBRANE") {
      const mf = sqft(sh.leafW + 2 * MEMB_OVER, sh.leafH + 2 * MEMB_OVER) * sh.leaves;
      cons.push({ name: "MEMBRANE FOIL", qty: r3(mf), uom: "sqft", pack: "Shutter Pack" });
      if (MEMB_ADH === null) {
        stubs.push("Membrane adhesive rate (g/sqft) not yet supplied — the line is emitted by area only.");
        cons.push({ name: "MEMBRANE ADHESIVE", qty: r3(shSqft), uom: "sqft", pack: "Shutter Pack" });
      } else {
        cons.push({ name: "MEMBRANE ADHESIVE", qty: r3(shSqft * MEMB_ADH), uom: "gm", pack: "Shutter Pack" });
      }
    }
    if (shFamOf(st) === "PU1" || shFamOf(st) === "PU2") {
      const sides = shFamOf(st) === "PU2" ? 2 : 1;
      cons.push({ name: "PU EPOXY", qty: r3(shSqft * PU_RATE.epoxy * sides), uom: "gm", pack: "Shutter Pack" });
      cons.push({ name: "PU BASE PRIMER", qty: r3(shSqft * PU_RATE.primer * sides), uom: "gm", pack: "Shutter Pack" });
      cons.push({ name: "PU TOP COAT", qty: r3(shSqft * PU_RATE.top * sides), uom: "gm", pack: "Shutter Pack" });
    }
  }
  if (visibleSqft > 0) {
    const visibleFamily = shFamOf(visibleSideMaterialId);
    if (visibleFamily === "POSTLAM") {
      cons.push({ name: "VISIBLE SIDE LAMINATE 0.8MM", qty: r3(visibleSqft * 2), uom: "sqft", pack: PK });
      cons.push({ name: "LAMINATE ADHESIVE", qty: r3(visibleSqft * LAM_ADH * 2), uom: "gm", pack: PK });
    } else if (visibleFamily === "MEMBRANE") {
      stubs.push("Visible-side membrane wrapping allowance has not been specified; foil and adhesive quantities withheld.");
    } else if (visibleFamily === "PU1" || visibleFamily === "PU2") {
      const faces = visibleFamily === "PU2" ? 2 : 1;
      cons.push({ name: "PU EPOXY", qty: r3(visibleSqft * PU_RATE.epoxy * faces), uom: "gm", pack: PK });
      cons.push({ name: "PU BASE PRIMER", qty: r3(visibleSqft * PU_RATE.primer * faces), uom: "gm", pack: PK });
      cons.push({ name: "PU TOP COAT", qty: r3(visibleSqft * PU_RATE.top * faces), uom: "gm", pack: PK });
    }
  }

  return { panels: merged, profiles, hardware, cons, pkRows, stubs };
}

/* ------------------------------------------------------------------ */
/*  Model                                                              */
/* ------------------------------------------------------------------ */

function buildModel(cfg: {
  boardPrices?: BoardPriceOverrides;
  zk: string; fk: string; vid: string; hand: string; handle: string; handlePrice?: string; handleBrand?: string;
  board: string; backBoardId: string; drawerBoardId: string; shType: string; visibleSides: VisibleSides; visibleSideMaterialId: string;
  glassType: string; glassPricePerSqft?: string; sinkStoneFullBack?: boolean; edgeBand?: EdgeBandChoice; hingeChoice: HingeChoice; neon: string;
  carcassLamFrontSheetPrice: string; carcassLamBackSheetPrice: string;
  backLamFrontSheetPrice: string; backLamBackSheetPrice: string;
  drawerLamFrontSheetPrice: string; drawerLamBackSheetPrice: string;
  visibleLamFrontSheetPrice: string; visibleLamBackSheetPrice: string;
  shutterLamFrontSheetPrice: string; shutterLamBackSheetPrice: string;
  W: number; H: number; D: number; shelfQty?: number; fillerWidth?: number; fillerSides?: "LH" | "RH" | "BOTH"; fillerWidthRH?: number; blindOpeningWidth?: number; spotLight?: boolean; drawerModel: string; finish?: string;
}): CarcassModel {
  cfg = { ...cfg,
    carcassLamBackSheetPrice: isGlassShutterFam(cfg.fk) ? cfg.carcassLamBackSheetPrice : cfg.carcassLamFrontSheetPrice,
    backLamBackSheetPrice: cfg.backLamFrontSheetPrice,
    drawerLamBackSheetPrice: cfg.drawerLamFrontSheetPrice,
    spotLight: cfg.zk === "WC" && isGlassShutterFam(cfg.fk) && !!cfg.spotLight,
  };
  const fam = famSetOf(cfg.zk)[cfg.fk];
  const v = fam.variants.find((x: any) => x.id === widthVariant(cfg.zk, fam, cfg.vid, cfg.W)) ?? fam.variants[0];
  const shelfQty = cfg.shelfQty ?? shelfCount(cfg.zk, cfg.fk, fam, cfg.H);
  const built = buildCarcassInnerRaw({ ...cfg, shelfQty, v });

  /* Cabinet code — stone contract, 11 fields + optional finish suffix:
     p1-p2-handleToken(CJ|NHX|STD)-matToken(GL|WD)-p3-p4-p5-W-H-D-t[-FINISH]
     Hand rides in p4 or p5 as in stone; wall p3 leading digit is rewritten
     from the live shelf count. */
  const handleToken = cfg.handle === "XCJ" ? "CJ" : cfg.handle === "NONE" ? "NHX" : "STD";
  const matToken = isGlassShutterFam(cfg.fk) ? "GL" : cfg.fk === "SK" && cfg.board === SINK_STONE_BOARD_ID ? "ST" : "WD";
  const handTok = v.handed ? cfg.hand : "";
  const p3 = shelfCodeToken(v.p3 ?? "1SX", shelfQty, ZONES[cfg.zk].kind === "wall", isGlassShutterFam(cfg.fk));
  const p4: string = v.p4 || handTok || "XXX";
  const p5: string = v.p5 || (v.p4 && handTok ? handTok : "XXX");
  const code =
    [ZONES[cfg.zk].p1, fam.p2, handleToken, matToken, p3, p4, p5, cfg.W, cfg.H, cfg.D, T].join("-") +
    (cfg.finish ? "-" + cfg.finish.toUpperCase() : "");

  return { code, ...cfg, shelfQty, vid: v.id, ...built } as CarcassModel;
}

/* ------------------------------------------------------------------ */
/*  Raw rows / CSV — same output contract as stone                     */
/* ------------------------------------------------------------------ */

function buildRawRows(m: CarcassModel): Array<{ item: string; pack: string; uom: string; qty: number }> {
  const rows: Array<{ item: string; pack: string; uom: string; qty: number }> = [];
  m.panels.forEach((p) => rows.push({ item: normalizePartOrPanelName(p.name), pack: p.pack, uom: "nos", qty: p.qty }));
  m.profiles.forEach((p) => rows.push({ item: `${p.name} ${p.len}MM`, pack: p.pack, uom: "nos", qty: p.qty }));
  m.hardware.forEach((h) => expandHardwarePack(h).forEach((component) => rows.push({ item: component.name, pack: component.pack, uom: component.uom, qty: component.qty })));
  m.cons.forEach((c) => rows.push({ item: c.name, pack: c.pack, uom: c.uom, qty: c.qty }));
  return rows;
}

function cabinetPacketRows(m: CarcassModel): Array<{ pack: string; item: string; qty: number; unit: string }> {
  return [
    ...m.panels.map((panel) => ({ pack: panel.pack, item: `${panel.name} · ${panel.mat ?? ""}`, qty: panel.qty, unit: "pcs" })),
    ...m.profiles.map((profile) => ({ pack: profile.pack, item: `${profile.name} · cut ${profile.len} mm`, qty: profile.qty, unit: "pcs" })),
    ...m.hardware.flatMap(expandHardwarePack).map((part) => ({ pack: part.pack, item: part.name, qty: part.qty, unit: part.uom })),
    ...m.cons.map((part) => ({ pack: part.pack, item: part.name, qty: part.qty, unit: part.uom })),
  ];
}

/** Export cut panels and an Excel calculator linked to the live project configuration. */
function exportPanelCalculatorWorkbook(project: ProjectLine[], extraPanels: Panel[], waste: WastePct) {
  type PanelRecord = {
    code: string; elevation: string; category: string; panel: Panel; cabinetQty: number;
    materialType: string;
  };
  const records: PanelRecord[] = [];
  project.forEach((line) => line.m.panels.forEach((panel) => {
    const item = panel.visibleSide ? shutterMasterItem(panel.materialId ?? line.m.visibleSideMaterialId)
      : panel.pack === "Shutter Pack" ? shutterMasterItem(line.m.shType)
        : carcassMasterItem(line.m.board, line.m.backBoardId, line.m.drawerBoardId, panel);
    const category = panel.visibleSide ? "Visible side" : panel.pack === "Drawer Pack" ? "Drawer"
      : panel.pack === "Shutter Pack" ? "Shutter" : item?.group === "Carcass Back Material" ? "Carcass back" : "Carcass";
    records.push({ code: line.m.code, elevation: line.elevation, category, panel,
      cabinetQty: line.qty, materialType: item?.type ?? "Unknown" });
  }));
  extraPanels.forEach((panel, index) => {
    const category = panel.extraMaterialRole === "visible" ? "Visible side"
      : panel.pack === "Carcass Pack" ? "Carcass" : "Shutter";
    const item = panel.pack === "Carcass Pack"
      ? CARCASS_BOARD_ITEMS.find((candidate) => candidate.id === panel.materialId)
      : shutterMasterItem(panel.materialId ?? "");
    records.push({ code: `EXTRA-${index + 1}`, elevation: "", category, panel,
      cabinetQty: 1, materialType: item?.type ?? "Unknown" });
  });

  const workbook = XLSX.utils.book_new();
  const headers = ["Cabinet code", "Elevation", "Category", "Panel", "Material", "Width mm", "Height mm",
    "Thickness mm", "Qty / cabinet", "Cabinet qty", "Total panels", "Material type", "Banded",
    "Panel sqft net", "Laminate sqft net (both faces)", "Edge band m net",
    "Board waste %", "Band waste %", "Laminate sqft incl waste", "Edge band m incl waste"];
  const panelRows: (string | number | XLSX.CellObject)[][] = [headers];
  records.forEach(({ code, elevation, category, panel, cabinetQty, materialType }, index) => {
    const row = index + 2;
    const count = panel.qty * cabinetQty;
    const area = panel.w * panel.h * count / SQDIV;
    const postlam = materialType.toUpperCase() === "POSTLAM";
    const band = panel.band ? (2 * (panel.w + panel.h) + 4 * BAND_EDGE_ALLOWANCE) * count / 1000 : 0;
    const boardWaste = category === "Shutter" || category === "Visible side" || category === "Drawer" || category === "Carcass back" ? waste.shutter : waste.carcass;
    const bandWaste = waste.edgeBand ?? WASTE.edgeBand;
    panelRows.push([code, elevation, category, panel.name, panel.mat ?? "", panel.w, panel.h, panel.t ?? 0,
      panel.qty, cabinetQty, { f: `I${row}*J${row}`, t: "n", v: count }, materialType,
      panel.band ? "Yes" : "No", { f: `F${row}*G${row}*K${row}/${SQDIV}`, t: "n", v: area },
      { f: `IF(L${row}="Postlam",2*N${row},0)`, t: "n", v: postlam ? area * 2 : 0 },
      { f: `IF(M${row}="Yes",(2*(F${row}+G${row})+${4 * BAND_EDGE_ALLOWANCE})*K${row}/1000,0)`, t: "n", v: band },
      boardWaste, bandWaste,
      { f: `O${row}/(1-Q${row}/100)`, t: "n", v: quantityWithWaste(postlam ? area * 2 : 0, boardWaste) },
      { f: `P${row}/(1-R${row}/100)`, t: "n", v: quantityWithWaste(band, bandWaste) }]);
  });
  const panelSheet = XLSX.utils.aoa_to_sheet(panelRows);
  panelSheet["!cols"] = [{ wch: 60 }, { wch: 13 }, { wch: 16 }, { wch: 53 }, { wch: 44 },
    ...Array(6).fill({ wch: 15 }), { wch: 17 }, { wch: 12 }, ...Array(7).fill({ wch: 20 })];
  panelSheet["!freeze"] = { xSplit: 1, ySplit: 1 };
  panelSheet["!autofilter"] = { ref: `A1:T${Math.max(2, panelRows.length)}` };
  for (let column = 0; column < headers.length; column++) {
    const address = XLSX.utils.encode_cell({ r: 0, c: column });
    panelSheet[address].s = { fill: { fgColor: { rgb: "17655B" } }, font: { bold: true, color: { rgb: "FFFFFF" } } };
  }
  XLSX.utils.book_append_sheet(workbook, panelSheet, "Panels");

  const firstCode = project[0]?.m.code ?? "";
  const categories = ["Carcass", "Shutter", "Drawer", "Visible side"];
  const limit = Math.max(records.length + 1, 1000);
  const summary: (string | number | XLSX.CellObject)[][] = [
    ["Laminate and edge-band calculator"],
    ["Paste a cabinet code in B4. Results use the Panels tab exported from this kitchen."],
    [], ["Cabinet code", firstCode],
    ["Code status", { f: `IF(B4="","Enter a code",IF(COUNTIFS('Panels'!$A$2:$A$${limit},B4)=0,"Code not found","Found"))`, t: "s" }],
    ["Postlam board laminate is counted on both faces. Glass-cabinet carcass laminate may have separate front and back prices; glass shutters and shelves themselves have no laminate sheets. Prelam, PU and membrane have no separate laminate sheets."],
    [],
    ["Category", "Panel sqft net", "Laminate sqft (both faces)", "Edge band m net", "Laminate sqft incl waste", "Edge band m incl waste"],
  ];
  for (let i = 0; i < categories.length; i++) {
    const row = i + 9;
    const values: (string | number | XLSX.CellObject)[] = [categories[i]];
    const criteria = `'Panels'!$A$2:$A$${limit},$B$4,'Panels'!$C$2:$C$${limit},$A${row}`;
    for (const col of ["N", "O", "P", "S", "T"]) values.push({ f: `IF($B$5<>"Found","",SUMIFS('Panels'!$${col}$2:$${col}$${limit},${criteria}))`, t: "n" });
    summary.push(values);
  }
  summary.push(["Total", ...["B", "C", "D", "E", "F"].map((col) => ({ f: `IF($B$5<>"Found","",SUM(${col}9:${col}12))`, t: "n" as const }))]);
  summary.push([], ["Code alone does not define the material or visible sides. Export a fresh panel list after changing the kitchen."],
    ["Banded panels use four edges plus 50 mm per edge; unbanded panels, including grooved backs, have zero edge band."],
    [], ["Available cabinet codes"]);
  [...new Set(records.map((record) => record.code))].forEach((code) => summary.push([code]));
  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  summarySheet["!cols"] = [{ wch: 68 }, ...Array(5).fill({ wch: 24 })];
  summarySheet["!freeze"] = { xSplit: 0, ySplit: 8 };
  if (summarySheet.B4) summarySheet.B4.s = { fill: { fgColor: { rgb: "FFF2CC" } }, font: { bold: true } };
  for (let column = 0; column < 6; column++) {
    const address = XLSX.utils.encode_cell({ r: 7, c: column });
    summarySheet[address].s = { fill: { fgColor: { rgb: "17655B" } }, font: { bold: true, color: { rgb: "FFFFFF" } } };
  }
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Calculator");
  // Put the code-entry sheet first while preserving the Panels formula references.
  workbook.SheetNames = ["Calculator", "Panels"];
  XLSX.writeFile(workbook, `Panel_Laminate_Calculator_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function buildCSV(project: ProjectLine[]): string {
  const order: string[] = [];
  const map = new Map<string, { code: string; item: string; pack: string; uom: string; qty: number }>();
  project.forEach((l) => {
    const code = l.m.code;
    buildRawRows(l.m).forEach((r) => {
      const key = code + "||" + r.item + "||" + r.pack + "||" + r.uom;
      if (!map.has(key)) {
        map.set(key, { code, item: r.item, pack: r.pack, uom: r.uom, qty: 0 });
        order.push(key);
      }
      map.get(key)!.qty += r.qty * l.qty;
    });
  });
  const esc = (s: unknown): string => {
    const str = String(s ?? "");
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  let csv = "SN,Item Name,Pack Name,Cabinet Code,UoM,Qty\n";
  order.forEach((k, i) => {
    const r = map.get(k)!;
    const q = Number.isInteger(r.qty) ? r.qty : +r.qty.toFixed(3);
    csv += [i + 1, esc(r.item), esc(r.pack), esc(r.code), r.uom, q].join(",") + "\n";
  });
  return csv;
}

/* ------------------------------------------------------------------ */
/*  Full BOM — 26 columns, levels L0..L4 (stone contract preserved)    */
/* ------------------------------------------------------------------ */

type WastePct = typeof WASTE;

function edgeBandWaste(wst: WastePct): number { return wst.edgeBand ?? WASTE.edgeBand; }

function wasteFor(pack: string, uom: string, wst: WastePct = WASTE, itemName = ""): number {
  if (uom === "mtr" || uom === "RMT") return /^EDGE BAND\b/i.test(itemName) ? edgeBandWaste(wst) : wst.profile;
  return pack === "Shutter Pack" || pack === "Drawer Pack" ? wst.shutter : wst.carcass;
}

function boardWasteForPanel(panel: Panel, model: CarcassModel, wst: WastePct): number {
  if (panel.visibleSide || panel.pack === "Shutter Pack" || panel.pack === "Drawer Pack") return wst.shutter;
  return carcassMasterItem(model.board, model.backBoardId, model.drawerBoardId, panel)?.group === "Carcass Back Material"
    ? wst.shutter : wst.carcass;
}

function billableBoardSqft(panel: Panel, multiplier: number, wst: WastePct, model?: CarcassModel): number {
  const waste = model ? boardWasteForPanel(panel, model, wst)
    : wasteFor(panel.visibleSide ? "Shutter Pack" : panel.pack, "sqft", wst);
  return quantityWithWaste(sqft(panel.w, panel.h) * panel.qty * multiplier, waste);
}

function makeRow(o: Partial<FullBomRow>): FullBomRow {
  return {
    SO: "", Elevation: "", "Main Group": "", "Sub Group": "", Level: 0, Item: "", SKU: "",
    Type: "", Height: "", Width: "", Depth: "", Thickness: "", Finish: "", Grain: "",
    "CF Type": "", "Profile Code": "", "SO Qty": 0, "Waste %": 0, "Actual Qty": 0, Pcs: "",
    "In Stock": 0, "Eff. Stock": 0, Deficit: 0, Unit: "nos", Status: "unknown",
    _type: String(o.Type ?? "plain"), ...o,
  };
}

function buildFullBomData(project: ProjectLine[], so: string, finish: string, wst: WastePct = WASTE): FullBomRow[] {
  const rows: FullBomRow[] = [];
  project.forEach((line) => {
    const m = line.m;
    const q = line.qty;

    rows.push(makeRow({
      SO: so, Elevation: line.elevation, "Main Group": "Cabinet", "Sub Group": m.code,
      Level: 0, Item: m.code, Type: "master",
      Height: String(m.H), Width: String(m.W), Depth: String(m.D),
      "SO Qty": q, "Actual Qty": q, Unit: "nos",
    }));

    const packs = [...new Set(m.panels.map((p) => p.pack))];
    packs.forEach((pk) => {
      rows.push(makeRow({
        SO: so, Elevation: line.elevation, "Main Group": "Cabinet", "Sub Group": pk,
        Level: 1, Item: `${pk} — ${m.code}`, Type: "sub_bom",
        "SO Qty": q, "Actual Qty": q, Unit: "nos",
      }));

      m.panels.filter((p) => p.pack === pk).forEach((p) => {
        const bandFinish = edgeBandForMaterial(m.edgeBand, edgeBandFieldForPanel(p, m.board, m.backBoardId, m.drawerBoardId)).finish;
        const stoneFinish = m.board === SINK_STONE_BOARD_ID && p.mat === carcassBoardOf(m.board, m.backBoardId).core
          ? selectedBoardFinish(SINK_STONE_BOARD_ID, m.boardPrices?.carcass, m.finish) : undefined;
        explodePanelForTree(p, finish, bandFinish).forEach((t) => {
          const waste = t.uom === "sqft" ? boardWasteForPanel(p, m, wst)
            : t.uom === "RMT" ? wasteFor(pk, t.uom, wst, t.name) : 0;
          rows.push(makeRow({
            SO: so, Elevation: line.elevation, "Main Group": "Cabinet", "Sub Group": pk,
            Level: t.level, Item: stoneFinish && t.uom === "sqft" ? `${t.name} · ${stoneFinish}` : t.name, Type: t.level >= 4 ? "component" : "plain",
            Height: String(p.h), Width: String(p.w), Thickness: String(p.t ?? ""),
            Finish: t.uom === "RMT" && t.name.startsWith("EDGE BAND") ? bandFinish : stoneFinish ?? finish,
            "CF Type": t.mat ?? "",
            "SO Qty": r3(t.qty * q), "Waste %": waste,
            "Actual Qty": r3(quantityWithWaste(t.qty * q, waste)),
            Pcs: t.uom === "sqft" ? r3(quantityWithWaste(t.qty * q, waste) /
              (m.board === SINK_STONE_BOARD_ID && p.mat === carcassBoardOf(m.board, m.backBoardId).core
                ? stoneSlabSqft(m.boardPrices?.carcass?.slabSqft) : SHEET_SQFT)) : "",
            Unit: t.uom,
          }));
        });
      });
    });

    m.profiles.forEach((p) => {
      rows.push(makeRow({
        SO: so, Elevation: line.elevation, "Main Group": "Cabinet", "Sub Group": p.pack,
        Level: 3, Item: `${p.name} ${p.len}MM`, Type: "component",
        "Profile Code": p.type, "SO Qty": p.qty * q, "Waste %": wst.profile,
        "Actual Qty": r3(quantityWithWaste((p.len * p.qty * q) / 1000, wst.profile)),
        Unit: "mtr",
      }));
    });

    m.hardware.forEach((h) => {
      rows.push(makeRow({
        SO: so, Elevation: line.elevation, "Main Group": "Cabinet", "Sub Group": h.pack ?? "Hardware Pack",
        Level: 2, Item: h.name, Type: "sub_bom",
        "SO Qty": h.qty * q, "Actual Qty": h.qty * q, Unit: h.uom ?? "nos",
      }));
      expandHardwarePack(h).filter((component) => component.name !== h.name).forEach((component) => rows.push(makeRow({
        SO: so, Elevation: line.elevation, "Main Group": "Cabinet", "Sub Group": component.pack,
        Level: 3, Item: component.name, Type: "component",
        "SO Qty": r3(component.qty * q), "Actual Qty": r3(component.qty * q), Unit: component.uom,
      })));
    });

    // Edge band is emitted from the cut panels above with its own wastage;
    // repeating the consumable summary here would double-count it in the BOM.
    m.cons.filter((c) => !/^EDGE BAND\b/i.test(c.name)).forEach((c) => {
      rows.push(makeRow({
        SO: so, Elevation: line.elevation, "Main Group": "Cabinet", "Sub Group": c.pack,
        Level: 4, Item: c.name, Type: "component",
        "SO Qty": r3(c.qty * q), "Actual Qty": r3(c.qty * q), Unit: c.uom,
      }));
    });
  });
  return rows;
}

/* ------------------------------------------------------------------ */
/*  Board roll-up — sqft → sheets                                      */
/* ------------------------------------------------------------------ */

type BoardTotal = { key: string; mat: string; t: number; finish: string; rate: number; sheetAreaSqft: number; pack: string; sqft: number; billableSqft: number; waste: number; sheets: number | null };

function boardCostKey(mat: string, thickness: number, finish: string, rate: number, sheetAreaSqft = 32): string {
  return JSON.stringify([mat, thickness, finish, Number(rate.toPrecision(14)), sheetAreaSqft]);
}

function buildBoardTotals(project: ProjectLine[], wst: WastePct = WASTE, extraPanels: Panel[] = []): BoardTotal[] {
  const map = new Map<string, BoardTotal>();
  const fold = (p: Panel, mult: number, finish: string, rate: number, model?: CarcassModel, sheetAreaSqft = 32) => {
    const mat = p.mat ?? "Board";
    const pack = p.visibleSide ? "Shutter Pack" : p.pack;
    const k = boardCostKey(mat, p.t ?? T, finish, rate, sheetAreaSqft);
    if (!map.has(k)) {
      map.set(k, { key: k, mat, t: p.t ?? T, finish, rate, sheetAreaSqft, pack, sqft: 0, billableSqft: 0, waste: 0, sheets: 0 });
    }
    const total = map.get(k)!;
    const area = sqft(p.w, p.h) * p.qty * mult;
    total.sqft += area;
    total.billableSqft += billableBoardSqft(p, mult, wst, model);
    if (!total.pack.split(", ").includes(pack)) total.pack += `, ${pack}`;
  };
  project.forEach((l) => l.m.panels.forEach((p) => {
    const m = l.m;
    const item = p.visibleSide ? shutterMasterItem(p.materialId ?? m.visibleSideMaterialId)
      : p.pack === "Shutter Pack" ? /glass/i.test(p.mat ?? "") ? glassShutterItemOf(m.glassType) : shutterMasterItem(m.shType)
      : carcassMasterItem(m.board, m.backBoardId, m.drawerBoardId, p);
    const field = p.visibleSide ? "visible" : p.pack === "Shutter Pack" ? "shutter"
      : p.pack === "Drawer Pack" ? "drawer" : item?.group === "Carcass Back Material" ? "back" : "carcass";
    const rate = item ? p.pack === "Shutter Pack" && /glass/i.test(p.mat ?? "") && m.zk === "WC" && m.fk === "WGL" && m.glassPricePerSqft !== undefined
      ? Number(m.glassPricePerSqft) : selectedBoardRate(item, m.boardPrices?.[field]) : 0;
    const sheetArea = item?.id === SINK_STONE_BOARD_ID ? stoneSlabSqft(m.boardPrices?.[field]?.slabSqft) : 32;
    fold(p, l.qty, item ? selectedBoardFinish(item.id, m.boardPrices?.[field], m.finish) : m.finish, rate, m, sheetArea);
  }));
  extraPanels.forEach((p) => {
    const item = p.pack === "Carcass Pack" ? CARCASS_BOARD_ITEMS.find((candidate) => candidate.id === p.materialId)
      : shutterMasterItem(p.materialId ?? "");
    fold(p, 1, p.extraFinish ?? "White", item ? selectedBoardRate(item, p.extraBoardPrice) : 0);
  });
  return [...map.values()].map((b) => ({
    ...b,
    waste: b.billableSqft ? r3((1 - b.sqft / b.billableSqft) * 100) : 0,
    sheets: /glass/i.test(b.mat) ? null : roundQuantity(b.billableSqft / b.sheetAreaSqft),
  }));
}

/* ------------------------------------------------------------------ */
/*  Fillers · Visible Panels · Countertop · Accessories                */
/*  (spec: CHAT_SUMMARY §15-§17 — wood keeps none of stone's profile   */
/*   machinery; a filler/VP is a plain shutter-type panel, countertop  */
/*   is one bought-in line, every accessory is opt-in.)                */
/* ------------------------------------------------------------------ */

const FILLER_ZONES = ["base", "tall", "wall", "loft", "mid"] as const;
// Preserve imported visible-panel rows in project files, but hide the standalone editor.
const SHOW_STANDALONE_VISIBLE_PANELS = false;
const FILLER_TYPES = [
  { value: "filler", label: "Filler" },
  { value: "top-filler", label: "Top Filler" },
  { value: "cover-panel", label: "Cover Panel" },
  { value: "chimney-panel", label: "Chimney Panel" },
  { value: "dishwasher-panel", label: "Dishwasher Panel" },
] as const;
const FILLER_ZKS: Record<string, string[]> = {
  base: ["BC", "BCL", "BB", "BBL"], tall: ["TC", "TB", "TCL"], wall: ["WC", "WB"],
  loft: ["LO", "LB", "LBF", "LOF"], mid: ["MD"],
};
/** Stone's height presets survive as fallbacks when no matching line exists. */
const FILLER_PRESETS: Record<string, number[]> = {
  base: [717], wall: [1082, 717], tall: [2037, 2397], loft: [597], mid: [1647, 1287],
};
const FILLER_DEF_W = 80;
/** Wood VP width = carcass depth + 20 (stone used +25). */
const VP_DEPTH_ADD = 20;

function zoneLine(zone: string, project: ProjectLine[]): ProjectLine | undefined {
  return project.find((l) => (FILLER_ZKS[zone] ?? []).includes(l.m.zk));
}
/** Default filler/VP height: the zone's shutter height (line H − 3mm gap), else preset. */
function defFillerH(zone: string, project: ProjectLine[]): number {
  const l = zoneLine(zone, project);
  return l ? l.m.H - 3 : FILLER_PRESETS[zone]?.[0] ?? 717;
}
function defZoneDepth(zone: string, project: ProjectLine[]): number {
  const l = zoneLine(zone, project);
  return l ? l.m.D : zone === "base" || zone === "tall" ? 560 : 336;
}

function cabinetFillers(project: ProjectLine[]): FillerRow[] {
  return project.flatMap((line) => {
    if (!line.m.fillerWidth) return [];
    const sides = line.m.fillerSides === "BOTH" ? ["LH", "RH"] as const : [line.m.fillerSides ?? "LH"] as const;
    return sides.map((side) => ({
      id: line.id, linkedLineId: line.id, fillerSide: side, fillerType: "filler" as const,
      zone: ZONES[line.m.zk].tall ? "tall" : ZONES[line.m.zk].kind === "wall" ? "wall" : ZONES[line.m.zk].kind === "loft" ? "loft" : "base",
      customShade: line.m.finish, qty: line.qty, customHeight: String(line.m.H),
      customWidth: String(side === "RH" ? line.m.fillerWidthRH ?? line.m.fillerWidth : line.m.fillerWidth),
      customDepth: String(line.m.D), elevation: line.elevation,
    }));
  });
}

function fillerPanelCount(filler: FillerRow): number {
  return filler.fillerType === "cover-panel" ? 5 : filler.zone === "wall" && filler.linkedLineId !== undefined ? 3 : 1;
}

/** A filler or visible panel resolves to one banded shutter-type panel. */
function extraPanelOf(kind: "Filler" | "Visible", zone: string, H: number, W: number, q: number, shTypeKey: string): Panel {
  const S = shOf(shTypeKey);
  return {
    name: `Panels- SH ${kind} ${S.t}mm ${W}x${H}`,
    w: W, h: H, qty: q, drill: null, pack: "Shutter Pack",
    t: S.t, mat: S.mat, band: S.band,
  };
}

function buildExtrasBom(
  fillers: FillerRow[], visiblePanels: VisiblePanelRow[], countertops: CountertopRow[],
  project: ProjectLine[], so: string, globalShType: string, countertopShType: string, globalFinish: string, wst: WastePct,
  materials?: KitchenMaterials, fallbackBoardId: string = DEFAULT_BOARD_ID,
  fallbackShutterLaminate: { front: string; back: string } = { front: DEFAULT_LAMINATE_PRICES.shutterLamFrontSheetPrice, back: DEFAULT_LAMINATE_PRICES.shutterLamBackSheetPrice },
  fallbackVisible: { itemId: string; front: string; back: string } = { itemId: MATERIAL_MASTER.visibleSideShutterMaterialId, front: "550", back: "550" },
): { rows: FullBomRow[]; panels: Panel[] } {
  const rows: FullBomRow[] = [];
  const panels: Panel[] = [];

  const emit = (kind: "Filler" | "Visible", r: FillerRow, shTypeKey: string) => {
    const zone = r.zone;
    const linkedCabinet = r.linkedLineId === undefined ? undefined : project.find((line) => line.id === r.linkedLineId);
    const H = parseFloat(r.customHeight) || linkedCabinet?.m.H || defFillerH(zone, project);
    const W = parseFloat(r.customWidth) ||
      (kind === "Filler" ? FILLER_DEF_W : defZoneDepth(zone, project) + VP_DEPTH_ADD);
    const q = r.qty || 1;
    const fin = r.customShade || globalFinish;
    const fillerType = kind === "Filler" ? r.fillerType ?? "filler" : "filler";
    const baseLabel = kind === "Visible" ? "Visible Panel" : FILLER_TYPES.find((type) => type.value === fillerType)?.label ?? "Filler";
    const label = fillerType === "filler" && r.fillerSide ? `${baseLabel} ${r.fillerSide}` : baseLabel;
    const depth = parseFloat(r.customDepth ?? "") || linkedCabinet?.m.D || defZoneDepth(zone, project);
    const materialZone = ({ base: "Base", wall: "Wall", tall: "Tall", loft: "Loft", mid: "Mid" } as const)[zone as "base" | "wall" | "tall" | "loft" | "mid"] ?? "Base";
    const matchingLine = linkedCabinet ?? project.find((line) => line.elevation === r.elevation && (FILLER_ZKS[zone] ?? []).includes(line.m.zk));
    const zoneMaterials = materials?.[materialZone];
    const edgeBand = matchingLine?.m.edgeBand ?? zoneMaterials?.edgeBand;
    const selected = kind === "Visible" ? zoneMaterials?.visible : zoneMaterials?.shutter;
    const resolvedShutterType = kind === "Visible"
      ? (r as VisiblePanelRow).shutterType || matchingLine?.m.visibleSideMaterialId || selected?.itemId || fallbackVisible.itemId
      : matchingLine?.m.shType || selected?.itemId || shTypeKey;
    const frontPanel = extraPanelOf(kind, zone, Math.round(H), Math.round(W), q, resolvedShutterType);
    frontPanel.name = `Panels- SH ${label} ${frontPanel.t}mm ${Math.round(W)}x${Math.round(H)}`;
    frontPanel.materialId = resolvedShutterType;
    frontPanel.extraMaterialRole = kind === "Visible" ? "visible" : "shutter";
    frontPanel.extraBoardPrice = matchingLine?.m.boardPrices?.[frontPanel.extraMaterialRole] ?? boardPricesFromMaterials(zoneMaterials)[frontPanel.extraMaterialRole];
    frontPanel.extraLaminate = kind === "Visible" ? {
      front: matchingLine?.m.visibleLamFrontSheetPrice ?? selected?.frontSheetPrice ?? fallbackVisible.front,
      back: matchingLine?.m.visibleLamBackSheetPrice ?? selected?.backSheetPrice ?? fallbackVisible.back,
    } : {
      front: matchingLine?.m.shutterLamFrontSheetPrice ?? selected?.frontSheetPrice ?? fallbackShutterLaminate.front,
      back: matchingLine?.m.shutterLamBackSheetPrice ?? selected?.backSheetPrice ?? fallbackShutterLaminate.back,
    };
    const partPanels: Panel[] = [frontPanel];
    if (kind === "Filler" && fillerType !== "cover-panel" && zone === "wall" && linkedCabinet) {
      const selectedMaterials = zoneMaterials?.carcass;
      const boardId = matchingLine?.m.board ?? selectedMaterials?.itemId ?? fallbackBoardId;
      const carcassBoard = carcassBoardOf(boardId);
      const laminate = {
        front: matchingLine?.m.carcassLamFrontSheetPrice ?? selectedMaterials?.frontSheetPrice ?? DEFAULT_LAMINATE_PRICES.carcassLamFrontSheetPrice,
        back: matchingLine?.m.carcassLamBackSheetPrice ?? selectedMaterials?.backSheetPrice ?? DEFAULT_LAMINATE_PRICES.carcassLamBackSheetPrice,
      };
      for (const face of ["Top", "Bottom"]) partPanels.push({
        name: `Panels- CR Wall Filler ${face} ${carcassBoard.coreT}mm ${Math.round(W)}x${Math.round(depth)}`,
        w: Math.round(W), h: Math.round(depth), qty: q, drill: null, pack: "Carcass Pack",
        t: carcassBoard.coreT, mat: carcassBoard.core, band: true,
        materialId: carcassBoard.item?.id, extraCarcassLaminate: laminate,
        extraBoardPrice: matchingLine?.m.boardPrices?.carcass ?? boardPricesFromMaterials(zoneMaterials).carcass,
      });
    }
    if (fillerType === "cover-panel") {
      const selectedMaterials = zoneMaterials?.carcass;
      const boardId = matchingLine?.m.board ?? selectedMaterials?.itemId ?? zoneLine(zone, project)?.m.board ?? fallbackBoardId;
      const carcassBoard = carcassBoardOf(boardId);
      const laminate = {
        front: matchingLine?.m.carcassLamFrontSheetPrice ?? selectedMaterials?.frontSheetPrice ?? DEFAULT_LAMINATE_PRICES.carcassLamFrontSheetPrice,
        back: matchingLine?.m.carcassLamBackSheetPrice ?? selectedMaterials?.backSheetPrice ?? DEFAULT_LAMINATE_PRICES.carcassLamBackSheetPrice,
      };
      for (const [dimension, length] of [["height", H], ["width", W]] as const) {
        for (let piece = 1; piece <= 2; piece++) partPanels.push({
          name: `Panels- CR Cover Panel ${dimension} strip ${piece} ${carcassBoard.coreT}mm ${Math.round(length)}x100`,
          w: Math.round(length), h: 100, qty: q, drill: null, pack: "Carcass Pack",
          t: carcassBoard.coreT, mat: carcassBoard.core, band: true,
          materialId: carcassBoard.item?.id, extraCarcassLaminate: laminate,
          extraBoardPrice: matchingLine?.m.boardPrices?.carcass ?? boardPricesFromMaterials(zoneMaterials).carcass,
        });
      }
    }
    partPanels.forEach((panel) => {
      panel.extraEdgeBand = edgeBand;
      panel.extraFinish = selectedBoardFinish(panel.materialId ?? "", panel.extraBoardPrice, fin);
    });
    panels.push(...partPanels);
    const Z = zone.toUpperCase();
    const codeBase = `SH-${label.replace(/\s+/g, "")}-${Z}-${Math.round(H)}x${Math.round(W)}`;
    const start = rows.length;
    rows.push(makeRow({
      SO: so, "Main Group": kind === "Filler" ? "Filler" : "Visible Panel", "Sub Group": codeBase,
      Level: 0, Item: `Panels- SH ${label} ${Math.round(H)}x${Math.round(W)}x${partPanels[0].t}`,
      SKU: `${codeBase}-${q}`, Type: "master",
      Height: String(Math.round(H)), Width: String(Math.round(W)), Thickness: String(partPanels[0].t ?? ""),
      Finish: fin, "SO Qty": q, "Actual Qty": q, Unit: "nos",
    }));
    rows.push(makeRow({
      SO: so, "Main Group": rows[start]["Main Group"], "Sub Group": codeBase,
      Level: 1, Item: codeBase, SKU: codeBase, Type: "sub_bom",
      Finish: fin, "SO Qty": q, "Actual Qty": q, Unit: "nos",
    }));
    partPanels.forEach((p) => {
      const field = p.extraMaterialRole ?? (p.pack === "Carcass Pack" ? "carcass" : "shutter");
      const bandFinish = edgeBandForMaterial(edgeBand, field).finish;
      explodePanelForTree(p, fin, bandFinish).forEach((t) => {
      const waste = t.uom === "sqft" || t.uom === "RMT" ? wasteFor(p.pack, t.uom, wst, t.name) : 0;
      rows.push(makeRow({
        SO: so, "Main Group": rows[start]["Main Group"], "Sub Group": codeBase,
        Level: t.level, Item: t.name, Type: t.level >= 4 ? "component" : "plain",
        Height: String(p.h), Width: String(p.w), Thickness: String(p.t ?? ""),
        Finish: t.uom === "RMT" && t.name.startsWith("EDGE BAND") ? bandFinish : fin,
        "CF Type": t.mat ?? "",
        "SO Qty": r3(t.qty), "Waste %": waste,
        "Actual Qty": r3(quantityWithWaste(t.qty, waste)),
        Pcs: t.uom === "sqft" ? r3(quantityWithWaste(t.qty, waste) / SHEET_SQFT) : "",
        Unit: t.uom,
      }));
      });
    });
    for (let i = start; i < rows.length; i++) rows[i].Elevation = r.elevation || "";
  };

  fillers.forEach((f) => emit("Filler", f, globalShType));
  visiblePanels.forEach((vp) => emit("Visible", vp, globalShType));

  countertops.forEach((c) => {
    const L = parseFloat(c.length) || 0;
    const D = parseFloat(c.depth) || 600;
    const selected = countertopMaterialItem(c, countertopShType);
    const Tt = parseFloat(c.thickness) || selected?.thicknessMm || 30;
    if (!L) return;
    const q = c.qty || 1;
    const matName = selected?.subgroup ?? (c.material.trim() || "Counter Ply");
    rows.push(makeRow({
      SO: so, "Main Group": "Counter Ply", "Sub Group": `CT-${L}x${D}x${Tt}`,
      Level: 0, Item: `Counter Ply ${matName} ${Tt}mm ${L}x${D}`, SKU: `CT-${L}x${D}x${Tt}-${q}`,
      Type: "master", Height: String(D), Width: String(L), Thickness: String(Tt),
      Finish: matName, "SO Qty": q, "Actual Qty": q, Unit: "nos",
    }));
    rows.push(makeRow({
      SO: so, "Main Group": "Counter Ply", "Sub Group": `CT-${L}x${D}x${Tt}`,
      Level: 1, Item: selected?.materialDescription ?? `CT ${matName} ${Tt}mm ${L}x${D} (bought-in)`, SKU: selected?.id ?? `CT-${L}x${D}x${Tt}`,
      Type: "component", Height: String(D), Width: String(L), Thickness: String(Tt),
      Finish: matName, "SO Qty": q, "Actual Qty": q, Unit: "nos",
    }));
  });

  return { rows, panels };
}

/* --- Accessories — everything opt-in (CHAT_SUMMARY §17) --- */

// Keep the saved "elenor" key so older project exports still reopen as a light row.
type AccessoryKind = "skirting" | "elenor" | "c-handle" | "j-handle";
interface AccessoryRow {
  id: number;
  kind: AccessoryKind;
  /** Stable source for an editable, automatically calculated row. */
  automaticKey?: string;
  disabled?: boolean;
  /** Cutting size of one accessory piece, in metres. */
  size: string;
  /** Legacy saved total length; converted to size on import. */
  lengthMeters?: number;
  /** Number of pieces or runs, always a whole number. */
  qty: number;
  /** Cabinet count retained when several J cuts form one elevation run. */
  fixingPlateCabinetQty?: number;
  elevation: string;
  straight: number; // skirting connectors
  lconn: number;
  driver: string;   // light driver master ID (legacy labels also accepted)
}
interface MasterAccessoryRow {
  id: number;
  linkedLineId?: number;
  sourceItemId?: string;
  disabled?: boolean;
  itemId: string;
  qty: number;
  elevation: string;
  /** Blank uses the Kitchen master rate; a non-negative value overrides this row only. */
  manualRate?: string;
  /** Project-specific item when it is not in the Kitchen master or reference catalog. */
  customName?: string;
  customUnit?: "PCS" | "SET" | "MTR";
  customBrand?: string;
}
interface LinkedAccessoryEdit {
  linkedLineId: number;
  sourceItemId: string;
  disabled?: boolean;
  itemId?: string;
  qty?: number;
  elevation?: string;
  manualRate?: string;
  customName?: string;
  customUnit?: "PCS" | "SET" | "MTR";
  customBrand?: string;
}
const validAccessoryManualRate = (value: unknown) => value === undefined || value === "" ||
  (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0);
const KITCHEN_ACCESSORY_ITEMS = COSTING_ITEMS.filter((item) => item.id.startsWith("KITCHEN-") &&
  (["Accessory", "LIGHT"].includes(item.group) ||
    (item.group === "HANDLE" && ["C Type", "J Type"].includes(item.subgroup))));
const accessoryNameKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");
const pricedAccessoryNames = new Set(KITCHEN_ACCESSORY_ITEMS.flatMap((item) => costingItemNames(item).map(accessoryNameKey)));
const MASTER_ACCESSORY_ITEMS = [
  ...KITCHEN_ACCESSORY_ITEMS.map((item) => ({
    id: item.id, subgroup: item.group === "HANDLE" ? `${item.subgroup} handle` : item.subgroup, materialDescription: item.materialDescription,
    type: item.type, brand: item.brand, rateBasis: item.rateBasis,
    currentRate: item.currentRate, priced: true,
  })),
  ...(accessoryCatalogData as Array<{ id: string; name: string; subgroup: string; unit: string }>)
    .filter((item) => !pricedAccessoryNames.has(accessoryNameKey(item.name)))
    .map((item) => ({
      id: item.id, subgroup: item.subgroup, materialDescription: item.name,
      type: item.unit, brand: "", rateBasis: item.unit.toUpperCase() === "SET" ? "SET" : item.unit.toUpperCase() === "MTR" ? "MTR" : "PCS",
      currentRate: 0, priced: false,
    })),
];
/** Cabinet-linked accessories are derived from lines, so edits and deletion cannot leave stale rows. */
function cabinetAccessories(project: ProjectLine[], edits: LinkedAccessoryEdit[] = []): MasterAccessoryRow[] {
  return project.flatMap((line) => {
    const applyEdit = (base: MasterAccessoryRow): MasterAccessoryRow => {
      const edit = edits.find((candidate) => candidate.linkedLineId === line.id && candidate.sourceItemId === base.sourceItemId);
      return edit ? { ...base, ...edit } : base;
    };
    const bottleItem = ({ 150: "KITCHEN-076", 200: "KITCHEN-077", 300: "KITCHEN-078" } as Record<number, string>)[line.m.W];
    const itemIds = line.m.fk === "BPO"
      ? bottleItem ? [bottleItem, "KITCHEN-079"] : []
      : line.m.fk === "WDR" ? line.m.W === 600 ? ["KITCHEN-072"] : line.m.W === 900 ? ["KITCHEN-071"] : []
      : line.m.fk === "MGC" ? ["ACCESSORIES-101"]
      : line.m.fk === "LMC" ? ["KITCHEN-069"]
      : line.m.fk === "WBP" ? ["KITCHEN-075"]
      : line.m.zk === "TC" && line.m.fk === "PAN" ? line.m.W === 450 ? ["ACCESSORIES-130"] : line.m.W === 600 ? ["ACCESSORIES-136"] : []
      : [];
    if (line.m.zk === "WC" && isGlassShutterFam(line.m.fk) && line.m.spotLight) itemIds.push("KITCHEN-091");
    const linked = itemIds.filter((id): id is string => !!id && MASTER_ACCESSORY_ITEMS.some((item) => item.id === id))
      .map((itemId, index) => applyEdit({ id: -(line.id * 10 + index + 1), linkedLineId: line.id, sourceItemId: itemId,
        itemId, qty: line.qty, elevation: line.elevation, manualRate: "" }));
    const handleType = line.m.handle;
    const fronts = line.m.panels.filter((panel) => panel.pack === "Shutter Pack" && !panel.visibleSide &&
      /\bSH\b/i.test(panel.name) && !/\b(?:Fixed|Filler|Visible)\b/i.test(panel.name))
      .reduce((sum, panel) => sum + panel.qty, 0);
    if (!["PUSH", "KNOB", "HANDLE"].includes(handleType) || fronts === 0) return linked;
    const handleName = handleType === "PUSH" ? "Push to Open" : handleType === "KNOB" ? "Knob" : "Handle";
    return [...linked, applyEdit({ id: -(line.id * 10 + 9), linkedLineId: line.id, sourceItemId: "CUSTOM", itemId: "CUSTOM", qty: fronts * line.qty,
      elevation: line.elevation, customName: handleName, customUnit: "PCS" as const,
      customBrand: handleType === "PUSH" ? line.m.handleBrand || "Hettich" : "",
      manualRate: line.m.handlePrice ?? "" })];
  });
}
function selectedMasterAccessory(row: MasterAccessoryRow) {
  const catalogItem = MASTER_ACCESSORY_ITEMS.find((item) => item.id === row.itemId);
  if (catalogItem) return catalogItem;
  if (row.itemId !== "CUSTOM" || !row.customName?.trim()) return undefined;
  const unit = row.customUnit ?? "PCS";
  return {
    id: `CUSTOM-ACCESSORY-${row.id}`, subgroup: row.customName.trim(),
    materialDescription: [row.customName.trim(), row.customBrand?.trim()].filter(Boolean).join(" · "),
    type: unit, brand: row.customBrand?.trim() ?? "",
    rateBasis: unit, currentRate: 0, priced: false,
  };
}

function groupLinkedAccessories(rows: MasterAccessoryRow[]): MasterAccessoryRow[][] {
  const groups = new Map<string, MasterAccessoryRow[]>();
  for (const row of rows) {
    const identity = row.itemId === "CUSTOM"
      ? `CUSTOM|${(row.customName ?? "").trim().toUpperCase()}|${row.customUnit ?? "PCS"}|${(row.customBrand ?? "").trim().toUpperCase()}`
      : row.itemId;
    const key = `${row.elevation}\u0000${identity}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
}
const ACC_LABEL: Record<AccessoryKind, string> = {
  skirting: "PVC Skirting Profile",
  elenor: "LED Profile Light",
  "c-handle": "C Type handle",
  "j-handle": "J Type handle",
};
const HANDLE_ITEMS = {
  "c-handle": COSTING_ITEMS.find((item) => item.id === "KITCHEN-050")!,
  "j-handle": COSTING_ITEMS.find((item) => item.id === "KITCHEN-049")!,
};
const HANDLE_HARDWARE = {
  "c-handle": ["HARDWARE-022", "HARDWARE-023", "HARDWARE-026"],
  "j-handle": ["HARDWARE-024", "HARDWARE-025", "HARDWARE-026"],
};
function requiredHandleHardware(kind: "c-handle" | "j-handle") {
  return HANDLE_HARDWARE[kind].map((id) => COSTING_ITEMS.find((item) => item.id === id)!);
}
function handleHardwareQuantities(row: AccessoryRow) {
  if (row.kind !== "c-handle" && row.kind !== "j-handle") return [];
  const [leftCap, rightCap, fixingPlate] = requiredHandleHardware(row.kind);
  const capQty = row.kind === "j-handle" && row.fixingPlateCabinetQty !== undefined ? 1 : row.qty;
  const plateQty = 2 * (row.fixingPlateCabinetQty ?? row.qty);
  return [{ item: leftCap, qty: capQty }, { item: rightCap, qty: capQty }, { item: fixingPlate, qty: plateQty }];
}
function accessoryMeters(row: AccessoryRow): number {
  return Math.max(0, Number(row.size) || 0) * Math.max(0, row.qty);
}
function groupedAutomaticAccessories(automatic: AccessoryRow[], edits: AccessoryRow[]) {
  const overrides = new Map(edits.filter((row) => row.automaticKey).map((row) => [row.automaticKey, row]));
  const groups = new Map<string, Array<{ source: AccessoryRow; item: AccessoryRow; edited: boolean }>>();
  automatic.forEach((source) => {
    const override = overrides.get(source.automaticKey);
    const item = { ...source, ...override };
    // Handles share one visible row per kind and elevation; each cut remains editable below it.
    const key = item.kind === "c-handle" || item.kind === "j-handle"
      ? `${item.elevation}\u0000${item.kind}` : source.automaticKey!;
    const group = groups.get(key) ?? [];
    group.push({ source, item, edited: !!override });
    groups.set(key, group);
  });
  return [...groups.values()];
}
function visibleSuggestedRows<T extends { disabled?: boolean }>(rows: T[], showRemoved: boolean): T[] {
  return showRemoved ? rows : rows.filter((row) => !row.disabled);
}
/** A J profile is one continuous run per elevation, while C handles keep their individual cuts. */
function mergeJHandleRuns(rows: AccessoryRow[]): AccessoryRow[] {
  const merged = new Map<string, AccessoryRow>();
  const result: AccessoryRow[] = [];
  rows.forEach((row) => {
    if (row.kind !== "j-handle") { result.push(row); return; }
    const previous = merged.get(row.elevation);
    if (previous) {
      previous.size = (accessoryMeters(previous) + accessoryMeters(row)).toFixed(3);
      previous.fixingPlateCabinetQty = (previous.fixingPlateCabinetQty ?? 0) + row.qty;
    }
    else {
      const run = { ...row, size: accessoryMeters(row).toFixed(3), qty: 1, fixingPlateCabinetQty: row.qty };
      merged.set(row.elevation, run);
      result.push(run);
    }
  });
  return result;
}
const LIGHT_ITEMS = {
  profile: COSTING_ITEMS.find((item) => item.id === "KITCHEN-084")!,
  diffuser: COSTING_ITEMS.find((item) => item.id === "KITCHEN-085")!,
  led: COSTING_ITEMS.find((item) => item.id === "KITCHEN-086")!,
  wire: COSTING_ITEMS.find((item) => item.id === "KITCHEN-090")!,
};
const DRIVER_ITEMS = COSTING_ITEMS.filter((item) => ["KITCHEN-089", "KITCHEN-088"].includes(item.id));
function selectedDriver(value: string): CostingMasterItem | undefined {
  return DRIVER_ITEMS.find((item) => item.id === value || costingItemNames(item).includes(value))
    ?? (value.includes("2A 24W") ? DRIVER_ITEMS.find((item) => item.id === "KITCHEN-089") : undefined)
    ?? (value.includes("5A 60W") ? DRIVER_ITEMS.find((item) => item.id === "KITCHEN-088") : undefined);
}
const SKIRT_WASTE = 0.10;

/** Default skirting run: base and tall cabinet widths, metres. */
function defSkirtMeters(project: ProjectLine[]): number {
  const mm = project.reduce((a, l) =>
    a + (FILLER_ZKS.base.includes(l.m.zk) || FILLER_ZKS.tall.includes(l.m.zk) ? l.m.W * l.qty : 0), 0);
  return r3(mm / 1000);
}

function calculatedAccessories(project: ProjectLine[], fillers: FillerRow[]): AccessoryRow[] {
  const panelWidth = (filler: FillerRow) => Math.max(0, Number(filler.customWidth) || FILLER_DEF_W) * filler.qty;
  const elevations = [...new Set([...project.map((line) => line.elevation), ...fillers.map((filler) => filler.elevation)])];
  return elevations.flatMap((elevation, index) => {
    const zoneLines = project.filter((line) => line.elevation === elevation);
    const zoneFillers = fillers.filter((filler) => filler.elevation === elevation);
    const skirtingCabinetWidths = zoneLines.reduce((total, line) => total +
      (FILLER_ZKS.base.includes(line.m.zk) || FILLER_ZKS.tall.includes(line.m.zk) ? line.m.W * line.qty : 0), 0);
    const wallWidths = zoneLines.reduce((total, line) => total + (FILLER_ZKS.wall.includes(line.m.zk) ? line.m.W * line.qty : 0), 0);
    const extraSkirting = zoneFillers.reduce((total, filler) => total +
      ((filler.linkedLineId !== undefined && filler.zone === "base") || filler.fillerType === "dishwasher-panel" ? panelWidth(filler) : 0), 0);
    const chimneyWidth = zoneFillers.reduce((total, filler) => total + (filler.fillerType === "chimney-panel" ? panelWidth(filler) : 0), 0);
    const row = (kind: AccessoryKind, offset: number, millimetres: number): AccessoryRow => ({
      id: -1000 - index * 2 - offset, kind, size: (millimetres / 1000).toFixed(3), qty: 1,
      elevation, straight: 0, lconn: 0, driver: "", automaticKey: `elevation:${elevation}:${kind}`,
    });
    const profiles = [row("skirting", 1, skirtingCabinetWidths + extraSkirting), row("elenor", 2, Math.max(0, wallWidths - chimneyWidth))]
      .filter((item) => Number(item.size) > 0);
    const handles = zoneLines.flatMap((line) => {
      if (!FILLER_ZKS.base.includes(line.m.zk) || line.m.handle !== "XCJ") return [];
      const handleRow = (kind: "c-handle" | "j-handle", offset: number): AccessoryRow => ({
        id: -(line.id * 10 + offset), kind, size: (line.m.W / 1000).toFixed(3), qty: line.qty,
        elevation: line.elevation, straight: 0, lconn: 0, driver: "", automaticKey: `cabinet:${line.id}:${kind}`,
      });
      return [handleRow("j-handle", 1), ...(famSetOf(line.m.zk)[line.m.fk]?.drawers ? [handleRow("c-handle", 2)] : [])];
    });
    return [...profiles, ...handles];
  });
}

/** Convert version-one accessory rows, where size/qty had different meanings by type. */
function restoreAccessoryRow(row: AccessoryRow, version: number, project: ProjectLine[]): AccessoryRow {
  if (version === 2) {
    if (!Number.isSafeInteger(row.qty) || row.qty < 1 || !Number.isFinite(Number(row.size)) || Number(row.size) < 0) {
      throw new Error("A saved other accessory has an invalid size or quantity.");
    }
    return row;
  }
  if (row.kind === "skirting") {
    return { ...row, size: String(Number(row.size) || defSkirtMeters(project)), qty: 1, lengthMeters: undefined };
  }
  if (row.lengthMeters !== undefined && Number.isFinite(row.lengthMeters)) {
    const qty = Number.isSafeInteger(row.qty) && row.qty > 0 ? row.qty : 1;
    return { ...row, size: String(row.lengthMeters / qty), qty, lengthMeters: undefined };
  }
  if (row.kind === "elenor") {
    const qty = Number.isSafeInteger(row.qty) && row.qty > 0 ? row.qty : 1;
    return { ...row, size: String((Number(row.size) || 720) / 1000), qty, lengthMeters: undefined };
  }
  return { ...row, size: String(row.qty), qty: 1, lengthMeters: undefined };
}

function buildAccessoryRows(accs: AccessoryRow[], project: ProjectLine[], so: string): AccessoryExportRow[] {
  const out: AccessoryExportRow[] = [];
  const carcass = project.map((l) => l.m.code.split("-").slice(0, 3).join("-")).join(", ");
  accs.forEach((a) => {
    if (a.kind === "skirting") {
      const mtr = accessoryMeters(a);
      const withWaste = r3(quantityWithWaste(mtr, SKIRT_WASTE * 100));
      out.push({
        SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL.skirting, Selected: "yes",
        "Item Name": "PVC SKIRTING PROFILE 100MM", Size: `${a.size} m × ${a.qty}`,
        Elevation: a.elevation, Total: mtr, "Actual Qty": withWaste, "Zoho Item ID": "",
      });
      if (a.straight > 0) out.push({
        SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL.skirting, Selected: "yes",
        "Item Name": "SKIRTING STRAIGHT CONNECTOR", Size: "", Elevation: a.elevation,
        Total: a.straight, "Actual Qty": a.straight, "Zoho Item ID": "",
      });
      if (a.lconn > 0) out.push({
        SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL.skirting, Selected: "yes",
        "Item Name": "SKIRTING L CONNECTOR", Size: "", Elevation: a.elevation,
        Total: a.lconn, "Actual Qty": a.lconn, "Zoho Item ID": "",
      });
    } else if (a.kind === "c-handle" || a.kind === "j-handle") {
      const item = HANDLE_ITEMS[a.kind];
      const meters = accessoryMeters(a);
      out.push({ SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL[a.kind], Selected: "yes",
        "Item Name": item.materialDescription, Size: `${a.size} m × ${a.qty}`, Elevation: a.elevation,
        Total: meters, "Actual Qty": meters, "Zoho Item ID": item.id });
      handleHardwareQuantities(a).forEach(({ item: hardware, qty }) => out.push({
        SO: so, "Carcass Items": carcass, Accessory: `${ACC_LABEL[a.kind]} hardware`, Selected: "yes",
        "Item Name": hardware.materialDescription, Size: "Pcs", Elevation: a.elevation,
        Total: qty, "Actual Qty": qty, "Zoho Item ID": hardware.id,
      }));
    } else {
      const q = a.qty;
      const netM = accessoryMeters(a);
      const billedM = netM;
      const rowsDef: Array<[CostingMasterItem, number, number, string]> = [
        [LIGHT_ITEMS.profile, netM, billedM, `${a.size} m × ${q}`],
        [LIGHT_ITEMS.diffuser, netM, billedM, `${a.size} m × ${q}`],
        [LIGHT_ITEMS.led, netM, billedM, `${a.size} m × ${q}`],
        [LIGHT_ITEMS.wire, 2 * q, 2 * q, `2 m × ${q}`],
      ];
      rowsDef.forEach(([item, total, actualQty, size]) => out.push({
        SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL.elenor, Selected: "yes",
        "Item Name": item.materialDescription, Size: size, Elevation: a.elevation,
        Total: total, "Actual Qty": actualQty, "Zoho Item ID": "",
      }));
      const driver = selectedDriver(a.driver);
      if (driver) out.push({
        SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL.elenor, Selected: "yes",
        "Item Name": driver.materialDescription, Size: "Pcs", Elevation: a.elevation,
        Total: q, "Actual Qty": q, "Zoho Item ID": "",
      });
    }
  });
  return out;
}

function buildMasterAccessoryRows(accs: MasterAccessoryRow[], so: string): AccessoryExportRow[] {
  return accs.flatMap((row) => {
    const item = selectedMasterAccessory(row);
    if (!item) return [];
    return [{
      SO: so, "Carcass Items": "", Accessory: item.subgroup, Selected: "yes",
      "Item Name": item.materialDescription, Size: item.type, Elevation: row.elevation,
      Total: row.qty, "Actual Qty": row.qty, "Zoho Item ID": item.priced ? item.id : "",
    }];
  });
}

/** Keep each cut piece editable, but purchase/export one quantity per item and elevation. */
function mergeAccessoryExportRows(rows: AccessoryExportRow[]): AccessoryExportRow[] {
  const grouped = new Map<string, AccessoryExportRow>();
  for (const row of rows) {
    const key = `${row.Elevation}\u0000${row["Zoho Item ID"] || row["Item Name"].trim().toUpperCase()}`;
    const previous = grouped.get(key);
    if (!previous) { grouped.set(key, { ...row }); continue; }
    const sum = (left: number | string, right: number | string): number | string =>
      typeof left === "number" && typeof right === "number" ? r3(left + right) : left === "" ? right : right === "" ? left : left;
    previous.Total = sum(previous.Total, row.Total);
    previous["Actual Qty"] = sum(previous["Actual Qty"], row["Actual Qty"]);
    if (row.Size && row.Size !== "Pcs" && row.Total !== "") previous.Size = previous.Size ? `${previous.Size} + ${row.Size}` : row.Size;
  }
  return [...grouped.values()];
}

/* --- Costing — rupee totals for the user; factors stay on /admin --- */

type CostDetail = {
  boardQuantityKey?: string;
  purchaseAreaSqft?: number;
  category: string;
  itemCode: string;
  item: string;
  specification: string;
  netQty: number;
  wastePct: number;
  billableQty: number;
  uom: "sqft" | "RMT" | "nos" | "set" | "gm" | "kg" | "ml";
  rate: number;
  amount: number;
  allocatedBillableQty?: number;
};
function laminateCostDetail(group: "Carcass" | "Drawer" | "Shutter" | "Visible side", sheetPrice: string, panelSqft: number, wastePct: number,
  face: "both" | "front" | "back" = "both"): CostDetail {
  const material = group === "Shutter" || group === "Visible side" ? "SHUTTER" : "CARCASS";
  const netQty = panelSqft * (face === "both" ? 2 : 1);
  const billableQty = quantityWithWaste(netQty, wastePct);
  const rate = laminateSqftRate(sheetPrice);
  return { category: `${group} laminate`, itemCode: `${material}-LAMINATE-0.8MM`, item: `${material} LAMINATE 0.8MM`,
    specification: `${face === "both" ? "Both faces" : face === "front" ? "Front face" : "Back face"} · ₹${Number(sheetPrice).toFixed(2)} per 32 sqft sheet`,
    netQty, wastePct, billableQty, uom: "sqft", rate, amount: billableQty * rate };
}
type LineCost = { label: string; code?: string; qty: number; unitCost: number; cost: number; details: CostDetail[] };
type CostingResult = { lines: LineCost[]; total: number; unpriced: string[]; purchases: PurchaseTotal[] };
type ChargeMode = "sqft" | "direct";
type NumericInput = number | "";
type ServiceCharge = { mode: ChargeMode; value: NumericInput };
type ProjectPricingInputs = {
  conversionPct: NumericInput;
  profitPct: NumericInput;
  transportation: ServiceCharge;
  installation: ServiceCharge;
  loading: ServiceCharge;
  includeTax: boolean;
  processingRates: Record<string, number>;
};

const PROCESSING_CATEGORIES = [
  "Carcass / shelf material", "Carcass back material", "Drawer material",
  "Shutter material", "Visible side material",
] as const;
type ProcessingCategory = typeof PROCESSING_CATEGORIES[number];
type ProcessingBoard = { category: ProcessingCategory; item: CostingMasterItem };
type ProcessingType = "Prelam" | "Postlam" | "PU" | "Membrane";
const PROCESSING_TYPES: ProcessingType[] = ["Prelam", "Postlam", "PU", "Membrane"];
const processingType = (item: CostingMasterItem): ProcessingType | undefined => {
  if (/^membrane/i.test(item.subgroup)) return "Membrane";
  if (/^pu\b/i.test(item.subgroup)) return "PU";
  if (/^postlam$/i.test(item.type)) return "Postlam";
  if (/^prelam$/i.test(item.type)) return "Prelam";
  return undefined;
};
const processingKey = (category: ProcessingCategory, type: ProcessingType) => `${category}|${type}`;
const processingRateFor = (rates: Record<string, number>, category: ProcessingCategory, item: CostingMasterItem): number => {
  const type = processingType(item);
  return (type ? rates[processingKey(category, type)] : undefined)
    ?? rates[`${category}|${item.id}`]
    ?? (type ? DEFAULT_BOARD_PROCESSING_RATES[processingKey(category, type)] : undefined)
    ?? 0;
};
const materialItemsForCategory = (category: ProcessingCategory): CostingMasterItem[] => {
  if (category === "Carcass / shelf material") return CARCASS_BOARD_ITEMS;
  if (category === "Carcass back material") return CARCASS_BACK_ITEMS;
  if (category === "Drawer material") return DRAWER_BOARD_ITEMS;
  return SHUTTER_BOARD_ITEMS.filter((item) => category !== "Visible side material" || [18, 25].includes(item.thicknessMm ?? 0));
};

function processingBoardForPanel(p: Panel, m: CarcassModel): ProcessingBoard | undefined {
  if (p.visibleSide) {
    const item = shutterMasterItem(p.materialId ?? m.visibleSideMaterialId);
    return item?.rateBasis === "SQFT" ? { category: "Visible side material", item } : undefined;
  }
  if (p.pack === "Shutter Pack") {
    if (/glass/i.test(p.mat ?? "")) return undefined;
    const item = shutterMasterItem(m.shType);
    return item?.rateBasis === "SQFT" ? { category: "Shutter material", item } : undefined;
  }
  if (/glass/i.test(p.mat ?? "")) return undefined;
  const item = carcassMasterItem(m.board, m.backBoardId, m.drawerBoardId, p);
  if (!item || item.rateBasis !== "SQFT") return undefined;
  const category = p.pack === "Drawer Pack" ? "Drawer material"
    : item.group === "Carcass Back Material" ? "Carcass back material" : "Carcass / shelf material";
  return { category, item };
}

function usedProcessingBoards(project: ProjectLine[]): ProcessingBoard[] {
  const found = new Map<string, ProcessingBoard>();
  project.forEach((line) => line.m.panels.forEach((panel) => {
    const board = processingBoardForPanel(panel, line.m);
    if (board) found.set(`${board.category}|${board.item.id}`, board);
  }));
  return PROCESSING_CATEGORIES.flatMap((category) => [...found.values()]
    .filter((board) => board.category === category)
    .sort((a, b) => a.item.id.localeCompare(b.item.id)));
}

function usedProcessingTypes(boards: ProcessingBoard[]): Array<{ category: ProcessingCategory; type: ProcessingType }> {
  return PROCESSING_CATEGORIES.flatMap((category) => PROCESSING_TYPES
    .filter((type) => boards.some((board) => board.category === category && processingType(board.item) === type))
    .map((type) => ({ category, type })));
}

function extraProcessingBoard(panel: Panel): ProcessingBoard | undefined {
  const carcass = panel.pack === "Carcass Pack";
  const item = carcass ? CARCASS_BOARD_ITEMS.find((candidate) => candidate.id === panel.materialId)
    : shutterMasterItem(panel.materialId ?? "");
  if (!item || item.rateBasis !== "SQFT" || /glass/i.test(panel.mat ?? "")) return undefined;
  return { category: carcass ? "Carcass / shelf material"
    : panel.extraMaterialRole === "visible" ? "Visible side material" : "Shutter material", item };
}

const DEFAULT_PROJECT_PRICING: ProjectPricingInputs = {
  conversionPct: "",
  profitPct: "",
  transportation: { mode: "direct", value: "" },
  installation: { mode: "direct", value: "" },
  loading: { mode: "direct", value: "" },
  includeTax: false,
  processingRates: {},
};

type ProjectRestore = {
  name?: string;
  project: ProjectLine[];
  fillers: FillerRow[];
  linkedFillerEdits?: LinkedFillerEdit[];
  visiblePanels: VisiblePanelRow[];
  countertops: CountertopRow[];
  accessories: AccessoryRow[];
  masterAccessories: MasterAccessoryRow[];
  linkedAccessoryEdits?: LinkedAccessoryEdit[];
  waste: WastePct;
  pricing: ProjectPricingInputs;
  rawSelections: Array<{ key: string; id: string; name: string; sku: string; stock_on_hand?: number }>;
  current?: { config: CabinetConfig; elevation: string; qty: number };
  hasSavedMaterialSnapshot?: boolean;
  notice: string;
};

const PROJECT_FILE_FORMAT = "wood-bom-project";
const MATERIAL_EDIT_DRAFT_KEY = "wood-bom-material-edit-draft";
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function cabinetConfig(model: CarcassModel): CabinetConfig {
  const { boardPrices, zk, fk, vid, hand, handle, handlePrice, handleBrand, board, backBoardId, drawerBoardId, shType, visibleSides, visibleSideMaterialId, carcassLamFrontSheetPrice, carcassLamBackSheetPrice, backLamFrontSheetPrice, backLamBackSheetPrice, drawerLamFrontSheetPrice, drawerLamBackSheetPrice, visibleLamFrontSheetPrice, visibleLamBackSheetPrice, shutterLamFrontSheetPrice, shutterLamBackSheetPrice, glassType, glassPricePerSqft, sinkStoneFullBack, edgeBand, hingeChoice, neon, W, H, D, shelfQty, fillerWidth, fillerSides, fillerWidthRH, blindOpeningWidth, spotLight, drawerModel, finish } = model;
  return { boardPrices, zk, fk, vid, hand, handle, handlePrice, handleBrand, board, backBoardId, drawerBoardId, shType, visibleSides, visibleSideMaterialId, carcassLamFrontSheetPrice, carcassLamBackSheetPrice, backLamFrontSheetPrice, backLamBackSheetPrice, drawerLamFrontSheetPrice, drawerLamBackSheetPrice, visibleLamFrontSheetPrice, visibleLamBackSheetPrice, shutterLamFrontSheetPrice, shutterLamBackSheetPrice, glassType, glassPricePerSqft, sinkStoneFullBack, edgeBand, hingeChoice, neon, W, H, D, shelfQty, fillerWidth, fillerSides, fillerWidthRH, blindOpeningWidth, spotLight, drawerModel, finish };
}

function projectSetupRows(data: Omit<ProjectRestore, "notice">): ProjectSetupRow[] {
  const row = (kind: string, value: unknown): ProjectSetupRow => ({ "Record Type": kind, Data: JSON.stringify(value) });
  return [
    row("format", { name: PROJECT_FILE_FORMAT, version: 2 }),
    row("settings", { name: data.name ?? "", waste: data.waste, pricing: data.pricing, current: data.current }),
    ...data.project.map((line) => row("cabinet", { id: line.id, config: cabinetConfig(line.m), qty: line.qty, elevation: line.elevation })),
    ...data.fillers.map((item) => row("filler", item)),
    ...(data.linkedFillerEdits ?? []).filter((item) => data.project.some((line) => line.id === item.linkedLineId)).map((item) => row("linked-filler-edit", item)),
    ...data.visiblePanels.map((item) => row("visible-panel", item)),
    ...data.countertops.map((item) => row("countertop", item)),
    ...data.accessories.map((item) => row("other-accessory", item)),
    ...data.masterAccessories.map((item) => row("accessory", item)),
    ...(data.linkedAccessoryEdits ?? []).filter((item) => data.project.some((line) => line.id === item.linkedLineId)).map((item) => row("linked-accessory-edit", item)),
    ...data.rawSelections.map((item) => row("raw-selection", item)),
  ];
}

function validatedCabinetConfig(value: unknown): CabinetConfig {
  if (!isRecord(value)) throw new Error("A cabinet configuration is missing.");
  const config = value as CabinetConfig;
  // Older exports could contain blind glass families. Convert them to the
  // corresponding solid family when restoring under the no-glass rule.
  if (config.zk === "WB" && config.fk === "WGL") config.fk = "WST";
  if (config.zk === "TB" && config.fk === "BLNG") config.fk = "BLND";
  if ((config.zk === "LB" || config.zk === "LBF") && config.fk === "LGL") config.fk = "LST";
  if (config.boardPrices !== undefined && (!isRecord(config.boardPrices) || Object.entries(config.boardPrices).some(([key, price]) => !MATERIAL_FIELDS.includes(key as typeof MATERIAL_FIELDS[number]) || !isRecord(price) || typeof price.itemId !== "string" || !COSTING_ITEMS.some(item => item.id === price.itemId) || !validBoardSheetPrice(price.sheetPrice) || (price.finish !== undefined && (typeof price.finish !== "string" || price.finish.length > 80)) || (price.slabSqft !== undefined && (price.itemId !== SINK_STONE_BOARD_ID || typeof price.slabSqft !== "string" || stoneSlabSqft(price.slabSqft) !== Number(price.slabSqft))) || [price.slabLengthMm, price.slabWidthMm].some((dimension) => dimension !== undefined && (price.itemId !== SINK_STONE_BOARD_ID || !validStoneDimension(dimension)))))) throw new Error("Invalid saved board price, finish, or slab area.");
  const family = typeof config.zk === "string" ? famSetOf(config.zk)[config.fk] : undefined;
  if (!ZONES[config.zk] || !family || !family.variants.some((variant: { id: string }) => variant.id === config.vid)) {
    throw new Error(`Unknown cabinet family or configuration: ${String(config.zk)} / ${String(config.fk)} / ${String(config.vid)}.`);
  }
  if (![config.W, config.H, config.D].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) {
    throw new Error("A cabinet has invalid width, height, or depth.");
  }
  if (config.shelfQty !== undefined && (!Number.isSafeInteger(config.shelfQty) || config.shelfQty < 0)) {
    throw new Error("A cabinet has an invalid shelf quantity.");
  }
  if (config.fillerWidth !== undefined && (!Number.isFinite(config.fillerWidth) || config.fillerWidth <= 0)) {
    throw new Error("A cabinet has an invalid filler width.");
  }
  if ((config.fillerSides !== undefined && !["LH", "RH", "BOTH"].includes(config.fillerSides)) ||
      (config.fillerWidthRH !== undefined && (!Number.isFinite(config.fillerWidthRH) || config.fillerWidthRH <= 0)) ||
      (config.fillerSides === "BOTH" && config.fillerWidthRH === undefined)) {
    throw new Error("A cabinet has an invalid filler side or RH width.");
  }
  if (config.blindOpeningWidth !== undefined && (typeof config.blindOpeningWidth !== "number" ||
      blindOpeningError(config.zk, config.W, config.blindOpeningWidth))) {
    throw new Error("A saved blind cabinet opening shutter width is outside the allowed range or leaves no fixed panel.");
  }
  if (config.spotLight !== undefined && typeof config.spotLight !== "boolean") throw new Error("A saved spot-light selection is invalid.");
  if (!(CARCASS_BOARD_ITEMS.some((item) => item.id === config.board) ||
      (config.zk === "WC" && ["WOP", "WGL"].includes(config.fk) && SHUTTER_BOARD_ITEMS.some((item) => item.id === config.board))) ||
      !SHUTTER_BOARD_ITEMS.some((item) => item.id === config.shType) ||
      (config.board === SINK_STONE_BOARD_ID && config.fk !== "SK")) {
    throw new Error("A saved cabinet material is not available in the current master.");
  }
  config.backBoardId = config.backBoardId ?? carcassBoardOf(config.board).backItem?.id ?? DEFAULT_BACK_ID;
  config.drawerBoardId = config.drawerBoardId ?? DEFAULT_DRAWER_ID;
  if (!CARCASS_BACK_ITEMS.some((item) => item.id === config.backBoardId) || !DRAWER_BOARD_ITEMS.some((item) => item.id === config.drawerBoardId)) {
    throw new Error("A saved cabinet back or drawer material is not available in the current master.");
  }
  config.visibleSides = config.visibleSides ?? "";
  config.visibleSideMaterialId = config.visibleSideMaterialId ?? MATERIAL_MASTER.visibleSideShutterMaterialId;
  if (!["", "LH", "RH", "BOTH"].includes(config.visibleSides) ||
      (config.visibleSides && !SHUTTER_BOARD_ITEMS.some((item) => item.id === config.visibleSideMaterialId && [18, 25].includes(item.thicknessMm ?? 0)))) {
    throw new Error("A saved visible-side setting is invalid.");
  }
  if (!GLASS_SHUTTER_ITEMS.some((item) => item.id === config.glassType) || !HINGE_CHOICES.includes(config.hingeChoice) || !DRAWER_MODELS.includes(config.drawerModel)) {
    throw new Error("A saved glass, hinge, or drawer option is not available.");
  }
  if (config.glassPricePerSqft !== undefined && (typeof config.glassPricePerSqft !== "string" || !validBoardSheetPrice(config.glassPricePerSqft)))
    throw new Error("Invalid saved glass shutter price.");
  if (config.sinkStoneFullBack !== undefined && typeof config.sinkStoneFullBack !== "boolean")
    throw new Error("Invalid saved stone sink back selection.");
  if (config.edgeBand !== undefined && !validEdgeBandChoice(config.edgeBand))
    throw new Error("Invalid saved edge-band finish or price.");
  if (!["LHS", "RHS"].includes(config.hand) || !["STD", ...HANDLE_TYPES].includes(config.handle as "STD" | typeof HANDLE_TYPES[number]) || config.neon !== "NEON50" || typeof config.finish !== "string" ||
      (config.handlePrice !== undefined && !validAccessoryManualRate(config.handlePrice)) ||
      (config.handleBrand !== undefined && typeof config.handleBrand !== "string")) {
    throw new Error("A saved cabinet setting is invalid.");
  }
  const laminateFields = ["carcassLamFrontSheetPrice", "carcassLamBackSheetPrice", "backLamFrontSheetPrice", "backLamBackSheetPrice", "drawerLamFrontSheetPrice", "drawerLamBackSheetPrice", "visibleLamFrontSheetPrice", "visibleLamBackSheetPrice", "shutterLamFrontSheetPrice", "shutterLamBackSheetPrice"] as const;
  for (const field of laminateFields) {
    const value = config[field] ?? "550"; // older project files did not save all laminate prices
    if (typeof value !== "string" || !isValidLaminatePrice(value)) throw new Error(`Invalid ${field} in a saved cabinet.`);
    config[field] = value;
  }
  if (!isGlassShutterFam(config.fk)) config.carcassLamBackSheetPrice = config.carcassLamFrontSheetPrice;
  config.backLamBackSheetPrice = config.backLamFrontSheetPrice;
  config.drawerLamBackSheetPrice = config.drawerLamFrontSheetPrice;
  return config;
}

function cabinetConfigWithSelectedMaterials(value: unknown, materials: KitchenMaterials): CabinetConfig {
  if (!isRecord(value)) throw new Error("A cabinet configuration is missing.");
  const zone = kitchenZoneForCode(String(value.zk ?? ""), String(value.fk ?? ""));
  const selected = materialChoicesForCabinet(materials, String(value.zk ?? ""), String(value.fk ?? "")) ?? materials[zone] ?? materials.Base;
  const handleChoice = handleSettingFor(materials, String(value.zk ?? ""), String(value.fk ?? ""));
  const specialGlass = String(value.zk ?? "") === "WC" && String(value.fk ?? "") === "WGL" ? materials._wallGlass?.glass : undefined;
  const carcassLaminate = carcassLaminateForCabinet(selected, isGlassShutterFam(String(value.fk ?? "")) && !materials._wallGlass);
  return {
    ...value,
    handle: handleChoice.type, handlePrice: handleChoice.price, handleBrand: handleChoice.brand,
    boardPrices: boardPricesFromMaterials(selected),
    board: selected.carcass.itemId,
    backBoardId: selected.back.itemId,
    drawerBoardId: selected.drawer.itemId,
    shType: selected.shutter.itemId,
    visibleSideMaterialId: selected.visible.itemId,
    glassType: specialGlass?.itemId ?? value.glassType,
    glassPricePerSqft: specialGlass?.pricePerSqft ?? value.glassPricePerSqft,
    sinkStoneFullBack: String(value.fk ?? "") === "SK" ? value.sinkStoneFullBack ?? materials._sinkStoneFullBack ?? true : value.sinkStoneFullBack,
    edgeBand: selected.edgeBand ?? value.edgeBand,
    hingeChoice: (materials._hingeChoice ?? value.hingeChoice) as HingeChoice,
    drawerModel: materials._drawerBrand ?? value.drawerModel,
    carcassLamFrontSheetPrice: carcassLaminate.front,
    carcassLamBackSheetPrice: carcassLaminate.back,
    backLamFrontSheetPrice: selected.back.frontSheetPrice,
    backLamBackSheetPrice: selected.back.frontSheetPrice,
    drawerLamFrontSheetPrice: selected.drawer.frontSheetPrice,
    drawerLamBackSheetPrice: selected.drawer.frontSheetPrice,
    shutterLamFrontSheetPrice: selected.shutter.frontSheetPrice,
    shutterLamBackSheetPrice: selected.shutter.backSheetPrice,
    visibleLamFrontSheetPrice: selected.visible.frontSheetPrice,
    visibleLamBackSheetPrice: selected.visible.backSheetPrice,
  } as CabinetConfig;
}

/** Older printed PDFs may not contain material fields introduced later. Keep
 * their cabinet geometry and accessories, replacing only unavailable choices. */
function compatiblePrintedCabinetConfig(value: unknown, materials?: KitchenMaterials): unknown {
  if (!isRecord(value)) return value;
  const zk = String(value.zk ?? "");
  const fk = String(value.fk ?? "");
  const specialWall = zk === "WC" && ["WOP", "WGL"].includes(fk);
  const selected = materialChoicesForCabinet(materials, zk, fk);
  const next: Record<string, unknown> = { ...value };
  const available = (items: CostingMasterItem[], id: unknown) => items.some((item) => item.id === id);
  if (!available(CARCASS_BOARD_ITEMS, next.board) && !(specialWall && available(SHUTTER_BOARD_ITEMS, next.board))) {
    const preferred = selected?.carcass.itemId;
    next.board = specialWall
      ? available(SHUTTER_BOARD_ITEMS, preferred) ? preferred : selected?.shutter.itemId ?? DEFAULT_SHTYPE
      : available(CARCASS_BOARD_ITEMS, preferred) ? preferred : DEFAULT_BOARD_ID;
  }
  if (!available(SHUTTER_BOARD_ITEMS, next.shType)) next.shType = selected?.shutter.itemId ?? DEFAULT_SHTYPE;
  if (!available(CARCASS_BACK_ITEMS, next.backBoardId)) next.backBoardId = selected?.back.itemId ?? DEFAULT_BACK_ID;
  if (!available(DRAWER_BOARD_ITEMS, next.drawerBoardId)) next.drawerBoardId = selected?.drawer.itemId ?? DEFAULT_DRAWER_ID;
  if (!available(SHUTTER_BOARD_ITEMS, next.visibleSideMaterialId)) next.visibleSideMaterialId = selected?.visible.itemId ?? MATERIAL_MASTER.visibleSideShutterMaterialId;
  if (!available(GLASS_SHUTTER_ITEMS, next.glassType)) next.glassType = materials?._wallGlass?.glass?.itemId ?? DEFAULT_GLASS_TYPE;
  if (!HINGE_CHOICES.includes(next.hingeChoice as HingeChoice)) next.hingeChoice = materials?._hingeChoice ?? HINGE_CHOICES[0];
  if (!DRAWER_MODELS.includes(String(next.drawerModel))) next.drawerModel = materials?._drawerBrand ?? DRAWER_MODELS[0];
  const laminateDefaults = {
    carcassLamFrontSheetPrice: selected?.carcass.frontSheetPrice, carcassLamBackSheetPrice: selected?.carcass.backSheetPrice,
    backLamFrontSheetPrice: selected?.back.frontSheetPrice, backLamBackSheetPrice: selected?.back.backSheetPrice,
    drawerLamFrontSheetPrice: selected?.drawer.frontSheetPrice, drawerLamBackSheetPrice: selected?.drawer.backSheetPrice,
    shutterLamFrontSheetPrice: selected?.shutter.frontSheetPrice, shutterLamBackSheetPrice: selected?.shutter.backSheetPrice,
    visibleLamFrontSheetPrice: selected?.visible.frontSheetPrice, visibleLamBackSheetPrice: selected?.visible.backSheetPrice,
  };
  for (const [field, fallback] of Object.entries(laminateDefaults)) {
    if (typeof next[field] !== "string" || !isValidLaminatePrice(next[field] as string)) next[field] = fallback && isValidLaminatePrice(fallback) ? fallback : "550";
  }
  if (next.boardPrices !== undefined && (!isRecord(next.boardPrices) || Object.entries(next.boardPrices).some(([field, price]) =>
    !MATERIAL_FIELDS.includes(field as typeof MATERIAL_FIELDS[number]) || !isRecord(price) || typeof price.itemId !== "string" || !validBoardSheetPrice(price.sheetPrice) || (price.finish !== undefined && (typeof price.finish !== "string" || price.finish.length > 80)) || (price.slabSqft !== undefined && (price.itemId !== SINK_STONE_BOARD_ID || typeof price.slabSqft !== "string" || stoneSlabSqft(price.slabSqft) !== Number(price.slabSqft))) || [price.slabLengthMm, price.slabWidthMm].some((dimension) => dimension !== undefined && (price.itemId !== SINK_STONE_BOARD_ID || !validStoneDimension(dimension)))))) {
    delete next.boardPrices;
  }
  if (next.edgeBand !== undefined && !validEdgeBandChoice(next.edgeBand)) next.edgeBand = selected?.edgeBand;
  return next;
}

function restoreProjectSetup(rows: Record<string, unknown>[], pdfMaterials?: KitchenMaterials, olderPrintedPdf = false): ProjectRestore {
  const records = rows.map((row) => ({ kind: String(row["Record Type"] ?? ""), data: JSON.parse(String(row.Data ?? "null")) as unknown }));
  const format = records.find((record) => record.kind === "format")?.data;
  if (!isRecord(format) || format.name !== PROJECT_FILE_FORMAT || ![1, 2].includes(Number(format.version))) throw new Error("Unsupported Project Setup format.");
  const settings = records.find((record) => record.kind === "settings")?.data;
  if (!isRecord(settings) || !isRecord(settings.waste) || !isRecord(settings.pricing)) throw new Error("Project settings are missing.");
  const waste = { ...WASTE, ...settings.waste } as WastePct;
  if (![waste.carcass, waste.shutter, waste.profile, waste.edgeBand].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 100)) throw new Error("Saved wastage settings must be below 100%.");
  const pricing = settings.pricing as ProjectPricingInputs;
  const validNumberInput = (value: unknown) => value === "" || (typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (![pricing.transportation, pricing.installation, pricing.loading].every((charge) => isRecord(charge) && ["direct", "sqft"].includes(charge.mode as string) && validNumberInput(charge.value)) ||
      !validNumberInput(pricing.conversionPct) || !validNumberInput(pricing.profitPct) || typeof pricing.includeTax !== "boolean") {
    throw new Error("Saved pricing settings are invalid.");
  }
  if (pricing.processingRates === undefined) pricing.processingRates = {};
  if (!isRecord(pricing.processingRates) || Object.entries(pricing.processingRates).some(([key, value]) =>
    (key !== "Counter Ply" && (!PROCESSING_CATEGORIES.some((category) => key.startsWith(`${category}|`)) ||
    ![...PROCESSING_TYPES, ...COSTING_ITEMS.filter((item) => item.rateBasis === "SQFT").map((item) => item.id)]
      .some((suffix) => key.endsWith(`|${suffix}`)))) ||
    typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000)) {
    throw new Error("Saved board processing rates are invalid.");
  }
  const savedCurrent = settings.current;
  const current = isRecord(savedCurrent)
    ? { config: validatedCabinetConfig(olderPrintedPdf ? compatiblePrintedCabinetConfig(savedCurrent.config, pdfMaterials)
      : pdfMaterials ? cabinetConfigWithSelectedMaterials(savedCurrent.config, pdfMaterials) : savedCurrent.config),
      elevation: String(savedCurrent.elevation ?? ""), qty: Number(savedCurrent.qty) }
    : undefined;
  if (current && (!Number.isFinite(current.qty) || current.qty < 1)) throw new Error("Saved current cabinet quantity is invalid.");
  const project = records.filter((record) => record.kind === "cabinet").map((record, index) => {
    if (!isRecord(record.data) || typeof record.data.qty !== "number" || record.data.qty < 1 || !Number.isFinite(record.data.qty)) throw new Error("A saved cabinet quantity is invalid.");
    const config = validatedCabinetConfig(olderPrintedPdf ? compatiblePrintedCabinetConfig(record.data.config, pdfMaterials)
      : pdfMaterials ? cabinetConfigWithSelectedMaterials(record.data.config, pdfMaterials) : record.data.config);
    return { id: typeof record.data.id === "number" && Number.isFinite(record.data.id) ? record.data.id : index + 1,
      m: buildModel(config), qty: record.data.qty, elevation: String(record.data.elevation ?? "") };
  });
  const linkedAccessoryEdits = records.filter((record) => record.kind === "linked-accessory-edit").map((record) => {
    const value = record.data;
    if (!isRecord(value) || typeof value.linkedLineId !== "number" || !Number.isFinite(value.linkedLineId) ||
        typeof value.sourceItemId !== "string" || !project.some((line) => line.id === value.linkedLineId) ||
        (value.qty !== undefined && (typeof value.qty !== "number" || !Number.isFinite(value.qty) || value.qty < 0)) ||
        (value.manualRate !== undefined && !validAccessoryManualRate(value.manualRate)) ||
        (value.itemId !== undefined && typeof value.itemId !== "string") ||
        (value.elevation !== undefined && typeof value.elevation !== "string") ||
        (value.disabled !== undefined && typeof value.disabled !== "boolean")) {
      throw new Error("A saved cabinet accessory edit is invalid.");
    }
    return value as unknown as LinkedAccessoryEdit;
  });
  const linkedFillerEdits = records.filter((record) => record.kind === "linked-filler-edit").map((record) => {
    const value = record.data;
    if (!isRecord(value) || typeof value.linkedLineId !== "number" || !project.some((line) => line.id === value.linkedLineId) ||
        (value.disabled !== undefined && typeof value.disabled !== "boolean") ||
        (value.fillerSide !== undefined && !["LH", "RH"].includes(String(value.fillerSide))) ||
        (value.fillerType !== undefined && !FILLER_TYPES.some((type) => type.value === value.fillerType)) ||
        (value.zone !== undefined && !FILLER_ZONES.includes(value.zone as (typeof FILLER_ZONES)[number])) ||
        (value.qty !== undefined && (!Number.isSafeInteger(value.qty) || (value.qty as number) < 1)) ||
        ["customShade", "customHeight", "customWidth", "customDepth", "elevation"].some((key) => value[key] !== undefined && typeof value[key] !== "string") ||
        ["customHeight", "customWidth", "customDepth"].some((key) => value[key] !== undefined && value[key] !== "" && !(Number(value[key]) > 0))) {
      throw new Error("A saved cabinet filler edit is invalid.");
    }
    return value as unknown as LinkedFillerEdit;
  });
  const values = <T extends { id: number; qty: number },>(kind: string): T[] => records.filter((record) => record.kind === kind).map((record) => {
    if (!isRecord(record.data)) throw new Error(`A ${kind} row is invalid.`);
    if (typeof record.data.id !== "number" || !Number.isFinite(record.data.id) || typeof record.data.qty !== "number" || !Number.isFinite(record.data.qty) ||
        record.data.qty < (kind === "other-accessory" && Number(format.version) === 1 ? 0 : 1)) {
      throw new Error(`A ${kind} row has an invalid id or quantity.`);
    }
    if (kind === "filler") {
      const type = record.data.fillerType ?? "filler";
      if (!FILLER_TYPES.some((choice) => choice.value === type) ||
          (record.data.customDepth !== undefined && record.data.customDepth !== "" &&
            !(Number(record.data.customDepth) > 0))) {
        throw new Error("A saved filler has an invalid type or depth.");
      }
    }
    if (kind === "accessory") {
      if (!validAccessoryManualRate(record.data.manualRate)) throw new Error("An accessory has an invalid manual price.");
      if (record.data.itemId === "CUSTOM") {
        if (typeof record.data.customName !== "string" || !record.data.customName.trim() ||
            !["PCS", "SET", "MTR"].includes(String(record.data.customUnit ?? "PCS")) ||
            (record.data.customBrand !== undefined && typeof record.data.customBrand !== "string")) {
          throw new Error("A custom accessory has an invalid name, unit, or brand.");
        }
      } else if (!MASTER_ACCESSORY_ITEMS.some((item) => item.id === String((record.data as Record<string, unknown>).itemId))) {
        throw new Error("A saved accessory is not available in the current catalog.");
      }
    }
    return record.data as T;
  });
  const rawSelections = records.filter((record) => record.kind === "raw-selection").map((record) => {
    if (!isRecord(record.data) || typeof record.data.key !== "string" || typeof record.data.id !== "string" || !record.data.id) {
      throw new Error("A saved raw material selection is invalid.");
    }
    return { key: record.data.key, id: record.data.id, name: String(record.data.name ?? ""), sku: String(record.data.sku ?? ""),
      stock_on_hand: typeof record.data.stock_on_hand === "number" ? record.data.stock_on_hand : undefined };
  });
  return {
    name: typeof settings.name === "string" ? settings.name : "",
    project, fillers: values<FillerRow>("filler"), linkedFillerEdits, visiblePanels: values<VisiblePanelRow>("visible-panel"),
    countertops: values<CountertopRow>("countertop"),
    accessories: values<AccessoryRow>("other-accessory").map((row) => restoreAccessoryRow(row, Number(format.version), project)),
    masterAccessories: values<MasterAccessoryRow>("accessory"), linkedAccessoryEdits, waste, pricing, rawSelections, current,
    hasSavedMaterialSnapshot: true,
    notice: `Imported ${project.length} cabinet line${project.length === 1 ? "" : "s"} with ${pdfMaterials ? "the kitchen materials and laminate prices selected before entering the Builder" : "saved materials"}, hardware choices, accessories, raw selections, and pricing settings.`,
  };
}

function restoreLegacyBom(rows: Record<string, unknown>[]): ProjectRestore {
  const cabinetRows = rows.filter((row) => Number(row.Level ?? row.level) === 0 && /^[A-Z]{2,3}-/.test(String(row.Item ?? row.itemName ?? "").trim()));
  if (!cabinetRows.length) throw new Error("No cabinet master rows were found in this BOM export.");
  const project = cabinetRows.map((row, index) => {
    const code = String(row.Item ?? row.itemName).trim();
    const parts = code.split("-");
    if (parts.length < 11) throw new Error(`Cabinet code is incomplete: ${code}`);
    const [zone, familyCode, handleToken, matToken] = parts;
    const W = Number(parts[7]), H = Number(parts[8]), D = Number(parts[9]);
    if (!ZONES[zone] || ![W, H, D].every((n) => Number.isFinite(n) && n > 0)) throw new Error(`Cannot read cabinet dimensions: ${code}`);
    const hand = parts.slice(5, 7).includes("RHS") ? "RHS" : "LHS";
    const rawFinish = parts.slice(11).join("-");
    const finish = (boardFinishesData as string[]).find((name) => name.toUpperCase() === rawFinish) ?? rawFinish;
    const shelfQty = ZONES[zone].kind === "wall" && /^\d+/.test(parts[4]) ? Number(parts[4].match(/^\d+/)?.[0]) : undefined;
    const solidBlindFamily = matToken === "GL" ? zone === "WB" ? "WST" : zone === "TB" ? "BLND" : zone === "LB" || zone === "LBF" ? "LST" : "" : "";
    const candidates = Object.entries(famSetOf(zone)).flatMap(([fk, family]: [string, any]) => {
      if (family.p2 !== familyCode || (isGlassShutterFam(fk) ? "GL" : fk === "SK" && matToken === "ST" ? "ST" : "WD") !== matToken) return [];
      return family.variants.map((variant: { id: string }) => ({ fk, vid: variant.id }));
    }).filter(({ fk, vid }) => {
      const family = famSetOf(zone)[fk];
      const variant = family.variants.find((candidate: { id: string }) => candidate.id === vid);
      const expectedP3 = shelfCodeToken(variant.p3 ?? "1SX", shelfQty ?? shelfCount(zone, fk, family, H), ZONES[zone].kind === "wall", isGlassShutterFam(fk));
      // Older wall exports used SG for wood shelves and 0SG for no shelf.
      // Preserve the original single/double choice while identifying a legacy
      // row; buildModel then applies today's >600 mm shutter rule.
      const observedP3 = ZONES[zone].kind === "wall" && matToken === "WD" && /^\d+SG$/.test(parts[4])
        ? shelfCodeToken(parts[4], shelfQty ?? 0, true, false) : parts[4];
      const expectedP4 = variant.p4 || (variant.handed ? hand : "XXX");
      const expectedP5 = variant.p5 || (variant.p4 && variant.handed ? hand : "XXX");
      const observedP4 = fk === "APP" && /^[12]HB$/.test(parts[5]) ? parts[5].replace("HB", "LB") : parts[5];
      return observedP3 === expectedP3 && observedP4 === expectedP4 && parts[6] === expectedP5;
    });
    if (candidates.length !== 1 && !solidBlindFamily) throw new Error(`Cannot uniquely identify cabinet ${code} from this older export. Please use a new Excel BOM with Project Setup.`);
    const selected = solidBlindFamily ? { fk: solidBlindFamily, vid: famSetOf(zone)[solidBlindFamily].variants[0].id } : candidates[0];
    const config: CabinetConfig = { zk: zone, ...selected, hand, handle: handleToken === "CJ" ? "XCJ" : handleToken === "NHX" ? "NONE" : "STD", board: matToken === "ST" ? SINK_STONE_BOARD_ID : DEFAULT_BOARD_ID, backBoardId: DEFAULT_BACK_ID, drawerBoardId: DEFAULT_DRAWER_ID, shType: DEFAULT_SHTYPE, visibleSides: "", visibleSideMaterialId: MATERIAL_MASTER.visibleSideShutterMaterialId, ...DEFAULT_LAMINATE_PRICES, backLamFrontSheetPrice: "550", backLamBackSheetPrice: "550", drawerLamFrontSheetPrice: "550", visibleLamFrontSheetPrice: "550", visibleLamBackSheetPrice: "550", glassType: DEFAULT_GLASS_TYPE, hingeChoice: HINGE_CHOICES[0], neon: "NEON50", W, H, D, shelfQty, drawerModel: DRAWER_MODELS[0], finish };
    const qty = Number(row["SO Qty"] ?? row.quantityNeeded ?? 1);
    if (!Number.isFinite(qty) || qty < 1) throw new Error(`Invalid cabinet quantity: ${code}`);
    return { id: index + 1, m: buildModel(config), qty, elevation: String(row.Elevation ?? "") };
  });
  return { project, fillers: [], visiblePanels: [], countertops: [], accessories: [], masterAccessories: [], waste: { ...WASTE },
    pricing: { ...DEFAULT_PROJECT_PRICING, transportation: { ...DEFAULT_PROJECT_PRICING.transportation },
      installation: { ...DEFAULT_PROJECT_PRICING.installation }, loading: { ...DEFAULT_PROJECT_PRICING.loading }, processingRates: {} }, rawSelections: [],
    notice: `Imported ${project.length} cabinet line${project.length === 1 ? "" : "s"} from an older BOM. That file did not save material, hinge, drawer, accessory, or pricing selections; review those before continuing.` };
}

/** Older costing exports have no Project Setup; recover only fields actually recorded in their detail sheets. */
function restoreCostingWorkbook(workbook: XLSX.WorkBook): ProjectRestore {
  const summarySheet = workbook.Sheets["Cabinet Summary"];
  const itemSheet = workbook.Sheets["Cabinet Items"];
  if (!summarySheet || !itemSheet) throw new Error("This is not a Wood Kitchen costing export (Cabinet Summary and Cabinet Items are required).");
  const summary = XLSX.utils.sheet_to_json<Record<string, unknown>>(summarySheet, { defval: "" });
  const items = XLSX.utils.sheet_to_json<Record<string, unknown>>(itemSheet, { defval: "" });
  const cabinetRows = summary.filter((row) => String(row["Cabinet code"] ?? "").trim());
  if (!cabinetRows.length) throw new Error("The costing workbook has no cabinet codes to restore.");
  const restored = restoreLegacyBom(cabinetRows.map((row) => ({
    Level: 0, Item: String(row["Cabinet code"]).trim(), "SO Qty": Number(row.Qty),
    Elevation: String(row["Cabinet / item"] ?? "").match(/^([A-Z]{2})\s*·/)?.[1] ?? "",
  })));
  const detailByCode = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const code = String(item["Cabinet code"] ?? "").trim();
    if (code) detailByCode.set(code, [...(detailByCode.get(code) ?? []), item]);
  }
  const purchaseRows = workbook.Sheets["Consolidated Items"]
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["Consolidated Items"], { defval: "" }) : [];
  const sheetPriceById = new Map(purchaseRows.filter((row) => row["Purchase unit"] === "sheet" || row["Purchase unit"] === "slab")
    .map((row) => [String(row["Item code"]), String(row["Purchase rate (Rs)"])]));
  const priceInSpec = (spec: unknown): string | undefined => String(spec ?? "").match(/₹\s*([\d,.]+)/)?.[1]?.replace(/,/g, "");
  const fieldForCategory: Record<string, { field: typeof MATERIAL_FIELDS[number]; key: "board" | "backBoardId" | "drawerBoardId" | "shType" | "visibleSideMaterialId" }> = {
    "Carcass board": { field: "carcass", key: "board" },
    "Carcass back board": { field: "back", key: "backBoardId" },
    "Drawer board": { field: "drawer", key: "drawerBoardId" },
    "Shutter board": { field: "shutter", key: "shType" },
    "Visible side board": { field: "visible", key: "visibleSideMaterialId" },
  };
  restored.project = restored.project.map((line, index) => {
    const detail = detailByCode.get(String(cabinetRows[index]["Cabinet code"]).trim()) ?? [];
    const config = cabinetConfig(line.m);
    const prices: BoardPriceOverrides = {};
    for (const item of detail) {
      const category = String(item.Category ?? "");
      const match = fieldForCategory[category];
      const id = String(item["Item code"] ?? "");
      if (match && COSTING_ITEMS.some((candidate) => candidate.id === id)) {
        config[match.key] = id;
        const sheetPrice = sheetPriceById.get(id);
        if (validBoardSheetPrice(sheetPrice)) prices[match.field] = { itemId: id, sheetPrice };
      }
      if (category === "Shutter glass" && GLASS_SHUTTER_ITEMS.some((candidate) => candidate.id === id)) config.glassType = id;
      if (category === "Drawer System" || category === "Drawer system") {
        const master = COSTING_ITEMS.find((candidate) => candidate.id === id);
        const brand = DRAWER_MODELS.find((candidate) => candidate.toLowerCase() === master?.brand.toLowerCase());
        if (brand) config.drawerModel = brand;
      }
    }
    config.boardPrices = prices;
    if (!detail.some((item) => item.Category === "Visible side board")) config.visibleSideMaterialId = config.shType;
    const laminatePriceFor = (category: string, face: "Front" | "Back", fallback: string): string => {
      const matches = detail.filter((item) => item.Category === category);
      const selected = matches.find((item) => new RegExp(`^${face} face`, "i").test(String(item.Specification ?? "")))
        ?? matches.find((item) => /Both faces/i.test(String(item.Specification ?? "")));
      return priceInSpec(selected?.Specification) ?? fallback;
    };
    config.carcassLamFrontSheetPrice = laminatePriceFor("Carcass laminate", "Front", config.carcassLamFrontSheetPrice);
    config.carcassLamBackSheetPrice = laminatePriceFor("Carcass laminate", "Back", config.carcassLamFrontSheetPrice);
    config.backLamFrontSheetPrice = laminatePriceFor("Carcass back laminate", "Front", config.carcassLamFrontSheetPrice);
    config.backLamBackSheetPrice = config.backLamFrontSheetPrice;
    config.drawerLamFrontSheetPrice = laminatePriceFor("Drawer laminate", "Front", config.drawerLamFrontSheetPrice);
    config.drawerLamBackSheetPrice = config.drawerLamFrontSheetPrice;
    config.shutterLamFrontSheetPrice = laminatePriceFor("Shutter laminate", "Front", config.shutterLamFrontSheetPrice);
    config.shutterLamBackSheetPrice = laminatePriceFor("Shutter laminate", "Back", config.shutterLamFrontSheetPrice);
    config.visibleLamFrontSheetPrice = laminatePriceFor("Visible side laminate", "Front", config.shutterLamFrontSheetPrice);
    config.visibleLamBackSheetPrice = laminatePriceFor("Visible side laminate", "Back", config.shutterLamBackSheetPrice);
    const hinge = detail.find((item) => item.Category === "Hardware" && COSTING_ITEMS.some((candidate) => candidate.id === item["Item code"] && candidate.group === "Hinge"));
    if (hinge) {
      const hingeItem = COSTING_ITEMS.find((candidate) => candidate.id === hinge["Item code"]);
      const choice = HINGE_CHOICES.find((candidate) => candidate.toLowerCase().startsWith(hingeItem?.brand.toLowerCase() ?? "\0") &&
        candidate.includes("Non Soft") === /WITHOUT|W\/OUT|NON SOFT/i.test(hingeItem?.type ?? ""));
      if (choice) config.hingeChoice = choice;
    }
    return { ...line, m: buildModel(validatedCabinetConfig(config)) };
  });
  let extraId = 1;
  for (const row of summary.filter((candidate) => !String(candidate["Cabinet code"] ?? "").trim())) {
    const label = String(row["Cabinet / item"] ?? "").trim();
    const qty = Number(row.Qty);
    if (!Number.isSafeInteger(qty) || qty < 1) continue;
    const filler = label.match(/^Panels- (?:SH|CR) (Filler|Chimney Panel|Dishwasher Panel)\s*(LH|RH)?\s*\d+mm\s+(\d+)x(\d+)$/i);
    if (filler) {
      const width = Number(filler[3]), height = Number(filler[4]);
      restored.fillers.push({ id: extraId++, fillerType: /chimney/i.test(filler[1]) ? "chimney-panel" : /dishwasher/i.test(filler[1]) ? "dishwasher-panel" : "filler",
        fillerSide: filler[2] === "LH" || filler[2] === "RH" ? filler[2] : undefined,
        zone: height >= 1800 ? "tall" : height >= 800 || /chimney/i.test(filler[1]) ? "wall" : "base",
        customShade: "", qty, customHeight: String(height), customWidth: String(width), elevation: "" });
      continue;
    }
    const counter = label.match(/^Counter Ply (.+?) (\d+)mm (\d+)x(\d+)$/i);
    if (counter) {
      const detail = items.find((item) => item["Cabinet / item"] === label && item.Category === "Counter Ply");
      restored.countertops.push({ id: extraId++, material: String(detail?.["Actual item"] ?? counter[1]),
        materialId: String(detail?.["Item code"] ?? ""), thickness: counter[2], length: counter[3], depth: counter[4], qty });
      continue;
    }
    const detail = items.find((item) => item["Cabinet / item"] === label && item.Category === "Accessory");
    if (detail) {
      const id = String(detail["Item code"] ?? "");
      const catalog = MASTER_ACCESSORY_ITEMS.find((item) => item.id === id);
      restored.masterAccessories.push({ id: extraId++, itemId: catalog?.id ?? "CUSTOM", qty,
        elevation: label.match(/^([A-Z]{2})\s*·/)?.[1] ?? "",
        ...(!catalog ? { customName: String(detail["Actual item"] ?? label), customUnit: "PCS" as const } : {}),
        ...(/manual rate/i.test(String(detail.Specification ?? "")) ? { manualRate: String(detail["Rate (Rs / basis)"] ?? "") } : {}),
      });
    }
  }
  const carcassWaste = items.find((item) => item.Category === "Carcass board")?.["Waste %"];
  const shutterWaste = items.find((item) => item.Category === "Shutter board")?.["Waste %"];
  if (typeof carcassWaste === "number") restored.waste.carcass = carcassWaste;
  if (typeof shutterWaste === "number") restored.waste.shutter = shutterWaste;
  const edgeBandWastePct = items.find((item) => ["Carcass edge band", "Shutter edge band", "Edge band"].includes(String(item.Category)))?.["Waste %"];
  if (typeof edgeBandWastePct === "number") restored.waste.edgeBand = edgeBandWastePct;
  const pricingSheet = workbook.Sheets["Project Pricing"];
  if (pricingSheet) {
    const pricingRows = XLSX.utils.sheet_to_json<(string | number)[]>(pricingSheet, { header: 1, defval: "" });
    const value = (name: string) => pricingRows.find((row) => row[0] === name)?.[1];
    const number = (name: string) => Number(value(name)) || 0;
    restored.pricing = {
      ...restored.pricing, conversionPct: number("Conversion (%)"), profitPct: number("Profit (%)"),
      transportation: { mode: value("Transportation method") === "sqft" ? "sqft" : "direct", value: number("Transportation rate / amount") },
      installation: { mode: value("Installation method") === "sqft" ? "sqft" : "direct", value: number("Installation rate / amount") },
      loading: { mode: value("Loading / Unloading method") === "sqft" ? "sqft" : "direct", value: number("Loading / Unloading rate / amount") },
      includeTax: number("Include GST (1=yes, 0=no)") === 1,
    };
  }
  const firstCell = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["Manual Comparison"], { header: 1, defval: "" })[0]?.[0];
  restored.name = String(firstCell ?? "").replace(/^KITCHEN COSTING\s*-\s*/i, "").trim();
  restored.hasSavedMaterialSnapshot = true;
  restored.notice = `Recovered ${restored.project.length} cabinet lines, ${restored.fillers.length} standalone panel rows, ${restored.countertops.length} Counter Ply rows, ${restored.masterAccessories.length} additional accessories, recorded board and laminate prices, and project pricing. This older costing export has no Project Setup: filler elevations and cabinet links, individual cutting-size edits for calculated handles/lights/skirting, and some cabinet-only options cannot be recovered. Review these before using the new costing.`;
  return restored;
}

/** Browser-printed projects predating the restore appendix expose only their visible tables. */
function restoreLegacyPrintedPdf(pages: string[], pdfMaterials?: KitchenMaterials): ProjectRestore {
  const linesPage = pages.find((page) => page.includes("Project lines\n"));
  const counterHeading = /(?:Countertop|Counter Ply) \+ add row/;
  const boardsPage = pages.find((page) => page.includes("Boards\n") && counterHeading.test(page));
  const accessoryPage = pages.find((page) => page.includes("Accessories + add row") && page.includes("Accessory lines (export preview)"));
  if (!linesPage || !boardsPage) {
    throw new Error("This PDF is not a recognized Wood Kitchen BOM project printout. Import its original Excel project file instead.");
  }
  const table = linesPage.split("Project lines\n")[1]?.split("Wastage %")[0]?.replace(/-\s*\n\s*/g, "-") ?? "";
  const codePattern = /^([A-Z]{2})\s+([A-Z]{2,3}-[A-Z0-9]+-(?:CJ|NHX|STD)-(?:WD|GL|ST)-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-\d+-\d+-\d+-\d+-[A-Z0-9]+)\b/gm;
  const matches = [...table.matchAll(codePattern)];
  if (!matches.length) throw new Error("No cabinet rows could be read from this printed PDF.");
  const cabinetRows = matches.map((match, index) => {
    const rest = table.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? table.length);
    const qty = Number(rest.match(/\b(\d+)\s+remove\b/)?.[1]);
    if (!Number.isInteger(qty) || qty < 1) throw new Error(`Could not read the quantity for ${match[2]}.`);
    return { Level: 0, Item: match[2], "SO Qty": qty, Elevation: match[1] };
  });
  const restored = restoreLegacyBom(cabinetRows);

  // The printed Boards table is an aggregate, not per-cabinet state. Apply the
  // sole visible choice in each group, then explicitly require user review.
  const boardTable = boardsPage.split("Boards\n")[1]?.split("Fillers + add row")[0]?.replace(/\s+/g, " ") ?? "";
  const materialInTable = (name: string) => boardTable.includes(name.replace(/\s+/g, " "));
  const boardChoices = pdfMaterials ? [] : CARCASS_BOARD_ITEMS.filter((item) => costingItemNames(item).some(materialInTable));
  const shutterMatches = pdfMaterials ? [] : SHUTTER_BOARD_ITEMS.filter((item) => costingItemNames(item).some(materialInTable));
  const shutterChoices = shutterMatches.filter((item) => !shutterMatches.some((other) =>
    other.id !== item.id && other.materialDescription.includes(item.materialDescription)));
  const glassChoices = GLASS_SHUTTER_ITEMS.filter((item) => costingItemNames(item).some(materialInTable));
  const allText = pages.join("\n");
  const hingeChoice = HINGE_CHOICES.find((choice) => allText.includes(choice));
  const drawerModel = DRAWER_MODELS.find((choice) => new RegExp(`DRAWER BOX SET ${choice}\\b`, "i").test(allText) ||
    COSTING_ITEMS.some((item) => item.group === "Drawer System" && item.brand.toLowerCase() === choice.toLowerCase() &&
      /(?:Low|High) Back/i.test(item.subgroup) && costingItemNames(item).some((name) => allText.includes(name))));
  restored.project = restored.project.map((line) => {
    const config = cabinetConfig(line.m);
    if (boardChoices.length === 1) config.board = boardChoices[0].id;
    if (shutterChoices.length === 1) config.shType = shutterChoices[0].id;
    if (glassChoices.length === 1) config.glassType = glassChoices[0].id;
    if (hingeChoice) config.hingeChoice = hingeChoice;
    if (drawerModel) config.drawerModel = drawerModel;
    return { ...line, m: buildModel(config) };
  });

  const wasteMatch = boardsPage.match(/^carcass\s+(\d+(?:\.\d+)?)\s+shutter\s+(\d+(?:\.\d+)?)\s+profile\s+(\d+(?:\.\d+)?)/m);
  if (wasteMatch) restored.waste = { ...restored.waste, carcass: Number(wasteMatch[1]), shutter: Number(wasteMatch[2]), profile: Number(wasteMatch[3]) };
  const pricingText = allText.split("Project pricing factors")[1]?.split("Cabinet / item Billable sqft")[0] ?? "";
  const conversion = pricingText.match(/Conversion \(%\)\s*(\d+(?:\.\d+)?)/)?.[1];
  const profit = pricingText.match(/Profit \(%\)\s*(\d+(?:\.\d+)?)/)?.[1];
  if (conversion !== undefined) restored.pricing.conversionPct = Number(conversion);
  if (profit !== undefined) restored.pricing.profitPct = Number(profit);
  for (const [label, key] of [["Transportation", "transportation"], ["Installation", "installation"], ["Loading / Unloading", "loading"]] as const) {
    const section = pricingText.split(`${label}\n`)[1]?.split("\n")[0] ?? "";
    const value = section.match(/(Direct price|Per[- ]sqft|Per square foot)\s+(\d+(?:\.\d+)?)/i);
    if (value) restored.pricing[key] = { mode: /^Direct/i.test(value[1]) ? "direct" : "sqft", value: Number(value[2]) };
  }
  restored.pricing.includeTax = /GST \(18%\)(?![^\n]*not included)/.test(allText.split("Subtotal before tax")[1]?.split("Final project price")[0] ?? "")
    && !allText.includes("GST (18%) — not included");

  const visibleSection = boardsPage.split("Visible Panels + add row")[1]?.split(counterHeading)[0] ?? "";
  for (const match of visibleSection.matchAll(/(?:^|\n)(\d+)\s+Default\b[^\n]*?\s+(\d+)\s+(\d+)\s+([A-Z]{2})\s+×/g)) {
    restored.visiblePanels.push({ id: restored.visiblePanels.length + 1, zone: "base", customShade: "", qty: Number(match[1]),
      customHeight: match[2], customWidth: match[3], elevation: match[4],
      shutterType: pdfMaterials?.Base.shutter.itemId ?? shutterChoices[0]?.id ?? DEFAULT_SHTYPE });
  }
  const counterSection = boardsPage.split(counterHeading)[1]?.split("Other Accessories + add row")[0] ?? "";
  for (const match of counterSection.matchAll(/(?:^|\n)(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s+(\d+)\s+×/g)) {
    restored.countertops.push({ id: restored.countertops.length + 1, length: match[1], depth: match[2], thickness: match[3],
      material: match[4].trim(), qty: Number(match[5]), ratePerSqft: "" });
  }

  const otherSection = accessoryPage?.split("Accessories + add row")[0] ?? "";
  for (const match of otherSection.matchAll(/PVC Skirting Pr\s+(\d+(?:\.\d+)?)\s+(\d+)\s+([A-Z]{2})\s+(\d+)\s+(\d+)\s+—\s+×/g)) {
    restored.accessories.push(restoreAccessoryRow({ id: restored.accessories.length + 1, kind: "skirting", size: match[1], qty: Number(match[2]),
      elevation: match[3], straight: Number(match[4]), lconn: Number(match[5]), driver: "" }, 1, restored.project));
  }
  const masterSection = accessoryPage?.split("Accessories + add row")[1]?.split("Accessory lines (export preview)")[0] ?? "";
  for (const line of masterSection.split("\n")) {
    const item = MASTER_ACCESSORY_ITEMS.find((candidate) => line.startsWith(candidate.subgroup));
    if (!item) continue;
    const qty = Number(line.match(/\s(\d+)\s+(?:[A-Z]{2}\s+)?×$/)?.[1]);
    if (Number.isInteger(qty) && qty > 0) restored.masterAccessories.push({ id: restored.masterAccessories.length + 1, itemId: item.id, qty,
      elevation: line.match(/\s([A-Z]{2})\s+×$/)?.[1] ?? "" });
  }
  const displayedCode = linesPage.split("Project lines\n")[0].match(/[A-Z]{2,3}-[A-Z0-9]+-(?:CJ|NHX|STD)-(?:WD|GL|ST)-[A-Z0-9-]+-\d+-\d+-\d+-\d+-[A-Z0-9]+/)?.[0];
  const displayedLine = restored.project.find((line) => line.m.code === displayedCode);
  if (displayedLine) restored.current = { config: cabinetConfig(displayedLine.m), elevation: displayedLine.elevation, qty: displayedLine.qty };
  if (pdfMaterials) {
    restored.project = restored.project.map((line) => ({ ...line, m: buildModel(cabinetConfigWithSelectedMaterials(cabinetConfig(line.m), pdfMaterials)) }));
    if (restored.current) restored.current.config = cabinetConfigWithSelectedMaterials(restored.current.config, pdfMaterials);
  }
  restored.notice = `Imported ${restored.project.length} cabinets, ${restored.visiblePanels.length} visible panel(s), ${restored.countertops.length} Counter Ply row(s), ${restored.accessories.length} skirting row(s), and ${restored.masterAccessories.length} accessory item(s) from this older print. ${pdfMaterials ? "Cabinet materials and laminate prices came from the kitchen selection made before entering the Builder; glass, hinge and drawer hardware choices were inferred from the print." : "Board, shutter, glass, hinge and drawer choices were inferred from project-wide tables; verify each cabinet."} Visible-panel zone was not printed and is set to base. Counter Ply rates, raw-material selections, and any hidden settings were not in the PDF and need review.`;
  return restored;
}

async function readProjectFile(file: File, pdfMaterials?: KitchenMaterials): Promise<ProjectRestore> {
  if (file.size > 10_000_000) throw new Error("The selected file is too large (maximum 10 MB).");
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const data = await readPrintedProjectPdf(file);
    if (isRecord(data) && Array.isArray(data.legacyPages)) {
      return restoreLegacyPrintedPdf(data.legacyPages as string[], pdfMaterials);
    }
    if (!Array.isArray(data)) throw new Error("This PDF does not contain valid project rows.");
    return restoreProjectSetup(data as Record<string, unknown>[], pdfMaterials, true);
  }
  if (file.name.toLowerCase().endsWith(".json")) {
    const data: unknown = JSON.parse(await file.text());
    if (Array.isArray(data)) return restoreLegacyBom(data as Record<string, unknown>[]);
    if (isRecord(data) && data.format === PROJECT_FILE_FORMAT && Array.isArray(data.rows)) return restoreProjectSetup(data.rows as Record<string, unknown>[]);
    throw new Error("This JSON file is not a Wood BOM project export.");
  }
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const setupSheet = workbook.Sheets["Project Setup"];
  if (setupSheet) return restoreProjectSetup(XLSX.utils.sheet_to_json<Record<string, unknown>>(setupSheet, { defval: "" }));
  if (workbook.Sheets["Cabinet Summary"] && workbook.Sheets["Cabinet Items"]) return restoreCostingWorkbook(workbook);
  const bomSheet = workbook.Sheets["Full BOM"] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!bomSheet) throw new Error("This file contains no BOM sheet.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(bomSheet, { defval: "" });
  if (rows.some((row) => typeof row["Cabinet Code"] === "string")) {
    const codes = [...new Set(rows.map((row) => String(row["Cabinet Code"] ?? "").trim()).filter(Boolean))];
    const restored = restoreLegacyBom(codes.map((code) => ({ Level: 0, Item: code, "SO Qty": 1 })));
    restored.notice += " Raw CSV does not contain cabinet quantities or elevation; each distinct code was restored once.";
    return restored;
  }
  return restoreLegacyBom(rows);
}

function edgeBandFieldForPanel(panel: Panel, board: string, backBoardId: string, drawerBoardId: string): MaterialField {
  if (panel.visibleSide || panel.extraMaterialRole === "visible") return "visible";
  if (panel.pack === "Shutter Pack") return "shutter";
  if (panel.pack === "Drawer Pack") return "drawer";
  return carcassMasterItem(board, backBoardId, drawerBoardId, panel)?.group === "Carcass Back Material" ? "back" : "carcass";
}

function carcassMasterItem(board: string, backBoardId: string, drawerBoardId: string, panel: Panel): CostingMasterItem | undefined {
  if (/glass/i.test(panel.mat ?? "")) return GLASS_SHELF_ITEM;
  if (panel.pack === "Drawer Pack") {
    return DRAWER_BOARD_ITEMS.find((item) => item.id === (panel.materialId ?? drawerBoardId));
  }
  const selected = carcassBoardOf(board, backBoardId);
  return selected.backItem && costingItemNames(selected.backItem).includes(panel.mat ?? "") && panel.t === selected.backCoreT ? selected.backItem : selected.item;
}

function shutterMasterItem(shutterType: string): CostingMasterItem | undefined {
  return SHUTTER_BOARD_ITEMS.find((item) => item.id === shutterType);
}

const hardwareNameKey = (value: string) => value.toUpperCase().replace(/\bXX\b/g, "").replace(/[^A-Z0-9]/g, "");
function hardwareMasterItem(name: string): CostingMasterItem | undefined {
  const key = hardwareNameKey(name);
  // Prefer Kitchen prices, then use the Hardware master for BOM components.
  const kitchenItems = [...COSTING_ITEMS.filter((item) => item.id.startsWith("KITCHEN-")), ...COSTING_ITEMS.filter((item) => item.id.startsWith("HARDWARE-"))];
  const exact = kitchenItems.find((item) => costingItemNames(item).some((name) => hardwareNameKey(name) === key));
  if (exact) return exact;
  const upper = name.toUpperCase();
  if (upper.includes("MINI FIX")) return kitchenItems.find((item) => item.subgroup === "Mini Fix");
  if (upper.includes("DOWEL")) return kitchenItems.find((item) => item.subgroup === "Dowel");
  if (upper.includes("PVC INSERT")) return kitchenItems.find((item) => item.subgroup === "PVC Insert");
  if (upper.includes("DOOR BUMPER") || upper.includes("PVC BUFFER")) return kitchenItems.find((item) => item.subgroup === "Buffer");
  if (upper.includes("END CONNECTOR")) return kitchenItems.find((item) => item.subgroup === "Profile Connector");
  if (upper.includes("LEG PVC")) return kitchenItems.find((item) => item.subgroup === "PVC Leg");
  if (upper.includes("SKIRTING CLIP")) return kitchenItems.find((item) => item.subgroup === "Skirting Clip");
  if (upper.includes("SCREW")) {
    const size = upper.match(/\b(16|25|30|75)\s*(?:X|MM)/)?.[1];
    return size ? kitchenItems.find((item) => item.subgroup === "Screw" && item.type.includes(size)) : undefined;
  }
  return undefined;
}

function profileMasterItem(profile: Profile, neon: string): CostingMasterItem | undefined {
  const exact = COSTING_ITEMS.find((item) => item.rateBasis === "MTR" && costingItemNames(item).some((name) => hardwareNameKey(name) === hardwareNameKey(profile.name)));
  if (exact || profile.type === "TOP") return exact;
  const profileName = NEON_LABEL[neon] ?? neon;
  const type = `${profileName} ${profile.type === "V" ? "Shutter" : "Handle"} Profile`;
  return COSTING_ITEMS.find((item) => item.group === "Profile" && item.type === type && item.rateBasis === "MTR");
}

function otherAccessoryMasterItem(name: string): CostingMasterItem | undefined {
  const exact = hardwareMasterItem(name);
  if (exact) return exact;
  const upper = name.toUpperCase();
  if (upper.includes("SKIRTING") && !upper.includes("CONNECTOR")) return COSTING_ITEMS.find((item) => item.id === "KITCHEN-092");
  if (upper.includes("ELENOR") || upper.includes("ALU PROF FOR LIGHT")) return COSTING_ITEMS.find((item) => item.id === "KITCHEN-084");
  if (upper.includes("DIFFUSER")) return COSTING_ITEMS.find((item) => item.id === "KITCHEN-085");
  if (upper.includes("LED LIGHT") || upper.includes("FLEXIBLE LED")) return COSTING_ITEMS.find((item) => item.id === "KITCHEN-086");
  if (upper.includes("EXTENSION WIRE")) return COSTING_ITEMS.find((item) => item.id === "KITCHEN-090");
  if (upper.includes("12V 2A 24W")) return COSTING_ITEMS.find((item) => item.id === "KITCHEN-089");
  if (upper.includes("12V 5A 60W")) return COSTING_ITEMS.find((item) => item.id === "KITCHEN-088");
  return undefined;
}

/**
 * Per the costing sheet: carcass sqft × board rate, shutter sqft × shutter-type
 * rate (each after its wastage %), edge band and profiles per running metre.
 * Drawer boxes, hinges and accessories are priced only once their rates are
 * set on /admin — until then they are listed as unpriced rather than silently
 * costed at zero.
 */
function computeCosting(
  project: ProjectLine[],
  fillers: FillerRow[], visiblePanels: VisiblePanelRow[],
  countertops: CountertopRow[],
  extrasPanels: Panel[],
  otherAccessories: AccessoryRow[],
  masterAccessories: MasterAccessoryRow[],
  globalShType: string, countertopShType: string, rates: CostingRates, wst: WastePct,
  processingRates: Record<string, number>,
  wholeProjectPurchases?: PurchaseTotal[],
  boardQuantityOverrides: Record<string, { sheets: number; netSqft: number }> = {},
): CostingResult {
  const lines: LineCost[] = [];
  const unpriced = new Set<string>();


  // Compatibility fallback for filler/visible-panel rows outside a cabinet.
  void rates;

  project.forEach((l) => {
    const m = l.m;
    const st = isGlassShutterFam(m.fk) ? "GLASS" : m.shType;
    const details: CostDetail[] = [];
    let currentBoardQuantityKey: string | undefined;
    const addDetail = (detail: CostDetail) => {
      if (/board$/i.test(detail.category)) detail.boardQuantityKey = currentBoardQuantityKey;
      const existing = details.find((row) => row.boardQuantityKey === detail.boardQuantityKey && row.category === detail.category && row.itemCode === detail.itemCode && row.item === detail.item && row.rate === detail.rate && row.wastePct === detail.wastePct);
      if (existing) {
        existing.netQty += detail.netQty;
        existing.billableQty += detail.billableQty;
        existing.amount += detail.amount;
      } else details.push(detail);
    };
    const addLaminateCost = (group: "Carcass" | "Drawer" | "Shutter" | "Visible side", frontPrice: string, backPrice: string,
      boardItem: CostingMasterItem, area: number, wastePct: number) => {
      if (!isValidLaminatePrice(frontPrice) || !isValidLaminatePrice(backPrice)) {
        unpriced.add(`${boardItem.id} laminate sheet price for ${m.code}`);
        return;
      }
      if (Number(frontPrice) === Number(backPrice)) addDetail(laminateCostDetail(group, frontPrice, area, wastePct));
      else {
        addDetail(laminateCostDetail(group, frontPrice, area, wastePct, "front"));
        addDetail(laminateCostDetail(group, backPrice, area, wastePct, "back"));
      }
    };
    m.panels.forEach((p) => {
      currentBoardQuantityKey = undefined;
      const a = sqft(p.w, p.h) * p.qty * l.qty;
      if (p.pack === "Shutter Pack" || p.visibleSide) {
        const panelShutterType = p.visibleSide ? (p.materialId ?? m.visibleSideMaterialId) : /glass/i.test(p.mat ?? "") ? "GLASS" : m.shType;
        const masterItem = panelShutterType === "GLASS" ? glassShutterItemOf(m.glassType) : shutterMasterItem(panelShutterType);
        if (!masterItem) { unpriced.add(`${shOf(panelShutterType).label} shutter board`); return; }
        const billed = quantityWithWaste(a, wst.shutter);
        const rate = panelShutterType === "GLASS" && m.zk === "WC" && m.fk === "WGL" &&
          m.glassPricePerSqft !== undefined ? Number(m.glassPricePerSqft)
          : selectedBoardRate(masterItem, m.boardPrices?.[p.visibleSide ? "visible" : "shutter"]);
        const boardFinish = selectedBoardFinish(masterItem.id, m.boardPrices?.[p.visibleSide ? "visible" : "shutter"], m.finish);
        currentBoardQuantityKey = boardCostKey(p.mat ?? "Board", p.t ?? T, boardFinish, rate);
        addDetail({ category: p.visibleSide ? "Visible side board" : panelShutterType === "GLASS" ? "Shutter glass" : "Shutter board", itemCode: masterItem.id, item: panelShutterType === "GLASS" ? masterItem.materialDescription : `${masterItem.materialDescription} · ${boardFinish}`, specification: `${masterItem.subgroup} · ${masterItem.thicknessMm ?? "—"}mm${p.visibleSide ? ` · ${p.drill ?? "side"}` : ""}${panelShutterType === "GLASS" ? "" : ` · ${boardFinish}`}`, netQty: a, wastePct: wst.shutter, billableQty: billed, uom: "sqft", rate, amount: billed * rate });
        if (isPostlamItem(masterItem)) {
          addLaminateCost(p.visibleSide ? "Visible side" : "Shutter",
            p.visibleSide ? m.visibleLamFrontSheetPrice : m.shutterLamFrontSheetPrice,
            p.visibleSide ? m.visibleLamBackSheetPrice : m.shutterLamBackSheetPrice, masterItem, a, wst.shutter);
        }
      } else {
        const masterItem = carcassMasterItem(m.board, m.backBoardId, m.drawerBoardId, p);
        if (!masterItem) { unpriced.add(`${p.mat ?? "Unknown"} ${p.t ?? ""}mm board`); return; }
        const boardWaste = boardWasteForPanel(p, m, wst);
        const billed = quantityWithWaste(a, boardWaste);
        const category = /glass/i.test(p.mat ?? "") ? "Glass shelf" : p.pack === "Drawer Pack" ? "Drawer board" : masterItem.group === "Carcass Back Material" ? "Carcass back board" : "Carcass board";
        const rate = selectedBoardRate(masterItem, m.boardPrices?.[category === "Drawer board" ? "drawer" : category === "Carcass back board" ? "back" : "carcass"]);
        const boardField = category === "Drawer board" ? "drawer" : category === "Carcass back board" ? "back" : "carcass";
        const boardFinish = selectedBoardFinish(masterItem.id, m.boardPrices?.[boardField], m.finish);
        const sheetAreaSqft = masterItem.id === SINK_STONE_BOARD_ID ? stoneSlabSqft(m.boardPrices?.carcass?.slabSqft) : 32;
        currentBoardQuantityKey = boardCostKey(p.mat ?? "Board", p.t ?? T, boardFinish, rate, sheetAreaSqft);
        addDetail({ category, itemCode: masterItem.id, item: category === "Glass shelf" ? masterItem.materialDescription : `${masterItem.materialDescription} · ${boardFinish}`, specification: `${masterItem.subgroup} · ${masterItem.thicknessMm ?? "—"}mm${category === "Glass shelf" ? "" : ` · ${boardFinish}`}`, netQty: a, wastePct: boardWaste, billableQty: billed, uom: "sqft", rate, amount: billed * rate,
          ...(masterItem.id === SINK_STONE_BOARD_ID ? { purchaseAreaSqft: sheetAreaSqft } : {}) });
        if (isPostlamItem(masterItem)) {
          const group = category === "Drawer board" ? "Drawer" : "Carcass";
          const frontPrice = category === "Drawer board" ? m.drawerLamFrontSheetPrice
            : category === "Carcass back board" ? m.backLamFrontSheetPrice : m.carcassLamFrontSheetPrice;
          const backPrice = category === "Carcass board" ? m.carcassLamBackSheetPrice : frontPrice;
          addLaminateCost(group, frontPrice, backPrice, masterItem, a, boardWaste);
        }
      }
      const processingBoard = processingBoardForPanel(p, m);
      if (processingBoard) {
        const rate = processingRateFor(processingRates, processingBoard.category, processingBoard.item);
        if (rate > 0) {
          const wastePct = boardWasteForPanel(p, m, wst);
          const billed = billableBoardSqft(p, l.qty, wst, m);
          addDetail({ category: `${processingBoard.category} processing`, itemCode: `${processingBoard.item.id}-PROC`,
            item: processingBoard.item.materialDescription, specification: "Processing cost per billable board sqft",
            netQty: a, wastePct, billableQty: billed, uom: "sqft", rate, amount: billed * rate });
        }
      }
    });
    m.panels.filter((panel) => panel.band).forEach((panel) => {
      const field = edgeBandFieldForPanel(panel, m.board, m.backBoardId, m.drawerBoardId);
      const shutter = field === "shutter" || field === "visible";
      const master = findCostingItem({ group: "Edge Band", subgroup: shutter ? "Shutter" : "Carcass", rateBasis: "MTR" });
      if (!master) return;
      const bandM = perim(panel.w, panel.h) * panel.qty * l.qty;
      const billed = quantityWithWaste(bandM, edgeBandWaste(wst));
      const selection = edgeBandForMaterial(m.edgeBand, field);
      const rate = Number(selection.pricePerRmt);
      addDetail({ category: shutter ? "Shutter edge band" : "Carcass edge band", itemCode: master.id, item: `${master.materialDescription} · ${selection.finish}`, specification: `${field} · ${master.thicknessMm ?? "—"}mm · ${selection.finish}`, netQty: bandM, wastePct: edgeBandWaste(wst), billableQty: billed, uom: "RMT", rate, amount: billed * rate });
    });
    m.profiles.forEach((profile) => {
      const masterProfile = profileMasterItem(profile, m.neon);
      if (!masterProfile) unpriced.add(`${profile.name} (${profile.type})`);
      const netM = profile.len / 1000 * profile.qty * l.qty;
      const billedM = quantityWithWaste(netM, wst.profile);
      addDetail({
        category: "Profile",
        itemCode: masterProfile?.id ?? `UNPRICED-${hardwareNameKey(profile.name)}`,
        item: masterProfile?.materialDescription ?? profile.name,
        specification: `${masterProfile?.type ?? "Rate required — BOM profile"} · ${profile.orientation ?? (profile.type === "V" ? "vertical" : "horizontal")} · ${profile.len}mm × ${profile.qty} per cabinet`,
        netQty: netM,
        wastePct: wst.profile,
        billableQty: billedM,
        uom: "RMT",
        rate: masterProfile?.currentRate ?? 0,
        amount: billedM * (masterProfile?.currentRate ?? 0),
      });
    });
    m.hardware.flatMap(expandHardwarePack).forEach((h) => {
      if (/^HINGE\b/i.test(h.name)) {
        const hingeItem = hardwareMasterItem(h.name);
        const rate = hingeItem?.currentRate ?? 0;
        if (!hingeItem) unpriced.add(h.name);
        details.push({ category: "Hardware", itemCode: hingeItem?.id ?? `UNPRICED-${hardwareNameKey(h.name)}`, item: hingeItem?.materialDescription ?? h.name, specification: `${h.pack}${hingeItem ? "" : " · RATE REQUIRED"}`, netQty: h.qty * l.qty, wastePct: 0, billableQty: h.qty * l.qty, uom: "nos", rate, amount: h.qty * l.qty * rate });
        return;
      }
      if (/^DRAWER BOX SET/i.test(h.name)) {
        const family = famSetOf(m.zk)[m.fk];
        const variant = family?.variants?.find((candidate: any) => candidate.id === m.vid);
        const fullMix = family && variant ? drawerBreakdown(family, variant) : [{ cls: "HIGH" as DrawerClass, n: h.qty }];
        const classInName = / LOW BACK$/i.test(h.name) ? "LOW" : / HIGH BACK$/i.test(h.name) ? "HIGH" : null;
        const mix = classInName ? fullMix.filter(({ cls }) => cls === classInName) : fullMix;
        mix.forEach(({ cls, n }) => {
          const subgroup = cls === "LOW" ? "Low Back" : "High Back";
          const masterDrawer = drawerSystemItem(m.drawerModel, cls);
          const drawerRate = masterDrawer?.currentRate ?? 0;
          details.push({ category: "Drawer system", itemCode: masterDrawer?.id ?? "—", item: masterDrawer?.materialDescription ?? `${m.drawerModel} ${subgroup}`, specification: `${n} per cabinet · ${masterDrawer?.type ?? subgroup}${masterDrawer ? "" : " · RATE REQUIRED"}`, netQty: n * l.qty, wastePct: 0, billableQty: n * l.qty, uom: "set", rate: drawerRate, amount: n * l.qty * drawerRate });
          if (!masterDrawer) unpriced.add(`${m.drawerModel} drawer box sets (${cls === "LOW" ? "LB" : "HB"})`);
        });
        return;
      }
      const masterHardware = hardwareMasterItem(h.name);
      const rate = masterHardware?.currentRate ?? 0;
      if (!masterHardware) unpriced.add(h.name);
      addDetail({ category: masterHardware?.group ?? "Hardware", itemCode: masterHardware?.id ?? `UNPRICED-${hardwareNameKey(h.name)}`, item: masterHardware?.materialDescription ?? h.name, specification: h.pack, netQty: h.qty * l.qty, wastePct: 0, billableQty: h.qty * l.qty, uom: masterHardware?.rateBasis === "MTR" || /^(Mtr|RMT)$/i.test(h.uom) ? "RMT" : masterHardware?.rateBasis === "KG" ? "kg" : masterHardware?.rateBasis === "SET" ? "set" : "nos", rate, amount: h.qty * l.qty * rate });
    });
    // Board-face laminate and edge band already have detailed cost lines above.
    // Every remaining consumable must stay visible, even without a matching price.
    m.cons.filter((c) => !/^EDGE BAND /i.test(c.name) && !/^(CARCASS(?: FRONT| BACK)?|DRAWER|SHUTTER|VISIBLE SIDE) LAMINATE /i.test(c.name)).forEach((c) => {
      const item = COSTING_ITEMS.find((candidate) => costingItemNames(candidate).some((name) => hardwareNameKey(name) === hardwareNameKey(c.name)));
      const unit = c.uom.toLowerCase();
      const uom: CostDetail["uom"] = unit === "gm" ? "gm" : unit === "kg" ? "kg" : unit === "ml" ? "ml" : unit === "sqft" ? "sqft" : /^(rmt|mtr)$/.test(unit) ? "RMT" : unit === "set" ? "set" : "nos";
      const compatible = item && ((uom === "gm" || uom === "kg") ? item.rateBasis === "KG" : uom === "sqft" ? item.rateBasis === "SQFT" : uom === "RMT" ? item.rateBasis === "MTR" : uom === "set" ? item.rateBasis === "SET" : item.rateBasis === "PCS");
      const rate = compatible ? item.currentRate / (uom === "gm" ? 1000 : 1) : 0;
      if (!compatible) unpriced.add(`${c.name} (${c.uom} rate required)`);
      const netQty = c.qty * l.qty;
      addDetail({ category: "Consumable", itemCode: compatible ? item.id : `UNPRICED-${hardwareNameKey(c.name)}-${uom}`, item: c.name,
        specification: `${c.pack}${compatible ? "" : " · RATE REQUIRED"}`, netQty, wastePct: 0, billableQty: netQty, uom, rate, amount: netQty * rate });
    });
    const cost = details.reduce((sum, detail) => sum + detail.amount, 0);
    lines.push({ label: `${l.elevation} · ${m.code}`, code: m.code, qty: l.qty, unitCost: l.qty ? cost / l.qty : cost, cost, details });
  });

  // Cover-panel strips use carcass material; visible panels have their own board and laminate selection.
  // Every emitted extra panel carries its own material. A filler may emit one,
  // three, or five panels (cover panels); positional filler counts can
  // silently omit the final panels from costing while Raw Material includes them.
  extrasPanels.forEach((p) => {
    const st = p.materialId ?? globalShType;
    const isCarcassSide = p.pack === "Carcass Pack";
    const boardItem = isCarcassSide
      ? CARCASS_BOARD_ITEMS.find((item) => item.id === p.materialId)
      : shutterMasterItem(p.materialId ?? st);
    const rate = boardItem ? selectedBoardRate(boardItem, p.extraBoardPrice) : 0;
    const net = sqft(p.w, p.h) * p.qty;
    const boardWaste = isCarcassSide ? wst.carcass : wst.shutter;
    const billed = quantityWithWaste(net, boardWaste);
    const category = isCarcassSide ? "Carcass board" : p.extraMaterialRole === "visible" ? "Visible side board" : "Shutter board";
    const panelFinish = p.extraFinish ?? "White";
    const details: CostDetail[] = [{ category, itemCode: boardItem?.id ?? "—", item: `${boardItem?.materialDescription ?? p.mat ?? shOf(st).mat} · ${panelFinish}`, specification: `${boardItem?.subgroup ?? (isCarcassSide ? "Carcass" : shOf(st).label)} · ${boardItem?.thicknessMm ?? p.t ?? "—"}mm · ${panelFinish}`, netQty: net, wastePct: boardWaste, billableQty: billed, uom: "sqft", rate, amount: billed * rate }];
    details[0].boardQuantityKey = boardCostKey(p.mat ?? "Board", p.t ?? T, panelFinish, rate);
    if (isPostlamItem(boardItem)) {
      const laminate = isCarcassSide ? p.extraCarcassLaminate : p.extraLaminate;
      const frontPrice = laminate?.front;
      const backPrice = laminate?.back;
      if (!frontPrice || !backPrice || !isValidLaminatePrice(frontPrice) || !isValidLaminatePrice(backPrice)) unpriced.add(`${p.name} laminate sheet price`);
      else {
        const group = isCarcassSide ? "Carcass" : p.extraMaterialRole === "visible" ? "Visible side" : "Shutter";
        if (Number(frontPrice) === Number(backPrice)) details.push(laminateCostDetail(group, frontPrice, net, boardWaste));
        else details.push(laminateCostDetail(group, frontPrice, net, boardWaste, "front"),
          laminateCostDetail(group, backPrice, net, boardWaste, "back"));
      }
    }
    const extraBoard = extraProcessingBoard(p);
    if (extraBoard) {
      const processingRate = processingRateFor(processingRates, extraBoard.category, extraBoard.item);
      if (processingRate > 0) {
        const processingSqft = billableBoardSqft(p, 1, wst);
        details.push({ category: `${extraBoard.category} processing`, itemCode: `${extraBoard.item.id}-PROC`, item: extraBoard.item.materialDescription, specification: "Processing cost per billable board sqft", netQty: net, wastePct: boardWaste, billableQty: processingSqft, uom: "sqft", rate: processingRate, amount: processingSqft * processingRate });
      }
    }
    if (p.band) {
      const band = perim(p.w, p.h) * p.qty;
      const bandBilled = quantityWithWaste(band, edgeBandWaste(wst));
      const bandItem = findCostingItem({ group: "Edge Band", subgroup: isCarcassSide ? "Carcass" : "Shutter", rateBasis: "MTR" });
      const field = p.extraMaterialRole ?? (isCarcassSide ? "carcass" : "shutter");
      const selection = edgeBandForMaterial(p.extraEdgeBand, field);
      const bandRate = Number(selection.pricePerRmt);
      details.push({ category: "Edge band", itemCode: bandItem?.id ?? "—", item: `${bandItem?.materialDescription ?? `${isCarcassSide ? "Carcass" : "Shutter matching"} edge band`} · ${selection.finish}`, specification: `${field} · 0.8mm · ${selection.finish}`, netQty: band, wastePct: edgeBandWaste(wst), billableQty: bandBilled, uom: "RMT", rate: bandRate, amount: bandBilled * bandRate });
    }
    const cost = details.reduce((sum, detail) => sum + detail.amount, 0);
    lines.push({ label: `${p.name}`, qty: p.qty, unitCost: p.qty ? cost / p.qty : cost, cost, details });
  });

  countertops.forEach((countertop) => {
    const length = Number(countertop.length);
    const depth = Number(countertop.depth || 600);
    const selected = countertopMaterialItem(countertop, countertopShType);
    const thickness = counterPlyThickness(countertop, countertopShType);
    if (!(length > 0 && depth > 0 && thickness > 0)) {
      unpriced.add("Counter Ply (length, depth and thickness must be entered)");
      return;
    }
    const qty = Math.max(1, countertop.qty || 1);
    const netQty = counterPlyCostSqft(countertop);
    const rate = selected?.currentRate ?? Number(countertop.ratePerSqft);
    const material = selected?.materialDescription ?? (countertop.material.trim() || "Unspecified material");
    const label = `Counter Ply ${material} ${thickness}mm ${length}x${depth}`;
    const processingRate = processingRates["Counter Ply"] ?? DEFAULT_BOARD_PROCESSING_RATES["Counter Ply"];
    const processingDetail: CostDetail = {
      category: "Counter Ply processing", itemCode: `${selected?.id ?? `CT-${length}x${depth}x${thickness}`}-PROC`,
      item: material, specification: "Processing cost per Counter Ply material sqft",
      netQty, wastePct: 0, billableQty: netQty, uom: "sqft", rate: processingRate,
      amount: netQty * processingRate,
    };
    if ((!selected && !countertop.ratePerSqft) || !Number.isFinite(rate) || rate <= 0) {
      unpriced.add(`${label} (Counter Ply rate per sqft)`);
      lines.push({ label, qty, unitCost: processingDetail.amount / qty, cost: processingDetail.amount, details: [{ category: "Counter Ply", itemCode: selected?.id ?? "UNPRICED-COUNTER-PLY", item: material, specification: `${length}×${depth}×${thickness}mm · RATE REQUIRED`, netQty, wastePct: 0, billableQty: netQty, uom: "sqft", rate: 0, amount: 0 }, processingDetail] });
      return;
    }
    const amount = netQty * rate;
    lines.push({ label, qty, unitCost: (amount + processingDetail.amount) / qty, cost: amount + processingDetail.amount, details: [{
      category: "Counter Ply", itemCode: selected?.id ?? `CT-${length}x${depth}x${thickness}`,
      item: material, specification: `${selected?.subgroup ?? "Custom material"} · ${length}×${depth}×${thickness}mm · bought-in`,
      netQty, wastePct: 0, billableQty: netQty, uom: "sqft", rate, amount,
    }, processingDetail] });
  });

  const handleCostLines = new Map<string, LineCost>();
  otherAccessories.forEach((accessory) => {
    const details: CostDetail[] = [];
    const addAccessoryDetail = (name: string, specification: string, netQty: number, billableQty: number, uom: CostDetail["uom"], wastePct = 0) => {
      const item = otherAccessoryMasterItem(name);
      const rate = item?.currentRate ?? 0;
      if (!item) unpriced.add(name);
      details.push({
        category: "Other accessory",
        itemCode: item?.id ?? `UNPRICED-${hardwareNameKey(name)}`,
        item: item?.materialDescription ?? name,
        specification: `${specification}${item ? "" : " · RATE REQUIRED"}`,
        netQty,
        wastePct,
        billableQty,
        uom,
        rate,
        amount: billableQty * rate,
      });
    };
    if (accessory.kind === "skirting") {
      const netM = accessoryMeters(accessory);
      addAccessoryDetail("PVC SKIRTING PROFILE 100MM", `${accessory.size}m × ${accessory.qty} skirting pieces`, netM, quantityWithWaste(netM, SKIRT_WASTE * 100), "RMT", SKIRT_WASTE * 100);
      if (accessory.straight > 0) addAccessoryDetail("SKIRTING STRAIGHT CONNECTOR", "Straight connector", accessory.straight, accessory.straight, "nos");
      if (accessory.lconn > 0) addAccessoryDetail("SKIRTING L CONNECTOR", "L connector", accessory.lconn, accessory.lconn, "nos");
    } else if (accessory.kind === "c-handle" || accessory.kind === "j-handle") {
      const item = HANDLE_ITEMS[accessory.kind];
      const meters = accessoryMeters(accessory);
      addAccessoryDetail(item.materialDescription, `${accessory.size}m × ${accessory.qty} handle pieces`, meters, meters, "RMT");
      handleHardwareQuantities(accessory).forEach(({ item: hardware, qty }) =>
        addAccessoryDetail(hardware.materialDescription, `${qty} pcs for ${accessory.kind} handles`, qty, qty, "nos"));
    } else {
      const qty = accessory.qty;
      const netM = accessoryMeters(accessory);
      const billedM = netM;
      for (const item of [LIGHT_ITEMS.profile, LIGHT_ITEMS.diffuser, LIGHT_ITEMS.led]) {
        addAccessoryDetail(item.materialDescription, `${accessory.size}m × ${qty} light pieces`, netM, billedM, "RMT");
      }
      addAccessoryDetail(LIGHT_ITEMS.wire.materialDescription, "2m per set", 2 * qty, 2 * qty, "RMT");
      const driver = selectedDriver(accessory.driver);
      if (driver) addAccessoryDetail(driver.materialDescription, "Driver", qty, qty, "nos");
    }
    const cost = details.reduce((sum, detail) => sum + detail.amount, 0);
    const qty = accessory.qty;
    const label = `${accessory.elevation ? `${accessory.elevation} · ` : ""}${ACC_LABEL[accessory.kind]}`;
    if (accessory.kind === "c-handle" || accessory.kind === "j-handle") {
      const key = `${accessory.elevation}\u0000${accessory.kind}`;
      const previous = handleCostLines.get(key);
      if (previous) {
        previous.qty += qty;
        previous.cost += cost;
        previous.unitCost = previous.qty ? previous.cost / previous.qty : 0;
        details.forEach((detail) => {
          const matching = previous.details.find((saved) => saved.itemCode === detail.itemCode && saved.rate === detail.rate && saved.uom === detail.uom);
          if (!matching) { previous.details.push(detail); return; }
          matching.netQty += detail.netQty;
          matching.billableQty += detail.billableQty;
          matching.amount += detail.amount;
          if (detail.uom === "RMT") matching.specification += ` + ${detail.specification}`;
        });
      } else {
        const line = { label, qty, unitCost: qty ? cost / qty : cost, cost, details };
        handleCostLines.set(key, line);
        lines.push(line);
      }
    } else lines.push({ label, qty, unitCost: qty ? cost / qty : cost, cost, details });
  });

  const accessoryCostLines = new Map<string, LineCost>();
  masterAccessories.forEach((row) => {
    const item = selectedMasterAccessory(row);
    if (!item) return;
    const qty = item.rateBasis === "MTR" ? Math.max(0, row.qty || 0) : Math.max(1, row.qty || 1);
    const manualRate = row.manualRate?.trim() ?? "";
    const hasManualRate = manualRate !== "";
    const rate = hasManualRate ? Number(manualRate) : item.currentRate;
    const itemCode = row.itemId === "CUSTOM" ? "CUSTOM-ACCESSORY" : item.id;
    const invalidRate = (hasManualRate && (!Number.isFinite(rate) || rate < 0)) || (!hasManualRate && (!item.priced || !Number.isFinite(rate) || rate <= 0));
    const uom: CostDetail["uom"] = item.rateBasis === "SET" ? "set" : item.rateBasis === "MTR" ? "RMT" : "nos";
    const effectiveRate = invalidRate ? 0 : rate;
    const key = JSON.stringify([row.elevation, itemCode, item.materialDescription, uom, effectiveRate, invalidRate]);
    const previous = accessoryCostLines.get(key);
    if (previous) {
      previous.qty += qty;
      previous.details[0].netQty += qty;
      previous.details[0].billableQty += qty;
      previous.details[0].amount += qty * effectiveRate;
      previous.cost += qty * effectiveRate;
      return;
    }
    if (invalidRate) {
      unpriced.add(`${item.materialDescription} (reference accessory)`);
      const line: LineCost = { label: `${row.elevation ? `${row.elevation} · ` : ""}${item.materialDescription}`, qty, unitCost: 0, cost: 0, details: [{ category: "Accessory", itemCode, item: item.materialDescription, specification: `${item.subgroup} · RATE REQUIRED`, netQty: qty, wastePct: 0, billableQty: qty, uom, rate: 0, amount: 0 }] };
      accessoryCostLines.set(key, line);
      lines.push(line);
      return;
    }
    const amount = qty * rate;
    const line: LineCost = {
      label: `${row.elevation ? `${row.elevation} · ` : ""}${item.subgroup}`,
      qty, unitCost: rate, cost: amount,
      details: [{ category: "Accessory", itemCode, item: item.materialDescription, specification: `${item.subgroup}${item.brand ? ` · ${item.brand}` : ""}${hasManualRate ? " · manual rate" : " · Kitchen master rate"}`, netQty: qty, wastePct: 0, billableQty: qty, uom, rate, amount }],
    };
    accessoryCostLines.set(key, line);
    lines.push(line);
  });

  for (const line of lines) for (const detail of line.details) {
    if (!detail.boardQuantityKey || !/board$/i.test(detail.category)) continue;
    const override = boardQuantityOverrides[detail.boardQuantityKey];
    if (!override || !Number.isFinite(override.sheets) || override.sheets < 0 || override.netSqft <= 0) continue;
    const factor = override.sheets * (detail.purchaseAreaSqft ?? 32) / override.netSqft;
    detail.billableQty = detail.netQty * factor;
    detail.wastePct = factor > 0 ? (1 - 1 / factor) * 100 : 0;
    detail.amount = detail.billableQty * detail.rate;
  }
  const purchases = allocatePurchaseCosts(lines, wholeProjectPurchases);
  return { lines, total: lines.reduce((a, x) => a + x.cost, 0), unpriced: [...unpriced], purchases };
}

function kitchenCostingSnapshot(restored: ProjectRestore, materials: KitchenMaterials | undefined, rates: CostingRates,
  boardSheetInputs: Record<string, string> = {}): KitchenCostingSnapshot {
  const project = restored.project;
  const linkedFillers = cabinetFillers(project).map((filler) => ({
    ...filler, ...restored.linkedFillerEdits?.find((edit) => edit.linkedLineId === filler.linkedLineId && (edit.fillerSide ?? "LH") === filler.fillerSide),
  })).filter((filler) => !filler.disabled);
  const fillers = [...restored.fillers, ...linkedFillers];
  const linkedAccessories = cabinetAccessories(project, restored.linkedAccessoryEdits ?? []).filter((row) => !row.disabled);
  const masterAccessories = [...restored.masterAccessories, ...linkedAccessories];
  const edits = new Map(restored.accessories.filter((row) => row.automaticKey).map((row) => [row.automaticKey, row]));
  const calculated = calculatedAccessories(project, fillers).flatMap((row) => {
    const edit = edits.get(row.automaticKey);
    return edit?.disabled ? [] : [{ ...row, ...edit }];
  });
  const accessories = [...restored.accessories.filter((row) => !row.automaticKey), ...mergeJHandleRuns(calculated)];
  const shutterTypes = [...new Set(project.filter((line) => line.m.panels.some((panel) =>
    panel.pack === "Shutter Pack" && !/glass/i.test(panel.mat ?? ""))).map((line) => line.m.shType))];
  const shutterType = restored.current?.config.shType ?? materials?.Base.shutter.itemId ?? DEFAULT_SHTYPE;
  const counterShutterType = shutterTypes.length === 1 ? shutterTypes[0] : shutterType;
  const current = restored.current?.config ?? (project[0] ? cabinetConfig(project[0].m) : undefined);
  const finish = current?.finish ?? (boardFinishesData as string[])[0] ?? "White";
  const extras = buildExtrasBom(fillers, restored.visiblePanels, restored.countertops, project, "", shutterType, counterShutterType,
    finish, restored.waste, materials, current?.board ?? DEFAULT_BOARD_ID,
    { front: current?.shutterLamFrontSheetPrice ?? DEFAULT_LAMINATE_PRICES.shutterLamFrontSheetPrice,
      back: current?.shutterLamBackSheetPrice ?? DEFAULT_LAMINATE_PRICES.shutterLamBackSheetPrice },
    { itemId: current?.visibleSideMaterialId ?? MATERIAL_MASTER.visibleSideShutterMaterialId,
      front: current?.visibleLamFrontSheetPrice ?? "550", back: current?.visibleLamBackSheetPrice ?? "550" });
  const boardOverrides = Object.fromEntries(buildBoardTotals(project, restored.waste, extras.panels).flatMap((board) => {
    const key = board.key;
    const input = boardSheetInputs[key];
    return board.sheets !== null && input !== undefined && input.trim() !== "" && Number.isFinite(Number(input)) && Number(input) >= 0
      ? [[key, { sheets: roundQuantity(Number(input)), netSqft: board.sqft }]] : [];
  }));
  const costing = computeCosting(project, fillers, restored.visiblePanels, restored.countertops, extras.panels, accessories,
    masterAccessories, shutterType, counterShutterType, rates, restored.waste, restored.pricing.processingRates, undefined, boardOverrides);
  const cabinetArea = project.reduce((sum, line) => sum + sqft(line.m.W, cabinetAreaHeight(line.m.zk, line.m.H)) * line.qty, 0);
  let panelIndex = 0;
  const fillerArea = fillers.reduce((sum, filler) => {
    const panel = extras.panels[panelIndex];
    panelIndex += fillerPanelCount(filler);
    return sum + (panel ? sqft(panel.w, panel.h) * panel.qty : 0);
  }, 0);
  const counterArea = restored.countertops.reduce((sum, row) => {
    const length = Number(row.length);
    return sum + (length > 0 ? counterPlyAreaSqft(row, counterShutterType) : 0);
  }, 0);
  const areaSqft = cabinetArea + fillerArea + counterArea;
  const factor = restored.pricing;
  const conversion = costing.total * Number(factor.conversionPct || 0) / 100;
  const profit = (costing.total + conversion) * Number(factor.profitPct || 0) / 100;
  const charge = (value: ServiceCharge) => value.mode === "sqft" ? Number(value.value || 0) * areaSqft : Number(value.value || 0);
  const transportation = charge(factor.transportation);
  const installation = charge(factor.installation);
  const loading = charge(factor.loading);
  const subtotal = costing.total + conversion + profit + transportation + installation + loading;
  const tax = factor.includeTax ? subtotal * 0.18 : 0;
  return { areaSqft, materialCost: costing.total, conversion, profit, transportation, installation, loading,
    tax, total: subtotal + tax, unpriced: costing.unpriced,
    items: costing.purchases.map((item) => ({ category: item.categories.join(", "), itemCode: item.itemCode, item: item.item,
      unit: item.unit, quantity: item.quantity, rate: item.rate, amount: item.amount })) };
}

/* --- Full BOM → BomReportRow, so export.ts (xlsx) can consume it --- */

function toReportRows(rows: FullBomRow[]): BomReportRow[] {
  return rows.map((r) => ({
    sourceOrderId: "", sourceOrderNumber: r.SO, customerName: "",
    itemId: "", itemName: r.Item, sku: r.SKU || r.Item,
    groupName: r["Sub Group"], masterGroup: r["Main Group"],
    cfGroup: "", cfSubGroup: r["Sub Group"],
    cfHeight: r.Height, cfWidth: r.Width, cfDepth: r.Depth, cfThickness: r.Thickness,
    cfFinish: r.Finish, cfType: r["CF Type"],
    level: r.Level, quantityNeeded: r["SO Qty"], wastePercent: r["Waste %"],
    actualQuantity: r["Actual Qty"], rawStock: r["In Stock"],
    effectiveStock: r["Eff. Stock"], deficit: r.Deficit, unit: r.Unit,
    status: (["in-stock", "low-stock", "out-of-stock"].includes(r.Status) ? r.Status : "unknown") as BomReportRow["status"],
    rowType: (r._type === "master" || r._type === "sub_bom" || r._type === "component" ? r._type : "plain") as BomReportRow["rowType"],
    typeLabel: r.Level === 0 ? "ITEM" : r._type === "sub_bom" ? "SUB-BOM" : "COMPONENT",
    underProfile: false,
  }));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function WoodBomBuilder({ soMode = false, planningMode = false, materials: selectedMaterials }: { soMode?: boolean; planningMode?: boolean; materials?: KitchenMaterials } = {}) {
  const railRef = useRef<HTMLElement>(null);
  const pdfImportRef = useRef<HTMLInputElement>(null);
  const bulkPdfImportRef = useRef<HTMLInputElement>(null);
  const manualCostingImportRef = useRef<HTMLInputElement>(null);
  const materialDraftLoadedRef = useRef(false);
  const workspaceLoadedRef = useRef(false);
  const [materials, setMaterials] = useState(selectedMaterials);
  const [kitchens, setKitchens] = useState<KitchenWorkspaceEntry[]>([]);
  const [activeKitchen, setActiveKitchen] = useState("");
  const [kitchenName, setKitchenName] = useState("");
  const [manualCosting, setManualCosting] = useState<ManualCostingImport | null>(null);
  const [kitchenNameDraft, setKitchenNameDraft] = useState("");
  useEffect(() => { setKitchenNameDraft(kitchenName); }, [kitchenName]);
  const [kitchenBusy, setKitchenBusy] = useState(false);
  const [zk, setZk] = useState("BC");
  const [fk, setFk] = useState("SH");
  const [vid, setVid] = useState("single");
  const [hand, setHand] = useState("LHS");
  const [handle, setHandle] = useState<string>(() => handleSettingFor(materials, "BC").type);
  const [handlePrice, setHandlePrice] = useState(() => handleSettingFor(materials, "BC").price);
  const [handleBrand, setHandleBrand] = useState(() => handleSettingFor(materials, "BC").brand);
  const [boardPrices, setBoardPrices] = useState<BoardPriceOverrides>(() => boardPricesFromMaterials(materials?.Base));
  const [board, setBoard] = useState(materials?.Base.carcass.itemId ?? DEFAULT_BOARD_ID);
  const [backBoardId, setBackBoardId] = useState(materials?.Base.back.itemId ?? DEFAULT_BACK_ID);
  const [drawerBoardId, setDrawerBoardId] = useState(materials?.Base.drawer.itemId ?? DEFAULT_DRAWER_ID);
  const [shType, setShType] = useState(materials?.Base.shutter.itemId ?? DEFAULT_SHTYPE);
  const [visibleSides, setVisibleSides] = useState<VisibleSides>("");
  const [visibleSideMaterialId, setVisibleSideMaterialId] = useState(materials?.Base.visible.itemId ?? MATERIAL_MASTER.visibleSideShutterMaterialId);
  const [carcassLamFrontSheetPrice, setCarcassLamFrontSheetPrice] = useState(materials?.Base.carcass.frontSheetPrice ?? DEFAULT_LAMINATE_PRICES.carcassLamFrontSheetPrice);
  const [carcassLamBackSheetPrice, setCarcassLamBackSheetPrice] = useState(materials?.Base.carcass.backSheetPrice ?? DEFAULT_LAMINATE_PRICES.carcassLamBackSheetPrice);
  const [backLamFrontSheetPrice, setBackLamFrontSheetPrice] = useState(materials?.Base.back.frontSheetPrice ?? "550");
  const [backLamBackSheetPrice, setBackLamBackSheetPrice] = useState(materials?.Base.back.backSheetPrice ?? "550");
  const [drawerLamFrontSheetPrice, setDrawerLamFrontSheetPrice] = useState(materials?.Base.drawer.frontSheetPrice ?? "550");
  const [drawerLamBackSheetPrice, setDrawerLamBackSheetPrice] = useState(materials?.Base.drawer.backSheetPrice ?? "550");
  const [visibleLamFrontSheetPrice, setVisibleLamFrontSheetPrice] = useState(materials?.Base.visible.frontSheetPrice ?? "550");
  const [visibleLamBackSheetPrice, setVisibleLamBackSheetPrice] = useState(materials?.Base.visible.backSheetPrice ?? "550");
  const [shutterLamFrontSheetPrice, setShutterLamFrontSheetPrice] = useState(materials?.Base.shutter.frontSheetPrice ?? DEFAULT_LAMINATE_PRICES.shutterLamFrontSheetPrice);
  const [shutterLamBackSheetPrice, setShutterLamBackSheetPrice] = useState(materials?.Base.shutter.backSheetPrice ?? DEFAULT_LAMINATE_PRICES.shutterLamBackSheetPrice);
  const [glassType, setGlassType] = useState(DEFAULT_GLASS_TYPE);
  const [glassPricePerSqft, setGlassPricePerSqft] = useState<string | undefined>(materials?._wallGlass?.glass?.pricePerSqft);
  const [sinkStoneFullBack, setSinkStoneFullBack] = useState(materials?._sinkStoneFullBack ?? true);
  const [edgeBand, setEdgeBand] = useState<EdgeBandChoice>(() => materials?.Base.edgeBand ?? defaultEdgeBandChoice());
  const [hingeChoice, setHingeChoice] = useState<HingeChoice>((materials?._hingeChoice as HingeChoice | undefined) ?? "Hettich Soft Close");
  const [neon] = useState("NEON50");
  const [hingeLocked, setHingeLocked] = useState(false);
  const [drawerModel, setDrawerModel] = useState(materials?._drawerBrand ?? "Hettich");
  const [drawerLocked, setDrawerLocked] = useState(false);
  const [finish, setFinish] = useState((boardFinishesData as string[])[0] ?? "White");
  const [elevation, setElevation] = useState("AA");
  const [qty, setQty] = useState(1);
  const [W, setW] = useState(600);
  const [H, setH] = useState(720);
  const [D, setD] = useState(560);
  const [zoneHeights, setZoneHeights] = useState<Record<string, number>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fillerWidth, setFillerWidth] = useState<number | null>(null);
  const [fillerSides, setFillerSides] = useState<"LH" | "RH" | "BOTH">("LH");
  const [fillerWidthRH, setFillerWidthRH] = useState<number>(FILLER_DEF_W);
  const [blindOpeningWidth, setBlindOpeningWidth] = useState<number>(() => defaultBlindOpeningWidth("BC"));
  const [spotLight, setSpotLight] = useState(false);
  const [shelfOverride, setShelfOverride] = useState<number | null>(null);
  const [project, setProject] = useState<ProjectLine[]>([]);
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const [tab, setTab] = useState<"packets" | "raw" | "totals">("packets");
  const [selectedElevation, setSelectedElevation] = useState<string | null>(null);
  const [projectLineFilters, setProjectLineFilters] = useState<Record<string, string[]>>({});
  const [projectLineSort, setProjectLineSort] = useState<{ column: string; direction: "asc" | "desc" } | null>(null);
  const [selectedProjectLineIds, setSelectedProjectLineIds] = useState<number[]>([]);
  const [bulkHeightOpen, setBulkHeightOpen] = useState(false);
  const [bulkHeightInput, setBulkHeightInput] = useState("");

  useEffect(() => {
    if (project.length === 0) {
      setHingeLocked(false);
      setDrawerLocked(false);
    }
  }, [project.length]);

  /* --- new sections: fillers / visible panels / countertop / accessories --- */
  const [fillers, setFillers] = useState<FillerRow[]>([]);
  const [linkedFillerEdits, setLinkedFillerEdits] = useState<LinkedFillerEdit[]>([]);
  const [visiblePanels, setVisiblePanels] = useState<VisiblePanelRow[]>([]);
  const [countertops, setCountertops] = useState<CountertopRow[]>([]);
  const [accessories, setAccessories] = useState<AccessoryRow[]>([]);
  const [masterAccessories, setMasterAccessories] = useState<MasterAccessoryRow[]>([]);
  const [linkedAccessoryEdits, setLinkedAccessoryEdits] = useState<LinkedAccessoryEdit[]>([]);
  const [showRemovedFillers, setShowRemovedFillers] = useState(false);
  const [showRemovedAccessories, setShowRemovedAccessories] = useState(false);
  const linkedFillers = useMemo(() => cabinetFillers(project).map((filler) => ({
    ...filler, ...linkedFillerEdits.find((edit) => edit.linkedLineId === filler.linkedLineId && (edit.fillerSide ?? "LH") === filler.fillerSide),
  })), [project, linkedFillerEdits]);
  const displayedLinkedFillers = visibleSuggestedRows(linkedFillers, showRemovedFillers);
  const removedFillerCount = linkedFillers.length - visibleSuggestedRows(linkedFillers, false).length;
  const allFillers = useMemo(() => [...fillers, ...linkedFillers.filter((filler) => !filler.disabled)], [fillers, linkedFillers]);
  const automaticAccessories = useMemo(() => calculatedAccessories(project, allFillers), [project, allFillers]);
  const allAccessories = useMemo(() => {
    const manual = accessories.filter((row) => !row.automaticKey);
    const edited = new Map(accessories.filter((row) => row.automaticKey).map((row) => [row.automaticKey, row]));
    const calculated = automaticAccessories.flatMap((automatic) => {
      const override = edited.get(automatic.automaticKey);
      if (override?.disabled) return [];
      return [{ ...automatic, ...override }];
    });
    return [...manual, ...mergeJHandleRuns(calculated)];
  }, [accessories, automaticAccessories]);
  const linkedAccessories = useMemo(() => cabinetAccessories(project, linkedAccessoryEdits), [project, linkedAccessoryEdits]);
  const linkedAccessoryGroups = useMemo(() => groupLinkedAccessories(linkedAccessories), [linkedAccessories]);
  const automaticAccessoryGroups = groupedAutomaticAccessories(automaticAccessories, accessories);
  const displayedAutomaticAccessoryGroups = automaticAccessoryGroups
    .map((group) => visibleSuggestedRows(group.map(({ source, item, edited }) => ({ source, item, edited, disabled: item.disabled })), showRemovedAccessories))
    .filter((group) => group.length > 0);
  const displayedLinkedAccessoryGroups = linkedAccessoryGroups.filter((group) => showRemovedAccessories || group.some((row) => !row.disabled));
  const removedAccessoryCount = automaticAccessoryGroups.flat().filter(({ item }) => item.disabled).length
    + linkedAccessories.filter((row) => row.disabled).length;
  const allMasterAccessories = useMemo(() => [...masterAccessories, ...linkedAccessories.filter((row) => !row.disabled)], [masterAccessories, linkedAccessories]);
  const [waste, setWaste] = useState({ ...WASTE });
  const [boardSheetInputs, setBoardSheetInputs] = useState<Record<string, string>>({});
  const [projectPricingInputs, setProjectPricingInputs] = useState<ProjectPricingInputs>(DEFAULT_PROJECT_PRICING);
  const [pricingModalOpen, setPricingModalOpen] = useState(false);
  const [pricingAdminUnlocked, setPricingAdminUnlocked] = useState(false);
  const [pricingAdminPassword, setPricingAdminPassword] = useState("");
  const [pricingAdminError, setPricingAdminError] = useState("");
  const [pricingAdminChecking, setPricingAdminChecking] = useState(false);
  const [draftPricing, setDraftPricing] = useState<ProjectPricingInputs>(DEFAULT_PROJECT_PRICING);
  const [draftProcessingRates, setDraftProcessingRates] = useState<Record<string, string>>({});
  const [selectedProcessingTypes, setSelectedProcessingTypes] = useState<Partial<Record<ProcessingCategory, ProcessingType>>>({});
  const [replacementTypes, setReplacementTypes] = useState<Partial<Record<ProcessingCategory, ProcessingType>>>({});
  const [replacementItems, setReplacementItems] = useState<Partial<Record<ProcessingCategory, string>>>({});

  const nextIdOf = (list: { id: number }[]) => list.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const addFiller = () => setFillers((c) => [...c, { id: nextIdOf(c), fillerType: "filler", zone: "base", customShade: "", qty: 1, customHeight: "", customWidth: "", customDepth: "", elevation }]);
  const updFiller = (id: number, p: Partial<FillerRow>) => setFillers((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const rmFiller = (id: number) => setFillers((c) => c.filter((r) => r.id !== id));
  const updLinkedFiller = (source: FillerRow, change: Partial<LinkedFillerEdit>) => setLinkedFillerEdits((current) => {
    if (source.linkedLineId === undefined) return current;
    const existing = current.find((row) => row.linkedLineId === source.linkedLineId && (row.fillerSide ?? "LH") === source.fillerSide);
    return existing
      ? current.map((row) => row === existing ? { ...row, ...change } : row)
      : [...current, { linkedLineId: source.linkedLineId, fillerSide: source.fillerSide, ...change }];
  });
  const resetLinkedFiller = (source: FillerRow) => setLinkedFillerEdits((current) => current.filter((row) =>
    row.linkedLineId !== source.linkedLineId || (row.fillerSide ?? "LH") !== source.fillerSide));
  const addVp = () => setVisiblePanels((c) => [...c, { id: nextIdOf(c), zone: "base", customShade: "", qty: 1, customHeight: "", customWidth: "", elevation: "", shutterType: "" }]);
  const updVp = (id: number, p: Partial<VisiblePanelRow>) => setVisiblePanels((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const rmVp = (id: number) => setVisiblePanels((c) => c.filter((r) => r.id !== id));
  const addCt = () => setCountertops((c) => [...c, { id: nextIdOf(c), length: "", depth: "600", thickness: String(shutterMasterItem(shType)?.thicknessMm ?? ""), material: "", materialId: "", ratePerSqft: "", qty: 1 }]);
  const updCt = (id: number, p: Partial<CountertopRow>) => setCountertops((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const rmCt = (id: number) => setCountertops((c) => c.filter((r) => r.id !== id));
  const addAcc = () => setAccessories((c) => [...c, { id: nextIdOf(c), kind: "c-handle", size: "", qty: 1, elevation: "", straight: 0, lconn: 0, driver: "" }]);
  const updAcc = (id: number, p: Partial<AccessoryRow>) => setAccessories((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const updAutomaticAcc = (source: AccessoryRow, change: Partial<AccessoryRow>) => setAccessories((current) => {
    const existing = current.find((row) => row.automaticKey === source.automaticKey);
    return existing
      ? current.map((row) => row.id === existing.id ? { ...row, ...change } : row)
      : [...current, { ...source, ...change, id: nextIdOf(current) }];
  });
  const resetAutomaticAcc = (source: AccessoryRow) => setAccessories((current) => current.filter((row) => row.automaticKey !== source.automaticKey));
  const rmAcc = (id: number) => setAccessories((c) => c.filter((r) => r.id !== id));
  const addMasterAcc = () => setMasterAccessories((c) => [...c, { id: nextIdOf(c), itemId: MASTER_ACCESSORY_ITEMS[0]?.id ?? "", qty: 1, elevation: "", manualRate: "" }]);
  const updMasterAcc = (id: number, p: Partial<MasterAccessoryRow>) => setMasterAccessories((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const updLinkedAcc = (source: MasterAccessoryRow, change: Partial<LinkedAccessoryEdit>) => setLinkedAccessoryEdits((current) => {
    const linkedLineId = source.linkedLineId;
    const sourceItemId = source.sourceItemId;
    if (linkedLineId === undefined || !sourceItemId) return current;
    const existing = current.find((row) => row.linkedLineId === linkedLineId && row.sourceItemId === sourceItemId);
    return existing
      ? current.map((row) => row === existing ? { ...row, ...change } : row)
      : [...current, { linkedLineId, sourceItemId, ...change }];
  });
  const resetLinkedAcc = (source: MasterAccessoryRow) => setLinkedAccessoryEdits((current) =>
    current.filter((row) => row.linkedLineId !== source.linkedLineId || row.sourceItemId !== source.sourceItemId));
  const updLinkedAccGroup = (rows: MasterAccessoryRow[], change: Partial<LinkedAccessoryEdit>) => {
    rows.forEach((row) => updLinkedAcc(row, change));
  };
  const setLinkedAccGroupQty = (rows: MasterAccessoryRow[], value: number) => {
    if (!Number.isFinite(value) || value < 0 || rows.length === 0) return;
    const item = selectedMasterAccessory(rows[0]);
    const target = item?.rateBasis === "MTR" ? value : Math.trunc(value);
    const enabledCount = item?.rateBasis === "MTR" ? Math.min(rows.length, target > 0 ? 1 : 0) : Math.min(rows.length, target);
    rows.forEach((row, index) => updLinkedAcc(row, {
      disabled: index >= enabledCount,
      qty: index === 0 ? (item?.rateBasis === "MTR" ? target : Math.max(1, target - enabledCount + 1)) : 1,
    }));
  };
  const rmMasterAcc = (id: number) => setMasterAccessories((c) => c.filter((r) => r.id !== id));

  /* --- raw material selection + stock check (Zoho) --- */
  type RawState = { loading: boolean; error: string; items: Array<{ item_id: string; name?: string; sku?: string; stock_on_hand?: number }>; sel: string };
  const [rawMap, setRawMap] = useState<Record<string, RawState>>({});
  const [stockMap, setStockMap] = useState<Record<string, { stock: number | null; loading: boolean }>>({});
  const [stockRunning, setStockRunning] = useState(false);

  /* --- costing rates: derived from the bundled costing master JSON --- */
  const [rates, setRates] = useState<CostingRates>({ ...DEFAULT_RATES });
  useEffect(() => {
    fetch("/api/costing").then((r) => r.json())
      .then((d) => { if (d?.rates) setRates(d.rates); })
      .catch(() => {});
  }, []);

  const fams = useMemo(() => famSetOf(zk), [zk]);
  const fkSafe = fams[fk] ? fk : Object.keys(fams)[0];
  const fam = fams[fkSafe];
  const defaultShelfQty = shelfCount(zk, fkSafe, fam, H);
  const effectiveShelfQty = shelfOverride ?? defaultShelfQty;
  const v = fam.variants.find((x: any) => x.id === widthVariant(zk, fam, vid, W)) ?? fam.variants[0];
  const sizes = useMemo(() => defSizes(zk, fkSafe), [zk, fkSafe]);
  const isGlass = isGlassShutterFam(fkSafe);
  const drawerOnly = !!fam.drawers && !fam.fixedDpn && !(ZONES[zk].tall && fkSafe === "APP");
  const carcassPostlam = isPostlamItem(carcassBoardOf(board).item);
  const shutterPostlam = !fam.noShutter && !isGlass && isPostlamItem(SHUTTER_BOARD_ITEMS.find((item) => item.id === shType));
  const laminatePricesValid = (!carcassPostlam || (isValidLaminatePrice(carcassLamFrontSheetPrice) && isValidLaminatePrice(carcassLamBackSheetPrice)))
    && (!shutterPostlam || (isValidLaminatePrice(shutterLamFrontSheetPrice) && isValidLaminatePrice(shutterLamBackSheetPrice)))
    && [backLamFrontSheetPrice, backLamBackSheetPrice, drawerLamFrontSheetPrice, drawerLamBackSheetPrice, visibleLamFrontSheetPrice, visibleLamBackSheetPrice].every(isValidLaminatePrice);
  const accessoryWidthValid = fkSafe !== "BPO" || [150, 200, 300].includes(W);
  const stonePriceValid = board !== SINK_STONE_BOARD_ID || boardPrices.carcass?.itemId !== SINK_STONE_BOARD_ID ||
    (validBoardSheetPrice(boardPrices.carcass.sheetPrice) && (boardPrices.carcass.slabSqft === undefined ||
      stoneSlabSqft(boardPrices.carcass.slabSqft) === Number(boardPrices.carcass.slabSqft))) &&
      [boardPrices.carcass.slabLengthMm, boardPrices.carcass.slabWidthMm].every((dimension) => dimension === undefined || validStoneDimension(dimension));
  const glassPriceValid = !isGlass || glassPricePerSqft === undefined || validBoardSheetPrice(glassPricePerSqft);
  const edgeBandValid = validEdgeBandChoice(edgeBand);
  const openingWidthAlert = blindOpeningError(zk, W, blindOpeningWidth);

  const m = useMemo(
    () => buildModel({ boardPrices, zk, fk: fkSafe, vid: v.id, hand, handle, handlePrice, handleBrand, board, backBoardId, drawerBoardId, shType, visibleSides, visibleSideMaterialId, carcassLamFrontSheetPrice, carcassLamBackSheetPrice, backLamFrontSheetPrice, backLamBackSheetPrice, drawerLamFrontSheetPrice, drawerLamBackSheetPrice, visibleLamFrontSheetPrice, visibleLamBackSheetPrice, shutterLamFrontSheetPrice, shutterLamBackSheetPrice, glassType, glassPricePerSqft, sinkStoneFullBack, edgeBand, hingeChoice, neon, W, H, D, shelfQty: effectiveShelfQty, fillerWidth: fillerWidth ?? undefined, fillerSides: fillerWidth === null ? undefined : fillerSides, fillerWidthRH: fillerWidth !== null && fillerSides !== "LH" ? fillerWidthRH : undefined, blindOpeningWidth: ZONES[zk].blind ? blindOpeningWidth : undefined, spotLight, drawerModel, finish }),
    [boardPrices, zk, fkSafe, v.id, hand, handle, handlePrice, handleBrand, board, backBoardId, drawerBoardId, shType, visibleSides, visibleSideMaterialId, carcassLamFrontSheetPrice, carcassLamBackSheetPrice, backLamFrontSheetPrice, backLamBackSheetPrice, drawerLamFrontSheetPrice, drawerLamBackSheetPrice, visibleLamFrontSheetPrice, visibleLamBackSheetPrice, shutterLamFrontSheetPrice, shutterLamBackSheetPrice, glassType, glassPricePerSqft, sinkStoneFullBack, edgeBand, hingeChoice, neon, W, H, D, effectiveShelfQty, fillerWidth, fillerSides, fillerWidthRH, blindOpeningWidth, spotLight, drawerModel, finish],
  );

  const applyMaterialChoices = useCallback((chosen: ZoneMaterials | undefined, glassCabinet = false) => {
    if (chosen) {
      const carcassLaminate = carcassLaminateForCabinet(chosen, glassCabinet);
      setBoardPrices(boardPricesFromMaterials(chosen));
      setEdgeBand(chosen.edgeBand ?? defaultEdgeBandChoice());
      setBoard(chosen.carcass.itemId); setBackBoardId(chosen.back.itemId); setDrawerBoardId(chosen.drawer.itemId);
      setShType(chosen.shutter.itemId); setVisibleSideMaterialId(chosen.visible.itemId);
      setCarcassLamFrontSheetPrice(carcassLaminate.front); setCarcassLamBackSheetPrice(carcassLaminate.back);
      setBackLamFrontSheetPrice(chosen.back.frontSheetPrice); setBackLamBackSheetPrice(chosen.back.backSheetPrice);
      setDrawerLamFrontSheetPrice(chosen.drawer.frontSheetPrice); setDrawerLamBackSheetPrice(chosen.drawer.backSheetPrice);
      setVisibleLamFrontSheetPrice(chosen.visible.frontSheetPrice); setVisibleLamBackSheetPrice(chosen.visible.backSheetPrice);
      setShutterLamFrontSheetPrice(chosen.shutter.frontSheetPrice); setShutterLamBackSheetPrice(chosen.shutter.backSheetPrice);
    }
  }, []);

  const onZone = useCallback((z: string) => {
    setZk(z);
    const handleChoice = handleSettingFor(materials, z);
    setHandle(handleChoice.type); setHandlePrice(handleChoice.price); setHandleBrand(handleChoice.brand);
    setShelfOverride(null);
    const f = Object.keys(famSetOf(z))[0];
    applyMaterialChoices(materialChoicesForCabinet(materials, z, f), isGlassShutterFam(f) && !(z === "WC" && materials?._wallGlass));
    setGlassType(z === "WC" && f === "WGL" ? materials?._wallGlass?.glass?.itemId ?? DEFAULT_GLASS_TYPE : DEFAULT_GLASS_TYPE);
    setGlassPricePerSqft(z === "WC" && f === "WGL" ? materials?._wallGlass?.glass?.pricePerSqft : undefined);
    setSinkStoneFullBack(materials?._sinkStoneFullBack ?? true);
    setFk(f);
    setVid(famSetOf(z)[f].variants[0].id);
    const s = defSizes(z, f);
    setW(s.w[0]); setH(zoneHeights[z] ?? s.h[0]); setD(s.d);
    setFillerWidth(null); setFillerSides("LH"); setFillerWidthRH(FILLER_DEF_W);
    setBlindOpeningWidth(defaultBlindOpeningWidth(z));
    setSpotLight(false);
  }, [materials, applyMaterialChoices, zoneHeights]);

  const onFam = useCallback((f: string) => {
    const nextMaterialZone = kitchenZoneForCode(zk, f);
    const handleChoice = handleSettingFor(materials, zk, f);
    setHandle(handleChoice.type); setHandlePrice(handleChoice.price); setHandleBrand(handleChoice.brand);
    const nextChoices = materialChoicesForCabinet(materials, zk, f);
    if (nextMaterialZone !== kitchenZoneForCode(zk, fkSafe) || f === "WOP" || f === "WGL" || fkSafe === "WOP" || fkSafe === "WGL")
      applyMaterialChoices(nextChoices, isGlassShutterFam(f) && !(zk === "WC" && materials?._wallGlass));
    else if (nextChoices) {
      const laminate = carcassLaminateForCabinet(nextChoices, isGlassShutterFam(f));
      setCarcassLamFrontSheetPrice(laminate.front);
      setCarcassLamBackSheetPrice(laminate.back);
    }
    setFk(f);
    setGlassType(zk === "WC" && f === "WGL" ? materials?._wallGlass?.glass?.itemId ?? DEFAULT_GLASS_TYPE : DEFAULT_GLASS_TYPE);
    setGlassPricePerSqft(zk === "WC" && f === "WGL" ? materials?._wallGlass?.glass?.pricePerSqft : undefined);
    setSinkStoneFullBack(materials?._sinkStoneFullBack ?? true);
    setSpotLight(false);
    setShelfOverride(null);
    setVid(fams[f].variants[0].id);
    const s = defSizes(zk, f);
    setW(s.w[0]); setH(zoneHeights[zk] ?? H); setD(s.d);
    setFillerWidth(null); setFillerSides("LH"); setFillerWidthRH(FILLER_DEF_W);
  }, [zk, fkSafe, fams, materials, applyMaterialChoices, zoneHeights, H]);

  const onVariant = (nextId: string) => {
    const paired = fam.variants.some((option: any) => option.id === "single" || option.id === "sgl")
      && fam.variants.some((option: any) => option.id === "double" || option.id === "dbl");
    if (paired) {
      const nextIsDouble = nextId === "double" || nextId === "dbl";
      if (nextIsDouble && !isDoubleShutterWidth(W)) setW(601);
      if (!nextIsDouble && isDoubleShutterWidth(W)) setW(600);
    }
    setVid(nextId);
  };

  const onWidth = (nextWidth: number) => {
    setW(nextWidth);
    if (nextWidth > 0) setVid((current) => widthVariant(zk, fam, current, nextWidth));
  };

  const onHeight = (nextHeight: number) => {
    setH(nextHeight);
    if (nextHeight > 0) setZoneHeights((current) => ({ ...current, [zk]: nextHeight }));
    setShelfOverride(null);
  };

  const addLine = () => {
    if (!laminatePricesValid || !stonePriceValid || !glassPriceValid || !edgeBandValid || !accessoryWidthValid || openingWidthAlert || (fillerWidth !== null && (fillerWidth <= 0 || (fillerSides !== "LH" && fillerWidthRH <= 0)))) return;
    if (editingLineId !== null) {
      setProject((p) => p.map((line) => line.id === editingLineId ? { ...line, m, qty, elevation } : line));
      setEditingLineId(null);
    } else {
      setProject((p) => [...p, { id: Date.now() + Math.random(), m, qty, elevation }]);
    }
    if (!drawerOnly) setHingeLocked(true);
    if (fam.drawers) setDrawerLocked(true);
    setShelfOverride(null);
  };
  const loadConfig = (config: CabinetConfig) => {
    setBoardPrices(config.boardPrices ?? {});
    setZk(config.zk); setFk(config.fk);
    const loadedFamily = famSetOf(config.zk)[config.fk];
    setVid(loadedFamily ? widthVariant(config.zk, loadedFamily, config.vid, config.W) : config.vid);
    setHand(config.hand);
    setHandle(config.handle === "XCJ" && /^(WC|WB|LO|LB|MD)/.test(config.zk) ? "NONE" : config.handle);
    setHandlePrice(config.handlePrice ?? ""); setHandleBrand(config.handleBrand ?? ""); setBoard(config.board); setBackBoardId(config.backBoardId); setDrawerBoardId(config.drawerBoardId); setShType(config.shType);
    setVisibleSides(config.visibleSides); setVisibleSideMaterialId(config.visibleSideMaterialId);
    setCarcassLamFrontSheetPrice(config.carcassLamFrontSheetPrice);
    setCarcassLamBackSheetPrice(config.carcassLamBackSheetPrice);
    setBackLamFrontSheetPrice(config.backLamFrontSheetPrice); setBackLamBackSheetPrice(config.backLamBackSheetPrice);
    setDrawerLamFrontSheetPrice(config.drawerLamFrontSheetPrice); setDrawerLamBackSheetPrice(config.drawerLamBackSheetPrice);
    setVisibleLamFrontSheetPrice(config.visibleLamFrontSheetPrice); setVisibleLamBackSheetPrice(config.visibleLamBackSheetPrice);
    setShutterLamFrontSheetPrice(config.shutterLamFrontSheetPrice);
    setShutterLamBackSheetPrice(config.shutterLamBackSheetPrice);
    setGlassType(config.glassType); setGlassPricePerSqft(config.glassPricePerSqft); setSinkStoneFullBack(config.sinkStoneFullBack ?? true); setHingeChoice(config.hingeChoice);
    setEdgeBand(config.edgeBand ?? defaultEdgeBandChoice());
    setDrawerModel(config.drawerModel); setFinish(config.finish);
    setW(config.W); setH(config.H); setD(config.D); setShelfOverride(config.shelfQty ?? null);
    setFillerWidth(config.fillerWidth ?? null);
    setFillerSides(config.fillerSides ?? "LH");
    setFillerWidthRH(config.fillerWidthRH ?? config.fillerWidth ?? FILLER_DEF_W);
    setBlindOpeningWidth(config.blindOpeningWidth ?? defaultBlindOpeningWidth(config.zk));
    setSpotLight(!!config.spotLight);
    setZoneHeights((current) => ({ ...current, [config.zk]: config.H }));
  };
  const editLine = (line: ProjectLine) => {
    loadConfig(cabinetConfig(line.m));
    setElevation(line.elevation); setQty(line.qty); setEditingLineId(line.id);
    railRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const delLine = (id: number) => {
    if (editingLineId === id) { setEditingLineId(null); setShelfOverride(null); }
    setProject((p) => p.filter((x) => x.id !== id));
    setLinkedFillerEdits((current) => current.filter((row) => row.linkedLineId !== id));
    setLinkedAccessoryEdits((current) => current.filter((row) => row.linkedLineId !== id));
    setSelectedProjectLineIds((current) => current.filter((selectedId) => selectedId !== id));
  };

  const applyRestoredKitchen = (restored: ProjectRestore, boardInputs: Record<string, string> = {}) => {
    setProject(restored.project);
    setShowRemovedFillers(false); setShowRemovedAccessories(false);
    // Counter Ply is project-wide; a stale elevation filter would hide its processing on import.
    setSelectedElevation(null);
    setLinkedFillerEdits(restored.linkedFillerEdits ?? []);
    setSelectedProjectLineIds([]);
    setLinkedAccessoryEdits(restored.linkedAccessoryEdits ?? []);
    setBoardSheetInputs(boardInputs);
    setFillers(restored.fillers); setVisiblePanels(restored.visiblePanels);
    setCountertops(restored.countertops); setAccessories(restored.accessories);
    setMasterAccessories(restored.masterAccessories);
    setWaste(restored.waste); setProjectPricingInputs(restored.pricing);
    const current = restored.current ?? (restored.project[0] ? { config: cabinetConfig(restored.project[0].m), elevation: restored.project[0].elevation, qty: restored.project[0].qty } : undefined);
    if (current) { loadConfig(current.config); setElevation(current.elevation); setQty(current.qty); }
    setEditingLineId(null); setStockMap({});
    setRawMap(Object.fromEntries(restored.rawSelections.map((selection) => [selection.key, {
      loading: false, error: "", sel: selection.id,
      items: [{ item_id: selection.id, name: selection.name, sku: selection.sku, stock_on_hand: selection.stock_on_hand }],
    }])));
    setHingeLocked(restored.project.some((line) => !famSetOf(line.m.zk)[line.m.fk]?.drawers || !!famSetOf(line.m.zk)[line.m.fk]?.fixedDpn));
    setDrawerLocked(restored.project.some((line) => !!famSetOf(line.m.zk)[line.m.fk]?.drawers));
    setImportMessage(restored.notice);
    setTab("totals");
  };

  const importFile = async (file: File) => {
    setImportError(""); setImportMessage("");
    try {
      const restored = await readProjectFile(file, materials);
      if (/\.pdf$/i.test(file.name)) restored.name = kitchenNameFromPdfFilename(file.name);
      if (project.length > 0 && !window.confirm("Replace the current project with the imported file?")) return;
      if (restored.hasSavedMaterialSnapshot && restored.project.length) {
        const imported = materialsFromImportedCabinets(restored.project.map((line) => cabinetConfig(line.m)), materials);
        const response = await fetch("/api/kitchen-materials", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(imported.materials),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error ?? "Could not save the imported materials to the material selection page.");
        }
        window.sessionStorage.removeItem(MATERIAL_EDIT_DRAFT_KEY);
        setMaterials(imported.materials);
        restored.notice += " Recovered material choices are now filled in on Material Selection.";
        if (imported.conflictingZones.length) restored.notice += ` Cabinets in ${imported.conflictingZones.join(", ")} have different materials within the same zone. Their individual BOM choices were kept; Material Selection shows the first cabinet in each zone.`;
        if (imported.conflictingHandleZones.length) restored.notice += ` Cabinets in ${imported.conflictingHandleZones.join(", ")} have different handle settings within the same zone. Their individual BOM choices were kept; Material Selection shows the first cabinet in each zone.`;
        if (imported.conflictingHinges) restored.notice += " The imported cabinets have different hinge settings. Individual cabinet BOM choices were kept; Material Selection shows the first cabinet's hinges.";
        if (imported.conflictingDrawerBrands) restored.notice += " The imported cabinets have different drawer brands. Individual cabinet BOM choices were kept; Material Selection shows the first cabinet's drawer brand.";
      }
      applyRestoredKitchen(restored);
      setKitchenName(restored.name ?? "");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import this project file.");
    }
  };

  const countertopShutterType = useMemo(() => {
    const types = [...new Set(project.filter((line) => line.m.panels.some((panel) =>
      panel.pack === "Shutter Pack" && !/glass/i.test(panel.mat ?? ""))).map((line) => line.m.shType))];
    return types.length === 1 ? types[0] : shType;
  }, [project, shType]);
  const extras = useMemo(
    () => buildExtrasBom(allFillers, visiblePanels, countertops, project, soMode ? "SO" : "", shType, countertopShutterType, finish, waste, materials, board,
      { front: shutterLamFrontSheetPrice, back: shutterLamBackSheetPrice },
      { itemId: visibleSideMaterialId, front: visibleLamFrontSheetPrice, back: visibleLamBackSheetPrice }),
    [allFillers, visiblePanels, countertops, project, soMode, shType, countertopShutterType, finish, waste, materials, board,
      shutterLamFrontSheetPrice, shutterLamBackSheetPrice, visibleSideMaterialId, visibleLamFrontSheetPrice, visibleLamBackSheetPrice],
  );
  const boardTotals = useMemo(() => buildBoardTotals(project, waste, extras.panels), [project, waste, extras]);
  const boardQuantityOverrides = useMemo(() => Object.fromEntries(boardTotals.flatMap((b) => {
    const key = b.key;
    const value = boardSheetInputs[key];
    return b.sheets !== null && value !== undefined && value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0
      ? [[key, { sheets: roundQuantity(Number(value)), netSqft: b.sqft }]] : [];
  })), [boardTotals, boardSheetInputs]);
  const fullBom = useMemo(
    () => [...buildFullBomData(project, soMode ? "SO" : "", finish, waste), ...extras.rows],
    [project, soMode, finish, waste, extras],
  );
  const accessoryRows = useMemo(() => mergeAccessoryExportRows([
    ...buildAccessoryRows(allAccessories, project, soMode ? "SO" : ""),
    ...buildMasterAccessoryRows(allMasterAccessories, soMode ? "SO" : ""),
  ]), [allAccessories, allMasterAccessories, project, soMode]);
  const rawSelections = useMemo(() => Object.entries(rawMap).flatMap(([key, state]) => {
    if (!state.sel) return [];
    const item = state.items.find((candidate) => candidate.item_id === state.sel);
    return [{ key, id: state.sel, name: item?.name ?? "", sku: item?.sku ?? "", stock_on_hand: item?.stock_on_hand }];
  }), [rawMap]);
  const projectSetup = useMemo(() => projectSetupRows({
    name: kitchenName, project, fillers, linkedFillerEdits, visiblePanels, countertops, accessories, masterAccessories, linkedAccessoryEdits,
    waste, pricing: projectPricingInputs, rawSelections,
    current: W > 0 && H > 0 && D > 0 ? { config: cabinetConfig(m), elevation, qty } : undefined,
  }), [kitchenName, project, fillers, linkedFillerEdits, visiblePanels, countertops, accessories, masterAccessories, linkedAccessoryEdits, waste, projectPricingInputs, rawSelections, W, H, D, m, elevation, qty]);
  useEffect(() => {
    const saved = window.sessionStorage.getItem(MATERIAL_EDIT_DRAFT_KEY);
    if (!saved || !materials) return;
    materialDraftLoadedRef.current = true;
    try {
      const draft = JSON.parse(saved) as { rows?: ProjectSetupRow[]; editingLineIndex?: number; boardSheetInputs?: Record<string, string> };
      if (!Array.isArray(draft.rows)) throw new Error("Saved kitchen is incomplete.");
      const restored = restoreProjectSetup(draft.rows, materials);
      setProject(restored.project);
      setSelectedElevation(null);
      setLinkedFillerEdits(restored.linkedFillerEdits ?? []);
      setSelectedProjectLineIds([]);
      setLinkedAccessoryEdits(restored.linkedAccessoryEdits ?? []);
      setFillers(restored.fillers); setVisiblePanels(restored.visiblePanels);
      setCountertops(restored.countertops); setAccessories(restored.accessories);
      setMasterAccessories(restored.masterAccessories);
      setWaste(restored.waste); setProjectPricingInputs(restored.pricing);
      setBoardSheetInputs(draft.boardSheetInputs ?? {});
      setRawMap(Object.fromEntries(restored.rawSelections.map((selection) => [selection.key, {
        loading: false, error: "", sel: selection.id,
        items: [{ item_id: selection.id, name: selection.name, sku: selection.sku, stock_on_hand: selection.stock_on_hand }],
      }])));
      if (restored.current) {
        loadConfig(restored.current.config);
        setElevation(restored.current.elevation); setQty(restored.current.qty);
      }
      setEditingLineId(typeof draft.editingLineIndex === "number" ? restored.project[draft.editingLineIndex]?.id ?? null : null);
      setHingeLocked(restored.project.some((line) => !famSetOf(line.m.zk)[line.m.fk]?.drawers || !!famSetOf(line.m.zk)[line.m.fk]?.fixedDpn));
      setDrawerLocked(restored.project.some((line) => !!famSetOf(line.m.zk)[line.m.fk]?.drawers));
      setImportMessage("Kitchen preserved. Updated material selections and laminate prices have been applied to the existing cabinets.");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not restore the kitchen after editing materials.");
    } finally {
      window.sessionStorage.removeItem(MATERIAL_EDIT_DRAFT_KEY);
    }
  // Run once when returning from Material Selection; the draft is removed after restoration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materials]);
  useEffect(() => {
    if (workspaceLoadedRef.current) return;
    workspaceLoadedRef.current = true;
    const stored = readKitchenWorkspace();
    if (!stored.length) {
      const id = crypto.randomUUID();
      const first: KitchenWorkspaceEntry = { id, name: "", rows: projectSetup, materials };
      writeKitchenWorkspace([first]);
      setActiveKitchenId(id);
      setKitchens([first]); setActiveKitchen(id);
      return;
    }
    const id = activeKitchenId();
    const selected = stored.find((entry) => entry.id === id) ?? stored[0];
    setActiveKitchenId(selected.id);
    setKitchens(stored); setActiveKitchen(selected.id); setKitchenName(selected.name);
    setManualCosting(selected.manualCosting ?? null);
    if (!materialDraftLoadedRef.current) {
      try {
        if (selected.rows.length) applyRestoredKitchen(restoreProjectSetup(selected.rows), selected.boardSheetInputs ?? {});
        if (selected.materials) setMaterials(selected.materials);
      } catch (error) {
        setImportError(error instanceof Error ? error.message : "Could not restore this kitchen.");
      }
    }
  // Initialize the browser-local kitchen workspace only once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const printRestoreLines = useMemo(() => encodeProjectPrintData(projectSetup), [projectSetup]);
  const processingBoards = useMemo(() => usedProcessingBoards(project), [project]);
  const processingTypes = useMemo(() => usedProcessingTypes(processingBoards), [processingBoards]);
  const displayedProcessingTypes = PROCESSING_CATEGORIES.flatMap((category) => PROCESSING_TYPES
    .filter((type) => processingTypes.some((row) => row.category === category && row.type === type) || replacementTypes[category] === type)
    .map((type) => ({ category, type })));
  const costing = useMemo(
    () => computeCosting(project, allFillers, visiblePanels, countertops, extras.panels, allAccessories, allMasterAccessories, shType, countertopShutterType, rates, waste, projectPricingInputs.processingRates, undefined, boardQuantityOverrides),
    [project, allFillers, visiblePanels, countertops, extras, allAccessories, allMasterAccessories, shType, countertopShutterType, rates, waste, projectPricingInputs.processingRates, boardQuantityOverrides],
  );
  const projectPricing = useMemo(() => {
    const cabinetAreas = project.map((line) => {
      const eachSqft = sqft(line.m.W, cabinetAreaHeight(line.m.zk, line.m.H));
      return {
        label: `${line.elevation} · ${line.m.code}`,
        qty: line.qty,
        eachSqft,
        sqft: eachSqft * line.qty,
      };
    });
    const cabinetSqft = cabinetAreas.reduce((total, line) => total + line.sqft, 0);
    // Extras are emitted in filler order before visible panels. Only each
    // filler's front face counts toward project area; cover-panel strips stay
    // in the BOM and material cost but not in the service-charge area.
    let panelIndex = 0;
    const fillerAreaSlots = allFillers.flatMap((filler) => {
      const count = fillerPanelCount(filler);
      const panels = extras.panels.slice(panelIndex, panelIndex + count);
      panelIndex += count;
      return panels.map((panel, index) => {
        const eachSqft = index === 0 ? sqft(panel.w, panel.h) : 0;
        return { label: `${filler.elevation ? `${filler.elevation} · ` : ""}${panel.name}`, elevation: filler.elevation,
          qty: panel.qty, eachSqft, sqft: eachSqft * panel.qty, front: index === 0 };
      });
    });
    const fillerAreas = fillerAreaSlots.filter((line) => line.front);
    const fillerSqft = fillerAreas.reduce((total, line) => total + line.sqft, 0);
    const counterPlyAreas = countertops.flatMap((countertop) => {
      const length = Number(countertop.length);
      const depth = Number(countertop.depth || 600);
      const thickness = counterPlyThickness(countertop, countertopShutterType);
      if (!(length > 0 && depth > 0 && thickness > 0)) return [];
      const qty = Math.max(1, countertop.qty || 1);
      const eachSqft = counterPlyAreaSqft({ ...countertop, qty: 1 }, countertopShutterType);
      return [{ label: `Counter Ply ${length}×${depth}mm`, qty, eachSqft, sqft: eachSqft * qty }];
    });
    const counterPlySqft = counterPlyAreas.reduce((total, line) => total + line.sqft, 0);
    const totalSqft = cabinetSqft + fillerSqft + counterPlySqft;
    const serviceAmount = (charge: ServiceCharge) => charge.mode === "sqft"
      ? Number(charge.value || 0) * totalSqft
      : Number(charge.value || 0);
    const baseCost = costing.total;
    const conversionPct = Number(projectPricingInputs.conversionPct || 0);
    const profitPct = Number(projectPricingInputs.profitPct || 0);
    const conversion = baseCost * conversionPct / 100;
    const convertedCost = baseCost + conversion;
    const profit = convertedCost * profitPct / 100;
    const transportation = serviceAmount(projectPricingInputs.transportation);
    const installation = serviceAmount(projectPricingInputs.installation);
    const loading = serviceAmount(projectPricingInputs.loading);
    const subtotal = convertedCost + profit + transportation + installation + loading;
    const tax = projectPricingInputs.includeTax ? subtotal * 0.18 : 0;
    const allocate = (line: { label: string; qty: number; eachSqft: number; sqft: number }) => {
      const share = totalSqft > 0 ? line.sqft / totalSqft : 0;
      const allocation = (charge: ServiceCharge, total: number) => charge.mode === "sqft"
        ? line.sqft * Number(charge.value || 0)
        : total * share;
      return {
        ...line,
        transportation: allocation(projectPricingInputs.transportation, transportation),
        installation: allocation(projectPricingInputs.installation, installation),
        loading: allocation(projectPricingInputs.loading, loading),
      };
    };
    const allocatedCharges = cabinetAreas.map(allocate);
    const fillerCharges = fillerAreas.map((line) => ({ ...allocate(line), elevation: line.elevation }));
    const counterPlyCharges = counterPlyAreas.map(allocate);
    return { cabinetSqft, fillerSqft, counterPlySqft, totalSqft, baseCost, conversion, convertedCost, profit, transportation, installation, loading, subtotal, tax, grandTotal: subtotal + tax, allocatedCharges, fillerCharges, counterPlyCharges, fillerAreaSlots };
  }, [costing, project, allFillers, countertops, countertopShutterType, extras, projectPricingInputs]);
  const currentCostingSnapshot = useMemo<KitchenCostingSnapshot>(() => ({
    areaSqft: projectPricing.totalSqft,
    materialCost: projectPricing.baseCost,
    conversion: projectPricing.conversion,
    profit: projectPricing.profit,
    transportation: projectPricing.transportation,
    installation: projectPricing.installation,
    loading: projectPricing.loading,
    tax: projectPricing.tax,
    total: projectPricing.grandTotal,
    unpriced: costing.unpriced,
    items: costing.purchases.map((item) => ({ category: item.categories.join(", "), itemCode: item.itemCode,
      item: item.item, unit: item.unit, quantity: item.quantity, rate: item.rate, amount: item.amount })),
  }), [costing, projectPricing]);
  const saveActiveKitchen = () => {
    const stored = readKitchenWorkspace();
    const updated = stored.map((entry) => entry.id === activeKitchen ? { ...entry, name: kitchenName,
      rows: projectSetup, materials, boardSheetInputs, costing: currentCostingSnapshot, manualCosting: manualCosting ?? undefined } : entry);
    writeKitchenWorkspace(updated);
    setKitchens(updated);
    return updated;
  };
  const renameKitchen = (name: string) => {
    setKitchenName(name);
    const updated = readKitchenWorkspace().map((entry) => entry.id === activeKitchen ? { ...entry, name } : entry);
    writeKitchenWorkspace(updated); setKitchens(updated);
  };
  const selectKitchen = async (id: string) => {
    if (id === activeKitchen) return false;
    setImportError("");
    try {
      const entries = saveActiveKitchen();
      const selected = entries.find((entry) => entry.id === id);
      if (!selected) return false;
      if (selected.materials) {
        const response = await fetch("/api/kitchen-materials", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selected.materials) });
        if (!response.ok) throw new Error("Could not load this kitchen’s material selections.");
      }
      if (selected.rows.length) applyRestoredKitchen(restoreProjectSetup(selected.rows), selected.boardSheetInputs ?? {});
      else {
        setProject([]); setFillers([]); setLinkedFillerEdits([]); setVisiblePanels([]); setCountertops([]);
        setAccessories([]); setLinkedAccessoryEdits([]); setMasterAccessories([]); setBoardSheetInputs({});
        setWaste({ ...WASTE }); setProjectPricingInputs(DEFAULT_PROJECT_PRICING); setEditingLineId(null);
      }
      setMaterials(selected.materials ?? materials);
      setManualCosting(selected.manualCosting ?? null);
      setActiveKitchenId(id); setActiveKitchen(id); setKitchenName(selected.name);
      setImportMessage(`Showing ${selected.name.trim() || selected.sourceName || "unnamed kitchen"}.`);
      return true;
    } catch (error) { setImportError(error instanceof Error ? error.message : "Could not switch kitchens."); return false; }
  };
  const removeImportedKitchen = async () => {
    const current = kitchens.find((entry) => entry.id === activeKitchen);
    if (!current?.sourceName || !window.confirm(`Remove ${current.name || current.sourceName} and its locally saved cabinets, materials, and costing?`)) return;
    const remaining = readKitchenWorkspace().filter((entry) => entry.id !== current.id);
    if (remaining.length) {
      if (!await selectKitchen(remaining[0].id)) return;
      const updated = readKitchenWorkspace().filter((entry) => entry.id !== current.id);
      writeKitchenWorkspace(updated); setKitchens(updated);
    } else {
      const blank: KitchenWorkspaceEntry = { id: crypto.randomUUID(), name: "", rows: [] };
      writeKitchenWorkspace([blank]); setActiveKitchenId(blank.id);
      window.location.assign("/materials");
    }
  };
  const importKitchenPdfs = async (files: FileList) => {
    setImportError(""); setImportMessage(""); setKitchenBusy(true);
    try {
      const entries = saveActiveKitchen();
      const additions: KitchenWorkspaceEntry[] = [];
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error(`${file.name} is not a PDF.`);
        const restored = await readProjectFile(file, materials);
        restored.name = kitchenNameFromPdfFilename(file.name);
        const importedMaterials = restored.hasSavedMaterialSnapshot && restored.project.length
          ? materialsFromImportedCabinets(restored.project.map((line) => cabinetConfig(line.m)), materials).materials
          : materials;
        additions.push({ id: crypto.randomUUID(), name: restored.name ?? "", sourceName: file.name, rows: projectSetupRows(restored),
          materials: importedMaterials, boardSheetInputs: {}, costing: kitchenCostingSnapshot(restored, importedMaterials, rates) });
      }
      const next = [...entries, ...additions];
      writeKitchenWorkspace(next);
      setKitchens(next);
      if (additions[0]) await selectKitchen(additions[0].id);
      setImportMessage(`Imported ${additions.length} kitchen PDF${additions.length === 1 ? "" : "s"}. Kitchen names were derived from the PDF filenames and can be edited.`);
    } catch (error) { setImportError(error instanceof Error ? error.message : "Could not import the kitchen PDFs."); }
    finally { setKitchenBusy(false); }
  };
  const downloadBulkCosting = () => {
    try {
      const entries = saveActiveKitchen();
      const populated = entries.filter((entry) => entry.costing && entry.rows.some((row) => row["Record Type"] === "cabinet"));
      if (!populated.length) throw new Error("Import or add a kitchen before downloading bulk costing.");
      if (populated.some((entry) => !entry.name.trim())) throw new Error("Enter a name for every kitchen before downloading bulk costing.");
      if (new Set(populated.map((entry) => entry.name.trim().toLowerCase())).size !== populated.length) throw new Error("Give each kitchen a different name before downloading bulk costing.");
      exportBulkCostingWorkbook(populated.map((entry) => ({ name: entry.name.trim(), ...entry.costing! })));
    } catch (error) { setImportError(error instanceof Error ? error.message : "Could not download bulk costing."); }
  };
  const updateManualCosting = (value: ManualCostingImport | null) => {
    setManualCosting(value);
    const updated = readKitchenWorkspace().map((entry) => entry.id === activeKitchen
      ? { ...entry, manualCosting: value ?? undefined } : entry);
    writeKitchenWorkspace(updated);
    setKitchens(updated);
  };
  const importManualCosting = async (file: File) => {
    setImportError(""); setImportMessage("");
    try {
      if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("Select an Excel costing file (.xls or .xlsx).");
      if (file.size > 10_000_000) throw new Error("The costing file is too large (maximum 10 MB).");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", bookSheets: true });
      if (workbook.SheetNames.includes("Cabinet Summary") && workbook.SheetNames.includes("Cabinet Items")) {
        await importFile(file);
        return;
      }
      const imported = parseManualCosting(await file.arrayBuffer(), file.name);
      updateManualCosting(imported);
      setImportMessage(`Imported ${imported.rows.length} manual costing items from ${file.name}. Quantities are shown per kitchen (${imported.sets} set${imported.sets === 1 ? "" : "s"} in the source). The BOM calculation was not changed.`);
      setTab("totals");
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById("imported-manual-costing")?.scrollIntoView({ behavior: "smooth", block: "start" })));
    } catch (error) { setImportError(error instanceof Error ? error.message : "Could not import the costing workbook."); }
  };
  const elevations = useMemo(() => [...new Set([
    ...project.map((line) => line.elevation),
    ...allFillers.map((line) => line.elevation),
    ...visiblePanels.map((line) => line.elevation),
    ...accessories.map((line) => line.elevation),
    ...allMasterAccessories.map((line) => line.elevation),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b)), [project, allFillers, visiblePanels, accessories, allMasterAccessories]);
  const activeElevation = selectedElevation !== null && elevations.includes(selectedElevation) ? selectedElevation : null;
  const shownProject = useMemo(() => activeElevation === null ? project : project.filter((line) => line.elevation === activeElevation), [project, activeElevation]);
  const projectLineValue = (line: ProjectLine, column: string) => {
    if (column === "Elev") return line.elevation;
    if (column === "Cabinet") return line.m.code;
    if (column === "Description") return famSetOf(line.m.zk)[line.m.fk].name;
    if (column === "W×H×D") return `${line.m.W}×${line.m.H}×${line.m.D}`;
    return String(line.qty);
  };
  const projectFilterColumns = ["Elev", "Cabinet", "Description", "W×H×D", "Qty"];
  const cabinetCodeOptions = [...new Set(shownProject.map((line) => line.m.code))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const hasProjectLineFilter = projectFilterColumns.some((column) => (projectLineFilters[column]?.length ?? 0) > 0);
  const filteredProjectLines = shownProject.filter((line) => projectFilterColumns.every((column) =>
    !projectLineFilters[column]?.length || projectLineFilters[column].includes(projectLineValue(line, column))))
    .sort((a, b) => projectLineSort ? projectLineValue(a, projectLineSort.column).localeCompare(
      projectLineValue(b, projectLineSort.column), undefined, { numeric: true }) * (projectLineSort.direction === "asc" ? 1 : -1) : 0);
  const selectedProjectLines = project.filter((line) => selectedProjectLineIds.includes(line.id));
  const selectedCabinetType = selectedProjectLines[0]?.m;
  const sameCabinetType = (line: ProjectLine) => !selectedCabinetType ||
    (line.m.zk === selectedCabinetType.zk && line.m.fk === selectedCabinetType.fk);
  const selectableVisibleLines = filteredProjectLines.filter(sameCabinetType);
  const allVisibleSelected = selectableVisibleLines.length > 0 && selectableVisibleLines.every((line) => selectedProjectLineIds.includes(line.id));
  const applySelectedHeight = () => {
    const height = Number(bulkHeightInput);
    if (!Number.isSafeInteger(height) || height <= 0 || selectedProjectLines.length === 0 || !selectedCabinetType) return;
    const ids = new Set(selectedProjectLines.map((line) => line.id));
    setProject((current) => current.map((line) => {
      if (!ids.has(line.id) || line.m.zk !== selectedCabinetType.zk || line.m.fk !== selectedCabinetType.fk) return line;
      const config = cabinetConfig(line.m);
      const family = famSetOf(config.zk)[config.fk];
      const previousDefault = shelfCount(config.zk, config.fk, family, config.H);
      const shelfQty = config.shelfQty === previousDefault ? shelfCount(config.zk, config.fk, family, height) : config.shelfQty;
      return { ...line, m: buildModel({ ...config, H: height, shelfQty }) };
    }));
    setBulkHeightOpen(false);
    setSelectedProjectLineIds([]);
  };
  const matchingCabinetCodes = new Set(filteredProjectLines.map((line) => line.m.code));
  const shownFillers = useMemo(() => activeElevation === null ? allFillers : allFillers.filter((line) => line.elevation === activeElevation), [allFillers, activeElevation]);
  const shownVisiblePanels = useMemo(() => activeElevation === null ? visiblePanels : visiblePanels.filter((line) => line.elevation === activeElevation), [visiblePanels, activeElevation]);
  const shownAccessories = useMemo(() => activeElevation === null ? allAccessories : allAccessories.filter((line) => line.elevation === activeElevation), [allAccessories, activeElevation]);
  const shownMasterAccessories = useMemo(() => activeElevation === null ? allMasterAccessories : allMasterAccessories.filter((line) => line.elevation === activeElevation), [allMasterAccessories, activeElevation]);
  const shownExtras = useMemo(() => activeElevation === null ? extras : buildExtrasBom(
    shownFillers, shownVisiblePanels, [], project, soMode ? "SO" : "", shType, countertopShutterType, finish, waste, materials, board,
    { front: shutterLamFrontSheetPrice, back: shutterLamBackSheetPrice },
    { itemId: visibleSideMaterialId, front: visibleLamFrontSheetPrice, back: visibleLamBackSheetPrice },
  ), [activeElevation, extras, shownFillers, shownVisiblePanels, project, soMode, shType, countertopShutterType, finish, waste, materials, board,
    shutterLamFrontSheetPrice, shutterLamBackSheetPrice, visibleSideMaterialId, visibleLamFrontSheetPrice, visibleLamBackSheetPrice]);
  const shownBoardTotals = boardTotals;
  const shownCosting = useMemo(() => activeElevation === null ? costing : computeCosting(
    shownProject, shownFillers, shownVisiblePanels, countertops, shownExtras.panels, shownAccessories, shownMasterAccessories,
    shType, countertopShutterType, rates, waste, projectPricingInputs.processingRates, costing.purchases, boardQuantityOverrides,
  ), [activeElevation, costing, shownProject, shownFillers, shownVisiblePanels, shownExtras, shownAccessories, shownMasterAccessories,
    countertops, shType, countertopShutterType, rates, waste, projectPricingInputs.processingRates, boardQuantityOverrides]);
  const shownProcessingCosts = useMemo(() => {
    return shownCosting.lines.flatMap((line) => line.details
      .filter((detail) => /processing$/i.test(detail.category))
      .map((detail) => ({ source: line.label, ...detail })));
  }, [shownCosting]);
  const shownPricing = useMemo(() => {
    if (activeElevation === null) return projectPricing;
    const allocatedCharges = projectPricing.allocatedCharges.filter((_, index) => project[index]?.elevation === activeElevation);
    const cabinetSqft = allocatedCharges.reduce((sum, line) => sum + line.sqft, 0);
    const fillerCharges = projectPricing.fillerCharges.filter((line) => line.elevation === activeElevation);
    const fillerSqft = fillerCharges.reduce((sum, line) => sum + line.sqft, 0);
    const counterPlyCharges = projectPricing.counterPlyCharges;
    const counterPlySqft = projectPricing.counterPlySqft;
    const totalSqft = cabinetSqft + fillerSqft + counterPlySqft;
    const baseCost = shownCosting.total;
    const conversion = baseCost * Number(projectPricingInputs.conversionPct || 0) / 100;
    const convertedCost = baseCost + conversion;
    const profit = convertedCost * Number(projectPricingInputs.profitPct || 0) / 100;
    const areaCharges = [...allocatedCharges, ...fillerCharges, ...counterPlyCharges];
    const transportation = areaCharges.reduce((sum, line) => sum + line.transportation, 0);
    const installation = areaCharges.reduce((sum, line) => sum + line.installation, 0);
    const loading = areaCharges.reduce((sum, line) => sum + line.loading, 0);
    const subtotal = convertedCost + profit + transportation + installation + loading;
    const tax = projectPricingInputs.includeTax ? subtotal * 0.18 : 0;
    return { cabinetSqft, fillerSqft, counterPlySqft, totalSqft, baseCost, conversion, convertedCost, profit, transportation, installation, loading,
      subtotal, tax, grandTotal: subtotal + tax, allocatedCharges, fillerCharges, counterPlyCharges };
  }, [activeElevation, projectPricing, project, shownCosting, projectPricingInputs]);
  const allStubs = useMemo(() => [...new Set(project.flatMap((l) => l.m.stubs))], [project]);

  /* --- Zoho: raw-material search per board group --- */
  const findRaw = useCallback(async (key: string, mat: string, t: number) => {
    setRawMap((m0) => ({ ...m0, [key]: { loading: true, error: "", items: m0[key]?.items ?? [], sel: m0[key]?.sel ?? "" } }));
    try {
      const items = await searchBoardItems(finish, String(t));
      setRawMap((m0) => ({ ...m0, [key]: { loading: false, error: items.length ? "" : `No matching board items found in Zoho for ${mat}`, items, sel: items[0]?.item_id ?? "" } }));
    } catch (e) {
      setRawMap((m0) => ({ ...m0, [key]: { loading: false, error: e instanceof Error ? e.message : "Zoho API error", items: [], sel: "" } }));
    }
  }, [finish]);

  /* --- Zoho: stock check over hardware + consumables --- */
  const stockNames = useMemo(() => {
    const map = new Map<string, number>();
    project.forEach((l) => {
      l.m.hardware.flatMap(expandHardwarePack).forEach((h) => map.set(h.name, (map.get(h.name) ?? 0) + h.qty * l.qty));
      l.m.cons.forEach((c) => map.set(c.name, (map.get(c.name) ?? 0) + c.qty * l.qty));
    });
    return [...map.entries()].map(([name, req]) => ({ name, req: r3(req) }));
  }, [project]);

  const runStockCheck = useCallback(async () => {
    setStockRunning(true);
    for (const { name } of stockNames) {
      setStockMap((s) => ({ ...s, [name]: { stock: s[name]?.stock ?? null, loading: true } }));
      try {
        const res = await fetch(`/api/zoho/items?search=${encodeURIComponent(name)}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const items: Array<{ name?: string; sku?: string; stock_on_hand?: number }> = data.items ?? data ?? [];
        const hit = items.find((it) => it.name === name || it.sku === name) ?? items[0];
        setStockMap((s) => ({ ...s, [name]: { stock: hit?.stock_on_hand ?? null, loading: false } }));
      } catch {
        setStockMap((s) => ({ ...s, [name]: { stock: null, loading: false } }));
      }
    }
    setStockRunning(false);
  }, [stockNames]);

  const dl = (name: string, text: string, type: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
  };

  const openPricingModal = () => {
    setReplacementTypes({}); setReplacementItems({});
    setSelectedProcessingTypes(Object.fromEntries(PROCESSING_CATEGORIES.flatMap((category) => {
      const first = processingTypes.find((row) => row.category === category)?.type;
      return first ? [[category, first]] : [];
    })) as Partial<Record<ProcessingCategory, ProcessingType>>);
    setDraftPricing({ ...projectPricingInputs, processingRates: { ...projectPricingInputs.processingRates },
      transportation: { ...projectPricingInputs.transportation }, installation: { ...projectPricingInputs.installation },
      loading: { ...projectPricingInputs.loading } });
    setDraftProcessingRates({ ...Object.fromEntries(processingTypes.map(({ category, type }) => {
      const key = processingKey(category, type);
      const legacyRate = processingBoards.find((board) => board.category === category && processingType(board.item) === type &&
        projectPricingInputs.processingRates[`${category}|${board.item.id}`] !== undefined);
      return [key, String(projectPricingInputs.processingRates[key] ??
        (legacyRate ? projectPricingInputs.processingRates[`${category}|${legacyRate.item.id}`] : undefined)
        ?? DEFAULT_BOARD_PROCESSING_RATES[key] ?? "")];
    })),
      "Counter Ply": String(projectPricingInputs.processingRates["Counter Ply"] ?? DEFAULT_BOARD_PROCESSING_RATES["Counter Ply"]),
    });
    setPricingAdminError("");
    setPricingModalOpen(true);
  };
  const unlockPricingModal = async () => {
    if (!pricingAdminPassword.trim()) return;
    setPricingAdminChecking(true); setPricingAdminError("");
    try {
      const response = await fetch("/api/costing", { method: "POST", headers: { "x-admin-password": pricingAdminPassword.trim() } });
      if (!response.ok) {
        const detail = response.status === 500 ? await response.json().catch(() => ({})) : {};
        throw new Error(response.status === 401 ? "Incorrect admin password."
          : detail?.error === "ADMIN_PASSWORD is not configured on the server."
            ? "Admin password is not configured for this environment."
            : "Could not verify admin access.");
      }
      setPricingAdminUnlocked(true); setPricingAdminPassword("");
    } catch (error) { setPricingAdminError(error instanceof Error ? error.message : "Could not verify admin access."); }
    finally { setPricingAdminChecking(false); }
  };
  const savePricingModal = () => {
    const processingRates: Record<string, number> = {};
    for (const category of PROCESSING_CATEGORIES) {
      const type = replacementTypes[category];
      if (!type) continue;
      const itemId = replacementItems[category];
      const item = materialItemsForCategory(category).find((candidate) => candidate.id === itemId && processingType(candidate) === type);
      if (!item) { setPricingAdminError(`Choose an exact ${category.toLowerCase()} board for ${type}.`); return; }
    }
    for (const { category, type } of displayedProcessingTypes) {
      const key = processingKey(category, type);
      const raw = draftProcessingRates[key] ?? "";
      const value = raw.trim() === "" ? 0 : Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 1_000_000) { setPricingAdminError(`Enter a valid processing cost for ${category} ${type}.`); return; }
      if (raw.trim() !== "" && value !== DEFAULT_BOARD_PROCESSING_RATES[key]) processingRates[key] = value;
    }
    const counterPlyRaw = draftProcessingRates["Counter Ply"] ?? "";
    const counterPlyRate = counterPlyRaw.trim() === "" ? DEFAULT_BOARD_PROCESSING_RATES["Counter Ply"] : Number(counterPlyRaw);
    if (!Number.isFinite(counterPlyRate) || counterPlyRate < 0 || counterPlyRate > 1_000_000) {
      setPricingAdminError("Enter a valid Counter Ply processing cost."); return;
    }
    if (counterPlyRaw.trim() !== "" && counterPlyRate !== DEFAULT_BOARD_PROCESSING_RATES["Counter Ply"])
      processingRates["Counter Ply"] = counterPlyRate;
    const factorValues = [draftPricing.conversionPct, draftPricing.profitPct,
      draftPricing.transportation.value, draftPricing.installation.value, draftPricing.loading.value];
    if (factorValues.some((value) => value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0))) {
      setPricingAdminError("Enter valid non-negative costing factors."); return;
    }
    setProjectPricingInputs({ ...draftPricing, processingRates });
    if (Object.values(replacementItems).some(Boolean)) {
      setProject((current) => current.map((line) => {
        const config = cabinetConfig(line.m);
        const nextConfig: CabinetConfig = {
          ...config,
          board: replacementItems["Carcass / shelf material"] ?? config.board,
          backBoardId: replacementItems["Carcass back material"] ?? config.backBoardId,
          drawerBoardId: replacementItems["Drawer material"] ?? config.drawerBoardId,
          shType: replacementItems["Shutter material"] ?? config.shType,
          visibleSideMaterialId: replacementItems["Visible side material"] ?? config.visibleSideMaterialId,
        };
        return { ...line, m: buildModel(nextConfig) };
      }));
      setEditingLineId(null);
      setShelfOverride(null);
    }
    setPricingModalOpen(false); setPricingAdminError("");
  };

  return (
    <div className="wbb">
      <style>{CSS}</style>

      <header className="hd">
        <div>
          <h1>Wood Kitchen BOM Builder</h1>
          <p>
            Plywood carcass · {Object.keys(ZONES).length} zones · sheet {SHEET_W}×{SHEET_H} ({SHEET_SQFT.toFixed(2)} sqft)
            {planningMode ? " · planning mode" : ""}
          </p>
        </div>
        <div className="hd-actions">
          <UserSignOut hasUnsavedWork={project.length > 0} />
          <input ref={pdfImportRef} type="file" accept=".pdf,application/pdf" aria-label="Import printed project PDF" style={{ display: "none" }} onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = "";
          }} />
          <button type="button" className="add" onClick={() => pdfImportRef.current?.click()}>Import printed PDF</button>
          <input ref={bulkPdfImportRef} type="file" multiple accept=".pdf,application/pdf" aria-label="Import multiple kitchen PDFs" style={{ display: "none" }} onChange={(event) => {
            if (event.target.files?.length) void importKitchenPdfs(event.target.files);
            event.target.value = "";
          }} />
          <button type="button" className="add" disabled={kitchenBusy} onClick={() => bulkPdfImportRef.current?.click()}>{kitchenBusy ? "Importing…" : "Import multiple kitchen PDFs"}</button>
          <input ref={manualCostingImportRef} type="file" accept=".xls,.xlsx" aria-label="Import manual costing Excel" style={{ display: "none" }} onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importManualCosting(file);
            event.target.value = "";
          }} />
          <button type="button" className="add" onClick={() => manualCostingImportRef.current?.click()}>Import costing Excel</button>
          <button type="button" className="add" disabled={project.length === 0 || !kitchenName.trim()} onClick={() => {
            setTab("totals");
            setSelectedElevation(null);
            setProjectLineFilters({});
            setProjectLineSort(null);
            requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
          }}>Print project PDF</button>
        </div>
        <div className="hd-n">
          <span>cabinets<b>{project.reduce((a, l) => a + l.qty, 0)}</b></span>
          <span>sheets<b>{boardTotals.reduce((a, b) => a + (b.sheets ?? 0), 0).toFixed(2)}</b></span>
        </div>
      </header>
      <section style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", padding: "12px 20px", background: "#fff", borderBottom: "1px solid #d6dfd8" }}>
        <label style={{ display: "grid", gap: 5, minWidth: 230, fontWeight: 650 }}>Kitchen
          <select aria-label="Select kitchen" value={activeKitchen} onChange={(event) => void selectKitchen(event.target.value)}>
            {kitchens.map((entry, index) => <option key={entry.id} value={entry.id}>{entry.name.trim() || entry.sourceName || `Kitchen ${index + 1}`}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 5, minWidth: 250, fontWeight: 650 }}>Kitchen name (required for costing downloads)
          <input aria-label="Kitchen name" required value={kitchenNameDraft} onChange={(event) => setKitchenNameDraft(event.target.value)} placeholder="Enter kitchen name" />
        </label>
        <button type="button" className="add" disabled={!kitchenNameDraft.trim() || kitchenNameDraft.trim() === kitchenName.trim()} onClick={() => renameKitchen(kitchenNameDraft.trim())}>Save name</button>
        {kitchens.find((entry) => entry.id === activeKitchen)?.sourceName &&
          <button type="button" className="add" disabled={kitchenBusy} onClick={() => void removeImportedKitchen()}>Remove imported PDF</button>}
        <span style={{ color: "var(--mut)", fontSize: 12 }}>{kitchens.length} kitchen{kitchens.length === 1 ? "" : "s"} in this session</span>
      </section>
      <nav className="kitchen-step-nav" aria-label="Kitchen setup steps">
        <a href="/materials" onClick={(event) => {
          try {
            saveActiveKitchen();
            window.sessionStorage.setItem(MATERIAL_EDIT_DRAFT_KEY, JSON.stringify({ rows: projectSetup, editingLineIndex: project.findIndex((line) => line.id === editingLineId), boardSheetInputs }));
          } catch {
            event.preventDefault();
            setImportError("This kitchen could not be saved temporarily. Export the Project JSON before changing materials.");
          }
        }}>1 · Material selection</a>
        <span aria-current="page">2 · Builder configuration</span>
      </nav>
      {importError && <p className="header-import-error" role="alert">{importError}</p>}
      {importMessage && <p className="header-import-success" role="status">{importMessage}</p>}

      <div className="body">
        {/* ---------------- Configure Unit ---------------- */}
        <aside className="rail" ref={railRef}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 18 }}>
            <h2 style={{ margin: 0 }}>Configure unit</h2>
            <button type="button" className="x" aria-label={showAdvanced ? "Hide additional configuration fields" : "Show additional configuration fields"}
              aria-expanded={showAdvanced} onClick={() => setShowAdvanced((current) => !current)}
              style={{ whiteSpace: "nowrap", fontSize: 14 }}>{showAdvanced ? "👁 Hide details" : "👁 Show details"}</button>
          </div>

          <Fld label="Zone">
            <select value={zk} onChange={(e) => onZone(e.target.value)}>
              {Object.entries(ZONES).map(([k, z]) => <option key={k} value={k}>{k} — {z.name}</option>)}
            </select>
          </Fld>

          <Fld label="Cabinet family">
            <select value={fkSafe} onChange={(e) => onFam(e.target.value)}>
              {Object.entries(fams).map(([k, f]: [string, any]) => <option key={k} value={k}>{k} — {f.name}</option>)}
            </select>
          </Fld>

          <Fld label="Configuration">
            <select value={v.id} onChange={(e) => onVariant(e.target.value)}>
              {fam.variants.map((x: any) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            {fam.variants.some((option: any) => option.id === "single" || option.id === "sgl") && fam.variants.some((option: any) => option.id === "double" || option.id === "dbl") &&
              <Hint>Up to 600 mm: single shutter. Above 600 mm: double shutter.</Hint>}
          </Fld>

          {zk === "WC" && isGlass && <Fld label="Top spot light">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={spotLight} onChange={(event) => setSpotLight(event.target.checked)} style={{ width: "auto" }} />
              Add one spot light at the top of each wall glass cabinet
            </label>
            <Hint>The spot light is added automatically to Accessories and included in the BOM and costing.</Hint>
          </Fld>}

          {v.handed && (
            <Fld label="Hand"><Seg opts={[["LHS", "LHS"], ["RHS", "RHS"]]} val={hand} set={setHand} /></Fld>
          )}

          {showAdvanced && <Fld label="Handle / profile">
            <select value={handle} onChange={(e) => setHandle(e.target.value)}>
              {!/^(WC|WB|LO|LB|MD)/.test(zk) && <option value="XCJ">C/J/G Gola</option>}<option value="PUSH">Push to Open</option><option value="KNOB">Knob</option><option value="HANDLE">Handle</option><option value="NONE">No Handle</option>
            </select>
            {(["PUSH", "KNOB", "HANDLE"] as string[]).includes(handle) && <input aria-label="Handle price per piece" type="number" min={0} step="0.01" placeholder="Price per piece (₹)" value={handlePrice} onChange={(e) => setHandlePrice(e.target.value)} />}
            {handle === "PUSH" && <select aria-label="Push to Open brand" value={handleBrand || "Hettich"} onChange={(e) => setHandleBrand(e.target.value)}>
              {["Hettich", "Hafele", "Blum", "Magppie"].map((brand) => <option key={brand} value={brand}>{brand}</option>)}
            </select>}
            {handle === "XCJ" && <Hint>Top depth cuts to {D - CJ_CUT}. Base shutters lose 33mm.</Hint>}
          </Fld>}

          {showAdvanced && !drawerOnly && (
            <Fld label="Hinge brand and type">
              <select value={hingeChoice} disabled={hingeLocked} onChange={(e) => setHingeChoice(e.target.value as HingeChoice)}>
                {HINGE_CHOICES.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
              </select>
              <Hint>{hingeLocked ? "Locked for this kitchen plan · " : ""}{hingeModeFor(zk, fkSafe) === "wide" ? "165° · Pullout cabinet" : hingeModeFor(zk, fkSafe) === "blind" ? "Blind hinge · Blind cabinet" : "95–110° · Standard cabinet"}</Hint>
            </Fld>
          )}

          {(showAdvanced || fkSafe === "SK" || (zk === "WC" && ["WOP", "WGL"].includes(fkSafe))) && <Fld label={fkSafe === "SK" ? "Sink cabinet material" : zk === "WC" && ["WOP", "WGL"].includes(fkSafe) ? "Carcass" : "Carcass board type"}>
            <select value={board} onChange={(e) => setBoard(e.target.value)}>
              {(zk === "WC" && ["WOP", "WGL"].includes(fkSafe) ? SHUTTER_BOARD_ITEMS : CARCASS_BOARD_ITEMS.filter((item) => item.id !== SINK_STONE_BOARD_ID || fkSafe === "SK"))
                .map((item) => <option key={item.id} value={item.id}>{item.subgroup} · {item.thicknessMm ?? "—"}mm</option>)}
            </select>
            <Hint>{carcassBoardOf(board, backBoardId).core} · Back: {carcassBoardOf(board, backBoardId).backItem?.subgroup ?? "—"} · {carcassBoardOf(board, backBoardId).backCoreT}mm · Drawer: {DRAWER_BOARD_ITEMS.find((item) => item.id === drawerBoardId)?.subgroup ?? "—"}</Hint>
          </Fld>}
          {fkSafe === "SK" && board === SINK_STONE_BOARD_ID && <Fld label="Stone sink back">
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={sinkStoneFullBack} onChange={(event) => setSinkStoneFullBack(event.target.checked)} style={{ width: "auto" }} />
              Include full stone back
            </label>
            <Hint>Unchecked: no back panel. Wood sink cabinets keep the 100 mm back rail.</Hint>
          </Fld>}
          <Fld label="Visible sides">
            <Seg opts={[["LH", "LH"], ["RH", "RH"], ["BOTH", "Both sides"]]} val={visibleSides} set={(value) => setVisibleSides(value as VisibleSides)} />
            {visibleSides && <button className="x" type="button" onClick={() => setVisibleSides("")}>Clear visible sides</button>}
            <Hint>{visibleSides ? `Selected side${visibleSides === "BOTH" ? "s" : ""} use ${SHUTTER_BOARD_ITEMS.find((item) => item.id === visibleSideMaterialId)?.subgroup ?? "the admin-selected shutter material"}.` : "No visible side selected."}</Hint>
          </Fld>

          {(showAdvanced || (zk === "WC" && fkSafe === "WGL")) && !fam.noShutter && (isGlass ? (
            <>
              <Fld label="Glass material type">
                <select value={glassType} onChange={(e) => { setGlassType(e.target.value); setGlassPricePerSqft(String(glassShutterItemOf(e.target.value).currentRate)); }}>
                  {GLASS_SHUTTER_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.subgroup}</option>)}
                </select>
                {zk === "WC" && fkSafe === "WGL" && <label>Glass price · ₹ / sqft
                  <input aria-label="Glass shutter price per sqft" type="number" min="0" max="1000000" step="0.01"
                    value={glassPricePerSqft ?? String(glassShutterItemOf(glassType).currentRate)}
                    onChange={(event) => setGlassPricePerSqft(event.target.value)} />
                </label>}
                <Hint>Shutters use 5mm glass. Internal glass shelves use 6mm clear glass at ₹{GLASS_SHELF_ITEM?.currentRate ?? 135}/sqft.</Hint>
              </Fld>
              {showAdvanced && <Fld label="Neon profile">
                <div className="fixed-value">Neon 50</div>
                <Hint>Glass shutters use Neon 50 only — inset {SH_INSET.NEON50}mm, frame {SH_FRAME.NEON50}mm.</Hint>
              </Fld>}
            </>
          ) : (
            <Fld label="Shutter board type">
              <select value={shType} onChange={(e) => setShType(e.target.value)}>
                {SHUTTER_BOARD_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.subgroup} · {item.thicknessMm ?? "—"}mm</option>)}
              </select>
              <Hint>{shOf(shType).mat} · cut at {shOf(shType).t}mm · {shOf(shType).band ? `${BAND_T}mm band, all edges` : "no edge band"}</Hint>
            </Fld>
          ))}

          {showAdvanced && fam.drawers && (
            <Fld label="Drawer model">
              <select value={drawerModel} disabled={drawerLocked} onChange={(e) => setDrawerModel(e.target.value)}>
                {DRAWER_MODELS.map((x) => <option key={x}>{x}</option>)}
              </select>
              {drawerLocked && <Hint>Locked for this kitchen plan.</Hint>}
            </Fld>
          )}

          <Fld label="Finish">
            <select value={finish} onChange={(e) => setFinish(e.target.value)}>
              {(boardFinishesData as string[]).map((f) => <option key={f}>{f}</option>)}
            </select>
          </Fld>

          {showAdvanced && <Fld label="Edge band">
            {MATERIAL_FIELDS.map((field) => {
              const selection = edgeBandForMaterial(edgeBand, field);
              const change = (update: Partial<typeof selection>) => setEdgeBand((current) => ({ ...current, byMaterial: {
                ...current.byMaterial, [field]: { ...edgeBandForMaterial(current, field), ...update },
              } }));
              return <div key={field} style={{ display: "grid", gap: 5, marginBottom: 10 }}>
                <strong>{field === "carcass" ? "Carcass / shelf" : field === "back" ? "Carcass back" : field === "drawer" ? "Drawer" : field === "visible" ? "Visible side" : "Shutter"}</strong>
                <input aria-label={`${field} edge band finish name`} list="edge-band-finishes" value={selection.finish}
                  onChange={(event) => change({ finish: event.target.value })} />
                <input aria-label={`${field} edge band rate per RMT`} type="number" min="0" max="1000000" step="0.01" value={selection.pricePerRmt}
                  onChange={(event) => change({ pricePerRmt: event.target.value })} />
              </div>;
            })}
            <datalist id="edge-band-finishes">{(edgebandFinishesData as string[]).map((name) => <option key={name} value={name} />)}</datalist>
          </Fld>}

          <Fld label="Dimensions (W · H · D)">
            <div className="g3">
              <input type="number" min={1} step={1} list="cabinet-width-presets" aria-label="Width in millimetres" title="Width (mm)" placeholder="Width" value={W || ""} onChange={(e) => onWidth(e.target.value === "" ? 0 : +e.target.value)} />
              <datalist id="cabinet-width-presets">{sizes.w.map((x) => <option key={x} value={x} />)}</datalist>
              <input type="number" min={1} step={1} list="cabinet-height-presets" aria-label="Height in millimetres" title="Height (mm)" placeholder="Height" value={H || ""} onChange={(e) => onHeight(e.target.value === "" ? 0 : +e.target.value)} />
              <datalist id="cabinet-height-presets">{sizes.h.map((x) => <option key={x} value={x} />)}</datalist>
              <input type="number" min={1} step={1} list="cabinet-depth-presets" aria-label="Depth in millimetres" title="Depth (mm)" placeholder="Depth" value={D || ""} onChange={(e) => setD(e.target.value === "" ? 0 : +e.target.value)} />
              <datalist id="cabinet-depth-presets"><option value={sizes.d} /></datalist>
            </div>
            <Hint>Enter any custom width, height, or depth in millimetres. Standard sizes appear as suggestions.</Hint>
            {!accessoryWidthValid && <Hint>Bottle pull-out accessories are available for 150, 200, or 300 mm cabinets.</Hint>}
          </Fld>

          {ZONES[zk].blind && <Fld label="Blind opening shutter width (mm)">
            <input type="number" min={blindOpeningLimits(zk).min} max={blindOpeningLimits(zk).max} step={1}
              aria-label="Blind opening shutter width in millimetres" value={blindOpeningWidth || ""}
              onChange={(event) => setBlindOpeningWidth(event.target.value === "" ? 0 : Number(event.target.value))} />
            <Hint>Allowed: {blindOpeningLimits(zk).min}–{blindOpeningLimits(zk).max} mm. The fixed panel uses the remaining cabinet width, allowing 3 mm for each panel.</Hint>
            {openingWidthAlert && <p role="alert" style={{ color: "#a63d16", fontWeight: 650, margin: "8px 0 0" }}>{openingWidthAlert}</p>}
          </Fld>}

          <Fld label="Cabinet filler">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={fillerWidth !== null} onChange={(event) => {
                setFillerWidth(event.target.checked ? FILLER_DEF_W : null);
                if (event.target.checked) { setFillerSides("LH"); setFillerWidthRH(FILLER_DEF_W); }
              }} style={{ width: "auto" }} />
              Add a filler with this cabinet
            </label>
            {fillerWidth !== null && <>
              <Seg opts={[["LH", "LH"], ["RH", "RH"], ["BOTH", "Both sides"]]} val={fillerSides}
                set={(value) => { if (value === "BOTH" && fillerSides === "LH") setFillerWidthRH(fillerWidth); setFillerSides(value as "LH" | "RH" | "BOTH"); }} />
              {(fillerSides === "LH" || fillerSides === "BOTH") && <label>LH filler width (mm)
                <input type="number" min={1} step={1} aria-label="LH cabinet filler width in millimetres" value={fillerWidth || ""}
                  onChange={(event) => setFillerWidth(event.target.value === "" ? 0 : Number(event.target.value))} />
              </label>}
              {(fillerSides === "RH" || fillerSides === "BOTH") && <label>RH filler width (mm)
                <input type="number" min={1} step={1} aria-label="RH cabinet filler width in millimetres" value={fillerWidthRH || ""}
                  onChange={(event) => setFillerWidthRH(event.target.value === "" ? 0 : Number(event.target.value))} />
              </label>}
              <Hint>LH and RH widths can match or differ. Height follows the cabinet. Wall fillers also include top and bottom carcass panels at cabinet depth.</Hint>
            </>}
          </Fld>

          <Fld label="Shelf quantity">
            <input type="number" min={0} step={1} aria-label="Shelf quantity" value={effectiveShelfQty} onChange={(e) => setShelfOverride(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
            <Hint>Default: {defaultShelfQty}. Use 0 for no shelves. This quantity applies only to this cabinet.</Hint>
          </Fld>

          <Fld label="Elevation & quantity">
            <div className="g2">
              <select value={elevation} onChange={(e) => setElevation(e.target.value)}>
                {ELEVATIONS.map((x) => <option key={x}>{x}</option>)}
              </select>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, +e.target.value))} />
            </div>
          </Fld>

          <button className="add" disabled={W <= 0 || H <= 0 || D <= 0 || !accessoryWidthValid || !stonePriceValid || !glassPriceValid || !edgeBandValid || !!openingWidthAlert || (fillerWidth !== null && (fillerWidth <= 0 || (fillerSides !== "LH" && fillerWidthRH <= 0))) || !laminatePricesValid} onClick={addLine}>{editingLineId === null ? "Add to project" : "Save cabinet changes"}</button>
          {editingLineId !== null && <button className="x" onClick={() => { setEditingLineId(null); setShelfOverride(null); }}>Cancel edit</button>}
          <div className="code">{m.code}</div>
        </aside>

        {/* ---------------- Output ---------------- */}
        <main className="out">
          <nav className="tabs">
            {([["packets", "Packets"], ["raw", "Raw BoM (this unit)"], ["totals", `Project & totals (${project.length})`]] as const)
              .map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
            {project.length > 0 && (
              <span className="dls">
                <button onClick={() => dl("wood-bom.csv", buildCSV(project), "text/csv")}>CSV</button>
                <button onClick={() => dl("wood-full-bom.json", JSON.stringify(fullBom, null, 2), "application/json")}>Full BOM</button>
              </span>
            )}
          </nav>

          {tab === "packets" && (
            <div className="pane">
              <h3>{fam.name} — {v.label}</h3>
              <Tbl head={["Pack", "Panel", "Material", "W", "H", "Thk", "Qty", "Band"]}
                num={[3, 4, 5, 6, 7]}
                rows={m.panels.map((p) => [p.pack, normalizePartOrPanelName(p.name), p.mat ?? "—",
                  p.w, p.h, p.t ?? "", p.qty, p.band ? r3(perim(p.w, p.h) * p.qty).toFixed(2) : "—"])} />
              {m.profiles.length > 0 && <>
                <h4>Profiles</h4>
                <Tbl head={["Pack", "Profile", "Len", "Qty"]} num={[2, 3]}
                  rows={m.profiles.map((p) => [p.pack, p.name, p.len, p.qty])} />
              </>}
              <h4>Hardware</h4>
              <Tbl head={["Pack", "Item", "Qty", "Unit"]} num={[2]}
                rows={m.hardware.flatMap(expandHardwarePack).map((h) => [h.pack, h.name, r3(h.qty), h.uom])} />
              {m.cons.length > 0 && <>
                <h4>Consumables</h4>
                <Tbl head={["Pack", "Item", "Qty", "Unit"]} num={[2]}
                  rows={m.cons.map((c) => [c.pack, c.name, r3(c.qty).toFixed(2), c.uom])} />
              </>}
              {m.stubs.length > 0 && <Stub list={m.stubs} />}
            </div>
          )}

          {tab === "raw" && (
            <div className="pane">
              <Tbl head={["Item", "Pack", "Unit", "Qty"]} num={[3]}
                rows={buildRawRows(m).map((r) => [r.item, r.pack, r.uom, r3(r.qty)])} />
            </div>
          )}

          {tab === "totals" && (
            <div className="pane">
              {project.length === 0 && countertops.length === 0 ? <div className="empty">Configure a cabinet or add Counter Ply to start a project.</div> : <>
                <label style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14, fontWeight: 650 }}>
                  Filter Project &amp; totals by elevation
                  <select aria-label="Filter project totals by elevation" value={activeElevation ?? ""}
                    onChange={(event) => setSelectedElevation(event.target.value || null)} style={{ width: "auto", minWidth: 150 }}>
                    <option value="">All elevations</option>
                    {elevations.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                {activeElevation !== null && <p className="hint">Showing elevation {activeElevation} plus all project-wide Counter Ply rows. Exports still contain the full project.</p>}
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <h4>Project lines</h4>
                  {selectedProjectLines.length > 0 && <>
                    <span className="hint">{selectedProjectLines.length} selected · {ZONES[selectedCabinetType!.zk].name} / {famSetOf(selectedCabinetType!.zk)[selectedCabinetType!.fk].name}</span>
                    <button type="button" className="add" onClick={() => { setBulkHeightInput(String(selectedProjectLines[0].m.H)); setBulkHeightOpen(true); }}>Edit selected heights</button>
                    <button type="button" className="x" onClick={() => setSelectedProjectLineIds([])}>Clear selection</button>
                  </>}
                </div>
                {selectedProjectLines.length > 0 && <button type="button" className="x" style={{ marginBottom: 10 }}
                  onClick={() => setSelectedProjectLineIds((current) => allVisibleSelected
                    ? current.filter((id) => !selectableVisibleLines.some((line) => line.id === id))
                    : [...new Set([...current, ...selectableVisibleLines.map((line) => line.id)])])}>
                  {allVisibleSelected ? "Deselect" : "Select"} all matching visible cabinets
                </button>}
                {(hasProjectLineFilter || projectLineSort) && <p className="hint" style={{ marginBottom: 8 }}>
                  Showing {filteredProjectLines.length} of {shownProject.length} cabinet lines. Filters also apply to cabinet rows in costing and service charges; project totals and exports remain complete.
                  <button type="button" className="x" style={{ marginLeft: 8 }} onClick={() => { setProjectLineFilters({}); setProjectLineSort(null); }}>Clear filters &amp; sort</button>
                </p>}
                <Tbl head={["Select", ...projectFilterColumns.map((column) => <ColumnFilter key={column} label={column}
                  options={[...new Set(shownProject.map((line) => projectLineValue(line, column)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))}
                  selected={projectLineFilters[column] ?? []}
                  onChange={(values) => setProjectLineFilters((current) => ({ ...current, [column]: values }))}
                  sortDirection={projectLineSort?.column === column ? projectLineSort.direction : null}
                  onSort={(direction) => setProjectLineSort({ column, direction })} />), ""]} num={[5]}
                  rows={filteredProjectLines.map((l) => {
                    const packetRows = cabinetPacketRows(l.m);
                    const packNames = [...new Set([...l.m.pkRows.map((row) => row.pack), ...packetRows.map((row) => row.pack)])];
                    return [<input key={`select-${l.id}`} type="checkbox" aria-label={`Select cabinet ${l.m.code} in elevation ${l.elevation}`}
                      checked={selectedProjectLineIds.includes(l.id)} disabled={!sameCabinetType(l)}
                      title={!sameCabinetType(l) ? "Select cabinets of the same zone and family only" : undefined}
                      onChange={(event) => setSelectedProjectLineIds((current) => event.target.checked ? [...current, l.id] : current.filter((id) => id !== l.id))} />,
                      l.elevation,
                      <details key={l.id}>
                        <summary style={{ cursor: "pointer", color: "var(--acc)", fontWeight: 650 }}>{l.m.code}</summary>
                        <div style={{ marginTop: 10, minWidth: 500 }}>
                          {packNames.map((pack) => <div key={pack} style={{ marginBottom: 10 }}>
                            <strong>{pack}</strong>
                            <Tbl head={["Item", "Qty / cabinet", "Unit"]} num={[1]}
                              rows={packetRows.filter((row) => row.pack === pack).map((row) => [row.item, r3(row.qty), row.unit])} />
                          </div>)}
                        </div>
                      </details>,
                      famSetOf(l.m.zk)[l.m.fk].name, `${l.m.W}×${l.m.H}×${l.m.D}`, l.qty,
                      <div key="actions" style={{ display: "flex", gap: 8 }}>
                        <button className="x" style={{ color: "var(--acc)" }} onClick={() => editLine(l)}>Edit</button>
                        <button className="x" onClick={() => delLine(l.id)}>remove</button>
                      </div>];
                  })} />

                <h4>Wastage % (editable)</h4>
                <p className="hint">Required quantity = usable quantity ÷ (1 − wastage %). For example, 550 sqft at 10% needs 611.11 sqft.</p>
                <div className="g3" style={{ maxWidth: 600 }}>
                  {(["carcass", "shutter", "profile", "edgeBand"] as const).map((k) => (
                    <label key={k} style={{ fontSize: 11, color: "var(--mut)" }}>{k}
                      <input type="number" min={0} max={99.9} step="0.1" value={waste[k]}
                        onChange={(event) => setWaste((current) => ({ ...current, [k]: Math.min(99.9, Math.max(0, Number(event.target.value) || 0)) }))} />
                    </label>
                  ))}
                </div>

                <h4>Boards — whole kitchen, editable sheets / stone slabs</h4>
                <p className="hint">Edit Sheets to change only board cost for this kitchen. Waste % is calculated from the entered sheets; laminate, processing and consumables stay unchanged. Clear an entry to restore the calculated quantity. Overrides are temporary and reset on refresh or import.</p>
                <Tbl head={["Material", "Thk", "Pack", "Sqft", "Waste %", "Sheets"]} num={[1, 3, 4, 5]}
                  rows={shownBoardTotals.map((b) => {
                    const key = b.key;
                    const override = boardQuantityOverrides[key];
                    const derivedWaste = override && override.sheets > 0 && b.sqft > 0 ? (1 - b.sqft / (override.sheets * b.sheetAreaSqft)) * 100 : b.waste;
                    return [`${b.mat} · ${b.finish}`, b.t, `${b.pack} · ${b.sheetAreaSqft} sqft/unit · ₹${b.rate.toFixed(2)}/sqft`, b.sqft.toFixed(2), derivedWaste.toFixed(2),
                      b.sheets === null ? "by area" : <input key={key} aria-label={`Sheets for ${b.mat} ${b.t}mm ${b.finish} ₹${b.rate.toFixed(2)}/sqft`} type="number" min={0} step="0.01"
                        value={boardSheetInputs[key] === undefined ? b.sheets.toFixed(2) : sheetQuantityInput(boardSheetInputs[key])} style={{ width: 140 }}
                        onBlur={() => setBoardSheetInputs((current) => current[key] ? { ...current, [key]: Number(current[key]).toFixed(2) } : current)}
                        onChange={(e) => { const value = e.target.value; if (value === "" || Number.isFinite(Number(value)) && Number(value) >= 0) setBoardSheetInputs((current) => ({ ...current, [key]: sheetQuantityInput(value) })); }} />];
                  })} />
              </>}

              {/* ---- Fillers ---- */}
              <SecHead title="Filler / Other Panels" onAdd={addFiller} />
              <p className="hint">Cabinet fillers start with cabinet dimensions. Remove hides a suggested filler and excludes it from the project; Reset restores its cabinet defaults.</p>
              {removedFillerCount > 0 && <button type="button" className="x" onClick={() => setShowRemovedFillers((value) => !value)}>
                {showRemovedFillers ? "Hide removed fillers" : `Show removed fillers (${removedFillerCount})`}
              </button>}
              {displayedLinkedFillers.length === 0 && fillers.length === 0 ? <div className="empty">No active fillers or other panels. Add a row to include one.</div> :
                <Tbl head={["Type", "Qty", "Shade", "Width (mm)", "Height (mm)", "Elevation", ""]} num={[1]}
                  rows={[
                    ...displayedLinkedFillers.map((filler) => {
                    const changed = linkedFillerEdits.some((edit) => edit.linkedLineId === filler.linkedLineId && (edit.fillerSide ?? "LH") === filler.fillerSide);
                    const disabled = !!filler.disabled;
                    return [
                      <div key="type"><span style={{ display: "block" }}>{filler.fillerSide ?? "Filler"}</span><select aria-label="Suggested filler type" disabled={disabled} value={filler.fillerType ?? "filler"}
                        onChange={(event) => {
                          const fillerType = event.target.value as FillerRow["fillerType"];
                          updLinkedFiller(filler, { fillerType, zone: fillerType === "chimney-panel" ? "wall" : fillerType === "dishwasher-panel" ? "base" : cabinetFillers(project).find((row) => row.linkedLineId === filler.linkedLineId)?.zone ?? filler.zone });
                        }}>
                        {FILLER_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                      </select></div>,
                      <input key="qty" type="number" min={1} step={1} disabled={disabled} aria-label="Suggested filler quantity" value={filler.qty}
                        onChange={(event) => updLinkedFiller(filler, { qty: Math.max(1, Math.trunc(Number(event.target.value) || 1)) })} style={{ width: 60 }} />,
                      <select key="shade" aria-label="Suggested filler shade" disabled={disabled} value={filler.customShade}
                        onChange={(event) => updLinkedFiller(filler, { customShade: event.target.value })}>
                        {(boardFinishesData as string[]).map((shade) => <option key={shade}>{shade}</option>)}
                      </select>,
                      <input key="width" type="number" min={1} disabled={disabled} aria-label="Suggested filler width" value={filler.customWidth}
                        onChange={(event) => updLinkedFiller(filler, { customWidth: event.target.value })} style={{ width: 84 }} />,
                      <input key="height" type="number" min={1} disabled={disabled} aria-label="Suggested filler height" value={filler.customHeight}
                        onChange={(event) => updLinkedFiller(filler, { customHeight: event.target.value })} style={{ width: 84 }} />,
                      <input key="elevation" list="elev-list" disabled={disabled} aria-label="Suggested filler elevation" value={filler.elevation}
                        onChange={(event) => updLinkedFiller(filler, { elevation: event.target.value })} style={{ width: 65 }} />,
                      <div key="actions" style={{ display: "flex", gap: 6 }}>
                        <button type="button" onClick={() => updLinkedFiller(filler, { disabled: !disabled })}>{disabled ? "Restore" : "Remove"}</button>
                        {changed && <button type="button" onClick={() => resetLinkedFiller(filler)}>Reset</button>}
                      </div>,
                    ];
                  }),
                    ...fillers.map((f) => [
                    <select key="t" value={f.fillerType ?? "filler"} onChange={(e) => {
                      const fillerType = e.target.value as FillerRow["fillerType"];
                      updFiller(f.id, { fillerType, zone: fillerType === "chimney-panel" ? "wall" : fillerType === "dishwasher-panel" ? "base" : f.zone });
                    }}>
                      {FILLER_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                    </select>,
                    <input key="q" type="number" min={1} value={f.qty} onChange={(e) => updFiller(f.id, { qty: Math.max(1, +e.target.value) })} style={{ width: 58 }} />,
                    <select key="s" value={f.customShade} onChange={(e) => updFiller(f.id, { customShade: e.target.value })}>
                      <option value="">Default ({finish})</option>
                      {(boardFinishesData as string[]).map((x) => <option key={x}>{x}</option>)}</select>,
                    <input key="w" type="number" placeholder={String(FILLER_DEF_W)} value={f.customWidth}
                      onChange={(e) => updFiller(f.id, { customWidth: e.target.value })} style={{ width: 80 }} />,
                    <input key="h" type="number" placeholder={String(defFillerH(f.zone, project))} value={f.customHeight}
                      onChange={(e) => updFiller(f.id, { customHeight: e.target.value })} style={{ width: 80 }} />,
                    <input key="e" list="elev-list" value={f.elevation} onChange={(e) => updFiller(f.id, { elevation: e.target.value })} style={{ width: 64 }} />,
                    <button key="x" className="x" onClick={() => rmFiller(f.id)}>×</button>,
                  ]),
                  ]} />}

              {/* ---- Visible Panels ---- */}
              {SHOW_STANDALONE_VISIBLE_PANELS && <>
              <SecHead title="Visible Panels" onAdd={addVp} />
              {visiblePanels.length === 0 ? <div className="empty">No visible panels. Only on customer request — height matches the shutter, width = carcass depth + {VP_DEPTH_ADD}mm.</div> :
                <Tbl head={["Zone", "Qty", "Visible material", "Shade", "Height (mm)", "Width (mm)", "Elevation", ""]} num={[1]}
                  rows={visiblePanels.map((f) => [
                    <select key="z" value={f.zone} onChange={(e) => updVp(f.id, { zone: e.target.value })}>
                      {FILLER_ZONES.map((z) => <option key={z}>{z}</option>)}</select>,
                    <input key="q" type="number" min={1} value={f.qty} onChange={(e) => updVp(f.id, { qty: Math.max(1, +e.target.value) })} style={{ width: 58 }} />,
                    <select key="t" value={f.shutterType} onChange={(e) => updVp(f.id, { shutterType: e.target.value })}>
                      <option value="">Default visible-panel material</option>
                      {SHUTTER_BOARD_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.subgroup} · {item.thicknessMm ?? "—"}mm</option>)}</select>,
                    <select key="s" value={f.customShade} onChange={(e) => updVp(f.id, { customShade: e.target.value })}>
                      <option value="">Default ({finish})</option>
                      {(boardFinishesData as string[]).map((x) => <option key={x}>{x}</option>)}</select>,
                    <input key="h" type="number" placeholder={String(defFillerH(f.zone, project))} value={f.customHeight}
                      onChange={(e) => updVp(f.id, { customHeight: e.target.value })} style={{ width: 80 }} />,
                    <input key="w" type="number" placeholder={String(defZoneDepth(f.zone, project) + VP_DEPTH_ADD)} value={f.customWidth}
                      onChange={(e) => updVp(f.id, { customWidth: e.target.value })} style={{ width: 80 }} />,
                    <input key="e" list="elev-list" value={f.elevation} onChange={(e) => updVp(f.id, { elevation: e.target.value })} style={{ width: 64 }} />,
                    <button key="x" className="x" onClick={() => rmVp(f.id)}>×</button>,
                  ])} />}
              </>}
              {visiblePanels.length > 0 && <p className="hint">This imported project has {visiblePanels.length} legacy standalone visible panel row(s). They remain in its BOM and costing; the standalone editor is hidden.</p>}

              {/* ---- Counter Ply ---- */}
              <SecHead title="Counter Ply" onAdd={addCt} />
              {countertops.length === 0 ? <div className="empty">No Counter Ply. Add a single-sheet top; its board follows the shutter material by default, or choose from Countertop Base PLY, carcass and shutter materials.</div> : <>
                <p className="hint">Costing area uses length × depth ÷ 92903, multiplied by quantity; the purchase quantity divides this area by 32 sqft per sheet. Visible sqft uses length × entered thickness ÷ 92903. Rates shown here are per sqft.</p>
                <Tbl head={["Length (mm)", "Depth (mm)", "Thk (mm)", "Material", "Rate (Rs/sqft)", "Qty", ""]} num={[4, 5]}
                  rows={countertops.map((c) => [
                    <input key="l" type="number" value={c.length} onChange={(e) => updCt(c.id, { length: e.target.value })} style={{ width: 90 }} />,
                    <input key="d" type="number" placeholder="600" value={c.depth || "600"} onChange={(e) => updCt(c.id, { depth: e.target.value })} style={{ width: 80 }} />,
                    <input key="t" type="number" placeholder="Thickness" value={c.thickness || String(countertopMaterialItem(c, countertopShutterType)?.thicknessMm ?? "")} onChange={(e) => updCt(c.id, { thickness: e.target.value })} style={{ width: 64 }} />,
                    <div key="m" style={{ display: "grid", gap: 4 }}>
                      <select value={countertopMaterialId(c)} aria-label="Counter Ply material" onChange={(e) => {
                        const id = e.target.value;
                        const previousThickness = countertopMaterialItem(c, countertopShutterType)?.thicknessMm;
                        const nextItem = id === "" ? shutterMasterItem(countertopShutterType) : COUNTER_PLY_ITEMS.find((item) => item.id === id);
                        updCt(c.id, { materialId: id, material: id === "CUSTOM" ? c.material : id ? nextItem?.materialDescription ?? "" : "",
                          thickness: !c.thickness || Number(c.thickness) === previousThickness ? String(nextItem?.thicknessMm ?? "") : c.thickness });
                      }} style={{ minWidth: 180 }}>
                        <option value="">Same as shutter ({shOf(countertopShutterType).label})</option>
                        {COUNTER_PLY_GROUPS.map((group) => <optgroup key={group} label={group}>
                          {COUNTER_PLY_ITEMS.filter((item) => item.group === group).map((item) =>
                            <option key={item.id} value={item.id}>{item.subgroup} · {item.thicknessMm ?? "—"}mm</option>)}
                        </optgroup>)}
                        <option value="CUSTOM">Custom / legacy material</option>
                      </select>
                      {countertopMaterialId(c) === "CUSTOM" && <input value={c.material} placeholder="Material name" onChange={(e) => updCt(c.id, { material: e.target.value })} />}
                    </div>,
                    countertopMaterialId(c) === "CUSTOM"
                      ? <input key="r" type="number" min={0} step="0.01" value={c.ratePerSqft ?? ""} placeholder="Enter rate" onChange={(e) => updCt(c.id, { ratePerSqft: e.target.value })} style={{ width: 90 }} />
                      : <span key="r">₹{(countertopMaterialItem(c, countertopShutterType)?.currentRate ?? 0).toFixed(2)}</span>,
                    <input key="q" type="number" min={1} value={c.qty} onChange={(e) => updCt(c.id, { qty: Math.max(1, +e.target.value) })} style={{ width: 58 }} />,
                    <button key="x" className="x" onClick={() => rmCt(c.id)}>×</button>,
                  ])} />
              </>}

              {/* ---- Calculated, manually cut and priced accessories in one editor ---- */}
              <SecHead title="Accessories">
                <button className="x" style={{ color: "var(--acc)" }} onClick={addAcc}>+ add cut-length item</button>
                <button className="x" style={{ color: "var(--acc)" }} onClick={addMasterAcc}>+ add priced item</button>
              </SecHead>
              <p className="hint">Calculated items are editable defaults; Remove hides and excludes them, and Reset restores their calculated values. J profiles combine into one run per elevation. C handles show the combined length and each editable cut size.</p>
              {removedAccessoryCount > 0 && <button type="button" className="x" onClick={() => setShowRemovedAccessories((value) => !value)}>
                {showRemovedAccessories ? "Hide removed accessories" : `Show removed accessories (${removedAccessoryCount})`}
              </button>}
              {displayedAutomaticAccessoryGroups.length === 0 && accessories.filter((row) => !row.automaticKey).length === 0 && displayedLinkedAccessoryGroups.length === 0 && masterAccessories.length === 0
                ? <div className="empty">No active accessories selected. Add a cut-length or priced item above.</div>
                : <Tbl head={["Accessory", "Cut size (m)", "Qty", "Total (m)", "Elevation", "Brand", "Rate (Rs/unit)", "Straight", "L-conn", "Driver", ""]} num={[2, 3, 6]}
                rows={[
                  ...displayedAutomaticAccessoryGroups.map((group) => {
                  if (group[0].item.kind === "c-handle" || group[0].item.kind === "j-handle") {
                    const kind = group[0].item.kind;
                    const elevation = group[0].item.elevation;
                    const included = group.filter(({ item }) => !item.disabled);
                    const total = included.reduce((sum, { item }) => sum + accessoryMeters(item), 0);
                    const pieces = included.reduce((sum, { item }) => sum + item.qty, 0);
                    const updateJLength = (value: string) => {
                      const requested = Number(value);
                      if (value.trim() === "" || !Number.isFinite(requested) || requested < 0 || !included.length) return;
                      if (total === 0) {
                        const { source, item } = included[0];
                        updAutomaticAcc(source, { size: (requested / item.qty).toFixed(3) });
                        return;
                      }
                      const factor = requested / total;
                      included.forEach(({ source, item }) => updAutomaticAcc(source, { size: (Number(item.size) * factor).toFixed(3) }));
                    };
                    const cutFields = group.map(({ source, item, edited }) => <div key={source.automaticKey} style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 6 }}>
                      <input type="number" min={0} step="0.001" value={item.size} disabled={item.disabled}
                        aria-label={`${ACC_LABEL[kind]} cut size in ${elevation}`}
                        onChange={(event) => updAutomaticAcc(source, { size: event.target.value })} style={{ width: 84 }} /> m ×
                      <input type="number" min={1} step={1} value={item.qty} disabled={item.disabled}
                        aria-label={`${ACC_LABEL[kind]} pieces in ${elevation}`}
                        onChange={(event) => updAutomaticAcc(source, { qty: Math.max(1, Math.trunc(Number(event.target.value) || 1)) })} style={{ width: 52 }} />
                      <button type="button" onClick={() => updAutomaticAcc(source, { disabled: !item.disabled })}>{item.disabled ? "Restore" : "Remove"}</button>
                      {edited && <button type="button" onClick={() => resetAutomaticAcc(source)}>Reset</button>}
                    </div>);
                    return [
                      <select key="kind" value={kind} aria-label={`Handle type in ${elevation}`}
                        onChange={(event) => group.forEach(({ source }) => updAutomaticAcc(source, { kind: event.target.value as AccessoryKind }))}>
                        {(Object.keys(ACC_LABEL) as AccessoryKind[]).map((option) => <option key={option} value={option}>{ACC_LABEL[option]}</option>)}</select>,
                      kind === "j-handle"
                        ? <label key="cuts" style={{ display: "flex", gap: 5, alignItems: "center" }}>Combined
                          <input key={total.toFixed(3)} type="number" min={0} step="0.001" defaultValue={total.toFixed(3)}
                            aria-label={`Combined J handle length in ${elevation}`} onBlur={(event) => updateJLength(event.target.value)} style={{ width: 90 }} /> m
                        </label>
                        : <details key="cuts" open><summary>Combined: {total.toFixed(3)} m</summary>{cutFields}</details>,
                      kind === "j-handle" ? (included.length ? 1 : 0) : pieces,
                      total.toFixed(3),
                      <input key="elev" list="elev-list" value={elevation} aria-label={`Elevation for ${ACC_LABEL[kind]}`}
                        onChange={(event) => group.forEach(({ source }) => updAutomaticAcc(source, { elevation: event.target.value }))} style={{ width: 64 }} />,
                      "—", "—", "—", "—", "—",
                      <div key="actions" style={{ display: "flex", gap: 6 }}>
                        <button type="button" onClick={() => group.forEach(({ source }) => updAutomaticAcc(source, { disabled: included.length > 0 }))}>{included.length > 0 ? "Remove" : "Restore"}</button>
                        {group.some(({ edited }) => edited) && <button type="button" onClick={() => group.forEach(({ source }) => resetAutomaticAcc(source))}>Reset</button>}
                      </div>,
                    ];
                  }
                  const source = group[0].source;
                  const override = accessories.find((row) => row.automaticKey === source.automaticKey);
                  const item = { ...source, ...override };
                  const disabled = !!override?.disabled;
                  return [
                    <select key="kind" value={item.kind} disabled={disabled} aria-label={`Accessory type in ${source.elevation}`}
                      onChange={(event) => updAutomaticAcc(source, { kind: event.target.value as AccessoryKind })}>
                      {(Object.keys(ACC_LABEL) as AccessoryKind[]).map((kind) => <option key={kind} value={kind}>{ACC_LABEL[kind]}</option>)}</select>,
                    <input key="size" type="number" min={0} step="0.001" value={item.size} disabled={disabled} aria-label={`Cut size for ${ACC_LABEL[source.kind]} in ${source.elevation}`}
                      onChange={(event) => updAutomaticAcc(source, { size: event.target.value })} style={{ width: 90 }} />,
                    <input key="qty" type="number" min={1} step={1} value={item.qty} disabled={disabled} aria-label={`Quantity for ${ACC_LABEL[source.kind]} in ${source.elevation}`}
                      onChange={(event) => updAutomaticAcc(source, { qty: Math.max(1, Math.trunc(Number(event.target.value) || 1)) })} style={{ width: 58 }} />,
                    accessoryMeters(item).toFixed(3),
                    <input key="elev" list="elev-list" value={item.elevation} disabled={disabled} aria-label={`Elevation for ${ACC_LABEL[source.kind]} in ${source.elevation}`}
                      onChange={(event) => updAutomaticAcc(source, { elevation: event.target.value })} style={{ width: 64 }} />,
                    "—",
                    "—",
                    item.kind === "skirting" ? <input key="straight" type="number" min={0} step={1} value={item.straight} disabled={disabled} aria-label={`Straight connectors for ${source.elevation}`}
                      onChange={(event) => updAutomaticAcc(source, { straight: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })} style={{ width: 58 }} /> : "—",
                    item.kind === "skirting" ? <input key="lconn" type="number" min={0} step={1} value={item.lconn} disabled={disabled} aria-label={`L connectors for ${source.elevation}`}
                      onChange={(event) => updAutomaticAcc(source, { lconn: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })} style={{ width: 58 }} /> : "—",
                    item.kind === "elenor" ? <select key="driver" value={selectedDriver(item.driver)?.id ?? ""} disabled={disabled} aria-label={`Driver for ${source.elevation}`}
                      onChange={(event) => updAutomaticAcc(source, { driver: event.target.value })}>
                      <option value="">— no driver —</option>{DRIVER_ITEMS.map((driver) => <option key={driver.id} value={driver.id}>{driver.subgroup}</option>)}
                    </select> : "—",
                    <div key="actions" style={{ display: "flex", gap: 6 }}>
                      {disabled ? <button type="button" onClick={() => updAutomaticAcc(source, { disabled: false })}>Restore</button>
                        : <button type="button" onClick={() => updAutomaticAcc(source, { disabled: true })}>Remove</button>}
                      {override && <button type="button" onClick={() => resetAutomaticAcc(source)}>Reset</button>}
                    </div>,
                  ];
                }),
                  ...accessories.filter((row) => !row.automaticKey).map((a) => [
                    <select key="k" value={a.kind} onChange={(e) => updAcc(a.id, { kind: e.target.value as AccessoryKind, size: "", lengthMeters: undefined, qty: 1 })}>
                      {(Object.keys(ACC_LABEL) as AccessoryKind[]).map((k) => <option key={k} value={k}>{ACC_LABEL[k]}</option>)}</select>,
                    <input key="s" aria-label={`${ACC_LABEL[a.kind]} cutting size (metres)`} type="number" min={0} step="0.001" value={a.size}
                      placeholder="metres" onChange={(e) => updAcc(a.id, { size: e.target.value })} style={{ width: 90 }} />,
                    <input key="q" aria-label={`${ACC_LABEL[a.kind]} quantity (pieces)`} type="number" min={1} step={1} value={a.qty}
                      onChange={(e) => updAcc(a.id, { qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })} style={{ width: 58 }} />,
                    <span key="total">{accessoryMeters(a).toFixed(3)}</span>,
                    <input key="e" list="elev-list" value={a.elevation} onChange={(e) => updAcc(a.id, { elevation: e.target.value })} style={{ width: 64 }} />,
                    "—",
                    "—",
                    a.kind === "skirting" ? <input key="st" type="number" min={0} step={1} value={a.straight} onChange={(e) => updAcc(a.id, { straight: Math.max(0, Math.trunc(Number(e.target.value))) })} style={{ width: 58 }} /> : "—",
                    a.kind === "skirting" ? <input key="lc" type="number" min={0} step={1} value={a.lconn} onChange={(e) => updAcc(a.id, { lconn: Math.max(0, Math.trunc(Number(e.target.value))) })} style={{ width: 58 }} /> : "—",
                    a.kind === "elenor" ? <select key="dr" value={selectedDriver(a.driver)?.id ?? ""} onChange={(e) => updAcc(a.id, { driver: e.target.value })}>
                      <option value="">— no driver —</option>
                      {DRIVER_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.subgroup}</option>)}</select> : "—",
                    <button key="x" className="x" onClick={() => rmAcc(a.id)}>×</button>,
                  ]),
                    ...displayedLinkedAccessoryGroups.map((rows) => {
                      const row = rows[0];
                      const item = selectedMasterAccessory(row);
                      const label = item?.subgroup ?? row.itemId;
                      const modified = rows.some((entry) => linkedAccessoryEdits.some((edit) => edit.linkedLineId === entry.linkedLineId && edit.sourceItemId === entry.sourceItemId));
                      const rates = new Set(rows.map((entry) => entry.manualRate ?? ""));
                      const rate = rates.size === 1 ? row.manualRate ?? "" : "";
                      const included = rows.some((entry) => !entry.disabled);
                      return [
                        <div key="item" style={{ minWidth: 320 }}>
                          <AccessoryPicker rowId={row.id} selectedLabel={item ? `${item.subgroup} — ${item.materialDescription}` : row.customName ?? ""}
                            selectedId={row.itemId}
                            onSelect={(itemId) => updLinkedAccGroup(rows, { itemId, customName: undefined, customUnit: undefined, customBrand: undefined, manualRate: "" })}
                            onCustom={(customName) => updLinkedAccGroup(rows, { itemId: "CUSTOM", customName, customUnit: "PCS", customBrand: "", manualRate: "" })} />
                          {row.itemId === "CUSTOM" && <div className="accessory-custom-fields">
                            <input aria-label={`${label} name in ${row.elevation}`} placeholder="Accessory name" value={row.customName ?? ""} onChange={(event) => updLinkedAccGroup(rows, { customName: event.target.value })} />
                            <select aria-label={`${label} unit in ${row.elevation}`} value={row.customUnit ?? "PCS"} onChange={(event) => updLinkedAccGroup(rows, { customUnit: event.target.value as "PCS" | "SET" | "MTR" })}>
                              <option value="PCS">PCS</option><option value="SET">SET</option><option value="MTR">MTR</option>
                            </select>
                          </div>}
                        </div>,
                        "—",
                        <input key="qty" type="number" min={0} step={item?.rateBasis === "MTR" ? "0.01" : "1"}
                          aria-label={`Quantity for ${label} in ${row.elevation}`} value={rows.reduce((sum, entry) => sum + (entry.disabled ? 0 : entry.qty), 0)}
                          onChange={(event) => setLinkedAccGroupQty(rows, Number(event.target.value))} style={{ width: 76 }} />,
                        "—",
                        <input key="elevation" list="elev-list" aria-label={`Elevation for ${label}`} value={row.elevation}
                          onChange={(event) => updLinkedAccGroup(rows, { elevation: event.target.value })} style={{ width: 68 }} />,
                        row.itemId === "CUSTOM" ? <input key="brand" aria-label={`${label} brand in ${row.elevation}`} placeholder="Brand (optional)" value={row.customBrand ?? ""}
                          onChange={(event) => updLinkedAccGroup(rows, { customBrand: event.target.value })} style={{ width: 100 }} /> : item?.brand || "—",
                        <input key="rate" type="number" min={0} step="0.01" aria-label={`Rate for ${label} in ${row.elevation}`}
                          placeholder={rates.size > 1 ? "Mixed rates" : item?.priced ? item.currentRate.toFixed(2) : "Enter rate"} value={rate}
                          onChange={(event) => { const value = event.target.value; if (value === "" || Number.isFinite(Number(value)) && Number(value) >= 0) updLinkedAccGroup(rows, { manualRate: value }); }} style={{ width: 120 }} />,
                        "—",
                        "—",
                        "—",
                        <div key="actions" style={{ display: "flex", gap: 6 }}>
                          {included ? <button type="button" onClick={() => setLinkedAccGroupQty(rows, 0)}>Remove</button>
                            : <button type="button" onClick={() => rows.forEach(resetLinkedAcc)}>Restore</button>}
                          {modified && <button type="button" onClick={() => rows.forEach(resetLinkedAcc)}>Reset</button>}
                        </div>,
                      ];
                    }),
                    ...masterAccessories.map((row) => {
                    const selected = selectedMasterAccessory(row);
                    return [
                      <div key="i" style={{ minWidth: 360 }}>
                        <AccessoryPicker rowId={row.id} selectedLabel={selected ? `${selected.subgroup} — ${selected.materialDescription}` : ""}
                          selectedId={row.itemId}
                          onSelect={(itemId) => updMasterAcc(row.id, { itemId, customName: undefined, customUnit: undefined, customBrand: undefined, manualRate: "" })}
                          onCustom={(customName) => updMasterAcc(row.id, { itemId: "CUSTOM", customName, customUnit: "PCS", customBrand: "", manualRate: "" })} />
                        {row.itemId === "CUSTOM" && <div className="accessory-custom-fields">
                          <input aria-label="Custom accessory name" placeholder="Accessory name" value={row.customName ?? ""} onChange={(e) => updMasterAcc(row.id, { customName: e.target.value })} />
                          <select aria-label="Custom accessory unit" value={row.customUnit ?? "PCS"} onChange={(e) => updMasterAcc(row.id, { customUnit: e.target.value as "PCS" | "SET" | "MTR" })}>
                            <option value="PCS">PCS</option><option value="SET">SET</option><option value="MTR">MTR</option>
                          </select>
                        </div>}
                      </div>,
                      "—",
                      <input key="q" type="number" aria-label={`Quantity (${selected?.rateBasis ?? "unit"})`} min={selected?.rateBasis === "MTR" ? 0 : 1} step={selected?.rateBasis === "MTR" ? "0.01" : "1"} value={row.qty} onChange={(e) => updMasterAcc(row.id, { qty: Math.max(selected?.rateBasis === "MTR" ? 0 : 1, +e.target.value) })} style={{ width: 78 }} />,
                      "—",
                      <input key="e" list="elev-list" value={row.elevation} onChange={(e) => updMasterAcc(row.id, { elevation: e.target.value })} style={{ width: 64 }} />,
                      row.itemId === "CUSTOM" ? <input key="brand" aria-label="Custom accessory brand" placeholder="Brand (optional)" value={row.customBrand ?? ""} onChange={(e) => updMasterAcc(row.id, { customBrand: e.target.value })} style={{ minWidth: 110 }} /> : selected?.brand || "—",
                      <div key="rate" style={{ display: "grid", gap: 2, minWidth: 130 }}>
                        <input type="number" min={0} step="0.01" aria-label={`Manual rate for ${selected?.subgroup ?? "accessory"}`} placeholder={selected?.priced ? selected.currentRate.toFixed(2) : "Enter price"} value={row.manualRate ?? ""} onChange={(e) => updMasterAcc(row.id, { manualRate: e.target.value })} style={{ width: 118 }} />
                        <small style={{ color: "var(--mut)" }}>{row.manualRate !== undefined && row.manualRate !== "" ? `Manual · ${selected?.rateBasis ?? "unit"}` : selected?.priced ? `Master ₹${selected.currentRate.toFixed(2)} / ${selected.rateBasis}` : "No master rate"}</small>
                      </div>,
                      "—",
                      "—",
                      "—",
                      <button key="x" className="x" onClick={() => rmMasterAcc(row.id)}>×</button>,
                    ];
                  }),
                  ]} />}

              {/* ---- Costing with an auditable per-cabinet breakdown ---- */}
              <SecHead title="Costing (Rs)" />
              {manualCosting && <details id="imported-manual-costing" open style={{ marginBottom: 16 }}>
                <summary style={{ cursor: "pointer", fontWeight: 650 }}>Imported manual costing · {manualCosting.sourceName}</summary>
                <p className="hint">Editable reference for this kitchen. Source covers {manualCosting.sets} set{manualCosting.sets === 1 ? "" : "s"}; quantities below are per kitchen. These rows do not overwrite BOM-calculated costs.</p>
                {manualCosting.areaSqft !== undefined && <label style={{ display: "block", marginBottom: 8 }}>Manual area (sqft) <input type="number" min={0} step="any" value={manualCosting.areaSqft} onChange={(event) => updateManualCosting({ ...manualCosting, areaSqft: Math.max(0, Number(event.target.value)) })} style={{ width: 110, marginLeft: 8 }} /></label>}
                <Tbl head={["Category", "Manual item", "Brand / code", "Unit", "Qty / kitchen", "Rate (Rs)", "Amount (Rs)", ""]} num={[4, 5, 6]}
                  rows={manualCosting.rows.map((row) => [
                    <input key="category" value={row.category} aria-label={`Category for manual item ${row.id}`} onChange={(event) => updateManualCosting({ ...manualCosting, rows: manualCosting.rows.map((item) => item.id === row.id ? { ...item, category: event.target.value } : item) })} style={{ minWidth: 120 }} />,
                    <input key="item" value={row.item} aria-label={`Manual item ${row.id}`} onChange={(event) => updateManualCosting({ ...manualCosting, rows: manualCosting.rows.map((item) => item.id === row.id ? { ...item, item: event.target.value } : item) })} style={{ minWidth: 260 }} />,
                    <input key="brand" value={row.brand || row.itemCode} aria-label={`Brand or code for manual item ${row.id}`} onChange={(event) => updateManualCosting({ ...manualCosting, rows: manualCosting.rows.map((item) => item.id === row.id ? { ...item, brand: event.target.value, itemCode: "" } : item) })} style={{ minWidth: 100 }} />,
                    <input key="unit" value={row.unit} aria-label={`Unit for manual item ${row.id}`} onChange={(event) => updateManualCosting({ ...manualCosting, rows: manualCosting.rows.map((item) => item.id === row.id ? { ...item, unit: event.target.value } : item) })} style={{ width: 66 }} />,
                    <input key="qty" type="number" min={0} step="any" value={row.quantity} aria-label={`Quantity for manual item ${row.id}`} onChange={(event) => updateManualCosting({ ...manualCosting, rows: manualCosting.rows.map((item) => item.id === row.id ? { ...item, quantity: Math.max(0, Number(event.target.value)) } : item) })} style={{ width: 90 }} />,
                    <input key="rate" type="number" min={0} step="any" value={row.rate} aria-label={`Rate for manual item ${row.id}`} onChange={(event) => updateManualCosting({ ...manualCosting, rows: manualCosting.rows.map((item) => item.id === row.id ? { ...item, rate: Math.max(0, Number(event.target.value)) } : item) })} style={{ width: 90 }} />,
                    (row.quantity * row.rate).toFixed(2),
                    <button key="remove" type="button" className="x" aria-label={`Remove manual item ${row.id}`} onClick={() => updateManualCosting({ ...manualCosting, rows: manualCosting.rows.filter((item) => item.id !== row.id) })}>×</button>,
                  ])} />
                {(manualCosting.extraCharges ?? []).length > 0 && <Tbl head={["Other manual charge", "Amount (Rs)"]} num={[1]}
                  rows={(manualCosting.extraCharges ?? []).map((charge) => [charge.label,
                    <input key={charge.id} type="number" min={0} step="any" aria-label={`${charge.label} manual amount`} value={charge.amount} onChange={(event) => updateManualCosting({ ...manualCosting,
                      extraCharges: (manualCosting.extraCharges ?? []).map((item) => item.id === charge.id ? { ...item, amount: Math.max(0, Number(event.target.value)) } : item) })} style={{ width: 120 }} />])} />}
                <p style={{ fontWeight: 700 }}>Manual item total: ₹{manualCosting.rows.reduce((sum, row) => sum + row.quantity * row.rate, 0).toFixed(2)} · Manual including listed charges: ₹{(manualCosting.rows.reduce((sum, row) => sum + row.quantity * row.rate, 0) + (manualCosting.extraCharges ?? []).reduce((sum, charge) => sum + charge.amount, 0)).toFixed(2)} · Software material total: ₹{costing.total.toFixed(2)}</p>
                <button type="button" className="x" onClick={() => { if (window.confirm("Remove this imported manual costing from the kitchen?")) updateManualCosting(null); }}>Remove imported costing</button>
              </details>}
              {shownProcessingCosts.length > 0 && <div style={{ marginBottom: 16 }}>
                <h3>Board processing costs</h3>
                <p className="hint">Each processing line stays separate. Billable sqft = net sqft + wastage. Raw Material Selection combines identical boards across categories, so compare its sqft with the sum of the corresponding processing lines. Counter Ply uses length × depth × quantity ÷ 92903.</p>
                <Tbl head={["Cabinet / item", "Category", "Board", "Net sqft", "Waste sqft", "Billable sqft (+waste)", "Rate (Rs/sqft)", "Amount (Rs)"]} num={[3, 4, 5, 6, 7]}
                  rows={[...shownProcessingCosts.map((row) => [row.source, row.category, row.item, row.netQty.toFixed(2), (row.billableQty - row.netQty).toFixed(2), row.billableQty.toFixed(2), String(row.rate), row.amount.toFixed(2)]),
                    [<b key="total">Total processing</b>, "", "", "", "", shownProcessingCosts.reduce((sum, row) => sum + row.billableQty, 0).toFixed(2), "", <b key="amount">{shownProcessingCosts.reduce((sum, row) => sum + row.amount, 0).toFixed(2)}</b>]]} />
              </div>}
              {costing.purchases.length > 0 && <details open style={{ marginBottom: 16 }}>
                <summary style={{ cursor: "pointer", fontWeight: 650 }}>Whole-kitchen purchase quantities</summary>
                <p style={{ color: "var(--mut)", fontSize: 12 }}>Same items are combined across all cabinets and panels after wastage, then quantities are rounded to two decimal places for purchasing and costing—not up to whole units. Boards and laminates use 32 sqft sheets; adhesives use kg. Different quoted rates remain separate. Processing remains charged on billable sqft.</p>
                <Tbl head={["Category", "Item", "Unit", "Purchase qty", "Rate (Rs)", "Amount (Rs)"]} num={[3, 4, 5]}
                  rows={costing.purchases.map((item) => [item.categories.join(", "), `${item.itemCode} · ${item.item}`, item.unit,
                    item.quantity.toFixed(2), item.categories.some((category) => /processing$/i.test(category)) ? String(item.rate) : item.rate.toFixed(2), item.amount.toFixed(2)])} />
              </details>}
              {shownCosting.lines.length === 0 ? <div className="empty">No costed items for this elevation.</div> : <>
                <Tbl head={[<ColumnFilter key="cost-cabinet" label="Cabinet" options={cabinetCodeOptions}
                  selected={projectLineFilters.Cabinet ?? []}
                  onChange={(values) => setProjectLineFilters((current) => ({ ...current, Cabinet: values }))}
                  sortDirection={projectLineSort?.column === "Cabinet" ? projectLineSort.direction : null}
                  onSort={(direction) => setProjectLineSort({ column: "Cabinet", direction })} />, "Qty", "Per item (Rs)", "Total (Rs)"]} num={[1, 2, 3]}
                  rows={[
                    ...shownCosting.lines.filter((c) => !c.code || matchingCabinetCodes.has(c.code))
                      .sort((a, b) => a.code && b.code && projectLineSort?.column === "Cabinet"
                        ? a.code.localeCompare(b.code, undefined, { numeric: true }) * (projectLineSort.direction === "asc" ? 1 : -1) : 0).map((c) => [
                      <details key={c.label}>
                        <summary style={{ cursor: "pointer", color: "var(--acc)", fontWeight: 650 }}>{c.label}</summary>
                        <div style={{ margin: "10px 0 4px", overflowX: "auto" }}>
                          <table style={{ width: "100%", minWidth: 1040, borderCollapse: "collapse", fontSize: 11 }}>
                            <thead><tr>{["Category", "Master row", "Actual item code / board used", "Board type / thickness", "Total sqft / qty", "Waste", "Allocated purchase qty", "Basis", "Rate (Rs)", "Allocated amount (Rs)"].map((heading) => <th key={heading} style={{ padding: "6px 7px", background: "#EEF1EE", border: "1px solid #D8DEDA", textAlign: "left" }}>{heading}</th>)}</tr></thead>
                            <tbody>{c.details.map((detail, index) => <tr key={`${detail.category}-${detail.item}-${index}`}>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.category}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", whiteSpace: "nowrap", fontWeight: 650 }}>{detail.itemCode}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.item}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.specification}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{detail.netQty.toFixed(2)}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{detail.wastePct}%</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{(detail.allocatedBillableQty ?? detail.billableQty).toFixed(2)}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.uom}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{/processing$/i.test(detail.category) ? String(detail.rate) : detail.rate.toFixed(2)}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right", fontWeight: 650 }}>{detail.amount.toFixed(2)}</td>
                            </tr>)}</tbody>
                            <tfoot><tr><td colSpan={9} style={{ padding: "7px", textAlign: "right", fontWeight: 700 }}>Cabinet line total</td><td style={{ padding: "7px", textAlign: "right", fontWeight: 700 }}>{c.cost.toFixed(2)}</td></tr></tfoot>
                          </table>
                        </div>
                      </details>,
                      c.qty, c.unitCost.toFixed(2), c.cost.toFixed(2),
                    ]),
                    [<b key="t">{activeElevation === null ? "Project costing total" : `${activeElevation} costing total`}{shownCosting.unpriced.length > 0 ? " (incomplete — rates or quantities pending)" : ""}</b>, "", "", <b key="v">{shownCosting.total.toFixed(2)}</b>],
                  ]} />
                {shownCosting.unpriced.length > 0 && (
                  <Stub list={shownCosting.unpriced.map((u) => u.includes("(quantity pending)")
                    ? `${u} — required hardware; quantity not specified and cost not included.`
                    : u.includes("(reference accessory)")
                    ? `${u} — enter a manual rate in Accessories to include it in the total.`
                    : `${u} — RATE REQUIRED. Listed in the costing, but excluded from the amount until a matching master price is supplied.`)} />
                )}
                <div style={{ marginTop: 18, padding: 16, border: "1px solid #D8DEDA", borderRadius: 8, background: "#FAFBFA" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0 }}>Project pricing</h3>
                    <button type="button" className="add" style={{ width: "auto", padding: "8px 12px" }} onClick={openPricingModal}>Admin · Edit processing costs &amp; factors</button>
                  </div>
                  <p style={{ margin: "0 0 14px", color: "#617069", fontSize: 12 }}>
                    Per-sqft charges use {shownPricing.totalSqft.toFixed(2)} sqft: {shownPricing.cabinetSqft.toFixed(2)} cabinet sqft + {shownPricing.fillerSqft.toFixed(2)} filler-front sqft + {shownPricing.counterPlySqft.toFixed(2)} Counter Ply sqft. Base and Tall cabinets use width × (height + 100mm) × quantity; fillers use only front width × height × quantity; Counter Ply uses length × the thickness entered in its section × quantity ÷ 92903. Cover-panel carcass strips remain in material costing but are excluded from visible sqft.
                  </p>

                  <div style={{ marginTop: 14, overflowX: "auto" }}>
                    <table style={{ width: "100%", minWidth: 940, borderCollapse: "collapse", background: "white", fontSize: 12 }}>
                      <thead><tr>{["Cabinet / filler / Counter Ply", "Qty", "Sqft / item", "Total sqft", "Transportation", "Installation", "Loading / Unloading"].map((heading) => <th key={heading} style={{ padding: "7px 9px", background: "#EEF1EE", border: "1px solid #D8DEDA", textAlign: heading === "Cabinet / filler / Counter Ply" ? "left" : "right" }}>{heading === "Cabinet / filler / Counter Ply" ? <ColumnFilter label="Cabinet" options={cabinetCodeOptions}
                        selected={projectLineFilters.Cabinet ?? []} onChange={(values) => setProjectLineFilters((current) => ({ ...current, Cabinet: values }))}
                        sortDirection={projectLineSort?.column === "Cabinet" ? projectLineSort.direction : null}
                        onSort={(direction) => setProjectLineSort({ column: "Cabinet", direction })} /> : heading}</th>)}</tr></thead>
                      <tbody>{shownPricing.allocatedCharges.map((line, index) => ({ line, code: shownProject[index]?.m.code ?? "", index }))
                        .filter(({ code }) => matchingCabinetCodes.has(code))
                        .sort((a, b) => projectLineSort?.column === "Cabinet" ? a.code.localeCompare(b.code, undefined, { numeric: true }) * (projectLineSort.direction === "asc" ? 1 : -1) : 0)
                        .map(({ line, index }) => <tr key={`${line.label}-${index}`}>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4" }}>{line.label}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.qty}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.eachSqft.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.sqft.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.transportation.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.installation.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.loading.toFixed(2)}</td>
                      </tr>)}{shownPricing.fillerCharges.map((line, index) => <tr key={`filler-${index}`}>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4" }}>{line.label}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.qty}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.eachSqft.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.sqft.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.transportation.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.installation.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.loading.toFixed(2)}</td>
                      </tr>)}{shownPricing.counterPlyCharges.map((line, index) => <tr key={`counter-ply-${index}`}>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4" }}>{line.label}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.qty}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.eachSqft.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.sqft.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.transportation.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.installation.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.loading.toFixed(2)}</td>
                      </tr>)}</tbody>
                      <tfoot><tr>
                        <td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", fontWeight: 750 }}>{activeElevation === null ? "Cabinets + filler panels + Counter Ply total" : `${activeElevation} cabinets + filler panels`}</td>
                        <td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right", fontWeight: 750 }}>{shownProject.reduce((sum, line) => sum + line.qty, 0) + shownPricing.fillerCharges.reduce((sum, line) => sum + line.qty, 0) + shownPricing.counterPlyCharges.reduce((sum, line) => sum + line.qty, 0)}</td>
                        <td style={{ padding: "8px 9px", border: "1px solid #D8DEDA" }} />
                        <td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right", fontWeight: 750 }}>{shownPricing.totalSqft.toFixed(2)}</td>
                        <td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right", fontWeight: 750 }}>Rs {shownPricing.transportation.toFixed(2)}</td>
                        <td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right", fontWeight: 750 }}>Rs {shownPricing.installation.toFixed(2)}</td>
                        <td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right", fontWeight: 750 }}>Rs {shownPricing.loading.toFixed(2)}</td>
                      </tr></tfoot>
                    </table>
                    {(projectPricingInputs.transportation.mode === "direct" || projectPricingInputs.installation.mode === "direct" || projectPricingInputs.loading.mode === "direct") && (
                      <p style={{ margin: "6px 0 0", color: "#617069", fontSize: 11 }}>Direct service prices are allocated across cabinets, filler panels and Counter Ply in proportion to their area.</p>
                    )}
                  </div>

                  <div style={{ marginTop: 16, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", background: "white" }}>
                      <tbody>{[
                        ["Base cabinet / item costing (includes filler panels)", shownPricing.baseCost],
                        ["Filler panel material costing, including sides (included above)", shownCosting.lines.slice(shownProject.length, shownProject.length + shownFillers.reduce((sum, filler) => sum + fillerPanelCount(filler), 0)).reduce((sum, line) => sum + line.cost, 0)],
                        [`Conversion (${Number(projectPricingInputs.conversionPct || 0).toFixed(2)}%)`, shownPricing.conversion],
                        [`Profit (${Number(projectPricingInputs.profitPct || 0).toFixed(2)}% of cost after conversion)`, shownPricing.profit],
                        [`Transportation${projectPricingInputs.transportation.mode === "sqft" ? ` (${Number(projectPricingInputs.transportation.value || 0).toFixed(2)} / sqft)` : " (direct)"}`, shownPricing.transportation],
                        [`Installation${projectPricingInputs.installation.mode === "sqft" ? ` (${Number(projectPricingInputs.installation.value || 0).toFixed(2)} / sqft)` : " (direct)"}`, shownPricing.installation],
                        [`Loading / Unloading${projectPricingInputs.loading.mode === "sqft" ? ` (${Number(projectPricingInputs.loading.value || 0).toFixed(2)} / sqft)` : " (direct)"}`, shownPricing.loading],
                      ].map(([label, amount]) => <tr key={String(label)}>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4" }}>{label}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {Number(amount).toFixed(2)}</td>
                      </tr>)}</tbody>
                      <tfoot>
                        <tr><td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", fontWeight: 700 }}>Subtotal before tax</td><td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right", fontWeight: 700 }}>Rs {shownPricing.subtotal.toFixed(2)}</td></tr>
                        <tr><td style={{ padding: "8px 9px", border: "1px solid #D8DEDA" }}>GST (18%){projectPricingInputs.includeTax ? "" : " — not included"}</td><td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right" }}>Rs {shownPricing.tax.toFixed(2)}</td></tr>
                        <tr style={{ background: "#E8F3EF", color: "#126350" }}><td style={{ padding: "10px 9px", border: "1px solid #BED8CF", fontWeight: 800 }}>{activeElevation === null ? "Final project price" : `${activeElevation} price`}</td><td style={{ padding: "10px 9px", border: "1px solid #BED8CF", textAlign: "right", fontWeight: 800, fontSize: 16 }}>Rs {shownPricing.grandTotal.toFixed(2)}</td></tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </>}

              {/* ---- Raw Material Selection ---- */}
              <SecHead title="Raw Material Selection" />
              {shownBoardTotals.length === 0 ? <div className="empty">No boards for this elevation.</div> :
                <Tbl head={["Material", "Thk", "Sqft (+waste)", "Zoho item", "Stock", ""]} num={[1, 2]}
                  rows={shownBoardTotals.filter((b) => !/glass/i.test(b.mat)).map((b) => {
                    const key = b.key;
                    const rs = rawMap[key];
                    const selItem = rs?.items.find((i) => i.item_id === rs.sel);
                    return [`${b.mat} · ${b.finish} · ${b.pack} · ${b.sheetAreaSqft} sqft/${b.mat === COSTING_ITEMS.find((item) => item.id === SINK_STONE_BOARD_ID)?.materialDescription ? "slab" : "sheet"} · ₹${b.rate.toFixed(2)}/sqft`, b.t, b.billableSqft.toFixed(2),
                      rs?.loading ? "loading…"
                        : rs?.error ? <span key="e" style={{ color: "var(--flag)" }}>{rs.error}</span>
                        : rs?.items.length ? (
                          <select key="s" value={rs.sel} onChange={(e) => setRawMap((m0) => ({ ...m0, [key]: { ...rs, sel: e.target.value } }))}>
                            {rs.items.map((i) => <option key={i.item_id} value={i.item_id}>{i.name}{i.sku ? ` (${i.sku})` : ""}</option>)}
                          </select>
                        ) : "—",
                      selItem?.stock_on_hand ?? "—",
                      <button key="f" className="x" style={{ color: "var(--acc)" }} onClick={() => findRaw(key, b.mat, b.t)}>
                        {rs ? "retry" : "find in Zoho"}</button>];
                  })} />}

              {/* ---- Stock Check ---- */}
              <SecHead title="Stock Check">
                <button className="add" style={{ width: "auto", padding: "6px 14px" }} disabled={stockRunning || stockNames.length === 0}
                  onClick={runStockCheck}>{stockRunning ? "Checking…" : "Check Stock"}</button>
              </SecHead>
              {stockNames.length === 0 ? <div className="empty">Add cabinets first — hardware and consumables are checked against Zoho stock.</div> :
                <Tbl head={["Item", "Required", "In Stock", "Status"]} num={[1, 2]}
                  rows={stockNames.map(({ name, req }) => {
                    const s = stockMap[name];
                    const stock = s?.stock;
                    return [name, req,
                      s?.loading ? "…" : stock ?? "—",
                      s?.loading ? "checking" : stock == null ? "unknown"
                        : stock >= req ? "in stock" : `deficit ${r3(req - stock)}`];
                  })} />}

              {/* ---- Downloads ---- */}
              <SecHead title="Downloads" />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={costing.lines.length === 0 || !kitchenName.trim()}
                  onClick={() => exportCostingWorkbook(costing.lines, [
                    ...projectPricing.allocatedCharges,
                    ...projectPricing.fillerAreaSlots,
                    ...visiblePanels.map(() => ({ eachSqft: 0, sqft: 0 })),
                    ...projectPricing.counterPlyCharges,
                  ], projectPricing, costing.unpriced, projectPricingInputs, kitchenName.trim())}>Costing (.xlsx)</button>
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={kitchens.length < 2} onClick={downloadBulkCosting}>Combined costing (.xlsx)</button>
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={project.length === 0}
                  onClick={() => dl("wood-bom-project.json", JSON.stringify({ format: PROJECT_FILE_FORMAT, rows: projectSetup }, null, 2), "application/json")}>Project JSON</button>
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={fullBom.length === 0}
                  onClick={() => exportBomWorkbook(toReportRows(fullBom), accessoryRows, projectSetup, costing.purchases)}>Excel BOM (.xlsx)</button>
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={project.length === 0 && extras.panels.length === 0}
                  onClick={() => exportPanelCalculatorWorkbook(project, extras.panels, waste)}>Panel list &amp; laminate calculator (.xlsx)</button>
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={fullBom.length === 0}
                  onClick={() => exportBomCsv(toReportRows(fullBom))}>Full BOM (.csv)</button>
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={project.length === 0}
                  onClick={() => dl("wood-bom.csv", buildCSV(project), "text/csv")}>Raw CSV</button>
              </div>
              <div style={{ marginTop: 12 }}>
                <label htmlFor="project-import" style={{ display: "block", fontWeight: 650, marginBottom: 6 }}>Import project from an exported Excel BOM or printed PDF</label>
                <input id="project-import" type="file" accept=".xlsx,.xls,.csv,.json,.pdf" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importFile(file);
                  event.target.value = "";
                }} />
                <Hint>Import replaces the current project. A printed PDF with Project restore data restores its exact cabinet materials and fills those choices on Material Selection. Older PDFs without restore data use the current kitchen selections. Excel BOM and JSON files restore their saved choices.</Hint>
                {importMessage && <p role="status" style={{ color: "var(--acc)" }}>{importMessage}</p>}
                {importError && <p role="alert" style={{ color: "var(--flag)" }}>{importError}</p>}
              </div>

              <datalist id="elev-list">{ELEVATIONS.map((x) => <option key={x} value={x} />)}</datalist>
              {allStubs.length > 0 && <Stub list={allStubs} />}
            </div>
          )}
        </main>
      </div>
      {bulkHeightOpen && <div className="pricing-overlay" onKeyDown={(event) => { if (event.key === "Escape") setBulkHeightOpen(false); }}>
        <section className="pricing-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-height-title" style={{ maxWidth: 480 }}>
          <div className="pricing-modal-header">
            <div><h2 id="bulk-height-title">Edit cabinet height</h2><p>{selectedProjectLines.length} selected cabinet{selectedProjectLines.length === 1 ? "" : "s"} · same type only</p></div>
            <button type="button" className="x" aria-label="Close bulk height popup" onClick={() => setBulkHeightOpen(false)}>✕</button>
          </div>
          <label htmlFor="bulk-cabinet-height" style={{ display: "block", marginTop: 20, fontWeight: 650 }}>New height · mm</label>
          <input id="bulk-cabinet-height" type="number" min={1} step={1} autoFocus value={bulkHeightInput}
            onChange={(event) => setBulkHeightInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applySelectedHeight(); }} />
          <p className="hint">Only the selected cabinet lines will change. Their codes, panels, BOM and costing will be recalculated. Default shelf quantities follow the new height; custom quantities stay unchanged.</p>
          <div className="pricing-modal-footer" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="x" onClick={() => setBulkHeightOpen(false)}>Cancel</button>
            <button type="button" className="add" disabled={!Number.isSafeInteger(Number(bulkHeightInput)) || Number(bulkHeightInput) <= 0 || selectedProjectLines.length === 0}
              onClick={applySelectedHeight}>Apply height</button>
          </div>
        </section>
      </div>}
      {pricingModalOpen && <div className="pricing-overlay" onKeyDown={(event) => { if (event.key === "Escape") setPricingModalOpen(false); }}>
        <section className="pricing-modal" role="dialog" aria-modal="true" aria-labelledby="pricing-modal-title">
          <div className="pricing-modal-header">
            <div><h2 id="pricing-modal-title">Processing costs &amp; costing factors</h2><p>Admin only · material types used in this kitchen</p></div>
            <button type="button" className="x" aria-label="Close pricing popup" onClick={() => setPricingModalOpen(false)}>✕</button>
          </div>
          {!pricingAdminUnlocked ? <div className="pricing-auth">
            <label htmlFor="pricing-admin-password">Admin password</label>
            <input id="pricing-admin-password" type="password" autoFocus value={pricingAdminPassword}
              onChange={(event) => setPricingAdminPassword(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void unlockPricingModal(); }} />
            <button type="button" className="add" style={{ width: "auto" }} disabled={pricingAdminChecking || !pricingAdminPassword.trim()}
              onClick={() => void unlockPricingModal()}>{pricingAdminChecking ? "Checking…" : "Unlock admin controls"}</button>
          </div> : <>
            <h3>Change materials for all cabinets in this kitchen</h3>
            <p className="hint">Optional one-time change. Choose a type and its exact board in each category you want to replace. Saving rebuilds the affected cabinets and recalculates their BOM and cost; future kitchen defaults are unchanged.</p>
            {PROCESSING_CATEGORIES.filter((category) => processingBoards.some((row) => row.category === category)).map((category) => {
              const availableItems = materialItemsForCategory(category);
              const availableTypes = PROCESSING_TYPES.filter((type) => availableItems.some((item) => processingType(item) === type));
              const selectedType = replacementTypes[category] ?? "";
              return <div key={category} className="pricing-board-group">
                <h4>{category}</h4>
                <div className="pricing-type-row">
                  <Fld label="Material type"><select aria-label={`${category} replacement material type`} value={selectedType}
                    onChange={(event) => {
                      const value = event.target.value as ProcessingType | "";
                      setReplacementTypes((old) => ({ ...old, [category]: value || undefined }));
                      setReplacementItems((old) => ({ ...old, [category]: undefined }));
                      if (value) setSelectedProcessingTypes((old) => ({ ...old, [category]: value }));
                    }}>
                    <option value="">Keep current materials</option>
                    {availableTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select></Fld>
                  <Fld label="Exact board / subgroup"><select aria-label={`${category} replacement board`} value={replacementItems[category] ?? ""} disabled={!selectedType}
                    onChange={(event) => setReplacementItems((old) => ({ ...old, [category]: event.target.value || undefined }))}>
                    <option value="">Choose a board</option>
                    {availableItems.filter((item) => processingType(item) === selectedType).map((item) =>
                      <option key={item.id} value={item.id}>{item.subgroup} · {item.thicknessMm ?? "—"}mm · {item.id}</option>)}
                  </select></Fld>
                </div>
              </div>;
            })}
            <h3>Board processing costs</h3>
            <p className="hint">Select a current or replacement material type to edit its processing rate. Each type keeps a separate rate within its category, charged on the same billable sqft (+ wastage) shown in Raw Material Selection.</p>
            {displayedProcessingTypes.length === 0 ? <div className="empty">Add cabinets to list their material types.</div> :
              PROCESSING_CATEGORIES.filter((category) => displayedProcessingTypes.some((row) => row.category === category)).map((category) =>
                <div key={category} className="pricing-board-group">
                  <h4>{category}</h4>
                  {(() => {
                    const types = displayedProcessingTypes.filter((row) => row.category === category).map((row) => row.type);
                    const type = selectedProcessingTypes[category] && types.includes(selectedProcessingTypes[category])
                      ? selectedProcessingTypes[category] : types[0];
                    const key = processingKey(category, type);
                    return <div className="pricing-type-row">
                      <Fld label="Material type"><select aria-label={`${category} material type`} value={type}
                        onChange={(event) => setSelectedProcessingTypes((old) => ({ ...old, [category]: event.target.value as ProcessingType }))}>
                        {types.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select></Fld>
                      <Fld label="Processing · Rs/sqft"><input type="number" min={0} step="0.00001" inputMode="decimal"
                        aria-label={`${category} ${type} processing cost per sqft`} value={draftProcessingRates[key] ?? ""} placeholder="0"
                        onChange={(event) => setDraftProcessingRates((old) => ({ ...old, [key]: event.target.value }))} /></Fld>
                    </div>;
                  })()}
                </div>)}
            <div className="pricing-board-group">
              <h4>Counter Ply</h4>
              <Fld label="Processing · Rs/sqft"><input type="number" min={0} step="0.00001" inputMode="decimal"
                aria-label="Counter Ply processing cost per sqft" value={draftProcessingRates["Counter Ply"] ?? ""}
                onChange={(event) => setDraftProcessingRates((old) => ({ ...old, "Counter Ply": event.target.value }))} /></Fld>
              <p className="hint">Charged on length × depth × quantity ÷ 92903, separately from the Counter Ply board price.</p>
            </div>
            <h3 style={{ marginTop: 22 }}>Costing factors</h3>
            <p className="hint">Per-sqft service charges use cabinet front area plus only the filler front area. Cover-panel carcass strips remain in material costing but do not add to total area. Base and Tall cabinets add 100mm to their height for this calculation.</p>
            <div className="pricing-factor-grid">
              <Fld label="Profit (%)"><input type="number" min={0} step="0.01" value={draftPricing.profitPct} placeholder="0"
                onChange={(event) => setDraftPricing((old) => ({ ...old, profitPct: event.target.value === "" ? "" : Number(event.target.value) }))} /></Fld>
              {([ ["Transportation", "transportation"], ["Installation", "installation"], ["Loading / Unloading", "loading"] ] as const).map(([label, key]) =>
                <Fld key={key} label={label}><div className="pricing-charge">
                  <select aria-label={`${label} calculation method`} value={draftPricing[key].mode}
                    onChange={(event) => setDraftPricing((old) => ({ ...old, [key]: { ...old[key], mode: event.target.value as ChargeMode } }))}>
                    <option value="direct">Direct price</option><option value="sqft">Rs / sqft</option>
                  </select>
                  <input type="number" min={0} step="0.01" aria-label={`${label} rate`} value={draftPricing[key].value} placeholder="0"
                    onChange={(event) => setDraftPricing((old) => ({ ...old, [key]: { ...old[key], value: event.target.value === "" ? "" : Number(event.target.value) } }))} />
                </div></Fld>)}
              {Number(draftPricing.conversionPct || 0) > 0 && <Fld label="Legacy conversion (%)"><input type="number" min={0} step="0.01" value={draftPricing.conversionPct}
                onChange={(event) => setDraftPricing((old) => ({ ...old, conversionPct: event.target.value === "" ? "" : Number(event.target.value) }))} /></Fld>}
            </div>
            <label className="pricing-gst"><input type="checkbox" checked={draftPricing.includeTax}
              onChange={(event) => setDraftPricing((old) => ({ ...old, includeTax: event.target.checked }))} /> Include GST (18%)</label>
          </>}
          {pricingAdminError && <p role="alert" className="pricing-error">{pricingAdminError}</p>}
          <div className="pricing-modal-footer">
            <span className="hint">Use Project JSON or Excel BOM export to keep these prices after refresh.</span>
            <div><button type="button" className="x" onClick={() => setPricingModalOpen(false)}>Cancel</button>
              {pricingAdminUnlocked && <button type="button" className="add" style={{ width: "auto" }} onClick={savePricingModal}>Save changes</button>}</div>
          </div>
        </section>
      </div>}
      <section className="print-data" aria-label="Project restore data">
        <h2>Project restore data</h2>
        <p>Keep this final page when saving or printing to PDF. It lets the Builder restore cabinet and project details, including the saved material choices and prices, when the PDF is imported.</p>
        {printRestoreLines.map((line) => <div className="print-data-line" key={line.slice(0, 11)}>{line}</div>)}
      </section>
    </div>
  );
}

export default WoodBomBuilder;

/* ------------------------------------------------------------------ */
/*  Small presentational helpers                                       */
/* ------------------------------------------------------------------ */

function AccessoryPicker({ rowId, selectedLabel, selectedId, onSelect, onCustom }: {
  rowId: number;
  selectedLabel: string;
  selectedId: string;
  onSelect: (id: string) => void;
  onCustom: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const matches = search ? MASTER_ACCESSORY_ITEMS.filter((item) =>
    `${item.subgroup} ${item.materialDescription} ${item.brand} ${item.id}`.toLowerCase().includes(search)) : MASTER_ACCESSORY_ITEMS;
  const listId = `accessory-options-${rowId}`;
  return <div className="accessory-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <input type="search" role="combobox" aria-label="Search or add accessory" aria-expanded={open} aria-controls={listId}
      aria-autocomplete="list" placeholder="Search or add accessory"
      value={open ? query : selectedLabel}
      onFocus={() => { setQuery(""); setOpen(true); }}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); event.currentTarget.blur(); }
        if (event.key === "Enter" && open) {
          event.preventDefault();
          if (matches.length) onSelect(matches[0].id);
          else if (query.trim()) onCustom(query.trim());
          setOpen(false);
        }
      }} />
    {open && <div id={listId} role="listbox" className="accessory-options">
      {matches.map((item) => <button key={item.id} type="button" role="option" aria-selected={item.id === selectedId}
        onClick={() => { onSelect(item.id); setOpen(false); }}>
        <strong>{item.subgroup}</strong><span>{item.materialDescription}</span>
        <small>{item.priced ? `₹${item.currentRate.toFixed(2)} / ${item.rateBasis}` : "Enter rate manually"}</small>
      </button>)}
      {query.trim() && <button type="button" className="accessory-create" onClick={() => { onCustom(query.trim()); setOpen(false); }}>
        + Add new accessory “{query.trim()}”
      </button>}
    </div>}
  </div>;
}

const Fld = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="fld"><label>{label}</label>{children}</div>
);
const Hint = ({ children }: { children: ReactNode }) => <p className="hint">{children}</p>;
const Seg = ({ opts, val, set }: { opts: [string, string][]; val: string; set: (v: string) => void }) => (
  <div className="seg">{opts.map(([k, l]) => (
    <button key={k} type="button" aria-pressed={val === k} className={val === k ? "on" : ""} onClick={() => set(k)}>{l}</button>
  ))}</div>
);
const SecHead = ({ title, onAdd, children }: { title: string; onAdd?: () => void; children?: ReactNode }) => (
  <h4 style={{ display: "flex", alignItems: "center", gap: 10 }}>
    {title}
    {onAdd && <button className="x" style={{ color: "var(--acc)" }} onClick={onAdd}>+ add row</button>}
    {children}
  </h4>
);
const Stub = ({ list }: { list: string[] }) => (
  <div className="stub">
    <h5>Not yet specified</h5>
    <ul>{list.map((s, i) => <li key={i}>{s}</li>)}</ul>
  </div>
);
const ColumnFilter = ({ label, options, selected, onChange, sortDirection, onSort }: {
  label: string; options: string[]; selected: string[]; onChange: (values: string[]) => void;
  sortDirection: "asc" | "desc" | null; onSort: (direction: "asc" | "desc") => void;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const matches = options.filter((option) => option.toLowerCase().includes(query.trim().toLowerCase()));
  return <span className="column-filter-heading">
    <span>{label}</span>
    <button type="button" className={`column-filter-trigger${selected.length || sortDirection ? " active" : ""}`}
      aria-label={`Filter ${label}`} aria-expanded={open} title={`Filter ${label}`}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 438)),
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 336)) });
        setOpen((value) => !value);
      }}>▾</button>
    {open && createPortal(<div className="column-filter-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="column-filter-menu" role="dialog" aria-label={`Filter ${label} values`}
        style={{ top: position.top, left: position.left }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="column-filter-actions">
          <button type="button" aria-pressed={sortDirection === "asc"} onClick={() => { onSort("asc"); setOpen(false); }}>Sort ascending</button>
          <button type="button" aria-pressed={sortDirection === "desc"} onClick={() => { onSort("desc"); setOpen(false); }}>Sort descending</button>
        </div>
        <input type="search" autoFocus aria-label={`Search ${label} values`} placeholder={`Search ${label.toLowerCase()}…`}
          value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="column-filter-options">
          {matches.length ? matches.map((option) => <label key={option}>
            <input type="checkbox" checked={selected.includes(option)} onChange={(event) => onChange(event.target.checked
              ? [...selected, option] : selected.filter((value) => value !== option))} />
            <span title={option}>{option}</span>
          </label>) : <p>No matching values</p>}
        </div>
        <div className="column-filter-actions">
          <button type="button" onClick={() => onChange(matches.length === options.length ? [] : matches)}>Select matches</button>
          <button type="button" onClick={() => { onChange([]); setQuery(""); }}>Clear</button>
          <button type="button" onClick={() => setOpen(false)}>Done</button>
        </div>
      </div>
    </div>, document.body)}
  </span>;
};
const Tbl = ({ head, rows, num = [] }: { head: ReactNode[]; rows: ReactNode[][]; num?: number[] }) => (
  <div className="tw"><table>
    <thead><tr>{head.map((h, i) => <th key={i} className={num.includes(i) ? "n" : ""}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => (
      <tr key={i}>{r.map((c, j) => <td key={j} className={num.includes(j) ? "n" : ""}>{c}</td>)}</tr>
    ))}</tbody>
  </table></div>
);

const CSS = `
.wbb{--paper:#F4F5F3;--ink:#1B2430;--mut:#66757F;--line:#D8DEDA;--pnl:#FFF;--acc:#15645A;--flag:#9C5510;--flagbg:#FBF2E6;
 background:var(--paper);color:var(--ink);min-height:100vh;font-family:"Inter","Segoe UI",system-ui,sans-serif;
 font-size:13px;line-height:1.5;font-variant-numeric:tabular-nums}
.wbb *{box-sizing:border-box}
.hd{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;padding:18px 24px;
 background:var(--pnl);border-bottom:2px solid var(--ink)}
.hd h1{margin:0;font-size:19px;font-weight:650;letter-spacing:-.015em}
.hd p{margin:3px 0 0;color:var(--mut);font-size:12px}
.hd-n{display:flex;gap:22px}
.hd-n span{color:var(--mut);font-size:11px}
.hd-n b{display:block;font-size:20px;color:var(--acc);font-weight:650}
.hd-actions{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
.hd-actions .add{width:auto;padding:8px 12px}
.header-import-error,.header-import-success{margin:8px 24px;padding:9px 12px;border-radius:3px;font-size:12px}
.header-import-error{color:#9C5510;background:#FBF2E6}
.header-import-success{color:#15645A;background:#E9F5F1}
.print-data{display:none}
.body{display:flex;align-items:flex-start;flex-wrap:wrap}
.rail{width:318px;flex:0 0 318px;padding:18px;background:var(--pnl);border-right:1px solid var(--line)}
.rail h2{margin:0 0 14px;font-size:12px;font-weight:650;color:var(--mut)}
.fld{margin-bottom:14px}
.fld label{display:block;font-size:11px;font-weight:600;color:var(--mut);margin-bottom:5px}
.wbb select,.wbb input{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:3px;background:#fff;
 font:inherit;font-size:12.5px;color:var(--ink)}
.accessory-picker{min-width:340px;max-width:560px}
.accessory-picker input{width:100%;text-overflow:ellipsis}
.accessory-options{max-height:240px;overflow-y:auto;margin-top:4px;border:1px solid var(--line);border-radius:4px;background:#fff}
.accessory-options button{display:block;width:100%;padding:7px 9px;border:0;border-bottom:1px solid var(--line);background:#fff;text-align:left;color:var(--ink);font:inherit;cursor:pointer;white-space:normal;overflow-wrap:anywhere}
.accessory-options button:hover,.accessory-options button:focus-visible,.accessory-options button[aria-selected="true"]{background:#E9F5F1}
.accessory-options button strong{display:block;font-weight:650}
.accessory-options button span,.accessory-options button small{display:block;color:var(--mut)}
.accessory-options .accessory-create{color:var(--acc);font-weight:650}
.accessory-custom-fields{display:flex;gap:6px;margin-top:5px}
.accessory-custom-fields select{width:82px;flex:0 0 82px}
.wbb select:focus,.wbb input:focus{outline:2px solid var(--acc);outline-offset:-1px}
.hint{margin:5px 0 0;font-size:11px;color:var(--mut)}
.seg{display:flex;border:1px solid var(--line);border-radius:3px;overflow:hidden}
.seg button{flex:1;padding:7px 4px;border:0;background:#fff;font:inherit;font-size:12px;cursor:pointer;color:var(--mut)}
.seg button+button{border-left:1px solid var(--line)}
.seg button.on{background:var(--acc);color:#fff;font-weight:600}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.add{width:100%;padding:10px;border:0;border-radius:3px;background:var(--acc);color:#fff;font:inherit;
 font-weight:600;font-size:13px;cursor:pointer}
.add:hover{background:#0F4F47}
.add:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.code{margin-top:10px;padding:8px;background:var(--paper);border:1px solid var(--line);border-radius:3px;
 font-size:11px;color:var(--mut);text-align:center;word-break:break-all}
.out{flex:1;min-width:340px;padding-bottom:40px}
.tabs{display:flex;align-items:center;background:var(--pnl);border-bottom:1px solid var(--line);padding:0 16px}
.tabs button{padding:12px 15px;border:0;background:none;font:inherit;font-size:13px;color:var(--mut);cursor:pointer;
 border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs button.on{color:var(--ink);font-weight:600;border-bottom-color:var(--acc)}
.dls{margin-left:auto;display:flex;gap:4px}
.dls button{color:var(--acc);font-weight:600}
.pane{padding:20px 24px}
.pane h3{margin:0 0 14px;font-size:15px;font-weight:650}
.pane h4{margin:24px 0 9px;font-size:11px;font-weight:650;color:var(--mut)}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:3px;background:var(--pnl)}
.wbb table{width:100%;border-collapse:collapse;font-size:12.5px}
.wbb th{text-align:left;padding:9px 11px;background:var(--paper);border-bottom:1px solid var(--line);
 font-size:11px;font-weight:650;color:var(--mut);white-space:nowrap}
.wbb td{padding:8px 11px;border-bottom:1px solid var(--line)}
.wbb tr:last-child td{border-bottom:0}
.wbb th.n,.wbb td.n{text-align:right}
.column-filter-heading{display:inline-flex;align-items:center;justify-content:space-between;gap:7px;min-width:100%}
.column-filter-trigger{border:1px solid transparent;border-radius:3px;background:transparent;color:#617069;cursor:pointer;padding:1px 5px;font-size:13px;line-height:1.2}
.column-filter-trigger:hover,.column-filter-trigger.active{border-color:#9DBCB0;background:#E2F0EA;color:#126350}
.column-filter-backdrop{position:fixed;inset:0;z-index:2000}
.column-filter-menu{position:fixed;width:min(328px,calc(100vw - 16px));max-height:min(430px,calc(100vh - 24px));display:flex;flex-direction:column;gap:10px;padding:12px;background:#fff;color:#1B2430;border:1px solid #C9D3CE;border-radius:7px;box-shadow:0 12px 32px #0003;font-size:12px}
.column-filter-menu>input{width:100%;min-height:34px;padding:6px 9px;border:1px solid #C9D3CE;border-radius:4px;font:inherit}
.column-filter-options{overflow:auto;min-height:0;max-height:280px;border:1px solid #E1E7E3;border-radius:4px}
.column-filter-options label{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;cursor:pointer;overflow-wrap:anywhere}
.column-filter-options label+label{border-top:1px solid #EDF0EE}
.column-filter-options input{margin-top:2px;flex:none}
.column-filter-options p{padding:8px;margin:0;color:#66757F}
.column-filter-actions{display:flex;justify-content:space-between;gap:5px}
.column-filter-actions button{border:1px solid #C9D3CE;border-radius:4px;background:#F7F9F7;padding:5px 8px;cursor:pointer;color:#126350;font:inherit}
.x{border:0;background:none;color:var(--flag);font:inherit;font-size:11.5px;cursor:pointer;padding:0}
.empty{padding:44px 20px;text-align:center;color:var(--mut);background:var(--pnl);border:1px dashed var(--line);border-radius:3px}
.stub{margin-top:22px;padding:13px 16px;background:var(--flagbg);border-left:3px solid var(--flag);border-radius:0 3px 3px 0}
.stub h5{margin:0 0 7px;font-size:12px;font-weight:650;color:var(--flag)}
.stub ul{margin:0;padding-left:17px}
.stub li{margin-bottom:4px;font-size:12px}
.pricing-overlay{position:fixed;inset:0;z-index:1000;background:#14251b99;display:flex;justify-content:center;align-items:flex-start;overflow-y:auto;padding:24px 12px}
.pricing-modal{width:min(960px,100%);background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 50px #0003;padding:20px;color:var(--ink)}
.pricing-modal-header,.pricing-modal-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.pricing-modal-header{border-bottom:1px solid var(--line);padding-bottom:14px}
.pricing-modal-header h2{margin:0;font-size:18px}
.pricing-modal-header p{margin:4px 0 0;color:var(--mut);font-size:12px}
.pricing-modal-header .x{font-size:20px;color:var(--ink);padding:5px 9px}
.pricing-modal h3{margin:18px 0 4px;font-size:15px}
.pricing-modal .hint{margin:4px 0 10px}
.pricing-auth{display:flex;align-items:end;gap:10px;margin:24px 0;flex-wrap:wrap}
.pricing-auth label{font-weight:650;flex:0 0 100%}
.pricing-auth input{max-width:280px}
.pricing-board-group h4{margin:15px 0 7px;font-size:12px}
.pricing-type-row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(160px,1fr);gap:12px;align-items:end}
.pricing-type-row .fld{min-width:0}
.pricing-type-row input{width:100%}
.pricing-board-group .tw{overflow-x:auto}
.pricing-board-group table{min-width:320px}
.pricing-board-group th:last-child,.pricing-board-group td:last-child{width:175px}
.pricing-board-group input{width:120px;text-align:right}
.pricing-factor-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:12px}
.pricing-charge{display:grid;grid-template-columns:minmax(100px,1fr) minmax(85px,1fr);gap:6px}
.pricing-gst{display:flex;align-items:center;gap:8px;font-weight:650;margin:12px 0}
.wbb .pricing-gst input{width:auto}
.pricing-modal-footer{border-top:1px solid var(--line);padding-top:14px;margin-top:18px}
.pricing-modal-footer>div{display:flex;align-items:center;gap:12px}
.pricing-error{color:var(--flag);margin:10px 0}
@media(max-width:760px){.pricing-factor-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:480px){.pricing-factor-grid{grid-template-columns:1fr}.pricing-overlay{padding:8px}.pricing-modal{padding:12px}}
@media(max-width:480px){.pricing-type-row{grid-template-columns:1fr}}
@media(max-width:820px){.rail{width:100%;flex:1 1 100%;border-right:0;border-bottom:1px solid var(--line)}}
@media print{
 @page{size:A4;margin:12mm}
 body,.app-shell,.widget-frame,.wbb{margin:0!important;padding:0!important;max-width:none!important;overflow:visible!important;background:#fff!important;box-shadow:none!important;border:0!important}
 .hd{padding:0 0 9mm;border-bottom:1px solid #333}
 .hd-actions,.hd-n,.rail,.tabs,.header-import-error,.header-import-success,.pricing-overlay{display:none!important}
 .body,.out{display:block!important;width:100%!important;min-width:0!important;overflow:visible!important}
 .pane{padding:0!important}
 .tw{overflow:visible!important}
 .wbb table{font-size:8pt}
 .wbb th,.wbb td{padding:3px 4px}
 .print-data{display:block!important;break-before:page;page-break-before:always}
 .print-data h2{font-size:14pt;margin:0 0 5mm}
 .print-data p{font-size:9pt;margin:0 0 5mm}
 .print-data-line{font-family:monospace;font-size:6pt;line-height:1.35;white-space:nowrap}
}
`;

/* Laminate/hardware search helpers stay reachable for later wiring. */
void searchLaminateItems; void searchHardwareItems;
void laminateFinishesData; void edgebandFinishesData;
