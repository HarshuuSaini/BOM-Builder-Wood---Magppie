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

import { useState, useMemo, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { searchBoardItems, searchLaminateItems, searchHardwareItems } from "@/lib/rawmaterial";
import boardFinishesData from "@/data/board_finishes.json";
import laminateFinishesData from "@/data/laminate_finishes.json";
import edgebandFinishesData from "@/data/edgeband_finishes.json";
import { getPartBaseName, getPanelBaseName, normalizePartOrPanelName } from "@/lib/naming";
import { exportBomWorkbook, exportBomCsv, type AccessoryExportRow } from "@/lib/export";
import { DEFAULT_RATES, CARCASS_RATE_KEY, SHUTTER_RATE_KEY, findCostingItem, type CostingRates } from "@/lib/costing";
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
  pack: string;
}

interface Hardware {
  name: string;
  qty: number;
  uom?: string;
  pack?: string;
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

const sqft = (w: number, h: number) => (w * h) / SQDIV;
const perim = (w: number, h: number) => (2 * (w + h)) / 1000;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const legCount = (w: number) => (w <= 150 ? 2 : w >= 1050 ? 6 : 4);
const hingeN = (h: number) => (h <= 900 ? 3 : h <= 1600 ? 4 : h <= 2100 ? 5 : 6);

/* ------------------------------------------------------------------ */
/*  Boards & shutter types                                             */
/* ------------------------------------------------------------------ */

const BOARDS: Record<string, {
  label: string; core: string; coreT: number; lam: boolean;
  back: string; backCoreT: number;
}> = {
  A: {
    label: "16mm ply + 0.8mm laminate both faces",
    core: "16mm BWP Plywood", coreT: 16, lam: true,
    back: "6mm BWP Plywood", backCoreT: 6,
  },
  B: {
    label: "18mm prelaminated MDF",
    core: "18mm Prelaminated MDF", coreT: 18, lam: false,
    back: "8mm Prelaminated MDF", backCoreT: 8,
  },
  C: {
    label: "18mm prelaminated particle board",
    core: "18mm Prelaminated Particle Board", coreT: 18, lam: false,
    back: "8mm Prelaminated Particle Board", backCoreT: 8,
  },
};

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

const SHUTTER_TYPES: Record<string, {
  label: string; band: boolean; mat: string; t: number; fam: ShFamily; rate: string;
}> = {
  PRELAM_HDHMR:     { label: "Prelaminated — HDHMR (SF)",        band: true,  mat: "18MM PRELAMINATED HDHMR SF",         t: 18, fam: "PRELAM",   rate: "SHUTTER_PRELAM_HDHMR" },
  PRELAM_MDF:       { label: "Prelaminated — MDF (SF)",          band: true,  mat: "18MM PRELAMINATED MDF SF",           t: 18, fam: "PRELAM",   rate: "SHUTTER_PRELAM_MDF" },
  PRELAM_PARTICAL:  { label: "Prelaminated — Partical (SF)",     band: true,  mat: "18MM PRELAMINATED PARTICAL SF",      t: 18, fam: "PRELAM",   rate: "SHUTTER_PRELAM_PB" },
  POSTLAM_HDHMR:    { label: "Postlam — HDHMR raw (SF)",         band: true,  mat: "18MM POSTLAM HDHMR RAW SF",          t: 16, fam: "POSTLAM",  rate: "SHUTTER_POSTLAM_PLY" },
  POSTLAM_MDF:      { label: "Postlam — MDF raw (SF)",           band: true,  mat: "18MM POSTLAM MDF RAW SF",            t: 16, fam: "POSTLAM",  rate: "SHUTTER_POSTLAM_PLY" },
  POSTLAM_PARTICAL: { label: "Postlam — Partical raw (SF)",      band: true,  mat: "18MM POSTLAM PARTICAL RAW SF",       t: 16, fam: "POSTLAM",  rate: "SHUTTER_POSTLAM_PLY" },
  POSTLAM_BWP:      { label: "Postlam — BWP Ply raw (SF)",       band: true,  mat: "18MM POSTLAM BWP PLY RAW SF",        t: 16, fam: "POSTLAM",  rate: "SHUTTER_POSTLAM_PLY" },
  MEMBRANE_HDHMR:   { label: "Membrane one side — HDHMR OSR (HG)", band: false, mat: "18MM MEMBRANE ONE SIDE HDHMR OSR HG", t: 18, fam: "MEMBRANE", rate: "SHUTTER_MEMBRANE" },
  MEMBRANE_MDF:     { label: "Membrane one side — MDF OSR (HG)", band: false, mat: "18MM MEMBRANE ONE SIDE MDF OSR HG",  t: 18, fam: "MEMBRANE", rate: "SHUTTER_MEMBRANE" },
  PU1_HDHMR:        { label: "PU one side — HDHMR OSR (HG)",     band: false, mat: "18MM PU ONE SIDE HDHMR OSR HG",      t: 18, fam: "PU1",      rate: "SHUTTER_PU_SINGLE" },
  PU1_MDF:          { label: "PU one side — MDF OSR (HG)",       band: false, mat: "18MM PU ONE SIDE MDF OSR HG",        t: 18, fam: "PU1",      rate: "SHUTTER_PU_SINGLE" },
  PU2_HDHMR:        { label: "PU both sides — HDHMR raw (HG)",   band: false, mat: "18MM PU BOTH SIDE HDHMR RAW HG",     t: 18, fam: "PU2",      rate: "SHUTTER_PU_DOUBLE" },
  PU2_MDF:          { label: "PU both sides — MDF raw (HG)",     band: false, mat: "18MM PU BOTH SIDE MDF RAW HG",       t: 18, fam: "PU2",      rate: "SHUTTER_PU_DOUBLE" },
  GLASS:            { label: "Glass",                            band: false, mat: "5mm Toughened Glass",                t: 5,  fam: "GLASS",    rate: "" },
};

const DEFAULT_SHTYPE = "POSTLAM_BWP";
const shOf = (st: string) => SHUTTER_TYPES[st] ?? SHUTTER_TYPES[DEFAULT_SHTYPE];
const shFamOf = (st: string): ShFamily => shOf(st).fam;

/** Only the glass branch keeps the stone frame machinery. */
const SH_INSET: Record<string, number> = { NEON20: 5, NEON50: 8 };
const SH_FRAME: Record<string, number> = { NEON20: 25, NEON50: 50 };
const NEON_LABEL: Record<string, string> = { NEON20: "Neon 20", NEON50: "Neon 50" };
const GLASS_T = 5;
const GLASS_SHELF_T = 8;

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
  if (isGlassShutterFam(fk)) return { mat: `${GLASS_SHELF_T}mm Toughened Glass`, t: GLASS_SHELF_T, band: false };
  return { mat: BOARDS[board].core, t: T, band: true };
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
  // Lian: not supplied — the returned sheet still held the template example row.
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
  shType: string,
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

