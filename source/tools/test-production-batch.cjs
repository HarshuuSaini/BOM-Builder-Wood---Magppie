const assert = require('node:assert/strict');
// Reuse the builder's TS loader and existing regression checks.
require('./test-purchase-rounding.cjs');
const fs = require('node:fs');
const Module = require('node:module');
const { renderToStaticMarkup } = require('react-dom/server');
const React = require('react');
const b = require('../src/components/WoodBomBuilder.tsx');
const { productionGroups, optimizeProductionGroup, productionGroupKey, consolidateProductionSupplies } = require('../src/lib/production-optimizer.ts');
const { productionExportTables, exportProductionWorkbook } = require('../src/lib/production-export.ts');
const part = (overrides = {}) => ({ id: 'p1', kitchenId: 'a', kitchen: 'A', elevation: 'AA', cabinet: 'CAB1',
  panel: 'Side', role: 'Carcass', materialId: 'BOARD', material: 'Board', finish: 'White', thickness: 18,
  length: 50, width: 50, qty: 4, rate: 10, kind: 'board', edgeBand: 'White', drill: '', grainLocked: false, ...overrides });
const input = (parts, overrides = {}) => ({ id: 'a', name: 'Kitchen A', version: 1, parts, supplies: [], foilCosting: [], warnings: [], ...overrides });
const group = p => productionGroups([input(p)])[0];
const stock = { length: 100, width: 100, trim: 0, kerf: 0, grainLocked: true };
const four = optimizeProductionGroup(group([part()]), stock);
assert.equal(four.layouts.length, 1);
assert.equal(four.layouts[0].placements.length, 4);
assert.equal(four.wastePct, 0);
assert.equal(optimizeProductionGroup(group([part()]), { ...stock, kerf: 3 }).layouts.length, 4);
assert.equal(optimizeProductionGroup(group([part()]), { ...stock, trim: 1 }).layouts.length, 4);
const rotatedPart = part({ length: 90, width: 60, qty: 1 });
const rotationStock = { ...stock, length: 60, width: 90 };
assert.equal(optimizeProductionGroup(group([rotatedPart]), rotationStock).unplaced.length, 1);
const rotated = optimizeProductionGroup(group([rotatedPart]), { ...rotationStock, grainLocked: false });
assert.equal(rotated.unplaced.length, 0);
assert.equal(rotated.layouts[0].placements[0].rotated, true);
const sharedSheet = optimizeProductionGroup(group([part({ id: 'large', length: 100, width: 60, qty: 1 }), part({ id: 'turn', length: 40, width: 100, qty: 1 })]), { length: 100, width: 100, kerf: 0, trim: 0 });
assert.equal(sharedSheet.layouts.length, 1, 'Rotate to fit an existing sheet before opening another');
assert(sharedSheet.layouts[0].placements.some(p => p.part.id === 'turn' && p.rotated));
assert.throws(() => optimizeProductionGroup(group([part()]), { ...stock, trim: 50 }), /Invalid stock/);
assert.throws(() => optimizeProductionGroup(group([part({ qty: 1.5 })]), stock), /quantity/);
assert.throws(() => optimizeProductionGroup(group([part({ qty: 10001 })]), stock), /10,000/);
const groups = productionGroups([input([part(), part({ id: 'p2', finish: 'Black' }), part({ id: 'p3', thickness: 8 }), part({ id: 'p4', rate: 11 }),
  part({ id: 'p5', kind: 'foil', role: 'Shutter' }), part({ id: 'p6', kind: 'foil', role: 'Visible side' })])]);
