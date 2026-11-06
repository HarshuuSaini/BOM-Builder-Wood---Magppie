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
  if (file.endsWith('WoodBomBuilder.tsx')) source += '\nexport { buildModel, cabinetAccessories, buildFullBomData, computeCosting, defSizes, famSetOf, projectSetupRows, restoreProjectSetup, restoreLegacyBom, DEFAULT_PROJECT_PRICING };';
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
  } }).outputText, file);
};
const b = require('../src/components/WoodBomBuilder.tsx');
const { handleSettingFor } = require('../src/lib/kitchen-materials.ts');
const config = { zk: 'WC', fk: 'WLU', vid: 'sgl', hand: 'LHS', handle: 'HANDLE', handlePrice: '999',
  board: 'KITCHEN-007', backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029', shType: 'KITCHEN-014', visibleSides: '', visibleSideMaterialId: 'KITCHEN-014',
  glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
  carcassLamFrontSheetPrice: '550', carcassLamBackSheetPrice: '550', backLamFrontSheetPrice: '550', backLamBackSheetPrice: '550',
  drawerLamFrontSheetPrice: '550', drawerLamBackSheetPrice: '550', visibleLamFrontSheetPrice: '550', visibleLamBackSheetPrice: '550',
  shutterLamFrontSheetPrice: '550', shutterLamBackSheetPrice: '550', W: 1000, H: 400, D: 580, drawerModel: 'Hettich', finish: 'White' };
assert.deepEqual(b.defSizes('WC', 'WLU'), { w: [1000], h: [400], d: 580 });
assert.equal(Object.keys(b.famSetOf('WC'))[0], 'WST', 'Existing default wall family remains unchanged');
assert.ok(!b.famSetOf('WB').WLU, 'Not a wall blind family');
assert.equal(b.famSetOf('WC').WLU.variants.length, 1);
assert.equal(handleSettingFor(undefined, 'WC', 'WLU').type, 'PUSH');
const defaults = { _handleDefaults: { Wall: { type: 'HANDLE', price: '999', brand: 'SS' } } };
assert.equal(handleSettingFor(defaults, 'WC', 'WLU').price, '', 'Do not reuse SS handle pricing');
assert.equal(handleSettingFor(defaults, 'WC', 'WST').type, 'HANDLE');
for (const width of [500, 600, 601, 1000, 1200]) {
  const model = b.buildModel({ ...config, W: width, vid: 'dbl' });
  const shutters = model.panels.filter(panel => panel.pack === 'Shutter Pack' && /\bSH\b/.test(panel.name));
  assert.equal(shutters.reduce((sum, panel) => sum + panel.qty, 0), 1);
  assert.equal(shutters[0].w, width);
  assert.equal(shutters[0].drill, 'TOP');
  assert.equal(model.handle, 'PUSH');
  assert.equal(model.handlePrice, '');
  assert.equal(model.vid, 'sgl');
  assert.ok(model.code.startsWith('WC-LU-STD-'));
  const project = [{ id: 1, m: model, qty: 3, elevation: 'AA' }];
  const accessories = b.cabinetAccessories(project);
  const tips = accessories.filter(row => row.customName === 'TIP-ON Push to Open');
  assert.equal(tips.length, 0, 'No duplicate custom TIP-ON when the master fitting is charged');
  assert.equal(model.hardware.find(row => /Push Open Fitting Magnetic/.test(row.name)).qty, 1);
  assert.equal(model.hardware.find(row => /Huwil Lift Duo/.test(row.name)).qty, 2);
  assert.ok(!accessories.some(row => row.customName === 'Handle'));
  assert.ok(!model.hardware.some(row => /SS.*HANDLE|HANDLE.*SS/i.test(row.name)));
  const bom = b.buildFullBomData(project, '', 'White', { carcass: 10, shutter: 20, profile: 20 });
  assert.ok(bom.some(row => /Push Open Fitting Magnetic/.test(JSON.stringify(row))), 'Master push-open fitting is present in BOM export');
  assert.ok(bom.some(row => /Huwil Lift Duo/.test(JSON.stringify(row))), 'Lift mechanisms are present in BOM export');
}
const model = b.buildModel({ ...config, handle: 'PUSH', handlePrice: '200' });
const project = [{ id: 1, m: model, qty: 2, elevation: 'AA' }];
const accessories = b.cabinetAccessories(project);
const cost = b.computeCosting(project, [], [], [], [], [], accessories, config.shType, config.shType, {}, { carcass: 10, shutter: 20, profile: 20 }, {});
const hardwareCost = cost.lines.flatMap(line => line.details).filter(row => ['HARDWARE-032', 'HARDWARE-033'].includes(row.itemCode));
assert.equal(hardwareCost.find(row => row.itemCode === 'HARDWARE-032').billableQty, 2);
assert.equal(hardwareCost.find(row => row.itemCode === 'HARDWARE-033').billableQty, 4);
assert.equal(hardwareCost.reduce((sum, row) => sum + row.amount, 0), 1772);
assert.ok(!cost.unpriced.some(row => /TIP-ON|Huwil|Push Open Fitting/i.test(row)));
const saved = b.restoreProjectSetup(b.projectSetupRows({ project, fillers: [], visiblePanels: [], countertops: [], accessories: [], masterAccessories: [], rawSelections: [], waste: { carcass: 10, shutter: 20, profile: 20 }, pricing: b.DEFAULT_PROJECT_PRICING }));
assert.equal(saved.project[0].m.fk, 'WLU');
assert.equal(saved.project[0].m.handle, 'PUSH');
assert.equal(saved.project[0].m.panels.filter(p => p.pack === 'Shutter Pack').reduce((sum, p) => sum + p.qty, 0), 1);
const legacy = b.restoreLegacyBom([{ Level: 0, Item: model.code, 'SO Qty': 2, Elevation: 'AA' }]);
assert.equal(legacy.project[0].m.fk, 'WLU');
assert.equal(legacy.project[0].m.handle, 'PUSH');
console.log('Wall lift-up: default sizes, single shutter at every width, one TIP-ON/unit, no SS handle, pricing, BOM export and project restore passed.');
