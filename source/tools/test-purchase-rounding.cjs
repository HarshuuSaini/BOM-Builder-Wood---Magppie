const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, file) => {
  let source = fs.readFileSync(file, 'utf8').replace(/import\.meta\.url/g, '"file:///test"');
  if (file.endsWith('WoodBomBuilder.tsx')) source += '\nexport {computeCosting, buildModel, buildAccessoryRows, countertopMaterialItem, countertopMaterialId, DEFAULT_RATES, DEFAULT_LAMINATE_PRICES};';
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  } }).outputText, file);
};
const { purchaseTotals, allocatePurchaseCosts, ceilQuantity, roundQuantity, sheetQuantityInput } = require('../src/lib/purchase-rounding.ts');
for (const [input, expected] of [['4.287328756949', '4.29'], ['5.8506770203644', '5.85'], ['2.2896212545897', '2.29'], ['1.0908247727953', '1.09']]) {
  assert.equal(sheetQuantityInput(input), expected);
  assert.equal(roundQuantity(Number(input)), Number(expected));
}
assert.equal(sheetQuantityInput(''), '');
assert.equal(sheetQuantityInput('4.'), '4.');
assert.equal(sheetQuantityInput('0'), '0');
const detail = (id, qty, uom, rate, category = 'Hardware') => ({
  itemCode: id, item: id, category, specification: '', netQty: qty, wastePct: 0,
  billableQty: qty, uom, rate, amount: qty * rate,
});
const line = details => ({ label: '', qty: 1, cost: 0, unitCost: 0, details });
const near = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
assert.equal(ceilQuantity(6.1), 7);
assert.equal(ceilQuantity(6), 6);
assert.equal(ceilQuantity(6 + Number.EPSILON * 4), 6);
assert.equal(ceilQuantity(6.0000001), 7);
assert.equal(ceilQuantity(0), 0);
const rows = [
  line([detail('BOARD', 3.05 * 32, 'sqft', 100, 'Carcass board')]),
  line([detail('BOARD', 3.05 * 32, 'sqft', 100, 'Visible side board')]),
  line([detail('GLUE', 1500, 'gm', 0.4, 'Consumable')]),
  line([detail('GLUE', 1.9712, 'kg', 400, 'Consumable')]),
  line([detail('PROFILE', 2.1, 'RMT', 104, 'Profile'), detail('PROFILE', 2.1, 'RMT', 104, 'Hardware')]),
  line([detail('LAM', 32.1, 'sqft', 10, 'Front laminate')]),
  line([detail('PROC', 32.1, 'sqft', 45, 'Shutter material processing')]),
  line([detail('PIN', 6.1, 'nos', 0), detail('SET', 2.1, 'set', 100)]),
];
const totals = allocatePurchaseCosts(rows);
const get = id => totals.find(x => x.itemCode === id);
near(get('BOARD').quantity, 6.1);
near(get('BOARD').amount, 19520);
near(get('GLUE').quantity, 3.47);
near(get('GLUE').amount, 1388);
near(get('PROFILE').quantity, 4.2);
near(get('LAM').quantity, 1);
near(get('LAM').amount, 320);
near(purchaseTotals([detail('DECIMAL', 0.9241325678, 'kg', 400)])[0].amount, 368);
// Combine first: separately rounding 0.004 + 0.004 would incorrectly yield zero.
near(purchaseTotals([detail('SMALL', 0.004, 'kg', 400), detail('SMALL', 0.004, 'kg', 400)])[0].quantity, 0.01);
assert.equal(get('PROC').quantity, 32.1);
assert.equal(get('PIN').quantity, 6.1);
assert.equal(get('SET').quantity, 2.1);
near(rows.reduce((s, x) => s + x.cost, 0), totals.reduce((s, x) => s + x.amount, 0));
const partial = [line([detail('BOARD', 3.05 * 32, 'sqft', 100, 'Carcass board')])];
allocatePurchaseCosts(partial, totals);
near(partial[0].cost, 9760);
assert.equal(purchaseTotals([detail('B', 1, 'sqft', 10, 'Carcass board'), detail('B', 1, 'sqft', 20, 'Carcass board')]).length, 2);
const again = rows.reduce((s, x) => s + x.cost, 0);
allocatePurchaseCosts(rows);
near(rows.reduce((s, x) => s + x.cost, 0), again);

const b = require('../src/components/WoodBomBuilder.tsx');
const config = { zk: 'BC', fk: 'SK', vid: 'double', hand: 'LHS', handle: 'STD', board: 'KITCHEN-007',
  backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029', shType: 'KITCHEN-013',
  visibleSides: 'LH', visibleSideMaterialId: 'KITCHEN-013', ...b.DEFAULT_LAMINATE_PRICES,
  backLamFrontSheetPrice: '550', backLamBackSheetPrice: '550', drawerLamFrontSheetPrice: '550',
  drawerLamBackSheetPrice: '550', visibleLamFrontSheetPrice: '550', visibleLamBackSheetPrice: '550',
  glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
  W: 900, H: 720, D: 560, drawerModel: 'Hettich', finish: 'White' };
