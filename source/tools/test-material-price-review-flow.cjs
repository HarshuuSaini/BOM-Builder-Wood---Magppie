const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { COSTING_ITEMS } = require('../src/lib/costing.ts');
const { KITCHEN_ZONES } = require('../src/lib/kitchen-materials.ts');
const { priceChangesFor } = require('../src/lib/price-change-audit.ts');
const choice = itemId => ({ itemId, frontSheetPrice: '550', backSheetPrice: '550' });
const zone = { carcass: choice('KITCHEN-007'), back: choice('KITCHEN-035'), drawer: choice('KITCHEN-029'), shutter: choice('KITCHEN-014'), visible: choice('KITCHEN-014') };
const materials = { ...Object.fromEntries(KITCHEN_ZONES.map(z => [z, structuredClone(zone)])), _sources: Object.fromEntries(KITCHEN_ZONES.map(z => [z, 'Own'])) };
materials.Base.carcass.boardSheetPrice = '3000';
const entry = { id: 'k', name: 'Kitchen', rows: [], materials, savedCostingId: 'saved-k', savedCostingVersion: 2 };
entry.priceChanges = priceChangesFor(entry).map(c => ({ ...c, reason: 'Saved supplier quote' }));
function harness(source) {
  const hooks = [], effects = [], requests = [], navigations = [];
  let cursor = 0, tree, workspace = [structuredClone(source)];
  const slot = init => hooks[cursor++] ??= init();
  const react = {
    useRef: value => slot(() => ({ current: value })),
    useState(initial) { const s = slot(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [s.value, value => { s.value = typeof value === 'function' ? value(s.value) : value; }]; },
    useEffect(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((d, i) => d !== s.deps[i])) { s.deps = deps; effects.push(fn); } },
  };
  const file = path.resolve(__dirname, '../src/components/MaterialSelection.tsx');
  const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths;
  mod.require = name => {
    if (name === 'react') return react;
    if (name === 'next/navigation') return { useRouter: () => ({ push: p => navigations.push(p) }) };
    if (name === '@/components/UserSignOut') return { UserSignOut: () => null };
    if (name === '@/lib/kitchen-workspace') return { readKitchenWorkspace: () => structuredClone(workspace), writeKitchenWorkspace: entries => { workspace = structuredClone(entries); }, activeKitchenId: () => 'k', setActiveKitchenId() {} };
    return require(name);
  };
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  mod._compile(`module.exports = (fetch) => { ${compiled}\nreturn exports; };`, file);
  const component = mod.exports(async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true }) }; }).MaterialSelection;
  function render() {
    cursor = 0;
    tree = component({ options: COSTING_ITEMS.map(i => ({ ...i, boardSheetPrice: String(i.currentRate * (i.id === 'KITCHEN-SINK-STONE-18' ? 21 : 32)) })) });
    while (effects.length) effects.shift()();
  }
  const nodes = () => { const result = []; const visit = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(visit); result.push(n); visit(n.props?.children); }; visit(tree); return result; };
  render(); render(); render();
  return { render, requests, navigations, nodes, dialog: () => nodes().find(n => n.type?.name === 'PriceChangeReviewDialog'),
    review: () => nodes().find(n => n.type?.name === 'PriceChangeReview'),
    proceed: () => nodes().find(n => n.type === 'button' && String(n.props.children).includes('Continue to Builder')).props.onClick() };
}
(async () => {
  const separateBoard = COSTING_ITEMS.find(i => i.group === 'Carcass/ Shelf Material' && i.id !== 'KITCHEN-007' && i.id !== 'KITCHEN-SINK-STONE-18');
  for (const sinkId of ['KITCHEN-SINK-STONE-18', separateBoard.id]) {
    const separate = structuredClone(entry);
    separate.materials.Sink.carcass = { ...choice(sinkId), boardSheetPrice: '2004', boardFinish: 'Pearl White HG', slabSqft: '21' };
    const view = harness(separate);
    const input = label => view.nodes().find(n => n.props?.['aria-label'] === label);
    const tab = name => { view.nodes().find(n => n.props?.role === 'tab' && n.props.children === name).props.onClick(); view.render(); };
    input('All Carcass / shelf material Postlam raw board sheet price').props.onChange({ target: { value: '3456' } }); view.render();
    tab('Sink');
    assert.equal(input('Sink Carcass / shelf material').props.value, sinkId, 'Separate sink material stays selected');
    const rate = view.nodes().find(n => n.type === 'input' && n.props?.['aria-label']?.startsWith('Sink Carcass / shelf material ') && n.props?.['aria-label']?.endsWith('sheet price'));
    assert.equal(rate.props.value, '2004', 'All-cabinet board price cannot replace a different sink material rate');
    tab('Base');
    assert.equal(input('Base Carcass / shelf material Postlam raw board sheet price').props.value, '3456', 'Matching material receives the shared price update');
  }
  console.log('PASS: shared material price updates preserve separate stone and wood sink materials/rates while updating matching cabinets.');
  const saved = harness(entry);
  assert.equal(saved.dialog().props.required, false, 'Kitchen-level saved remarks are restored');
  await saved.proceed();
  assert.equal(saved.requests.length, 1); assert.equal(saved.navigations[0], '/builder');
  assert(saved.requests[0].body._priceChanges.some(c => c.reason === 'Saved supplier quote'));
  const unsaved = structuredClone(entry); unsaved.materials.Base.carcass.boardSheetPrice = '3100';
  const changed = harness(unsaved);
  assert.equal(changed.dialog().props.required, true);
  await changed.proceed(); changed.render();
  assert.equal(changed.requests.length, 0, 'No material apply occurs before the mandatory reason');
  assert.equal(changed.dialog().props.openRequest, 1, 'Continue requests the review dialog directly');
  assert(!changed.nodes().some(n => n.props?.role === 'alert'), 'No vague error banner pointing to a hidden control');
  const review = changed.review();
  review.props.onReason(review.props.changes.map(c => c.key), 'Updated supplier quote'); changed.render();
  await changed.proceed();
  assert.equal(changed.requests.length, 1); assert.equal(changed.navigations[0], '/builder');
  console.log('PASS: saved kitchen remarks restore, Continue opens required review directly, missing remarks block apply, and entering the reason allows Builder navigation.');
})().catch(e => { console.error(e); process.exitCode = 1; });
