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
  if (file.endsWith('WoodBomBuilder.tsx')) source += '\nexport {computeCosting, buildModel, DEFAULT_RATES, DEFAULT_LAMINATE_PRICES};';
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  } }).outputText, file);
};
const { purchaseTotals, allocatePurchaseCosts, ceilQuantity } = require('../src/lib/purchase-rounding.ts');
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
near(get('GLUE').quantity, 3.4712);
near(get('GLUE').amount, 1388.48);
near(get('PROFILE').quantity, 4.2);
near(get('LAM').quantity, 32.1 / 32);
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
const calc = (project, totals) => b.computeCosting(project, [], [], [], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {}, totals);
const project = [{ id: 1, m: model, qty: 1, elevation: 'AA' }, { id: 2, m: model, qty: 1, elevation: 'BB' }];
const full = calc(project);
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
assert(full.purchases.every(p => !p.rounded && p.quantity === p.requiredQty));
assert.equal(full.purchases.filter(p => p.itemCode === 'KITCHEN-013').length, 1);
near(full.purchases.find(p => p.itemCode === 'KITCHEN-SINK-PROFILE').quantity, 0.854 * 4 * 1.2);

const XLSX = require('xlsx-js-style');
let workbook;
XLSX.writeFile = value => { workbook = value; };
require('../src/lib/export.ts').exportCostingWorkbook(full.lines, [], {
  cabinetSqft: 0, fillerSqft: 0, totalSqft: 0, baseCost: full.total, conversion: 0, profit: 0,
  transportation: 0, installation: 0, loading: 0, subtotal: full.total, tax: 0, grandTotal: full.total,
}, full.unpriced);
const exported = XLSX.utils.sheet_to_json(workbook.Sheets['Consolidated Items']);
assert(exported.some(p => !Number.isInteger(p['Purchase qty'])));
for (const p of exported) near(p['Purchase qty'], p['Required qty incl. waste']);
near(exported.reduce((s, p) => s + p['Amount (Rs)'], 0), full.total);
console.log('PASS: unrounded quantities, units, allocation, elevation filtering, idempotence, actual cabinet costing and decimal costing export.');
