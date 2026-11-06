const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {
  return originalResolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (mod, file) => {
  let source = fs.readFileSync(file, 'utf8').replace(/import\.meta\.url/g, '"file:///test"');
  if (file.endsWith('WoodBomBuilder.tsx')) source += '\nexport { buildModel, computeCosting };';
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  } }).outputText, file);
};
const { buildModel, computeCosting } = require('../src/components/WoodBomBuilder.tsx');
const { COSTING_ITEMS } = require('../src/lib/costing.ts');
const base = { zk: 'BC', fk: 'SH', vid: 'single', hand: 'LHS', handle: 'NONE', board: 'KITCHEN-007',
  backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029', visibleSides: 'BOTH',
  glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
  carcassLamFrontSheetPrice: '550', carcassLamBackSheetPrice: '550', backLamFrontSheetPrice: '550', backLamBackSheetPrice: '550',
  drawerLamFrontSheetPrice: '550', drawerLamBackSheetPrice: '550', visibleLamFrontSheetPrice: '550', visibleLamBackSheetPrice: '550',
  shutterLamFrontSheetPrice: '550', shutterLamBackSheetPrice: '550', W: 600, H: 720, D: 560,
  drawerModel: 'Hettich', finish: 'White' };
const waste = { carcass: 10, shutter: 20, profile: 20, edgeBand: 3 };
// Modern Membrane is board + separately charged PVC foil (covered by test-modern-membrane.cjs), so it has no included finish.
const finishes = COSTING_ITEMS.filter(item => item.group === 'Shutter Material' && /^(PU\b|Membrane\b)/i.test(item.subgroup)
  && !/^Membrane \(Modern\)/i.test(item.subgroup));
assert.ok(finishes.length >= 3, 'Cover membrane plus single/double PU');
for (const item of finishes) {
  const model = buildModel({ ...base, shType: item.id, visibleSideMaterialId: item.id });
  assert.ok(model.cons.some(c => /^(PU|MEMBRANE)\b/.test(c.name)), 'Production BOM must retain finishing quantities');
  const calculate = m => computeCosting([{ id: 1, m, qty: 2, elevation: 'AA' }], [], [], [], [], [], [], item.id, item.id, {}, waste, {});
  const cost = calculate(model);
  assert.ok(!cost.lines.flatMap(line => line.details).some(detail => /^(PU|MEMBRANE)\b/i.test(detail.item) && detail.category === 'Consumable'));
  assert.ok(!cost.unpriced.some(name => /^(PU|MEMBRANE)\b/i.test(name)), 'Included finishes must not report rate required');
  const withoutIncluded = calculate({ ...model, cons: model.cons.filter(c => !/^(PU|MEMBRANE)\b/i.test(c.name)) });
  assert.equal(cost.total, withoutIncluded.total);
  assert.deepEqual(cost.purchases, withoutIncluded.purchases, 'Export purchase lines must also exclude included finishes');
  assert.ok(cost.lines[0].details.some(detail => detail.category === 'Shutter board' && detail.rate === item.currentRate));
  assert.ok(cost.lines[0].details.some(detail => detail.category === 'Visible side board' && detail.rate === item.currentRate));
  assert.ok(cost.lines[0].details.some(detail => detail.item === 'LAMINATE ADHESIVE'), 'Carcass laminate adhesive remains chargeable');
}
console.log('Inclusive PU/Membrane rates: BOM retained, no duplicate finishing charges/warnings/purchases; board and unrelated adhesive costs retained.');
