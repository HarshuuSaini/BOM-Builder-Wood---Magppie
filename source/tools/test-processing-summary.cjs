const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/lib/processing-summary.ts');
const loaded = new Module(file, module);
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { summarizeProcessingCosts } = loaded.exports;
const detail = (billableQty, rate, itemCode = 'BOARD-PROC', item = 'Prelam Particle BSL-18mm') => ({
  category: 'Carcass / shelf material processing', itemCode, item, billableQty, rate, amount: billableQty * rate, uom: 'sqft',
});
const lines = [
  { details: [detail(17.39, 36), { ...detail(15.3, 99), category: 'Carcass board' }] },
  { details: [detail(13.38, 36), { ...detail(5.48, 12.59375, 'BACK-PROC', 'Prelam Particle BSL-8mm'), category: 'Carcass back material processing' }] },
  { details: [{ ...detail(8.11, 36), category: 'Shutter material processing' }, detail(10, 42.3), detail(20, 36, 'OTHER-PROC', 'Prelam MDF BSL-18mm')] },
  { details: [detail(12, 12.6, 'COUNTER-PROC', 'Counter Ply')] },
];
const before = JSON.stringify(lines);
const rows = summarizeProcessingCosts(lines);
assert.equal(rows.length, 5);
assert.equal(rows[0].sqft, 17.39 + 13.38 + 8.11, 'Includes billable wastage and merges across cabinets/categories');
assert.equal(rows[0].rate, 36);
assert.equal(rows[0].total, (17.39 + 13.38 + 8.11) * 36);
assert.equal(rows.find(row => row.rate === 42.3).sqft, 10, 'Different rates stay separate');
assert.equal(rows.find(row => row.material === 'Counter Ply').total, 151.2);
assert.equal(JSON.stringify(lines), before, 'Display must not modify costing/export data');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8);
near(rows.reduce((sum, row) => sum + row.total, 0), lines.flatMap(line => line.details).filter(row => /processing$/i.test(row.category)).reduce((sum, row) => sum + row.amount, 0));
assert.deepEqual(summarizeProcessingCosts([]), []);
assert.equal(summarizeProcessingCosts([lines[1]])[0].sqft, 13.38, 'A filtered elevation only summarizes its own lines');
const source = fs.readFileSync(path.resolve(__dirname, '../src/components/WoodBomBuilder.tsx'), 'utf8');
assert.ok(source.includes('head={["Material", "Combined sqft (+waste)", "Processing rate (Rs/sqft)", "Total processing cost (Rs)"]}'));
console.log('Processing summary: four columns, combined billable area, separate material/rates, Counter Ply, elevation filtering and unchanged totals passed.');
