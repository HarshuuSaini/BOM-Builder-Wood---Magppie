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
  if (file.endsWith('WoodBomBuilder.tsx')) source += '\nexport {computeCosting, buildModel, blindOpeningError, cabinetFillers, cabinetAccessories, buildExtrasBom, calculatedAccessories, buildMasterAccessoryRows, buildAccessoryRows, restoreAccessoryRow, restoreLegacyBom, countertopMaterialItem, countertopMaterialId, counterPlyAreaSqft, DEFAULT_RATES, DEFAULT_LAMINATE_PRICES};';
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  } }).outputText, file);
};
const { purchaseTotals, allocatePurchaseCosts, ceilQuantity, roundQuantity, sheetQuantityInput } = require('../src/lib/purchase-rounding.ts');
for (const [input, expected] of [['4.287328756949', '4.29'], ['5.8506770203644', '5.85'], ['2.2896212545897', '2.29'], ['1.0908247727953', '1.09']]) {
  assert.equal(sheetQuantityInput(input), expected);
  assert.equal(roundQuantity(Number(input)), Number(expected));
}
assert.equal(sheetQuantityInput(''), '');
assert.equal(sheetQuantityInput('4.'), '4.');
assert.equal(sheetQuantityInput('0'), '0');
const detail = (id, qty, uom, rate, category = 'Hardware') => ({
  itemCode: id, item: id, category, specification: '', netQty: qty, wastePct: 0,
  billableQty: qty, uom, rate, amount: qty * rate,
});
const line = details => ({ label: '', qty: 1, cost: 0, unitCost: 0, details });
const near = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
assert.equal(ceilQuantity(6.1), 7);
assert.equal(ceilQuantity(6), 6);
assert.equal(ceilQuantity(6 + Number.EPSILON * 4), 6);
assert.equal(ceilQuantity(6.0000001), 7);
assert.equal(ceilQuantity(0), 0);
const rows = [
  line([detail('BOARD', 3.05 * 32, 'sqft', 100, 'Carcass board')]),
  line([detail('BOARD', 3.05 * 32, 'sqft', 100, 'Visible side board')]),
  line([detail('GLUE', 1500, 'gm', 0.4, 'Consumable')]),
  line([detail('GLUE', 1.9712, 'kg', 400, 'Consumable')]),
  line([detail('PROFILE', 2.1, 'RMT', 104, 'Profile'), detail('PROFILE', 2.1, 'RMT', 104, 'Hardware')]),
  line([detail('LAM', 32.1, 'sqft', 10, 'Front laminate')]),
  line([detail('PROC', 32.1, 'sqft', 45, 'Shutter material processing')]),
  line([detail('PIN', 6.1, 'nos', 0), detail('SET', 2.1, 'set', 100)]),
];
const totals = allocatePurchaseCosts(rows);
const get = id => totals.find(x => x.itemCode === id);
near(get('BOARD').quantity, 6.1);
near(get('BOARD').amount, 19520);
near(get('GLUE').quantity, 3.47);
near(get('GLUE').amount, 1388);
near(get('PROFILE').quantity, 4.2);
near(get('LAM').quantity, 1);
near(get('LAM').amount, 320);
near(purchaseTotals([detail('DECIMAL', 0.9241325678, 'kg', 400)])[0].amount, 368);
// Combine first: separately rounding 0.004 + 0.004 would incorrectly yield zero.
near(purchaseTotals([detail('SMALL', 0.004, 'kg', 400), detail('SMALL', 0.004, 'kg', 400)])[0].quantity, 0.01);
assert.equal(get('PROC').quantity, 32.1);
assert.equal(get('PIN').quantity, 6.1);
assert.equal(get('SET').quantity, 2.1);
near(rows.reduce((s, x) => s + x.cost, 0), totals.reduce((s, x) => s + x.amount, 0));
const partial = [line([detail('BOARD', 3.05 * 32, 'sqft', 100, 'Carcass board')])];
allocatePurchaseCosts(partial, totals);
near(partial[0].cost, 9760);
assert.equal(purchaseTotals([detail('B', 1, 'sqft', 10, 'Carcass board'), detail('B', 1, 'sqft', 20, 'Carcass board')]).length, 2);
const again = rows.reduce((s, x) => s + x.cost, 0);
allocatePurchaseCosts(rows);
near(rows.reduce((s, x) => s + x.cost, 0), again);

