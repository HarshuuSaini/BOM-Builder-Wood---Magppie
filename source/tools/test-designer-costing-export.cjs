const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const XLSX = require('xlsx-js-style');
const lib = path.resolve(__dirname, '../src/lib');
function load(file) {
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded.require = name => name === './conversion-margin' ? load(path.join(lib, 'conversion-margin.ts')) : name === '@/lib/stock' ? {} : name.startsWith('@/lib/')
    ? load(path.join(lib, `${name.slice(6)}.ts`)) : Module.prototype.require.call(loaded, name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, file);
  return loaded.exports;
}
const exportsApi = load(path.join(lib, 'export.ts'));
const { purchaseTotals } = load(path.join(lib, 'purchase-rounding.ts'));
const detail = (category, itemCode, billableQty, uom, rate) => ({ category, itemCode, item: itemCode,
  specification: '', netQty: billableQty, wastePct: 0, billableQty, uom, rate, amount: billableQty * rate });
const details = [detail('Carcass board', 'BOARD', 3.05 * 32, 'sqft', 100),
  detail('Carcass board', 'BOARD', 3.05 * 32, 'sqft', 100),
  detail('Carcass board', 'BOARD', 32, 'sqft', 120),
  detail('Consumable', 'GLUE', 1500, 'gm', 0.4), detail('Consumable', 'GLUE', 1.9712, 'kg', 400),
  detail('Carcass material processing', 'PROC', 1.23456, 'sqft', 42.3)];
const lines = [{ label: 'Kitchen cabinet', code: 'CAB', qty: 1, unitCost: 0, cost: 0, details }];
const purchases = purchaseTotals(details);
const itemTotal = purchases.reduce((sum, item) => sum + item.amount, 0);
const items = purchases.map(item => ({ category: item.categories.join(', '), itemCode: item.itemCode,
  item: item.item, unit: item.unit, quantity: item.quantity, rate: item.rate, amount: item.amount }));
const factors = { conversionPct: 40, profitPct: 10, transportation: { mode: 'sqft', value: 15 },
  installation: { mode: 'sqft', value: 95 }, loading: { mode: 'sqft', value: 5 }, includeTax: true };
const kitchen = { name: 'Kitchen A', items, unpriced: ['Missing handle rate'], areaSqft: 100, materialCost: itemTotal,
  conversion: 123456, profit: 234567, transportation: 345678, installation: 456789, loading: 567891,
  tax: 678912, total: 789123, factors };
