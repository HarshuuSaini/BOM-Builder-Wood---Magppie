const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/lib/cabinet-rules.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function("module", "exports", compiled)(moduleForTest, moduleForTest.exports);
const { blindOpeningLimits, isDoubleShutterWidth, shelfCodeToken, tallApplianceDrawerCode } = moduleForTest.exports;

assert.deepEqual(blindOpeningLimits("BB"), { min: 300, max: 600, defaultWidth: 550 });
assert.deepEqual(blindOpeningLimits("BBL"), { min: 300, max: 600, defaultWidth: 550 });
assert.deepEqual(blindOpeningLimits("WB"), { min: 350, max: 600, defaultWidth: 450 });
assert.deepEqual(blindOpeningLimits("TB"), { min: 450, max: 550, defaultWidth: 550 });
assert.equal(isDoubleShutterWidth(600), false);
assert.equal(isDoubleShutterWidth(601), true);
assert.equal(shelfCodeToken("1SG", 0, true, true), "XXX");
assert.equal(shelfCodeToken("1SX", 0, true, false), "XXX");
assert.equal(shelfCodeToken("3SG", 2, true, true), "2SG");
assert.equal(shelfCodeToken("1SG", 2, true, false), "2SX");
assert.equal(shelfCodeToken("1SX", 2, true, false), "2SX");
assert.equal(shelfCodeToken("1SX", 1, false, false), "1SX");
assert.equal(shelfCodeToken("BPO", 0, true, false), "BPO");
assert.equal(tallApplianceDrawerCode(1), "1LB");
assert.equal(tallApplianceDrawerCode(2), "2LB");
console.log("Cabinet rules: OK");