  // A drawer cabinet's "shutter" is its set of drawer fronts, one per drawer,
  // each sized to its own drawer height. Stone sized these from its 360/180
  // front slots; wood front heights have not been supplied, so a multi-drawer
  // cabinet raises a stub instead of emitting one oversized leaf.
  if (fam.drawers) {
    const n = drawerBreakdown(fam, v).reduce((a, d) => a + d.n, 0);
    if (n > 1) {
      stubs.push(
        `${n} drawer fronts not emitted — front heights per drawer class have not been ` +
        `supplied. Stone sized these from its 360/180 front slots.`,
      );
      return { leaves: 0, leafW: 0, leafH: 0 };
    }
  }

  const { leaves } = shutSpec(zk, fk, v);
  if (!leaves) return { leaves: 0, leafW: 0, leafH: 0 };

  const leafW = W / leaves;
  const leafH = H - shDeduct(isBase, handle, "SH");
  const st = isGlassShutterFam(fk) ? "GLASS" : shType;
  const S = shOf(st);

  if (st === "GLASS") {
    const inset = SH_INSET[neon];
    const frame = SH_FRAME[neon];
    panels.push({
      name: `Panels- SH Glass ${GLASS_T}mm ${Math.round(leafW - inset)}x${Math.round(leafH - inset)}`,
      w: Math.round(leafW - inset), h: Math.round(leafH - inset), qty: leaves,
      drill: null, pack: "Shutter Pack", t: GLASS_T,
      mat: `${GLASS_T}mm Toughened Glass`, band: false,
    });
    profiles.push({
      name: `ALU PROF ${NEON_LABEL[neon].toUpperCase()} ${frame}MM`,
      len: Math.round(leafH), qty: 2 * leaves, type: "V", pack: "Shutter Pack",
    });
    profiles.push({
      name: `ALU PROF ${NEON_LABEL[neon].toUpperCase()} ${frame}MM`,
      len: Math.round(leafW), qty: 2 * leaves, type: "H", pack: "Shutter Pack",
    });
    hardware.push({ name: "CORNER CONNECTOR FOR GLASS SHUTTER", qty: 4 * leaves, uom: "nos", pack: "Shutter Pack" });
  } else {
    panels.push({
      name: `Panels- SH ${S.t}mm ${Math.round(leafW)}x${Math.round(leafH)}`,
      w: Math.round(leafW), h: Math.round(leafH), qty: leaves,
      drill: null, pack: "Shutter Pack", t: S.t,
      mat: S.mat, band: S.band,
    });
  }

