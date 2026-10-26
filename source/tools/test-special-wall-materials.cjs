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
const glassShelf = COSTING_ITEMS.find(item => item.id === 'KITCHEN-GLASS-6-CLEAR');
assert(glass.panels.some(panel => panel.name.includes('Shelf') && panel.mat === glassShelf.materialDescription));
const glassCost = computeCosting([{ id: 1, m: glass, qty: 1, elevation: 'AA' }], [], [], [], [], [], [], glass.shType, glass.shType, {}, { carcass: 10, shutter: 20, profile: 20 }, {});
assert(glassCost.lines[0].details.some(detail => detail.category === 'Shutter glass' && detail.rate === 210));
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
