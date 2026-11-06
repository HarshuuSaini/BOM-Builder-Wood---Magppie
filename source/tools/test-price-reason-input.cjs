const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/components/PriceChangeReview.tsx');
const slots = [], effects = [], emitted = [];
let cursor = 0;
const slot = init => slots[cursor++] ??= init();
const react = {
  useState(initial) { const s = slot(() => ({ value: initial })); return [s.value, v => { s.value = v; }]; },
  useRef(initial) { return slot(() => ({ current: initial })); },
  useEffect(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.deps = deps; effects.push(fn); } },
};
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = module.paths;
loaded.require = name => name === 'react' ? react : require(name);
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, file);
function render(parentValue) {
  cursor = 0;
  const element = loaded.exports.PriceReasonInput({ value: parentValue, required: true, label: 'Reason', onChange: value => emitted.push(value) });
  while (effects.length) effects.shift()();
  return element.props;
}
let input = render('');
input.onFocus();
for (const text of ['update', 'update ', 'update the', 'update the ', 'update the master']) {
  input.onChange({ target: { value: text } });
  // Reproduce a parent re-render with a stale/normalized audit summary.
  input = render(text.trim());
  assert.equal(input.value, text, 'Focused textarea must preserve the exact text, including trailing spaces');
}
input.onChange({ target: { value: 'update  the\nmaster' } });
input = render('updatethemaster');
assert.equal(input.value, 'update  the\nmaster');
input.onBlur();
assert.equal(emitted.at(-1), 'update  the\nmaster', 'Blur persists the original spaces and newlines');
assert.equal(input.maxLength, undefined);
const { priceChangesFor } = require('../src/lib/price-change-audit.ts');
const base = { rows: [], materials: { Base: { carcass: { itemId: 'KITCHEN-007', boardSheetPrice: '3000', frontSheetPrice: '550', backSheetPrice: '550' } } } };
const old = priceChangesFor(base).map(c => ({ ...c, reason: 'updatedthemaster' }));
const current = old.map(c => ({ ...c, reason: 'updated the master ' }));
const result = priceChangesFor({ ...base, materials: { ...base.materials, _priceChanges: old }, priceChanges: current });
assert(result.every(c => c.reason === 'updated the master '), 'Current editor text overrides older material remarks');
console.log('PASS: typing spaces, double spaces, middle spaces and newlines survives parent renders and blur; stale material remarks cannot replace the draft.');