assert.equal(groups.length, 6);
const foil = optimizeProductionGroup(group([part({ kind: 'foil', role: 'Shutter', length: 900, width: 600, qty: 2 })]));
assert.equal(foil.rollLengthMm, 900);
assert.equal(foil.layouts[0].width, 1420);
assert.equal(foil.layouts[0].placements.length, 2);
assert.equal(optimizeProductionGroup(group([part({ kind: 'foil', width: 1421, qty: 1, grainLocked: true })])).unplaced.length, 1);
// Conservation, bounds, kerf spacing and absence of overlap across deterministic varied cuts.
let seed = 42;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const randomGroup = group(Array.from({ length: 100 }, (_, i) => part({ id: `r${i}`, length: 40 + Math.floor(random() * 600), width: 40 + Math.floor(random() * 400), qty: 2 })));
const randomPlan = optimizeProductionGroup(randomGroup);
assert.equal(randomPlan.layouts.flatMap(l => l.placements).length, 200);
for (const layout of randomPlan.layouts) {
  for (const p of layout.placements) {
    assert(p.x >= 10 && p.y >= 10);
    assert(p.x + p.length <= 2430 && p.y + p.width <= 1210);
    for (const q of layout.placements) if (p !== q) assert(p.x + p.length + 3 <= q.x || q.x + q.length + 3 <= p.x || p.y + p.width + 3 <= q.y || q.y + q.width + 3 <= p.y);
  }
  const totalArea = [...layout.placements, ...layout.offcuts].reduce((s, p) => s + p.length * p.width, 0);
  assert(totalArea <= 2440 * 1220);
}
assert.deepEqual(optimizeProductionGroup(randomGroup), randomPlan, 'Repeat runs deterministic');
const config = { zk: 'BC', fk: 'SH', vid: 'single', hand: 'LHS', handle: 'NONE', board: 'KITCHEN-007',
  backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029', shType: 'KITCHEN-015-MDF', visibleSides: 'LH', visibleSideMaterialId: 'KITCHEN-015-MDF',
  ...b.DEFAULT_LAMINATE_PRICES, glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
  W: 600, H: 720, D: 560, drawerModel: 'Hettich', finish: 'White' };
const model = b.buildModel(config);
const pricing = { conversionPct: 40, profitPct: 0, includeTax: false, transportation: { mode: 'sqft', value: 15 },
  installation: { mode: 'sqft', value: 95 }, loading: { mode: 'sqft', value: 5 }, processingRates: {} };
const entry = { id: 'factory-a', name: 'Factory A', rows: b.projectSetupRows({ name: 'Factory A', project: [{ id: 1, m: model, qty: 2, elevation: 'AA' }],
  fillers: [], visiblePanels: [], countertops: [], accessories: [], masterAccessories: [], rawSelections: [],
  waste: { carcass: 12, shutter: 22, profile: 12, edgeBand: 3 }, pricing }), savedCostingVersion: 7 };
