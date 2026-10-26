const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const lib = path.join(__dirname, "../src/lib");
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const code = ts.transpileModule(fs.readFileSync(path.join(lib, `${name}.ts`), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  cache.set(name, module.exports);
  new Function("require", "module", "exports", code)(
    (id) => id === "./kitchen-materials" ? load("kitchen-materials")
      : id === "./costing" ? load("costing")
      : id === "@/lib/costing" ? load("costing")
      : id === "@/data/costing_master.json" ? require(path.join(__dirname, "../src/data/costing_master.json"))
      : require(id), module, module.exports,
  );
  cache.set(name, module.exports);
  return module.exports;
}

const { materialsFromImportedCabinets } = load("imported-kitchen-materials");
const cabinet = {
  zk: "BC", fk: "SH", board: "KITCHEN-001", backBoardId: "KITCHEN-031",
  drawerBoardId: "KITCHEN-023", shType: "KITCHEN-008", visibleSideMaterialId: "KITCHEN-008",
  hingeChoice: "Hafele Soft Close", drawerModel: "Hettich", handle: "HANDLE", handlePrice: "150", handleBrand: "",
  boardPrices: {
    back: { itemId: "KITCHEN-031", sheetPrice: "1121.28", finish: "Walnut" },
    drawer: { itemId: "KITCHEN-023", sheetPrice: "2112" },
  },
  carcassLamFrontSheetPrice: "550", carcassLamBackSheetPrice: "550",
  backLamFrontSheetPrice: "500", backLamBackSheetPrice: "520",
  drawerLamFrontSheetPrice: "600", drawerLamBackSheetPrice: "620",
  shutterLamFrontSheetPrice: "1800", shutterLamBackSheetPrice: "961",
  visibleLamFrontSheetPrice: "1900", visibleLamBackSheetPrice: "900",
};
const { materials, conflictingZones } = materialsFromImportedCabinets([cabinet]);
assert.equal(materials.Base.carcass.itemId, "KITCHEN-001");
assert.equal(materials.Base.back.itemId, "KITCHEN-031");
assert.equal(materials.Base.back.boardFinish, "Walnut");
assert.equal(materials.Base.drawer.itemId, "KITCHEN-023");
assert.equal(materials.Base.shutter.itemId, "KITCHEN-008");
assert.equal(materials.Base.back.boardSheetPrice, "1121.28");
assert.equal(materials.Base.drawer.boardSheetPrice, "2112");
assert.equal(materials.Base.back.frontSheetPrice, "500");
assert.equal(materials.Base.drawer.frontSheetPrice, "600");
assert.equal(materials.Tall.drawer.itemId, "KITCHEN-023");
assert.equal(materials._sources.Tall, "Own");
assert.equal(materials._hingeChoice, "Hafele Soft Close");
assert.equal(materials._drawerBrand, "Hettich");
for (const zone of ["Base", "Wall", "Tall", "Loft"]) {
  assert.deepEqual(materials._handleDefaults[zone], { type: "HANDLE", price: "150", brand: "" });
}
assert.deepEqual(conflictingZones, []);

const mixed = materialsFromImportedCabinets([
  cabinet,
  { ...cabinet, zk: "WC", shType: "KITCHEN-014", visibleSideMaterialId: "KITCHEN-014" },
  { ...cabinet, zk: "WC", shType: "KITCHEN-008" },
]);
assert.equal(mixed.materials.Base.shutter.itemId, "KITCHEN-008");
assert.equal(mixed.materials.Wall.shutter.itemId, "KITCHEN-014");
assert.deepEqual(mixed.conflictingZones, ["Wall"]);
assert.deepEqual(mixed.conflictingHandleZones, []);
assert.equal(mixed.conflictingHinges, false);
assert.equal(mixed.conflictingDrawerBrands, false);
const mixedHardware = materialsFromImportedCabinets([
  cabinet,
  { ...cabinet, zk: "WC", hingeChoice: "Blum Soft Close", drawerModel: "Blum", handle: "KNOB", handlePrice: "80" },
  { ...cabinet, zk: "WC", handle: "PUSH", handlePrice: "120", handleBrand: "Hafele" },
]);
assert.deepEqual(mixedHardware.conflictingHandleZones, ["Wall"]);
assert.equal(mixedHardware.conflictingHinges, true);
assert.equal(mixedHardware.conflictingDrawerBrands, true);
const special = materialsFromImportedCabinets([
  { ...cabinet, zk: "WC", fk: "WOP", board: "KITCHEN-014" },
  { ...cabinet, zk: "WC", fk: "WGL", board: "KITCHEN-014", glassType: "KITCHEN-GLASS-5-CLEAR", glassPricePerSqft: "210" },
  { ...cabinet, zk: "BC", fk: "SK", sinkStoneFullBack: false,
    edgeBand: { finish: "Oak 0.8mm", carcassPricePerRmt: "8", shutterPricePerRmt: "14.2" } },
], materials);
assert.equal(special.materials.Wall.carcass.itemId, materials.Wall.carcass.itemId);
assert.equal(special.materials._wallOpen.carcass.itemId, "KITCHEN-014");
assert.equal(special.materials._wallGlass.glass.pricePerSqft, "210");
assert.equal(special.materials._sinkStoneFullBack, false);
assert.equal(special.materials.Sink.edgeBand.finish, "Oak 0.8mm");
const olderOpen = materialsFromImportedCabinets([
  { ...cabinet, zk: "WC", fk: "WOP", board: "KITCHEN-007", shType: "KITCHEN-014" },
  { ...cabinet, zk: "WC", fk: "WGL", board: "KITCHEN-007", shType: "KITCHEN-014", glassType: "KITCHEN-GLASS-5-CLEAR", glassPricePerSqft: "210" },
], materials);
assert.equal(olderOpen.materials._wallOpen.carcass.itemId, materials.Wall.shutter.itemId);
assert.equal(olderOpen.materials._wallGlass.carcass.itemId, materials.Wall.shutter.itemId);
assert.equal(olderOpen.materials._wallGlass.glass.pricePerSqft, "210");
const missingGlass = materialsFromImportedCabinets([
  { ...cabinet, zk: "WC", fk: "WGL", board: "KITCHEN-007", shType: "KITCHEN-014", glassType: undefined, glassPricePerSqft: undefined },
]);
assert.equal(missingGlass.materials._wallGlass.carcass.itemId, missingGlass.materials.Wall.shutter.itemId);
assert.equal(missingGlass.materials._wallGlass.glass.itemId, "KITCHEN-GLASS-5-TINTED");
const missingBoardSelections = materialsFromImportedCabinets([{ ...cabinet,
  board: undefined, backBoardId: undefined, drawerBoardId: undefined, shType: undefined,
  visibleSideMaterialId: undefined, carcassLamFrontSheetPrice: undefined,
  carcassLamBackSheetPrice: undefined, shutterLamFrontSheetPrice: undefined,
}], materials);
assert.equal(missingBoardSelections.materials.Base.carcass.itemId, materials.Base.carcass.itemId);
assert.equal(missingBoardSelections.materials.Base.shutter.itemId, materials.Base.shutter.itemId);
assert.equal(missingBoardSelections.materials.Base.carcass.frontSheetPrice, materials.Base.carcass.frontSheetPrice);
console.log("Imported material selection: OK");
