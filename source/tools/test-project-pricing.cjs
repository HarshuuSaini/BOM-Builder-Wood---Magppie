const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const XLSX = require('xlsx-js-style');
const root = path.resolve(__dirname, '..');
const builderFile = path.join(root, 'src/components/WoodBomBuilder.tsx');
const builderSource = fs.readFileSync(builderFile, 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
} }).outputText;
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, file) => {
  let source = fs.readFileSync(file, 'utf8').replace(/import\.meta\.url/g, '"file:///test"');
  if (file === builderFile) source += '\nexport { calculateProjectPricing, DEFAULT_PROJECT_PRICING, restoreLegacyBom, restoreProjectSetup, projectSetupRows, kitchenCostingSnapshot, DEFAULT_RATES, displayedItemCostBreakdown };';
  mod._compile(compile(source), file);
};
const b = require(builderFile);
const { exportCostingWorkbook, exportBulkCostingWorkbook } = require('../src/lib/export.ts');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
for (const [filler, count] of [[{ zone: 'base', fillerType: 'filler' }, 1], [{ zone: 'wall', linkedLineId: 1 }, 3], [{ zone: 'base', fillerType: 'cover-panel' }, 5]]) {
  const lines = [{ cost: 70000 }, ...Array.from({ length: count }, () => ({ cost: 215.4 / count })), { cost: 5159.3 }];
  const breakdown = b.displayedItemCostBreakdown({ total: 75374.7, lines }, 1, [filler]);
  near(breakdown.baseItemCost, 75159.3);
  near(breakdown.fillerCost, 215.4);
  near(breakdown.baseItemCost + breakdown.fillerCost, 75374.7);
}
assert.deepEqual(b.displayedItemCostBreakdown({ total: 100, lines: [{ cost: 100 }] }, 1, []), { baseItemCost: 100, fillerCost: 0 });
const factors = structuredClone(b.DEFAULT_PROJECT_PRICING);
assert.deepEqual(factors, { batchQuantity: 20, conversionPct: 40, conversionModel: 'margin', transportation: { mode: 'sqft', value: 15 },
  installation: { mode: 'sqft', value: 95 }, loading: { mode: 'sqft', value: 5 }, includeTax: false, processingRates: {} });
const result = b.calculateProjectPricing(100000, 100, factors);
assert.equal(result.combinedSubtotal, 111500);
near(result.conversion, 111500 / 0.6 - 111500);
near(result.subtotal, 111500 / 0.6);
near(result.grandTotal, 111500 / 0.6);
const withTax = b.calculateProjectPricing(100000, 100, { ...factors, includeTax: true, profitPct: 10 });
assert(!('profit' in withTax), 'Legacy extra percentages have no effect and no separate field remains');
near(withTax.tax, 111500 / 0.6 * 0.18);
near(withTax.grandTotal, 111500 / 0.6 * 1.18);
for (const conversionPct of [-1, 100, 101, Infinity, NaN]) assert.throws(() => b.calculateProjectPricing(100000, 100, { ...factors, conversionPct }), /below 100/);
near(b.calculateProjectPricing(100000, 0, factors).grandTotal, 166666.6666666667);
assert.equal(b.calculateProjectPricing(0, 0, factors).grandTotal, 0);
assert.equal(b.calculateProjectPricing(100000, 100, { ...factors, conversionPct: 0 }).subtotal, 111500);

// Run the actual React memo callbacks with controlled geometry/cost data. This
// exercises the call sites and real allocation code without a browser or mocks of pricing.
const ast = ts.createSourceFile(builderFile, builderSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function memo(name, scope) {
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback, `Missing ${name} memo`);
  return new Function(...Object.keys(scope), compile(`const run = ${callback};\nrun();`).replace(/run\(\);\s*$/, 'return run();'))(...Object.values(scope));
}
const project = [
  { m: { W: 40, H: 1, zk: 'WC', code: 'A' }, qty: 1, elevation: 'AA' },
  { m: { W: 20, H: 1, zk: 'WC', code: 'B' }, qty: 1, elevation: 'BB' },
];
const scope = { project, costing: { total: 100000 }, allFillers: [{ elevation: 'AA' }],
  extras: { panels: [{ w: 30, h: 1, qty: 1, name: 'Front' }, { w: 99, h: 99, qty: 1, name: 'Excluded side' }] },
  countertops: [{ length: 10, depth: 600, qty: 1 }], countertopShutterType: '',
  sqft: (w, h) => w * h, cabinetAreaHeight: (_, h) => h, fillerPanelCount: () => 2,
  counterPlyThickness: () => 1, counterPlyAreaSqft: row => Number(row.length),
  calculateProjectPricing: b.calculateProjectPricing, projectPricingInputs: factors };