const model = b.buildModel(config);
const drawerModel = b.buildModel({...config, fk: 'DW', vid: '2dr-mixed'});
const drawerPanels = drawerModel.panels.filter(p => p.pack === 'Drawer Pack');
assert(drawerPanels.length > 0 && drawerPanels.every(p => p.band));
const drawerBand = drawerPanels.reduce((sum, p) => sum + 2 * (p.w + p.h) / 1000 * p.qty, 0);
near(drawerModel.cons.find(c => c.pack === 'Drawer Pack' && c.name.startsWith('EDGE BAND')).qty, Math.round(drawerBand * 1000) / 1000);
near(drawerModel.cons.find(c => c.pack === 'Drawer Pack' && c.name === 'EDGEBAND ADHESIVE').qty, Math.round(drawerBand * 6 * 1000) / 1000);
const drawerCost = b.computeCosting([{id: 1, m: drawerModel, qty: 1, elevation: 'AA'}], [], [], [], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {});
const nonShutterBand = drawerModel.panels.filter(p => p.band && p.pack !== 'Shutter Pack' && !p.visibleSide)
  .reduce((sum, p) => sum + 2 * (p.w + p.h) / 1000 * p.qty, 0);
near(drawerCost.lines[0].details.find(d => d.category === 'Carcass edge band').netQty, nonShutterBand);
const calc = (project, totals) => b.computeCosting(project, [], [], [], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {}, totals);
const project = [{ id: 1, m: model, qty: 1, elevation: 'AA' }, { id: 2, m: model, qty: 1, elevation: 'BB' }];
const full = calc(project);
const counter = b.computeCosting([], [], [], [{id: 1, materialId: 'KITCHEN-014', material: 'POSTlam BWP Ply BSL', ratePerSqft: '166.8125', length: '2050', depth: '600', thickness: '18', qty: 1}], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {});
near(counter.lines[0].details[0].rate, 2612.4 / 32);
near(counter.purchases[0].rate, 2612.4);
near(counter.total, counter.purchases[0].quantity * 2612.4);
const counterBase = {id: 1, materialId: 'KITCHEN-030', material: 'RAW BWR Ply Counter Base-16mm', ratePerSqft: '166.81', length: '2050', depth: '600', thickness: '', qty: 1};
assert.equal(b.countertopMaterialId(counterBase), 'KITCHEN-030');
assert.equal(b.countertopMaterialItem(counterBase, config.shType).thicknessMm, 16);
assert.equal(b.countertopMaterialId({...counterBase, materialId: undefined}), 'KITCHEN-030');
assert.equal(b.countertopMaterialItem({...counterBase, materialId: 'KITCHEN-007'}, config.shType).id, 'KITCHEN-007');
const counterBaseCost = b.computeCosting([], [], [], [counterBase], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {});
assert.equal(counterBaseCost.lines[0].details[0].itemCode, 'KITCHEN-030');
near(counterBaseCost.lines[0].details[0].rate, 2612.3 / 32);
near(counterBaseCost.purchases[0].rate, 2612.3);
near(counterBaseCost.total, counterBaseCost.purchases[0].quantity * 2612.3);
assert(counterBaseCost.lines[0].details[0].specification.includes('16mm'));
const otherRows = [
  { id: 1, kind: 'elenor', lengthMeters: 5.25, size: '720', qty: 1, elevation: 'AA', straight: 0, lconn: 0, driver: '' },
  { id: 2, kind: 'c-handle', lengthMeters: 0.75, size: '', qty: 1, elevation: 'AA', straight: 0, lconn: 0, driver: '' },
  { id: 3, kind: 'j-handle', lengthMeters: 2.5, size: '', qty: 1, elevation: 'AA', straight: 0, lconn: 0, driver: '' },
];
const otherCost = b.computeCosting([], [], [], [], [], otherRows, [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {});
for (const [id, qty] of [['KITCHEN-084', 5.25], ['KITCHEN-085', 5.25], ['KITCHEN-086', 5.25], ['KITCHEN-050', 0.75], ['KITCHEN-049', 2.5]]) {
  const purchase = otherCost.purchases.find(p => p.itemCode === id);
  assert(purchase, `Missing other accessory ${id}`);
  near(purchase.quantity, qty);
  assert.equal(purchase.unit, 'RMT');
}
const otherExport = b.buildAccessoryRows(otherRows, [], '');
near(otherExport[0]['Actual Qty'], 5.25);
assert.equal(otherExport[0].Size, 'Mtr');
near(otherExport.find(r => r['Zoho Item ID'] === 'KITCHEN-050')['Actual Qty'], 0.75);
const pendingHardware = otherExport.filter(r => r.Accessory.includes('quantity pending'));
assert.equal(pendingHardware.length, 6);
assert(pendingHardware.every(r => r.Total === '' && r['Actual Qty'] === ''));
assert.deepEqual(pendingHardware.map(r => r['Zoho Item ID']), ['HARDWARE-022', 'HARDWARE-023', 'HARDWARE-026', 'HARDWARE-024', 'HARDWARE-025', 'HARDWARE-026']);
assert.equal(otherCost.unpriced.filter(r => r.includes('(quantity pending)')).length, 5);
assert(!otherCost.purchases.some(r => pendingHardware.some(h => h['Zoho Item ID'] === r.itemCode)));
const legacyLight = b.buildAccessoryRows([{...otherRows[0], lengthMeters: undefined, size: '1000', qty: 2}], [], '');
near(legacyLight[0]['Actual Qty'], 2);
for (const [itemId, rate] of [['KITCHEN-049', 275], ['KITCHEN-050', 315]]) {
  const handles = b.computeCosting([], [], [], [], [], [], [{ id: 1, itemId, qty: 0.75, elevation: 'AA' }],
    config.shType, config.shType, b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {});
  assert.equal(handles.unpriced.length, 0);
  assert.equal(handles.purchases[0].itemCode, itemId);
  assert.equal(handles.purchases[0].unit, 'RMT');
  near(handles.purchases[0].quantity, 0.75);
  near(handles.total, rate * 0.75);
}
const boardPanel = model.panels.find(p => p.band && !p.visibleSide && p.pack === 'Carcass Pack');
const boardKey = `${boardPanel.mat}|${boardPanel.t}`;
const boardDetails = full.lines.flatMap(l => l.details).filter(d => d.boardQuantityKey === boardKey);
const netSqft = boardDetails.reduce((sum, d) => sum + d.netQty, 0);
const overridden = b.computeCosting(project, [], [], [], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {}, undefined,
  { [boardKey]: { sheets: 6.25, netSqft } });
near(overridden.lines.flatMap(l => l.details).filter(d => d.boardQuantityKey === boardKey).reduce((sum, d) => sum + d.billableQty, 0), 6.25 * 32);
full.lines.forEach((l, i) => l.details.forEach((d, j) => {
  if (d.boardQuantityKey !== boardKey) {
    near(overridden.lines[i].details[j].billableQty, d.billableQty);
    near(overridden.lines[i].details[j].amount, d.amount);
  }
}));
near(full.total, calc([{...project[0], qty: 2}]).total);
near(full.total, full.purchases.reduce((s, p) => s + p.amount, 0));
near(calc([project[0]], full.purchases).total + calc([project[1]], full.purchases).total, full.total);
assert(full.purchases.every(p => !p.rounded && p.quantity === Math.round((p.requiredQty + Number.EPSILON) * 100) / 100));
assert.equal(full.purchases.filter(p => p.itemCode === 'KITCHEN-013').length, 1);
near(full.purchases.find(p => p.itemCode === 'KITCHEN-SINK-PROFILE').quantity, 4.1);

const XLSX = require('xlsx-js-style');
let workbook;
XLSX.writeFile = value => { workbook = value; };
require('../src/lib/export.ts').exportCostingWorkbook(full.lines, [], {
  cabinetSqft: 0, fillerSqft: 0, totalSqft: 0, baseCost: full.total, conversion: 0, profit: 0,
  transportation: 0, installation: 0, loading: 0, subtotal: full.total, tax: 0, grandTotal: full.total,
}, full.unpriced);
const exported = XLSX.utils.sheet_to_json(workbook.Sheets['Consolidated Items']);
assert(exported.some(p => !Number.isInteger(p['Purchase qty'])));
for (const p of exported) {
  near(p['Purchase qty'], Math.round((p['Required qty incl. waste'] + Number.EPSILON) * 100) / 100);
  near(p['Amount (Rs)'], p['Purchase qty'] * p['Rate (Rs / basis)']);
}
assert.equal(workbook.Sheets['Consolidated Items'].E2.z, '#,##0.00');
assert.equal(workbook.Sheets['Manual Comparison'].G5.z, '#,##0.00');
near(exported.reduce((s, p) => s + p['Amount (Rs)'], 0), full.total);
console.log('PASS: two-decimal aggregate quantities and costs, units, allocation, elevation filtering, idempotence, actual cabinet costing and export formatting.');
