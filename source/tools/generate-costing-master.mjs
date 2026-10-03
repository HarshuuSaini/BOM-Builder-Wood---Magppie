#!/usr/bin/env node

/**
 * Generate the application's static costing master from the approved Excel
 * workbook. KITCHEN supplies boards and cabinet items; Hardware supplies the
 * individual components used when hardware packs are expanded. Usage:
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
const n = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const s = (value) => value == null ? "" : String(value).trim();

function readItems(sheetName, prefix) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`The workbook does not contain a ${sheetName} sheet.`);
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  return rows.filter((row) => s(row["Material Description"]) && s(row.Group) && s(row.Subgroup) && s(row["Rate Basis"])).map((row, index) => ({
    id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
    sNo: n(row.SN) ?? n(row["S. No."]) ?? index + 1,
    elevation: s(row.Elevation),
    materialDescription: s(row["Material Description"]),
    remark: s(row.Remark),
    unit: s(row.Unit),
    sqft: n(row.SQFT),
    price: n(row.Price),
    sqftPrice: n(row["Sq.FT. Price"]),
    group: s(row.Group),
    subgroup: s(row.Subgroup),
    type: s(row.Type),
    brand: s(row.Brand),
    thicknessMm: n(row["Thickness (mm)"]),
    rateBasis: s(row["Rate Basis"]).toUpperCase(),
    currentRate: s(row["Rate Basis"]).toUpperCase() === "SQFT"
      ? n(row["Sq.FT. Price"])
      : n(row.Price),
  }));
}

const items = [...readItems("KITCHEN", "KITCHEN"), ...readItems("Hardware", "HARDWARE")];

if (items.some((item) => !item.group || !item.subgroup || !item.rateBasis || item.currentRate == null)) {
  throw new Error("One or more master items is missing Group, Subgroup, Rate Basis, or Current Rate.");
}

const payload = {
  schemaVersion: 1,
  source: `${path.basename(inputPath)} / KITCHEN + Hardware`,
  generatedAt: new Date().toISOString(),
  currency: "INR",
  items,
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${items.length} records to ${outputPath}`);
