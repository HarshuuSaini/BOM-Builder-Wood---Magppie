const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const XLSX = require("xlsx-js-style");

const libDir = path.join(__dirname, "..", "src", "lib");
function loadTypeScript(file) {
  const source = fs.readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded.require = (name) => {
    if (name === "@/lib/purchase-rounding") return loadTypeScript(path.join(libDir, "purchase-rounding.ts"));
    if (name === "@/lib/stock") return {};
    return Module.prototype.require.call(loaded, name);
  };
  loaded._compile(compiled, file);
  return loaded.exports;
}

const { exportCostingWorkbook, exportBulkCostingWorkbook } = loadTypeScript(path.join(libDir, "export.ts"));
const originalWrite = XLSX.writeFile;
let workbook;
XLSX.writeFile = (result) => { workbook = result; };
try {
  const detail = { category: "Carcass board", itemCode: "BOARD-1", item: "Test board",
    specification: "test", netQty: 64, wastePct: 0, billableQty: 64,
    allocatedBillableQty: 64, uom: "sqft", rate: 100, amount: 6400 };
  const pricing = { cabinetSqft: 10, fillerSqft: 0, counterPlySqft: 2, totalSqft: 12, baseCost: 6400,
    conversion: 640, profit: 352, transportation: 24, installation: 100,
    loading: 0, subtotal: 7516, tax: 1352.88, grandTotal: 8868.88 };
  exportCostingWorkbook([{ label: "AA · Test cabinet", code: "TEST", qty: 1,
    unitCost: 6400, cost: 6400, details: [detail] }], [{ eachSqft: 10, sqft: 10 }], pricing, [], {
    conversionPct: 10, profitPct: 5, transportation: { mode: "sqft", value: 2 },
    installation: { mode: "direct", value: 100 }, loading: { mode: "direct", value: 0 }, includeTax: true,
  }, "Test kitchen");
} finally {
  XLSX.writeFile = originalWrite;
}

assert.ok(workbook, "costing workbook was not exported");
const ws = (name) => workbook.Sheets[name];
assert.equal(ws("Consolidated Items").H2.f, "ROUND(E2/G2,2)");
assert.equal(ws("Consolidated Items").K2.f, "J2*G2");
assert.equal(ws("Consolidated Items").L2.f, "H2*K2");
assert.equal(ws("Manual Comparison").E5.f, "'Consolidated Items'!K2");
assert.equal(ws("Manual Comparison").G5.f, "'Consolidated Items'!H2");
assert.equal(ws("Project Pricing").B3.v, 2);
assert.equal(ws("Project Pricing").B4.f, "SUM(B1:B3)");
assert.equal(ws("Project Pricing").B4.v, 12);
assert.equal(ws("Project Pricing").B12.v, 24);
assert.equal(ws("Project Pricing").B7.f, "B5*B6/100");
assert.equal(ws("Project Pricing").B9.f, "(B5+B7)*B8/100");
assert.equal(ws("Project Pricing").B12.f, 'IF(B10="sqft",B11*B4,B11)');
assert.equal(ws("Project Pricing").B22.f, "B19*B20*B21/100");
assert.equal(ws("Project Pricing").B23.f, "B19+B22");
assert.equal(ws("Manual Comparison").B2.f, "'Project Pricing'!B4");
assert.equal(ws("Manual Comparison").H13.f, "'Project Pricing'!B23");
assert.match(ws("Cabinet Items").O2.f, /'Consolidated Items'!L2/);
assert.match(ws("Cabinet Summary").G2.f, /'Cabinet Items'!O2:O2/);
assert.equal(ws("Project Pricing").B23.v, 8868.88);

const reopened = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
assert.equal(reopened.Sheets["Project Pricing"].B23.f, "B19+B22");
assert.equal(reopened.Sheets["Consolidated Items"].H2.f, "ROUND(E2/G2,2)");
const bulkItem = (rate, quantity) => ({ category: 'Counter Ply', itemCode: 'KITCHEN-030', item: 'Counter base ply', unit: 'sheet', rate, quantity, amount: rate * quantity });
const bulkKitchen = (name, rate, quantity, areaSqft) => ({ name, areaSqft, materialCost: rate * quantity,
  conversion: 0, profit: 0, transportation: 0, installation: 0, loading: 0, tax: 0,
  total: rate * quantity, unpriced: [], items: [bulkItem(rate, quantity)] });
XLSX.writeFile = result => { workbook = result; };
try {
  exportBulkCostingWorkbook([bulkKitchen('Kitchen A', 2612.3, 2, 12), bulkKitchen('Kitchen B', 2800, 3, 14)]);
} finally { XLSX.writeFile = originalWrite; }
const bulk = workbook.Sheets['Combined Costing'];
assert.equal(bulk.D2.v, 'Kitchen A');
assert.equal(bulk.G2.v, 'Kitchen B');
assert.equal(bulk.D5.v, 2612.3);
assert.equal(bulk.G5.v, 2800);
assert.equal(bulk.F5.f, 'D5*E5');
assert.equal(bulk.I5.f, 'G5*H5');
assert.equal(bulk.F6.v, 5224.6);
assert.equal(bulk.I6.v, 8400);
assert.equal(bulk.A1.s.font.bold, true);
assert.equal(bulk.D2.s.font.bold, true);
assert.equal(bulk.D4.s.font.bold, true);
assert.equal(bulk.D5.s.fill.fgColor.rgb, bulk.F5.s.fill.fgColor.rgb);
assert.notEqual(bulk.D5.s.fill.fgColor.rgb, bulk.G5.s.fill.fgColor.rgb);
assert.notEqual(bulk.D2.s.fill.fgColor.rgb, bulk.G2.s.fill.fgColor.rgb);
console.log("Costing workbook formulas and XLSX round-trip passed.");
