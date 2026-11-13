const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const ts = require("typescript");
require.extensions[".css"] = module => { module.exports = {}; };
require('./test-purchase-rounding.cjs');
const { priceChangesFor } = require('../src/lib/price-change-audit.ts');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wood-bom-costing-test-"));
const databasePath = path.join(directory, "costings.sqlite");
const connections = new Set();
const filename = path.join(__dirname, "..", "src", "lib", "local-costing-store.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Fresh module state, explicit env and real SQLite, confined to this test's temporary directory.
// No framework initialization, env-file loading, or access to the app's .local-data directory.
function loadStore(env) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Buffer,
    process: { env, cwd() { throw new Error("Test must use an explicit temporary database directory."); } },
    require(name) {
      if (name === "server-only") return {};
      if (name === "node:sqlite") return { DatabaseSync: class extends DatabaseSync {
        constructor(target, ...args) {
          assert.equal(target, databasePath, "Database must stay inside the temporary directory");
          super(target, ...args);
          connections.add(this);
        }
      } };
      return require(name);
    },
  }, { filename });
  return module.exports;
}

function closeConnections() {
  for (const db of connections) db.close();
  connections.clear();
}

const user = { username: "Sudha@31", role: "user" };
const other = { username: "Abdul@31", role: "user" };
const admin = { username: "preview-admin", role: "admin" };
const env = { NODE_ENV: "development", LOCAL_COSTINGS_ENABLED: "1", LOCAL_COSTINGS_DIRECTORY: directory };
const clone = value => JSON.parse(JSON.stringify(value));
const entry = () => { const value = ({
  id: "same-workspace-id", name: "Kitchen A", sourceName: "kitchen.pdf",
  rows: [{ "Record Type": "format", Data: "v1" }, { "Record Type": "cabinet", Data: '{"name":"base cabinet"}' }],
  costing: {
    areaSqft: 20, materialCost: 100, conversion: 0, conversionModel: 'margin', transportation: 2,
    installation: 3, loading: 1, tax: 0, total: 106,
    items: [{ category: "board", itemCode: "B1", item: "Plywood", unit: "sqft", quantity: 2, rate: 50, amount: 100 }],
    unpriced: ["Handle"],
  },
}); return { ...value, priceChanges: priceChangesFor(value).map(c => ({ ...c, reason: 'Fixture quoted rate' })) }; };

