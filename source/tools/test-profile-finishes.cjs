const assert = require('node:assert/strict');
require('./test-sink-stone.cjs');
const { profileFinishCost, PROFILE_DEVELOPED_WIDTHS } = require('../src/lib/profile-finishes.ts');
const { COSTING_ITEMS } = require('../src/lib/costing.ts');
const { buildModel, computeCosting } = require('../src/components/WoodBomBuilder.tsx');
for (const [id, width] of Object.entries(PROFILE_DEVELOPED_WIDTHS)) {
  const anodised = profileFinishCost(id, 3, { handles: 'Anodised', skirting: 'Anodised' });
  const powder = profileFinishCost(id, 3, { handles: 'Powder coating', skirting: 'Powder coating' });
  assert.equal(anodised.area, 3000 * width / 92903.04);
  assert.equal(anodised.amount, anodised.area * 40);
  assert.equal(powder.amount, powder.area * 80);
  assert.equal(powder.amount, anodised.amount * 2);
  assert.equal(profileFinishCost(id, 3, { handles: 'Raw', skirting: 'Raw' }), undefined);
}
assert.equal(profileFinishCost('KITCHEN-084', 3), undefined, 'Light is already anodised; no extra charge');
assert.equal(COSTING_ITEMS.find(item => item.id === 'KITCHEN-042').currentRate, 125);
assert.equal(COSTING_ITEMS.find(item => item.id === 'KITCHEN-043').currentRate, 150);
assert.equal(COSTING_ITEMS.find(item => item.id === 'KITCHEN-051').currentRate, 345);
for (const [id, rate] of Object.entries({ 'KITCHEN-040': 275, 'KITCHEN-041': 315, 'KITCHEN-049': 175, 'KITCHEN-050': 215, 'KITCHEN-092': 28.21, 'KITCHEN-093': 28.21, 'KITCHEN-094': 395, 'KITCHEN-ALU-SKIRTING': 234.45 })) {
  const item = COSTING_ITEMS.find(item => item.id === id);
  assert(Math.abs(item.currentRate - rate) < 1e-8, id);
}
const config = { zk: 'WC', fk: 'WGL', vid: 'single', handle: 'HANDLE', hand: 'LHS',
  board: 'KITCHEN-007', backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029',
  shType: 'KITCHEN-014', visibleSides: '', visibleSideMaterialId: 'KITCHEN-014',
  glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
  W: 600, H: 900, D: 336, drawerModel: 'Hettich', finish: 'White',
  carcassLamFrontSheetPrice: '550', carcassLamBackSheetPrice: '550', backLamFrontSheetPrice: '550', backLamBackSheetPrice: '550',
  drawerLamFrontSheetPrice: '550', drawerLamBackSheetPrice: '550', shutterLamFrontSheetPrice: '550', shutterLamBackSheetPrice: '550', visibleLamFrontSheetPrice: '550', visibleLamBackSheetPrice: '550' };
const model = buildModel(config);
const result = computeCosting([{ id: 1, m: model, qty: 2, elevation: 'AA' }], [], [], [], [], [], [], config.shType, config.shType, {}, { carcass: 10, shutter: 20, profile: 20 }, {}, undefined, {}, { handles: 'Anodised', skirting: 'Powder coating' });
const finish = result.lines[0].details.filter(detail => detail.category === 'Profile surface finishing');
assert.equal(finish.length, 2);
assert(finish.every(detail => detail.rate === 40 && detail.uom === 'sqft'));
assert(result.purchases.some(item => item.itemCode.endsWith('-FINISH-Anodised')));
const customWaste = computeCosting([{ id: 1, m: model, qty: 1, elevation: 'AA' }], [], [], [], [], [], [], config.shType, config.shType, {}, { carcass: 10, shutter: 20, profile: 20 }, {}, undefined, {}, undefined, {}, { 'KITCHEN-040': 5, 'KITCHEN-041': 30 });
for (const [id, waste] of [['KITCHEN-040', 5], ['KITCHEN-041', 30]]) {
  const detail = customWaste.lines[0].details.find(detail => detail.itemCode === id);
  assert.equal(detail.wastePct, waste);
  assert(Math.abs(detail.billableQty - detail.netQty / (1 - waste / 100)) < 1e-8);
}
const skirting = [{ id: 1, kind: 'skirting', size: '1', qty: 1, elevation: 'AA', straight: 0, lconn: 0, driver: '' }];
for (const material of ['PVC', 'Aluminium']) {
  const costing = computeCosting([], [], [], [], [], skirting, [], config.shType, config.shType, {}, { carcass: 10, shutter: 20, profile: 20 }, {}, undefined, {}, { handles: 'Raw', skirting: 'Anodised', skirtingMaterial: material });
  const id = material === 'PVC' ? 'KITCHEN-092' : 'KITCHEN-ALU-SKIRTING';
  const purchase = costing.purchases.find(p => p.itemCode === id);
  assert(purchase, `Selected ${material} skirting is costed`);
  assert.equal(purchase.quantity, 1.33);
  const finishes = costing.purchases.filter(p => p.itemCode.includes('-FINISH-'));
  assert.equal(finishes.length, material === 'PVC' ? 0 : 1);
  if (material === 'Aluminium') assert.equal(finishes[0].rate, 40);
}
assert.equal(profileFinishCost('KITCHEN-092', 3), undefined);
assert.equal(profileFinishCost('KITCHEN-093', 3), undefined);
const coatedSkirting = computeCosting([], [], [], [], [], skirting, [], config.shType, config.shType, {}, { carcass: 10, shutter: 20, profile: 20 }, {}, undefined, {}, { handles: 'Powder coating', skirting: 'Powder coating', skirtingMaterial: 'Aluminium' });
const coating = coatedSkirting.purchases.find(p => p.itemCode === 'KITCHEN-ALU-SKIRTING-FINISH-Powder coating');
assert(coating, 'Powder coating is charged separately from the raw skirting');
assert.equal(coating.rate, 80);
assert.equal(profileFinishCost('KITCHEN-ALU-SKIRTING', 1).area, 1000 * 123.322 / 92903.04);
assert.equal(profileFinishCost('KITCHEN-094', 1), undefined, 'Connector does not use the skirting surface width');
const coatedPurchase = coatedSkirting.purchases.find(p => p.itemCode === 'KITCHEN-ALU-SKIRTING');
assert.equal(coatedPurchase.rate, 234.45);
assert.equal(coatedPurchase.quantity, 1.33);
console.log('PASS: developed widths, surface finish rates, master deductions, light exclusion and selected skirting costing.');