const main = memo('projectPricing', scope);
assert.equal(main.totalSqft, 100);
near(main.subtotal, 111500 / 0.6);
for (const field of ['transportation', 'installation', 'loading']) {
  near([...main.allocatedCharges, ...main.fillerCharges, ...main.counterPlyCharges].reduce((sum, row) => sum + row[field], 0), main[field]);
}
const direct = { ...factors, transportation: { mode: 'direct', value: 3000 } };
const directMain = memo('projectPricing', { ...scope, projectPricingInputs: direct });
const elevation = memo('shownPricing', { ...scope, projectPricing: directMain, projectPricingInputs: direct,
  activeElevation: 'AA', shownCosting: { total: 80000 } });
assert.equal(elevation.totalSqft, 80);
assert.equal(elevation.transportation, 2400);
near(elevation.subtotal, (80000 + 2400 + 7600 + 400) / 0.6);

// Saved blanks/zeros and direct overrides survive restoration. Legacy projects
// without saved factors inherit defaults; snapshots use the corrected order.
const override = { ...factors, conversionPct: 12, installation: { mode: 'direct', value: 0 },
  transportation: { mode: 'direct', value: 2500 }, loading: { mode: 'direct', value: '' } };
const saved = b.restoreProjectSetup([
  { 'Record Type': 'format', Data: JSON.stringify({ name: 'wood-bom-project', version: 2 }) },
  { 'Record Type': 'settings', Data: JSON.stringify({ pricing: override, waste: { carcass: 10, shutter: 20, profile: 20 } }) },
]);
assert.deepEqual(saved.pricing, override);
assert.deepEqual(b.restoreProjectSetup(b.projectSetupRows(saved)).pricing, override);
const snapshot = b.kitchenCostingSnapshot(saved, undefined, b.DEFAULT_RATES);
near(snapshot.conversion, 2500 / 0.88 - 2500);
near(snapshot.total, 2500 / 0.88);
const legacy = b.restoreLegacyBom([{ Level: 0, Item: 'WC-SH-NHX-WD-1SG-RHS-XXX-800-900-336-18-WHITE', 'SO Qty': 1, Elevation: 'AA' }]);
assert.deepEqual(legacy.pricing, factors);
const defaultSnapshot = b.kitchenCostingSnapshot(legacy, undefined, b.DEFAULT_RATES);
near(defaultSnapshot.transportation, defaultSnapshot.areaSqft * 15);
near(defaultSnapshot.installation, defaultSnapshot.areaSqft * 95);
near(defaultSnapshot.loading, defaultSnapshot.areaSqft * 5);
near(defaultSnapshot.conversion, (defaultSnapshot.materialCost + defaultSnapshot.areaSqft * 115) / 0.6 - (defaultSnapshot.materialCost + defaultSnapshot.areaSqft * 115));
near(defaultSnapshot.total, (defaultSnapshot.materialCost + defaultSnapshot.areaSqft * 115) / 0.6);

