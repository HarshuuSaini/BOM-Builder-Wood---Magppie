import * as XLSX from "xlsx-js-style";
import { groupLabel, resolveSku, statusLabel } from "@/lib/stock";
import type { BomReportRow } from "@/lib/types";
import { purchaseTotals, type PurchaseTotal } from "@/lib/purchase-rounding";

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
  allocatedBillableQty?: number;
};
export type CostingExportLine = {
  label: string; code?: string; qty: number; unitCost: number; cost: number;
  details: CostingExportDetail[];
};
export type CostingExportArea = { eachSqft: number; sqft: number };
export type CostingExportPricing = {
  cabinetSqft: number; fillerSqft: number; counterPlySqft: number; totalSqft: number;
  baseCost: number; conversion: number; profit: number;
  transportation: number; installation: number; loading: number;
  subtotal: number; tax: number; grandTotal: number;
};
export type CostingExportFactors = {
  conversionPct: number | ""; profitPct: number | "";
  transportation: { mode: "sqft" | "direct"; value: number | "" };
  installation: { mode: "sqft" | "direct"; value: number | "" };
  loading: { mode: "sqft" | "direct"; value: number | "" };
  includeTax: boolean;
};

export type BulkCostingKitchen = {
  name: string;
  areaSqft: number;
  materialCost: number;
  conversion: number;
  profit: number;
  transportation: number;
  installation: number;
  loading: number;
  tax: number;
  total: number;
  items: Array<{ category: string; itemCode: string; item: string; unit: string; quantity: number; rate: number; amount: number }>;
  unpriced: string[];
};

