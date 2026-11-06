const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const builderFile = path.join(root, "src/components/WoodBomBuilder.tsx");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalExtensions = { ".ts": require.extensions[".ts"], ".tsx": require.extensions[".tsx"] };
const fixtureKey = "__builderPricingAccessProject";
assert.equal(Object.hasOwn(globalThis, fixtureKey), false);

function replaceOnce(source, target, replacement) {
  assert.equal(source.split(target).length - 1, 1, `Expected exactly one instrumentation target: ${target}`);
  return source.replace(target, replacement);
}

try {
  Module._resolveFilename = function (name, ...args) {
    return originalResolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, ...args);
  };
  Module._load = function (name, ...args) {
    if (name === "@/components/UserSignOut") return { UserSignOut: () => null };
    return originalLoad.call(this, name, ...args);
  };
  for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (mod, file) => {
    let source = fs.readFileSync(file, "utf8").replace(/import\.meta\.url/g, '"file:///test"');
    if (file === builderFile) {
      // Run the real component, hooks, costing calculations and JSX. Only seed
      // project state and select its totals tab; no production source is edited.
      source = replaceOnce(source, "useState<ProjectLine[]>([])", `useState<ProjectLine[]>(globalThis.${fixtureKey})`);
      source = replaceOnce(source, 'useState<"packets" | "raw" | "totals">("packets")', 'useState<"packets" | "raw" | "totals">("totals")');
      source += "\nexport { buildModel, restoreProjectSetup, projectSetupRows, DEFAULT_PROJECT_PRICING, WASTE };";
    }
    mod._compile(ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true, target: ts.ScriptTarget.ES2022,
    } }).outputText, file);
  };

  const builder = require(builderFile);
  const { stripDesignerProjectRows } = require("../src/lib/costing-visibility.ts");
  const config = {
    zk: "BC", fk: "SH", vid: "single", hand: "LHS", handle: "NONE",
    board: "KITCHEN-007", backBoardId: "KITCHEN-035", drawerBoardId: "KITCHEN-029",
    shType: "KITCHEN-014", visibleSides: "", visibleSideMaterialId: "KITCHEN-014",
    glassType: "KITCHEN-GLASS-5-TINTED", hingeChoice: "Hettich Soft Close", neon: "NEON50",
    carcassLamFrontSheetPrice: "550", carcassLamBackSheetPrice: "550",
    backLamFrontSheetPrice: "550", backLamBackSheetPrice: "550",
    drawerLamFrontSheetPrice: "550", drawerLamBackSheetPrice: "550",
    visibleLamFrontSheetPrice: "550", visibleLamBackSheetPrice: "550",
    shutterLamFrontSheetPrice: "550", shutterLamBackSheetPrice: "550",
    W: 600, H: 720, D: 560, drawerModel: "Hettich", finish: "White",
  };
  const model = builder.buildModel(config);
  assert.equal(model.zk, "BC");
  assert.equal(model.fk, "SH");
  globalThis[fixtureKey] = [{ id: 1, m: model, qty: 1, elevation: "AA" }];

  const customProcessing = { "Carcass / shelf material|Prelam": 47, "Counter Ply": 8 };
  const approvedPricing = {
    ...structuredClone(builder.DEFAULT_PROJECT_PRICING), conversionPct: 13, profitPct: 17, includeTax: true,
    transportation: { mode: "direct", value: 1234 }, installation: { mode: "direct", value: 2345 },
    loading: { mode: "direct", value: 345 }, processingRates: customProcessing,
  };
  const restored = {
    name: "SSR BCSH kitchen", project: globalThis[fixtureKey], fillers: [], visiblePanels: [],
    countertops: [], accessories: [], masterAccessories: [], rawSelections: [],
    waste: structuredClone(builder.WASTE), pricing: approvedPricing,
  };
  const fullRows = builder.projectSetupRows(restored);
  const before = JSON.stringify(fullRows);
  const designerRows = stripDesignerProjectRows(fullRows);
  const designerSettings = JSON.parse(designerRows.find(row => row["Record Type"] === "settings").Data);
  assert.equal(Object.hasOwn(designerSettings, "pricing"), false);
  assert.deepEqual(designerSettings.itemProcessingRates, customProcessing);
  const roundTrip = builder.restoreProjectSetup(designerRows);
  assert.equal(roundTrip.project.length, 1);
  assert.equal(roundTrip.project[0].m.code, model.code);
  assert.deepEqual(roundTrip.pricing.processingRates, customProcessing);
  const { processingRates: _rates, ...restoredFactors } = roundTrip.pricing;
  const { processingRates: _defaults, ...defaultFactors } = builder.DEFAULT_PROJECT_PRICING;
  assert.deepEqual(restoredFactors, defaultFactors, "Designer restores use defaults and must not recover approved private factors");
  assert.equal(JSON.stringify(fullRows), before);
  assert.equal(approvedPricing.conversionPct, 13);

  const render = canViewProjectPricing => renderToStaticMarkup(React.createElement(builder.WoodBomBuilder, { canViewProjectPricing }));
  const adminHtml = render(true);
  for (const label of ['Kitchen batch quantity', 'Run Opti &amp; apply waste %', 'Download Opti cutting chart', 'Batch sheets', 'Sheets / kitchen']) assert(adminHtml.includes(label), label);
  assert(adminHtml.includes('aria-label="Kitchen batch quantity"') && adminHtml.includes('value="20"'));
  assert(!adminHtml.match(/aria-label="Kitchen batch quantity"[^>]*max=/), 'Builder batch input has no maximum');
  const designerHtml = render(false);
  for (const group of ['skirting', 'J handle', 'C handle', 'G handle', 'light profile / diffuser', 'foil']) {
    assert(adminHtml.includes(`${group} group waste percent`));
    assert(!designerHtml.includes(`${group} group waste percent`));
  }
  assert(!adminHtml.includes('Admin · Profile, accessory &amp; foil waste %'));
  assert.ok(!designerHtml.includes("Whole-kitchen purchase quantities"), "Purchase roll-up is admin-only");
  assert.ok(adminHtml.includes("Whole-kitchen purchase quantities"));
  const purchaseDetails = adminHtml.match(/<details[^>]*>\s*<summary[^>]*>Whole-kitchen purchase quantities<\/summary>/);
  assert.ok(purchaseDetails, "Admin purchase roll-up remains expandable");
  assert.ok(!/\bopen(?:=|\s|>)/.test(purchaseDetails[0]), "Purchase roll-up is collapsed by default");
  assert(!adminHtml.includes('Profit (') && !designerHtml.includes('Profit ('), 'Separate profit is removed for every role');
  const privateLabels = ["Conversion (", "Admin · Edit processing costs &amp; factors"];
  for (const label of privateLabels) {
    assert.ok(adminHtml.includes(label), `Admin must see ${label}`);
    assert.ok(!designerHtml.includes(label), `Designer must not see ${label}`);
  }
  for (const html of [adminHtml, designerHtml]) {
    for (const label of ["Transportation", "Installation", "Loading / Unloading", "Combined subtotal before conversion", "Subtotal before tax", "GST (18%)", "Final project price"]) {
      assert.ok(html.includes(label), `Both roles must see ${label}`);
    }
    assert.ok(html.includes("Project pricing"), "Keep the section visible for both roles");
    assert.ok(html.includes("Total sqft"), "Keep the area breakdown visible");
    assert.ok(html.includes("Base cabinet / item costing (excluding filler panels)"));
    assert.ok(html.includes("Filler panel material costing, including sides"));
    assert.ok(html.includes(model.code), "SSR must render the seeded BCSH cabinet");
    assert.ok(html.includes("Board processing costs"), "Item processing must remain visible");
    assert.ok(html.includes("Total processing cost (Rs)"), "Processing amounts must remain visible");
    assert.ok(html.includes("Per item (Rs)"), "Item costing must remain visible");
    assert.ok(html.includes("Cabinet line total"), "The populated cabinet costing must remain visible");
    assert.ok(html.includes("Project costing total"), "The material/item total must remain visible");
  }
  console.log("Builder pricing access passed: conversion/profit rows and editing remain admin-only; other pricing summary rows visible to both roles.");
} finally {
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  for (const [extension, handler] of Object.entries(originalExtensions)) {
    if (handler) require.extensions[extension] = handler;
    else delete require.extensions[extension];
  }
  delete globalThis[fixtureKey];
}