try {
  const store = loadStore(env);
  const status = (fn, expected) => assert.throws(fn, error => error instanceof store.CostingAccessError && error.status === expected);
  assert.equal(store.isLocalCostingsEnabled(), true);
  assert.equal(store.listSavedCostings(user).length, 0);
  const original = entry();
  const first = store.saveCosting(original, user);
  assert.equal(original.savedCostingId, undefined, "Saving must not mutate the caller's workspace");
  assert.equal(first.owner, user.username);
  assert.equal(first.updatedBy, user.username);
  assert.equal(first.version, 1);
  assert.equal(first.entry.savedCostingVersion, 1);
  assert.equal(first.cabinetCount, 1);
  assert.equal(first.total, 106);
  assert.deepEqual(clone(first.entry.costing), original.costing);
  assert.equal(store.listSavedCostings(other).length, 0);
  status(() => store.getSavedCosting(first.id, other), 404);
  status(() => store.saveCosting(first.entry, other), 404);
  status(() => store.getSavedCosting("missing", user), 404);
  status(() => store.saveCosting({ ...entry(), savedCostingId: "missing" }, user), 404);

  const second = store.saveCosting({ ...entry(), name: "Other owner's kitchen" }, other);
  assert.notEqual(first.id, second.id, "Identical workspace IDs must be scoped to each owner");
  assert.equal(store.listSavedCostings(user).length, 1);
  assert.equal(store.listSavedCostings(other)[0].id, second.id);
  assert.equal(store.listSavedCostings(admin).length, 2);
  assert.equal(store.getSavedCosting(first.id, admin).owner, user.username);

  const adminEdit = clone(first.entry);
  adminEdit.name = "Administrator revision";
  adminEdit.costing.loading = 45; adminEdit.costing.total = 150;
  const updated = store.saveCosting(adminEdit, admin);
  assert.equal(updated.owner, user.username, "Admin editing must preserve the original owner");
  assert.equal(updated.updatedBy, admin.username);
  assert.equal(updated.createdAt, first.createdAt);
  assert.equal(updated.version, 2);
  assert.equal(store.getSavedCosting(first.id, user).total, 150);
  status(() => store.getSavedCosting(first.id, other), 404);
  status(() => store.saveCosting(first.entry, user), 409);
  status(() => store.saveCosting(first.entry, admin), 409);
  status(() => store.saveCosting(entry(), user), 409); // Same workspace, missing current version.
  status(() => store.saveCosting({ ...updated.entry, savedCostingVersion: 99 }, user), 409);

  const inspect = new DatabaseSync(databasePath);
  connections.add(inspect);
  const revisions = () => inspect.prepare("SELECT * FROM costing_revisions WHERE costing_id = ? ORDER BY version").all(first.id);
  assert.deepEqual(revisions().map(row => row.version), [1, 2]);
  assert.deepEqual(revisions().map(row => row.saved_by), [user.username, admin.username]);
  assert.equal(JSON.parse(revisions()[0].payload).name, "Kitchen A");
  assert.equal(JSON.parse(revisions()[1].payload).costing.total, 150);
  assert.equal(inspect.prepare("SELECT owner, workspace_id FROM costings WHERE id = ?").get(first.id).workspace_id, original.id);

  // If revision persistence fails, the current row must also roll back.
  inspect.exec("CREATE TRIGGER reject_revision BEFORE INSERT ON costing_revisions WHEN NEW.version = 3 BEGIN SELECT RAISE(ABORT, 'test revision failure'); END;");
  assert.throws(() => store.saveCosting({ ...updated.entry, name: "Must roll back" }, user), /test revision failure/);
  assert.equal(store.getSavedCosting(first.id, user).name, updated.name);
  assert.equal(store.getSavedCosting(first.id, user).version, 2);
  assert.equal(revisions().length, 2);
  inspect.exec("DROP TRIGGER reject_revision;");

  const invalidEntries = [
    null, { ...entry(), id: " " }, { ...entry(), id: "x".repeat(161) }, { ...entry(), name: 5 },
    { ...entry(), rows: null }, { ...entry(), rows: [null, ...entry().rows] },
    { ...entry(), rows: [[], ...entry().rows] }, { ...entry(), rows: [{ Data: "x" }] },
    { ...entry(), rows: [{ "Record Type": "cabinet", Data: {} }] },
    { ...entry(), rows: [] }, { ...entry(), rows: [{ "Record Type": "settings", Data: "{}" }] },
    ...["", 123, {}, "x".repeat(161)].map(savedCostingId => ({ ...entry(), savedCostingId })),
    ...[null, "2", 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(savedCostingVersion => ({ ...updated.entry, savedCostingVersion })),
    ...[null, [], {}, { ...entry().costing, total: "125" }, { ...entry().costing, total: NaN },
      { ...entry().costing, areaSqft: Infinity }, { ...entry().costing, items: [null] },
      { ...entry().costing, items: [{ ...entry().costing.items[0], amount: "100" }] },
      { ...entry().costing, unpriced: [null] }].map(costing => ({ ...entry(), costing })),
  ];
  for (const invalid of invalidEntries) status(() => store.saveCosting(invalid, user), 400);
  for (const invalidId of [null, {}, 123, "", " "]) status(() => store.getSavedCosting(invalidId, user), 400);
  const circular = { ...entry(), id: "circular" };
  circular.extra = circular;
  status(() => store.saveCosting(circular, user), 400);
  status(() => store.saveCosting({ ...entry(), id: "oversized", rows: [{ "Record Type": "cabinet", Data: "x".repeat(2_000_001) }] }, user), 413);
  assert.equal(inspect.prepare("SELECT count(*) AS count FROM costings").get().count, 2);
  assert.equal(revisions().length, 2, "Invalid and conflicting saves must not create revisions");
  const emptyEdit = { ...updated.entry, rows: [], costing: {
    areaSqft: 0, materialCost: 0, conversion: 0, profit: 0, transportation: 0,
    installation: 0, loading: 0, tax: 0, total: 0, items: [], unpriced: [],
  } };
  status(() => store.saveCosting({ ...emptyEdit, savedCostingId: "missing" }, user), 404);
  status(() => store.saveCosting(emptyEdit, other), 404);
  status(() => store.saveCosting({ ...emptyEdit, savedCostingVersion: 1 }, user), 409);
  status(() => store.saveCosting({ ...emptyEdit, savedCostingVersion: undefined }, admin), 409);
  status(() => store.saveCosting({ ...emptyEdit, savedCostingId: undefined }, user), 400);
  status(() => store.saveCosting({ ...entry(), id: "new-empty", rows: [] }, user), 400);
  assert.equal(revisions().length, 2, "Rejected empty edits must not create revisions");
  const third = store.saveCosting({ ...emptyEdit, name: "Final cabinet removed" }, user);
  assert.equal(third.version, 3, "A failed transaction must not poison later saves");
  assert.equal(third.owner, user.username);
  assert.equal(third.cabinetCount, 0);
  assert.equal(third.total, 0);
  assert.deepEqual(clone(store.getSavedCosting(first.id, user).entry.rows), []);
  assert.deepEqual(JSON.parse(revisions()[2].payload).rows, []);
  const fourth = store.saveCosting({ ...third.entry, rows: [
    { "Record Type": "format", Data: "v1" }, { "Record Type": "settings", Data: "{}" },
  ] }, admin);
  assert.equal(fourth.version, 4);
  assert.equal(fourth.owner, user.username);
  assert.equal(fourth.updatedBy, admin.username);
  assert.equal(fourth.cabinetCount, 0);
  assert.deepEqual(JSON.parse(revisions()[0].payload).rows, original.rows, "Clearing items must preserve earlier revisions");

  // Close every connection, then load a fresh module and reopen the on-disk database.
  closeConnections();
  const reloadEnv = { ...env };
  const reloaded = loadStore(reloadEnv);
  assert.deepEqual(clone(reloaded.getSavedCosting(first.id, user)), clone(fourth));
  assert.equal(reloaded.listSavedCostings(admin).length, 2);
  const revisionCheck = new DatabaseSync(databasePath);
  connections.add(revisionCheck);
  assert.equal(revisionCheck.prepare("SELECT count(*) AS count FROM costing_revisions WHERE costing_id = ?").get(first.id).count, 4);

  const lifecycleInput = { ...entry(), id: 'lifecycle', name: 'Lifecycle', rows: [
    ...entry().rows, { 'Record Type': 'settings', Data: JSON.stringify({ name: 'Lifecycle', pricing: { processingRates: { 'Counter Ply': 17 } } }) },
  ] };
  lifecycleInput.priceChanges = priceChangesFor(lifecycleInput).map(c => ({ ...c, reason: 'Fixture quoted rate' }));
  const lifecycle = reloaded.saveCosting(lifecycleInput, user);
  const copyResults = reloaded.changeSavedCostings([lifecycle.id, second.id], 'clone', admin, 2);
  assert.equal(copyResults.length, 4);
  assert.equal(new Set(copyResults.map(c => c.id)).size, 4);
  const independent = reloaded.getSavedCosting(copyResults[0].id, user);
  assert.notEqual(independent.entry.id, lifecycle.entry.id);
  assert.equal(independent.version, 1); assert.equal(independent.owner, user.username);
  assert.equal(JSON.parse(independent.entry.rows.find(r => r['Record Type'] === 'settings').Data).name, independent.name);
  assert.deepEqual(clone(independent.entry.costing), clone(lifecycle.entry.costing));
  const editedCopy = reloaded.saveCosting({ ...independent.entry, name: 'Edited copy' }, user);
  assert.equal(reloaded.getSavedCosting(lifecycle.id, user).name, 'Lifecycle');
  assert.equal(editedCopy.name, 'Edited copy');
  assert.throws(() => reloaded.changeSavedCostings([lifecycle.id], 'clone', other), e => e.status === 404);
  const binned = reloaded.changeSavedCostings([lifecycle.id], 'bin', user)[0];
  assert(binned.deletedAt); assert.equal(binned.version, lifecycle.version + 1);
  assert(!reloaded.listSavedCostings(user).some(c => c.id === lifecycle.id));
  assert(reloaded.listSavedCostings(user, true).some(c => c.id === lifecycle.id));
  const binAfterReopen = loadStore({ ...env });
  assert(binAfterReopen.listSavedCostings(user, true).some(c => c.id === lifecycle.id), 'Bin entries persist after reopening the database');
  assert.equal(reloaded.listSavedCostings(other, true).length, 0);
  assert.throws(() => reloaded.getSavedCosting(lifecycle.id, user), e => e.status === 404);
  assert.throws(() => reloaded.saveCosting(lifecycle.entry, user), e => e.status === 409);
  assert.throws(() => reloaded.changeSavedCostings([lifecycle.id], 'restore', other), e => e.status === 404);
  assert.throws(() => reloaded.changeSavedCostings([lifecycle.id], 'clone', user), e => e.status === 409);
  assert.throws(() => reloaded.changeSavedCostings([editedCopy.id, 'missing'], 'bin', admin), e => e.status === 404);
  assert(reloaded.getSavedCosting(editedCopy.id, user), 'Bulk validation failure must not bin earlier selections');
  const restored = reloaded.changeSavedCostings([lifecycle.id], 'restore', user)[0];
  assert(!restored.deletedAt); assert.equal(restored.version, lifecycle.version + 2);
  assert.deepEqual(clone(reloaded.getSavedCosting(lifecycle.id, user).entry.costing), clone(lifecycle.entry.costing));
  assert.equal(reloaded.listSavedCostings(user, true).length, 0);
  assert.throws(() => reloaded.changeSavedCostings([lifecycle.id, lifecycle.id], 'bin', user), e => e.status === 400);
  const beforeFailedClone = reloaded.listSavedCostings(admin).length;
  revisionCheck.exec(`CREATE TRIGGER reject_clone BEFORE INSERT ON costing_revisions WHEN json_extract(NEW.payload,'$.name') LIKE 'Other owner%copy%' BEGIN SELECT RAISE(ABORT, 'clone failure'); END;`);
  assert.throws(() => reloaded.changeSavedCostings([lifecycle.id, second.id], 'clone', admin), /clone failure/);
  assert.equal(reloaded.listSavedCostings(admin).length, beforeFailedClone, 'Every clone rolls back if one revision fails');
  revisionCheck.exec('DROP TRIGGER reject_clone');
  const missingReason = { ...entry(), id: 'needs-audit', priceChanges: [] };
  assert.throws(() => reloaded.saveCosting(missingReason, user), e => e.status === 400 && /reason/i.test(e.message));
  const auditSaved = reloaded.saveCosting({ ...missingReason, priceChanges: priceChangesFor(missingReason).map(c => ({ ...c, reason: 'New supplier quote' })) }, user);
  const changedAgain = clone(auditSaved.entry);
  changedAgain.costing.items[0].rate = 60;
  assert.throws(() => reloaded.saveCosting(changedAgain, user), e => e.status === 400 && /reason/i.test(e.message));
  const exactRemark = 'updated the master  \nSupplier revised the rate ';
  changedAgain.priceChanges = priceChangesFor(changedAgain, auditSaved.entry).map(c => ({ ...c, reason: exactRemark }));
  const auditUpdated = reloaded.saveCosting(changedAgain, user);
  assert.equal(auditUpdated.entry.priceChanges[0].reason, exactRemark, 'Saving preserves spaces, newlines and trailing spaces exactly');
  const auditCopy = reloaded.changeSavedCostings([auditUpdated.id], 'clone', user)[0];
  assert.equal(reloaded.getSavedCosting(auditCopy.id, user).entry.priceChanges[0].reason, exactRemark);
  assert.equal(loadStore({ ...env }).getSavedCosting(auditUpdated.id, user).entry.priceChanges[0].reason, exactRemark, 'Reopening SQLite preserves the full remark');

  // The guard must apply to already-open connections as well as fresh modules.
  const { savedAccessorySelection } = require('../src/lib/accessory-master.ts');
  const basket = { ...entry(), id: 'master-basket-fixture', name: 'Accessory master fixture' };
  const basketRow = { id: 42, itemId: 'CUSTOM', customName: 'Detergent basket', customBrand: 'Test brand', customUnit: 'PCS', qty: 1, elevation: '', manualRate: '400', priceChangeReason: 'New test basket' };
  basket.rows.push({ 'Record Type': 'accessory', Data: JSON.stringify(basketRow) });
  basket.costing.items.push({ category: 'Accessory', itemCode: 'CUSTOM-ACCESSORY', item: 'Detergent basket · Test brand', unit: 'nos', quantity: 1, rate: 400, amount: 400 });
  basket.costing.materialCost += 400;
  basket.costing.total += 400;
  const basketSaved = reloaded.saveCosting(basket, admin);
  const masterBasket = reloaded.listAccessoryMaster().find(item => item.name === 'Detergent basket');
  assert(masterBasket && masterBasket.rate === 400 && masterBasket.brand === 'Test brand');
  assert.equal(masterBasket.reason, 'New test basket');
  assert.equal(savedAccessorySelection(masterBasket).manualRate, '400');
  assert.equal(savedAccessorySelection(masterBasket).customName, 'Detergent basket');
  const revisedBasket = clone(basketSaved.entry);
  const revisedRow = { ...basketRow, manualRate: '500', priceChangeReason: 'Supplier revised basket price' };
  revisedBasket.rows[2].Data = JSON.stringify(revisedRow);
  revisedBasket.costing.items[1].rate = 500; revisedBasket.costing.items[1].amount = 500;
  const basketUpdated = reloaded.saveCosting(revisedBasket, admin);
  assert.equal(reloaded.listAccessoryMaster().find(item => item.name === 'Detergent basket').rate, 500);
  const beforeConflict = reloaded.listAccessoryMaster().find(item => item.name === 'Detergent basket');
  assert.throws(() => reloaded.saveCosting(basketSaved.entry, admin), error => error.status === 409);
  assert.deepEqual(clone(reloaded.listAccessoryMaster().find(item => item.name === 'Detergent basket')), clone(beforeConflict), 'A stale quote cannot roll back the master price');
  const drawerMat = clone(basketUpdated.entry);
  drawerMat.id = 'master-drawer-mat'; delete drawerMat.savedCostingId; delete drawerMat.savedCostingVersion;
  drawerMat.rows[2].Data = JSON.stringify({ id: 44, itemId: 'ACCESSORIES-033', qty: 2, elevation: '', manualRate: '175', priceChangeReason: 'Test drawer mat rate' });
  drawerMat.costing.items[1] = { category: 'Accessory', itemCode: 'ACCESSORIES-033', item: 'MATT LS ANTI SKID X600X1 GREY ASM6-ATL EBC', unit: 'RMT', quantity: 2, rate: 175, amount: 350 };
  drawerMat.priceChanges = priceChangesFor(drawerMat).map(change => ({ ...change, reason: 'Fixture price approved' }));
  reloaded.saveCosting(drawerMat, admin);
  const masterMat = reloaded.listAccessoryMaster().find(item => item.sourceItemId === 'ACCESSORIES-033');
  assert(masterMat && masterMat.unit === 'MTR' && masterMat.rate === 175, 'Priced reference drawer mats are reusable with their running-metre rate');
  assert.equal(savedAccessorySelection(masterMat).itemId, 'ACCESSORIES-033');
  assert.equal(loadStore({ ...env }).listAccessoryMaster().find(item => item.name === 'Detergent basket').rate, 500, 'Reusable accessories survive reopening SQLite');
  const serviceA = reloaded.saveCosting({ ...entry(), id: 'service-a', name: 'Service A' }, user);
  const serviceB = reloaded.saveCosting({ ...entry(), id: 'service-b', name: 'Service B' }, other);
  const untouched = reloaded.saveCosting({ ...entry(), id: 'service-untouched', name: 'Unselected' }, user);
  const rates = { transportation: 20, installation: 100, loading: 6, conversionPct: 50, includeTax: true };
  const rateUpdate = { rates, reason: 'Updated installation  and service quote\nApproved ', kitchens: [{ id: serviceA.id, version: serviceA.version }, { id: serviceB.id, version: serviceB.version }] };
  assert.throws(() => reloaded.updateComparisonServiceRates(rateUpdate, user), e => e.status === 403);
  assert.throws(() => reloaded.updateComparisonServiceRates({ ...rateUpdate, reason: '  ' }, admin), e => e.status === 400);
  assert.throws(() => reloaded.updateComparisonServiceRates({ ...rateUpdate, rates: { ...rates, installation: -1 } }, admin), e => e.status === 400);
  assert.throws(() => reloaded.updateComparisonServiceRates({ ...rateUpdate, kitchens: [rateUpdate.kitchens[0], { id: serviceB.id, version: serviceB.version + 1 }] }, admin), e => e.status === 409);
  assert.equal(reloaded.getSavedCosting(serviceA.id, admin).version, serviceA.version, 'A stale second kitchen rolls back the first kitchen too');
  const serviceUpdated = reloaded.updateComparisonServiceRates(rateUpdate, admin);
  assert.equal(serviceUpdated.length, 2);
  for (const result of serviceUpdated) {
    assert.equal(result.version, 2);
    assert.equal(result.materialCost, 100);
    assert.equal(result.transportation, 400);
    assert.equal(result.installation, 2000);
    assert.equal(result.loading, 120);
    assert.equal(result.conversion, 2620);
    assert(!('profit' in result) && !('profit' in result.entry.costing));
    assert(Math.abs(result.tax - 943.2) < 0.00001);
    assert(Math.abs(result.total - 6183.2) < 0.00001);
    assert.deepEqual(clone(result.entry.costing.items), entry().costing.items, 'Comparison rate editing preserves material quantities and prices');
    assert(result.entry.priceChanges.filter(c => /\.pricing\./.test(c.key)).every(c => c.reason === rateUpdate.reason));
    assert.equal(result.updatedBy, admin.username);
  }
  assert.deepEqual(clone(reloaded.getSavedCosting(untouched.id, admin)), clone(untouched), 'Unselected kitchens are untouched');
  const { DEFAULT_SERVICE_RATES } = require('../src/lib/project-service-rates.ts');
  assert.equal(DEFAULT_SERVICE_RATES.installation, 95, 'Editing selected quotes does not change future defaults');
  assert.equal(loadStore({ ...env }).getSavedCosting(serviceA.id, admin).total, serviceUpdated[0].total, 'Updated quote survives SQLite reopening');
  assert.throws(() => reloaded.updateComparisonServiceRates(rateUpdate, admin), e => e.status === 409, 'Old comparison versions cannot overwrite newer prices');
  let retained = reloaded.saveCosting({ ...entry(), id: 'retention', name: 'Retention' }, user);
  for (let i = 2; i <= 9; i++) retained = reloaded.saveCosting({ ...retained.entry, name: `Retention ${i}` }, user);
  const historyDb = new DatabaseSync(databasePath); connections.add(historyDb);
  const retainedVersions = () => historyDb.prepare('SELECT version FROM costing_revisions WHERE costing_id=? ORDER BY version').all(retained.id).map(row => row.version);
  assert.deepEqual(retainedVersions(), [5, 6, 7, 8, 9], 'Keep five versions including the current save');
  const currentPayload = historyDb.prepare('SELECT payload FROM costings WHERE id=?').get(retained.id).payload;
  historyDb.exec('BEGIN');
  historyDb.prepare('INSERT INTO costing_revisions VALUES(?,?,?,?,?)').run(retained.id, 10, currentPayload, new Date().toISOString(), admin.username);
  assert.deepEqual(retainedVersions(), [6, 7, 8, 9, 10]);
  historyDb.exec('ROLLBACK');
  assert.deepEqual(retainedVersions(), [5, 6, 7, 8, 9], 'Failed transactions restore pruned history too');
  historyDb.exec('DROP TRIGGER retain_five_costing_versions');
  for (const version of [1, 2, 3, 4]) historyDb.prepare('INSERT INTO costing_revisions VALUES(?,?,?,?,?)').run(retained.id, version, currentPayload, new Date().toISOString(), admin.username);
  const retentionReload = loadStore({ ...env });
  assert.equal(retentionReload.getSavedCosting(retained.id, admin).version, 9);
  assert.deepEqual(retainedVersions(), [5, 6, 7, 8, 9], 'Existing excessive history is trimmed on reopening');
  assert.equal(historyDb.prepare('SELECT payload FROM costings WHERE id=?').get(retained.id).payload, currentPayload, 'History cleanup never rewrites the current quote');
  retentionReload.changeSavedCostings([retained.id], 'bin', admin);
  assert.deepEqual(retainedVersions(), [6, 7, 8, 9, 10]);
  retentionReload.changeSavedCostings([retained.id], 'restore', admin);
  assert.deepEqual(retainedVersions(), [7, 8, 9, 10, 11], 'Bin and restore saves follow the same retention policy');
  for (let i = 0; i < 8; i++) historyDb.prepare('INSERT INTO accessory_master_revisions(accessory_id,payload,saved_at,saved_by) VALUES(?,?,?,?)').run('retention-accessory', '{}', new Date().toISOString(), admin.username);
  assert.equal(historyDb.prepare('SELECT COUNT(*) AS n FROM accessory_master_revisions WHERE accessory_id=?').get('retention-accessory').n, 5);
  reloadEnv.NODE_ENV = "production";
  assert.equal(reloaded.isLocalCostingsEnabled(), false);
  for (const action of [() => reloaded.listSavedCostings(admin), () => reloaded.getSavedCosting(first.id, user), () => reloaded.saveCosting(third.entry, user)]) {
    assert.throws(action, /only in the local preview/);
  }
  for (const disabledEnv of [
    { NODE_ENV: "production", LOCAL_COSTINGS_ENABLED: "1" },
    { NODE_ENV: "development", LOCAL_COSTINGS_ENABLED: "0" },
    { NODE_ENV: "development" },
  ]) {
    const disabled = loadStore(disabledEnv);
    assert.equal(disabled.isLocalCostingsEnabled(), false);
    const before = connections.size;
    for (const action of [() => disabled.listSavedCostings(admin), () => disabled.getSavedCosting(first.id, user), () => disabled.saveCosting(entry(), user)]) {
      assert.throws(action, /only in the local preview/);
    }
    assert.equal(connections.size, before, "Disabled feature must never open SQLite");
  }
  console.log("Local costing SQLite passed: owner isolation, admin ownership, revisions, 409 conflicts, rollback, validation, reload persistence and production guard.");
} finally {
  closeConnections();
  fs.rmSync(directory, { recursive: true, force: true });
}
