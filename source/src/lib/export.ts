import * as XLSX from "xlsx-js-style";
import { groupLabel, resolveSku, statusLabel } from "@/lib/stock";
import type { BomReportRow } from "@/lib/types";

export type AccessoryExportRow = {
  SO: string;
  "Carcass Items": string;
  Accessory: string;
  Selected: string;
  "Item Name": string;
  Size: string;
  Elevation: string;
  Total: number | string;
  "Actual Qty": number | string;
  "Zoho Item ID": string;
};

export type ProjectSetupRow = { "Record Type": string; Data: string };

export type CostingExportDetail = {
  category: string; itemCode: string; item: string; specification: string;
  netQty: number; wastePct: number; billableQty: number;
  uom: string; rate: number; amount: number;
};
export type CostingExportLine = {
  label: string; code?: string; qty: number; unitCost: number; cost: number;
  details: CostingExportDetail[];
};
export type CostingExportArea = { eachSqft: number; sqft: number };
export type CostingExportPricing = {
  cabinetSqft: number; baseCost: number; conversion: number; profit: number;
  transportation: number; installation: number; loading: number;
  subtotal: number; tax: number; grandTotal: number;
};

const COLS_FULL = [
  { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 6 }, { wch: 40 }, { wch: 18 },
  { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 14 },
  { wch: 10 }, { wch: 9 }, { wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 9 },
  { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 14 }, { wch: 14 },
];
const COLS_OOS = [
  { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 32 }, { wch: 32 }, { wch: 18 },
  { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 14 },
  { wch: 10 }, { wch: 9 }, { wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 9 },
  { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 14 },
];
const COLS_OPTI = [
  { wch: 16 }, { wch: 16 }, { wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 9 },
  { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 10 }, { wch: 14 },
];
const COLS_SF = [
  { wch: 16 }, { wch: 36 }, { wch: 20 }, { wch: 10 }, { wch: 36 },
  { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 20 },
];

function sheetName(value: string): string {
  return String(value).replace(/[:\\/?*[\]]/g, "").slice(0, 31);
}

function addSheet<T extends Record<string, unknown>>(
  workbook: XLSX.WorkBook,
  rows: T[],
  name: string,
  cols: Array<{ wch: number }>,
) {
  if (!rows.length) return;
  const cleaned = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!key.startsWith("_")) out[key] = value;
    }
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(cleaned);
  ws["!cols"] = cols;
  XLSX.utils.book_append_sheet(workbook, ws, sheetName(name));
}

function parseSlabArea(itemName: string): number {
  const match = itemName.match(/(\d{3,4})\s*[xX]\s*(\d{3,4})/);
  if (match) {
    const h = parseFloat(match[1]);
    const w = parseFloat(match[2]);
    return (h * w) / (304.8 * 304.8);
  }
  return 0;
}

type FullBomExport = {
  SO: string;
  "Main Group": string;
  "Sub Group": string;
  Level: number;
  Item: string;
  SKU: string;
  Type: string;
  Height: string;
  Width: string;
  Depth: string;
  Thickness: string;
  Finish: string;
  Grain: string;
  "CF Type": string;
  "Profile Code": string;
  "SO Qty": number;
  "Waste %": number;
  "Actual Qty": number;
  Pcs: number | string;
  "In Stock": number;
  "Eff. Stock": number;
  Deficit: number;
  Unit: string;
  Status: string;
  _underProfile: boolean;
  _type: string;
};

