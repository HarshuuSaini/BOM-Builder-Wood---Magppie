const assert = require('node:assert/strict');
const master = require('../src/data/costing_master.json');
const byId = id => master.items.find(item => item.id === id);
const expected = {
  'KITCHEN-004': 2201.91, 'KITCHEN-011': 2201.91,
  'KITCHEN-026': 2202, 'KITCHEN-037': 1116,
  'KITCHEN-029': 2412, 'KITCHEN-035': 1399.51,
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
  'KITCHEN-007': 81.6375, 'KITCHEN-012': 115.25,
  'KITCHEN-013': 53.75, 'KITCHEN-014': 166.8125,
  'KITCHEN-028': 71.13, 'KITCHEN-034': 49.25,
  'KITCHEN-036': 20.97, 'KITCHEN-015': 251.7775,
  'KITCHEN-019': 500,
})) assert.equal(byId(id).currentRate, rate, id);
assert(master.items.every(item => item.currentRate >= 0));
console.log('PASS: raw-board rates, matching HDHMR rates and protected prices.');
