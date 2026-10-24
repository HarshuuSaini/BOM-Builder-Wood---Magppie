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
  if (file.endsWith('WoodBomBuilder.tsx')) source += '\nexport { buildModel, computeCosting };';
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  } }).outputText, file);
};

const { COSTING_ITEMS, DEFAULT_BOARD_PROCESSING_RATES, SINK_STONE_BOARD_ID } = require('../src/lib/costing.ts');
const { buildModel, computeCosting } = require('../src/components/WoodBomBuilder.tsx');
const { updateMaterialChoices } = require('../src/components/MaterialSelection.tsx');
const stoneItem = COSTING_ITEMS.find(item => item.id === SINK_STONE_BOARD_ID);
assert.equal(stoneItem.price, 2004);
assert.equal(stoneItem.currentRate, 2004 / 32);
assert.equal(DEFAULT_BOARD_PROCESSING_RATES['Carcass / shelf material|Prelam'], 36);
const selection = {
  carcass: { itemId: 'KITCHEN-007', frontSheetPrice: '550', backSheetPrice: '550' },
  back: { itemId: 'KITCHEN-035', frontSheetPrice: '550', backSheetPrice: '550' },
  drawer: { itemId: 'KITCHEN-029', frontSheetPrice: '550', backSheetPrice: '550' },
  shutter: { itemId: 'KITCHEN-014', frontSheetPrice: '961', backSheetPrice: '961' },
  visible: { itemId: 'KITCHEN-014', frontSheetPrice: '961', backSheetPrice: '961' },
};
const changed = updateMaterialChoices(selection, 'carcass', { itemId: SINK_STONE_BOARD_ID }, []);
assert.equal(changed.choices.carcass.itemId, SINK_STONE_BOARD_ID);
assert.equal(changed.choices.back.itemId, 'KITCHEN-035');
assert.equal(changed.choices.drawer.itemId, 'KITCHEN-029');

const config = {
  zk: 'BC', fk: 'SK', vid: 'single', hand: 'LHS', handle: 'NONE',
  board: SINK_STONE_BOARD_ID, backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029',
  shType: 'KITCHEN-014', visibleSides: '', visibleSideMaterialId: 'KITCHEN-014',
  glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
  carcassLamFrontSheetPrice: '550', carcassLamBackSheetPrice: '550',
  backLamFrontSheetPrice: '550', backLamBackSheetPrice: '550',
  drawerLamFrontSheetPrice: '550', drawerLamBackSheetPrice: '550',
  visibleLamFrontSheetPrice: '550', visibleLamBackSheetPrice: '550',
  shutterLamFrontSheetPrice: '550', shutterLamBackSheetPrice: '550',
  W: 600, H: 720, D: 560, drawerModel: 'Hettich', finish: 'White',
};
const stone = buildModel(config);
assert.match(stone.code, /-ST-/);
assert(stone.panels.some(panel => panel.mat === stoneItem.materialDescription));
assert(stone.panels.filter(panel => panel.mat === stoneItem.materialDescription).every(panel => !panel.band));
for (const name of ['AKEMI 5010', 'GLUE BONDTITE', 'GLUE SILICONE']) {
  assert(stone.cons.some(consumable => consumable.name.includes(name)), `${name} must be in the stone BOM`);
}
const project = [{ id: 1, m: stone, qty: 1, elevation: 'AA' }];
const waste = { carcass: 10, shutter: 20, profile: 20 };
const costing = computeCosting(project, [], [], [], [], [], [], config.shType, config.shType, {}, waste, {});
const board = costing.lines[0].details.find(detail => detail.itemCode === SINK_STONE_BOARD_ID);
const processing = costing.lines[0].details.find(detail => detail.itemCode === `${SINK_STONE_BOARD_ID}-PROC`);
assert.equal(board.rate, 2004 / 32);
assert.equal(processing.rate, 36);
assert.equal(processing.billableQty, board.billableQty);
assert(costing.lines[0].details.filter(detail => detail.specification.includes('Stone pasting')).length >= 3);

const custom = buildModel({ ...config, boardPrices: { carcass: { itemId: SINK_STONE_BOARD_ID, sheetPrice: '2400' } } });
const customCosting = computeCosting([{ ...project[0], m: custom }], [], [], [], [], [], [], config.shType, config.shType, {}, waste, {});
assert.equal(customCosting.lines[0].details.find(detail => detail.itemCode === SINK_STONE_BOARD_ID).rate, 2400 / 32);
const wood = buildModel({ ...config, board: 'KITCHEN-007' });
assert.match(wood.code, /-WD-/);
assert(!wood.cons.some(consumable => consumable.pack === 'Stone pasting'));
console.log('PASS: sink stone default/custom sheet rate, processing, pasting BOM and wood fallback.');
