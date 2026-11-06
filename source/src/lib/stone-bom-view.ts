import * as XLSX from "xlsx-js-style";
import type { ProductionInput, ProductionPart } from "@/lib/production-optimizer";
import type { PurchaseTotal } from "@/lib/purchase-rounding";

/** Column contracts from the supplied Stone Builder workbook. Keep technical OP spelling intact. */
export const STONE_BOM_HEADERS = {
  full: ["S. No.", "SO", "Elevation", "Main Group", "Sub Group", "Level", "Item", "SKU", "Type", "Height", "Width", "Depth", "Thickness", "Finish", "Grain", "CF Type", "Profile Code", "SO Qty", "Waste %", "Actual Qty", "Pcs", "In Stock", "Eff. Stock", "Deficit", "Unit", "Status"],
  bom: ["S. No.", "SO", "Elevation", "Main Group", "SKU", "Type", "Height", "Width", "Depth", "Actual Qty", "Unit", "Thickness", "Finish", "Grain", "Remark"],
  opti: ["SO", "Main Group", "Group", "Item Name", "Profile Code", "Type", "Length", "Width", "Qty", "Thickness", "Grain", "Finish"],
  hardware: ["RM Item Name", "Order From", "Material Type", "Quantity", "Order Qty", "UOM"],
  routing: ["Tab (Source)", "BOM Location", "Hardware Pack", "Cabinet / Type", "Side", "Item Name", "Order From", "Route From", "Qty", "UOM"],
  opCodes: ["[P_DRWINFO_1]", "[P_DESC1]", "[P_IDESC]", "[P_LENGTH]", "[P_WIDTH]", "[P_MINQ]", "[P_IIDESC]", "[P_GRAIN]", "[P_FINISHING]", "[P_CODE_MAT]", "[P_EDGING_CODE]", "[P_EDGING_INFO]", "[P_DRILL_CODE]", "[P_DRILL_INFO]", "[P_CODE]", "[P_EDGE_MAT_UP]", "[P_EGDE_MAT_LO]", "[P_EDGE_MAT_SX]", "[P_EDGE_MAT_DX]"],
  opNames: ["Info 1", "Description 1", "I Description", "Length", "Width", "Min Q.", "II Description", "Grain", "Finishing", "Material", "Edging code", "Edging Infos", "Drilling Code", "Drilling infos", "Parts code", "Mat. edge Len1", "Mat. edge Len2", "Mat. edge Wdt1", "Mat. edge Wdt2"],
};
const widths = {
  full: [7, 15, 12, 15, 15, 7, 41, 19, 11, 10, 10, 10, 12, 15, 11, 10, 13, 11, 12, 10, 10, 10, 10, 8, 15, 15],
  bom: [8, 11, 11, 13, 57, 9, 9, 9, 9, 11, 9, 11, 19, 9, 25],
  opti: [17, 17, 33, 45, 13, 30, 10, 10, 10, 12, 11, 15],
  hardware: [51, 19, 15, 13, 13, 11], routing: [13, 31, 43, 27, 17, 53, 17, 13, 8, 9],
};
export function addStoneTable(workbook: XLSX.WorkBook, name: string, rows: Record<string, unknown>[], headers: readonly string[], columnWidths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet([Array.from(headers), ...rows.map(row => headers.map(key => row[key] ?? ""))]);
  sheet["!cols"] = columnWidths.map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return sheet;
}
export function addStoneFullBom(workbook: XLSX.WorkBook, rows: Record<string, unknown>[]) {
  return addStoneTable(workbook, "Full BOM", rows, STONE_BOM_HEADERS.full, widths.full);
}
const mainGroup = (part: ProductionPart) => ["Shutter", "Visible side"].includes(part.role) ? "Shutter" : "Carcass";