function assertDesigner(book) {
  assert.ok(!book.SheetNames.some(name => name !== 'Pricing Summary' && /pricing|factor|setup/i.test(name)));
  for (const sheet of Object.values(book.Sheets)) for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith('!')) continue;
    if (typeof cell.v === 'string') assert.doesNotMatch(cell.v, /^Conversion\s*\(|\bprofit\b/i);
    if (cell.f) assert.doesNotMatch(cell.f, /pricing|factor|setup/i);
    assert.ok(![123456, 234567].includes(cell.v));
  }
}
function evaluate(sheet, address) {
  const cell = sheet[address];
  if (!cell?.f) return cell?.v ?? 0;
  const sum = cell.f.match(/^SUM\(([A-Z]+)(\d+):\1(\d+)\)$/);
  if (sum) {
    let value = 0;
    for (let row = Number(sum[2]); row <= Number(sum[3]); row++) value += evaluate(sheet, `${sum[1]}${row}`);
    return value;
  }
  const formula = cell.f.replace(/[A-Z]+\d+/g, ref => String(evaluate(sheet, ref)));
  assert.match(formula, /^[\d.*+\- ()]+$/);
  return new Function(`return ${formula}`)();
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
let book;
const originalWrite = XLSX.writeFile;
XLSX.writeFile = result => { book = result; };
try {
  exportsApi.exportDesignerCostingWorkbook(lines, 'Kitchen A', kitchen.unpriced);
  assertDesigner(book);
  assert.deepEqual(book.SheetNames, ['Item Costing', 'Unpriced Items']);
  const sheet = book.Sheets['Item Costing'];
  const totalRow = purchases.length + 4;
  near(sheet[`G${totalRow}`].v, itemTotal);
  near(evaluate(sheet, `G${totalRow}`), itemTotal);
  for (let row = 4; row < totalRow; row++) {
    const expected = purchases.find(item => item.itemCode === sheet[`B${row}`].v && item.rate === sheet[`E${row}`].v);
    assert.equal(sheet[`F${row}`].v, expected.quantity);
    assert.equal(sheet[`G${row}`].f, `E${row}*F${row}`);
  }
  const oldAmount = sheet.G4.v;
  sheet.E4.v = 100; sheet.F4.v = 2;
  near(evaluate(sheet, `G${totalRow}`), itemTotal - oldAmount + 200);
  const reopened = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  assertDesigner(reopened);
  near(evaluate(reopened.Sheets['Item Costing'], `G${totalRow}`), itemTotal - oldAmount + 200);

  exportsApi.exportDesignerBulkCostingWorkbook([kitchen, { ...kitchen, name: 'Kitchen B', items: items.map(item => ({ ...item, quantity: item.quantity * 2, amount: item.amount * 2 })) }]);
  assertDesigner(book);
  const summary = XLSX.utils.sheet_to_json(book.Sheets['Pricing Summary'], { header: 1 });
  assert(summary.some(row => row[0] === 'Transportation' && row[1] === kitchen.transportation));
  assert(summary.some(row => row[0] === 'Installation' && row[1] === kitchen.installation));
  assert(summary.some(row => row[0] === 'Loading / Unloading' && row[1] === kitchen.loading));
  assert(summary.some(row => row[0] === 'Final project price' && row[1] === kitchen.total));
  const bulk = book.Sheets['Combined Items'];
  near(evaluate(bulk, `G${totalRow}`), itemTotal);
  near(evaluate(bulk, `J${totalRow}`), itemTotal * 2);
  assert.equal(bulk.E2.v, 'Kitchen A'); assert.equal(bulk.H2.v, 'Kitchen B');
  assert.equal(bulk.G4.f, 'E4*F4'); assert.equal(bulk.J4.f, 'H4*I4');
  bulk.H4.v = 100; bulk.I4.v = 3;
  near(evaluate(bulk, `J${totalRow}`), itemTotal * 2 - oldAmount * 2 + 300);
  near(evaluate(bulk, `G${totalRow}`), itemTotal);
  exportsApi.exportDesignerBulkCostingWorkbook([{ ...kitchen, items: [], unpriced: [] }]);
  assertDesigner(book);
  assert.equal(book.Sheets['Combined Items'].G4.f, '0');
  assert.equal(book.Sheets['Combined Items'].G4.v, 0);
  assert.throws(() => exportsApi.exportDesignerBulkCostingWorkbook([]), /Name every kitchen/);
  assert.throws(() => exportsApi.exportDesignerCostingWorkbook(lines, ' ', []), /kitchen name/);

  // Calling designer exports must not alter admin exports or their factors.
  exportsApi.exportBulkCostingWorkbook([kitchen]);
  assert.ok(Object.values(book.Sheets['Combined Costing']).some(cell => cell?.v === 'Conversion margin'));
  assert.ok(Object.values(book.Sheets['Combined Costing']).some(cell => cell?.v === 'GST'));
  assert.ok(Object.values(book.Sheets['Combined Costing']).some(cell => cell?.v === 'Total Cost'));
  exportsApi.exportCostingWorkbook(lines, [{ eachSqft: 100, sqft: 100 }], {
    cabinetSqft: 100, fillerSqft: 0, counterPlySqft: 0, totalSqft: 100, baseCost: itemTotal,
    conversion: 123456, profit: 234567, transportation: 345678, installation: 456789,
    loading: 567891, subtotal: 1000000, tax: 180000, grandTotal: 1180000,
  }, [], factors, 'Admin kitchen');
  assert.ok(book.Sheets['Project Pricing']);
  assert.equal(book.Sheets['Project Pricing'].B6.v, 40);
  assert.equal(book.Sheets['Project Pricing'].B7.f, 'IF(AND(B6>=0,B6<100),SUM(B5,B10,B13,B16)/(1-B6/100)-SUM(B5,B10,B13,B16),NA())');
  assert(Math.abs(book.Sheets['Project Pricing'].B21.v - (itemTotal + 345678 + 456789 + 567891) / 0.6 * 1.18) < 0.00001);
} finally { XLSX.writeFile = originalWrite; }
console.log('Designer exports passed: item-only cells, purchase quantities, editable formulas, bulk variants, XLSX round-trip, empty inputs and unchanged admin exports.');
