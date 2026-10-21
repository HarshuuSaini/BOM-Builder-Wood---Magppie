const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const lib = path.join(__dirname, "../src/lib");
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const code = ts.transpileModule(fs.readFileSync(path.join(lib, `${name}.ts`), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  cache.set(name, module.exports);
  new Function("require", "module", "exports", code)(
    (id) => id === "./kitchen-materials" ? load("kitchen-materials") : require(id), module, module.exports,
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
    back: { itemId: "KITCHEN-031", sheetPrice: "1121.28" },
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
console.log("Imported material selection: OK");