function kitchenPricingColor(index: number, lightness: number): string {
  const hue = (index * 137.508 + 165) % 360;
  const saturation = 0.48;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue / 60;
  const second = chroma * (1 - Math.abs(sector % 2 - 1));
  const offset = lightness - chroma / 2;
  const channels = sector < 1 ? [chroma, second, 0] : sector < 2 ? [second, chroma, 0]
    : sector < 3 ? [0, chroma, second] : sector < 4 ? [0, second, chroma]
      : sector < 5 ? [second, 0, chroma] : [chroma, 0, second];
  return channels.map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Side-by-side quantities, kitchen-specific rates and amounts, following the supplied costing layout. */
export function exportBulkCostingWorkbook(kitchens: BulkCostingKitchen[]) {
  if (!kitchens.length || kitchens.some((kitchen) => !kitchen.name.trim())) throw new Error("Name every kitchen before downloading the bulk costing.");
  const workbook = XLSX.utils.book_new();
  const items = new Map<string, { category: string; itemCode: string; item: string; unit: string }>();
  const kitchenItems = kitchens.map((kitchen) => {
    const occurrences = new Map<string, number>();
    return new Map<string, BulkCostingKitchen["items"][number]>(kitchen.items.map((item) => {
      const base = JSON.stringify([item.category, item.itemCode, item.item, item.unit]);
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      const key = JSON.stringify([base, occurrence]);
      items.set(key, item);
      return [key, item] as const;
    }));
  });
  const sorted = [...items.entries()].sort((a, b) => a[1].category.localeCompare(b[1].category) || a[1].item.localeCompare(b[1].item));
  const rows: (string | number | XLSX.CellObject)[][] = [
    ["KITCHEN COSTING - COMBINED"],
    ["", "", "", ...kitchens.flatMap((kitchen) => [kitchen.name, "", ""])],
    ["", "", "Area (sqft)", ...kitchens.flatMap((kitchen) => [kitchen.areaSqft, "", ""])],
    ["Category", "Material Description", "Unit", ...kitchens.flatMap(() => ["Rate (Rs)", "Qty. Req.", "Total Rate (Rs)"])],
  ];
  sorted.forEach(([key, item], index) => {
    const row = index + 5;
    const kitchenCells = kitchenItems.flatMap((lookup, kitchenIndex): Array<string | number | XLSX.CellObject> => {
      const matched = lookup.get(key);
      const rateCol = XLSX.utils.encode_col(3 + kitchenIndex * 3);
      const qtyCol = XLSX.utils.encode_col(4 + kitchenIndex * 3);
      return matched ? [matched.rate, matched.quantity, { f: `${rateCol}${row}*${qtyCol}${row}`, t: "n" as const, v: matched.amount }] : ["", "", ""];
    });
    rows.push([item.category, item.item, item.unit, ...kitchenCells]);
  });
  const totalRow = rows.length + 1;
  rows.push(["", "Material / item total", "", ...kitchens.flatMap((kitchen, index) => ["", "", {
    f: `SUM(${XLSX.utils.encode_col(5 + index * 3)}5:${XLSX.utils.encode_col(5 + index * 3)}${totalRow - 1})`, t: "n" as const, v: kitchen.materialCost,
  }])]);
  const extraRows: Array<[string, keyof Pick<BulkCostingKitchen, "conversion" | "profit" | "transportation" | "installation" | "loading" | "tax">]> = [
    ["Conversion", "conversion"], ["Profit", "profit"], ["Transportation", "transportation"],
    ["Installation", "installation"], ["Loading / Unloading", "loading"], ["GST", "tax"],
  ];
  extraRows.forEach(([label, field]) => rows.push(["", label, "", ...kitchens.flatMap((kitchen) => ["", "", kitchen[field]])]));
  const finalRow = rows.length + 1;
  rows.push(["", "Total Cost", "", ...kitchens.flatMap((kitchen, index) => {
    const column = XLSX.utils.encode_col(5 + index * 3);
    return ["", "", { f: `SUM(${column}${totalRow}:${column}${finalRow - 1})`, t: "n" as const, v: kitchen.total }];
  })]);
  rows.push(["", "Cost per sqft", "", ...kitchens.flatMap((kitchen, index) => {
    const totalCol = XLSX.utils.encode_col(5 + index * 3);
    const areaCol = XLSX.utils.encode_col(3 + index * 3);
    return ["", "", { f: `IF(${areaCol}3=0,0,${totalCol}${finalRow}/${areaCol}3)`, t: "n" as const, v: kitchen.areaSqft ? kitchen.total / kitchen.areaSqft : 0 }];
  })]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 24 }, { wch: 72 }, { wch: 16 }, ...kitchens.flatMap(() => [{ wch: 16 }, { wch: 16 }, { wch: 19 }])];
  sheet["!freeze"] = { xSplit: 3, ySplit: 4 };
  sheet["!merges"] = kitchens.map((_, index) => ({ s: { r: 1, c: 3 + index * 3 }, e: { r: 1, c: 5 + index * 3 } }));
  const lastRow = rows.length;
  const lastCol = 3 + kitchens.length * 3;
  for (let row = 1; row <= lastRow; row++) {
    for (let col = 0; col < lastCol; col++) {
      const address = XLSX.utils.encode_cell({ r: row - 1, c: col });
      const cell = sheet[address] ?? (sheet[address] = { t: "s", v: "" });
      const kitchenIndex = col >= 3 ? Math.floor((col - 3) / 3) : -1;
      const heading = row <= 4;
      const summary = row >= totalRow;
      cell.s = {
        fill: { patternType: "solid", fgColor: { rgb: kitchenIndex >= 0
          ? kitchenPricingColor(kitchenIndex, row === 2 || row === 4 || summary ? 0.80 : 0.94)
          : heading ? "E8EFEB" : summary ? "F2F5F3" : "FFFFFF" } },
        font: { name: "Arial", sz: 10, bold: heading || summary, color: { rgb: "1B302B" } },
        alignment: { vertical: "center", horizontal: row === 2 || row === 4 ? "center" : col >= 3 ? "right" : "left" },
        numFmt: typeof cell.v === "number" || cell.f ? "#,##0.00" : undefined,
      };
    }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, "Combined Costing");
  const unpriced = kitchens.flatMap((kitchen) => kitchen.unpriced.map((item) => ({ Kitchen: kitchen.name, "Unpriced item": item })));
  if (unpriced.length) addSheet(workbook, unpriced, "Unpriced Items", [{ wch: 28 }, { wch: 75 }]);
  XLSX.writeFile(workbook, `Combined_Kitchen_Costing_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

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
  for (const [address, cell] of Object.entries(ws)) {
    if (!address.startsWith("!") && cell.t === "n") cell.z = "#,##0.00";
  }
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

export function exportBomWorkbook(rows: BomReportRow[], accessories: AccessoryExportRow[], projectSetup: ProjectSetupRow[] = [], purchases: PurchaseTotal[] = []) {
  const workbook = XLSX.utils.book_new();

  const bomData = fullBomRows(rows);
  addSheet(workbook, bomData, "Full BOM", COLS_FULL);
  const bomSheet = workbook.Sheets["Full BOM"];
  if (bomSheet && bomData.length) applyFullBomColors(bomSheet, bomData);

  const consolidated = consolidateOos(oosLeafRows(rows));
  addSheet(workbook, consolidated, "Out of Stock", COLS_OOS);

  addSheet(workbook, optiRowsFromOos(consolidated), "Opti", COLS_OPTI);

  if (accessories.length) addSheet(workbook, accessories, "Accessories", COLS_SF);
  if (purchases.length) addSheet(workbook, purchases.map(item => ({
    "Item code": item.itemCode, Item: item.item, Category: item.categories.join(", "),
    Unit: item.unit, "Purchase qty": item.quantity,
  })), "Purchase Quantities", [{ wch: 25 }, { wch: 65 }, { wch: 35 }, { wch: 12 }, { wch: 18 }]);

  if (projectSetup.length) addSheet(workbook, projectSetup, "Project Setup", [{ wch: 20 }, { wch: 100 }]);

  XLSX.writeFile(workbook, `BOM_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** Export the same calculated rows shown in Costing, with a separate item roll-up. */
export function exportCostingWorkbook(
  lines: CostingExportLine[],
  cabinetAreas: CostingExportArea[],
  pricing: CostingExportPricing,
  unpriced: string[],
  factors: CostingExportFactors,
  kitchenName: string,
) {
  if (!lines.length) return;
  if (!kitchenName.trim()) throw new Error("Enter the kitchen name before downloading costing.");
  const workbook = XLSX.utils.book_new();
  const purchases = purchaseTotals(lines.flatMap(line => line.details));
  const purchaseRowByKey = new Map(purchases.map((item, index) => [item.key, index + 2]));
  const sourceFactor = (unit: string) => unit === "sheet" ? 32 : unit === "kg" ? 1000 : 1;
  const purchaseRows = purchases.map((item) => {
    const factor = sourceFactor(item.unit);
    return { item, factor, requiredSourceQty: item.requiredQty * factor, sourceRate: item.rate / factor };
  });
  const manualItems = purchaseRows.map(({ item }) => ({ key: item.key, elevation: item.categories.join(", ").toUpperCase(),
    description: item.item, code: item.itemCode, rate: item.rate, unit: item.unit, qty: item.quantity }));
  const manualRows: (string | number | XLSX.CellObject)[][] = [
    [`KITCHEN COSTING - ${kitchenName.trim()}`],
    ["Cabinet + filler + Counter Ply area (sqft)", pricing.totalSqft, "Total cabinets", lines.filter((line) => !!line.code).reduce((total, line) => total + line.qty, 0)],
    ["Edit quantities, conversion factors and rates on Consolidated Items; edit project factors on Project Pricing. This comparison and its totals recalculate from those inputs."],
    ["Sr. No.", "Elevation", "Material Description", "Item code", "Rate (Rs)", "Unit of Mnt.", "Qty. Req.", "Total Rate (Rs)"],
  ];
  manualItems.sort((a, b) => a.elevation.localeCompare(b.elevation) || a.description.localeCompare(b.description))
    .forEach((item, index) => {
      const row = index + 5;
      const purchaseRow = purchaseRowByKey.get(item.key)!;
      manualRows.push([index + 1, item.elevation, item.description, item.code,
        { f: `'Consolidated Items'!K${purchaseRow}`, t: "n", v: item.rate }, item.unit,
        { f: `'Consolidated Items'!H${purchaseRow}`, t: "n", v: item.qty },
        { f: `E${row}*G${row}`, t: "n", v: item.rate * item.qty }]);
    });
  const lastItemRow = manualRows.length;
  const summaryStart = lastItemRow + 1;
  manualRows.push(["", "", "", "", "", "", "Material / item cost", { f: `SUM(H5:H${lastItemRow})`, t: "n", v: pricing.baseCost }]);
  const extraCosts: Array<[string, number, number]> = [
    ["Conversion", pricing.conversion, 7], ["Profit", pricing.profit, 9],
    ["Transportation", pricing.transportation, 12], ["Installation", pricing.installation, 15],
    ["Loading / Unloading", pricing.loading, 18], ["GST", pricing.tax, 22],
  ];
  extraCosts.forEach(([label, amount, row]) => manualRows.push(["", "", "", "", "", "", label,
    { f: `'Project Pricing'!B${row}`, t: "n", v: amount }]));
  const totalRow = manualRows.length + 1;
  manualRows.push(["", "", "", "", "", "", "Project total", { f: `'Project Pricing'!B23`, t: "n", v: pricing.grandTotal }]);
  manualRows.push(["", "", "", "", "", "", "Cost per total sqft", { f: `IF(B2=0,0,H${totalRow}/B2)`, t: "n", v: pricing.totalSqft ? pricing.grandTotal / pricing.totalSqft : 0 }]);
  const manualSheet = XLSX.utils.aoa_to_sheet(manualRows);
  manualSheet["!cols"] = [{ wch: 9 }, { wch: 27 }, { wch: 72 }, { wch: 25 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 22 }];
  manualSheet["!freeze"] = { xSplit: 0, ySplit: 4 };
  for (let col = 0; col < 8; col++) {
    const address = XLSX.utils.encode_cell({ r: 3, c: col });
    manualSheet[address].s = { fill: { patternType: "solid", fgColor: { rgb: "22685E" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { vertical: "center" } };
  }
  for (let row = 4; row < manualRows.length; row++) {
    for (const col of [4, 6, 7]) {
      const cell = manualSheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell) cell.z = "#,##0.00";
    }
  }
  XLSX.utils.book_append_sheet(workbook, manualSheet, "Manual Comparison");
  let nextDetailRow = 2;
  const detailSpans = lines.map((line) => {
    const start = nextDetailRow;
    nextDetailRow += line.details.length;
    return { start, end: nextDetailRow - 1 };
  });
  const summary: Array<{
    "Cabinet / item": string; "Cabinet code": string; Qty: number | string;
    "Sqft / item": number | string; "Total item sqft": number | string;
    "Cost / item (Rs)": XLSX.CellObject | string;
    "Total cost (Rs)": XLSX.CellObject;
    "Cost / item sqft (Rs)": XLSX.CellObject | string;
  }> = lines.map((line, index) => {
    const area = cabinetAreas[index];
    const row = index + 2;
    const span = detailSpans[index];
    return {
      "Cabinet / item": line.label,
      "Cabinet code": line.code ?? "",
      Qty: line.qty,
      "Sqft / item": area?.eachSqft ?? "",
      "Total item sqft": area?.sqft ?? "",
      "Cost / item (Rs)": { f: `IF(C${row}=0,0,G${row}/C${row})`, t: "n" as const, v: line.unitCost },
      "Total cost (Rs)": { f: span.end >= span.start ? `SUM('Cabinet Items'!O${span.start}:O${span.end})` : "0", t: "n" as const, v: line.cost },
      "Cost / item sqft (Rs)": area?.sqft ? { f: `IF(E${row}=0,0,G${row}/E${row})`, t: "n" as const, v: line.cost / area.sqft } : "",
    };
  });
  summary.push({
    "Cabinet / item": "Project item costing total", "Cabinet code": "", Qty: "",
    "Sqft / item": "", "Total item sqft": pricing.totalSqft,
    "Cost / item (Rs)": "",
    "Total cost (Rs)": { f: `SUM(G2:G${lines.length + 1})`, t: "n" as const, v: pricing.baseCost },
    "Cost / item sqft (Rs)": pricing.totalSqft ? { f: `IF(E${lines.length + 2}=0,0,G${lines.length + 2}/E${lines.length + 2})`, t: "n" as const, v: pricing.baseCost / pricing.totalSqft } : "",
  });
  addSheet(workbook, summary, "Cabinet Summary", [
    { wch: 54 }, { wch: 64 }, { wch: 9 }, { wch: 17 }, { wch: 20 },
    { wch: 21 }, { wch: 21 }, { wch: 25 },
  ]);

  let detailExcelRow = 1;
  const detailRows = lines.flatMap((line, index) => line.details.map((detail) => {
    detailExcelRow += 1;
    const purchaseKey = purchaseTotals([detail])[0].key;
    const purchaseRow = purchaseRowByKey.get(purchaseKey);
    const group = purchases.find((item) => item.key === purchaseKey);
    if (!purchaseRow || !group) throw new Error(`Missing purchase group for ${detail.itemCode}`);
    const area = cabinetAreas[index]?.sqft;
    return {
    "Cabinet / item": line.label,
    "Cabinet code": line.code ?? "",
    "Cabinet qty": line.qty,
    "Item sqft": cabinetAreas[index]?.sqft ?? "",
    Category: detail.category,
    "Item code": detail.itemCode,
    "Actual item": detail.item,
    Specification: detail.specification,
    "Net qty": detail.netQty,
    "Waste %": detail.wastePct,
    "Billable qty": detail.billableQty,
    "Allocated purchase qty": { f: `IF('Consolidated Items'!D${purchaseRow}=0,0,K${detailExcelRow}/'Consolidated Items'!D${purchaseRow}*'Consolidated Items'!H${purchaseRow}*'Consolidated Items'!G${purchaseRow})`, t: "n" as const, v: detail.allocatedBillableQty ?? detail.billableQty },
    Basis: detail.uom,
    "Rate (Rs / basis)": { f: `'Consolidated Items'!J${purchaseRow}`, t: "n" as const, v: detail.rate },
    "Amount (Rs)": { f: `IF('Consolidated Items'!D${purchaseRow}=0,0,K${detailExcelRow}/'Consolidated Items'!D${purchaseRow}*'Consolidated Items'!L${purchaseRow})`, t: "n" as const, v: detail.amount },
    "Cost / item sqft (Rs)": area ? { f: `IF(D${detailExcelRow}=0,0,O${detailExcelRow}/D${detailExcelRow})`, t: "n" as const, v: detail.amount / area } : "",
  }; }));
  addSheet(workbook, detailRows, "Cabinet Items", [
    { wch: 54 }, { wch: 64 }, { wch: 13 }, { wch: 16 }, { wch: 22 },
    { wch: 18 }, { wch: 65 }, { wch: 46 }, { wch: 13 }, { wch: 12 },
    { wch: 15 }, { wch: 11 }, { wch: 20 }, { wch: 18 }, { wch: 27 },
  ]);

  const purchaseSheetRows: (string | number | XLSX.CellObject)[][] = [[
    "Category", "Item code", "Actual item", "Original usage", "Required qty (editable)",
    "Source unit", "Units per purchase", "Purchase qty", "Purchase unit", "Source rate (Rs)",
    "Purchase rate (Rs)", "Amount (Rs)",
  ]];
  purchaseRows.forEach(({ item, factor, requiredSourceQty, sourceRate }, index) => {
    const row = index + 2;
    const sourceUnit = item.unit === "sheet" ? "sqft" : item.unit === "kg" ? "gm" : item.unit;
    const processing = item.categories.some((category) => /processing$/i.test(category));
    purchaseSheetRows.push([
      item.categories.join(", "), item.itemCode, item.item, requiredSourceQty, requiredSourceQty,
      sourceUnit, factor,
      { f: processing ? `E${row}/G${row}` : `ROUND(E${row}/G${row},2)`, t: "n", v: item.quantity }, item.unit, sourceRate,
      { f: `J${row}*G${row}`, t: "n", v: item.rate },
      { f: `H${row}*K${row}`, t: "n", v: item.amount },
    ]);
  });
  const purchaseSheet = XLSX.utils.aoa_to_sheet(purchaseSheetRows);
  purchaseSheet["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 65 }, { wch: 20 }, { wch: 24 },
    { wch: 14 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 22 }, { wch: 20 }];
  purchaseSheet["!freeze"] = { xSplit: 3, ySplit: 1 };
  for (let row = 1; row < purchaseSheetRows.length; row++) {
    for (const col of [3, 4, 6, 7, 9, 10, 11]) {
      purchaseSheet[XLSX.utils.encode_cell({ r: row, c: col })].z = "#,##0.00";
    }
    for (const col of [4, 6, 9]) {
      purchaseSheet[XLSX.utils.encode_cell({ r: row, c: col })].s = { fill: { patternType: "solid", fgColor: { rgb: "FFF1DD" } } };
    }
    if (purchases[row - 1].categories.some((category) => /processing$/i.test(category))) {
      purchaseSheet[XLSX.utils.encode_cell({ r: row, c: 7 })].z = "#,##0.00000";
    }
  }
  XLSX.utils.book_append_sheet(workbook, purchaseSheet, "Consolidated Items");

  const calcCell = (formula: string, value: number): XLSX.CellObject => ({ f: formula, t: "n", v: value });
  const pricingRows: (string | number | XLSX.CellObject)[][] = [
    ["Cabinet front area (sqft)", pricing.cabinetSqft, "Editable area"],
    ["Filler front area (sqft)", pricing.fillerSqft, "Editable area"],
    ["Counter Ply area (sqft)", pricing.counterPlySqft, "Editable area"],
    ["Total priced area (sqft)", calcCell("SUM(B1:B3)", pricing.totalSqft), "Used for per-sqft charges"],
    ["Material / item cost (Rs)", calcCell(`'Manual Comparison'!H${summaryStart}`, pricing.baseCost), "Sum of consolidated item costs"],
    ["Conversion (%)", Number(factors.conversionPct || 0), "Editable percentage"],
    ["Conversion (Rs)", calcCell("B5*B6/100", pricing.conversion)],
    ["Profit (%)", Number(factors.profitPct || 0), "On material cost plus conversion"],
    ["Profit (Rs)", calcCell("(B5+B7)*B8/100", pricing.profit)],
    ["Transportation method", factors.transportation.mode, "Enter direct or sqft"],
    ["Transportation rate / amount", Number(factors.transportation.value || 0), "Rs/sqft or direct Rs"],
    ["Transportation (Rs)", calcCell('IF(B10="sqft",B11*B4,B11)', pricing.transportation)],
    ["Installation method", factors.installation.mode, "Enter direct or sqft"],
    ["Installation rate / amount", Number(factors.installation.value || 0), "Rs/sqft or direct Rs"],
    ["Installation (Rs)", calcCell('IF(B13="sqft",B14*B4,B14)', pricing.installation)],
    ["Loading / Unloading method", factors.loading.mode, "Enter direct or sqft"],
    ["Loading / Unloading rate / amount", Number(factors.loading.value || 0), "Rs/sqft or direct Rs"],
    ["Loading / Unloading (Rs)", calcCell('IF(B16="sqft",B17*B4,B17)', pricing.loading)],
    ["Subtotal before GST (Rs)", calcCell("SUM(B5,B7,B9,B12,B15,B18)", pricing.subtotal)],
    ["Include GST (1=yes, 0=no)", factors.includeTax ? 1 : 0, "Editable switch"],
    ["GST rate (%)", 18, "Editable percentage"],
    ["GST (Rs)", calcCell("B19*B20*B21/100", pricing.tax)],
    ["Project total (Rs)", calcCell("B19+B22", pricing.grandTotal)],
  ];
  const pricingSheet = XLSX.utils.aoa_to_sheet(pricingRows);
  pricingSheet["!cols"] = [{ wch: 38 }, { wch: 22 }, { wch: 38 }];
  const editablePricingRows = new Set([1, 2, 3, 6, 8, 10, 11, 13, 14, 16, 17, 20, 21]);
  for (let row = 1; row <= pricingRows.length; row++) {
    const cell = pricingSheet[`B${row}`];
    if (cell.t === "n") cell.z = "#,##0.00";
    if (editablePricingRows.has(row)) cell.s = { fill: { patternType: "solid", fgColor: { rgb: "FFF1DD" } } };
  }
  XLSX.utils.book_append_sheet(workbook, pricingSheet, "Project Pricing");
  manualSheet.B2 = { f: "'Project Pricing'!B4", t: "n", v: pricing.totalSqft };

  if (unpriced.length) addSheet(workbook, unpriced.map((item) => ({
    "Unpriced item": item, Status: item.includes("(quantity pending)")
      ? "Required hardware; quantity pending; excluded from costing"
      : "Rate not set; excluded from costing",
  })), "Unpriced Items", [{ wch: 75 }, { wch: 42 }]);

  const safeName = kitchenName.trim().replace(/[^a-z0-9 _-]/gi, "").replace(/\s+/g, "_").slice(0, 60);
  XLSX.writeFile(workbook, `Costing_Report_${safeName ? `${safeName}_` : ""}${new Date().toISOString().slice(0, 10)}.xlsx`);
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
