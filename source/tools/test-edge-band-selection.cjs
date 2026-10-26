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
  if (file.endsWith('WoodBomBuilder.tsx')) source += '\nexport { buildModel, computeCosting, buildFullBomData, cabinetConfig, validatedCabinetConfig, cabinetConfigWithSelectedMaterials };';
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  } }).outputText, file);
};

const { buildModel, computeCosting, buildFullBomData, cabinetConfig, validatedCabinetConfig, cabinetConfigWithSelectedMaterials } = require('../src/components/WoodBomBuilder.tsx');
const edgeBand = { finish: 'Oak 0.8mm', carcassPricePerRmt: '8', shutterPricePerRmt: '14.2' };
const config = {
  zk: 'BC', fk: 'SH', vid: 'single', hand: 'LHS', handle: 'NONE', board: 'KITCHEN-007',
  backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029', shType: 'KITCHEN-014',
  visibleSides: '', visibleSideMaterialId: 'KITCHEN-014', glassType: 'KITCHEN-GLASS-5-TINTED',
  hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
  carcassLamFrontSheetPrice: '550', carcassLamBackSheetPrice: '550', backLamFrontSheetPrice: '550', backLamBackSheetPrice: '550',
  drawerLamFrontSheetPrice: '550', drawerLamBackSheetPrice: '550', visibleLamFrontSheetPrice: '550', visibleLamBackSheetPrice: '550',
  shutterLamFrontSheetPrice: '550', shutterLamBackSheetPrice: '550', W: 600, H: 720, D: 560,
  drawerModel: 'Hettich', finish: 'White', edgeBand,
};
const model = buildModel(config);
const project = [{ id: 1, m: model, qty: 1, elevation: 'AA' }];
const result = computeCosting(project, [], [], [], [], [], [], config.shType, config.shType, {},
  { carcass: 10, shutter: 20, profile: 20 }, {});
const details = result.lines[0].details;
assert(details.some((detail) => detail.category === 'Carcass edge band' && detail.rate === 8 && detail.amount > 0));
assert(details.some((detail) => detail.category === 'Shutter edge band' && detail.rate === 14.2 && detail.amount > 0));
for (const detail of details.filter((row) => row.category.endsWith('edge band'))) {
  assert.equal(detail.wastePct, 3);
  assert(Math.abs(detail.billableQty - detail.netQty / 0.97) < 1e-9);
  assert(Math.abs(detail.amount - detail.billableQty * detail.rate) < 0.05);
}
assert(model.cons.some((item) => item.name === 'EDGE BAND 0.8MM Oak 0.8mm'));
assert(buildFullBomData(project, '', 'White').some((row) => row.Item === 'EDGE BAND 0.8MM Oak 0.8mm' && row.Finish === 'Oak 0.8mm' && row['Waste %'] === 3));
const editedWaste = { carcass: 10, shutter: 20, profile: 20, edgeBand: 5 };
const editedCost = computeCosting(project, [], [], [], [], [], [], config.shType, config.shType, {}, editedWaste, {});
assert(editedCost.lines[0].details.filter((row) => row.category.endsWith('edge band')).every((row) => row.wastePct === 5 && Math.abs(row.billableQty - row.netQty / 0.95) < 1e-9));
assert(buildFullBomData(project, '', 'White', editedWaste).filter((row) => row.Item === 'EDGE BAND 0.8MM Oak 0.8mm').every((row) => row['Waste %'] === 5));
assert.deepEqual(validatedCabinetConfig(cabinetConfig(model)).edgeBand, edgeBand);

const choice = (itemId) => ({ itemId, frontSheetPrice: '550', backSheetPrice: '550' });
const zone = { carcass: choice('KITCHEN-007'), back: choice('KITCHEN-035'), drawer: choice('KITCHEN-029'),
  shutter: choice('KITCHEN-014'), visible: choice('KITCHEN-014'), edgeBand };
const materials = { Base: zone, Sink: zone, Wall: zone, Tall: zone, Loft: zone, Mid: zone };
assert.deepEqual(cabinetConfigWithSelectedMaterials({ ...config, edgeBand: undefined }, materials).edgeBand, edgeBand);

const perMaterial = { ...edgeBand, byMaterial: {
  carcass: { finish: 'Carcass White 0.8mm', pricePerRmt: '7' },
  back: { finish: 'Back Grey 0.8mm', pricePerRmt: '9' },
  drawer: { finish: 'Drawer Oak 0.8mm', pricePerRmt: '11' },
  shutter: { finish: 'Shutter Black 0.8mm', pricePerRmt: '15' },
  visible: { finish: 'Visible Walnut 0.8mm', pricePerRmt: '17' },
} };
const distinctModel = buildModel({ ...config, edgeBand: perMaterial, visibleSides: 'LH' });
const distinctProject = [{ id: 2, m: distinctModel, qty: 1, elevation: 'AB' }];
const distinctDetails = computeCosting(distinctProject, [], [], [], [], [], [], config.shType, config.shType, {},
  { carcass: 10, shutter: 20, profile: 20 }, {}).lines[0].details.filter((row) => row.category.endsWith('edge band'));
for (const [field, selection] of Object.entries(perMaterial.byMaterial)) {
  if (!distinctModel.panels.some((panel) => panel.band && (field === 'visible' ? panel.visibleSide :
    field === 'shutter' ? panel.pack === 'Shutter Pack' : field === 'back' ? panel.pack === 'Carcass Pack' && /back/i.test(panel.name) :
    field === 'drawer' ? panel.pack === 'Drawer Pack' : panel.pack === 'Carcass Pack' && !panel.visibleSide))) continue;
  assert(distinctDetails.some((row) => row.specification.includes(`${field} ·`) && row.rate === Number(selection.pricePerRmt) && row.item.includes(selection.finish)), field);
  assert(buildFullBomData(distinctProject, '', 'White').some((row) => row.Item === `EDGE BAND 0.8MM ${selection.finish}` && row.Finish === selection.finish), field);
}
assert.deepEqual(validatedCabinetConfig(cabinetConfig(distinctModel)).edgeBand, perMaterial);
console.log('Edge-band finish and per-RMT costing: OK');
