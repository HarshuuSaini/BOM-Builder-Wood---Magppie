const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
const load = Module._load;
Module._resolveFilename = function(name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);
};
Module._load = function(name, ...args) {
  if (name === '@/components/UserSignOut') return { UserSignOut: () => React.createElement('button', null, 'Sign out') };
  return load.call(this, name, ...args);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { CostingLibrary } = require('../src/components/CostingLibrary.tsx');
const { costingLibraryPricing } = require('../src/lib/costing-library-pricing.ts');
const { loginLandingPage } = require('../src/lib/login-workspace.ts');
const snapshot = { materialCost: 100000, installation: 9500, transportation: 1500, loading: 500, conversion: 44600, profit: 0, tax: 0, total: 156100 };
const fixture = { ...snapshot, id: 'test', owner: 'Sudha@31', name: 'Test kitchen', areaSqft: 100,
  createdAt: '2026-10-26T10:00:00Z', updatedAt: '2026-10-26T10:00:00Z', updatedBy: 'Sudha@31', version: 1, cabinetCount: 1 };
const headings = markup => [...markup.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map(match => match[1].replace(/<[^>]*>/g, '').trim());
const render = role => renderToStaticMarkup(React.createElement(CostingLibrary, { initial: [fixture], actor: { username: 'preview', role } }));
const user = render('user'), admin = render('admin');
assert.deepEqual(headings(user), ['Actions / select', 'Kitchen', 'Created by', 'Visible sqft', 'Item cost', 'Last saved', 'Version']);
assert.deepEqual(headings(admin), ['Actions / select', 'Kitchen', 'Created by', 'Visible sqft', 'Item cost', 'Installation', 'Transportation', 'Loading / Unloading', 'Conversion', 'Tax', 'Total', 'Last saved', 'Version']);
assert(admin.includes('Actions for Test kitchen') && admin.includes('popover="auto"') && admin.includes('Clone kitchen') && admin.includes('Move to bin'));
assert(admin.includes('Compare selected kitchens') && !user.includes('Compare selected kitchens'));
assert.ok(user.includes('Edit costing'));
assert.ok(admin.includes('Admin edit'));
assert.ok(user.includes('+ Add costing'));
assert.ok(admin.includes('+ Add costing'));
for (const value of [9500, 1500, 500, 44600, 156100]) {
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
  assert.ok(admin.includes(amount));
  assert.ok(!user.includes(amount));
}
assert.deepEqual(costingLibraryPricing(snapshot, false), [['Item cost', 100000]], 'View details must use the same role restriction');
assert.equal(costingLibraryPricing(snapshot, true).length, 7);
assert.equal(loginLandingPage(true), '/costings');
assert.equal(loginLandingPage(false), '/materials', 'Production without the local portal keeps its existing landing page');
assert.equal(loginLandingPage(undefined), '/materials');
console.log('Saved costing library: admin charges/totals, user item-cost-only pricing, retained actions and role-based login landing passed.');
