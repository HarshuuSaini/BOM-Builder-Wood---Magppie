const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const master = require('../src/data/costing_master.json');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { selectedBoardRate } = require(path.resolve(__dirname, '../src/lib/kitchen-materials.ts'));
const byId = id => master.items.find(item => item.id === id);
const expected = {
  'KITCHEN-004': 2201.91, 'KITCHEN-011': 2201.91,
  'KITCHEN-026': 2202, 'KITCHEN-037': 1116,
  'KITCHEN-029': 2412, 'KITCHEN-035': 1399.51,
  'KITCHEN-030': 2612.3,
};
for (const [id, price] of Object.entries(expected)) {
  const item = byId(id);
  assert.equal(item.price, price, id);
  assert.equal(item.currentRate, price / 32, id);
  assert.equal(item.sqftPrice, price / 32, id);
}
// Protected raw prices and finishes must not receive a laminate deduction.
for (const [id, rate] of Object.entries({
  'KITCHEN-005': 99.625, 'KITCHEN-006': 71.21875,
  'KITCHEN-007': 81.6375, 'KITCHEN-012': 99.625,
  'KITCHEN-013': 71.21875, 'KITCHEN-014': 81.6375,
  'KITCHEN-028': 71.13, 'KITCHEN-034': 49.25,
  'KITCHEN-036': 20.97, 'KITCHEN-015': 251.7775,
  'KITCHEN-019': 500,
})) assert.equal(byId(id).currentRate, rate, id);
assert(master.items.every(item => item.currentRate >= 0));
for (const type of ['Prelam', 'Postlam']) {
  const item = { id: 'TEST-BOARD', type, currentRate: 50 };
  assert.equal(selectedBoardRate(item, { itemId: item.id, sheetPrice: '2400' }), 75,
    `${type} selected sheet price must drive costing`);
  assert.equal(selectedBoardRate(item, { itemId: 'OTHER-BOARD', sheetPrice: '2400' }), 50,
    `${type} overrides must be item-specific`);
}
assert.equal(selectedBoardRate({ id: 'PU-BOARD', type: 'PU', currentRate: 50 },
  { itemId: 'PU-BOARD', sheetPrice: '2400' }), 50, 'PU pricing must remain unchanged');
for (const shutter of master.items.filter(item => item.group === 'Shutter Material')) {
  const carcass = master.items.find(item => item.group === 'Carcass/ Shelf Material' && item.subgroup === shutter.subgroup && item.thicknessMm === shutter.thicknessMm);
  if (!carcass) continue;
  for (const field of ['price', 'sqftPrice', 'currentRate']) assert.equal(shutter[field], carcass[field], `${shutter.id} ${field}`);
}
console.log('PASS: raw-board rates, all matching carcass/shutter rates and protected unmatched finishes.');
