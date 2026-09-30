import React, { useState, useMemo } from "react";

/* ============================================================
   Magppie — Wood Kitchen BOM Builder
   Ported from the Stone Carcass BOM Builder.
   Catalog (zones, families, variants) is the stone catalog verbatim.
   Construction logic is the wood spec agreed in planning.
   ============================================================ */

const SQDIV = 92903.04;
const SHEET_W = 2440, SHEET_H = 1220;
const SHEET_SQFT = (SHEET_W * SHEET_H) / SQDIV;      // 32.03
const T = 18;          // carcass nominal
const T_BACK = 8;      // back nominal
const GROOVE = 9;      // back groove allowance
const CJ_CUT = 23;     // gola top-depth cut
const SHELF_W_CLR = 1;
const SHELF_D_OFF = 28;
const LAM_ADH = 25;    // g/sqft/side
const PU = { epoxy: 15, primer: 30, top: 50 };  // g/sqft/side
const MEMB_OVER = 50;  // mm per edge
const WASTE = { carcass: 10, shutter: 20, profile: 20 };

const sqft = (w, h) => (w * h) / SQDIV;
const perim = (w, h) => (2 * (w + h)) / 1000;
const r3 = (n) => Math.round(n * 1000) / 1000;

/* ---------------- Zones ---------------- */
const ZONES = {
  BC:  { name: "Base",                    mount: "legs", fams: "base" },
  BCL: { name: "Base — Low Depth",        mount: "legs", low: true, fams: "base" },
  BB:  { name: "Base Blind",              mount: "legs", blind: true, fams: "blind" },
  BBL: { name: "Base Blind — Low Depth",  mount: "legs", low: true, blind: true, fams: "blind" },
  WC:  { name: "Wall",                    mount: "wall", kind: "wall", fams: "wall" },
  WB:  { name: "Wall Blind",              mount: "wall", kind: "wall", blind: true, fams: "wall" },
  TC:  { name: "Tall",                    mount: "legs", tall: true, fams: "tall" },
  TB:  { name: "Tall Blind",              mount: "legs", tall: true, blind: true, fams: "tallblind" },
  TCL: { name: "Tall — Low Depth",        mount: "legs", tall: true, low: true, fams: "talllow" },
  LO:  { name: "Loft",                    mount: "wall", kind: "loft", fams: "loft" },
  LB:  { name: "Loft Blind",              mount: "wall", kind: "loft", blind: true, fams: "loft" },
  LBF: { name: "Loft Blind — Full Depth", mount: "wall", kind: "loft", blind: true, full: true, fams: "loft" },
  LOF: { name: "Loft — Full Depth",       mount: "wall", kind: "loft", full: true, fams: "loft" },
  MD:  { name: "Mid Rolling Shutter",     mount: "wall", kind: "md", fams: "md" },
};

/* ---------------- Families ---------------- */
const V = (id, label, o = {}) => ({ id, label, ...o });