const b = require('../src/components/WoodBomBuilder.tsx');
const { handleSettingFor } = require('../src/lib/kitchen-materials.ts');
const { updateMaterialChoices } = require('../src/components/MaterialSelection.tsx');
assert.equal(handleSettingFor(undefined, 'BC').type, 'XCJ');
assert.equal(handleSettingFor(undefined, 'TC').type, 'XCJ');
assert.equal(handleSettingFor(undefined, 'WC').type, 'NONE');
assert.equal(handleSettingFor(undefined, 'LO').type, 'NONE');
assert.equal(handleSettingFor(undefined, 'MD').type, 'NONE');
assert.equal(handleSettingFor({ _handleDefaults: { Wall: { type: 'XCJ', price: '', brand: '' } } }, 'WC').type, 'NONE');
const laminateChoices = Object.fromEntries(['carcass', 'back', 'drawer', 'shutter', 'visible'].map(field => [field,
  { itemId: field, frontSheetPrice: '550', backSheetPrice: '950', boardSheetPrice: String(field.length * 100) }]));
const cascaded = updateMaterialChoices(laminateChoices, 'carcass', { frontSheetPrice: '431' }, []).choices;
for (const field of ['carcass', 'back', 'drawer']) {
  assert.equal(cascaded[field].frontSheetPrice, '431');
  assert.equal(cascaded[field].backSheetPrice, '431');
  assert.equal(cascaded[field].boardSheetPrice, String(field.length * 100));
}
const drawerOverride = updateMaterialChoices(cascaded, 'drawer', { frontSheetPrice: '600' }, []).choices;
assert.equal(drawerOverride.drawer.frontSheetPrice, '600');
assert.equal(drawerOverride.carcass.frontSheetPrice, '431');
assert.equal(drawerOverride.back.frontSheetPrice, '431');
const shutterFrontOverride = updateMaterialChoices(cascaded, 'shutter', { frontSheetPrice: '961' }, [
  { id: 'shutter', group: 'Shutter Material', subgroup: 'POSTlam MDF BSL', boardSheetPrice: '2084', type: 'POSTLAM' },
  { id: 'visible', group: 'Shutter Material', subgroup: 'POSTlam MDF BSL', boardSheetPrice: '2084', type: 'POSTLAM' },
]).choices;
assert.equal(shutterFrontOverride.shutter.frontSheetPrice, '961');
assert.equal(shutterFrontOverride.shutter.backSheetPrice, '950');
const visibleBackOverride = updateMaterialChoices(shutterFrontOverride, 'visible', { backSheetPrice: '1200' }, []).choices;
assert.equal(visibleBackOverride.visible.frontSheetPrice, '961');
assert.equal(visibleBackOverride.visible.backSheetPrice, '1200');
const config = { zk: 'BC', fk: 'SK', vid: 'double', hand: 'LHS', handle: 'STD', board: 'KITCHEN-007',
  backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029', shType: 'KITCHEN-013',
  visibleSides: 'LH', visibleSideMaterialId: 'KITCHEN-013', ...b.DEFAULT_LAMINATE_PRICES,
  backLamFrontSheetPrice: '550', backLamBackSheetPrice: '550', drawerLamFrontSheetPrice: '550',
  drawerLamBackSheetPrice: '550', visibleLamFrontSheetPrice: '550', visibleLamBackSheetPrice: '550',
  glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
  W: 900, H: 720, D: 560, drawerModel: 'Hettich', finish: 'White' };
