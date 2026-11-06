const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const b = require('../src/components/WoodBomBuilder.tsx');
const model = b.buildModel({ zk: 'BC', fk: 'SH', vid: 'single', hand: 'LHS', handle: 'NONE',
  board: 'KITCHEN-007', backBoardId: 'KITCHEN-035', drawerBoardId: 'KITCHEN-029',
  shType: 'KITCHEN-010', visibleSides: 'LH', visibleSideMaterialId: 'KITCHEN-010',
  ...b.DEFAULT_LAMINATE_PRICES, glassType: 'KITCHEN-GLASS-5-TINTED', hingeChoice: 'Hettich Soft Close',
  neon: 'NEON50', W: 600, H: 720, D: 560, drawerModel: 'Hettich', finish: 'White' });
const before = JSON.stringify(model);
let bands = 0, adhesives = 0;
model.cons.forEach((row, index) => {
  const formula = b.edgeBandCalculation(model, index);
  if (/^EDGE BAND\b/.test(row.name)) {
    bands++;
    assert(formula.includes('4 × 50') && formula.includes('÷ 1000'));
    assert(formula.endsWith(`= ${row.qty.toFixed(2)} RMT`));
  } else if (row.name === 'EDGEBAND ADHESIVE') {
    adhesives++;
    assert(formula.includes('× 6 g/RMT'));
    assert(formula.includes(`= ${row.qty.toFixed(2)} gm`));
  } else assert.equal(formula, '');
});
assert(bands > 0 && bands === adhesives);
const repeated = structuredClone(model);
repeated.panels.find(panel => panel.band).qty = 2;
assert(repeated.cons.some((row, index) => b.edgeBandCalculation(repeated, index).includes('× 2 ÷ 1000')), 'Repeated panel quantity is shown');
assert.equal(b.edgeBandCalculation(model, -1), '');
assert.equal(JSON.stringify(model), before, 'Showing formulas never changes BOM quantities');
console.log('PASS: edge-band formulas show actual dimensions, panel quantities, 50mm allowances and adhesive at 6g/RMT without mutating BOM.');