const BASE_FAMILIES = {
  DW:  { name: "Base Drawer", p2: "DW", drawers: "2HB", variants: [V("2dr", "2 Drawers", { p3: "XXX", p4: "2HB" }), V("3dr", "3 Drawers", { p3: "2LB", p4: "1HB" })] },
  HO:  { name: "Base Hob", p2: "HO", top: "frame", drawers: "2HB", variants: [V("2dr", "2 Drawers", { p3: "XXX", p4: "2HB" }), V("3dr", "3 Drawers", { p3: "2LB", p4: "1HB" })] },
  SK:  { name: "Base Sink", p2: "SK", top: "frame", variants: [V("single", "Single bowl (handed)", { p3: "XXX", handed: true }), V("double", "Double bowl", { p3: "XXX", p4: "2HS", both: true })] },
  SH:  { name: "Base Shutter", p2: "SH", shelf: 1, variants: [V("single", "Single door (handed)", { p3: "1SX", handed: true }), V("double", "Double door", { p3: "1SX", p4: "2HS", both: true })] },
  GD:  { name: "Base Grain Drawer", p2: "GD", variants: [V("std", "Grain Drawer", { p3: "1BL", p4: "1HF" })] },
  AP:  { name: "Base Appliance (Oven)", p2: "AP", backStrips: true, variants: [V("ovn", "Oven", { p3: "OVN", p4: "1FP" })] },
  BPO: { name: "Base Bottle Pullout", p2: "AC", variants: [V("po", "Bottle Pullout (handed)", { p3: "BPO", handed: true })] },
  WBP: { name: "Base Waste Bin Pullout", p2: "AC", variants: [V("wb", "Waste Bin Pullout", { p3: "WBP", p4: "1HF", both: true })] },
};
const BLIND_FAMILIES = {
  LMC: { name: "LeMans Corner", p2: "AC", variants: [V("lmc", "LeMans (handed)", { p3: "LMC", handed: true })] },
  BSH: { name: "Blind + Shelf", p2: "SH", shelf: 1, variants: [V("bsh", "Blind shelf (handed)", { p3: "1SX", handed: true })] },
  PLB: { name: "Plain Blind", p2: "SH", variants: [V("plb", "Plain blind (handed)", { p3: "XXX", handed: true })] },
};
const WALL_FAMILIES = {
  WGL: { name: "Wall Glass Shutter", p2: "SH", glassFam: true, variants: [V("sgl", "Single door (handed)", { p3: "3SG", handed: true }), V("dbl", "Double door", { p3: "3SG", p4: "2HS", both: true })] },
  WST: { name: "Wall Solid Shutter", p2: "SH", variants: [V("sgl", "Single door (handed)", { p3: "1SG", handed: true }), V("dbl", "Double door", { p3: "1SG", p4: "2HS", both: true })] },
  WOP: { name: "Wall Open Shelf", p2: "OP", noShutter: true, variants: [V("op", "Open (no door)", { p3: "3SG", p4: "XXX" })] },
  WDR: { name: "Wall Dish Rack", p2: "AC", noBottom: true, variants: [V("sgl", "Single door (handed)", { p3: "2SG", handed: true }), V("dbl", "Double door", { p3: "2SG", p4: "2HS", both: true })] },
};
const TALL_FAMILIES = {
  SHF:  { name: "Tall Shelf (full shutter)", p2: "SH", shelf: 4, variants: [V("sgl", "Single door (handed)", { p3: "6SX", handed: true }), V("dbl", "Double door", { p3: "6SX", p4: "2HS", both: true })] },
  SHFG: { name: "Tall Shelf Glass (full shutter)", p2: "SH", shelf: 4, glassFam: true, variants: [V("sgl", "Single door (handed)", { p3: "6SG", handed: true }), V("dbl", "Double door", { p3: "6SG", p4: "2HS", both: true })] },
  APP:  { name: "Tall Appliance + DW", p2: "AP", special: "APP", variants: [V("1dw", "+ 1 Drawer (handed)", { p4: "1HB", handed: true }), V("2dw", "+ 2 Drawers (handed)", { p4: "2HB", handed: true })] },
  PAN:  { name: "Tall Tandem Pantry", p2: "AC", variants: [V("h", "Pantry (handed)", { p3: "1SX", handed: true })] },
  DPN:  { name: "Tall Drawer Pantry", p2: "DW", variants: [V("h", "Drawer pantry (handed)", { p3: "1SX", handed: true })] },
  DPNG: { name: "Tall Drawer Pantry Glass", p2: "DW", glassFam: true, variants: [V("h", "Drawer pantry (handed)", { p3: "1SG", handed: true })] },
  PPN:  { name: "Tall PO Shelf Pantry", p2: "PO", variants: [V("h", "Pullout pantry (handed)", { p3: "2SX", handed: true })] },
  PPNG: { name: "Tall PO Shelf Pantry Glass", p2: "PO", glassFam: true, variants: [V("h", "Pullout pantry (handed)", { p3: "2SG", handed: true })] },
  REF:  { name: "Tall Refrigerator", p2: "REF", special: "REF", variants: [V("h", "Fridge (handed)", { p3: "1SX", handed: true })] },
};
const TALL_BLIND_FAMILIES = {
  BLND: { name: "Tall Blind Shelf", p2: "SH", shelf: 4, variants: [V("h", "Blind shelf (handed)", { p3: "6SX", handed: true })] },
  BLNG: { name: "Tall Blind Glass Shelf", p2: "SH", shelf: 4, glassFam: true, variants: [V("h", "Blind shelf (handed)", { p3: "6SG", handed: true })] },
};
const TALL_LOW_FAMILIES = {
  LOWS:  { name: "Tall Shelf (Low)", p2: "SH", shelf: 4, variants: [V("h", "Shelf low (handed)", { p3: "6SX", handed: true })] },
  LOWSG: { name: "Tall Shelf Glass (Low)", p2: "SH", shelf: 4, glassFam: true, variants: [V("h", "Shelf low (handed)", { p3: "6SG", handed: true })] },
};
const LOFT_FAMILIES = {
  LST: { name: "Loft Solid Shutter", p2: "SH", shelf: 1, variants: [V("sgl", "Single door (handed)", { p3: "1SX", handed: true }), V("dbl", "Double door", { p3: "1SX", p4: "2HS", both: true })] },
  LGL: { name: "Loft Glass Shutter", p2: "SH", shelf: 1, glassFam: true, variants: [V("sgl", "Single door (handed)", { p3: "1SG", handed: true }), V("dbl", "Double door", { p3: "1SG", p4: "2HS", both: true })] },
};
const MD_FAMILIES = {
  MDR: { name: "Rolling Shutter", p2: "RS", noBottom: true, noShutter: true, special: "MD", variants: [V("rs", "Rolling shutter", { p3: "3SG", p4: "1SX" })] },
};

