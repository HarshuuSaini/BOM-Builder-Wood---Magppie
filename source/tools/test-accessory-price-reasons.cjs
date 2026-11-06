const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const { priceChangesFor, missingPriceReasons } = require('../src/lib/price-change-audit.ts');
const { COSTING_ITEMS } = require('../src/lib/costing.ts');
const { PriceChangeReview } = require('../src/components/PriceChangeReview.tsx');
const { renderToStaticMarkup } = require('react-dom/server');
const React = require('react');
const item = COSTING_ITEMS.find(i => i.id === 'KITCHEN-068');
function kitchen(kind, data, code = item.id, name = item.materialDescription, unit = item.rateBasis) {
  return { rows: [{ 'Record Type': kind, Data: JSON.stringify(data) }], costing: { items: [
    { category: 'Accessory', itemCode: code, item: name, unit, quantity: 2, rate: Number(data.manualRate), amount: Number(data.manualRate) * 2 },
  ], unpriced: [] } };
}
for (const kind of ['accessory', 'linked-accessory-edit']) {
  const source = kind === 'accessory' ? { id: 1, itemId: item.id } : { linkedLineId: 1, sourceItemId: item.id };
  const data = { ...source, manualRate: String(item.currentRate + 100), priceChangeReason: '' };
  assert(missingPriceReasons(priceChangesFor(kitchen(kind, data))).length > 0);
  const reason = 'Supplier updated the price  for this kitchen\nConfirmed by factory ';
  const changed = kitchen(kind, { ...data, priceChangeReason: reason });
  const audit = priceChangesFor(changed);
  assert.equal(audit.length, 2, 'The source rate and purchase rate are both audited');
  assert(audit.every(c => c.reason === reason), 'Inline remark reaches source and purchase, preserving spaces');
  assert.equal(missingPriceReasons(audit).length, 0);
  assert(!audit.some(c => c.key.endsWith('priceChangeReason')), 'Remark text is not treated as a price');
  const html = renderToStaticMarkup(React.createElement(PriceChangeReview, { changes: audit, accessoriesReadOnly: true, onReason() {} }));
  assert(!html.includes('<textarea'), 'Accessory review shows the recorded reason rather than a separate editor');
  assert(html.includes('Supplier updated the price'));
  const again = kitchen(kind, { ...data, manualRate: String(item.currentRate + 200), priceChangeReason: '' });
  again.priceChanges = audit;
  assert(missingPriceReasons(priceChangesFor(again, { ...changed, priceChanges: audit })).some(c => !c.key.startsWith('Purchase.')), 'A subsequent price edit requires a fresh inline reason');
}
const custom = kitchen('accessory', { id: 2, itemId: 'CUSTOM', customName: 'Custom pantry', customUnit: 'SET', manualRate: '3000', priceChangeReason: 'New accessory specified' }, 'CUSTOM-ACCESSORY', 'Custom pantry', 'set');
assert.equal(missingPriceReasons(priceChangesFor(custom)).length, 0, 'Custom accessory reason also covers its purchase line');
const branded = kitchen('accessory', { id: 3, itemId: 'CUSTOM', customName: 'Detergent basket', customBrand: 'Test brand', customUnit: 'PCS', manualRate: '400', priceChangeReason: 'New basket selected' }, 'CUSTOM-ACCESSORY', 'Detergent basket · Test brand', 'nos');
assert.equal(missingPriceReasons(priceChangesFor(branded)).length, 0, 'A brand in the purchase name must not block saving a correctly explained new accessory');
const unchanged = kitchen('accessory', { id: 1, itemId: item.id, manualRate: String(item.currentRate), priceChangeReason: '' });
assert.equal(priceChangesFor(unchanged).length, 0, 'An unchanged master price needs no remark');
const b = require('../src/components/WoodBomBuilder.tsx');
const roundTripReason = 'Supplier price updated  for bulk order\nApproved ';
const setup = { name: 'Accessory reason test', project: [], fillers: [], visiblePanels: [], countertops: [], accessories: [],
  masterAccessories: [{ id: 1, itemId: item.id, qty: 1, elevation: 'AA', manualRate: String(item.currentRate + 100), priceChangeReason: roundTripReason }],
  linkedAccessoryEdits: [], rawSelections: [], waste: { carcass: 12, shutter: 22, profile: 12, edgeBand: 3 },
  pricing: { conversionPct: 40, profitPct: 0, includeTax: false, transportation: { mode: 'sqft', value: 15 }, installation: { mode: 'sqft', value: 95 }, loading: { mode: 'sqft', value: 5 }, processingRates: {} } };
const restored = b.restoreProjectSetup(b.projectSetupRows(setup));
assert.equal(restored.masterAccessories[0].priceChangeReason, roundTripReason, 'The normal project save/restore keeps the exact inline remark');
console.log('PASS: mandatory inline accessory reasons, linked and custom items, matching purchase audits, read-only review and fresh reasons after edits.');
