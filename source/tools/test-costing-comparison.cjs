const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { compareCostings, comparisonCategory } = require('../src/lib/costing-comparison.ts');
const { CostingComparison } = require('../src/components/CostingComparison.tsx');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const item = (category, itemCode, item, amount) => ({ category, itemCode, item, amount, quantity: 1, rate: amount, unit: 'pcs' });
const items = [
  item('Carcass board', 'B1', 'Private carcass board-18mm', 100), item('Carcass back material processing', 'BP', 'Private back board-8mm', 10),
  item('Carcass back board', 'B8', 'Private carcass back-8mm', 20), item('Carcass edge band', 'EB', 'White edge band', 4),
  item('Shutter board', 'S1', 'Private shutter board', 200), item('Shutter PVC foil laminate', 'FOIL', 'Private foil', 25),
  item('Visible side material processing', 'VS', 'Private visible side-18mm', 30), item('Drawer board', 'D', 'Private drawer-16mm', 40),
  item('Counter Ply processing', 'CP', 'Counter ply', 10), item('Hardware', 'HINGE', 'HINGE 95 DEG SOFT CLOSE', 55),
  item('Other accessory', 'KITCHEN-049', 'ALU PROF FOR HANDLE J TYPE', 60),
  item('Profile surface finishing', 'KITCHEN-049-FINISH-Powder coating', 'KITCHEN-049 · Powder coating', 7),
  item('Other accessory', 'KITCHEN-084', 'ALU PROF FOR LIGHT PROJECT', 8),
  item('Profile surface finishing', 'KITCHEN-ALU-SKIRTING-FINISH-Powder coating', 'Skirting finish', 9),
  item('Assembly Hardware', 'SCREW', 'Screw', 3), item('Drawer System', 'BOX', 'Drawer box', 5),
  item('Accessory', 'A1', 'Cutlery tray', 70), item('Accessory', 'A2', 'Waste bin', 80),
  item('Other accessory', 'LED', 'LED strip', 15), item('Consumable', 'GLUE', 'Glue', 2),
  item('Accessory', 'UNPRICED', 'Unpriced pantry', 0),
  item('Accessory', 'HARDWARE-026', 'FIXING PLATE 1100300010000 OML', 12),
  item('Accessory', 'KITCHEN-092', 'SKIRTING 100MM BLACK FINISH CRY', 13),
  item('Visible side laminate', 'LAM', 'Visible side decorative laminate', 12),
  item('Visible side edge band', 'EB-V', 'Matching edge band', 3),
  item('Consumable', 'LAM-GLUE', 'LAMINATE ADHESIVE', 6),
  item('Consumable', 'EB-GLUE', 'EDGEBAND ADHESIVE', 2),
];
const source = { id: 'a', name: 'Kitchen A', version: 2, areaSqft: 100, materialCost: items.reduce((s, p) => s + p.amount, 0), total: 1200,
  entry: { costing: { items, unpriced: [] } } };