function famSetOf(z) {
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
}

/* ---------------- Wood standard widths ---------------- */
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

function sizesFor(zk, fk) {
  const z = ZONES[zk];
  let w = WIDTHS[fk];
  if (!w) w = z.tall ? TALL_W : [300, 450, 600, 900];
  const h = z.tall ? [2400, 2040]
    : z.kind === "wall" ? [1085, 725]
    : z.kind === "loft" ? [600]
    : z.kind === "md" ? [1650, 1290]
    : [720];
  const d = z.full ? 560 : (z.low || z.kind) ? 336 : 560;
  return { w, h, d };
}

/* ---------------- Boards & shutter types ---------------- */
const BOARDS = {
  A: { label: "16mm ply + 0.8mm laminate both faces", core: "16mm BWP plywood", coreT: 16, lam: true, back: "6mm ply + 0.8mm laminate both faces", backLam: true },
  B: { label: "18mm prelaminated MDF", core: "18mm prelaminated MDF", coreT: 18, lam: false, back: "8mm prelaminated MDF", backLam: false },
  C: { label: "18mm prelaminated particle board", core: "18mm prelaminated particle board", coreT: 18, lam: false, back: "8mm prelaminated particle board", backLam: false },
};
const SHUTTER_TYPES = {
  PRELAM: { label: "Laminated — Prelaminated", band: true, board: "18mm prelaminated board" },
  POSTLAM: { label: "Laminated — Post-laminated", band: true, board: "16mm BWP plywood core" },
  MEMBRANE: { label: "Membrane", band: false, board: "18mm prelaminated board" },
  PU1: { label: "PU — One side", band: false, board: "18mm prelaminated board" },
  PU2: { label: "PU — Both sides", band: false, board: "18mm BWP plywood" },
  GLASS: { label: "Glass", band: false, board: "5mm toughened glass" },
};
const NEON = { N20: { label: "Neon 20", inset: 5, frame: 25 }, N50: { label: "Neon 50", inset: 8, frame: 50 } };

/* ---------------- Helpers ---------------- */
const legCount = (w) => (w <= 150 ? 2 : w >= 1050 ? 6 : 4);
const hingeN = (h) => (h <= 900 ? 3 : h <= 1600 ? 4 : h <= 2100 ? 5 : 6);

function shelfCount(zk, fk, fam, H) {
  const z = ZONES[zk];
  if (z.kind === "wall") {
    if (fk === "WDR") return H >= 1085 ? 2 : 0;
    return H >= 1085 ? 3 : 1;
  }
  return fam.shelf || 0;
}