const model = b.buildModel(config);
const blindConfig = { ...config, zk: 'BB', fk: 'BSH', W: 1050 };
const blindDefault = b.buildModel(blindConfig);
const blindChanged = b.buildModel({ ...blindConfig, blindOpeningWidth: 450 });
assert.deepEqual(blindDefault.panels.filter(panel => panel.name.includes('Blind')).map(panel => panel.w), [547, 497]);
assert.deepEqual(blindChanged.panels.filter(panel => panel.name.includes('Blind')).map(panel => panel.w), [447, 597]);
assert.equal(b.blindOpeningError('BB', 1050, 450), '');
assert.equal(b.blindOpeningError('BB', 1050, 550), '');
assert.match(b.blindOpeningError('BB', 1050, 449), /between 450 and 550/);
assert.match(b.blindOpeningError('BB', 1050, 551), /between 450 and 550/);
assert.match(b.blindOpeningError('BB', 500, 500), /fixed panel/);
assert.equal(b.blindOpeningError('BC', 500, 100), '');
const wallBlind = b.buildModel({ ...config, zk: 'WB', fk: 'WST', W: 900 });
assert.equal(wallBlind.panels.find(panel => panel.name.includes('Blind Active')).w, 447);
const wallGlassSpot = b.buildModel({ ...config, zk: 'WC', fk: 'WGL', W: 450, spotLight: true });
const wallGlassSpotLine = [{ id: 12, m: wallGlassSpot, qty: 2, elevation: 'BB' }];
const spotAccessories = b.cabinetAccessories(wallGlassSpotLine);
assert.equal(spotAccessories.length, 1);
assert.equal(spotAccessories[0].itemId, 'KITCHEN-091');
assert.equal(spotAccessories[0].qty, 2);
assert.equal(spotAccessories[0].elevation, 'BB');
assert.equal(b.buildMasterAccessoryRows(spotAccessories, '')[0]['Zoho Item ID'], 'KITCHEN-091');
assert.equal(b.buildModel({ ...config, zk: 'WC', fk: 'WST', spotLight: true }).spotLight, false);
assert.equal(b.buildModel({ ...config, zk: 'LO', fk: 'LGL', spotLight: true }).spotLight, false);
const spotCost = b.computeCosting([], [], [], [], [], [], spotAccessories, config.shType, config.shType,
  b.DEFAULT_RATES, { carcass: 10, shutter: 20, profile: 20 }, {});
assert.equal(spotCost.purchases.find(row => row.itemCode === 'KITCHEN-091').quantity, 2);
for (const [width, id] of [[450, 'ACCESSORIES-130'], [600, 'ACCESSORIES-136']]) {
  const pantry = b.buildModel({ ...config, zk: 'TC', fk: 'PAN', W: width, H: 2400 });
  const accessory = b.cabinetAccessories([{ id: width, m: pantry, qty: 1, elevation: 'AA' }]);
  assert(accessory.some(row => row.itemId === id), `Missing ${width}mm tandem pantry accessory`);
}
const twoFillerCabinet = b.buildModel({ ...config, fillerWidth: 50, fillerSides: 'BOTH', fillerWidthRH: 80 });
const twoFillerProject = [{ id: 100, m: twoFillerCabinet, qty: 2, elevation: 'AA' }];
const sideFillers = b.cabinetFillers(twoFillerProject);
assert.deepEqual(sideFillers.map(row => [row.fillerSide, row.customWidth, row.customHeight, row.qty]),
  [['LH', '50', '720', 2], ['RH', '80', '720', 2]]);
const sidePanels = b.buildExtrasBom(sideFillers, [], [], twoFillerProject, '', config.shType, config.shType, config.finish,
  { carcass: 10, shutter: 20, profile: 20 });