function fullBomRows(rows: BomReportRow[]): FullBomExport[] {
  return rows.map((row) => {
    const isBoard = row.itemName.toLowerCase().includes("board") ||
                    (row.cfGroup && row.cfGroup.toLowerCase().includes("board")) ||
                    (row.masterGroup && row.masterGroup.toLowerCase().includes("board"));
    let pcs: number | string = "-";
    if (isBoard) {
      const slabArea = parseSlabArea(row.itemName);
      if (slabArea > 0) {
        pcs = Math.round((row.actualQuantity / slabArea) * 100) / 100;
      } else {
        pcs = "";
      }
    }
    return {
      SO: row.sourceOrderNumber,
      "Main Group": groupLabel(row.masterGroup && row.masterGroup !== "__other__" ? row.masterGroup : row.cfGroup),
      "Sub Group": groupLabel(row.cfGroup),
      Level: row.level,
      Item: "  ".repeat(row.level) + row.itemName,
      SKU: resolveSku(row.sku, row.itemName),
      Type: extractSideType(row.itemName),
      Height: row.cfHeight,
      Width: row.cfWidth,
      Depth: row.cfDepth,
      Thickness: row.cfThickness,
      Finish: row.cfFinish,
      Grain: "",
      "CF Type": row.cfType,
      "Profile Code": extractProfileCode(row.itemName),
      "SO Qty": row.quantityNeeded,
      "Waste %": row.wastePercent,
      "Actual Qty": row.actualQuantity,
      Pcs: pcs,
      "In Stock": row.rawStock,
      "Eff. Stock": row.effectiveStock,
      Deficit: row.deficit,
      Unit: row.unit,
      Status: statusLabel(row.status),
      _underProfile: row.underProfile,
      _type: row.rowType,
    };
  });
}

type OosExport = {
  SO: string;
  "Main Group": string;
  "Sub Group": string;
  "BOM Path": string;
  Item: string;
  SKU: string;
  Type: string;
  Height: string;
  Width: string;
  Depth: string;
  Thickness: string;
  Finish: string;
  Grain: string;
  "CF Type": string;
  "Profile Code": string;
  "SO Qty": number;
  "Waste %": number;
  "Actual Qty": number;
  Pcs: number | string;
  "In Stock": number;
  Deficit: number;
  Unit: string;
  _underProfile: boolean;
};

function oosLeafRows(rows: BomReportRow[]): OosExport[] {
  return rows
    .filter((row) => row.rowType !== "master" && row.deficit > 0)
    .map((row) => {
      const isBoard = row.itemName.toLowerCase().includes("board") ||
                      (row.cfGroup && row.cfGroup.toLowerCase().includes("board")) ||
                      (row.masterGroup && row.masterGroup.toLowerCase().includes("board"));
      let pcs: number | string = "-";
      if (isBoard) {
        const slabArea = parseSlabArea(row.itemName);
        if (slabArea > 0) {
          pcs = Math.round((row.actualQuantity / slabArea) * 100) / 100;
        } else {
          pcs = "";
        }
      }
      return {
        SO: row.sourceOrderNumber,
        "Main Group": groupLabel(row.masterGroup && row.masterGroup !== "__other__" ? row.masterGroup : row.cfGroup),
        "Sub Group": groupLabel(row.cfGroup),
        "BOM Path": "",
        Item: row.itemName,
        SKU: resolveSku(row.sku, row.itemName),
        Type: extractSideType(row.itemName),
        Height: row.cfHeight,
        Width: row.cfWidth,
        Depth: row.cfDepth,
        Thickness: row.cfThickness,
        Finish: row.cfFinish,
        Grain: "",
        "CF Type": row.cfType,
        "Profile Code": extractProfileCode(row.itemName),
        "SO Qty": row.quantityNeeded,
        "Waste %": row.wastePercent,
        "Actual Qty": row.actualQuantity,
        Pcs: pcs,
        "In Stock": row.effectiveStock,
        Deficit: row.deficit,
        Unit: row.unit,
        _underProfile: row.underProfile,
      };
    });
}

function consolidateOos(rows: OosExport[]): OosExport[] {
  const order: string[] = [];
  const map = new Map<string, OosExport & { _soSet: Set<string>; _pathSet: Set<string> }>();

  rows.forEach((row) => {
    const key = row.SKU && row.SKU !== "-" && row.SKU !== "" ? row.SKU : row.Item;
    const existing = map.get(key);
    if (!existing) {
      order.push(key);
      map.set(key, {
        ...row,
        _soSet: new Set(row.SO ? [row.SO] : []),
        _pathSet: new Set(row["BOM Path"] ? [row["BOM Path"]] : []),
      });
    } else {
      if (row.SO) existing._soSet.add(row.SO);
      if (row["BOM Path"]) existing._pathSet.add(row["BOM Path"]);
      existing["SO Qty"] += row["SO Qty"];
      existing["Actual Qty"] += row["Actual Qty"];
    }
  });

  return order.map((key) => {
    const value = map.get(key)!;
    const deficit = Math.max(0, value["Actual Qty"] - value["In Stock"]);
    const { _soSet, _pathSet, ...rest } = value;

    const isBoard = value.Item.toLowerCase().includes("board") ||
                    (value["Sub Group"] && value["Sub Group"].toLowerCase().includes("board")) ||
                    (value["Main Group"] && value["Main Group"].toLowerCase().includes("board"));
    let pcs: number | string = "-";
    if (isBoard) {
      const slabArea = parseSlabArea(value.Item);
      if (slabArea > 0) {
        pcs = Math.round((value["Actual Qty"] / slabArea) * 100) / 100;
      } else {
        pcs = "";
      }
    }

    return {
      ...rest,
      SO: Array.from(_soSet).join(", "),
      "BOM Path": Array.from(_pathSet).join(" | "),
      Pcs: pcs,
      Deficit: deficit,
    };
  });
}