/* ---------------- The build ---------------- */
function buildUnit(cfg) {
  const { zk, fk, vid, hand, handle, board, shType, neon, W, H, D, qty } = cfg;
  const z = ZONES[zk];
  const fam = famSetOf(zk)[fk];
  const v = fam.variants.find((x) => x.id === vid) || fam.variants[0];
  const B = BOARDS[board];
  const isBase = !z.tall && !z.kind;
  const isGlass = !!fam.glassFam;
  const st = isGlass ? "GLASS" : shType;

  const panels = [], hardware = [], cons = [], stubs = [];
  const carcMat = B.core;

  const addP = (group, item, w, h, n, thk, mat, band) =>
    panels.push({ group, item, w: Math.round(w), h: Math.round(h), n, thk, mat, band,
      sqft: sqft(w, h) * n, band_m: band ? perim(w, h) * n : 0 });

  /* --- Carcass --- */
  const topD = handle === "XCJ" ? D - CJ_CUT : D;
  addP("Carcass", "Side LH/RH", D, H, 2, T, carcMat, true);
  addP("Carcass", "Top", W - 2 * T, topD, 1, T, carcMat, true);
  if (!fam.noBottom) addP("Carcass", "Bottom", W - 2 * T, D, 1, T, carcMat, true);

  if (fam.special === "MD") {
    stubs.push("MD back panel height — parked at the construction stage (no bottom panel, so the +9 groove allowance applies on one end only).");
  } else if (fam.special === "REF") {
    stubs.push("REF short back wall — stone uses H − 1874. Wood equivalent not yet defined.");
    addP("Carcass", "Back", W - 2 * T + GROOVE, H - 2 * T + GROOVE, 1, T_BACK, B.back, false);
  } else if (fam.special === "APP") {
    stubs.push("APP twin back walls — stone splits upper/lower at H − 1349. Wood equivalent not yet defined.");
    addP("Carcass", "Back", W - 2 * T + GROOVE, H - 2 * T + GROOVE, 1, T_BACK, B.back, false);
  } else if (fam.backStrips) {
    addP("Carcass", "Back strip", W - 2 * T + GROOVE, 75, 2, T_BACK, B.back, false);
  } else {
    addP("Carcass", "Back", W - 2 * T + GROOVE, H - 2 * T + GROOVE, 1, T_BACK, B.back, false);
  }

  if (fam.top === "frame") {
    addP("Carcass", "Top rail (front)", W - 2 * T, 100, 1, T, carcMat, true);
    addP("Carcass", "Top rail (back)", W - 2 * T, 100, 1, T, carcMat, true);
  }

  const nsh = shelfCount(zk, fk, fam, H);
  if (nsh > 0) {
    const shMat = isGlass ? "8mm toughened glass" : carcMat;
    const shThk = isGlass ? 8 : T;
    addP("Carcass", "Shelf", W - 2 * T - SHELF_W_CLR, D - SHELF_D_OFF, nsh, shThk, shMat, !isGlass);
  }

  /* --- Shutters --- */
  let leaves = 0, leafW = 0, leafH = 0;
  if (!fam.noShutter) {
    leaves = v.both || v.double || W > 600 ? 2 : 1;
    leafW = W / leaves;
    const ded = isBase && handle === "XCJ" ? 33 : 3;
    leafH = H - ded;
    if (st === "GLASS") {
      const nn = NEON[neon];
      addP("Shutter", `Glass panel (${nn.label})`, leafW - nn.inset, leafH - nn.inset, leaves, 5, "5mm toughened glass", false);
      hardware.push({ item: `Alu profile ${nn.label}`, qty: r3(((leafW + leafH) * 2 * leaves) / 1000), uom: "mtr", note: `frame ${nn.frame}mm` });
      hardware.push({ item: "Corner connector", qty: 4 * leaves, uom: "nos", note: "" });
    } else {
      const S = SHUTTER_TYPES[st];
      addP("Shutter", "Shutter leaf", leafW, leafH, leaves, 18, S.board, S.band);
    }
    hardware.push({ item: "Hinge", qty: hingeN(H) * leaves, uom: "nos", note: `hingeN(${H})` });
  }

  if (fam.special === "MD") {
    hardware.push({ item: "Rolling shutter unit (bought-in)", qty: 1, uom: "set", note: `${W} × ${H}` });
  }

  /* --- Drawers (stubbed) --- */
  if (fam.drawers || /DW|GD|DPN/.test(fk)) {
    stubs.push("Drawer box bottom & back panels — awaiting the per-model deduction table. Metal box itself is bought-in.");
    hardware.push({ item: `Drawer box set (${cfg.drawerModel})`, qty: 1, uom: "set", note: "bought-in" });
  }

  /* --- Legs --- */
  if (z.mount === "legs") hardware.push({ item: "PVC leg", qty: legCount(W), uom: "nos", note: `legCount(${W})` });

  /* --- Consumables --- */
  const carcSqft = panels.filter((p) => p.group === "Carcass" && p.thk === T).reduce((a, p) => a + p.sqft, 0);
  const backSqft = panels.filter((p) => p.thk === T_BACK).reduce((a, p) => a + p.sqft, 0);
  const bandM = panels.reduce((a, p) => a + p.band_m, 0);

  if (bandM > 0) {
    cons.push({ item: "Edge band 0.8mm", qty: r3(bandM), uom: "RMT" });
    cons.push({ item: "Edgeband adhesive", qty: r3(bandM), uom: "RMT" });
  }
  if (B.lam) {
    cons.push({ item: "Carcass laminate 0.8mm", qty: r3((carcSqft + backSqft) * 2), uom: "sqft" });
    cons.push({ item: "Carcass laminate adhesive", qty: r3((carcSqft + backSqft) * LAM_ADH * 2), uom: "gm" });
  }
  const shSqft = panels.filter((p) => p.group === "Shutter").reduce((a, p) => a + p.sqft, 0);
  if (st === "POSTLAM" && shSqft) {
    cons.push({ item: "Shutter laminate 0.8mm (outer + liner)", qty: r3(shSqft * 2), uom: "sqft" });
    cons.push({ item: "Shutter laminate adhesive", qty: r3(shSqft * LAM_ADH * 2), uom: "gm" });
  }
  if (st === "MEMBRANE" && shSqft) {
    const mf = (sqft(leafW + 2 * MEMB_OVER, leafH + 2 * MEMB_OVER)) * leaves;
    cons.push({ item: "Membrane foil", qty: r3(mf), uom: "sqft" });
    cons.push({ item: "Membrane adhesive", qty: r3(shSqft), uom: "sqft" });
    stubs.push("Membrane adhesive rate (g/sqft) not yet set — quantity shown as area only.");
  }
  if ((st === "PU1" || st === "PU2") && shSqft) {
    const sides = st === "PU2" ? 2 : 1;
    cons.push({ item: "PU epoxy", qty: r3(shSqft * PU.epoxy * sides), uom: "gm" });
    cons.push({ item: "PU base primer", qty: r3(shSqft * PU.primer * sides), uom: "gm" });
    cons.push({ item: "PU top coat", qty: r3(shSqft * PU.top * sides), uom: "gm" });
  }

  const code = [zk, fam.p2, v.p3 || "XXX", v.p4 || "XXX", handle, v.handed ? hand : ""].filter(Boolean).join("·");

  return { code, famName: fam.name, vLabel: v.label, panels, hardware, cons, stubs, qty,
    totals: { carcSqft, backSqft, shSqft, bandM } };
}