const original = JSON.stringify(entry);
const production = b.productionInputFromEntry(entry);
const { runBuilderOpti, cuttingChartHtml } = require('../src/lib/builder-opti.ts');
const restoredForOpti = b.restoreProjectSetup(entry.rows);
const fingerprint = b.builderOptiFingerprint(restoredForOpti.project, [], [], undefined, 20);
const optimized = runBuilderOpti(production, 20, fingerprint);
assert(optimized.groups.every(g => g.unplaced.length === 0));
assert(optimized.groups.some(g => g.kind === 'foil' && !g.skipped), 'Foil also receives a roll plan');
assert.equal(optimized.input.parts[0].qty, production.parts[0].qty * 20);
const tableKeys = b.buildBoardTotals(restoredForOpti.project).map(row => row.key);
assert(production.parts.filter(p => p.kind === 'board').every(p => tableKeys.includes(p.costingKey)), 'Production boards map exactly to the Builder costing rows');
for (const g of optimized.groups.filter(g => g.kind === 'board' && !g.skipped)) {
  const keys = [...new Set(g.parts.map(p => p.costingKey))];
  const sheetShare = keys.reduce((sum, key) => sum + optimized.saved.allocations[key].sheets, 0);
  assert(Math.abs(sheetShare * 20 - g.layouts.length) < 1e-9, 'Per-kitchen allocation reconciles to integer batch sheets');
  assert(keys.every(key => optimized.saved.allocations[key].wastePct === g.wastePct));
}
const restoredOptimized = b.restoreProjectSetup(entry.rows.map(row => row['Record Type'] !== 'settings' ? row : {
  ...row, Data: JSON.stringify({ ...JSON.parse(row.Data), pricing: { ...pricing, batchQuantity: 20, boardOpti: optimized.saved } }),
}));
let optimizedCosting;
const optimizedSnapshot = b.kitchenCostingSnapshot(restoredOptimized, undefined, b.DEFAULT_RATES, {}, value => { optimizedCosting = value; });
const boardAmount = optimizedCosting.lines.flatMap(line => line.details).filter(d => /board$/.test(d.category)).reduce((sum, d) => sum + d.amount, 0);
const expectedBoardAmount = optimized.groups.filter(g => g.kind === 'board' && !g.skipped).reduce((sum, g) => sum + g.layouts.length * 32 * g.rate / 20, 0);
assert(Math.abs(boardAmount - expectedBoardAmount) < 1e-7, 'Board cost reconciles exactly to whole batch sheets without rounding per-role shares');
const baselineSnapshot = b.kitchenCostingSnapshot(restoredForOpti, undefined, b.DEFAULT_RATES);
assert.notEqual(optimizedSnapshot.materialCost, baselineSnapshot.materialCost, 'Saved Opti updates costing without requiring chart regeneration');
restoredOptimized.pricing.batchQuantity = 19;
assert.equal(b.kitchenCostingSnapshot(restoredOptimized, undefined, b.DEFAULT_RATES).materialCost, baselineSnapshot.materialCost, 'Changed batch invalidates saved Opti');
const changedProject = restoredForOpti.project.map(line => ({ ...line, qty: line.qty + 1 }));
assert.notEqual(b.builderOptiFingerprint(changedProject, [], [], undefined, 20), fingerprint, 'Cabinet quantity changes invalidate layouts');
assert.notEqual(b.builderOptiFingerprint(restoredForOpti.project.map(line => ({ ...line, m: { ...line.m, panels: line.m.panels.map((p, i) => i ? p : { ...p, w: p.w + 1 }) } })), [], [], undefined, 20), fingerprint, 'Panel geometry changes invalidate layouts');
assert.throws(() => runBuilderOpti(production, 0, fingerprint), /Batch quantity/);
const largerBatch = runBuilderOpti(input([part({ qty: 1, costingKey: 'large-batch' })]), 125, 'batch-125');
assert.equal(largerBatch.saved.batch, 125, 'Opti accepts batches above 100');
assert.equal(largerBatch.input.parts[0].qty, 125);
const largerSaved = b.restoreProjectSetup(entry.rows.map(row => row['Record Type'] !== 'settings' ? row : {
  ...row, Data: JSON.stringify({ ...JSON.parse(row.Data), pricing: { ...pricing, batchQuantity: 125, boardOpti: largerBatch.saved } }),
}));
assert.equal(largerSaved.pricing.batchQuantity, 125);
assert.equal(largerSaved.pricing.boardOpti.batch, 125, 'Large batch and Opti metadata survive saved-job restore');
const bulk = runBuilderOpti(input([part({ qty: 60, costingKey: 'bulk' })]), 401, 'bulk-401');
const { productionSheetCount } = require('../src/lib/production-optimizer.ts');
const bulkGroup = bulk.groups[0];
assert.equal(bulk.input.parts[0].qty, 24060);
assert(bulkGroup.layouts.some(l => l.repeatCount > 1));
assert.equal(bulkGroup.layouts.reduce((sum, l) => sum + l.placements.length * (l.repeatCount ?? 1), 0), 24060, 'All pieces are represented by layout repeats');
assert.equal(bulk.saved.allocations.bulk.batchSheets, productionSheetCount(bulkGroup));
assert(Math.abs(bulk.saved.allocations.bulk.sheets * 401 - productionSheetCount(bulkGroup)) < 1e-9);
assert(Math.abs(bulkGroup.netSqft - 24060 * 50 * 50 / 92903.04) < 1e-7);
assert(Math.abs(bulkGroup.wastePct - 100 * (1 - bulkGroup.netSqft / bulkGroup.purchasedSqft)) < 1e-9);
const bulkHtml = cuttingChartHtml(bulk.groups, 'Bulk', 401);
assert(bulkHtml.includes('Repeat this layout') && bulkHtml.includes('Total material stock units'));
assert(bulkHtml.includes('Production summary') && bulkHtml.includes('Cutting batch summary') && bulkHtml.includes('Sheets in batch'));
assert(bulkHtml.includes('Cutting batch B001') && bulkHtml.includes('id="B001"'));
const { productionReportSummary } = require('../src/lib/production-report.ts');
const bulkReport = productionReportSummary(bulk.groups);
assert.equal(bulkReport.batches.reduce((sum, batch) => sum + batch.sheets, 0), productionSheetCount(bulkGroup));
assert.equal(bulkReport.batches.reduce((sum, batch) => sum + batch.totalPieces, 0), 24060);
assert.equal(bulkReport.totalSheets, productionSheetCount(bulkGroup));
assert(bulkReport.totalBatches <= bulkGroup.layouts.length, 'Identical charts may reduce the number of cutting batches');
assert.equal(bulkReport.batches.reduce((sum, batch) => sum + batch.sources.length, 0), bulkGroup.layouts.length, 'Every original chart belongs to exactly one batch');
assert.equal(new Set(bulkReport.batches.map(batch => batch.id)).size, bulkReport.batches.length);
const bulkExport = productionExportTables([bulk.input], bulk.groups);
assert.equal(bulkExport.summary[0]['Sheet count'], productionSheetCount(bulkGroup));
assert(bulkExport.layouts.some(l => l['Repeat count'] > 1));
assert.equal(bulkExport.batchSummary.reduce((sum, row) => sum + row['Sheets in batch'], 0), bulkReport.totalSheets);
assert(bulkExport.layouts.every(row => bulkReport.batches.some(batch => batch.id === row['Cutting batch'])));
const mixedBulk = runBuilderOpti(input([
  part({ id: 'large-a', qty: 17, length: 500, width: 200, costingKey: 'carcass' }),
  part({ id: 'large-b', qty: 19, length: 400, width: 150, costingKey: 'shutter' }),
  part({ id: 'large-c', qty: 23, length: 300, width: 100, costingKey: 'shutter' }),
]), 401, 'mixed-bulk');
const actualBulkPieces = new Map();
for (const g of mixedBulk.groups) for (const l of g.layouts) for (const p of l.placements) actualBulkPieces.set(p.part.id, (actualBulkPieces.get(p.part.id) ?? 0) + (l.repeatCount ?? 1));
for (const p of mixedBulk.input.parts) assert.equal(actualBulkPieces.get(p.id), p.qty, 'Sub-batches and remainder account for every part type exactly once');
assert(Math.abs(Object.values(mixedBulk.saved.allocations).reduce((sum, a) => sum + a.batchSheets, 0) - mixedBulk.groups.reduce((sum, g) => sum + productionSheetCount(g), 0)) < 1e-9);
assert.throws(() => runBuilderOpti({ ...production, parts: [part({ length: 9999, costingKey: 'oversized' })] }, 1, fingerprint), /not applied/);
const html = cuttingChartHtml(optimized.groups, '<unsafe>', 20);
assert(html.includes('&lt;unsafe&gt;') && html.includes('Cabinet code') && html.includes('window.print()'));
assert(!html.includes('<unsafe>') && !html.includes('Hardware items'));
assert.equal(JSON.stringify(entry), original, 'Never mutate saved entry');
assert.equal(production.version, 7);
const boardPanels = production.parts.filter(p => p.kind === 'board');
assert.equal(boardPanels.length, model.panels.length);
assert.equal(boardPanels.reduce((s, p) => s + p.qty, 0), model.panels.reduce((s, p) => s + p.qty * 2, 0));
assert(production.parts.some(p => p.kind === 'foil' && p.role === 'Shutter'));
assert(production.parts.some(p => p.kind === 'foil' && p.role === 'Visible side'));
assert(production.foilCosting.every(p => p.unit === 'sqft'));
assert(production.supplies.some(p => p.itemCode === 'HARDWARE-011' && p.qty === 2));
assert(production.bom.length > 0);
const second = { ...production, id: 'factory-b', name: 'Factory B', parts: production.parts.map(p => ({ ...p, id: `b:${p.id}`, kitchenId: 'factory-b', kitchen: 'Factory B' })),
  supplies: production.supplies.map(s => ({ ...s, kitchen: 'Factory B' })) };
