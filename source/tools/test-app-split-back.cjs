const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, file) => {
  let source = fs.readFileSync(file, 'utf8').replace(/import\.meta\.url/g, '"file:///test"');
  if (file.endsWith('WoodBomBuilder.tsx')) source += '\nexport { buildModel, computeCosting, buildFullBomData, projectSetupRows, restoreProjectSetup, DEFAULT_PROJECT_PRICING };';
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
  } }).outputText, file);
};
const b = require('../src/components/WoodBomBuilder.tsx');
const { COSTING_ITEMS } = require('../src/lib/costing.ts');
const cfg = { zk: 'TC', fk: 'APP', vid: '1dw', hand: 'LHS', handle: 'XCJ', board: 'KITCHEN-007',
  backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029', shType: 'KITCHEN-014', visibleSides: '', visibleSideMaterialId: 'KITCHEN-014',
  glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
  carcassLamFrontSheetPrice: '550', carcassLamBackSheetPrice: '550', backLamFrontSheetPrice: '550', backLamBackSheetPrice: '550',
  drawerLamFrontSheetPrice: '550', drawerLamBackSheetPrice: '550', visibleLamFrontSheetPrice: '550', visibleLamBackSheetPrice: '550',
  shutterLamFrontSheetPrice: '550', shutterLamBackSheetPrice: '550', W: 600, H: 2400, D: 560, drawerModel: 'Hettich', finish: 'White' };
const waste = { carcass: 10, shutter: 20, profile: 20, edgeBand: 3 };
for (const height of [2040, 2400]) for (const variant of ['1dw', '2dw']) {
  const model = b.buildModel({ ...cfg, H: height, vid: variant });
  const backs = model.panels.filter(panel => /^Panels- CR Back (Upper|Lower)\b/.test(panel.name));
  assert.equal(backs.length, 2);
  assert.deepEqual(backs.map(panel => panel.h), [height - 1349, variant === '1dw' ? 286 : 686]);
  assert.ok(backs.every(panel => panel.w === 573 && panel.t === 8 && panel.qty === 1 && !panel.band));
  assert.ok(!model.panels.some(panel => /^Panels- CR Back 8mm/.test(panel.name)), 'No full back');
  assert.ok(!model.stubs.some(note => /APP twin|single back is emitted|Wood equivalent not yet defined/.test(note)));
  const project = [{ id: 1, m: model, qty: 2, elevation: 'AA' }];
  const cost = b.computeCosting(project, [], [], [], [], [], [], cfg.shType, cfg.shType, {}, waste, {});
  const actualBack = cost.lines[0].details.find(row => row.category === 'Carcass back board');
  const net = backs.reduce((sum, panel) => sum + panel.w * panel.h / 92903.04 * panel.qty * 2, 0);
  assert.ok(Math.abs(actualBack.netQty - net) < 1e-8);
  assert.equal(actualBack.itemCode, cfg.backBoardId);
  assert.equal(actualBack.rate, COSTING_ITEMS.find(item => item.id === cfg.backBoardId).currentRate);
  const bom = b.buildFullBomData(project, '', 'White', waste);
  assert.ok(bom.some(row => /Back Upper/.test(JSON.stringify(row))));
  assert.ok(bom.some(row => /Back Lower/.test(JSON.stringify(row))));
  const restored = b.restoreProjectSetup(b.projectSetupRows({ project, fillers: [], visiblePanels: [], countertops: [], accessories: [], masterAccessories: [], rawSelections: [], waste, pricing: b.DEFAULT_PROJECT_PRICING }));
  assert.equal(restored.project[0].m.panels.filter(panel => /^Panels- CR Back (Upper|Lower)\b/.test(panel.name)).length, 2);
}
const invalid = b.buildModel({ ...cfg, H: 1349 });
assert.ok(!invalid.panels.some(panel => panel.h <= 0));
assert.ok(invalid.stubs.some(note => /APP upper back requires/.test(note)));
const normalTall = b.buildModel({ ...cfg, fk: 'SHF', vid: 'sgl' });
assert.ok(normalTall.panels.some(panel => /^Panels- CR Back 8mm/.test(panel.name)), 'Other tall cabinets retain their full back');
console.log('APP split backs: both drawer variants/heights, selected grooved wood back, no full back, costing/BOM/restore and invalid-height guard passed.');
