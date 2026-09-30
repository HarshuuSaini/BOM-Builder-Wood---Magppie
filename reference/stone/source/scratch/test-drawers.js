// Test script for Lian Drawer Box Sizing and the SINGLE-pack drawer structure.
// Every drawer variant (Low / High / Semi High) collapses into ONE composite:
//   "Drawer Pack- Cab Drawer Box <variant>"
// whose Level-1 quantity equals the number of drawers. Its children carry the
// total (per-drawer consumption x drawer count) and are divided back down at
// render/Zoho:
//   - Back panel:   Part(JD) -> Panel -> Raw   (drilled)
//   - Bottom panel: flat Panel               (no drill, no Part wrapper)
//   - Fascia:       cabinet-level OWN pack: Part(JD) -> Panel -> Raw  (built-in only, carcass colour)
//   - HM513 (DBS):  Set of Profile Parts (LH/RH) wrapper  (has LH/RH drilling)
//   - HM535 (DBC):  flat cut profile          (like the bottom panel)
//   - Hardware:     flat under the pack (Level 2)
const ZONES = {
  BC: { name: "Base", p1: "BC", construct: "fulltb", mount: "legs", low: false, blind: false, fams: "base" }
};

function shutSpec(zk, fk, v, inbuiltDrawers = "none") {
  const Z = ZONES[zk];
  if (Z.blind) return { kind: "hinged", blindW: Z.kind === "wall" || Z.kind === "loft" ? 450 : 550 };
  if (fk === "DW" || fk === "HO") {
    if (v.id === "3dr" && inbuiltDrawers === "1lb") {
      return { kind: "drawer", fronts: [{ loc: "UH", hb: 1 }, { loc: "BH", hb: 1 }] };
    }
    if (v.id === "3dr" && inbuiltDrawers === "2hb1bl") {
      return { kind: "drawer", fronts: [{ loc: "UH", hb: 1 }, { loc: "BH", hb: 1 }] };
    }
    return v.p4 === "2HB"
      ? { kind: "drawer", fronts: [{ loc: "UH", hb: 1 }, { loc: "BH", hb: 1 }] }
      : { kind: "drawer", fronts: [{ loc: "UL", hb: 0 }, { loc: "ML", hb: 0 }, { loc: "BH", hb: 1 }] };
  }
  if (fk === "GD" || fk === "BPO" || fk === "WBP") return { kind: "drawer", fronts: [{ loc: "FH", hb: 1 }] };
  if (["SK", "SH", "WGL", "WST", "WDR", "SHF", "PAN", "DPN", "PPN", "REF", "BLND", "LOWS", "LST", "LGL"].includes(fk)) return { kind: "hinged" };
  return { kind: "none" };
}