assert.equal(productionGroups([production, second]).length, productionGroups([production]).length, 'Identical material shares sheets across kitchens');
const supplies = consolidateProductionSupplies([production, second]);
const bracket = supplies.find(s => s.itemCode === 'HARDWARE-011');
assert.equal(bracket.qty, 4);
assert.equal(bracket.kitchens.length, 2);
const plans = productionGroups([production, second]).map(g => optimizeProductionGroup(g));
const tables = productionExportTables([production, second], plans);
assert(tables.hardware.some(s => s['Item Code'] === 'HARDWARE-011' && s.Quantity === 4));
assert(tables.routing.some(s => s['BOM Location'] === 'Factory B'));
assert(tables.summary.filter(s => s['Stock type'] === 'Roll').every(s => s['Sheet count'] === 'Not applicable'));
const XLSX = require('xlsx-js-style');
const writeFile = XLSX.writeFile;
let exported;
try { XLSX.writeFile = workbook => { exported = workbook; }; exportProductionWorkbook([production, second], plans); }
finally { XLSX.writeFile = writeFile; }
const roundTrip = XLSX.read(XLSX.write(exported, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
for (const tab of ['Full BOM', 'BOM', 'Opti', 'OP', 'Hardware items', 'Hardware Routing', 'Cut Layouts', 'Foil costing', 'Sheet Summary', 'Batch Summary']) assert(roundTrip.Sheets[tab], tab);
assert.equal(roundTrip.Sheets.OP.A1.v, '[P_DRWINFO_1]');
assert.equal(roundTrip.Sheets.OP.D1.v, '[P_LENGTH]');
assert.equal(roundTrip.Sheets.OP.S1.v, '[P_EDGE_MAT_DX]');
// Verify the builder's existing Excel BOM button now uses the Stone sample's tab/column view.
const { exportBomWorkbook } = require('../src/lib/export.ts');
const reportRows = b.buildFullBomData([{ id: 1, m: model, qty: 2, elevation: 'AA' }], 'Factory A', 'White').map(r => ({
  sourceOrderId: '', sourceOrderNumber: r.SO, customerName: '', elevation: r.Elevation, itemId: '', itemName: r.Item, sku: r.SKU,
  groupName: r['Sub Group'], masterGroup: r['Main Group'], cfGroup: '', cfSubGroup: r['Sub Group'],
  cfHeight: r.Height, cfWidth: r.Width, cfDepth: r.Depth, cfThickness: r.Thickness, cfFinish: r.Finish, cfType: r['CF Type'],
  level: r.Level, quantityNeeded: r['SO Qty'], wastePercent: r['Waste %'], actualQuantity: r['Actual Qty'],
  rawStock: r['In Stock'], effectiveStock: r['Eff. Stock'], deficit: r.Deficit, unit: r.Unit,
  status: 'unknown', rowType: r._type, typeLabel: 'COMPONENT', underProfile: false,
}));
let normalBom;
const normalPurchases = b.computeCosting(b.restoreProjectSetup(entry.rows).project, [], [], [], [], [], [], config.shType, config.shType, b.DEFAULT_RATES, { carcass: 12, shutter: 22, profile: 12, edgeBand: 3 }, {}).purchases;
try { XLSX.writeFile = workbook => { normalBom = workbook; }; exportBomWorkbook(reportRows, [], entry.rows, normalPurchases, production); }
finally { XLSX.writeFile = writeFile; }
assert.deepEqual(normalBom.SheetNames.slice(0, 7), ['Full BOM', 'BOM', 'Out of Stock', 'Opti', 'OP', 'Hardware items', 'Hardware Routing']);
const { STONE_BOM_HEADERS } = require('../src/lib/stone-bom-view.ts');
for (const [name, key] of [['Full BOM', 'full'], ['BOM', 'bom'], ['Opti', 'opti'], ['Hardware items', 'hardware'], ['Hardware Routing', 'routing']]) {
  const row = XLSX.utils.sheet_to_json(normalBom.Sheets[name], { header: 1 })[0];
  assert.deepEqual(row, STONE_BOM_HEADERS[key], `${name} matches the reference column order`);
}
assert.equal(normalBom.Sheets['Full BOM'].C2.v, 'AA', 'Elevation retained');
assert.equal(normalBom.Sheets.OP.A3.v, '[P_DRWINFO_1]');
assert.equal(normalBom.Sheets.OP.D4.v, 'Length');
assert.equal(normalBom.Sheets.OP.D5.t, 'n');
assert(XLSX.utils.sheet_to_json(normalBom.Sheets['Hardware items']).some(row => /PVC FOIL/.test(row['RM Item Name']) && row.UOM === 'sqft'));
assert(XLSX.utils.sheet_to_json(normalBom.Sheets.Opti).every(row => row.Qty > 0));
assert.equal(XLSX.read(XLSX.write(normalBom, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' }).SheetNames.length, normalBom.SheetNames.length);
// SSR form labels and empty state.
const { ProductionBatch, LayoutDrawing } = require('../src/components/ProductionBatch.tsx');
const { ProductionOptiSummary } = require('../src/components/ProductionOptiSummary.tsx');
const summaryMarkup = renderToStaticMarkup(React.createElement(ProductionOptiSummary, { groups: bulk.groups }));
assert(summaryMarkup.includes('Cutting batch summary') && summaryMarkup.includes('Sheets in batch') && summaryMarkup.includes('B001'));
assert(summaryMarkup.includes('Total sheets in cutting batches'));
const chartMarkup = renderToStaticMarkup(React.createElement(LayoutDrawing, { layout: sharedSheet.layouts[0], label: 'Sheet 1' }));
for (const header of ['Kitchen', 'Cabinet code', 'Panel', 'Length (mm)', 'Width (mm)']) assert(chartMarkup.includes(`<th>${header}</th>`));
assert(chartMarkup.includes('<table') && !chartMarkup.includes('<ol'));
assert(chartMarkup.includes('100 × 60 mm'), 'Actual cut dimensions are drawn on the panel');
const markup = renderToStaticMarkup(React.createElement(ProductionBatch, { kitchens: [{ id: 'a', name: 'A', owner: 'Sudha', version: 1 }] }));
assert(markup.includes('Select A') && markup.includes('Batch quantity for A'));
assert(!markup.match(/aria-label="Batch quantity for A"[^>]*max=/), 'Factory batch input has no maximum');
// Page enforces role and local-only checks before listing saved kitchens.
const load = Module._load;
let actor = { role: 'user', username: 'Sudha' }, enabled = true, listed = 0, openAccess = false;
Module._load = function(name, ...args) {
  if (name === 'next/navigation') return { notFound: () => { throw new Error('NOT_FOUND'); } };
  if (name === '@/lib/user-session') return { requireIdentity: async () => actor, isOpenCostingAccess: () => openAccess };
  if (name === '@/lib/local-costing-store') return { isLocalCostingsEnabled: () => enabled, listSavedCostings: () => { listed++; return []; } };
  return load.call(this, name, ...args);
};
(async () => {
  try {
    const { default: page } = require('../src/app/production/page.tsx');
    await assert.rejects(page(), /NOT_FOUND/); assert.equal(listed, 0);
    actor = { role: 'admin', username: 'preview' }; enabled = false;
    await assert.rejects(page(), /NOT_FOUND/); assert.equal(listed, 0);
    openAccess = true;
    const publicPage = await page(); assert.equal(publicPage.props.browserWorkspace, true); assert.equal(listed, 0);
    openAccess = false;
    enabled = true; await page(); assert.equal(listed, 1);
  } finally { Module._load = load; }
  // Read the actual local quote without opening it for writes, if present.
  if (fs.existsSync('.local-data/costings.sqlite')) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('.local-data/costings.sqlite', { readOnly: true });
    try {
      const saved = db.prepare('SELECT payload FROM costings WHERE id = ?').get('84d769d5-0f79-4113-803b-93aa291a1244');
      if (saved) {
        const actualEntry = JSON.parse(saved.payload);
        const before = JSON.stringify(actualEntry);
        const actual = b.productionInputFromEntry(actualEntry);
        const actualPlans = productionGroups([actual]).map(g => optimizeProductionGroup(g));
        assert.equal(JSON.stringify(actualEntry), before);
        assert(actual.parts.length > 0);
        console.log(`Actual saved kitchen checked read-only: ${actual.parts.length} cut records, ${actualPlans.filter(g => g.kind === 'board').reduce((s, g) => s + g.layouts.length, 0)} sheets; ${actualPlans.reduce((s, g) => s + g.unplaced.length, 0)} oversized part records flagged.`);
      }
    } finally { db.close(); }
  }
  console.log('PASS: production geometry, grain/kerf/trim, roll foil, batch grouping, builder quantities, hardware, XLSX round-trip, SSR and admin/local access.');
})().catch(error => { console.error(error); process.exitCode = 1; });
