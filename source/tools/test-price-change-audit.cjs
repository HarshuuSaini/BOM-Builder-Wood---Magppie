const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const { priceChangesFor, missingPriceReasons, groupPriceChanges } = require('../src/lib/price-change-audit.ts');
const { COSTING_ITEMS, DEFAULT_BOARD_PROCESSING_RATES } = require('../src/lib/costing.ts');
const { compareCostings } = require('../src/lib/costing-comparison.ts');
const { CostingComparison } = require('../src/components/CostingComparison.tsx');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const board = COSTING_ITEMS.find(i => i.id === 'KITCHEN-030');
const accessory = COSTING_ITEMS.find(i => i.id === 'KITCHEN-068');
const entry = { rows: [{ 'Record Type': 'accessory', Data: JSON.stringify({ id: 1, itemId: accessory.id, manualRate: accessory.currentRate + 100 }) },
  { 'Record Type': 'settings', Data: JSON.stringify({ pricing: { processingRates: { 'Counter Ply': 12 } } }) }],
  materials: { Base: { carcass: { itemId: board.id, boardSheetPrice: String(board.currentRate * 32 + 500), frontSheetPrice: '550', backSheetPrice: '550' } } } };
let changes = priceChangesFor(entry);
assert.equal(changes.length, 3);
assert.equal(missingPriceReasons(changes).length, 3);
assert(changes.some(c => c.defaultPrice === 10 && c.changedPrice === 12));
const audited = { ...entry, priceChanges: changes.map(c => ({ ...c, reason: 'Supplier price revised' })) };
assert.equal(missingPriceReasons(priceChangesFor(audited)).length, 0);
const previous = structuredClone(audited);
const edited = structuredClone(audited);
edited.rows[0].Data = JSON.stringify({ id: 1, itemId: accessory.id, manualRate: accessory.currentRate + 200 });
assert.equal(missingPriceReasons(priceChangesFor(edited, previous)).length, 1, 'An old remark cannot justify a different new price');
const reset = structuredClone(previous);
reset.rows[0].Data = JSON.stringify({ id: 1, itemId: accessory.id, manualRate: accessory.currentRate });
assert.equal(missingPriceReasons(priceChangesFor(reset, previous)).length, 1, 'Resetting a price to its default also needs a reason');
const differentBoard = COSTING_ITEMS.find(i => i.id === 'KITCHEN-007');
const switched = structuredClone(previous);
switched.materials.Base.carcass = { itemId: differentBoard.id, boardSheetPrice: String(differentBoard.currentRate * 32), frontSheetPrice: '550', backSheetPrice: '550' };
assert(!priceChangesFor(switched, previous).some(c => c.key === 'Materials.Base.carcass.boardSheetPrice'), 'Selecting a different board at its master price does not carry over the previous board default');
const legacy = priceChangesFor(entry, entry);
assert(legacy.every(c => c.legacy && !c.reason));
assert.equal(missingPriceReasons(legacy).length, 0);
assert.equal(missingPriceReasons(priceChangesFor(edited, entry)).length, 1, 'Legacy prices are not an exemption for subsequent edits');
const fakeDefault = { ...entry, priceChanges: changes.map(c => ({ ...c, defaultPrice: c.changedPrice, reason: '' })) };
assert.equal(missingPriceReasons(priceChangesFor(fakeDefault)).length, 3, 'Client cannot redefine the default price');
const withRemark = { id: 'a', name: 'Kitchen A', version: 1, materialCost: 100, total: 140, areaSqft: 10, entry: { ...audited, costing: { items: [], unpriced: [] } } };
const noChange = { ...withRemark, id: 'b', name: 'Kitchen B', entry: { rows: [], costing: { items: [], unpriced: [] } } };
const report = compareCostings([withRemark, noChange]);
assert.equal(report.columns[0].priceChanges.length, 3); assert.equal(report.columns[1].priceChanges.length, 0);
const html = renderToStaticMarkup(React.createElement(CostingComparison, { data: report, onClose() {} }));
assert(html.includes('Kitchen A — price changes and reasons') && !html.includes('Kitchen B — price changes and reasons'));
assert(html.includes('Supplier price revised') && html.includes('Default price') && html.includes('Changed price'));
const legacyReport = compareCostings([{ ...withRemark, entry: { ...entry, costing: { items: [], unpriced: [] } } }]);
assert(renderToStaticMarkup(React.createElement(CostingComparison, { data: legacyReport, onClose() {} })).includes('Reason not recorded'));
assert.equal(DEFAULT_BOARD_PROCESSING_RATES['Counter Ply'], 10);
for (const [category, code, unit] of [['Hardware', 'KITCHEN-055', 'PCS'], ['Accessory', 'KITCHEN-068', 'PCS'], ['Profile', 'KITCHEN-049', 'MTR'], ['Consumable', 'KITCHEN-SINK-BONDTITE', 'kg']]) {
  const item = COSTING_ITEMS.find(i => i.id === code);
  const quoted = { rows: [], costing: { items: [{ category, itemCode: code, item: item.materialDescription, unit, quantity: 1, rate: item.currentRate + 5, amount: item.currentRate + 5 }], unpriced: [] } };
  const audit = priceChangesFor(quoted);
  assert.equal(audit.length, 1, `${category} receives a reason requirement`);
  assert.equal(audit[0].defaultPrice, item.currentRate);
  assert.equal(missingPriceReasons(audit).length, 1);
}
const both = compareCostings([withRemark, { ...withRemark, id: 'b', name: 'Kitchen B' }]);
assert(both.columns.every(c => c.priceChanges.length === 3));
const b = require('../src/components/WoodBomBuilder.tsx');
const config = { zk: 'BC', fk: 'SH', vid: 'single', hand: 'LHS', handle: 'NONE', board: 'KITCHEN-007', backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029', shType: 'KITCHEN-014', visibleSideMaterialId: 'KITCHEN-014', ...b.DEFAULT_LAMINATE_PRICES, glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close', neon: 'NEON50', W: 600, H: 720, D: 560, drawerModel: 'Hettich', finish: 'White' };
const rows = b.projectSetupRows({ name: 'Defaults', project: [{ id: 1, m: b.buildModel(config), qty: 1, elevation: 'AA' }], fillers: [], visiblePanels: [], countertops: [], accessories: [], masterAccessories: [], rawSelections: [], waste: { carcass: 12, shutter: 22, profile: 12, edgeBand: 3 }, pricing: { conversionPct: 40, profitPct: 0, includeTax: false, transportation: { mode: 'sqft', value: 15 }, installation: { mode: 'sqft', value: 95 }, loading: { mode: 'sqft', value: 5 }, processingRates: {} } });
assert.equal(priceChangesFor({ rows, costing: b.kitchenCostingSnapshot(b.restoreProjectSetup(rows), undefined, b.DEFAULT_RATES) }).length, 0, 'A kitchen using defaults needs no price-change remarks');
const glass = { rows: [], materials: { _wallGlass: { glass: { itemId: 'KITCHEN-GLASS-5-TINTED', pricePerSqft: '150' } } }, costing: { items: [
  { category: 'Shutter glass', itemCode: 'KITCHEN-GLASS-5-TINTED', item: 'GLASS 05 MM TINTED', unit: 'nos', quantity: 2, rate: 703.330052, amount: 1406.660104 },
  { category: 'Glass shelf', itemCode: 'KITCHEN-GLASS-6-CLEAR', item: 'GLASS 06 MM CLEAR', unit: 'nos', quantity: 2, rate: 375.953252, amount: 751.906504 },
], unpriced: [] } };
assert.equal(priceChangesFor(glass).length, 0, '₹150/sqft and ₹135/sqft glass do not become overrides when converted to per-piece purchase costs');
const staleGlass = glass.costing.items.map(i => ({ key: `Purchase.${JSON.stringify([i.category, i.itemCode, i.item, i.unit])}.0`, itemCode: i.itemCode, label: `${i.category} · ${i.item}`, unit: '₹/piece', defaultPrice: i.category === 'Shutter glass' ? 150 : 135, changedPrice: i.rate, reason: '' }));
assert.equal(groupPriceChanges(staleGlass).length, 0, 'Older piece-cost audit records must disappear from review and comparison');
assert.equal(missingPriceReasons(staleGlass).length, 0, 'Old derived glass records cannot block saving');
const glassHardwareChange = { key: 'Purchase.hardware.0', itemCode: 'HARDWARE-003', label: 'Hardware · Corner connector for glass shutter', unit: '₹/piece', defaultPrice: 5, changedPrice: 10, reason: '' };
assert.equal(missingPriceReasons([glassHardwareChange]).length, 1, 'Hardware used with glass still needs a remark for a genuine piece-rate edit');
const repricedGlass = structuredClone(glass);
repricedGlass.materials._wallGlass.glass.pricePerSqft = '180';
const realGlassChange = priceChangesFor(repricedGlass);
assert.equal(realGlassChange.length, 1); assert.equal(realGlassChange[0].unit, '₹/sqft');
assert.equal(realGlassChange[0].defaultPrice, 150); assert.equal(realGlassChange[0].changedPrice, 180);
assert.equal(missingPriceReasons(realGlassChange).length, 1, 'A genuine per-sqft glass rate edit still requires a reason');
console.log('PASS: all configured prices require reasons, master defaults cannot be forged, changing a price invalidates the old reason, legacy detection and one/both-kitchen comparison.');