assert.deepEqual(sidePanels.panels.map(panel => panel.w), [50, 80]);
assert(sidePanels.panels.some(panel => panel.name.includes('Filler LH')));
assert(sidePanels.panels.some(panel => panel.name.includes('Filler RH')));
const singleRh = b.cabinetFillers([{ ...twoFillerProject[0], m: b.buildModel({ ...config, fillerWidth: 50, fillerSides: 'RH', fillerWidthRH: 80 }) }]);
assert.deepEqual(singleRh.map(row => [row.fillerSide, row.customWidth]), [['RH', '80']]);
const legacyFiller = b.cabinetFillers([{ ...twoFillerProject[0], m: b.buildModel({ ...config, fillerWidth: 50 }) }]);
assert.deepEqual(legacyFiller.map(row => [row.fillerSide, row.customWidth]), [['LH', '50']]);
const skirtingWithBoth = b.calculatedAccessories(twoFillerProject, sideFillers).find(row => row.kind === 'skirting');
near(Number(skirtingWithBoth.size), (config.W * 2 + (50 + 80) * 2) / 1000);
assert.equal(model.code.split('-')[2], 'STD');
for (const [handle, token] of [['XCJ', 'CJ'], ['NONE', 'NHX'], ['PUSH', 'STD'], ['KNOB', 'STD'], ['HANDLE', 'STD']]) {
  const cabinet = b.buildModel({ ...config, handle });
  assert.equal(cabinet.code.split('-')[2], token);
  if (handle === 'NONE') {
    const restored = b.restoreLegacyBom([{ Level: 0, Item: cabinet.code, 'SO Qty': 1, Elevation: 'AA' }]);
    assert.equal(restored.project[0].m.code.split('-')[2], 'NHX');
    assert.equal(restored.project[0].m.handle, 'NONE');
  }
}
const combinedLaminateModel = b.buildModel({ ...config, carcassLamFrontSheetPrice: '431', carcassLamBackSheetPrice: '999',
  backLamFrontSheetPrice: '431', backLamBackSheetPrice: '999', shutterLamFrontSheetPrice: '431', shutterLamBackSheetPrice: '431',
  visibleLamFrontSheetPrice: '431', visibleLamBackSheetPrice: '431' });
assert.equal(combinedLaminateModel.carcassLamBackSheetPrice, '431');
for (const pack of ['Carcass Pack', 'Shutter Pack']) {
  const laminateRows = combinedLaminateModel.cons.filter(row => row.pack === pack && row.name.includes('LAMINATE 0.8MM'));
  assert(laminateRows.length > 0);
  assert(laminateRows.every(row => !/FRONT|BACK|OUTER|LINER/.test(row.name)));
}
const combinedLaminateCost = b.computeCosting([{ id: 1, m: combinedLaminateModel, qty: 1, elevation: 'AA' }], [], [], [], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, { carcass: 10, shutter: 20, profile: 20 }, {});
const laminateDetails = combinedLaminateCost.lines[0].details.filter(row => row.category.endsWith(' laminate'));
assert(laminateDetails.length > 0);
assert(laminateDetails.every(row => row.rate === 431 / 32 && row.specification.includes('Both faces')));
assert(laminateDetails.every(row => !/front|back|outer|liner/i.test(row.category)));
const differentShutterVisiblePrices = b.buildModel({ ...config,
  boardPrices: { shutter: { itemId: config.shType, sheetPrice: '2084' }, visible: { itemId: config.visibleSideMaterialId, sheetPrice: '2400' } },
  shutterLamFrontSheetPrice: '961', shutterLamBackSheetPrice: '400',
  visibleLamFrontSheetPrice: '1100', visibleLamBackSheetPrice: '400' });
