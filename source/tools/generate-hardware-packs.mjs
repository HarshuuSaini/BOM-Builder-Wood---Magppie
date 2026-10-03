import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx-js-style";

if (!process.argv[2]) throw new Error("Pass the approved costing workbook path.");
const sourcePath = path.resolve(process.argv[2]);
const outputPath = path.resolve(process.argv[3] ?? "src/data/hardware_packs.json");

const workbook = XLSX.readFile(sourcePath, { cellFormula: true, cellNF: true });
const sheet = workbook.Sheets.pack;
if (!sheet) throw new Error("The workbook does not contain a pack sheet.");
const rows = XLSX.utils.sheet_to_json(sheet, { range: 1, defval: null, raw: true });
const s = (value) => value == null ? "" : String(value).trim();
const n = (value) => typeof value === "number" && Number.isFinite(value) ? value : Number(value);
const definitions = {};
const metadata = {};

for (const row of rows) {
  const type = s(row.TYPE);
  if (!type) continue;
  if (!definitions[type]) definitions[type] = [];
  const component = s(row["ITEM NAME"]);
  if (!component) {
    metadata[type] = {
      cabinet: s(row.CABINET),
      quantity: Number.isFinite(n(row.QUANTITY)) ? n(row.QUANTITY) : null,
      uom: s(row.UOM),
    };
    continue;
  }
  const qty = n(row.QUANTITY);
  if (!Number.isFinite(qty)) throw new Error(`${type}: ${component} has no valid quantity.`);
  definitions[type].push({ component, qty, uom: s(row.UOM) || "PCS" });
}

for (const [type, components] of Object.entries(definitions)) {
  if (!components.length) throw new Error(`${type} has no component rows.`);
}
const payload = {
  schemaVersion: 1,
  source: `${path.basename(sourcePath)} / pack`,
  generatedAt: new Date().toISOString(),
  packCount: Object.keys(definitions).length,
  metadata,
  definitions,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${payload.packCount} hardware packs to ${outputPath}`);