type OptiExport = {
  SO: string;
  "Main Group": string;
  Group: string;
  "Item Name": string;
  "Profile Code": string;
  Type: string;
  Length: string;
  Width: string;
  "Min Q.": number;
  Thickness: string;
  Grain: string;
  Finish: string;
};

function extractSideType(name: string): string {
  const setMatch = name.match(/(LH\([^\)]+\)\s*\+\s*RH\([^\)]+\)|LH\([^\)]+\)|RH\([^\)]+\)|TP\([^\)]+\)\s*\+\s*BT\([^\)]+\)|TP\([^\)]+\)|BT\([^\)]+\))/i);
  if (setMatch) return setMatch[1];

  if (/\b(LH\/RH|LH\+RH)\b/i.test(name)) return "LH/RH";
  if (/\b(TP\/BT|TP\+BT|Top\/Bottom)\b/i.test(name)) return "TP/BT";

  if (/\b(LH|LHS)\b/i.test(name)) return "LH";
  if (/\b(RH|RHS)\b/i.test(name)) return "RH";
  if (/\b(TP|Top)\b/i.test(name)) return "TP";
  if (/\b(BT|Bottom)\b/i.test(name)) return "BT";

  return "-";
}

function extractProfileCode(itemName: string): string {
  const upper = itemName.toUpperCase();
  if (upper.includes("SLF") || upper.includes("HM-511") || upper.includes("HM511")) return "SLF";
  if (upper.includes("STP") || upper.includes("HM-509") || upper.includes("HM509")) return "STP";
  if (upper.includes("SINK") || upper.includes("HM-510") || upper.includes("HM510")) return "SINK";
  if (upper.includes("ELEN") || upper.includes("HM-519") || upper.includes("HM519")) return "ELEN";
  if (upper.includes("DBS") || upper.includes("HM-513") || upper.includes("HM513")) return "DBS";
  if (upper.includes("DBC") || upper.includes("HM-535") || upper.includes("HM535")) return "DBC";
  if (upper.includes("MD1")) return "MD1";
  if (upper.includes("MD2")) return "MD2";
  if (upper.includes("CL1")) return "CL1";
  if (upper.includes("CL2")) return "CL2";
  if (upper.includes("CM1")) return "CM1";
  if (upper.includes("CM2")) return "CM2";
  if (upper.includes("NEON")) return "NEON";

  const lastDash = itemName.lastIndexOf("-");
  if (lastDash >= 3) {
    return itemName.substring(lastDash - 3, lastDash).toUpperCase();
  }
  return "";
}

const OPTI_SUB_GROUPS = ["profile", "panels- sh", "panels- cab"];

function optiRowsFromOos(consolidated: OosExport[]): OptiExport[] {
  return consolidated.filter((row) => {
    const sg = (row["Sub Group"] || "").toLowerCase();
    return OPTI_SUB_GROUPS.some((g) => sg === g);
  }).map((row) => ({
    SO: row.SO,
    "Main Group": row["Main Group"],
    Group: row["Sub Group"],
    "Item Name": resolveSku(row.SKU, row.Item),
    "Profile Code": extractProfileCode(row.Item),
    Type: row["CF Type"],
    Length: row.Height,
    Width: row.Width,
    "Min Q.": row.Deficit || 0,
    Thickness: row.Thickness,
    Grain: "",
    Finish: row.Finish,
  }));
}