  hardware.push({ name: "HINGE", qty: hingeN(H) * leaves, uom: "nos", pack: "Shutter Pack" });
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
  board: string; shType: string; neon: string;
  W: number; H: number; D: number; drawerModel: string;
}) {
  const { zk, fk, v, hand, handle, board, shType, neon, W, H, D, drawerModel } = cfg;
  const z = ZONES[zk];
  const fam = famSetOf(zk)[fk];
  const B = BOARDS[board];

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

  /* --- sides run full height; top and bottom sit between them --- */
  add(`Panels- CR Side ${T}mm ${D}x${H}`, D, H, 2, T, carc, true, hand === "LHS" ? "LH" : "RH");

  const topD = handle === "XCJ" ? D - CJ_CUT : D;
  add(`Panels- CR Top ${T}mm ${W - 2 * T}x${topD}`, W - 2 * T, topD, 1, T, carc, true);

  if (!fam.noBottom) add(`Panels- CR Bottom ${T}mm ${W - 2 * T}x${D}`, W - 2 * T, D, 1, T, carc, true);

  /* --- back: grooved, +9 allowance, never banded --- */
  const bw = W - 2 * T + GROOVE;
  const bh = H - 2 * T + GROOVE;
  if (fam.special === "MD") {
    stubs.push("MD back panel height — parked at the construction stage. With no bottom panel the back is grooved on three edges only, so the +9 allowance does not apply symmetrically.");
  } else if (fam.backStrips) {
    add(`Panels- CR Back Strip ${T_BACK}mm ${bw}x75`, bw, 75, 2, T_BACK, B.back, false);
  } else {
    if (fam.special === "REF") stubs.push("REF short back wall — stone uses H − 1874 to clear the fridge recess. Wood equivalent not yet defined; a full-height back is emitted meanwhile.");
    if (fam.special === "APP") stubs.push("APP twin back walls — stone splits upper/lower at H − 1349. Wood equivalent not yet defined; a single back is emitted meanwhile.");
    add(`Panels- CR Back ${T_BACK}mm ${bw}x${bh}`, bw, bh, 1, T_BACK, B.back, false);
  }

  /* --- sink / hob / dish-rack: rails instead of the stone alu frame --- */
  if (fam.top === "frame") {
    add(`Panels- CR Top Rail Front ${T}mm ${W - 2 * T}x100`, W - 2 * T, 100, 1, T, carc, true);
    add(`Panels- CR Top Rail Back ${T}mm ${W - 2 * T}x100`, W - 2 * T, 100, 1, T, carc, true);
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

  /* --- shutters --- */
  const sh = buildShutters(zk, fk, v, handle, shType, neon, W, H, panels, profiles, hardware, pkRows, stubs);

  /* --- drawers --- */
  addDrawerBoxes(fk, v, W, D, drawerModel, panels, hardware, pkRows, stubs);

  /* --- rolling shutter is a bought-in unit --- */
  if (fam.special === "MD") {
    hardware.push({ name: `ROLLING SHUTTER UNIT ${W}X${H}`, qty: 1, uom: "set", pack: "Hardware Pack" });
  }

  /* --- legs --- */
  if (z.mount === "legs") {
    hardware.push({ name: `HARDWARE PACK PVC LEG SET/${legCount(W)}`, qty: legCount(W), uom: "nos", pack: "Hardware Pack" });
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
  board: string; shType: string; neon: string;
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
  m.hardware.forEach((h) => rows.push({ item: h.name, pack: h.pack ?? "Hardware Pack", uom: h.uom ?? "nos", qty: h.qty }));
  m.cons.forEach((c) => rows.push({ item: c.name, pack: c.pack, uom: c.uom, qty: c.qty }));
  return rows;
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
        Level: 2, Item: h.name, Type: "component",
        "SO Qty": h.qty * q, "Actual Qty": h.qty * q, Unit: h.uom ?? "nos",
      }));
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
  project: ProjectLine[], so: string, globalShType: string, globalFinish: string, wst: WastePct,
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
    const Tt = parseFloat(c.thickness) || 30;
    if (!L) return;
    const q = c.qty || 1;
    const matName = c.material || "Countertop";
    rows.push(makeRow({
      SO: so, "Main Group": "Countertop", "Sub Group": `CT-${L}x${D}x${Tt}`,
      Level: 0, Item: `Countertop ${matName} ${Tt}mm ${L}x${D}`, SKU: `CT-${L}x${D}x${Tt}-${q}`,
      Type: "master", Height: String(D), Width: String(L), Thickness: String(Tt),
      Finish: matName, "SO Qty": q, "Actual Qty": q, Unit: "nos",
    }));
    rows.push(makeRow({
      SO: so, "Main Group": "Countertop", "Sub Group": `CT-${L}x${D}x${Tt}`,
      Level: 1, Item: `CT ${matName} ${Tt}mm ${L}x${D} (bought-in)`, SKU: `CT-${L}x${D}x${Tt}`,
      Type: "component", Height: String(D), Width: String(L), Thickness: String(Tt),
      Finish: matName, "SO Qty": q, "Actual Qty": q, Unit: "nos",
    }));
  });

  return { rows, panels };
}

