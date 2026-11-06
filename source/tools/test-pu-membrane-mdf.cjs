const assert = require('node:assert/strict');
const { items } = require('../src/data/costing_master.json');

const originals = items.filter((item) => /^(PU|Membrane)\b/.test(item.subgroup) && item.subgroup.includes('HDHMR'));
assert.equal(originals.length, 8);
assert.equal(new Set(items.map((item) => item.id)).size, items.length);
for (const original of originals) {
  const mdf = items.find((item) => item.id === `${original.id}-MDF`);
  assert.ok(mdf, original.itemName);
  for (const field of ['price', 'sqftPrice', 'currentRate', 'thicknessMm', 'rateBasis', 'group', 'type']) {
    assert.equal(mdf[field], original[field], `${mdf.id}: ${field}`);
  }
  assert.equal(mdf.subgroup, original.subgroup.replaceAll('HDHMR', 'MDF'));
  assert.equal(mdf.itemName, original.itemName.replaceAll('HDHMR', 'MDF'));
}
console.log('PASS: all eight PU/Membrane MDF variants match their corresponding HDHMR master rates.');
