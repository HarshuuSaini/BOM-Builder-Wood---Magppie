"use client";

import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from "react";
import * as XLSX from "xlsx-js-style";
import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { searchStoneItems, searchProfileItems, searchHardwareItems } from "@/lib/rawmaterial";
import stoneFinishesData from "@/data/stone_finishes.json";
import profileFinishesData from "@/data/profile_finishes.json";
import planningFinishesData from "@/data/planning_finishes.json";
import { getPartBaseName, getPanelBaseName, normalizePartOrPanelName } from "@/lib/naming";

// ---- Types & Interfaces ----
interface Panel {
  name: string;
  w: number;
  h: number;
  qty: number;
  drill: string | null;
  pack: string;
  t?: number;
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

// Fillers / Visible Panels — dynamic row lists. `zone` is base|tall|wall|loft|mid and
// may repeat across rows (multiple fillers/panels of the same zone, different sizes).
interface FillerRow {
  id: number;
  zone: string;
  customShade: string;
  qty: number;
  customHeight: string;
  customWidth: string;
  elevation: string; // AA/BB/… (or custom free text); stamped onto the filler's BOM rows
}
interface VisiblePanelRow extends FillerRow {
  profile: string;
}

// Backsplash — dynamic row list. Each row is its own master BOM under the "Backsplash"
// main group: 1 stone panel (chosen colour) + a glue consumable (per-sqft rate × area × qty);
// the panel carries the usual +15% stone waste. (Countertop will be a separate section.)
interface BacksplashRow {
  id: number;
  width: string;
  height: string;
  thickness: string;
  color: string;
  qty: number;
}

// Countertop — dynamic row list. Inputs (Length, Depth, Thickness 30/40, Colour, per-side
// option, Island, Base light, Qty) derive the BOM: top stone + dead-stock base stone (depth
// −40), stone patti strips (front always; sides per drop-down/edging; island = all 4), brass
// strip(s) at drop-downs, an LED band light (length = Length − 30×drop-down sides), and
// polish/glue consumables. See memory [[project-countertop-construction]].
type CtSide = "none" | "dropdown" | "edging";
interface CountertopRow {
  id: number;
  length: string;
  depth: string;
  thickness: string;   // "30" | "40"
  color: string;
  ctType: number;      // 1..9 construction type (see CT_TYPES / ctGeom)
  edging: CtEdging;    // ROUNDING side on the free (non-drop) side(s) — options depend on ctType; name-only
  edgingHeight: string; // rounding height value shown in the counter name (default 600); editable
  dropHeight: string;  // drop-down side/island panel height (default 705); editable; only when a drop exists
  left: CtSide;        // legacy — kept for back-compat; geometry now derives from ctType
  right: CtSide;
  island: boolean;
  baseLight: boolean;
  qty: number;
}

// Rounding = a NAME-ONLY note (no stone piece, no deduction) marking the free (non-drop) side
// that is rounded, with its height value shown in the counter name (e.g. "Rounding LH (-600)").
// Valid only where a side is free: type 1 (both free → both/left/right), type 2 (LH drops → RH
// free), type 3 (RH drops → LH free). Types 4/5 and islands have no free side.
type CtEdging = "none" | "left" | "right" | "both";
function ctEdgingOptions(type: number): { value: CtEdging; label: string }[] {
  if (type === 1) return [{ value: "none", label: "None" }, { value: "left", label: "LH" }, { value: "right", label: "RH" }, { value: "both", label: "Both" }];
  if (type === 2) return [{ value: "none", label: "None" }, { value: "right", label: "RH" }]; // LH drops → RH free
  if (type === 3) return [{ value: "none", label: "None" }, { value: "left", label: "LH" }];  // RH drops → LH free
  return [{ value: "none", label: "None" }]; // 4/5 + islands: no free side
}

// The 9 countertop construction types (factory working PDF + the "section format" island
// sheet, circle ⑨). EVERY type shares the same base build: a top slab L×D, a dead-stock
// counter base stone L×(D−40) (560 deep at D=600, set back 10 mm at the back), a 30 mm front
// mitred drop-down patti (len L), an Alu Grand Light HM-512 under the front lip, a 3 mm edge
// radius, and polish/glue consumables. Types differ only in the side/back treatment:
//   • side drop-down  → the 30 mm side patti is a MITRED FOLD of the top slab (cut on site), so
//                       it is NOT a separate piece — instead the top slab LENGTH is grown by 30 mm
//                       per side (the user-entered Length excludes these folds). Each drop side also
//                       gets 1 brass strip (cut D×30) + a D×dropHeight back-side-visible stone panel.
//   • side edge only  → both side patti fold into the top slab length (no brass, no panel)  [type 5].
//   • island (6-9)    → both sides drop-down + a back patti (30 mm, or 350 mm for type 8) and,
//                       for 6/7/8, an extra island back/vertical panel ((L−60)×dropHeight, type 8
//                       (L−80)×dropHeight). Type 7 is double-side-visible → TWO Grand Lights.
// dropHeight defaults to 705 mm (editable); it is the visible drop of the side/island panels.
// See memory [[project-countertop-construction]].
// Display order (with the "Linear + BSV" type moved to 2nd). Each `value` still points at its
// original construction logic — only the dropdown order and labels change. Display numbers are
// the on-screen position; the underlying `value` is what's stored/decoded.
const CT_TYPES: { value: number; label: string; island: boolean }[] = [
  { value: 1, label: "1 · Linear", island: false },
  { value: 5, label: "2 · Linear + BSV", island: false },
  { value: 2, label: "3 · Linear + LHV with LH Drop", island: false },
  { value: 3, label: "4 · Linear + RHV with RH Drop", island: false },
  { value: 4, label: "5 · Linear + BSV with Both Side Drop", island: false },
  { value: 6, label: "6 · Island Compact", island: true },
  { value: 7, label: "7 · Island Table", island: true },
  { value: 8, label: "8 · Island with 350mm Sitting", island: true },
  { value: 9, label: "9 · Island Both Side Cabinets", island: true },
];

// kind "flat" → a single counter-colour stone line; kind "dropdown" → a mini-counter sub-BOM:
// one VISIBLE drop stone (len × dropHeight, the 30/100 mm patti are mitred folds of it) + a
// dead-stock base stone reduced by 100 mm (dropHeight − 100) + pasting. No separate patti.
interface CtPanel { label: string; len: number; wid: number; kind: "flat" | "dropdown"; deadQty?: number; }
interface CtGeom {
  topL: number;         // top-slab cut LENGTH = L + 30×(type-5 edge folds) − 100×(side drops)
  topD: number;         // top-slab cut DEPTH  = D + 30 (front fold) − 100×(island back drop)
  baseL: number;        // dead-stock base stone length = L − 100×(side drops)
  baseD: number;        // dead-stock base stone depth  = (D − 40) − 100×(island back drop)
  panels: CtPanel[];    // separate counter-colour stone pieces (back patti, side & island drop panels)
  brass: number;        // brass strips — one per drop-down side
  brassLen: number;     // brass strip cut length (runs the side edge = Depth)
  grandLights: number;  // Grand Light HM-512 runs (2 for the vertical island, type 7)
  sideDrops: number;    // # of side drops (used to shorten the Grand Light run: L − 30×sideDrops)
}

// True when the type has a drop-down side/island panel → the editable "drop height" applies.
function ctHasDrop(type: number): boolean { return type === 2 || type === 3 || type === 4 || (CT_TYPES.find((t) => t.value === type)?.island ?? false); }

// Derive the full per-type piece list from the user's Length (L) × Depth (D) × Thickness (T)
// and the drop-down panel height. (Rounding is NOT geometry — it is only annotated in the
// countertop name; see the build below.)
function ctGeom(type: number, L: number, D: number, T: number, dropHeight = 705): CtGeom {
  const dh = dropHeight > 0 ? dropHeight : 705;     // visible drop of the side/island stone panels
  const isl = CT_TYPES.find((t) => t.value === type)?.island ?? false;
  const panels: CtPanel[] = []; // front 30 mm patti is a fold of the top slab (grows topD), not a separate piece
  const dropLeft = type === 2 || type === 4 || isl;
  const dropRight = type === 3 || type === 4 || isl;
  const edgeBoth = type === 5; // both sides edge-drop only (no brass, no back panel)
  // Each drop-down side is a separate vertical drop stone (kind "dropdown"); the cabinet mitre
  // takes 100 mm off the top & base LENGTH on that side. Type-5 edges (no drop) fold +30 instead.
  let brass = 0, sideDrops = 0, edgeFolds = 0;
  if (dropLeft)  { panels.push({ label: "Drop-Down Left",  len: D, wid: dh, kind: "dropdown" }); brass++; sideDrops++; }
  if (dropRight) { panels.push({ label: "Drop-Down Right", len: D, wid: dh, kind: "dropdown" }); brass++; sideDrops++; }
  if (edgeBoth)  { edgeFolds += 2; }
  let grandLights = 1;
  if (isl) {
    // The back finished side is itself a drop-down stone (its 30/350 mm back patti is a mitred
    // fold of it — the old separate "Patti Back" flat piece is removed). Type 8 is the 350 mm
    // sitting-area drop whose dead-stock base is made of TWO stones.
    if (type === 6) panels.push({ label: "Island Back Panel (single-side)", len: Math.max(0, L - 60), wid: dh, kind: "dropdown" });
    if (type === 7) { panels.push({ label: "Island Vertical Panel (double-side)", len: Math.max(0, L - 60), wid: dh, kind: "dropdown" }); grandLights = 2; }
    if (type === 8) panels.push({ label: "Island Sitting Drop", len: Math.max(0, L - 80), wid: 350, kind: "dropdown", deadQty: 2 });
    if (type === 9) panels.push({ label: "Island Back Panel (section)", len: Math.max(0, L - 60), wid: dh, kind: "dropdown" });
  }
  // Cabinet-side 100 mm mitre reduction: side drops shrink the LENGTH (top+base), the island back
  // drop shrinks the DEPTH (top+base). Type 7 (freestanding island table) is exempt entirely.
  // Type 8: the UPPER COUNTER keeps full depth (front drop & top same depth) — only the dead stock
  // changes (100 mm cabinet mitre + the 350 mm sitting drop's two stones) → skip the top-depth cut.
  const reduce = type === 7 ? 0 : 1;
  const backDrops = isl ? 1 : 0;
  const topDepthReduce = (type === 7 || type === 8) ? 0 : 1;
  const topL = L + 30 * edgeFolds - 100 * sideDrops * reduce;
  const topD = D + 30 - 100 * backDrops * reduce * topDepthReduce;
  const baseL = L - 100 * sideDrops * reduce;
  const baseD = Math.max(0, D - 40 - 100 * backDrops * reduce);
  return { topL, topD, baseL, baseD, panels, brass, brassLen: D, grandLights, sideDrops };
}

interface Shutter {
  code: string;
  kind: "drawer" | "hinged" | "fixed";
  design: string;
  w: number;
  h: number;
  pw: number;
  ph: number;
  profV: number;
  profH: number;
  hinge: string;
  hq?: number;
  loc?: string; // L / R / U / F / X — which side/position this leaf occupies
}

interface CarcassModel {
  code: string;
  mat: string;
  carcassMat?: string;
  shutterMat?: string;
  // Stone shade for the fixed (dummy) blind panel — only used by glass-shutter blind
  // cabinets, where the glass shutter shade (shutterMat) differs from the stone panel.
  fixedPanelMat?: string;
  carcassProfileColor?: string;
  shutterProfileColor?: string;
  f: any;
  v: any;
  sn: string;
  lh?: string | null;
  rh?: string | null;
  W: number;
  H: number;
  D: number;
  t: number;
  isCJ: boolean;
  pkRows: Array<[string, string, string, number, string]>;
  panels: Panel[];
  profiles: Profile[];
  hardware: Hardware[];
  cons: Consumable[];
  netSqft: number;
  nPanels: number;
  ops: { cut: number; drill: number };
  shutters?: Shutter[];
  zk?: string;
  fk?: string;
  // Wall stone/glass shutter cabinets: glass shelves emitted as a DIRECT raw material
  // (not a stone-panel BOM). Size mirrors the legacy stone shelf; qty derives from height.
  glassShelf?: { name: string; w: number; d: number; t: number; qty: number };
}

interface ProjectLine {
  qty: number;
  m: CarcassModel;
  rate?: number;
  elevation?: string;
  // Designer-page Excel upload metadata — lets the shutter-colour picker rebuild the line's
  // model with a new shutter finish, filtered by the row's price group.
  priceGroup?: string;       // "PG-1" | "PG-2"
  upCode?: string;           // cabinet code (no finish suffix)
  upDesign?: string;         // shutter design (e.g. MD1CM1)
  upCarcass?: string;        // carcass finish
  upProfile?: string;        // profile colour
}

// ---- Accessory Types ----
type AccessoryKey = "skirting" | "duplay" | "lprofile" | "jhandle" | "chandle" | "grandlight";

type AccessoryItem = {
  key: AccessoryKey;
  label: string;
  itemId: string;
  condition: (zone: string) => boolean;
};

type AccessoryEntry = {
  enabled: boolean;
  size: string;
  elevation: string;
  actualQty: number | null;
  straightConnectors: number;
  lConnectors: number;
  driver: string;
};

type AccessorySubformRow = {
  id: number;
  cabinetIndices: number[];
  accessories: Record<AccessoryKey, AccessoryEntry>;
};

const ACCESSORY_ITEMS: AccessoryItem[] = [
  { key: "skirting", label: "Skirting with light", itemId: "3418412000001249001", condition: (zone) => { const z = zone.toLowerCase(); return z.includes("base") || z.includes("tall"); } },
  { key: "duplay", label: "Duplay Profile Light", itemId: "3418412000001249010", condition: (zone) => zone.toLowerCase().includes("wall") },
  { key: "lprofile", label: "L Profile Dado Light", itemId: "3418412000001249037", condition: (zone) => zone.toLowerCase().includes("wall") },
  { key: "jhandle", label: "J type handle", itemId: "3418412000001249019", condition: () => true },
  { key: "chandle", label: "C type handle", itemId: "3418412000001249028", condition: () => true },
  { key: "grandlight", label: "Grand Profile Light", itemId: "3418412000001249046", condition: (zone) => zone.toLowerCase().includes("base") },
];

const PROFILE_ACC_KEYS: AccessoryKey[] = ["skirting", "duplay", "lprofile", "grandlight"];

// ---- Elevation (mandatory at cabinet add) ----
const ELEVATION_OPTIONS = ["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "II", "JJ", "KK"];

// ---- Other Accessories (panels) ----
type OtherAccItemKey = "chimney" | "dishwasher";
type OtherAccItem = { key: OtherAccItemKey; label: string };
const OTHER_ACC_ITEMS: OtherAccItem[] = [
  { key: "chimney", label: "Chimney Panel" },
  { key: "dishwasher", label: "Dishwasher Panel" },
];
type OtherAccRow = {
  id: number;
  item: OtherAccItemKey;
  width: number;
  height: number;
  profile: string;      // profile CODE (design, e.g. MD1); default = shutter design
  profileColor: string; // profile colour — follows shutter profile colour
  color: string;        // stone finish; default = shutter stone
  qty: number;
};

// Standard Visible-Panel size presets per zone (Height × Width(depth) mm). The "Wall Chimney
// Area" sizes are NOT here — they belong to the Chimney Panel (CHIMNEY_PRESETS below).
const VP_PRESETS: Record<string, Array<{ label: string; h: number; w: number }>> = {
  base: [
    { label: "Base STD (717×586)", h: 717, w: 586 },
    { label: "Base Low Depth (717×362)", h: 717, w: 362 },
  ],
  wall: [
    { label: "Wall STD (1082×362)", h: 1082, w: 362 },
    { label: "Wall STD (717×362)", h: 717, w: 362 },
  ],
  tall: [
    { label: "Tall STD (2037×586)", h: 2037, w: 586 },
    { label: "Tall STD (2397×586)", h: 2397, w: 586 },
    { label: "Tall Low Depth (2037×362)", h: 2037, w: 362 },
    { label: "Tall Low Depth (2397×362)", h: 2397, w: 362 },
  ],
  loft: [
    { label: "Loft STD (597×362)", h: 597, w: 362 },
    { label: "Loft Full Depth (597×586)", h: 597, w: 586 },
  ],
  mid: [
    { label: "MID STD (1647×362)", h: 1647, w: 362 },
    { label: "MID STD (1287×362)", h: 1287, w: 362 },
    { label: "MID Full Depth (1647×586)", h: 1647, w: 586 },
    { label: "MID Full Depth (1287×586)", h: 1287, w: 586 },
  ],
};

// Chimney Panel size presets (the former "Wall Chimney Area" sizes), Height × Width(depth) mm.
const CHIMNEY_PRESETS: Array<{ label: string; h: number; w: number }> = [
  { label: "Chimney Area (1082×336)", h: 1082, w: 336 },
  { label: "Chimney Area (717×336)", h: 717, w: 336 },
];

// Default Filler HEIGHT presets per zone (mm). Fillers are narrow vertical strips, so only the
// height varies; the width stays custom (default 80).
const FILLER_PRESETS: Record<string, number[]> = {
  base: [717],
  wall: [1082, 717],
  tall: [2037, 2397],
  loft: [597],
  mid: [1647, 1287],
};

// Light profile BOM definitions (exact Zoho item names from "Light Profile Boms" sheet)
const LIGHT_PROFILE_BOMS: Record<string, { profile: string; led: string; ledMultiplier: number; diffuser: string; diffuserMultiplier: number; wire: string; wireQty: number; tape: string | null; tapeMultiplier: number; waste: number }> = {
  skirting: {
    profile: "ALU PROF FOR SKIRTING WITH LIGHT 3000X100X9.8 ANODISED CHAMPAGNE HM-507 MINA",
    led: "LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED", ledMultiplier: 1,
    diffuser: "PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI", diffuserMultiplier: 1,
    wire: "LIGHT EXTENSION WIRE TWP SP XX 14/38 SNO", wireQty: 1,
    tape: null, tapeMultiplier: 0,
    waste: 0.10,
  },
  duplay: {
    profile: "ALU PROF DUPLY LIGHT 3000X45X14 ANODISED CHAMPAGNE HM-534 MINA",
    led: "LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED", ledMultiplier: 2,
    diffuser: "PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI", diffuserMultiplier: 2,
    wire: "LIGHT EXTENSION WIRE TWP SP XX 14/38 SNO", wireQty: 2,
    tape: "TAPE THERMAL 210 MIC 50 MTR X50X0.3 391990 EURO", tapeMultiplier: 1,
    waste: 0.10,
  },
  lprofile: {
    profile: "ALU PROF DADO TOOL 3000X35..5X28 ANODISED CHAMPAGNE HM-514 MINA",
    led: "LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED", ledMultiplier: 1,
    diffuser: "PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI", diffuserMultiplier: 1,
    wire: "LIGHT EXTENSION WIRE TWP SP XX 14/38 SNO", wireQty: 1,
    tape: null, tapeMultiplier: 0,
    waste: 0.10,
  },
  grandlight: {
    profile: "ALU PROF GRAND COUNTER 3000X20X15.5 ANODISED CHAMPAGNE HM-512 MINA",
    led: "LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED", ledMultiplier: 1,
    diffuser: "PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI", diffuserMultiplier: 1,
    wire: "LIGHT EXTENSION WIRE TWP SP XX 14/38 SNO", wireQty: 1,
    tape: "TAPE FOR COVER CAP ADH 3M X20X 91031 3M", tapeMultiplier: 1,
    waste: 0.10,
  },
  elenor: {
    profile: "ALU PROF FOR ELENOR 3000X15X15 ANODISED CHAMPAGNE HM-519 MINA",
    led: "LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED", ledMultiplier: 1,
    diffuser: "PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI", diffuserMultiplier: 1,
    wire: "LIGHT EXTENSION WIRE TWP SP XX 14/38 SNO", wireQty: 2,
    tape: "TAPE FOR COVER CAP ADH 3M X20X 91031 3M", tapeMultiplier: 1,
    waste: 0.10,
  },
};

const DRIVER_OPTIONS = [
  "",
  "LIGHT DRIVER LED STRIP 12V, 2AMP , 24W XX LED",
  "LIGHT DRIVER LED STRIP 12V, 5AMP , 60W XX LED",
];

function createAccessoryEntries(): Record<AccessoryKey, AccessoryEntry> {
  return Object.fromEntries(
    ACCESSORY_ITEMS.map((a) => [a.key, { enabled: false, size: "", elevation: "", actualQty: null, straightConnectors: 0, lConnectors: 0, driver: "" }]),
  ) as Record<AccessoryKey, AccessoryEntry>;
}

// ---- Stock Check Types ----
type StockItem = {
  name: string;
  category: "hardware" | "consumable" | "service";
  stock: number | null;
  loading: boolean;
};

// ---- Constants & Helper Functions ----
const STEP = 2;
const CJ_CUT = 23;
const SHELF_OFF = 40;
const SQDIV = 92903.04;
const STONE_WASTE = 0.15;
const PROFILE_WASTE = 0.20;
const ELENOR_WASTE = 0.10;
const KG_SQFT = 3.45;

const PROFILE_COLORS = [
  "ALDORA",
  "ANODISED",
  "ANODISED BRUSH",
  "ANTHRACITE",
  "ANTIQUE BRASS",
  "BLACK",
  "BLACK MATT",
  "BROWN",
  "BRUSH GOLD",
  "BRUSHED STEEL",
  "CERAMIC BLACK",
  "CHAMPAGNE",
  "DRIFWOOD",
  "GOLD",
  "JET BLACK",
  "LITE BRONZE",
  "PVDF GOLD",
  "W/OUT ANODISED",
  "WHITE"
];

const STP_SIZE = [75, 150, 300, 450, 500, 550, 600, 720, 850, 900, 1050, 1070, 1150, 1200, 2370];
const STP_KG = [0.01, 0.01, 0.02, 0.02, 0.02, 0.02, 0.03, 0.03, 0.05, 0.05, 0.06, 0.06, 0.06, 0.06, 0.09];

function stepSil(run: number): number {
  let bi = 0;
  let bd = 1e9;
  STP_SIZE.forEach((s, i) => {
    const d = Math.abs(s - run);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return STP_KG[bi];
}

function addElenor(H: number, profiles: Profile[], cons: Consumable[], hardware: Hardware[], pkRows: any[]) {
  const lenWithWaste = Math.ceil(H * (1 + ELENOR_WASTE));
  const elenName = `Elenor with Light ${H}mm`;
  // "Elenor with Light" is a composite item in the cabinet BOM
  pkRows.push(["elen_bom", elenName, `L=${H}`, 2, "Set"]);
  // BOM components of the composite:
  profiles.push({ name: "ALU PROF FOR ELENOR 3000X15X15 ANODISED CHAMPAGNE HM-519 MINA", len: H, qty: 2, type: "ELEN", pack: elenName });
  cons.push({ name: "LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED", qty: 2 * lenWithWaste, uom: "MM", pack: elenName });
  cons.push({ name: "PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI", qty: 2 * lenWithWaste, uom: "MM", pack: elenName });
  cons.push({ name: "TAPE FOR COVER CAP ADH 3M X20X 91031 3M", qty: 2 * lenWithWaste, uom: "MM", pack: elenName });
  cons.push({ name: "LIGHT EXTENSION WIRE TWP SP XX 14/38 SNO", qty: 2, uom: "Mtr", pack: elenName });
  // Driver is selected manually in the Accessories section
}

const legCount = (w: number) => (w <= 150 ? 2 : w >= 1050 ? 6 : 4);
const sqft = (w: number, h: number) => (w * h) / SQDIV;

// ---- Catalog Configuration Data ----
const BASE_FAMILIES: Record<string, any> = {
  DW: {
    name: "Base Drawer",
    p2: "DW",
    top: "panel",
    variants: [
      { id: "2dr", label: "2 Drawers", p3: "XXX", p4: "2HB", side: "2HB" },
      { id: "3dr", label: "3 Drawers", p3: "2LB", p4: "1HB", side: "2LB+1HB" },
    ],
  },
  HO: {
    name: "Base Hob",
    p2: "HO",
    top: "frame",
    variants: [
      { id: "2dr", label: "2 Drawers", p3: "XXX", p4: "2HB", side: "2HB" },
      { id: "3dr", label: "3 Drawers", p3: "2LB", p4: "1HB", side: "2LB+1HB" },
    ],
  },
  SK: {
    name: "Base Sink",
    p2: "SK",
    top: "frame",
    variants: [
      { id: "single", label: "Single bowl (handed)", p3: "XXX", handed: true, act: "SK 3H", oth: "SK JD" },
      { id: "double", label: "Double bowl", p3: "XXX", p4: "2HS", side: "SK 3H", both: true },
    ],
  },
  SH: {
    name: "Base Shutter",
    p2: "SH",
    top: "panel",
    shelf: 1,
    variants: [
      { id: "single", label: "Single door (handed)", p3: "1SX", handed: true, act: "1S 3H", oth: "1S JD" },
      { id: "double", label: "Double door", p3: "1SX", p4: "2HS", side: "1S 3H", both: true },
    ],
  },
  GD: {
    name: "Base Grain Drawer",
    p2: "GD",
    top: "panel",
    variants: [{ id: "std", label: "Grain Drawer", p3: "1BL", p4: "1HF", side: "1HB" }],
  },
  AP: {
    name: "Base Appliance (Oven)",
    p2: "AP",
    top: "panel",
    backStrips: true,
    variants: [{ id: "ovn", label: "Oven", p3: "OVN", p4: "1FP", side: "APP" }],
  },
  BPO: {
    name: "Base Bottle Pullout",
    p2: "AC",
    top: "panel",
    variants: [{ id: "po", label: "Bottle Pullout (handed)", p3: "BPO", handed: true, act: "BPO", oth: "JD" }],
  },
  WBP: {
    name: "Base Waste Bin Pullout",
    p2: "AC",
    top: "panel",
    variants: [{ id: "wb", label: "Waste Bin Pullout", p3: "WBP", p4: "1HF", side: "1HB", both: true }],
  },
};

const BLIND_FAMILIES: Record<string, any> = {
  LMC: { name: "LeMans Corner", p2: "AC", top: "panel", variants: [{ id: "lmc", label: "LeMans (handed)", p3: "LMC", handed: true, blind: true, lem: true }] },
  BSH: { name: "Blind + Shelf", p2: "SH", top: "panel", shelf: 1, variants: [{ id: "bsh", label: "Blind shelf (handed)", p3: "1SX", handed: true, blind: true }] },
  PLB: { name: "Plain Blind", p2: "SH", top: "panel", variants: [{ id: "plb", label: "Plain blind (handed)", p3: "XXX", handed: true, blind: true, plain: true }] },
};

const WALL_FAMILIES: Record<string, any> = {
  WGL: {
    name: "Wall Glass Shutter",
    p2: "SH",
    glass: 3,
    variants: [
      { id: "sgl", label: "Single door (handed)", p3: "3SG", handed: true, act: "3S 4H", oth: "3S JD" },
      { id: "dbl", label: "Double door", p3: "3SG", p4: "2HS", both: true, side: "3S 4H" },
    ],
  },
  WST: {
    name: "Wall Stone Shutter",
    p2: "SH",
    shelf: 3,
    variants: [
      { id: "sgl", label: "Single door (handed)", p3: "1SG", handed: true, act: "1S 3H", oth: "1S JD" },
      { id: "dbl", label: "Double door", p3: "1SG", p4: "2HS", both: true, side: "1S 3H" },
    ],
  },
  WOP: {
    name: "Wall Open Shelf",
    p2: "OP",
    glass: 3,
    variants: [{ id: "op", label: "Open (no door)", p3: "3SG", p4: "XXX", both: true, side: "3S JD" }],
  },
  WDR: {
    name: "Wall Dish Rack",
    p2: "AC",
    glass: 2,
    variants: [
      { id: "sgl", label: "Single door (handed)", p3: "2SG", handed: true, act: "2S 4H", oth: "2S JD", handle: "DSH" },
      { id: "dbl", label: "Double door", p3: "2SG", p4: "2HS", both: true, side: "2S 4H", handle: "DSH" },
    ],
  },
};

const TALL_FAMILIES: Record<string, any> = {
  SHF: { name: "Tall Shelf Stone (full shutter)", p2: "SH", bracket: "TCS", holes: "6H", variants: [{ id: "sgl", label: "Single door (handed)", p3: "6SX", handed: true }, { id: "dbl", label: "Double door", p3: "6SX", p4: "2HS", double: true }] },
  SHFG: { name: "Tall Shelf Glass (full shutter)", p2: "SH", bracket: "TCS", holes: "6H", variants: [{ id: "sgl", label: "Single door (handed)", p3: "6SG", handed: true }, { id: "dbl", label: "Double door", p3: "6SG", p4: "2HS", double: true }] },
  APP: { name: "Tall Appliance + DW", p2: "AP", bracket: "TMO", holes: "4H", applianceHeight: true, variants: [{ id: "1dw", label: "+ 1 Drawer (handed)", p4: "1HB", handed: true, handP5: true }, { id: "2dw", label: "+ 2 Drawers (handed)", p4: "2HB", handed: true, handP5: true }] },
  PAN: { name: "Tall Tandem Pantry", p2: "AC", bracket: "TTP", holes: "6H", variants: [{ id: "h", label: "Pantry (handed)", p3: "1SX", p5: "TPT", handed: true }] },
  DPN: { name: "Tall Drawer Pantry Stone", p2: "DW", bracket: "T3A", holes: "4H", variants: [{ id: "h", label: "Drawer pantry (handed)", p3: "1SX", p5: "5BD", handed: true }] },
  DPNG: { name: "Tall Drawer Pantry Glass", p2: "DW", bracket: "T3A", holes: "4H", variants: [{ id: "h", label: "Drawer pantry (handed)", p3: "1SG", p5: "5BD", handed: true }] },
  PPN: { name: "Tall PO Shelf Pantry Stone", p2: "PO", bracket: "TPO", holes: "6H", variants: [{ id: "h", label: "Pullout pantry (handed)", p3: "2SX", p5: "4PO", handed: true }] },
  PPNG: { name: "Tall PO Shelf Pantry Glass", p2: "PO", bracket: "TPO", holes: "6H", variants: [{ id: "h", label: "Pullout pantry (handed)", p3: "2SG", p5: "4PO", handed: true }] },
  REF: { name: "Tall Refrigerator", p2: "REF", bracket: "TRC", holes: "3H", variants: [{ id: "h", label: "Fridge (handed)", p3: "1SX", handed: true }] },
};

const TALL_BLIND_FAMILIES: Record<string, any> = {
  BLND: { name: "Tall Blind Stone Shelf", p2: "SH", bracket: "TBC", holes: "JD", variants: [{ id: "h", label: "Blind shelf (handed)", p3: "6SX", handed: true, bothJD: true }] },
  BLNG: { name: "Tall Blind Glass Shelf", p2: "SH", bracket: "TBC", holes: "JD", variants: [{ id: "h", label: "Blind shelf (handed)", p3: "6SG", handed: true, bothJD: true }] },
};

const TALL_LOW_FAMILIES: Record<string, any> = {
  LOWS: { name: "Tall Shelf Stone (Low)", p2: "SH", bracket: "TLD", holes: "6H", variants: [{ id: "h", label: "Shelf low (handed)", p3: "6SX", handed: true }] },
  LOWSG: { name: "Tall Shelf Glass (Low)", p2: "SH", bracket: "TLD", holes: "6H", variants: [{ id: "h", label: "Shelf low (handed)", p3: "6SG", handed: true }] },
};

const LOFT_FAMILIES: Record<string, any> = {
  LST: { name: "Loft Stone Shutter", p2: "SH", glass: 1, variants: [{ id: "sgl", label: "Single door (handed)", p3: "1SX", handed: true, act: "1S 3H", oth: "1S JD" }, { id: "dbl", label: "Double door", p3: "1SX", p4: "2HS", both: true, side: "1S 3H" }] },
  LGL: { name: "Loft Glass Shutter", p2: "SH", glass: 1, variants: [{ id: "sgl", label: "Single door (handed)", p3: "1SG", handed: true, act: "1S 3H", oth: "1S JD" }, { id: "dbl", label: "Double door", p3: "1SG", p4: "2HS", both: true, side: "1S 3H" }] },
};

const MD_FAMILIES: Record<string, any> = {
  MDR: { name: "Rolling Shutter", p2: "RS", glass: 3, variants: [{ id: "rs", label: "Rolling shutter", p3: "3SG", p4: "1SX", both: true, side: "4S JD" }] },
};

const ZONES: Record<string, { name: string; p1: string; construct: string; mount: string; low?: boolean; blind?: boolean; tall?: boolean; kind?: string; fams: string }> = {
  BC: { name: "Base", p1: "BC", construct: "fulltb", mount: "legs", low: false, blind: false, fams: "base" },
  BCL: { name: "Base — Low Depth", p1: "BCL", construct: "fulltb", mount: "legs", low: true, blind: false, fams: "base" },
  BB: { name: "Base Blind", p1: "BB", construct: "fulltb", mount: "legs", low: false, blind: true, fams: "blind" },
  BBL: { name: "Base Blind — Low Depth", p1: "BBL", construct: "fulltb", mount: "legs", low: true, blind: true, fams: "blind" },
  WC: { name: "Wall", p1: "WC", construct: "fullsides", mount: "wall", kind: "wall", fams: "wall" },
  WB: { name: "Wall Blind", p1: "WB", construct: "fullsides", mount: "wall", kind: "wall", blind: true, fams: "wall" },
  TC: { name: "Tall", p1: "TC", construct: "fulltb", mount: "legs", tall: true, low: false, fams: "tall" },
  TB: { name: "Tall Blind", p1: "TB", construct: "fulltb", mount: "legs", tall: true, low: false, blind: true, fams: "tallblind" },
  TCL: { name: "Tall — Low Depth", p1: "TCL", construct: "fulltb", mount: "legs", tall: true, low: true, fams: "talllow" },
  LO: { name: "Loft", p1: "LO", construct: "fullsides", mount: "wall", kind: "loft", fams: "loft" },
  LB: { name: "Loft Blind", p1: "LB", construct: "fullsides", mount: "wall", kind: "loft", blind: true, fams: "loft" },
  LBF: { name: "Loft Blind — Full Depth", p1: "LBF", construct: "fullsides", mount: "wall", kind: "loft", blind: true, fams: "loft" },
  LOF: { name: "Loft — Full Depth", p1: "LOF", construct: "fullsides", mount: "wall", kind: "loft", fams: "loft" },
  MD: { name: "Mid Rolling Shutter", p1: "MD", construct: "fullsides", mount: "wall", kind: "md", fams: "md" },
};

const famSetOf = (z: string) => {
  if (z === "BCL") {
    return { SH: BASE_FAMILIES.SH };
  }
  if (z === "BB") {
    return { LMC: BLIND_FAMILIES.LMC, BSH: BLIND_FAMILIES.BSH };
  }
  if (z === "BBL") {
    return { BSH: BLIND_FAMILIES.BSH };
  }
  if (z === "WB") {
    return { WGL: WALL_FAMILIES.WGL, WST: WALL_FAMILIES.WST };
  }

  const k = ZONES[z]?.fams;
  return k === "blind"
    ? BLIND_FAMILIES
    : k === "wall"
    ? WALL_FAMILIES
    : k === "tall"
    ? TALL_FAMILIES
    : k === "tallblind"
    ? TALL_BLIND_FAMILIES
    : k === "talllow"
    ? TALL_LOW_FAMILIES
    : k === "loft"
    ? LOFT_FAMILIES
    : k === "md"
    ? MD_FAMILIES
    : BASE_FAMILIES;
};

// Families whose shutter face is GLASS (5mm) rather than stone (6mm). These also carry
// 8mm glass shelves. Used to keep glass vs stone behavior consistent across wall & tall.
const GLASS_SHUTTER_FAMS = new Set(["WGL", "SHFG", "BLNG", "DPNG", "PPNG", "LOWSG", "LGL"]);
const isGlassShutterFam = (fk: string | undefined) => !!fk && GLASS_SHUTTER_FAMS.has(fk);

// Shutter corner connector: glass shutters use the glass bracket; everything else (and the
// always-stone fixed dummy panel) uses the stone corner connector.
const shutterCornerName = (fk: string | undefined, kind?: string) =>
  isGlassShutterFam(fk) && kind !== "fixed"
    ? "CORNER BRACKET FOR GLASS SHUTTER 62X62X GSP-CBM EBC"
    : "CORNER CONNECTOR FOR STONE 70X70X2 MAR";

// Tip-On (push-to-open) for loft cabinets — the user picks one of these BLUM codes.
const TIPON_OPTIONS = [
  "TIPON LONG VERSION W MAG LONG VERSION ADAPTER PLATE 80X20X15 GREY 1743112 BLUM",
  "TIPON LONG VERSION 125XX GREY 3156257 BLUM",
];

const SIZES: Record<string, { w: number[]; h: number[]; d: number }> = {
  "BC.DW": { w: [450, 600, 900], h: [720], d: 560 },
  "BC.HO": { w: [600, 900], h: [720], d: 560 },
  "BC.SK": { w: [600, 900, 1050, 1200], h: [720], d: 560 },
  "BC.SH": { w: [450, 500, 550, 600, 900], h: [720], d: 560 },
  "BC.GD": { w: [450, 600], h: [720], d: 560 },
  "BC.AP": { w: [600], h: [720], d: 560 },
  "BC.BPO": { w: [150, 300], h: [720], d: 560 },
  "BC.WBP": { w: [300, 600], h: [720], d: 560 },

  "BCL.DW": { w: [450, 600, 900], h: [720], d: 336 },
  "BCL.HO": { w: [600, 900], h: [720], d: 336 },
  "BCL.SK": { w: [600, 900, 1050, 1200], h: [720], d: 336 },
  "BCL.SH": { w: [450, 600], h: [720], d: 336 },
  "BCL.GD": { w: [450, 600], h: [720], d: 336 },
  "BCL.AP": { w: [600], h: [720], d: 336 },
  "BCL.BPO": { w: [150, 300], h: [720], d: 336 },

  "BB.LMC": { w: [1050], h: [720], d: 560 },
  "BB.BSH": { w: [1150], h: [720], d: 560 },
  "BB.PLB": { w: [1150], h: [720], d: 560 },

  "BBL.LMC": { w: [1050], h: [720], d: 336 },
  "BBL.BSH": { w: [1150], h: [720], d: 336 },
  "BBL.PLB": { w: [1150], h: [720], d: 336 },

  "WC.WGL": { w: [450, 500, 550, 600, 850, 900], h: [1085, 725], d: 336 },
  "WC.WST": { w: [450, 500, 550, 600, 850, 900], h: [1085, 725], d: 336 },
  "WC.WDR": { w: [600, 900], h: [1085, 725], d: 336 },
  "WC.WOP": { w: [300], h: [1085, 725], d: 336 },

  "WB.WGL": { w: [900], h: [1085, 725], d: 336 },
  "WB.WST": { w: [900], h: [1085, 725], d: 336 },
  "WB.WDR": { w: [600, 900], h: [1085, 725], d: 336 },
  "WB.WOP": { w: [300], h: [1085, 725], d: 336 },

  "TC.SHF": { w: [450, 600, 900], h: [2400, 2040], d: 560 },
  "TC.SHFG": { w: [450, 600, 900], h: [2400, 2040], d: 560 },
  "TC.APP": { w: [600], h: [2400, 2040], d: 560 },
  "TC.PAN": { w: [600], h: [2400, 2040], d: 560 },
  "TC.DPN": { w: [600], h: [2400, 2040], d: 560 },
  "TC.DPNG": { w: [600], h: [2400, 2040], d: 560 },
  "TC.PPN": { w: [600], h: [2400, 2040], d: 560 },
  "TC.PPNG": { w: [600], h: [2400, 2040], d: 560 },
  "TC.REF": { w: [600], h: [2400, 2040], d: 560 },

  "TB.BLND": { w: [1150], h: [2400, 2040], d: 560 },
  "TB.BLNG": { w: [1150], h: [2400, 2040], d: 560 },
  "TCL.LOWS": { w: [450, 600], h: [2400, 2040], d: 336 },
  "TCL.LOWSG": { w: [450, 600], h: [2400, 2040], d: 336 },

  "LO.LST": { w: [450, 550, 600, 850], h: [600], d: 336 },
  "LO.LGL": { w: [450, 550, 600, 850], h: [600], d: 336 },
  "LB.LST": { w: [900], h: [600], d: 336 },
  "LB.LGL": { w: [900], h: [600], d: 336 },
  "LBF.LST": { w: [1050], h: [600], d: 560 },
  "LBF.LGL": { w: [1050], h: [600], d: 560 },
  "LOF.LST": { w: [450, 500, 600], h: [600], d: 560 },
  "LOF.LGL": { w: [450, 500, 600], h: [600], d: 560 },

  "MD.MDR": { w: [600], h: [1650, 1290], d: 336 },
};

function defSizes(zoneKey: string) {
  const z = ZONES[zoneKey];
  const d = z.low ? 336 : z.kind ? 336 : 560;
  const h = z.tall ? 2400 : z.kind === "wall" ? 1085 : z.kind === "loft" ? 600 : z.kind === "md" ? 1650 : 720;
  return { w: [300, 450, 600, 900], h: [h], d };
}

// ---- Shutters Code ----
const SH_INSET: Record<string, number> = { MD1: 5, MD2: 5, MD3: 3, MD1CM1: 5, MD1CM2: 5, MD2CM1: 5, MD2CM2: 5, MD3CM1: 3, MD3CM2: 3, CL1: 118, CL2: 149, NEON20: 5 };
const SH_FRAME: Record<string, number> = { MD1: 25, MD2: 25, MD3: 25, MD1CM1: 25, MD1CM2: 25, MD2CM1: 25, MD2CM2: 25, MD3CM1: 25, MD3CM2: 25, CL1: 31, CL2: 31, NEON20: 25 };
const SH_DESIGNS = ["MD1", "MD2", "MD3", "MD1CM1", "MD1CM2", "MD2CM1", "MD2CM2", "MD3CM1", "MD3CM2", "CL1", "CL2", "NEON20"];
const SH_KGSQFT = 1.38;

// Designs that lock the handle to XCJ (handleless / gola); MD2 + its CM variants use Titus (STD) handle.
const XCJ_DESIGNS = ["MD1", "MD3", "MD1CM1", "MD1CM2", "MD3CM1", "MD3CM2"];
const STD_DESIGNS = ["MD2", "MD2CM1", "MD2CM2"];

// Stone face thickness (mm) per design. MD3 family = 9mm; NEON20 = 5mm glass; others = 6mm.
function shThkOf(design: string, isGlassShutter: boolean): number {
  if (isGlassShutter) return 5; // glass faces (incl. NEON20, CL1-glass) are 5mm
  if (["MD3", "MD3CM1", "MD3CM2"].includes(design)) return 9;
  return 6;
}

function shDeduct(isBase: boolean, design: string, loc: string): number {
  if (!isBase) return 3;
  if (["MD1", "MD1CM1", "MD1CM2", "MD3", "MD3CM1", "MD3CM2"].includes(design)) return loc === "ML" ? 3 : 33;
  return 3;
}

function hingeN(h: number): number {
  return h <= 900 ? 3 : h <= 1600 ? 4 : h <= 2100 ? 5 : 6;
}

function shutSpec(zk: string, fk: string, v: any, inbuiltDrawers: string = "none") {
  const Z = ZONES[zk];
  if (Z.blind) return { kind: "hinged", blindW: Z.kind === "wall" || Z.kind === "loft" ? 450 : 550 };
  if (fk === "DW" || fk === "HO") {
    if (v.id === "3dr" && inbuiltDrawers === "1lb") {
      return { kind: "drawer", fronts: [{ loc: "UH", hb: 1 }, { loc: "BH", hb: 1 }] };
    }
    // 2HB+1BL inbuilt: the cabinet shows TWO High-Back shutters (Upper HB + Bottom HB,
    // same size). The internal boxes (2 High + 1 Low) are emitted by addDrawerBoxes; the
    // shutter face is just the two high-backs (the old 2×LB faces are removed).
    if (v.id === "3dr" && inbuiltDrawers === "2hb1bl") {
      return { kind: "drawer", fronts: [{ loc: "UH", hb: 1 }, { loc: "BH", hb: 1 }] };
    }
    return v.p4 === "2HB"
      ? { kind: "drawer", fronts: [{ loc: "UH", hb: 1 }, { loc: "BH", hb: 1 }] }
      : { kind: "drawer", fronts: [{ loc: "UL", hb: 0 }, { loc: "ML", hb: 0 }, { loc: "BH", hb: 1 }] };
  }
  if (fk === "GD" || fk === "BPO" || fk === "WBP") return { kind: "drawer", fronts: [{ loc: "FH", hb: 1 }] };
  if (Z.tall && fk === "APP") {
    return { kind: "drawer", upperDoor: true, fronts: v.p4 === "2HB" ? [{ loc: "UH", hb: 1 }, { loc: "BH", hb: 1 }] : [{ loc: "BH", hb: 1 }] };
  }
  if (["SK", "SH", "WGL", "WST", "WDR", "SHF", "SHFG", "PAN", "DPN", "DPNG", "PPN", "PPNG", "REF", "BLND", "BLNG", "LOWS", "LOWSG", "LST", "LGL"].includes(fk)) return { kind: "hinged" };
  return { kind: "none" };
}

function validDesigns(zk: string, fk: string, v: any, W?: number, handle?: string): string[] {
  if (!v) return SH_DESIGNS.slice();
  const spec = shutSpec(zk, fk, v) as any;
  if (spec.kind === "none") return [];
  // Glass-shutter families carry only a glass profile: NEON20 (slim, default) or CL1
  // (classic). CL1 here is a glass shutter (5mm, inset same as stone). All other designs
  // are stone and never apply to glass families.
  if (isGlassShutterFam(fk)) return ["NEON20", "CL1"];
  let ds = SH_DESIGNS.slice();
  if (spec.kind === "drawer") {
    ds = ds.filter((d) => d !== "NEON20");
    // Low-back drawer fronts only carry the simple flat profiles; MD3 follows MD1's rules.
    if (spec.fronts.some((fr: any) => !fr.hb)) ds = ["MD1", "MD2", "MD3"];
  }
  if (fk === "BPO" && W === 150) {
    ds = ["MD1", "MD2", "MD3"];
  }
  // Handle compatibility (base zones only, where the handle is a real choice): XCJ pairs
  // with the handleless MD1/MD3/CM designs; STD (Titus) pairs with the MD2 family. CL1/CL2/
  // NEON20 are handle-agnostic. The live UI omits `handle` (design drives the handle); the
  // combination exports pass it so each cabinet code lists only its compatible designs.
  if (handle) {
    const Z = ZONES[zk];
    const isBase = !Z.kind && !Z.tall;
    if (isBase) {
      if (handle === "XCJ") ds = ds.filter((d) => !STD_DESIGNS.includes(d));
      else if (handle === "STD") ds = ds.filter((d) => !XCJ_DESIGNS.includes(d));
    }
  }
  return ds;
}

function addDrawerBoxes(
  zk: string,
  fk: string,
  v: any,
  W: number,
  D: number,
  t: number,
  panels: Panel[],
  profiles: Profile[],
  hardware: Hardware[],
  cons: Consumable[],
  pkRows: Array<[string, string, string, number, string]>,
  drawerModel: string = "Lian",
  inbuiltDrawers: string = "none"
) {
  // Determine effectiveInbuiltDrawers based on cabinet rules. NOTE: WBP (waste-bin pull-out) is
  // an accessory with NO drawer — it must NOT get a built-in drawer box. Only GD (grain drawer)
  // genuinely carries the built-in low-back drawer.
  let effectiveInbuiltDrawers = inbuiltDrawers;
  if (fk === "GD") {
    effectiveInbuiltDrawers = "1lb";
  } else if (fk === "DPN") {
    effectiveInbuiltDrawers = "fixed_dpn";
  }

  const supportedModel = drawerModel === "Lian" || drawerModel === "Hettich" || drawerModel === "Blum" || drawerModel === "Hafele" || drawerModel === "Grass";

  // Aggregate drawer boxes per variant (Low / High / Semi High). Each variant
  // collapses to a single "Drawer Pack- Cab Drawer Box <variant>" composite whose
  // quantity equals the number of drawers; inner children carry the total
  // (per-drawer consumption × drawer count) and are divided back down at render/Zoho.
  type DrawerAgg = { count: number; backH: number; hardware: string; fasciaH: number | null };
  const agg: Record<string, DrawerAgg> = {};
  const bump = (variant: string, backH: number, hardware: string, fasciaH: number | null) => {
    if (!agg[variant]) agg[variant] = { count: 0, backH, hardware, fasciaH: null };
    agg[variant].count += 1;
    if (fasciaH !== null) agg[variant].fasciaH = fasciaH;
  };

  // 1. Standard drawer boxes (no fascia — their front is the shutter). For "2hb1bl" the two
  // High-Back boxes are standard (faced by the 2 HB shutters); only the built-in Low Back
  // (added in step 2) carries a fascia. In the 2HB+1BL build the box BEHIND each high-back
  // front is actually a LOW box (short back + H90 hardware) — only the fascia is tall — so the
  // "High" pack takes the Low configuration (back height 63, LOW BACK DRAWER H90).
  const is2hb1bl = effectiveInbuiltDrawers === "2hb1bl";
  const isAcc = fk === "BPO" || fk === "WBP";
  if (!isAcc && supportedModel) {
    const spec = shutSpec(zk, fk, v, effectiveInbuiltDrawers);
    if (spec && spec.kind === "drawer" && spec.fronts) {
      spec.fronts.forEach((fr: any) => {
        if (fr.hb === 0) {
          bump("Low", 63, "HARDWARE PACK LOW BACK DRAWER H90 SET/1", null);
        } else if (fr.hb === 1) {
          if (is2hb1bl) {
            bump("High", 63, "HARDWARE PACK LOW BACK DRAWER H90 SET/1", null);
          } else {
            bump("High", 212, "HARDWARE PACK HIGH BACK DRAWER H239 SET/1", null);
          }
        }
      });
    }
  }

  // 2. Built-in drawer boxes (with carcass-colour fascia)
  if (supportedModel) {
    let numLow = 0;
    let numSemi = 0;
    let numHigh = 0;

    if (effectiveInbuiltDrawers === "1lb") {
      numLow = 1;
    } else if (effectiveInbuiltDrawers === "1sb") {
      numSemi = 1;
    } else if (effectiveInbuiltDrawers === "2lb") {
      numLow = 2;
    } else if (effectiveInbuiltDrawers === "2sb") {
      numSemi = 2;
    } else if (effectiveInbuiltDrawers === "2hb1bl") {
      // Only the built-in Low Back gets a fascia; the 2 High Backs are standard boxes
      // (step 1) faced by the HB shutters.
      numLow = 1;
    } else if (effectiveInbuiltDrawers === "fixed_dpn") {
      numLow = 2;
      numSemi = 3;
    }

    for (let i = 0; i < numHigh; i++) {
      bump("High", 212, "HARDWARE PACK HIGH BACK DRAWER H239 SET/1", 210);
    }
    for (let i = 0; i < numLow; i++) {
      bump("Low", 63, "HARDWARE PACK LOW BACK DRAWER H90 SET/1", 110);
    }
    for (let i = 0; i < numSemi; i++) {
      bump("Semi High", 148, "HARDWARE PACK HIGH BACK DRAWER H175 SET/1", 210);
    }
  }

  // 3. Emit one Drawer Pack per variant with total quantities (per-drawer × count)
  const backW = W - 72;
  const bottomW = W - 50;
  const bottomD = D - 77;
  const faciaW = W - 2 * t - 8;
  for (const [variant, a] of Object.entries(agg)) {
    const n = a.count;
    const drawerPackName = `Drawer Pack- Cab Drawer Box ${variant}`;

    // Back panel — keeps Part/drill (JD) sub-level
    panels.push({
      name: `Panels- Cab Drawer Box Back ${variant} ${backW}x${a.backH}x15`,
      w: backW,
      h: a.backH,
      qty: 1 * n,
      drill: "JD",
      pack: drawerPackName,
      t: 15
    });

    // Bottom panel — flat (no Part wrapper, no drill)
    panels.push({
      name: `Panels- Cab Drawer Box Bottom ${bottomW}x${bottomD}x6`,
      w: bottomW,
      h: bottomD,
      qty: 1 * n,
      drill: null,
      pack: drawerPackName,
      t: 6
    });

    // Fascia (built-in drawers only) — carcass colour, drilled (JD). The fascia is the
    // visible cabinet face, so it lives at the cabinet/carcass level as its OWN pack,
    // NOT nested inside the Drawer Pack composite.
    if (a.fasciaH !== null) {
      const fasciaPk = `Panels- Cab Drawer Box Fascia ${variant} ${faciaW}x${a.fasciaH}x15`;
      panels.push({
        name: fasciaPk,
        w: faciaW,
        h: a.fasciaH,
        qty: 1 * n,
        drill: "JD",
        pack: fasciaPk,
        t: 15
      });
      if (!pkRows.some(row => row[1] === fasciaPk)) {
        pkRows.push(["panel", fasciaPk, `${faciaW}×${a.fasciaH}×15`, n, "Pcs"]);
      }
    }

    // Side profile HM513 (DBS) — keeps Set of Profile Parts (LH/RH) wrapper
    profiles.push({
      name: `ALU PROF DRAWER BOTTOM SIDE (HM513) LH/RH`,
      len: 483,
      qty: 2 * n,
      type: "DBS",
      pack: drawerPackName
    });
    // Center profile HM535 (DBC) — flat, like the bottom panel (no set wrapper)
    profiles.push({
      name: `ALU PROF FOR DRAWER BOTTOM CENTER (HM535) MID`,
      len: W - 78,
      qty: 4 * n,
      type: "DBC",
      pack: drawerPackName
    });

    // Drawer-runner hardware pack. Shutter-faced drawers already carry this pack on their shutter
    // (buildShutters `hinge`), so emitting it here too duplicates the Zoho item — only the built-in
    // (fascia) drawers, which have NO shutter, keep their hardware in the Drawer Pack.
    if (a.fasciaH !== null) {
      hardware.push({
        name: a.hardware,
        qty: 1 * n,
        pack: drawerPackName
      });
    }

    if (!pkRows.some(row => row[1] === drawerPackName)) {
      pkRows.push(["panel", drawerPackName, `Set`, n, "Set"]);
    }
  }
}

function buildShutters(
  zk: string,
  fk: string,
  v: any,
  design: string,
  handle: string,
  W: number,
  H: number,
  hand: string,
  inbuiltDrawers: string = "none"
): Shutter[] {
  const Z = ZONES[zk];
  if (!design) return [];
  const isBase = !Z.kind && !Z.tall;
  const spec = shutSpec(zk, fk, v, inbuiltDrawers) as any;
  if (spec.kind === "none") return [];
  const inset = SH_INSET[design] || 5;
  const frame = SH_FRAME[design] || 25;
  const isGlassShutter = isGlassShutterFam(fk);
  // Two separate tokens after the "SH" prefix: handle (XCJ→CJ, else STD) then material
  // (glass→GL, stone→ST). Kept distinct so both are readable: SH-<CJ|STD>-<GL|ST>-...
  const handleSeg = handle === "XCJ" ? "CJ" : "STD";
  const matSeg = isGlassShutter ? "GL" : "ST";
  const shThk = String(shThkOf(design, isGlassShutter));
  const zp = isBase ? "B" : Z.kind === "wall" ? "W" : Z.tall ? "T" : Z.kind === "loft" ? "L" : "M";
  // Hinge pack by zone/material: loft → without-soft-close (closed by Tip-On); glass shutters
  // → slim glass hinge; everything else → the standard 3D hinge.
  const hingePackFor = (hh: number) => {
    const n = hingeN(hh);
    if (Z.kind === "loft") return `HARDWARE PACK HINGE W/OUT SOFT CLOSE Set/${n}`;
    if (isGlassShutter) return `HARDWARE PACK SLIM HINGE FOR GLASS Set/${n}`;
    return `HARDWARE PACK 3D HINGE 0 CRANK Set/${n}`;
  };
  const out: Shutter[] = [];

  if (spec.kind === "drawer") {
    spec.fronts.forEach((fr: any) => {
      const HE = fr.loc === "FH" ? H : fr.hb ? 360 : 180;
      const ded = shDeduct(isBase, design, fr.loc);
      const w = W - 3;
      const h = HE - ded;
      const pw = w - inset;
      const ph = h - inset;
      
      let tc = zp + (fr.hb ? "HB" : "LB");
      if (fk === "BPO") tc = "BPO";
      if (fk === "WBP") tc = "WBP";
      
      const isAcc = fk === "BPO" || fk === "WBP";
      // 2HB+1BL: the box behind each high front is a LOW box, so its shutter carries the LOW BACK
      // (H90) drawer hardware, not the high-back H239. (Matches the Drawer Pack's Low config.)
      const hinge = isAcc ? "" : (inbuiltDrawers === "2hb1bl" && fr.hb
        ? "HARDWARE PACK LOW BACK DRAWER H90 SET/1"
        : `HARDWARE PACK ${fr.hb ? "HIGH BACK DRAWER H239" : "LOW BACK DRAWER H90"} SET/1`);
      const loc = fr.loc[0];
      
      out.push({
        code: `SH-${handleSeg}-${matSeg}-${tc}-${W}x${HE}-${loc}-${w}-${h}-${frame}-${shThk}-${design}`,
        kind: "drawer",
        design,
        w,
        h,
        pw,
        ph,
        profV: h,
        profH: w,
        hinge,
        loc,
      });
    });
    if (spec.upperDoor) {
      const HE = H >= 2400 ? 1085 : 720;
      const ded = shDeduct(isBase, design, "RH");
      const h = HE - ded;
      const dw = W - 3;
      const loc = hand === "RHS" ? "R" : "L";
      const pw = dw - inset;
      const ph = h - inset;
      out.push({
        code: `SH-${handleSeg}-${matSeg}-${zp}SH-${W}x${HE}-${loc}-${dw}-${h}-${frame}-${shThk}-${design}`,
        kind: "hinged",
        design,
        w: dw,
        h,
        pw,
        ph,
        profV: h,
        profH: dw,
        hinge: hingePackFor(h),
        loc,
      });
    }
  } else {
    if (spec.blindW) {
      const ded = shDeduct(isBase, design, "RH");
      const h = H - ded;
      const dw1 = spec.blindW - 3;
      const loc1 = hand === "RHS" ? "R" : "L";
      out.push({
        code: `SH-${handleSeg}-${matSeg}-${zp}SH-${W}x${H}-${loc1}-${dw1}-${h}-${frame}-${shThk}-${design}`,
        kind: "hinged",
        design,
        w: dw1,
        h,
        pw: dw1 - inset,
        ph: h - inset,
        profV: h,
        profH: dw1,
        hinge: hingePackFor(h),
        hq: 1,
        loc: loc1,
      });
      const rem = W - spec.blindW;
      if (rem > 0) {
        const dw2 = rem - 3;
        const h2 = H - 3;
        const fi = SH_INSET["MD1"];
        const ff = SH_FRAME["MD1"];
        // The fixed (dummy) panel of a blind cabinet can never be glass — it is always a
        // stone MD1 panel (6mm), even when the functional shutter family is glass. So this
        // panel is forced to the stone material token ("ST"/6) regardless of `matSeg`/`shThk`.
        out.push({
          code: `SH-${handleSeg}-ST-${zp}SH-${W}x${H}-X-${dw2}-${h2}-${ff}-6-MD1`,
          kind: "fixed",
          design: "MD1",
          w: dw2,
          h: h2,
          pw: dw2 - fi,
          ph: h2 - fi,
          profV: h2,
          profH: dw2,
          hinge: "HARDWARE PACK L BRACKET (fixed dummy)",
          hq: 2,
          loc: "X",
        });
      }
      return out;
    }
    const two = v.double || v.p4 === "2HS" || W > 600;
    const ded = shDeduct(isBase, design, "RH");
    const h = H - ded;
    const dw = two ? W / 2 - 3 : W - 3;
    const doors = two ? [{ loc: "L" }, { loc: "R" }] : [{ loc: hand === "RHS" ? "R" : "L" }];
    doors.forEach((d) => {
      const pw = dw - inset;
      const ph = h - inset;
      out.push({
        code: `SH-${handleSeg}-${matSeg}-${zp}SH-${W}x${H}-${d.loc}-${dw}-${h}-${frame}-${shThk}-${design}`,
        kind: "hinged",
        design,
        w: dw,
        h,
        pw,
        ph,
        profV: h,
        profH: dw,
        hinge: hingePackFor(h),
        loc: d.loc,
      });
    });
  }
  return out;
}


// Per-shutter vertical profile drill codes, mirroring the carcass side-panel drilling.
// - Single door: the whole leaf inherits the cabinet's LH/RH codes (LH(m.lh)+RH(m.rh)).
// - Double door: each leaf is drilled only on its own outer (hinge) side; the inner
//   meeting edge is a plain joint (JD). Left leaf -> LH(m.lh)+RH(JD); right -> LH(JD)+RH(m.rh).
function shutterVDrill(
  lh: string | null | undefined,
  rh: string | null | undefined,
  shutters: Shutter[],
  s: Shutter
): { lh: string; rh: string } | undefined {
  if (!lh || !rh) return undefined;
  const L = String(lh);
  const R = String(rh);
  const hingedLocs = (shutters || []).filter((x) => x.kind === "hinged").map((x) => x.loc);
  const isDoublePair = hingedLocs.includes("L") && hingedLocs.includes("R");
  if (isDoublePair && s.kind === "hinged") {
    if (s.loc === "L") return { lh: L, rh: "JD" };
    if (s.loc === "R") return { lh: "JD", rh: R };
  }
  return { lh: L, rh: R };
}

function mergeCarcassPanels(panels: Panel[]): Panel[] {
  const dirRegex = /\b(Top|TP|Bottom|BT)\b/gi;
  const sideRegex = /\b(LH\/RH|LH\+RH|LH|RH|LHS|RHS)\b/gi;

  const isSidePanel = (name: string) => sideRegex.test(name);
  const isDirPanel = (name: string) => dirRegex.test(name);

  const normalizeSideName = (name: string) => name.replace(sideRegex, "LH/RH");
  const normalizeDirName = (name: string) => name.replace(dirRegex, "TP/BT");

  const parseSideDrill = (drill: string | null) => {
    if (!drill) return { lh: null, rh: null };
    const str = drill.trim();
    if (str.toLowerCase() === "no drill") return { lh: "no drill", rh: "no drill" };

    if (str.includes("/")) {
      const parts = str.split("/");
      if (parts.length === 2) {
        return {
          lh: parts[0].trim(),
          rh: parts[1].trim()
        };
      }
    }

    const lhMatch = str.match(/^LH\s+(.*)$/i);
    if (lhMatch) return { lh: lhMatch[1].trim(), rh: null };

    const rhMatch = str.match(/^RH\s+(.*)$/i);
    if (rhMatch) return { lh: null, rh: rhMatch[1].trim() };

    return { lh: str, rh: str };
  };

  const sideGroups: Record<string, Panel[]> = {};
  const dirGroups: Record<string, Panel[]> = {};
  const rawGroups: Record<string, Panel[]> = {};

  panels.forEach((p) => {
    if (isSidePanel(p.name)) {
      const normName = normalizeSideName(p.name);
      const key = `side_${normName}_w${p.w}_h${p.h}_pack${p.pack}`;
      (sideGroups[key] ??= []).push(p);
    } else if (isDirPanel(p.name)) {
      const normName = normalizeDirName(p.name);
      const key = `dir_${normName}_w${p.w}_h${p.h}_drill${p.drill || ""}_pack${p.pack}`;
      (dirGroups[key] ??= []).push(p);
    } else {
      const key = `raw_${p.name}_w${p.w}_h${p.h}_drill${p.drill || ""}_pack${p.pack}`;
      (rawGroups[key] ??= []).push(p);
    }
  });

  const merged: Panel[] = [];

  // 1. Process side groups
  for (const group of Object.values(sideGroups)) {
    if (group.length === 1 && group[0].qty === 1) {
      const p = group[0];
      const parsed = parseSideDrill(p.drill);
      const isLH = p.name.match(/\b(LH|LHS)\b/i) || parsed.lh;
      const sideName = p.name.replace(sideRegex, isLH ? "LH" : "RH");
      const sideDrill = isLH ? parsed.lh : parsed.rh;
      merged.push({
        ...p,
        name: sideName,
        drill: sideDrill
      });
    } else {
      const first = group[0];
      let lhDrill: string | null = null;
      let rhDrill: string | null = null;
      let totalQty = 0;

      group.forEach((p) => {
        const parsed = parseSideDrill(p.drill);
        if (parsed.lh) lhDrill = parsed.lh;
        if (parsed.rh) rhDrill = parsed.rh;
        totalQty += p.qty;
      });

      let combDrill: string | null = null;
      if (lhDrill && rhDrill) {
        combDrill = lhDrill === rhDrill ? lhDrill : `${lhDrill} / ${rhDrill}`;
      } else {
        combDrill = lhDrill || rhDrill;
      }

      merged.push({
        name: normalizeSideName(first.name),
        w: first.w,
        h: first.h,
        qty: totalQty,
        drill: combDrill,
        pack: first.pack
      });
    }
  }

  // 2. Process dir groups
  for (const group of Object.values(dirGroups)) {
    if (group.length === 1) {
      merged.push(group[0]);
    } else {
      const first = group[0];
      const totalQty = group.reduce((sum, p) => sum + p.qty, 0);

      const directions = new Set<string>();
      group.forEach((p) => {
        const matches = p.name.match(dirRegex);
        if (matches) {
          matches.forEach((m) => directions.add(m));
        }
      });

      let combDir = "TP/BT";
      if (directions.has("Top") || directions.has("Bottom")) {
        combDir = "Top/Bottom";
      } else if (directions.has("TP") || directions.has("BT")) {
        combDir = "TP/BT";
      } else if (directions.has("top") || directions.has("bottom")) {
        combDir = "top/bottom";
      } else if (directions.has("tp") || directions.has("bt")) {
        combDir = "tp/bt";
      }

      merged.push({
        name: first.name.replace(dirRegex, combDir),
        w: first.w,
        h: first.h,
        qty: totalQty,
        drill: first.drill,
        pack: first.pack
      });
    }
  }

  // 3. Process raw groups
  for (const group of Object.values(rawGroups)) {
    if (group.length === 1) {
      merged.push(group[0]);
    } else {
      const first = group[0];
      const totalQty = group.reduce((sum, p) => sum + p.qty, 0);
      merged.push({
        ...first,
        qty: totalQty
      });
    }
  }

  return merged;
}

interface TreeItem {
  id: string;
  name: string;
  qty: number;
  w: number;
  h: number;
  drill?: string | null;
  type: "part" | "panel";
  children?: TreeItem[];
}

function explodePanelForTree(p: Panel, cFinish: string): TreeItem[] {
  const hasDrill = p.drill && p.drill.trim() !== "" && p.drill.trim().toLowerCase() !== "no drill";
  
  if (hasDrill) {
    const isCombinedSide = /LH\/RH|LH\+RH/i.test(p.name);
    const isCombinedDir = /TP\/BT|Top\/Bottom|TP\+BT/i.test(p.name);

    if (isCombinedSide) {
      let lhDrill = p.drill;
      let rhDrill = p.drill;
      if (p.drill && p.drill.includes("/")) {
        const parts = p.drill.split("/");
        if (parts.length === 2) {
          lhDrill = parts[0].trim();
          rhDrill = parts[1].trim();
        }
      }
      const lhName = p.name.replace(/LH\/RH|LH\+RH/gi, "LH");
      const rhName = p.name.replace(/LH\/RH|LH\+RH/gi, "RH");

      const partLhName = getPartBaseName(lhName, lhDrill, cFinish);
      const partRhName = getPartBaseName(rhName, rhDrill, cFinish);
      const panelCommonName = getPanelBaseName(p.name, null, cFinish);

      return [
        {
          id: `lh_${partLhName}`,
          name: partLhName,
          qty: p.qty / 2,
          w: p.w,
          h: p.h,
          drill: lhDrill,
          type: "part",
          children: [
            {
              id: `lh_panel_${panelCommonName}`,
              name: panelCommonName,
              qty: 1,
              w: p.w,
              h: p.h,
              type: "panel"
            }
          ]
        },
        {
          id: `rh_${partRhName}`,
          name: partRhName,
          qty: p.qty / 2,
          w: p.w,
          h: p.h,
          drill: rhDrill,
          type: "part",
          children: [
            {
              id: `rh_panel_${panelCommonName}`,
              name: panelCommonName,
              qty: 1,
              w: p.w,
              h: p.h,
              type: "panel"
            }
          ]
        }
      ];
    } else if (isCombinedDir) {
      const tpTag = p.name.toLowerCase().includes("top") ? "Top" : "TP";
      const btTag = p.name.toLowerCase().includes("bottom") ? "Bottom" : "BT";
      const tpName = p.name.replace(/TP\/BT|Top\/Bottom|TP\+BT/gi, tpTag);
      const btName = p.name.replace(/TP\/BT|Top\/Bottom|TP\+BT/gi, btTag);

      const partTpName = getPartBaseName(tpName, p.drill, cFinish);
      const partBtName = getPartBaseName(btName, p.drill, cFinish);
      const panelCommonName = getPanelBaseName(p.name, null, cFinish);

      return [
        {
          id: `tp_${partTpName}`,
          name: partTpName,
          qty: p.qty / 2,
          w: p.w,
          h: p.h,
          drill: p.drill,
          type: "part",
          children: [
            {
              id: `tp_panel_${panelCommonName}`,
              name: panelCommonName,
              qty: 1,
              w: p.w,
              h: p.h,
              type: "panel"
            }
          ]
        },
        {
          id: `bt_${partBtName}`,
          name: partBtName,
          qty: p.qty / 2,
          w: p.w,
          h: p.h,
          drill: p.drill,
          type: "part",
          children: [
            {
              id: `bt_panel_${panelCommonName}`,
              name: panelCommonName,
              qty: 1,
              w: p.w,
              h: p.h,
              type: "panel"
            }
          ]
        }
      ];
    } else {
      const partName = getPartBaseName(p.name, p.drill, cFinish);
      const panelItemName = getPanelBaseName(p.name, null, cFinish);
      return [
        {
          id: `single_${partName}`,
          name: partName,
          qty: p.qty,
          w: p.w,
          h: p.h,
          drill: p.drill,
          type: "part",
          children: [
            {
              id: `single_panel_${panelItemName}`,
              name: panelItemName,
              qty: 1,
              w: p.w,
              h: p.h,
              type: "panel"
            }
          ]
        }
      ];
    }
  } else {
    // No-drill panel goes directly as Panel
    const panelItemName = getPanelBaseName(p.name, null, cFinish);
    return [
      {
        id: `nodrill_${panelItemName}`,
        name: panelItemName,
        qty: p.qty,
        w: p.w,
        h: p.h,
        type: "panel"
      }
    ];
  }
}

function formatProfileNameForTree(p: Profile, carcassProfileColor: string): string {
  const pFinish = carcassProfileColor || "CHAMPAGNE";
  const cleanedNameForPanel = p.name
    .replace(/\b(V|H|Top|Bottom|vertical|horizontal|edge)\b/gi, "")
    .replace(/LH\+RH/gi, "LH/RH")
    .replace(/TP\+BT/gi, "TP/BT")
    .replace(/\s+/g, " ")
    .trim();
  return `${cleanedNameForPanel} ${p.len}mm ${pFinish}`;
}

function buildCarcassInner(
  zk: string,
  fk: string,
  v: any,
  handle: string,
  W: number,
  H: number,
  D: number,
  t: number,
  mat: string,
  hand: string,
  drawerModel: string = "Lian",
  inbuiltDrawers: string = "none",
  tipOn: string = ""
): CarcassModel {
  const model = buildCarcassInnerRaw(zk, fk, v, handle, W, H, D, t, mat, hand, drawerModel, inbuiltDrawers, tipOn);
  model.panels = mergeCarcassPanels(model.panels);
  
  // Re-calculate netSqft, nPanels, nCut, nDrill based on merged panels to ensure consistency
  let netSqft = 0;
  let nPanels = 0;
  let nCut = 0;
  let nDrill = 0;
  model.panels.forEach((p) => {
    netSqft += sqft(p.w, p.h) * p.qty;
    nPanels += p.qty;
    nCut += p.qty;
    if (p.drill) nDrill += p.qty;
  });
  model.netSqft = netSqft;
  model.nPanels = nPanels;
  model.ops = { cut: nCut, drill: nDrill };
  
  return model;
}

function buildCarcassInnerRaw(
  zk: string,
  fk: string,
  v: any,
  handle: string,
  W: number,
  H: number,
  D: number,
  t: number,
  mat: string,
  hand: string,
  drawerModel: string = "Lian",
  inbuiltDrawers: string = "none",
  tipOn: string = ""
): CarcassModel {
  const z = ZONES[zk];
  const f = famSetOf(zk)[fk];
  const p4 = v.p4 || hand;
  const isCJ = handle === "XCJ";
  // Two separate tokens in the cabinet code, mirroring the shutter code: handle
  // (XCJ→CJ, else STD) then material (glass shutter WGL→GL, else stone ST).
  // Result: <zone>-<fam>-<CJ|STD>-<GL|ST>-...
  const handleToken = handle === "XCJ" ? "CJ" : "STD";
  const matToken = isGlassShutterFam(fk) ? "GL" : "ST";

  if (z.tall) {
    const sideH = H - 2 * t;
    const sd = D - 15;
    const shD = D - 49;
    const bw = W - 2 * t - 2 * STEP;
    // Tall Refrigerator (REF): back wall is shortened to cabinet height - 1874.
    const bh = fk === "REF" ? H - 1874 : H - 2 * t - 2 * STEP;
    const br = f.bracket;
    const ho = f.holes;
    let lh: string;
    let rh: string;
    if (v.bothJD) {
      lh = rh = `${br} JD`;
    } else if (v.double) {
      lh = rh = `${br} ${ho}`;
    } else {
      const L = hand === "LHS";
      lh = L ? `${br} ${ho}` : `${br} JD`;
      rh = L ? `${br} JD` : `${br} ${ho}`;
    }
    const isApp = f.applianceHeight;
    const p3 = isApp ? (H >= 2400 ? "3SX" : "1SX") : v.p3 || "1SX";
    const shelves = parseInt(p3) || 1;
    const p4t = isApp ? v.p4 : v.p4 || hand || "XXX";
    const p5t = isApp ? hand || "XXX" : v.p5 || "XXX";
    const lowT = z.low ? " (Low Depth)" : "";
    const lowSh = z.low ? " (Low)" : "";
    const code = [z.p1, f.p2, handleToken, matToken, p3, p4t, p5t, W, H, D, t].join("-") + (mat && mat !== "(none)" ? "-" + mat : "");
    const sidePk = `Set of Parts- Cab Standard Tall LH(${lh})+RH(${rh}) ${sideH}x${sd}x${t}`;
    const tbPk = `Set of Parts- Cab Standard Base${lowT} TP(JD)+BT(LEG) ${W}x${D}x${t}`;
    const backPk = `Set of Parts- Cab Standard Tall Back Wall (Prof) ${bw}x${bh}x${t}`;
    const shelfW = W - 2 * t - 5;
    const shelfPk = `Panels- Cab Shelf${lowSh} ${shelfW}x${shD}x${t}`;
    const pkRows: Array<[string, string, string, number, string]> = [];
    const panels: Panel[] = [];
    const profiles: Profile[] = [];
    const hardware: Hardware[] = [];
    const cons: Consumable[] = [];

    pkRows.push(["panel", `Set of Parts- Cab Standard Tall LH(${lh})+RH(${rh})`, `${sideH}×${sd}×${t}`, 1, "Set"]);
    panels.push({ name: `Panels- Cab Tall LH/RH ${sideH}x${sd}x${t}`, w: sideH, h: sd, qty: 2, drill: `${lh} / ${rh}`, pack: sidePk });
    addElenor(sideH, profiles, cons, hardware, pkRows);
    pkRows.push(["panel", `Set of Parts- Cab Standard Base${lowT} TP(JD)+BT(LEG)`, `${W}×${D}×${t}`, 1, "Set"]);
    panels.push({ name: `Panels- Cab Top ${W}x${D}x${t}`, w: W, h: D, qty: 1, drill: "JD", pack: tbPk });
    panels.push({ name: `Panels- Cab Bottom ${W}x${D}x${t}`, w: W, h: D, qty: 1, drill: "Leg holes", pack: tbPk });
    const isSpecialApp = fk === "APP" && (v.id === "1dw" || v.id === "2dw");
    const isRef = fk === "REF";
    // REF @ 2040mm: no back wall and no shelves (not required).
    const refNoBackShelf = isRef && H === 2040;
    // Tall Appliance + DW: upper back wall dimension is derived from cabinet height
    // (cabinet height - 1349; = 1051 at the standard 2400mm height).
    const hUpper = H - 1349;
    const hLower = v.id === "1dw" ? 286 : 686;

    if (isSpecialApp) {
      const backPkUpper = `Set of Parts- Cab Standard Tall Back Wall Upper (Prof) ${bw}x${hUpper}x${t}`;
      const backPkLower = `Set of Parts- Cab Standard Tall Back Wall Lower (Prof) ${bw}x${hLower}x${t}`;
      pkRows.push(["panel", "Set of Parts- Cab Standard Tall Back Wall Upper (Prof)", `${bw}×${hUpper}×${t}`, 1, "Set"]);
      panels.push({ name: `Panels- Cab Tall Back Upper ${bw}x${hUpper}x${t}`, w: bw, h: hUpper, qty: 1, drill: null, pack: backPkUpper });
      pkRows.push(["panel", "Set of Parts- Cab Standard Tall Back Wall Lower (Prof)", `${bw}×${hLower}×${t}`, 1, "Set"]);
      panels.push({ name: `Panels- Cab Tall Back Lower ${bw}x${hLower}x${t}`, w: bw, h: hLower, qty: 1, drill: null, pack: backPkLower });

      profiles.push({ name: "Prof Stepper (STP) TP/BT", len: W, qty: 2, type: "STP", pack: backPkUpper });
      profiles.push({ name: "Prof Stepper (STP) LH/RH", len: hUpper, qty: 2, type: "STP", pack: backPkUpper });
      profiles.push({ name: "Prof Stepper (STP) TP/BT", len: W, qty: 2, type: "STP", pack: backPkLower });
      profiles.push({ name: "Prof Stepper (STP) LH/RH", len: hLower, qty: 2, type: "STP", pack: backPkLower });

      cons.push({ name: "STEPPER SILICONE (DOWSIL 789)", qty: +(2 * stepSil(W) + 2 * stepSil(hUpper)).toFixed(3), uom: "Kg", pack: backPkUpper });
      cons.push({ name: "STEPPER SILICONE (DOWSIL 789)", qty: +(2 * stepSil(W) + 2 * stepSil(hLower)).toFixed(3), uom: "Kg", pack: backPkLower });
    } else if (!refNoBackShelf) {
      // Vertical stepper profile follows the back-wall height (= H for standard tall;
      // shorter for REF where bh = H - 1874).
      const backVProf = bh + 2 * t + 2 * STEP;
      pkRows.push(["panel", "Set of Parts- Cab Standard Tall Back Wall (Prof)", `${bw}×${bh}×${t}`, 1, "Set"]);
      panels.push({ name: `Panels- Cab Tall Back ${bw}x${bh}x${t}`, w: bw, h: bh, qty: 1, drill: null, pack: backPk });
      profiles.push({ name: "Prof Stepper (STP) TP/BT", len: W, qty: 2, type: "STP", pack: backPk });
      profiles.push({ name: "Prof Stepper (STP) LH/RH", len: backVProf, qty: 2, type: "STP", pack: backPk });
      cons.push({ name: "STEPPER SILICONE (DOWSIL 789)", qty: +(2 * stepSil(W) + 2 * stepSil(backVProf)).toFixed(3), uom: "Kg", pack: backPk });
    }
    // Tall glass-shutter families (SHFG/BLNG) carry 8mm glass shelves (direct raw
    // material, W-36 × D-49) instead of stone shelf panels — mirroring the wall unit.
    const isTallGlass = isGlassShutterFam(fk);
    let glassShelf: { name: string; w: number; d: number; t: number; qty: number } | undefined;
    if (!refNoBackShelf) {
      if (isTallGlass) {
        const gShelfW = W - 36;
        const gShelfD = shD; // D - 49
        glassShelf = {
          name: `GLASS TOUGH EP ${gShelfW}X${gShelfD}X8 CLEAR SKV`,
          w: gShelfW,
          d: gShelfD,
          t: 8,
          qty: shelves
        };
        pkRows.push(["cons", glassShelf.name, "glass shelf", shelves, "Pcs"]);
      } else {
        pkRows.push(["panel", `Panels- Cab Shelf${lowSh}`, `${shelfW}×${shD}×${t}`, shelves, "Pcs"]);
        panels.push({ name: shelfPk, w: shelfW, h: shD, qty: shelves, drill: null, pack: shelfPk });

        if (shelves > 0) {
          const profLen = shD - 2;
          profiles.push({
            name: "Prof Shelf (HM511) LH/RH",
            len: profLen,
            qty: 2 * shelves,
            type: "SLF",
            pack: shelfPk
          });
        }
      }
    }

    // REF: additional shelf panel at depth - 13 (other details mirror the standard shelf).
    if (isRef && !refNoBackShelf) {
      const refShelfD = D - 13;
      const refShelfPk = `Panels- Cab Shelf ${shelfW}x${refShelfD}x${t}`;
      pkRows.push(["panel", refShelfPk, `${shelfW}×${refShelfD}×${t}`, 1, "Pcs"]);
      panels.push({ name: refShelfPk, w: shelfW, h: refShelfD, qty: 1, drill: null, pack: refShelfPk });

      const refProfLen = refShelfD - 2;
      profiles.push({
        name: "Prof Shelf (HM511) LH/RH",
        len: refProfLen,
        qty: 2,
        type: "SLF",
        pack: refShelfPk
      });
    }

    if (fk === "APP") {
      let addQty = 0;
      if (v.id === "1dw") {
        addQty = 3;
      } else if (v.id === "2dw") {
        addQty = 2;
      }

      if (addQty > 0) {
        const shelfD13 = D - 13;
        const shelfD13Pk = `Panels- Cab Shelf ${shelfW}x${shelfD13}x${t}`;
        pkRows.push(["panel", shelfD13Pk, `${shelfW}×${shelfD13}×${t}`, addQty, "Pcs"]);
        panels.push({ name: shelfD13Pk, w: shelfW, h: shelfD13, qty: addQty, drill: null, pack: shelfD13Pk });

        const profLen = shelfD13 - 2;
        profiles.push({
          name: "Prof Shelf (HM511) LH/RH",
          len: profLen,
          qty: 2 * addQty,
          type: "SLF",
          pack: shelfD13Pk
        });
      }
    }

    const legN = legCount(W);
    pkRows.push(["hard", `HARDWARE PACK PVC LEG SET/${legN}`, "—", 1, "Set"]);
    hardware.push({ name: `HARDWARE PACK PVC LEG SET/${legN}`, qty: 1, pack: `HARDWARE PACK PVC LEG SET/${legN}` });
    pkRows.push(["hard", "HARDWARE PACK CARCASS FIXING HPL 4 SET/1", "large", 1, "Set"]);
    hardware.push({ name: "HARDWARE PACK CARCASS FIXING HPL 4 SET/1", qty: 1, pack: "HARDWARE PACK CARCASS FIXING HPL 4 SET/1" });
    const backPerim = isSpecialApp ? (2 * (bw + hUpper) + 2 * (bw + hLower)) : (refNoBackShelf ? 0 : 2 * (bw + bh));
    const glue = Math.round(((4 * D + backPerim) / 1000) * 15);
    pkRows.push(["cons", "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", "assembly", glue, "ML"]);
    cons.unshift({ name: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: glue, uom: "ML", pack: "Assembly Glue" });

    addDrawerBoxes(zk, fk, v, W, D, t, panels, profiles, hardware, cons, pkRows, drawerModel, inbuiltDrawers);

    let netSqft = 0;
    let nPanels = 0;
    let nCut = 0;
    let nDrill = 0;
    panels.forEach((p) => {
      netSqft += sqft(p.w, p.h) * p.qty;
      nPanels += p.qty;
      nCut += p.qty;
      if (p.drill) nDrill += p.qty;
    });

    return { code, mat, f, v, sn: "Standard", lh, rh, W, H, D, t, isCJ: false, pkRows, panels, profiles, hardware, cons, netSqft, nPanels, ops: { cut: nCut, drill: nDrill }, glassShelf };
  }

  if (z.kind === "loft") {
    const sideH = H;
    const sd = D - 15;
    const bw = W - 2 * t - 2 * STEP;
    const bh = H - 2 * t - 2 * STEP;
    const tbw = W - 2 * t;
    let lh: string;
    let rh: string;
    if (v.both) {
      lh = rh = v.side;
    } else {
      const L = hand === "LHS";
      lh = L ? v.act : v.oth;
      rh = L ? v.oth : v.act;
    }
    const p4w = v.p4 || hand || "XXX";
    const gw = W - 36;
    const gd = D - 49;
    const gN = f.glass || 1;
    const code = [z.p1, f.p2, handleToken, matToken, v.p3, p4w, "XXX", W, H, D, t].join("-") + (mat && mat !== "(none)" ? "-" + mat : "");
    const sidePk = `Set of Parts- Cab Standard Loft LH(${lh})+RH(${rh}) ${sideH}x${sd}x${t}`;
    const tbPk = `Set of Parts- Cab Standard Loft TP(JD)+BT(JD) ${tbw}x${D}x${t}`;
    const backPk = `Set of Parts- Cab Standard Loft Back Wall (Prof) ${bw}x${bh}x${t}`;
    const pkRows: Array<[string, string, string, number, string]> = [];
    const panels: Panel[] = [];
    const profiles: Profile[] = [];
    const hardware: Hardware[] = [];
    const cons: Consumable[] = [];

    pkRows.push(["panel", `Set of Parts- Cab Standard Loft LH(${lh})+RH(${rh})`, `${sideH}×${sd}×${t}`, 1, "Set"]);
    panels.push({ name: `Panels- Cab Loft LH/RH ${sideH}x${sd}x${t}`, w: sideH, h: sd, qty: 2, drill: `${lh} / ${rh}`, pack: sidePk });
    pkRows.push(["panel", "Set of Parts- Cab Standard Loft TP(JD)+BT(JD)", `${tbw}×${D}×${t}`, 1, "Set"]);
    panels.push({ name: `Panels- Cab Loft TP ${tbw}x${D}x${t}`, w: tbw, h: D, qty: 1, drill: "JD", pack: tbPk });
    panels.push({ name: `Panels- Cab Loft BT ${tbw}x${D}x${t}`, w: tbw, h: D, qty: 1, drill: "JD", pack: tbPk });
    addElenor(H, profiles, cons, hardware, pkRows);
    pkRows.push(["panel", "Set of Parts- Cab Standard Loft Back Wall (Prof)", `${bw}×${bh}×${t}`, 1, "Set"]);
    panels.push({ name: `Panels- Cab Loft Back ${bw}x${bh}x${t}`, w: bw, h: bh, qty: 1, drill: null, pack: backPk });
    profiles.push({ name: "Prof Stepper (STP) TP/BT", len: W, qty: 2, type: "STP", pack: backPk });
    profiles.push({ name: "Prof Stepper (STP) LH/RH", len: H, qty: 2, type: "STP", pack: backPk });
    cons.push({ name: "STEPPER SILICONE (DOWSIL 789)", qty: +(2 * stepSil(W) + 2 * stepSil(H)).toFixed(3), uom: "Kg", pack: backPk });
    pkRows.push(["cons", `GLASS TOUGH EP ${gw}X${gd}X8 CLEAR SKV`, "glass shelf", gN, "Pcs"]);
    hardware.push({ name: `GLASS TOUGH EP ${gw}X${gd}X8`, qty: gN, uom: "Pcs", pack: "Glass Shelf" });
    pkRows.push(["hard", "HARDWARE PACK WALL HANGER BRACKET SET/1", "—", 1, "Set"]);
    hardware.push({ name: "HARDWARE PACK WALL HANGER BRACKET SET/1", qty: 1, uom: "Set", pack: "HARDWARE PACK WALL HANGER BRACKET SET/1" });
    pkRows.push(["hard", "HARDWARE PACK CARCASS FIXING HPL 4 SET/1", "small (wall)", 1, "Set"]);
    hardware.push({ name: "HARDWARE PACK CARCASS FIXING HPL 4 SET/1", qty: 1, pack: "HARDWARE PACK CARCASS FIXING HPL 4 SET/1" });
    // Tip-On (push-to-open) — loft only; one per door (loft hinges are without-soft-close).
    if (tipOn) {
      const tipOnQty = v.both ? 2 : 1;
      pkRows.push(["hard", tipOn, "tip-on", tipOnQty, "Set"]);
      hardware.push({ name: tipOn, qty: tipOnQty, uom: "Set", pack: tipOn });
    }
    const backPerim = 2 * (bw + bh);
    const glue = Math.round(((4 * D + backPerim) / 1000) * 15);
    pkRows.push(["cons", "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", "assembly", glue, "ML"]);
    cons.unshift({ name: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: glue, uom: "ML", pack: "Assembly Glue" });

    let netSqft = 0;
    let nPanels = 0;
    let nCut = 0;
    let nDrill = 0;
    panels.forEach((p) => {
      netSqft += sqft(p.w, p.h) * p.qty;
      nPanels += p.qty;
      nCut += p.qty;
      if (p.drill) nDrill += p.qty;
    });

    return { code, mat, f, v, sn: "Standard", lh, rh, W, H, D, t, isCJ: false, pkRows, panels, profiles, hardware, cons, netSqft, nPanels, ops: { cut: nCut, drill: nDrill } };
  }

  if (z.kind === "md") {
    const sideH = H;
    const sd = D;
    const bw = W - 2 * t - 2 * STEP;
    const bh = H - 17;
    const tbw = W - 2 * t;
    const lh = v.side;
    const rh = v.side;
    const gw = W - 36;
    const gd = D - 62;
    const gN = f.glass || 3;
    const code = [z.p1, f.p2, handleToken, matToken, v.p3, v.p4, "XXX", W, H, D, t].join("-") + (mat && mat !== "(none)" ? "-" + mat : "");
    const sidePk = `Set of Parts- Cab Standard Wall LH(${lh})+RH(${rh}) ${sd}x${sideH}x${t}`;
    const tpPk = `Part Cab Standard TP JD ${tbw}x${D}x${t}`;
    const backPk = `Set of Parts- Cab Standard Tall Back Wall (Prof) ${bw}x${bh}x${t}`;
    const pkRows: Array<[string, string, string, number, string]> = [];
    const panels: Panel[] = [];
    const profiles: Profile[] = [];
    const hardware: Hardware[] = [];
    const cons: Consumable[] = [];

    pkRows.push(["panel", `Set of Parts- Cab Standard Wall LH(${lh})+RH(${rh})`, `${sd}×${sideH}×${t}`, 1, "Set"]);
    panels.push({ name: `Panels- Cab Wall LH/RH ${sd}x${sideH}x${t}`, w: sd, h: sideH, qty: 2, drill: `${lh} / ${rh}`, pack: sidePk });
    pkRows.push(["panel", "Part Cab Standard TP JD (no bottom)", `${tbw}×${D}×${t}`, 1, "Pcs"]);
    panels.push({ name: `Panels- Cab MD TP ${tbw}x${D}x${t}`, w: tbw, h: D, qty: 1, drill: "JD", pack: tpPk });
    pkRows.push(["panel", "Set of Parts- Cab Standard Tall Back Wall (Prof)", `${bw}×${bh}×${t}`, 1, "Set"]);
    panels.push({ name: `Panels- Cab MD Back ${bw}x${bh}x${t}`, w: bw, h: bh, qty: 1, drill: null, pack: backPk });
    profiles.push({ name: "Prof Stepper (STP) TP/BT", len: W, qty: 2, type: "STP", pack: backPk });
    profiles.push({ name: "Prof Stepper (STP) LH/RH", len: H, qty: 2, type: "STP", pack: backPk });
    cons.push({ name: "STEPPER SILICONE (DOWSIL 789)", qty: +(2 * stepSil(W) + 2 * stepSil(H)).toFixed(3), uom: "Kg", pack: backPk });
    pkRows.push(["cons", `GLASS 08 MM CLEAR TOUGH EP ${gw} X ${gd} MM`, "glass shelf", gN, "Pcs"]);
    hardware.push({ name: `GLASS 08 MM ${gw}X${gd}`, qty: gN, uom: "Pcs", pack: "Glass Shelf" });
    pkRows.push(["panel", "Panels- Cab Stone Shelf (fixed)", `${bw}×${D - 32}×${t}`, 1, "Pcs"]);
    panels.push({ name: `Panels- Cab MD Stone Shelf ${bw}x${D - 32}x${t}`, w: bw, h: D - 32, qty: 1, drill: null, pack: `Panels- Cab Stone Shelf ${bw}x${D - 32}x${t}` });
    pkRows.push(["hard", "HARDWARE PACK WALL HANGER BRACKET SET/1", "—", 1, "Set"]);
    hardware.push({ name: "HARDWARE PACK WALL HANGER BRACKET SET/1", qty: 1, uom: "Set", pack: "HARDWARE PACK WALL HANGER BRACKET SET/1" });
    pkRows.push(["hard", "HARDWARE PACK CARCASS FIXING HPL 4 SET/1", "small (wall)", 1, "Set"]);
    hardware.push({ name: "HARDWARE PACK CARCASS FIXING HPL 4 SET/1", qty: 1, pack: "HARDWARE PACK CARCASS FIXING HPL 4 SET/1" });
    const backPerim = 2 * (bw + bh);
    const glue = Math.round(((4 * D + backPerim) / 1000) * 15);
    pkRows.push(["cons", "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", "assembly", glue, "ML"]);
    cons.unshift({ name: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: glue, uom: "ML", pack: "Assembly Glue" });

    let netSqft = 0;
    let nPanels = 0;
    let nCut = 0;
    let nDrill = 0;
    panels.forEach((p) => {
      netSqft += sqft(p.w, p.h) * p.qty;
      nPanels += p.qty;
      nCut += p.qty;
      if (p.drill) nDrill += p.qty;
    });

    return { code, mat, f, v, sn: "Standard", lh, rh, W, H, D, t, isCJ: false, pkRows, panels, profiles, hardware, cons, netSqft, nPanels, ops: { cut: nCut, drill: nDrill } };
  }

  if (z.kind === "wall") {
    const isWDR = fk === "WDR";
    // Dish Rack carcass is reduced a further 15mm (vs. the standard 15mm) to fit the
    // aluminium sink profile: at H=1085 the whole WDR carcass (LH/RH sides, back wall,
    // stepper) is 1055mm. Every other wall family stays at H − 15 (= 1070 at 1085).
    const cH = isWDR ? H - 30 : H - 15;
    const sideH = cH;
    const sd = isWDR ? D : D - 15;
    const bw = W - 2 * t - 2 * STEP;
    const bh = cH - 2 * t - 2 * STEP;
    const tbw = W - 2 * t;
    let lh: string;
    let rh: string;
    if (v.both) {
      lh = rh = v.side;
    } else if (v.handed) {
      const L = hand === "LHS";
      lh = L ? v.act : v.oth;
      rh = L ? v.oth : v.act;
    } else {
      lh = rh = v.side;
    }
    const p5 = v.handle || "XXX";
    const p4w = v.p4 || hand || "XXX";
    // Shelf count is height-derived for every wall family, so the cabinet code's p3
    // shelf-count digit (and the side-panel shelf-drilling) follow the height rather
    // than the static family default:
    //   WGL / WST / WOP  →  1085 → 3 shelves, 720 → 1 shelf
    //   WDR (dish rack)  →  1085 → 2 shelves, 720 → 0 shelves (no shelf; p3 → XXX)
    const isWallShelfFam = fk === "WGL" || fk === "WST" || fk === "WOP" || fk === "WDR";
    const wallShelfQty = isWDR
      ? (H >= 1085 ? 2 : 0)
      : (fk === "WGL" || fk === "WST" || fk === "WOP") ? (H >= 1085 ? 3 : 1) : 0;
    const shelfTok = wallShelfQty === 0 ? "XXX" : `${wallShelfQty}S`;
    const p3Code = isWallShelfFam
      ? (wallShelfQty === 0 ? "XXX" : v.p3.replace(/^\d+/, String(wallShelfQty)))
      : v.p3;
    // Side-panel drilling follows the same height rules: the shelf-count token tracks
    // wallShelfQty, and (WGL/WST only) the hinge-count token is height-driven via the
    // general hingeN rule (720 → 3H, 1085 → 4H). WDR/WOP keep their family hinge token.
    if (isWallShelfFam) {
      const dynHinge = fk === "WGL" || fk === "WST";
      const tx = (codeStr: string) => {
        let s = codeStr.replace(/^\d+S/, shelfTok);
        if (dynHinge) s = s.replace(/\d+H/, `${hingeN(H)}H`);
        return s;
      };
      lh = tx(lh);
      rh = tx(rh);
    }
    // Glass vs stone shutter must be distinguishable in the cabinet code. Both carry
    // glass shelves (so p3 reads the same "SG"), so the differentiator is the shared
    // material token: WGL → "GL", WST (and other wall fams) → "ST".
    const code = [z.p1, f.p2, handleToken, matToken, p3Code, p4w, p5, W, H, D, t].join("-") + (mat && mat !== "(none)" ? "-" + mat : "");
    const sidePk = `Set of Parts- Cab Standard Wall LH(${lh})+RH(${rh}) ${sd}x${sideH}x${t}`;
    const tbPk = isWDR
      ? `Set of Parts- Cab Standard Wall TP(JD) ${tbw}x${D}x${t}`
      : `Set of Parts- Cab Standard Wall TP(JD)+BT(JD) ${tbw}x${D}x${t}`;
    const backPk = `Set of Parts- Cab Standard Wall Back Wall (Prof) ${bw}x${bh}x${t}`;
    const gw = W - 36;
    // Glass/stone shelf depth: Dish Rack (WDR) → D - 39, any other wall family → D - 49.
    const gd = D - (isWDR ? 39 : 49);
    const pkRows: Array<[string, string, string, number, string]> = [];
    const panels: Panel[] = [];
    const profiles: Profile[] = [];
    const hardware: Hardware[] = [];
    const cons: Consumable[] = [];

    pkRows.push(["panel", `Set of Parts- Cab Standard Wall LH(${lh})+RH(${rh})`, `${sd}×${sideH}×${t}`, 1, "Set"]);
    panels.push({ name: `Panels- Cab Wall LH/RH ${sd}x${sideH}x${t}`, w: sd, h: sideH, qty: 2, drill: `${lh} / ${rh}`, pack: sidePk });

    if (isWDR) {
      pkRows.push(["panel", "Set of Parts- Cab Standard Wall TP(JD)", `${tbw}×${D}×${t}`, 1, "Set"]);
      panels.push({ name: `Panels- Cab Wall TP ${tbw}x${D}x${t}`, w: tbw, h: D, qty: 1, drill: "JD", pack: tbPk });

      const sinkPk = "Sink Profile Frame (HM510)";
      pkRows.push(["prof", "Set of Profile TP(JD)+BT(JD) SINK", `${W}`, 1, "Set"]);
      pkRows.push(["prof", "Set of Profile LH(JD)+RH(JD) SINK", `${D}`, 1, "Set"]);
      pkRows.push(["hard", "CORNER BRACKET FOR GLASS SHUTTER", "—", 1, "Set"]);
      profiles.push({ name: "Prof Sink Frame (SINK) TP/BT", len: W, qty: 2, type: "SINK", pack: sinkPk });
      profiles.push({ name: "Prof Sink Frame (SINK) LH/RH", len: D, qty: 2, type: "SINK", pack: sinkPk });
      hardware.push({ name: "CORNER BRACKET FOR GLASS SHUTTER", qty: 1, pack: sinkPk });
    } else {
      pkRows.push(["panel", "Set of Parts- Cab Standard Wall TP(JD)+BT(JD)", `${tbw}×${D}×${t}`, 1, "Set"]);
      panels.push({ name: `Panels- Cab Wall TP ${tbw}x${D}x${t}`, w: tbw, h: D, qty: 1, drill: "JD", pack: tbPk });
      panels.push({ name: `Panels- Cab Wall BT ${tbw}x${D}x${t}`, w: tbw, h: D, qty: 1, drill: "JD", pack: tbPk });
      addElenor(cH, profiles, cons, hardware, pkRows);
    }
    pkRows.push(["panel", "Set of Parts- Cab Standard Wall Back Wall (Prof)", `${bw}×${bh}×${t}`, 1, "Set"]);
    panels.push({ name: `Panels- Cab Wall Back ${bw}x${bh}x${t}`, w: bw, h: bh, qty: 1, drill: null, pack: backPk });
    profiles.push({ name: "Prof Stepper (STP) TP/BT", len: W, qty: 2, type: "STP", pack: backPk });
    profiles.push({ name: "Prof Stepper (STP) LH/RH", len: cH, qty: 2, type: "STP", pack: backPk });
    cons.push({ name: "STEPPER SILICONE (DOWSIL 789)", qty: +(2 * stepSil(W) + 2 * stepSil(cH)).toFixed(3), uom: "Kg", pack: backPk });

    let glassShelf: { name: string; w: number; d: number; t: number; qty: number } | undefined;

    if (fk === "WST" || fk === "WGL") {
      // Wall stone & glass shutter cabinets: glass shelves are a DIRECT raw material
      // (not a stone-panel BOM). Shelf size = W - 36 × D - 49 (8mm glass), matching the
      // other wall/loft glass shelves. Qty by height: 1085 → 3, 720 → 1.
      const shelfW = gw;
      const shelfD = gd;
      const shelfQty = wallShelfQty;
      glassShelf = {
        name: `GLASS TOUGH EP ${shelfW}X${shelfD}X8 CLEAR SKV`,
        w: shelfW,
        d: shelfD,
        t: 8,
        qty: shelfQty
      };
      pkRows.push(["cons", glassShelf.name, "glass shelf", shelfQty, "Pcs"]);
    } else if (f.glass && wallShelfQty > 0) {
      // Other wall families (WOP/WDR): legacy glass shelf via hardware pack. Quantity is
      // height-derived (WOP: 1085 → 3, 720 → 1; WDR: 1085 → 2, 720 → 0 = no shelf emitted).
      pkRows.push(["cons", `GLASS TOUGH EP ${gw}X${gd}X8 CLEAR SKV`, "glass shelf", wallShelfQty, "Pcs"]);
      hardware.push({ name: `GLASS TOUGH EP ${gw}X${gd}X8`, qty: wallShelfQty, uom: "Pcs", pack: "Glass Shelf" });
    }
    pkRows.push(["hard", "HARDWARE PACK WALL HANGER BRACKET SET/1", "—", 1, "Set"]);
    hardware.push({ name: "HARDWARE PACK WALL HANGER BRACKET SET/1", qty: 1, uom: "Set", pack: "HARDWARE PACK WALL HANGER BRACKET SET/1" });
    pkRows.push(["hard", "HARDWARE PACK CARCASS FIXING HPL 4 SET/1", "small (wall)", 1, "Set"]);
    hardware.push({ name: "HARDWARE PACK CARCASS FIXING HPL 4 SET/1", qty: 1, pack: "HARDWARE PACK CARCASS FIXING HPL 4 SET/1" });
    const backPerim = 2 * (bw + bh);
    const glue = Math.round(((4 * D + backPerim) / 1000) * 15);
    pkRows.push(["cons", "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", "assembly", glue, "ML"]);
    cons.unshift({ name: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: glue, uom: "ML", pack: "Assembly Glue" });

    let netSqft = 0;
    let nPanels = 0;
    let nCut = 0;
    let nDrill = 0;
    panels.forEach((p) => {
      netSqft += sqft(p.w, p.h) * p.qty;
      nPanels += p.qty;
      nCut += p.qty;
      if (p.drill) nDrill += p.qty;
    });

    return { code, mat, f, v, sn: "Standard", lh, rh, W, H, D, t, isCJ: false, pkRows, panels, profiles, hardware, cons, netSqft, nPanels, ops: { cut: nCut, drill: nDrill }, glassShelf };
  }

  // ---- Base Default Cases ----
  const sideH = H - 2 * t;
  const bw = W - 2 * t - 2 * STEP;
  const bh = H - 2 * t - 2 * STEP;
  let lh: string;
  let rh: string;
  if (v.blind) {
    const L = hand === "LHS";
    if (v.plain) {
      lh = L ? "BL L" : "BL";
      rh = L ? "BL" : "BL R";
    } else {
      lh = L ? "1S BL L" : "1S BL";
      rh = L ? "1S BL" : "1S BL R";
    }
  } else if (v.both) {
    lh = rh = v.side;
  } else if (v.handed) {
    if (hand === "LHS") {
      lh = v.act;
      rh = v.oth;
    } else {
      lh = v.oth;
      rh = v.act;
    }
  } else {
    lh = rh = v.side;
  }
  const sn = isCJ ? "CJ" : "Standard";
  const lowS = z.low && !z.blind ? " (Low Depth)" : "";
  const lowT = z.low ? " (Low Depth)" : "";
  const lowSh = z.low ? " (Low)" : "";
  const tpbtC = v.lem
    ? hand === "LHS"
      ? "TP(LEM L)+BT(LEM L+LEG)"
      : "TP(LEM R)+BT(LEM R+LEG)"
    : "TP(JD)+BT(LEG)";
  const topDepTxt = isCJ ? D - CJ_CUT + "-" + D : String(D);
  // BC + DW + 3-drawer with "2HB + 1BL" inbuilt selection only relabels the code (boxes unchanged).
  const isInbuilt2hb1bl = z.p1 === "BC" && fk === "DW" && v.id === "3dr" && inbuiltDrawers === "2hb1bl";
  const codeP3 = isInbuilt2hb1bl ? "2HB" : v.p3;
  const codeP4 = isInbuilt2hb1bl ? "1BL" : p4;
  // P7 (p5) used to repeat the handle as XCJ/STD — redundant with P3's handle token (CJ/STD) and
  // confusing for the team, so it is now "XXX". The handle is decoded from P3 (handleToken).
  const code = [z.p1, f.p2, handleToken, matToken, codeP3, codeP4, "XXX", W, H, D, t].join("-") + (mat && mat !== "(none)" ? "-" + mat : "");
  const pkRows: Array<[string, string, string, number, string]> = [];
  const panels: Panel[] = [];
  const profiles: Profile[] = [];
  const hardware: Hardware[] = [];
  const cons: Consumable[] = [];

  const sidePk = `Set of Parts- Cab ${sn} Base${lowS} LH(${lh})+RH(${rh}) ${D}x${sideH}x${t}`;
  const tbPk = `Set of Parts- Cab ${sn} Base${lowT} ${tpbtC} ${W}x${topDepTxt}x${t}`;
  const btFramePk = `Part Cab Common BT LEG ${W}x${D}x${t}`;
  const backPk = `Set of Parts- Cab Common Base Back Wall (Prof) ${bw}x${bh}x${t}`;
  const backStripPk = `Back Wall Strips ${bw}x75x${t}`;
  const sinkPk = "Sink Profile Frame (HM510)";
  const shelfW = W - 2 * t - 5;
  const shelfPk = `Panels- Cab Shelf${lowSh} ${shelfW}x${D - SHELF_OFF}x${t}`;

  pkRows.push(["panel", `Set of Parts- Cab ${sn} Base${lowS} LH(${lh})+RH(${rh})`, `${D}×${sideH}×${t}`, 1, "Set"]);
  panels.push({ name: `Panels- Cab LH/RH ${D}x${sideH}x${t}`, w: D, h: sideH, qty: 1, drill: `LH ${lh}`, pack: sidePk });
  panels.push({ name: `Panels- Cab LH/RH ${D}x${sideH}x${t}`, w: D, h: sideH, qty: 1, drill: `RH ${rh}`, pack: sidePk });

  if (f.top === "frame") {
    pkRows.push(["panel", "Part Cab Common BT LEG", `${W}×${D}×${t}`, 1, "Pcs"]);
    panels.push({ name: `Panels- Cab Bottom ${W}x${D}x${t}`, w: W, h: D, qty: 1, drill: "Leg holes", pack: btFramePk });
  } else {
    const td = isCJ ? D - CJ_CUT : D;
    pkRows.push(["panel", `Set of Parts- Cab ${sn} Base${lowT} ${tpbtC}`, `${W}×${topDepTxt}×${t}`, 1, "Set"]);
    panels.push({
      name: `Panels- Cab Top${isCJ ? " CJ" : ""} ${W}x${td}x${t}`,
      w: W,
      h: td,
      qty: 1,
      drill: v.lem ? (hand === "LHS" ? "LEM L" : "LEM R") : "JD",
      pack: tbPk,
    });
    panels.push({
      name: `Panels- Cab Bottom ${W}x${D}x${t}`,
      w: W,
      h: D,
      qty: 1,
      drill: v.lem ? (hand === "LHS" ? "LEM L+LEG" : "LEM R+LEG") : "Leg holes",
      pack: tbPk,
    });
  }

  if (f.backStrips) {
    pkRows.push(["panel", "Back Wall TP(Prof)", `${bw}×75×${t}`, 1, "Set"]);
    pkRows.push(["panel", "Back Wall BT(Prof)", `${bw}×75×${t}`, 1, "Set"]);
    panels.push({ name: `Panels- Cab Back Strip ${bw}x75x${t}`, w: bw, h: 75, qty: 2, drill: null, pack: backStripPk });
  } else {
    pkRows.push(["panel", "Set of Parts- Cab Common Base Back Wall (Prof)", `${bw}×${bh}×${t}`, 1, "Set"]);
    panels.push({ name: `Panels- Cab Back Wall ${bw}x${bh}x${t}`, w: bw, h: bh, qty: 1, drill: null, pack: backPk });
    profiles.push({ name: "Prof Stepper (STP) TP/BT", len: W, qty: 2, type: "STP", pack: backPk });
    profiles.push({ name: "Prof Stepper (STP) LH/RH", len: H, qty: 2, type: "STP", pack: backPk });
    cons.push({ name: "STEPPER SILICONE (DOWSIL 789)", qty: +(2 * stepSil(W) + 2 * stepSil(H)).toFixed(3), uom: "Kg", pack: backPk });
  }

  if (f.top === "frame") {
    pkRows.push(["prof", `Set of Profile TP(JD)+BT(JD) SINK`, `${W}${isCJ ? "  (CJ −23)" : ""}`, 1, "Set"]);
    pkRows.push(["prof", `Set of Profile LH(JD)+RH(JD) SINK`, `530`, 1, "Set"]);
    pkRows.push(["hard", "CORNER BRACKET FOR GLASS SHUTTER", "—", 1, "Set"]);
    profiles.push({ name: "Prof Sink Frame (SINK) TP/BT", len: W, qty: 2, type: "SINK", pack: sinkPk });
    profiles.push({ name: "Prof Sink Frame (SINK) LH/RH", len: 530, qty: 2, type: "SINK", pack: sinkPk });
    hardware.push({ name: "CORNER BRACKET FOR GLASS SHUTTER", qty: 1, pack: sinkPk });
  }

  if (f.shelf) {
    pkRows.push(["panel", `Panels- Cab Shelf${lowSh}`, `${shelfW}×${D - SHELF_OFF}×${t}`, f.shelf, "Pcs"]);
    panels.push({ name: `Panels- Cab Shelf${lowSh} ${shelfW}x${D - SHELF_OFF}x${t}`, w: shelfW, h: D - SHELF_OFF, qty: f.shelf, drill: null, pack: shelfPk });

    // Add shelf profiles
    const profLen = z.low ? (D - SHELF_OFF) : (D - SHELF_OFF - 2);
    profiles.push({
      name: "Prof Shelf (HM511) LH/RH",
      len: profLen,
      qty: 2 * f.shelf,
      type: "SLF",
      pack: shelfPk
    });
  }

  const legN = legCount(W);
  pkRows.push(["hard", `HARDWARE PACK PVC LEG SET/${legN}`, "—", 1, "Set"]);
  hardware.push({ name: `HARDWARE PACK PVC LEG SET/${legN}`, qty: 1, pack: `HARDWARE PACK PVC LEG SET/${legN}` });
  pkRows.push(["hard", "HARDWARE PACK CARCASS FIXING HPL 4 SET/1", "large", 1, "Set"]);
  hardware.push({ name: "HARDWARE PACK CARCASS FIXING HPL 4 SET/1", qty: 1, pack: "HARDWARE PACK CARCASS FIXING HPL 4 SET/1" });

  const backPerim = f.backStrips ? 2 * (2 * (bw + 75)) : 2 * (bw + bh);
  const glue = Math.round(((4 * D + backPerim) / 1000) * 15);
  pkRows.push(["cons", "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", "assembly", glue, "ML"]);
  cons.unshift({ name: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: glue, uom: "ML", pack: "Assembly Glue" });

  addDrawerBoxes(zk, fk, v, W, D, t, panels, profiles, hardware, cons, pkRows, drawerModel, inbuiltDrawers);

  let netSqft = 0;
  let nPanels = 0;
  let nCut = 0;
  let nDrill = 0;
  panels.forEach((p) => {
    netSqft += sqft(p.w, p.h) * p.qty;
    nPanels += p.qty;
    nCut += p.qty;
    if (p.drill) nDrill += p.qty;
  });

  return { code, mat, f, v, sn, lh, rh, W, H, D, t, isCJ, pkRows, panels, profiles, hardware, cons, netSqft, nPanels, ops: { cut: nCut, drill: nDrill } };
}

function buildModel(
  zk: string,
  fk: string,
  v: any,
  handle: string,
  design: string,
  carcassMat: string,
  shutterMat: string,
  carcassProfileColor: string,
  shutterProfileColor: string,
  W: number,
  H: number,
  D: number,
  t: number,
  hand: string,
  drawerModel: string = "Lian",
  inbuiltDrawers: string = "none",
  fixedPanelMat: string = "",
  tipOn: string = ""
): CarcassModel {
  const matSuffix = carcassMat === shutterMat || !shutterMat ? carcassMat : `${carcassMat}-${shutterMat}`;
  const m = buildCarcassInner(zk, fk, v, handle, W, H, D, t, matSuffix, hand, drawerModel, inbuiltDrawers, tipOn);
  m.zk = zk;
  m.fk = fk;
  m.carcassMat = carcassMat;
  m.shutterMat = shutterMat;
  m.fixedPanelMat = fixedPanelMat || shutterMat;
  m.carcassProfileColor = carcassProfileColor;
  m.shutterProfileColor = shutterProfileColor;
  m.mat = carcassMat; // fallback
  m.shutters = buildShutters(zk, fk, v, design, handle, W, H, hand, inbuiltDrawers);
  m.shutters.forEach((s) => {
    // The fixed (dummy) panel of a blind cabinet is always a stone 6mm panel, even in a
    // glass-shutter family — so glass treatment is per-shutter, never on the fixed panel.
    const label = isGlassShutterFam(fk) && s.kind !== "fixed"
      ? `${s.w}×${s.h} · glass ${s.pw}×${s.ph}×5`
      : `${s.w}×${s.h} · panel ${s.pw}×${s.ph}×${shThkOf(s.design, false)}`;
    m.pkRows.push(["shut", s.code, label, 1, "Set"]);
  });
  return m;
}

function buildRawRows(m: CarcassModel) {
  const rows: Array<{ item: string; pack: string; uom: string; qty: number }> = [];
  m.panels.forEach((p) => {
    rows.push({ item: p.name, pack: p.pack, uom: "Pcs", qty: p.qty });
  });
  m.profiles.forEach((p) => rows.push({ item: `${p.name} ${p.len}mm`, pack: p.pack, uom: "Pcs", qty: p.qty }));
  m.hardware.forEach((h) => rows.push({ item: h.name, pack: h.pack || h.name, uom: h.uom || "Set", qty: h.qty }));
  m.cons.forEach((c) => rows.push({ item: c.name, pack: c.pack || "Consumable", uom: c.uom, qty: c.qty }));
  if (m.glassShelf) rows.push({ item: m.glassShelf.name, pack: "Glass Shelf", uom: "Pcs", qty: m.glassShelf.qty });
  (m.shutters || []).forEach((s) => {
    // Fixed (dummy) blind panels are always stone 6mm MD1, even in glass families.
    if (isGlassShutterFam(m.fk) && s.kind !== "fixed") {
      rows.push({ item: `GLASS TOUGH EP ${s.pw}X${s.ph}X5 ${m.shutterMat || "CLEAR"} SKV`, pack: s.code, uom: "Pcs", qty: 1 });
    } else {
      rows.push({ item: `Panels- SH ${s.pw}x${s.ph}x${shThkOf(s.design, false)} ${s.design}`, pack: s.code, uom: "Pcs", qty: 1 });
    }
    rows.push({ item: `Profile LH/RH (${s.design}) ${s.profV}mm`, pack: s.code, uom: "Pcs", qty: 2 });
    rows.push({ item: `Profile TP/BT (${s.design}) ${s.profH}mm`, pack: s.code, uom: "Pcs", qty: 2 });
    rows.push({ item: shutterCornerName(m.fk, s.kind), pack: s.code, uom: "Set", qty: 1 });
    if (s.hinge) {
      rows.push({ item: s.hinge, pack: s.code, uom: "Set", qty: s.hq || 1 });
    }
  });
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

// ---- Excel Export for Builder ----

const FULL_BOM_COLS = [
  { wch: 6 }, { wch: 14 }, { wch: 11 }, { wch: 14 }, { wch: 14 }, { wch: 6 }, { wch: 40 }, { wch: 18 },
  { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 14 },
  { wch: 10 }, { wch: 9 }, { wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 9 },
  { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 14 }, { wch: 14 },
];
const OOS_COLS = [
  { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 32 }, { wch: 32 }, { wch: 18 },
  { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 14 },
  { wch: 10 }, { wch: 9 }, { wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 9 },
  { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 14 },
];
const OPTI_COLS = [
  { wch: 16 }, { wch: 16 }, { wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 9 },
  { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 10 }, { wch: 14 },
];
const ACC_COLS = [
  { wch: 16 }, { wch: 36 }, { wch: 20 }, { wch: 10 }, { wch: 36 },
  { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 20 },
];

const ROW_TYPE_FILLS: Record<string, { fgColor: { rgb: string } }> = {
  master:    { fgColor: { rgb: "FFF1DD" } },
  sub_bom:   { fgColor: { rgb: "EEF4FB" } },
  component: { fgColor: { rgb: "D6EAF8" } },
  plain:     { fgColor: { rgb: "F3F0FC" } },
};

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
  _type: string;
};

type OosRow = {
  SO: string;
  "Main Group": string;
  "Sub Group": string;
  "BOM Path": string;
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
  Deficit: number;
  Unit: string;
};

function extractSideType(name: string): string {
  const setMatch = name.match(/(LH\([^\)]+\)\s*\+\s*RH\([^\)]+\)|LH\([^\)]+\)|RH\([^\)]+\)|TP\([^\)]+\)\s*\+\s*BT\([^\)]+\)|TP\([^\)]+\)|BT\([^\)]+\))/i);
  if (setMatch) return setMatch[1];

  if (/\b(LH\/RH|LH\+RH)\b/i.test(name)) return "LH/RH";
  if (/\b(TP\/BT|TP\+BT|Top\/Bottom)\b/i.test(name)) return "TP/BT";

  if (/\b(LH|LHS)\b/i.test(name)) return "LH";
  if (/\b(RH|RHS)\b/i.test(name)) return "RH";
  if (/\b(TP|Top)\b/i.test(name)) return "TP";
  if (/\b(BT|Bottom)\b/i.test(name)) return "BT";

  return "-";
}

function extractProfileCode(itemName: string): string {
  const upper = itemName.toUpperCase();
  if (upper.includes("SLF") || upper.includes("HM-511") || upper.includes("HM511")) return "SLF";
  if (upper.includes("STP") || upper.includes("HM-509") || upper.includes("HM509")) return "STP";
  if (upper.includes("SINK") || upper.includes("HM-510") || upper.includes("HM510")) return "SINK";
  if (upper.includes("ELEN") || upper.includes("HM-519") || upper.includes("HM519")) return "ELEN";
  if (upper.includes("DBS") || upper.includes("HM-513") || upper.includes("HM513")) return "DBS";
  if (upper.includes("DBC") || upper.includes("HM-535") || upper.includes("HM535")) return "DBC";
  if (upper.includes("MD1")) return "MD1";
  if (upper.includes("MD2")) return "MD2";
  if (upper.includes("MD3")) return "MD3";
  if (upper.includes("CL1")) return "CL1";
  if (upper.includes("CL2")) return "CL2";
  if (upper.includes("CM1")) return "CM1";
  if (upper.includes("CM2")) return "CM2";
  if (upper.includes("NEON")) return "NEON";

  const lastDash = itemName.lastIndexOf("-");
  if (lastDash >= 3) {
    return itemName.substring(lastDash - 3, lastDash).toUpperCase();
  }
  return "";
}

function parseSlabArea(itemName: string): number {
  const match = itemName.match(/(\d{3,4})\s*[xX]\s*(\d{3,4})/);
  if (match) {
    const h = parseFloat(match[1]);
    const w = parseFloat(match[2]);
    return (h * w) / (304.8 * 304.8);
  }
  return 0;
}

function getRawMaterialNameAndSku(
  key: string,
  selectedRawIds: Record<string, string>,
  rawOptionsMap: Record<string, any[]>,
  fallbackName: string,
): { name: string; sku: string; stock: number } {
  const selectedId = selectedRawIds?.[key];
  if (!selectedId) return { name: fallbackName, sku: "-", stock: 0 };
  if (selectedId.startsWith("MOCK_CREATE|")) {
    return { name: selectedId.split("|")[1], sku: "-", stock: 0 };
  }
  const items = rawOptionsMap?.[key] || [];
  const item = items.find((i: any) => i.item_id === selectedId || i.sku === selectedId);
  if (item) {
    return {
      name: item.name || item.item_name || fallbackName,
      sku: item.sku || "-",
      stock: typeof item.stock_on_hand === "number" ? item.stock_on_hand : 0,
    };
  }
  return { name: selectedId, sku: "-", stock: 0 };
}

function classifyRowType(pkType: string): string {
  if (pkType === "panel") return "sub_bom";
  if (pkType === "prof") return "component";
  if (pkType === "hard" || pkType === "cons") return "plain";
  if (pkType === "shut") return "sub_bom";
  if (pkType === "elen_bom") return "sub_bom";
  return "plain";
}

function extractDim(dim: string): { h: string; w: string; d: string; t: string } {
  const parts = dim.replace(/[^0-9xX×\-. ]/g, "").split(/[xX×]/);
  return { h: parts[0] || "", w: parts[1] || "", d: "", t: parts[2] || "" };
}

function subGroupFromPkType(pkType: string, isShutter: boolean): string {
  if (isShutter) return "Shutter";
  if (pkType === "panel") return "Carcass Pack";
  // The "Set of Profile ..." pack wrapper is a Profile Pack (matches the convention used for
  // all other profile sets) — NOT "Profile", so it isn't double-counted in the Opti sheet
  // alongside the actual profile cuts.
  if (pkType === "prof") return "Profile Pack";
  if (pkType === "hard") return "Hardware";
  if (pkType === "cons") return "Consumable";
  if (pkType === "elen_bom") return "Elenor Light";
  return "Carcass";
}

function makeRow(
  so: string, mainGroup: string, subGroup: string, level: number,
  item: string, sku: string, type: string,
  h: string, w: string, d: string, t: string,
  finish: string, cfType: string, soQty: number, waste: number,
  actualQty: number, unit: string, stockMap: Record<string, StockItem>,
  _type: string,
  profileCode: string = "",
): FullBomRow {
  const stock = stockMap[item.trim()]?.stock ?? 0;
  const effStock = stock;
  const deficit = Math.max(0, actualQty - effStock);
  const status = stockMap[item.trim()] ? (deficit <= 0 ? "In Stock" : "Out of Stock") : "Unknown";

  const isStone = item.toLowerCase().includes("stone") ||
                  (subGroup && subGroup.toLowerCase().includes("stone")) ||
                  (mainGroup && mainGroup.toLowerCase().includes("stone"));
  let pcs: number | string = "-";
  if (isStone) {
    const slabArea = parseSlabArea(item);
    if (slabArea > 0) {
      pcs = Math.round((actualQty / slabArea) * 100) / 100;
    } else {
      pcs = "";
    }
  }

  const pCode = profileCode || (subGroup.toLowerCase().includes("profile") ? extractProfileCode(item) : "");

  const cleanItem = item.trim();
  const isHwPack = cleanItem.toLowerCase().includes("hardware pack");
  const finalSubGroup = isHwPack ? "Hardware Pack" : subGroup;

  return {
    SO: so, Elevation: "", "Main Group": mainGroup, "Sub Group": finalSubGroup, Level: level,
    Item: "  ".repeat(level) + item, SKU: sku, Type: extractSideType(item),
    Height: h, Width: w, Depth: d, Thickness: t,
    Finish: finish, Grain: "", "CF Type": cfType,
    "Profile Code": pCode,
    "SO Qty": soQty, "Waste %": waste, "Actual Qty": actualQty,
    Pcs: pcs, "In Stock": stock, "Eff. Stock": effStock,
    Deficit: deficit, Unit: unit, Status: status, _type: _type,
  };
}

function addPanelRow(
  so: string,
  mainGroup: string,
  subGroup: string,
  level: number,
  itemName: string,
  sku: string,
  type: string,
  h: string, w: string, d: string, t: string,
  finish: string,
  cfType: string,
  soQty: number,
  waste: number,
  actualQty: number,
  uom: string,
  stockMap: Record<string, StockItem>,
  _type: string,
  rows: FullBomRow[],
  selectedRawIds: Record<string, string>,
  rawOptionsMap: Record<string, any[]>,
  carcassT?: number
) {
  const panelRow = makeRow(
    so, mainGroup, subGroup, level,
    itemName, sku, type,
    h, w, d, t,
    finish, cfType, soQty, waste, actualQty,
    uom, stockMap, _type
  );
  rows.push(panelRow);

  // Now add the raw material row at level + 1
  let rawKey = "";
  let rawWaste = 0;
  if (mainGroup === "Carcass") {
    rawKey = `carcass|${finish}|${carcassT || t}`;
    rawWaste = 17;
  } else {
    rawKey = `shutter|${finish}|${t || "6"}`;
    rawWaste = 0;
  }

  const { name: rawName, sku: rawSku } = getRawMaterialNameAndSku(
    rawKey, selectedRawIds, rawOptionsMap, `Raw Material ${finish}`
  );

  const panelH = parseFloat(h) || 0;
  const panelW = parseFloat(w) || 0;
  const netSqft = (panelH * panelW) / (304.8 * 304.8);
  const rawSoQty = +(netSqft * soQty).toFixed(3);
  // Raw stone scales with the panel's TOTAL quantity (actualQty), not the per-parent SO qty —
  // otherwise drawer-pack panels (per-drawer qty 1, total = drawer count) and multi-unit
  // projects under-count the stone.
  const rawActualQty = +(netSqft * actualQty * (1 + rawWaste / 100)).toFixed(3);

  const rawRow = makeRow(
    so, mainGroup, "Raw Material", level + 1,
    rawName, rawSku, "-",
    "", "", "", t,
    finish, itemName, rawSoQty, rawWaste, rawActualQty,
    "sqft", stockMap, "plain"
  );
  rows.push(rawRow);
}

function addProfilePanelAndRawRow(
  so: string,
  parentGroup: "Carcass" | "Shutters",
  level: number,
  pPanelName: string,
  skuSuffix: string,
  len: number,
  qty: number,
  finish: string,
  parentRef: string,
  stockMap: Record<string, StockItem>,
  profileCode: string,
  selectedRawIds: Record<string, string>,
  rawOptionsMap: Record<string, any[]>,
  q: number,
  items: FullBomRow[]
) {
  const panelRow = makeRow(so, parentGroup, "Profile", level,
    pPanelName, pPanelName + skuSuffix, "component",
    String(len), "", "", "",
    finish, parentRef, qty, 0, +(qty * q).toFixed(3), "pcs", stockMap, "component", profileCode);
  items.push(panelRow);

  const prefix = parentGroup === "Carcass" ? "carcass" : "shutter";
  const profileKey = `${prefix}|${profileCode}|${finish}`;

  const defaultFallback = profileCode === "HM-504"
    ? `ALU FILLER PROFILE HM-504 SIZE 76X8.2 WITH ANODISED ${finish.toUpperCase()} 3 MTR W 0.75 KG/MTR MINA`
    : `Raw Profile ${profileCode} ${finish}`;

  const { name: rawName, sku: rawSku } = getRawMaterialNameAndSku(
    profileKey, selectedRawIds, rawOptionsMap, defaultFallback
  );

  const lenMeters = len / 1000;
  const rawSoQty = +(lenMeters * qty).toFixed(3);
  const profileWaste = profileCode.toUpperCase() === "ELEN" ? 20 : 25;
  const rawActualQty = +(rawSoQty * (1 + profileWaste / 100) * q).toFixed(3);

  const rawRow = makeRow(so, parentGroup, "Raw Material", level + 1,
    rawName, rawSku, "-",
    "", "", "", "",
    finish, pPanelName, rawSoQty, profileWaste, rawActualQty,
    "mtr", stockMap, "plain", profileCode
  );
  items.push(rawRow);
}

// Linear light component (profile / LED / diffuser) as a cut-to-size BOM: a cut piece (lands
// in the Opti sheet) over a raw 3-mtr stock child (Sub Group "Raw Material" → excluded from
// Opti). Used by the Elenor light and the countertop band light. `rawName` is the catalog
// 3-mtr item name; `len` is the cut length (mm).
function addLightCutRow(
  so: string,
  parentGroup: string,
  level: number,
  rawName: string,
  cutLabel: string,
  len: number,
  pieceQty: number,
  finish: string,
  parentRef: string,
  stockMap: Record<string, StockItem>,
  items: FullBomRow[],
  q: number,
  waste: number = 0,
) {
  const cutName = `${cutLabel} Cut ${len}mm`;
  items.push(makeRow(so, parentGroup, "Profile", level,
    cutName, cutName, "component",
    String(len), "", "", "",
    finish, parentRef, pieceQty, 0, +(pieceQty * q).toFixed(3),
    "Pcs", stockMap, "component"));
  const lenMeters = len / 1000;
  const rawSoQty = +(lenMeters * pieceQty).toFixed(3);
  const rawActualQty = +(rawSoQty * (1 + waste) * q).toFixed(3);
  items.push(makeRow(so, parentGroup, "Raw Material", level + 1,
    rawName, rawName, "-",
    "", "", "", "",
    finish, cutName, rawSoQty, waste * 100, rawActualQty,
    "Mtr", stockMap, "plain"));
}

function addHardwareRow(
  so: string,
  mainGroup: string,
  subGroup: string,
  level: number,
  itemName: string,
  sku: string,
  type: string,
  h: string, w: string, d: string, t: string,
  finish: string,
  cfType: string,
  soQty: number,
  waste: number,
  actualQty: number,
  uom: string,
  stockMap: Record<string, StockItem>,
  _type: string,
  rows: FullBomRow[]
) {
  const hwRow = makeRow(
    so, mainGroup, subGroup, level,
    itemName, sku, type,
    h, w, d, t,
    finish, cfType, soQty, waste, actualQty,
    uom, stockMap, _type
  );
  rows.push(hwRow);

  const def = HARDWARE_PACK_DEFINITIONS[itemName];
  if (def) {
    def.forEach((comp) => {
      const compSoQty = +(comp.qty * soQty).toFixed(3);
      const compActualQty = +(comp.qty * actualQty).toFixed(3);
      const compRow = makeRow(
        so, mainGroup, "Hardware", level + 1,
        comp.component, comp.component, "plain",
        "", "", "", "",
        "", itemName, compSoQty, 0, compActualQty,
        comp.uom.toLowerCase(), stockMap, "plain"
      );
      rows.push(compRow);
    });
  }
}

function buildProfileBomRows(
  so: string,
  profileCode: string,
  finish: string,
  lengths: Array<{ len: number; qty: number; name: string }>,
  skuSuffix: string,
  stockMap: Record<string, StockItem>,
  parentGroup: "Carcass" | "Shutters",
  subGroup: string,
  q: number,
  parentName: string,
  selectedRawIds: Record<string, string>,
  rawOptionsMap: Record<string, any[]>,
  vDrill?: { lh: string; rh: string }
): FullBomRow[] {
  const noDrill = NO_DRILL_PROFILES.has(profileCode.toUpperCase());
  const rows: FullBomRow[] = [];
  // Optional per-side drill labels (e.g. cabinet LH/RH codes "2HB", "BPO", "JD").
  // When provided, the vertical profile parts/sets are tagged so the shutter
  // profile drilling mirrors the carcass side-panel drilling.
  const lhTag = vDrill ? `(${vDrill.lh})` : "";
  const rhTag = vDrill ? `(${vDrill.rh})` : "";
  const vSideLabel = vDrill ? `LH${lhTag}+RH${rhTag}` : "(LH/RH)";

  const verticalChildren: Array<{ name: string; qty: number; len: number; items?: FullBomRow[] }> = [];
  const horizontalChildren: Array<{ name: string; qty: number; len: number; items?: FullBomRow[] }> = [];
  const otherChildren: Array<{ name: string; qty: number; len: number; items?: FullBomRow[] }> = [];

  for (const { len, qty, name } of lengths) {
    const isVertical = /(^|\s|\()(V|vertical|LH[+/]RH|LH|RH|ELEN)(\s|\)|$)/i.test(name);
    const isHorizontal = /(^|\s|\()(H|horizontal|TP[+/]BT|TP|BT|edge)(\s|\)|$)/i.test(name);

    const cleanedNameForPart = name
      .replace(/(LH[+/]RH|TP[+/]BT)/gi, "")
      .replace(/\b(V|H|LH|RH|TP|BT|Top|Bottom|vertical|horizontal|edge)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    const cleanedNameForPanel = name
      .replace(/\b(V|H|Top|Bottom|vertical|horizontal|edge)\b/gi, "")
      .replace(/LH\+RH/gi, "LH/RH")
      .replace(/TP\+BT/gi, "TP/BT")
      .replace(/\s+/g, " ")
      .trim();

    const pPanelName = `${cleanedNameForPanel} ${len}mm ${finish}`;

    if (noDrill) {
      // Level 3 Panel goes directly to Set of Profile (Level 2)
      const items: FullBomRow[] = [];
      addProfilePanelAndRawRow(
        so, parentGroup, 3, pPanelName, skuSuffix, len, qty,
        finish, "", stockMap, profileCode, selectedRawIds, rawOptionsMap, q, items
      );

      if (isVertical) {
        verticalChildren.push({ name: pPanelName, qty, len, items });
      } else if (isHorizontal) {
        horizontalChildren.push({ name: pPanelName, qty, len, items });
      } else {
        otherChildren.push({ name: pPanelName, qty, len, items });
      }
    } else {
      // Drill profiles: Part wrapper (Level 3) + Panel (Level 4)
      if (qty === 2 && (isVertical || isHorizontal)) {
        if (isVertical) {
          const lhBase = `Part Profile LH${lhTag} ${cleanedNameForPart} ${len}mm ${finish}`.replace(/\s+/g, " ").trim();
          const rhBase = `Part Profile RH${rhTag} ${cleanedNameForPart} ${len}mm ${finish}`.replace(/\s+/g, " ").trim();

          const lhRow = makeRow(so, parentGroup, "Profile - Part", 3,
            lhBase, lhBase + skuSuffix, "sub_bom",
            String(len), "", "", "",
            finish, "", 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "sub_bom");

          const rhRow = makeRow(so, parentGroup, "Profile - Part", 3,
            rhBase, rhBase + skuSuffix, "sub_bom",
            String(len), "", "", "",
            finish, "", 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "sub_bom");

          const lhItems: FullBomRow[] = [lhRow];
          addProfilePanelAndRawRow(
            so, parentGroup, 4, pPanelName, skuSuffix, len, 1,
            finish, lhBase, stockMap, profileCode, selectedRawIds, rawOptionsMap, q, lhItems
          );

          const rhItems: FullBomRow[] = [rhRow];
          addProfilePanelAndRawRow(
            so, parentGroup, 4, pPanelName, skuSuffix, len, 1,
            finish, rhBase, stockMap, profileCode, selectedRawIds, rawOptionsMap, q, rhItems
          );

          verticalChildren.push({ name: lhBase, qty: 1, len, items: lhItems });
          verticalChildren.push({ name: rhBase, qty: 1, len, items: rhItems });
        } else {
          const topBase = `Part Profile Top ${cleanedNameForPart} ${len}mm ${finish}`;
          const btmBase = `Part Profile Bottom ${cleanedNameForPart} ${len}mm ${finish}`;

          const topRow = makeRow(so, parentGroup, "Profile - Part", 3,
            topBase, topBase + skuSuffix, "sub_bom",
            String(len), "", "", "",
            finish, "", 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "sub_bom");

          const btmRow = makeRow(so, parentGroup, "Profile - Part", 3,
            btmBase, btmBase + skuSuffix, "sub_bom",
            String(len), "", "", "",
            finish, "", 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "sub_bom");

          const topItems: FullBomRow[] = [topRow];
          addProfilePanelAndRawRow(
            so, parentGroup, 4, pPanelName, skuSuffix, len, 1,
            finish, topBase, stockMap, profileCode, selectedRawIds, rawOptionsMap, q, topItems
          );

          const btmItems: FullBomRow[] = [btmRow];
          addProfilePanelAndRawRow(
            so, parentGroup, 4, pPanelName, skuSuffix, len, 1,
            finish, btmBase, stockMap, profileCode, selectedRawIds, rawOptionsMap, q, btmItems
          );

          horizontalChildren.push({ name: topBase, qty: 1, len, items: topItems });
          horizontalChildren.push({ name: btmBase, qty: 1, len, items: btmItems });
        }
      } else {
        const partBase = `Part Profile ${cleanedNameForPart} ${len}mm ${finish}`;
        const partRow = makeRow(so, parentGroup, "Profile - Part", 3,
          partBase, partBase + skuSuffix, "sub_bom",
          String(len), "", "", "",
          finish, "", qty, 0, +(qty * q).toFixed(3), "pcs", stockMap, "sub_bom");

        const partItems: FullBomRow[] = [partRow];
        addProfilePanelAndRawRow(
          so, parentGroup, 4, pPanelName, skuSuffix, len, 1,
          finish, partBase, stockMap, profileCode, selectedRawIds, rawOptionsMap, q, partItems
        );

        otherChildren.push({ name: partBase, qty, len, items: partItems });
      }
    }
  }

  const subSets: Array<{ name: string; items: FullBomRow[] }> = [];

  if (noDrill) {
    if (verticalChildren.length > 0) {
      const base = `Set of Profile ${profileCode} ${finish} ${vSideLabel}`;
      const subId = base + skuSuffix;
      const setRow = makeRow(so, parentGroup, "Profile Pack", 2,
        base, subId, "sub_bom",
        "", "", "", "",
        finish, parentName, 1, 0, +(1 * q).toFixed(3), "set", stockMap, "sub_bom");

      const childrenRows = verticalChildren.flatMap(c => {
        if (c.items) {
          c.items[0]["CF Type"] = base;
          return c.items;
        }
        return [];
      });
      subSets.push({ name: base, items: [setRow, ...childrenRows] });
    }
    if (horizontalChildren.length > 0) {
      const base = `Set of Profile ${profileCode} ${finish} (TP/BT)`;
      const subId = base + skuSuffix;
      const setRow = makeRow(so, parentGroup, "Profile Pack", 2,
        base, subId, "sub_bom",
        "", "", "", "",
        finish, parentName, 1, 0, +(1 * q).toFixed(3), "set", stockMap, "sub_bom");

      const childrenRows = horizontalChildren.flatMap(c => {
        if (c.items) {
          c.items[0]["CF Type"] = base;
          return c.items;
        }
        return [];
      });
      subSets.push({ name: base, items: [setRow, ...childrenRows] });
    }
    if (otherChildren.length > 0) {
      const base = `Set of Profile ${profileCode} ${finish}`;
      const subId = base + skuSuffix;
      const setRow = makeRow(so, parentGroup, "Profile Pack", 2,
        base, subId, "sub_bom",
        "", "", "", "",
        finish, parentName, 1, 0, +(1 * q).toFixed(3), "set", stockMap, "sub_bom");

      const childrenRows = otherChildren.flatMap(c => {
        if (c.items) {
          c.items[0]["CF Type"] = base;
          return c.items;
        }
        return [];
      });
      subSets.push({ name: base, items: [setRow, ...childrenRows] });
    }

    if (subSets.length > 1) {
      const parentBase = `Set of Profile ${profileCode} ${finish} ${vDrill ? `${vSideLabel}+TP/BT` : "LH/RH+TP/BT"}`;
      const parentId = parentBase + skuSuffix;
      const parentRow = makeRow(so, parentGroup, "Profile Pack", 2,
        parentBase, parentId, "sub_bom",
        "", "", "", "",
        finish, parentName, 1, 0, +(1 * q).toFixed(3), "set", stockMap, "sub_bom");

      rows.push(parentRow);
      subSets.forEach(s => {
        let lastPanelLevel = 3;
        s.items.forEach((item, idx) => {
          if (idx === 0) {
            item.Level = 3;
            item["CF Type"] = parentBase;
            lastPanelLevel = 3;
          } else {
            if (item.Unit === "mtr" || item["Sub Group"] === "Raw Material") {
              item.Level = lastPanelLevel + 1;
            } else {
              item.Level = 4;
              lastPanelLevel = 4;
            }
          }
        });
        rows.push(...s.items);
      });
    } else if (subSets.length === 1) {
      rows.push(...subSets[0].items);
    }
  } else {
    if (verticalChildren.length > 0) {
      const base = `Set of Profile Parts ${profileCode} ${finish} ${vSideLabel}`;
      const subId = base + skuSuffix;
      const setRow = makeRow(so, parentGroup, "Profile Pack", 2,
        base, subId, "sub_bom",
        "", "", "", "",
        finish, parentName, 1, 0, +(1 * q).toFixed(3), "set", stockMap, "sub_bom");
      rows.push(setRow);

      verticalChildren.forEach(c => {
        if (c.items) {
          c.items.forEach(item => {
            if (item.Level === 3) item["CF Type"] = base;
          });
          rows.push(...c.items);
        }
      });
    }
    if (horizontalChildren.length > 0) {
      const base = `Set of Profile Parts ${profileCode} ${finish} (TP/BT)`;
      const subId = base + skuSuffix;
      const setRow = makeRow(so, parentGroup, "Profile Pack", 2,
        base, subId, "sub_bom",
        "", "", "", "",
        finish, parentName, 1, 0, +(1 * q).toFixed(3), "set", stockMap, "sub_bom");
      rows.push(setRow);

      horizontalChildren.forEach(c => {
        if (c.items) {
          c.items.forEach(item => {
            if (item.Level === 3) item["CF Type"] = base;
          });
          rows.push(...c.items);
        }
      });
    }
    if (otherChildren.length > 0) {
      const base = `Set of Profile Parts ${profileCode} ${finish}`;
      const subId = base + skuSuffix;
      const setRow = makeRow(so, parentGroup, "Profile Pack", 2,
        base, subId, "sub_bom",
        "", "", "", "",
        finish, parentName, 1, 0, +(1 * q).toFixed(3), "set", stockMap, "sub_bom");
      rows.push(setRow);

      otherChildren.forEach(c => {
        if (c.items) {
          c.items.forEach(item => {
            if (item.Level === 3) item["CF Type"] = base;
          });
          rows.push(...c.items);
        }
      });
    }
  }

  return rows;
}

function getDrawerCount(packName: string, panels: Panel[]): number {
  // Drawer Box panels now live in the same Drawer Pack composite. Legacy Pullout
  // Shelf packs (defensive) still keep their panels in a separate Set of Parts.
  const searchName = packName.includes("Pullout Shelf")
    ? packName.replace("Drawer Pack-", "Set of Parts-")
    : packName;
  const matchedPanels = panels.filter(p => p.pack.startsWith(searchName));
  if (packName.includes("Pullout Shelf")) {
    const basePanel = matchedPanels.find(p => p.name.toLowerCase().includes("base"));
    return basePanel ? basePanel.qty : 4;
  }
  const backPanel = matchedPanels.find(p => p.name.toLowerCase().includes("back"));
  return backPanel ? backPanel.qty : 1;
}

function buildFullBomData(
  project: ProjectLine[],
  soNumber: string,
  stockMap: Record<string, StockItem>,
  selectedRawIds: Record<string, string> = {},
  rawOptionsMap: Record<string, any[]> = {},
  fillers: FillerRow[] = [],
  visiblePanels: VisiblePanelRow[] = [],
  backsplashes: BacksplashRow[] = [],
  countertops: CountertopRow[] = [],
  getDefaultShutterShadeForZone: (zk: string) => string = () => "STATUARIO",
  getDefaultShutterHeightForZone: (zk: string) => number = () => 715,
  getDefaultCabinetDepthForZone: (zk: string) => number = () => 560,
  getShutterProfileForZone: (zk: string) => string = () => "MD1",
  getProfileColorForZone: (zk: string) => string = () => "CHAMPAGNE"
): FullBomRow[] {
  const rows: FullBomRow[] = [];
  const so = soNumber;
  const skuSuffix = so && so !== "Project" && so !== "DRAFT" ? "-" + so : "";

  project.forEach((l) => {
    const m = l.m;
    const q = l.qty;
    const zone = m.code.split("-")[0];
    const zoneName = ZONES[zone]?.name || zone;
    const cFinish = m.carcassMat || m.mat;
    const sFinish = m.shutterMat || m.mat;
    const _elevStart = rows.length;

    // Level 0: Cabinet master
    rows.push(makeRow(so, "Carcass", "Carcass", 0,
      m.code, m.code + skuSuffix, "master",
      String(m.H), String(m.W), String(m.D), String(m.t),
      cFinish, zoneName + " " + (m.sn || ""), q, 0, q, "pcs", {}, "master"));

    // Build lookup: which panels/profiles belong to which pack
    // pack field on Panel/Profile has dimensions appended (e.g. "Set of Parts- ... 690x560x15")
    // pkRow name may not include dimensions, so we match by checking if pack starts with pkRow name
    const panelsByPack: Record<string, typeof m.panels> = {};
    m.panels.forEach((p) => {
      (panelsByPack[p.pack] ??= []).push(p);
    });
    const profilesByPack: Record<string, typeof m.profiles> = {};
    m.profiles.forEach((p) => {
      (profilesByPack[p.pack] ??= []).push(p);
    });
    // Also build by-cons lookup for consumables that have a specific pack parent (e.g. Stepper Silicone → Back Wall pack)
    const consByPack: Record<string, typeof m.cons> = {};
    m.cons.forEach((c) => {
      if (c.pack && c.pack !== "Consumable" && c.pack !== "Assembly Glue") {
        (consByPack[c.pack] ??= []).push(c);
      }
    });

    // Helper: find children matching a pkRow name (panels/profiles may have extra dim suffix in pack)
    const findPanelsForPk = (pkName: string) => {
      // Exact match first
      if (panelsByPack[pkName]) return panelsByPack[pkName];
      // Prefix match: panel.pack starts with pkRow name
      return m.panels.filter((p) => p.pack.startsWith(pkName));
    };
    const findProfilesForPk = (pkName: string) => {
      if (profilesByPack[pkName]) return profilesByPack[pkName];
      return m.profiles.filter((p) => p.pack.startsWith(pkName));
    };
    const findConsForPk = (pkName: string) => {
      if (consByPack[pkName]) return consByPack[pkName];
      return m.cons.filter((c) => c.pack && c.pack.startsWith(pkName));
    };

    // Level 1: pkRows (carcass packs) — each with its Level 2 children nested underneath
    m.pkRows.forEach(([pkType, name, dim, qty, uom]) => {
      if (pkType === "shut" || pkType === "hard" || pkType === "cons") return; // shutters, hardware, and consumables handled separately below



      const subGroup = subGroupFromPkType(pkType, false);
      const rowType = classifyRowType(pkType);
      const parsed = extractDim(dim);
      const actualQty = +(qty * q).toFixed(3);

      // Level 1: the pack itself
      rows.push(makeRow(so, "Carcass", subGroup, 1,
        name, name + skuSuffix, rowType,
        parsed.h, parsed.w, parsed.d, parsed.t,
        cFinish, subGroup, qty, 0, actualQty, uom.toLowerCase(), stockMap, rowType));

      // Drawer Box pack — single composite (Level 1 qty = drawer count). Children carry
      // per-drawer consumption: back panel keeps its Part/JD drill, bottom panel is flat,
      // side profile DBS keeps the Set of Profile Parts (LH/RH) wrapper, center profile DBC
      // is flat like the bottom panel, and the runner hardware sits flat under the pack.
      if (pkType === "panel" && name.startsWith("Drawer Pack- Cab Drawer Box")) {
        const dCount = getDrawerCount(name, m.panels) || 1;
        const qN = q * dCount; // makes profile children explode to per-drawer × drawer count

        findPanelsForPk(name).forEach((p) => {
          const perDrawerQty = +(p.qty / dCount).toFixed(3);
          const pActual = +(p.qty * q).toFixed(3);
          const pt = p.t || m.t;
          const hasDrill = p.drill && p.drill.trim() !== "" && p.drill.trim().toLowerCase() !== "no drill";

          if (hasDrill) {
            const partName = getPartBaseName(p.name, p.drill, cFinish);
            rows.push(makeRow(so, "Carcass", "Part Cab", 2,
              partName, partName + skuSuffix, "sub_bom",
              String(p.h), String(p.w), "", String(pt),
              cFinish, p.pack, perDrawerQty, 0, pActual, "pcs", stockMap, "sub_bom"));

            const panelItemName = getPanelBaseName(p.name, null, cFinish);
            addPanelRow(so, "Carcass", "Panels- Cab", 3,
              panelItemName, panelItemName + skuSuffix, "component",
              String(p.h), String(p.w), "", String(pt),
              cFinish, partName, 1, 0, pActual, "pcs", stockMap, "component",
              rows, selectedRawIds, rawOptionsMap, pt);
          } else {
            const panelItemName = getPanelBaseName(p.name, null, cFinish);
            addPanelRow(so, "Carcass", "Panels- Cab", 2,
              panelItemName, panelItemName + skuSuffix, "component",
              String(p.h), String(p.w), "", String(pt),
              cFinish, p.pack, perDrawerQty, 0, pActual, "pcs", stockMap, "component",
              rows, selectedRawIds, rawOptionsMap, pt);
          }
        });

        const drawerProfFinish = m.carcassProfileColor || cFinish;
        findProfilesForPk(name).forEach((p) => {
          const perDrawerQty = +(p.qty / dCount).toFixed(3);
          if (p.type === "DBC") {
            const items: FullBomRow[] = [];
            addProfilePanelAndRawRow(
              so, "Carcass", 2, p.name, skuSuffix, p.len, perDrawerQty,
              drawerProfFinish, name, stockMap, p.type, selectedRawIds, rawOptionsMap, qN, items
            );
            rows.push(...items);
          } else {
            const profileRows = buildProfileBomRows(
              so, p.type, drawerProfFinish,
              [{ len: p.len, qty: perDrawerQty, name: p.name }],
              skuSuffix, stockMap, "Carcass", subGroup, qN,
              name, selectedRawIds, rawOptionsMap
            );
            rows.push(...profileRows);
          }
        });

        m.hardware.forEach((h) => {
          if (h.pack !== name) return;
          const perDrawerQty = +(h.qty / dCount).toFixed(3);
          const hActual = +(h.qty * q).toFixed(3);
          addHardwareRow(so, "Carcass", "Hardware", 2,
            h.name, h.name, "component",
            "", "", "", "",
            "", name, perDrawerQty, 0, hActual, "set", stockMap, "component", rows);
        });

        return;
      }

      // Level 2: panels that belong to this pack — wrapped with Part level to match Zoho inventory structure
      if (pkType === "panel") {
        const matchedPanels = findPanelsForPk(name);
        matchedPanels.forEach((p) => {
          const hasDrill = p.drill && p.drill.trim() !== "" && p.drill.trim().toLowerCase() !== "no drill";

          if (hasDrill) {
            const isCombinedSide = /LH\/RH|LH\+RH/i.test(p.name);
            const isCombinedDir = /TP\/BT|Top\/Bottom|TP\+BT/i.test(p.name);

            if (isCombinedSide) {
              let lhDrill = p.drill;
              let rhDrill = p.drill;
              if (p.drill && p.drill.includes("/")) {
                const parts = p.drill.split("/");
                if (parts.length === 2) {
                  lhDrill = parts[0].trim();
                  rhDrill = parts[1].trim();
                }
              }
              const lhName = p.name.replace(/LH\/RH|LH\+RH/gi, "LH");
              const rhName = p.name.replace(/LH\/RH|LH\+RH/gi, "RH");

              // LH Part & Panel (maps to common raw panel)
              const partLhName = getPartBaseName(lhName, lhDrill, cFinish);
              const pActualHalf = +((p.qty / 2) * q).toFixed(3);
              rows.push(makeRow(so, "Carcass", "Part Cab", 2,
                partLhName, partLhName + skuSuffix, "sub_bom",
                String(p.h), String(p.w), "", String(m.t),
                cFinish, p.pack, p.qty / 2, 0, pActualHalf, "pcs", stockMap, "sub_bom"));

              const panelCommonName = getPanelBaseName(p.name, null, cFinish);
              addPanelRow(so, "Carcass", "Panels- Cab", 3,
                panelCommonName, panelCommonName + skuSuffix, "component",
                String(p.h), String(p.w), "", String(m.t),
                cFinish, partLhName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "component",
                rows, selectedRawIds, rawOptionsMap, m.t);

              // RH Part & Panel (maps to common raw panel)
              const partRhName = getPartBaseName(rhName, rhDrill, cFinish);
              rows.push(makeRow(so, "Carcass", "Part Cab", 2,
                partRhName, partRhName + skuSuffix, "sub_bom",
                String(p.h), String(p.w), "", String(m.t),
                cFinish, p.pack, p.qty / 2, 0, pActualHalf, "pcs", stockMap, "sub_bom"));

              addPanelRow(so, "Carcass", "Panels- Cab", 3,
                panelCommonName, panelCommonName + skuSuffix, "component",
                String(p.h), String(p.w), "", String(m.t),
                cFinish, partRhName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "component",
                rows, selectedRawIds, rawOptionsMap, m.t);

            } else if (isCombinedDir) {
              const tpTag = p.name.toLowerCase().includes("top") ? "Top" : "TP";
              const btTag = p.name.toLowerCase().includes("bottom") ? "Bottom" : "BT";
              const tpName = p.name.replace(/TP\/BT|Top\/Bottom|TP\+BT/gi, tpTag);
              const btName = p.name.replace(/TP\/BT|Top\/Bottom|TP\+BT/gi, btTag);

              // Common raw Panel name
              const panelCommonName = getPanelBaseName(p.name, null, cFinish);

              // TP Part & Panel (maps to common raw panel)
              const partTpName = getPartBaseName(tpName, p.drill, cFinish);
              const pActualHalf = +((p.qty / 2) * q).toFixed(3);
              rows.push(makeRow(so, "Carcass", "Part Cab", 2,
                partTpName, partTpName + skuSuffix, "sub_bom",
                String(p.h), String(p.w), "", String(m.t),
                cFinish, p.pack, p.qty / 2, 0, pActualHalf, "pcs", stockMap, "sub_bom"));

              addPanelRow(so, "Carcass", "Panels- Cab", 3,
                panelCommonName, panelCommonName + skuSuffix, "component",
                String(p.h), String(p.w), "", String(m.t),
                cFinish, partTpName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "component",
                rows, selectedRawIds, rawOptionsMap, m.t);

              // BT Part & Panel (maps to common raw panel)
              const partBtName = getPartBaseName(btName, p.drill, cFinish);
              rows.push(makeRow(so, "Carcass", "Part Cab", 2,
                partBtName, partBtName + skuSuffix, "sub_bom",
                String(p.h), String(p.w), "", String(m.t),
                cFinish, p.pack, p.qty / 2, 0, pActualHalf, "pcs", stockMap, "sub_bom"));

              addPanelRow(so, "Carcass", "Panels- Cab", 3,
                panelCommonName, panelCommonName + skuSuffix, "component",
                String(p.h), String(p.w), "", String(m.t),
                cFinish, partBtName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "component",
                rows, selectedRawIds, rawOptionsMap, m.t);

            } else {
              const pActual = +(p.qty * q).toFixed(3);
              const partName = getPartBaseName(p.name, p.drill, cFinish);
              rows.push(makeRow(so, "Carcass", "Part Cab", 2,
                partName, partName + skuSuffix, "sub_bom",
                String(p.h), String(p.w), "", String(m.t),
                cFinish, p.pack, p.qty, 0, pActual, "pcs", stockMap, "sub_bom"));

              const panelItemName = getPanelBaseName(p.name, null, cFinish);
              addPanelRow(so, "Carcass", "Panels- Cab", 3,
                panelItemName, panelItemName + skuSuffix, "component",
                String(p.h), String(p.w), "", String(m.t),
                cFinish, partName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "component",
                rows, selectedRawIds, rawOptionsMap, m.t);
            }
          } else {
            const pActual = +(p.qty * q).toFixed(3);
            const panelItemName = getPanelBaseName(p.name, null, cFinish);
            addPanelRow(so, "Carcass", "Panels- Cab", 2,
              panelItemName, panelItemName + skuSuffix, "component",
              String(p.h), String(p.w), "", String(m.t),
              cFinish, p.pack, p.qty, 0, pActual, "pcs", stockMap, "component",
              rows, selectedRawIds, rawOptionsMap, m.t);
          }
        });
        // Profiles under this pack — grouped by type and resolved with buildProfileBomRows
        const matchedProfiles = findProfilesForPk(name);
        const carcassProfsByType: Record<string, typeof matchedProfiles> = {};
        matchedProfiles.forEach((p) => {
          (carcassProfsByType[p.type] ??= []).push(p);
        });

        for (const [pType, profsList] of Object.entries(carcassProfsByType)) {
          const profFinish = m.carcassProfileColor || cFinish;
          const profileRows = buildProfileBomRows(
            so,
            pType,
            profFinish,
            profsList.map((p) => ({ len: p.len, qty: p.qty, name: p.name })),
            skuSuffix,
            stockMap,
            "Carcass",
            subGroup,
            q,
            name, // Pack Name is the parent
            selectedRawIds,
            rawOptionsMap
          );
          rows.push(...profileRows);
        }
        // Consumables under this pack (e.g. Stepper Silicone under Back Wall pack)
        const matchedCons = findConsForPk(name);
        matchedCons.forEach((c) => {
          const cActual = +(c.qty * q).toFixed(3);
          rows.push(makeRow(so, "Carcass", "Consumable", 2,
            c.name, c.name, "plain",
            "", "", "", "",
            "", c.pack || "Consumable", c.qty, 0, cActual, c.uom.toLowerCase(), stockMap, "plain"));
        });
      }

      // Level 2: profiles that belong to profile packs — grouped by type and resolved with buildProfileBomRows
      if (pkType === "prof") {
        const matchedProfiles = findProfilesForPk(name);
        const carcassProfsByType: Record<string, typeof matchedProfiles> = {};
        matchedProfiles.forEach((p) => {
          (carcassProfsByType[p.type] ??= []).push(p);
        });

        for (const [pType, profsList] of Object.entries(carcassProfsByType)) {
          const profFinish = m.carcassProfileColor || cFinish;
          const profileRows = buildProfileBomRows(
            so,
            pType,
            profFinish,
            profsList.map((p) => ({ len: p.len, qty: p.qty, name: p.name })),
            skuSuffix,
            stockMap,
            "Carcass",
            subGroup,
            q,
            name, // Pack Name is the parent
            selectedRawIds,
            rawOptionsMap
          );
          rows.push(...profileRows);
        }
      }

      // Elenor with Light composite — nest ALL children (profiles + cons + hardware).
      // Profile, LED and diffuser are all cut-to-size pieces of the SAME length (the Elenor
      // profile length = cabinet side height) at qty 2, named with the cut size, over their
      // raw 3-mtr stock (excluded from Opti). Tape/wire stay flat consumables.
      if (pkType === "elen_bom") {
        const elenProfFinish = m.carcassProfileColor || cFinish;
        // Level 2: Profile cut piece (named with the cut size, not the raw 3-mtr stock).
        const matchedProfiles = findProfilesForPk(name);
        const elenCutLen = matchedProfiles.find((p) => p.type === "ELEN")?.len || matchedProfiles[0]?.len || 0;
        matchedProfiles.forEach((p) => {
          addLightCutRow(so, "Carcass", 2, p.name, "Profile Elenor (HM-519)", p.len, p.qty,
            elenProfFinish, name, stockMap, rows, q, ELENOR_WASTE);
        });
        // Level 2: LED + diffuser → 2 cut pieces of the Elenor length (NOT one double-length cut).
        const matchedCons = findConsForPk(name);
        matchedCons.forEach((c) => {
          const isLinear = /\bLED\b|DIFFUSER/i.test(c.name);
          if (isLinear) {
            const label = /DIFFUSER/i.test(c.name) ? "Diffuser" : "LED Light";
            addLightCutRow(so, "Carcass", 2, c.name, label, elenCutLen, 2,
              elenProfFinish, name, stockMap, rows, q, ELENOR_WASTE);
          } else {
            const cActual = +(c.qty * q).toFixed(3);
            rows.push(makeRow(so, "Carcass", "Consumable", 2,
              c.name, c.name, "component",
              "", "", "", "",
              "", name, c.qty, 0, cActual, c.uom.toLowerCase(), stockMap, "component"));
          }
        });
        // Level 2: Hardware components under this composite
        m.hardware.forEach((h) => {
          if (h.pack === name || (h.pack && h.pack.startsWith("Elenor with Light"))) {
            const hActual = +(h.qty * q).toFixed(3);
            addHardwareRow(so, "Carcass", "Hardware", 2,
              h.name, h.name, "component",
              "", "", "", "",
              "", name, h.qty, 0, hActual, (h.uom || "set").toLowerCase(), stockMap, "component", rows);
          }
        });
      }
    });

    // Collect all pkRow names for orphan detection (panels/profiles not matched to any pack)
    const elenPkNames = m.pkRows.filter(([t]) => t === "elen_bom").map(([, n]) => n);
    const allPkNames = m.pkRows.filter(([t]) => t === "panel" || t === "prof" || t === "elen_bom").map(([, n]) => n);
    const isMatchedPanel = (p: Panel) => allPkNames.some((pk) => p.pack === pk || p.pack.startsWith(pk));
    const isMatchedProfile = (p: Profile) => allPkNames.some((pk) => p.pack === pk || p.pack.startsWith(pk));
    const isMatchedCons = (c: Consumable) => {
      if (!c.pack || c.pack === "Consumable" || c.pack === "Assembly Glue") return false;
      return allPkNames.some((pk) => c.pack === pk || c.pack.startsWith(pk));
    };
    const isMatchedHardware = (h: Hardware) => {
      if (h.pack && h.pack.startsWith("Drawer Pack- Cab Drawer Box")) return true; // nested under drawer pack
      return elenPkNames.some((pk) => h.pack === pk || (h.pack && h.pack.startsWith("Elenor with Light")));
    };

    // Orphan panels — not matched to any pack (still get Part wrapper per Zoho logic if drilled)
    m.panels.forEach((p) => {
      if (!isMatchedPanel(p)) {
        const hasDrill = p.drill && p.drill.trim() !== "" && p.drill.trim().toLowerCase() !== "no drill";

        if (hasDrill) {
          const isCombinedSide = /LH\/RH|LH\+RH/i.test(p.name);
          const isCombinedDir = /TP\/BT|Top\/Bottom|TP\+BT/i.test(p.name);

          if (isCombinedSide) {
            let lhDrill = p.drill;
            let rhDrill = p.drill;
            if (p.drill && p.drill.includes("/")) {
              const parts = p.drill.split("/");
              if (parts.length === 2) {
                lhDrill = parts[0].trim();
                rhDrill = parts[1].trim();
              }
            }
            const lhName = p.name.replace(/LH\/RH|LH\+RH/gi, "LH");
            const rhName = p.name.replace(/LH\/RH|LH\+RH/gi, "RH");

            // LH Part & Panel (maps to common raw panel)
            const partLhName = getPartBaseName(lhName, lhDrill, cFinish);
            const pActualHalf = +((p.qty / 2) * q).toFixed(3);
            rows.push(makeRow(so, "Carcass", "Part Cab", 1,
              partLhName, partLhName + skuSuffix, "sub_bom",
              String(p.h), String(p.w), "", String(m.t),
              cFinish, p.pack, p.qty / 2, 0, pActualHalf, "pcs", stockMap, "sub_bom"));

            const panelCommonName = getPanelBaseName(p.name, null, cFinish);
            addPanelRow(so, "Carcass", "Panels- Cab", 2,
              panelCommonName, panelCommonName + skuSuffix, "component",
              String(p.h), String(p.w), "", String(m.t),
              cFinish, partLhName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "component",
              rows, selectedRawIds, rawOptionsMap, m.t);

            // RH Part & Panel (maps to common raw panel)
            const partRhName = getPartBaseName(rhName, rhDrill, cFinish);
            rows.push(makeRow(so, "Carcass", "Part Cab", 1,
              partRhName, partRhName + skuSuffix, "sub_bom",
              String(p.h), String(p.w), "", String(m.t),
              cFinish, p.pack, p.qty / 2, 0, pActualHalf, "pcs", stockMap, "sub_bom"));

            addPanelRow(so, "Carcass", "Panels- Cab", 2,
              panelCommonName, panelCommonName + skuSuffix, "component",
              String(p.h), String(p.w), "", String(m.t),
              cFinish, partRhName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "component",
              rows, selectedRawIds, rawOptionsMap, m.t);

          } else if (isCombinedDir) {
            const tpTag = p.name.toLowerCase().includes("top") ? "Top" : "TP";
            const btTag = p.name.toLowerCase().includes("bottom") ? "Bottom" : "BT";
            const tpName = p.name.replace(/TP\/BT|Top\/Bottom|TP\+BT/gi, tpTag);
            const btName = p.name.replace(/TP\/BT|Top\/Bottom|TP\+BT/gi, btTag);

            // Common raw Panel name
            const panelCommonName = getPanelBaseName(p.name, null, cFinish);

            // TP Part & Panel (maps to common raw panel)
            const partTpName = getPartBaseName(tpName, p.drill, cFinish);
            const pActualHalf = +((p.qty / 2) * q).toFixed(3);
            rows.push(makeRow(so, "Carcass", "Part Cab", 1,
              partTpName, partTpName + skuSuffix, "sub_bom",
              String(p.h), String(p.w), "", String(m.t),
              cFinish, p.pack, p.qty / 2, 0, pActualHalf, "pcs", stockMap, "sub_bom"));

            addPanelRow(so, "Carcass", "Panels- Cab", 2,
              panelCommonName, panelCommonName + skuSuffix, "component",
              String(p.h), String(p.w), "", String(m.t),
              cFinish, partTpName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "component",
              rows, selectedRawIds, rawOptionsMap, m.t);

            // BT Part & Panel (maps to common raw panel)
            const partBtName = getPartBaseName(btName, p.drill, cFinish);
            rows.push(makeRow(so, "Carcass", "Part Cab", 1,
              partBtName, partBtName + skuSuffix, "sub_bom",
              String(p.h), String(p.w), "", String(m.t),
              cFinish, p.pack, p.qty / 2, 0, pActualHalf, "pcs", stockMap, "sub_bom"));

            addPanelRow(so, "Carcass", "Panels- Cab", 2,
              panelCommonName, panelCommonName + skuSuffix, "component",
              String(p.h), String(p.w), "", String(m.t),
              cFinish, partBtName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "component",
              rows, selectedRawIds, rawOptionsMap, m.t);

          } else {
            const actualQty = +(p.qty * q).toFixed(3);
            const partName = getPartBaseName(p.name, p.drill, cFinish);
            rows.push(makeRow(so, "Carcass", "Part Cab", 1,
              partName, partName + skuSuffix, "sub_bom",
              String(p.h), String(p.w), "", String(m.t),
              cFinish, p.pack, p.qty, 0, actualQty, "pcs", stockMap, "sub_bom"));

            const panelItemName = getPanelBaseName(p.name, null, cFinish);
            addPanelRow(so, "Carcass", "Panels- Cab", 2,
              panelItemName, panelItemName + skuSuffix, "component",
              String(p.h), String(p.w), "", String(m.t),
              cFinish, partName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "component",
              rows, selectedRawIds, rawOptionsMap, m.t);
          }
        } else {
          const actualQty = +(p.qty * q).toFixed(3);
          const panelItemName = getPanelBaseName(p.name, null, cFinish);
          addPanelRow(so, "Carcass", "Panels- Cab", 1,
            panelItemName, panelItemName + skuSuffix, "component",
            String(p.h), String(p.w), "", String(m.t),
            cFinish, p.pack, p.qty, 0, actualQty, "pcs", stockMap, "component",
            rows, selectedRawIds, rawOptionsMap, m.t);
        }
      }
    });

    // Orphan profiles — not matched to any pack (Zoho naming with side info)
    m.profiles.forEach((p) => {
      if (!isMatchedProfile(p)) {
        const profFinish = m.carcassProfileColor || cFinish;
        const sideMatch = p.name.match(/(LH[+/]RH|TP[+/]BT|LH|RH|TP|BT)/i);
        const sideLabel = sideMatch ? ` (${sideMatch[1].toUpperCase()})` : "";
        const cleanedProfName = p.name
          .replace(/(LH[+/]RH|TP[+/]BT)/gi, "")
          .replace(/\b(V|H|LH|RH|TP|BT|Top|Bottom|vertical|horizontal|edge)\b/gi, "")
          .replace(/\s+/g, " ")
          .trim();
        const panelProfName = `${cleanedProfName} ${p.len}mm ${profFinish}${sideLabel}`;
        addProfilePanelAndRawRow(
          so, "Carcass", 1, panelProfName, skuSuffix, p.len, p.qty,
          profFinish, p.pack, stockMap, p.type,
          selectedRawIds, rawOptionsMap, q, rows
        );
      }
    });

    // Level 1: Hardware (flat — no children; skip hardware already nested in Elenor composite)
    m.hardware.forEach((h) => {
      if (isMatchedHardware(h)) return;
      const actualQty = +(h.qty * q).toFixed(3);
      addHardwareRow(so, "Carcass", "Hardware", 1,
        h.name, h.name, "plain",
        "", "", "", "",
        "", h.pack || h.name, h.qty, 0, actualQty, (h.uom || "set").toLowerCase(), stockMap, "plain", rows);
    });

    // Level 1: Consumables not already nested under a pack
    m.cons.forEach((c) => {
      if (!isMatchedCons(c)) {
        const actualQty = +(c.qty * q).toFixed(3);
        rows.push(makeRow(so, "Carcass", "Consumable", 1,
          c.name, c.name, "plain",
          "", "", "", "",
          "", c.pack || "Consumable", c.qty, 0, actualQty, c.uom.toLowerCase(), stockMap, "plain"));
      }
    });

    // Level 1: Glass shelf (wall stone/glass shutter) — DIRECT raw material, not a BOM
    if (m.glassShelf) {
      const gs = m.glassShelf;
      const gsActual = +(gs.qty * q).toFixed(3);
      rows.push(makeRow(so, "Carcass", "Raw Material", 1,
        gs.name, gs.name + skuSuffix, "plain",
        String(gs.d), String(gs.w), "", String(gs.t),
        "CLEAR", "Glass Shelf", gs.qty, 0, gsActual, "pcs", stockMap, "plain"));
    }

    // Shutters — each shutter gets its own sub-tree
    (m.shutters || []).forEach((s) => {
      // Fixed (dummy) blind panels are always stone 6mm MD1, even in glass families.
      const isGlassShutter = isGlassShutterFam(m.fk) && s.kind !== "fixed";
      // Glass face uses the chosen glass color; the fixed stone panel uses its own stone
      // shade (m.fixedPanelMat). Everything else falls back to the shutter shade.
      const glassColor = m.shutterMat || "CLEAR";
      const shFinish = s.kind === "fixed" ? (m.fixedPanelMat || m.shutterMat || m.mat) : sFinish;
      // Thickness is design-driven: MD3 family = 9mm stone, NEON20/glass = 5mm, else 6mm.
      const shThkVal = String(shThkOf(s.design, isGlassShutter));
      const shStoneThk = String(shThkOf(s.design, false));

      // Level 1: Shutter master (shutter code)
      rows.push(makeRow(so, "Shutter", "Shutter", 1,
        s.code, s.code + skuSuffix, "sub_bom",
        String(s.h), String(s.w), "", shThkVal,
        shFinish, s.kind + " " + s.design, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "sub_bom"));

      const shProfFinish = m.shutterProfileColor || shFinish;
      const shutterVD = shutterVDrill(m.lh, m.rh, m.shutters || [], s);

      // Parts- SH assembly node (matches "Shutter Part Bom" sheet) — present for ALL
      // shutters. Panel/Glass + Set of Profile + Corner Connector are reparented under
      // this node; only the hinge HARDWARE PACK stays a direct child of the shutter.
      const partsShName = `Parts- SH ${s.pw}x${s.ph} ${s.design}`;
      rows.push(makeRow(so, "Shutter", "Parts- SH", 2,
        partsShName, partsShName + skuSuffix, "sub_bom",
        String(s.ph), String(s.pw), "", shThkVal,
        shFinish, s.code, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "sub_bom"));

      // Level 3: Panel / Glass (under Parts- SH)
      if (isGlassShutter) {
        // Glass IS a purchased raw material → direct Level 3 raw material (no panel BOM).
        const glassItemName = `GLASS TOUGH EP ${s.pw}X${s.ph}X5 ${glassColor} SKV`;
        rows.push(makeRow(so, "Shutter", "Raw Material", 3,
          glassItemName, glassItemName + skuSuffix, "plain",
          String(s.ph), String(s.pw), "", "5",
          glassColor, partsShName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "plain"));
      } else {
        const panelName = `Panels- SH ${s.pw}x${s.ph}x${shStoneThk} ${s.design}`;
        addPanelRow(so, "Shutter", "Panels- SH", 3,
          panelName, panelName + skuSuffix, "component",
          String(s.ph), String(s.pw), "", shStoneThk,
          shFinish, partsShName, 1, 0, +(1 * q).toFixed(3), "pcs", stockMap, "component",
          rows, selectedRawIds, rawOptionsMap);
      }

      // Level 3+: Shutter Profiles — buildProfileBomRows emits its "Set of Profile"
      // at level 2; shift every row down by 1 so the sets sit at level 3 under Parts- SH.
      const shutterProfileRows = buildProfileBomRows(
        so, s.design, shProfFinish,
        [
          { len: s.profV, qty: 2, name: `Profile LH/RH (${s.design})` },
          { len: s.profH, qty: 2, name: `Profile TP/BT (${s.design})` }
        ],
        skuSuffix, stockMap, "Shutters", s.code, q, partsShName,
        selectedRawIds, rawOptionsMap, shutterVD
      );
      shutterProfileRows.forEach((r) => { r.Level += 1; });
      rows.push(...shutterProfileRows);

      // Level 3: Corner Connector (under Parts- SH) — glass vs stone per shutter.
      const cornerName = shutterCornerName(m.fk, s.kind);
      rows.push(makeRow(so, "Shutter", "Hardware", 3,
        cornerName, cornerName, "plain",
        "", "", "", "",
        "", partsShName, 1, 0, +(1 * q).toFixed(3), "set", stockMap, "plain"));

      // Level 2: Hinge HARDWARE PACK — direct child of the shutter
      if (s.hinge) {
        addHardwareRow(so, "Shutter", "Hardware", 2,
          s.hinge, s.hinge, "plain",
          "", "", "", "",
          "", s.code, s.hq || 1, 0, +((s.hq || 1) * q).toFixed(3), "set", stockMap, "plain", rows);
      }
    });

    // Tag every row produced for this cabinet with its elevation (AA/BB/...) for the export.
    const lineElev = l.elevation || "";
    for (let _i = _elevStart; _i < rows.length; _i++) rows[_i].Elevation = lineElev;
  });

  // Append Fillers
  fillers.forEach((f) => {
    const _fillerStart = rows.length;
    const zoneKey = f.zone;
    const q = f.qty;
    const finish = f.customShade || getDefaultShutterShadeForZone(zoneKey);
    const H = f.customHeight ? parseFloat(f.customHeight) || 0 : getDefaultShutterHeightForZone(zoneKey);
    const W = f.customWidth ? parseFloat(f.customWidth) || 0 : 80;

    const fCode = `SH-Filler-${zoneKey.toUpperCase()}-${H}x${W}`;
    const parentLabel = `Filler ${zoneKey.toUpperCase()}`;

    // Level 0: Master Filler Item
    rows.push(makeRow(so, "Shutter", "Shutter", 0,
      `Panels- SH Filler ${H}x${W}x6`, `SH-Filler-${zoneKey.toUpperCase()}-${H}x${W}-${q}` + skuSuffix, "master",
      String(H), String(W), "", "6",
      finish, parentLabel, q, 0, q, "pcs", stockMap, "master"));

    // Level 1: Sub-BOM
    rows.push(makeRow(so, "Shutter", "Shutter", 1,
      fCode, fCode + skuSuffix, "sub_bom",
      String(H), String(W), "", "6",
      finish, parentLabel, 1, 0, q, "pcs", stockMap, "sub_bom"));

    // Level 2: Shutter Panel (Stone as Per the size)
    const pw = W;
    const ph = H;
    const panelName = `Panels- SH ${pw}x${ph}x6 Plain`;
    addPanelRow(so, "Shutter", "Panels- SH", 2,
      panelName, panelName + skuSuffix, "component",
      String(ph), String(pw), "", "6",
      finish, fCode, 1, 0, q, "pcs", stockMap, "component",
      rows, selectedRawIds, rawOptionsMap);

    // Level 2: Shutter Profiles (HM-504 Raw Profile)
    const profFinish = getProfileColorForZone(zoneKey);
    const profileKey = `shutter|HM-504|${profFinish}`;
    const defaultFallback = `ALU FILLER PROFILE HM-504 SIZE 76X8.2 WITH ANODISED ${profFinish.toUpperCase()} 3 MTR W 0.75 KG/MTR MINA`;
    const { name: rawName, sku: rawSku } = getRawMaterialNameAndSku(
      profileKey, selectedRawIds, rawOptionsMap, defaultFallback
    );
    const lenMeters = H / 1000;
    const rawSoQty = lenMeters;
    const rawActualQty = +(rawSoQty * q).toFixed(3);
    rows.push(makeRow(so, "Shutter", "Raw Material", 2,
      rawName, rawSku, "-",
      "", "", "", "",
      profFinish, fCode, rawSoQty, 0, rawActualQty,
      "mtr", stockMap, "plain", "HM-504"));

    // Level 2: Consumables (Silicone pasting glue)
    const siliconeName = "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG";
    const siliconeSoQty = +(lenMeters * 15).toFixed(3); // 15 mL per meter
    const siliconeActualQty = +(siliconeSoQty * q).toFixed(3);
    rows.push(makeRow(so, "Shutter", "Consumable", 2,
      siliconeName, siliconeName, "-",
      "", "", "", "",
      "", fCode, siliconeSoQty, 0, siliconeActualQty,
      "ml", stockMap, "plain"));

    // Stamp this filler's elevation (AA/BB/… or custom) onto every row it produced.
    const fElev = f.elevation || "";
    for (let _i = _fillerStart; _i < rows.length; _i++) rows[_i].Elevation = fElev;
  });

  // Append Visible Panels
  visiblePanels.forEach((vp) => {
    const zoneKey = vp.zone;
    const q = vp.qty;
    const finish = vp.customShade || getDefaultShutterShadeForZone(zoneKey);
    const H = vp.customHeight ? parseFloat(vp.customHeight) || 0 : getDefaultShutterHeightForZone(zoneKey);
    const W = vp.customWidth ? parseFloat(vp.customWidth) || 0 : (getDefaultCabinetDepthForZone(zoneKey) + 25);

    const vpCode = `SH-Visible-${zoneKey.toUpperCase()}-${H}x${W}`;
    const parentLabel = `Visible Panel ${zoneKey.toUpperCase()}`;

    // Level 0: Master Visible Panel Item
    rows.push(makeRow(so, "Shutter", "Shutter", 0,
      `Panels- SH Visible ${H}x${W}x6`, `SH-Visible-${zoneKey.toUpperCase()}-${H}x${W}-${q}` + skuSuffix, "master",
      String(H), String(W), "", "6",
      finish, parentLabel, q, 0, q, "pcs", stockMap, "master"));

    // Level 1: Sub-BOM
    rows.push(makeRow(so, "Shutter", "Shutter", 1,
      vpCode, vpCode + skuSuffix, "sub_bom",
      String(H), String(W), "", "6",
      finish, parentLabel, 1, 0, q, "pcs", stockMap, "sub_bom"));

    // Level 2: Parts- SH assembly node (Panel + Set of Profile + Corner Connector)
    const pw = W - 5;
    const ph = H - 5;
    const mainProfile = vp.profile.includes("MD3") ? "MD3" : "MD1";
    const vpThk = String(shThkOf(mainProfile, false));
    const vpPartsShName = `Parts- SH ${pw}x${ph} ${mainProfile}`;
    rows.push(makeRow(so, "Shutter", "Parts- SH", 2,
      vpPartsShName, vpPartsShName + skuSuffix, "sub_bom",
      String(ph), String(pw), "", vpThk,
      finish, vpCode, 1, 0, q, "pcs", stockMap, "sub_bom"));

    // Level 3: Shutter Panel (under Parts- SH)
    const panelName = `Panels- SH ${pw}x${ph}x${vpThk} ${mainProfile}`;
    addPanelRow(so, "Shutter", "Panels- SH", 3,
      panelName, panelName + skuSuffix, "component",
      String(ph), String(pw), "", vpThk,
      finish, vpPartsShName, 1, 0, q, "pcs", stockMap, "component",
      rows, selectedRawIds, rawOptionsMap);

    // Level 3+: Shutter Profiles (sets shifted down by 1 to sit under Parts- SH)
    const profFinish = getProfileColorForZone(zoneKey);
    const mainProfileRows = buildProfileBomRows(
      so,
      mainProfile,
      profFinish,
      [
        { len: H, qty: 2, name: `Profile LH/RH (${mainProfile})` },
        { len: W, qty: 2, name: `Profile TP/BT (${mainProfile})` }
      ],
      skuSuffix,
      stockMap,
      "Shutters",
      vpCode,
      q,
      vpPartsShName,
      selectedRawIds,
      rawOptionsMap
    );
    mainProfileRows.forEach((r) => { r.Level += 1; });
    rows.push(...mainProfileRows);

    if (vp.profile.includes("CM")) {
      const mouldProfile = "CM1";
      const mouldProfileRows = buildProfileBomRows(
        so,
        mouldProfile,
        profFinish,
        [
          { len: H, qty: 2, name: `Profile LH/RH (${mouldProfile})` },
          { len: W, qty: 2, name: `Profile TP/BT (${mouldProfile})` }
        ],
        skuSuffix,
        stockMap,
        "Shutters",
        vpCode,
        q,
        vpPartsShName,
        selectedRawIds,
        rawOptionsMap
      );
      mouldProfileRows.forEach((r) => { r.Level += 1; });
      rows.push(...mouldProfileRows);
    }

    // Level 3: Corner Connector (under Parts- SH)
    rows.push(makeRow(so, "Shutter", "Hardware", 3,
      "CORNER CONNECTOR FOR STONE 70X70X2 MAR", "CORNER CONNECTOR FOR STONE 70X70X2 MAR", "plain",
      "70", "70", "", "2",
      "", vpPartsShName, 1, 0, 1 * q, "set", stockMap, "plain"));
  });

  // Append Backsplash — each row is its own master under the "Backsplash" main group.
  // Master qty = pieces (row qty); the stone panel consumes stone (+15% waste via the raw
  // aggregation), and the glue consumable is a per-sqft rate scaled by the panel area × qty.
  backsplashes.forEach((b) => {
    const q = Math.max(1, b.qty);
    const W = parseFloat(b.width) || 0;
    const H = parseFloat(b.height) || 0;
    const T = parseFloat(b.thickness) || 15;
    const color = b.color || getDefaultShutterShadeForZone("base");
    const areaSqft = sqft(W, H); // per piece

    const masterItem = `Back Splash ${T}mm ${W}x${H}`;
    const masterSku = `BS-${W}x${H}x${T}-${q}` + skuSuffix;
    const subCode = `BS-${W}x${H}x${T}`;

    rows.push(makeRow(so, "Backsplash", "Backsplash", 0,
      masterItem, masterSku, "master",
      String(H), String(W), "", String(T),
      color, "Backsplash", q, 0, q, "pcs", stockMap, "master"));
    rows.push(makeRow(so, "Backsplash", "Backsplash", 1,
      subCode, subCode + skuSuffix, "sub_bom",
      String(H), String(W), "", String(T),
      color, "Backsplash", 1, 0, q, "pcs", stockMap, "sub_bom"));

    const panel = `Panels- BS Stone ${T}mm ${W}x${H}`;
    addPanelRow(so, "Backsplash", "Panels- BS", 2,
      panel, panel + skuSuffix, "component",
      String(H), String(W), "", String(T),
      color, subCode, 1, 0, q, "pcs", stockMap, "component",
      rows, selectedRawIds, rawOptionsMap);

    const soQ = +(1.25 * areaSqft).toFixed(3);
    rows.push(makeRow(so, "Backsplash", "Consumable", 2,
      "GLUE LATRICATE SUPER FLEX 20KG XX WHITE 335 AGG", "GLUE LATRICATE SUPER FLEX 20KG XX WHITE 335 AGG", "-",
      "", "", "", "",
      "", subCode, soQ, 0, +(soQ * q).toFixed(3), "kg", stockMap, "plain"));
  });

  // Append Countertop — master "Countertop Pasting Material {T}mm". Derived geometry: top stone
  // + dead-stock base (depth −40), stone patti strips (front always; sides per drop-down/edging;
  // island = all 4), brass strip(s) at drop-downs, LED band light (len = Length − 30×#drop-downs),
  // and polish/glue consumables (per-sqft × top area). Strips/panels are counter-colour stone
  // (+15% waste via raw aggregation); base is dead-stock.
  countertops.forEach((c) => {
    const q = Math.max(1, c.qty);
    const L = parseFloat(c.length) || 0;
    const D = parseFloat(c.depth) || 0;
    const T = parseFloat(c.thickness) || 30;
    const pt = T / 2; // each pasted slab thickness (15 for 30mm, 20 for 40mm)
    const color = c.color || getDefaultShutterShadeForZone("base");
    const areaSqft = sqft(L, D);
    const geom = ctGeom(c.ctType || 1, L, D, T, parseFloat(c.dropHeight) || 705);
    // Visible drop stone is issued extra for the mitre: +15 mm single-side-visible, +30 mm
    // double-side-visible (type 7) — same as the plain counter's front fold.
    const dropIssue = (c.ctType === 7) ? 30 : 15;

    // Rounding is NOT a stone piece — it's just a note in the counter name showing the side(s)
    // and the rounding height value (e.g. " Rounding LH (-600)"). No deduction/geometry change.
    const roundLabel = (c.edging && c.edging !== "none")
      ? ` Rounding ${c.edging === "left" ? "LH" : c.edging === "right" ? "RH" : "Both"} (-${parseFloat(c.edgingHeight) || 600})`
      : "";
    const masterItem = `Countertop Pasting Material ${T}mm ${L}x${D}${roundLabel}`;
    const subCode = `CT-${L}x${D}x${T}`;
    rows.push(makeRow(so, "Countertop", "Countertop", 0,
      masterItem, `CT-${L}x${D}x${T}-${q}` + skuSuffix, "master",
      String(L), String(D), "", String(T), color, "Countertop", q, 0, q, "pcs", stockMap, "master"));
    rows.push(makeRow(so, "Countertop", "Countertop", 1,
      subCode, subCode + skuSuffix, "sub_bom",
      String(L), String(D), "", String(T), color, "Countertop", 1, 0, q, "pcs", stockMap, "sub_bom"));

    // Top stone — cut size topL × topD (incl. front fold, type-5 edge folds, and the 100 mm
    // cabinet-mitre reductions). Dead-stock base = baseL × baseD (same reductions).
    const topPanel = `Panels- CT Stone ${pt}mm ${geom.topL}x${geom.topD}`;
    addPanelRow(so, "Countertop", "Panels- CT", 2, topPanel, topPanel + skuSuffix, "component",
      String(geom.topL), String(geom.topD), "", String(pt), color, subCode, 1, 0, q, "pcs", stockMap, "component",
      rows, selectedRawIds, rawOptionsMap);
    const basePanel = `Panels- CT Counter Base Stone ${pt}mm ${geom.baseL}x${geom.baseD}`;
    addPanelRow(so, "Countertop", "Panels- CT", 2, basePanel, basePanel + skuSuffix, "component",
      String(geom.baseL), String(geom.baseD), "", String(pt), "DEAD STOCK", subCode, 1, 0, q, "pcs", stockMap, "component",
      rows, selectedRawIds, rawOptionsMap);

    // Pasting consumables — per-sqft rates; reused by the counter and each drop-down sub-BOM.
    const ctCons: Array<{ name: string; rate: number; uom: string }> = [
      { name: "AKEMI 5010 FOR STONE POLISH 2.25 PER KG S", rate: 10, uom: "gram" },
      { name: "GLUE BONDTITE FAST & CLEAR FOR STONE XX AGG", rate: 10, uom: "gram" },
      { name: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", rate: 40, uom: "ml" },
    ];
    const emitCons = (parentRef: string, area: number, level: number) => {
      for (const cn of ctCons) {
        const soQ = +(cn.rate * area).toFixed(3);
        rows.push(makeRow(so, "Countertop", "Consumable", level, cn.name, cn.name, "-",
          "", "", "", "", "", parentRef, soQ, 0, +(soQ * q).toFixed(3), cn.uom, stockMap, "plain"));
      }
    };

    // Per-type pieces. "flat" pieces (back patti) are a single counter-colour stone line.
    // "dropdown" pieces (side & island drop panels) are a sub-BOM: ONE visible drop stone
    // (len × dropHeight — the 30 mm front and 100 mm back patti are mitred folds OF this stone,
    // not separate pieces) + a dead-stock base reduced by 100 mm (dropHeight − 100) + pasting.
    for (const p of geom.panels) {
      if (p.kind === "dropdown") {
        const dh = p.wid; // nominal visible drop height
        const visH = dh + dropIssue; // issued extra for the mitre (+15 / +30)
        const deadQty = p.deadQty || 1; // type-8 sitting drop = 2 dead stones
        const node = `Drop-Down ${p.label.replace(/^Drop-Down /, "")} ${p.len}x${dh}`;
        rows.push(makeRow(so, "Countertop", "Drop-Down", 2, node, node + skuSuffix, "sub_bom",
          String(p.len), String(dh), "", String(T), color, subCode, 1, 0, q, "pcs", stockMap, "sub_bom"));
        const visName = `Panels- CT ${p.label} Stone ${pt}mm ${p.len}x${visH}`;
        addPanelRow(so, "Countertop", "Panels- CT", 3, visName, visName + skuSuffix, "component",
          String(p.len), String(visH), "", String(pt), color, node, 1, 0, q, "pcs", stockMap, "component", rows, selectedRawIds, rawOptionsMap);
        const dBaseH = Math.max(0, dh - 100);
        const dBaseName = `Panels- CT ${p.label} Base Stone ${pt}mm ${p.len}x${dBaseH}`;
        addPanelRow(so, "Countertop", "Panels- CT", 3, dBaseName, dBaseName + skuSuffix, "component",
          String(p.len), String(dBaseH), "", String(pt), "DEAD STOCK", node, deadQty, 0, deadQty * q, "pcs", stockMap, "component", rows, selectedRawIds, rawOptionsMap);
        emitCons(node, sqft(p.len, visH), 3);
      } else {
        const pName = `Panels- CT ${p.label} ${pt}mm ${p.len}x${p.wid}`;
        addPanelRow(so, "Countertop", "Panels- CT", 2, pName, pName + skuSuffix, "component",
          String(p.len), String(p.wid), "", String(pt), color, subCode, 1, 0, q, "pcs", stockMap, "component",
          rows, selectedRawIds, rawOptionsMap);
      }
    }

    // Brass strip at each drop-down side — a BOM material with a specific cut size (runs the side
    // edge: brassLen × 30 mm), 1 piece per drop side.
    if (geom.brass > 0) {
      const brassName = `BRASS STRIP 05MM 600 X 30 MM ${geom.brassLen}x30`;
      rows.push(makeRow(so, "Countertop", "Hardware", 2,
        brassName, "BRASS STRIP 05MM 600 X 30 MM" + skuSuffix, "plain",
        String(geom.brassLen), "30", "", "5", "", subCode, geom.brass, 0, geom.brass * q, "pcs", stockMap, "plain"));
    }

    // Grand Light band: a BOM ("Counter Band Light {len}") whose profile, LED and diffuser are
    // each cut-to-size pieces (raw 3-mtr stock excluded from Opti). Length = L − 30 × side drops.
    // The vertical island (type 7) is double-side-visible → two runs (front + back).
    if (c.baseLight) {
      const lightLen = Math.max(0, L - 30 * geom.sideDrops);
      for (let gi = 0; gi < geom.grandLights; gi++) {
        const tag = geom.grandLights > 1 ? (gi === 0 ? " Front" : " Back") : "";
        const lightNode = `Counter Band Light${tag} ${lightLen}mm`;
        rows.push(makeRow(so, "Countertop", "Light", 2, lightNode, lightNode + skuSuffix, "sub_bom",
          String(lightLen), "", "", "", "", subCode, 1, 0, q, "pcs", stockMap, "sub_bom"));
        addLightCutRow(so, "Countertop", 3, "ALU PROF GRAND COUNTER 3000X20X15.5 ANODISED CHAMPAGNE HM-512 MINA", "Grand Counter Profile", lightLen, 1, "CHAMPAGNE", lightNode, stockMap, rows, q, 0);
        addLightCutRow(so, "Countertop", 3, "LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED", "LED Light", lightLen, 1, "", lightNode, stockMap, rows, q, 0);
        addLightCutRow(so, "Countertop", 3, "PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI", "Diffuser", lightLen, 1, "", lightNode, stockMap, rows, q, 0);
      }
    }

    // Counter-level pasting consumables — per-sqft rates × top area × qty.
    emitCons(subCode, areaSqft, 2);
  });

  return rows;
}

function buildOosData(fullBom: FullBomRow[]): OosRow[] {
  const leafRows = fullBom.filter((r) => r._type !== "master" && r.Deficit > 0);
  const order: string[] = [];
  const map = new Map<string, OosRow & { _soSet: Set<string> }>();

  leafRows.forEach((r) => {
    const key = r.SKU || r.Item.trim();
    const existing = map.get(key);
    if (!existing) {
      order.push(key);
      map.set(key, {
        SO: r.SO,
        "Main Group": r["Main Group"],
        "Sub Group": r["Sub Group"],
        "BOM Path": "",
        Item: r.Item.trim(),
        SKU: r.SKU,
        Type: r.Type,
        Height: r.Height,
        Width: r.Width,
        Depth: r.Depth,
        Thickness: r.Thickness,
        Finish: r.Finish,
        Grain: "",
        "CF Type": r["CF Type"],
        "Profile Code": r["Profile Code"] || "",
        "SO Qty": r["SO Qty"],
        "Waste %": r["Waste %"],
        "Actual Qty": r["Actual Qty"],
        Pcs: "-",
        "In Stock": r["In Stock"],
        Deficit: r.Deficit,
        Unit: r.Unit,
        _soSet: new Set(r.SO ? [r.SO] : []),
      });
    } else {
      if (r.SO) existing._soSet.add(r.SO);
      existing["SO Qty"] += r["SO Qty"];
      existing["Actual Qty"] += r["Actual Qty"];
      existing.Deficit = Math.max(0, existing["Actual Qty"] - existing["In Stock"]);
    }
  });

  return order.map((key) => {
    const { _soSet, ...rest } = map.get(key)!;
    return { ...rest, SO: Array.from(_soSet).join(", ") };
  });
}

function buildOptiData(oosRows: OosRow[]): Array<Record<string, unknown>> {
  const OPTI_GROUPS = ["profile", "panels- sh", "panels- cab"];
  return oosRows
    .filter((r) => {
      const sg = (r["Sub Group"] || "").toLowerCase();
      return OPTI_GROUPS.some((g) => sg === g);
    })
    .map((r) => ({
      SO: r.SO,
      "Main Group": r["Main Group"],
      Group: r["Sub Group"],
      "Item Name": r.SKU || r.Item,
      "Profile Code": r["Profile Code"] || extractProfileCode(r.Item),
      Type: r["CF Type"],
      Length: r.Height,
      Width: r.Width,
      "Min Q.": r.Deficit || 0,
      Thickness: r.Thickness,
      Grain: "",
      Finish: r.Finish,
    }));
}

function applyRowColors(ws: XLSX.WorkSheet, data: FullBomRow[]) {
  const colCount = 26;
  for (let r = 0; r < data.length; r++) {
    const fill = ROW_TYPE_FILLS[data[r]._type];
    if (!fill) continue;
    for (let c = 0; c < colCount; c++) {
      const addr = XLSX.utils.encode_cell({ r: r + 1, c });
      if (!ws[addr]) ws[addr] = { v: "", t: "s" };
      ws[addr].s = { fill: { patternType: "solid", ...fill } };
    }
  }
}

function exportBuilderExcel(
  project: ProjectLine[],
  accessories: Array<{ SO: string; "Carcass Items": string; Accessory: string; Selected: string; "Item Name": string; Size: string; Elevation: string; Total: number | string; "Actual Qty": number | string; "Zoho Item ID": string }>,
  soNumber?: string,
  stockMap?: Record<string, StockItem>,
  selectedRawIds: Record<string, string> = {},
  rawOptionsMap: Record<string, any[]> = {},
  fillers: FillerRow[] = [],
  visiblePanels: VisiblePanelRow[] = [],
  backsplashes: BacksplashRow[] = [],
  countertops: CountertopRow[] = [],
  getDefaultShutterShadeForZone: (zk: string) => string = () => "STATUARIO",
  getDefaultShutterHeightForZone: (zk: string) => number = () => 715,
  getDefaultCabinetDepthForZone: (zk: string) => number = () => 560,
  getShutterProfileForZone: (zk: string) => string = () => "MD1",
  getProfileColorForZone: (zk: string) => string = () => "CHAMPAGNE"
) {
  const wb = XLSX.utils.book_new();
  const so = soNumber || "Project";

  // Sheet 1: Full BOM
  const fullBom = buildFullBomData(
    project,
    so,
    stockMap || {},
    selectedRawIds,
    rawOptionsMap,
    fillers,
    visiblePanels,
    backsplashes,
    countertops,
    getDefaultShutterShadeForZone,
    getDefaultShutterHeightForZone,
    getDefaultCabinetDepthForZone,
    getShutterProfileForZone,
    getProfileColorForZone
  );
  if (fullBom.length) {
    // Serial number per project line item (top-level master), carried onto its sub-rows —
    // not a running number per BOM-tree row.
    let sno = 0;
    const cleaned = fullBom.map(({ _type, ...rest }) => {
      if (rest.Level === 0) sno++;
      return { "S. No.": sno, ...rest };
    });
    const ws = XLSX.utils.json_to_sheet(cleaned);
    ws["!cols"] = FULL_BOM_COLS;
    XLSX.utils.book_append_sheet(wb, ws, "Full BOM");
    applyRowColors(ws, fullBom);
  }

  // Sheet 2: Out of Stock
  const oosRows = buildOosData(fullBom);
  if (oosRows.length) {
    const ws2 = XLSX.utils.json_to_sheet(oosRows);
    ws2["!cols"] = OOS_COLS;
    XLSX.utils.book_append_sheet(wb, ws2, "Out of Stock");
  }

  // Sheet 3: Opti
  const optiRows = buildOptiData(oosRows);
  if (optiRows.length) {
    const ws3 = XLSX.utils.json_to_sheet(optiRows);
    ws3["!cols"] = OPTI_COLS;
    XLSX.utils.book_append_sheet(wb, ws3, "Opti");
  }

  // Sheet 4: Accessories
  if (accessories.length) {
    const ws4 = XLSX.utils.json_to_sheet(accessories);
    ws4["!cols"] = ACC_COLS;
    XLSX.utils.book_append_sheet(wb, ws4, "Accessories");
  }

  // Sheet 5: Hardware items
  const validGroups = new Set(["Raw Material", "Consumable", "Hardware"]);
  const hwItemsMap = new Map<string, { Item: string; Group: string; Quantity: number; Unit: string }>();

  fullBom.forEach((row) => {
    const group = row["Sub Group"];
    if (!validGroups.has(group)) return;

    const cleanItemName = (row.Item || "").trim();
    if (!cleanItemName) return;

    let qty = 0;
    const pcsVal = row.Pcs;
    const actualVal = row["Actual Qty"];

    if (pcsVal !== "" && pcsVal !== "-" && pcsVal !== null && pcsVal !== undefined) {
      const parsedPcs = parseFloat(String(pcsVal));
      if (!isNaN(parsedPcs)) {
        qty = parsedPcs;
      } else {
        qty = parseFloat(String(actualVal)) || 0;
      }
    } else {
      qty = parseFloat(String(actualVal)) || 0;
    }

    const unit = row.Unit || "pcs";

    if (hwItemsMap.has(cleanItemName)) {
      const existing = hwItemsMap.get(cleanItemName)!;
      existing.Quantity = +(existing.Quantity + qty).toFixed(3);
    } else {
      hwItemsMap.set(cleanItemName, {
        Item: cleanItemName,
        Group: group,
        Quantity: +qty.toFixed(3),
        Unit: unit,
      });
    }
  });

  const hwItemsRows = Array.from(hwItemsMap.values());
  if (hwItemsRows.length) {
    const ws5 = XLSX.utils.json_to_sheet(hwItemsRows);
    ws5["!cols"] = [
      { wch: 45 }, // Item
      { wch: 20 }, // Group
      { wch: 12 }, // Quantity
      { wch: 10 }  // Unit
    ];
    XLSX.utils.book_append_sheet(wb, ws5, "Hardware items");
  }

  XLSX.writeFile(wb, `Builder_BOM_${so}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---- Packing List HTML Builder ----
function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeFilename(v: string) {
  return v.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function extractDimension(itemName: string): string {
  const multi = itemName.match(/(\d+x\d+)-?\s*(\d+x\d+x\d+)/i);
  if (multi) return `${multi[1]} - ${multi[2]}`;
  const triple = itemName.match(/(\d+x\d+x\d+)/i);
  if (triple) return triple[1];
  const double = itemName.match(/(\d+x\d+)/i);
  if (double) return double[1];
  return "";
}

function calcBoxDimension(dims: string, isSet: boolean): string {
  const triple = dims.match(/(\d+)[x×](\d+)[x×](\d+)/i);
  if (!triple) return "";
  const w = parseInt(triple[1], 10);
  const h = parseInt(triple[2], 10);
  const t = parseInt(triple[3], 10);
  const padding = 20;
  const thickness = isSet ? t * 2 + padding : t + padding;
  return `${w + padding}x${h + padding}x${thickness}`;
}

/**
 * Build packing list HTML — groups items per cabinet into CARCASS and SHUTTER sections.
 * pkRows type: "shut" = shutter group, "panel"/"prof" = carcass group, "hard" = hardware, "cons" = consumables.
 * Matches Dashboard's buildPackingListHtml structure exactly.
 */
function isShutterHardware(name: string): boolean {
  const n = name.toUpperCase();
  return n.includes("HINGE") || n.includes("CORNER CONNECTOR");
}

function isShutterConsumable(name: string): boolean {
  return false;
}

function buildBuilderPackingHtml(
  project: ProjectLine[],
  soNumber: string,
  customerName: string,
  soDate: string,
  filter: "both" | "carcass" | "shutter" = "both",
) {
  let packNum = 0;
  const hwItems: Array<{ name: string; finish: string; qty: number }> = [];
  const consItems: Array<{ name: string; qty: number; uom: string }> = [];

  // ── CARCASS SECTION ──
  let carcassBodyHtml = "";
  let hasCarcass = false;

  if (filter !== "shutter") {
    project.forEach((l, li) => {
      const m = l.m;
      const q = l.qty;
      const carcassRows = m.pkRows.filter((r) => r[0] !== "shut" && r[0] !== "hard" && r[0] !== "cons");
      if (carcassRows.length === 0) return;
      hasCarcass = true;
      const letter = String.fromCharCode(65 + li);
      carcassBodyHtml += `<tr style="background:#f5f3ef;">
        <td class="center" style="font-weight:900;">${letter}.</td>
        <td colspan="6" style="font-weight:900;">${escapeHtml(m.code)} ×${q}</td>
      </tr>`;

      carcassRows.forEach((r) => {
        const [, name, dims, qty] = r;
        const isSet = name.toLowerCase().includes("set of parts");
        const boxDim = dims ? calcBoxDimension(dims, isSet) : "";
        const pcsPerBox = isSet ? 2 : 1;
        const totalBoxes = (typeof qty === "number" ? qty : 1) * q;
        for (let b = 0; b < totalBoxes; b++) {
          packNum++;
          carcassBodyHtml += `<tr>
            <td class="center">${packNum}</td>
            <td>${escapeHtml(name)}</td>
            <td>${escapeHtml(m.carcassMat || m.mat || "-")}</td>
            <td class="center">PACK - ${packNum}</td>
            <td class="center">${pcsPerBox}</td>
            <td class="center">1</td>
            <td class="center">${escapeHtml(boxDim)}</td>
          </tr>`;
        }
      });
    });
  }

  // ── SHUTTER SECTION ──
  let shutterBodyHtml = "";
  let hasShutter = false;

  if (filter !== "carcass") {
    let shutterIdx = 0;
    project.forEach((l) => {
      const m = l.m;
      const q = l.qty;
      const shutters = m.shutters || [];
      if (shutters.length === 0) return;
      hasShutter = true;

      // Mirror the carcass logic: each shutter's full CODE is its own heading row, with the
      // assembled "Parts- SH" item under it. Hardware is collected separately below.
      shutters.forEach((s) => {
        const isGlass = isGlassShutterFam(m.fk) && s.kind !== "fixed";
        const shThk = shThkOf(s.design, isGlass);
        const letter = String.fromCharCode(65 + (shutterIdx % 26));
        shutterIdx++;
        shutterBodyHtml += `<tr style="background:#f5f3ef;">
          <td class="center" style="font-weight:900;">${letter}.</td>
          <td colspan="6" style="font-weight:900;">${escapeHtml(s.code)} ×${q}</td>
        </tr>`;

        const partsName = `Parts- SH ${s.pw}x${s.ph} ${s.design}`;
        const boxDim = calcBoxDimension(`${s.w}x${s.h}x${shThk}`, false);
        const totalBoxes = 1 * q;
        for (let b = 0; b < totalBoxes; b++) {
          packNum++;
          shutterBodyHtml += `<tr>
            <td class="center">${packNum}</td>
            <td>${escapeHtml(partsName)}</td>
            <td>${escapeHtml(m.shutterMat || m.mat || "-")}</td>
            <td class="center">PACK - ${packNum}</td>
            <td class="center">1</td>
            <td class="center">1</td>
            <td class="center">${escapeHtml(boxDim)}</td>
          </tr>`;
        }
      });
    });
  }

  // ── COLLECT HARDWARE & CONSUMABLES ──
  project.forEach((l) => {
    const m = l.m;
    const q = l.qty;

    m.pkRows.filter((r) => r[0] === "hard").forEach((r) => {
      const isShHw = isShutterHardware(r[1]);
      if (filter === "carcass" && isShHw) return;
      if (filter === "shutter" && !isShHw) return;
      hwItems.push({ name: r[1], finish: "-", qty: (typeof r[3] === "number" ? r[3] : 1) * q });
    });

    m.pkRows.filter((r) => r[0] === "cons").forEach((r) => {
      const isShCons = isShutterConsumable(r[1]);
      if (filter === "carcass" && isShCons) return;
      if (filter === "shutter" && !isShCons) return;
      consItems.push({ name: r[1], qty: (typeof r[3] === "number" ? r[3] : 1) * q, uom: r[4] || "" });
    });
  });

  const carcassTableHtml = hasCarcass
    ? `<tr><td class="section-head" colspan="7" style="font-size:16px;font-weight:700;text-align:center;background:#e8e4df;">CARCASS PACKING LIST</td></tr>
       <tr><th class="head">S.NO.</th><th class="head">ITEM NAME - CARCASS</th><th class="head">ITEM COLOR</th><th class="head">PACK</th><th class="head">PCS</th><th class="head">BOX</th><th class="head">BOX DIMENSION ( L x W x H )</th></tr>
       ${carcassBodyHtml}`
    : "";

  const shutterTableHtml = hasShutter
    ? `<tr><td class="section-head" colspan="7" style="font-size:16px;font-weight:700;text-align:center;background:#e4e8ef;">SHUTTER PACKING LIST</td></tr>
       <tr><th class="head">S.NO.</th><th class="head">ITEM NAME - SHUTTER</th><th class="head">ITEM COLOR</th><th class="head">PACK</th><th class="head">PCS</th><th class="head">BOX</th><th class="head">BOX DIMENSION ( L x W x H )</th></tr>
       ${shutterBodyHtml}`
    : "";

  // ── HARDWARE SECTION ──
  const hwAgg = new Map<string, { qty: number; finish: string }>();
  hwItems.forEach(({ name, qty, finish }) => {
    const existing = hwAgg.get(name);
    hwAgg.set(name, { qty: (existing?.qty || 0) + qty, finish: existing?.finish || finish });
  });
  // Add consumables to hardware section
  consItems.forEach(({ name, qty }) => {
    const existing = hwAgg.get(name);
    hwAgg.set(name, { qty: (existing?.qty || 0) + qty, finish: "-" });
  });

  let hwTableHtml = "";
  if (hwAgg.size > 0) {
    packNum++;
    let hwRowsHtml = "";
    const entries = Array.from(hwAgg.entries());
    entries.forEach(([name, val], idx) => {
      const isGlue = name.toLowerCase().includes("glue silicone");
      const pcs = isGlue ? Math.ceil(val.qty / 270) : Math.ceil(val.qty);
      hwRowsHtml += `<tr>
        <td class="center">${idx + 1}</td>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(val.finish)}</td>
        ${idx === 0 ? `<td class="center" rowspan="${entries.length}" style="vertical-align:middle;">PACK - ${packNum}</td>` : ""}
        <td class="center">${pcs}</td>
        ${idx === 0 ? `<td class="center" rowspan="${entries.length}" style="vertical-align:middle;">1</td>` : ""}
        <td class="center"></td>
      </tr>`;
    });
    hwTableHtml = `<tr><td class="section-head" colspan="7" style="font-size:16px;font-weight:700;text-align:center;background:#f0f0f0;">HARDWARE PACK & OTHER ITEMS</td></tr>
      <tr><th class="head">S.NO.</th><th class="head">ITEM NAME</th><th class="head">ITEM COLOR</th><th class="head">PACK</th><th class="head">PCS</th><th class="head">BOX</th><th class="head">BOX DIMENSION ( L x W x H )</th></tr>
      ${hwRowsHtml}`;
  }

  const bodyHtml = carcassTableHtml || shutterTableHtml || hwTableHtml
    ? `${carcassTableHtml}${shutterTableHtml}${hwTableHtml}`
    : `<tr><td class="center" colspan="7">No items in the project.</td></tr>`;

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: "Times New Roman", serif; color: #000; }
          table { border-collapse: collapse; width: 100%; }
          td, th { border: 1px solid #222; font-size: 12px; padding: 6px 5px; vertical-align: middle; }
          .title { font-size: 34px; font-weight: 700; text-align: center; }
          .company { font-size: 20px; font-weight: 700; text-align: center; }
          .address { font-size: 12px; text-align: center; }
          .label { font-weight: 700; }
          .head { font-weight: 700; text-align: center; }
          .center { text-align: center; }
          .section-head { font-size: 16px; font-weight: 700; text-align: center; }
        </style>
      </head>
      <body>
        <table>
          <tr><td class="title" colspan="7">PACKING LIST</td></tr>
          <tr><td class="company" colspan="7">MAGPPIE LIVING PRIVATE LIMITED</td></tr>
          <tr><td class="address" colspan="7">PLOT NO- 68, SECTOR- 03, IMT MANESAR GURUGRAM, HARYANA-122050</td></tr>
          <tr>
            <td class="label" colspan="3">MRP NO / COMPLAINT NO :- ${escapeHtml(soNumber)}</td>
            <td colspan="2"></td>
            <td class="label" colspan="2">DATE :- ${escapeHtml(soDate)}</td>
          </tr>
          <tr>
            <td class="label" colspan="3">CUSTOMER NAME : ${escapeHtml(customerName)}</td>
            <td colspan="2"></td>
            <td class="label" colspan="2">PRODUCT : KITCHEN</td>
          </tr>
          <tr>
            <td class="label" colspan="3">DESTINATION :</td>
            <td colspan="2"></td>
            <td class="label" colspan="2">VEHICLE NO :</td>
          </tr>
          <tr>
            <td class="label" colspan="3">PAPER PERSON :</td>
            <td colspan="2"></td>
            <td class="label" colspan="2">CONTACT NUMBER :</td>
          </tr>
          ${bodyHtml}
        </table>
      </body>
    </html>`;
}

// ---- Labels PDF Builder ----
function generateBarcodeDataUrl(text: string): string {
  if (!text || text === "-") return "";
  const canvas = document.createElement("canvas");
  try {
    JsBarcode(canvas, text, {
      format: "CODE128",
      width: 3,
      height: 80,
      displayValue: true,
      fontSize: 16,
      margin: 4,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

/**
 * Build labels PDF — one label per pack item.
 * Groups items by carcass vs shutter: "shut" type = shutter (uses shutterMat finish), all others = carcass.
 * Matches Dashboard's buildLabelsPdf layout exactly.
 */
async function buildBuilderLabelsPdf(
  project: ProjectLine[],
  soNumber: string,
  customerName: string,
  filter: "both" | "carcass" | "shutter" = "both",
): Promise<Blob> {
  type LabelEntry = {
    name: string;
    finish: string;
    dimension: string;
    sku: string;
    group: "Carcass" | "Shutter";
    boxNum: number;
    totalBoxes: number;
    pcsPerBox: number;
  };

  const labelEntries: LabelEntry[] = [];

  project.forEach((l) => {
    const m = l.m;
    const q = l.qty;

    m.pkRows.forEach((r) => {
      const [type, name, dims] = r;
      if (type === "hard" || type === "cons") return;

      const isShutter = type === "shut";
      if (filter === "carcass" && isShutter) return;
      if (filter === "shutter" && !isShutter) return;
      const finish = isShutter ? (m.shutterMat || m.mat || "") : (m.carcassMat || m.mat || "");
      const isSet = name.toLowerCase().includes("set of parts");
      const pcsPerBox = isSet ? 2 : 1;
      const unitQty = typeof r[3] === "number" ? r[3] : 1;
      const totalBoxes = unitQty * q;
      const dimension = dims ? extractDimension(dims) : "";

      for (let b = 1; b <= totalBoxes; b++) {
        labelEntries.push({
          name,
          finish,
          dimension,
          sku: m.code,
          group: isShutter ? "Shutter" : "Carcass",
          boxNum: b,
          totalBoxes,
          pcsPerBox,
        });
      }
    });
  });

  const totalLabels = labelEntries.length;
  const W = 150;
  const H = 100;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [W, H] });

  const qrPayload = `${soNumber}\n${customerName}`;
  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "L", margin: 1, scale: 4 });
  } catch {
    /* skip QR if too large */
  }

  for (let i = 0; i < labelEntries.length; i++) {
    if (i > 0) doc.addPage([W, H], "landscape");
    const entry = labelEntries[i];
    const sku = entry.sku;

    // Border
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(2, 2, W - 4, H - 4);

    // Header: MAGPPIE + product name
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("MAGPPIE", 6, 12);

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const productLines = doc.splitTextToSize(entry.name, 80);
    doc.text(productLines, W - 6, 8, { align: "right" });

    doc.line(4, 18, W - 4, 18);

    // From / To
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("From :", 6, 23);
    doc.setFont("helvetica", "normal");
    doc.text("MAGPPIE LIVING PVT LTD", 18, 23);
    doc.text("Plot No-68, Sector-03", 18, 27);
    doc.text("IMT Manesar, Gurugram", 18, 31);
    doc.text("Haryana - 122050", 18, 35);

    doc.line(W / 2, 19, W / 2, 40);

    doc.setFont("helvetica", "bold");
    doc.text("To :", W / 2 + 4, 23);
    doc.setFont("helvetica", "normal");
    const custLines = doc.splitTextToSize(customerName, 60);
    doc.text(custLines, W / 2 + 12, 23);
    doc.text(soNumber, W / 2 + 12, 27 + (custLines.length - 1) * 3.5);

    doc.line(4, 40, W - 4, 40);

    // Barcode + QR
    const barcodeUrl = generateBarcodeDataUrl(sku);
    if (barcodeUrl) {
      doc.addImage(barcodeUrl, "PNG", 6, 43, 55, 18);
    }
    if (qrDataUrl) {
      doc.addImage(qrDataUrl, "PNG", W - 32, 43, 26, 26);
    }

    doc.line(4, 72, W - 4, 72);

    // Footer: box info, finish, dimension, group
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`Box ${i + 1} of ${totalLabels}`, 6, 78);
    doc.setFont("helvetica", "normal");
    doc.text(`Box ${entry.boxNum} of ${entry.totalBoxes} | ${entry.pcsPerBox} pcs`, 6, 83);
    if (entry.finish) doc.text(`Finish: ${entry.finish}`, 6, 88);
    if (entry.dimension) doc.text(`Dim: ${entry.dimension}`, 6, 93);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(soNumber, W - 6, 78, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.text(sku, W - 6, 83, { align: "right" });
    doc.text(entry.group.toUpperCase(), W - 6, 88, { align: "right" });
  }

  return doc.output("blob");
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildSoLineItem(item: any) {
  const itemId = item.item_id || item.composite_item_id;
  const result: any = {
    quantity: item.quantity || 1,
    rate: item.rate || 0,
  };
  
  if (itemId) {
    result.item_id = itemId;
  }
  
  if (item.line_item_id) {
    result.line_item_id = item.line_item_id;
  }
  
  if (!itemId) {
    if (item.description !== undefined && item.description !== null) {
      result.description = item.description;
    } else {
      result.description = item.name || "Line Item";
    }
    if (item.name) {
      result.name = item.name;
    }
  }
  
  if (item.tax_id) result.tax_id = item.tax_id;
  if (item.tax_name) result.tax_name = item.tax_name;
  if (item.tax_percentage !== undefined && item.tax_percentage !== null) {
    result.tax_percentage = item.tax_percentage;
  }
  if (item.tax_type) result.tax_type = item.tax_type;
  if (item.tax_exemption_id) result.tax_exemption_id = item.tax_exemption_id;
  if (item.tax_exemption_code) result.tax_exemption_code = item.tax_exemption_code;
  
  if (item.unit) result.unit = item.unit;
  if (item.discount !== undefined && item.discount !== null) {
    result.discount = item.discount;
  }
  
  return result;
}

// Glass shutter face colors — shown as the "Shutter Finish" options only when a
// glass-shutter family is selected. "CLEAR" reproduces the current default item name.
const GLASS_COLORS = [
  "BROWN TINTED", "EXTRA CLEAR", "BROWN MIRROR", "CLEAR", "CLEAR MIRROR", "CLEAR SHELF",
  "BROWN FLUTED", "CLEAR FLUTED", "EXTRA CLEAR FLUTED", "EXTRA CLEAR MIRROR",
  "GREY TINTED", "BLACK TINTED",
];

const STONE_FINISHES = [
  "ARLON PISTA", "ARMANI GRIS", "BEIGE HYDRA", "BIANCO HYDRA", "BIANCO LASA", "BLACK", 
  "BLACK FUSION", "BLACK STATUARIO NUVOLATO", "BRECCIA BIANCO", "CALACATTA PERLATO", 
  "CALCUTTA BIANCO ORO", "CAROL", "CARRARA", "CLAROS GREY DARK", "CLASSICO BIANCO", 
  "CLASSICO CHOCO", "CLOUDY AQUA", "CLOUDY OLIVE", "CLOUDY WHITE", "CORALLO GREY", 
  "CREAM", "CREMA", "CRYSTAL BLACK", "CYAN BLUE", "DIAMOND GREY", "DINAN DARK GREY", 
  "DINAN LIGHT GREY", "DRY VERDE ALPI", "EVEREST GREY", "EVEREST TAUPE", "EXTREME GREY", 
  "FENDI WHITE", "FLURRY BLACK", "FOREST GREEN", "GALAXY CREMA", "GLACIER BEACH", 
  "GRAPHITE", "GRAPHITE SOLID", "GREEN", "GREY IVORY", "HONEY BEIGE", "ICELAND WHITE", 
  "INTERSTELLAR", "INVISIBLE ROYAL", "IRAN TRAVERTINE", "IRON BEIGE", "KHAKI BROWN", 
  "KHAKI GREY", "LIGHT CARBON", "LOUIS GREY", "LOUISE BROWN", "MACALLAN GREY", 
  "MACALLAN IVORY", "MACAUBAS SHINE", "MAGIC BLACK", "MAGIC GREY", "MAGPPIE OAK", 
  "MYRA SAND", "NAIROBY CREAM", "NEO DARK BROWN", "NEW MACHIA", "OCEAN BLACK", 
  "OLGA ASH", "ONXY GALAXY", "ONXY GIN", "ONYX GOLD", "ONYX GREEN", "ONYX MYSTIC", 
  "ONYX OMAN", "ORO CARRARA", "PANDA WHITE", "PANTAGONIA", "PEARL GREY", "PEARL WHITE", 
  "PIETRA GREY", "POLAR BIEGE SAND", "POLAR BLACK SAND", "POLISH CLASSICO", "PULPIS GREY", 
  "RAND BEIGE", "RAND BLACK", "RAND IVORY", "REED GREEN", "ROMA LIGHT GREY", 
  "ROMA TRAVENTINE", "SALT BLACK", "SANDUNE BEIGE", "SENSO WHITE", "SHIRONE PEACH", 
  "SHIRONE PEACH DECOR", "SHIRONE PEACH DÉCOR", "SILVER RIVER PURE", 
  "SILVER RIVER PURE GRADE", "SMOKE", "STATUARIETTO", "STATUARIO", "STATUARIO ALTISSIMO", 
  "STATUARIO GOLD", "STATUARIO GOLD (MACHIA)", "STATUARIO NUVOLATO", "STATUARIO VENATINO", 
  "TAJ MAHAL", "TAJ MAHAL BIANCO", "TEAK WOOD CREAM", "TRAVERTINO ANGLE", "VANILLA CREAM", 
  "VERDE ALPI", "VERDE CALACATTA", "VERDE LAPPONIA", "VERONICA ARBESQUE", "VERSACE GOLD", 
  "WALNUT", "WHITE MATT", "WHITE SALT", "WOOD WHITE"
];

interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: Array<string | SearchableSelectOption>;
  placeholder?: string;
  disabled?: boolean;
}

function SearchableSelect({ value, onChange, options, placeholder = "Search...", disabled = false }: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const normalizedOptions = useMemo(() => {
    return options.map((opt) => {
      if (typeof opt === "string") {
        return { value: opt, label: opt };
      }
      return opt;
    });
  }, [options]);

  const selectedLabel = useMemo(() => {
    const found = normalizedOptions.find((opt) => opt.value === value);
    return found ? found.label : (value || "Select...");
  }, [normalizedOptions, value]);

  const filteredOptions = useMemo(() => {
    return normalizedOptions.filter((opt) =>
      opt.label.toLowerCase().includes(search.toLowerCase()) ||
      opt.value.toLowerCase().includes(search.toLowerCase())
    );
  }, [normalizedOptions, search]);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
    }
  }, [isOpen]);

  return (
    <div className={`searchable-select-container ${disabled ? "disabled" : ""}`} ref={containerRef}>
      <div 
        className="searchable-select-trigger" 
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={disabled ? { background: "#efe9dd", color: "#8a8275", cursor: "not-allowed" } : {}}
      >
        <span>{selectedLabel}</span>
        <span className="arrow">▼</span>
      </div>
      {isOpen && !disabled && (
        <div className="searchable-select-dropdown">
          <div className="search-box-wrapper">
            <input
              type="text"
              className="search-input"
              placeholder={placeholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="options-list">
            {filteredOptions.length === 0 ? (
              <div className="no-options">No matches found</div>
            ) : (
              filteredOptions.map((opt) => (
                <div
                  key={opt.value}
                  className={`option-item ${opt.value === value ? "selected" : ""}`}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                >
                  {opt.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface AggregatedStone {
  key: string;
  category: "carcass" | "shutter";
  finish: string;
  thickness: number;
  netSqft: number;
}

interface AggregatedProfile {
  key: string;
  category: "carcass" | "shutter";
  profileCode: string;
  finish: string;
  lenMeters: number;
}

interface AggregatedHardware {
  key: string;
  name: string;
  uom: string;
  totalQty: number;
}

function parseCabinetCodeToModel(
  code: string,
  currentDesign: string = "MD1",
  overrides?: { carcassMat?: string; shutterMat?: string; profileColor?: string },
): CarcassModel | null {
  try {
    if (!code) return null;
    // Current cabinet code (11 fields + optional finish suffix):
    //   p1 - p2 - handleToken(CJ|STD) - matToken(GL|ST) - p3 - p4 - p5 - W - H - D - t - [carcassMat(-shutterMat)]
    const cleanCode = code.split("-SO-")[0].trim();
    const parts = cleanCode.split("-");
    if (parts.length < 11) return null;
    const zk = parts[0];
    const Z = ZONES[zk];
    if (!Z) return null;
    const p2 = parts[1];
    const handleToken = parts[2];
    const matToken = parts[3];
    const p3 = parts[4];
    const p4 = parts[5];
    const p5 = parts[6];
    const W = parseInt(parts[7]);
    const H = parseInt(parts[8]);
    const D = parseInt(parts[9]);
    const t = parseInt(parts[10]);
    if (isNaN(W) || isNaN(H) || isNaN(D) || isNaN(t)) return null;

    // Resolve family by its p2 code, disambiguating shared p2 (e.g. WGL/WST both "SH") by
    // the glass/stone material token, then by a matching variant p3 (e.g. BPO vs WBP).
    const fams = famSetOf(zk);
    let candidates = Object.keys(fams).filter((k) => fams[k].p2 === p2);
    if (candidates.length === 0) return null;
    if (candidates.length > 1) {
      const wantGlass = matToken === "GL";
      const byGlass = candidates.filter((k) => isGlassShutterFam(k) === wantGlass);
      if (byGlass.length === 1) candidates = byGlass;
      else {
        const byP3 = (byGlass.length ? byGlass : candidates).filter((k) =>
          fams[k].variants.some((v: any) => (v.p3 || "XXX") === p3)
        );
        if (byP3.length) candidates = byP3;
        else if (byGlass.length) candidates = byGlass;
      }
    }
    const fk = candidates[0];
    const familyObj = fams[fk];

    // Resolve variant: a "2HS" token means double-door; otherwise match the single/handed
    // variant by p3 (falling back to the first non-double variant).
    const isDouble = [p3, p4, p5].includes("2HS");
    const isDoubleVar = (v: any) => !!(v.both || v.double || /double|dbl/i.test((v.id || "") + (v.label || "")));
    let variantObj: any;
    if (isDouble) {
      variantObj = familyObj.variants.find(isDoubleVar);
    } else {
      variantObj =
        familyObj.variants.find((v: any) => (v.p3 || "XXX") === p3 && !isDoubleVar(v)) ||
        familyObj.variants.find((v: any) => !isDoubleVar(v));
    }
    variantObj = variantObj || familyObj.variants[0];

    const hand = [p4, p5].includes("RHS") ? "RHS" : "LHS";
    const handle = handleToken === "CJ" ? "XCJ" : "STD";

    // Finish suffix: "carcass-shutter" (dual) or single finish. Finishes are space-delimited,
    // so the dual form splits cleanly on the first "-".
    const matPart = parts.slice(11).join("-");
    let carcassMat = "STATUARIO";
    let shutterMat = "STATUARIO";
    if (matPart) {
      if (matPart.includes("/")) {
        const [cMat, sMat] = matPart.split("/");
        carcassMat = cMat;
        shutterMat = sMat;
      } else {
        const segs = matPart.split("-");
        if (segs.length >= 2) {
          carcassMat = segs[0];
          shutterMat = segs.slice(1).join("-");
        } else {
          carcassMat = shutterMat = matPart;
        }
      }
    }

    // Explicit overrides (Designer-page Excel upload) win over the code's finish suffix.
    if (overrides?.carcassMat) carcassMat = overrides.carcassMat;
    if (overrides?.shutterMat !== undefined) shutterMat = overrides.shutterMat;
    const profCol = overrides?.profileColor || "CHAMPAGNE";

    return buildModel(zk, fk, variantObj, handle, currentDesign, carcassMat, shutterMat, profCol, profCol, W, H, D, t, hand);
  } catch (e) {
    console.warn("Error parsing cabinet code:", code, e);
    return null;
  }
}

type ItemCustomFields = {
  group?: string;
  subGroup?: string;
  finish?: string;
  thickness?: string;
  height?: string;
  width?: string;
  depth?: string;
};

function normalizeItemName(s: string | undefined | null): string {
  return String(s ?? "")
    .replace(/\s+/g, " ") // collapse runs of whitespace to a single space
    .trim()
    .toLowerCase();
}

async function searchItemByName(name: string): Promise<any | null> {
  const cleanName = normalizePartOrPanelName(name);
  const target = normalizeItemName(cleanName);

  const findMatch = (items: any[]) =>
    items.find(
      (it: any) =>
        normalizeItemName(it.name) === target || normalizeItemName(it.sku) === target,
    );

  const res = await fetch(`/api/zoho/items?search=${encodeURIComponent(cleanName)}`);
  if (res.ok) {
    const data = await res.json();
    const items = data.items || [];
    const match = findMatch(items);
    if (match) return match;
  }
  const fallbackRes = await fetch(`/api/zoho/items?name=${encodeURIComponent(cleanName)}`);
  if (fallbackRes.ok) {
    const fallbackData = await fallbackRes.json();
    const fallbackItems = fallbackData.items || [];
    const fallbackMatch = findMatch(fallbackItems);
    if (fallbackMatch) return fallbackMatch;
  }
  return null;
}

async function resolveSimpleItem(name: string, isService: boolean = false, customFields?: ItemCustomFields, uom?: string): Promise<string> {
  const normName = normalizePartOrPanelName(name);
  const existing = await searchItemByName(normName);
  if (existing) return existing.item_id;

  const cf: Array<{ api_name: string; value: string }> = [];
  if (customFields?.group) cf.push({ api_name: "cf_group", value: customFields.group });
  if (customFields?.subGroup) cf.push({ api_name: "cf_sub_group", value: customFields.subGroup });
  if (customFields?.finish) cf.push({ api_name: "cf_finish", value: customFields.finish });
  if (customFields?.thickness) cf.push({ api_name: "cf_thickness", value: customFields.thickness });
  if (customFields?.height) cf.push({ api_name: "cf_height", value: customFields.height });
  if (customFields?.width) cf.push({ api_name: "cf_width", value: customFields.width });
  if (customFields?.depth) cf.push({ api_name: "cf_depth", value: customFields.depth });

  // Determine unit: explicit uom > inferred from name > default
  let unit = uom || "";
  if (!unit) {
    const lower = normName.toLowerCase();
    if (lower.includes("set")) unit = "pcs";
    else if (lower.includes("kg") || lower.includes("glue")) unit = "Kg";
    else if (lower.includes("ml") || lower.includes("silicone")) unit = "ML";
    else if (lower.includes("mtr") || lower.includes("wire")) unit = "Mtr";
    else if (lower.includes("mm") || lower.includes("led") || lower.includes("diffuser") || lower.includes("tape") || lower.includes("prof")) unit = "MM";
  }

  const payload: any = {
    name: normName,
    sku: normName,
    rate: 0,
    purchase_rate: 0,
    can_be_sold: true,
    can_be_purchased: true,
    account_id: "3418412000000000486",
    purchase_account_id: "3418412000000000567",
    is_taxable: true
  };
  if (cf.length > 0) payload.custom_fields = cf;
  if (isService) {
    payload.product_type = "service";
  } else {
    payload.inventory_account_id = "3418412000000000626";
    payload.track_inventory = true;
    // Omit unit field for now to avoid UOM creation restrictions in Zoho
    // payload.unit = unit;
  }

  const createRes = await fetch("/api/zoho/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(`Failed to create item "${name}": ${errData.error || createRes.statusText}`);
  }
  const createData = await createRes.json();
  return createData.item.item_id;
}

function truncZoho(s: string, max = 100): string {
  return s.length <= max ? s : s.slice(0, max);
}

async function resolveCompositeItem(
  rawName: string,
  rawSku: string,
  mappedItems: Array<{ item_id: string; quantity: number }>,
  customFields?: ItemCustomFields
): Promise<string> {
  const normName = normalizePartOrPanelName(rawName);
  const normSku = normalizePartOrPanelName(rawSku);
  const name = truncZoho(normName);
  const sku = truncZoho(normSku);
  const existing = await searchItemByName(name);
  if (existing) {
    return existing.item_id || existing.composite_item_id;
  }

  // Ensure at least 2 mapped items if the single item has quantity <= 1
  let finalMappedItems = [...mappedItems];
  if (finalMappedItems.length === 1 && finalMappedItems[0].quantity <= 1) {
    if (name !== "Drilling-1") {
      try {
        const drillingId = await resolveSimpleItem("Drilling-1", true);
        if (drillingId && finalMappedItems[0].item_id !== drillingId) {
          finalMappedItems.push({ item_id: drillingId, quantity: 1 });
        }
      } catch (e) {
        console.error("Failed to auto-append Drilling-1 service:", e);
      }
    }
  }

  const cf: Array<{ api_name: string; value: string }> = [];
  if (customFields?.group) cf.push({ api_name: "cf_group", value: customFields.group });
  if (customFields?.subGroup) cf.push({ api_name: "cf_sub_group", value: customFields.subGroup });
  if (customFields?.finish) cf.push({ api_name: "cf_finish", value: customFields.finish });
  if (customFields?.thickness) cf.push({ api_name: "cf_thickness", value: customFields.thickness });
  if (customFields?.height) cf.push({ api_name: "cf_height", value: customFields.height });
  if (customFields?.width) cf.push({ api_name: "cf_width", value: customFields.width });
  if (customFields?.depth) cf.push({ api_name: "cf_depth", value: customFields.depth });

  const compositePayload: any = {
    name,
    sku,
    rate: 0,
    purchase_rate: 0,
    can_be_sold: true,
    can_be_purchased: true,
    account_id: "3418412000000000486",
    purchase_account_id: "3418412000000000567",
    inventory_account_id: "3418412000000000626",
    track_inventory: true,
    is_taxable: true,
    unit: "pcs",
    mapped_items: finalMappedItems
  };
  if (cf.length > 0) compositePayload.custom_fields = cf;

  const createRes = await fetch("/api/zoho/compositeitems", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(compositePayload)
  });

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(`Failed to create composite item "${name}": ${errData.error || createRes.statusText}`);
  }

  const createData = await createRes.json();
  return createData.compositeItem.composite_item_id || createData.compositeItem.item_id;
}

async function findExistingCompositeByRawMaterial(rawMaterialId: string, itemName: string): Promise<string | null> {
  const cleanName = normalizePartOrPanelName(itemName);
  let items: any[] = [];
  const searchRes = await fetch(`/api/zoho/items?search=${encodeURIComponent(cleanName)}`);
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    items = searchData.items || [];
  }
  if (items.length === 0) {
    const fallbackRes = await fetch(`/api/zoho/items?name=${encodeURIComponent(cleanName)}`);
    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      items = fallbackData.items || [];
    }
  }

  for (const item of items) {
    const itemId = item.item_id || item.composite_item_id;
    if (!itemId) continue;
    if (item.is_combo_product === true || item.is_combo_product === "true" || item.item_type === "composite") {
      try {
        const detailRes = await fetch(`/api/zoho/compositeitems/${encodeURIComponent(itemId)}`);
        if (!detailRes.ok) continue;
        const detailData = await detailRes.json();
        const composite = detailData.compositeItem;
        if (!composite) continue;
        const mapped = composite.mapped_items || composite.composite_item_line_items || composite.bundle_items || composite.line_items || composite.items || [];
        const hasRawMaterial = mapped.some((m: any) => m.item_id === rawMaterialId);
        if (hasRawMaterial) return itemId;
      } catch {
        continue;
      }
    }
  }
  return null;
}

const NO_DRILL_PROFILES = new Set(["STP", "ELEN", "SLF", "SINK"]);

async function resolveProfileBOM(
  profileCode: string,
  finish: string,
  lengths: Array<{ len: number; qty: number; name: string }>,
  rawProfileId: string,
  cuttingServiceId: string,
  drillingServiceId: string,
  ctx: { soPrefix: string; subGroup: string; parentGroup: "Carcass" | "Shutters"; dims: { W: number; H: number; D: number; t: number }; vDrill?: { lh: string; rh: string } }
): Promise<string[]> {
  if (profileCode.toUpperCase() === "ELEN") {
    return [];
  }
  const noDrill = NO_DRILL_PROFILES.has(profileCode.toUpperCase());
  // Optional per-side drill labels mirroring the carcass side-panel drilling.
  const lhTag = ctx.vDrill ? `(${ctx.vDrill.lh})` : "";
  const rhTag = ctx.vDrill ? `(${ctx.vDrill.rh})` : "";
  const vSideLabel = ctx.vDrill ? `LH${lhTag}+RH${rhTag}` : "(LH/RH)";
  const verticalChildren: Array<{ item_id: string; quantity: number }> = [];
  const horizontalChildren: Array<{ item_id: string; quantity: number }> = [];
  const otherChildren: Array<{ item_id: string; quantity: number }> = [];

  for (const { len, qty, name } of lengths) {
    const panelCf: ItemCustomFields = {
      group: "Profile",
      subGroup: ctx.subGroup,
      finish,
      height: String(len)
    };
    const isVertical = /(^|\s|\()(V|vertical|LH[+/]RH|LH|RH|ELEN)(\s|\)|$)/i.test(name);
    const isHorizontal = /(^|\s|\()(H|horizontal|TP[+/]BT|TP|BT|edge)(\s|\)|$)/i.test(name);

    // Cleaned name for the individual LH/RH/Top/Bottom Parts (strips everything including LH/RH, TP/BT)
    const cleanedNameForPart = name
      .replace(/(LH[+/]RH|TP[+/]BT)/gi, "")
      .replace(/\b(V|H|LH|RH|TP|BT|Top|Bottom|vertical|horizontal|edge)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    // Cleaned name for the profile Panel (keeps LH/RH, TP/BT, but strips single-side indicators)
    const cleanedNameForPanel = name
      .replace(/\b(V|H|Top|Bottom|vertical|horizontal|edge)\b/gi, "")
      .replace(/LH\+RH/gi, "LH/RH")
      .replace(/TP\+BT/gi, "TP/BT")
      .replace(/\s+/g, " ")
      .trim();

    // Level 4: Profile Panel (common uncut profile)
    let pPanelName = `${cleanedNameForPanel} ${len}mm ${finish}`;
    const existingPanel = await findExistingCompositeByRawMaterial(rawProfileId, pPanelName);
    let pPanelId: string;
    if (existingPanel) {
      pPanelId = existingPanel;
    } else {
      if (ctx.soPrefix) pPanelName = `${ctx.soPrefix} ${pPanelName}`;
      const wasteFactor = profileCode.toUpperCase() === "ELEN" ? ELENOR_WASTE : PROFILE_WASTE;
      const reqLen = (len / 1000) * (1 + wasteFactor);
      const roundedLen = Math.round(reqLen * 10000) / 10000;
      const pPanelMappedItems = [
        { item_id: rawProfileId, quantity: roundedLen },
        { item_id: cuttingServiceId, quantity: 1 }
      ];
      pPanelId = await resolveCompositeItem(pPanelName, pPanelName, pPanelMappedItems, panelCf);
    }

    if (noDrill) {
      // No-drill profiles (STP, ELEN, SLF): panel goes directly into sub-set with qty
      if (isVertical) {
        verticalChildren.push({ item_id: pPanelId, quantity: qty });
      } else if (isHorizontal) {
        horizontalChildren.push({ item_id: pPanelId, quantity: qty });
      } else {
        otherChildren.push({ item_id: pPanelId, quantity: qty });
      }
    } else {
      // Drill profiles (MD1, MD2, CL1, CL2, NEON, etc.): Part level with drilling
      const partCf: ItemCustomFields = {
        group: "Profile - Part",
        subGroup: ctx.subGroup,
        finish,
        height: String(len)
      };

      if (qty === 2 && (isVertical || isHorizontal)) {
        if (isVertical) {
          const lhBase = `Part Profile LH${lhTag} ${cleanedNameForPart} ${len}mm ${finish}`.replace(/\s+/g, " ").trim();
          const rhBase = `Part Profile RH${rhTag} ${cleanedNameForPart} ${len}mm ${finish}`.replace(/\s+/g, " ").trim();
          const pPartLhName = ctx.soPrefix && !existingPanel ? `${ctx.soPrefix} ${lhBase}` : lhBase;
          const pPartRhName = ctx.soPrefix && !existingPanel ? `${ctx.soPrefix} ${rhBase}` : rhBase;

          const pPartLhId = await resolveCompositeItem(pPartLhName, pPartLhName, [
            { item_id: pPanelId, quantity: 1 },
            { item_id: drillingServiceId, quantity: 1 }
          ], partCf);

          const pPartRhId = await resolveCompositeItem(pPartRhName, pPartRhName, [
            { item_id: pPanelId, quantity: 1 },
            { item_id: drillingServiceId, quantity: 1 }
          ], partCf);

          verticalChildren.push({ item_id: pPartLhId, quantity: 1 });
          verticalChildren.push({ item_id: pPartRhId, quantity: 1 });
        } else {
          const topBase = `Part Profile Top ${cleanedNameForPart} ${len}mm ${finish}`;
          const btmBase = `Part Profile Bottom ${cleanedNameForPart} ${len}mm ${finish}`;
          const pPartTopName = ctx.soPrefix && !existingPanel ? `${ctx.soPrefix} ${topBase}` : topBase;
          const pPartBottomName = ctx.soPrefix && !existingPanel ? `${ctx.soPrefix} ${btmBase}` : btmBase;

          const pPartTopId = await resolveCompositeItem(pPartTopName, pPartTopName, [
            { item_id: pPanelId, quantity: 1 },
            { item_id: drillingServiceId, quantity: 1 }
          ], partCf);

          const pPartBottomId = await resolveCompositeItem(pPartBottomName, pPartBottomName, [
            { item_id: pPanelId, quantity: 1 },
            { item_id: drillingServiceId, quantity: 1 }
          ], partCf);

          horizontalChildren.push({ item_id: pPartTopId, quantity: 1 });
          horizontalChildren.push({ item_id: pPartBottomId, quantity: 1 });
        }
      } else {
        const partBase = `Part Profile ${cleanedNameForPart} ${len}mm ${finish}`;
        const pPartName = ctx.soPrefix && !existingPanel ? `${ctx.soPrefix} ${partBase}` : partBase;
        const pPartId = await resolveCompositeItem(pPartName, pPartName, [
          { item_id: pPanelId, quantity: 1 },
          { item_id: drillingServiceId, quantity: 1 }
        ], partCf);

        otherChildren.push({ item_id: pPartId, quantity: qty });
      }
    }
  }

  const setIds: string[] = [];
  const setCf: ItemCustomFields = {
    group: "Profile Pack",
    subGroup: ctx.subGroup,
    finish
  };

  if (noDrill) {
    // No-drill: create sub-sets, then wrap in a parent set
    const subSetIds: Array<{ item_id: string; quantity: number }> = [];

    if (verticalChildren.length > 0) {
      const base = `Set of Profile ${profileCode} ${finish} ${vSideLabel}`;
      const setName = ctx.soPrefix ? `${ctx.soPrefix} ${base}` : base;
      const subId = await resolveCompositeItem(setName, setName, verticalChildren, setCf);
      subSetIds.push({ item_id: subId, quantity: 1 });
    }
    if (horizontalChildren.length > 0) {
      const base = `Set of Profile ${profileCode} ${finish} (TP/BT)`;
      const setName = ctx.soPrefix ? `${ctx.soPrefix} ${base}` : base;
      const subId = await resolveCompositeItem(setName, setName, horizontalChildren, setCf);
      subSetIds.push({ item_id: subId, quantity: 1 });
    }
    if (otherChildren.length > 0) {
      const base = `Set of Profile ${profileCode} ${finish}`;
      const setName = ctx.soPrefix ? `${ctx.soPrefix} ${base}` : base;
      const subId = await resolveCompositeItem(setName, setName, otherChildren, setCf);
      subSetIds.push({ item_id: subId, quantity: 1 });
    }

    if (subSetIds.length > 0) {
      const parentBase = `Set of Profile ${profileCode} ${finish} ${ctx.vDrill ? `${vSideLabel}+TP/BT` : "LH/RH+TP/BT"}`;
      const parentName = ctx.soPrefix ? `${ctx.soPrefix} ${parentBase}` : parentBase;
      const parentId = await resolveCompositeItem(parentName, parentName, subSetIds, setCf);
      setIds.push(parentId);
    }
  } else {
    // Drill profiles: separate sets, no parent wrapper
    if (verticalChildren.length > 0) {
      const base = `Set of Profile Parts ${profileCode} ${finish} ${vSideLabel}`;
      const setName = ctx.soPrefix ? `${ctx.soPrefix} ${base}` : base;
      setIds.push(await resolveCompositeItem(setName, setName, verticalChildren, setCf));
    }
    if (horizontalChildren.length > 0) {
      const base = `Set of Profile Parts ${profileCode} ${finish} (TP/BT)`;
      const setName = ctx.soPrefix ? `${ctx.soPrefix} ${base}` : base;
      setIds.push(await resolveCompositeItem(setName, setName, horizontalChildren, setCf));
    }
    if (otherChildren.length > 0) {
      const base = `Set of Profile Parts ${profileCode} ${finish}`;
      const setName = ctx.soPrefix ? `${ctx.soPrefix} ${base}` : base;
      setIds.push(await resolveCompositeItem(setName, setName, otherChildren, setCf));
    }
  }

  return setIds;
}

const HARDWARE_PACK_DEFINITIONS: Record<string, Array<{ component: string; qty: number; uom: string }>> = {
  "HARDWARE PACK 3D HINGE 0 CRANK Set/3": [
    { component: "HINGE 0 CRANK SOFT CLOSE 5 HOLE XX BLACK 3D MS CRY", qty: 3, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 12, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK 3D HINGE 0 CRANK Set/4": [
    { component: "HINGE 0 CRANK SOFT CLOSE 5 HOLE XX BLACK 3D MS CRY", qty: 4, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 16, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK 3D HINGE 0 CRANK Set/6": [
    { component: "HINGE 0 CRANK SOFT CLOSE 5 HOLE XX BLACK 3D MS CRY", qty: 6, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 24, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK HINGE 0 CRANK CARCASS Set/3": [
    { component: "HINGE 0 CRANK W/OUT SOFT CLOSE 95 DEG XX GUN BLACK DPW-209 LIAN", qty: 3, uom: "PCS" }
  ],
  // Glass shutter hinge (slim, for alu profile) — used by all glass-shutter families.
  "HARDWARE PACK SLIM HINGE FOR GLASS Set/3": [
    { component: "HINGE SLIM FOR ALU PROFILE 0 CRANK SOFT CLOSE 95 DEG XX GUN BLACK DPOA-209 LIAN", qty: 3, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 12, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK SLIM HINGE FOR GLASS Set/4": [
    { component: "HINGE SLIM FOR ALU PROFILE 0 CRANK SOFT CLOSE 95 DEG XX GUN BLACK DPOA-209 LIAN", qty: 4, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 16, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK SLIM HINGE FOR GLASS Set/5": [
    { component: "HINGE SLIM FOR ALU PROFILE 0 CRANK SOFT CLOSE 95 DEG XX GUN BLACK DPOA-209 LIAN", qty: 5, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 20, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK SLIM HINGE FOR GLASS Set/6": [
    { component: "HINGE SLIM FOR ALU PROFILE 0 CRANK SOFT CLOSE 95 DEG XX GUN BLACK DPOA-209 LIAN", qty: 6, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 24, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  // Loft shutter hinge (without soft close — closing is by the Tip-On). All loft zones.
  "HARDWARE PACK HINGE W/OUT SOFT CLOSE Set/3": [
    { component: "HINGE 0 CRANK W/OUT SOFT CLOSE 95 DEG XX GUN BLACK DPW-209 LIAN", qty: 3, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 12, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK HINGE W/OUT SOFT CLOSE Set/4": [
    { component: "HINGE 0 CRANK W/OUT SOFT CLOSE 95 DEG XX GUN BLACK DPW-209 LIAN", qty: 4, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 16, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK HINGE W/OUT SOFT CLOSE Set/5": [
    { component: "HINGE 0 CRANK W/OUT SOFT CLOSE 95 DEG XX GUN BLACK DPW-209 LIAN", qty: 5, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 20, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK HINGE W/OUT SOFT CLOSE Set/6": [
    { component: "HINGE 0 CRANK W/OUT SOFT CLOSE 95 DEG XX GUN BLACK DPW-209 LIAN", qty: 6, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 24, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK SLIM HINGE 0 CRANK Set/3": [
    { component: "HINGE 0 CRANK SOFT CLOSE FOR SLIM SHUTTER XX BLACK MS CRY", qty: 3, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 6, uom: "PCS" },
    { component: "SCREW FOR HANDLE 8XX4 CINE", qty: 6, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK SLIM HINGE 0 CRANK Set/5": [
    { component: "HINGE 0 CRANK SOFT CLOSE FOR SLIM SHUTTER XX BLACK MS CRY", qty: 5, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 10, uom: "PCS" },
    { component: "SCREW FOR HANDLE 8XX4 CINE", qty: 10, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK BLIND HINGE 0 CRANK Set/3": [
    { component: "HINGE 0 CRANK SOFT CLOSE 95 DEG XX GUN BLACK DKP90 LIAN", qty: 3, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 6, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK BLIND HINGE 0 CRANK Set/4": [
    { component: "HINGE 0 CRANK SOFT CLOSE 95 DEG XX GUN BLACK DKP90 LIAN", qty: 4, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 8, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK BLIND HINGE 0 CRANK Set/6": [
    { component: "HINGE 0 CRANK SOFT CLOSE 95 DEG XX GUN BLACK DKP90 LIAN", qty: 6, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 12, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK PVC LEG SET/2": [
    { component: "LEG PVC TRIAGLE MOUNTING BRACKET XX100 BLACK REH", qty: 2, uom: "PCS" },
    { component: "GLUE BONDTITE FAST & CLEAR FOR STONE XX AGG", qty: 0.04, uom: "Kg" },
    { component: "SKIRTING CLIP FOR Q PLINTH LEG XX25 WHITE REH", qty: 2, uom: "PCS" }
  ],
  "HARDWARE PACK PVC LEG SET/4": [
    { component: "LEG PVC TRIAGLE MOUNTING BRACKET XX100 BLACK REH", qty: 4, uom: "PCS" },
    { component: "GLUE BONDTITE FAST & CLEAR FOR STONE XX AGG", qty: 0.08, uom: "Kg" },
    { component: "SKIRTING CLIP FOR Q PLINTH LEG XX25 WHITE REH", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK PVC LEG SET/6": [
    { component: "LEG PVC TRIAGLE MOUNTING BRACKET XX100 BLACK REH", qty: 6, uom: "PCS" },
    { component: "GLUE BONDTITE FAST & CLEAR FOR STONE XX AGG", qty: 0.12, uom: "Kg" },
    { component: "SKIRTING CLIP FOR Q PLINTH LEG XX25 WHITE REH", qty: 6, uom: "PCS" }
  ],
  "HARDWARE PACK CARCASS FIXING HPL 4 SET/1": [
    { component: "HPL 2.5 MM CARCASS FIXING 9X400", qty: 4, uom: "PCS" },
    { component: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: 80, uom: "ML" }
  ],
  "HARDWARE PACK LOW BACK DRAWER H90 SET/1": [
    { component: "DRAWER TANDEM SOFT CLOSE LB 500XX90 GRAPHITE GREY TD30-16-90-500 LIAN", qty: 1, uom: "SET" },
    { component: "INSERT NYLON FOR STONE W/O THREAD 10X3.5X MOD", qty: 4, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 13XX4.8 SS 304 CINE", qty: 12, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK LOW BACK DRAWER H90 SET/2": [
    { component: "DRAWER TANDEM SOFT CLOSE LB 500XX90 GRAPHITE GREY TD30-16-90-500 LIAN", qty: 2, uom: "SET" },
    { component: "INSERT NYLON FOR STONE W/O THREAD 10X3.5X MOD", qty: 8, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 13XX4.8 SS 304 CINE", qty: 24, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 8, uom: "PCS" }
  ],
  "HARDWARE PACK LOW BACK DRAWER H90 SET/3": [
    { component: "DRAWER TANDEM SOFT CLOSE LB 500XX90 GRAPHITE GREY TD30-16-90-500 LIAN", qty: 3, uom: "SET" },
    { component: "INSERT NYLON FOR STONE W/O THREAD 10X3.5X MOD", qty: 12, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 13XX4.8 SS 304 CINE", qty: 12, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 12, uom: "PCS" }
  ],
  "HARDWARE PACK HIGH BACK DRAWER H175 SET/2": [
    { component: "DRAWER TANDEM SOFT CLOSE HB 500XX175 GRAPHITE GREY TD30-16-175-500 LIAN", qty: 2, uom: "SET" },
    { component: "INSERT NYLON FOR STONE W/O THREAD 10X3.5X MOD", qty: 8, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 13XX4.8 SS 304 CINE", qty: 24, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 8, uom: "PCS" }
  ],
  "HARDWARE PACK HIGH BACK DRAWER H239 SET/1": [
    { component: "DRAWER TANDEM SOFT CLOSE HB 500XX239 GRAPHITE GREY TD30-16-239-500 LIAN", qty: 1, uom: "SET" },
    { component: "INSERT NYLON FOR STONE W/O THREAD 10X3.5X MOD", qty: 4, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 13XX4.8 SS 304 CINE", qty: 12, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 4, uom: "PCS" }
  ],
  "HARDWARE PACK HIGH BACK DRAWER H239 SET/2": [
    { component: "DRAWER TANDEM SOFT CLOSE HB 500XX239 GRAPHITE GREY TD30-16-239-500 LIAN", qty: 2, uom: "SET" },
    { component: "INSERT NYLON FOR STONE W/O THREAD 10X3.5X MOD", qty: 8, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 13XX4.8 SS 304 CINE", qty: 24, uom: "PCS" },
    { component: "DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC", qty: 8, uom: "PCS" }
  ],
  "HARDWARE PACK WALL HANGER BRACKET SET/1": [
    { component: "COVER CAP LH CABINET COVER 080.062.038112 85XX WHITE K018.C01L.906 003.012.00077 FTL", qty: 1, uom: "SET" },
    { component: "COVER CAP RH CABINET COVER 080.062.03811 85XX WHITE K018.C01R.906 003.012.00078 FTL", qty: 1, uom: "PCS" },
    { component: "HANGER CABINET RAIL W WGHT 080.062.03619 70X60X6 K018.A000.101 003.008.00048 FTL", qty: 2, uom: "PCS" },
    { component: "INSERT PVC 120XX8 RED HILTI", qty: 8, uom: "PCS" },
    { component: "PVC PACKING FOR WALL HANGING 100X100X12 K018 LOC", qty: 2, uom: "PCS" }
  ],
  "HARDWARE PACK HB DRAWER 600MM FIXING SET/1": [
    { component: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: 50, uom: "ML" },
    { component: "SCREW FOR HANDLE 8XX4 CINE", qty: 4, uom: "Pcs" }
  ],
  "HARDWARE PACK DRAWER 450MM FIXING SET/1": [
    { component: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: 40, uom: "ML" },
    { component: "SCREW FOR HANDLE 8XX4 CINE", qty: 4, uom: "Pcs" }
  ],
  "HARDWARE PACK DRAWER 600MM FIXING SET/1": [
    { component: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: 60, uom: "ML" },
    { component: "SCREW FOR HANDLE 8XX4 CINE", qty: 4, uom: "Pcs" }
  ],
  "HARDWARE PACK DRAWER 900MM FIXING SET/1": [
    { component: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: 80, uom: "ML" },
    { component: "SCREW FOR HANDLE 8XX4 CINE", qty: 4, uom: "Pcs" }
  ],
  "HARDWARE PACK BOTTLE PULLOUT 150MM SET/1": [
    { component: "BOTTLE PULLOUT UNIVERSAL 465X155X580 GREY 304162 HI GOLD", qty: 1, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 10, uom: "Pcs" }
  ],
  "HARDWARE PACK BOTTLE PULLOUT 300MM SET/1": [
    { component: "BOTTLE PULLOUT THREE LAYERS 470X264X552 GREY 3183001 NOUMI", qty: 1, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 10, uom: "Pcs" }
  ],
  "HARDWARE PACK KAKU FITTING SET/4": [
    { component: "KAKU FITTING FOR DUMMY PANEL FIXING XX BLACK CRY", qty: 4, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 16, uom: "Pcs" }
  ],
  "HARDWARE PACK KAKU FITTING SET/2": [
    { component: "KAKU FITTING FOR DUMMY PANEL FIXING XX BLACK CRY", qty: 2, uom: "PCS" },
    { component: "SCREW FOR CHIP BOARD 16XX4 SS 304 CINE", qty: 8, uom: "Pcs" }
  ]
};

async function resolveHardwarePackComposite(
  packName: string,
  customFields?: ItemCustomFields
): Promise<string> {
  const existingPack = await searchItemByName(packName);
  if (existingPack) {
    return existingPack.item_id || existingPack.composite_item_id;
  }

  const def = HARDWARE_PACK_DEFINITIONS[packName];
  const hwCf: ItemCustomFields = { group: "Hardware Pack", ...customFields };

  if (def) {
    const mappedItems: Array<{ item_id: string; quantity: number }> = [];
    for (const comp of def) {
      const compId = await resolveSimpleItem(
        comp.component,
        false,
        { group: "Hardware Part", ...customFields },
        comp.uom
      );
      mappedItems.push({ item_id: compId, quantity: comp.qty });
    }
    return await resolveCompositeItem(packName, packName, mappedItems, hwCf);
  } else {
    // Fallback: create as simple item if not defined in sheet
    return await resolveSimpleItem(packName, false, hwCf, "Set");
  }
}

async function resolveHardwarePack(
  hardwareName: string,
  qty: number,
  packingHardwareId: string,
  customFields?: ItemCustomFields
): Promise<string> {
  const hwCf: ItemCustomFields = { group: "Hardware Part", ...customFields };
  const physicalHardwareId = await resolveSimpleItem(hardwareName, false, hwCf);

  const packName = `Pack Hardware ${hardwareName} x${qty}`;
  const packSku = packName;
  const packCf: ItemCustomFields = { group: "Hardware Pack", ...customFields };
  const mappedItems = [
    { item_id: physicalHardwareId, quantity: qty },
    { item_id: packingHardwareId, quantity: 1 }
  ];
  return await resolveCompositeItem(packName, packSku, mappedItems, packCf);
}

export function CarcassBomBuilder({ soMode = false, planningMode = false }: { soMode?: boolean; planningMode?: boolean } = {}) {
  const [zone, setZone] = useState<string>("BC");
  const [family, setFamily] = useState<string>("DW");
  const [variantId, setVariantId] = useState<string>("2dr");
  const [handed, setHanded] = useState<string>("LHS");
  const [handle, setHandle] = useState<string>("XCJ");
  const [design, setDesign] = useState<string>("MD1");
  // Glass-shutter cabinets default to the NEON20 profile and the picker is locked.
  // The user can unlock it to choose another design. Resets to locked when leaving glass.
  const [designUnlocked, setDesignUnlocked] = useState<boolean>(false);
  const [carcassMat, setCarcassMat] = useState<string>("STATUARIO");
  const [shutterMat, setShutterMat] = useState<string>("STATUARIO");
  // Glass shutter face color (shown only for glass-shutter families). For blind glass
  // units the stone `shutterMat` selector doubles as the fixed-panel stone shade.
  const [glassColor, setGlassColor] = useState<string>("CLEAR");
  const [carcassProfileColor, setCarcassProfileColor] = useState<string>("CHAMPAGNE");
  const [shutterProfileColor, setShutterProfileColor] = useState<string>("CHAMPAGNE");
  const [drawerModel, setDrawerModel] = useState<string>("Lian");
  const [tipOn, setTipOn] = useState<string>(TIPON_OPTIONS[0]);
  const [inbuiltDrawers, setInbuiltDrawers] = useState<string>("none");
  const [elevation, setElevation] = useState<string>("");

  const [wSel, setWSel] = useState<string>("600");
  const [hSel, setHSel] = useState<string>("720");
  const [dSel, setDSel] = useState<string>("560");
  const [customW, setCustomW] = useState<number>(600);
  const [customH, setCustomH] = useState<number>(720);
  const [customD, setCustomD] = useState<number>(560);

  const [thickness, setThickness] = useState<number>(15);
  const [tLocked, setTLocked] = useState<boolean>(true);
  const [lineQty, setLineQty] = useState<number>(1);
  const [project, setProject] = useState<ProjectLine[]>([]);
  // Which project line's Main BOM Details panel is expanded (accordion — one at a time).
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"pk" | "raw" | "proj">(soMode ? "proj" : "pk");
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedCsv, setCopiedCsv] = useState<boolean>(false);

  // Accessories state
  const [accessoryRows, setAccessoryRows] = useState<AccessorySubformRow[]>([]);
  const [accessoryCounter, setAccessoryCounter] = useState(0);

  // Other Accessories (panels) state
  const [otherAccRows, setOtherAccRows] = useState<OtherAccRow[]>([]);
  const [otherAccCounter, setOtherAccCounter] = useState(0);

  // Fillers state — dynamic row list (a zone may appear more than once). Row ids are
  // derived from the current list (pure updater → StrictMode-safe, no key collisions).
  const [fillers, setFillers] = useState<FillerRow[]>([]);
  const addFillerRow = () =>
    setFillers((curr) => {
      const nextId = curr.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      return [...curr, { id: nextId, zone: "base", customShade: "", qty: 1, customHeight: "", customWidth: "", elevation: "" }];
    });
  const updateFiller = (id: number, patch: Partial<FillerRow>) =>
    setFillers((curr) => curr.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeFiller = (id: number) => setFillers((curr) => curr.filter((r) => r.id !== id));

  // Visible Panels state — dynamic row list (a zone may appear more than once)
  const [visiblePanels, setVisiblePanels] = useState<VisiblePanelRow[]>([]);
  const addVisiblePanelRow = () =>
    setVisiblePanels((curr) => {
      const nextId = curr.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      return [...curr, { id: nextId, zone: "base", customShade: "", qty: 1, profile: "MD1", customHeight: "", customWidth: "", elevation: "" }];
    });
  const updateVisiblePanel = (id: number, patch: Partial<VisiblePanelRow>) =>
    setVisiblePanels((curr) => curr.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeVisiblePanel = (id: number) => setVisiblePanels((curr) => curr.filter((r) => r.id !== id));

  // Backsplash state — dynamic row list (W, H, Thickness, Colour, Qty)
  const [backsplashes, setBacksplashes] = useState<BacksplashRow[]>([]);
  const addBacksplashRow = () =>
    setBacksplashes((curr) => {
      const nextId = curr.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      return [...curr, { id: nextId, width: "", height: "", thickness: "15", color: "", qty: 1 }];
    });
  const updateBacksplash = (id: number, patch: Partial<BacksplashRow>) =>
    setBacksplashes((curr) => curr.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeBacksplash = (id: number) => setBacksplashes((curr) => curr.filter((r) => r.id !== id));

  // Countertop state — dynamic row list
  const [countertops, setCountertops] = useState<CountertopRow[]>([]);
  const addCountertopRow = () =>
    setCountertops((curr) => {
      const nextId = curr.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      return [...curr, { id: nextId, length: "", depth: "600", thickness: "30", color: "", ctType: 1, edging: "none", edgingHeight: "600", dropHeight: "705", left: "none", right: "none", island: false, baseLight: true, qty: 1 }];
    });
  const updateCountertop = (id: number, patch: Partial<CountertopRow>) =>
    setCountertops((curr) => curr.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeCountertop = (id: number) => setCountertops((curr) => curr.filter((r) => r.id !== id));

  // Stock check state
  const [stockMap, setStockMap] = useState<Record<string, StockItem>>({});
  const [packingFilter, setPackingFilter] = useState<"both" | "carcass" | "shutter">("both");
  const [stockCheckLoading, setStockCheckLoading] = useState(false);

  // Dynamic Finishes States
  const [finishesMap, setFinishesMap] = useState<Record<string, string[]>>(stoneFinishesData as Record<string, string[]>);
  
  const carcassOptions = useMemo(() => {
    return finishesMap[String(thickness)] || [];
  }, [finishesMap, thickness]);

  const shutterOptions = useMemo(() => {
    return finishesMap["6"] || [];
  }, [finishesMap]);

  const profileFinishMap = profileFinishesData as Record<string, string[]>;

  const carcassProfileOptions = useMemo(() => {
    const codes = ["STP", "ELEN"];
    const finishSet = new Set<string>();
    codes.forEach((c) => {
      (profileFinishMap[c] || []).forEach((f) => finishSet.add(f));
    });
    return Array.from(finishSet).sort();
  }, [profileFinishMap]);

  const shutterProfileOptions = useMemo(() => {
    const codes: string[] = [];
    if (/^(MD\d|CL\d|NEON)/.test(design)) {
      const parts = design.match(/(MD\d|CM\d|CL\d|NEON\d*)/g);
      if (parts) codes.push(...parts);
    }
    if (codes.length === 0) codes.push(design);
    const finishSet = new Set<string>();
    codes.forEach((c) => {
      (profileFinishMap[c] || []).forEach((f) => finishSet.add(f));
    });
    return Array.from(finishSet).sort();
  }, [profileFinishMap, design]);

  // Modal States
  const [isFinishModalOpen, setIsFinishModalOpen] = useState(false);
  const [newFinishName, setNewFinishName] = useState("");
  const [newFinishThickness, setNewFinishThickness] = useState("15");
  const [finishModalTarget, setFinishModalTarget] = useState<"carcass" | "shutter">("carcass");
  const [isSavingFinish, setIsSavingFinish] = useState(false);
  const [finishError, setFinishError] = useState("");
  const [finishSuccess, setFinishSuccess] = useState(false);

  // Auto-adjust finishes when options change
  useEffect(() => {
    if (carcassOptions.length > 0 && !carcassOptions.includes(carcassMat)) {
      setCarcassMat(carcassOptions[0]);
    }
  }, [carcassOptions, carcassMat]);

  useEffect(() => {
    if (shutterOptions.length > 0 && !shutterOptions.includes(shutterMat)) {
      setShutterMat(shutterOptions[0]);
    }
  }, [shutterOptions, shutterMat]);

  useEffect(() => {
    if (carcassProfileOptions.length > 0 && !carcassProfileOptions.includes(carcassProfileColor)) {
      setCarcassProfileColor(carcassProfileOptions[0]);
    }
  }, [carcassProfileOptions, carcassProfileColor]);

  useEffect(() => {
    if (shutterProfileOptions.length > 0 && !shutterProfileOptions.includes(shutterProfileColor)) {
      setShutterProfileColor(shutterProfileOptions[0]);
    }
  }, [shutterProfileOptions, shutterProfileColor]);

  const handleSaveFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFinishName.trim()) {
      setFinishError("Finish Name is required.");
      return;
    }
    const tVal = parseInt(newFinishThickness);
    if (isNaN(tVal) || tVal <= 0) {
      setFinishError("Valid thickness is required.");
      return;
    }
    
    setIsSavingFinish(true);
    setFinishError("");
    setFinishSuccess(false);
    
    try {
      const cleanFinishName = newFinishName.trim().toUpperCase();
      const itemName = `STONE ${tVal}MM ${cleanFinishName}`;
      const itemSku = itemName;
      
      const response = await fetch("/api/zoho/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: itemName,
          sku: itemSku,
          rate: 0,
          purchase_rate: 0,
          can_be_sold: true,
          can_be_purchased: true,
          account_id: "3418412000000000486",
          purchase_account_id: "3418412000000000567",
          inventory_account_id: "3418412000000000626",
          track_inventory: true,
          is_taxable: true,
          unit: "pcs",
          custom_fields: [
            {
              api_name: "cf_group",
              value: "Stone"
            },
            {
              api_name: "cf_finish",
              value: cleanFinishName
            },
            {
              api_name: "cf_thickness",
              value: String(tVal)
            },
            {
              api_name: "cf_height",
              value: "2800"
            },
            {
              api_name: "cf_width",
              value: "1200"
            }
          ]
        })
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with status ${response.status}`);
      }
      
      // Update local finishes map
      setFinishesMap((prev) => {
        const key = String(tVal);
        const list = prev[key] || [];
        if (!list.includes(cleanFinishName)) {
          return {
            ...prev,
            [key]: [...list, cleanFinishName].sort()
          };
        }
        return prev;
      });
      
      // Select the new finish
      if (finishModalTarget === "carcass") {
        setThickness(tVal);
        setCarcassMat(cleanFinishName);
      } else {
        setShutterMat(cleanFinishName);
      }
      
      setFinishSuccess(true);
      setTimeout(() => {
        setIsFinishModalOpen(false);
        setNewFinishName("");
        setFinishSuccess(false);
      }, 1000);
      
    } catch (err: any) {
      console.error("Error saving finish:", err);
      setFinishError(err.message || "Failed to create item in Zoho.");
    } finally {
      setIsSavingFinish(false);
    }
  };

  // Zoho Integration States
  const [soQuery, setSoQuery] = useState<string>("");
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [selectedSo, setSelectedSo] = useState<any | null>(null);
  const [loadedSoDetail, setLoadedSoDetail] = useState<any | null>(null);
  const [isSoDetailLoading, setIsSoDetailLoading] = useState<boolean>(false);
  const [soRate, setSoRate] = useState<number>(0);
  const [zohoLoading, setZohoLoading] = useState<boolean>(false);
  const [zohoMessage, setZohoMessage] = useState<string>("");
  const [soSearchError, setSoSearchError] = useState<string>("");

  useEffect(() => {
    if (soQuery.length < 2) {
      setSalesOrders([]);
      setSoSearchError("");
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/zoho/salesorders?q=${encodeURIComponent(soQuery)}`);
        const data = await res.json().catch(() => ({} as any));
        if (res.ok) {
          setSalesOrders(data.salesorders || []);
          setSoSearchError("");
        } else {
          // Surface the Zoho error instead of failing silently (e.g. token cooldown / invalid).
          setSalesOrders([]);
          setSoSearchError(data?.error || "Sales Order search failed — Zoho is unavailable.");
        }
      } catch (err) {
        console.warn("Error searching Sales Orders:", err);
        setSalesOrders([]);
        setSoSearchError("Sales Order search failed — network error.");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [soQuery]);

  useEffect(() => {
    if (!selectedSo) {
      setLoadedSoDetail(null);
      return;
    }
    setIsSoDetailLoading(true);
    fetch(`/api/zoho/salesorders/${encodeURIComponent(selectedSo.salesorder_id)}`)
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error("Failed to fetch Sales Order details");
      })
      .then((data) => {
        setLoadedSoDetail(data.salesorder);
        setIsSoDetailLoading(false);
      })
      .catch((err) => {
        console.warn("Error fetching SO detail:", err);
        setIsSoDetailLoading(false);
      });
  }, [selectedSo]);

  // Sales-Order mode (reverse flow): instead of CREATING cabinet codes, decode the cabinet
  // codes that already live on the selected Zoho Sales Order back into models and drive the
  // Project from them — so the BOM tree, totals and exports all reflect the SO. Selecting an
  // SO replaces the Project; clearing the SO does NOT wipe it (so an Excel upload can stand).
  useEffect(() => {
    if (!soMode) return;
    if (selectedSo && loadedSoDetail?.line_items) {
      const lines: ProjectLine[] = [];
      (loadedSoDetail.line_items as any[]).forEach((line) => {
        // Service line items carry the cabinet code in `description` (sku/name are empty).
        const m = parseCabinetCodeToModel(line.sku || line.name || line.description, design);
        if (m) lines.push({ qty: line.quantity || 1, m, rate: line.rate || 0, elevation: "" });
      });
      setProject(lines);
    }
  }, [soMode, selectedSo, loadedSoDetail, design]);

  // ---- Designer-page Excel upload (cabinet codes → project lines; shutter colour chosen here) ----
  const canDesignerUpload = soMode && !planningMode; // the /designer page only
  const PG_FINISHES = (planningFinishesData as any).priceGroups as Record<string, string[]>;
  const allPgColours = useMemo(
    () => Array.from(new Set(Object.values(PG_FINISHES).flat())).sort(),
    [PG_FINISHES]
  );
  const coloursForPriceGroup = (pg?: string): string[] =>
    (pg && PG_FINISHES[pg]) ? PG_FINISHES[pg] : allPgColours;

  const [uploadMsg, setUploadMsg] = useState<string>("");
  const [bulkZone, setBulkZone] = useState<string>("all");   // all|base|wall|tall|loft|md
  const [bulkPG, setBulkPG] = useState<string>("all");       // all | PG-1 | PG-2 …
  const [bulkColour, setBulkColour] = useState<string>("");

  const zoneKindOfLine = (l: ProjectLine): string => {
    const z = ZONES[l.m.code.split("-")[0]];
    if (!z) return "base";
    if (z.kind === "wall") return "wall";
    if (z.kind === "loft") return "loft";
    if (z.tall) return "tall";
    if (z.kind === "md") return "md";
    return "base";
  };
  // Price groups present among the lines of a given zone (drives the dependent PG dropdown).
  const pgsForZone = (zone: string): string[] =>
    Array.from(new Set(
      project.filter((l) => zone === "all" || zoneKindOfLine(l) === zone)
        .map((l) => l.priceGroup).filter((x): x is string => !!x)
    )).sort();
  const lineMatchesBulk = (l: ProjectLine): boolean => {
    if (bulkZone !== "all" && zoneKindOfLine(l) !== bulkZone) return false;
    if (bulkPG !== "all" && l.priceGroup !== bulkPG) return false;
    return true;
  };

  // Rebuild a line's model with a newly-chosen shutter colour (keeps code/design/finishes).
  const setLineShutterColour = (line: ProjectLine, colour: string): ProjectLine => {
    if (!line.upCode) return line;
    const m = parseCabinetCodeToModel(line.upCode, line.upDesign || design, {
      carcassMat: line.upCarcass,
      shutterMat: colour,
      profileColor: line.upProfile,
    });
    return m ? { ...line, m } : line;
  };
  const applyColourToLine = (idx: number, colour: string) =>
    setProject((cur) => cur.map((l, i) => (i === idx ? setLineShutterColour(l, colour) : l)));
  const applyBulkColour = () => {
    if (!bulkColour) return;
    setProject((cur) => cur.map((l) => (lineMatchesBulk(l) ? setLineShutterColour(l, bulkColour) : l)));
  };

  const handleDesignerUpload = async (file: File) => {
    try {
      setUploadMsg("Reading file…");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets["Shutter"] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
      const carcassMap = (planningFinishesData as any).carcassShortCodes as Record<string, string>;
      const profileMap = (planningFinishesData as any).profileFinishMap as Record<string, string>;
      const typeMap = (planningFinishesData as any).shutterTypeMap as Record<string, string>;
      const lines: ProjectLine[] = [];
      let skipped = 0;
      for (const r of rows) {
        const code = String(r["Cabinet Code"] || "").trim();
        if (!code) continue;
        const rawType = String(r["Shutter Type"] || "").trim();
        const design2 = typeMap[rawType] || rawType.replace(/\s*\+\s*/g, "") || "MD1";
        const cabFin = carcassMap[String(r["Cabinet Finish"] || "").trim()] || String(r["Cabinet Finish"] || "").trim() || "STATUARIO";
        const profCol = profileMap[String(r["Profile Finish"] || "").trim()] || "CHAMPAGNE";
        const pg = String(r["Shutter Finish"] || "").trim(); // this column is the price group
        const qty = Math.max(1, parseInt(String(r["Shutter Qty"] || "1"), 10) || 1);
        const m = parseCabinetCodeToModel(code, design2, { carcassMat: cabFin, shutterMat: "", profileColor: profCol });
        if (!m) { skipped++; continue; }
        lines.push({ qty, m, rate: 0, elevation: "", priceGroup: pg, upCode: code, upDesign: design2, upCarcass: cabFin, upProfile: profCol });
      }
      if (lines.length === 0) { setUploadMsg("No valid cabinet codes found in the sheet."); return; }
      setSelectedSo(null);
      setProject(lines);
      setUploadMsg(`Loaded ${lines.length} cabinet(s)${skipped ? `, ${skipped} skipped` : ""}. Choose shutter colours below.`);
    } catch (err: any) {
      console.warn("Upload parse error:", err);
      setUploadMsg(`Could not read the file: ${err?.message || "invalid format"}`);
    }
  };

  const handleAddToZohoSO = async () => {
    if (!selectedSo) return;
    setZohoLoading(true);
    setZohoMessage("Initiating Zoho Integration flow...");

    try {
      // Step 1: Resolve Drilling, Cutting, and Packing Service items in Zoho
      setZohoMessage("Resolving Drilling, Cutting, and Packing Service items...");
      const cuttingServiceId = await resolveSimpleItem("Cutting-1", true);
      const drillingServiceId = await resolveSimpleItem("Drilling-1", true);
      const packingCarcassId = await resolveSimpleItem("Packing Item - Carcass", true);
      const packingShutterId = await resolveSimpleItem("Packing Item - Shutter", true);
      const packingHardwareId = await resolveSimpleItem("Packing Item - Hardware", true);

      // Determine items to add: if project has items, add them; otherwise add the currently active cabinet
      const itemsToAdd = project.length > 0
        ? project.map(l => ({ model: l.m, qty: l.qty, rate: l.rate || soRate, elevation: l.elevation || "" }))
        : [{ model, qty: lineQty, rate: soRate, elevation }];

      const newCabinetLines: Array<{ item_id: string; quantity: number; rate: number; description?: string; code?: string }> = [];

      for (const item of itemsToAdd) {
        const currentModel = item.model;
        const currentQty = item.qty;
        const currentRate = item.rate;
        const currentElevation = item.elevation;

        setZohoMessage(`Processing cabinet: "${currentModel.code}"...`);

        // Resolve carcass stone
        const carcassMatOfModel = currentModel.mat || currentModel.carcassMat || carcassMat;
        const carcassStoneKey = `carcass|${carcassMatOfModel}|${currentModel.t}`;
        const carcassStoneId = selectedRawIds[carcassStoneKey];
        if (!carcassStoneId) {
          throw new Error(`Carcass stone raw material not selected for finish "${carcassMatOfModel}" (${currentModel.t}mm) in cabinet "${currentModel.code}". Please choose a raw material selection first.`);
        }
        
        const carcassStoneItem = (rawOptionsMap[carcassStoneKey] || []).find(i => i.item_id === carcassStoneId);
        const carcassSlabArea = carcassStoneItem ? getSlabArea(carcassStoneItem) : 0;

        // Resolve Shutter Stone if cabinet has stone shutters / fixed panels.
        // Thickness is design-driven (MD3 family = 9mm, else 6mm) and the fixed (dummy)
        // blind panel is always 6mm MD1, so a single cabinet may need more than one stone
        // (finish, thickness) selection — resolve each distinct combo into a map.
        const isGlassFamModel = isGlassShutterFam(currentModel.fk);
        const glassColorOfModel = currentModel.shutterMat || glassColor || "CLEAR";
        // Per-shutter stone finish (mirrors rawAggregation): glass-family fixed panels use
        // the fixed-panel shade; everything else uses the shutter shade.
        const stoneFinishOf = (s: Shutter) =>
          (isGlassFamModel && s.kind === "fixed")
            ? (currentModel.fixedPanelMat || currentModel.shutterMat || shutterMat)
            : (currentModel.shutterMat || shutterMat);
        const isStoneShutter = (s: Shutter) => !isGlassFamModel || s.kind === "fixed";
        // Default model-level finish (used for dedup search naming) = first stone shutter's finish.
        const stoneShutterFinish = isGlassFamModel
          ? (currentModel.fixedPanelMat || currentModel.shutterMat || shutterMat)
          : (currentModel.shutterMat || shutterMat);
        const shutterMatOfModel = stoneShutterFinish;
        const shutterStoneByKey: Record<string, { id: string; slabArea: number }> = {};
        if (currentModel.shutters && currentModel.shutters.length > 0) {
          for (const s of currentModel.shutters) {
            if (!isStoneShutter(s)) continue;
            const sThk = shThkOf(s.design, false);
            const sFin = stoneFinishOf(s);
            const k = `shutter|${sFin}|${sThk}`;
            if (shutterStoneByKey[k]) continue;
            const id = selectedRawIds[k];
            if (!id) {
              throw new Error(`Shutter stone raw material not selected for finish "${sFin}" (${sThk}mm) in cabinet "${currentModel.code}". Please choose a raw material selection first.`);
            }
            const item = (rawOptionsMap[k] || []).find(i => i.item_id === id);
            shutterStoneByKey[k] = { id, slabArea: item ? getSlabArea(item) : 0 };
          }
        }

        // Group carcass panels and profiles by packet
        const carcassPanelsByPack: Record<string, Panel[]> = {};
        currentModel.panels.forEach((p) => {
          if (!carcassPanelsByPack[p.pack]) {
            carcassPanelsByPack[p.pack] = [];
          }
          carcassPanelsByPack[p.pack].push(p);
        });

        const carcassProfilesByPack: Record<string, Profile[]> = {};
        currentModel.profiles.forEach((p) => {
          if (!p.pack) return;
          // Skip Elenor profiles — they are handled as a separate composite
          if (p.pack && p.pack.startsWith("Elenor with Light")) return;
          if (!carcassProfilesByPack[p.pack]) {
            carcassProfilesByPack[p.pack] = [];
          }
          carcassProfilesByPack[p.pack].push(p);
        });

        // Derive zone & subgroup from cabinet code
        const codeZone = currentModel.code.split("-")[0];
        const zoneName = ZONES[codeZone]?.name || codeZone;
        const dims = { W: currentModel.W, H: currentModel.H, D: currentModel.D, t: currentModel.t };
        const soNumber = selectedSo.salesorder_number || "";
        const hwCf: ItemCustomFields = {
          group: "Hardware Pack", subGroup: zoneName
        };

        // Check if carcass stone raw material already exists in any composite
        setZohoMessage("Checking for existing composites with same raw material...");
        const basePanelSearchName = `Panel ${(currentModel.panels[0]?.name || "Carcass").replace(/^Panels/i, "")} ${carcassMatOfModel}`;
        const existingCarcassPanel = await findExistingCompositeByRawMaterial(carcassStoneId, basePanelSearchName);
        const soPrefix = existingCarcassPanel ? "" : soNumber;

        // Construct packets bottom-up
        const packetCompositeIds: Array<{ item_id: string; quantity: number }> = [];

        const carcassHardwarePacks = currentModel.hardware
          .map(h => h.pack)
          .filter((pk): pk is string => !!pk && (pk.startsWith("Set of Parts-") || pk.startsWith("Drawer Pack-")));

        const carcassPacks = Array.from(new Set([
          ...Object.keys(carcassPanelsByPack),
          ...Object.keys(carcassProfilesByPack),
          ...carcassHardwarePacks
        ])).sort((a, b) => {
          if (a.startsWith("Set of Parts-") && b.startsWith("Drawer Pack-")) return -1;
          if (a.startsWith("Drawer Pack-") && b.startsWith("Set of Parts-")) return 1;
          return 0;
        });

        const drawerSetOfPartsIds: Record<string, string> = {};

        for (const packName of carcassPacks) {
          const partChildren: Array<{ item_id: string; quantity: number }> = [];

          if (packName.startsWith("Drawer Pack- Cab Drawer Box") || packName.startsWith("Drawer Pack- Cab Pullout Shelf")) {

            const drawerCount = getDrawerCount(packName, currentModel.panels);

            // Panels — back/fascia keep a drilled Part wrapper, bottom panel stays flat.
            // Quantities are divided by drawerCount so the composite holds per-drawer parts.
            if (carcassPanelsByPack[packName]) {
              for (const p of carcassPanelsByPack[packName]) {
                const panelBase = getPanelBaseName(p.name, null, carcassMatOfModel);
                const panelName = soPrefix ? `${soPrefix} ${panelBase}` : panelBase;
                const panelCf: ItemCustomFields = {
                  group: "Panels- Cab", subGroup: zoneName, finish: carcassMatOfModel,
                  thickness: String(p.t || dims.t), height: String(p.h), width: String(p.w)
                };
                let panelId: string;
                const existingPanel = !soPrefix ? await findExistingCompositeByRawMaterial(carcassStoneId, panelBase) : null;
                if (existingPanel) {
                  panelId = existingPanel;
                } else {
                  setZohoMessage(`Creating BOM Panel: "${panelName}"...`);
                  const panelArea = sqft(p.w, p.h);
                  const reqArea = panelArea * (1 + STONE_WASTE);
                  const stoneQty = carcassSlabArea > 0 ? reqArea / carcassSlabArea : reqArea;
                  const roundedStoneQty = Math.round(stoneQty * 10000) / 10000;
                  panelId = await resolveCompositeItem(panelName, panelName, [
                    { item_id: carcassStoneId, quantity: roundedStoneQty },
                    { item_id: cuttingServiceId, quantity: 1 }
                  ], panelCf);
                }

                const hasDrill = p.drill && p.drill.trim() !== "" && p.drill.trim().toLowerCase() !== "no drill";
                if (hasDrill) {
                  const partBase = getPartBaseName(p.name, p.drill, carcassMatOfModel);
                  const partName = soPrefix ? `${soPrefix} ${partBase}` : partBase;
                  const partCf: ItemCustomFields = {
                    group: "Part Cab", subGroup: zoneName, finish: carcassMatOfModel,
                    thickness: String(p.t || dims.t), height: String(p.h), width: String(p.w)
                  };
                  const partId = await resolveCompositeItem(partName, partName, [
                    { item_id: panelId, quantity: 1 },
                    { item_id: drillingServiceId, quantity: 1 }
                  ], partCf);
                  partChildren.push({ item_id: partId, quantity: p.qty / drawerCount });
                } else {
                  partChildren.push({ item_id: panelId, quantity: p.qty / drawerCount });
                }
              }
            }

            if (carcassProfilesByPack[packName]) {
              const profsByType: Record<string, Profile[]> = {};
              carcassProfilesByPack[packName].forEach((p) => {
                (profsByType[p.type] ??= []).push(p);
              });

              for (const [pType, profsList] of Object.entries(profsByType)) {
                const pFinish = currentModel.carcassProfileColor || carcassProfileColor || "CHAMPAGNE";
                const profileKey = `carcass|${pType}|${pFinish}`;
                let rawProfileId = selectedRawIds[profileKey];
                if (!rawProfileId) {
                  throw new Error(`Raw profile item not selected for carcass profile: "${pType}" (${pFinish})`);
                }
                if (rawProfileId.startsWith("MOCK_CREATE|")) {
                  const itemName = rawProfileId.split("|")[1];
                  setZohoMessage(`Creating raw profile item: "${itemName}"...`);
                  rawProfileId = await resolveSimpleItem(itemName, false, { group: "Aluminium Profile & Parts", finish: pFinish }, "Mtr");
                }

                if (pType === "DBC") {
                  // Center profile (HM535) — flat cut profile (raw + cutting), no set wrapper
                  for (const p of profsList) {
                    const cutBase = `${p.name} ${p.len}mm ${pFinish}`;
                    let cutId: string;
                    const existingCut = await findExistingCompositeByRawMaterial(rawProfileId, cutBase);
                    if (existingCut) {
                      cutId = existingCut;
                    } else {
                      const cutName = soPrefix ? `${soPrefix} ${cutBase}` : cutBase;
                      setZohoMessage(`Creating BOM Profile: "${cutName}"...`);
                      const reqLen = (p.len / 1000) * (1 + PROFILE_WASTE);
                      const roundedLen = Math.round(reqLen * 10000) / 10000;
                      cutId = await resolveCompositeItem(cutName, cutName, [
                        { item_id: rawProfileId, quantity: roundedLen },
                        { item_id: cuttingServiceId, quantity: 1 }
                      ], { group: "Profile", subGroup: zoneName, finish: pFinish, height: String(p.len) });
                    }
                    partChildren.push({ item_id: cutId, quantity: p.qty / drawerCount });
                  }
                } else {
                  setZohoMessage(`Creating BOM Level 2 Set of Profiles: "${pType}"...`);
                  const carcassProfileSetIds = await resolveProfileBOM(
                    pType,
                    pFinish,
                    profsList.map((p) => ({ len: p.len, qty: p.qty / drawerCount, name: p.name })),
                    rawProfileId,
                    cuttingServiceId,
                    drillingServiceId,
                    { soPrefix, subGroup: zoneName, parentGroup: "Carcass", dims }
                  );
                  for (const setId of carcassProfileSetIds) {
                    partChildren.push({ item_id: setId, quantity: 1 });
                  }
                }
              }
            }

            const packetHardware = currentModel.hardware.filter(
              (h) => h.pack === packName || (h.pack && h.pack.startsWith(packName))
            );
            const hwGrouped: Record<string, { name: string; qty: number }> = {};
            packetHardware.forEach((h) => {
              if (hwGrouped[h.name]) {
                hwGrouped[h.name].qty += h.qty;
              } else {
                hwGrouped[h.name] = { name: h.name, qty: h.qty };
              }
            });

            for (const { name: hName, qty } of Object.values(hwGrouped)) {
              setZohoMessage(`Resolving drawer hardware: "${hName}"...`);
              let hPackId: string;
              if (hName.toUpperCase().startsWith("HARDWARE PACK")) {
                hPackId = await resolveHardwarePackComposite(hName, hwCf);
              } else {
                hPackId = await resolveHardwarePack(hName, qty / drawerCount, packingHardwareId, hwCf);
              }
              partChildren.push({ item_id: hPackId, quantity: 1 });
            }

            const packBase = `${packName} ${carcassMatOfModel}`;
            const packNameWithFinish = soPrefix ? `${soPrefix} ${packBase}` : packBase;
            setZohoMessage(`Creating BOM Level 1 Drawer Pack: "${packNameWithFinish}"...`);
            const packCf: ItemCustomFields = {
              group: "Carcass Pack", subGroup: zoneName, finish: carcassMatOfModel,
              thickness: String(dims.t), height: String(dims.H), width: String(dims.W), depth: String(dims.D)
            };
            const packetMappedItems = [
              ...partChildren,
              { item_id: packingCarcassId, quantity: 1 }
            ];
            const packetId = await resolveCompositeItem(packNameWithFinish, packNameWithFinish, packetMappedItems, packCf);
            packetCompositeIds.push({ item_id: packetId, quantity: drawerCount });

          } else {
            const isDrawerBoxSet = packName.startsWith("Set of Parts- Cab Drawer Box") || packName.startsWith("Set of Parts- Cab Pullout Shelf");
            const setDrawerCount = isDrawerBoxSet ? getDrawerCount(packName, currentModel.panels) : 1;

            if (carcassPanelsByPack[packName]) {
              for (const p of carcassPanelsByPack[packName]) {
                const panelBase = getPanelBaseName(p.name, null, carcassMatOfModel);
                let panelName = soPrefix ? `${soPrefix} ${panelBase}` : panelBase;

                const panelCf: ItemCustomFields = {
                  group: "Panels- Cab", subGroup: zoneName, finish: carcassMatOfModel,
                  thickness: String(p.t || dims.t), height: String(p.h), width: String(p.w)
                };

                let panelId: string;
                if (!soPrefix) {
                  const existingPanel = await findExistingCompositeByRawMaterial(carcassStoneId, panelBase);
                  if (existingPanel) {
                    panelId = existingPanel;
                  } else {
                    setZohoMessage(`Creating BOM Level 4 Panel: "${panelName}"...`);
                    const panelArea = sqft(p.w, p.h);
                    const reqArea = panelArea * (1 + STONE_WASTE);
                    const stoneQty = carcassSlabArea > 0 ? reqArea / carcassSlabArea : reqArea;
                    const roundedStoneQty = Math.round(stoneQty * 10000) / 10000;
                    panelId = await resolveCompositeItem(panelName, panelName, [
                      { item_id: carcassStoneId, quantity: roundedStoneQty },
                      { item_id: cuttingServiceId, quantity: 1 }
                    ], panelCf);
                  }
                } else {
                  setZohoMessage(`Creating BOM Level 4 Panel: "${panelName}"...`);
                  const panelArea = sqft(p.w, p.h);
                  const reqArea = panelArea * (1 + STONE_WASTE);
                  const stoneQty = carcassSlabArea > 0 ? reqArea / carcassSlabArea : reqArea;
                  const roundedStoneQty = Math.round(stoneQty * 10000) / 10000;
                  panelId = await resolveCompositeItem(panelName, panelName, [
                    { item_id: carcassStoneId, quantity: roundedStoneQty },
                    { item_id: cuttingServiceId, quantity: 1 }
                  ], panelCf);
                }

                const hasDrill = p.drill && p.drill.trim() !== "" && p.drill.trim().toLowerCase() !== "no drill";

                if (hasDrill) {
                  const isCombinedSide = /LH\/RH|LH\+RH/i.test(p.name);
                  const isCombinedDir = /TP\/BT|Top\/Bottom|TP\+BT/i.test(p.name);

                  if (isCombinedSide) {
                    let lhDrill = p.drill;
                    let rhDrill = p.drill;
                    if (p.drill && p.drill.includes("/")) {
                      const parts = p.drill.split("/");
                      if (parts.length === 2) {
                        lhDrill = parts[0].trim();
                        rhDrill = parts[1].trim();
                      }
                    }

                    const lhName = p.name.replace(/LH\/RH|LH\+RH/gi, "LH");
                    const rhName = p.name.replace(/LH\/RH|LH\+RH/gi, "RH");

                    const partBaseLh = getPartBaseName(lhName, lhDrill, carcassMatOfModel);
                    const partNameLh = soPrefix ? `${soPrefix} ${partBaseLh}` : partBaseLh;
                    setZohoMessage(`Creating BOM Level 3 Part LH: "${partNameLh}"...`);
                    const partCfLh: ItemCustomFields = {
                      group: "Part Cab", subGroup: zoneName, finish: carcassMatOfModel,
                      thickness: String(p.t || dims.t), height: String(p.h), width: String(p.w)
                    };
                    const partIdLh = await resolveCompositeItem(partNameLh, partNameLh, [
                      { item_id: panelId, quantity: 1 },
                      { item_id: drillingServiceId, quantity: 1 }
                    ], partCfLh);
                    partChildren.push({ item_id: partIdLh, quantity: (p.qty / 2) / setDrawerCount });

                    const partBaseRh = getPartBaseName(rhName, rhDrill, carcassMatOfModel);
                    const partNameRh = soPrefix ? `${soPrefix} ${partBaseRh}` : partBaseRh;
                    setZohoMessage(`Creating BOM Level 3 Part RH: "${partNameRh}"...`);
                    const partCfRh: ItemCustomFields = {
                      group: "Part Cab", subGroup: zoneName, finish: carcassMatOfModel,
                      thickness: String(p.t || dims.t), height: String(p.h), width: String(p.w)
                    };
                    const partIdRh = await resolveCompositeItem(partNameRh, partNameRh, [
                      { item_id: panelId, quantity: 1 },
                      { item_id: drillingServiceId, quantity: 1 }
                    ], partCfRh);
                    partChildren.push({ item_id: partIdRh, quantity: (p.qty / 2) / setDrawerCount });

                  } else if (isCombinedDir) {
                    const tpTag = p.name.toLowerCase().includes("top") ? "Top" : "TP";
                    const btTag = p.name.toLowerCase().includes("bottom") ? "Bottom" : "BT";
                    const tpName = p.name.replace(/TP\/BT|Top\/Bottom|TP\+BT/gi, tpTag);
                    const btName = p.name.replace(/TP\/BT|Top\/Bottom|TP\+BT/gi, btTag);

                    const partBaseTp = getPartBaseName(tpName, p.drill, carcassMatOfModel);
                    const partNameTp = soPrefix ? `${soPrefix} ${partBaseTp}` : partBaseTp;
                    setZohoMessage(`Creating BOM Level 3 Part TP: "${partNameTp}"...`);
                    const partCfTp: ItemCustomFields = {
                      group: "Part Cab", subGroup: zoneName, finish: carcassMatOfModel,
                      thickness: String(p.t || dims.t), height: String(p.h), width: String(p.w)
                    };
                    const partIdTp = await resolveCompositeItem(partNameTp, partNameTp, [
                      { item_id: panelId, quantity: 1 },
                      { item_id: drillingServiceId, quantity: 1 }
                    ], partCfTp);
                    partChildren.push({ item_id: partIdTp, quantity: (p.qty / 2) / setDrawerCount });

                    const partBaseBt = getPartBaseName(btName, p.drill, carcassMatOfModel);
                    const partNameBt = soPrefix ? `${soPrefix} ${partBaseBt}` : partBaseBt;
                    setZohoMessage(`Creating BOM Level 3 Part BT: "${partNameBt}"...`);
                    const partCfBt: ItemCustomFields = {
                      group: "Part Cab", subGroup: zoneName, finish: carcassMatOfModel,
                      thickness: String(p.t || dims.t), height: String(p.h), width: String(p.w)
                    };
                    const partIdBt = await resolveCompositeItem(partNameBt, partNameBt, [
                      { item_id: panelId, quantity: 1 },
                      { item_id: drillingServiceId, quantity: 1 }
                    ], partCfBt);
                    partChildren.push({ item_id: partIdBt, quantity: (p.qty / 2) / setDrawerCount });

                  } else {
                    const partBase = getPartBaseName(p.name, p.drill, carcassMatOfModel);
                    const partName = soPrefix ? `${soPrefix} ${partBase}` : partBase;
                    setZohoMessage(`Creating BOM Level 3 Part: "${partName}"...`);

                    const partCf: ItemCustomFields = {
                      group: "Part Cab", subGroup: zoneName, finish: carcassMatOfModel,
                      thickness: String(p.t || dims.t), height: String(p.h), width: String(p.w)
                    };
                    const partId = await resolveCompositeItem(partName, partName, [
                      { item_id: panelId, quantity: 1 },
                      { item_id: drillingServiceId, quantity: 1 }
                    ], partCf);
                    partChildren.push({ item_id: partId, quantity: p.qty / setDrawerCount });
                  }
                } else {
                  partChildren.push({ item_id: panelId, quantity: p.qty / setDrawerCount });
                }
              }
            }

            if (carcassProfilesByPack[packName]) {
              const profsByType: Record<string, Profile[]> = {};
              carcassProfilesByPack[packName].forEach((p) => {
                if (!profsByType[p.type]) {
                  profsByType[p.type] = [];
                }
                profsByType[p.type].push(p);
              });

              for (const [pType, profsList] of Object.entries(profsByType)) {
                const pFinish = currentModel.carcassProfileColor || carcassProfileColor || "CHAMPAGNE";
                const profileKey = `carcass|${pType}|${pFinish}`;
                let rawProfileId = selectedRawIds[profileKey];
                if (!rawProfileId) {
                  throw new Error(`Raw profile item not selected for carcass profile: "${pType}" (${pFinish})`);
                }
                if (rawProfileId.startsWith("MOCK_CREATE|")) {
                  const itemName = rawProfileId.split("|")[1];
                  setZohoMessage(`Creating raw profile item: "${itemName}"...`);
                  rawProfileId = await resolveSimpleItem(itemName, false, { group: "Aluminium Profile & Parts", finish: pFinish }, "Mtr");
                }

                setZohoMessage(`Creating BOM Level 2 Set of Profiles: "${pType}"...`);
                const carcassProfileSetIds = await resolveProfileBOM(
                  pType,
                  pFinish,
                  profsList.map((p) => ({
                    len: p.len,
                    qty: p.qty / setDrawerCount,
                    name: p.name
                  })),
                  rawProfileId,
                  cuttingServiceId,
                  drillingServiceId,
                  { soPrefix, subGroup: zoneName, parentGroup: "Carcass", dims }
                );

                for (const setId of carcassProfileSetIds) {
                  partChildren.push({ item_id: setId, quantity: 1 });
                }
              }
            }

            if (partChildren.length > 0) {
              const packBase = `${packName} ${carcassMatOfModel}`;
              const packNameWithFinish = soPrefix ? `${soPrefix} ${packBase}` : packBase;
              setZohoMessage(`Creating BOM Level 2 Set of Parts: "${packNameWithFinish}"...`);
              const packCf: ItemCustomFields = {
                group: "Carcass Pack", subGroup: zoneName, finish: carcassMatOfModel,
                thickness: String(dims.t), height: String(dims.H), width: String(dims.W), depth: String(dims.D)
              };
              const packetMappedItems = [
                ...partChildren,
                { item_id: packingCarcassId, quantity: 1 }
              ];
              const packetId = await resolveCompositeItem(packNameWithFinish, packNameWithFinish, packetMappedItems, packCf);

              if (isDrawerBoxSet) {
                packetCompositeIds.push({ item_id: packetId, quantity: setDrawerCount });
              } else {
                packetCompositeIds.push({ item_id: packetId, quantity: 1 });
              }
            }
          }
        }

        // Add Shutters (if any)
        const shutterCompositeIds: Array<{ item_id: string; quantity: number }> = [];
        if (currentModel.shutters && currentModel.shutters.length > 0) {
          // Check shutter raw material dedup against the first stone shutter (thickness-aware).
          const firstStone = currentModel.shutters.find((s) => isStoneShutter(s));
          const firstStoneThk = firstStone ? shThkOf(firstStone.design, false) : 6;
          const firstStoneKey = firstStone ? `shutter|${stoneFinishOf(firstStone)}|${firstStoneThk}` : "";
          const firstStoneId = firstStone ? (shutterStoneByKey[firstStoneKey]?.id || "") : "";
          const shutterPanelSearchName = firstStone
            ? `Panel Shutter ${firstStone.pw}x${firstStone.ph}x${firstStoneThk} ${stoneFinishOf(firstStone)}`
            : "";
          const existingShutterPanel = firstStoneId
            ? await findExistingCompositeByRawMaterial(firstStoneId, shutterPanelSearchName)
            : null;
          const shutterSoPrefix = existingShutterPanel ? "" : soNumber;

          for (const s of currentModel.shutters) {
            const shutterParts: Array<{ item_id: string; quantity: number }> = [];

            // 1. Shutter Panel Part — thickness & finish are per-shutter (design-driven).
            const sThk = shThkOf(s.design, false);
            const sFin = stoneFinishOf(s);
            const sStone = shutterStoneByKey[`shutter|${sFin}|${sThk}`];
            const shutterStoneId = sStone?.id || "";
            const shutterSlabArea = sStone?.slabArea || 0;
            const shPanelBase = `Panel Shutter ${s.pw}x${s.ph}x${sThk} ${sFin}`;
            const shPanelCf: ItemCustomFields = {
              group: "Panels- SH", subGroup: zoneName, finish: sFin,
              thickness: String(sThk), height: String(s.ph), width: String(s.pw)
            };

            let shPanelId: string;
            if (isGlassShutterFam(currentModel.fk) && s.kind !== "fixed") {
              const glassItemName = `GLASS TOUGH EP ${s.pw}X${s.ph}X5 ${glassColorOfModel} SKV`;
              setZohoMessage(`Resolving Shutter Glass item: "${glassItemName}"...`);
              shPanelId = await resolveSimpleItem(glassItemName, false, { group: "Glass", finish: glassColorOfModel }, "Pcs");
            } else {
              if (!shutterSoPrefix) {
                const existing = await findExistingCompositeByRawMaterial(shutterStoneId, shPanelBase);
                if (existing) {
                  shPanelId = existing;
                } else {
                  const shPanelName = shPanelBase;
                  setZohoMessage(`Creating Shutter BOM Level 4 Panel: "${shPanelName}"...`);
                  const shArea = sqft(s.pw, s.ph);
                  const reqShArea = shArea * (1 + STONE_WASTE);
                  const shStoneQty = shutterSlabArea > 0 ? reqShArea / shutterSlabArea : reqShArea;
                  const roundedShStoneQty = Math.round(shStoneQty * 10000) / 10000;
                  shPanelId = await resolveCompositeItem(shPanelName, shPanelName, [
                    { item_id: shutterStoneId, quantity: roundedShStoneQty },
                    { item_id: cuttingServiceId, quantity: 1 }
                  ], shPanelCf);
                }
              } else {
                const shPanelName = `${shutterSoPrefix} ${shPanelBase}`;
                setZohoMessage(`Creating Shutter BOM Level 4 Panel: "${shPanelName}"...`);
                const shArea = sqft(s.pw, s.ph);
                const reqShArea = shArea * (1 + STONE_WASTE);
                const shStoneQty = shutterSlabArea > 0 ? reqShArea / shutterSlabArea : reqShArea;
                const roundedShStoneQty = Math.round(shStoneQty * 10000) / 10000;
                shPanelId = await resolveCompositeItem(shPanelName, shPanelName, [
                  { item_id: shutterStoneId, quantity: roundedShStoneQty },
                  { item_id: cuttingServiceId, quantity: 1 }
                ], shPanelCf);
              }
            }
            shutterParts.push({ item_id: shPanelId, quantity: 1 });

            // 2. Set of Shutter Profiles (Level 2)
            const sFinish = currentModel.shutterProfileColor || shutterProfileColor || "CHAMPAGNE";
            const shDesign = s.design || design;
            const shutterProfileKey = `shutter|${shDesign}|${sFinish}`;
            let rawShutterProfileId = selectedRawIds[shutterProfileKey];
            if (!rawShutterProfileId) {
              throw new Error(`Raw profile item not selected for shutter profile design: "${shDesign}" (${sFinish})`);
            }
            if (rawShutterProfileId.startsWith("MOCK_CREATE|")) {
              const itemName = rawShutterProfileId.split("|")[1];
              setZohoMessage(`Creating raw profile item: "${itemName}"...`);
              rawShutterProfileId = await resolveSimpleItem(itemName, false, { group: "Aluminium Profile & Parts", finish: sFinish }, "Mtr");
            }
            const shutterProfileSetIds = await resolveProfileBOM(
              shDesign,
              sFinish,
              [
                { len: s.profV, qty: 2, name: `Profile LH/RH (${shDesign})` },
                { len: s.profH, qty: 2, name: `Profile TP/BT (${shDesign})` }
              ],
              rawShutterProfileId,
              cuttingServiceId,
              drillingServiceId,
              {
                soPrefix: shutterSoPrefix, subGroup: zoneName, parentGroup: "Shutters", dims,
                // Mirror carcass side-panel drilling onto the shutter vertical profiles
                // (single door = full LH/RH; double door = per-leaf split, inner edge = JD).
                vDrill: shutterVDrill(currentModel.lh, currentModel.rh, currentModel.shutters || [], s)
              }
            );
            for (const setId of shutterProfileSetIds) {
              shutterParts.push({ item_id: setId, quantity: 1 });
            }

            // 3. Shutter Assembly Hardware Pack (Corner Connectors)
            const shutterHwCf: ItemCustomFields = {
              group: "Hardware Pack", subGroup: zoneName
            };
            const shutterAssemblyHardwareId = await resolveHardwarePack(
              shutterCornerName(currentModel.fk, s.kind),
              1,
              packingHardwareId,
              shutterHwCf
            );
            shutterParts.push({ item_id: shutterAssemblyHardwareId, quantity: 1 });

            // 4. Packing Item - Shutter
            shutterParts.push({ item_id: packingShutterId, quantity: 1 });

            // Create Level 2: Fully Ready Shutter
            const shutterBase = `${s.code} Ready`;
            const shutterName = shutterSoPrefix ? `${shutterSoPrefix} ${shutterBase}` : shutterBase;
            setZohoMessage(`Creating Fully Ready Shutter Composite: "${shutterName}"...`);
            const shutterPackCf: ItemCustomFields = {
              group: "Shutter Panel Pack", subGroup: zoneName, finish: shutterMatOfModel,
              thickness: "6", height: String(s.h), width: String(s.w)
            };
            const fullyReadyShutterId = await resolveCompositeItem(shutterName, shutterName, shutterParts, shutterPackCf);

            // 5. Fitting Hardware Pack (hinge + packing hardware)
            setZohoMessage(`Creating Shutter Fitting Hardware Pack: "${s.hinge}"...`);
            const fittingHardwareId = s.hinge.toUpperCase().startsWith("HARDWARE PACK")
              ? await resolveHardwarePackComposite(s.hinge, shutterHwCf)
              : await resolveHardwarePack(s.hinge, s.hq || 1, packingHardwareId, shutterHwCf);

            // Create Level 2: Shutter BOM
            const shutterBomBase = s.code;
            const shutterBomName = shutterSoPrefix ? `${shutterSoPrefix} ${shutterBomBase}` : shutterBomBase;
            setZohoMessage(`Creating Shutter BOM: "${shutterBomName}"...`);
            const shutterBomCf: ItemCustomFields = {
              group: "Shutters", subGroup: zoneName, finish: shutterMatOfModel,
              thickness: "6", height: String(s.h), width: String(s.w)
            };
            const shutterBomId = await resolveCompositeItem(shutterBomName, shutterBomName, [
              { item_id: fullyReadyShutterId, quantity: 1 },
              { item_id: fittingHardwareId, quantity: 1 }
            ], shutterBomCf);
            shutterCompositeIds.push({ item_id: shutterBomId, quantity: 1 });
          }
        }

        // Process accessories, hardware, and consumables of carcass
        const carcassMappedItems: Array<{ item_id: string; quantity: number }> = [
          ...packetCompositeIds,
          ...shutterCompositeIds
        ];

        for (const h of currentModel.hardware) {
          // Skip Elenor-pack hardware — handled inside the Elenor composite
          if (h.pack && h.pack.startsWith("Elenor with Light")) continue;
          // Skip Drawer Pack/Set of Parts hardware (now inside their composites)
          if (h.pack && (h.pack.startsWith("Drawer Pack-") || h.pack.startsWith("Set of Parts-"))) continue;

          setZohoMessage(`Resolving carcass hardware: "${h.name}"...`);

          if (h.name.toUpperCase().startsWith("HARDWARE PACK")) {
            const packId = await resolveHardwarePackComposite(h.name, hwCf);
            carcassMappedItems.push({ item_id: packId, quantity: h.qty });
          } else {
            const hPackId = await resolveHardwarePack(h.name, h.qty, packingHardwareId, hwCf);
            carcassMappedItems.push({ item_id: hPackId, quantity: 1 });
          }
        }

        for (const c of currentModel.cons) {
          // Skip Elenor-pack consumables — handled inside the Elenor composite
          if (c.pack && c.pack.startsWith("Elenor with Light")) continue;
          // Skip Drawer Pack/Set of Parts consumables
          if (c.pack && (c.pack.startsWith("Drawer Pack-") || c.pack.startsWith("Set of Parts-"))) continue;

          setZohoMessage(`Resolving carcass consumable: "${c.name}"...`);
          const cId = await resolveSimpleItem(c.name, false, undefined, c.uom);
          carcassMappedItems.push({ item_id: cId, quantity: c.qty });
        }

        // Glass shelf (wall stone/glass shutter) — direct raw material
        if (currentModel.glassShelf) {
          const gs = currentModel.glassShelf;
          setZohoMessage(`Resolving glass shelf: "${gs.name}"...`);
          const gsId = await resolveSimpleItem(gs.name, false, { group: "Glass", finish: "CLEAR" }, "Pcs");
          carcassMappedItems.push({ item_id: gsId, quantity: gs.qty });
        }

        // Handle Elenor composite (if present)
        const elenorPacks = Array.from(new Set(
          [
            ...currentModel.profiles.map(p => p.pack),
            ...currentModel.cons.map(c => c.pack),
            ...currentModel.hardware.map(h => h.pack)
          ].filter((pack): pack is string => typeof pack === "string" && pack.startsWith("Elenor with Light"))
        ));

        for (const elenPackName of elenorPacks) {
          const elenorProfiles = currentModel.profiles.filter((p) => p.pack === elenPackName);
          const elenorCons = currentModel.cons.filter((c) => c.pack === elenPackName);
          const elenorHardware = currentModel.hardware.filter((h) => h.pack === elenPackName);

          if (elenorProfiles.length > 0 || elenorCons.length > 0) {
            setZohoMessage(`Creating ${elenPackName} composite...`);
            const elenorMappedItems: Array<{ item_id: string; quantity: number }> = [];

            // Helper: a cut-to-size composite = raw 3-mtr stock + Cutting service. Used so the
            // profile / LED / diffuser are BOMs (raw stays out of the Opti sheet), not raw items.
            const makeCutComposite = async (rawName: string, cutLabel: string, lenMm: number, rawGroup: string) => {
              const rawId = await resolveSimpleItem(rawName, false, { group: rawGroup, subGroup: zoneName }, "Mtr");
              const lenM = Math.round((lenMm / 1000) * 10000) / 10000;
              const cutName = `${cutLabel} Cut ${Math.round(lenMm)}mm`;
              return resolveCompositeItem(cutName, cutName, [
                { item_id: rawId, quantity: lenM },
                { item_id: cuttingServiceId, quantity: 1 }
              ], { group: "Profile", subGroup: zoneName });
            };

            // Profile → cut composite (per piece, length = ep.len = Elenor length). Qty 2.
            const elenCutLen = elenorProfiles[0]?.len || 0;
            for (const ep of elenorProfiles) {
              const cutId = await makeCutComposite(ep.name, "Elenor Profile", ep.len, "Aluminium Profile & Parts");
              elenorMappedItems.push({ item_id: cutId, quantity: ep.qty });
            }

            // LED + diffuser → cut composites of the SAME Elenor length, qty 2 (not one
            // double-length cut). Tape/wire stay raw simple items.
            for (const ec of elenorCons) {
              const isLinear = /\bLED\b|DIFFUSER/i.test(ec.name);
              if (isLinear) {
                const label = /DIFFUSER/i.test(ec.name) ? "Diffuser" : "LED Light";
                const cutId = await makeCutComposite(ec.name, label, elenCutLen, "Light");
                elenorMappedItems.push({ item_id: cutId, quantity: 2 });
              } else {
                const ecId = await resolveSimpleItem(ec.name, false, undefined, ec.uom);
                elenorMappedItems.push({ item_id: ecId, quantity: ec.qty });
              }
            }

            // Resolve any Elenor hardware
            for (const eh of elenorHardware) {
              const ehId = await resolveSimpleItem(eh.name, false, { group: "Hardware Part", subGroup: zoneName }, eh.uom);
              elenorMappedItems.push({ item_id: ehId, quantity: eh.qty });
            }

            const elenorCf: ItemCustomFields = {
              group: "Elenor Light", subGroup: zoneName
            };
            const elenorPkRow = currentModel.pkRows.find(([t, n]) => t === "elen_bom" && n === elenPackName);
            const elenorQty = elenorPkRow ? elenorPkRow[3] : 1;
            const elenorCompositeId = await resolveCompositeItem(
              elenPackName,
              elenPackName,
              elenorMappedItems,
              elenorCf
            );
            carcassMappedItems.push({ item_id: elenorCompositeId, quantity: elenorQty });
          }
        }

        // Level 1: Cabinet (Carcass)
        const cabinetCode = soPrefix ? `${soPrefix} ${currentModel.code}` : currentModel.code;
        setZohoMessage(`Creating BOM Level 1 Cabinet: "${cabinetCode}"...`);
        const cabinetCf: ItemCustomFields = {
          group: "Carcass", subGroup: zoneName, finish: carcassMatOfModel,
          thickness: String(dims.t), height: String(dims.H), width: String(dims.W), depth: String(dims.D)
        };
        const cabinetItemId = await resolveCompositeItem(cabinetCode, cabinetCode, carcassMappedItems, cabinetCf);

        newCabinetLines.push({
          item_id: cabinetItemId,
          quantity: currentQty,
          rate: currentRate,
          description: currentElevation ? `Elevation: ${currentElevation}` : undefined,
          code: currentModel.code
        });
      }

      // Step 2b: Other Accessories (Chimney / Dishwasher panels) — each becomes its own SO line
      for (const row of otherAccRows) {
        const accLabel = OTHER_ACC_ITEMS.find((it) => it.key === row.item)?.label || row.item;
        setZohoMessage(`Processing Other Accessory: "${accLabel}"...`);

        // Resolve stone for the chosen colour (6mm). Mirrors the shutter-stone selection.
        const oaStoneKey = `shutter|${row.color}|6`;
        const oaStoneId = selectedRawIds[oaStoneKey];
        if (!oaStoneId) {
          throw new Error(`Stone raw material not selected for Other Accessory "${accLabel}" finish "${row.color}" (6mm). Please choose a raw material selection first.`);
        }
        const oaStoneItem = (rawOptionsMap[oaStoneKey] || []).find((i) => i.item_id === oaStoneId);
        const oaSlabArea = oaStoneItem ? getSlabArea(oaStoneItem) : 0;

        const oaArea = sqft(row.width, row.height) * (1 + STONE_WASTE);
        const oaStoneQty = Math.round((oaSlabArea > 0 ? oaArea / oaSlabArea : oaArea) * 10000) / 10000;

        const oaCf: ItemCustomFields = {
          group: "Other Accessory", finish: row.color,
          thickness: "6", height: String(row.height), width: String(row.width)
        };
        const oaName = `${accLabel} ${row.width}x${row.height}x6 ${row.color} (${row.profile} ${row.profileColor})`;
        setZohoMessage(`Creating Other Accessory composite: "${oaName}"...`);
        const oaCompositeId = await resolveCompositeItem(oaName, oaName, [
          { item_id: oaStoneId, quantity: oaStoneQty },
          { item_id: cuttingServiceId, quantity: 1 }
        ], oaCf);

        newCabinetLines.push({
          item_id: oaCompositeId,
          quantity: Math.max(1, row.qty),
          rate: 0,
          description: `Profile: ${row.profile} ${row.profileColor}`
        });
      }

      // Step 3: Fetch Sales Order, append lines, and update
      setZohoMessage(`Fetching details for Sales Order: ${selectedSo.salesorder_number}...`);
      const soRes = await fetch(`/api/zoho/salesorders/${encodeURIComponent(selectedSo.salesorder_id)}`);
      if (!soRes.ok) {
        throw new Error(`Failed to fetch Sales Order detail: ${soRes.statusText}`);
      }
      
      const soData = await soRes.json();
      const currentSo = soData.salesorder;
      if (!currentSo) {
        throw new Error("Sales order detail not found in response.");
      }

      const firstLine = currentSo.line_items?.[0] || {};
      const taxFields = (src: any) => ({
        tax_id: src.tax_id !== undefined ? src.tax_id : (firstLine.tax_id ?? ""),
        tax_name: src.tax_name !== undefined ? src.tax_name : (firstLine.tax_name ?? ""),
        tax_percentage: src.tax_percentage !== undefined ? src.tax_percentage : (firstLine.tax_percentage ?? 0),
        tax_type: src.tax_type !== undefined ? src.tax_type : (firstLine.tax_type ?? "tax"),
        gst_treatment_code: src.gst_treatment_code !== undefined ? src.gst_treatment_code : (firstLine.gst_treatment_code ?? "out_of_scope")
      });

      // Index the freshly-built cabinet composites by their canonical cabinet code.
      const newByCode = new Map<string, Array<typeof newCabinetLines[number]>>();
      for (const nl of newCabinetLines) {
        if (!nl.code) continue;
        const arr = newByCode.get(nl.code) || [];
        arr.push(nl);
        newByCode.set(nl.code, arr);
      }

      // Rebuild the SO line items: a SERVICE line whose decoded cabinet code matches a new
      // composite is REPLACED by that composite (carrying over the service line's qty & rate);
      // a line that is already a BOM (non-service) is kept untouched.
      const usedNew = new Set<typeof newCabinetLines[number]>();
      const rebuilt: any[] = [];
      let replacedCount = 0;
      for (const orig of (currentSo.line_items || [])) {
        const isService = String(orig.product_type || "").toLowerCase() === "service";
        if (isService) {
          const decoded = parseCabinetCodeToModel(orig.sku || orig.name || orig.description, design);
          const candidates = decoded?.code ? newByCode.get(decoded.code) : undefined;
          const replacement = candidates?.find((c) => !usedNew.has(c));
          if (replacement) {
            usedNew.add(replacement);
            replacedCount++;
            rebuilt.push({
              item_id: replacement.item_id,
              quantity: orig.quantity,
              rate: orig.rate,
              ...(replacement.description ? { description: replacement.description } : {}),
              ...taxFields(orig)
            });
            continue;
          }
        }
        rebuilt.push(buildSoLineItem(orig));
      }

      // Append any new composites that didn't replace a service line (manually-added cabinets
      // on /builder, other accessories, etc.).
      const appended = newCabinetLines.filter((nl) => !usedNew.has(nl));
      for (const nl of appended) {
        rebuilt.push({
          item_id: nl.item_id,
          quantity: nl.quantity,
          rate: nl.rate,
          ...(nl.description ? { description: nl.description } : {}),
          ...taxFields(firstLine)
        });
      }

      setZohoMessage(`Updating Sales Order ${currentSo.salesorder_number} (${replacedCount} replaced, ${appended.length} added)...`);
      const updateRes = await fetch(`/api/zoho/salesorders/${encodeURIComponent(selectedSo.salesorder_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_items: rebuilt
        })
      });

      if (!updateRes.ok) {
        const errData = await updateRes.json().catch(() => ({}));
        throw new Error(`Failed to update Sales Order: ${errData.error || updateRes.statusText}`);
      }

      setZohoMessage(`Sales Order ${currentSo.salesorder_number} updated — ${replacedCount} service item(s) replaced with BOMs, ${appended.length} added.`);
    } catch (err: any) {
      console.error("Zoho integration flow error:", err);
      setZohoMessage(`Error: ${err.message || "An unexpected error occurred."}`);
    } finally {
      setZohoLoading(false);
    }
  };

  // ---- Families & Variants logic helpers ----
  const currentFams = useMemo(() => famSetOf(zone), [zone]);
  const activeFamilyKey = useMemo(() => {
    return currentFams[family] ? family : Object.keys(currentFams)[0];
  }, [currentFams, family]);
  const currentFam = useMemo(() => currentFams[activeFamilyKey], [currentFams, activeFamilyKey]);
  const currentVariant = useMemo(() => {
    if (!currentFam) return null;
    return currentFam.variants.find((v: any) => v.id === variantId) || currentFam.variants[0];
  }, [currentFam, variantId]);

  const hasDrawers = useMemo(() => {
    if (!currentVariant) return false;
    return shutSpec(zone, activeFamilyKey, currentVariant, inbuiltDrawers).kind === "drawer";
  }, [zone, activeFamilyKey, currentVariant, inbuiltDrawers]);

  const hasInbuiltDrawerOption = useMemo(() => {
    return (activeFamilyKey === "DW" || activeFamilyKey === "HO") && currentVariant?.id === "3dr";
  }, [activeFamilyKey, currentVariant]);

  // Adjust standard sizes mapping on zone/family changes
  const standardSizes = useMemo(() => {
    return SIZES[zone + "." + activeFamilyKey] || defSizes(zone);
  }, [zone, activeFamilyKey]);

  // Reset standard dimensions on sizes changes
  useEffect(() => {
    if (standardSizes) {
      setWSel(String(standardSizes.w[0] ?? "600"));
      setHSel(String(standardSizes.h[0] ?? "720"));
      setDSel(String(standardSizes.d));
    }
  }, [standardSizes]);

  // Handle defaults
  useEffect(() => {
    const famKeys = Object.keys(currentFams);
    if (!famKeys.includes(family)) {
      setFamily(famKeys[0]);
    }
  }, [zone, currentFams, family]);

  useEffect(() => {
    if (currentFam) {
      const isBlindZone = !!ZONES[zone]?.blind;
      // Blind units never offer a double-door configuration.
      const allowed = currentFam.variants.filter(
        (v: any) => !(isBlindZone && (v.both || /double/i.test(v.label || "")))
      );
      const varKeys = allowed.map((v: any) => v.id);
      if (!varKeys.includes(variantId)) {
        setVariantId(varKeys[0]);
      }
    }
  }, [family, currentFam, variantId, zone]);

  // Reset Handle XCJ / STD depending on zone (Base zones only get XCJ handle option)
  const isBaseZone = useMemo(() => {
    const z = ZONES[zone];
    return !z.kind && !z.tall;
  }, [zone]);

  useEffect(() => {
    if (!isBaseZone) {
      setHandle("STD");
    } else {
      setHandle("XCJ");
    }
  }, [zone, isBaseZone]);

  // Calculate actual numeric dimensions
  const finalW = useMemo(() => (wSel === "custom" ? customW : parseInt(wSel) || 600), [wSel, customW]);
  const finalH = useMemo(() => (hSel === "custom" ? customH : parseInt(hSel) || 720), [hSel, customH]);
  const finalD = useMemo(() => (dSel === "custom" ? customD : parseInt(dSel) || 560), [dSel, customD]);

  // The family's "Double" configuration (Double door / Double bowl / ...), if any.
  const doubleVariantId = useMemo(() => {
    const dv = currentFam?.variants.find((v: any) => /double/i.test(v.label || ""));
    return dv?.id ?? null;
  }, [currentFam]);

  // ---- Width <-> Configuration coupling ----
  // A cabinet wider than 600mm is a 2-shutter unit, so it must use the Double configuration;
  // conversely, picking the Double configuration forces the width above 600. Both are wired as
  // user-action handlers (not reactive effects) so the two rules never trap each other.
  const numericWidthOf = (sel: string) => (sel === "custom" ? customW : parseInt(sel) || 0);

  const coupleWidthToVariant = (widthVal: number) => {
    if (doubleVariantId && widthVal > 600 && currentVariant?.id !== doubleVariantId) {
      setVariantId(doubleVariantId);
    }
  };

  const handleWidthSelect = (val: string) => {
    setWSel(val);
    if (val !== "custom") coupleWidthToVariant(parseInt(val) || 0);
  };

  const handleCustomWidth = (num: number) => {
    setCustomW(num);
    coupleWidthToVariant(num);
  };

  const handleVariantChange = (newId: string) => {
    setVariantId(newId);
    if (!currentFam) return;
    const newVar = currentFam.variants.find((v: any) => v.id === newId);
    if (!newVar) return;
    const curW = numericWidthOf(wSel);
    const isDouble = /double/i.test(newVar.label || "");
    if (isDouble && curW <= 600) {
      const firstWide = standardSizes.w.find((w) => w > 600);
      if (firstWide) setWSel(String(firstWide));
      else { setWSel("custom"); setCustomW((c) => (c > 600 ? c : 900)); }
    } else if (!isDouble && newVar.handed && curW > 600) {
      const narrow = [...standardSizes.w].filter((w) => w <= 600).pop();
      if (narrow) setWSel(String(narrow));
      else { setWSel("custom"); setCustomW((c) => (c > 0 && c <= 600 ? c : 600)); }
    }
    // Base drawer 3-drawer config has no 450 width — bump off it if currently selected.
    if ((activeFamilyKey === "DW" || activeFamilyKey === "HO") && newId === "3dr" && curW === 450) {
      const alt = standardSizes.w.find((w) => w !== 450);
      if (alt) setWSel(String(alt));
      else { setWSel("custom"); setCustomW((c) => (c && c !== 450 ? c : 600)); }
    }
  };

  // Invariant guard: a Double configuration must always be wider than 600mm (two-shutter unit).
  // Action handlers cover direct user edits, but a "Double" variant can also persist across a
  // Cabinet-Family switch with a stale ≤600 width — this effect repairs that case. It only ever
  // raises the width for Double variants, so it cannot trap the user: the escape to a single
  // configuration runs through handleVariantChange, which atomically drops the width back ≤600.
  useEffect(() => {
    if (!currentVariant) return;
    const isDouble = /double/i.test(currentVariant.label || "");
    if (isDouble && finalW <= 600) {
      const firstWide = standardSizes.w.find((w) => w > 600);
      if (firstWide) setWSel(String(firstWide));
      else { setWSel("custom"); setCustomW((c) => (c > 600 ? c : 900)); }
    }
  }, [currentVariant, finalW, standardSizes]);

  // Get valid shutter designs. Glass-shutter families can only carry a glass profile:
  // NEON20 (slim, the default/locked choice) or CL1 (classic). When the design lock is
  // released the user may switch between these two; CL1 in a glass family is treated as a
  // glass shutter (5mm glass, inset same as stone). CL1 also remains in the stone-family
  // dropdown below, where it is treated as a 6mm stone shutter with stone shades.
  const designsList = useMemo(() => {
    return validDesigns(zone, activeFamilyKey, currentVariant, finalW);
  }, [zone, activeFamilyKey, currentVariant, finalW]);

  // Glass-shutter cabinets: lock the design to NEON20 unless the user unlocks it.
  const isGlassShutterSelected = isGlassShutterFam(activeFamilyKey);
  const designLocked = isGlassShutterSelected && !designUnlocked;
  // Blind glass unit: the functional shutter is glass and the fixed dummy panel is stone,
  // so we show two shade pickers — glass color + fixed-panel stone shade.
  const isBlindGlassSelected = isGlassShutterSelected && !!ZONES[zone]?.blind;

  // Re-lock the design picker whenever we leave a glass-shutter family.
  useEffect(() => {
    if (!isGlassShutterSelected && designUnlocked) setDesignUnlocked(false);
  }, [isGlassShutterSelected, designUnlocked]);

  useEffect(() => {
    if (designLocked) {
      if (design !== "NEON20") setDesign("NEON20");
      return;
    }
    if (designsList.length > 0) {
      if (!designsList.includes(design)) {
        setDesign(designsList[0]);
      }
    } else {
      setDesign("");
    }
  }, [designsList, design, designLocked]);

  // Design drives/locks the handle (base zones only, where the handle is selectable):
  // MD1/MD3 + their CM variants are handleless XCJ; MD2 + its CM variants use the Titus
  // (STD) handle. CL1/CL2/NEON20 leave the handle to the user.
  const handleLockedByDesign = isBaseZone && (XCJ_DESIGNS.includes(design) || STD_DESIGNS.includes(design));
  useEffect(() => {
    if (!isBaseZone) return;
    if (XCJ_DESIGNS.includes(design)) {
      if (handle !== "XCJ") setHandle("XCJ");
    } else if (STD_DESIGNS.includes(design)) {
      if (handle !== "STD") setHandle("STD");
    }
  }, [design, isBaseZone, handle]);

  useEffect(() => {
    if (!hasInbuiltDrawerOption && inbuiltDrawers !== "none") {
      setInbuiltDrawers("none");
    }
  }, [hasInbuiltDrawerOption, inbuiltDrawers]);

  // Derived Model
  const model = useMemo(() => {
    // For glass families the shutter shade is the glass color; the stone `shutterMat`
    // selector then represents the fixed-panel stone shade (blind glass only).
    const effShutterMat = isGlassShutterSelected ? glassColor : shutterMat;
    const effFixedPanelMat = isBlindGlassSelected ? shutterMat : "";
    return buildModel(zone, activeFamilyKey, currentVariant, handle, design, carcassMat, effShutterMat, carcassProfileColor, shutterProfileColor, finalW, finalH, finalD, thickness, handed, drawerModel, inbuiltDrawers, effFixedPanelMat, ZONES[zone]?.kind === "loft" ? tipOn : "");
  }, [zone, activeFamilyKey, currentVariant, handle, design, carcassMat, shutterMat, glassColor, isGlassShutterSelected, isBlindGlassSelected, carcassProfileColor, shutterProfileColor, finalW, finalH, finalD, thickness, handed, drawerModel, inbuiltDrawers, tipOn]);

  useEffect(() => {
    (window as any).__BOM_CONTEXT__ = {
      page: "builder",
      model: {
        code: model.code,
        zone,
        family: activeFamilyKey,
        width: finalW,
        height: finalH,
        depth: finalD,
        carcassMaterial: carcassMat,
        shutterMaterial: shutterMat,
        design: design,
        validDesigns: designsList
      }
    };
  }, [model, zone, activeFamilyKey, finalW, finalH, finalD, carcassMat, shutterMat, design, designsList]);

  // Option lists for custom searchable selects
  const zoneOptions = useMemo(() => {
    return Object.entries(ZONES).map(([k, z]) => ({
      value: k,
      label: z.name
    }));
  }, []);

  const familyOptions = useMemo(() => {
    return Object.entries(currentFams).map(([k, f]: [string, any]) => ({
      value: k,
      label: f.name
    }));
  }, [currentFams]);

  const variantOptions = useMemo(() => {
    if (!currentFam) return [];
    const isBlindZone = !!ZONES[zone]?.blind;
    return currentFam.variants
      // Blind units never offer a double-door configuration.
      .filter((v: any) => !(isBlindZone && (v.both || /double/i.test(v.label || ""))))
      .map((v: any) => ({
        value: v.id,
        label: v.label
      }));
  }, [currentFam, zone]);

  const handOptions = useMemo(() => [
    { value: "LHS", label: "LHS — active Left" },
    { value: "RHS", label: "RHS — active Right" }
  ], []);

  const drawerModelOptions = useMemo(() => [
    { value: "Lian", label: "Lian" },
    { value: "Hettich", label: "Hettich" },
    { value: "Blum", label: "Blum" },
    { value: "Hafele", label: "Hafele" },
    { value: "Grass", label: "Grass" }
  ], []);

  const handleOptions = useMemo(() => {
    const opts = [];
    if (isBaseZone) {
      opts.push({ value: "XCJ", label: "XCJ — CJ / Gola" });
    }
    opts.push({ value: "STD", label: "STD — Standard" });
    return opts;
  }, [isBaseZone]);

  const designOptions = useMemo(() => {
    return designsList.map((d) => ({ value: d, label: d }));
  }, [designsList]);

  const wOptions = useMemo(() => {
    const isDoubleVariant = !!currentVariant && /double/i.test(currentVariant.label || "");
    let widths = isDoubleVariant ? standardSizes.w.filter((v) => v > 600) : standardSizes.w;
    // Base drawer (DW/HO) 3-drawer configuration does not offer the 450 width.
    if ((activeFamilyKey === "DW" || activeFamilyKey === "HO") && currentVariant?.id === "3dr") {
      widths = widths.filter((v) => v !== 450);
    }
    const opts = widths.map((v) => ({ value: String(v), label: String(v) }));
    opts.push({ value: "custom", label: "Custom…" });
    return opts;
  }, [standardSizes, currentVariant, activeFamilyKey]);

  const hOptions = useMemo(() => {
    const opts = standardSizes.h.map((v) => ({ value: String(v), label: String(v) }));
    opts.push({ value: "custom", label: "Custom…" });
    return opts;
  }, [standardSizes]);

  const dOptions = useMemo(() => {
    const opts = [{ value: String(standardSizes.d), label: String(standardSizes.d) }];
    opts.push({ value: "custom", label: "Custom…" });
    return opts;
  }, [standardSizes]);

  const thicknessOptions = useMemo(() => {
    return ["5", "6", "7", "9", "12", "15", "16", "20"].map((t) => ({ value: t, label: `${t} mm` }));
  }, []);

  // Raw Material Selection States (Aggregated)
  const [rawOptionsMap, setRawOptionsMap] = useState<Record<string, any[]>>({});
  const [selectedRawIds, setSelectedRawIds] = useState<Record<string, string>>({});
  const [rawLoadingMap, setRawLoadingMap] = useState<Record<string, boolean>>({});
  const [rawErrorMap, setRawErrorMap] = useState<Record<string, string>>({});
  const [customPcsMap, setCustomPcsMap] = useState<Record<string, string>>({});

  // Helper utility to read custom fields
  const getCfValue = (item: any, apiName: string): string => {
    if (!item) return "";
    if (item[apiName] !== undefined && item[apiName] !== null && item[apiName] !== "") {
      return String(item[apiName]);
    }
    const fields = item?.custom_fields || [];
    const f = fields.find((x: any) => x.api_name === apiName);
    return f ? String(f.value || "") : "";
  };

  const getSlabArea = (item: any) => {
    const len = parseFloat(getCfValue(item, "cf_height")) || 0;
    const wid = parseFloat(getCfValue(item, "cf_width")) || 0;
    if (len > 0 && wid > 0) {
      return (len * wid) / 92903.04;
    }
    return 0;
  };

  const hasShutters = useMemo(() => {
    return model.shutters && model.shutters.length > 0;
  }, [model.shutters]);

  // Active items priority list: Zoho SO line items -> Project line items -> fallback to current configured cabinet
  const activeItems = useMemo(() => {
    if (selectedSo && loadedSoDetail && loadedSoDetail.line_items) {
      const items: Array<{ qty: number; m: CarcassModel }> = [];
      loadedSoDetail.line_items.forEach((line: any) => {
        // Service line items carry the cabinet code in `description` (sku/name are empty).
        const parsed = parseCabinetCodeToModel(line.sku || line.name || line.description, design);
        if (parsed) {
          items.push({ qty: line.quantity, m: parsed });
        }
      });
      return items;
    }
    if (project.length > 0) {
      return project.map((l) => ({ qty: l.qty, m: l.m }));
    }
    // Designer (SO) mode: nothing is configured manually, so without a Sales Order there are
    // no materials — don't fall back to the default unit. The Builder keeps the fallback.
    return soMode ? [] : [{ qty: 1, m: model }];
  }, [selectedSo, loadedSoDetail, project, model, design, soMode]);

  // Aggregated Stone and Profile requirements
  const rawAggregation = useMemo(() => {
    const stones: Record<string, AggregatedStone> = {};
    const profiles: Record<string, AggregatedProfile> = {};
    const hardwareMap: Record<string, AggregatedHardware> = {};

    activeItems.forEach(({ qty, m }) => {
      // 1. Carcass Stone
      const cFinish = m.carcassMat || m.mat || "STATUARIO";
      const cThick = m.t || 15;
      const cKey = `carcass|${cFinish}|${cThick}`;
      if (!stones[cKey]) {
        stones[cKey] = {
          key: cKey,
          category: "carcass",
          finish: cFinish,
          thickness: cThick,
          netSqft: 0,
        };
      }
      stones[cKey].netSqft += m.netSqft * qty;

      // 2. Shutter Stone
      if (m.shutters && m.shutters.length > 0) {
        const glassFam = isGlassShutterFam(m.fk);
        m.shutters.forEach((s) => {
          // Glass faces (non-fixed shutters in a glass family) are not stone.
          const isGlassFace = glassFam && s.kind !== "fixed";
          if (isGlassFace) return;
          // Fixed panels in glass families use the fixed-panel stone shade.
          const sFinish = (glassFam && s.kind === "fixed")
            ? (m.fixedPanelMat || m.shutterMat || m.mat || "STATUARIO")
            : (m.shutterMat || m.mat || "STATUARIO");
          const sThk = shThkOf(s.design, false); // 9 for MD3 family, else 6
          const sKey = `shutter|${sFinish}|${sThk}`;
          if (!stones[sKey]) {
            stones[sKey] = {
              key: sKey,
              category: "shutter",
              finish: sFinish,
              thickness: sThk,
              netSqft: 0,
            };
          }
          stones[sKey].netSqft += sqft(s.pw, s.ph) * qty;
        });
      }

      // 3. Carcass Profiles
      m.profiles.forEach((p) => {
        if (!p.type) return;
        const pFinish = m.carcassProfileColor || "CHAMPAGNE";
        const pKey = `carcass|${p.type}|${pFinish}`;
        if (!profiles[pKey]) {
          profiles[pKey] = {
            key: pKey,
            category: "carcass",
            profileCode: p.type,
            finish: pFinish,
            lenMeters: 0,
          };
        }
        profiles[pKey].lenMeters += ((p.len * p.qty) / 1000) * qty;
      });

      // 4. Shutter Profiles — group per-shutter design so fixed MD1 panels
      //    get their own raw-profile selection alongside glass NEON20 doors.
      if (m.shutters && m.shutters.length > 0) {
        const sFinish = m.shutterProfileColor || "CHAMPAGNE";
        m.shutters.forEach((s) => {
          const sDesign = s.design || design || "MD1";
          const pKey = `shutter|${sDesign}|${sFinish}`;
          if (!profiles[pKey]) {
            profiles[pKey] = {
              key: pKey,
              category: "shutter",
              profileCode: sDesign,
              finish: sFinish,
              lenMeters: 0,
            };
          }
          profiles[pKey].lenMeters += ((2 * s.profV + 2 * s.profH) / 1000) * qty;
        });
      }

      // 5. Hardware items
      m.hardware.forEach((h) => {
        const def = HARDWARE_PACK_DEFINITIONS[h.name];
        if (def) {
          def.forEach((comp) => {
            const compKey = `hw|${comp.component}`;
            if (!hardwareMap[compKey]) {
              hardwareMap[compKey] = { key: compKey, name: comp.component, uom: comp.uom, totalQty: 0 };
            }
            hardwareMap[compKey].totalQty += comp.qty * h.qty * qty;
          });
        } else {
          const hKey = `hw|${h.name}`;
          if (!hardwareMap[hKey]) {
            hardwareMap[hKey] = { key: hKey, name: h.name, uom: h.uom || "Set", totalQty: 0 };
          }
          hardwareMap[hKey].totalQty += h.qty * qty;
        }
      });

      // 6. Consumable items
      m.cons.forEach((c) => {
        const cKey = `hw|${c.name}`;
        if (!hardwareMap[cKey]) {
          hardwareMap[cKey] = { key: cKey, name: c.name, uom: c.uom, totalQty: 0 };
        }
        hardwareMap[cKey].totalQty += c.qty * qty;
      });
    });

    // Add Fillers to rawAggregation
    fillers.forEach((f) => {
      const zoneKey = f.zone;
      const q = f.qty;
      const finish = f.customShade || getDefaultShutterShadeForZone(zoneKey);
      const H = f.customHeight ? parseFloat(f.customHeight) || 0 : getDefaultShutterHeightForZone(zoneKey);
      const W = f.customWidth ? parseFloat(f.customWidth) || 0 : 80;

      const pw = W;
      const ph = H;
      const fSqft = sqft(pw, ph) * q;

      const sKey = `shutter|${finish}|6`;
      if (!stones[sKey]) {
        stones[sKey] = { key: sKey, category: "shutter", finish, thickness: 6, netSqft: 0 };
      }
      stones[sKey].netSqft += fSqft;

      const pFinish = getProfileColorForZone(zoneKey);
      const pKey = `shutter|HM-504|${pFinish}`;
      if (!profiles[pKey]) {
        profiles[pKey] = { key: pKey, category: "shutter", profileCode: "HM-504", finish: pFinish, lenMeters: 0 };
      }
      profiles[pKey].lenMeters += (H / 1000) * q;

      const cKey = `hw|GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG`;
      if (!hardwareMap[cKey]) {
        hardwareMap[cKey] = { key: cKey, name: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", uom: "ML", totalQty: 0 };
      }
      hardwareMap[cKey].totalQty += (H / 1000) * 15 * q;
    });

    // Add Visible Panels to rawAggregation
    visiblePanels.forEach((vp) => {
      const zoneKey = vp.zone;
      const q = vp.qty;
      const finish = vp.customShade || getDefaultShutterShadeForZone(zoneKey);
      const H = vp.customHeight ? parseFloat(vp.customHeight) || 0 : getDefaultShutterHeightForZone(zoneKey);
      const W = vp.customWidth ? parseFloat(vp.customWidth) || 0 : (getDefaultCabinetDepthForZone(zoneKey) + 25);

      const pw = W - 5;
      const ph = H - 5;
      const vpSqft = sqft(pw, ph) * q;

      const mainProfile = vp.profile.includes("MD3") ? "MD3" : "MD1";
      const vpThk = shThkOf(mainProfile, false);
      const sKey = `shutter|${finish}|${vpThk}`;
      if (!stones[sKey]) {
        stones[sKey] = { key: sKey, category: "shutter", finish, thickness: vpThk, netSqft: 0 };
      }
      stones[sKey].netSqft += vpSqft;

      const pFinish = getProfileColorForZone(zoneKey);
      const pKey = `shutter|${mainProfile}|${pFinish}`;
      if (!profiles[pKey]) {
        profiles[pKey] = { key: pKey, category: "shutter", profileCode: mainProfile, finish: pFinish, lenMeters: 0 };
      }
      profiles[pKey].lenMeters += ((2 * H + 2 * W) / 1000) * q;

      if (vp.profile.includes("CM")) {
        const cmKey = `shutter|CM1|${pFinish}`;
        if (!profiles[cmKey]) {
          profiles[cmKey] = { key: cmKey, category: "shutter", profileCode: "CM1", finish: pFinish, lenMeters: 0 };
        }
        profiles[cmKey].lenMeters += ((2 * H + 2 * W) / 1000) * q;
      }
    });

    // Add Backsplash to rawAggregation — the panel consumes stone; the glue is a per-sqft
    // rate × area × qty consumable.
    backsplashes.forEach((b) => {
      const q = Math.max(1, b.qty);
      const W = parseFloat(b.width) || 0;
      const H = parseFloat(b.height) || 0;
      const T = parseFloat(b.thickness) || 15;
      const color = b.color || getDefaultShutterShadeForZone("base");
      const areaSqft = sqft(W, H);

      const sKey = `shutter|${color}|${T}`;
      if (!stones[sKey]) stones[sKey] = { key: sKey, category: "shutter", finish: color, thickness: T, netSqft: 0 };
      stones[sKey].netSqft += areaSqft * q;

      const consName = "GLUE LATRICATE SUPER FLEX 20KG XX WHITE 335 AGG";
      const cKey = `hw|${consName}|kg`;
      if (!hardwareMap[cKey]) hardwareMap[cKey] = { key: cKey, name: consName, uom: "kg", totalQty: 0 };
      hardwareMap[cKey].totalQty += 1.25 * areaSqft * q;
    });

    // Add Countertop to rawAggregation — top stone + patti strips consume the counter colour
    // (pt mm); the dead-stock base consumes a "DEAD STOCK" bucket; per-sqft consumables.
    countertops.forEach((c) => {
      const q = Math.max(1, c.qty);
      const L = parseFloat(c.length) || 0;
      const D = parseFloat(c.depth) || 0;
      const T = parseFloat(c.thickness) || 30;
      const pt = T / 2;
      const color = c.color || getDefaultShutterShadeForZone("base");
      const topArea = sqft(L, D);

      // Counter-colour stone & dead-stock base must mirror the BOM build exactly. Geometry is the
      // single source of truth. "flat" pieces add their area to counter colour. "dropdown" pieces:
      // ONE visible drop stone (len × dropHeight, patti folded in) → counter colour; the reduced
      // base (dropHeight − 100) → dead stock; pasting scales by the drop area.
      const geom = ctGeom(c.ctType || 1, L, D, T, parseFloat(c.dropHeight) || 705);
      const dropIssue = (c.ctType === 7) ? 30 : 15;
      let colorArea = sqft(geom.topL, geom.topD); // top slab (incl. folds & 100mm reductions)
      let deadArea = sqft(geom.baseL, geom.baseD); // counter base stone (reduced)
      let pasteArea = topArea;                      // area driving polish/glue (counter + drops)
      for (const p of geom.panels) {
        if (p.kind === "dropdown") {
          const dh = p.wid;
          const visH = dh + dropIssue;
          const deadQty = p.deadQty || 1;
          colorArea += sqft(p.len, visH);                            // visible drop stone (issued + patti folded in)
          deadArea += sqft(p.len, Math.max(0, dh - 100)) * deadQty;  // drop base = (dropHeight − 100) × stones
          pasteArea += sqft(p.len, visH);
        } else {
          colorArea += sqft(p.len, p.wid);
        }
      }
      const sKey = `shutter|${color}|${pt}`;
      if (!stones[sKey]) stones[sKey] = { key: sKey, category: "shutter", finish: color, thickness: pt, netSqft: 0 };
      stones[sKey].netSqft += colorArea * q;

      const bKey = `shutter|DEAD STOCK|${pt}`;
      if (!stones[bKey]) stones[bKey] = { key: bKey, category: "shutter", finish: "DEAD STOCK", thickness: pt, netSqft: 0 };
      stones[bKey].netSqft += deadArea * q;

      const addC = (name: string, uom: string, qty: number) => {
        const k = `hw|${name}|${uom}`;
        if (!hardwareMap[k]) hardwareMap[k] = { key: k, name, uom, totalQty: 0 };
        hardwareMap[k].totalQty += qty;
      };
      addC("AKEMI 5010 FOR STONE POLISH 2.25 PER KG S", "gram", 10 * pasteArea * q);
      addC("GLUE BONDTITE FAST & CLEAR FOR STONE XX AGG", "gram", 10 * pasteArea * q);
      addC("GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", "ml", 40 * pasteArea * q);
    });

    // Add Other Accessories (Chimney/Dishwasher panels) to rawAggregation — they consume stone
    otherAccRows.forEach((row) => {
      const q = Math.max(1, row.qty);
      const sKey = `shutter|${row.color}|6`;
      if (!stones[sKey]) {
        stones[sKey] = { key: sKey, category: "shutter", finish: row.color, thickness: 6, netSqft: 0 };
      }
      stones[sKey].netSqft += sqft(row.width, row.height) * q;
    });

    return {
      stones: Object.values(stones),
      profiles: Object.values(profiles),
      hardware: Object.values(hardwareMap),
    };
  }, [activeItems, design, fillers, visiblePanels, backsplashes, countertops, otherAccRows]);

  // Retry helper — clears error + options for a key so the effect re-fetches
  const retryRawFetch = (key: string) => {
    setRawOptionsMap((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setRawErrorMap((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setRawLoadingMap((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };
  const retryAllRawFetch = () => {
    setRawOptionsMap({});
    setRawErrorMap({});
    setRawLoadingMap({});
  };

  // Effect to fetch Zoho items for the aggregated Stone & Profile combinations
  useEffect(() => {
    // 1. Stones
    rawAggregation.stones.forEach((stone) => {
      const { key, finish, thickness } = stone;
      if (rawOptionsMap[key] === undefined && !rawLoadingMap[key]) {
        setRawLoadingMap((prev) => ({ ...prev, [key]: true }));
        searchStoneItems(finish, thickness.toString())
          .then((items) => {
            setRawOptionsMap((prev) => ({ ...prev, [key]: items }));
            setRawErrorMap((prev) => { const next = { ...prev }; delete next[key]; return next; });
            if (items.length > 0) {
              setSelectedRawIds((prev) => {
                if (prev[key]) return prev; // keep existing selection if any
                return { ...prev, [key]: items[0].item_id || "" };
              });
            }
            setRawLoadingMap((prev) => ({ ...prev, [key]: false }));
          })
          .catch((err) => {
            // Expected & handled (shown inline as a Retry message). Use warn, not error, so
            // a Zoho outage / auth failure doesn't pop the Next.js dev error overlay.
            console.warn(`Error fetching stone for key ${key}:`, err);
            setRawErrorMap((prev) => ({ ...prev, [key]: err?.message || "Zoho API unreachable" }));
            setRawLoadingMap((prev) => ({ ...prev, [key]: false }));
          });
      }
    });

    // 2. Profiles
    rawAggregation.profiles.forEach((prof) => {
      const { key, finish, profileCode } = prof;
      if (rawOptionsMap[key] === undefined && !rawLoadingMap[key]) {
        setRawLoadingMap((prev) => ({ ...prev, [key]: true }));
        searchProfileItems(finish, profileCode)
          .then((items) => {
            setRawOptionsMap((prev) => ({ ...prev, [key]: items }));
            setRawErrorMap((prev) => { const next = { ...prev }; delete next[key]; return next; });
            if (items.length > 0) {
              setSelectedRawIds((prev) => {
                if (prev[key]) return prev; // keep existing selection
                return { ...prev, [key]: items[0].item_id || "" };
              });
            }
            setRawLoadingMap((prev) => ({ ...prev, [key]: false }));
          })
          .catch((err) => {
            console.warn(`Error fetching profile for key ${key}:`, err);
            setRawErrorMap((prev) => ({ ...prev, [key]: err?.message || "Zoho API unreachable" }));
            setRawLoadingMap((prev) => ({ ...prev, [key]: false }));
          });
      }
    });
    // 3. Hardware & Consumables
    rawAggregation.hardware.forEach((hw) => {
      const { key, name } = hw;
      if (rawOptionsMap[key] === undefined && !rawLoadingMap[key]) {
        setRawLoadingMap((prev) => ({ ...prev, [key]: true }));
        searchHardwareItems(name)
          .then((items) => {
            setRawOptionsMap((prev) => ({ ...prev, [key]: items }));
            setRawErrorMap((prev) => { const next = { ...prev }; delete next[key]; return next; });
            if (items.length > 0) {
              setSelectedRawIds((prev) => {
                if (prev[key]) return prev;
                // Auto-select exact name match if found
                const exact = items.find((i: any) => (i.name || i.item_name || "").toLowerCase() === name.toLowerCase());
                return { ...prev, [key]: exact?.item_id || items[0].item_id || "" };
              });
            }
            setRawLoadingMap((prev) => ({ ...prev, [key]: false }));
          })
          .catch((err) => {
            console.warn(`Error fetching hardware for key ${key}:`, err);
            setRawErrorMap((prev) => ({ ...prev, [key]: err?.message || "Zoho API unreachable" }));
            setRawLoadingMap((prev) => ({ ...prev, [key]: false }));
          });
      }
    });
  }, [rawAggregation.stones, rawAggregation.profiles, rawAggregation.hardware]);

  function getDefaultShutterShadeForZone(zoneKey: string) {
    const matchingLines = project.filter((line) => {
      const zk = line.m.zk || "";
      if (zoneKey === "base") return ["BC", "BCL", "BB", "BBL"].includes(zk);
      if (zoneKey === "tall") return ["TC", "TB", "TCL"].includes(zk);
      if (zoneKey === "wall") return ["WC", "WB"].includes(zk);
      if (zoneKey === "loft") return ["LO", "LB", "LBF", "LOF"].includes(zk);
      if (zoneKey === "mid") return ["MD"].includes(zk);
      return false;
    });
    if (matchingLines.length > 0) {
      return matchingLines[0].m.shutterMat || matchingLines[0].m.mat || shutterMat;
    }
    return shutterMat;
  }

  function getDefaultShutterHeightForZone(zoneKey: string) {
    const matchingLines = project.filter((line) => {
      const zk = line.m.zk || "";
      if (zoneKey === "base") return ["BC", "BCL", "BB", "BBL"].includes(zk);
      if (zoneKey === "tall") return ["TC", "TB", "TCL"].includes(zk);
      if (zoneKey === "wall") return ["WC", "WB"].includes(zk);
      if (zoneKey === "loft") return ["LO", "LB", "LBF", "LOF"].includes(zk);
      if (zoneKey === "mid") return ["MD"].includes(zk);
      return false;
    });
    if (matchingLines.length > 0) {
      for (const line of matchingLines) {
        if (line.m.shutters && line.m.shutters.length > 0) {
          return line.m.shutters[0].h;
        }
      }
      return matchingLines[0].m.H;
    }
    if (zoneKey === "base") return 715;
    if (zoneKey === "tall") return 2095;
    if (zoneKey === "wall") return 715;
    if (zoneKey === "loft") return 355;
    if (zoneKey === "mid") return 1195;
    return 720;
  }

  function getDefaultCabinetDepthForZone(zoneKey: string) {
    const matchingLines = project.filter((line) => {
      const zk = line.m.zk || "";
      if (zoneKey === "base") return ["BC", "BCL", "BB", "BBL"].includes(zk);
      if (zoneKey === "tall") return ["TC", "TB", "TCL"].includes(zk);
      if (zoneKey === "wall") return ["WC", "WB"].includes(zk);
      if (zoneKey === "loft") return ["LO", "LB", "LBF", "LOF"].includes(zk);
      if (zoneKey === "mid") return ["MD"].includes(zk);
      return false;
    });
    if (matchingLines.length > 0) {
      return matchingLines[0].m.D;
    }
    if (zoneKey === "base" || zoneKey === "tall" || zoneKey === "loft") return 560;
    return 330;
  }

  function getShutterProfileForZone(zoneKey: string) {
    const matchingLines = project.filter((line) => {
      const zk = line.m.zk || "";
      if (zoneKey === "base") return ["BC", "BCL", "BB", "BBL"].includes(zk);
      if (zoneKey === "tall") return ["TC", "TB", "TCL"].includes(zk);
      if (zoneKey === "wall") return ["WC", "WB"].includes(zk);
      if (zoneKey === "loft") return ["LO", "LB", "LBF", "LOF"].includes(zk);
      if (zoneKey === "mid") return ["MD"].includes(zk);
      return false;
    });
    if (matchingLines.length > 0) {
      for (const line of matchingLines) {
        if (line.m.shutters && line.m.shutters.length > 0) {
          return line.m.shutters[0].design;
        }
      }
    }
    return design || "MD1";
  }

  function getProfileColorForZone(zoneKey: string) {
    const matchingLines = project.filter((line) => {
      const zk = line.m.zk || "";
      if (zoneKey === "base") return ["BC", "BCL", "BB", "BBL"].includes(zk);
      if (zoneKey === "tall") return ["TC", "TB", "TCL"].includes(zk);
      if (zoneKey === "wall") return ["WC", "WB"].includes(zk);
      if (zoneKey === "loft") return ["LO", "LB", "LBF", "LOF"].includes(zk);
      if (zoneKey === "mid") return ["MD"].includes(zk);
      return false;
    });
    if (matchingLines.length > 0) {
      return matchingLines[0].m.shutterProfileColor || shutterProfileColor || "CHAMPAGNE";
    }
    return shutterProfileColor || "CHAMPAGNE";
  }

  // Consolidated Aggregates
  const aggregates = useMemo(() => {
    let netSqft = 0;
    let nPanels = 0;
    let cut = 0;
    let drill = 0;
    let glue = 0;
    let sil = 0;
    let shSqft = 0;
    let shProf = 0;
    let shCorner = 0;
    const profAgg: Record<string, number> = {};
    const hardAgg: Record<string, number> = {};
    const finAgg: Record<string, { sqft: number; pan: number }> = {};
    const consAgg: Record<string, number> = {};

    project.forEach((l) => {
      const m = l.m;
      const q = l.qty;
      netSqft += m.netSqft * q;
      nPanels += m.nPanels * q;
      cut += m.ops.cut * q;
      drill += m.ops.drill * q;

      m.profiles.forEach((p) => {
        profAgg[p.type] = (profAgg[p.type] || 0) + ((p.len * p.qty) / 1000) * q;
      });
      m.hardware.forEach((h) => {
        hardAgg[h.name] = (hardAgg[h.name] || 0) + h.qty * q;
      });
      m.cons.forEach((c) => {
        if (c.uom === "ML") glue += c.qty * q;
        else if (c.uom === "Kg") sil += c.qty * q;
        else {
          const k = c.name.split(" (")[0] + "|" + c.uom;
          consAgg[k] = (consAgg[k] || 0) + c.qty * q;
        }
      });
      (m.shutters || []).forEach((s) => {
        shSqft += sqft(s.pw, s.ph) * q;
        shProf += ((2 * s.profV + 2 * s.profH) / 1000) * q;
        shCorner += q;
        hardAgg[s.hinge] = (hardAgg[s.hinge] || 0) + (s.hq || 1) * q;
      });

      const carcassFinish = m.carcassMat || m.mat || "STATUARIO";
      if (!finAgg[carcassFinish]) finAgg[carcassFinish] = { sqft: 0, pan: 0 };
      finAgg[carcassFinish].sqft += m.netSqft * q;
      finAgg[carcassFinish].pan += m.nPanels * q;

      if (m.shutters && m.shutters.length > 0) {
        const shutterFinish = m.shutterMat || m.mat || "STATUARIO";
        if (!finAgg[shutterFinish]) finAgg[shutterFinish] = { sqft: 0, pan: 0 };
        const unitShSqftVal = m.shutters.reduce((acc, s) => acc + sqft(s.pw, s.ph), 0);
        finAgg[shutterFinish].sqft += unitShSqftVal * q;
        finAgg[shutterFinish].pan += m.shutters.length * q;
      }
    });

    // Add Fillers
    fillers.forEach((f) => {
      const zoneKey = f.zone;
      const q = f.qty;
      const finish = f.customShade || getDefaultShutterShadeForZone(zoneKey);
      const H = f.customHeight ? parseFloat(f.customHeight) || 0 : getDefaultShutterHeightForZone(zoneKey);
      const W = f.customWidth ? parseFloat(f.customWidth) || 0 : 80;
      
      const pw = W;
      const ph = H;
      const fSqft = sqft(pw, ph) * q;
      const fProf = (H / 1000) * q;
      
      shSqft += fSqft;
      shProf += fProf;

      if (!finAgg[finish]) finAgg[finish] = { sqft: 0, pan: 0 };
      finAgg[finish].sqft += fSqft;
      finAgg[finish].pan += q;

      const profDesign = "HM-504";
      profAgg[profDesign] = (profAgg[profDesign] || 0) + fProf;

      const glueName = "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG";
      const glueQty = (H / 1000) * 15 * q;
      const k = glueName + "|ml";
      consAgg[k] = (consAgg[k] || 0) + glueQty;
    });

    // Add Visible Panels
    visiblePanels.forEach((vp) => {
      const zoneKey = vp.zone;
      const q = vp.qty;
      const finish = vp.customShade || getDefaultShutterShadeForZone(zoneKey);
      const H = vp.customHeight ? parseFloat(vp.customHeight) || 0 : getDefaultShutterHeightForZone(zoneKey);
      const W = vp.customWidth ? parseFloat(vp.customWidth) || 0 : (getDefaultCabinetDepthForZone(zoneKey) + 25);
      
      const pw = W - 5;
      const ph = H - 5;
      const fSqft = sqft(pw, ph) * q;
      
      const mainProfile = vp.profile.includes("MD3") ? "MD3" : "MD1";
      const multiplier = vp.profile.includes("CM") ? 2 : 1;
      const fProf = ((2 * H + 2 * W) / 1000) * q * multiplier;
      
      shSqft += fSqft;
      shProf += fProf;
      shCorner += q;

      if (!finAgg[finish]) finAgg[finish] = { sqft: 0, pan: 0 };
      finAgg[finish].sqft += fSqft;
      finAgg[finish].pan += q;

      profAgg[mainProfile] = (profAgg[mainProfile] || 0) + ((2 * H + 2 * W) / 1000) * q;
      if (vp.profile.includes("CM")) {
        profAgg["CM1"] = (profAgg["CM1"] || 0) + ((2 * H + 2 * W) / 1000) * q;
      }
    });

    const extraCons = Object.entries(consAgg).map(([k, v]) => {
      const [n, u] = k.split("|");
      return { name: n, qty: v, uom: u };
    });

    return {
      netSqft,
      nPanels,
      cut,
      drill,
      glue,
      sil,
      shSqft,
      shProf,
      shCorner,
      profAgg,
      hardAgg,
      finAgg,
      extraCons,
    };
  }, [project, fillers, visiblePanels, shutterMat, design, shutterProfileColor]);

  // CSV Output
  const csvText = useMemo(() => {
    return buildCSV(project);
  }, [project]);

  const addLine = () => {
    if (!elevation) {
      alert("Please select an Elevation before adding the cabinet to the project.");
      return;
    }
    const q = Math.max(1, lineQty);
    setProject((curr) => [...curr, { qty: q, m: model, rate: soRate, elevation }]);
  };

  // ---- Other Accessories helpers ----
  const otherAccProfileOptions = SH_DESIGNS; // profile design codes

  const addOtherAccRow = () => {
    const nextId = otherAccCounter + 1;
    setOtherAccCounter(nextId);
    setOtherAccRows((cur) => [
      ...cur,
      { id: nextId, item: "chimney", width: customW, height: customH, profile: design, profileColor: shutterProfileColor, color: shutterMat, qty: 1 },
    ]);
  };
  const updateOtherAccRow = (rowId: number, patch: Partial<OtherAccRow>) => {
    setOtherAccRows((cur) => cur.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  };
  const removeOtherAccRow = (rowId: number) => {
    setOtherAccRows((cur) => cur.filter((r) => r.id !== rowId));
  };

  const removeLine = (idx: number) => {
    setProject((curr) => curr.filter((_, i) => i !== idx));
  };

  const copyCode = () => {
    const t = model.code;
    navigator.clipboard?.writeText(t).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1200);
    });
  };

  const copyCsvData = () => {
    navigator.clipboard?.writeText(csvText).then(() => {
      setCopiedCsv(true);
      setTimeout(() => setCopiedCsv(false), 1200);
    });
  };

  const downloadCsvFile = () => {
    const blob = new Blob([csvText], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "carcass_bom.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  // Enumerate EVERY carcass combination (zone × family × variant × handed × handle × W×H)
  // at a fixed thickness of 15mm, finish left as "ANY" (no row multiplication by finish).
  // Engine-derived columns (code, net sqft, #panels, #shutters) come from buildModel itself.
  const exportAllCombinations = () => {
    type Row = Record<string, string | number>;
    const rows: Row[] = [];
    // Per-row set of valid SHUTTER DESIGN profiles (MD1, MD2, …, NEON20) this cabinet can
    // use, aligned 1:1 with `rows`, plus the global union — used to emit Yes/No columns.
    const rowProfSets: Set<string>[] = [];
    const allProfCodes = new Set<string>();
    const t = 15;
    const placeholderDesign = "MD1"; // only feeds shutter geometry; not part of the carcass code

    Object.entries(ZONES).forEach(([zk, z]) => {
      const isBase = !z.kind && !z.tall; // base zones (BC/BCL/BB/BBL) offer XCJ + STD handles
      const fams = famSetOf(zk);
      Object.entries(fams).forEach(([fk, f]: [string, any]) => {
        const sizeSpec = SIZES[`${zk}.${fk}`] || defSizes(zk);
        const handles = isBase ? ["XCJ", "STD"] : ["STD"];
        // Does this family offer a "Double" configuration (Double door / Double bowl / ...)?
        const hasDoubleVariant = (f.variants || []).some((vt: any) => /double/i.test(vt.label || ""));
        (f.variants || []).forEach((v: any) => {
          // Blind units never offer a double-door configuration.
          if (z.blind && (v.both || /double/i.test(v.label || ""))) return;
          const sp = shutSpec(zk, fk, v) as any;
          const isHingedDoublable = sp.kind === "hinged" && !sp.blindW;
          // A handed single-door/bowl variant auto-converts to the family's Double variant above
          // 600mm, so we only enumerate it up to 600; the Double variant covers the wider sizes.
          const isHandedSingle = !!v.handed && !v.both && !v.double;
          // A "Double" configuration (Double door / Double bowl / ...) only exists above 600mm.
          const isDoubleVariant = /double/i.test(v.label || "");
          const hands: string[] = v.handed ? ["LHS", "RHS"] : [""];
          // BC + DW + 3-drawer also has a built-in "2HB + 1BL" variant that yields a
          // DISTINCT carcass code (…-2HB-1BL-… instead of …-2LB-1HB-…). Enumerate both.
          const inbuiltOpts: string[] = (zk === "BC" && fk === "DW" && v.id === "3dr") ? ["none", "2hb1bl"] : ["none"];
          handles.forEach((handle) => {
            sizeSpec.w.forEach((W: number) => {
              if (isHandedSingle && hasDoubleVariant && isHingedDoublable && W > 600) return;
              if (isDoubleVariant && isHingedDoublable && W <= 600) return;
              // Base drawer (DW/HO) 3-drawer configuration does not offer the 450 width.
              if ((fk === "DW" || fk === "HO") && v.id === "3dr" && W === 450) return;
              sizeSpec.h.forEach((H: number) => {
                const D = sizeSpec.d;
                hands.forEach((hand) => {
                  inbuiltOpts.forEach((inbuilt) => {
                    let m;
                    try {
                      m = buildModel(zk, fk, v, handle, placeholderDesign, "", "", "", "", W, H, D, t, hand || "LHS", "Lian", inbuilt);
                    } catch {
                      return; // skip any combination the engine rejects
                    }
                    const parts = m.code.split("-");
                    // Which shutter design profiles can this cabinet use? (Empty for
                    // families with no shutters, e.g. open units.)
                    const profCodes = new Set<string>(validDesigns(zk, fk, v, W, handle));
                    profCodes.forEach((c) => allProfCodes.add(c));
                    rowProfSets.push(profCodes);

                    // Net sqft breakdowns (single cabinet, no waste):
                    const r3 = (x: number) => Math.round(x * 1000) / 1000;
                    let shutterSqft = 0;
                    (m.shutters || []).forEach((s) => { shutterSqft += sqft(s.pw, s.ph); });
                    let fasciaSqft = 0, drawerBackSqft = 0, drawerBottomSqft = 0, shelfQty = 0, shelfSqft = 0;
                    (m.panels || []).forEach((p) => {
                      const a = sqft(p.w, p.h) * p.qty;
                      if (/Drawer Box Fascia/i.test(p.name)) fasciaSqft += a;
                      else if (/Drawer Box Back/i.test(p.name)) drawerBackSqft += a;
                      else if (/Drawer Box Bottom/i.test(p.name)) drawerBottomSqft += a;
                      else if (/shelf/i.test(p.name)) { shelfSqft += a; shelfQty += p.qty; }
                    });
                    // Glass shelves live in pkRows (Sub Group "glass shelf"); parse W×D from the name.
                    (m.pkRows || []).forEach((rw) => {
                      if (rw[2] === "glass shelf") {
                        const gq = typeof rw[3] === "number" ? rw[3] : 0;
                        const mm = String(rw[1]).match(/(\d+)\s*[xX×]\s*(\d+)/);
                        if (mm) shelfSqft += sqft(parseInt(mm[1], 10), parseInt(mm[2], 10)) * gq;
                        shelfQty += gq;
                      }
                    });

                    rows.push({
                      "Cabinet Code": m.code,
                      "Zone Key": zk,
                      "Zone Name": z.name,
                      "Family Key": fk,
                      "Family Name": f.name,
                      "Variant Id": v.id,
                      "Variant Label": v.label,
                      "Inbuilt Drawers": inbuilt === "2hb1bl" ? "2HB + 1BL" : "—",
                      "Handed": v.handed ? hand : "—",
                      "P1": parts[0] || "",
                      "P2": parts[1] || "",
                      "P3": parts[2] || "",
                      "P4": parts[3] || "",
                      "Handle": handle,
                      "Width": W,
                      "Height": H,
                      "Depth": D,
                      "Thickness": t,
                      "Construction": z.construct,
                      "Mount": z.mount,
                      "Tall?": z.tall ? "Yes" : "No",
                      "Blind?": z.blind ? "Yes" : "No",
                      "Low-depth?": z.low ? "Yes" : "No",
                      "Finish": "ANY",
                      "Carcass Net Sqft": Math.round((m.netSqft || 0) * 1000) / 1000,
                      "# Panels": m.panels?.length || 0,
                      "# Shutters": m.shutters?.length || 0,
                      "Shelf Qty": shelfQty,
                      "Shelf Sqft": r3(shelfSqft),
                      "Drawers Bottom Sqft": r3(drawerBottomSqft),
                      "Drawer Back Sqft": r3(drawerBackSqft),
                      "Fascia Sqft": r3(fasciaSqft),
                      "Shutter Sqft": r3(shutterSqft),
                      "Side Spec": v.side || "",
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    // One Yes/No column per shutter design profile, in canonical SH_DESIGNS order
    // (any unexpected codes appended at the end), marking whether the cabinet can use it.
    const profCols = [
      ...SH_DESIGNS.filter((d) => allProfCodes.has(d)),
      ...Array.from(allProfCodes).filter((d) => !SH_DESIGNS.includes(d)).sort(),
    ];
    rows.forEach((row, i) => {
      const set = rowProfSets[i];
      profCols.forEach((code) => {
        row[`Design ${code}`] = set.has(code) ? "Yes" : "No";
      });
    });

    const header = [
      "Cabinet Code", "Zone Key", "Zone Name", "Family Key", "Family Name", "Variant Id", "Variant Label",
      "Inbuilt Drawers",
      "Handed", "P1", "P2", "P3", "P4", "Handle", "Width", "Height", "Depth", "Thickness",
      "Construction", "Mount", "Tall?", "Blind?", "Low-depth?", "Finish",
      "Carcass Net Sqft", "# Panels", "# Shutters",
      "Shelf Qty", "Shelf Sqft", "Drawers Bottom Sqft", "Drawer Back Sqft", "Fascia Sqft", "Shutter Sqft",
      "Side Spec",
      ...profCols.map((code) => `Design ${code}`),
    ];
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    // Bold + shaded header row
    header.forEach((_, c) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) {
        ws[addr].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "44403A" } },
          alignment: { horizontal: "center" },
        };
      }
    });
    ws["!cols"] = header.map((h) => ({ wch: Math.max(10, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "All Combinations");
    XLSX.writeFile(wb, `carcass-all-combinations-${rows.length}.xlsx`);
  };

  // Enumerate EVERY shutter code across all carcass combinations. The shutter code
  // embeds the shutter design (MD1/MD2/.../NEON20), so we additionally fan out over
  // every valid design per combination. Rows are de-duplicated by shutter code so the
  // output is the unique universe of possible shutter codes (15mm carcass, finish = ANY).
  const exportAllShutterCodes = () => {
    type Row = Record<string, string | number>;
    const rows: Row[] = [];
    const seen = new Set<string>();
    const t = 15;

    Object.entries(ZONES).forEach(([zk, z]) => {
      const isBase = !z.kind && !z.tall;
      const fams = famSetOf(zk);
      Object.entries(fams).forEach(([fk, f]: [string, any]) => {
        const sizeSpec = SIZES[`${zk}.${fk}`] || defSizes(zk);
        const handles = isBase ? ["XCJ", "STD"] : ["STD"];
        const hasDoubleVariant = (f.variants || []).some((vt: any) => /double/i.test(vt.label || ""));
        (f.variants || []).forEach((v: any) => {
          // Blind units never offer a double-door configuration.
          if (z.blind && (v.both || /double/i.test(v.label || ""))) return;
          const sp = shutSpec(zk, fk, v) as any;
          const isHingedDoublable = sp.kind === "hinged" && !sp.blindW;
          const isHandedSingle = !!v.handed && !v.both && !v.double;
          const isDoubleVariant = /double/i.test(v.label || "");
          const hands: string[] = v.handed ? ["LHS", "RHS"] : [""];
          const inbuiltOpts: string[] = (zk === "BC" && fk === "DW" && v.id === "3dr") ? ["none", "2hb1bl"] : ["none"];
          handles.forEach((handle) => {
            sizeSpec.w.forEach((W: number) => {
              if (isHandedSingle && hasDoubleVariant && isHingedDoublable && W > 600) return;
              if (isDoubleVariant && isHingedDoublable && W <= 600) return;
              // Base drawer (DW/HO) 3-drawer configuration does not offer the 450 width.
              if ((fk === "DW" || fk === "HO") && v.id === "3dr" && W === 450) return;
              const designs = validDesigns(zk, fk, v, W, handle);
              if (designs.length === 0) return; // no shutters for this family/variant
              sizeSpec.h.forEach((H: number) => {
                const D = sizeSpec.d;
                hands.forEach((hand) => {
                  inbuiltOpts.forEach((inbuilt) => {
                    designs.forEach((design) => {
                      let m;
                      try {
                        m = buildModel(zk, fk, v, handle, design, "", "", "", "", W, H, D, t, hand || "LHS", "Lian", inbuilt);
                      } catch {
                        return;
                      }
                      (m.shutters || []).forEach((s) => {
                        if (seen.has(s.code)) return;
                        seen.add(s.code);
                        const isGlassFace = isGlassShutterFam(fk) && s.kind !== "fixed";
                        rows.push({
                          "Shutter Code": s.code,
                          "Cabinet Code": m.code,
                          "Zone Key": zk,
                          "Zone Name": z.name,
                          "Family Key": fk,
                          "Family Name": f.name,
                          "Variant Id": v.id,
                          "Variant Label": v.label,
                          "Inbuilt Drawers": inbuilt === "2hb1bl" ? "2HB + 1BL" : "—",
                          "Design": s.design,
                          "Handle": handle,
                          "Handed": v.handed ? hand : "—",
                          "Kind": s.kind,
                          "Loc": s.loc || "",
                          "Shutter W": s.w,
                          "Shutter H": s.h,
                          "Panel W": s.pw,
                          "Panel H": s.ph,
                          "Face Thk": isGlassFace ? 5 : shThkOf(s.design, false),
                          "Face": isGlassFace ? "Glass" : (s.kind === "fixed" ? "Fixed Stone Panel" : "Stone"),
                          "Profile V (mm)": s.profV,
                          "Profile H (mm)": s.profH,
                          "Hinge": s.hinge || "",
                          "Hinge Qty": s.hq || 0,
                          "Cabinet W": W,
                          "Cabinet H": H,
                          "Cabinet D": D,
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    const header = [
      "Shutter Code", "Cabinet Code", "Zone Key", "Zone Name", "Family Key", "Family Name",
      "Variant Id", "Variant Label", "Inbuilt Drawers", "Design", "Handle", "Handed",
      "Kind", "Loc", "Shutter W", "Shutter H", "Panel W", "Panel H", "Face Thk", "Face",
      "Profile V (mm)", "Profile H (mm)", "Hinge", "Hinge Qty",
      "Cabinet W", "Cabinet H", "Cabinet D",
    ];
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    header.forEach((_, c) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) {
        ws[addr].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "44403A" } },
          alignment: { horizontal: "center" },
        };
      }
    });
    ws["!cols"] = header.map((h) => ({ wch: Math.max(10, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "All Shutter Codes");
    XLSX.writeFile(wb, `shutter-all-codes-${rows.length}.xlsx`);
  };

  const handleExcelDownload = () => {
    const accExport = buildAccessoryExportRows();
    exportBuilderExcel(
      project,
      accExport,
      selectedSo?.salesorder_number,
      stockMap,
      selectedRawIds,
      rawOptionsMap,
      fillers,
      visiblePanels,
      backsplashes,
      countertops,
      getDefaultShutterShadeForZone,
      getDefaultShutterHeightForZone,
      getDefaultCabinetDepthForZone,
      getShutterProfileForZone,
      getProfileColorForZone
    );
  };

  // ---- Accessory Helpers ----
  const addAccessoryRow = () => {
    const nextId = accessoryCounter + 1;
    setAccessoryCounter(nextId);
    setAccessoryRows((cur) => [...cur, { id: nextId, cabinetIndices: [], accessories: createAccessoryEntries() }]);
  };

  const updateAccessoryRow = (rowId: number, updater: (r: AccessorySubformRow) => AccessorySubformRow) => {
    setAccessoryRows((cur) => cur.map((r) => (r.id === rowId ? updater(r) : r)));
  };

  const removeAccessoryRow = (rowId: number) => {
    setAccessoryRows((cur) => cur.filter((r) => r.id !== rowId));
  };

  const getApplicableAccessories = (row: AccessorySubformRow): AccessoryItem[] => {
    const cabinets = row.cabinetIndices.map((i) => project[i]).filter(Boolean);
    if (!cabinets.length) return ACCESSORY_ITEMS;

    return ACCESSORY_ITEMS.filter((a) => {
      if (a.key === "skirting") {
        return cabinets.some((cab) => {
          const zk = cab.m.zk || "";
          return zk.startsWith("B") || zk.startsWith("T");
        });
      }
      if (a.key === "duplay" || a.key === "lprofile") {
        return cabinets.some((cab) => {
          const zk = cab.m.zk || "";
          return zk.startsWith("W");
        });
      }
      if (a.key === "grandlight") {
        return cabinets.some((cab) => {
          const zk = cab.m.zk || "";
          return zk.startsWith("B");
        });
      }
      if (a.key === "jhandle" || a.key === "chandle") {
        return cabinets.some((cab) => {
          const zk = cab.m.zk || "";
          return zk.startsWith("B") && cab.m.isCJ;
        });
      }
      return true;
    });
  };

  const getRowWidthMm = (indices: number[], accKey?: AccessoryKey): number => {
    return indices.reduce((sum, i) => {
      const line = project[i];
      if (!line) return sum;

      // 1. Dupley Profile Light (duplay) excluded from Wall Dishrack (WDR or contains -DSH-)
      if (accKey === "duplay" && (line.m.fk === "WDR" || line.m.code.includes("-DSH-"))) {
        return sum;
      }

      // 2. C-handle (chandle) excluded from hinged door base units (SH, SK, LMC, BSH, PLB)
      if (accKey === "chandle" && line.m.fk && ["SH", "SK", "LMC", "BSH", "PLB"].includes(line.m.fk)) {
        return sum;
      }

      // 3. J-handle (jhandle) and C-handle (chandle) only apply to base CJ styling
      if (accKey === "jhandle" || accKey === "chandle") {
        const zk = line.m.zk || "";
        const isBase = zk.startsWith("B");
        if (!isBase || !line.m.isCJ) {
          return sum;
        }
      }

      return sum + (line.m.W || 0);
    }, 0);
  };

  const getRowTotalMeters = (indices: number[], accKey?: AccessoryKey): number => {
    return parseFloat((getRowWidthMm(indices, accKey) / 1000).toFixed(3));
  };

  const buildAccessoryExportRows = (): Array<{ SO: string; "Carcass Items": string; Accessory: string; Selected: string; "Item Name": string; Size: string; Elevation: string; Total: number | string; "Actual Qty": number | string; "Zoho Item ID": string }> => {
    const soNum = selectedSo?.salesorder_number || "";
    const out: Array<{ SO: string; "Carcass Items": string; Accessory: string; Selected: string; "Item Name": string; Size: string; Elevation: string; Total: number | string; "Actual Qty": number | string; "Zoho Item ID": string }> = [];
    accessoryRows.forEach((row) => {
      if (!row.cabinetIndices.length) return;
      const cabNames = row.cabinetIndices.map((i) => project[i]?.m.code || `#${i + 1}`).join(", ");
      ACCESSORY_ITEMS.forEach((acc) => {
        const entry = row.accessories[acc.key];
        if (!entry.enabled) return;
        const totalM = getRowTotalMeters(row.cabinetIndices, acc.key);
        const totalMm = getRowWidthMm(row.cabinetIndices, acc.key);
        const qty = entry.actualQty ?? totalM;

        // Light profile BOM expansion
        const bom = LIGHT_PROFILE_BOMS[acc.key];
        if (bom) {
          const lenMm = typeof qty === "number" ? qty * 1000 : totalMm;
          const lenWithWaste = Math.ceil(lenMm * (1 + bom.waste));
          // Profile
          out.push({ SO: soNum, "Carcass Items": cabNames, Accessory: acc.label, Selected: "Yes", "Item Name": bom.profile, Size: entry.size, Elevation: entry.elevation, Total: totalM, "Actual Qty": lenWithWaste, "Zoho Item ID": acc.itemId });
          // LED
          out.push({ SO: soNum, "Carcass Items": cabNames, Accessory: acc.label, Selected: "", "Item Name": bom.led, Size: "", Elevation: "", Total: "", "Actual Qty": lenWithWaste * bom.ledMultiplier, "Zoho Item ID": "" });
          // Diffuser
          out.push({ SO: soNum, "Carcass Items": cabNames, Accessory: acc.label, Selected: "", "Item Name": bom.diffuser, Size: "", Elevation: "", Total: "", "Actual Qty": lenWithWaste * bom.diffuserMultiplier, "Zoho Item ID": "" });
          // Wire
          out.push({ SO: soNum, "Carcass Items": cabNames, Accessory: acc.label, Selected: "", "Item Name": bom.wire, Size: "", Elevation: "", Total: "", "Actual Qty": bom.wireQty, "Zoho Item ID": "" });
          // Tape (if applicable)
          if (bom.tape) {
            out.push({ SO: soNum, "Carcass Items": cabNames, Accessory: acc.label, Selected: "", "Item Name": bom.tape, Size: "", Elevation: "", Total: "", "Actual Qty": lenWithWaste * bom.tapeMultiplier, "Zoho Item ID": "" });
          }
          // Driver (manually selected)
          if (entry.driver) {
            out.push({ SO: soNum, "Carcass Items": cabNames, Accessory: acc.label, Selected: "", "Item Name": entry.driver, Size: "", Elevation: "", Total: "", "Actual Qty": 1, "Zoho Item ID": "" });
          }
          // Skirting connectors
          if (acc.key === "skirting") {
            if (entry.straightConnectors > 0) {
              out.push({ SO: soNum, "Carcass Items": cabNames, Accessory: acc.label, Selected: "", "Item Name": "SKIRTING STRAIGHT CONNECTOR", Size: "", Elevation: "", Total: "", "Actual Qty": entry.straightConnectors, "Zoho Item ID": "" });
            }
            if (entry.lConnectors > 0) {
              out.push({ SO: soNum, "Carcass Items": cabNames, Accessory: acc.label, Selected: "", "Item Name": "SKIRTING L CONNECTOR", Size: "", Elevation: "", Total: "", "Actual Qty": entry.lConnectors, "Zoho Item ID": "" });
            }
          }
        } else {
          // Non-light profile accessories (J handle, C handle)
          out.push({ SO: soNum, "Carcass Items": cabNames, Accessory: acc.label, Selected: "Yes", "Item Name": acc.label, Size: entry.size, Elevation: entry.elevation, Total: totalM, "Actual Qty": qty, "Zoho Item ID": acc.itemId });
        }
      });
    });
    // Other Accessories (Chimney / Dishwasher panels)
    otherAccRows.forEach((row) => {
      const label = OTHER_ACC_ITEMS.find((it) => it.key === row.item)?.label || row.item;
      const itemName = `${label} - ${row.color} (${row.profile} ${row.profileColor})`;
      out.push({
        SO: soNum,
        "Carcass Items": "",
        Accessory: "Other Accessory",
        Selected: "Yes",
        "Item Name": itemName,
        Size: `${row.width}x${row.height}`,
        Elevation: "",
        Total: "",
        "Actual Qty": row.qty,
        "Zoho Item ID": "",
      });
    });
    return out;
  };

  // ---- Stock Check ----
  const runStockCheck = useCallback(async () => {
    if (project.length === 0) return;
    setStockCheckLoading(true);
    const itemNames = new Set<string>();
    project.forEach((l) => {
      l.m.hardware.forEach((h) => {
        const def = HARDWARE_PACK_DEFINITIONS[h.name];
        if (def) {
          def.forEach((comp) => itemNames.add(comp.component));
        } else {
          itemNames.add(h.name);
        }
      });
      l.m.cons.forEach((c) => itemNames.add(c.name));
      if (l.m.shutters && isGlassShutterFam(l.m.fk)) {
        const glassColor = l.m.shutterMat || "CLEAR";
        l.m.shutters.forEach((s) => {
          // Fixed (dummy) blind panels are stone, not glass — skip them here.
          if (s.kind !== "fixed") itemNames.add(`GLASS TOUGH EP ${s.pw}X${s.ph}X5 ${glassColor} SKV`);
        });
      }
    });

    const newMap: Record<string, StockItem> = {};
    for (const name of itemNames) {
      newMap[name] = { name, category: "hardware", stock: null, loading: true };
    }
    setStockMap({ ...newMap });

    for (const name of itemNames) {
      try {
        const res = await fetch(`/api/zoho/items?search=${encodeURIComponent(name)}`);
        if (res.ok) {
          const data = await res.json();
          const items = data.items || [];
          const match = items.find((it: any) => it.name === name || it.sku === name);
          if (match) {
            newMap[name] = { ...newMap[name], stock: match.stock_on_hand ?? 0, loading: false };
          } else {
            const fbRes = await fetch(`/api/zoho/items?name=${encodeURIComponent(name)}`);
            if (fbRes.ok) {
              const fbData = await fbRes.json();
              const fbMatch = (fbData.items || []).find((it: any) => it.name === name);
              newMap[name] = { ...newMap[name], stock: fbMatch ? (fbMatch.stock_on_hand ?? 0) : null, loading: false };
            } else {
              newMap[name] = { ...newMap[name], stock: null, loading: false };
            }
          }
        } else {
          newMap[name] = { ...newMap[name], stock: null, loading: false };
        }
      } catch {
        newMap[name] = { ...newMap[name], stock: null, loading: false };
      }
      setStockMap({ ...newMap });
    }
    setStockCheckLoading(false);
  }, [project]);

  // ---- Packing List & Labels ----
  const handlePackingDownload = () => {
    const soNum = selectedSo?.salesorder_number || "DRAFT";
    const custName = selectedSo?.customer_name || "—";
    const soDate = selectedSo?.date || new Date().toISOString().slice(0, 10);
    const html = buildBuilderPackingHtml(project, soNum, custName, soDate, packingFilter);
    const suffix = packingFilter === "both" ? "" : `-${packingFilter}`;
    const filename = `${sanitizeFilename(soNum)}-packing-list${suffix}.xls`;
    downloadBlob(filename, new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }));
  };

  const handleLabelsDownload = async () => {
    const soNum = selectedSo?.salesorder_number || "DRAFT";
    const custName = selectedSo?.customer_name || "—";
    const blob = await buildBuilderLabelsPdf(project, soNum, custName, packingFilter);
    const suffix = packingFilter === "both" ? "" : `-${packingFilter}`;
    downloadBlob(`${sanitizeFilename(soNum)}-labels${suffix}.pdf`, blob);
  };

  // Stepper calculations for model
  const purSqft = model.netSqft * (1 + STONE_WASTE);
  const wt = model.netSqft * KG_SQFT;
  let netProf = 0;
  let purProf = 0;
  model.profiles.forEach((p) => {
    const pLen = (p.len * p.qty) / 1000;
    netProf += pLen;
    const waste = p.type?.toUpperCase() === "ELEN" ? ELENOR_WASTE : PROFILE_WASTE;
    purProf += pLen * (1 + waste);
  });
  const glueLine = model.cons.find((c) => c.uom === "ML");
  const silLine = model.cons.find((c) => c.uom === "Kg");
  const extraConsThisUnit = model.cons.filter((c) => c.uom !== "ML" && c.uom !== "Kg");

  // Shutters stats this unit
  let unitShSqft = 0;
  let unitShProf = 0;
  let unitShProfP = 0;
  model.shutters?.forEach((s) => {
    unitShSqft += sqft(s.pw, s.ph);
    const profLen = (2 * s.profV + 2 * s.profH) / 1000;
    unitShProf += profLen;
    const shDesign = s.design || design || "";
    const waste = shDesign.toUpperCase() === "ELEN" ? ELENOR_WASTE : PROFILE_WASTE;
    unitShProfP += profLen * (1 + waste);
  });
  const unitShStoneP = unitShSqft * (1 + STONE_WASTE);
  const unitShWt = unitShSqft * SH_KGSQFT;

  // Layout Grouping for Tree details
  const treeGroups = useMemo(() => {
    const codeZone = model.code.split("-")[0];
    const zoneName = ZONES[codeZone]?.name || "Base";
    
    const finish = model.carcassMat || model.mat || carcassMat;

    const nonDrawerPanels = model.panels.filter(p => !p.pack.startsWith("Drawer Pack- Cab Drawer Box") && !p.pack.startsWith("Drawer Pack- Cab Pullout Shelf") && !p.pack.startsWith("Set of Parts- Cab Drawer Box") && !p.pack.startsWith("Set of Parts- Cab Pullout Shelf"));
    const nonDrawerProfiles = model.profiles.filter(p => !p.pack.startsWith("Drawer Pack- Cab Drawer Box") && !p.pack.startsWith("Drawer Pack- Cab Pullout Shelf"));

    const mapItems = (panelsList: Panel[]) => {
      return panelsList.flatMap((p) => explodePanelForTree(p, finish));
    };

    const grps = [
      { 
        t: `Set of Parts- Cab ${model.sn} ${zoneName} LH(${model.lh})+RH(${model.rh})`, 
        items: mapItems(nonDrawerPanels.filter((p) => p.name.includes("LH/RH"))) 
      },
      {
        t: currentFam?.top === "frame" ? "Part Cab Common BT LEG" : "Top + Bottom",
        items: mapItems(nonDrawerPanels.filter((p) => /(\bTop\b|\bBottom\b|\bTP\b|\bBT\b|TP\/BT|Top\/Bottom)/i.test(p.name))),
      },
      {
        t: currentFam?.backStrips ? "Back Wall strips" : "Back Wall (Prof)",
        items: mapItems(nonDrawerPanels.filter((p) => p.name.includes("Back"))),
        profs: nonDrawerProfiles.filter((p) => p.type === "STP"),
        sil: silLine,
      },
    ];
    if (currentFam?.top === "frame") {
      grps.push({ t: "Sink Profile Frame (SINK)", items: [], profs: nonDrawerProfiles.filter((p) => p.type === "SINK"), sil: undefined });
    }
    if (nonDrawerPanels.some((p) => p.name.includes("Shelf"))) {
      grps.push({ t: "Shelf", items: mapItems(nonDrawerPanels.filter((p) => p.name.includes("Shelf"))), profs: [], sil: undefined });
    }

    // Add Drawer Packs and Set of Parts as distinct groups
    model.pkRows.forEach(([, n]) => {
      if (n.startsWith("Drawer Pack-") || n.startsWith("Set of Parts-")) {
        grps.push({
          t: n,
          items: mapItems(model.panels.filter(p => p.pack.startsWith(n))),
          profs: model.profiles.filter(p => p.pack.startsWith(n)),
          sil: undefined
        });
      }
    });

    return grps.filter((g) => g.items.length > 0 || (g.profs && g.profs.length > 0));
  }, [model, currentFam, silLine, carcassMat]);

  return (
    <div className="builder-container">
      <header className="builder-header">
        <div>
          <div className="sub">
            {planningMode
              ? "Planning · Upload cabinet codes / Sales Order → choose shutter colour → BoM"
              : soMode
              ? "Designer · Sales Order → cabinet codes fetched → Raw BoM → Project Totals"
              : "Kitchen Carcass · Code → Packets → Raw BoM → Project Totals"}
          </div>
          <h1>{planningMode ? "Planning → BoM" : soMode ? "Sales Order → BoM (Designer)" : "Carcass Code & BoM Builder"}</h1>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <a href="/" className="nav-header-link">BOM Dashboard</a>
          <a href="/reorder" className="nav-header-link">Re-order Report</a>
          <a href="/builder" className="nav-header-link">Builder</a>
          <a href="/designer" className="nav-header-link">Designer</a>
          <a href="/planning" className="nav-header-link">Planning</a>
          <button
            className="addbtn"
            onClick={exportAllCombinations}
            style={{ fontSize: 11 }}
            title="Download an Excel of every possible carcass combination (15mm, finish = ANY)"
          >
            Export All Combinations (.xlsx)
          </button>
          <button
            className="addbtn"
            onClick={exportAllShutterCodes}
            style={{ fontSize: 11 }}
            title="Download an Excel of every possible shutter code across all combinations and designs"
          >
            Export All Shutter Codes (.xlsx)
          </button>
          <span className="tag">STONE · v21</span>
        </div>
      </header>

      <div className="grid" style={soMode ? { gridTemplateColumns: "1fr" } : undefined}>
        {/* Configure Card — hidden in Sales-Order (designer) mode, which fetches codes from the SO */}
        <div style={soMode ? { display: "none" } : undefined}>
          <div className="card">
            <h2>① Configure Unit</h2>
            <label>Zone <span className="hint">P1</span></label>
            <SearchableSelect
              value={zone}
              onChange={setZone}
              options={zoneOptions}
              placeholder="Search zone..."
            />

            <label>Cabinet Family <span className="hint">P2</span></label>
            <SearchableSelect
              value={activeFamilyKey}
              onChange={setFamily}
              options={familyOptions}
              placeholder="Search cabinet family..."
            />

            <label>Configuration <span className="hint">P3·P4</span></label>
            <SearchableSelect
              value={currentVariant?.id || ""}
              onChange={handleVariantChange}
              options={variantOptions}
              placeholder="Search configuration..."
            />

            {hasDrawers && (
              <>
                <label>Drawer Model</label>
                <SearchableSelect
                  value={drawerModel}
                  onChange={setDrawerModel}
                  options={drawerModelOptions}
                  placeholder="Search drawer model..."
                />
              </>
            )}

            {ZONES[zone]?.kind === "loft" && (
              <>
                <label>Tip-On <span className="hint">push-to-open</span></label>
                <SearchableSelect
                  value={tipOn}
                  onChange={setTipOn}
                  options={TIPON_OPTIONS.map((o) => ({ value: o, label: o }))}
                  placeholder="Search tip-on..."
                />
              </>
            )}

            {hasInbuiltDrawerOption && (
              <>
                <label>Inbuilt Drawers</label>
                <SearchableSelect
                  value={inbuiltDrawers}
                  onChange={setInbuiltDrawers}
                  options={[
                    { value: "none", label: "None" },
                    { value: "2hb1bl", label: "2HB + 1BL" }
                  ]}
                  placeholder="Select inbuilt drawers..."
                />
              </>
            )}

            {currentVariant?.handed && !(activeFamilyKey === "BPO" && finalW > 150) && (
              <div id="handedWrap">
                <label>Hand <span className="hint">active side</span></label>
                <SearchableSelect
                  value={handed}
                  onChange={setHanded}
                  options={handOptions}
                  placeholder="Search hand..."
                />
              </div>
            )}

            <label>Handle / Profile <span className="hint">{handleLockedByDesign ? `set by ${design}` : "P5"}</span></label>
            <SearchableSelect
              value={handle}
              onChange={setHandle}
              options={handleOptions}
              placeholder="Search handle..."
              disabled={handleLockedByDesign}
            />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ margin: 0 }}>Shutter Profile Design</label>
              {isGlassShutterSelected && (
                <button
                  type="button"
                  onClick={() => setDesignUnlocked((u) => !u)}
                  style={{
                    fontSize: "11px",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    border: "1px solid #b8860b",
                    background: designLocked ? "#fff7e0" : "#e7f5e7",
                    color: designLocked ? "#8a6d00" : "#256029",
                    cursor: "pointer",
                  }}
                  title={designLocked ? "Locked to NEON20 — click to unlock and change" : "Unlocked — click to re-lock to NEON20"}
                >
                  {designLocked ? "🔒 unlock" : "🔓 lock"}
                </button>
              )}
            </div>
            <SearchableSelect
              value={design}
              onChange={setDesign}
              options={designOptions}
              disabled={designsList.length === 0 || designLocked}
              placeholder="Search design..."
            />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "13px", marginBottom: "5px" }}>
              <label style={{ margin: 0 }}>Carcass Finish</label>
              <button 
                type="button" 
                onClick={() => {
                  setFinishModalTarget("carcass");
                  setNewFinishThickness(String(thickness));
                  setNewFinishName("");
                  setFinishError("");
                  setFinishSuccess(false);
                  setIsFinishModalOpen(true);
                }} 
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: "16px",
                  fontWeight: "bold",
                  padding: "0 4px"
                }}
                title="Add New Finish"
              >
                +
              </button>
            </div>
            <SearchableSelect
              value={carcassMat}
              onChange={setCarcassMat}
              options={carcassOptions}
              placeholder="Search carcass finish..."
            />

            <label style={{ display: "block", fontSize: "12px", fontWeight: "600", margin: "13px 0 5px" }}>Carcass Profile Finish</label>
            <SearchableSelect
              value={carcassProfileColor}
              onChange={setCarcassProfileColor}
              options={carcassProfileOptions}
              placeholder="Search carcass profile finish..."
            />

            {designsList.length > 0 && (
              <>
                {isGlassShutterSelected ? (
                  <>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: "600", margin: "13px 0 5px" }}>Glass Shutter Color</label>
                    <SearchableSelect
                      value={glassColor}
                      onChange={setGlassColor}
                      options={GLASS_COLORS}
                      placeholder="Search glass color..."
                    />
                    {isBlindGlassSelected && (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "13px", marginBottom: "5px" }}>
                          <label style={{ margin: 0 }}>Fixed Panel Finish (Stone)</label>
                          <button
                            type="button"
                            onClick={() => {
                              setFinishModalTarget("shutter");
                              setNewFinishThickness("6");
                              setNewFinishName("");
                              setFinishError("");
                              setFinishSuccess(false);
                              setIsFinishModalOpen(true);
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "var(--accent)",
                              cursor: "pointer",
                              fontSize: "16px",
                              fontWeight: "bold",
                              padding: "0 4px"
                            }}
                            title="Add New Finish"
                          >
                            +
                          </button>
                        </div>
                        <SearchableSelect
                          value={shutterMat}
                          onChange={setShutterMat}
                          options={shutterOptions}
                          placeholder="Search fixed panel finish..."
                        />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "13px", marginBottom: "5px" }}>
                      <label style={{ margin: 0 }}>Shutter Finish</label>
                      <button
                        type="button"
                        onClick={() => {
                          setFinishModalTarget("shutter");
                          setNewFinishThickness("6");
                          setNewFinishName("");
                          setFinishError("");
                          setFinishSuccess(false);
                          setIsFinishModalOpen(true);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--accent)",
                          cursor: "pointer",
                          fontSize: "16px",
                          fontWeight: "bold",
                          padding: "0 4px"
                        }}
                        title="Add New Finish"
                      >
                        +
                      </button>
                    </div>
                    <SearchableSelect
                      value={shutterMat}
                      onChange={setShutterMat}
                      options={shutterOptions}
                      placeholder="Search shutter finish..."
                    />
                  </>
                )}

                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", margin: "13px 0 5px" }}>Shutter Profile Finish</label>
                <SearchableSelect
                  value={shutterProfileColor}
                  onChange={setShutterProfileColor}
                  options={shutterProfileOptions}
                  placeholder="Search shutter profile finish..."
                />
              </>
            )}

            <label>Dimensions (mm) <span className="hint">W × H × D</span></label>
            <div className="dims">
              <div>
                <SearchableSelect
                  value={wSel}
                  onChange={handleWidthSelect}
                  options={wOptions}
                  placeholder="Search width..."
                />
                {wSel === "custom" && (
                  <input className="dimCustom" type="number" step="10" placeholder="custom W" value={customW} onChange={(e) => handleCustomWidth(parseInt(e.target.value) || 0)} />
                )}
              </div>

              <div>
                <SearchableSelect
                  value={hSel}
                  onChange={setHSel}
                  options={hOptions}
                  placeholder="Search height..."
                />
                {hSel === "custom" && (
                  <input className="dimCustom" type="number" step="10" placeholder="custom H" value={customH} onChange={(e) => setCustomH(parseInt(e.target.value) || 0)} />
                )}
              </div>

              <div>
                <SearchableSelect
                  value={dSel}
                  onChange={setDSel}
                  options={dOptions}
                  placeholder="Search depth..."
                />
                {dSel === "custom" && (
                  <input className="dimCustom" type="number" step="10" placeholder="custom D" value={customD} onChange={(e) => setCustomD(parseInt(e.target.value) || 0)} />
                )}
              </div>
            </div>

            <label>Thickness (mm) <button className={`lockbtn ${!tLocked ? "on" : ""}`} onClick={() => {
              if (tLocked) {
                setTLocked(false);
              } else {
                setTLocked(true);
                setThickness(15);
              }
            }}>{tLocked ? "🔒 locked" : "🔓 unlocked"}</button></label>
            <input type="number" value={thickness} min="5" max="40" step="1" disabled={tLocked} onChange={(e) => setThickness(parseInt(e.target.value) || 15)} />
          </div>

        </div>

        {/* Output Panel */}
        <div>
          <div className="codebox" style={soMode ? { display: "none" } : undefined}>
            <div className="lbl">Cabinet Code</div>
            <div className="code">
              {(() => {
                const matSuffix = model.carcassMat === model.shutterMat || !model.shutterMat ? model.carcassMat : `${model.carcassMat}-${model.shutterMat}`;
                const parts = model.code.replace("-" + matSuffix, "").split("-");
                const cls = ["s1", "s2", "s3", "s4", "s5", "sd", "sd", "sd", "sd"];
                return (
                  <>
                    {parts.map((p, i) => (
                      <span key={i} className={cls[i] || "sd"}>
                        {i > 0 && <span style={{ color: "#6a6256" }}>-</span>}
                        {p}
                      </span>
                    ))}
                    {model.carcassMat && model.carcassMat !== "(none)" && (
                      <>
                        <span style={{ color: "#6a6256" }}>-</span>
                        <span className="s3">
                          {model.carcassMat}
                          {model.shutters && model.shutters.length > 0 && model.shutterMat !== model.carcassMat ? `/${model.shutterMat}` : ""}
                        </span>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
            <button className="copy" onClick={copyCode}>
              {copiedCode ? "Copied" : "Copy"}
            </button>
          </div>

          {/* Add to Project Row */}
          <div className="addrow" style={soMode ? { display: "none" } : undefined}>
            <select
              value={elevation}
              title="Elevation (required)"
              onChange={(e) => setElevation(e.target.value)}
              style={{ padding: "6px 8px", border: elevation ? "1px solid var(--line)" : "1px solid #c0392b", borderRadius: "3px", fontSize: 13 }}
            >
              <option value="">Elevation *</option>
              {ELEVATION_OPTIONS.map((el) => (
                <option key={el} value={el}>{el}</option>
              ))}
            </select>
            <input
              type="number"
              value={lineQty}
              min="1"
              step="1"
              title="Qty"
              onChange={(e) => setLineQty(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <button className="addbtn" onClick={addLine} disabled={!elevation} title={!elevation ? "Select an Elevation first" : "Add to Project"}>
              + Add to Project
            </button>
          </div>

          <div className="meta" style={soMode ? { display: "none" } : undefined}>
            <span>Construction: <b>{ZONES[zone].construct === "fullsides" ? "Full Sides (wall-hung)" : "Full Top/Bottom"}</b></span>
            <span>Unit: <b>{currentFam?.name} · {currentVariant?.label} {currentVariant?.handed ? `(${handed})` : ""}</b></span>
          </div>

          <div className="tabs">
            <button className={`tab ${activeTab === "pk" ? "on" : ""}`} style={soMode ? { display: "none" } : undefined} onClick={() => setActiveTab("pk")}>Packets</button>
            <button className={`tab ${activeTab === "raw" ? "on" : ""}`} style={soMode ? { display: "none" } : undefined} onClick={() => setActiveTab("raw")}>Raw BoM (this unit)</button>
            <button className={`tab ${activeTab === "proj" ? "on" : ""}`} onClick={() => setActiveTab("proj")}>{soMode ? "Sales Order → BoM" : "Project & Totals"} <span className="badge">{project.reduce((a, l) => a + l.qty, 0)}</span></button>
          </div>

          {/* Tab 1: Packets */}
          {activeTab === "pk" && (
            <div className="card">
              <h2>② Carcass Packets</h2>
              <table>
                <thead>
                  <tr>
                    <th>Packet</th>
                    <th>Dimensions</th>
                    <th style={{ textAlign: "right" }}>Qty</th>
                    <th>UoM</th>
                  </tr>
                </thead>
                <tbody>
                  {model.pkRows.map((r, i) => {
                    const gl: Record<string, string> = { panel: "Panel", prof: "Profile", hard: "Hardware", cons: "Consumable", shut: "Shutter" };
                    const gc: Record<string, string> = { panel: "g-panel", prof: "g-prof", hard: "g-hard", cons: "g-cons", shut: "g-prof" };
                    return (
                      <tr key={i}>
                        <td>
                          <span className={`grp ${gc[r[0]] || "g-panel"}`}>{gl[r[0]] || r[0]}</span>
                          <div className="pk">{r[1]}</div>
                        </td>
                        <td className="dim">{r[2]}</td>
                        <td className="qty" style={{ textAlign: "right" }}>{r[3]}</td>
                        <td className="qty">{r[4]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 2: Raw BoM */}
          {activeTab === "raw" && (
            <div>
              <div className="card">
                <h2>③ Raw Roll-up — this unit</h2>
                <div className="rollup">
                  <div className="rc stone">
                    <div className="rt">Stone</div>
                    <div className="big">{purSqft.toFixed(2)}<span style={{ fontSize: 13 }}> sqft</span></div>
                    <div className="small">{model.nPanels} panels · net {model.netSqft.toFixed(2)} +15%<br />weight ≈ {wt.toFixed(1)} kg</div>
                  </div>
                  <div className="rc prof">
                    <div className="rt">Profiles</div>
                    <div className="big">{purProf.toFixed(2)}<span style={{ fontSize: 13 }}> m</span></div>
                    <div className="small">net {netProf.toFixed(2)} +20%{netProf === 0 && <><br />(none)</>}</div>
                  </div>
                  <div className="rc hard">
                    <div className="rt">Hardware</div>
                    <div className="big">{model.hardware.length}</div>
                    <div className="small">
                      {model.hardware.map((h, i) => (
                        <span key={i}>{h.name}<br /></span>
                      ))}
                    </div>
                  </div>
                  <div className="rc cons">
                    <div className="rt">Consumables</div>
                    <div className="big">{glueLine ? glueLine.qty : 0}<span style={{ fontSize: 13 }}> ml</span></div>
                    <div className="small">
                      assembly glue
                      {silLine && <><br />stepper silicone {silLine.qty} kg</>}
                      {extraConsThisUnit.map((c, i) => (
                        <span key={i}><br />{c.name.split(" (")[0]}: {c.qty} {c.uom}</span>
                      ))}
                    </div>
                  </div>
                  <div className="rc ops">
                    <div className="rt">Operations</div>
                    <div className="big">{model.ops.cut}+{model.ops.drill}</div>
                    <div className="small">{model.ops.cut} cutting · {model.ops.drill} drilling</div>
                  </div>
                  {model.shutters && model.shutters.length > 0 && (
                    <>
                      <div className="rc stone">
                        <div className="rt">Shutter Stone (6mm)</div>
                        <div className="big">{unitShStoneP.toFixed(2)}<span style={{ fontSize: 13 }}> sqft</span></div>
                        <div className="small">{model.shutters.length} shutter(s) · net {unitShSqft.toFixed(2)} +15%<br />weight ≈ {unitShWt.toFixed(1)} kg @1.38</div>
                      </div>
                      <div className="rc prof">
                        <div className="rt">Shutter Profiles</div>
                        <div className="big">{unitShProfP.toFixed(2)}<span style={{ fontSize: 13 }}> m</span></div>
                        <div className="small">design {design} · +20%<br />corner sets {model.shutters.length}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Raw Material Selection moved to Projects & Totals tab */}

              {/* Full Explosion Tree */}
              <div className="card">
                <h2>④ Full Explosion</h2>
                <div>
                  {treeGroups.map((g, i) => (
                    <details key={i} style={{ border: "1px solid var(--line)", borderRadius: "5px", marginBottom: "8px", background: "#fff" }}>
                      <summary style={{ cursor: "pointer", padding: "10px 12px", fontWeight: 500, fontSize: "13px", display: "flex", justifyContent: "space-between" }}>
                        <span>{g.t}</span>
                      </summary>
                      <div className="tree" style={{ padding: "0 12px 12px 28px" }}>
                        {g.items.map((item: any, idx) => (
                          <div key={item.id || idx}>
                            {/* Level 2: Part or Panel */}
                            <div className="tn">
                              <span className={item.type === "part" ? "pn" : "pr"} style={{ fontWeight: item.type === "part" ? 600 : 400 }}>
                                {item.name}
                              </span>
                              <span className="qty">×{item.qty}</span>
                            </div>
                            
                            {/* Level 3: Children (e.g. Panel under Part) or operations */}
                            {item.type === "part" ? (
                              <div className="lvl2" style={{ paddingLeft: "18px" }}>
                                {item.drill && (
                                  <div className="tn" style={{ borderBottom: "none", padding: "2px 0" }}>
                                    <span className="op">↳ Drilling-1 ({item.drill})</span>
                                  </div>
                                )}
                                {item.children?.map((child: any, ci: number) => (
                                  <div key={child.id || ci}>
                                    <div className="tn" style={{ borderBottom: "none", padding: "2px 0" }}>
                                      <span style={{ color: "var(--accent2)" }}>↳ {child.name}</span>
                                      <span className="qty">×{child.qty}</span>
                                    </div>
                                    <div className="tn lvl2" style={{ paddingLeft: "18px", borderBottom: "none", padding: "2px 0" }}>
                                      <span className="op">↳ Cutting-1</span>
                                      <span className="qty">{sqft(child.w, child.h).toFixed(2)} sqft ea</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="tn lvl2" style={{ paddingLeft: "18px", borderBottom: "none", padding: "2px 0" }}>
                                <span className="op">↳ Cutting-1</span>
                                <span className="qty">{sqft(item.w, item.h).toFixed(2)} sqft ea</span>
                              </div>
                            )}
                          </div>
                        ))}
                        {g.profs?.map((p, pi) => {
                          const formattedName = formatProfileNameForTree(p, carcassProfileColor);
                          return (
                            <div key={pi}>
                              <div className="tn">
                                <span className="pr">{formattedName}</span>
                                <span className="qty">×{p.qty}</span>
                              </div>
                              <div className="tn lvl2" style={{ paddingLeft: "18px", borderBottom: "none", padding: "2px 0" }}>
                                <span className="op">↳ Cutting-1</span>
                                <span className="qty">{p.len} mm ea</span>
                              </div>
                            </div>
                          );
                        })}
                        {g.sil && (
                          <div className="tn">
                            <span style={{ color: "var(--good)" }}>↳ {g.sil.name}</span>
                            <span className="qty">{g.sil.qty} kg</span>
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
                <div className="assume">
                  <b>Logic</b>
                  <ul>
                    <li>Stone area W×H÷92903 sqft +15%; weight net sqft×3.45 kg.</li>
                    <li>Thickness {tLocked ? "locked 15" : "UNLOCKED " + thickness} mm → 2×t reductions.</li>
                    <li>Profiles +20%. Stepper (STP)=2×W+2×H; stepper silicone separate.</li>
                    <li>BT-LEG=1 bottom panel. CJ top −23. No edge-banding.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Project & Totals */}
          {activeTab === "proj" && (
            <div>
              {/* ① Zoho Sales Order — hidden on the Designer page (it uses the Excel upload instead) */}
              {!canDesignerUpload && (
              <div className="card" style={{ position: "relative" }}>
                <h2>① Zoho Sales Order</h2>

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div style={{ flex: 2, minWidth: "200px" }}>
                    <label style={{ margin: "0 0 5px" }}>Search Sales Order</label>
                    <input
                      type="text"
                      placeholder="Type SO-00001 or Customer..."
                      value={soQuery}
                      onChange={(e) => {
                        setSoQuery(e.target.value);
                        setSelectedSo(null);
                      }}
                    />
                  </div>

                  <div style={{ flex: 1.5, minWidth: "180px" }}>
                    <button
                      className="addbtn"
                      onClick={handleAddToZohoSO}
                      disabled={!selectedSo || zohoLoading}
                      style={{
                        width: "100%",
                        opacity: (!selectedSo || zohoLoading) ? 0.6 : 1,
                        cursor: (!selectedSo || zohoLoading) ? "not-allowed" : "pointer"
                      }}
                    >
                      {zohoLoading ? "Processing..." : "Add to Zoho Sales Order"}
                    </button>
                  </div>
                </div>

                {soSearchError && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#c0392b", fontWeight: 600 }}>
                    ⚠ {soSearchError}
                  </div>
                )}

                {salesOrders.length > 0 && !selectedSo && (
                  <div className="so-dropdown" style={{
                    border: "1px solid var(--line)",
                    borderRadius: "4px",
                    background: "#fff",
                    maxHeight: "150px",
                    overflowY: "auto",
                    marginTop: "4px",
                    boxShadow: "var(--shadow)",
                    position: "absolute",
                    zIndex: 10,
                    width: "calc(100% - 36px)",
                    left: "18px"
                  }}>
                    {salesOrders.map((so: any) => (
                      <div
                        key={so.salesorder_id}
                        onClick={() => {
                          setSelectedSo(so);
                          setSoQuery(so.salesorder_number);
                        }}
                        style={{
                          padding: "8px 10px",
                          cursor: "pointer",
                          fontSize: "12px",
                          borderBottom: "1px solid var(--line)",
                          fontFamily: "var(--font-mono, monospace)",
                          color: "var(--ink)",
                          background: "#fff"
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--line)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                      >
                        <strong>{so.salesorder_number}</strong> — {so.customer_name}
                      </div>
                    ))}
                  </div>
                )}

                {selectedSo && (
                  <div style={{
                    marginTop: "12px",
                    padding: "10px",
                    background: "rgba(106, 98, 86, 0.05)",
                    borderRadius: "4px",
                    fontSize: "12px",
                    border: "1px solid var(--line)",
                    color: "var(--ink)"
                  }}>
                    Selected: <b>{selectedSo.salesorder_number}</b> · Customer: <b>{selectedSo.customer_name}</b> · Status: <span className="tag" style={{ background: "var(--ink)", padding: "1px 4px", fontSize: "10px" }}>{selectedSo.status}</span>
                  </div>
                )}

                {zohoMessage && (
                  <div style={{
                    marginTop: "12px",
                    padding: "8px 10px",
                    background: zohoMessage.startsWith("Error") ? "#fde8e8" : "rgba(106, 98, 86, 0.05)",
                    border: `1px solid ${zohoMessage.startsWith("Error") ? "#f8b4b4" : "var(--line)"}`,
                    borderRadius: "4px",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono, monospace)",
                    color: zohoMessage.startsWith("Error") ? "#9b1c1c" : "var(--ink)",
                    whiteSpace: "pre-wrap"
                  }}>
                    {zohoMessage}
                  </div>
                )}
              </div>
              )}

              {/* Upload Cabinet Codes (Designer page) */}
              {canDesignerUpload && (
                <div className="card">
                  <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>① Upload Cabinet Codes (.xls)</span>
                    <label className="addbtn" style={{ fontSize: 11, cursor: "pointer" }}>
                      Choose Excel…
                      <input
                        type="file"
                        accept=".xls,.xlsx"
                        style={{ display: "none" }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDesignerUpload(f); e.target.value = ""; }}
                      />
                    </label>
                  </h2>
                  <div style={{ fontSize: 11, color: "var(--ink)", opacity: 0.7 }}>
                    Upload the planning <b>Shutter</b> sheet. Cabinets load into Project Lines; pick the shutter
                    colour per line (filtered by its price group) or in bulk below.
                  </div>
                  {uploadMsg && (
                    <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: uploadMsg.toLowerCase().includes("could not") || uploadMsg.toLowerCase().includes("no valid") ? "#c0392b" : "var(--accent)" }}>
                      {uploadMsg}
                    </div>
                  )}
                  {project.some((l) => l.priceGroup) && (
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
                      <div>
                        <label style={{ margin: "0 0 4px", fontSize: 11 }}>Zone</label>
                        <select value={bulkZone} onChange={(e) => { setBulkZone(e.target.value); setBulkPG("all"); setBulkColour(""); }} style={{ padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 3, fontSize: 11 }}>
                          <option value="all">All</option>
                          <option value="base">Base</option>
                          <option value="wall">Wall</option>
                          <option value="tall">Tall</option>
                          <option value="loft">Loft</option>
                          <option value="md">Mid</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ margin: "0 0 4px", fontSize: 11 }}>Price Group</label>
                        <select value={bulkPG} onChange={(e) => { setBulkPG(e.target.value); setBulkColour(""); }} style={{ padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 3, fontSize: 11 }}>
                          <option value="all">All</option>
                          {pgsForZone(bulkZone).map((pg) => (<option key={pg} value={pg}>{pg}</option>))}
                        </select>
                      </div>
                      <div>
                        <label style={{ margin: "0 0 4px", fontSize: 11 }}>Colour</label>
                        <select value={bulkColour} onChange={(e) => setBulkColour(e.target.value)} style={{ padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 3, fontSize: 11, minWidth: 180 }}>
                          <option value="">Select colour…</option>
                          {(bulkPG !== "all" ? coloursForPriceGroup(bulkPG) : allPgColours).map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      <button className="addbtn" style={{ fontSize: 11 }} disabled={!bulkColour} onClick={applyBulkColour}>Apply to filtered</button>
                    </div>
                  )}
                </div>
              )}

              {/* ② Consolidated Totals — combined */}
              {project.length > 0 && (
                <>
                  <div className="card">
                    <h2>② Consolidated Totals — combined</h2>
                    <div className="rollup">
                      <div className="rc stone">
                        <div className="rt">Stone (all finishes)</div>
                        <div className="big">{(aggregates.netSqft * 1.15).toFixed(2)}<span style={{ fontSize: 13 }}> sqft</span></div>
                        <div className="small">{aggregates.nPanels} panels · net {aggregates.netSqft.toFixed(2)} +15%<br />weight ≈ {(aggregates.netSqft * KG_SQFT).toFixed(1)} kg</div>
                      </div>
                      <div className="rc prof">
                        <div className="rt">Profiles</div>
                        <div className="big">{(Object.values(aggregates.profAgg).reduce((a, b) => a + b, 0) * 1.2).toFixed(2)}<span style={{ fontSize: 13 }}> m</span></div>
                        <div className="small">
                          {Object.entries(aggregates.profAgg).map(([k, v]) => (
                            <span key={k}>{k}: {v.toFixed(2)}m<br /></span>
                          ))}
                          net {Object.values(aggregates.profAgg).reduce((a, b) => a + b, 0).toFixed(2)} +20%
                        </div>
                      </div>
                      <div className="rc hard">
                        <div className="rt">Hardware</div>
                        <div className="big">{Object.values(aggregates.hardAgg).reduce((a, b) => a + b, 0)}</div>
                        <div className="small">
                          {Object.entries(aggregates.hardAgg).map(([k, v]) => (
                            <span key={k}>{v} × {k}<br /></span>
                          ))}
                        </div>
                      </div>
                      <div className="rc cons">
                        <div className="rt">Consumables</div>
                        <div className="big">{aggregates.glue}<span style={{ fontSize: 13 }}> ml</span></div>
                        <div className="small">
                          assembly glue<br />
                          stepper silicone {aggregates.sil.toFixed(2)} kg
                          {aggregates.extraCons.map((c, i) => (
                            <span key={i}><br />{c.name}: {c.qty} {c.uom}</span>
                          ))}
                        </div>
                      </div>
                      <div className="rc ops">
                        <div className="rt">Operations</div>
                        <div className="big">{aggregates.cut}+{aggregates.drill}</div>
                        <div className="small">{aggregates.cut} cutting · {aggregates.drill} drilling</div>
                      </div>
                      {aggregates.shSqft > 0 && (
                        <>
                          <div className="rc stone">
                            <div className="rt">Shutter Stone (6mm)</div>
                            <div className="big">{(aggregates.shSqft * 1.15).toFixed(2)}<span style={{ fontSize: 13 }}> sqft</span></div>
                            <div className="small">net {aggregates.shSqft.toFixed(2)} +15%<br />weight ≈ {(aggregates.shSqft * SH_KGSQFT).toFixed(1)} kg · {aggregates.shCorner} corner sets</div>
                          </div>
                          <div className="rc prof">
                            <div className="rt">Shutter Profiles</div>
                            <div className="big">{(aggregates.shProf * 1.2).toFixed(2)}<span style={{ fontSize: 13 }}> m</span></div>
                            <div className="small">net {aggregates.shProf.toFixed(2)} +20%</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Stone per finish table */}
                  <div className="card">
                    <h2>③ Stone — per finish</h2>
                    <table>
                      <thead>
                        <tr>
                          <th>Finish</th>
                          <th style={{ textAlign: "right" }}>Panels</th>
                          <th style={{ textAlign: "right" }}>Net sqft</th>
                          <th style={{ textAlign: "right" }}>+15% sqft</th>
                          <th style={{ textAlign: "right" }}>Weight kg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(aggregates.finAgg).map(([k, v]) => (
                          <tr key={k}>
                            <td className="pk">{k}</td>
                            <td className="qty" style={{ textAlign: "right" }}>{v.pan}</td>
                            <td className="qty" style={{ textAlign: "right" }}>{v.sqft.toFixed(2)}</td>
                            <td className="qty" style={{ textAlign: "right" }}>{(v.sqft * 1.15).toFixed(2)}</td>
                            <td className="qty" style={{ textAlign: "right" }}>{(v.sqft * KG_SQFT).toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="assume">Stone is finish-specific. Profiles, hardware &amp; consumables are finish-agnostic and shown only in combined totals.</div>
                  </div>
                </>
              )}

              {/* ④ Project Lines */}
              <div className="card">
                <h2>④ Project Lines <button className="clr" style={{ float: "right" }} onClick={() => setProject([])}>clear all</button></h2>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Code</th>
                      <th>Finish</th>
                      <th style={{ textAlign: "right" }}>Rate (INR)</th>
                      <th style={{ textAlign: "right" }}>Qty</th>
                      <th style={{ textAlign: "right" }}>Total (INR)</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="empty">No cabinets added yet. Configure a unit and tap &quot;Add to Project&quot;.</div>
                        </td>
                      </tr>
                    ) : (
                      <>
                        {project.map((l, i) => (
                          <Fragment key={i}>
                          <tr>
                            <td>{i + 1}</td>
                            <td
                              className="dim"
                              style={{ fontSize: 11, cursor: "pointer" }}
                              title="Show Main BOM Details"
                              onClick={() => setExpandedLine((cur) => (cur === i ? null : i))}
                            >
                              <span style={{ color: "var(--accent)", marginRight: 4, display: "inline-block", width: 10 }}>
                                {expandedLine === i ? "▾" : "▸"}
                              </span>
                              {(() => {
                                const matSuffix = l.m.carcassMat === l.m.shutterMat || !l.m.shutterMat ? l.m.carcassMat : `${l.m.carcassMat}-${l.m.shutterMat}`;
                                return l.m.code.replace("-" + matSuffix, "");
                              })()}
                              {l.elevation && (
                                <span style={{ display: "block", fontSize: "10px", color: "var(--accent)", marginTop: 2 }}>Elevation: {l.elevation}</span>
                              )}
                            </td>
                            <td className="qty">
                              <div>
                                <span style={{ display: "block" }}>
                                  Stone: {l.m.carcassMat}
                                  {l.m.shutters && l.m.shutters.length > 0 && l.m.shutterMat !== l.m.carcassMat ? `/${l.m.shutterMat}` : ""}
                                </span>
                                {l.m.carcassProfileColor && (
                                  <span style={{ display: "block", fontSize: "10px", color: "var(--accent2)" }}>
                                    Profile: {l.m.carcassProfileColor}
                                    {l.m.shutters && l.m.shutters.length > 0 && l.m.shutterProfileColor !== l.m.carcassProfileColor ? `/${l.m.shutterProfileColor}` : ""}
                                  </span>
                                )}
                                {l.priceGroup && (
                                  <div style={{ marginTop: 4 }}>
                                    <select
                                      value={l.m.shutterMat || ""}
                                      onChange={(e) => applyColourToLine(i, e.target.value)}
                                      title={`Shutter colour (${l.priceGroup})`}
                                      style={{ fontSize: 10, padding: "2px 4px", border: l.m.shutterMat ? "1px solid var(--line)" : "1px solid #c0392b", borderRadius: 3, maxWidth: 170, background: "#fff" }}
                                    >
                                      <option value="">Pick colour ({l.priceGroup})…</option>
                                      {coloursForPriceGroup(l.priceGroup).map((c) => (
                                        <option key={c} value={c}>{c}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <input
                                type="number"
                                value={l.rate || 0}
                                min="0"
                                onChange={(e) => {
                                  const val = Math.max(0, parseFloat(e.target.value) || 0);
                                  setProject((curr) => curr.map((item, idx) => idx === i ? { ...item, rate: val } : item));
                                }}
                                style={{ width: "95px", textAlign: "right", padding: "4px", border: "1px solid var(--line)", borderRadius: "3px", fontFamily: "var(--font-mono, monospace)" }}
                              />
                            </td>
                            <td className="qty" style={{ textAlign: "right" }}>{l.qty}</td>
                            <td className="qty" style={{ textAlign: "right", fontFamily: "var(--font-mono, monospace)" }}>
                              {((l.rate || 0) * l.qty).toLocaleString("en-IN")}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <button className="rm" onClick={() => removeLine(i)}>remove</button>
                            </td>
                          </tr>
                          {expandedLine === i && (
                            <tr>
                              <td colSpan={7} style={{ background: "rgba(106, 98, 86, 0.04)", padding: "10px 14px" }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8, letterSpacing: "0.5px" }}>
                                  MAIN BOM DETAILS — {l.m.code}
                                </div>
                                {l.m.pkRows.length === 0 ? (
                                  <div className="empty" style={{ fontSize: 11 }}>No BOM packets for this item.</div>
                                ) : (
                                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                    <thead>
                                      <tr style={{ borderBottom: "1px solid var(--line)" }}>
                                        <th style={{ textAlign: "left", padding: "4px 8px" }}>Packet</th>
                                        <th style={{ textAlign: "left", padding: "4px 8px" }}>Dimensions</th>
                                        <th style={{ textAlign: "right", padding: "4px 8px", width: 60 }}>Qty</th>
                                        <th style={{ textAlign: "left", padding: "4px 8px", width: 60 }}>UoM</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {l.m.pkRows.map((r, ri) => {
                                        const gl: Record<string, string> = { panel: "Panel", prof: "Profile", hard: "Hardware", cons: "Consumable", shut: "Shutter", elen_bom: "Elenor" };
                                        const gc: Record<string, string> = { panel: "g-panel", prof: "g-prof", hard: "g-hard", cons: "g-cons", shut: "g-prof", elen_bom: "g-prof" };
                                        return (
                                          <tr key={ri} style={{ borderBottom: "1px solid rgba(106, 98, 86, 0.12)" }}>
                                            <td style={{ padding: "4px 8px" }}>
                                              <span className={`grp ${gc[r[0]] || "g-panel"}`}>{gl[r[0]] || r[0]}</span>
                                              <span style={{ marginLeft: 6 }}>{r[1]}</span>
                                            </td>
                                            <td className="dim" style={{ padding: "4px 8px" }}>{r[2]}</td>
                                            <td className="qty" style={{ padding: "4px 8px", textAlign: "right" }}>{r[3]}</td>
                                            <td className="qty" style={{ padding: "4px 8px" }}>{r[4]}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        ))}
                        <tr style={{ fontWeight: "600", background: "rgba(106, 98, 86, 0.05)" }}>
                          <td colSpan={3} style={{ textAlign: "left", padding: "8px 10px" }}>Grand Total</td>
                          <td></td>
                          <td style={{ textAlign: "right", padding: "8px 10px" }}>{project.reduce((sum, l) => sum + l.qty, 0)}</td>
                          <td style={{ textAlign: "right", padding: "8px 10px", fontFamily: "var(--font-mono, monospace)" }}>
                            {project.reduce((sum, l) => sum + (l.rate || 0) * l.qty, 0).toLocaleString("en-IN")}
                          </td>
                          <td></td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>

              {/* ⑤ Fillers */}
              <div className="card">
                <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>⑤ Fillers</span>
                  <button className="clr" style={{ fontSize: "11px", padding: "3px 10px" }} onClick={addFillerRow}>+ add row</button>
                </h2>
                {fillers.length === 0 ? (
                  <div className="empty" style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6, padding: "8px 0" }}>
                    No fillers. Click &quot;+ add row&quot; to add a filler for any zone (a zone can be added more than once).
                  </div>
                ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid var(--line)" }}>
                        <th style={{ textAlign: "left", padding: "8px" }}>Zone</th>
                        <th style={{ width: "80px", textAlign: "center", padding: "8px" }}>Qty</th>
                        <th style={{ textAlign: "left", padding: "8px" }}>Shutter Shade</th>
                        <th style={{ width: "130px", textAlign: "center", padding: "8px" }}>Height preset</th>
                        <th style={{ width: "120px", textAlign: "center", padding: "8px" }}>Height (mm)</th>
                        <th style={{ width: "120px", textAlign: "center", padding: "8px" }}>Width (mm)</th>
                        <th style={{ width: "110px", textAlign: "center", padding: "8px" }}>Elevation</th>
                        <th style={{ width: "50px", textAlign: "center", padding: "8px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      <datalist id="filler-elev-list">
                        {ELEVATION_OPTIONS.map((el) => (<option key={el} value={el} />))}
                      </datalist>
                      {fillers.map((item) => {
                        const zoneKey = item.zone;
                        const defaultShade = getDefaultShutterShadeForZone(zoneKey);
                        const defaultHeight = getDefaultShutterHeightForZone(zoneKey);
                        const defaultWidth = 80;

                        return (
                          <tr key={item.id} style={{ borderBottom: "1px solid var(--line)" }}>
                            <td style={{ padding: "8px" }}>
                              <select
                                value={item.zone}
                                onChange={(e) => updateFiller(item.id, { zone: e.target.value })}
                                style={{ width: "120px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", fontSize: "11px", background: "#fff" }}
                              >
                                {["base", "tall", "wall", "loft", "mid"].map((z) => (
                                  <option key={z} value={z}>{z.charAt(0).toUpperCase() + z.slice(1)}</option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <input
                                type="number"
                                min={1}
                                value={item.qty}
                                onChange={(e) => updateFiller(item.id, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                                style={{ width: "60px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center", fontSize: "11px", background: "#fff" }}
                              />
                            </td>
                            <td style={{ padding: "8px" }}>
                              <select
                                value={item.customShade || ""}
                                onChange={(e) => updateFiller(item.id, { customShade: e.target.value })}
                                style={{ width: "160px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", fontSize: "11px", background: "#fff" }}
                              >
                                <option value="">Default ({defaultShade})</option>
                                {shutterOptions.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <select
                                value=""
                                onChange={(e) => { if (e.target.value) updateFiller(item.id, { customHeight: e.target.value }); }}
                                style={{ width: "120px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", fontSize: "11px", background: "#fff" }}
                              >
                                <option value="">Custom / pick…</option>
                                {(FILLER_PRESETS[zoneKey] || []).map((h) => (<option key={h} value={String(h)}>{h}</option>))}
                              </select>
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <input
                                type="number"
                                placeholder={String(defaultHeight)}
                                value={item.customHeight}
                                onChange={(e) => updateFiller(item.id, { customHeight: e.target.value })}
                                style={{ width: "95px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center", fontSize: "11px", background: "#fff" }}
                              />
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <input
                                type="number"
                                placeholder={String(defaultWidth)}
                                value={item.customWidth}
                                onChange={(e) => updateFiller(item.id, { customWidth: e.target.value })}
                                style={{ width: "95px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center", fontSize: "11px", background: "#fff" }}
                              />
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <input
                                list="filler-elev-list"
                                placeholder="AA / custom"
                                value={item.elevation}
                                onChange={(e) => updateFiller(item.id, { elevation: e.target.value })}
                                style={{ width: "90px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center", fontSize: "11px", background: "#fff" }}
                              />
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <button className="clr" title="Remove row" onClick={() => removeFiller(item.id)} style={{ fontSize: "13px", padding: "2px 8px", color: "#c0392b" }}>×</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                )}
              </div>

              {/* ⑥ Visible Panels */}
              <div className="card">
                <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>⑥ Visible Panels</span>
                  <button className="clr" style={{ fontSize: "11px", padding: "3px 10px" }} onClick={addVisiblePanelRow}>+ add row</button>
                </h2>
                {visiblePanels.length === 0 ? (
                  <div className="empty" style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6, padding: "8px 0" }}>
                    No visible panels. Click &quot;+ add row&quot; to add a visible panel for any zone (a zone can be added more than once).
                  </div>
                ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid var(--line)" }}>
                        <th style={{ textAlign: "left", padding: "8px" }}>Zone</th>
                        <th style={{ width: "80px", textAlign: "center", padding: "8px" }}>Qty</th>
                        <th style={{ textAlign: "left", padding: "8px" }}>Profile Style</th>
                        <th style={{ textAlign: "left", padding: "8px" }}>Shutter Shade</th>
                        <th style={{ width: "160px", textAlign: "center", padding: "8px" }}>Size preset</th>
                        <th style={{ width: "120px", textAlign: "center", padding: "8px" }}>Height (mm)</th>
                        <th style={{ width: "120px", textAlign: "center", padding: "8px" }}>Width (mm)</th>
                        <th style={{ width: "50px", textAlign: "center", padding: "8px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePanels.map((item) => {
                        const zoneKey = item.zone;
                        const defaultShade = getDefaultShutterShadeForZone(zoneKey);
                        const defaultHeight = getDefaultShutterHeightForZone(zoneKey);
                        const defaultWidth = getDefaultCabinetDepthForZone(zoneKey) + 25;

                        return (
                          <tr key={item.id} style={{ borderBottom: "1px solid var(--line)" }}>
                            <td style={{ padding: "8px" }}>
                              <select
                                value={item.zone}
                                onChange={(e) => updateVisiblePanel(item.id, { zone: e.target.value })}
                                style={{ width: "120px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", fontSize: "11px", background: "#fff" }}
                              >
                                {["base", "tall", "wall", "loft", "mid"].map((z) => (
                                  <option key={z} value={z}>{z.charAt(0).toUpperCase() + z.slice(1)}</option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <input
                                type="number"
                                min={1}
                                value={item.qty}
                                onChange={(e) => updateVisiblePanel(item.id, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                                style={{ width: "60px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center", fontSize: "11px", background: "#fff" }}
                              />
                            </td>
                            <td style={{ padding: "8px" }}>
                              <select
                                value={item.profile}
                                onChange={(e) => updateVisiblePanel(item.id, { profile: e.target.value })}
                                style={{ width: "130px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", fontSize: "11px", background: "#fff" }}
                              >
                                <option value="MD1">MD1 (Default)</option>
                                <option value="MD3">MD3</option>
                                <option value="MD1 + CM1/2">MD1 + CM1/2</option>
                                <option value="MD3 + CM1/3">MD3 + CM1/3</option>
                              </select>
                            </td>
                            <td style={{ padding: "8px" }}>
                              <select
                                value={item.customShade || ""}
                                onChange={(e) => updateVisiblePanel(item.id, { customShade: e.target.value })}
                                style={{ width: "160px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", fontSize: "11px", background: "#fff" }}
                              >
                                <option value="">Default ({defaultShade})</option>
                                {shutterOptions.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <select
                                value=""
                                onChange={(e) => { const p = (VP_PRESETS[zoneKey] || []).find((x) => x.label === e.target.value); if (p) updateVisiblePanel(item.id, { customHeight: String(p.h), customWidth: String(p.w) }); }}
                                style={{ width: "150px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", fontSize: "11px", background: "#fff" }}
                              >
                                <option value="">Custom / pick…</option>
                                {(VP_PRESETS[zoneKey] || []).map((p) => (<option key={p.label} value={p.label}>{p.label}</option>))}
                              </select>
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <input
                                type="number"
                                placeholder={String(defaultHeight)}
                                value={item.customHeight}
                                onChange={(e) => updateVisiblePanel(item.id, { customHeight: e.target.value })}
                                style={{ width: "95px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center", fontSize: "11px", background: "#fff" }}
                              />
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <input
                                type="number"
                                placeholder={String(defaultWidth)}
                                value={item.customWidth}
                                onChange={(e) => updateVisiblePanel(item.id, { customWidth: e.target.value })}
                                style={{ width: "95px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center", fontSize: "11px", background: "#fff" }}
                              />
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <button className="clr" title="Remove row" onClick={() => removeVisiblePanel(item.id)} style={{ fontSize: "13px", padding: "2px 8px", color: "#c0392b" }}>×</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                )}
              </div>

              {/* ⑦ Countertop */}
              <div className="card">
                <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>⑦ Countertop</span>
                  <button className="clr" style={{ fontSize: "11px", padding: "3px 10px" }} onClick={addCountertopRow}>+ add row</button>
                </h2>
                {countertops.length === 0 ? (
                  <div className="empty" style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6, padding: "8px 0" }}>
                    No countertops. Click &quot;+ add row&quot;. Base-stone, patti, brass &amp; light are derived from Length / Depth / Thickness / sides.
                  </div>
                ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid var(--line)" }}>
                        <th style={{ width: "100px", textAlign: "center", padding: "6px" }}>Length (mm)</th>
                        <th style={{ width: "95px", textAlign: "center", padding: "6px" }}>Depth (mm)</th>
                        <th style={{ width: "85px", textAlign: "center", padding: "6px" }}>Thick.</th>
                        <th style={{ textAlign: "left", padding: "6px" }}>Color</th>
                        <th style={{ width: "230px", textAlign: "center", padding: "6px" }}>Type</th>
                        <th style={{ width: "90px", textAlign: "center", padding: "6px" }}>Rounding</th>
                        <th style={{ width: "70px", textAlign: "center", padding: "6px" }}>Drop Ht</th>
                        <th style={{ width: "55px", textAlign: "center", padding: "6px" }}>Light</th>
                        <th style={{ width: "55px", textAlign: "center", padding: "6px" }}>Qty</th>
                        <th style={{ width: "40px", textAlign: "center", padding: "6px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {countertops.map((item) => {
                        const defaultColor = getDefaultShutterShadeForZone("base");
                        const numIn = { width: "78px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center" as const, fontSize: "11px", background: "#fff" };
                        const sel = { width: "92px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", fontSize: "11px", background: "#fff" };
                        return (
                          <tr key={item.id} style={{ borderBottom: "1px solid var(--line)" }}>
                            <td style={{ padding: "6px", textAlign: "center" }}>
                              <input type="number" value={item.length} onChange={(e) => updateCountertop(item.id, { length: e.target.value })} style={numIn} />
                            </td>
                            <td style={{ padding: "6px", textAlign: "center" }}>
                              <input type="number" value={item.depth} placeholder="600" onChange={(e) => updateCountertop(item.id, { depth: e.target.value })} style={numIn} />
                            </td>
                            <td style={{ padding: "6px", textAlign: "center" }}>
                              <select value={item.thickness} onChange={(e) => updateCountertop(item.id, { thickness: e.target.value })} style={{ ...sel, width: "70px" }}>
                                <option value="30">30</option>
                                <option value="40">40</option>
                              </select>
                            </td>
                            <td style={{ padding: "6px" }}>
                              <select value={item.color || ""} onChange={(e) => updateCountertop(item.id, { color: e.target.value })} style={{ ...sel, width: "150px" }}>
                                <option value="">Default ({defaultColor})</option>
                                {shutterOptions.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                              </select>
                            </td>
                            <td style={{ padding: "6px", textAlign: "center" }}>
                              <select value={item.ctType || 1} onChange={(e) => { const t = parseInt(e.target.value) || 1; const opts = ctEdgingOptions(t); const ed = opts.some((o) => o.value === item.edging) ? item.edging : "none"; updateCountertop(item.id, { ctType: t, edging: ed, island: CT_TYPES.find((x) => x.value === t)?.island ?? false }); }} style={{ ...sel, width: "220px" }}>
                                {CT_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                              </select>
                            </td>
                            <td style={{ padding: "6px", textAlign: "center" }}>
                              {(() => { const opts = ctEdgingOptions(item.ctType || 1); const on = (item.edging || "none") !== "none"; return (
                                <div style={{ display: "flex", flexDirection: "column", gap: "3px", alignItems: "center" }}>
                                  <select value={item.edging || "none"} disabled={opts.length <= 1} onChange={(e) => updateCountertop(item.id, { edging: e.target.value as CtEdging })} style={{ ...sel, width: "80px", opacity: opts.length <= 1 ? 0.5 : 1 }}>
                                    {opts.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                                  </select>
                                  <input type="number" value={item.edgingHeight} disabled={!on} title="Rounding height (shown in counter name)" placeholder="600" onChange={(e) => updateCountertop(item.id, { edgingHeight: e.target.value })} style={{ ...numIn, width: "62px", opacity: on ? 1 : 0.4 }} />
                                </div>
                              ); })()}
                            </td>
                            <td style={{ padding: "6px", textAlign: "center" }}>
                              {(() => { const has = ctHasDrop(item.ctType || 1); return (
                                <input type="number" value={item.dropHeight} disabled={!has} title="Drop-down panel height" placeholder="705" onChange={(e) => updateCountertop(item.id, { dropHeight: e.target.value })} style={{ ...numIn, width: "60px", opacity: has ? 1 : 0.4 }} />
                              ); })()}
                            </td>
                            <td style={{ padding: "6px", textAlign: "center" }}>
                              <input type="checkbox" checked={item.baseLight} onChange={(e) => updateCountertop(item.id, { baseLight: e.target.checked })} style={{ cursor: "pointer" }} />
                            </td>
                            <td style={{ padding: "6px", textAlign: "center" }}>
                              <input type="number" min={1} value={item.qty} onChange={(e) => updateCountertop(item.id, { qty: Math.max(1, parseInt(e.target.value) || 1) })} style={{ ...numIn, width: "48px" }} />
                            </td>
                            <td style={{ padding: "6px", textAlign: "center" }}>
                              <button className="clr" title="Remove row" onClick={() => removeCountertop(item.id)} style={{ fontSize: "13px", padding: "2px 8px", color: "#c0392b" }}>×</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                )}
              </div>

              {/* ⑧ Backsplash */}
              <div className="card">
                <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>⑧ Backsplash</span>
                  <button className="clr" style={{ fontSize: "11px", padding: "3px 10px" }} onClick={addBacksplashRow}>+ add row</button>
                </h2>
                {backsplashes.length === 0 ? (
                  <div className="empty" style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6, padding: "8px 0" }}>
                    No backsplashes. Click &quot;+ add row&quot; to add one (you can add as many as you like).
                  </div>
                ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid var(--line)" }}>
                        <th style={{ width: "110px", textAlign: "center", padding: "8px" }}>Width (mm)</th>
                        <th style={{ width: "110px", textAlign: "center", padding: "8px" }}>Height (mm)</th>
                        <th style={{ width: "120px", textAlign: "center", padding: "8px" }}>Thickness (mm)</th>
                        <th style={{ textAlign: "left", padding: "8px" }}>Color</th>
                        <th style={{ width: "70px", textAlign: "center", padding: "8px" }}>Qty</th>
                        <th style={{ width: "50px", textAlign: "center", padding: "8px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {backsplashes.map((item) => {
                        const defaultColor = getDefaultShutterShadeForZone("base");
                        return (
                          <tr key={item.id} style={{ borderBottom: "1px solid var(--line)" }}>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <input
                                type="number"
                                value={item.width}
                                onChange={(e) => updateBacksplash(item.id, { width: e.target.value })}
                                style={{ width: "90px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center", fontSize: "11px", background: "#fff" }}
                              />
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <input
                                type="number"
                                value={item.height}
                                onChange={(e) => updateBacksplash(item.id, { height: e.target.value })}
                                style={{ width: "90px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center", fontSize: "11px", background: "#fff" }}
                              />
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <input
                                type="number"
                                value={item.thickness}
                                placeholder="15"
                                onChange={(e) => updateBacksplash(item.id, { thickness: e.target.value })}
                                style={{ width: "90px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center", fontSize: "11px", background: "#fff" }}
                              />
                            </td>
                            <td style={{ padding: "8px" }}>
                              <select
                                value={item.color || ""}
                                onChange={(e) => updateBacksplash(item.id, { color: e.target.value })}
                                style={{ width: "160px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", fontSize: "11px", background: "#fff" }}
                              >
                                <option value="">Default ({defaultColor})</option>
                                {shutterOptions.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <input
                                type="number"
                                min={1}
                                value={item.qty}
                                onChange={(e) => updateBacksplash(item.id, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                                style={{ width: "55px", padding: "4px 6px", border: "1px solid var(--line)", borderRadius: "3px", textAlign: "center", fontSize: "11px", background: "#fff" }}
                              />
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              <button className="clr" title="Remove row" onClick={() => removeBacksplash(item.id)} style={{ fontSize: "13px", padding: "2px 8px", color: "#c0392b" }}>×</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                )}
              </div>

              {/* ⑨ Raw Material Selection — split into Carcass & Shutter subsections */}
              <div className="card" style={{ marginTop: "0" }}>
                <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>⑨ Raw Material Selection</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {Object.keys(rawErrorMap).length > 0 && (
                      <button className="clr" style={{ fontSize: "11px", padding: "3px 10px" }} onClick={retryAllRawFetch}>↻ Retry All</button>
                    )}
                    <span style={{ fontSize: "12px", fontWeight: "normal", color: "var(--accent)" }}>
                      {selectedSo && loadedSoDetail
                        ? `Aggregated from SO: ${selectedSo.salesorder_number}`
                        : project.length > 0
                        ? `Aggregated from Project: ${project.reduce((a, l) => a + l.qty, 0)} units`
                        : soMode
                        ? "Select a Sales Order to load materials"
                        : "Aggregated from Configured Unit (Fallback)"}
                    </span>
                  </span>
                </h2>

                {isSoDetailLoading ? (
                  <div style={{ padding: "20px 0", textAlign: "center", color: "var(--accent)", fontSize: "14px" }}>
                    Loading Sales Order line items & materials...
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>

                    {/* ── Carcass Raw Materials ── */}
                    <div>
                      <h3 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "2px solid var(--accent)", paddingBottom: "8px", margin: "0 0 20px 0", letterSpacing: "0.5px" }}>Carcass</h3>

                      {/* Carcass Stones */}
                      <div style={{ marginBottom: "20px" }}>
                        <h4 style={{ fontSize: "14px", fontWeight: 600, borderBottom: "1px solid var(--line)", paddingBottom: "6px", margin: "0 0 14px 0" }}>Stones</h4>
                        {rawAggregation.stones.filter(s => s.category === "carcass").length === 0 ? (
                          <div style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6 }}>No carcass stone materials required.</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                            {rawAggregation.stones.filter(s => s.category === "carcass").map((stone) => {
                              const { key, finish, thickness, netSqft } = stone;
                              const items = rawOptionsMap[key] || [];
                              const selectedId = selectedRawIds[key] || "";
                              const loading = rawLoadingMap[key];
                              const selectedItem = items.find((i: any) => i.item_id === selectedId);
                              const slabArea = selectedItem ? getSlabArea(selectedItem) : 0;
                              const reqSqft = netSqft * (1 + STONE_WASTE);
                              const calcPcs = slabArea > 0 ? reqSqft / slabArea : 0;
                              const roundedCalcPcs = Math.round(calcPcs * 100) / 100;
                              const customVal = customPcsMap[key];
                              const displayPcs = customVal !== undefined && customVal !== "" ? customVal : roundedCalcPcs.toString();
                              const stock = selectedItem && selectedItem.stock_on_hand !== null && selectedItem.stock_on_hand !== undefined ? selectedItem.stock_on_hand : "N/A";

                              return (
                                <div key={key} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--accent)" }}>Stone — {finish} ({thickness}mm)</span>
                                    <span style={{ fontSize: "11px", color: "var(--ink)", opacity: 0.7 }}>Net: {netSqft.toFixed(2)} sqft | Total (+15%): {reqSqft.toFixed(2)} sqft</span>
                                  </div>
                                  {loading ? (
                                    <div style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6 }}>Loading stone items...</div>
                                  ) : rawErrorMap[key] ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                      <div style={{ fontSize: "12px", color: "#c0392b" }}>⚠ Zoho API error — check your network connection.</div>
                                      <button className="clr" style={{ fontSize: "11px", padding: "2px 8px" }} onClick={() => retryRawFetch(key)}>Retry</button>
                                    </div>
                                  ) : items.length === 0 ? (
                                    <div style={{ fontSize: "12px", color: "var(--warn)" }}>No matching {thickness}mm stone items found in Zoho for finish &quot;{finish}&quot;.</div>
                                  ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                      <SearchableSelect
                                        value={selectedId}
                                        onChange={(val: string) => setSelectedRawIds((prev) => ({ ...prev, [key]: val }))}
                                        options={items.map((item: any) => ({ value: item.item_id, label: `${item.name} ${item.sku ? `(${item.sku})` : ""}` }))}
                                        placeholder="Search stone..."
                                      />
                                      {selectedItem && (
                                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", background: "rgba(106, 98, 86, 0.05)", padding: "10px", borderRadius: "4px", fontSize: "12px", border: "1px solid var(--line)" }}>
                                          <div>SKU: <b>{selectedItem.sku || "N/A"}</b> · Stock: <b>{stock}</b></div>
                                          {slabArea > 0 ? (
                                            <>
                                              <div>Slab Size: <b>{getCfValue(selectedItem, "cf_height")}x{getCfValue(selectedItem, "cf_width")}mm</b> ({slabArea.toFixed(2)} sqft)</div>
                                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
                                                <span>Calculated Slabs: <b>{roundedCalcPcs.toFixed(2)} pcs</b></span>
                                                <label style={{ margin: 0, fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                                  <span>Actual Slabs:</span>
                                                  <input type="number" step="0.01" style={{ width: "70px", padding: "3px 6px", fontSize: "12px", textAlign: "center" }} value={displayPcs} onChange={(e) => setCustomPcsMap((prev) => ({ ...prev, [key]: e.target.value }))} />
                                                </label>
                                              </div>
                                            </>
                                          ) : (
                                            <div style={{ color: "var(--warn)" }}>Slab dimensions missing in Zoho custom fields (cf_height / cf_width).</div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Carcass Profiles */}
                      <div>
                        <h4 style={{ fontSize: "14px", fontWeight: 600, borderBottom: "1px solid var(--line)", paddingBottom: "6px", margin: "0 0 14px 0" }}>Profiles</h4>
                        {rawAggregation.profiles.filter(p => p.category === "carcass").length === 0 ? (
                          <div style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6 }}>No carcass profile materials required.</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            {rawAggregation.profiles.filter(p => p.category === "carcass").map((prof) => {
                              const { key, profileCode, finish, lenMeters } = prof;
                              const items = rawOptionsMap[key] || [];
                              const selectedId = selectedRawIds[key] || "";
                              const loading = rawLoadingMap[key];
                              const selectedItem = items.find((i: any) => i.item_id === selectedId);
                              const stock = selectedItem && selectedItem.stock_on_hand !== null && selectedItem.stock_on_hand !== undefined ? selectedItem.stock_on_hand : "N/A";
                              const waste = profileCode.toUpperCase() === "ELEN" ? ELENOR_WASTE : PROFILE_WASTE;
                              const reqProf = lenMeters * (1 + waste);

                              return (
                                <div key={key} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: "12px", fontWeight: 500 }}>Profile — {profileCode} ({finish})</span>
                                    <span style={{ fontSize: "11px", color: "var(--ink)", opacity: 0.7 }}>Net: {lenMeters.toFixed(2)}m | Total (+{(waste * 100).toFixed(0)}%): {reqProf.toFixed(2)}m</span>
                                  </div>
                                  {loading ? (
                                    <div style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6 }}>Loading profiles...</div>
                                  ) : rawErrorMap[key] ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                      <div style={{ fontSize: "12px", color: "#c0392b" }}>⚠ Zoho API error — check your network connection.</div>
                                      <button className="clr" style={{ fontSize: "11px", padding: "2px 8px" }} onClick={() => retryRawFetch(key)}>Retry</button>
                                    </div>
                                  ) : items.length === 0 ? (
                                    <div style={{ fontSize: "12px", color: "var(--warn)" }}>No matching profile items found in Zoho for finish &quot;{finish}&quot; with code &quot;{profileCode}&quot;.</div>
                                  ) : (
                                    <>
                                      <SearchableSelect
                                        value={selectedId}
                                        onChange={(val: string) => setSelectedRawIds((prev) => ({ ...prev, [key]: val }))}
                                        options={items.map((item: any) => ({ value: item.item_id, label: `${item.name} ${item.sku ? `(${item.sku})` : ""}` }))}
                                        placeholder="Search profile..."
                                      />
                                      {selectedItem && (
                                        <div style={{ background: "rgba(106, 98, 86, 0.05)", padding: "8px 10px", borderRadius: "4px", fontSize: "11px", border: "1px solid var(--line)" }}>
                                          SKU: <b>{selectedItem.sku || "N/A"}</b> · Stock: <b>{stock}</b>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── Shutter Raw Materials ── */}
                    {(rawAggregation.stones.some(s => s.category === "shutter") || rawAggregation.profiles.some(p => p.category === "shutter")) && (
                      <div>
                        <h3 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "2px solid var(--accent)", paddingBottom: "8px", margin: "0 0 20px 0", letterSpacing: "0.5px" }}>Shutter</h3>

                        {/* Shutter Stones */}
                        <div style={{ marginBottom: "20px" }}>
                          <h4 style={{ fontSize: "14px", fontWeight: 600, borderBottom: "1px solid var(--line)", paddingBottom: "6px", margin: "0 0 14px 0" }}>Stones</h4>
                          {rawAggregation.stones.filter(s => s.category === "shutter").length === 0 ? (
                            <div style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6 }}>No shutter stone materials required.</div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                              {rawAggregation.stones.filter(s => s.category === "shutter").map((stone) => {
                                const { key, finish, thickness, netSqft } = stone;
                                const items = rawOptionsMap[key] || [];
                                const selectedId = selectedRawIds[key] || "";
                                const loading = rawLoadingMap[key];
                                const selectedItem = items.find((i: any) => i.item_id === selectedId);
                                const slabArea = selectedItem ? getSlabArea(selectedItem) : 0;
                                const reqSqft = netSqft * (1 + STONE_WASTE);
                                const calcPcs = slabArea > 0 ? reqSqft / slabArea : 0;
                                const roundedCalcPcs = Math.round(calcPcs * 100) / 100;
                                const customVal = customPcsMap[key];
                                const displayPcs = customVal !== undefined && customVal !== "" ? customVal : roundedCalcPcs.toString();
                                const stock = selectedItem && selectedItem.stock_on_hand !== null && selectedItem.stock_on_hand !== undefined ? selectedItem.stock_on_hand : "N/A";

                                return (
                                  <div key={key} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                      <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--accent)" }}>Stone — {finish} ({thickness}mm)</span>
                                      <span style={{ fontSize: "11px", color: "var(--ink)", opacity: 0.7 }}>Net: {netSqft.toFixed(2)} sqft | Total (+15%): {reqSqft.toFixed(2)} sqft</span>
                                    </div>
                                    {loading ? (
                                      <div style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6 }}>Loading stone items...</div>
                                    ) : rawErrorMap[key] ? (
                                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <div style={{ fontSize: "12px", color: "#c0392b" }}>⚠ Zoho API error — check your network connection.</div>
                                        <button className="clr" style={{ fontSize: "11px", padding: "2px 8px" }} onClick={() => retryRawFetch(key)}>Retry</button>
                                      </div>
                                    ) : items.length === 0 ? (
                                      <div style={{ fontSize: "12px", color: "var(--warn)" }}>No matching {thickness}mm stone items found in Zoho for finish &quot;{finish}&quot;.</div>
                                    ) : (
                                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                        <SearchableSelect
                                          value={selectedId}
                                          onChange={(val: string) => setSelectedRawIds((prev) => ({ ...prev, [key]: val }))}
                                          options={items.map((item: any) => ({ value: item.item_id, label: `${item.name} ${item.sku ? `(${item.sku})` : ""}` }))}
                                          placeholder="Search stone..."
                                        />
                                        {selectedItem && (
                                          <div style={{ display: "flex", flexDirection: "column", gap: "6px", background: "rgba(106, 98, 86, 0.05)", padding: "10px", borderRadius: "4px", fontSize: "12px", border: "1px solid var(--line)" }}>
                                            <div>SKU: <b>{selectedItem.sku || "N/A"}</b> · Stock: <b>{stock}</b></div>
                                            {slabArea > 0 ? (
                                              <>
                                                <div>Slab Size: <b>{getCfValue(selectedItem, "cf_height")}x{getCfValue(selectedItem, "cf_width")}mm</b> ({slabArea.toFixed(2)} sqft)</div>
                                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
                                                  <span>Calculated Slabs: <b>{roundedCalcPcs.toFixed(2)} pcs</b></span>
                                                  <label style={{ margin: 0, fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                                    <span>Actual Slabs:</span>
                                                    <input type="number" step="0.01" style={{ width: "70px", padding: "3px 6px", fontSize: "12px", textAlign: "center" }} value={displayPcs} onChange={(e) => setCustomPcsMap((prev) => ({ ...prev, [key]: e.target.value }))} />
                                                  </label>
                                                </div>
                                              </>
                                            ) : (
                                              <div style={{ color: "var(--warn)" }}>Slab dimensions missing in Zoho custom fields (cf_height / cf_width).</div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Shutter Profiles */}
                        <div>
                          <h4 style={{ fontSize: "14px", fontWeight: 600, borderBottom: "1px solid var(--line)", paddingBottom: "6px", margin: "0 0 14px 0" }}>Profiles</h4>
                          {rawAggregation.profiles.filter(p => p.category === "shutter").length === 0 ? (
                            <div style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6 }}>No shutter profile materials required.</div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                              {rawAggregation.profiles.filter(p => p.category === "shutter").map((prof) => {
                                const { key, profileCode, finish, lenMeters } = prof;
                                const items = rawOptionsMap[key] || [];
                                const selectedId = selectedRawIds[key] || "";
                                const loading = rawLoadingMap[key];
                                const selectedItem = items.find((i: any) => i.item_id === selectedId);
                                const stock = selectedItem && selectedItem.stock_on_hand !== null && selectedItem.stock_on_hand !== undefined ? selectedItem.stock_on_hand : "N/A";
                                const waste = profileCode.toUpperCase() === "ELEN" ? ELENOR_WASTE : PROFILE_WASTE;
                                const reqProf = lenMeters * (1 + waste);

                                return (
                                  <div key={key} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                      <span style={{ fontSize: "12px", fontWeight: 500 }}>Profile — {profileCode} ({finish})</span>
                                      <span style={{ fontSize: "11px", color: "var(--ink)", opacity: 0.7 }}>Net: {lenMeters.toFixed(2)}m | Total (+{(waste * 100).toFixed(0)}%): {reqProf.toFixed(2)}m</span>
                                    </div>
                                    {loading ? (
                                      <div style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6 }}>Loading profiles...</div>
                                    ) : rawErrorMap[key] ? (
                                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <div style={{ fontSize: "12px", color: "#c0392b" }}>⚠ Zoho API error — check your network connection.</div>
                                        <button className="clr" style={{ fontSize: "11px", padding: "2px 8px" }} onClick={() => retryRawFetch(key)}>Retry</button>
                                      </div>
                                    ) : items.length === 0 ? (
                                      <div style={{ fontSize: "12px", color: "var(--warn)" }}>No matching profile items found in Zoho for finish &quot;{finish}&quot; with code &quot;{profileCode}&quot;.</div>
                                    ) : (
                                      <>
                                        <SearchableSelect
                                          value={selectedId}
                                          onChange={(val: string) => setSelectedRawIds((prev) => ({ ...prev, [key]: val }))}
                                          options={items.map((item: any) => ({ value: item.item_id, label: `${item.name} ${item.sku ? `(${item.sku})` : ""}` }))}
                                          placeholder="Search profile..."
                                        />
                                        {selectedItem && (
                                          <div style={{ background: "rgba(106, 98, 86, 0.05)", padding: "8px 10px", borderRadius: "4px", fontSize: "11px", border: "1px solid var(--line)" }}>
                                            SKU: <b>{selectedItem.sku || "N/A"}</b> · Stock: <b>{stock}</b>
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Hardware & Consumables ── */}
                    {rawAggregation.hardware.length > 0 && (
                      <div>
                        <h3 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "2px solid var(--accent)", paddingBottom: "8px", margin: "0 0 20px 0", letterSpacing: "0.5px" }}>Hardware & Consumables</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                          {rawAggregation.hardware.map((hw) => {
                            const { key, name, uom, totalQty } = hw;
                            const items = rawOptionsMap[key] || [];
                            const selectedId = selectedRawIds[key] || "";
                            const loading = rawLoadingMap[key];
                            const selectedItem = items.find((i: any) => i.item_id === selectedId);
                            const stock = selectedItem && selectedItem.stock_on_hand !== null && selectedItem.stock_on_hand !== undefined ? selectedItem.stock_on_hand : "N/A";

                            return (
                              <div key={key} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: "12px", fontWeight: 500 }}>{name}</span>
                                  <span style={{ fontSize: "11px", color: "var(--ink)", opacity: 0.7 }}>Qty: {Number.isInteger(totalQty) ? totalQty : totalQty.toFixed(3)} {uom}</span>
                                </div>
                                {loading ? (
                                  <div style={{ fontSize: "12px", color: "var(--ink)", opacity: 0.6 }}>Searching Zoho...</div>
                                ) : rawErrorMap[key] ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <div style={{ fontSize: "12px", color: "#c0392b" }}>⚠ Zoho API error — check your network connection.</div>
                                    <button className="clr" style={{ fontSize: "11px", padding: "2px 8px" }} onClick={() => retryRawFetch(key)}>Retry</button>
                                  </div>
                                ) : items.length === 0 ? (
                                  <div style={{ fontSize: "12px", color: "var(--warn)" }}>No matching items found in Zoho for &quot;{name}&quot;.</div>
                                ) : (
                                  <>
                                    <SearchableSelect
                                      value={selectedId}
                                      onChange={(val: string) => setSelectedRawIds((prev) => ({ ...prev, [key]: val }))}
                                      options={items.map((item: any) => ({ value: item.item_id, label: `${item.name || item.item_name} ${item.sku ? `(${item.sku})` : ""}` }))}
                                      placeholder="Search item..."
                                    />
                                    {selectedItem && (
                                      <div style={{ background: "rgba(106, 98, 86, 0.05)", padding: "8px 10px", borderRadius: "4px", fontSize: "11px", border: "1px solid var(--line)" }}>
                                        SKU: <b>{selectedItem.sku || "N/A"}</b> · Stock: <b>{stock}</b>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>

              {/* ⑩ Stock Check */}
              {project.length > 0 && (
                <div className="card">
                  <h2>
                    <span>⑩ Stock Check</span>
                    <button className="clr" style={{ float: "right" }} onClick={runStockCheck} disabled={stockCheckLoading}>
                      {stockCheckLoading ? "Checking..." : "Check Stock"}
                    </button>
                  </h2>
                  {Object.keys(stockMap).length > 0 ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th style={{ textAlign: "right" }}>Required</th>
                          <th style={{ textAlign: "right" }}>In Stock</th>
                          <th style={{ textAlign: "center" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const reqMap = new Map<string, number>();
                          project.forEach((l) => {
                            l.m.hardware.forEach((h) => reqMap.set(h.name, (reqMap.get(h.name) || 0) + h.qty * l.qty));
                            l.m.cons.forEach((c) => reqMap.set(c.name, (reqMap.get(c.name) || 0) + c.qty * l.qty));
                          });
                          return Array.from(reqMap.entries()).map(([name, needed]) => {
                            const si = stockMap[name];
                            const stock = si?.stock;
                            const loading = si?.loading;
                            const deficit = stock !== null && stock !== undefined ? Math.max(0, needed - stock) : null;
                            return (
                              <tr key={name}>
                                <td style={{ fontSize: 11 }}>{name}</td>
                                <td style={{ textAlign: "right", fontSize: 11 }}>{Number.isInteger(needed) ? needed : needed.toFixed(3)}</td>
                                <td style={{ textAlign: "right", fontSize: 11 }}>{loading ? "..." : stock !== null && stock !== undefined ? stock : "N/A"}</td>
                                <td style={{ textAlign: "center" }}>
                                  {loading ? (
                                    <span style={{ fontSize: 10, color: "var(--accent)" }}>checking</span>
                                  ) : deficit === null ? (
                                    <span className="tag" style={{ background: "#888", fontSize: 9, padding: "1px 6px" }}>unknown</span>
                                  ) : deficit === 0 ? (
                                    <span className="tag" style={{ background: "var(--good)", fontSize: 9, padding: "1px 6px" }}>in stock</span>
                                  ) : (
                                    <span className="tag" style={{ background: "var(--warn)", fontSize: 9, padding: "1px 6px" }}>deficit {Number.isInteger(deficit) ? deficit : deficit.toFixed(3)}</span>
                                  )}
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  ) : (
                    <div className="empty">Click &quot;Check Stock&quot; to verify hardware &amp; consumable availability in Zoho.</div>
                  )}
                </div>
              )}

              {/* Other Accessories (panels) */}
              {project.length > 0 && (
                <div className="card">
                  <h2>
                    <span>Other Accessories</span>
                    <button className="clr" style={{ float: "right" }} onClick={addOtherAccRow}>+ add row</button>
                  </h2>
                  {otherAccRows.length === 0 ? (
                    <div className="empty">No other accessories. Click &quot;+ add row&quot; to add a Chimney Panel or Dishwasher Panel.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {otherAccRows.map((row) => (
                        <div key={row.id} style={{ border: "1px solid var(--line)", borderRadius: "5px", padding: "12px", background: "#fff", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                          <label style={{ fontSize: 10, display: "inline-flex", flexDirection: "column", gap: "3px" }}>
                            Item
                            <select value={row.item} onChange={(e) => updateOtherAccRow(row.id, { item: e.target.value as OtherAccItemKey })} style={{ fontSize: 11, padding: "4px 6px" }}>
                              {OTHER_ACC_ITEMS.map((it) => (
                                <option key={it.key} value={it.key}>{it.label}</option>
                              ))}
                            </select>
                          </label>
                          {row.item === "chimney" && (
                            <label style={{ fontSize: 10, display: "inline-flex", flexDirection: "column", gap: "3px" }}>
                              Size preset
                              <select value="" onChange={(e) => { const p = CHIMNEY_PRESETS.find((x) => x.label === e.target.value); if (p) updateOtherAccRow(row.id, { width: p.w, height: p.h }); }} style={{ fontSize: 11, padding: "4px 6px" }}>
                                <option value="">Custom / pick…</option>
                                {CHIMNEY_PRESETS.map((p) => (<option key={p.label} value={p.label}>{p.label}</option>))}
                              </select>
                            </label>
                          )}
                          <label style={{ fontSize: 10, display: "inline-flex", flexDirection: "column", gap: "3px" }}>
                            Width (mm)
                            <input type="number" min={0} value={row.width} onChange={(e) => updateOtherAccRow(row.id, { width: parseFloat(e.target.value) || 0 })} style={{ width: "80px", fontSize: 11, padding: "4px 6px" }} />
                          </label>
                          <label style={{ fontSize: 10, display: "inline-flex", flexDirection: "column", gap: "3px" }}>
                            Height (mm)
                            <input type="number" min={0} value={row.height} onChange={(e) => updateOtherAccRow(row.id, { height: parseFloat(e.target.value) || 0 })} style={{ width: "80px", fontSize: 11, padding: "4px 6px" }} />
                          </label>
                          <label style={{ fontSize: 10, display: "inline-flex", flexDirection: "column", gap: "3px" }}>
                            Profile (code)
                            <select value={row.profile} onChange={(e) => updateOtherAccRow(row.id, { profile: e.target.value })} style={{ fontSize: 11, padding: "4px 6px" }}>
                              {(otherAccProfileOptions.includes(row.profile) ? otherAccProfileOptions : [row.profile, ...otherAccProfileOptions]).map((p) => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                            <span style={{ fontSize: 9, color: "var(--accent2)" }}>Colour: {row.profileColor} (shutter)</span>
                          </label>
                          <label style={{ fontSize: 10, display: "inline-flex", flexDirection: "column", gap: "3px" }}>
                            Color (Stone)
                            <select value={row.color} onChange={(e) => updateOtherAccRow(row.id, { color: e.target.value })} style={{ fontSize: 11, padding: "4px 6px" }}>
                              {(shutterOptions.includes(row.color) ? shutterOptions : [row.color, ...shutterOptions]).map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </label>
                          <label style={{ fontSize: 10, display: "inline-flex", flexDirection: "column", gap: "3px" }}>
                            Qty
                            <input type="number" min={1} value={row.qty} onChange={(e) => updateOtherAccRow(row.id, { qty: Math.max(1, parseInt(e.target.value) || 1) })} style={{ width: "60px", fontSize: 11, padding: "4px 6px", textAlign: "center" }} />
                          </label>
                          <button className="rm" style={{ marginLeft: "auto" }} onClick={() => removeOtherAccRow(row.id)}>remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ⑪ Accessories */}
              {project.length > 0 && (
                <div className="card">
                  <h2>
                    <span>⑪ Accessories</span>
                    <button className="clr" style={{ float: "right" }} onClick={addAccessoryRow}>+ add row</button>
                  </h2>
                  {accessoryRows.length === 0 ? (
                    <div className="empty">No accessory rows. Click &quot;+ add row&quot; to configure accessories for cabinets.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      {accessoryRows.map((row) => {
                        const applicable = getApplicableAccessories(row);
                        const totalM = getRowTotalMeters(row.cabinetIndices);
                        return (
                          <div key={row.id} style={{ border: "1px solid var(--line)", borderRadius: "5px", padding: "12px", background: "#fff" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                              <span style={{ fontSize: 12, fontWeight: 600 }}>Accessory Row #{row.id}</span>
                              <button className="rm" onClick={() => removeAccessoryRow(row.id)}>remove</button>
                            </div>
                            <div style={{ marginBottom: "10px" }}>
                              <label style={{ fontSize: 11, margin: "0 0 4px" }}>Select Cabinets</label>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                {project.map((l, i) => (
                                  <label key={i} style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                                    <input
                                      type="checkbox"
                                      checked={row.cabinetIndices.includes(i)}
                                      onChange={(e) => {
                                        updateAccessoryRow(row.id, (r) => ({
                                          ...r,
                                          cabinetIndices: e.target.checked
                                            ? [...r.cabinetIndices, i]
                                            : r.cabinetIndices.filter((idx) => idx !== i),
                                        }));
                                      }}
                                    />
                                    {l.m.code.split("-").slice(0, 3).join("-")}
                                  </label>
                                ))}
                              </div>
                              {row.cabinetIndices.length > 0 && (
                                <div style={{ fontSize: 10, color: "var(--accent)", marginTop: 4 }}>Total width: {getRowWidthMm(row.cabinetIndices)}mm = {totalM}m</div>
                              )}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                              {applicable.map((acc) => {
                                const entry = row.accessories[acc.key];
                                return (
                                  <div key={acc.key} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                                    <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: "4px", minWidth: "160px", cursor: "pointer" }}>
                                      <input
                                        type="checkbox"
                                        checked={entry.enabled}
                                        onChange={(e) => {
                                          updateAccessoryRow(row.id, (r) => {
                                            const updated = { ...r.accessories };
                                            if (e.target.checked && PROFILE_ACC_KEYS.includes(acc.key)) {
                                              PROFILE_ACC_KEYS.forEach((k) => { if (k !== acc.key) updated[k] = { ...updated[k], enabled: false }; });
                                            }
                                            updated[acc.key] = { ...updated[acc.key], enabled: e.target.checked };
                                            return { ...r, accessories: updated };
                                          });
                                        }}
                                      />
                                      {acc.label}
                                    </label>
                                    {entry.enabled && (
                                      <>
                                        <input type="text" placeholder="Size" value={entry.size} onChange={(e) => updateAccessoryRow(row.id, (r) => ({ ...r, accessories: { ...r.accessories, [acc.key]: { ...r.accessories[acc.key], size: e.target.value } } }))} style={{ width: "70px", fontSize: 11, padding: "3px 6px" }} />
                                        <input type="text" placeholder="Elevation" value={entry.elevation} onChange={(e) => updateAccessoryRow(row.id, (r) => ({ ...r, accessories: { ...r.accessories, [acc.key]: { ...r.accessories[acc.key], elevation: e.target.value } } }))} style={{ width: "80px", fontSize: 11, padding: "3px 6px" }} />
                                        <label style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: "4px", margin: 0 }}>
                                          Qty:
                                          <input type="number" step="0.01" value={entry.actualQty ?? totalM} onChange={(e) => updateAccessoryRow(row.id, (r) => ({ ...r, accessories: { ...r.accessories, [acc.key]: { ...r.accessories[acc.key], actualQty: parseFloat(e.target.value) || null } } }))} style={{ width: "60px", fontSize: 11, padding: "3px 6px", textAlign: "center" }} />
                                        </label>
                                        {/* Connector inputs for Skirting */}
                                        {acc.key === "skirting" && (
                                          <>
                                            <label style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: "4px", margin: 0 }}>
                                              Straight:
                                              <input type="number" min={0} value={entry.straightConnectors} onChange={(e) => updateAccessoryRow(row.id, (r) => ({ ...r, accessories: { ...r.accessories, [acc.key]: { ...r.accessories[acc.key], straightConnectors: parseInt(e.target.value) || 0 } } }))} style={{ width: "45px", fontSize: 11, padding: "3px 6px", textAlign: "center" }} />
                                            </label>
                                            <label style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: "4px", margin: 0 }}>
                                              L-conn:
                                              <input type="number" min={0} value={entry.lConnectors} onChange={(e) => updateAccessoryRow(row.id, (r) => ({ ...r, accessories: { ...r.accessories, [acc.key]: { ...r.accessories[acc.key], lConnectors: parseInt(e.target.value) || 0 } } }))} style={{ width: "45px", fontSize: 11, padding: "3px 6px", textAlign: "center" }} />
                                            </label>
                                          </>
                                        )}
                                        {/* Driver selection for all light profiles */}
                                        {PROFILE_ACC_KEYS.includes(acc.key) && (
                                          <label style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: "4px", margin: 0 }}>
                                            Driver:
                                            <select value={entry.driver} onChange={(e) => updateAccessoryRow(row.id, (r) => ({ ...r, accessories: { ...r.accessories, [acc.key]: { ...r.accessories[acc.key], driver: e.target.value } } }))} style={{ fontSize: 11, padding: "3px 4px" }}>
                                              <option value="">— select —</option>
                                              {DRIVER_OPTIONS.filter(Boolean).map((d) => (
                                                <option key={d} value={d}>{d.length > 40 ? d.slice(0, 40) + "…" : d}</option>
                                              ))}
                                            </select>
                                          </label>
                                        )}
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ⑫ Downloads */}
              {project.length > 0 && (
                <div className="card">
                  <h2>⑫ Downloads</h2>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "15px", flexWrap: "wrap" }}>
                    <label style={{ fontSize: 11, fontWeight: "bold", color: "var(--ink)" }}>Packing List/Labels Filter:</label>
                    <select
                      value={packingFilter}
                      onChange={(e) => setPackingFilter(e.target.value as any)}
                      style={{
                        padding: "4px 8px",
                        fontSize: 11,
                        borderRadius: 4,
                        border: "1px solid var(--line)",
                        background: "#fff",
                        color: "var(--ink)",
                        cursor: "pointer"
                      }}
                    >
                      <option value="both">Both (Carcass & Shutter)</option>
                      <option value="carcass">Carcass Only</option>
                      <option value="shutter">Shutter Only</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button className="addbtn" onClick={handleExcelDownload} style={{ fontSize: 11 }}>Excel BOM</button>
                    <button className="addbtn" onClick={handlePackingDownload} style={{ fontSize: 11 }}>Packing List (.xls)</button>
                    <button className="addbtn" onClick={handleLabelsDownload} style={{ fontSize: 11 }}>Labels (PDF)</button>
                    <button className="clr" onClick={downloadCsvFile}>CSV</button>
                    <button className="clr" onClick={copyCsvData}>{copiedCsv ? "copied" : "copy csv"}</button>
                  </div>
                </div>
              )}

              {/* ⑬ CSV Preview */}
              {project.length > 0 && (
                <div className="card">
                  <h2>⑬ CSV Preview <span style={{ color: "#8a8275", textTransform: "none" }}>raw · flat · per-cabinet</span></h2>
                  <textarea value={csvText} readOnly style={{ width: "100%", height: 160, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, border: "1px solid var(--line)", borderRadius: 5, padding: 10, background: "#fff", color: "var(--ink)", whiteSpace: "pre" }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <footer className="builder-footer">Base zone · v4 — single-unit BoM + multi-unit project consolidation. Project list is session-only.</footer>

      {isFinishModalOpen && (
        <div className="finish-modal-backdrop">
          <form className="finish-modal-content" onSubmit={handleSaveFinish}>
            <h3 className="finish-modal-title">Create New Finish</h3>
            
            <label style={{ margin: "0 0 5px" }}>Finish Name</label>
            <input 
              type="text" 
              placeholder="e.g. EMERALD GOLD" 
              value={newFinishName} 
              onChange={(e) => setNewFinishName(e.target.value)}
              disabled={isSavingFinish || finishSuccess}
              required
              autoFocus
            />

            <label style={{ margin: "13px 0 5px" }}>Thickness (mm)</label>
            <SearchableSelect
              value={newFinishThickness}
              onChange={setNewFinishThickness}
              options={thicknessOptions}
              disabled={isSavingFinish || finishSuccess}
              placeholder="Search thickness..."
            />

            {finishError && <div className="finish-modal-error">{finishError}</div>}
            {finishSuccess && <div className="finish-modal-success">✓ Saved & Selected!</div>}

            <div className="finish-modal-btn-row">
              <button 
                type="button" 
                className="finish-modal-btn cancel" 
                onClick={() => setIsFinishModalOpen(false)}
                disabled={isSavingFinish || finishSuccess}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="finish-modal-btn save"
                disabled={isSavingFinish || finishSuccess}
              >
                {isSavingFinish ? "Saving..." : "Save Finish"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Scoped CSS Styles to match the premium builder look without polluting dashboard styling */}
      <style dangerouslySetInnerHTML={{ __html: `
        /* Finish Creator Modal styling */
        .finish-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(28, 26, 23, 0.4);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: modalFadeIn 0.2s ease-out;
        }
        .finish-modal-content {
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(28,26,23,.15);
          width: 90%;
          max-width: 400px;
          padding: 24px;
          position: relative;
          animation: modalSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes modalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalSlideUp {
          from { transform: translateY(15px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .finish-modal-title {
          font-family: 'Fraunces', serif;
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 16px 0;
          color: var(--ink);
        }
        .finish-modal-btn-row {
          display: flex;
          gap: 10px;
          margin-top: 20px;
        }
        .finish-modal-btn {
          flex: 1;
          padding: 10px;
          border-radius: 4px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          cursor: pointer;
        }
        .finish-modal-btn.cancel {
          background: none;
          border: 1px solid var(--line);
          color: #8a8275;
        }
        .finish-modal-btn.save {
          background: var(--accent);
          color: #fff;
          border: none;
        }
        .finish-modal-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .finish-modal-error {
          font-size: 11px;
          color: #9b1c1c;
          background: #fde8e8;
          border: 1px solid #f8b4b4;
          padding: 8px;
          border-radius: 4px;
          margin-top: 10px;
          font-family: 'IBM Plex Mono', monospace;
        }
        .finish-modal-success {
          font-size: 12px;
          color: var(--good);
          background: #edf7ed;
          border: 1px solid #c3e6cb;
          padding: 10px;
          border-radius: 4px;
          margin-top: 10px;
          text-align: center;
          font-weight: bold;
        }
        
        /* Custom SearchableSelect dropdown styling */
        .searchable-select-container {
          position: relative;
          width: 100%;
        }
        .searchable-select-trigger {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 9px 10px;
          border: 1px solid var(--line);
          border-radius: 4px;
          background: #fff;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          color: var(--ink);
          cursor: pointer;
          user-select: none;
        }
        .searchable-select-trigger .arrow {
          font-size: 9px;
          color: #8a8275;
        }
        .searchable-select-dropdown {
          position: absolute;
          top: 105%;
          left: 0;
          right: 0;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 4px;
          box-shadow: 0 4px 12px rgba(28,26,23,.1);
          z-index: 100;
          display: flex;
          flex-direction: column;
          max-height: 250px;
          overflow: hidden;
        }
        .search-box-wrapper {
          padding: 6px;
          border-bottom: 1px solid var(--line2);
          background: var(--panel);
        }
        .search-box-wrapper .search-input {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid var(--line);
          border-radius: 3px;
          font-size: 12px;
          font-family: 'IBM Plex Mono', monospace;
        }
        .options-list {
          overflow-y: auto;
          max-height: 200px;
        }
        .option-item {
          padding: 8px 10px;
          cursor: pointer;
          font-size: 12px;
          font-family: 'IBM Plex Mono', monospace;
          border-bottom: 1px solid var(--line2);
          color: var(--ink);
          text-align: left;
        }
        .option-item:last-child {
          border-bottom: none;
        }
        .option-item:hover {
          background: var(--line2);
        }
        .option-item.selected {
          background: var(--accent2);
          color: #fff;
        }
        .no-options {
          padding: 12px;
          text-align: center;
          font-size: 12px;
          color: #8a8275;
          font-family: 'IBM Plex Mono', monospace;
        }
        .builder-container {
          --paper: #f4efe6;
          --ink: #1c1a17;
          --line: #cdc4b4;
          --line2: #e2dacb;
          --accent: #c8521e;
          --accent2: #1f5d6b;
          --good: #3a6b35;
          --warn: #9a6b1a;
          --purple: #7a4a8a;
          --panel: #fbf8f2;
          --shadow: 0 1px 0 #fff inset, 0 2px 14px rgba(28,26,23,.08);
          background: radial-gradient(circle at 1px 1px, rgba(28,26,23,.05) 1px, transparent 0) 0 0/22px 22px, var(--paper);
          color: var(--ink);
          font-family: 'Spline Sans', system-ui, sans-serif;
          line-height: 1.45;
          padding: 20px;
          min-height: 100vh;
        }
        .builder-header {
          border-bottom: 2px solid var(--ink);
          padding-bottom: 14px;
          margin-bottom: 20px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          flex-wrap: wrap;
          gap: 8px;
        }
        .builder-header h1 {
          font-family: 'Fraunces', serif;
          font-weight: 600;
          font-size: 26px;
          margin: 0;
        }
        .nav-header-link {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--accent2);
          text-decoration: underline;
          cursor: pointer;
        }
        .nav-header-link:hover {
          color: var(--accent);
        }
        .sub {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          letter-spacing: .14em;
          text-transform: uppercase;
          color: var(--accent2);
        }
        .tag {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          background: var(--ink);
          color: var(--paper);
          padding: 3px 8px;
          border-radius: 2px;
          letter-spacing: .1em;
        }
        .grid {
          display: grid;
          grid-template-columns: 330px 1fr;
          gap: 22px;
        }
        @media(max-width: 820px) {
          .grid { grid-template-columns: 1fr; }
        }
        .card {
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 6px;
          box-shadow: var(--shadow);
          padding: 18px;
          margin-bottom: 18px;
        }
        .card h2 {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          letter-spacing: .16em;
          text-transform: uppercase;
          color: var(--accent);
          margin: 0 0 14px;
          font-weight: 600;
        }
        label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          margin: 13px 0 5px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        label .hint {
          font-weight: 400;
          color: #8a8275;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
        }
        select, input {
          width: 100%;
          padding: 9px 10px;
          border: 1px solid var(--line);
          border-radius: 4px;
          background: #fff;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          color: var(--ink);
        }
        input:disabled {
          background: #efe9dd;
          color: #8a8275;
        }
        select:focus, input:focus {
          outline: 2px solid var(--accent2);
          border-color: var(--accent2);
        }
        .dims {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 8px;
        }
        .dimCustom {
          margin-top: 6px;
        }
        .lockbtn {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 3px;
          padding: 2px 7px;
          cursor: pointer;
          color: #8a8275;
        }
        .lockbtn.on {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
        }
        .codebox {
          background: var(--ink);
          color: var(--paper);
          border-radius: 6px;
          padding: 16px 18px;
          margin-bottom: 14px;
          position: relative;
          overflow: hidden;
        }
        .codebox .lbl {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          letter-spacing: .2em;
          text-transform: uppercase;
          color: #b9b09c;
          margin-bottom: 7px;
        }
        .code {
          font-family: 'IBM Plex Mono', monospace;
          font-size: clamp(13px, 3vw, 19px);
          font-weight: 500;
          word-break: break-all;
        }
        .code .s1 { color: #ff9d6e; }
        .code .s2 { color: #7fd1c4; }
        .code .s3 { color: #e7c46b; }
        .code .s4 { color: #9db8ff; }
        .code .s5 { color: #f1a0c0; }
        .code .sd { color: #cfe6a0; }
        .copy {
          position: absolute;
          top: 12px;
          right: 12px;
          background: var(--accent);
          color: #fff;
          border: none;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          letter-spacing: .1em;
          padding: 6px 10px;
          border-radius: 3px;
          cursor: pointer;
          text-transform: uppercase;
        }
        .addrow {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
          align-items: center;
        }
        .addrow input {
          width: 70px;
          text-align: center;
        }
        .addbtn {
          flex: 1;
          background: var(--accent2);
          color: #fff;
          border: none;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          letter-spacing: .08em;
          text-transform: uppercase;
          padding: 11px;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
        }
        .addbtn:active {
          transform: translateY(1px);
        }
        .meta {
          display: flex;
          gap: 18px;
          flex-wrap: wrap;
          font-size: 12px;
          margin-bottom: 14px;
          font-family: 'IBM Plex Mono', monospace;
        }
        .meta b {
          color: var(--accent2);
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12.5px;
        }
        thead th {
          text-align: left;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: #8a8275;
          border-bottom: 1.5px solid var(--ink);
          padding: 7px 8px;
          font-weight: 600;
        }
        tbody td {
          padding: 8px;
          border-bottom: 1px solid var(--line2);
          vertical-align: top;
        }
        tbody tr:hover {
          background: #fff;
        }
        .pk {
          font-weight: 500;
        }
        .grp {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9px;
          letter-spacing: .06em;
          text-transform: uppercase;
          color: #fff;
          padding: 2px 6px;
          border-radius: 10px;
          display: inline-block;
          margin-bottom: 3px;
        }
        .g-panel { background: var(--accent2); }
        .g-hard { background: #6b5b3a; }
        .g-cons { background: var(--good); }
        .g-prof { background: var(--purple); }
        .dim, .qty {
          font-family: 'IBM Plex Mono', monospace;
        }
        .qty {
          white-space: nowrap;
        }
        .tabs {
          display: flex;
          gap: 6px;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }
        .tab {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          letter-spacing: .06em;
          text-transform: uppercase;
          padding: 8px 13px;
          border: 1px solid var(--line);
          border-radius: 4px;
          background: #fff;
          cursor: pointer;
          color: #8a8275;
        }
        .tab.on {
          background: var(--ink);
          color: var(--paper);
          border-color: var(--ink);
        }
        .badge {
          background: var(--accent);
          color: #fff;
          border-radius: 10px;
          padding: 1px 7px;
          margin-left: 5px;
          font-size: 10px;
        }
        .rollup {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 12px;
        }
        .rc {
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 12px 14px;
        }
        .rc .rt {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9.5px;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: #8a8275;
          margin-bottom: 8px;
        }
        .rc .big {
          font-family: 'Fraunces', serif;
          font-size: 24px;
          font-weight: 600;
          line-height: 1;
        }
        .rc .small {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: #6a6256;
          margin-top: 5px;
        }
        .rc.stone { border-left: 3px solid var(--accent2); }
        .rc.prof { border-left: 3px solid var(--purple); }
        .rc.hard { border-left: 3px solid #6b5b3a; }
        .rc.cons { border-left: 3px solid var(--good); }
        .rc.ops { border-left: 3px solid var(--accent); }
        .tn {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11.5px;
          padding: 5px 0;
          border-bottom: 1px dashed var(--line2);
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }
        .tn .op { color: var(--accent); }
        .tn .pn { color: var(--accent2); }
        .tn .pr { color: var(--purple); }
        .lvl2 { padding-left: 18px; }
        .rm {
          background: none;
          border: 1px solid var(--line);
          border-radius: 3px;
          cursor: pointer;
          color: var(--accent);
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          padding: 2px 8px;
        }
        .empty {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          color: #8a8275;
          text-align: center;
          padding: 24px;
        }
        .clr {
          background: none;
          border: 1px solid var(--line);
          color: #8a8275;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: .08em;
          padding: 5px 10px;
          border-radius: 3px;
          cursor: pointer;
        }
        .assume {
          margin-top: 8px;
          font-size: 11.5px;
          color: #6a6256;
          background: #fff;
          border: 1px dashed var(--line);
          border-radius: 5px;
          padding: 12px 14px;
        }
        .assume b {
          color: var(--warn);
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          letter-spacing: .1em;
          text-transform: uppercase;
        }
        .assume ul {
          margin: 7px 0 0;
          padding-left: 18px;
        }
        .assume li {
          margin: 3px 0;
        }
        .builder-footer {
          margin-top: 20px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          color: #9a9384;
          text-align: center;
        }
      ` }} />
    </div>
  );
}