const ROW_TYPE_FILLS: Record<string, { fgColor: { rgb: string } }> = {
  master:    { fgColor: { rgb: "FFF1DD" } },
  sub_bom:   { fgColor: { rgb: "EEF4FB" } },
  component: { fgColor: { rgb: "D6EAF8" } },
  plain:     { fgColor: { rgb: "F3F0FC" } },
};

function applyFullBomColors(ws: XLSX.WorkSheet, data: FullBomExport[]) {
  const typeColIdx = Object.keys(data[0]).filter((k) => !k.startsWith("_")).indexOf("Type");
  if (typeColIdx < 0) return;
  const colCount = Object.keys(data[0]).filter((k) => !k.startsWith("_")).length;

  for (let r = 0; r < data.length; r++) {
    const fill = ROW_TYPE_FILLS[data[r]._type];
    if (!fill) continue;
    const excelRow = r + 2;
    for (let c = 0; c < colCount; c++) {
      const addr = XLSX.utils.encode_cell({ r: excelRow - 1, c });
      if (!ws[addr]) ws[addr] = { v: "", t: "s" };
      ws[addr].s = { fill: { patternType: "solid", ...fill } };
    }
  }
}

export function exportBomWorkbook(rows: BomReportRow[], accessories: AccessoryExportRow[], projectSetup: ProjectSetupRow[] = []) {
  const workbook = XLSX.utils.book_new();

  const bomData = fullBomRows(rows);
  addSheet(workbook, bomData, "Full BOM", COLS_FULL);
  const bomSheet = workbook.Sheets["Full BOM"];
  if (bomSheet && bomData.length) applyFullBomColors(bomSheet, bomData);

  const consolidated = consolidateOos(oosLeafRows(rows));
  addSheet(workbook, consolidated, "Out of Stock", COLS_OOS);

  addSheet(workbook, optiRowsFromOos(consolidated), "Opti", COLS_OPTI);

  if (accessories.length) addSheet(workbook, accessories, "Accessories", COLS_SF);

  if (projectSetup.length) addSheet(workbook, projectSetup, "Project Setup", [{ wch: 20 }, { wch: 100 }]);

  XLSX.writeFile(workbook, `BOM_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** Export the same calculated rows shown in Costing, with a separate item roll-up. */
export function exportCostingWorkbook(
  lines: CostingExportLine[],
  cabinetAreas: CostingExportArea[],
  pricing: CostingExportPricing,
  unpriced: string[],
) {
  if (!lines.length) return;
  const workbook = XLSX.utils.book_new();
  const summary: Array<{
    "Cabinet / item": string; "Cabinet code": string; Qty: number | string;
    "Sqft / cabinet": number | string; "Total cabinet sqft": number | string;
    "Cost / cabinet (Rs)": number | string; "Total cost (Rs)": number;
    "Cost / cabinet sqft (Rs)": number | string;
  }> = lines.map((line, index) => {
    const area = cabinetAreas[index];
    return {
      "Cabinet / item": line.label,
      "Cabinet code": line.code ?? "",
      Qty: line.qty,
      "Sqft / cabinet": area?.eachSqft ?? "",
      "Total cabinet sqft": area?.sqft ?? "",
      "Cost / cabinet (Rs)": line.unitCost,
      "Total cost (Rs)": line.cost,
      "Cost / cabinet sqft (Rs)": area?.sqft ? line.cost / area.sqft : "",
    };
  });
  summary.push({
    "Cabinet / item": "Project item costing total", "Cabinet code": "", Qty: "",
    "Sqft / cabinet": "", "Total cabinet sqft": pricing.cabinetSqft,
    "Cost / cabinet (Rs)": "", "Total cost (Rs)": pricing.baseCost,
    "Cost / cabinet sqft (Rs)": pricing.cabinetSqft ? pricing.baseCost / pricing.cabinetSqft : "",
  });
  addSheet(workbook, summary, "Cabinet Summary", [
    { wch: 54 }, { wch: 64 }, { wch: 9 }, { wch: 17 }, { wch: 20 },
    { wch: 21 }, { wch: 21 }, { wch: 25 },
  ]);

  const detailRows = lines.flatMap((line, index) => line.details.map((detail) => ({
    "Cabinet / item": line.label,
    "Cabinet code": line.code ?? "",
    "Cabinet qty": line.qty,
    "Cabinet sqft": cabinetAreas[index]?.sqft ?? "",
    Category: detail.category,
    "Item code": detail.itemCode,
    "Actual item": detail.item,
    Specification: detail.specification,
    "Net qty": detail.netQty,
    "Waste %": detail.wastePct,
    "Billable qty": detail.billableQty,
    Basis: detail.uom,
    "Rate (Rs / basis)": detail.rate,
    "Amount (Rs)": detail.amount,
    "Cost / cabinet sqft (Rs)": cabinetAreas[index]?.sqft ? detail.amount / cabinetAreas[index].sqft : "",
  })));
  addSheet(workbook, detailRows, "Cabinet Items", [
    { wch: 54 }, { wch: 64 }, { wch: 13 }, { wch: 16 }, { wch: 22 },
    { wch: 18 }, { wch: 65 }, { wch: 46 }, { wch: 13 }, { wch: 12 },
    { wch: 15 }, { wch: 11 }, { wch: 20 }, { wch: 18 }, { wch: 27 },
  ]);

  const consolidated = new Map<string, {
    Category: string; "Item code": string; "Actual item": string;
    "Net qty": number; "Waste %": number; "Billable qty": number;
    Basis: string; "Rate (Rs / basis)": number; "Amount (Rs)": number;
    "Cost lines": number;
  }>();
  lines.forEach((line) => line.details.forEach((detail) => {
    const key = JSON.stringify([detail.itemCode, detail.item, detail.uom, detail.rate, detail.wastePct]);
    const row = consolidated.get(key);
    if (row) {
      row["Net qty"] += detail.netQty;
      row["Billable qty"] += detail.billableQty;
      row["Amount (Rs)"] += detail.amount;
      row["Cost lines"] += 1;
      if (!row.Category.split(", ").includes(detail.category)) row.Category += `, ${detail.category}`;
    } else consolidated.set(key, {
      Category: detail.category,
      "Item code": detail.itemCode,
      "Actual item": detail.item,
      "Net qty": detail.netQty,
      "Waste %": detail.wastePct,
      "Billable qty": detail.billableQty,
      Basis: detail.uom,
      "Rate (Rs / basis)": detail.rate,
      "Amount (Rs)": detail.amount,
      "Cost lines": 1,
    });
  }));
  addSheet(workbook, [...consolidated.values()], "Consolidated Items", [
    { wch: 30 }, { wch: 18 }, { wch: 65 }, { wch: 15 }, { wch: 12 },
    { wch: 17 }, { wch: 11 }, { wch: 20 }, { wch: 18 }, { wch: 22 },
  ]);

  addSheet(workbook, [
    { Factor: "Cabinet front area (sqft)", Value: pricing.cabinetSqft },
    { Factor: "Base item cost (Rs)", Value: pricing.baseCost },
    { Factor: "Conversion (Rs)", Value: pricing.conversion },
    { Factor: "Profit (Rs)", Value: pricing.profit },
    { Factor: "Transportation (Rs)", Value: pricing.transportation },
    { Factor: "Installation (Rs)", Value: pricing.installation },
    { Factor: "Loading / Unloading (Rs)", Value: pricing.loading },
    { Factor: "Subtotal (Rs)", Value: pricing.subtotal },
    { Factor: "GST (Rs)", Value: pricing.tax },
    { Factor: "Project total (Rs)", Value: pricing.grandTotal },
  ], "Project Pricing", [{ wch: 36 }, { wch: 20 }]);

  if (unpriced.length) addSheet(workbook, unpriced.map((item) => ({
    "Unpriced item": item, Status: "Rate not set; excluded from costing",
  })), "Unpriced Items", [{ wch: 75 }, { wch: 42 }]);

  XLSX.writeFile(workbook, `Costing_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportBomCsv(rows: BomReportRow[]) {
  const data = fullBomRows(rows);
  if (!data.length) return;
  const headers = Object.keys(data[0]).filter((key) => !key.startsWith("_"));
  const lines = data.map((row) =>
    headers
      .map((header) => {
        const value = (row as Record<string, unknown>)[header];
        return `"${String(value ?? "").replace(/"/g, '""')}"`;
      })
      .join(","),
  );
  const blob = new Blob([[headers.join(",")].concat(lines).join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `BOM_Report_${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
