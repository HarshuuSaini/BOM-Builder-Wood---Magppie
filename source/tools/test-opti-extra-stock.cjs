const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const o = require('../src/lib/production-optimizer.ts');
const r = require('../src/lib/production-report.ts');
const { productionExportTables, exportProductionWorkbook } = require('../src/lib/production-export.ts');
const { cuttingChartHtml, runBuilderOpti, optiFingerprint } = require('../src/lib/builder-opti.ts');
const { OptiMaterialOptions } = require('../src/components/OptiMaterialOptions.tsx');
const { ProductionOptiSummary } = require('../src/components/ProductionOptiSummary.tsx');
const b = require('../src/components/WoodBomBuilder.tsx');
const part = (changes = {}) => ({ id: 'p', kitchenId: 'k', kitchen: 'Kitchen', elevation: 'AA', cabinet: 'CAB', panel: 'Panel', role: 'Shutter',
  materialId: 'MDF', material: 'MDF', finish: 'White', thickness: 18, length: 40, width: 40, qty: 1, rate: 20,
  kind: 'board', edgeBand: '', drill: '', grainLocked: false, costingKey: 'cost', processingRate: 35, ...changes });
const input = parts => ({ id: 'k', name: 'Kitchen', version: 1, parts, supplies: [], foilCosting: [], warnings: [] });
const group = parts => o.productionGroups([input(parts)])[0];
const stock = { length: 100, width: 100, kerf: 3, trim: 2, grainLocked: false, priority: 'quantity', enabled: true };
const required = g => g.layouts.flatMap(l => l.placements.filter(p => !p.extraStock).map(p => [p.part.id, p.x, p.y, p.length, p.width, l.repeatCount ?? 1]));
function geometry(g) {
  for (const l of g.layouts) {
    const rects = [...l.placements, ...l.offcuts];
    for (const p of rects) {
      assert(p.x >= g.stock.trim && p.y >= (g.kind === 'profile' ? 0 : g.stock.trim));
      assert(p.x + p.length <= l.length - g.stock.trim + 1e-8);
      assert(p.y + p.width <= l.width - (g.kind === 'profile' ? 0 : g.stock.trim) + 1e-8);
    }
    for (let i = 0; i < l.placements.length; i++) for (let j = i + 1; j < l.placements.length; j++) {
      const a = l.placements[i], c = l.placements[j];
      assert(a.x + a.length + g.stock.kerf <= c.x || c.x + c.length + g.stock.kerf <= a.x || a.y + a.width + g.stock.kerf <= c.y || c.y + c.width + g.stock.kerf <= a.y, 'Required and extra pieces respect kerf and never overlap');
    }
    if (g.stock.grainLocked || g.kind === 'profile') assert(l.placements.every(p => !p.rotated));
  }
}
const source = group([part()]), original = JSON.stringify(source);
const normal = o.optimizeProductionGroup(source, stock);
const extra = o.optimizeProductionGroup(source, { ...stock, overproduction: true });
assert.equal(normal.extraStockCount, 0); assert(extra.extraStockCount > 0);
assert.deepEqual(required(normal), required(extra));
assert.equal(extra.purchasedSqft, normal.purchasedSqft);
assert.equal(extra.netSqft, normal.netSqft); assert.equal(extra.wastePct, normal.wastePct);
assert(extra.remainingWastePct < extra.wastePct);
assert(Math.abs(extra.extraProcessingCost - extra.extraStockSqft * 35) < 1e-9);
assert.equal(JSON.stringify(source), original); geometry(extra);
const priorities = group([part({ id: 'short', length: 20, width: 20, qty: 4 }), part({ id: 'long', length: 80, width: 10, qty: 1 })]);
assert.equal(o.optimizeProductionGroup(priorities, stock).layouts[0].placements[0].part.id, 'short');
assert.equal(o.optimizeProductionGroup(priorities, { ...stock, priority: 'length' }).layouts[0].placements[0].part.id, 'long');
const turn = group([part({ length: 90, width: 60 })]);
assert.equal(o.optimizeProductionGroup(turn, { ...stock, length: 60, width: 90, trim: 0 }).unplaced.length, 0);
assert.equal(o.optimizeProductionGroup(turn, { ...stock, length: 60, width: 90, trim: 0, grainLocked: true, overproduction: true }).unplaced.length, 1);
assert.equal(o.optimizeProductionGroup(turn, { ...stock, length: 60, width: 90, trim: 0, grainLocked: true, overproduction: true }).extraStockCount, 0);
const locked = o.optimizeProductionGroup(source, { ...stock, grainLocked: true, overproduction: true }); geometry(locked);
for (const priority of ['quantity', 'length']) {
  const lengthGroup = group([part({ id: 'frequent-long', length: 70, width: 20, qty: 12 }), part({ id: 'sheet-length', length: 40, width: 30, qty: 1 })]);
  const plan = o.optimizeProductionGroup(lengthGroup, { ...stock, trim: 0, grainLocked: true, priority, overproduction: true });
  const last = plan.layouts.find(l => l.placements.some(p => !p.extraStock && p.part.id === 'sheet-length'));
  assert(last && !last.placements.some(p => !p.extraStock && p.part.id === 'frequent-long'));
  assert.equal(last.placements.find(p => p.extraStock).part.id, 'sheet-length', 'Lengths already cut on this sheet precede longer/more frequent regular panels');
  geometry(plan);
}
// Frequent fillers must not consume an offcut that can make a regular panel.
// The filler is also longer, so this exercises both selected priority modes.
for (const priority of ['quantity', 'length']) {
  const fillerGroup = group([
    part({ id: 'filler', panel: 'Panels- CR Wall Filler Top 18mm 60x10', length: 60, width: 10, qty: 4 }),
    part({ id: 'regular', panel: 'Drawer bottom', length: 40, width: 30, qty: 1 }),
  ]);
  const base = { ...stock, length: 120, width: 80, trim: 0, grainLocked: true, priority };
  const noExtras = o.optimizeProductionGroup(fillerGroup, base);
  const withExtras = o.optimizeProductionGroup(fillerGroup, { ...base, overproduction: true });
  assert.deepEqual(required(withExtras), required(noExtras), 'Required panel placement is unchanged');
  assert.equal(withExtras.purchasedSqft, noExtras.purchasedSqft);
  const extras = withExtras.layouts[0].placements.filter(p => p.extraStock);
  assert.equal(extras[0].part.id, 'regular', `${priority}: reusable panel precedes longer/more frequent filler`);
  assert(extras.some(p => p.part.id === 'filler'), 'Small remaining spaces still allow fillers');
  // Replay the offcuts: a filler is allowed only when no regular panel fits.
  const free = noExtras.layouts[0].offcuts.map(r => ({ ...r }));
  for (const p of extras) {
    if (p.part.id === 'filler') assert(!free.some(r => r.length >= 40 && r.width >= 30));
    const index = free.findIndex(r => r.x === p.x && r.y === p.y && r.length >= p.length && r.width >= p.width);
    assert(index >= 0);
    const r = free.splice(index, 1)[0], right = r.length - p.length - base.kerf, below = r.width - p.width - base.kerf;
    if (right > 0) free.push({ x: r.x + p.length + base.kerf, y: r.y, length: right, width: p.width });
    if (below > 0) free.push({ x: r.x, y: r.y + p.width + base.kerf, length: r.length, width: below });
  }
  geometry(withExtras);
}
const screenshotParts = group([
  part({ id: 'panel2', panel: 'Drawer bottom', length: 560, width: 264, qty: 1 }),
  part({ id: 'strip', panel: 'Panels- CR Wall Filler Top 18mm 50x336', length: 336, width: 50, qty: 25 }),
]);
const screenshotPlan = o.optimizeProductionGroup(screenshotParts, { length: 2440, width: 1220, kerf: 3, trim: 10, grainLocked: false, priority: 'quantity', overproduction: true });
assert.equal(screenshotPlan.layouts[0].placements.find(p => p.extraStock).part.id, 'panel2', '560×264 regular panels precede the 25 more-frequent 336×50 filler strips');
geometry(screenshotPlan);
const plans = ['board', 'glass', 'stone', 'foil', 'profile'].map(kind => {
  const g = group([part({ kind, material: kind, width: kind === 'profile' ? 1 : kind === 'foil' ? 400 : 40, processingRate: undefined })]);
  if (['glass', 'stone', 'profile'].includes(kind)) assert(o.optimizeProductionGroup(g).skipped);
  const baseline = o.optimizeProductionGroup(g, stock);
  const filled = o.optimizeProductionGroup(g, { ...stock, grainLocked: true, overproduction: true });
  assert(filled.extraStockCount > 0, `${kind} supports extra stock`);
  assert.equal(filled.purchasedSqft, baseline.purchasedSqft); assert.equal(filled.rollLengthMm, baseline.rollLengthMm);
  assert.equal(filled.extraProcessingCost, undefined); geometry(filled);
  const priced = o.optimizeProductionGroup(g, { ...stock, grainLocked: true, overproduction: true, extraProcessingRate: 10 });
  assert(Math.abs(priced.extraProcessingCost - (kind === 'profile' ? priced.extraStockMetres : priced.extraStockSqft) * 10) < 1e-9);
  if (kind === 'foil') assert.equal(filled.stock.width, 1420);
  return filled;
});
const bulkGroup = group([part({ qty: 4001 })]);
const bulk = o.optimizeRepeatedProductionGroup(bulkGroup, { ...stock, grainLocked: true, overproduction: true });
assert(bulk.layouts.some(l => l.repeatCount > 1)); geometry(bulk);
assert.equal(bulk.layouts.reduce((sum, l) => sum + l.placements.filter(p => !p.extraStock).length * (l.repeatCount ?? 1), 0), 4001);
const report = r.productionReportSummary([...plans, bulk]);
assert.equal(report.extraStock.reduce((sum, p) => sum + p.qty, 0), report.batches.reduce((sum, p) => sum + p.extraStockPieces, 0));
assert.equal(report.batches.reduce((sum, p) => sum + p.totalPieces, 0), 4006);
for (const batch of report.batches) {
  assert.equal(r.cuttingBatchParts(batch, 'required').reduce((sum, p) => sum + p.qty, 0), batch.totalPieces);
  assert.equal(r.cuttingBatchParts(batch, 'stock').reduce((sum, p) => sum + p.qty, 0), batch.extraStockPieces);
}
const tables = productionExportTables([], plans);
assert(tables.layouts.some(p => p.Purpose === 'Extra stock')); assert(tables.layouts.some(p => p.Purpose === 'Required'));
assert(tables.extraStock.length && tables.extraStock.every(p => p['Processing estimate Rs'] === 'Not defined'));
assert(tables.settings.every(p => p.Priority === 'quantity' && p.Overproduction === 'Yes'));
const html = cuttingChartHtml(plans, '<Kitchen>', 1);
assert(html.includes('Extra stock — yellow parts') && html.includes('Required kitchen parts') && html.includes('#f7d77b'));
assert(html.includes('Not defined') && html.includes('&lt;Kitchen&gt;') && html.includes('stock lengths'));
assert(renderToStaticMarkup(React.createElement(ProductionOptiSummary, { groups: plans })).includes('Extra stock panels'));
const controls = renderToStaticMarkup(React.createElement(OptiMaterialOptions, { groups: plans, settings: {}, onChange() {} }));
assert(controls.includes('Quantity first') && controls.includes('Length first'));
for (const kind of ['board', 'glass', 'stone', 'foil', 'profile']) assert(controls.includes(`${kind} White 18mm overproduction`));
const XLSX = require('xlsx-js-style'), write = XLSX.writeFile;
let workbook;
try { XLSX.writeFile = w => { workbook = w; }; exportProductionWorkbook([], plans); } finally { XLSX.writeFile = write; }
const reread = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
assert(XLSX.utils.sheet_to_json(reread.Sheets['Extra Stock']).length > 0);
const options = { [source.key]: { ...stock, overproduction: true } };
assert(o.validOptiSettings(options)); assert(!o.validOptiSettings({ x: { priority: 'unknown' } }));
assert(!o.validOptiSettings({ x: { extraProcessingRate: -1 } }));
const rows = b.projectSetupRows({ name: 'Test', project: [], fillers: [], visiblePanels: [], countertops: [], accessories: [], masterAccessories: [], rawSelections: [],
  waste: { carcass: 12, shutter: 22, profile: 12, edgeBand: 3 }, optiSettings: options,
  pricing: { conversionPct: 40, profitPct: 0, includeTax: false, transportation: { mode: 'sqft', value: 15 }, installation: { mode: 'sqft', value: 95 }, loading: { mode: 'sqft', value: 5 }, processingRates: {} } });
assert.deepEqual(b.restoreProjectSetup(rows).optiSettings, options);
assert.notEqual(optiFingerprint(options), optiFingerprint({ [source.key]: { ...stock, overproduction: false } }));
assert.notEqual(b.builderOptiFingerprint([], [], [], undefined, 20, options), b.builderOptiFingerprint([], [], [], undefined, 20, { [source.key]: { ...stock, overproduction: false } }), 'Changing Opti options invalidates the saved Builder plan');
const run = (overproduction) => runBuilderOpti(input(source.parts), 1, 'test', { [source.key]: { ...stock, overproduction } });
assert.deepEqual(run(false).saved.allocations, run(true).saved.allocations, 'Extra stock is never added to quotation allocations');
assert.throws(() => o.optimizeProductionGroup(source, { ...stock, extraProcessingRate: -1 }), /Invalid stock/);
console.log('PASS: grain and both priorities, all five cuttable materials, extra-stock geometry/kerf, repeated counts, separate reports/Excel, undefined processing rates, saved controls and unchanged quote allocations.');
