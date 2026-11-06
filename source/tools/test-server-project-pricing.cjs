const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
require('./test-purchase-rounding.cjs');

const filename = path.join(__dirname, "..", "src", "lib", "server-project-pricing.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require: name => require(path.resolve(path.dirname(filename), name)) }, { filename });
const { priceDesignerCosting } = loaded.exports;
const plain = value => JSON.parse(JSON.stringify(value));
function freezeDeep(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
const settingsFor = entry => JSON.parse(entry.rows.find(row => row["Record Type"] === "settings").Data);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);
function fixture(settings = {}) {
  return {
    id: "workspace-1", name: "Kitchen", materials: { boards: [{ id: "plywood", rate: 100 }] },
    rows: [{ "Record Type": "settings", Data: JSON.stringify({ name: "Kitchen", waste: { board: 10 }, ...settings }) },
      { "Record Type": "cabinet", Data: '{"qty":1,"boardPrices":{"plywood":100}}' }],
    costing: {
      materialCost: 100000, areaSqft: 100,
      conversion: 999, profit: 999, transportation: 999, installation: 999, loading: 999, tax: 999, total: 999,
      items: [{ category: "processing", item: "Plywood processing", quantity: 100, rate: 12, amount: 1200 }],
      unpriced: ["Handle"],
    },
  };
}

const defaults = {
  conversionPct: 40, conversionModel: 'margin', includeTax: false,
  transportation: { mode: "sqft", value: 15 }, installation: { mode: "sqft", value: 95 }, loading: { mode: "sqft", value: 5 },
};
const hostileFactors = {
  conversionPct: 0, profitPct: 999, includeTax: true,
  transportation: { mode: "direct", value: 999999 }, installation: { mode: "direct", value: 999999 }, loading: { mode: "direct", value: 999999 },
};
const processingRates = { "Carcass|plywood": 12, "Counter Ply": 0 };
for (const incomingSettings of [{}, { itemProcessingRates: processingRates }, { pricing: { ...hostileFactors, processingRates } }]) {
  const incoming = freezeDeep(fixture(incomingSettings));
  const before = plain(incoming);
  const result = priceDesignerCosting(incoming);
  close(result.costing.total, 111500 / 0.6);
  assert.equal(result.costing.transportation, 1500);
  assert.equal(result.costing.installation, 9500);
  assert.equal(result.costing.loading, 500);
  close(result.costing.conversion, 111500 / 0.6 - 111500);
  assert(!('profit' in result.costing));
  assert.equal(result.costing.tax, 0);
  const actualSettings = settingsFor(result);
  const expectedRates = incomingSettings.itemProcessingRates ?? incomingSettings.pricing?.processingRates ?? {};
  assert.deepEqual(actualSettings.pricing, { ...defaults, processingRates: expectedRates });
  assert.equal(Object.hasOwn(actualSettings, "itemProcessingRates"), false);
  assert.deepEqual(plain(incoming), before, "Normalization must not mutate the client snapshot");
  assert.deepEqual(plain(result.costing.items), before.costing.items);
  assert.deepEqual(plain(result.materials), before.materials);
  assert.deepEqual(plain(result.rows[1]), before.rows[1]);
}

const approvedFactors = {
  conversionPct: 10, profitPct: 20, includeTax: true,
  transportation: { mode: "direct", value: 300 }, installation: { mode: "sqft", value: 2 }, loading: { mode: "direct", value: 50 },
};
const previous = freezeDeep(fixture({ pricing: { ...approvedFactors, processingRates: { plywood: 7 } } }));
const previousBefore = plain(previous);
const { profitPct: _legacy, ...approvedWithoutProfit } = approvedFactors;
for (const incomingSettings of [
  { pricing: { ...hostileFactors, processingRates } },
  { itemProcessingRates: processingRates },
  { itemProcessingRates: {} },
  {},
]) {
  const incoming = freezeDeep(fixture(incomingSettings));
  const before = plain(incoming);
  const result = priceDesignerCosting(incoming, previous);
  const expectedRates = incomingSettings.pricing?.processingRates ?? incomingSettings.itemProcessingRates ?? { plywood: 7 };
  assert.deepEqual(settingsFor(result).pricing, { ...approvedWithoutProfit, conversionModel: 'margin', processingRates: expectedRates }, "Stored admin factors win; legacy extra percentages are removed");
  assert.equal(result.costing.transportation, 300);
  assert.equal(result.costing.installation, 200);
  assert.equal(result.costing.loading, 50);
  close(result.costing.conversion, 100550 / 0.9 - 100550);
  assert(!('profit' in result.costing));
  close(result.costing.tax, 100550 / 0.9 * 0.18);
  close(result.costing.total, 100550 / 0.9 * 1.18);
  assert.deepEqual(plain(incoming), before);
  assert.deepEqual(plain(previous), previousBefore, "Normalization must not mutate the approved server snapshot");
  assert.deepEqual(plain(result.costing.items), before.costing.items);
  assert.deepEqual(settingsFor(result).waste, { board: 10 });
}

const withoutSnapshot = fixture({ itemProcessingRates: processingRates });
delete withoutSnapshot.costing;
freezeDeep(withoutSnapshot);
const normalized = priceDesignerCosting(withoutSnapshot, previous);
assert.equal(Object.hasOwn(normalized, "costing"), false);
assert.deepEqual(settingsFor(normalized).pricing, { ...approvedWithoutProfit, conversionModel: 'margin', processingRates });
console.log("Server project pricing passed: default total 156100, approved admin factors, processing overrides, retained item costs and no mutation.");