/* --- Accessories — everything opt-in (CHAT_SUMMARY §17) --- */

type AccessoryKind = "skirting" | "elenor";
interface AccessoryRow {
  id: number;
  kind: AccessoryKind;
  /** metres for skirting, cut height (mm) for elenor */
  size: string;
  qty: number;
  elevation: string;
  straight: number; // skirting connectors
  lconn: number;
  driver: string;   // elenor driver
}
const ACC_LABEL: Record<AccessoryKind, string> = {
  skirting: "PVC Skirting Profile",
  elenor: "Elenor with Light",
};
const DRIVER_OPTIONS = ["", "DRIVER 12V 2A 24W", "DRIVER 12V 5A 60W"];
const ELENOR_WASTE = 0.10;
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
      const lenWaste = Math.ceil(H * (1 + ELENOR_WASTE));
      const rowsDef: Array<[string, number, string]> = [
        ["ALU PROF FOR ELENOR 3000X15X15 ANODISED CHAMPAGNE HM-519 MINA", 2 * q, `L=${H}`],
        ["LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED", 2 * lenWaste * q, "MM"],
        ["PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI", 2 * lenWaste * q, "MM"],
        ["TAPE FOR COVER CAP ADH 3M X20X 91031 3M", 2 * lenWaste * q, "MM"],
        ["LIGHT EXTENSION WIRE TWP SP XX 14/38 SNO", 2 * q, "Mtr"],
      ];
      rowsDef.forEach(([name, qty, size]) => out.push({
        SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL.elenor, Selected: "yes",
        "Item Name": name, Size: size, Elevation: a.elevation,
        Total: qty, "Actual Qty": qty, "Zoho Item ID": "",
      }));
      if (a.driver) out.push({
        SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL.elenor, Selected: "yes",
        "Item Name": a.driver, Size: "", Elevation: a.elevation,
        Total: 1 * q, "Actual Qty": 1 * q, "Zoho Item ID": "",
      });
    }
  });
  return out;
}

/* --- Costing — rupee totals for the user; factors stay on /admin --- */

