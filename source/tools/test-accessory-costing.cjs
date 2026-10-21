const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const XLSX = require('xlsx-js-style');

const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return originalResolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, file) => {
  let source = fs.readFileSync(file, 'utf8').replace(/import\.meta\.url/g, '"file:///test"');
  if (file.endsWith('WoodBomBuilder.tsx')) source += '\nexport { computeCosting };';
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  } }).outputText, file);
};

const { computeCosting } = require('../src/components/WoodBomBuilder.tsx');
const { exportCostingWorkbook } = require('../src/lib/export.ts');
const accessories = [
  { id: 1, itemId: 'CUSTOM', customName: 'Handle', customUnit: 'PCS', qty: 1, elevation: 'AA', manualRate: '150' },
  { id: 2, itemId: 'CUSTOM', customName: 'Handle', customUnit: 'PCS', qty: 2, elevation: 'AA', manualRate: '150' },
  { id: 3, itemId: 'CUSTOM', customName: 'Handle', customUnit: 'PCS', qty: 4, elevation: 'BB', manualRate: '150' },
  { id: 4, itemId: 'CUSTOM', customName: 'Knob', customUnit: 'PCS', qty: 1, elevation: 'AA', manualRate: '150' },
  { id: 5, itemId: 'CUSTOM', customName: 'Handle', customUnit: 'PCS', qty: 1, elevation: 'AA', manualRate: '170' },
];
const costing = computeCosting([], [], [], [], [], [], accessories, '', '', {},
  { carcass: 10, shutter: 20, profile: 20 }, {});
assert.equal(costing.lines.length, 4);
const aa150 = costing.lines.find(line => line.label === 'AA · Handle' && line.unitCost === 150);
assert.equal(aa150.qty, 3);
assert.equal(aa150.cost, 450);
assert.equal(aa150.details[0].billableQty, 3);
assert.equal(costing.purchases.filter(item => item.item === 'Handle' && item.rate === 150).length, 1);
assert.equal(costing.purchases.find(item => item.item === 'Handle' && item.rate === 150).quantity, 7);
assert.equal(costing.total, 1370);

let workbook;
const originalWrite = XLSX.writeFile;
XLSX.writeFile = result => { workbook = result; };
try {
  exportCostingWorkbook(costing.lines, [], {
    cabinetSqft: 0, fillerSqft: 0, totalSqft: 0, baseCost: costing.total,
    conversion: 0, profit: 0, transportation: 0, installation: 0,
    loading: 0, subtotal: costing.total, tax: 0, grandTotal: costing.total,
  }, costing.unpriced, {
    conversionPct: 0, profitPct: 0, transportation: { mode: 'direct', value: 0 },
    installation: { mode: 'direct', value: 0 }, loading: { mode: 'direct', value: 0 }, includeTax: false,
  });
} finally {
  XLSX.writeFile = originalWrite;
}
const summary = XLSX.utils.sheet_to_json(workbook.Sheets['Cabinet Summary']);
const handles = summary.filter(row => row['Cabinet / item'] === 'AA · Handle');
assert.equal(handles.length, 2, 'different handle rates must remain separate');
assert.deepEqual(handles.map(row => row.Qty).sort((a, b) => a - b), [1, 3]);
const purchaseRows = XLSX.utils.sheet_to_json(workbook.Sheets['Consolidated Items']);
assert.equal(purchaseRows.filter(row => row['Actual item'] === 'Handle' && row['Source rate (Rs)'] === 150).length, 1);
console.log('Accessory costing and Excel export merge matching handles by elevation and rate.');
