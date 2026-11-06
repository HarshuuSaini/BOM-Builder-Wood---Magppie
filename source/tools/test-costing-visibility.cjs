const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const filename = path.join(__dirname, "..", "src", "lib", "costing-visibility.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, structuredClone }, { filename });
const { stripDesignerProjectRows, exposeSavedCosting, showsProjectPricing } = loaded.exports;
const plain = value => JSON.parse(JSON.stringify(value));

function freezeDeep(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

const pricing = {
  conversionPct: 15, profitPct: 25, transportation: { mode: "direct", value: 300 },
  installation: { mode: "sqft", value: 50 }, loading: { mode: "direct", value: 100 }, includeTax: true,
  processingRates: { "Carcass|plywood": 12, "Counter Ply": 6 },
  futurePrivateFactor: 789,
};
const settings = { name: "Kitchen", waste: { board: 10 }, current: { qty: 2 }, pricing };
const rows = freezeDeep([
  { "Record Type": "format", Data: '{"version":2}' },
  { "Record Type": "settings", Data: JSON.stringify(settings), extra: "preserve" },
  { "Record Type": "cabinet", Data: '{"boardPrices":{"plywood":100},"qty":2}' },
  { "Record Type": "raw-selection", Data: '{"id":"board-1"}' },
]);
const originalRows = plain(rows);
const stripped = stripDesignerProjectRows(rows);
const designerSettings = JSON.parse(stripped[1].Data);
assert.equal(Object.hasOwn(designerSettings, "pricing"), false);
assert.deepEqual(designerSettings.itemProcessingRates, pricing.processingRates);
assert.deepEqual(designerSettings.waste, settings.waste);
assert.deepEqual(designerSettings.current, settings.current);
assert.equal(designerSettings.name, "Kitchen");
assert.equal(stripped[1].extra, "preserve");
for (const index of [0, 2, 3]) assert.deepEqual(plain(stripped[index]), originalRows[index]);
assert.deepEqual(plain(rows), originalRows);
assert.notEqual(stripped, rows);
assert.deepEqual(plain(stripDesignerProjectRows(stripped)), plain(stripped), "Projection must be idempotent");

// Legacy settings, empty overrides and already-projected processing rates remain restorable.
for (const value of [
  { pricing: { processingRates: {} } },
  { itemProcessingRates: { plywood: 9 }, pricing: { profitPct: 99 } },
  { name: "Legacy" },
  { pricing: null },
  { pricing: { processingRates: { plywood: 0 } } },
  { itemProcessingRates: null },
  { itemProcessingRates: [] },
  { itemProcessingRates: { plywood: 9 }, pricing: { processingRates: { plywood: 12 } } },
]) {
  const output = JSON.parse(stripDesignerProjectRows([{ "Record Type": "settings", Data: JSON.stringify(value) }])[0].Data);
  assert.equal(Object.hasOwn(output, "pricing"), false);
  assert.ok(output.itemProcessingRates && typeof output.itemProcessingRates === "object" && !Array.isArray(output.itemProcessingRates));
  if (value.itemProcessingRates && !Array.isArray(value.itemProcessingRates) && !value.pricing?.processingRates) assert.deepEqual(output.itemProcessingRates, value.itemProcessingRates);
  if (value.pricing?.processingRates) assert.deepEqual(output.itemProcessingRates, value.pricing.processingRates);
}
for (const data of ['{"pricing":{"profitPct":99}', "null", "[]", '"invalid"']) {
  assert.deepEqual(JSON.parse(stripDesignerProjectRows([{ "Record Type": "settings", Data: data }])[0].Data), { itemProcessingRates: {} });
}

const privateFields = ["conversion", "profit", "transportation", "installation", "loading", "tax", "total", "combinedSubtotal", "convertedCost", "subtotal", "grandTotal", "finalTotal"];
const charges = Object.fromEntries(privateFields.map((key, index) => [key, 101 + index]));
const summary = {
  id: "saved-1", owner: "designer", version: 3, name: "Kitchen", createdAt: "2026-10-27",
  updatedAt: "2026-10-27", updatedBy: "admin", sourceName: "kitchen.pdf", areaSqft: 20,
  materialCost: 200, cabinetCount: 1, ...charges,
};
const saved = freezeDeep({
  ...summary,
  entry: {
    id: "workspace-1", name: "Kitchen", savedCostingId: "saved-1", savedCostingVersion: 3,
    rows, materials: { boards: [{ id: "board-1", rate: 100 }] }, boardSheetInputs: { "board-1": "100" },
    costing: { ...charges, areaSqft: 20, materialCost: 200,
      items: [{ category: "processing", item: "Board processing", unit: "sqft", quantity: 20, rate: 12, amount: 240 }],
      unpriced: ["Handle"],
    },
    manualCosting: { filename: "user-import.xlsx", rows: [{ item: "Plywood", amount: 100 }],
      extraCharges: [{ id: 1, label: "User imported delivery", amount: 50 }],
    },
  },
});
const original = plain(saved);
const exposed = exposeSavedCosting(saved, "user");
assert.notEqual(exposed, saved);
assert.notEqual(exposed.entry, saved.entry);
assert.notEqual(exposed.entry.costing, saved.entry.costing);
for (const field of privateFields) {
  assert.equal(Object.hasOwn(exposed, field), false, `Summary must omit ${field}`);
  assert.equal(Object.hasOwn(exposed.entry.costing, field), false, `Snapshot must omit ${field}`);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(exposed)), field), false);
}
for (const field of ["id", "owner", "version", "name", "areaSqft", "materialCost", "cabinetCount", "createdAt", "updatedAt", "updatedBy", "sourceName"]) {
  assert.deepEqual(exposed[field], summary[field]);
}
assert.deepEqual(plain(exposed.entry.rows), plain(stripped));
for (const field of ["materials", "boardSheetInputs", "manualCosting"]) {
  assert.deepEqual(plain(exposed.entry[field]), original.entry[field]);
}
for (const field of ["areaSqft", "materialCost", "items", "unpriced"]) {
  assert.deepEqual(plain(exposed.entry.costing[field]), original.entry.costing[field]);
}
assert.deepEqual(plain(saved), original, "Projection must not change the server snapshot");
exposed.entry.materials.boards[0].rate = 999;
exposed.entry.costing.items[0].amount = 999;
exposed.entry.manualCosting.extraCharges[0].amount = 999;
assert.deepEqual(plain(saved), original, "Editing a designer view must not mutate server data");

const exposedSummary = exposeSavedCosting(freezeDeep(summary), "user");
assert.equal(Object.hasOwn(exposedSummary, "entry"), false, "List summaries need no entry");
for (const field of privateFields) assert.equal(Object.hasOwn(exposedSummary, field), false);
assert.equal(exposedSummary.materialCost, 200);
assert.equal(exposedSummary.areaSqft, 20);
assert.deepEqual(plain(exposeSavedCosting({ id: "no-snapshot", entry: { rows: [] } }, "user")), { id: "no-snapshot", entry: { rows: [] } });
assert.equal(exposeSavedCosting(saved, "admin"), saved);
assert.deepEqual(plain(exposeSavedCosting(saved, "admin")), original);
assert.equal(exposeSavedCosting(summary, "admin"), summary);
assert.equal(showsProjectPricing("user", true), false, "Local designers see item cost only");
assert.equal(showsProjectPricing("admin", true), true);
assert.equal(showsProjectPricing("user", false), true, "Without local accounts (production) everyone keeps the full pricing view");
console.log("Costing visibility passed: designer factors/totals omitted, processing/materials/imports retained, summaries supported, admin full and server data unchanged; production keeps full pricing.");