/* ---------------- Raw material roll-up ---------------- */
function rollUp(project) {
  const mat = {}, band = {}, other = {};
  project.forEach((u) => {
    const q = u.qty;
    u.panels.forEach((p) => {
      const key = `${p.mat}||${p.thk}`;
      mat[key] = mat[key] || { mat: p.mat, thk: p.thk, sqft: 0, group: p.group };
      mat[key].sqft += p.sqft * q;
    });
    u.cons.forEach((c) => {
      const t = c.uom === "RMT" ? band : other;
      t[c.item] = t[c.item] || { item: c.item, qty: 0, uom: c.uom };
      t[c.item].qty += c.qty * q;
    });
  });
  const sheets = Object.values(mat).map((m) => {
    const isGlass = /glass/i.test(m.mat);
    const w = m.group === "Shutter" ? WASTE.shutter : WASTE.carcass;
    return { ...m, waste: w, sheets: isGlass ? null : (m.sqft * (1 + w / 100)) / SHEET_SQFT };
  });
  return { sheets, band: Object.values(band), other: Object.values(other) };
}

/* ============================================================ */
export default function WoodBomBuilder() {
  const [zk, setZk] = useState("BC");
  const [fk, setFk] = useState("SH");
  const [vid, setVid] = useState("single");
  const [hand, setHand] = useState("LHS");
  const [handle, setHandle] = useState("STD");
  const [board, setBoard] = useState("A");
  const [shType, setShType] = useState("POSTLAM");
  const [neon, setNeon] = useState("N20");
  const [drawerModel, setDrawerModel] = useState("Hettich");
  const [elev, setElev] = useState("AA");
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState("unit");
  const [project, setProject] = useState([]);

  const fams = useMemo(() => famSetOf(zk), [zk]);
  const fam = fams[fk] || Object.values(fams)[0];
  const fkSafe = fams[fk] ? fk : Object.keys(fams)[0];
  const sizes = useMemo(() => sizesFor(zk, fkSafe), [zk, fkSafe]);

  const [W, setW] = useState(600);
  const [H, setH] = useState(720);
  const [D, setD] = useState(560);

  const onZone = (z) => {
    setZk(z);
    const f = Object.keys(famSetOf(z))[0];
    setFk(f);
    const vv = famSetOf(z)[f].variants[0];
    setVid(vv.id);
    const s = sizesFor(z, f);
    setW(s.w[0]); setH(s.h[0]); setD(s.d);
  };
  const onFam = (f) => {
    setFk(f);
    setVid(fams[f].variants[0].id);
    const s = sizesFor(zk, f);
    setW(s.w[0]); setH(s.h[0]); setD(s.d);
  };

  const v = fam.variants.find((x) => x.id === vid) || fam.variants[0];
  const isGlassFam = !!fam.glassFam;

  const cfg = { zk, fk: fkSafe, vid: v.id, hand, handle, board, shType, neon, W, H, D, qty, drawerModel };
  const unit = useMemo(() => buildUnit(cfg), [zk, fkSafe, v.id, hand, handle, board, shType, neon, W, H, D, qty, drawerModel]);

  const add = () => setProject((p) => [...p, { ...unit, elev, id: Date.now() + Math.random() }]);
  const del = (id) => setProject((p) => p.filter((x) => x.id !== id));

  const roll = useMemo(() => rollUp(project), [project]);

  const csv = () => {
    const rows = [["Elevation", "Cabinet", "Group", "Item", "Material", "W", "H", "Thk", "Qty", "Sqft", "Band m"]];
    project.forEach((u) => {
      u.panels.forEach((p) =>
        rows.push([u.elev, u.code, p.group, p.item, p.mat, p.w, p.h, p.thk, p.n * u.qty, r3(p.sqft * u.qty), r3(p.band_m * u.qty)]));
      u.hardware.forEach((h) =>
        rows.push([u.elev, u.code, "Hardware", h.item, h.note, "", "", "", h.qty * u.qty, "", ""]));
      u.cons.forEach((c) =>
        rows.push([u.elev, u.code, "Consumable", c.item, c.uom, "", "", "", r3(c.qty * u.qty), "", ""]));
    });
    const blob = new Blob([rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "wood-kitchen-bom.csv";
    a.click();
  };

  const allStubs = [...new Set(project.flatMap((u) => u.stubs))];

  return (
    <div className="wbb">
      <style>{CSS}</style>

      <header className="hd">
        <div>
          <h1>Wood Kitchen BOM Builder</h1>
          <p>Plywood carcass · {Object.keys(ZONES).length} zones · sheet {SHEET_W}×{SHEET_H}</p>
        </div>
        <div className="hd-n">
          <span><b>{project.length}</b> cabinets</span>
          <span><b>{r3(roll.sheets.reduce((a, s) => a + (s.sheets || 0), 0)).toFixed(1)}</b> sheets</span>
        </div>
      </header>

      <div className="body">
        {/* ---------- config rail ---------- */}
        <aside className="rail">
          <Field label="Zone">
            <select value={zk} onChange={(e) => onZone(e.target.value)}>
              {Object.entries(ZONES).map(([k, z]) => <option key={k} value={k}>{k} — {z.name}</option>)}
            </select>
          </Field>

          <Field label="Cabinet family">
            <select value={fkSafe} onChange={(e) => onFam(e.target.value)}>
              {Object.entries(fams).map(([k, f]) => <option key={k} value={k}>{k} — {f.name}</option>)}
            </select>
          </Field>

          <Field label="Configuration">
            <select value={v.id} onChange={(e) => setVid(e.target.value)}>
              {fam.variants.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </Field>

          {v.handed && (
            <Field label="Hand">
              <Seg opts={[["LHS", "LHS"], ["RHS", "RHS"]]} val={hand} set={setHand} />
            </Field>
          )}

          <Field label="Handle">
            <Seg opts={[["STD", "Standard"], ["XCJ", "Gola"]]} val={handle} set={setHandle} />
            {handle === "XCJ" && <Hint>Top depth cuts to {D - CJ_CUT}. Base shutters lose 33mm.</Hint>}
          </Field>

          <Field label="Carcass board">
            <select value={board} onChange={(e) => setBoard(e.target.value)}>
              {Object.entries(BOARDS).map(([k, b]) => <option key={k} value={k}>{k} — {b.label}</option>)}
            </select>
            <Hint>Back: {BOARDS[board].back}</Hint>
          </Field>

          {!fam.noShutter && (
            isGlassFam ? (
              <Field label="Neon profile">
                <Seg opts={[["N20", "Neon 20"], ["N50", "Neon 50"]]} val={neon} set={setNeon} />
                <Hint>Glass family — shutter type locked to glass. Inset {NEON[neon].inset}mm.</Hint>
              </Field>
            ) : (
              <Field label="Shutter type">
                <select value={shType} onChange={(e) => setShType(e.target.value)}>
                  {Object.entries(SHUTTER_TYPES).filter(([k]) => k !== "GLASS")
                    .map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                </select>
                <Hint>{SHUTTER_TYPES[shType].band ? "0.8mm band on all edges" : "No edge band"} · shelf follows carcass board</Hint>
              </Field>
            )
          )}

          {(fam.drawers || /DW|GD|DPN/.test(fkSafe)) && (
            <Field label="Drawer model">
              <select value={drawerModel} onChange={(e) => setDrawerModel(e.target.value)}>
                {["Lian", "Hettich", "Blum", "Hafele", "Grass"].map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
          )}

          <Field label="Dimensions">
            <div className="dims">
              <select value={W} onChange={(e) => setW(+e.target.value)}>
                {sizes.w.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select value={H} onChange={(e) => setH(+e.target.value)}>
                {sizes.h.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <input type="number" value={D} onChange={(e) => setD(+e.target.value)} />
            </div>
            <Hint>width · height · depth (mm)</Hint>
          </Field>

          <Field label="Elevation & quantity">
            <div className="dims2">
              <select value={elev} onChange={(e) => setElev(e.target.value)}>
                {["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "JJ", "KK"].map((x) => <option key={x}>{x}</option>)}
              </select>
              <input type="number" min="1" value={qty} onChange={(e) => setQty(Math.max(1, +e.target.value))} />
            </div>
          </Field>

          <button className="add" onClick={add}>Add to project</button>
          <div className="code">{unit.code}</div>
        </aside>

        {/* ---------- output ---------- */}
        <main className="out">
          <nav className="tabs">
            {[["unit", "This unit"], ["project", `Project (${project.length})`], ["raw", "Raw materials"]].map(([k, l]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
            {project.length > 0 && <button className="csv" onClick={csv}>Download CSV</button>}
          </nav>

          {tab === "unit" && (
            <div className="pane">
              <h2>{unit.famName} — {unit.vLabel}</h2>
              <Table
                head={["Group", "Item", "Material", "W", "H", "Thk", "Qty", "Sqft", "Band m"]}
                rows={unit.panels.map((p) => [p.group, p.item, p.mat, p.w, p.h, p.thk, p.n, r3(p.sqft).toFixed(3), p.band_m ? r3(p.band_m).toFixed(3) : "—"])}
                num={[3, 4, 5, 6, 7, 8]}
              />
              <h3>Hardware</h3>
              <Table head={["Item", "Qty", "Unit", "Note"]}
                rows={unit.hardware.map((h) => [h.item, h.qty, h.uom, h.note || "—"])} num={[1]} />
              {unit.cons.length > 0 && <>
                <h3>Consumables</h3>
                <Table head={["Item", "Qty", "Unit"]}
                  rows={unit.cons.map((c) => [c.item, r3(c.qty).toFixed(3), c.uom])} num={[1]} />
              </>}
              {unit.stubs.length > 0 && <Stubs list={unit.stubs} />}
            </div>
          )}

          {tab === "project" && (
            <div className="pane">
              {project.length === 0 ? (
                <Empty>Configure a cabinet and add it to start a project.</Empty>
              ) : (
                <>
                  <Table
                    head={["Elev", "Cabinet", "Description", "W×H×D", "Qty", "Sqft", "Band m", ""]}
                    rows={project.map((u) => [
                      u.elev, u.code, u.famName,
                      `${u.panels[0].h}×${u.panels[1].w + 2 * T}`,
                      u.qty,
                      r3((u.totals.carcSqft + u.totals.backSqft + u.totals.shSqft) * u.qty).toFixed(2),
                      r3(u.totals.bandM * u.qty).toFixed(2),
                      <button key="x" className="x" onClick={() => del(u.id)}>remove</button>,
                    ])}
                    num={[4, 5, 6]}
                  />
                  {allStubs.length > 0 && <Stubs list={allStubs} />}
                </>
              )}
            </div>
          )}

          {tab === "raw" && (
            <div className="pane">
              {project.length === 0 ? (
                <Empty>Nothing to roll up yet.</Empty>
              ) : (
                <>
                  <h3>Boards</h3>
                  <Table
                    head={["Material", "Thk", "Sqft", "Waste %", "Sheets"]}
                    rows={roll.sheets.map((s) => [s.mat, s.thk, r3(s.sqft).toFixed(2), s.sheets === null ? "—" : s.waste, s.sheets === null ? "bought by area" : s.sheets.toFixed(2)])}
                    num={[1, 2, 3, 4]}
                  />
                  {roll.band.length > 0 && <>
                    <h3>Banding</h3>
                    <Table head={["Item", "Qty", "Unit"]}
                      rows={roll.band.map((b) => [b.item, r3(b.qty).toFixed(2), b.uom])} num={[1]} />
                  </>}
                  {roll.other.length > 0 && <>
                    <h3>Consumables</h3>
                    <Table head={["Item", "Qty", "Unit"]}
                      rows={roll.other.map((o) => [o.item, r3(o.qty).toFixed(1), o.uom])} num={[1]} />
                  </>}
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------------- small components ---------------- */
const Field = ({ label, children }) => (
  <div className="fld"><label>{label}</label>{children}</div>
);
const Hint = ({ children }) => <p className="hint">{children}</p>;
const Seg = ({ opts, val, set }) => (
  <div className="seg">{opts.map(([k, l]) => (
    <button key={k} className={val === k ? "on" : ""} onClick={() => set(k)}>{l}</button>
  ))}</div>
);
const Empty = ({ children }) => <div className="empty">{children}</div>;
const Stubs = ({ list }) => (
  <div className="stub">
    <h4>Not yet specified</h4>
    <ul>{list.map((s, i) => <li key={i}>{s}</li>)}</ul>
  </div>
);
const Table = ({ head, rows, num = [] }) => (
  <div className="tw"><table>
    <thead><tr>{head.map((h, i) => <th key={i} className={num.includes(i) ? "n" : ""}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => (
      <tr key={i}>{r.map((c, j) => <td key={j} className={num.includes(j) ? "n" : ""}>{c}</td>)}</tr>
    ))}</tbody>
  </table></div>
);

/* ---------------- styles ---------------- */
const CSS = `
.wbb{--paper:#F4F5F3;--ink:#1B2430;--mut:#66757F;--line:#D8DEDA;--pnl:#FFF;--acc:#15645A;--flag:#9C5510;--flagbg:#FBF2E6;
  background:var(--paper);color:var(--ink);min-height:100vh;
  font-family:"Inter","Segoe UI",system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.5;
  font-variant-numeric:tabular-nums;}
.wbb *{box-sizing:border-box}
.hd{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;
  padding:20px 24px;background:var(--pnl);border-bottom:2px solid var(--ink);}
.hd h1{margin:0;font-size:19px;font-weight:650;letter-spacing:-.015em;}
.hd p{margin:3px 0 0;color:var(--mut);font-size:12px;}
.hd-n{display:flex;gap:22px;}
.hd-n span{color:var(--mut);font-size:12px;}
.hd-n b{display:block;font-size:20px;color:var(--acc);font-weight:650;}
.body{display:flex;align-items:flex-start;gap:0;flex-wrap:wrap;}
.rail{width:320px;flex:0 0 320px;padding:20px;background:var(--pnl);border-right:1px solid var(--line);
  min-height:calc(100vh - 78px);}
.fld{margin-bottom:15px;}
.fld label{display:block;font-size:11px;font-weight:600;color:var(--mut);margin-bottom:5px;}
.wbb select,.wbb input{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:3px;
  background:#fff;font:inherit;font-size:12.5px;color:var(--ink);}
.wbb select:focus,.wbb input:focus{outline:2px solid var(--acc);outline-offset:-1px;border-color:var(--acc);}
.hint{margin:5px 0 0;font-size:11px;color:var(--mut);}
.seg{display:flex;border:1px solid var(--line);border-radius:3px;overflow:hidden;}
.seg button{flex:1;padding:7px 4px;border:0;background:#fff;font:inherit;font-size:12px;cursor:pointer;color:var(--mut);}
.seg button+button{border-left:1px solid var(--line);}
.seg button.on{background:var(--acc);color:#fff;font-weight:600;}
.dims{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;}
.dims2{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.add{width:100%;padding:10px;margin-top:6px;border:0;border-radius:3px;background:var(--acc);color:#fff;
  font:inherit;font-weight:600;font-size:13px;cursor:pointer;}
.add:hover{background:#0F4F47;}
.add:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.code{margin-top:10px;padding:8px;background:var(--paper);border:1px solid var(--line);border-radius:3px;
  font-size:11px;color:var(--mut);word-break:break-all;text-align:center;}
.out{flex:1;min-width:340px;padding:0 0 40px;}
.tabs{display:flex;gap:0;align-items:center;background:var(--pnl);border-bottom:1px solid var(--line);padding:0 16px;}
.tabs button{padding:12px 16px;border:0;background:none;font:inherit;font-size:13px;color:var(--mut);cursor:pointer;
  border-bottom:2px solid transparent;margin-bottom:-1px;}
.tabs button.on{color:var(--ink);font-weight:600;border-bottom-color:var(--acc);}
.tabs .csv{margin-left:auto;color:var(--acc);font-weight:600;}
.pane{padding:20px 24px;}
.pane h2{margin:0 0 16px;font-size:16px;font-weight:650;letter-spacing:-.01em;}
.pane h3{margin:26px 0 10px;font-size:12px;font-weight:650;color:var(--mut);}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:3px;background:var(--pnl);}
.wbb table{width:100%;border-collapse:collapse;font-size:12.5px;}
.wbb th{text-align:left;padding:9px 11px;background:var(--paper);border-bottom:1px solid var(--line);
  font-size:11px;font-weight:650;color:var(--mut);white-space:nowrap;}
.wbb td{padding:8px 11px;border-bottom:1px solid var(--line);}
.wbb tr:last-child td{border-bottom:0;}
.wbb th.n,.wbb td.n{text-align:right;}
.x{border:0;background:none;color:var(--flag);font:inherit;font-size:11.5px;cursor:pointer;padding:0;}
.empty{padding:44px 20px;text-align:center;color:var(--mut);background:var(--pnl);
  border:1px dashed var(--line);border-radius:3px;}
.stub{margin-top:22px;padding:14px 16px;background:var(--flagbg);border-left:3px solid var(--flag);border-radius:0 3px 3px 0;}
.stub h4{margin:0 0 7px;font-size:12px;font-weight:650;color:var(--flag);}
.stub ul{margin:0;padding-left:17px;color:var(--ink);}
.stub li{margin-bottom:4px;font-size:12px;}
@media(max-width:820px){.rail{width:100%;flex:1 1 100%;min-height:0;border-right:0;border-bottom:1px solid var(--line);}}
`;
