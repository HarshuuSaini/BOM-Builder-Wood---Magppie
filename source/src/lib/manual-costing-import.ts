import XLSX from "xlsx-js-style";

export type ManualCostingRow = {
  id: number;
  category: string;
  item: string;
  brand: string;
  itemCode: string;
  unit: string;
  quantity: number;
  rate: number;
};

export type ManualCostingImport = {
  sourceName: string;
  sets: number;
  rows: ManualCostingRow[];
  areaSqft?: number;
  extraCharges: { id: number; label: string; amount: number }[];
};

const cellText = (value: unknown) => String(value ?? "").trim();
const cellNumber = (value: unknown) => {
  if (typeof value === "number") return value;
  const parsed = Number(cellText(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
};

export function parseManualCosting(data: ArrayBuffer, sourceName: string): ManualCostingImport {
  const workbook = XLSX.read(data, { type: "array" });
  const worksheet = workbook.Sheets["KITCHEN"] ?? workbook.Sheets["Manual Comparison"] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) throw new Error("The costing workbook has no readable sheet.");
  const cells = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", raw: true });
  const headerIndex = cells.findIndex((row) => cellText(row[2]).toLowerCase() === "material description" &&
    /qty/i.test(cellText(row[6])));
  if (headerIndex < 0) throw new Error("Expected a costing sheet with Material Description, Rate, Unit and Qty columns.");

  let sets = 1;
  for (const row of cells) {
    if (/^sets$/i.test(cellText(row[6])) && cellNumber(row[7]) > 0) {
      sets = cellNumber(row[7]);
      break;
    }
  }
  if (sets === 1) {
    const title = cells.slice(0, headerIndex).flat().map(cellText).join(" ");
    const match = title.match(/\b(\d+(?:\.\d+)?)\s*sets?\b/i);
    if (match) sets = Number(match[1]);
  }
  if (!Number.isFinite(sets) || sets <= 0) throw new Error("The kitchen set count is invalid.");

  const rows: ManualCostingRow[] = [];
  for (const row of cells.slice(headerIndex + 1)) {
    const serial = cellText(row[0]);
    if (!serial || !Number.isInteger(cellNumber(serial)) || cellNumber(serial) < 1) continue;
    const item = cellText(row[2]);
    const quantity = cellNumber(row[6]);
    const rate = cellNumber(row[4]);
    if (!item || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(rate) || rate < 0) continue;
    rows.push({ id: rows.length + 1, category: cellText(row[1]), item,
      brand: worksheet === workbook.Sheets["KITCHEN"] ? cellText(row[3]) : "",
      itemCode: worksheet === workbook.Sheets["Manual Comparison"] ? cellText(row[3]) : "",
      unit: cellText(row[5]), quantity: quantity / sets, rate });
  }
  if (!rows.length) throw new Error("No costing items were found. Check that the workbook has an item table.");
  const areaLine = cells.find((row) => /\bSFT\b/i.test(cellText(row[6])) && cellNumber(row[7]) > 0);
  const extraCharges = cells.flatMap((row) => {
    const label = cellText(row[2]);
    const amount = cellNumber(row[7]);
    return /^(Installation|Transportation|Loading(?:\s*\/\s*Unloading)?)$/i.test(label) && Number.isFinite(amount) && amount >= 0
      ? [{ id: 0, label, amount }] : [];
  }).map((charge, index) => ({ ...charge, id: index + 1 }));
  return { sourceName, sets, rows,
    areaSqft: areaLine ? cellNumber(areaLine[7]) : undefined, extraCharges };
}