const other = { ...source, id: 'b', name: 'Kitchen B', entry: { costing: { items: items.filter(i => i.itemCode !== 'A2').map(i => ({ ...i, amount: i.amount * 2 })), unpriced: ['A rate'] } } };
other.materialCost = other.entry.costing.items.reduce((s, p) => s + p.amount, 0);
const before = JSON.stringify([source, other]);
const result = compareCostings([source, other]);
assert.equal(result.columns[0].totals.Carcass, 120);
assert.equal(result.columns[0].totals.Processing, 50);
assert.equal(result.columns[0].totals.Shutter, 200);
assert.equal(result.columns[0].totals['Edge band'], 7);
assert.equal(result.columns[0].totals.Laminate, 37);
assert.equal(result.columns[0].totals['Consumables / other'], 10, 'Adhesives stay separate from edge band and laminate');
assert.equal(result.columns[0].totals.Handles, 67);
assert.equal(result.columns[0].totals.Profiles, 30);
assert.equal(result.columns[0].totals.Hinges, 55);
assert.equal(result.columns[0].totals.Hardware, 20);
assert.equal(result.columns[0].totals.Accessories, 150);
assert.equal(result.columns[0].totals.Lighting, 15);
for (const column of result.columns) {
  assert.equal(column.adjustment, 0);
  assert.equal(Object.values(column.totals).reduce((s, p) => s + p, 0), column.itemCost);
  for (const category of result.categories) {
    const index = result.columns.indexOf(column);
    assert.equal(result.breakdowns[category].reduce((sum, row) => sum + row.amounts[index], 0), column.totals[category], `${category} detail reconciles to its total`);
  }
}
assert.deepEqual(result.accessories.find(a => a.name === 'Waste bin').amounts, [80, 0]);
assert.equal(result.accessories.length, 2, 'Only actual priced accessories are listed individually');
assert(result.breakdowns.Carcass.some(row => row.thicknessMm === 18));
assert(result.breakdowns.Carcass.some(row => row.thicknessMm === 8));
assert(result.breakdowns.Drawer.some(row => row.thicknessMm === 16));
assert(result.breakdowns['Edge band'].some(row => row.component === 'Carcass edge band'));
assert(!result.breakdowns.Carcass.some(row => /edge band|laminate/i.test(row.component)));
assert(!result.breakdowns.Shutter.some(row => /edge band|laminate/i.test(row.component)));
assert(!result.breakdowns.Carcass.some(row => /processing/.test(row.component)), 'Processing never remains in material totals');
const markup = renderToStaticMarkup(React.createElement(CostingComparison, { data: result, onClose() {} }));
assert(markup.includes('aria-expanded="false"'), 'Categories start collapsed');
const categoryTable = markup.split('</table>')[0];
assert(!categoryTable.includes('Private carcass board') && !categoryTable.includes('Private shutter board') && !categoryTable.includes('HINGE 95 DEG'), 'Category prices remain summarized; item names may appear separately for price-change reasons');
assert(markup.includes('Difference') && markup.includes('rates awaiting definition'));
assert.equal(JSON.stringify([source, other]), before, 'Comparison never reprices or mutates saved kitchens');
// Exercise the real category toggle and render the resulting expanded table.
function categoryView(category, data) {
  let expanded = false;
  const file = path.resolve(__dirname, '../src/components/CostingComparison.tsx');
  const loaded = new Module(file, module); loaded.filename = file; loaded.paths = module.paths;
  loaded.require = name => name === 'react' ? { useState: () => [expanded, update => { expanded = update(expanded); }] } : require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  const render = () => loaded.exports.ComparisonCategory({ category, data });
  let tree = render();
  const toggle = tree.props.children[0].props.children[0].props.children;
  toggle.props.onClick(); tree = render();
  const html = renderToStaticMarkup(tree);
  assert(html.includes('aria-expanded="true"'));
  tree.props.children[0].props.children[0].props.children.props.onClick();
  assert(!renderToStaticMarkup(render()).includes('material comparison'), 'The same toggle collapses its breakdown');
  return html;
}
const carcassHtml = categoryView('Carcass', result);
assert(carcassHtml.includes('Private carcass board-18mm') && carcassHtml.includes('Private carcass back-8mm') && !carcassHtml.includes('White edge band'));
const edgeHtml = categoryView('Edge band', result);
assert(edgeHtml.includes('White edge band') && edgeHtml.includes('Matching edge band') && edgeHtml.includes('Carcass edge band') && edgeHtml.includes('Visible side edge band'));
const laminateHtml = categoryView('Laminate', result);
assert(laminateHtml.includes('Private foil') && laminateHtml.includes('Visible side decorative laminate'));
assert(carcassHtml.includes('Kitchen A') && carcassHtml.includes('Kitchen B') && carcassHtml.includes('18 mm') && carcassHtml.includes('8 mm'));
const processingHtml = categoryView('Processing', result);
assert(processingHtml.includes('Counter Ply processing') && processingHtml.includes('Visible side material processing'));
const accessoriesHtml = categoryView('Accessories', result);
assert(accessoriesHtml.includes('Waste bin') && accessoriesHtml.includes('Cutlery tray') && accessoriesHtml.includes('—'));
assert(!accessoriesHtml.includes('Unpriced pantry') && !accessoriesHtml.includes('LED strip') && !accessoriesHtml.includes('FIXING PLATE') && !accessoriesHtml.includes('SKIRTING'));
function comparisonHarness(component, props, initial) {
  let state = initial;
  const file = path.resolve(__dirname, '../src/components/CostingComparison.tsx');
  const loaded = new Module(file, module); loaded.filename = file; loaded.paths = module.paths;
  loaded.require = name => name === 'react' ? { useState: value => [state ?? value, update => { state = typeof update === 'function' ? update(state ?? value) : update; }] } : require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  const nodes = tree => { const out = []; const visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); out.push(node); visit(node.props?.children); }; visit(tree); return out; };
  return { exports: loaded.exports, render: () => nodes(loaded.exports[component](props)) };
}
const versions = comparisonHarness('CostingComparison', { data: result, onClose() {} }, 2);
let nodes = versions.render();
assert.equal(nodes.filter(n => n.type?.name === 'SimpleComparisonGroup').length, 4);
assert(!nodes.some(n => n.type?.name === 'ComparisonCategory'), 'Version 2 starts at group totals');
assert(nodes.some(n => n.type === 'details' && n.props.className === 'comparison-price-changes' && !n.props.open), 'Version 2 keeps price-change reasons collapsed');
nodes.find(n => n.type === 'button' && n.props.children === 'Version 1 · Detailed').props.onClick();
nodes = versions.render();
assert.equal(nodes.filter(n => n.type?.name === 'ComparisonCategory').length, result.categories.length, 'Version 1 retains every original category');
assert(!nodes.some(n => n.type?.name === 'SimpleComparisonGroup'));
assert(nodes.some(n => n.type === 'th' && n.props.children === 'Item cost total'));
nodes.find(n => n.type === 'button' && n.props.children === 'Version 2 · Simple').props.onClick();
assert.equal(versions.render().filter(n => n.type?.name === 'SimpleComparisonGroup').length, 4, 'The switch works in both directions');
const groups = versions.exports.SIMPLE_COMPARISON_GROUPS;
assert.deepEqual([...groups.find(g => g.name === 'Accessories').categories], ['Accessories'], 'Version 2 exposes Accessories as a dedicated top-level category');
assert(!groups.find(g => g.name === 'Hardware & profiles').categories.includes('Accessories'));
assert.deepEqual(groups.flatMap(g => [...g.categories]).sort(), [...result.categories].sort(), 'Every category belongs to exactly one simple group');
for (const column of result.columns) assert.equal(groups.reduce((sum, group) => sum + group.categories.reduce((s, c) => s + column.totals[c], 0), 0) + column.adjustment, column.itemCost);
const grouped = comparisonHarness('SimpleComparisonGroup', { group: groups[0], data: result }, false);
nodes = grouped.render();
assert(!nodes.some(n => n.type?.name === 'ComparisonCategory'));
nodes.find(n => n.type === 'button').props.onClick();
nodes = grouped.render();
assert(nodes.some(n => n.type?.name === 'ComparisonCategory' && n.props.category === 'Carcass' && n.props.simple));
assert(!nodes.some(n => n.type?.name === 'ComparisonCategory' && n.props.category === 'Visible side'), 'Empty categories are hidden in Version 2');
assert(nodes.some(n => n.type?.name === 'ComparisonPrices' && n.props.highlight), 'Version 2 enables difference highlighting');
const emptyGroup = comparisonHarness('SimpleComparisonGroup', { group: groups[0], data: compareCostings([{ ...source, materialCost: 0, entry: { costing: { items: [], unpriced: [] } } }]) }, false);
assert.equal(emptyGroup.render().length, 0, 'Empty groups do not add clutter');
assert.equal(comparisonCategory(item('Profile', 'KITCHEN-041', 'ALU PROF FOR SHUTTER ASP', 1)), 'Profiles');
assert.equal(comparisonCategory(item('Accessory', 'CUSTOM-ACCESSORY', 'New profile accessory', 100)), 'Accessories', 'Explicit custom accessories are retained even when their name contains profile');
const unavailable = compareCostings([{ ...source, entry: {} }]);
assert(!unavailable.columns[0].hasSnapshot);
assert(renderToStaticMarkup(React.createElement(CostingComparison, { data: unavailable, onClose() {} })).includes('Not available'));
console.log('PASS: both comparison versions, nested groups/categories, difference highlighting, empty-category filtering, separate processing and reconciled totals.');
