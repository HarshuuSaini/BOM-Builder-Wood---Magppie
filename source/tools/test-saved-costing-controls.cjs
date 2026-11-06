const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require('./test-purchase-rounding.cjs');

const file = path.resolve(__dirname, '../src/components/SavedCostingControls.tsx');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const entry = (id, name, version = 1, rows = [{ 'Record Type': 'cabinet', Data: '{}' }]) => ({
  id, name, rows, ...(version && { savedCostingId: `saved-${id}`, savedCostingVersion: version }),
});

// Execute the actual component callbacks. Hooks retain state across explicit
// renders; network responses, timers, navigation and storage stay in memory.
function harness(initial, { admin = false, confirm = true, binCostings = [], activeKitchenId } = {}) {
  const hooks = [], requests = [], statuses = [], navigations = [], confirmations = [];
  const listeners = new Map(), timers = new Map();
  let cursor = 0, callbacks = [], tree, active = 0, maxActive = 0, storageError = false;
  let workspace = structuredClone(initial);
  const effects = [];
  const slot = create => hooks[cursor++] ??= create();
  const react = {
    useRef: value => slot(() => ({ current: value })),
    useState(value) {
      const state = slot(() => ({ value }));
      return [state.value, value => { state.value = value; if (typeof value === 'string') statuses.push(value); }];
    },
    useCallback(callback) { slot(() => ({})); callbacks.push(callback); return callback; },
    useEffect(effect, deps) {
      const state = slot(() => ({}));
      if (!state.deps || deps.some((value, index) => value !== state.deps[index])) effects.push(() => {
        state.cleanup?.(); state.deps = deps; state.cleanup = effect();
      });
    },
  };
  const fakeWindow = {
    setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
    confirm(message) { confirmations.push(message); return confirm; },
    location: { assign: url => navigations.push(url) },
  };
  const fetch = async (url, options) => {
    if (url === '/api/saved-costings?bin=1') return { ok: true, json: async () => ({ costings: binCostings }) };
    assert.equal(url, '/api/saved-costings');
    active++; maxActive = Math.max(maxActive, active);
    return new Promise(resolve => requests.push({ body: JSON.parse(options.body), headers: options.headers,
      respond(data, ok = true) { active--; resolve({ ok, json: async () => data }); },
    }));
  };
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.require = name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === '@/lib/kitchen-workspace') return {
      readKitchenWorkspace: () => structuredClone(workspace),
      writeKitchenWorkspace: entries => { if (storageError) throw new Error('Storage full'); workspace = structuredClone(entries); },
    };
    if (name === '@/lib/price-change-audit') return require('../src/lib/price-change-audit.ts');
    if (name === '@/components/PriceChangeReview') return { PriceChangeReview: () => null };
    if (name === '@/components/PriceChangeReviewDialog') return { PriceChangeReviewDialog: () => null };
    throw new Error(`Unexpected dependency ${name}`);
  };
  // Inject browser globals into this module only; no live HTTP or disk writes.
  loaded._compile(`module.exports = (window, fetch) => { ${compiled}\nreturn exports; };`, file);
  const component = loaded.exports(fakeWindow, fetch).SavedCostingControls;
  function render(entries) {
    cursor = 0; callbacks = [];
    tree = component({ entries, admin, username: 'alice', activeKitchenId });
    while (effects.length) effects.shift()();
  }
  render(initial);
  return { requests, statuses, navigations, confirmations, render,
    reviewNames: () => tree.props.children.find(child => child?.type?.name === 'PriceChangeReviewDialog').props.children.map(child => child.props.children[0].props.children),
    save: () => callbacks[1](),
    library: () => tree.props.children.find(child => child?.type === 'button' && String(child.props.children).includes('saved costings')).props.onClick(),
    workspace: () => structuredClone(workspace),
    maxActive: () => maxActive,
    storageFails: () => { storageError = true; },
    unload() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; listeners.get('beforeunload')(event); return event.prevented; },
    accept(index, version) { const request = requests[index]; request.respond({ costing: { id: `saved-${request.body.id}`, version } }); },
    reject(index, message = '409 version conflict') { requests[index].respond({ error: message }, false); },
  };
}

