const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

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
console.log("PDF kitchen naming passed.");
