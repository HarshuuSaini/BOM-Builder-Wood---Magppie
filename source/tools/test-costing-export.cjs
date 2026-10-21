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

const { exportCostingWorkbook } = loadTypeScript(path.join(libDir, "export.ts"));
const originalWrite = XLSX.writeFile;
let workbook;
XLSX.writeFile = (result) => { workbook = result; };
try {
  const detail = { category: "Carcass board", itemCode: "BOARD-1", item: "Test board",
    specification: "test", netQty: 64, wastePct: 0, billableQty: 64,
    allocatedBillableQty: 64, uom: "sqft", rate: 100, amount: 6400 };
  const pricing = { cabinetSqft: 10, fillerSqft: 0, totalSqft: 10, baseCost: 6400,
    conversion: 640, profit: 352, transportation: 20, installation: 100,
    loading: 0, subtotal: 7512, tax: 1352.16, grandTotal: 8864.16 };
  exportCostingWorkbook([{ label: "AA · Test cabinet", code: "TEST", qty: 1,
    unitCost: 6400, cost: 6400, details: [detail] }], [{ eachSqft: 10, sqft: 10 }], pricing, [], {
    conversionPct: 10, profitPct: 5, transportation: { mode: "sqft", value: 2 },
    installation: { mode: "direct", value: 100 }, loading: { mode: "direct", value: 0 }, includeTax: true,
  });
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
assert.equal(ws("Project Pricing").B6.f, "B4*B5/100");
assert.equal(ws("Project Pricing").B8.f, "(B4+B6)*B7/100");
assert.equal(ws("Project Pricing").B11.f, 'IF(B9="sqft",B10*B3,B10)');
assert.equal(ws("Project Pricing").B21.f, "B18*B19*B20/100");
assert.equal(ws("Project Pricing").B22.f, "B18+B21");
assert.equal(ws("Manual Comparison").H13.f, "'Project Pricing'!B22");
assert.match(ws("Cabinet Items").O2.f, /'Consolidated Items'!L2/);
assert.match(ws("Cabinet Summary").G2.f, /'Cabinet Items'!O2:O2/);
assert.equal(ws("Project Pricing").B22.v, 8864.16);

const reopened = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
assert.equal(reopened.Sheets["Project Pricing"].B22.f, "B18+B21");
assert.equal(reopened.Sheets["Consolidated Items"].H2.f, "ROUND(E2/G2,2)");
console.log("Costing workbook formulas and XLSX round-trip passed.");
