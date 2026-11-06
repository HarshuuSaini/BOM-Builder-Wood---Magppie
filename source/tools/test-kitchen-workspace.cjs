const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {
  return originalResolve.call(this, name.startsWith("@/") ? path.join(__dirname, "..", "src", name.slice(2)) : name, ...args);
};
require.extensions[".ts"] = (loaded, filename) => loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);

const file = path.join(__dirname, "..", "src", "lib", "kitchen-workspace.ts");
const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = Module._nodeModulePaths(path.dirname(file));
loaded._compile(compiled, file);

const { kitchenNameFromPdfFilename, normalizeImportedKitchenName } = loaded.exports;
assert.equal(kitchenNameFromPdfFilename("BOM Backorder Report_Tower1, 2 & 3 Unit 4 Kitchen.pdf"), "Tower1, 2 & 3 Unit 4");
assert.equal(kitchenNameFromPdfFilename("BOM  backorder report_ A Block Kitchen - revised.PDF"), "A Block");
assert.equal(kitchenNameFromPdfFilename("Custom project.pdf"), "Custom project");
assert.equal(kitchenNameFromPdfFilename("Kitchen.pdf"), "Kitchen");
const existing = { id: "1", name: "BOM Backorder Report_Tower1 Kitchen", sourceName: "BOM Backorder Report_Tower1 Kitchen.pdf", rows: [] };
assert.equal(normalizeImportedKitchenName(existing).name, "Tower1");
assert.equal(normalizeImportedKitchenName({ ...existing, name: "My renamed kitchen" }).name, "My renamed kitchen");
const storage = new Map();
global.window = { sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
const { writeKitchenWorkspace, readKitchenWorkspace, startNewKitchenDraft, activeKitchenId } = loaded.exports;
writeKitchenWorkspace([existing]);
storage.set("wood-bom-material-edit-draft", "previous edit");
startNewKitchenDraft("new-kitchen");
assert.equal(readKitchenWorkspace().length, 2);
assert.equal(readKitchenWorkspace()[0].id, existing.id, "Starting another kitchen preserves the prior kitchen");
assert.equal(activeKitchenId(), "new-kitchen");
assert.deepEqual(readKitchenWorkspace()[1], { id: "new-kitchen", name: "", rows: [] });
assert.equal(storage.has("wood-bom-material-edit-draft"), false);
delete global.window;
console.log("PDF kitchen naming and non-destructive new-costing drafts passed.");
