#!/usr/bin/env node

/**
 * Generate the application's static costing master from the approved Excel
 * workbook. Only the KITCHEN sheet is read. Usage:
 *
 *   node tools/generate-costing-master.mjs /path/to/Cost_Master_Updated.xlsx
 */

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx-js-style";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Pass the approved costing workbook path.");

const outputPath = path.resolve("src/data/costing_master.json");
const workbook = XLSX.readFile(inputPath, { cellFormula: true, cellNF: true });
const sheet = workbook.Sheets.KITCHEN;
if (!sheet) throw new Error("The workbook does not contain a KITCHEN sheet.");

const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
const n = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const s = (value) => value == null ? "" : String(value).trim();

const items = rows
  .filter((row) => s(row["Material Description"]))
  .map((row, index) => ({
    id: `KITCHEN-${String(index + 1).padStart(3, "0")}`,
    sNo: n(row["S. No."]) ?? index + 1,
    elevation: s(row.Elevation),
    sourceSubgroup: s(row.__EMPTY),
    materialDescription: s(row["Material Description"]),
    remark: s(row.Remark),
    unitCost: n(row["Unit Cost"]),
    unit: s(row.Unit),
    sqft: n(row.SQFT),
    price: n(row.Price),
    sqftPrice: n(row["Sq.FT. Price"]),
    group: s(row.Group),
    subgroup: s(row.Subgroup),
    type: s(row.Type),
    brand: s(row.Brand),
    thicknessMm: n(row["Thickness (mm)"]),
    rateBasis: s(row["Rate Basis"]),
    previousRate: n(row["Previous Rate"]),
    currentRate: n(row["Current Rate"]),
    rateChange: n(row["Rate Change (₹)"]),
    rateChangePercent: n(row["Rate Change (%)"]),
  }));

if (items.length !== 122) {
  throw new Error(`Expected 122 KITCHEN items, found ${items.length}.`);
}
if (items.some((item) => !item.group || !item.subgroup || !item.rateBasis || item.currentRate == null)) {
  throw new Error("One or more master items is missing Group, Subgroup, Rate Basis, or Current Rate.");
}

const payload = {
  schemaVersion: 1,
  source: "Cost_Master_Updated.xlsx / KITCHEN",
  generatedAt: new Date().toISOString(),
  currency: "INR",
  items,
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${items.length} records to ${outputPath}`);
