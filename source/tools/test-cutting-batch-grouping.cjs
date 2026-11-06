const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { productionReportSummary, productionCuttingBatches, cuttingBatchParts, batchPreviewLayout, cuttingPatternKey } = require('../src/lib/production-report.ts');
const { productionExportTables } = require('../src/lib/production-export.ts');
const { cuttingChartHtml } = require('../src/lib/builder-opti.ts');
const { DEFAULT_PRODUCTION_STOCK } = require('../src/lib/production-optimizer.ts');
const { LayoutDrawing } = require('../src/components/ProductionBatch.tsx');
const part = (id, cabinet) => ({ id, kitchenId: 'k', kitchen: 'Kitchen', elevation: 'AA', cabinet, panel: 'Side panel', role: 'Carcass',
  materialId: 'board', material: 'Prelam', finish: 'White', thickness: 18, length: 500, width: 200, qty: 1, rate: 35,
  kind: 'board', edgeBand: '', drill: '', grainLocked: false });
const layout = (number, count, id, cabinet, x = 10) => ({ number, repeatCount: count, length: 2440, width: 1220, offcuts: [],
  placements: [{ x, y: 10, length: 500, width: 200, rotated: false, piece: 1, part: part(id, cabinet) }] });
const a = layout(1, 4, 'a', 'CAB-A');
const different = layout(5, 2, 'c', 'CAB-C', 20);
const b = layout(7, 8, 'b', 'CAB-B');
const group = { key: 'white18', kind: 'board', material: 'Prelam', finish: 'White', thickness: 18, rate: 35,
  parts: [a.placements[0].part, b.placements[0].part, different.placements[0].part], stock: DEFAULT_PRODUCTION_STOCK,
  layouts: [a, different, b], unplaced: [], netSqft: 14 * 500 * 200 / 92903.04,
  purchasedSqft: 14 * 2440 * 1220 / 92903.04, rollLengthMm: 0 };
group.wastePct = 100 * (1 - group.netSqft / group.purchasedSqft);
const before = JSON.stringify(group);
const report = productionReportSummary([group]);
assert.equal(report.totalBatches, 2, 'Identical charts form one batch regardless of source cabinet IDs');
assert.equal(report.totalSheets, 14);
assert.equal(report.materials[0].batches, 2);
const identical = report.batches[0];
assert.equal(identical.sheets, 12);
assert.equal(identical.sheetRanges, '1–4, 7–14', 'Non-consecutive sheet references do not include another pattern');
assert.equal(identical.sources.length, 2);
assert.deepEqual(cuttingBatchParts(identical).map(p => [p.cabinet, p.qty]), [['CAB-A', 4], ['CAB-B', 8]]);
assert.equal(batchPreviewLayout(identical).repeatCount, 12);
assert.equal(report.batches.reduce((sum, batch) => sum + batch.sheets, 0), 14);
const exportTables = productionExportTables([], [group]);
assert.equal(exportTables.summary[0]['Cutting batches'], 2);
assert.equal(exportTables.layouts.find(p => p.Cabinet === 'CAB-A')['Cutting batch'], exportTables.layouts.find(p => p.Cabinet === 'CAB-B')['Cutting batch']);
assert.notEqual(exportTables.layouts.find(p => p.Cabinet === 'CAB-A')['Cutting batch'], exportTables.layouts.find(p => p.Cabinet === 'CAB-C')['Cutting batch']);
assert.equal(exportTables.batchSummary[0]['Sheets in batch'], 12);
assert.equal(exportTables.batchSummary[0]['Sheet references'], '1–4, 7–14');
const html = cuttingChartHtml([group], 'Kitchen', 20);
assert.equal((html.match(/<svg /g) ?? []).length, 2, 'Only one drawing per unique cutting chart is downloaded');
assert(html.includes('Repeat this layout 12 times') && html.includes('CAB-A') && html.includes('CAB-B'));
assert(html.includes('Pieces in batch') && html.includes('1–4, 7–14'));
const markup = renderToStaticMarkup(React.createElement(LayoutDrawing, { layout: batchPreviewLayout(identical), batch: identical, label: 'B001' }));
assert(markup.includes('CAB-A') && markup.includes('CAB-B') && markup.includes('12 times'));
assert.notEqual(cuttingPatternKey(a), cuttingPatternKey({ ...a, length: 2500 }), 'Different stock sizes remain separate');
assert.notEqual(cuttingPatternKey(a), cuttingPatternKey({ ...a, placements: a.placements.map(p => ({ ...p, length: 501 })) }), 'Different cuts remain separate');
assert.notEqual(cuttingPatternKey(a), cuttingPatternKey({ ...a, placements: a.placements.map(p => ({ ...p, part: { ...p.part, drill: 'Holes' } })) }), 'Different machining stays separate');
const otherFinish = { ...group, key: 'oak18', finish: 'Oak', layouts: [layout(1, 1, 'oak', 'CAB-OAK')] };
assert.equal(productionCuttingBatches([group, otherFinish]).length, 3, 'Different material groups cannot share a batch');
const double = { ...a, placements: [...a.placements, { ...a.placements[0], x: 600, piece: 2 }] };
assert.equal(cuttingPatternKey(double), cuttingPatternKey({ ...double, placements: [...double.placements].reverse() }), 'Placement array order does not affect chart identity');
assert.equal(JSON.stringify(group), before, 'Grouping never changes the optimized plan or costing');
console.log('PASS: identical charts group into 12-sheet batches, distinct charts/materials stay separate, source cabinet quantities, non-consecutive sheet ranges, summary, Excel and one-chart-per-batch downloads reconcile.');