// Mirrors CarcassBomBuilder.addDrawerBoxes (single-pack structure).
function addDrawerBoxes(zk, fk, v, W, D, t, panels, profiles, hardware, cons, pkRows, drawerModel = "Lian", inbuiltDrawers = "none") {
  let effectiveInbuiltDrawers = inbuiltDrawers;
  if (fk === "GD") { // WBP (waste-bin pull-out) is an accessory with no drawer — excluded
    effectiveInbuiltDrawers = "1lb";
  } else if (fk === "DPN") {
    effectiveInbuiltDrawers = "fixed_dpn";
  }

  const supportedModel = drawerModel === "Lian" || drawerModel === "Hettich" || drawerModel === "Blum" || drawerModel === "Hafele" || drawerModel === "Grass";

  const agg = {};
  const bump = (variant, backH, hw, fasciaH) => {
    if (!agg[variant]) agg[variant] = { count: 0, backH, hardware: hw, fasciaH: null };
    agg[variant].count += 1;
    if (fasciaH !== null) agg[variant].fasciaH = fasciaH;
  };

  // 1. Standard drawer boxes (no fascia — front is the shutter). For "2hb1bl" the 2 High
  // Backs are standard (faced by HB shutters); only the built-in Low Back gets a fascia. In
  // 2HB+1BL the box behind each high front is actually a LOW box (back 63 + H90) — only the
  // fascia is tall — so the "High" pack takes the Low configuration.
  const is2hb1bl = effectiveInbuiltDrawers === "2hb1bl";
  const isAcc = fk === "BPO" || fk === "WBP";
  if (!isAcc && supportedModel) {
    const spec = shutSpec(zk, fk, v, effectiveInbuiltDrawers);
    if (spec && spec.kind === "drawer" && spec.fronts) {
      spec.fronts.forEach((fr) => {
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
    if (effectiveInbuiltDrawers === "1lb") numLow = 1;
    else if (effectiveInbuiltDrawers === "1sb") numSemi = 1;
    else if (effectiveInbuiltDrawers === "2lb") numLow = 2;
    else if (effectiveInbuiltDrawers === "2sb") numSemi = 2;
    else if (effectiveInbuiltDrawers === "2hb1bl") { numLow = 1; }
    else if (effectiveInbuiltDrawers === "fixed_dpn") { numLow = 2; numSemi = 3; }

    for (let i = 0; i < numHigh; i++) bump("High", 212, "HARDWARE PACK HIGH BACK DRAWER H239 SET/1", 210);
    for (let i = 0; i < numLow; i++) bump("Low", 63, "HARDWARE PACK LOW BACK DRAWER H90 SET/1", 110);
    for (let i = 0; i < numSemi; i++) bump("Semi High", 148, "HARDWARE PACK HIGH BACK DRAWER H175 SET/1", 210);
  }

  // 3. Emit one Drawer Pack per variant with total quantities (per-drawer x count)
  const backW = W - 72;
  const bottomW = W - 50;
  const bottomD = D - 77;
  const faciaW = W - 2 * t - 8;
  for (const variant of Object.keys(agg)) {
    const a = agg[variant];
    const n = a.count;
    const drawerPackName = `Drawer Pack- Cab Drawer Box ${variant}`;

    panels.push({ name: `Panels- Cab Drawer Box Back ${variant} ${backW}x${a.backH}x15`, w: backW, h: a.backH, qty: 1 * n, drill: "JD", pack: drawerPackName, t: 15 });
    panels.push({ name: `Panels- Cab Drawer Box Bottom ${bottomW}x${bottomD}x6`, w: bottomW, h: bottomD, qty: 1 * n, drill: null, pack: drawerPackName, t: 6 });

    // Fascia lives at cabinet/carcass level as its OWN pack (NOT nested in Drawer Pack).
    if (a.fasciaH !== null) {
      const fasciaPk = `Panels- Cab Drawer Box Fascia ${variant} ${faciaW}x${a.fasciaH}x15`;
      panels.push({ name: fasciaPk, w: faciaW, h: a.fasciaH, qty: 1 * n, drill: "JD", pack: fasciaPk, t: 15 });
      if (!pkRows.some(row => row[1] === fasciaPk)) pkRows.push(["panel", fasciaPk, `${faciaW}×${a.fasciaH}×15`, n, "Pcs"]);
    }

    profiles.push({ name: `ALU PROF DRAWER BOTTOM SIDE (HM513) LH/RH`, len: 483, qty: 2 * n, type: "DBS", pack: drawerPackName });
    profiles.push({ name: `ALU PROF FOR DRAWER BOTTOM CENTER (HM535) MID`, len: W - 78, qty: 4 * n, type: "DBC", pack: drawerPackName });

    // Only built-in (fascia) drawers keep the runner hardware here; shutter-faced drawers carry
    // it on their shutter (buildShutters `hinge`), so emitting it here too would duplicate it.
    if (a.fasciaH !== null) hardware.push({ name: a.hardware, qty: 1 * n, pack: drawerPackName });

    if (!pkRows.some(row => row[1] === drawerPackName)) pkRows.push(["panel", drawerPackName, `Set`, n, "Set"]);
  }
}

function mergePanels(panels) {
  const merged = {};
  panels.forEach(p => {
    const key = `${p.name}_w${p.w}_h${p.h}_t${p.t}_drill${p.drill || "null"}_pack${p.pack}`;
    if (merged[key]) merged[key].qty += p.qty;
    else merged[key] = { ...p };
  });
  return Object.values(merged);
}

// Mirrors CarcassBomBuilder.getDrawerCount.
function getDrawerCount(packName, panels) {
  const searchName = packName.includes("Pullout Shelf") ? packName.replace("Drawer Pack-", "Set of Parts-") : packName;
  const matchedPanels = panels.filter(p => p.pack.startsWith(searchName));
  if (packName.includes("Pullout Shelf")) {
    const basePanel = matchedPanels.find(p => p.name.toLowerCase().includes("base"));
    return basePanel ? basePanel.qty : 4;
  }
  const backPanel = matchedPanels.find(p => p.name.toLowerCase().includes("back"));
  return backPanel ? backPanel.qty : 1;
}

// Mirrors the Drawer Pack branch of buildFullBomData.
function mockBuildFullBomData(m, q) {
  const rows = [];
  const cFinish = m.carcassMat || "STONE";
  rows.push({ level: 0, name: m.code, type: "master", qty: q });

  const panelsByPack = {};
  m.panels.forEach((p) => { (panelsByPack[p.pack] ??= []).push(p); });
  const profilesByPack = {};
  m.profiles.forEach((p) => { (profilesByPack[p.pack] ??= []).push(p); });

  const findPanelsForPk = (pk) => panelsByPack[pk] || m.panels.filter((p) => p.pack.startsWith(pk));
  const findProfilesForPk = (pk) => profilesByPack[pk] || m.profiles.filter((p) => p.pack.startsWith(pk));

  m.pkRows.forEach(([pkType, name, , pkQty]) => {
    if (pkType === "shut" || pkType === "hard" || pkType === "cons") return;
    rows.push({ level: 1, name, qty: pkQty, actualQty: pkQty * q, parent: m.code });

    const isDrawerPack = pkType === "panel" && name.startsWith("Drawer Pack- Cab Drawer Box");
    const dCount = isDrawerPack ? (getDrawerCount(name, m.panels) || 1) : 1;

    findPanelsForPk(name).forEach((p) => {
      const perParent = +(p.qty / dCount).toFixed(3);
      const actualQty = +(p.qty * q).toFixed(3);
      const hasDrill = p.drill && p.drill !== "no drill";
      if (hasDrill) {
        const partName = `${p.name} (${p.drill}) ${cFinish}`;
        rows.push({ level: 2, name: partName, qty: perParent, actualQty, parent: name });
        rows.push({ level: 3, name: `${p.name} ${cFinish}`, qty: 1, actualQty: q, parent: partName });
      } else {
        rows.push({ level: 2, name: `${p.name} ${cFinish}`, qty: perParent, actualQty, parent: name });
      }
    });

    findProfilesForPk(name).forEach((p) => {
      const perParent = +(p.qty / dCount).toFixed(3);
      const actualQty = +(p.qty * q).toFixed(3);
      const pPanelName = `${p.name} ${p.len}mm CHAMPAGNE`;
      if (p.type === "DBC") {
        // flat cut profile
        rows.push({ level: 2, name: pPanelName, qty: perParent, actualQty, type: "DBC", parent: name });
        rows.push({ level: 3, name: `Raw Profile ${p.type} CHAMPAGNE`, qty: (p.len / 1000) * perParent, parent: pPanelName });
      } else {
        // DBS keeps a Set of Profile Parts (LH/RH) wrapper
        const setName = `Set of Profile Parts ${p.type} (LH/RH)`;
        rows.push({ level: 2, name: setName, qty: perParent / 2, actualQty, type: "DBS", parent: name });
        rows.push({ level: 3, name: `${p.name} LH`, qty: 1, parent: setName });
        rows.push({ level: 3, name: `${p.name} RH`, qty: 1, parent: setName });
      }
    });

    m.hardware.forEach((h) => {
      if (h.pack !== name) return;
      const perParent = +(h.qty / dCount).toFixed(3);
      rows.push({ level: 2, name: h.name, qty: perParent, actualQty: h.qty * q, parent: name });
    });
  });

  return rows;
}

// Mirrors the Drawer Pack branch of handleAddToZohoSO.
function mockHandleAddToZohoSO(m) {
  const carcassPanelsByPack = {};
  m.panels.forEach((p) => { (carcassPanelsByPack[p.pack] ??= []).push(p); });
  const carcassProfilesByPack = {};
  m.profiles.forEach((p) => { (carcassProfilesByPack[p.pack] ??= []).push(p); });

  const carcassHardwarePacks = m.hardware
    .map(h => h.pack)
    .filter(pk => !!pk && (pk.startsWith("Set of Parts-") || pk.startsWith("Drawer Pack-")));

  const carcassPacks = Array.from(new Set([
    ...Object.keys(carcassPanelsByPack),
    ...Object.keys(carcassProfilesByPack),
    ...carcassHardwarePacks
  ]));

  const resolvedComposites = {};
  const packetCompositeIds = [];

  for (const packName of carcassPacks) {
    const partChildren = [];
    const isDrawerPack = packName.startsWith("Drawer Pack- Cab Drawer Box") || packName.startsWith("Drawer Pack- Cab Pullout Shelf");
    const drawerCount = isDrawerPack ? getDrawerCount(packName, m.panels) : 1;

    if (carcassPanelsByPack[packName]) {
      for (const p of carcassPanelsByPack[packName]) {
        const panelName = `${p.name} STONE`;
        resolvedComposites[panelName] = { name: panelName, components: [{ item_id: "stone-raw", quantity: 0.5 }, { item_id: "cutting", quantity: 1 }] };
        const hasDrill = p.drill && p.drill !== "no drill";
        if (hasDrill) {
          const partName = `${p.name} (${p.drill}) STONE`;
          resolvedComposites[partName] = { name: partName, components: [{ item_id: panelName, quantity: 1 }, { item_id: "drilling", quantity: 1 }] };
          partChildren.push({ item_id: partName, quantity: p.qty / drawerCount });
        } else {
          partChildren.push({ item_id: panelName, quantity: p.qty / drawerCount });
        }
      }
    }

    if (carcassProfilesByPack[packName]) {
      const profsByType = {};
      carcassProfilesByPack[packName].forEach((p) => { (profsByType[p.type] ??= []).push(p); });
      for (const pType of Object.keys(profsByType)) {
        const profsList = profsByType[pType];
        if (pType === "DBC") {
          for (const p of profsList) {
            const cutName = `${p.name} ${p.len}mm CHAMPAGNE`;
            resolvedComposites[cutName] = { name: cutName, components: [{ item_id: `raw-${pType}`, quantity: p.len / 1000 }, { item_id: "cutting", quantity: 1 }] };
            partChildren.push({ item_id: cutName, quantity: p.qty / drawerCount });
          }
        } else {
          // DBS -> Set of Profile Parts wrapper, one set per profile entry
          for (const p of profsList) {
            const setName = `Set of Profile Parts ${pType} (LH/RH) ${p.len}mm`;
            resolvedComposites[setName] = { name: setName, components: [{ item_id: `${pType}-LH`, quantity: 1 }, { item_id: `${pType}-RH`, quantity: 1 }] };
            partChildren.push({ item_id: setName, quantity: 1 });
          }
        }
      }
    }

    const hwGrouped = {};
    m.hardware.filter(h => h.pack === packName).forEach((h) => {
      if (hwGrouped[h.name]) hwGrouped[h.name].qty += h.qty;
      else hwGrouped[h.name] = { name: h.name, qty: h.qty };
    });
    for (const k of Object.keys(hwGrouped)) {
      partChildren.push({ item_id: hwGrouped[k].name, quantity: 1 });
    }

    const packNameWithFinish = `${packName} STONE`;
    resolvedComposites[packNameWithFinish] = { name: packNameWithFinish, components: [...partChildren, { item_id: "packing-carcass", quantity: 1 }] };

    packetCompositeIds.push({ item_id: packNameWithFinish, quantity: isDrawerPack ? drawerCount : 1 });
  }

  return { resolvedComposites, packetCompositeIds };
}

// ===================== Run test scenarios =====================
console.log("=== RUNNING REFINED DRAWER BOX TESTS ===");

// Scenario A: DW-3dr, Inbuilt=none (Default: 2LB + 1HB standard drawers)
console.log("\n--- Scenario A: DW-3dr Default (inbuiltDrawers=none) ---");
const panelsA = [], profilesA = [], hardwareA = [], consA = [], pkRowsA = [];
addDrawerBoxes("BC", "DW", { id: "3dr", p3: "2LB", p4: "1HB" }, 600, 560, 15, panelsA, profilesA, hardwareA, consA, pkRowsA, "Lian", "none");

// One Drawer Pack per variant: Low (n=2) and High (n=1).
const dpLowRowA = pkRowsA.find(r => r[1] === "Drawer Pack- Cab Drawer Box Low");
const dpHighRowA = pkRowsA.find(r => r[1] === "Drawer Pack- Cab Drawer Box High");
if (!dpLowRowA || dpLowRowA[3] !== 2) throw new Error("Expected Drawer Pack Low pkRow qty 2");
if (!dpHighRowA || dpHighRowA[3] !== 1) throw new Error("Expected Drawer Pack High pkRow qty 1");
if (pkRowsA.filter(r => r[1].startsWith("Drawer Pack-")).length !== 2) throw new Error("Expected exactly 2 Drawer Pack pkRows");
if (pkRowsA.some(r => r[1].startsWith("Set of Parts- Cab Drawer Box"))) throw new Error("Set of Parts must NOT exist for drawer boxes");
// All drawer panels/profiles/hardware now live under Drawer Pack
if (!panelsA.every(p => p.pack.startsWith("Drawer Pack- Cab Drawer Box"))) throw new Error("Drawer panels must be in Drawer Pack");
if (!profilesA.every(p => p.pack.startsWith("Drawer Pack- Cab Drawer Box"))) throw new Error("Drawer profiles must be in Drawer Pack");
if (!hardwareA.every(h => h.pack.startsWith("Drawer Pack- Cab Drawer Box"))) throw new Error("Drawer hardware must be in Drawer Pack");

const mergedA = mergePanels(panelsA);
// Low: back(qty2)+bottom(qty2); High: back(qty1)+bottom(qty1) -> 4 groups
if (mergedA.length !== 4) throw new Error("Expected 4 panel groups, got " + mergedA.length);
const lbBackA = mergedA.find(p => p.h === 63);
const hbBackA = mergedA.find(p => p.h === 212);
if (!lbBackA || lbBackA.name !== "Panels- Cab Drawer Box Back Low 528x63x15" || lbBackA.qty !== 2) throw new Error("Bad LB back");
if (!hbBackA || hbBackA.name !== "Panels- Cab Drawer Box Back High 528x212x15" || hbBackA.qty !== 1) throw new Error("Bad HB back");
// Per-drawer x count totals: Low DBS=4, DBC=8; High DBS=2, DBC=4
const lowDbs = profilesA.find(p => p.pack.endsWith("Low") && p.type === "DBS");
const lowDbc = profilesA.find(p => p.pack.endsWith("Low") && p.type === "DBC");
const highDbs = profilesA.find(p => p.pack.endsWith("High") && p.type === "DBS");
if (lowDbs.qty !== 4 || lowDbc.qty !== 8) throw new Error("Bad Low profile totals (expected DBS 4, DBC 8)");
if (highDbs.qty !== 2) throw new Error("Bad High DBS total (expected 2)");
// Hardware: these are all SHUTTER-FACED drawers, so the runner hardware lives on the shutter
// (buildShutters `hinge`), NOT the Drawer Pack — the Drawer Pack carries no drawer hardware.
if (hardwareA.length !== 0) throw new Error("Shutter-faced drawers must NOT carry runner hardware in the Drawer Pack");
const hwLowA = hardwareA.find(h => h.name === "HARDWARE PACK LOW BACK DRAWER H90 SET/1");
const hwHighA = hardwareA.find(h => h.name === "HARDWARE PACK HIGH BACK DRAWER H239 SET/1");
if (hwLowA || hwHighA) throw new Error("Expected no drawer-pack hardware for shutter-faced drawers");
console.log("Scenario A Passed!");

// Scenario B: GD (standard High front + 1 LB inbuilt with fascia)
console.log("\n--- Scenario B: GD (standard HB + 1 LB inbuilt) ---");
const panelsB = [], profilesB = [], hardwareB = [], consB = [], pkRowsB = [];
addDrawerBoxes("BC", "GD", { id: "gd", p3: "GD", p4: "1HF" }, 600, 560, 15, panelsB, profilesB, hardwareB, consB, pkRowsB, "Lian", "none");

const dpLowB = pkRowsB.find(r => r[1] === "Drawer Pack- Cab Drawer Box Low");
const dpHighB = pkRowsB.find(r => r[1] === "Drawer Pack- Cab Drawer Box High");
if (!dpLowB || dpLowB[3] !== 1) throw new Error("Expected GD Drawer Pack Low qty 1");
if (!dpHighB || dpHighB[3] !== 1) throw new Error("Expected GD Drawer Pack High qty 1");
const fasciaB = mergePanels(panelsB).find(p => p.h === 110);
if (!fasciaB || fasciaB.w !== 562 || fasciaB.qty !== 1) throw new Error("Expected 1 inbuilt Low fascia width 562 at cabinet level");
// Fascia now lives at cabinet/carcass level in its OWN pack (NOT inside a Drawer Pack).
if (fasciaB.pack !== "Panels- Cab Drawer Box Fascia Low 562x110x15") throw new Error("Fascia must be its own cabinet-level pack");
if (mergePanels(panelsB).some(p => p.pack.startsWith("Drawer Pack-") && p.name.includes("Fascia"))) throw new Error("No fascia may live inside a Drawer Pack");
// Its pkRow must exist at cabinet level
if (!pkRowsB.some(r => r[1] === "Panels- Cab Drawer Box Fascia Low 562x110x15")) throw new Error("Expected fascia pkRow at cabinet level");
console.log("Scenario B Passed!");

// Scenario C: DPN (fixed 2 LB + 3 Semi High inbuilt, no standard drawers)
console.log("\n--- Scenario C: DPN fixed inbuilt (2 LB + 3 Semi) ---");
const panelsC = [], profilesC = [], hardwareC = [], consC = [], pkRowsC = [];
addDrawerBoxes("BC", "DPN", { id: "h" }, 600, 560, 15, panelsC, profilesC, hardwareC, consC, pkRowsC, "Lian", "none");

const dpLowC = pkRowsC.find(r => r[1] === "Drawer Pack- Cab Drawer Box Low");
const dpSemiC = pkRowsC.find(r => r[1] === "Drawer Pack- Cab Drawer Box Semi High");
if (!dpLowC || dpLowC[3] !== 2) throw new Error("Expected DPN Drawer Pack Low qty 2");
if (!dpSemiC || dpSemiC[3] !== 3) throw new Error("Expected DPN Drawer Pack Semi High qty 3");
const mergedC = mergePanels(panelsC);
const backLowC = mergedC.find(p => p.h === 63);
const backSemiC = mergedC.find(p => p.h === 148);
const fasciaLowC = mergedC.find(p => p.h === 110);
const fasciaHighC = mergedC.find(p => p.h === 210);
if (!backLowC || backLowC.qty !== 2) throw new Error("Expected 2 Back Low panels");
if (!backSemiC || backSemiC.qty !== 3) throw new Error("Expected 3 Back Semi panels");
if (backSemiC.name !== "Panels- Cab Drawer Box Back Semi High 528x148x15") throw new Error("Bad inbuilt semi back size");
if (!fasciaLowC || fasciaLowC.qty !== 2) throw new Error("Expected 2 Fascia Low panels");
if (!fasciaHighC || fasciaHighC.qty !== 3) throw new Error("Expected 3 Fascia High panels");
const semiDbc = profilesC.find(p => p.pack.endsWith("Semi High") && p.type === "DBC");
if (semiDbc.qty !== 12) throw new Error("Expected Semi DBC total 12 (4 x 3)");
const hwLowC = hardwareC.find(h => h.name === "HARDWARE PACK LOW BACK DRAWER H90 SET/1");
const hwSemiC = hardwareC.find(h => h.name === "HARDWARE PACK HIGH BACK DRAWER H175 SET/1");
if (!hwLowC || hwLowC.qty !== 2) throw new Error("Expected H90 qty 2 (DPN)");
if (!hwSemiC || hwSemiC.qty !== 3) throw new Error("Expected H175 qty 3 (DPN)");
console.log("Scenario C Passed!");

// Scenario D: "2hb1bl" = 2 High Back boxes (standard, faced by the HB shutters → NO fascia)
// + 1 built-in Low Back (WITH fascia 110). Only the low back has a fascia.
console.log("\n--- Scenario D: DW-3dr Inbuilt=2hb1bl (2 HB standard + 1 LB built-in) ---");
const panelsD = [], profilesD = [], hardwareD = [], consD = [], pkRowsD = [];
addDrawerBoxes("BC", "DW", { id: "3dr", p3: "2LB", p4: "1HB" }, 600, 560, 15, panelsD, profilesD, hardwareD, consD, pkRowsD, "Lian", "2hb1bl");

const dpHighD = pkRowsD.find(r => r[1] === "Drawer Pack- Cab Drawer Box High");
const dpLowD = pkRowsD.find(r => r[1] === "Drawer Pack- Cab Drawer Box Low");
if (!dpHighD || dpHighD[3] !== 2) throw new Error("Expected 2hb1bl Drawer Pack High qty 2");
if (!dpLowD || dpLowD[3] !== 1) throw new Error("Expected 2hb1bl Drawer Pack Low qty 1");
if (pkRowsD.filter(r => r[1].startsWith("Drawer Pack-")).length !== 2) throw new Error("Expected exactly 2 Drawer Packs for 2hb1bl");

const mergedD = mergePanels(panelsD);
// Fascia ONLY for the built-in Low Back; the 2 High Backs are standard (no fascia).
const fasciaHighD = mergedD.find(p => p.name.includes("Fascia High"));
const fasciaLowD = mergedD.find(p => p.h === 110 && p.name.includes("Fascia Low"));
if (fasciaHighD) throw new Error("High Back must NOT have a fascia for 2hb1bl");
if (!fasciaLowD || fasciaLowD.w !== 562 || fasciaLowD.qty !== 1) throw new Error("Expected exactly 1 Low fascia 110x562");
// Back panels: 2HB+1BL → the "High" pack takes the LOW config, so BOTH back panels are 63.
// High pack back 63 (qty2), built-in Low back 63 (qty1).
const backHighD = mergedD.find(p => p.name.includes("Back High"));
const backLowD = mergedD.find(p => p.name.includes("Back Low"));
if (!backHighD || backHighD.h !== 63 || backHighD.qty !== 2) throw new Error("Expected 2 High-pack back panels at h=63 (Low config)");
if (!backLowD || backLowD.h !== 63 || backLowD.qty !== 1) throw new Error("Expected 1 Low Back (63) panel");
if (mergedD.find(p => p.h === 212)) throw new Error("2hb1bl must NOT have any 212 back panel (High takes Low config)");
// Hardware: the 2 High fronts are shutter-faced → their runner hardware lives on the shutter,
// NOT the Drawer Pack. Only the built-in Low (fascia) keeps its hardware here → H90 qty 1, no H239.
const hwHighD = hardwareD.find(h => h.name === "HARDWARE PACK HIGH BACK DRAWER H239 SET/1");
const h90TotalD = hardwareD.filter(h => h.name === "HARDWARE PACK LOW BACK DRAWER H90 SET/1").reduce((s, h) => s + h.qty, 0);
if (hwHighD) throw new Error("2hb1bl must NOT use H239 (High pack takes Low config)");
if (h90TotalD !== 1) throw new Error("Expected H90 total qty 1 (only the built-in Low keeps hardware)");
console.log("Scenario D Passed!");

// ===================== Architecture Tests =====================
console.log("\n=== RUNNING ARCHITECTURE TESTS (BOM TREE & ZOHO SYNC) ===");

const mockCabinetModel = {
  code: "BC-DW-2LB-1HB",
  panels: mergePanels(panelsA), profiles: profilesA, hardware: hardwareA, cons: consA, pkRows: pkRowsA,
  carcassMat: "STONE", W: 600, H: 720, D: 560, t: 15
};

const bomRows = mockBuildFullBomData(mockCabinetModel, 1);

// Single Drawer Pack per variant at Level 1 (Low + High = 2); no Set of Parts
const drawerPackRows = bomRows.filter(r => r.level === 1 && r.name.startsWith("Drawer Pack- Cab Drawer Box"));
if (drawerPackRows.length !== 2) throw new Error("Expected 2 Drawer Pack rows at Level 1 (Low + High)");
if (bomRows.some(r => r.name.startsWith("Set of Parts- Cab Drawer Box"))) throw new Error("No Set of Parts rows must exist for drawer boxes");

// Level-1 pack quantity equals drawer count
const lowPackRow = drawerPackRows.find(r => r.name.endsWith("Low"));
const highPackRow = drawerPackRows.find(r => r.name.endsWith("High"));
if (lowPackRow.qty !== 2) throw new Error("Drawer Pack Low Level-1 qty must equal drawer count 2");
if (highPackRow.qty !== 1) throw new Error("Drawer Pack High Level-1 qty must equal drawer count 1");

// Each Drawer Pack nests: back (Part->panel), bottom (flat panel), DBS set, DBC flat, hardware
drawerPackRows.forEach(r => {
  const children = bomRows.filter(x => x.parent === r.name);
  const backPart = children.find(c => c.level === 2 && c.name.includes("Back") && c.name.includes("(JD)"));
  const bottomFlat = children.find(c => c.level === 2 && c.name.includes("Bottom"));
  const dbsSet = children.find(c => c.level === 2 && c.type === "DBS");
  const dbcFlat = children.find(c => c.level === 2 && c.type === "DBC");
  const hw = children.find(c => c.level === 2 && c.name.startsWith("HARDWARE PACK"));
  if (!backPart) throw new Error(`Expected drilled Back Part under ${r.name}`);
  if (!bottomFlat) throw new Error(`Expected flat Bottom panel under ${r.name}`);
  if (!dbsSet || !dbsSet.name.startsWith("Set of Profile Parts")) throw new Error(`Expected DBS Set wrapper under ${r.name}`);
  if (!dbcFlat) throw new Error(`Expected flat DBC profile under ${r.name}`);
  // These (Scenario A) are shutter-faced drawers, so runner hardware lives on the shutter, not
  // the pack. If a pack DOES carry hardware (built-in/fascia drawers), it must nest at Level 2 qty 1.
  if (hw && hw.qty !== 1) throw new Error(`Hardware per-drawer qty must be 1 under ${r.name}`);
  // per-parent (per-drawer) quantities: back 1, bottom 1, DBC 4
  if (backPart.qty !== 1) throw new Error(`Back per-drawer qty must be 1 under ${r.name}`);
  if (bottomFlat.qty !== 1) throw new Error(`Bottom per-drawer qty must be 1 under ${r.name}`);
  if (dbcFlat.qty !== 4) throw new Error(`DBC per-drawer qty must be 4 under ${r.name}`);
});

// Drawer hardware is NESTED only (no flat Level-1 hardware rows for drawer packs)
const flatDrawerHw = bomRows.filter(r => r.level === 1 && r.name.startsWith("HARDWARE PACK"));
if (flatDrawerHw.length !== 0) throw new Error("Drawer hardware must NOT be flat at Level 1 (nested under pack)");
console.log("BOM Tree Architecture Verification Passed!");

// Zoho SO integration structure
const { packetCompositeIds } = mockHandleAddToZohoSO(mockCabinetModel);
const dpLowSO = packetCompositeIds.find(i => i.item_id.startsWith("Drawer Pack- Cab Drawer Box Low STONE"));
const dpHighSO = packetCompositeIds.find(i => i.item_id.startsWith("Drawer Pack- Cab Drawer Box High STONE"));
if (packetCompositeIds.some(i => i.item_id.startsWith("Set of Parts- Cab Drawer Box"))) throw new Error("No Set of Parts composite must exist for drawers");
if (!dpLowSO || dpLowSO.quantity !== 2) throw new Error("Expected Drawer Pack Low composite qty 2");
if (!dpHighSO || dpHighSO.quantity !== 1) throw new Error("Expected Drawer Pack High composite qty 1");
console.log("Zoho SO Architecture Verification Passed!");

// ===================== Pullout Shelf Pantry (PPN) — legacy structure unchanged =====================
console.log("\n--- Testing Tall PO Shelf Pantry (PPN) Cabinet ---");
const panelsE = [], profilesE = [], hardwareE = [], consE = [], pkRowsE = [];
const W_E = 600, D_E = 560, t_E = 15;
const setOfPartsNameE = "Set of Parts- Cab Pullout Shelf";
const drawerPackNameE = "Drawer Pack- Cab Pullout Shelf";
const poW = W_E - 60, poD = D_E - 40, sideStripW = D_E - 55, sideStripH = 15;
const frontStripW = W_E - 60, frontStripH = 60, spacerW = D_E - 80, spacerH = 50;

for (let i = 0; i < 4; i++) {
  panelsE.push({ name: `Panels- Cab PO Shelf Base ${poW}x${poD}x${t_E}`, w: poW, h: poD, qty: 1, drill: null, pack: setOfPartsNameE, t: t_E });
  panelsE.push({ name: `Panels- Cab PO Shelf Side Strip ${sideStripW}x${sideStripH}x${t_E}`, w: sideStripW, h: sideStripH, qty: 2, drill: null, pack: setOfPartsNameE, t: t_E });
  panelsE.push({ name: `Panels- Cab PO Shelf Front Strip ${frontStripW}x${frontStripH}x${t_E}`, w: frontStripW, h: frontStripH, qty: 1, drill: null, pack: setOfPartsNameE, t: t_E });
  panelsE.push({ name: `Panels- Cab PO Shelf Spacer ${spacerW}x${spacerH}x${t_E}`, w: spacerW, h: spacerH, qty: 1, drill: null, pack: setOfPartsNameE, t: t_E });
  hardwareE.push({ name: "Quadro channel set", qty: 1, pack: drawerPackNameE });
}
pkRowsE.push(["panel", setOfPartsNameE, "Set", 1, "Set"]);
pkRowsE.push(["panel", drawerPackNameE, "Set", 1, "Set"]);

const mockPPNModel = {
  code: "TC-PO-2SX-LHS-4PO-600-2400-560-15",
  panels: mergePanels(panelsE), profiles: profilesE, hardware: hardwareE, cons: consE, pkRows: pkRowsE,
  carcassMat: "STONE", W: W_E, H: 2400, D: D_E, t: t_E
};

const bomRowsE = mockBuildFullBomData(mockPPNModel, 1);
const setOfPartsRowE = bomRowsE.find(r => r.level === 1 && r.name === setOfPartsNameE);
if (!setOfPartsRowE || setOfPartsRowE.qty !== 1) throw new Error("Expected Set of Parts row at Level 1 with qty 1");
const dpRowE = bomRowsE.find(r => r.level === 1 && r.name === drawerPackNameE);
if (!dpRowE || dpRowE.qty !== 1) throw new Error("Expected Drawer Pack at Level 1 with qty 1");
console.log("PPN BOM Tree Architecture Verification Passed!");

const zohoE = mockHandleAddToZohoSO(mockPPNModel);
const dpSOE = zohoE.packetCompositeIds.find(i => i.item_id.startsWith("Drawer Pack- Cab Pullout Shelf"));
if (!dpSOE || dpSOE.quantity !== 4) throw new Error("Expected Pullout Drawer Pack composite qty 4");
console.log("PPN Zoho SO Architecture Verification Passed!");

console.log("\nALL TESTS PASSED SUCCESSFULLY!");