type CostDetail = {
  category: string;
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

/**
 * Per the costing sheet: carcass sqft × board rate, shutter sqft × shutter-type
 * rate (each after its wastage %), edge band per RMT. Drawer boxes, hinges and
 * accessories are priced only once their rates are set on /admin — until then
 * they are listed as unpriced rather than silently costed at zero.
 */
function computeCosting(
  project: ProjectLine[],
  fillers: FillerRow[], visiblePanels: VisiblePanelRow[],
  extrasPanels: Panel[],
  globalShType: string, rates: CostingRates, wst: WastePct,
): CostingResult {
  const lines: LineCost[] = [];
  const unpriced = new Set<string>();

  // Each sheet row names its own costing key. Postlam rows share the single
  // postlam-ply rate, which is all the costing sheet prices.
  const shutterRate = (st: string): number => {
    const key = shOf(st).rate;
    return key ? (rates[key as keyof CostingRates] ?? 0) : 0;
  };

  project.forEach((l) => {
    const m = l.m;
    const cRate = rates[CARCASS_RATE_KEY[m.board] ?? "CARCASS_POSTLAM_PLY"];
    const st = isGlassShutterFam(m.fk) ? "GLASS" : m.shType;
    const sRate = shutterRate(st);
    const details: CostDetail[] = [];
    m.panels.forEach((p) => {
      const a = sqft(p.w, p.h) * p.qty * l.qty;
      if (p.pack === "Shutter Pack") {
        if (st === "GLASS") { unpriced.add("Glass shutters"); return; }
        const billed = a * (1 + wst.shutter / 100);
        details.push({ category: "Shutter board", item: p.name, specification: `${p.w}×${p.h}×${p.t ?? ""} mm · ${p.qty} per cabinet`, netQty: a, wastePct: wst.shutter, billableQty: billed, uom: "sqft", rate: sRate, amount: billed * sRate });
      } else {
        // Carcass and drawer panels are cut from the carcass board.
        const billed = a * (1 + wst.carcass / 100);
        details.push({ category: p.pack === "Drawer Pack" ? "Drawer panel" : "Carcass board", item: p.name, specification: `${p.w}×${p.h}×${p.t ?? ""} mm · ${p.qty} per cabinet`, netQty: a, wastePct: wst.carcass, billableQty: billed, uom: "sqft", rate: cRate, amount: billed * cRate });
      }
    });
    const bandM = m.panels.reduce((s, p) => s + (p.band ? perim(p.w, p.h) * p.qty * l.qty : 0), 0);
    if (bandM > 0) {
      const billed = bandM * (1 + wst.carcass / 100);
      details.push({ category: "Edge band", item: "0.8mm edge band", specification: "All four edges of banded panels", netQty: bandM, wastePct: wst.carcass, billableQty: billed, uom: "RMT", rate: rates.EDGEBAND_PER_RMT, amount: billed * rates.EDGEBAND_PER_RMT });
    }
    m.hardware.forEach((h) => {
      if (/^HINGE$/i.test(h.name)) {
        const hingeItem = findCostingItem({ group: "Hinge", subgroup: "0 CRANK", type: "100° Soft Close", brand: "Hettich" });
        if (rates.HINGE > 0) details.push({ category: "Hardware", item: hingeItem?.materialDescription ?? "Hinge", specification: "Hettich 0 crank · 100° soft close", netQty: h.qty * l.qty, wastePct: 0, billableQty: h.qty * l.qty, uom: "nos", rate: rates.HINGE, amount: h.qty * l.qty * rates.HINGE });
        else unpriced.add("Hinges");
      }
      if (/^DRAWER BOX SET/i.test(h.name)) {
        const family = famSetOf(m.zk)[m.fk];
        const variant = family?.variants?.find((candidate: any) => candidate.id === m.vid);
        const mix = family && variant ? drawerBreakdown(family, variant) : [{ cls: "HIGH" as DrawerClass, n: h.qty }];
        mix.forEach(({ cls, n }) => {
          const subgroup = cls === "LOW" ? "Low Back" : "High Back";
          const masterDrawer = findCostingItem({ group: "Drawer System", subgroup, brand: m.drawerModel });
          const drawerRate = masterDrawer?.currentRate ?? 0;
          if (drawerRate > 0) details.push({ category: "Drawer system", item: masterDrawer?.materialDescription ?? `${m.drawerModel} ${subgroup}`, specification: `${n} per cabinet · ${masterDrawer?.type ?? subgroup}`, netQty: n * l.qty, wastePct: 0, billableQty: n * l.qty, uom: "set", rate: drawerRate, amount: n * l.qty * drawerRate });
          else unpriced.add(`${m.drawerModel} drawer box sets (${cls === "LOW" ? "LB" : "HB"})`);
        });
      }
    });
    const cost = details.reduce((sum, detail) => sum + detail.amount, 0);
    lines.push({ label: `${l.elevation} · ${m.code}`, code: m.code, qty: l.qty, unitCost: l.qty ? cost / l.qty : cost, cost, details });
  });

  // Fillers & visible panels — shutter-type panels, costed at the shutter rate.
  const extraRows = [...fillers.map(() => globalShType), ...visiblePanels.map((v) => v.shutterType || globalShType)];
  extrasPanels.forEach((p, i) => {
    const st = extraRows[i];
    if (st === undefined) return; // countertops emit no panels
    const rate = shutterRate(st);
    const net = sqft(p.w, p.h) * p.qty;
    const billed = net * (1 + wst.shutter / 100);
    const details: CostDetail[] = [{ category: "Shutter board", item: p.name, specification: `${p.w}×${p.h}×${p.t ?? ""} mm`, netQty: net, wastePct: wst.shutter, billableQty: billed, uom: "sqft", rate, amount: billed * rate }];
    if (p.band) {
      const band = perim(p.w, p.h) * p.qty;
      const bandBilled = band * (1 + wst.carcass / 100);
      details.push({ category: "Edge band", item: "0.8mm edge band", specification: "All four edges", netQty: band, wastePct: wst.carcass, billableQty: bandBilled, uom: "RMT", rate: rates.EDGEBAND_PER_RMT, amount: bandBilled * rates.EDGEBAND_PER_RMT });
    }
    const cost = details.reduce((sum, detail) => sum + detail.amount, 0);
    lines.push({ label: `${p.name}`, qty: p.qty, unitCost: p.qty ? cost / p.qty : cost, cost, details });
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
  const [zk, setZk] = useState("BC");
  const [fk, setFk] = useState("SH");
  const [vid, setVid] = useState("single");
  const [hand, setHand] = useState("LHS");
  const [handle, setHandle] = useState("STD");
  const [board, setBoard] = useState("A");
  const [shType, setShType] = useState(DEFAULT_SHTYPE);
  const [neon, setNeon] = useState("NEON20");
  const [drawerModel, setDrawerModel] = useState("Hettich");
  const [finish, setFinish] = useState((boardFinishesData as string[])[0] ?? "White");
  const [elevation, setElevation] = useState("AA");
  const [qty, setQty] = useState(1);
  const [W, setW] = useState(600);
  const [H, setH] = useState(720);
  const [D, setD] = useState(560);
  const [project, setProject] = useState<ProjectLine[]>([]);
  const [tab, setTab] = useState<"packets" | "raw" | "totals">("packets");

  /* --- new sections: fillers / visible panels / countertop / accessories --- */
  const [fillers, setFillers] = useState<FillerRow[]>([]);
  const [visiblePanels, setVisiblePanels] = useState<VisiblePanelRow[]>([]);
  const [countertops, setCountertops] = useState<CountertopRow[]>([]);
  const [accessories, setAccessories] = useState<AccessoryRow[]>([]);
  const [waste, setWaste] = useState({ ...WASTE });

  const nextIdOf = (list: { id: number }[]) => list.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const addFiller = () => setFillers((c) => [...c, { id: nextIdOf(c), zone: "base", customShade: "", qty: 1, customHeight: "", customWidth: "", elevation: "" }]);
  const updFiller = (id: number, p: Partial<FillerRow>) => setFillers((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const rmFiller = (id: number) => setFillers((c) => c.filter((r) => r.id !== id));
  const addVp = () => setVisiblePanels((c) => [...c, { id: nextIdOf(c), zone: "base", customShade: "", qty: 1, customHeight: "", customWidth: "", elevation: "", shutterType: "" }]);
  const updVp = (id: number, p: Partial<VisiblePanelRow>) => setVisiblePanels((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const rmVp = (id: number) => setVisiblePanels((c) => c.filter((r) => r.id !== id));
  const addCt = () => setCountertops((c) => [...c, { id: nextIdOf(c), length: "", depth: "600", thickness: "30", material: "", qty: 1 }]);
  const updCt = (id: number, p: Partial<CountertopRow>) => setCountertops((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const rmCt = (id: number) => setCountertops((c) => c.filter((r) => r.id !== id));
  const addAcc = () => setAccessories((c) => [...c, { id: nextIdOf(c), kind: "skirting", size: "", qty: 1, elevation: "", straight: 0, lconn: 0, driver: "" }]);
  const updAcc = (id: number, p: Partial<AccessoryRow>) => setAccessories((c) => c.map((r) => r.id === id ? { ...r, ...p } : r));
  const rmAcc = (id: number) => setAccessories((c) => c.filter((r) => r.id !== id));

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

  const m = useMemo(
    () => buildModel({ zk, fk: fkSafe, vid: v.id, hand, handle, board, shType, neon, W, H, D, drawerModel, finish }),
    [zk, fkSafe, v.id, hand, handle, board, shType, neon, W, H, D, drawerModel, finish],
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

  const addLine = () => setProject((p) => [...p, { id: Date.now() + Math.random(), m, qty, elevation }]);
  const delLine = (id: number) => setProject((p) => p.filter((x) => x.id !== id));

  const extras = useMemo(
    () => buildExtrasBom(fillers, visiblePanels, countertops, project, soMode ? "SO" : "", shType, finish, waste),
    [fillers, visiblePanels, countertops, project, soMode, shType, finish, waste],
  );
  const boardTotals = useMemo(() => buildBoardTotals(project, waste, extras.panels), [project, waste, extras]);
  const fullBom = useMemo(
    () => [...buildFullBomData(project, soMode ? "SO" : "", finish, waste), ...extras.rows],
    [project, soMode, finish, waste, extras],
  );
  const accessoryRows = useMemo(() => buildAccessoryRows(accessories, project, soMode ? "SO" : ""), [accessories, project, soMode]);
  const costing = useMemo(
    () => computeCosting(project, fillers, visiblePanels, extras.panels, shType, rates, waste),
    [project, fillers, visiblePanels, extras, shType, rates, waste],
  );
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
      l.m.hardware.forEach((h) => map.set(h.name, (map.get(h.name) ?? 0) + h.qty * l.qty));
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
        <div className="hd-n">
          <span>cabinets<b>{project.reduce((a, l) => a + l.qty, 0)}</b></span>
          <span>sheets<b>{boardTotals.reduce((a, b) => a + (b.sheets ?? 0), 0).toFixed(1)}</b></span>
        </div>
      </header>

      <div className="body">
        {/* ---------------- Configure Unit ---------------- */}
        <aside className="rail">
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

          <Fld label="Carcass board">
            <select value={board} onChange={(e) => setBoard(e.target.value)}>
              {Object.entries(BOARDS).map(([k, b]) => <option key={k} value={k}>{k} — {b.label}</option>)}
            </select>
            <Hint>Back: {BOARDS[board].back} · nominal {T_BACK}mm</Hint>
          </Fld>

          {!fam.noShutter && (isGlass ? (
            <Fld label="Neon profile">
              <Seg opts={[["NEON20", "Neon 20"], ["NEON50", "Neon 50"]]} val={neon} set={setNeon} />
              <Hint>Glass family — inset {SH_INSET[neon]}mm, frame {SH_FRAME[neon]}mm.</Hint>
            </Fld>
          ) : (
            <Fld label="Shutter type">
              <select value={shType} onChange={(e) => setShType(e.target.value)}>
                {Object.entries(SHUTTER_TYPES).filter(([k]) => k !== "GLASS")
                  .map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
              </select>
              <Hint>{shOf(shType).mat} · cut at {shOf(shType).t}mm · {shOf(shType).band ? `${BAND_T}mm band, all edges` : "no edge band"}</Hint>
            </Fld>
          ))}

          {fam.drawers && (
            <Fld label="Drawer model">
              <select value={drawerModel} onChange={(e) => setDrawerModel(e.target.value)}>
                {DRAWER_MODELS.map((x) => <option key={x}>{x}</option>)}
              </select>
            </Fld>
          )}

          <Fld label="Finish">
            <select value={finish} onChange={(e) => setFinish(e.target.value)}>
              {(boardFinishesData as string[]).map((f) => <option key={f}>{f}</option>)}
            </select>
          </Fld>

          <Fld label="Dimensions (W · H · D)">
            <div className="g3">
              <select value={W} onChange={(e) => setW(+e.target.value)}>
                {sizes.w.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select value={H} onChange={(e) => setH(+e.target.value)}>
                {sizes.h.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <input type="number" value={D} onChange={(e) => setD(+e.target.value)} />
            </div>
          </Fld>

          <Fld label="Elevation & quantity">
            <div className="g2">
              <select value={elevation} onChange={(e) => setElevation(e.target.value)}>
                {ELEVATIONS.map((x) => <option key={x}>{x}</option>)}
              </select>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, +e.target.value))} />
            </div>
          </Fld>

          <button className="add" onClick={addLine}>Add to project</button>
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
                rows={m.hardware.map((h) => [h.pack ?? "Hardware Pack", h.name, h.qty, h.uom ?? "nos"])} />
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
                  rows={project.map((l) => [l.elevation, l.m.code, famSetOf(l.m.zk)[l.m.fk].name,
                    `${l.m.W}×${l.m.H}×${l.m.D}`, l.qty,
                    <button key="x" className="x" onClick={() => delLine(l.id)}>remove</button>])} />

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
                      {Object.entries(SHUTTER_TYPES).filter(([k]) => k !== "GLASS").map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select>,
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
              {countertops.length === 0 ? <div className="empty">No countertop. One bought-in line: L × D × T × material × qty.</div> :
                <Tbl head={["Length (mm)", "Depth (mm)", "Thk (mm)", "Material", "Qty", ""]} num={[4]}
                  rows={countertops.map((c) => [
                    <input key="l" type="number" value={c.length} onChange={(e) => updCt(c.id, { length: e.target.value })} style={{ width: 90 }} />,
                    <input key="d" type="number" placeholder="600" value={c.depth} onChange={(e) => updCt(c.id, { depth: e.target.value })} style={{ width: 80 }} />,
                    <input key="t" type="number" placeholder="30" value={c.thickness} onChange={(e) => updCt(c.id, { thickness: e.target.value })} style={{ width: 64 }} />,
                    <input key="m" value={c.material} placeholder="e.g. Quartz White" onChange={(e) => updCt(c.id, { material: e.target.value })} style={{ minWidth: 140 }} />,
                    <input key="q" type="number" min={1} value={c.qty} onChange={(e) => updCt(c.id, { qty: Math.max(1, +e.target.value) })} style={{ width: 58 }} />,
                    <button key="x" className="x" onClick={() => rmCt(c.id)}>×</button>,
                  ])} />}

              {/* ---- Accessories ---- */}
              <SecHead title="Accessories" onAdd={addAcc} />
              {accessories.length === 0 ? <div className="empty">Everything is opt-in: PVC skirting (sum of leg-mounted widths, +10% waste) and the Elenor light (2 sets per unit, cut = H).</div> : <>
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
                    a.kind === "elenor" ? <select key="dr" value={a.driver} onChange={(e) => updAcc(a.id, { driver: e.target.value })}>
                      {DRIVER_OPTIONS.map((d) => <option key={d} value={d}>{d || "— none —"}</option>)}</select> : "—",
                    <button key="x" className="x" onClick={() => rmAcc(a.id)}>×</button>,
                  ])} />
                {accessoryRows.length > 0 && <>
                  <h4>Accessory lines (export preview)</h4>
                  <Tbl head={["Accessory", "Item", "Size", "Total", "Actual Qty"]} num={[3, 4]}
                    rows={accessoryRows.map((r) => [r.Accessory, r["Item Name"], r.Size, r.Total, r["Actual Qty"]])} />
                </>}
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
                            <thead><tr>{["Category", "Main item", "Specification", "Net qty", "Waste", "Billable qty", "Basis", "Rate (Rs)", "Amount (Rs)"].map((heading) => <th key={heading} style={{ padding: "6px 7px", background: "#EEF1EE", border: "1px solid #D8DEDA", textAlign: "left" }}>{heading}</th>)}</tr></thead>
                            <tbody>{c.details.map((detail, index) => <tr key={`${detail.category}-${detail.item}-${index}`}>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.category}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.item}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.specification}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{detail.netQty.toFixed(3)}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{detail.wastePct}%</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{detail.billableQty.toFixed(3)}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4" }}>{detail.uom}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right" }}>{detail.rate.toFixed(2)}</td>
                              <td style={{ padding: "6px 7px", border: "1px solid #E3E7E4", textAlign: "right", fontWeight: 650 }}>{detail.amount.toFixed(2)}</td>
                            </tr>)}</tbody>
                            <tfoot><tr><td colSpan={8} style={{ padding: "7px", textAlign: "right", fontWeight: 700 }}>Cabinet line total</td><td style={{ padding: "7px", textAlign: "right", fontWeight: 700 }}>{c.cost.toFixed(2)}</td></tr></tfoot>
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
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={fullBom.length === 0}
                  onClick={() => exportBomWorkbook(toReportRows(fullBom), accessoryRows)}>Excel BOM (.xlsx)</button>
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={fullBom.length === 0}
                  onClick={() => exportBomCsv(toReportRows(fullBom))}>Full BOM (.csv)</button>
                <button className="add" style={{ width: "auto", padding: "8px 16px" }} disabled={project.length === 0}
                  onClick={() => dl("wood-bom.csv", buildCSV(project), "text/csv")}>Raw CSV</button>
              </div>

              <datalist id="elev-list">{ELEVATIONS.map((x) => <option key={x} value={x} />)}</datalist>
              {allStubs.length > 0 && <Stub list={allStubs} />}
            </div>
          )}
        </main>
      </div>
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
`;

/* Laminate/hardware search helpers stay reachable for later wiring. */
void searchLaminateItems; void searchHardwareItems;
void laminateFinishesData; void edgebandFinishesData;
