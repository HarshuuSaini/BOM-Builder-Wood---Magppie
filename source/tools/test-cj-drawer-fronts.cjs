const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const b = require('../src/components/WoodBomBuilder.tsx');
const config = { zk: 'BC', fk: 'DW', vid: '3dr', hand: 'LHS', handle: 'XCJ', board: 'KITCHEN-007',
  backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029', shType: 'KITCHEN-010', visibleSides: '',
  visibleSideMaterialId: 'KITCHEN-010', ...b.DEFAULT_LAMINATE_PRICES, glassType: 'KITCHEN-GLASS-5-TINTED',
  hingeChoice: 'Hettich Soft Close', neon: 'NEON50', W: 600, H: 720, D: 560, drawerModel: 'Hettich', finish: 'White' };
const fronts = patch => b.buildModel({ ...config, ...patch }).panels.filter(p => /Drawer Front/.test(p.name)).flatMap(p => Array.from({ length: p.qty }, () => p));
assert.deepEqual(fronts({}).map(p => p.h), [147, 177, 327]);
for (const handle of ['NONE', 'HANDLE', 'PUSH', 'KNOB']) assert.deepEqual(fronts({ handle }).map(p => p.h), [177, 177, 357]);
assert.deepEqual(fronts({ vid: '2dr' }).map(p => p.h), [327, 327], 'Two high fronts keep their existing deductions');
assert.deepEqual(fronts({ vid: '2dr', handle: 'NONE' }).map(p => p.h), [357, 357]);
const model = b.buildModel(config);
const project = [{ id: 1, m: model, qty: 1, elevation: 'AA' }];
const rows = b.projectSetupRows({ name: 'CJ reversal', project, fillers: [], visiblePanels: [], countertops: [],
  accessories: [], masterAccessories: [], rawSelections: [], waste: { carcass: 12, shutter: 22, profile: 12, edgeBand: 3 },
  pricing: { conversionPct: 40, profitPct: 0, includeTax: false, transportation: { mode: 'sqft', value: 15 }, installation: { mode: 'sqft', value: 95 }, loading: { mode: 'sqft', value: 5 }, processingRates: {} } });
const restored = b.restoreProjectSetup(rows);
assert.deepEqual(restored.project[0].m.panels.filter(p => /Drawer Front/.test(p.name)).map(p => p.h), [147, 177, 327]);
const production = b.productionInputFromEntry({ id: 'cj-reversal', name: 'CJ reversal', rows });
assert.deepEqual(production.parts.filter(p => p.kind === 'board' && /Drawer Front/.test(p.panel)).map(p => p.length), [147, 177, 327]);
console.log('PASS: CJ low fronts restored to 147/177mm; other handles, high fronts, saved restores and production cuts checked.');
