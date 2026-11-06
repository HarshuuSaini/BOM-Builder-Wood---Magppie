const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const b = require('../src/components/WoodBomBuilder.tsx');
const { COSTING_ITEMS } = require('../src/lib/costing.ts');
const { selectedBoardRate } = require('../src/lib/kitchen-materials.ts');
const base = { zk: 'WC', fk: 'WOP', vid: 'single', hand: 'LHS', handle: 'NONE',
  board: 'KITCHEN-022', backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029', shType: 'KITCHEN-014', visibleSides: '', visibleSideMaterialId: 'KITCHEN-014',
  ...b.DEFAULT_LAMINATE_PRICES, glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close', neon: 'NEON50',
  W: 600, H: 900, D: 336, fillerWidth: 50, fillerSides: 'LH', drawerModel: 'Hettich', finish: 'White' };
const pricing = { conversionPct: 40, profitPct: 0, includeTax: false, transportation: { mode: 'sqft', value: 15 },
  installation: { mode: 'sqft', value: 95 }, loading: { mode: 'sqft', value: 5 }, processingRates: {} };
const waste = { carcass: 12, shutter: 22, profile: 12, edgeBand: 3 };
const variants = COSTING_ITEMS.filter(item => item.group === 'Shutter Material' && item.thicknessMm === 25);
variants.push(COSTING_ITEMS.find(item => item.id === 'KITCHEN-014'));
for (const item of variants) {
  const model = b.buildModel({ ...base, board: item.id });
  const project = [{ id: 1, m: model, qty: 1, elevation: 'AA' }];
  const fillers = b.cabinetFillers(project);
  const extras = b.buildExtrasBom(fillers, [], [], project, '', base.shType, base.shType, 'White', waste);
  const strips = extras.panels.filter(panel => /CR Wall Filler/.test(panel.name));
  assert.equal(strips.length, 2);
  assert(strips.every(panel => panel.materialId === item.id && panel.t === item.thicknessMm));
  const boardTotals = b.buildBoardTotals([], waste, strips);
  assert(boardTotals.every(board => board.rate === item.currentRate && board.rate > 0));
  const setup = b.projectSetupRows({ name: 'Wall filler reproduction', project, fillers: [], visiblePanels: [], countertops: [],
    accessories: [], masterAccessories: [], rawSelections: [], waste, pricing });
  const production = b.productionInputFromEntry({ id: 'wall-filler', name: 'Wall filler reproduction', rows: setup });
  const cuts = production.parts.filter(p => /CR Wall Filler/.test(p.panel));
  assert.equal(cuts.length, 2, `${item.id}: both filler strips reach cutting input`);
  assert(cuts.every(p => p.materialId === item.id && p.thickness === item.thicknessMm && p.length === 336 && p.width === 50));
  assert(cuts.every(p => p.rate === selectedBoardRate(item, undefined)));
  let cost;
  b.kitchenCostingSnapshot(b.restoreProjectSetup(setup), undefined, b.DEFAULT_RATES, {}, value => { cost = value; });
  const stripCosts = cost.lines.filter(line => /CR Wall Filler/.test(line.label));
  assert.equal(stripCosts.length, 2);
  assert(stripCosts.every(line => line.details.some(d => d.category === 'Carcass board' && d.itemCode === item.id && d.rate === item.currentRate && d.amount > 0)));
  assert(!cost.unpriced.some(message => /CR Wall Filler/.test(message)), 'No missing-material or missing-price warning for valid strips');
  const { runBuilderOpti } = require('../src/lib/builder-opti.ts');
  const result = runBuilderOpti(production, 1, 'wall-filler-test');
  assert(result.groups.some(g => g.parts.some(p => /CR Wall Filler/.test(p.panel))));
}
console.log('PASS: valid 25mm shutter boards resolve for wall-filler strips in board totals, costing, production cuts and Opti without material substitution.');
