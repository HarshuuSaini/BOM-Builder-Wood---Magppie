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
import * as XLSX from "xlsx-js-style";
import { searchBoardItems, searchLaminateItems, searchHardwareItems } from "@/lib/rawmaterial";
import boardFinishesData from "@/data/board_finishes.json";
import laminateFinishesData from "@/data/laminate_finishes.json";
import edgebandFinishesData from "@/data/edgeband_finishes.json";
import accessoryCatalogData from "@/data/accessory_catalog.json";
import hardwarePacksData from "@/data/hardware_packs.json";
import { getPartBaseName, getPanelBaseName, normalizePartOrPanelName } from "@/lib/naming";
import { exportBomWorkbook, exportBomCsv, exportCostingWorkbook, type AccessoryExportRow, type ProjectSetupRow } from "@/lib/export";
import { COSTING_ITEMS, DEFAULT_RATES, findCostingItem, type CostingMasterItem, type CostingRates } from "@/lib/costing";
import { encodeProjectPrintData, readPrintedProjectPdf } from "@/lib/print-project";
import type { BomReportRow } from "@/lib/types";

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
  zone: string;
  customShade: string;
  qty: number;
  customHeight: string;
  customWidth: string;
  elevation: string;
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

type CarcassModel = {
  code: string;
  zk: string;
  fk: string;
  vid: string;
  hand: string;
  handle: string;
  board: string;
  shType: string;
  glassType: string;
  finish: string;
  hingeChoice: HingeChoice;
  neon: string;
  drawerModel: string;
  W: number;
  H: number;
  D: number;
  panels: Panel[];
  profiles: Profile[];
  hardware: Hardware[];
  cons: Consumable[];
  pkRows: PkRow[];
  stubs: string[];
};

type PkRow = { pack: string; type: string; qty: number };
type ProjectLine = { id: number; m: CarcassModel; qty: number; elevation: string };
type CabinetConfig = Pick<CarcassModel, "zk" | "fk" | "vid" | "hand" | "handle" | "board" | "shType" | "glassType" | "hingeChoice" | "neon" | "W" | "H" | "D" | "drawerModel" | "finish">;

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

const LAM_ADH = 25;                                  // g/sqft/side
const PU_RATE = { epoxy: 15, primer: 30, top: 50 };  // g/sqft/side
const MEMB_OVER = 50;                                // mm per edge
const MEMB_ADH: number | null = null;                // rate not yet supplied

const WASTE = { carcass: 10, shutter: 20, profile: 20 };