const separatePrices = b.computeCosting([{ id: 1, m: differentShutterVisiblePrices, qty: 1, elevation: 'AA' }], [], [], [], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, { carcass: 10, shutter: 20, profile: 20 }, {}).lines[0].details;
for (const [category, sheetPrice] of [['Shutter board', 2084], ['Visible side board', 2400], ['Shutter laminate', 961], ['Visible side laminate', 1100]]) {
  const row = separatePrices.find(detail => detail.category === category);
  assert(row, `Missing ${category}`);
  near(row.rate, sheetPrice / 32);
}
for (const category of ['Shutter laminate', 'Visible side laminate']) {
  const faces = separatePrices.filter(detail => detail.category === category);
  assert.equal(faces.length, 2);
  assert(faces.some(detail => detail.specification.startsWith('Front face') && detail.rate === (category === 'Shutter laminate' ? 961 : 1100) / 32));
  assert(faces.some(detail => detail.specification.startsWith('Back face') && detail.rate === 400 / 32));
}
const drawerModel = b.buildModel({...config, fk: 'DW', vid: '2dr-mixed'});
const drawerPanels = drawerModel.panels.filter(p => p.pack === 'Drawer Pack');
assert(drawerPanels.length > 0 && drawerPanels.every(p => p.band));
const bandPerPanel = p => (2 * (p.w + p.h) + 4 * 50) / 1000;
const drawerBand = drawerPanels.reduce((sum, p) => sum + bandPerPanel(p) * p.qty, 0);
near(drawerModel.cons.find(c => c.pack === 'Drawer Pack' && c.name.startsWith('EDGE BAND')).qty, Math.round(drawerBand * 1000) / 1000);
near(drawerModel.cons.find(c => c.pack === 'Drawer Pack' && c.name === 'EDGEBAND ADHESIVE').qty, Math.round(drawerBand * 6 * 1000) / 1000);
const drawerCost = b.computeCosting([{id: 1, m: drawerModel, qty: 1, elevation: 'AA'}], [], [], [], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {});
const nonShutterBand = drawerModel.panels.filter(p => p.band && p.pack !== 'Shutter Pack' && !p.visibleSide)
  .reduce((sum, p) => sum + bandPerPanel(p) * p.qty, 0);
near(drawerCost.lines[0].details.find(d => d.category === 'Carcass edge band').netQty, nonShutterBand);
const shutterPanels = model.panels.filter(p => p.band && (p.pack === 'Shutter Pack' || p.visibleSide));
const shutterBand = shutterPanels.reduce((sum, p) => sum + bandPerPanel(p) * p.qty, 0);
const shutterCost = b.computeCosting([{id: 1, m: model, qty: 1, elevation: 'AA'}], [], [], [], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {});
near(shutterCost.lines[0].details.find(d => d.category === 'Shutter edge band').netQty, shutterBand);
near(model.cons.find(c => c.pack === 'Shutter Pack' && c.name.startsWith('EDGE BAND')).qty,
  Math.round(shutterBand * 1000) / 1000);
