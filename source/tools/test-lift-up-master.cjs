const assert = require('node:assert/strict');
const master = require('../src/data/costing_master.json');

assert.equal(master.schemaVersion, 1);
assert.equal(master.currency, 'INR');
assert.equal(typeof master.source, 'string');
assert.ok(Number.isFinite(Date.parse(master.generatedAt)));
assert.equal(new Set(master.items.map(item => item.id)).size, master.items.length, 'Master IDs must be unique');
for (const key of ['count', 'itemCount', 'totalItems']) {
  if (key in master) assert.equal(master[key], master.items.length);
}
const expected = [
  ['HARDWARE-032', 'Push Open Fitting Magnetic Pom-40-Gr Ebc', 28, 1],
  ['HARDWARE-033', 'Huwil Lift Duo For Normal Doors 009.024.02173 Grs', 429, 2],
];
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
for (const [id, name, rate, quantity] of expected) {
  const item = master.items.find(item => item.id === id);
  assert.ok(item, `Missing ${id}`);
  for (const field of ['id', 'elevation', 'materialDescription', 'remark', 'unit', 'group', 'subgroup', 'type', 'brand']) {
    assert.equal(typeof item[field], 'string', `${id}.${field}`);
  }
  assert.ok(Number.isInteger(item.sNo));
  assert.equal(item.materialDescription, name);
  assert.equal(item.itemName, name);
  assert.equal(item.group, 'Assembly Hardware');
  assert.equal(item.elevation, 'ASSEMBLY HARDWARE');
  assert.equal(item.rateBasis, 'PCS');
  assert.equal(item.unit.toUpperCase(), 'PCS');
  assert.equal(item.price, rate);
  assert.equal(item.currentRate, rate);
  for (const field of ['sqft', 'sqftPrice', 'thicknessMm']) assert.equal(item[field], null);
  assert.equal(master.items.filter(candidate => [candidate.materialDescription, candidate.itemName]
    .some(value => value && normalize(value) === normalize(name))).length, 1, `Duplicate ${name}`);
  assert.match(item.remark, new RegExp(`${quantity} pieces? per unit`));
}
assert.equal(expected.reduce((total, [id, , , quantity]) => total + master.items.find(item => item.id === id).currentRate * quantity, 0), 886);
assert.ok(master.items.some(item => item.group === 'Hinge' && item.currentRate > 0), 'Existing hinges remain available');
console.log('Lift-up master passed: exact names, unique IDs, Assembly Hardware schema, metadata, PCS rates and 1×28 + 2×429 = INR 886; hinge records retained.');
