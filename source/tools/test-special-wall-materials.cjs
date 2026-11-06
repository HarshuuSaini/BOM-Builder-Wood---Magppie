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
  if (file.endsWith('WoodBomBuilder.tsx')) source += '\nexport { buildModel, computeCosting, cabinetConfigWithSelectedMaterials };';
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  } }).outputText, file);
};
const { COSTING_ITEMS } = require('../src/lib/costing.ts');
const { materialChoicesForCabinet, selectedBoardRate } = require('../src/lib/kitchen-materials.ts');
const { defaultSpecialWall } = require('../src/components/MaterialSelection.tsx');
const { buildModel, computeCosting, cabinetConfigWithSelectedMaterials } = require('../src/components/WoodBomBuilder.tsx');
const choice = (itemId) => ({ itemId, frontSheetPrice: '550', backSheetPrice: '550' });
const wall = { carcass: choice('KITCHEN-007'), back: choice('KITCHEN-035'), drawer: choice('KITCHEN-029'), shutter: choice('KITCHEN-014'), visible: choice('KITCHEN-014') };
const materials = { Base: wall, Sink: wall, Wall: wall, Tall: wall, Loft: wall, Mid: wall,
  _wallOpen: { carcass: choice('KITCHEN-014'), back: choice('KITCHEN-035'), visible: choice('KITCHEN-014') },
  _wallGlass: { carcass: choice('KITCHEN-014'), back: choice('KITCHEN-035'), visible: choice('KITCHEN-014'), glass: { itemId: 'KITCHEN-GLASS-5-CLEAR', pricePerSqft: '210' } },
};
assert.equal(materialChoicesForCabinet(materials, 'WC', 'WOP').carcass.itemId, 'KITCHEN-014');
assert.equal(materialChoicesForCabinet(materials, 'WC', 'WGL').carcass.itemId, 'KITCHEN-014');
assert.equal(materialChoicesForCabinet(materials, 'WC', 'WST').carcass.itemId, 'KITCHEN-007');
const wallIndependent = { ...wall,
  carcass: { ...choice('KITCHEN-007'), boardSheetPrice: '2600', boardFinish: 'Carcass white' },
  visible: { ...choice('KITCHEN-009'), boardSheetPrice: '1400', boardFinish: 'Visible oak' },
  edgeBand: { finish: 'White', carcassPricePerRmt: '8', shutterPricePerRmt: '12', byMaterial: {
    carcass: { finish: 'Carcass white', pricePerRmt: '8' }, visible: { finish: 'Visible oak', pricePerRmt: '12' },
  } },
};
for (const glass of [false, true]) {
  const defaults = defaultSpecialWall(wallIndependent, glass, COSTING_ITEMS);
  assert.deepEqual(defaults.carcass, wallIndependent.carcass);
  assert.deepEqual(defaults.visible, wallIndependent.visible);
  assert.deepEqual(defaults.edgeBand.byMaterial.carcass, wallIndependent.edgeBand.byMaterial.carcass);
}
const sharedMaterials = { ...materials, Wall: wallIndependent, _wallSpecialSources: { open: 'Wall', glass: 'Wall' } };
for (const family of ['WOP', 'WGL']) {
  const current = materialChoicesForCabinet(sharedMaterials, 'WC', family);
  assert.deepEqual(current.carcass, wallIndependent.carcass, 'Shared specials follow actual Wall carcass, not cached shutter material');
  assert.deepEqual(current.visible, wallIndependent.visible);
}
// Execute the real UI handlers with isolated state to cover shared -> own edits.
const uiFile = path.join(root, 'src/components/MaterialSelection.tsx');
const uiSource = fs.readFileSync(uiFile, 'utf8');
const ast = ts.createSourceFile(uiFile, uiSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name, scope) {
  let expression;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(expression);
  const js = ts.transpileModule(`const run = ${expression}; return run;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), js)(...Object.values(scope));
}
for (const kind of ['open', 'glass']) {
  let value = defaultSpecialWall(wallIndependent, kind === 'glass', COSTING_ITEMS);
  let sources = { open: 'Wall', glass: 'Wall' };
  const original = JSON.stringify(wallIndependent);
  const visible = structuredClone(value.visible);
  const scope = { effectiveSpecialWall: () => value, setWallOpen: next => { value = next; }, setWallGlass: next => { value = next; },
    setWallSpecialSources: update => { sources = update(sources); } };
  handler('updateSpecialWallField', scope)(kind, 'carcass', { itemId: 'KITCHEN-014', boardSheetPrice: '3000' });
  assert.deepEqual(value.visible, visible, 'Changing special carcass must not change its visible panel');
  assert.equal(sources[kind], 'Own');
  assert.equal(JSON.stringify(wallIndependent), original, 'Override must not rewrite Wall materials');
  const customCarcass = structuredClone(value.carcass);
  handler('updateSpecialWallField', scope)(kind, 'visible', { boardSheetPrice: '1500' });
  assert.deepEqual(value.carcass, customCarcass, 'Visible edits must not change carcass');
}

const base = { zk: 'WC', fk: 'WGL', vid: 'single', hand: 'LHS', handle: 'NONE', board: 'KITCHEN-007',
  backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029', shType: 'KITCHEN-014', visibleSides: '',
  visibleSideMaterialId: 'KITCHEN-014', glassType: 'KITCHEN-GLASS-5-TINTED',
  hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
  carcassLamFrontSheetPrice: '550', carcassLamBackSheetPrice: '550', backLamFrontSheetPrice: '550', backLamBackSheetPrice: '550',
  drawerLamFrontSheetPrice: '550', drawerLamBackSheetPrice: '550', visibleLamFrontSheetPrice: '550', visibleLamBackSheetPrice: '550',
  shutterLamFrontSheetPrice: '550', shutterLamBackSheetPrice: '550', W: 600, H: 900, D: 336,
  drawerModel: 'Hettich', finish: 'White' };
const glassConfig = cabinetConfigWithSelectedMaterials(base, materials);
assert.equal(glassConfig.board, 'KITCHEN-014');
assert.equal(glassConfig.glassType, 'KITCHEN-GLASS-5-CLEAR');
assert.equal(glassConfig.glassPricePerSqft, '210');
const glass = buildModel(glassConfig);
const { handleSettingFor } = require('../src/lib/kitchen-materials.ts');
assert.equal(handleSettingFor(undefined, 'WC', 'WGL').type, 'HANDLE');
assert.equal(handleSettingFor({ _handleDefaults: { Glass: { type: 'NONE', price: '', brand: '' } } }, 'TC', 'SHFG').type, 'NONE');
for (const handle of ['HANDLE', 'NONE']) {
  const model = buildModel({ ...glassConfig, handle });
  const frameProfiles = model.profiles.filter(profile => profile.pack === 'Shutter Pack');
  const handleProfiles = frameProfiles.filter(profile => profile.type === 'H');
  assert.equal(handleProfiles.reduce((sum, profile) => sum + profile.qty, 0), handle === 'HANDLE' ? 1 : 0);
  assert(handleProfiles.every(profile => profile.orientation === 'vertical'));
  assert.equal(frameProfiles.filter(profile => profile.type === 'V').reduce((sum, profile) => sum + profile.qty, 0), handle === 'HANDLE' ? 3 : 4);
  const cost = computeCosting([{ id: 1, m: model, qty: 1, elevation: 'AA' }], [], [], [], [], [], [], model.shType, model.shType, {}, { carcass: 10, shutter: 20, profile: 20 }, {});
  assert(cost.lines[0].details.filter(detail => detail.category === 'Profile').every(detail => detail.rate > 0));
}
const glassShelf = COSTING_ITEMS.find(item => item.id === 'KITCHEN-GLASS-6-CLEAR');
assert(glass.panels.some(panel => panel.name.includes('Shelf') && panel.mat === glassShelf.materialDescription));
const glassCost = computeCosting([{ id: 1, m: glass, qty: 1, elevation: 'AA' }], [], [], [], [], [], [], glass.shType, glass.shType, {}, { carcass: 10, shutter: 20, profile: 20 }, {});
const glassDetails = glassCost.lines[0].details.filter(detail => ['Shutter glass', 'Glass shelf'].includes(detail.category));
assert(glassDetails.some(detail => detail.category === 'Shutter glass'));
for (const detail of glassDetails) {
  assert.equal(detail.uom, 'nos');
  assert(Number.isInteger(detail.netQty));
  assert.match(detail.item, /\d+ × \d+ mm/);
  assert.equal(detail.billableQty, detail.netQty);
}
const shutterPanel = glass.panels.find(panel => panel.pack === 'Shutter Pack' && /glass/i.test(panel.mat));
const shutterDetail = glassDetails.find(detail => detail.category === 'Shutter glass');
assert(Math.abs(shutterDetail.rate - shutterPanel.w * shutterPanel.h / 92903.04 / 0.8 * 210) < 1e-8);
const twoSizesModel = { ...glass, panels: [...glass.panels, { ...shutterPanel, w: shutterPanel.w + 100 }] };
const twoSizesCost = computeCosting([{ id: 1, m: twoSizesModel, qty: 2, elevation: 'AA' }], [], [], [], [], [], [], glass.shType, glass.shType, {}, { carcass: 10, shutter: 20, profile: 20 }, {});
const shutterPurchases = twoSizesCost.purchases.filter(item => item.categories.includes('Shutter glass'));
assert.equal(shutterPurchases.length, 2);
assert(shutterPurchases.every(item => item.unit === 'nos' && Number.isInteger(item.quantity)));
const openConfig = cabinetConfigWithSelectedMaterials({ ...base, fk: 'WOP', vid: 'open' }, materials);
const open = buildModel(openConfig);
const shutterBoard = COSTING_ITEMS.find(item => item.id === 'KITCHEN-014');
assert(open.panels.some(panel => panel.name.includes('Shelf') && panel.mat === shutterBoard.materialDescription));
const prelamBoard = COSTING_ITEMS.find(item => item.type === 'Prelam' && item.group === 'Carcass/ Shelf Material');
assert(prelamBoard, 'Prelam carcass board exists in master');
const finishedMaterials = { ...materials, Base: { ...wall, carcass: { ...choice(prelamBoard.id), boardFinish: 'Walnut' } } };
const finishedConfig = cabinetConfigWithSelectedMaterials({ ...base, zk: 'BC', fk: 'SH' }, finishedMaterials);
assert.equal(finishedConfig.boardPrices.carcass.finish, 'Walnut');
assert.equal(selectedBoardRate(prelamBoard, finishedConfig.boardPrices.carcass), prelamBoard.currentRate);
console.log('Special wall materials and glass-shelf rules: OK');
