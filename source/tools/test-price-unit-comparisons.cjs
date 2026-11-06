const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const { COSTING_ITEMS } = require('../src/lib/costing.ts');
const { priceChangesFor, groupPriceChanges, missingPriceReasons } = require('../src/lib/price-change-audit.ts');
const { rateInUnit } = require('../src/lib/price-units.ts');
const { PriceChangeSummary } = require('../src/components/PriceChangeSummary.tsx');
const { PriceChangeReview } = require('../src/components/PriceChangeReview.tsx');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const cases = [
  ['KITCHEN-007', 'Carcass board', 'sheet', 32], ['KITCHEN-007', 'Carcass board', 'sqft', 32],
  ['KITCHEN-030', 'Counter Ply', 'sheet', 32], ['KITCHEN-SINK-STONE-18', 'Carcass board', 'slab', 21],
  ['KITCHEN-049', 'Profile', 'RMT'], ['KITCHEN-049', 'Profile', 'metre'], ['KITCHEN-049', 'Profile', 'mm'],
  ['KITCHEN-SINK-BONDTITE', 'Consumable', 'kg'], ['KITCHEN-SINK-BONDTITE', 'Consumable', 'gm'],
  ['KITCHEN-SINK-SILICONE', 'Consumable', 'g'], ['KITCHEN-EDGEBAND-ADHESIVE', 'Consumable', 'grams'],
  ['KITCHEN-055', 'Hardware', 'nos'], ['KITCHEN-068', 'Accessory', 'PCS'], ['KITCHEN-079', 'Accessory', 'set'],
];
const quote = (code, category, unit, rate, quantity = 1) => ({ rows: [], costing: { items: [{ category, itemCode: code, item: COSTING_ITEMS.find(i => i.id === code)?.materialDescription ?? code, unit, rate, quantity, amount: rate * quantity }], unpriced: [] } });
for (const [id, category, unit, area] of cases) {
  const m = COSTING_ITEMS.find(i => i.id === id);
  const base = rateInUnit(m.currentRate, m.rateBasis, unit, area);
  assert.notEqual(base, undefined, `${id} ${unit} has a defined conversion`);
  assert.equal(priceChangesFor(quote(id, category, unit, base)).length, 0, `${id} unchanged in ${unit}`);
  assert.equal(priceChangesFor(quote(id, category, unit, base, 20)).length, 0, 'Quantity and line amount do not change the unit rate');
  const changed = priceChangesFor(quote(id, category, unit, base * 1.1));
  assert.equal(changed.length, 1); assert.equal(changed[0].defaultPrice, base); assert.equal(changed[0].changedPrice, base * 1.1);
  assert.equal(missingPriceReasons(changed).length, 1);
}
for (const item of COSTING_ITEMS) {
  const unit = { SQFT: 'sqft', MTR: 'RMT', KG: 'kg', SET: 'set', PCS: 'nos' }[item.rateBasis];
  assert.equal(priceChangesFor(quote(item.id, 'Master item', unit, item.currentRate)).length, 0, `${item.id}: its master rate in a matching unit is unchanged`);
}
for (const [category, unit, rate] of [['Carcass laminate', 'sheet', 550], ['Carcass laminate', 'sqft', 550 / 32], ['Shutter PVC foil laminate', 'sqft', 75], ['Shutter PVC foil laminate', 'sheet', 2400], ['Profile surface finishing', 'sqft', 80]]) {
  const code = /foil/.test(category) ? 'PVC-FOIL-MODERN' : /finishing/.test(category) ? 'KITCHEN-049-FINISH-Powder coating' : 'LAMINATE';
  assert.equal(priceChangesFor(quote(code, category, unit, rate)).length, 0, `${category}: ${unit} matches its source price`);
  assert.equal(missingPriceReasons(priceChangesFor(quote(code, category, unit, rate * 1.1))).length, 1);
}
assert.equal(rateInUnit(100, 'SET', 'PCS'), undefined, 'Unknown pieces per set cannot be invented');
assert.equal(rateInUnit(100, 'SQFT', 'PCS'), undefined, 'Area per piece is not a rate override');
assert.equal(rateInUnit(1, 'SQFT', 'm²'), 1_000_000 / 92903.04);
assert.equal(priceChangesFor(quote('KITCHEN-079', 'Accessory', 'PCS', 50)).length, 0, 'Derived set-to-piece costs cannot be compared to a set rate');
const stale = { key: 'Purchase.legacy.0', itemCode: 'KITCHEN-SINK-BONDTITE', label: 'Consumable · Bondtite', unit: '₹/gm', defaultPrice: 3000, changedPrice: 3, reason: '' };
assert.equal(groupPriceChanges([stale]).length, 0); assert.equal(missingPriceReasons([stale]).length, 0);
const real = groupPriceChanges([{ ...stale, changedPrice: 4 }])[0];
assert.equal(real.defaultPrice, 3); assert.equal(real.changedPrice, 4);
const changes = priceChangesFor(quote('KITCHEN-007', 'Carcass board', 'sheet', 3000));
for (const component of [React.createElement(PriceChangeSummary, { changes }), React.createElement(PriceChangeReview, { changes, onReason() {} })]) {
  const html = renderToStaticMarkup(component);
  assert(!html.includes('Used for'), 'The Used for column is removed from both review and summary');
}
console.log('PASS: matching-unit comparisons for boards, slabs, laminates, legacy foil, profiles, hardware, accessories, sets, kg/grams and finishing; quantities never trigger remarks; Used for removed.');
