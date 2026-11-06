const assert = require('node:assert/strict');
// Reuse the project's TypeScript test loader and check sink costing remains intact.
require('./test-sink-stone.cjs');
const { COSTING_ITEMS } = require('../src/lib/costing.ts');
const { modernMembraneConstruction } = require('../src/lib/modern-membrane.ts');
const { buildModel, computeCosting, buildBoardTotals } = require('../src/components/WoodBomBuilder.tsx');
for (const id of ['KITCHEN-015', 'KITCHEN-016', 'KITCHEN-015-MDF', 'KITCHEN-016-MDF']) {
  const selected = COSTING_ITEMS.find(item => item.id === id);
  const construction = modernMembraneConstruction(selected);
  assert.ok(construction);
  const config = {
    zk: 'BC', fk: 'SK', vid: 'single', hand: 'LHS', handle: 'NONE',
    board: 'KITCHEN-007', backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029',
    shType: id, visibleSides: '', visibleSideMaterialId: id,
    glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
    carcassLamFrontSheetPrice: '550', carcassLamBackSheetPrice: '550',
    backLamFrontSheetPrice: '550', backLamBackSheetPrice: '550',
    drawerLamFrontSheetPrice: '550', drawerLamBackSheetPrice: '550',
    visibleLamFrontSheetPrice: '550', visibleLamBackSheetPrice: '550',
    shutterLamFrontSheetPrice: '550', shutterLamBackSheetPrice: '550',
    W: 600, H: 720, D: 560, drawerModel: 'Hettich', finish: 'White',
  };
  const model = buildModel(config);
  const result = computeCosting([{ id: 1, m: model, qty: 2, elevation: 'AA' }], [], [], [], [], [], [], id, id, {}, { carcass: 10, shutter: 20, profile: 20 }, {});
  const details = result.lines[0].details;
  const board = details.find(detail => detail.category === 'Shutter board');
  const foil = details.find(detail => detail.itemCode === 'PVC-FOIL-MODERN');
  assert(foil.specification.includes('1420 mm wide roll'));
  const foilPurchase = result.purchases.find(item => item.itemCode === 'PVC-FOIL-MODERN');
  assert.equal(foilPurchase.unit, 'sqft', 'Roll foil must never convert into 32 sqft sheets');
  assert.equal(foilPurchase.rate, 75);
  assert(Math.abs(foilPurchase.requiredQty - foil.billableQty) < 1e-8);
  assert.equal(foilPurchase.quantity, Math.round((foil.billableQty + Number.EPSILON) * 100) / 100);
  assert.equal(board.itemCode, construction.board.id);
  assert.equal(board.rate, construction.board.currentRate);
  const processing = details.find(detail => detail.itemCode === `${construction.board.id}-PROC`);
  assert.ok(processing, 'Underlying board must receive shutter processing');
  assert.equal(processing.rate, construction.faces === 1 ? 36 : 42.3);
  assert.equal(processing.billableQty, board.billableQty);
  const totals = buildBoardTotals([{ id: 1, m: model, qty: 2, elevation: 'AA' }], { carcass: 10, shutter: 20, profile: 20 });
  assert(totals.some(row => row.mat === construction.board.itemName && row.rate === construction.board.currentRate));
  assert(!totals.some(row => /Membrane/i.test(row.mat)));
  assert.equal(foil.netQty, board.netQty * construction.faces);
  assert.equal(foil.billableQty, foil.netQty / 0.8);
  assert(Math.abs(foil.amount - (foil.allocatedBillableQty ?? foil.billableQty) * 75) < 1e-8);
  assert(!details.some(detail => detail.itemCode === id));
  assert(!details.some(detail => detail.category === 'Shutter laminate'));
  assert(model.cons.some(item => item.name === 'MODERN MEMBRANE PVC FOIL'));
  assert(!model.cons.some(item => item.name === 'MEMBRANE FOIL'));
  const withSides = buildModel({ ...config, visibleSides: 'BOTH' });
  assert(withSides.panels.filter(panel => panel.visibleSide).every(panel => !panel.band));
  const withSidesCost = computeCosting([{ id: 1, m: withSides, qty: 1, elevation: 'AA' }], [], [], [], [], [], [], id, id, {}, { carcass: 10, shutter: 20, profile: 20 }, {});
  const foilLines = withSidesCost.purchases.filter(item => item.itemCode === 'PVC-FOIL-MODERN');
  assert.equal(foilLines.length, 2, 'Shutter and visible-side PVC foil must remain separate');
  assert(foilLines.every(item => item.unit === 'sqft' && item.rate === 75));
  assert(foilLines.some(item => item.categories.includes('Shutter PVC foil laminate')));
  assert(foilLines.some(item => item.categories.includes('Visible side PVC foil laminate')));
  assert(!withSidesCost.lines[0].details.some(detail => ['Shutter edge band', 'Visible side edge band'].includes(detail.category)));
  const overriddenWaste = computeCosting([{ id: 1, m: withSides, qty: 1, elevation: 'AA' }], [], [], [], [], [], [], id, id, {}, { carcass: 10, shutter: 20, profile: 20 }, {}, undefined, {}, undefined, {}, { 'foil:shutter': 10, 'foil:visible': 30 });
  const foilDetails = overriddenWaste.lines[0].details.filter(detail => detail.itemCode === 'PVC-FOIL-MODERN');
  assert.equal(foilDetails.find(detail => detail.category === 'Shutter PVC foil laminate').wastePct, 10);
  assert.equal(foilDetails.find(detail => detail.category === 'Visible side PVC foil laminate').wastePct, 30);
  model.boardPrices = { shutter: { itemId: id, sheetPrice: '3200', pvcFoilRate: '90' } };
  const custom = computeCosting([{ id: 1, m: model, qty: 2, elevation: 'AA' }], [], [], [], [], [], [], id, id, {}, { carcass: 10, shutter: 20, profile: 20 }, {});
  assert.equal(custom.lines[0].details.find(detail => detail.category === 'Shutter board').rate, 100);
  assert.equal(custom.lines[0].details.find(detail => detail.itemCode === 'PVC-FOIL-MODERN').rate, 90);
}
const { boardPricesFromMaterials } = require('../src/lib/kitchen-materials.ts');
const foilOnly = boardPricesFromMaterials({ shutter: { itemId: 'KITCHEN-015', frontSheetPrice: '550', backSheetPrice: '550', pvcFoilRate: '85' } }).shutter;
assert.equal(Number(foilOnly.sheetPrice), modernMembraneConstruction(COSTING_ITEMS.find(item => item.id === 'KITCHEN-015')).board.currentRate * 32);
assert.equal(foilOnly.pvcFoilRate, '85');
assert.equal(modernMembraneConstruction(COSTING_ITEMS.find(item => item.id === 'KITCHEN-017')), undefined);
assert.equal(modernMembraneConstruction(COSTING_ITEMS.find(item => item.id === 'KITCHEN-019')), undefined);
console.log('PASS: Modern Membrane board + one/two foil faces, laminate wastage, quantities, and no combined-rate double charging.');