const ELEVATIONS = ["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "JJ", "KK"];
const DRAWER_MODELS = ["Lian", "Hettich", "Blum", "Hafele", "Grass"];
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
const perim = (w: number, h: number) => (2 * (w + h)) / 1000;
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
const GLASS_SHUTTER_ITEMS = COSTING_ITEMS.filter((item) => item.group === "Glass Type" && item.type === "Shutter Glass" && item.thicknessMm === 5);
const GLASS_SHELF_ITEM = COSTING_ITEMS.find((item) => item.id === "KITCHEN-GLASS-6-CLEAR");
const DEFAULT_BOARD_ID = CARCASS_BOARD_ITEMS.find((item) => item.elevation === "CARCASS POSTLAM BWP PLY")?.id
  ?? CARCASS_BOARD_ITEMS[0]?.id ?? "";
const DEFAULT_SHTYPE = SHUTTER_BOARD_ITEMS.find((item) => item.elevation === "SHUTTER POSTLAM BWP PLY")?.id
  ?? SHUTTER_BOARD_ITEMS[0]?.id ?? "";
const DEFAULT_GLASS_TYPE = GLASS_SHUTTER_ITEMS.find((item) => item.id === "KITCHEN-GLASS-5-TINTED")?.id
  ?? GLASS_SHUTTER_ITEMS[0]?.id ?? "";

function glassShutterItemOf(id: string): CostingMasterItem {
  return GLASS_SHUTTER_ITEMS.find((item) => item.id === id) ?? GLASS_SHUTTER_ITEMS[0];
}

function carcassBoardOf(id: string) {
  const item = CARCASS_BOARD_ITEMS.find((candidate) => candidate.id === id) ?? CARCASS_BOARD_ITEMS[0];
  const backItem = CARCASS_BACK_ITEMS.find((candidate) => candidate.elevation === item?.elevation)
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
  if (row.materialId !== undefined) return row.materialId && !SHUTTER_BOARD_ITEMS.some((item) => item.id === row.materialId) ? "CUSTOM" : row.materialId;
  if (!row.material.trim()) return "";
  return SHUTTER_BOARD_ITEMS.find((item) =>
    [item.id, item.materialDescription, item.subgroup].some((value) => value.toLowerCase() === row.material.trim().toLowerCase()))?.id ?? "CUSTOM";
}

function countertopMaterialItem(row: CountertopRow, defaultShutterType: string): CostingMasterItem | undefined {
  const id = countertopMaterialId(row);
  return id === "CUSTOM" ? undefined : shutterMasterItem(id || defaultShutterType);
}

/** Only the glass branch keeps the stone frame machinery. */
const SH_INSET: Record<string, number> = { NEON20: 5, NEON50: 8 };
const SH_FRAME: Record<string, number> = { NEON20: 25, NEON50: 50 };
const NEON_LABEL: Record<string, string> = { NEON20: "Neon 20", NEON50: "Neon 50" };
const GLASS_T = 5;
const GLASS_SHELF_T = 6;

const GLASS_SHUTTER_FAMS = new Set(["WGL", "SHFG", "DPNG", "PPNG", "BLNG", "LOWSG", "LGL"]);
const isGlassShutterFam = (fk?: string) => !!fk && GLASS_SHUTTER_FAMS.has(fk);

/* ------------------------------------------------------------------ */
/*  Catalog — families (ported from stone verbatim)                    */
/* ------------------------------------------------------------------ */

const V = (id: string, label: string, o: Record<string, unknown> = {}) => ({ id, label, ...o });

const BASE_FAMILIES: Record<string, any> = {
  DW:  { name: "Base Drawer", p2: "DW", top: "panel", drawers: true,
         variants: [V("2dr", "2 Drawers", { p3: "XXX", p4: "2HB", side: "2HB" }),
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
  LMC: { name: "LeMans Corner", p2: "AC", top: "panel",
         variants: [V("lmc", "LeMans (handed)", { p3: "LMC", handed: true, blind: true })] },
  BSH: { name: "Blind + Shelf", p2: "SH", top: "panel", shelf: 1,
         variants: [V("bsh", "Blind shelf (handed)", { p3: "1SX", handed: true, blind: true })] },
  PLB: { name: "Plain Blind", p2: "SH", top: "panel",
         variants: [V("plb", "Plain blind (handed)", { p3: "XXX", handed: true, blind: true })] },
};

const WALL_FAMILIES: Record<string, any> = {
  WGL: { name: "Wall Glass Shutter", p2: "SH", glassFam: true,
         variants: [V("sgl", "Single door (handed)", { p3: "3SG", handed: true }),
                    V("dbl", "Double door", { p3: "3SG", p4: "2HS", both: true })] },
  WST: { name: "Wall Solid Shutter", p2: "SH",
         variants: [V("sgl", "Single door (handed)", { p3: "1SG", handed: true }),
                    V("dbl", "Double door", { p3: "1SG", p4: "2HS", both: true })] },
  WOP: { name: "Wall Open Shelf", p2: "OP", noShutter: true,
         variants: [V("op", "Open (no door)", { p3: "3SG", p4: "XXX", both: true })] },
  WDR: { name: "Wall Dish Rack", p2: "AC", noBottom: true, top: "frame",
         variants: [V("sgl", "Single door (handed)", { p3: "2SG", handed: true }),
                    V("dbl", "Double door", { p3: "2SG", p4: "2HS", both: true })] },
};

const TALL_FAMILIES: Record<string, any> = {
  SHF:  { name: "Tall Shelf (full shutter)", p2: "SH", bracket: "TCS", holes: "6H", shelf: 4,
          variants: [V("sgl", "Single door (handed)", { p3: "6SX", handed: true }),
                     V("dbl", "Double door", { p3: "6SX", p4: "2HS", both: true })] },
  SHFG: { name: "Tall Shelf Glass (full shutter)", p2: "SH", bracket: "TCS", holes: "6H", shelf: 4, glassFam: true,
          variants: [V("sgl", "Single door (handed)", { p3: "6SG", handed: true }),
                     V("dbl", "Double door", { p3: "6SG", p4: "2HS", both: true })] },
  APP:  { name: "Tall Appliance + DW", p2: "AP", bracket: "TMO", holes: "4H", special: "APP", drawers: true,
          variants: [V("1dw", "+ 1 Drawer (handed)", { p4: "1HB", handed: true }),
                     V("2dw", "+ 2 Drawers (handed)", { p4: "2HB", handed: true })] },
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
  BLNG: { name: "Tall Blind Glass Shelf", p2: "SH", bracket: "TBC", holes: "JD", shelf: 4, glassFam: true,
          variants: [V("h", "Blind shelf (handed)", { p3: "6SG", handed: true })] },
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
  if (z === "BB") return { LMC: BLIND_FAMILIES.LMC, BSH: BLIND_FAMILIES.BSH };
  if (z === "BBL") return { BSH: BLIND_FAMILIES.BSH };
  if (z === "WB") return { WGL: WALL_FAMILIES.WGL, WST: WALL_FAMILIES.WST };
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
  BPO: [150, 300],
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
    : z.kind === "wall" ? [1085, 725]
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

/** Shelf material is derived from the shutter type, not the zone. */
function shelfMaterialOf(fk: string, board: string): { mat: string; t: number; band: boolean } {
  if (isGlassShutterFam(fk)) return { mat: GLASS_SHELF_ITEM?.materialDescription ?? `${GLASS_SHELF_T}mm Clear Glass`, t: GLASS_SHELF_T, band: false };
  const selected = carcassBoardOf(board);
  return { mat: selected.core, t: selected.coreT, band: true };
}

function shelfCount(zk: string, fk: string, fam: any, H: number): number {
  const z = ZONES[zk];
  if (z.kind === "wall") {
    if (fk === "WDR") return H >= 1085 ? 2 : 0;
    if (fk === "WOP" || fk === "WGL" || fk === "WST") return H >= 1085 ? 3 : 1;
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
 *   2dr / 2dw  → 2 High
 *   3dr        → 2 Low + 1 High
 *   fixed_dpn  → 2 Low + 3 High   (stone had 2 Low + 3 Semi-High; wood has no
 *                                  Semi-High, so those three go High)
 */
function drawerBreakdown(fam: any, v: any): Array<{ cls: DrawerClass; n: number }> {
  if (fam.fixedDpn) return [{ cls: "LOW", n: 2 }, { cls: "HIGH", n: 3 }];
  if (/^3dr$/.test(v.id)) return [{ cls: "LOW", n: 2 }, { cls: "HIGH", n: 1 }];
  if (/^(2dr|2dw)$/.test(v.id)) return [{ cls: "HIGH", n: 2 }];
  return [{ cls: "HIGH", n: 1 }];
}

function addDrawerBoxes(
  fk: string,
  v: any,
  W: number,
  D: number,
  drawerModel: string,
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

  hardware.push({
    name: `DRAWER BOX SET ${drawerModel.toUpperCase()}`,
    qty: total,
    uom: "set",
    pack: "Drawer Pack",
  });
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
    const botW = W - d.botWded;
    const botD = D - d.botDded;
    const bakW = W - d.backWded;

    panels.push({
      name: `Panels- DR Bottom ${d.botT}mm ${botW}x${botD}`,
      w: botW, h: botD, qty: n, drill: null, pack: "Drawer Pack",
      t: d.botT, mat: DRAWER_PANEL_MAT(d.botT), band: false,
    });
    panels.push({
      name: `Panels- DR Back ${d.backT}mm ${bakW}x${d.backH}`,
      w: bakW, h: d.backH, qty: n, drill: null, pack: "Drawer Pack",
      t: d.backT, mat: DRAWER_PANEL_MAT(d.backT), band: false,
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
  // 360mm, with the normal/gola shutter deduction applied to each location.
  // DPN/DPNG are hinged pantry doors with internal drawers, not five external
  // drawer fronts, so fixedDpn deliberately continues to the hinged branch.
  if (fam.drawers && !fam.fixedDpn) {
    const st = isGlassShutterFam(fk) ? "GLASS" : shType;
    const S = shOf(st);
    const fronts: Array<{ cls: DrawerClass; loc: string }> = v.id === "3dr"
      ? [{ cls: "LOW", loc: "UL" }, { cls: "LOW", loc: "ML" }, { cls: "HIGH", loc: "BH" }]
      : /^(2dr|2dw)$/.test(v.id)
        ? [{ cls: "HIGH", loc: "UH" }, { cls: "HIGH", loc: "BH" }]
        : [{ cls: "HIGH", loc: fk === "GD" ? "FH" : "BH" }];
    fronts.forEach(({ cls, loc }) => {
      const slotH = loc === "FH" ? H : cls === "LOW" ? 180 : 360;
      const frontH = slotH - shDeduct(isBase, handle, loc);
      panels.push({
        name: `Panels- SH Drawer Front ${cls} ${S.t}mm ${W - 3}x${frontH}`,
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
      const slotH = front.loc === "FH" ? H : front.cls === "LOW" ? 180 : 360;
      return sum + sqft(W - 3, slotH - shDeduct(isBase, handle, front.loc));
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

  // Blind cabinets inherit the stone layout: one functional shutter plus one
  // fixed dummy shutter. Wall/loft use a 450mm active bay; all other blind
  // zones use 550mm. The fixed panel is always a solid selected shutter board,
  // even when the functional shutter is glass.
  if (z.blind) {
    const blindW = z.kind === "wall" || z.kind === "loft" ? 450 : 550;
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
  const key = (p: Panel) => [p.pack, p.name.replace(/\b(LH|RH)\b/g, "").trim(), p.w, p.h, p.t, p.mat, p.band].join("|");
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

function explodePanelForTree(p: Panel, finish: string): TreeItem[] {
  const area = sqft(p.w, p.h) * p.qty;
  const out: TreeItem[] = [];
  out.push({ level: 2, name: getPanelBaseName(p.name, p.drill, finish), qty: p.qty, uom: "nos" });
  out.push({ level: 3, name: getPartBaseName(p.name, p.drill, finish), qty: p.qty, uom: "nos" });
  out.push({ level: 4, name: `${p.mat ?? "Board"} ${finish}`.trim(), qty: r3(area), uom: "sqft", mat: p.mat, sqftVal: area });
  if (p.band) {
    const m = perim(p.w, p.h) * p.qty;
    out.push({ level: 4, name: `EDGE BAND ${BAND_T}MM ${finish}`.trim(), qty: r3(m), uom: "RMT" });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Carcass build                                                      */
/* ------------------------------------------------------------------ */

function buildCarcassInnerRaw(cfg: {
  zk: string; fk: string; v: any; hand: string; handle: string;
  board: string; shType: string; glassType: string; hingeChoice: HingeChoice; neon: string;
  W: number; H: number; D: number; drawerModel: string;
}) {
  const { zk, fk, v, hand, handle, board, shType, glassType, hingeChoice, neon, W, H, D, drawerModel } = cfg;
  const z = ZONES[zk];
  const isBase = !z.tall && !z.kind;
  const fam = famSetOf(zk)[fk];
  const B = carcassBoardOf(board);

  const panels: Panel[] = [];
  const profiles: Profile[] = [];
  const hardware: Hardware[] = [];
  const cons: Consumable[] = [];
  const pkRows: PkRow[] = [];
  const stubs: string[] = [];

  const carc = B.core;
  const PK = "Carcass Pack";
  const add = (name: string, w: number, h: number, qty: number, t: number, mat: string, band: boolean, drill: string | null = null) =>
    panels.push({ name, w: Math.round(w), h: Math.round(h), qty, drill, pack: PK, t, mat, band });

  /* --- sides run full height; base cabinets have no top panel --- */
  add(`Panels- CR Side ${T}mm ${D}x${H}`, D, H, 2, T, carc, true, hand === "LHS" ? "LH" : "RH");

  if (!isBase) {
    const topD = handle === "XCJ" ? D - CJ_CUT : D;
    add(`Panels- CR Top ${T}mm ${W - 2 * T}x${topD}`, W - 2 * T, topD, 1, T, carc, true);
  }

  if (fk !== "WDR" && !fam.noBottom) add(`Panels- CR Bottom ${T}mm ${W - 2 * T}x${D}`, W - 2 * T, D, 1, T, carc, true);

  /* --- back: grooved, +9 allowance, never banded --- */
  const bw = W - 2 * T + GROOVE;
  const bh = H - 2 * T + GROOVE;
  if (fk === "SK") {
    // The sink module has no full carcass back; its 100mm structural back is
    // emitted below in the framed-unit construction.
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
      add(`Panels- CR Top Rail Front ${T}mm ${W - 2 * T}x100`, W - 2 * T, 100, 1, T, carc, true);
    }
    if (fk !== "HO") {
      add(`Panels- CR Back ${T}mm ${W - 2 * T}x100`, W - 2 * T, 100, 1, T, carc, true);
    }
  }

  /* --- shelves: material follows the shutter type --- */
  const nsh = shelfCount(zk, fk, fam, H);
  if (nsh > 0) {
    const sm = shelfMaterialOf(fk, board);
    add(`Panels- CR Shelf ${sm.t}mm ${W - 2 * T - SHELF_W_CLR}x${D - SHELF_D_OFF}`,
        W - 2 * T - SHELF_W_CLR, D - SHELF_D_OFF, nsh, sm.t, sm.mat, sm.band);
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
    const topProfileCut = W - 2 * T - 10;
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
  const sh = buildShutters(zk, fk, v, handle, hand, shType, glassType, hingeChoice, neon, W, H, panels, profiles, hardware, pkRows, stubs);

  /* --- drawers --- */
  addDrawerBoxes(fk, v, W, D, drawerModel, panels, hardware, pkRows, stubs);

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
  const bandM = merged.reduce((a, p) => a + (p.band ? perim(p.w, p.h) * p.qty : 0), 0);
  const carcSqft = merged.filter((p) => p.pack === PK).reduce((a, p) => a + sqft(p.w, p.h) * p.qty, 0);
  const shSqft = merged.filter((p) => p.pack === "Shutter Pack").reduce((a, p) => a + sqft(p.w, p.h) * p.qty, 0);

  if (bandM > 0) {
    cons.push({ name: `EDGE BAND ${BAND_T}MM`, qty: r3(bandM), uom: "RMT", pack: PK });
    cons.push({ name: "EDGEBAND ADHESIVE", qty: r3(bandM), uom: "RMT", pack: PK });
  }
  if (B.lam) {
    cons.push({ name: "CARCASS LAMINATE 0.8MM", qty: r3(carcSqft * 2), uom: "sqft", pack: PK });
    cons.push({ name: "LAMINATE ADHESIVE", qty: r3(carcSqft * LAM_ADH * 2), uom: "gm", pack: PK });
  }

  const st = isGlassShutterFam(fk) ? "GLASS" : shType;
  if (shSqft > 0) {
    if (shFamOf(st) === "POSTLAM") {
      cons.push({ name: "SHUTTER LAMINATE 0.8MM OUTER", qty: r3(shSqft), uom: "sqft", pack: "Shutter Pack" });
      cons.push({ name: "SHUTTER LAMINATE 0.8MM LINER", qty: r3(shSqft), uom: "sqft", pack: "Shutter Pack" });
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

  return { panels: merged, profiles, hardware, cons, pkRows, stubs };
}

/* ------------------------------------------------------------------ */
/*  Model                                                              */
/* ------------------------------------------------------------------ */

function buildModel(cfg: {
  zk: string; fk: string; vid: string; hand: string; handle: string;
  board: string; shType: string; glassType: string; hingeChoice: HingeChoice; neon: string;
  W: number; H: number; D: number; drawerModel: string; finish?: string;
}): CarcassModel {
  const fam = famSetOf(cfg.zk)[cfg.fk];
  const v = fam.variants.find((x: any) => x.id === cfg.vid) ?? fam.variants[0];
  const built = buildCarcassInnerRaw({ ...cfg, v });

  /* Cabinet code — stone contract, 11 fields + optional finish suffix:
     p1-p2-handleToken(CJ|STD)-matToken(GL|WD)-p3-p4-p5-W-H-D-t[-FINISH]
     Hand rides in p4 or p5 as in stone; wall p3 leading digit is rewritten
     from the live shelf count. */
  const handleToken = cfg.handle === "XCJ" ? "CJ" : "STD";
  const matToken = isGlassShutterFam(cfg.fk) ? "GL" : "WD";
  const handTok = v.handed ? cfg.hand : "";
  let p3: string = v.p3 ?? "1SX";
  if (ZONES[cfg.zk].kind === "wall" && /^\d/.test(p3)) {
    p3 = String(shelfCount(cfg.zk, cfg.fk, fam, cfg.H)) + p3.slice(1);
  }
  const p4: string = v.p4 || handTok || "XXX";
  const p5: string = v.p5 || (v.p4 && handTok ? handTok : "XXX");
  const code =
    [ZONES[cfg.zk].p1, fam.p2, handleToken, matToken, p3, p4, p5, cfg.W, cfg.H, cfg.D, T].join("-") +
    (cfg.finish ? "-" + cfg.finish.toUpperCase() : "");

  return { code, ...cfg, vid: v.id, ...built } as CarcassModel;
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

function wasteFor(pack: string, uom: string, wst: WastePct = WASTE): number {
  if (uom === "mtr" || uom === "RMT") return wst.profile;
  return pack === "Shutter Pack" ? wst.shutter : wst.carcass;
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
        explodePanelForTree(p, finish).forEach((t) => {
          const waste = t.uom === "sqft" || t.uom === "RMT" ? wasteFor(pk, t.uom, wst) : 0;
          rows.push(makeRow({
            SO: so, Elevation: line.elevation, "Main Group": "Cabinet", "Sub Group": pk,
            Level: t.level, Item: t.name, Type: t.level >= 4 ? "component" : "plain",
            Height: String(p.h), Width: String(p.w), Thickness: String(p.t ?? ""),
            Finish: finish, "CF Type": t.mat ?? "",
            "SO Qty": r3(t.qty * q), "Waste %": waste,
            "Actual Qty": r3(t.qty * q * (1 + waste / 100)),
            Pcs: t.uom === "sqft" ? r3((t.qty * q * (1 + waste / 100)) / SHEET_SQFT) : "",
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
        "Actual Qty": r3(((p.len * p.qty * q) / 1000) * (1 + wst.profile / 100)),
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

    m.cons.forEach((c) => {
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

type BoardTotal = { mat: string; t: number; pack: string; sqft: number; waste: number; sheets: number | null };

function buildBoardTotals(project: ProjectLine[], wst: WastePct = WASTE, extraPanels: Panel[] = []): BoardTotal[] {
  const map = new Map<string, BoardTotal>();
  const fold = (p: Panel, mult: number) => {
    const mat = p.mat ?? "Board";
    const k = `${mat}|${p.t}|${p.pack}`;
    if (!map.has(k)) {
      map.set(k, { mat, t: p.t ?? T, pack: p.pack, sqft: 0, waste: wasteFor(p.pack, "sqft", wst), sheets: 0 });
    }
    map.get(k)!.sqft += sqft(p.w, p.h) * p.qty * mult;
  };
  project.forEach((l) => l.m.panels.forEach((p) => fold(p, l.qty)));
  extraPanels.forEach((p) => fold(p, 1));
  return [...map.values()].map((b) => ({
    ...b,
    sheets: /glass/i.test(b.mat) ? null : (b.sqft * (1 + b.waste / 100)) / SHEET_SQFT,
  }));
}

/* ------------------------------------------------------------------ */
/*  Fillers · Visible Panels · Countertop · Accessories                */
/*  (spec: CHAT_SUMMARY §15-§17 — wood keeps none of stone's profile   */
/*   machinery; a filler/VP is a plain shutter-type panel, countertop  */
/*   is one bought-in line, every accessory is opt-in.)                */
/* ------------------------------------------------------------------ */

const FILLER_ZONES = ["base", "tall", "wall", "loft", "mid"] as const;
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
): { rows: FullBomRow[]; panels: Panel[] } {
  const rows: FullBomRow[] = [];
  const panels: Panel[] = [];

  const emit = (kind: "Filler" | "Visible", r: FillerRow, shTypeKey: string) => {
    const zone = r.zone;
    const H = parseFloat(r.customHeight) || defFillerH(zone, project);
    const W = parseFloat(r.customWidth) ||
      (kind === "Filler" ? FILLER_DEF_W : defZoneDepth(zone, project) + VP_DEPTH_ADD);
    const q = r.qty || 1;
    const fin = r.customShade || globalFinish;
    const p = extraPanelOf(kind, zone, Math.round(H), Math.round(W), q, shTypeKey);
    panels.push(p);
    const Z = zone.toUpperCase();
    const codeBase = `SH-${kind === "Filler" ? "Filler" : "Visible"}-${Z}-${Math.round(H)}x${Math.round(W)}`;
    const start = rows.length;
    rows.push(makeRow({
      SO: so, "Main Group": kind === "Filler" ? "Filler" : "Visible Panel", "Sub Group": codeBase,
      Level: 0, Item: `Panels- SH ${kind} ${Math.round(H)}x${Math.round(W)}x${p.t}`,
      SKU: `${codeBase}-${q}`, Type: "master",
      Height: String(Math.round(H)), Width: String(Math.round(W)), Thickness: String(p.t ?? ""),
      Finish: fin, "SO Qty": q, "Actual Qty": q, Unit: "nos",
    }));
    rows.push(makeRow({
      SO: so, "Main Group": rows[start]["Main Group"], "Sub Group": codeBase,
      Level: 1, Item: codeBase, SKU: codeBase, Type: "sub_bom",
      Finish: fin, "SO Qty": q, "Actual Qty": q, Unit: "nos",
    }));
    explodePanelForTree(p, fin).forEach((t) => {
      const waste = t.uom === "sqft" || t.uom === "RMT" ? wasteFor("Shutter Pack", t.uom, wst) : 0;
      rows.push(makeRow({
        SO: so, "Main Group": rows[start]["Main Group"], "Sub Group": codeBase,
        Level: t.level, Item: t.name, Type: t.level >= 4 ? "component" : "plain",
        Height: String(p.h), Width: String(p.w), Thickness: String(p.t ?? ""),
        Finish: fin, "CF Type": t.mat ?? "",
        "SO Qty": r3(t.qty), "Waste %": waste,
        "Actual Qty": r3(t.qty * (1 + waste / 100)),
        Pcs: t.uom === "sqft" ? r3((t.qty * (1 + waste / 100)) / SHEET_SQFT) : "",
        Unit: t.uom,
      }));
    });
    for (let i = start; i < rows.length; i++) rows[i].Elevation = r.elevation || "";
  };

  fillers.forEach((f) => emit("Filler", f, globalShType));
  visiblePanels.forEach((vp) => emit("Visible", vp, vp.shutterType || globalShType));

  countertops.forEach((c) => {
    const L = parseFloat(c.length) || 0;
    const D = parseFloat(c.depth) || 600;
    const selected = countertopMaterialItem(c, countertopShType);
    const Tt = parseFloat(c.thickness) || selected?.thicknessMm || 30;
    if (!L) return;
    const q = c.qty || 1;
    const matName = selected?.subgroup ?? (c.material.trim() || "Countertop");
    rows.push(makeRow({
      SO: so, "Main Group": "Countertop", "Sub Group": `CT-${L}x${D}x${Tt}`,
      Level: 0, Item: `Countertop ${matName} ${Tt}mm ${L}x${D}`, SKU: `CT-${L}x${D}x${Tt}-${q}`,
      Type: "master", Height: String(D), Width: String(L), Thickness: String(Tt),
      Finish: matName, "SO Qty": q, "Actual Qty": q, Unit: "nos",
    }));
    rows.push(makeRow({
      SO: so, "Main Group": "Countertop", "Sub Group": `CT-${L}x${D}x${Tt}`,
      Level: 1, Item: selected?.materialDescription ?? `CT ${matName} ${Tt}mm ${L}x${D} (bought-in)`, SKU: selected?.id ?? `CT-${L}x${D}x${Tt}`,
      Type: "component", Height: String(D), Width: String(L), Thickness: String(Tt),
      Finish: matName, "SO Qty": q, "Actual Qty": q, Unit: "nos",
    }));
  });

  return { rows, panels };
}

/* --- Accessories — everything opt-in (CHAT_SUMMARY §17) --- */

// Keep the saved "elenor" key so older project exports still reopen as a light row.
type AccessoryKind = "skirting" | "elenor";
interface AccessoryRow {
  id: number;
  kind: AccessoryKind;
  /** metres for skirting, cut height (mm) for the LED profile light */
  size: string;
  qty: number;
  elevation: string;
  straight: number; // skirting connectors
  lconn: number;
  driver: string;   // light driver master ID (legacy labels also accepted)
}
interface MasterAccessoryRow {
  id: number;
  itemId: string;
  qty: number;
  elevation: string;
}
const KITCHEN_ACCESSORY_ITEMS = COSTING_ITEMS.filter((item) => ["Accessory", "LIGHT"].includes(item.group) && item.id.startsWith("KITCHEN-"));
const accessoryNameKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");
const pricedAccessoryNames = new Set(KITCHEN_ACCESSORY_ITEMS.map((item) => accessoryNameKey(item.materialDescription)));
const MASTER_ACCESSORY_ITEMS = [
  ...KITCHEN_ACCESSORY_ITEMS.map((item) => ({
    id: item.id, subgroup: item.subgroup, materialDescription: item.materialDescription,
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
const ACC_LABEL: Record<AccessoryKind, string> = {
  skirting: "PVC Skirting Profile",
  elenor: "LED Profile Light",
};
const LIGHT_ITEMS = {
  profile: COSTING_ITEMS.find((item) => item.id === "KITCHEN-084")!,
  diffuser: COSTING_ITEMS.find((item) => item.id === "KITCHEN-085")!,
  led: COSTING_ITEMS.find((item) => item.id === "KITCHEN-086")!,
  wire: COSTING_ITEMS.find((item) => item.id === "KITCHEN-090")!,
};
const DRIVER_ITEMS = COSTING_ITEMS.filter((item) => ["KITCHEN-089", "KITCHEN-088"].includes(item.id));
function selectedDriver(value: string): CostingMasterItem | undefined {
  return DRIVER_ITEMS.find((item) => item.id === value || item.materialDescription === value)
    ?? (value.includes("2A 24W") ? DRIVER_ITEMS.find((item) => item.id === "KITCHEN-089") : undefined)
    ?? (value.includes("5A 60W") ? DRIVER_ITEMS.find((item) => item.id === "KITCHEN-088") : undefined);
}
const LIGHT_WASTE = 0.10;
const SKIRT_WASTE = 0.10;

/** Default skirting run: sum of leg-mounted project line widths, metres. */
function defSkirtMeters(project: ProjectLine[]): number {
  const mm = project.reduce((a, l) =>
    a + (ZONES[l.m.zk].mount === "legs" ? l.m.W * l.qty : 0), 0);
  return r3(mm / 1000);
}

function buildAccessoryRows(accs: AccessoryRow[], project: ProjectLine[], so: string): AccessoryExportRow[] {
  const out: AccessoryExportRow[] = [];
  const carcass = project.map((l) => l.m.code.split("-").slice(0, 3).join("-")).join(", ");
  accs.forEach((a) => {
    if (a.kind === "skirting") {
      const mtr = parseFloat(a.size) || defSkirtMeters(project);
      const withWaste = r3(mtr * (1 + SKIRT_WASTE));
      out.push({
        SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL.skirting, Selected: "yes",
        "Item Name": "PVC SKIRTING PROFILE 100MM", Size: `${mtr} m`,
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
    } else {
      const H = parseFloat(a.size) || 720;
      const q = a.qty || 1;
      const netM = r3(H / 1000 * 2 * q);
      const billedM = r3(Math.ceil(H * (1 + LIGHT_WASTE)) / 1000 * 2 * q);
      const rowsDef: Array<[CostingMasterItem, number, number, string]> = [
        [LIGHT_ITEMS.profile, netM, billedM, `2 × L=${H}mm`],
        [LIGHT_ITEMS.diffuser, netM, billedM, "Mtr"],
        [LIGHT_ITEMS.led, netM, billedM, "Mtr"],
        [LIGHT_ITEMS.wire, 2 * q, 2 * q, "Mtr"],
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
    const item = MASTER_ACCESSORY_ITEMS.find((candidate) => candidate.id === row.itemId);
    if (!item) return [];
    return [{
      SO: so, "Carcass Items": "", Accessory: item.subgroup, Selected: "yes",
      "Item Name": item.materialDescription, Size: item.type, Elevation: row.elevation,
      Total: row.qty, "Actual Qty": row.qty, "Zoho Item ID": item.priced ? item.id : "",
    }];
  });
}

/* --- Costing — rupee totals for the user; factors stay on /admin --- */

type CostDetail = {
  category: string;
  itemCode: string;
  item: string;
  specification: string;
  netQty: number;
  wastePct: number;
  billableQty: number;
  uom: "sqft" | "RMT" | "nos" | "set";
  rate: number;
  amount: number;
};
type LineCost = { label: string; code?: string; qty: number; unitCost: number; cost: number; details: CostDetail[] };
type CostingResult = { lines: LineCost[]; total: number; unpriced: string[] };
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
};

const DEFAULT_PROJECT_PRICING: ProjectPricingInputs = {
  conversionPct: "",
  profitPct: "",
  transportation: { mode: "direct", value: "" },
  installation: { mode: "direct", value: "" },
  loading: { mode: "direct", value: "" },
  includeTax: false,
};

type ProjectRestore = {
  project: ProjectLine[];
  fillers: FillerRow[];
  visiblePanels: VisiblePanelRow[];
  countertops: CountertopRow[];
  accessories: AccessoryRow[];
  masterAccessories: MasterAccessoryRow[];
  waste: WastePct;
  pricing: ProjectPricingInputs;
  rawSelections: Array<{ key: string; id: string; name: string; sku: string; stock_on_hand?: number }>;
  current?: { config: CabinetConfig; elevation: string; qty: number };
  notice: string;
};

const PROJECT_FILE_FORMAT = "wood-bom-project";
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function cabinetConfig(model: CarcassModel): CabinetConfig {
  const { zk, fk, vid, hand, handle, board, shType, glassType, hingeChoice, neon, W, H, D, drawerModel, finish } = model;
  return { zk, fk, vid, hand, handle, board, shType, glassType, hingeChoice, neon, W, H, D, drawerModel, finish };
}

function projectSetupRows(data: Omit<ProjectRestore, "notice">): ProjectSetupRow[] {
  const row = (kind: string, value: unknown): ProjectSetupRow => ({ "Record Type": kind, Data: JSON.stringify(value) });
  return [
    row("format", { name: PROJECT_FILE_FORMAT, version: 1 }),
    row("settings", { waste: data.waste, pricing: data.pricing, current: data.current }),
    ...data.project.map((line) => row("cabinet", { id: line.id, config: cabinetConfig(line.m), qty: line.qty, elevation: line.elevation })),
    ...data.fillers.map((item) => row("filler", item)),
    ...data.visiblePanels.map((item) => row("visible-panel", item)),
    ...data.countertops.map((item) => row("countertop", item)),
    ...data.accessories.map((item) => row("other-accessory", item)),
    ...data.masterAccessories.map((item) => row("accessory", item)),
    ...data.rawSelections.map((item) => row("raw-selection", item)),
  ];
}

function validatedCabinetConfig(value: unknown): CabinetConfig {
  if (!isRecord(value)) throw new Error("A cabinet configuration is missing.");
  const config = value as CabinetConfig;
  const family = typeof config.zk === "string" ? famSetOf(config.zk)[config.fk] : undefined;
  if (!ZONES[config.zk] || !family || !family.variants.some((variant: { id: string }) => variant.id === config.vid)) {
    throw new Error(`Unknown cabinet family or configuration: ${String(config.zk)} / ${String(config.fk)} / ${String(config.vid)}.`);
  }
  if (![config.W, config.H, config.D].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) {
    throw new Error("A cabinet has invalid width, height, or depth.");
  }
  if (!CARCASS_BOARD_ITEMS.some((item) => item.id === config.board) || !SHUTTER_BOARD_ITEMS.some((item) => item.id === config.shType)) {
    throw new Error("A saved cabinet material is not available in the current master.");
  }
  if (!GLASS_SHUTTER_ITEMS.some((item) => item.id === config.glassType) || !HINGE_CHOICES.includes(config.hingeChoice) || !DRAWER_MODELS.includes(config.drawerModel)) {
    throw new Error("A saved glass, hinge, or drawer option is not available.");
  }
  if (!["LHS", "RHS"].includes(config.hand) || !["STD", "XCJ"].includes(config.handle) || config.neon !== "NEON50" || typeof config.finish !== "string") {
    throw new Error("A saved cabinet setting is invalid.");
  }
  return config;
}

function restoreProjectSetup(rows: Record<string, unknown>[]): ProjectRestore {
  const records = rows.map((row) => ({ kind: String(row["Record Type"] ?? ""), data: JSON.parse(String(row.Data ?? "null")) as unknown }));
  const format = records.find((record) => record.kind === "format")?.data;
  if (!isRecord(format) || format.name !== PROJECT_FILE_FORMAT || format.version !== 1) throw new Error("Unsupported Project Setup format.");
  const settings = records.find((record) => record.kind === "settings")?.data;
  if (!isRecord(settings) || !isRecord(settings.waste) || !isRecord(settings.pricing)) throw new Error("Project settings are missing.");
  const waste = settings.waste as WastePct;
  if (![waste.carcass, waste.shutter, waste.profile].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) throw new Error("Saved wastage settings are invalid.");
  const pricing = settings.pricing as ProjectPricingInputs;
  const validNumberInput = (value: unknown) => value === "" || (typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (![pricing.transportation, pricing.installation, pricing.loading].every((charge) => isRecord(charge) && ["direct", "sqft"].includes(charge.mode as string) && validNumberInput(charge.value)) ||
      !validNumberInput(pricing.conversionPct) || !validNumberInput(pricing.profitPct) || typeof pricing.includeTax !== "boolean") {
    throw new Error("Saved pricing settings are invalid.");
  }
  const savedCurrent = settings.current;
  const current = isRecord(savedCurrent)
    ? { config: validatedCabinetConfig(savedCurrent.config), elevation: String(savedCurrent.elevation ?? ""), qty: Number(savedCurrent.qty) }
    : undefined;
  if (current && (!Number.isFinite(current.qty) || current.qty < 1)) throw new Error("Saved current cabinet quantity is invalid.");
  const project = records.filter((record) => record.kind === "cabinet").map((record, index) => {
    if (!isRecord(record.data) || typeof record.data.qty !== "number" || record.data.qty < 1 || !Number.isFinite(record.data.qty)) throw new Error("A saved cabinet quantity is invalid.");
    const config = validatedCabinetConfig(record.data.config);
    return { id: index + 1, m: buildModel(config), qty: record.data.qty, elevation: String(record.data.elevation ?? "") };
  });
  const values = <T extends { id: number; qty: number },>(kind: string): T[] => records.filter((record) => record.kind === kind).map((record) => {
    if (!isRecord(record.data)) throw new Error(`A ${kind} row is invalid.`);
    if (typeof record.data.id !== "number" || !Number.isFinite(record.data.id) || typeof record.data.qty !== "number" || !Number.isFinite(record.data.qty) || record.data.qty < 1) {
      throw new Error(`A ${kind} row has an invalid id or quantity.`);
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
    project, fillers: values<FillerRow>("filler"), visiblePanels: values<VisiblePanelRow>("visible-panel"),
    countertops: values<CountertopRow>("countertop"), accessories: values<AccessoryRow>("other-accessory"),
    masterAccessories: values<MasterAccessoryRow>("accessory"), waste, pricing, rawSelections, current,
    notice: `Imported ${project.length} cabinet line${project.length === 1 ? "" : "s"} with saved materials, hardware choices, accessories, raw selections, and pricing settings.`,
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
    const candidates = Object.entries(famSetOf(zone)).flatMap(([fk, family]: [string, any]) => {
      if (family.p2 !== familyCode || (isGlassShutterFam(fk) ? "GL" : "WD") !== matToken) return [];
      return family.variants.map((variant: { id: string }) => ({ fk, vid: variant.id }));
    }).filter(({ fk, vid }) => {
      const config: CabinetConfig = { zk: zone, fk, vid, hand, handle: handleToken === "CJ" ? "XCJ" : "STD", board: DEFAULT_BOARD_ID, shType: DEFAULT_SHTYPE, glassType: DEFAULT_GLASS_TYPE, hingeChoice: HINGE_CHOICES[0], neon: "NEON50", W, H, D, drawerModel: DRAWER_MODELS[0], finish };
      return buildModel(config).code.split("-").slice(0, 7).join("-") === parts.slice(0, 7).join("-");
    });
    if (candidates.length !== 1) throw new Error(`Cannot uniquely identify cabinet ${code} from this older export. Please use a new Excel BOM with Project Setup.`);
    const config: CabinetConfig = { zk: zone, ...candidates[0], hand, handle: handleToken === "CJ" ? "XCJ" : "STD", board: DEFAULT_BOARD_ID, shType: DEFAULT_SHTYPE, glassType: DEFAULT_GLASS_TYPE, hingeChoice: HINGE_CHOICES[0], neon: "NEON50", W, H, D, drawerModel: DRAWER_MODELS[0], finish };
    const qty = Number(row["SO Qty"] ?? row.quantityNeeded ?? 1);
    if (!Number.isFinite(qty) || qty < 1) throw new Error(`Invalid cabinet quantity: ${code}`);
    return { id: index + 1, m: buildModel(config), qty, elevation: String(row.Elevation ?? "") };
  });
  return { project, fillers: [], visiblePanels: [], countertops: [], accessories: [], masterAccessories: [], waste: { ...WASTE }, pricing: DEFAULT_PROJECT_PRICING, rawSelections: [],
    notice: `Imported ${project.length} cabinet line${project.length === 1 ? "" : "s"} from an older BOM. That file did not save material, hinge, drawer, accessory, or pricing selections; review those before continuing.` };
}

/** Browser-printed projects predating the restore appendix expose only their visible tables. */
function restoreLegacyPrintedPdf(pages: string[]): ProjectRestore {
  const linesPage = pages.find((page) => page.includes("Project lines\n"));
  const boardsPage = pages.find((page) => page.includes("Boards\n") && page.includes("Countertop + add row"));
  const accessoryPage = pages.find((page) => page.includes("Accessories + add row") && page.includes("Accessory lines (export preview)"));
  if (!linesPage || !boardsPage) {
    throw new Error("This PDF is not a recognized Wood Kitchen BOM project printout. Import its original Excel project file instead.");
  }
  const table = linesPage.split("Project lines\n")[1]?.split("Wastage %")[0]?.replace(/-\s*\n\s*/g, "-") ?? "";
  const codePattern = /^([A-Z]{2})\s+([A-Z]{2,3}-[A-Z0-9]+-(?:CJ|STD)-(?:WD|GL)-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-\d+-\d+-\d+-\d+-[A-Z0-9]+)\b/gm;
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
  const boardChoices = CARCASS_BOARD_ITEMS.filter((item) => materialInTable(item.materialDescription));
  const shutterMatches = SHUTTER_BOARD_ITEMS.filter((item) => materialInTable(item.materialDescription));
  const shutterChoices = shutterMatches.filter((item) => !shutterMatches.some((other) =>
    other.id !== item.id && other.materialDescription.includes(item.materialDescription)));
  const glassChoices = GLASS_SHUTTER_ITEMS.filter((item) => materialInTable(item.materialDescription));
  const allText = pages.join("\n");
  const hingeChoice = HINGE_CHOICES.find((choice) => allText.includes(choice));
  const drawerModel = DRAWER_MODELS.find((choice) => new RegExp(`DRAWER BOX SET ${choice}\\b`, "i").test(allText));
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
  if (wasteMatch) restored.waste = { carcass: Number(wasteMatch[1]), shutter: Number(wasteMatch[2]), profile: Number(wasteMatch[3]) };
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

  const visibleSection = boardsPage.split("Visible Panels + add row")[1]?.split("Countertop + add row")[0] ?? "";
  for (const match of visibleSection.matchAll(/(?:^|\n)(\d+)\s+Default\b[^\n]*?\s+(\d+)\s+(\d+)\s+([A-Z]{2})\s+×/g)) {
    restored.visiblePanels.push({ id: restored.visiblePanels.length + 1, zone: "base", customShade: "", qty: Number(match[1]),
      customHeight: match[2], customWidth: match[3], elevation: match[4], shutterType: shutterChoices[0]?.id ?? DEFAULT_SHTYPE });
  }
  const counterSection = boardsPage.split("Countertop + add row")[1]?.split("Other Accessories + add row")[0] ?? "";
  for (const match of counterSection.matchAll(/(?:^|\n)(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s+(\d+)\s+×/g)) {
    restored.countertops.push({ id: restored.countertops.length + 1, length: match[1], depth: match[2], thickness: match[3],
      material: match[4].trim(), qty: Number(match[5]), ratePerSqft: "" });
  }

  const otherSection = accessoryPage?.split("Accessories + add row")[0] ?? "";
  for (const match of otherSection.matchAll(/PVC Skirting Pr\s+(\d+(?:\.\d+)?)\s+(\d+)\s+([A-Z]{2})\s+(\d+)\s+(\d+)\s+—\s+×/g)) {
    restored.accessories.push({ id: restored.accessories.length + 1, kind: "skirting", size: match[1], qty: Number(match[2]),
      elevation: match[3], straight: Number(match[4]), lconn: Number(match[5]), driver: "" });
  }
  const masterSection = accessoryPage?.split("Accessories + add row")[1]?.split("Accessory lines (export preview)")[0] ?? "";
  for (const line of masterSection.split("\n")) {
    const item = MASTER_ACCESSORY_ITEMS.find((candidate) => line.startsWith(candidate.subgroup));
    if (!item) continue;
    const qty = Number(line.match(/\s(\d+)\s+(?:[A-Z]{2}\s+)?×$/)?.[1]);
    if (Number.isInteger(qty) && qty > 0) restored.masterAccessories.push({ id: restored.masterAccessories.length + 1, itemId: item.id, qty,
      elevation: line.match(/\s([A-Z]{2})\s+×$/)?.[1] ?? "" });
  }
  const displayedCode = linesPage.split("Project lines\n")[0].match(/[A-Z]{2,3}-[A-Z0-9]+-(?:CJ|STD)-(?:WD|GL)-[A-Z0-9-]+-\d+-\d+-\d+-\d+-[A-Z0-9]+/)?.[0];
  const displayedLine = restored.project.find((line) => line.m.code === displayedCode);
  if (displayedLine) restored.current = { config: cabinetConfig(displayedLine.m), elevation: displayedLine.elevation, qty: displayedLine.qty };
  restored.notice = `Imported ${restored.project.length} cabinets, ${restored.visiblePanels.length} visible panel(s), ${restored.countertops.length} countertop(s), ${restored.accessories.length} skirting row(s), and ${restored.masterAccessories.length} accessory item(s) from this older print. Board, shutter, glass, hinge and drawer choices were inferred from project-wide tables; verify each cabinet. Visible-panel zone was not printed and is set to base. Countertop rates, raw-material selections, and any hidden settings were not in the PDF and need review.`;
  return restored;
}

async function readProjectFile(file: File): Promise<ProjectRestore> {
  if (file.size > 10_000_000) throw new Error("The selected file is too large (maximum 10 MB).");
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const data = await readPrintedProjectPdf(file);
    if (isRecord(data) && Array.isArray(data.legacyPages)) return restoreLegacyPrintedPdf(data.legacyPages as string[]);
    if (!Array.isArray(data)) throw new Error("This PDF does not contain valid project rows.");
    return restoreProjectSetup(data as Record<string, unknown>[]);
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

function carcassMasterItem(board: string, panel: Panel): CostingMasterItem | undefined {
  if (/glass/i.test(panel.mat ?? "")) return GLASS_SHELF_ITEM;
  if (panel.pack === "Drawer Pack" && /BWP Plywood/i.test(panel.mat ?? "")) {
    return COSTING_ITEMS.find((item) => item.group === "Drawer Material" && /BWP Ply/i.test(item.subgroup));
  }
  const selected = carcassBoardOf(board);
  return panel.mat === selected.back && panel.t === selected.backCoreT ? selected.backItem : selected.item;
}

function shutterMasterItem(shutterType: string): CostingMasterItem | undefined {
  return SHUTTER_BOARD_ITEMS.find((item) => item.id === shutterType);
}

const hardwareNameKey = (value: string) => value.toUpperCase().replace(/\bXX\b/g, "").replace(/[^A-Z0-9]/g, "");
function hardwareMasterItem(name: string): CostingMasterItem | undefined {
  const key = hardwareNameKey(name);
  // Costing authority is the KITCHEN sheet. Hardware-sheet rows are retained
  // for pack composition/reference only and must not supply cabinet rates.
  const kitchenItems = COSTING_ITEMS.filter((item) => item.id.startsWith("KITCHEN-"));
  const exact = kitchenItems.find((item) => hardwareNameKey(item.materialDescription) === key);
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
    const size = upper.match(/(?:XX|X)?(16|25|30|75)\s*MM/)?.[1];
    return kitchenItems.find((item) => item.subgroup === "Screw" && (!size || item.type.includes(size)));
  }
  return undefined;
}

function profileMasterItem(profile: Profile, neon: string): CostingMasterItem | undefined {
  const profileName = NEON_LABEL[neon] ?? neon;
  const type = `${profileName} ${profile.type === "V" ? "Shutter" : "Handle"} Profile`;
  return COSTING_ITEMS.find((item) => item.group === "Profile" && item.type === type && item.rateBasis === "MTR");
}

function otherAccessoryMasterItem(name: string): CostingMasterItem | undefined {
  const exact = COSTING_ITEMS.find((item) => item.id.startsWith("KITCHEN-") && hardwareNameKey(item.materialDescription) === hardwareNameKey(name));
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
): CostingResult {
  const lines: LineCost[] = [];
  const unpriced = new Set<string>();

  // Compatibility fallback for filler/visible-panel rows outside a cabinet.
  void rates;

  project.forEach((l) => {
    const m = l.m;
    const st = isGlassShutterFam(m.fk) ? "GLASS" : m.shType;
    const details: CostDetail[] = [];
    const addDetail = (detail: CostDetail) => {
      const existing = details.find((row) => row.category === detail.category && row.itemCode === detail.itemCode && row.rate === detail.rate && row.wastePct === detail.wastePct);
      if (existing) {
        existing.netQty += detail.netQty;
        existing.billableQty += detail.billableQty;
        existing.amount += detail.amount;
      } else details.push(detail);
    };
    m.panels.forEach((p) => {
      const a = sqft(p.w, p.h) * p.qty * l.qty;
      if (p.pack === "Shutter Pack") {
        const panelShutterType = /glass/i.test(p.mat ?? "") ? "GLASS" : m.shType;
        const masterItem = panelShutterType === "GLASS" ? glassShutterItemOf(m.glassType) : shutterMasterItem(panelShutterType);
        if (!masterItem) { unpriced.add(`${shOf(panelShutterType).label} shutter board`); return; }
        const billed = a * (1 + wst.shutter / 100);
        addDetail({ category: panelShutterType === "GLASS" ? "Shutter glass" : "Shutter board", itemCode: masterItem.id, item: masterItem.materialDescription, specification: `${masterItem.subgroup} · ${masterItem.thicknessMm ?? "—"}mm`, netQty: a, wastePct: wst.shutter, billableQty: billed, uom: "sqft", rate: masterItem.currentRate, amount: billed * masterItem.currentRate });
      } else {
        const masterItem = carcassMasterItem(m.board, p);
        if (!masterItem) { unpriced.add(`${p.mat ?? "Unknown"} ${p.t ?? ""}mm board`); return; }
        const billed = a * (1 + wst.carcass / 100);
        const category = /glass/i.test(p.mat ?? "") ? "Glass shelf" : p.pack === "Drawer Pack" ? "Drawer board" : masterItem.group === "Carcass Back Material" ? "Carcass back board" : "Carcass board";
        addDetail({ category, itemCode: masterItem.id, item: masterItem.materialDescription, specification: `${masterItem.subgroup} · ${masterItem.thicknessMm ?? "—"}mm`, netQty: a, wastePct: wst.carcass, billableQty: billed, uom: "sqft", rate: masterItem.currentRate, amount: billed * masterItem.currentRate });
      }
    });
    ([
      { shutter: false, master: findCostingItem({ group: "Edge Band", subgroup: "Carcass", rateBasis: "MTR" }) },
      { shutter: true, master: findCostingItem({ group: "Edge Band", subgroup: "Shutter", rateBasis: "MTR" }) },
    ]).forEach(({ shutter, master }) => {
      const bandM = m.panels.reduce((sum, p) => sum + (p.band && (p.pack === "Shutter Pack") === shutter ? perim(p.w, p.h) * p.qty * l.qty : 0), 0);
      if (!bandM || !master) return;
      const billed = bandM * (1 + wst.carcass / 100);
      addDetail({ category: shutter ? "Shutter edge band" : "Carcass edge band", itemCode: master.id, item: master.materialDescription, specification: `${master.subgroup} · ${master.thicknessMm ?? "—"}mm`, netQty: bandM, wastePct: wst.carcass, billableQty: billed, uom: "RMT", rate: master.currentRate, amount: billed * master.currentRate });
    });
    m.profiles.forEach((profile) => {
      const masterProfile = profileMasterItem(profile, m.neon);
      if (!masterProfile && profile.type !== "TOP") {
        unpriced.add(`${profile.name} (${profile.type})`);
        return;
      }
      const netM = profile.len / 1000 * profile.qty * l.qty;
      const billedM = netM * (1 + wst.profile / 100);
      addDetail({
        category: "Profile",
        itemCode: masterProfile?.id ?? "FALLBACK-1",
        item: masterProfile?.materialDescription ?? profile.name,
        specification: `${masterProfile?.type ?? "Base top profile"} · ${profile.orientation ?? (profile.type === "V" ? "vertical" : "horizontal")} · ${profile.len}mm × ${profile.qty} per cabinet`,
        netQty: netM,
        wastePct: wst.profile,
        billableQty: billedM,
        uom: "RMT",
        rate: masterProfile?.currentRate ?? 1,
        amount: billedM * (masterProfile?.currentRate ?? 1),
      });
    });
    m.hardware.flatMap(expandHardwarePack).forEach((h) => {
      if (/^HINGE\b/i.test(h.name)) {
        const hingeItem = hardwareMasterItem(h.name);
        const rate = hingeItem?.currentRate ?? 1;
        details.push({ category: "Hardware", itemCode: hingeItem?.id ?? "FALLBACK-1", item: hingeItem?.materialDescription ?? h.name, specification: h.pack, netQty: h.qty * l.qty, wastePct: 0, billableQty: h.qty * l.qty, uom: "nos", rate, amount: h.qty * l.qty * rate });
        return;
      }
      if (/^DRAWER BOX SET/i.test(h.name)) {
        const family = famSetOf(m.zk)[m.fk];
        const variant = family?.variants?.find((candidate: any) => candidate.id === m.vid);
        const mix = family && variant ? drawerBreakdown(family, variant) : [{ cls: "HIGH" as DrawerClass, n: h.qty }];
        mix.forEach(({ cls, n }) => {
          const subgroup = cls === "LOW" ? "Low Back" : "High Back";
          const masterDrawer = COSTING_ITEMS.find((item) => item.group === "Drawer System" && item.brand.toLowerCase() === m.drawerModel.toLowerCase() && item.subgroup.toLowerCase().includes(subgroup.toLowerCase()));
          const drawerRate = masterDrawer?.currentRate ?? 0;
          if (drawerRate > 0) details.push({ category: "Drawer system", itemCode: masterDrawer?.id ?? "—", item: masterDrawer?.materialDescription ?? `${m.drawerModel} ${subgroup}`, specification: `${n} per cabinet · ${masterDrawer?.type ?? subgroup}`, netQty: n * l.qty, wastePct: 0, billableQty: n * l.qty, uom: "set", rate: drawerRate, amount: n * l.qty * drawerRate });
          else unpriced.add(`${m.drawerModel} drawer box sets (${cls === "LOW" ? "LB" : "HB"})`);
        });
        return;
      }
      const masterHardware = hardwareMasterItem(h.name);
      const rate = masterHardware?.currentRate ?? 1;
      addDetail({ category: masterHardware?.group ?? "Hardware", itemCode: masterHardware?.id ?? "FALLBACK-1", item: masterHardware?.materialDescription ?? h.name, specification: h.pack, netQty: h.qty * l.qty, wastePct: 0, billableQty: h.qty * l.qty, uom: masterHardware?.rateBasis === "SET" ? "set" : "nos", rate, amount: h.qty * l.qty * rate });
    });
    const cost = details.reduce((sum, detail) => sum + detail.amount, 0);
    lines.push({ label: `${l.elevation} · ${m.code}`, code: m.code, qty: l.qty, unitCost: l.qty ? cost / l.qty : cost, cost, details });
  });

  // Fillers & visible panels — shutter-type panels, costed at the shutter rate.
  const extraRows = [...fillers.map(() => globalShType), ...visiblePanels.map((v) => v.shutterType || globalShType)];
  extrasPanels.forEach((p, i) => {
    const st = extraRows[i];
    if (st === undefined) return; // countertops emit no panels
    const boardItem = shutterMasterItem(st);
    const rate = boardItem?.currentRate ?? 0;
    const net = sqft(p.w, p.h) * p.qty;
    const billed = net * (1 + wst.shutter / 100);
    const details: CostDetail[] = [{ category: "Shutter board", itemCode: boardItem?.id ?? "—", item: boardItem?.materialDescription ?? shOf(st).mat, specification: `${boardItem?.subgroup ?? shOf(st).label} · ${boardItem?.thicknessMm ?? p.t ?? "—"}mm`, netQty: net, wastePct: wst.shutter, billableQty: billed, uom: "sqft", rate, amount: billed * rate }];
    if (p.band) {
      const band = perim(p.w, p.h) * p.qty;
      const bandBilled = band * (1 + wst.carcass / 100);
      const bandItem = findCostingItem({ group: "Edge Band", subgroup: "Shutter", rateBasis: "MTR" });
      const bandRate = bandItem?.currentRate ?? 0;
      details.push({ category: "Edge band", itemCode: bandItem?.id ?? "—", item: bandItem?.materialDescription ?? "Shutter matching edge band", specification: "Shutter matching · 0.8mm", netQty: band, wastePct: wst.carcass, billableQty: bandBilled, uom: "RMT", rate: bandRate, amount: bandBilled * bandRate });
    }
    const cost = details.reduce((sum, detail) => sum + detail.amount, 0);
    lines.push({ label: `${p.name}`, qty: p.qty, unitCost: p.qty ? cost / p.qty : cost, cost, details });
  });

  countertops.forEach((countertop) => {
    const length = Number(countertop.length);
    const depth = Number(countertop.depth || 600);
    const selected = countertopMaterialItem(countertop, countertopShType);
    const thickness = Number(countertop.thickness || selected?.thicknessMm || 30);
    if (!(length > 0 && depth > 0 && thickness > 0)) return;
    const qty = Math.max(1, countertop.qty || 1);
    const netQty = sqft(length, depth) * qty;
    const rate = selected?.currentRate ?? Number(countertop.ratePerSqft);
    const material = selected?.materialDescription ?? (countertop.material.trim() || "Unspecified material");
    const label = `Countertop ${material} ${thickness}mm ${length}x${depth}`;
    if ((!selected && !countertop.ratePerSqft) || !Number.isFinite(rate) || rate <= 0) {
      unpriced.add(`${label} (countertop rate per sqft)`);
      lines.push({ label, qty, unitCost: 0, cost: 0, details: [] });
      return;
    }
    const amount = netQty * rate;
    lines.push({ label, qty, unitCost: amount / qty, cost: amount, details: [{
      category: "Countertop", itemCode: selected?.id ?? `CT-${length}x${depth}x${thickness}`,
      item: material, specification: `${selected?.subgroup ?? "Custom material"} · ${length}×${depth}×${thickness}mm · bought-in`,
      netQty, wastePct: 0, billableQty: netQty, uom: "sqft", rate, amount,
    }] });
  });

  otherAccessories.forEach((accessory) => {
    const details: CostDetail[] = [];
    const addAccessoryDetail = (name: string, specification: string, netQty: number, billableQty: number, uom: CostDetail["uom"], wastePct = 0) => {
      const item = otherAccessoryMasterItem(name);
      const rate = item?.currentRate ?? 1;
      details.push({
        category: "Other accessory",
        itemCode: item?.id ?? "FALLBACK-1",
        item: item?.materialDescription ?? name,
        specification,
        netQty,
        wastePct,
        billableQty,
        uom,
        rate,
        amount: billableQty * rate,
      });
    };
    if (accessory.kind === "skirting") {
      const netM = parseFloat(accessory.size) || defSkirtMeters(project);
      addAccessoryDetail("PVC SKIRTING PROFILE 100MM", `${netM}m skirting run`, netM, netM * (1 + SKIRT_WASTE), "RMT", SKIRT_WASTE * 100);
      if (accessory.straight > 0) addAccessoryDetail("SKIRTING STRAIGHT CONNECTOR", "Straight connector", accessory.straight, accessory.straight, "nos");
      if (accessory.lconn > 0) addAccessoryDetail("SKIRTING L CONNECTOR", "L connector", accessory.lconn, accessory.lconn, "nos");
    } else {
      const heightMm = parseFloat(accessory.size) || 720;
      const qty = accessory.qty || 1;
      const netM = heightMm / 1000 * 2 * qty;
      const billedM = Math.ceil(heightMm * (1 + LIGHT_WASTE)) / 1000 * 2 * qty;
      for (const item of [LIGHT_ITEMS.profile, LIGHT_ITEMS.diffuser, LIGHT_ITEMS.led]) {
        addAccessoryDetail(item.materialDescription, `${heightMm}mm × 2 per set`, netM, billedM, "RMT", LIGHT_WASTE * 100);
      }
      addAccessoryDetail(LIGHT_ITEMS.wire.materialDescription, "2m per set", 2 * qty, 2 * qty, "RMT");
      const driver = selectedDriver(accessory.driver);
      if (driver) addAccessoryDetail(driver.materialDescription, "Driver", qty, qty, "nos");
    }
    const cost = details.reduce((sum, detail) => sum + detail.amount, 0);
    const qty = accessory.qty || 1;
    lines.push({ label: `${accessory.elevation ? `${accessory.elevation} · ` : ""}${ACC_LABEL[accessory.kind]}`, qty, unitCost: qty ? cost / qty : cost, cost, details });
  });

  masterAccessories.forEach((row) => {
    const item = MASTER_ACCESSORY_ITEMS.find((candidate) => candidate.id === row.itemId);
    if (!item) return;
    const qty = Math.max(1, row.qty || 1);
    if (!item.priced || !Number.isFinite(item.currentRate) || item.currentRate <= 0) {
      unpriced.add(`${item.materialDescription} (reference accessory)`);
      lines.push({ label: `${row.elevation ? `${row.elevation} · ` : ""}${item.materialDescription}`, qty, unitCost: 0, cost: 0, details: [] });
      return;
    }
    const uom: CostDetail["uom"] = item.rateBasis === "SET" ? "set" : item.rateBasis === "MTR" ? "RMT" : "nos";
    const amount = qty * item.currentRate;
    lines.push({
      label: `${row.elevation ? `${row.elevation} · ` : ""}${item.subgroup}`,
      qty, unitCost: item.currentRate, cost: amount,
      details: [{ category: "Accessory", itemCode: item.id, item: item.materialDescription, specification: `${item.subgroup}${item.brand ? ` · ${item.brand}` : ""}`, netQty: qty, wastePct: 0, billableQty: qty, uom, rate: item.currentRate, amount }],
    });
  });

  return { lines, total: lines.reduce((a, x) => a + x.cost, 0), unpriced: [...unpriced] };
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

export function WoodBomBuilder({ soMode = false, planningMode = false }: { soMode?: boolean; planningMode?: boolean } = {}) {
  const railRef = useRef<HTMLElement>(null);
  const pdfImportRef = useRef<HTMLInputElement>(null);
  const [zk, setZk] = useState("BC");
  const [fk, setFk] = useState("SH");
  const [vid, setVid] = useState("single");
  const [hand, setHand] = useState("LHS");
  const [handle, setHandle] = useState("STD");
  const [board, setBoard] = useState(DEFAULT_BOARD_ID);
  const [shType, setShType] = useState(DEFAULT_SHTYPE);
  const [glassType, setGlassType] = useState(DEFAULT_GLASS_TYPE);
  const [hingeChoice, setHingeChoice] = useState<HingeChoice>("Hettich Soft Close");
  const [neon] = useState("NEON50");
  const [hingeLocked, setHingeLocked] = useState(false);
  const [drawerModel, setDrawerModel] = useState("Hettich");
  const [drawerLocked, setDrawerLocked] = useState(false);
  const [finish, setFinish] = useState((boardFinishesData as string[])[0] ?? "White");
  const [elevation, setElevation] = useState("AA");
  const [qty, setQty] = useState(1);
  const [W, setW] = useState(600);
  const [H, setH] = useState(720);
  const [D, setD] = useState(560);
  const [project, setProject] = useState<ProjectLine[]>([]);
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const [tab, setTab] = useState<"packets" | "raw" | "totals">("packets");

  useEffect(() => {
    if (project.length === 0) {
      setHingeLocked(false);
      setDrawerLocked(false);
    }
  }, [project.length]);

  /* --- new sections: fillers / visible panels / countertop / accessories --- */
  const [fillers, setFillers] = useState<FillerRow[]>([]);
  const [visiblePanels, setVisiblePanels] = useState<VisiblePanelRow[]>([]);
  const [countertops, setCountertops] = useState<CountertopRow[]>([]);
  const [accessories, setAccessories] = useState<AccessoryRow[]>([]);
  const [masterAccessories, setMasterAccessories] = useState<MasterAccessoryRow[]>([]);
  const [accessorySearch, setAccessorySearch] = useState<Record<number, string>>({});
  const [waste, setWaste] = useState({ ...WASTE });
  const [projectPricingInputs, setProjectPricingInputs] = useState<ProjectPricingInputs>(DEFAULT_PROJECT_PRICING);

  const nextIdOf = (list: { id: number }[]) => list.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const addFiller = () => setFillers((c) => [...c, { id: nextIdOf(c), zone: "base", customShade: "", qty: 1, customHeight: "", customWidth: "", elevation: "" }]);
  const updFiller = (id: number, p: Partial<FillerRow>) => setFillers((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const rmFiller = (id: number) => setFillers((c) => c.filter((r) => r.id !== id));
  const addVp = () => setVisiblePanels((c) => [...c, { id: nextIdOf(c), zone: "base", customShade: "", qty: 1, customHeight: "", customWidth: "", elevation: "", shutterType: "" }]);
  const updVp = (id: number, p: Partial<VisiblePanelRow>) => setVisiblePanels((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const rmVp = (id: number) => setVisiblePanels((c) => c.filter((r) => r.id !== id));
  const addCt = () => setCountertops((c) => [...c, { id: nextIdOf(c), length: "", depth: "600", thickness: "", material: "", materialId: "", ratePerSqft: "", qty: 1 }]);
  const updCt = (id: number, p: Partial<CountertopRow>) => setCountertops((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const rmCt = (id: number) => setCountertops((c) => c.filter((r) => r.id !== id));
  const addAcc = () => setAccessories((c) => [...c, { id: nextIdOf(c), kind: "skirting", size: "", qty: 1, elevation: "", straight: 0, lconn: 0, driver: "" }]);
  const updAcc = (id: number, p: Partial<AccessoryRow>) => setAccessories((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const rmAcc = (id: number) => setAccessories((c) => c.filter((r) => r.id !== id));
  const addMasterAcc = () => setMasterAccessories((c) => [...c, { id: nextIdOf(c), itemId: MASTER_ACCESSORY_ITEMS[0]?.id ?? "", qty: 1, elevation: "" }]);
  const updMasterAcc = (id: number, p: Partial<MasterAccessoryRow>) => setMasterAccessories((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
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
  const v = fam.variants.find((x: any) => x.id === vid) ?? fam.variants[0];
  const sizes = useMemo(() => defSizes(zk, fkSafe), [zk, fkSafe]);
  const isGlass = isGlassShutterFam(fkSafe);
  const drawerOnly = !!fam.drawers && !fam.fixedDpn && !(ZONES[zk].tall && fkSafe === "APP");

  const m = useMemo(
    () => buildModel({ zk, fk: fkSafe, vid: v.id, hand, handle, board, shType, glassType, hingeChoice, neon, W, H, D, drawerModel, finish }),
    [zk, fkSafe, v.id, hand, handle, board, shType, glassType, hingeChoice, neon, W, H, D, drawerModel, finish],
  );

  const onZone = useCallback((z: string) => {
    setZk(z);
    const f = Object.keys(famSetOf(z))[0];
    setFk(f);
    setVid(famSetOf(z)[f].variants[0].id);
    const s = defSizes(z, f);
    setW(s.w[0]); setH(s.h[0]); setD(s.d);
  }, []);

  const onFam = useCallback((f: string) => {
    setFk(f);
    setVid(fams[f].variants[0].id);
    const s = defSizes(zk, f);
    setW(s.w[0]); setH(s.h[0]); setD(s.d);
  }, [zk, fams]);

  const addLine = () => {
    if (editingLineId !== null) {
      setProject((p) => p.map((line) => line.id === editingLineId ? { ...line, m, qty, elevation } : line));
      setEditingLineId(null);
    } else {
      setProject((p) => [...p, { id: Date.now() + Math.random(), m, qty, elevation }]);
    }
    if (!drawerOnly) setHingeLocked(true);
    if (fam.drawers) setDrawerLocked(true);
  };
  const loadConfig = (config: CabinetConfig) => {
    setZk(config.zk); setFk(config.fk); setVid(config.vid); setHand(config.hand);
    setHandle(config.handle); setBoard(config.board); setShType(config.shType);
    setGlassType(config.glassType); setHingeChoice(config.hingeChoice);
    setDrawerModel(config.drawerModel); setFinish(config.finish);
    setW(config.W); setH(config.H); setD(config.D);
  };
  const editLine = (line: ProjectLine) => {
    loadConfig(cabinetConfig(line.m));
    setElevation(line.elevation); setQty(line.qty); setEditingLineId(line.id);
    railRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const delLine = (id: number) => {
    if (editingLineId === id) setEditingLineId(null);
    setProject((p) => p.filter((x) => x.id !== id));
  };

  const importFile = async (file: File) => {
    setImportError(""); setImportMessage("");
    try {
      const restored = await readProjectFile(file);
      if (project.length > 0 && !window.confirm("Replace the current project with the imported file?")) return;
      setProject(restored.project);
      setFillers(restored.fillers); setVisiblePanels(restored.visiblePanels);
      setCountertops(restored.countertops); setAccessories(restored.accessories);
      setMasterAccessories(restored.masterAccessories);
      setWaste(restored.waste); setProjectPricingInputs(restored.pricing);
      const current = restored.current ?? (restored.project[0] ? { config: cabinetConfig(restored.project[0].m), elevation: restored.project[0].elevation, qty: restored.project[0].qty } : undefined);
      if (current) {
        loadConfig(current.config); setElevation(current.elevation); setQty(current.qty);
      }
      setEditingLineId(null); setStockMap({});
      setRawMap(Object.fromEntries(restored.rawSelections.map((selection) => [selection.key, {
        loading: false, error: "", sel: selection.id,
        items: [{ item_id: selection.id, name: selection.name, sku: selection.sku, stock_on_hand: selection.stock_on_hand }],
      }])));
      setHingeLocked(restored.project.some((line) => !famSetOf(line.m.zk)[line.m.fk]?.drawers || !!famSetOf(line.m.zk)[line.m.fk]?.fixedDpn));
      setDrawerLocked(restored.project.some((line) => !!famSetOf(line.m.zk)[line.m.fk]?.drawers));
      setImportMessage(restored.notice);
      setTab("totals");
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
    () => buildExtrasBom(fillers, visiblePanels, countertops, project, soMode ? "SO" : "", shType, countertopShutterType, finish, waste),
    [fillers, visiblePanels, countertops, project, soMode, shType, countertopShutterType, finish, waste],
  );
  const boardTotals = useMemo(() => buildBoardTotals(project, waste, extras.panels), [project, waste, extras]);
  const fullBom = useMemo(
    () => [...buildFullBomData(project, soMode ? "SO" : "", finish, waste), ...extras.rows],
    [project, soMode, finish, waste, extras],
  );
  const accessoryRows = useMemo(() => [
    ...buildAccessoryRows(accessories, project, soMode ? "SO" : ""),
    ...buildMasterAccessoryRows(masterAccessories, soMode ? "SO" : ""),
  ], [accessories, masterAccessories, project, soMode]);
  const rawSelections = useMemo(() => Object.entries(rawMap).flatMap(([key, state]) => {
    if (!state.sel) return [];
    const item = state.items.find((candidate) => candidate.item_id === state.sel);
    return [{ key, id: state.sel, name: item?.name ?? "", sku: item?.sku ?? "", stock_on_hand: item?.stock_on_hand }];
  }), [rawMap]);
  const printRestoreLines = useMemo(() => encodeProjectPrintData(projectSetupRows({
    project, fillers, visiblePanels, countertops, accessories, masterAccessories,
    waste, pricing: projectPricingInputs, rawSelections,
    current: W > 0 && H > 0 && D > 0 ? { config: cabinetConfig(m), elevation, qty } : undefined,
  })), [project, fillers, visiblePanels, countertops, accessories, masterAccessories, waste, projectPricingInputs, rawSelections, W, H, D, m, elevation, qty]);
  const costing = useMemo(
    () => computeCosting(project, fillers, visiblePanels, countertops, extras.panels, accessories, masterAccessories, shType, countertopShutterType, rates, waste),
    [project, fillers, visiblePanels, countertops, extras, accessories, masterAccessories, shType, countertopShutterType, rates, waste],
  );
  const projectPricing = useMemo(() => {
    const cabinetAreas = project.map((line) => ({
      label: `${line.elevation} · ${line.m.code}`,
      qty: line.qty,
      eachSqft: sqft(line.m.W, line.m.H),
      sqft: sqft(line.m.W, line.m.H) * line.qty,
    }));
    const cabinetSqft = cabinetAreas.reduce((total, line) => total + line.sqft, 0);
    const serviceAmount = (charge: ServiceCharge) => charge.mode === "sqft"
      ? Number(charge.value || 0) * cabinetSqft
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
    const allocatedCharges = cabinetAreas.map((line) => {
      const share = cabinetSqft > 0 ? line.sqft / cabinetSqft : 0;
      const allocation = (charge: ServiceCharge, total: number) => charge.mode === "sqft"
        ? line.sqft * Number(charge.value || 0)
        : total * share;
      return {
        ...line,
        transportation: allocation(projectPricingInputs.transportation, transportation),
        installation: allocation(projectPricingInputs.installation, installation),
        loading: allocation(projectPricingInputs.loading, loading),
      };
    });
    return { cabinetSqft, baseCost, conversion, convertedCost, profit, transportation, installation, loading, subtotal, tax, grandTotal: subtotal + tax, allocatedCharges };
  }, [costing, project, projectPricingInputs]);
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
          <input ref={pdfImportRef} type="file" accept=".pdf,application/pdf" aria-label="Import printed project PDF" style={{ display: "none" }} onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = "";
          }} />
          <button type="button" className="add" onClick={() => pdfImportRef.current?.click()}>Import printed PDF</button>
          <button type="button" className="add" disabled={project.length === 0} onClick={() => {
            setTab("totals");
            requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
          }}>Print project PDF</button>
        </div>
        <div className="hd-n">
          <span>cabinets<b>{project.reduce((a, l) => a + l.qty, 0)}</b></span>
          <span>sheets<b>{boardTotals.reduce((a, b) => a + (b.sheets ?? 0), 0).toFixed(1)}</b></span>
        </div>
      </header>
      {importError && <p className="header-import-error" role="alert">{importError}</p>}
      {importMessage && <p className="header-import-success" role="status">{importMessage}</p>}

      <div className="body">
        {/* ---------------- Configure Unit ---------------- */}
        <aside className="rail" ref={railRef}>
          <h2>Configure unit</h2>

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
            <select value={v.id} onChange={(e) => setVid(e.target.value)}>
              {fam.variants.map((x: any) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </Fld>

          {v.handed && (
            <Fld label="Hand"><Seg opts={[["LHS", "LHS"], ["RHS", "RHS"]]} val={hand} set={setHand} /></Fld>
          )}

          <Fld label="Handle / profile">
            <Seg opts={[["STD", "Standard"], ["XCJ", "Gola"]]} val={handle} set={setHandle} />
            {handle === "XCJ" && <Hint>Top depth cuts to {D - CJ_CUT}. Base shutters lose 33mm.</Hint>}
          </Fld>

          {!drawerOnly && (
            <Fld label="Hinge brand and type">
              <select value={hingeChoice} disabled={hingeLocked} onChange={(e) => setHingeChoice(e.target.value as HingeChoice)}>
                {HINGE_CHOICES.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
              </select>
              <Hint>{hingeLocked ? "Locked for this kitchen plan · " : ""}{hingeModeFor(zk, fkSafe) === "wide" ? "165° · Pullout cabinet" : hingeModeFor(zk, fkSafe) === "blind" ? "Blind hinge · Blind cabinet" : "95–110° · Standard cabinet"}</Hint>
            </Fld>
          )}

          <Fld label="Carcass board type">
            <select value={board} onChange={(e) => setBoard(e.target.value)}>
              {CARCASS_BOARD_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.subgroup} · {item.thicknessMm ?? "—"}mm</option>)}
            </select>
            <Hint>{carcassBoardOf(board).core} · Back: {carcassBoardOf(board).backItem?.subgroup ?? "—"} · {carcassBoardOf(board).backCoreT}mm</Hint>
          </Fld>

          {!fam.noShutter && (isGlass ? (
            <>
              <Fld label="Glass material type">
                <select value={glassType} onChange={(e) => setGlassType(e.target.value)}>
                  {GLASS_SHUTTER_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.subgroup}</option>)}
                </select>
                <Hint>Shutters use 5mm glass. Internal glass shelves use 6mm clear glass at ₹{GLASS_SHELF_ITEM?.currentRate ?? 135}/sqft.</Hint>
              </Fld>
              <Fld label="Neon profile">
                <div className="fixed-value">Neon 50</div>
                <Hint>Glass shutters use Neon 50 only — inset {SH_INSET.NEON50}mm, frame {SH_FRAME.NEON50}mm.</Hint>
              </Fld>
            </>
          ) : (
            <Fld label="Shutter board type">
              <select value={shType} onChange={(e) => setShType(e.target.value)}>
                {SHUTTER_BOARD_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.subgroup} · {item.thicknessMm ?? "—"}mm</option>)}
              </select>
              <Hint>{shOf(shType).mat} · cut at {shOf(shType).t}mm · {shOf(shType).band ? `${BAND_T}mm band, all edges` : "no edge band"}</Hint>
            </Fld>
          ))}

          {fam.drawers && (
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

          <Fld label="Dimensions (W · H · D)">
            <div className="g3">
              <input type="number" min={1} step={1} list="cabinet-width-presets" aria-label="Width in millimetres" title="Width (mm)" placeholder="Width" value={W || ""} onChange={(e) => setW(e.target.value === "" ? 0 : +e.target.value)} />
              <datalist id="cabinet-width-presets">{sizes.w.map((x) => <option key={x} value={x} />)}</datalist>
              <input type="number" min={1} step={1} list="cabinet-height-presets" aria-label="Height in millimetres" title="Height (mm)" placeholder="Height" value={H || ""} onChange={(e) => setH(e.target.value === "" ? 0 : +e.target.value)} />
              <datalist id="cabinet-height-presets">{sizes.h.map((x) => <option key={x} value={x} />)}</datalist>
              <input type="number" min={1} step={1} list="cabinet-depth-presets" aria-label="Depth in millimetres" title="Depth (mm)" placeholder="Depth" value={D || ""} onChange={(e) => setD(e.target.value === "" ? 0 : +e.target.value)} />
              <datalist id="cabinet-depth-presets"><option value={sizes.d} /></datalist>
            </div>
            <Hint>Enter any custom width, height, or depth in millimetres. Standard sizes appear as suggestions.</Hint>
          </Fld>

          <Fld label="Elevation & quantity">
            <div className="g2">
              <select value={elevation} onChange={(e) => setElevation(e.target.value)}>
                {ELEVATIONS.map((x) => <option key={x}>{x}</option>)}
              </select>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, +e.target.value))} />
            </div>
          </Fld>

          <button className="add" disabled={W <= 0 || H <= 0 || D <= 0} onClick={addLine}>{editingLineId === null ? "Add to project" : "Save cabinet changes"}</button>
          {editingLineId !== null && <button className="x" onClick={() => setEditingLineId(null)}>Cancel edit</button>}
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
                  p.w, p.h, p.t ?? "", p.qty, p.band ? r3(perim(p.w, p.h) * p.qty).toFixed(3) : "—"])} />
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
                  rows={m.cons.map((c) => [c.pack, c.name, r3(c.qty).toFixed(3), c.uom])} />
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
              {project.length === 0 ? <div className="empty">Configure a cabinet and add it to start a project.</div> : <>
                <h4>Project lines</h4>
                <Tbl head={["Elev", "Cabinet", "Description", "W×H×D", "Qty", ""]} num={[4]}
                  rows={project.map((l) => {
                    const packetRows = cabinetPacketRows(l.m);
                    const packNames = [...new Set([...l.m.pkRows.map((row) => row.pack), ...packetRows.map((row) => row.pack)])];
                    return [l.elevation,
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
                <div className="g3" style={{ maxWidth: 420 }}>
                  {(["carcass", "shutter", "profile"] as const).map((k) => (
                    <label key={k} style={{ fontSize: 11, color: "var(--mut)" }}>{k}
                      <input type="number" min={0} value={waste[k]}
                        onChange={(e) => setWaste((w0) => ({ ...w0, [k]: Math.max(0, +e.target.value) }))} />
                    </label>
                  ))}
                </div>

                <h4>Boards</h4>
                <Tbl head={["Material", "Thk", "Pack", "Sqft", "Waste %", "Sheets"]} num={[1, 3, 4, 5]}
                  rows={boardTotals.map((b) => [b.mat, b.t, b.pack, b.sqft.toFixed(2), b.waste,
                    b.sheets === null ? "by area" : b.sheets.toFixed(2)])} />
              </>}

              {/* ---- Fillers ---- */}
              <SecHead title="Fillers" onAdd={addFiller} />
              {fillers.length === 0 ? <div className="empty">No fillers. A filler is a shutter-type panel with {BAND_T}mm band — default width {FILLER_DEF_W}mm.</div> :
                <Tbl head={["Zone", "Qty", "Shade", "Height (mm)", "Width (mm)", "Elevation", ""]} num={[1]}
                  rows={fillers.map((f) => [
                    <select key="z" value={f.zone} onChange={(e) => updFiller(f.id, { zone: e.target.value })}>
                      {FILLER_ZONES.map((z) => <option key={z}>{z}</option>)}</select>,
                    <input key="q" type="number" min={1} value={f.qty} onChange={(e) => updFiller(f.id, { qty: Math.max(1, +e.target.value) })} style={{ width: 58 }} />,
                    <select key="s" value={f.customShade} onChange={(e) => updFiller(f.id, { customShade: e.target.value })}>
                      <option value="">Default ({finish})</option>
                      {(boardFinishesData as string[]).map((x) => <option key={x}>{x}</option>)}</select>,
                    <input key="h" type="number" placeholder={String(defFillerH(f.zone, project))} value={f.customHeight}
                      onChange={(e) => updFiller(f.id, { customHeight: e.target.value })} style={{ width: 80 }} />,
                    <input key="w" type="number" placeholder={String(FILLER_DEF_W)} value={f.customWidth}
                      onChange={(e) => updFiller(f.id, { customWidth: e.target.value })} style={{ width: 80 }} />,
                    <input key="e" list="elev-list" value={f.elevation} onChange={(e) => updFiller(f.id, { elevation: e.target.value })} style={{ width: 64 }} />,
                    <button key="x" className="x" onClick={() => rmFiller(f.id)}>×</button>,
                  ])} />}

              {/* ---- Visible Panels ---- */}
              <SecHead title="Visible Panels" onAdd={addVp} />
              {visiblePanels.length === 0 ? <div className="empty">No visible panels. Only on customer request — height matches the shutter, width = carcass depth + {VP_DEPTH_ADD}mm.</div> :
                <Tbl head={["Zone", "Qty", "Shutter type", "Shade", "Height (mm)", "Width (mm)", "Elevation", ""]} num={[1]}
                  rows={visiblePanels.map((f) => [
                    <select key="z" value={f.zone} onChange={(e) => updVp(f.id, { zone: e.target.value })}>
                      {FILLER_ZONES.map((z) => <option key={z}>{z}</option>)}</select>,
                    <input key="q" type="number" min={1} value={f.qty} onChange={(e) => updVp(f.id, { qty: Math.max(1, +e.target.value) })} style={{ width: 58 }} />,
                    <select key="t" value={f.shutterType} onChange={(e) => updVp(f.id, { shutterType: e.target.value })}>
                      <option value="">Default ({shOf(shType).label})</option>
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

              {/* ---- Countertop ---- */}
              <SecHead title="Countertop" onAdd={addCt} />
              {countertops.length === 0 ? <div className="empty">No countertop. Add a single-sheet top; its board follows the shutter material by default, or select another shutter board.</div> : <>
                <p className="hint">Same as shutter follows the sole solid-shutter board in the project; if several are used, it follows the current configuration. Catalog rates are per square foot.</p>
                <Tbl head={["Length (mm)", "Depth (mm)", "Thk (mm)", "Material", "Rate (Rs/sqft)", "Qty", ""]} num={[4, 5]}
                  rows={countertops.map((c) => [
                    <input key="l" type="number" value={c.length} onChange={(e) => updCt(c.id, { length: e.target.value })} style={{ width: 90 }} />,
                    <input key="d" type="number" placeholder="600" value={c.depth} onChange={(e) => updCt(c.id, { depth: e.target.value })} style={{ width: 80 }} />,
                    <input key="t" type="number" placeholder={String(countertopMaterialItem(c, countertopShutterType)?.thicknessMm ?? 30)} value={c.thickness} onChange={(e) => updCt(c.id, { thickness: e.target.value })} style={{ width: 64 }} />,
                    <div key="m" style={{ display: "grid", gap: 4 }}>
                      <select value={countertopMaterialId(c)} aria-label="Countertop material" onChange={(e) => {
                        const id = e.target.value;
                        const previousThickness = countertopMaterialItem(c, countertopShutterType)?.thicknessMm;
                        const nextItem = id === "" ? shutterMasterItem(countertopShutterType) : SHUTTER_BOARD_ITEMS.find((item) => item.id === id);
                        updCt(c.id, { materialId: id, material: id === "CUSTOM" ? c.material : id ? nextItem?.materialDescription ?? "" : "",
                          thickness: !c.thickness || Number(c.thickness) === previousThickness ? String(nextItem?.thicknessMm ?? "") : c.thickness });
                      }} style={{ minWidth: 180 }}>
                        <option value="">Same as shutter ({shOf(countertopShutterType).label})</option>
                        {SHUTTER_BOARD_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.subgroup} · {item.thicknessMm ?? "—"}mm</option>)}
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

              {/* ---- Other Accessories ---- */}
              <SecHead title="Other Accessories" onAdd={addAcc} />
              {accessories.length === 0 ? <div className="empty">Everything is opt-in: PVC skirting and the LED profile light (two height-length cuts per unit). Light profile, LED strip, diffuser, wire and drivers use the Kitchen master items.</div> : <>
                <Tbl head={["Accessory", "Size", "Qty", "Elevation", "Straight", "L-conn", "Driver", ""]} num={[2]}
                  rows={accessories.map((a) => [
                    <select key="k" value={a.kind} onChange={(e) => updAcc(a.id, { kind: e.target.value as AccessoryKind })}>
                      {(Object.keys(ACC_LABEL) as AccessoryKind[]).map((k) => <option key={k} value={k}>{ACC_LABEL[k]}</option>)}</select>,
                    <input key="s" type="number" value={a.size}
                      placeholder={a.kind === "skirting" ? `${defSkirtMeters(project)} m` : "H mm"}
                      onChange={(e) => updAcc(a.id, { size: e.target.value })} style={{ width: 90 }} />,
                    <input key="q" type="number" min={1} value={a.qty} onChange={(e) => updAcc(a.id, { qty: Math.max(1, +e.target.value) })} style={{ width: 58 }} />,
                    <input key="e" list="elev-list" value={a.elevation} onChange={(e) => updAcc(a.id, { elevation: e.target.value })} style={{ width: 64 }} />,
                    a.kind === "skirting" ? <input key="st" type="number" min={0} value={a.straight} onChange={(e) => updAcc(a.id, { straight: Math.max(0, +e.target.value) })} style={{ width: 58 }} /> : "—",
                    a.kind === "skirting" ? <input key="lc" type="number" min={0} value={a.lconn} onChange={(e) => updAcc(a.id, { lconn: Math.max(0, +e.target.value) })} style={{ width: 58 }} /> : "—",
                    a.kind === "elenor" ? <select key="dr" value={selectedDriver(a.driver)?.id ?? ""} onChange={(e) => updAcc(a.id, { driver: e.target.value })}>
                      <option value="">— no driver —</option>
                      {DRIVER_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.subgroup}</option>)}</select> : "—",
                    <button key="x" className="x" onClick={() => rmAcc(a.id)}>×</button>,
                  ])} />
              </>}

              {/* ---- Accessories from the priced KITCHEN master and reference catalog ---- */}
              <SecHead title="Accessories" onAdd={addMasterAcc} />
              {masterAccessories.length === 0 ? <div className="empty">No accessories selected. Priced Kitchen-master items and the wider reference accessory catalog are available.</div> :
                <Tbl head={["Search", "Accessory item", "Brand", "Rate (Rs)", "Qty", "Elevation", ""]} num={[3, 4]}
                  rows={masterAccessories.map((row) => {
                    const selected = MASTER_ACCESSORY_ITEMS.find((item) => item.id === row.itemId);
                    const query = (accessorySearch[row.id] ?? "").trim().toLowerCase();
                    const matching = query ? MASTER_ACCESSORY_ITEMS.filter((item) => `${item.subgroup} ${item.materialDescription}`.toLowerCase().includes(query)) : MASTER_ACCESSORY_ITEMS;
                    const options = selected && !matching.some((item) => item.id === selected.id) ? [selected, ...matching] : matching;
                    return [
                      <input key="search" type="search" aria-label="Search accessory catalog" placeholder="Search accessories" value={accessorySearch[row.id] ?? ""} onChange={(e) => setAccessorySearch((previous) => ({ ...previous, [row.id]: e.target.value }))} style={{ minWidth: 130 }} />,
                      <select key="i" value={row.itemId} onChange={(e) => updMasterAcc(row.id, { itemId: e.target.value })}>
                        {options.map((item) => <option key={item.id} value={item.id}>{item.subgroup} — {item.materialDescription}{item.priced ? "" : " (rate not in Kitchen master)"}</option>)}
                      </select>,
                      selected?.brand || "—",
                      selected?.priced ? selected.currentRate.toFixed(2) : "Unpriced",
                      <input key="q" type="number" min={1} value={row.qty} onChange={(e) => updMasterAcc(row.id, { qty: Math.max(1, +e.target.value) })} style={{ width: 58 }} />,
                      <input key="e" list="elev-list" value={row.elevation} onChange={(e) => updMasterAcc(row.id, { elevation: e.target.value })} style={{ width: 64 }} />,
                      <button key="x" className="x" onClick={() => rmMasterAcc(row.id)}>×</button>,
                    ];
                  })} />}

              {accessoryRows.length > 0 && <>
                <h4>Accessory lines (export preview)</h4>
                <Tbl head={["Accessory", "Item", "Size", "Total", "Actual Qty"]} num={[3, 4]}
                  rows={accessoryRows.map((r) => [r.Accessory, r["Item Name"], r.Size, r.Total, r["Actual Qty"]])} />
              </>}

              {/* ---- Costing with an auditable per-cabinet breakdown ---- */}
              <SecHead title="Costing (Rs)" />
              {costing.lines.length === 0 ? <div className="empty">Add cabinets to see costing.</div> : <>
                <Tbl head={["Cabinet / Item", "Qty", "Per cabinet (Rs)", "Total (Rs)"]} num={[1, 2, 3]}
                  rows={[
                    ...costing.lines.map((c) => [
                      <details key={c.label}>
                        <summary style={{ cursor: "pointer", color: "var(--acc)", fontWeight: 650 }}>{c.label}</summary>
                        <div style={{ margin: "10px 0 4px", overflowX: "auto" }}>
                          <table style={{ width: "100%", minWidth: 1040, borderCollapse: "collapse", fontSize: 11 }}>
                            <thead><tr>{["Category", "Master row", "Actual item code / board used", "Board type / thickness", "Total sqft / qty", "Waste", "Billable qty", "Basis", "Rate (Rs)", "Amount (Rs)"].map((heading) => <th key={heading} style={{ padding: "6px 7px", background: "#EEF1EE", border: "1px solid #D8DEDA", textAlign: "left" }}>{heading}</th>)}</tr></thead>
                            <tbody>{c.details.map((detail, index) => <tr key={`${detail.category}-${detail.item}-${index}`}>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.category}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", whiteSpace: "nowrap", fontWeight: 650 }}>{detail.itemCode}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.item}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.specification}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{detail.netQty.toFixed(3)}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{detail.wastePct}%</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{detail.billableQty.toFixed(3)}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.uom}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{detail.rate.toFixed(2)}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right", fontWeight: 650 }}>{detail.amount.toFixed(2)}</td>
                            </tr>)}</tbody>
                            <tfoot><tr><td colSpan={9} style={{ padding: "7px", textAlign: "right", fontWeight: 700 }}>Cabinet line total</td><td style={{ padding: "7px", textAlign: "right", fontWeight: 700 }}>{c.cost.toFixed(2)}</td></tr></tfoot>
                          </table>
                        </div>
                      </details>,
                      c.qty, c.unitCost.toFixed(2), c.cost.toFixed(2),
                    ]),
                    [<b key="t">Project costing total</b>, "", "", <b key="v">{costing.total.toFixed(2)}</b>],
                  ]} />
                {costing.unpriced.length > 0 && (
                  <Stub list={costing.unpriced.map((u) => `${u} — no rate set yet; not included in the total. An admin can set the rate on /admin.`)} />
                )}
                <div style={{ marginTop: 18, padding: 16, border: "1px solid #D8DEDA", borderRadius: 8, background: "#FAFBFA" }}>
                  <h3 style={{ margin: "0 0 4px" }}>Project pricing factors</h3>
                  <p style={{ margin: "0 0 14px", color: "#617069", fontSize: 12 }}>
                    Per-sqft charges use {projectPricing.cabinetSqft.toFixed(3)} sqft of cabinet front area (width × height × quantity).
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                    <Fld label="Conversion (%)">
                      <input type="number" min={0} step="0.01" value={projectPricingInputs.conversionPct}
                        placeholder="0" onChange={(e) => setProjectPricingInputs((p) => ({ ...p, conversionPct: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) }))} />
                    </Fld>
                    <Fld label="Profit (%)">
                      <input type="number" min={0} step="0.01" value={projectPricingInputs.profitPct}
                        placeholder="0" onChange={(e) => setProjectPricingInputs((p) => ({ ...p, profitPct: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) }))} />
                    </Fld>
                    {([
                      ["Transportation", "transportation"],
                      ["Installation", "installation"],
                      ["Loading / Unloading", "loading"],
                    ] as const).map(([label, key]) => (
                      <Fld key={key} label={label}>
                        <div style={{ display: "grid", gridTemplateColumns: "112px 1fr", gap: 6 }}>
                          <select aria-label={`${label} calculation method`} value={projectPricingInputs[key].mode}
                            onChange={(e) => setProjectPricingInputs((p) => ({ ...p, [key]: { ...p[key], mode: e.target.value as ChargeMode } }))}>
                            <option value="direct">Direct price</option>
                            <option value="sqft">Rs / sqft</option>
                          </select>
                          <input aria-label={`${label} rate`} type="number" min={0} step="0.01" value={projectPricingInputs[key].value}
                            placeholder="0" onChange={(e) => setProjectPricingInputs((p) => ({ ...p, [key]: { ...p[key], value: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) } }))} />
                        </div>
                      </Fld>
                    ))}
                    <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 36, alignSelf: "end", paddingBottom: 2, fontWeight: 650, cursor: "pointer" }}>
                      <input type="checkbox" checked={projectPricingInputs.includeTax}
                        onChange={(e) => setProjectPricingInputs((p) => ({ ...p, includeTax: e.target.checked }))} />
                      Include GST (18%)
                    </label>
                  </div>

                  <div style={{ marginTop: 14, overflowX: "auto" }}>
                    <table style={{ width: "100%", minWidth: 940, borderCollapse: "collapse", background: "white", fontSize: 12 }}>
                      <thead><tr>{["Cabinet", "Qty", "Sqft / cabinet", "Total cabinet sqft", "Transportation", "Installation", "Loading / Unloading"].map((heading) => <th key={heading} style={{ padding: "7px 9px", background: "#EEF1EE", border: "1px solid #D8DEDA", textAlign: heading === "Cabinet" ? "left" : "right" }}>{heading}</th>)}</tr></thead>
                      <tbody>{projectPricing.allocatedCharges.map((line, index) => <tr key={`${line.label}-${index}`}>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4" }}>{line.label}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.qty}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.eachSqft.toFixed(3)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>{line.sqft.toFixed(3)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.transportation.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.installation.toFixed(2)}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {line.loading.toFixed(2)}</td>
                      </tr>)}</tbody>
                      <tfoot><tr>
                        <td colSpan={3} style={{ padding: "8px 9px", border: "1px solid #D8DEDA", fontWeight: 750 }}>All cabinets total</td>
                        <td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right", fontWeight: 750 }}>{projectPricing.cabinetSqft.toFixed(3)}</td>
                        <td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right", fontWeight: 750 }}>Rs {projectPricing.transportation.toFixed(2)}</td>
                        <td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right", fontWeight: 750 }}>Rs {projectPricing.installation.toFixed(2)}</td>
                        <td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right", fontWeight: 750 }}>Rs {projectPricing.loading.toFixed(2)}</td>
                      </tr></tfoot>
                    </table>
                    {(projectPricingInputs.transportation.mode === "direct" || projectPricingInputs.installation.mode === "direct" || projectPricingInputs.loading.mode === "direct") && (
                      <p style={{ margin: "6px 0 0", color: "#617069", fontSize: 11 }}>Direct service prices are allocated to each cabinet in proportion to its front area.</p>
                    )}
                  </div>

                  <div style={{ marginTop: 16, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", background: "white" }}>
                      <tbody>{[
                        ["Base cabinet / item costing", projectPricing.baseCost],
                        [`Conversion (${Number(projectPricingInputs.conversionPct || 0).toFixed(2)}%)`, projectPricing.conversion],
                        [`Profit (${Number(projectPricingInputs.profitPct || 0).toFixed(2)}% of cost after conversion)`, projectPricing.profit],
                        [`Transportation${projectPricingInputs.transportation.mode === "sqft" ? ` (${Number(projectPricingInputs.transportation.value || 0).toFixed(2)} / sqft)` : " (direct)"}`, projectPricing.transportation],
                        [`Installation${projectPricingInputs.installation.mode === "sqft" ? ` (${Number(projectPricingInputs.installation.value || 0).toFixed(2)} / sqft)` : " (direct)"}`, projectPricing.installation],
                        [`Loading / Unloading${projectPricingInputs.loading.mode === "sqft" ? ` (${Number(projectPricingInputs.loading.value || 0).toFixed(2)} / sqft)` : " (direct)"}`, projectPricing.loading],
                      ].map(([label, amount]) => <tr key={String(label)}>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4" }}>{label}</td>
                        <td style={{ padding: "7px 9px", border: "1px solid #E3E7E4", textAlign: "right" }}>Rs {Number(amount).toFixed(2)}</td>
                      </tr>)}</tbody>
                      <tfoot>
                        <tr><td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", fontWeight: 700 }}>Subtotal before tax</td><td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right", fontWeight: 700 }}>Rs {projectPricing.subtotal.toFixed(2)}</td></tr>
                        <tr><td style={{ padding: "8px 9px", border: "1px solid #D8DEDA" }}>GST (18%){projectPricingInputs.includeTax ? "" : " — not included"}</td><td style={{ padding: "8px 9px", border: "1px solid #D8DEDA", textAlign: "right" }}>Rs {projectPricing.tax.toFixed(2)}</td></tr>
                        <tr style={{ background: "#E8F3EF", color: "#126350" }}><td style={{ padding: "10px 9px", border: "1px solid #BED8CF", fontWeight: 800 }}>Final project price</td><td style={{ padding: "10px 9px", border: "1px solid #BED8CF", textAlign: "right", fontWeight: 800, fontSize: 16 }}>Rs {projectPricing.grandTotal.toFixed(2)}</td></tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </>}

              {/* ---- Raw Material Selection ---- */}
              <SecHead title="Raw Material Selection" />
              {boardTotals.length === 0 ? <div className="empty">Add cabinets first — board groups appear here for Zoho matching.</div> :
                <Tbl head={["Material", "Thk", "Sqft (+waste)", "Zoho item", "Stock", ""]} num={[1, 2]}
                  rows={boardTotals.filter((b) => !/glass/i.test(b.mat)).map((b) => {
                    const key = `${b.mat}|${b.t}|${b.pack}`;
                    const rs = rawMap[key];
                    const selItem = rs?.items.find((i) => i.item_id === rs.sel);
                    return [b.mat, b.t, (b.sqft * (1 + b.waste / 100)).toFixed(2),
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
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={costing.lines.length === 0}
                  onClick={() => exportCostingWorkbook(costing.lines, projectPricing.allocatedCharges, projectPricing, costing.unpriced)}>Costing (.xlsx)</button>
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={fullBom.length === 0}
                  onClick={() => exportBomWorkbook(toReportRows(fullBom), accessoryRows, projectSetupRows({ project, fillers, visiblePanels, countertops, accessories, masterAccessories, waste, pricing: projectPricingInputs, rawSelections, current: W > 0 && H > 0 && D > 0 ? { config: cabinetConfig(m), elevation, qty } : undefined }))}>Excel BOM (.xlsx)</button>
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
                <Hint>Import replaces the current project. Excel BOM files with Project Setup and PDFs made with Print project PDF restore cabinet choices, accessories, wastage, and pricing. Older printed PDFs may not contain enough data.</Hint>
                {importMessage && <p role="status" style={{ color: "var(--acc)" }}>{importMessage}</p>}
                {importError && <p role="alert" style={{ color: "var(--flag)" }}>{importError}</p>}
              </div>

              <datalist id="elev-list">{ELEVATIONS.map((x) => <option key={x} value={x} />)}</datalist>
              {allStubs.length > 0 && <Stub list={allStubs} />}
            </div>
          )}
        </main>
      </div>
      <section className="print-data" aria-label="Project restore data">
        <h2>Project restore data</h2>
        <p>Keep this final page when saving or printing to PDF. It lets the builder restore the exact cabinet and project selections.</p>
        {printRestoreLines.map((line) => <div className="print-data-line" key={line.slice(0, 11)}>{line}</div>)}
      </section>
    </div>
  );
}

export default WoodBomBuilder;

/* ------------------------------------------------------------------ */
/*  Small presentational helpers                                       */
/* ------------------------------------------------------------------ */

const Fld = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="fld"><label>{label}</label>{children}</div>
);
const Hint = ({ children }: { children: ReactNode }) => <p className="hint">{children}</p>;
const Seg = ({ opts, val, set }: { opts: [string, string][]; val: string; set: (v: string) => void }) => (
  <div className="seg">{opts.map(([k, l]) => (
    <button key={k} className={val === k ? "on" : ""} onClick={() => set(k)}>{l}</button>
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
const Tbl = ({ head, rows, num = [] }: { head: string[]; rows: ReactNode[][]; num?: number[] }) => (
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
.x{border:0;background:none;color:var(--flag);font:inherit;font-size:11.5px;cursor:pointer;padding:0}
.empty{padding:44px 20px;text-align:center;color:var(--mut);background:var(--pnl);border:1px dashed var(--line);border-radius:3px}
.stub{margin-top:22px;padding:13px 16px;background:var(--flagbg);border-left:3px solid var(--flag);border-radius:0 3px 3px 0}
.stub h5{margin:0 0 7px;font-size:12px;font-weight:650;color:var(--flag)}
.stub ul{margin:0;padding-left:17px}
.stub li{margin-bottom:4px;font-size:12px}
@media(max-width:820px){.rail{width:100%;flex:1 1 100%;border-right:0;border-bottom:1px solid var(--line)}}
@media print{
 @page{size:A4;margin:12mm}
 body,.app-shell,.widget-frame,.wbb{margin:0!important;padding:0!important;max-width:none!important;overflow:visible!important;background:#fff!important;box-shadow:none!important;border:0!important}
 .hd{padding:0 0 9mm;border-bottom:1px solid #333}
 .hd-actions,.hd-n,.rail,.tabs,.header-import-error,.header-import-success{display:none!important}
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
