"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHEET_SQFT = exports.DRAWER_DED = exports.SHUTTER_TYPES = exports.BOARDS = exports.ZONES = exports.famSetOf = void 0;
exports.buildModel = buildModel;
exports.buildRawRows = buildRawRows;
exports.buildCSV = buildCSV;
exports.buildFullBomData = buildFullBomData;
exports.buildBoardTotals = buildBoardTotals;
exports.defSizes = defSizes;
const shim_1 = require("./shim");
const exportBomWorkbook = null, exportBomCsv = null;
void exportBomWorkbook;
void exportBomCsv;
const DEFAULT_RATES = {}, CARCASS_RATE_KEY = {}, SHUTTER_RATE_KEY = {};
void DEFAULT_RATES;
"use client";
/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const SQDIV = 92903.04;
const SHEET_W = 2440;
const SHEET_H = 1220;
const SHEET_SQFT = (SHEET_W * SHEET_H) / SQDIV; // 32.03
exports.SHEET_SQFT = SHEET_SQFT;
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
const LAM_ADH = 25; // g/sqft/side
const PU_RATE = { epoxy: 15, primer: 30, top: 50 }; // g/sqft/side
const MEMB_OVER = 50; // mm per edge
const MEMB_ADH = null; // rate not yet supplied
const WASTE = { carcass: 10, shutter: 20, profile: 20 };
const ELEVATIONS = ["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "JJ", "KK"];
const DRAWER_MODELS = ["Lian", "Hettich", "Blum", "Hafele", "Grass"];
const sqft = (w, h) => (w * h) / SQDIV;
const perim = (w, h) => (2 * (w + h)) / 1000;
const r3 = (n) => Math.round(n * 1000) / 1000;
const legCount = (w) => (w <= 150 ? 2 : w >= 1050 ? 6 : 4);
const hingeN = (h) => (h <= 900 ? 3 : h <= 1600 ? 4 : h <= 2100 ? 5 : 6);
/* ------------------------------------------------------------------ */
/*  Boards & shutter types                                             */
/* ------------------------------------------------------------------ */
const BOARDS = {
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
exports.BOARDS = BOARDS;
const SHUTTER_TYPES = {
    PRELAM_HDHMR: { label: "Prelaminated — HDHMR (SF)", band: true, mat: "18MM PRELAMINATED HDHMR SF", t: 18, fam: "PRELAM", rate: "SHUTTER_PRELAM_HDHMR" },
    PRELAM_MDF: { label: "Prelaminated — MDF (SF)", band: true, mat: "18MM PRELAMINATED MDF SF", t: 18, fam: "PRELAM", rate: "SHUTTER_PRELAM_MDF" },
    PRELAM_PARTICAL: { label: "Prelaminated — Partical (SF)", band: true, mat: "18MM PRELAMINATED PARTICAL SF", t: 18, fam: "PRELAM", rate: "SHUTTER_PRELAM_PB" },
    POSTLAM_HDHMR: { label: "Postlam — HDHMR raw (SF)", band: true, mat: "18MM POSTLAM HDHMR RAW SF", t: 16, fam: "POSTLAM", rate: "SHUTTER_POSTLAM_PLY" },
    POSTLAM_MDF: { label: "Postlam — MDF raw (SF)", band: true, mat: "18MM POSTLAM MDF RAW SF", t: 16, fam: "POSTLAM", rate: "SHUTTER_POSTLAM_PLY" },
    POSTLAM_PARTICAL: { label: "Postlam — Partical raw (SF)", band: true, mat: "18MM POSTLAM PARTICAL RAW SF", t: 16, fam: "POSTLAM", rate: "SHUTTER_POSTLAM_PLY" },
    POSTLAM_BWP: { label: "Postlam — BWP Ply raw (SF)", band: true, mat: "18MM POSTLAM BWP PLY RAW SF", t: 16, fam: "POSTLAM", rate: "SHUTTER_POSTLAM_PLY" },
    MEMBRANE_HDHMR: { label: "Membrane one side — HDHMR OSR (HG)", band: false, mat: "18MM MEMBRANE ONE SIDE HDHMR OSR HG", t: 18, fam: "MEMBRANE", rate: "SHUTTER_MEMBRANE" },
    MEMBRANE_MDF: { label: "Membrane one side — MDF OSR (HG)", band: false, mat: "18MM MEMBRANE ONE SIDE MDF OSR HG", t: 18, fam: "MEMBRANE", rate: "SHUTTER_MEMBRANE" },
    PU1_HDHMR: { label: "PU one side — HDHMR OSR (HG)", band: false, mat: "18MM PU ONE SIDE HDHMR OSR HG", t: 18, fam: "PU1", rate: "SHUTTER_PU_SINGLE" },
    PU1_MDF: { label: "PU one side — MDF OSR (HG)", band: false, mat: "18MM PU ONE SIDE MDF OSR HG", t: 18, fam: "PU1", rate: "SHUTTER_PU_SINGLE" },
    PU2_HDHMR: { label: "PU both sides — HDHMR raw (HG)", band: false, mat: "18MM PU BOTH SIDE HDHMR RAW HG", t: 18, fam: "PU2", rate: "SHUTTER_PU_DOUBLE" },
    PU2_MDF: { label: "PU both sides — MDF raw (HG)", band: false, mat: "18MM PU BOTH SIDE MDF RAW HG", t: 18, fam: "PU2", rate: "SHUTTER_PU_DOUBLE" },
    GLASS: { label: "Glass", band: false, mat: "5mm Toughened Glass", t: 5, fam: "GLASS", rate: "" },
};
exports.SHUTTER_TYPES = SHUTTER_TYPES;
const DEFAULT_SHTYPE = "POSTLAM_BWP";
const shOf = (st) => SHUTTER_TYPES[st] ?? SHUTTER_TYPES[DEFAULT_SHTYPE];
const shFamOf = (st) => shOf(st).fam;
/** Only the glass branch keeps the stone frame machinery. */
const SH_INSET = { NEON20: 5, NEON50: 8 };
const SH_FRAME = { NEON20: 25, NEON50: 50 };
const NEON_LABEL = { NEON20: "Neon 20", NEON50: "Neon 50" };
const GLASS_T = 5;
const GLASS_SHELF_T = 8;
const GLASS_SHUTTER_FAMS = new Set(["WGL", "SHFG", "DPNG", "PPNG", "BLNG", "LOWSG", "LGL"]);
const isGlassShutterFam = (fk) => !!fk && GLASS_SHUTTER_FAMS.has(fk);
/* ------------------------------------------------------------------ */
/*  Catalog — families (ported from stone verbatim)                    */
/* ------------------------------------------------------------------ */
const V = (id, label, o = {}) => ({ id, label, ...o });
const BASE_FAMILIES = {
    DW: { name: "Base Drawer", p2: "DW", top: "panel", drawers: true,
        variants: [V("2dr", "2 Drawers", { p3: "XXX", p4: "2HB", side: "2HB" }),
            V("3dr", "3 Drawers", { p3: "2LB", p4: "1HB", side: "2LB+1HB" })] },
    HO: { name: "Base Hob", p2: "HO", top: "frame", drawers: true,
        variants: [V("2dr", "2 Drawers", { p3: "XXX", p4: "2HB", side: "2HB" }),
            V("3dr", "3 Drawers", { p3: "2LB", p4: "1HB", side: "2LB+1HB" })] },
    SK: { name: "Base Sink", p2: "SK", top: "frame",
        variants: [V("single", "Single bowl (handed)", { p3: "XXX", handed: true }),
            V("double", "Double bowl", { p3: "XXX", p4: "2HS", both: true })] },
    SH: { name: "Base Shutter", p2: "SH", top: "panel", shelf: 1,
        variants: [V("single", "Single door (handed)", { p3: "1SX", handed: true }),
            V("double", "Double door", { p3: "1SX", p4: "2HS", both: true })] },
    GD: { name: "Base Grain Drawer", p2: "GD", top: "panel", drawers: true,
        variants: [V("std", "Grain Drawer", { p3: "1BL", p4: "1HF", side: "1HB" })] },
    AP: { name: "Base Appliance (Oven)", p2: "AP", top: "panel", backStrips: true,
        variants: [V("ovn", "Oven", { p3: "OVN", p4: "1FP", side: "APP" })] },
    BPO: { name: "Base Bottle Pullout", p2: "AC", top: "panel",
        variants: [V("po", "Bottle Pullout (handed)", { p3: "BPO", handed: true })] },
    WBP: { name: "Base Waste Bin Pullout", p2: "AC", top: "panel",
        variants: [V("wb", "Waste Bin Pullout", { p3: "WBP", p4: "1HF", both: true })] },
};
const BLIND_FAMILIES = {
    LMC: { name: "LeMans Corner", p2: "AC", top: "panel",
        variants: [V("lmc", "LeMans (handed)", { p3: "LMC", handed: true, blind: true })] },
    BSH: { name: "Blind + Shelf", p2: "SH", top: "panel", shelf: 1,
        variants: [V("bsh", "Blind shelf (handed)", { p3: "1SX", handed: true, blind: true })] },
    PLB: { name: "Plain Blind", p2: "SH", top: "panel",
        variants: [V("plb", "Plain blind (handed)", { p3: "XXX", handed: true, blind: true })] },
};
const WALL_FAMILIES = {
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
const TALL_FAMILIES = {
    SHF: { name: "Tall Shelf (full shutter)", p2: "SH", bracket: "TCS", holes: "6H", shelf: 4,
        variants: [V("sgl", "Single door (handed)", { p3: "6SX", handed: true }),
            V("dbl", "Double door", { p3: "6SX", p4: "2HS", both: true })] },
    SHFG: { name: "Tall Shelf Glass (full shutter)", p2: "SH", bracket: "TCS", holes: "6H", shelf: 4, glassFam: true,
        variants: [V("sgl", "Single door (handed)", { p3: "6SG", handed: true }),
            V("dbl", "Double door", { p3: "6SG", p4: "2HS", both: true })] },
    APP: { name: "Tall Appliance + DW", p2: "AP", bracket: "TMO", holes: "4H", special: "APP", drawers: true,
        variants: [V("1dw", "+ 1 Drawer (handed)", { p4: "1HB", handed: true }),
            V("2dw", "+ 2 Drawers (handed)", { p4: "2HB", handed: true })] },
    PAN: { name: "Tall Tandem Pantry", p2: "AC", bracket: "TTP", holes: "6H",
        variants: [V("h", "Pantry (handed)", { p3: "1SX", p5: "TPT", handed: true })] },
    DPN: { name: "Tall Drawer Pantry", p2: "DW", bracket: "T3A", holes: "4H", drawers: true, fixedDpn: true,
        variants: [V("h", "Drawer pantry (handed)", { p3: "1SX", p5: "5BD", handed: true })] },
    DPNG: { name: "Tall Drawer Pantry Glass", p2: "DW", bracket: "T3A", holes: "4H", drawers: true, fixedDpn: true, glassFam: true,
        variants: [V("h", "Drawer pantry (handed)", { p3: "1SG", p5: "5BD", handed: true })] },
    PPN: { name: "Tall PO Shelf Pantry", p2: "PO", bracket: "TPO", holes: "6H",
        variants: [V("h", "Pullout pantry (handed)", { p3: "2SX", p5: "4PO", handed: true })] },
    PPNG: { name: "Tall PO Shelf Pantry Glass", p2: "PO", bracket: "TPO", holes: "6H", glassFam: true,
        variants: [V("h", "Pullout pantry (handed)", { p3: "2SG", p5: "4PO", handed: true })] },
    REF: { name: "Tall Refrigerator", p2: "REF", bracket: "TRC", holes: "3H", special: "REF",
        variants: [V("h", "Fridge (handed)", { p3: "1SX", handed: true })] },
};
const TALL_BLIND_FAMILIES = {
    BLND: { name: "Tall Blind Shelf", p2: "SH", bracket: "TBC", holes: "JD", shelf: 4,
        variants: [V("h", "Blind shelf (handed)", { p3: "6SX", handed: true })] },
    BLNG: { name: "Tall Blind Glass Shelf", p2: "SH", bracket: "TBC", holes: "JD", shelf: 4, glassFam: true,
        variants: [V("h", "Blind shelf (handed)", { p3: "6SG", handed: true })] },
};
const TALL_LOW_FAMILIES = {
    LOWS: { name: "Tall Shelf (Low)", p2: "SH", bracket: "TLD", holes: "6H", shelf: 4,
        variants: [V("h", "Shelf low (handed)", { p3: "6SX", handed: true })] },
    LOWSG: { name: "Tall Shelf Glass (Low)", p2: "SH", bracket: "TLD", holes: "6H", shelf: 4, glassFam: true,
        variants: [V("h", "Shelf low (handed)", { p3: "6SG", handed: true })] },
};
const LOFT_FAMILIES = {
    LST: { name: "Loft Solid Shutter", p2: "SH", shelf: 1,
        variants: [V("sgl", "Single door (handed)", { p3: "1SX", handed: true }),
            V("dbl", "Double door", { p3: "1SX", p4: "2HS", both: true })] },
    LGL: { name: "Loft Glass Shutter", p2: "SH", shelf: 1, glassFam: true,
        variants: [V("sgl", "Single door (handed)", { p3: "1SG", handed: true }),
            V("dbl", "Double door", { p3: "1SG", p4: "2HS", both: true })] },
};
const MD_FAMILIES = {
    MDR: { name: "Rolling Shutter", p2: "RS", noBottom: true, noShutter: true, special: "MD",
        variants: [V("rs", "Rolling shutter", { p3: "3SG", p4: "1SX", both: true })] },
};
const ZONES = {
    BC: { name: "Base", p1: "BC", mount: "legs", low: false, blind: false, fams: "base" },
    BCL: { name: "Base — Low Depth", p1: "BCL", mount: "legs", low: true, fams: "base" },
    BB: { name: "Base Blind", p1: "BB", mount: "legs", blind: true, fams: "blind" },
    BBL: { name: "Base Blind — Low Depth", p1: "BBL", mount: "legs", low: true, blind: true, fams: "blind" },
    WC: { name: "Wall", p1: "WC", mount: "wall", kind: "wall", fams: "wall" },
    WB: { name: "Wall Blind", p1: "WB", mount: "wall", kind: "wall", blind: true, fams: "wall" },
    TC: { name: "Tall", p1: "TC", mount: "legs", tall: true, fams: "tall" },
    TB: { name: "Tall Blind", p1: "TB", mount: "legs", tall: true, blind: true, fams: "tallblind" },
    TCL: { name: "Tall — Low Depth", p1: "TCL", mount: "legs", tall: true, low: true, fams: "talllow" },
    LO: { name: "Loft", p1: "LO", mount: "wall", kind: "loft", fams: "loft" },
    LB: { name: "Loft Blind", p1: "LB", mount: "wall", kind: "loft", blind: true, fams: "loft" },
    LBF: { name: "Loft Blind — Full Depth", p1: "LBF", mount: "wall", kind: "loft", blind: true, full: true, fams: "loft" },
    LOF: { name: "Loft — Full Depth", p1: "LOF", mount: "wall", kind: "loft", full: true, fams: "loft" },
    MD: { name: "Mid Rolling Shutter", p1: "MD", mount: "wall", kind: "md", fams: "md" },
};
exports.ZONES = ZONES;
const famSetOf = (z) => {
    if (z === "BCL")
        return { SH: BASE_FAMILIES.SH };
    if (z === "BB")
        return { LMC: BLIND_FAMILIES.LMC, BSH: BLIND_FAMILIES.BSH };
    if (z === "BBL")
        return { BSH: BLIND_FAMILIES.BSH };
    if (z === "WB")
        return { WGL: WALL_FAMILIES.WGL, WST: WALL_FAMILIES.WST };
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
exports.famSetOf = famSetOf;
/* ------------------------------------------------------------------ */
/*  Standard widths — the wood table                                   */
/* ------------------------------------------------------------------ */
const WIDTHS = {
    DW: [450, 600, 800, 900, 1000],
    HO: [600, 750, 800, 900],
    GD: [450, 500, 550, 600],
    AP: [600],
    SH: [400, 450, 500, 550, 600, 800, 850, 900, 950, 1000],
    SK: [500, 600, 900, 1000, 1050, 1100, 1150, 1200],
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
function defSizes(zoneKey, fk) {
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
function shDeduct(isBase, handle, loc) {
    if (!isBase)
        return 3;
    if (handle === "XCJ")
        return loc === "ML" ? 3 : 33;
    return 3;
}
/** Shelf material is derived from the shutter type, not the zone. */
function shelfMaterialOf(fk, board) {
    if (isGlassShutterFam(fk))
        return { mat: `${GLASS_SHELF_T}mm Toughened Glass`, t: GLASS_SHELF_T, band: false };
    return { mat: BOARDS[board].core, t: T, band: true };
}
function shelfCount(zk, fk, fam, H) {
    const z = ZONES[zk];
    if (z.kind === "wall") {
        if (fk === "WDR")
            return H >= 1085 ? 2 : 0;
        if (fk === "WOP" || fk === "WGL" || fk === "WST")
            return H >= 1085 ? 3 : 1;
        return 0;
    }
    return fam.shelf ?? 0;
}
function shutSpec(zk, fk, v) {
    const fam = famSetOf(zk)[fk];
    if (fam?.noShutter)
        return { leaves: 0 };
    const leaves = v.both || v.double ? 2 : 1;
    return { leaves };
}
/**
 * Per-model panel deductions.
 *
 *   Bottom panel = (W − botWded) × (D − botDded)
 *   Back panel   = (W − backWded) × backH
 *
 * Wood offers two height classes only. Stone's Semi-High is not used.
 */
const DRAWER_DED = {
    Hettich: {
        LOW: { line: "INNOTECH / ATIRA", code: "H70", backH: 68, botWded: 108, botDded: 80, backWded: 120, botT: 16, backT: 16 },
        HIGH: { line: "INNOTECH / ATIRA", code: "H144", backH: 144, botWded: 108, botDded: 80, backWded: 120, botT: 16, backT: 16 },
    },
    Blum: {
        LOW: { line: "ANTARO", code: "H69", backH: 69, botWded: 111, botDded: 69, backWded: 123, botT: 16, backT: 16 },
        HIGH: { line: "ANTARO", code: "H183", backH: 183, botWded: 111, botDded: 69, backWded: 123, botT: 16, backT: 16 },
    },
    Hafele: {
        LOW: { line: "MATRIX", code: "H69", backH: 69, botWded: 111, botDded: 69, backWded: 123, botT: 16, backT: 16 },
        HIGH: { line: "MATRIX", code: "H164", backH: 164, botWded: 111, botDded: 69, backWded: 123, botT: 16, backT: 16 },
    },
    Grass: {
        LOW: { line: "DWD", code: "H68", backH: 68, botWded: 111, botDded: 69, backWded: 111, botT: 16, backT: 16 },
        HIGH: { line: "DWD", code: "H164", backH: 164, botWded: 111, botDded: 69, backWded: 111, botT: 16, backT: 16 },
    },
    // Lian: not supplied — the returned sheet still held the template example row.
};
exports.DRAWER_DED = DRAWER_DED;
/** Material for the bottom/back was not specified; BWP ply is assumed. */
const DRAWER_PANEL_MAT = (t) => `${t}mm BWP Plywood`;
/**
 * Drawer height mix per variant.
 *   2dr / 2dw  → 2 High
 *   3dr        → 2 Low + 1 High
 *   fixed_dpn  → 2 Low + 3 High   (stone had 2 Low + 3 Semi-High; wood has no
 *                                  Semi-High, so those three go High)
 */
function drawerBreakdown(fam, v) {
    if (fam.fixedDpn)
        return [{ cls: "LOW", n: 2 }, { cls: "HIGH", n: 3 }];
    if (/^3dr$/.test(v.id))
        return [{ cls: "LOW", n: 2 }, { cls: "HIGH", n: 1 }];
    if (/^(2dr|2dw)$/.test(v.id))
        return [{ cls: "HIGH", n: 2 }];
    return [{ cls: "HIGH", n: 1 }];
}
function addDrawerBoxes(fk, v, W, D, drawerModel, panels, hardware, pkRows, stubs) {
    const fam = famSetOf(zoneOfFam(fk))[fk];
    if (!fam?.drawers)
        return;
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
        stubs.push(`${drawerModel} deductions not supplied — bottom and back panels withheld for all ` +
            `${total} drawer${total > 1 ? "s" : ""}. The box set is still costed.`);
        return;
    }
    mix.forEach(({ cls, n }) => {
        const d = table[cls];
        if (!d) {
            stubs.push(`${drawerModel} has no "${cls}" row — ` +
                `${n} drawer${n > 1 ? "s" : ""} on this cabinet have no bottom or back panel.`);
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
function zoneOfFam(fk) {
    for (const zk of Object.keys(ZONES))
        if (famSetOf(zk)[fk])
            return zk;
    return "BC";
}
/* ------------------------------------------------------------------ */
/*  Shutters                                                           */
/* ------------------------------------------------------------------ */
function buildShutters(zk, fk, v, handle, shType, neon, W, H, panels, profiles, hardware, pkRows, stubs) {
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
            stubs.push(`${n} drawer fronts not emitted — front heights per drawer class have not been ` +
                `supplied. Stone sized these from its 360/180 front slots.`);
            return { leaves: 0, leafW: 0, leafH: 0 };
        }
    }
    const { leaves } = shutSpec(zk, fk, v);
    if (!leaves)
        return { leaves: 0, leafW: 0, leafH: 0 };
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
    }
    else {
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
function mergeCarcassPanels(panels) {
    const out = [];
    const key = (p) => [p.pack, p.name.replace(/\b(LH|RH)\b/g, "").trim(), p.w, p.h, p.t, p.mat, p.band].join("|");
    const map = new Map();
    panels.forEach((p) => {
        const k = key(p);
        const hit = map.get(k);
        if (hit) {
            hit.qty += p.qty;
            if (hit.drill && p.drill && hit.drill !== p.drill)
                hit.drill = "LH/RH";
        }
        else {
            const c = { ...p };
            map.set(k, c);
            out.push(c);
        }
    });
    return out;
}
function explodePanelForTree(p, finish) {
    const area = sqft(p.w, p.h) * p.qty;
    const out = [];
    out.push({ level: 2, name: (0, shim_1.getPanelBaseName)(p.name, p.drill, finish), qty: p.qty, uom: "nos" });
    out.push({ level: 3, name: (0, shim_1.getPartBaseName)(p.name, p.drill, finish), qty: p.qty, uom: "nos" });
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
function buildCarcassInnerRaw(cfg) {
    const { zk, fk, v, hand, handle, board, shType, neon, W, H, D, drawerModel } = cfg;
    const z = ZONES[zk];
    const fam = famSetOf(zk)[fk];
    const B = BOARDS[board];
    const panels = [];
    const profiles = [];
    const hardware = [];
    const cons = [];
    const pkRows = [];
    const stubs = [];
    const carc = B.core;
    const PK = "Carcass Pack";
    const add = (name, w, h, qty, t, mat, band, drill = null) => panels.push({ name, w: Math.round(w), h: Math.round(h), qty, drill, pack: PK, t, mat, band });
    /* --- sides run full height; top and bottom sit between them --- */
    add(`Panels- CR Side ${T}mm ${D}x${H}`, D, H, 2, T, carc, true, hand === "LHS" ? "LH" : "RH");
    const topD = handle === "XCJ" ? D - CJ_CUT : D;
    add(`Panels- CR Top ${T}mm ${W - 2 * T}x${topD}`, W - 2 * T, topD, 1, T, carc, true);
    if (!fam.noBottom)
        add(`Panels- CR Bottom ${T}mm ${W - 2 * T}x${D}`, W - 2 * T, D, 1, T, carc, true);
    /* --- back: grooved, +9 allowance, never banded --- */
    const bw = W - 2 * T + GROOVE;
    const bh = H - 2 * T + GROOVE;
    if (fam.special === "MD") {
        stubs.push("MD back panel height — parked at the construction stage. With no bottom panel the back is grooved on three edges only, so the +9 allowance does not apply symmetrically.");
    }
    else if (fam.backStrips) {
        add(`Panels- CR Back Strip ${T_BACK}mm ${bw}x75`, bw, 75, 2, T_BACK, B.back, false);
    }
    else {
        if (fam.special === "REF")
            stubs.push("REF short back wall — stone uses H − 1874 to clear the fridge recess. Wood equivalent not yet defined; a full-height back is emitted meanwhile.");
        if (fam.special === "APP")
            stubs.push("APP twin back walls — stone splits upper/lower at H − 1349. Wood equivalent not yet defined; a single back is emitted meanwhile.");
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
        add(`Panels- CR Shelf ${sm.t}mm ${W - 2 * T - SHELF_W_CLR}x${D - SHELF_D_OFF}`, W - 2 * T - SHELF_W_CLR, D - SHELF_D_OFF, nsh, sm.t, sm.mat, sm.band);
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
            }
            else {
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
function buildModel(cfg) {
    const fam = famSetOf(cfg.zk)[cfg.fk];
    const v = fam.variants.find((x) => x.id === cfg.vid) ?? fam.variants[0];
    const built = buildCarcassInnerRaw({ ...cfg, v });
    /* Cabinet code — stone contract, 11 fields + optional finish suffix:
       p1-p2-handleToken(CJ|STD)-matToken(GL|WD)-p3-p4-p5-W-H-D-t[-FINISH]
       Hand rides in p4 or p5 as in stone; wall p3 leading digit is rewritten
       from the live shelf count. */
    const handleToken = cfg.handle === "XCJ" ? "CJ" : "STD";
    const matToken = isGlassShutterFam(cfg.fk) ? "GL" : "WD";
    const handTok = v.handed ? cfg.hand : "";
    let p3 = v.p3 ?? "1SX";
    if (ZONES[cfg.zk].kind === "wall" && /^\d/.test(p3)) {
        p3 = String(shelfCount(cfg.zk, cfg.fk, fam, cfg.H)) + p3.slice(1);
    }
    const p4 = v.p4 || handTok || "XXX";
    const p5 = v.p5 || (v.p4 && handTok ? handTok : "XXX");
    const code = [ZONES[cfg.zk].p1, fam.p2, handleToken, matToken, p3, p4, p5, cfg.W, cfg.H, cfg.D, T].join("-") +
        (cfg.finish ? "-" + cfg.finish.toUpperCase() : "");
    return { code, ...cfg, vid: v.id, ...built };
}
/* ------------------------------------------------------------------ */
/*  Raw rows / CSV — same output contract as stone                     */
/* ------------------------------------------------------------------ */
function buildRawRows(m) {
    const rows = [];
    m.panels.forEach((p) => rows.push({ item: (0, shim_1.normalizePartOrPanelName)(p.name), pack: p.pack, uom: "nos", qty: p.qty }));
    m.profiles.forEach((p) => rows.push({ item: `${p.name} ${p.len}MM`, pack: p.pack, uom: "nos", qty: p.qty }));
    m.hardware.forEach((h) => rows.push({ item: h.name, pack: h.pack ?? "Hardware Pack", uom: h.uom ?? "nos", qty: h.qty }));
    m.cons.forEach((c) => rows.push({ item: c.name, pack: c.pack, uom: c.uom, qty: c.qty }));
    return rows;
}
function buildCSV(project) {
    const order = [];
    const map = new Map();
    project.forEach((l) => {
        const code = l.m.code;
        buildRawRows(l.m).forEach((r) => {
            const key = code + "||" + r.item + "||" + r.pack + "||" + r.uom;
            if (!map.has(key)) {
                map.set(key, { code, item: r.item, pack: r.pack, uom: r.uom, qty: 0 });
                order.push(key);
            }
            map.get(key).qty += r.qty * l.qty;
        });
    });
    const esc = (s) => {
        const str = String(s ?? "");
        return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    };
    let csv = "SN,Item Name,Pack Name,Cabinet Code,UoM,Qty\n";
    order.forEach((k, i) => {
        const r = map.get(k);
        const q = Number.isInteger(r.qty) ? r.qty : +r.qty.toFixed(3);
        csv += [i + 1, esc(r.item), esc(r.pack), esc(r.code), r.uom, q].join(",") + "\n";
    });
    return csv;
}
function wasteFor(pack, uom, wst = WASTE) {
    if (uom === "mtr" || uom === "RMT")
        return wst.profile;
    return pack === "Shutter Pack" ? wst.shutter : wst.carcass;
}
function makeRow(o) {
    return {
        SO: "", Elevation: "", "Main Group": "", "Sub Group": "", Level: 0, Item: "", SKU: "",
        Type: "", Height: "", Width: "", Depth: "", Thickness: "", Finish: "", Grain: "",
        "CF Type": "", "Profile Code": "", "SO Qty": 0, "Waste %": 0, "Actual Qty": 0, Pcs: "",
        "In Stock": 0, "Eff. Stock": 0, Deficit: 0, Unit: "nos", Status: "unknown",
        _type: String(o.Type ?? "plain"), ...o,
    };
}
function buildFullBomData(project, so, finish, wst = WASTE) {
    const rows = [];
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
function buildBoardTotals(project, wst = WASTE, extraPanels = []) {
    const map = new Map();
    const fold = (p, mult) => {
        const mat = p.mat ?? "Board";
        const k = `${mat}|${p.t}|${p.pack}`;
        if (!map.has(k)) {
            map.set(k, { mat, t: p.t ?? T, pack: p.pack, sqft: 0, waste: wasteFor(p.pack, "sqft", wst), sheets: 0 });
        }
        map.get(k).sqft += sqft(p.w, p.h) * p.qty * mult;
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
const FILLER_ZONES = ["base", "tall", "wall", "loft", "mid"];
const FILLER_ZKS = {
    base: ["BC", "BCL", "BB", "BBL"], tall: ["TC", "TB", "TCL"], wall: ["WC", "WB"],
    loft: ["LO", "LB", "LBF", "LOF"], mid: ["MD"],
};
/** Stone's height presets survive as fallbacks when no matching line exists. */
const FILLER_PRESETS = {
    base: [717], wall: [1082, 717], tall: [2037, 2397], loft: [597], mid: [1647, 1287],
};
const FILLER_DEF_W = 80;
/** Wood VP width = carcass depth + 20 (stone used +25). */
const VP_DEPTH_ADD = 20;
function zoneLine(zone, project) {
    return project.find((l) => (FILLER_ZKS[zone] ?? []).includes(l.m.zk));
}
/** Default filler/VP height: the zone's shutter height (line H − 3mm gap), else preset. */
function defFillerH(zone, project) {
    const l = zoneLine(zone, project);
    return l ? l.m.H - 3 : FILLER_PRESETS[zone]?.[0] ?? 717;
}
function defZoneDepth(zone, project) {
    const l = zoneLine(zone, project);
    return l ? l.m.D : zone === "base" || zone === "tall" ? 560 : 336;
}
/** A filler or visible panel resolves to one banded shutter-type panel. */
function extraPanelOf(kind, zone, H, W, q, shTypeKey) {
    const S = shOf(shTypeKey);
    return {
        name: `Panels- SH ${kind} ${S.t}mm ${W}x${H}`,
        w: W, h: H, qty: q, drill: null, pack: "Shutter Pack",
        t: S.t, mat: S.mat, band: S.band,
    };
}
function buildExtrasBom(fillers, visiblePanels, countertops, project, so, globalShType, globalFinish, wst) {
    const rows = [];
    const panels = [];
    const emit = (kind, r, shTypeKey) => {
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
        for (let i = start; i < rows.length; i++)
            rows[i].Elevation = r.elevation || "";
    };
    fillers.forEach((f) => emit("Filler", f, globalShType));
    visiblePanels.forEach((vp) => emit("Visible", vp, vp.shutterType || globalShType));
    countertops.forEach((c) => {
        const L = parseFloat(c.length) || 0;
        const D = parseFloat(c.depth) || 600;
        const Tt = parseFloat(c.thickness) || 30;
        if (!L)
            return;
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
const ACC_LABEL = {
    skirting: "PVC Skirting Profile",
    elenor: "Elenor with Light",
};
const DRIVER_OPTIONS = ["", "DRIVER 12V 2A 24W", "DRIVER 12V 5A 60W"];
const ELENOR_WASTE = 0.10;
const SKIRT_WASTE = 0.10;
/** Default skirting run: sum of leg-mounted project line widths, metres. */
function defSkirtMeters(project) {
    const mm = project.reduce((a, l) => a + (ZONES[l.m.zk].mount === "legs" ? l.m.W * l.qty : 0), 0);
    return r3(mm / 1000);
}
function buildAccessoryRows(accs, project, so) {
    const out = [];
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
            if (a.straight > 0)
                out.push({
                    SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL.skirting, Selected: "yes",
                    "Item Name": "SKIRTING STRAIGHT CONNECTOR", Size: "", Elevation: a.elevation,
                    Total: a.straight, "Actual Qty": a.straight, "Zoho Item ID": "",
                });
            if (a.lconn > 0)
                out.push({
                    SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL.skirting, Selected: "yes",
                    "Item Name": "SKIRTING L CONNECTOR", Size: "", Elevation: a.elevation,
                    Total: a.lconn, "Actual Qty": a.lconn, "Zoho Item ID": "",
                });
        }
        else {
            const H = parseFloat(a.size) || 720;
            const q = a.qty || 1;
            const lenWaste = Math.ceil(H * (1 + ELENOR_WASTE));
            const rowsDef = [
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
            if (a.driver)
                out.push({
                    SO: so, "Carcass Items": carcass, Accessory: ACC_LABEL.elenor, Selected: "yes",
                    "Item Name": a.driver, Size: "", Elevation: a.elevation,
                    Total: 1 * q, "Actual Qty": 1 * q, "Zoho Item ID": "",
                });
        }
    });
    return out;
}
/**
 * Per the costing sheet: carcass sqft × board rate, shutter sqft × shutter-type
 * rate (each after its wastage %), edge band per RMT. Drawer boxes, hinges and
 * accessories are priced only once their rates are set on /admin — until then
 * they are listed as unpriced rather than silently costed at zero.
 */
function computeCosting(project, fillers, visiblePanels, extrasPanels, globalShType, rates, wst) {
    const lines = [];
    const unpriced = new Set();
    // Each sheet row names its own costing key. Postlam rows share the single
    // postlam-ply rate, which is all the costing sheet prices.
    const shutterRate = (st) => {
        const key = shOf(st).rate;
        return key ? (rates[key] ?? 0) : 0;
    };
    project.forEach((l) => {
        const m = l.m;
        const cRate = rates[CARCASS_RATE_KEY[m.board] ?? "CARCASS_POSTLAM_PLY"];
        const st = isGlassShutterFam(m.fk) ? "GLASS" : m.shType;
        const sRate = shutterRate(st);
        let cost = 0;
        m.panels.forEach((p) => {
            const a = sqft(p.w, p.h) * p.qty;
            if (p.pack === "Shutter Pack") {
                if (st === "GLASS") {
                    unpriced.add("Glass shutters");
                    return;
                }
                cost += a * (1 + wst.shutter / 100) * sRate;
            }
            else {
                // Carcass and drawer panels are cut from the carcass board.
                cost += a * (1 + wst.carcass / 100) * cRate;
            }
        });
        const bandM = m.panels.reduce((s, p) => s + (p.band ? perim(p.w, p.h) * p.qty : 0), 0);
        cost += bandM * (1 + wst.carcass / 100) * rates.EDGEBAND_PER_RMT;
        m.hardware.forEach((h) => {
            if (/^HINGE$/i.test(h.name)) {
                if (rates.HINGE > 0)
                    cost += h.qty * rates.HINGE;
                else
                    unpriced.add("Hinges");
            }
            if (/^DRAWER BOX SET/i.test(h.name)) {
                if (rates.DRAWER_HB > 0)
                    cost += h.qty * rates.DRAWER_HB;
                else
                    unpriced.add("Drawer box sets (LB/HB)");
            }
        });
        lines.push({ label: `${l.elevation} · ${m.code}`, qty: l.qty, cost: cost * l.qty });
    });
    // Fillers & visible panels — shutter-type panels, costed at the shutter rate.
    const extraRows = [...fillers.map(() => globalShType), ...visiblePanels.map((v) => v.shutterType || globalShType)];
    extrasPanels.forEach((p, i) => {
        const st = extraRows[i];
        if (st === undefined)
            return; // countertops emit no panels
        const rate = shutterRate(st);
        let cost = sqft(p.w, p.h) * p.qty * (1 + wst.shutter / 100) * rate;
        if (p.band)
            cost += perim(p.w, p.h) * p.qty * (1 + wst.carcass / 100) * rates.EDGEBAND_PER_RMT;
        lines.push({ label: `${p.name}`, qty: p.qty, cost });
    });
    return { lines, total: lines.reduce((a, x) => a + x.cost, 0), unpriced: [...unpriced] };
}
/* --- Full BOM → BomReportRow, so export.ts (xlsx) can consume it --- */
function toReportRows(rows) {
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
        status: (["in-stock", "low-stock", "out-of-stock"].includes(r.Status) ? r.Status : "unknown"),
        rowType: (r._type === "master" || r._type === "sub_bom" || r._type === "component" ? r._type : "plain"),
        typeLabel: r.Level === 0 ? "ITEM" : r._type === "sub_bom" ? "SUB-BOM" : "COMPONENT",
        underProfile: false,
    }));
}