// Evaluate exported formulas recursively, including cross-sheet dependencies.
// Editing input cells must change computed results, independently of cached v.
function evaluate(book, sheet, address, stack = new Set()) {
  const key = `${sheet}!${address}`;
  assert.ok(!stack.has(key), `Circular formula ${key}`);
  const cell = book.Sheets[sheet][address];
  if (!cell?.f) return cell?.v ?? 0;
  const next = new Set(stack).add(key);
  const get = (tab, ref) => evaluate(book, tab, ref, next);
  let formula = cell.f.replace(/(?:'([^']+)'!)?([A-Z]+\d+):([A-Z]+\d+)/g, (_, tab, start, end) => {
    const range = XLSX.utils.decode_range(`${start}:${end}`);
    const values = [];
    for (let row = range.s.r; row <= range.e.r; row++) for (let col = range.s.c; col <= range.e.c; col++) {
      values.push(get(tab || sheet, XLSX.utils.encode_cell({ r: row, c: col })));
    }
    return `(${JSON.stringify(values)}.reduce((a,b)=>a+b,0))`;
  });
  formula = formula.replace(/(?:'([^']+)'!)?\b([A-Z]+\d+)\b/g, (_, tab, ref) => JSON.stringify(get(tab || sheet, ref)));
  formula = formula.replace(/\bSUM\(/g, 'sum(').replace(/\bIF\(/g, 'choose(').replace(/\bROUND\(/g, 'round(').replace(/(?<![<>=!])=(?![=>])/g, '===');
  formula = formula.replace(/\bAND\(/g, 'all(').replace(/\bNA\(/g, 'invalid(');
  return new Function('sum', 'choose', 'round', 'all', 'invalid', `return ${formula}`)((...args) => args.reduce((a, c) => a + c, 0), (test, yes, no) => test ? yes : no, (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits, (...args) => args.every(Boolean), () => NaN);
}
let workbook;
const originalWrite = XLSX.writeFile;
XLSX.writeFile = book => { workbook = book; };
try {
  const detail = { category: 'Hardware', itemCode: 'TEST', item: 'Test item', specification: '',
    netQty: 1, wastePct: 0, billableQty: 1, uom: 'nos', rate: 100000, amount: 100000 };
  exportCostingWorkbook([{ label: 'AA · Test', code: 'TEST', qty: 1, unitCost: 100000, cost: 100000, details: [detail] }],
    [{ eachSqft: 100, sqft: 100 }], { ...result, cabinetSqft: 100, fillerSqft: 0, counterPlySqft: 0, totalSqft: 100 }, [], factors, 'Pricing regression');
  near(evaluate(workbook, 'Project Pricing', 'B7'), 111500 / 0.6 - 111500);
  near(evaluate(workbook, 'Project Pricing', 'B21'), 111500 / 0.6);
  const single = workbook.Sheets['Project Pricing'];
  single.B1.v = 200;
  near(evaluate(workbook, 'Project Pricing', 'B21'), 123000 / 0.6);
  single.B18.v = 1;
  single.B6.v = 50;
  near(evaluate(workbook, 'Project Pricing', 'B21'), 123000 / 0.5 * 1.18);
  single.B11.v = 'direct';
  single.B12.v = 500;
  near(evaluate(workbook, 'Project Pricing', 'B21'), (100000 + 3000 + 500 + 1000) / 0.5 * 1.18);
  single.B6.v = 100;
  assert(Number.isNaN(evaluate(workbook, 'Project Pricing', 'B7')), 'Invalid Excel margin gives an error rather than an infinite or negative conversion');
  const kitchen = { name: 'A', areaSqft: 100, materialCost: 100000, ...result, total: result.grandTotal, factors,
    unpriced: [], items: [{ category: 'Hardware', itemCode: 'TEST', item: 'Test item', unit: 'nos', rate: 100000, quantity: 1, amount: 100000 }] };
  exportBulkCostingWorkbook([kitchen, { ...kitchen, name: 'B', factors: override,
    ...b.calculateProjectPricing(100000, 100, override), total: b.calculateProjectPricing(100000, 100, override).grandTotal }]);
  const bulk = workbook.Sheets['Combined Costing'];
  near(evaluate(workbook, 'Combined Costing', 'F7'), 111500 / 0.6 - 111500);
  near(evaluate(workbook, 'Combined Costing', 'F12'), 111500 / 0.6);
  near(evaluate(workbook, 'Combined Costing', 'I12'), 102500 / 0.88);
  bulk.D3.v = 200;
  near(evaluate(workbook, 'Combined Costing', 'F12'), 123000 / 0.6);
  bulk.E11.v = 1;
  bulk.D7.v = 50;
  near(evaluate(workbook, 'Combined Costing', 'F12'), 123000 / 0.5 * 1.18);
  bulk.D5.v = 200000;
  near(evaluate(workbook, 'Combined Costing', 'F12'), (200000 + 23000) / 0.5 * 1.18);
  near(evaluate(workbook, 'Combined Costing', 'I12'), 102500 / 0.88);
  const reopened = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  near(evaluate(reopened, 'Combined Costing', 'F12'), (200000 + 23000) / 0.5 * 1.18);
  bulk.D9.v = 500;
  bulk.E9.v = 'direct';
  near(evaluate(workbook, 'Combined Costing', 'F12'), (200000 + 3000 + 500 + 1000) / 0.5 * 1.18);
  assert(!Object.values(workbook.Sheets).some(sheet => Object.values(sheet).some(cell => /^Profit\b/.test(String(cell?.v ?? '')))), 'No standalone profit rows are exported');
} finally { XLSX.writeFile = originalWrite; }
console.log('Project pricing: defaults, main/elevation allocations, saved overrides, snapshots, editable single/bulk Excel formulas passed.');