(async () => {
  const removed = harness([entry('bin', 'test'), entry('live', 'Active kitchen')]);
  const binSave = removed.save(); await flush();
  removed.requests[0].respond({ error: 'This costing is in the bin.', code: 'COSTING_IN_BIN' }, false);
  await flush();
  assert.equal(removed.requests[1].body.id, 'live', 'A binned costing cannot prevent other kitchens from saving');
  removed.accept(1, 2); await binSave;
  await removed.save();
  assert.equal(removed.requests.length, 2, 'Binned drafts are not retried or recreated');
  assert.equal(removed.workspace().find(e => e.id === 'bin').name, 'test', 'Binned local drafts are preserved');
  assert.equal(removed.unload(), false, 'A binned draft is excluded from active unsaved-change warnings');
  const knownBin = harness([entry('bin', 'test'), entry('live', 'Active kitchen')], { binCostings: [{ id: 'saved-bin' }] });
  await flush(); const activeSave = knownBin.save(); await flush();
  assert.equal(knownBin.requests.length, 1); assert.equal(knownBin.requests[0].body.id, 'live');
  knownBin.accept(0, 2); await activeSave;
  const { priceChangesFor } = require('../src/lib/price-change-audit.ts');
  const priced = { ...entry('priced', 'Price review', 0), costing: { items: [{ category: 'Accessory', itemCode: 'CUSTOM-1', item: 'Custom accessory', unit: 'PCS', quantity: 1, rate: 3000, amount: 3000 }], unpriced: [] } };
  const otherPriced = { ...priced, id: 'other', name: 'Other kitchen' };
  const scoped = harness([priced, otherPriced], { activeKitchenId: 'other' });
  assert.deepEqual(scoped.reviewNames(), ['Other kitchen'], 'Review contains only the active kitchen');
  const gated = harness([priced]);
  await assert.rejects(gated.save(), /reason/i);
  assert.equal(gated.requests.length, 0, 'Autosave cannot send a changed price without a reason');
  gated.render([{ ...priced, priceChanges: priceChangesFor(priced).map(c => ({ ...c, reason: 'Customer selected premium hardware' })) }]);
  const allowed = gated.save(); await flush();
  assert.equal(gated.requests.length, 1);
  assert.equal(gated.requests[0].body.priceChanges[0].reason, 'Customer selected premium hardware');
  gated.accept(0, 1); await allowed;
  assert.equal(gated.workspace()[0].priceChanges[0].reason, 'Customer selected premium hardware');
  const h = harness([entry('a', 'Original')]);
  const first = h.save(), second = h.save(), third = h.save();
  await flush(); assert.equal(h.requests.length, 1);
  h.render([entry('a', 'Edited twice')]); h.accept(0, 2);
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].body.savedCostingVersion, 2);
  assert.equal(h.statuses.includes('All kitchens saved on this computer.'), false);
  h.render([entry('a', 'Newest')]); h.accept(1, 3);
  await flush(); assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].body.name, 'Newest');
  assert.equal(h.requests[2].body.savedCostingVersion, 3);
  h.accept(2, 4); await Promise.all([first, second, third]);
  assert.equal(h.maxActive(), 1, 'Parent queue must serialize all requests');
  assert.equal(h.workspace()[0].name, 'Newest');
  assert.equal(h.workspace()[0].savedCostingVersion, 4);
  assert.equal(h.unload(), false);
  for (const request of h.requests) assert.equal(request.headers['x-costing-user'], 'alice');

  const conflicted = harness([entry('a', 'Conflict'), entry('b', 'Healthy')]);
  const failed = conflicted.save(); const failure = assert.rejects(failed, /Conflict: 409 version conflict/);
  await flush(); conflicted.reject(0); await flush();
  assert.equal(conflicted.requests[1].body.id, 'b');
  conflicted.render([entry('a', 'Conflict draft'), entry('b', 'Healthy latest')]);
  conflicted.accept(1, 2); await flush();
  assert.equal(conflicted.requests[2].body.name, 'Healthy latest');
  conflicted.accept(2, 3); await failure;
  assert.equal(conflicted.requests.length, 3, 'Do not loop retries on conflicted kitchens');
  assert.equal(conflicted.workspace()[0].name, 'Conflict draft');
  assert.equal(conflicted.workspace()[1].savedCostingVersion, 3);
  assert.equal(conflicted.statuses.includes('All kitchens saved on this computer.'), false);
  assert.equal(conflicted.unload(), true);
  const retry = conflicted.save(); await flush();
  conflicted.accept(3, 2); await retry;
  assert.equal(conflicted.unload(), false, 'A later task can retry failed kitchens');

  const navigation = harness([entry('a', 'Original')]);
  navigation.library(); await flush();
  navigation.render([entry('a', 'Edit during navigation save')]); navigation.accept(0, 2);
  await flush(); assert.deepEqual(navigation.navigations, []);
  navigation.accept(1, 3); await flush();
  assert.deepEqual(navigation.navigations, ['/costings']);
  assert.equal(navigation.workspace()[0].name, 'Edit during navigation save');

  for (const allow of [true, false]) {
    const recovery = harness([entry('a', 'Unsaved draft')], { admin: true, confirm: allow });
    recovery.library(); await flush(); recovery.reject(0); await flush();
    assert.equal(recovery.confirmations.length, 1);
    assert.equal(recovery.workspace()[0].name, 'Unsaved draft');
    assert.deepEqual(recovery.navigations, allow ? ['/admin/costings'] : []);
    assert.equal(recovery.unload(), !allow);
  }

  const empty = harness([entry('new', '', 0, []), entry('existing', 'Cleared existing kitchen', 4, [])]);
  const emptySave = empty.save(); await flush();
  assert.equal(empty.requests.length, 1);
  assert.equal(empty.requests[0].body.id, 'existing');
  assert.deepEqual(empty.requests[0].body.rows, []);
  empty.accept(0, 5); await emptySave;

  const full = harness([entry('a', 'Must remain local')]);
  full.storageFails(); full.library(); await flush();
  assert.deepEqual(full.navigations, [], 'Never navigate if draft persistence fails');
  assert.equal(full.statuses.at(-1), 'Storage full');
  assert.equal(full.unload(), true);
  console.log('Saved costing controls passed: serialized queue, draining edits, per-kitchen conflicts/retry, draft-safe navigation, username header, blank existing saves and storage failure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