export function appendStoneManufacturingTabs(workbook: XLSX.WorkBook, input: ProductionInput, purchases: PurchaseTotal[]) {
  const parts = input.parts.filter(p => p.kind !== "foil");
  const bom = parts.map((p, i) => ({ "S. No.": i + 1, SO: p.kitchen, Elevation: p.elevation,
    "Main Group": mainGroup(p), SKU: p.panel, Type: p.role, Height: p.length,
    Width: p.kind === "profile" ? "" : p.width, Depth: "", "Actual Qty": p.qty, Unit: "pcs",
    Thickness: p.thickness || "", Finish: p.finish, Grain: "", Remark: p.edgeBand ? `Edge band: ${p.edgeBand} · all four edges` : p.drill }));
  addStoneTable(workbook, "BOM", bom, STONE_BOM_HEADERS.bom, widths.bom);
  const opti = parts.map(p => ({ SO: p.kitchen, "Main Group": mainGroup(p),
    Group: p.kind === "profile" ? "Profile" : mainGroup(p) === "Shutter" ? "Panels- Sh" : "Panels- Cab",
    "Item Name": p.panel, "Profile Code": p.kind === "profile" ? p.materialId : "", Type: p.cabinet,
    Length: p.length, Width: p.kind === "profile" ? "" : p.width, Qty: p.qty, Thickness: p.thickness || "", Grain: "", Finish: p.finish }));
  addStoneTable(workbook, "Opti", opti, STONE_BOM_HEADERS.opti, widths.opti);
  const materialGroups = new Map<string, ProductionPart[]>();
  for (const part of parts.filter(p => p.kind === "board")) {
    const key = JSON.stringify([part.materialId, part.material, part.finish, part.thickness, part.rate]);
    materialGroups.set(key, [...(materialGroups.get(key) ?? []), part]);
  }
  const opRows: (string | number)[][] = [];
  for (const group of materialGroups.values()) {
    if (opRows.length) opRows.push([], []);
    opRows.push([`${group[0].material} · ${group[0].finish} · ${group[0].thickness} mm`], [], [...STONE_BOM_HEADERS.opCodes], [...STONE_BOM_HEADERS.opNames]);
    opRows.push(...group.map(p => [p.kitchen, `${p.elevation} ${p.cabinet}`, p.panel, p.length, p.width, p.qty,
      p.thickness, 0, p.finish, p.materialId, "", p.edgeBand, "", p.drill, p.id, "", "", "", ""]));
  }
  if (!opRows.length) opRows.push(["No wooden cut panels"], [], [...STONE_BOM_HEADERS.opCodes], [...STONE_BOM_HEADERS.opNames]);
  const op = XLSX.utils.aoa_to_sheet(opRows);
  op["!cols"] = [41, 19, 35, 10, 10, 8, 14, 8, 31, 17, 13, 13, 13, 13, 11, 13, 13, 13, 13].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, op, "OP");
  const hardware = purchases.filter(p => !p.categories.some(c => /processing$|surface finishing/i.test(c))).map(p => ({
    "RM Item Name": p.item, "Order From": "Unassigned", "Material Type": p.categories.join(", "), Quantity: p.quantity,
    "Order Qty": /^(sheet|slab|nos|pcs|set)$/i.test(p.unit) ? Math.ceil(p.quantity - 1e-9) : p.quantity,
    UOM: /^(sheet|slab)$/.test(p.unit) ? "Pcs" : p.unit,
  }));
  addStoneTable(workbook, "Hardware items", hardware, STONE_BOM_HEADERS.hardware, widths.hardware);
  const routing = input.supplies.map(p => ({ "Tab (Source)": p.pack, "BOM Location": p.kitchen,
    "Hardware Pack": p.pack, "Cabinet / Type": p.cabinet, Side: "", "Item Name": p.item,
    "Order From": p.orderFrom, "Route From": "Unassigned", Qty: p.qty, UOM: p.unit }));
  addStoneTable(workbook, "Hardware Routing", routing, STONE_BOM_HEADERS.routing, widths.routing);
}