const calc = (project, totals) => b.computeCosting(project, [], [], [], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {}, totals);
const project = [{ id: 1, m: model, qty: 1, elevation: 'AA' }, { id: 2, m: model, qty: 1, elevation: 'BB' }];
const full = calc(project);
const counter = b.computeCosting([], [], [], [{id: 1, materialId: 'KITCHEN-014', material: 'POSTlam BWP Ply BSL', ratePerSqft: '166.8125', length: '2050', depth: '600', thickness: '18', qty: 1}], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {});
near(b.counterPlyAreaSqft({length: '2050', thickness: '18', depth: '600', qty: 2}), 2050 * 18 * 2 / 92903);
near(counter.lines[0].details[0].netQty, 2050 * 18 / 92903);
near(counter.lines[0].details[0].rate, 2612.4 / 32);
near(counter.purchases[0].rate, 2612.4);
near(counter.total, counter.purchases[0].quantity * 2612.4);
const counterBase = {id: 1, materialId: 'KITCHEN-030', material: 'RAW BWR Ply Counter Base-16mm', ratePerSqft: '166.81', length: '2050', depth: '600', thickness: '16', qty: 1};
assert.equal(b.countertopMaterialId(counterBase), 'KITCHEN-030');
assert.equal(b.countertopMaterialItem(counterBase, config.shType).thicknessMm, 16);
assert.equal(b.countertopMaterialId({...counterBase, materialId: undefined}), 'KITCHEN-030');
assert.equal(b.countertopMaterialItem({...counterBase, materialId: 'KITCHEN-007'}, config.shType).id, 'KITCHEN-007');
const counterBaseCost = b.computeCosting([], [], [], [counterBase], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {});
assert.equal(counterBaseCost.lines[0].details[0].itemCode, 'KITCHEN-030');
near(counterBaseCost.lines[0].details[0].rate, 2612.3 / 32);
near(counterBaseCost.purchases[0].rate, 2612.3);
near(counterBaseCost.total, counterBaseCost.purchases[0].quantity * 2612.3);
assert(counterBaseCost.lines[0].details[0].specification.includes('16mm'));
const otherRows = [
  { id: 1, kind: 'elenor', size: '1.75', qty: 3, elevation: 'AA', straight: 0, lconn: 0, driver: '' },
  { id: 2, kind: 'c-handle', size: '0.375', qty: 2, elevation: 'AA', straight: 0, lconn: 0, driver: '' },
  { id: 3, kind: 'j-handle', size: '1.25', qty: 2, elevation: 'AA', straight: 0, lconn: 0, driver: '' },
  { id: 4, kind: 'skirting', size: '3.2', qty: 2, elevation: 'AA', straight: 0, lconn: 0, driver: '' },
];
const otherCost = b.computeCosting([], [], [], [], [], otherRows, [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {});
for (const [id, qty] of [['KITCHEN-084', 5.25], ['KITCHEN-085', 5.25], ['KITCHEN-086', 5.25], ['KITCHEN-050', 0.75], ['KITCHEN-049', 2.5], ['KITCHEN-092', 7.04]]) {
  const purchase = otherCost.purchases.find(p => p.itemCode === id);
  assert(purchase, `Missing other accessory ${id}`);
  near(purchase.quantity, qty);
  assert.equal(purchase.unit, 'RMT');
}
const otherExport = b.buildAccessoryRows(otherRows, [], '');
near(otherExport[0]['Actual Qty'], 5.25);
assert.equal(otherExport[0].Size, '1.75 m × 3');
near(otherExport.find(r => r['Item Name'] === 'PVC SKIRTING PROFILE 100MM').Total, 6.4);
assert.equal(otherExport.find(r => r['Item Name'] === 'PVC SKIRTING PROFILE 100MM').Size, '3.2 m × 2');
near(otherExport.find(r => r['Item Name'].includes('LIGHT EXTENSION WIRE')).Total, 6);
near(otherExport.find(r => r['Zoho Item ID'] === 'KITCHEN-050')['Actual Qty'], 0.75);
const pendingHardware = otherExport.filter(r => r.Accessory.includes('quantity pending'));
assert.equal(pendingHardware.length, 6);
assert(pendingHardware.every(r => r.Total === '' && r['Actual Qty'] === ''));
assert.deepEqual(pendingHardware.map(r => r['Zoho Item ID']), ['HARDWARE-022', 'HARDWARE-023', 'HARDWARE-026', 'HARDWARE-024', 'HARDWARE-025', 'HARDWARE-026']);
assert.equal(otherCost.unpriced.filter(r => r.includes('(quantity pending)')).length, 5);
assert(!otherCost.purchases.some(r => pendingHardware.some(h => h['Zoho Item ID'] === r.itemCode)));
const legacyLightRow = b.restoreAccessoryRow({...otherRows[0], lengthMeters: undefined, size: '1000', qty: 2}, 1, []);
assert.equal(legacyLightRow.size, '1');
assert.equal(legacyLightRow.qty, 2);
const legacyLight = b.buildAccessoryRows([legacyLightRow], [], '');
near(legacyLight[0]['Actual Qty'], 2);
const legacyHandle = b.restoreAccessoryRow({...otherRows[1], lengthMeters: 0.75, size: '', qty: 1}, 1, []);
assert.equal(legacyHandle.size, '0.75');
assert.equal(legacyHandle.qty, 1);
const legacySkirting = b.restoreAccessoryRow({...otherRows[3], qty: 2}, 1, []);
assert.equal(legacySkirting.size, '3.2');
assert.equal(legacySkirting.qty, 1);
assert.throws(() => b.restoreAccessoryRow({...otherRows[1], qty: 1.5}, 2, []), /invalid size or quantity/);
for (const [itemId, rate] of [['KITCHEN-049', 275], ['KITCHEN-050', 315]]) {
  const handles = b.computeCosting([], [], [], [], [], [], [{ id: 1, itemId, qty: 0.75, elevation: 'AA' }],
    config.shType, config.shType, b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {});
  assert.equal(handles.unpriced.length, 0);
  assert.equal(handles.purchases[0].itemCode, itemId);
  assert.equal(handles.purchases[0].unit, 'RMT');
  near(handles.purchases[0].quantity, 0.75);
  near(handles.total, rate * 0.75);
}
const boardPanel = model.panels.find(p => p.band && !p.visibleSide && p.pack === 'Carcass Pack');
const boardKey = `${boardPanel.mat}|${boardPanel.t}`;
const boardDetails = full.lines.flatMap(l => l.details).filter(d => d.boardQuantityKey === boardKey);
const netSqft = boardDetails.reduce((sum, d) => sum + d.netQty, 0);
const overridden = b.computeCosting(project, [], [], [], [], [], [], config.shType, config.shType,
  b.DEFAULT_RATES, {carcass: 10, shutter: 20, profile: 20}, {}, undefined,
  { [boardKey]: { sheets: 6.25, netSqft } });
near(overridden.lines.flatMap(l => l.details).filter(d => d.boardQuantityKey === boardKey).reduce((sum, d) => sum + d.billableQty, 0), 6.25 * 32);
full.lines.forEach((l, i) => l.details.forEach((d, j) => {
  if (d.boardQuantityKey !== boardKey) {
    near(overridden.lines[i].details[j].billableQty, d.billableQty);
    near(overridden.lines[i].details[j].amount, d.amount);
  }
}));
near(full.total, calc([{...project[0], qty: 2}]).total);
near(full.total, full.purchases.reduce((s, p) => s + p.amount, 0));
near(calc([project[0]], full.purchases).total + calc([project[1]], full.purchases).total, full.total);
assert(full.purchases.every(p => !p.rounded && p.quantity === Math.round((p.requiredQty + Number.EPSILON) * 100) / 100));
assert.equal(full.purchases.filter(p => p.itemCode === 'KITCHEN-013').length, 1);
near(full.purchases.find(p => p.itemCode === 'KITCHEN-SINK-PROFILE').quantity, 4.1);

const XLSX = require('xlsx-js-style');
let workbook;
XLSX.writeFile = value => { workbook = value; };
require('../src/lib/export.ts').exportCostingWorkbook(full.lines, [], {
  cabinetSqft: 0, fillerSqft: 0, counterPlySqft: 0, totalSqft: 0, baseCost: full.total, conversion: 0, profit: 0,
  transportation: 0, installation: 0, loading: 0, subtotal: full.total, tax: 0, grandTotal: full.total,
}, full.unpriced, {
  conversionPct: 0, profitPct: 0, transportation: { mode: 'direct', value: 0 },
  installation: { mode: 'direct', value: 0 }, loading: { mode: 'direct', value: 0 }, includeTax: false,
}, 'Test kitchen');
const exported = XLSX.utils.sheet_to_json(workbook.Sheets['Consolidated Items']);
assert(exported.some(p => !Number.isInteger(p['Purchase qty'])));
for (const p of exported) {
  near(p['Purchase qty'], Math.round((p['Required qty (editable)'] / p['Units per purchase'] + Number.EPSILON) * 100) / 100);
  near(p['Amount (Rs)'], p['Purchase qty'] * p['Purchase rate (Rs)']);
}
assert.equal(workbook.Sheets['Consolidated Items'].E2.z, '#,##0.00');
assert.equal(workbook.Sheets['Manual Comparison'].G5.z, '#,##0.00');
near(exported.reduce((s, p) => s + p['Amount (Rs)'], 0), full.total);
console.log('PASS: two-decimal aggregate quantities and costs, units, allocation, elevation filtering, idempotence, actual cabinet costing and export formatting.');
