const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
let actor = { username: 'preview', role: 'admin' }, calls = [];
class CostingAccessError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
const fixture = { id: 'a', name: 'Kitchen', version: 1, areaSqft: 1, materialCost: 10, total: 14, entry: { costing: { items: [], unpriced: [] } } };
function load(route) {
  const filename = path.join(__dirname, '../src/app/api/saved-costings', route, 'route.ts');
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: mod, exports: mod.exports, Request, Response, URL, Set, Buffer,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (data, opts) => Response.json(data, opts) } };
      if (name.endsWith('local-costing-http')) return {
        localCostingActor: async () => { if (!actor) throw new CostingAccessError('Sign in first.', 401); return actor; },
        checkCostingOrigin: req => { if (req.headers.get('origin') !== 'http://localhost:3001') throw new CostingAccessError('Invalid origin.', 403); },
        costingErrorResponse: e => Response.json({ error: e.status ? e.message : 'Server error', ...(e.code ? { code: e.code } : {}) }, { status: e.status ?? 500 }),
      };
      if (name.endsWith('local-costing-store')) return { CostingAccessError,
        updateComparisonServiceRates: (...args) => { calls.push(['pricing', ...args]); return [fixture]; },
        changeSavedCostings: (...args) => { calls.push(args); return [fixture]; },
        getSavedCosting: (id, actor, includeBin) => { if (id === 'deleted') { if (includeBin) return { ...fixture, id, deletedAt: '2026-11-06' }; throw new CostingAccessError('Not found.', 404); } if (id === 'missing') throw new CostingAccessError('Not found.', 404); return { ...fixture, id }; },
        saveCosting: entry => { calls.push(['save', entry]); return fixture; },
      };
      if (name.endsWith('server-project-pricing')) return { priceDesignerCosting: entry => entry };
      if (name.endsWith('costing-visibility')) return { exposeSavedCosting: s => s };
      if (name.endsWith('costing-comparison')) return { compareCostings: saved => ({ columns: saved.map(s => ({ id: s.id })) }) };
      throw new Error(`Unexpected dependency ${name}`);
    },
  }, { filename });
  return mod.exports;
}
const request = (body, origin = 'http://localhost:3001') => new Request('http://localhost:3001/api/saved-costings/actions', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
(async () => {
  const actions = load('actions'), compare = load('compare');
  assert.equal((await actions.POST(request({ action: 'clone', ids: ['a'], copies: 3 }))).status, 200);
  assert.equal(calls[0][3], 3);
  assert.equal((await actions.POST(request({ action: 'delete-permanently', ids: ['a'] }))).status, 400);
  assert.equal((await actions.POST(request({ action: 'bin', ids: ['a'] }, 'http://evil.example'))).status, 403);
  assert.equal(calls.length, 1, 'Rejected requests cannot mutate the store');
  assert.equal((await compare.POST(request({ ids: ['a', 'b'] }))).status, 200);
  assert.equal((await compare.POST(request({ ids: ['a'] }))).status, 400);
  assert.equal((await compare.POST(request({ ids: ['a', 'a'] }))).status, 400);
  assert.equal((await compare.POST(request({ ids: ['a', 'deleted'] }))).status, 404);
  const saves = load('');
  const pricing = load('project-pricing');
  assert.equal((await pricing.POST(request({ kitchens: [{ id: 'a', version: 1 }], reason: 'Transport revised' }))).status, 200);
  assert.equal(calls[calls.length - 1][0], 'pricing');
  const beforeBadOrigin = calls.length;
  assert.equal((await pricing.POST(request({}, 'http://evil.example'))).status, 403);
  assert.equal(calls.length, beforeBadOrigin);
  const attemptsBeforeBin = calls.length;
  const binResponse = await saves.POST(request({ id: 'workspace', name: 'test', savedCostingId: 'deleted', savedCostingVersion: 1, rows: [] }));
  assert.equal(binResponse.status, 409); assert.equal((await binResponse.json()).code, 'COSTING_IN_BIN');
  assert.equal(calls.length, attemptsBeforeBin, 'A binned save must stop before persistence or repricing');
  const missingResponse = await saves.POST(request({ id: 'workspace', name: 'Missing', savedCostingId: 'missing', savedCostingVersion: 1, rows: [] }));
  assert.equal(missingResponse.status, 404, 'A genuinely missing record remains an error');
  actor = { username: 'Sudha@31', role: 'user' };
  assert.equal((await pricing.POST(request({}))).status, 403);
  assert.equal((await compare.POST(request({ ids: ['a', 'b'] }))).status, 403);
  actor = null;
  assert.equal((await pricing.POST(request({}))).status, 401);
  assert.equal((await actions.POST(request({ action: 'restore', ids: ['a'] }))).status, 401);
  assert.equal((await compare.POST(request({ ids: ['a', 'b'] }))).status, 401);
  console.log('PASS: action and comparison API authentication, admin comparison, origin checks, validation and hidden bin entries.');
})().catch(error => { console.error(error); process.exitCode = 1; });
