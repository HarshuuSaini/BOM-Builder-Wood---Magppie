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
  if (file.endsWith('WoodBomBuilder.tsx')) source += '\nexport { buildModel, computeCosting, buildBoardTotals };';
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  } }).outputText, file);
};

const { COSTING_ITEMS, DEFAULT_BOARD_PROCESSING_RATES, SINK_STONE_BOARD_ID } = require('../src/lib/costing.ts');
const { buildModel, computeCosting, buildBoardTotals } = require('../src/components/WoodBomBuilder.tsx');
const { updateMaterialChoices } = require('../src/components/MaterialSelection.tsx');
const { boardPricesFromMaterials, stoneSlabAreaFromDimensions } = require('../src/lib/kitchen-materials.ts');
const stoneItem = COSTING_ITEMS.find(item => item.id === SINK_STONE_BOARD_ID);
assert.equal(stoneItem.price, 2004);
assert.equal(stoneItem.currentRate, 2004 / 21);
assert.equal(stoneItem.sqft, 21);
assert.equal(stoneItem.thicknessMm, 15);
assert.equal(stoneSlabAreaFromDimensions(2400, 800), '21');
assert.equal(stoneSlabAreaFromDimensions(3000, 900), '29');
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
const selectedStone = boardPricesFromMaterials({ ...changed.choices, carcass: {
  ...changed.choices.carcass, boardSheetPrice: '2400', boardFinish: 'Black Galaxy',
  slabLengthMm: '3000', slabWidthMm: '900', slabSqft: stoneSlabAreaFromDimensions(3000, 900),
} }).carcass;
assert.deepEqual([selectedStone.sheetPrice, selectedStone.finish, selectedStone.slabSqft, selectedStone.slabLengthMm, selectedStone.slabWidthMm],
  ['2400', 'Black Galaxy', '29', '3000', '900']);
const backToWood = updateMaterialChoices({ ...changed.choices, carcass: {
  ...changed.choices.carcass, boardFinish: 'Black Galaxy', slabSqft: '29', slabLengthMm: '3000', slabWidthMm: '900',
} }, 'carcass', { itemId: 'KITCHEN-007' }, []);
assert.equal(backToWood.choices.carcass.slabSqft, undefined);
assert.equal(backToWood.choices.carcass.boardFinish, undefined);

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
assert(stone.panels.some(panel => panel.name.includes('Stone Back') && panel.h > 100));
assert(!stone.panels.some(panel => /Back.*x100\b/.test(panel.name)));
assert(stone.panels.some(panel => panel.mat === stoneItem.materialDescription));
assert(stone.panels.filter(panel => panel.mat === stoneItem.materialDescription).every(panel => !panel.band));
assert(stone.panels.filter(panel => panel.mat === stoneItem.materialDescription).every(panel => panel.t === 15));
assert(!stone.cons.some(consumable => consumable.name.includes('AKEMI')));
for (const name of ['GLUE BONDTITE', 'GLUE SILICONE']) {
  assert(stone.cons.some(consumable => consumable.name.includes(name)), `${name} must be in the stone BOM`);
}
assert.equal(stone.cons.find(consumable => consumable.name.includes('BONDTITE')).qty, 0.05);
assert.equal(stone.cons.find(consumable => consumable.name.includes('SILICONE')).qty, 0.5);
const project = [{ id: 1, m: stone, qty: 1, elevation: 'AA' }];
const waste = { carcass: 10, shutter: 20, profile: 20 };
const costing = computeCosting(project, [], [], [], [], [], [], config.shType, config.shType, {}, waste, {});
const board = costing.lines[0].details.find(detail => detail.itemCode === SINK_STONE_BOARD_ID);
const processing = costing.lines[0].details.find(detail => detail.itemCode === `${SINK_STONE_BOARD_ID}-PROC`);
assert.equal(board.rate, 2004 / 21);
assert.equal(board.purchaseAreaSqft, 21);
assert.equal(processing.rate, 36);
assert.equal(processing.billableQty, board.billableQty);
assert.equal(costing.lines[0].details.filter(detail => detail.specification.includes('Stone pasting')).length, 2);
assert.equal(costing.purchases.find(purchase => purchase.itemCode === SINK_STONE_BOARD_ID).unit, 'slab');
assert.equal(costing.purchases.find(purchase => purchase.itemCode === 'KITCHEN-SINK-BONDTITE').amount, 122);
assert.equal(costing.purchases.find(purchase => purchase.itemCode === 'KITCHEN-SINK-SILICONE').amount, 127.5);
const stoneTotal = buildBoardTotals(project, waste).find(row => row.mat === stoneItem.materialDescription);
assert.equal(stoneTotal.sheetAreaSqft, 21);
assert.equal(stoneTotal.sheets, Math.round((stoneTotal.billableSqft / 21) * 100) / 100);

const custom = buildModel({ ...config, boardPrices: { carcass: { itemId: SINK_STONE_BOARD_ID, sheetPrice: '2400', slabSqft: '24', finish: 'Black Galaxy' } } });
const customCosting = computeCosting([{ ...project[0], m: custom }], [], [], [], [], [], [], config.shType, config.shType, {}, waste, {});
assert.equal(customCosting.lines[0].details.find(detail => detail.itemCode === SINK_STONE_BOARD_ID).rate, 2400 / 24);
assert.equal(customCosting.purchases.find(purchase => purchase.itemCode === SINK_STONE_BOARD_ID).rate, 2400);
assert(customCosting.lines[0].details.find(detail => detail.itemCode === SINK_STONE_BOARD_ID).item.includes('Black Galaxy'));
const wood = buildModel({ ...config, board: 'KITCHEN-007' });
assert.match(wood.code, /-WD-/);
assert(wood.panels.some(panel => /Back.*x100\b/.test(panel.name)));
assert(!wood.cons.some(consumable => consumable.pack === 'Stone pasting'));
const stoneWithoutBack = buildModel({ ...config, sinkStoneFullBack: false });
assert(!stoneWithoutBack.panels.some(panel => /\bBack\b/.test(panel.name)));
assert(stoneWithoutBack.panels.length < stone.panels.length);
console.log('PASS: sink stone default/custom sheet rate, processing, pasting BOM and wood fallback.');
