import * as XLSX from "xlsx-js-style";
import { consolidateProductionSupplies, productionGroupKey, productionSheetCount, isSheetMaterial, extraStockMetrics, type ProductionInput, type OptimizedGroup } from "@/lib/production-optimizer";
import { productionCuttingBatches, productionExtraStockRows } from "@/lib/production-report";

export function productionExportTables(inputs: ProductionInput[], groups: OptimizedGroup[]) {
  const cuttingBatches = productionCuttingBatches(groups);
  const batchLookup = new Map(cuttingBatches.flatMap(b => b.sources.map(source => [`${b.groupIndex}:${source.layoutIndex}`, b.id])));
  const batchSummary = cuttingBatches.map(b => ({ "Cutting batch": b.id, "Material group": b.groupIndex + 1,
    Material: b.material, Finish: b.finish, Thickness: b.thickness, "First sheet": b.sheetStart, "Last sheet": b.sheetEnd, "Sheet references": b.sheetRanges,
    "Sheets in batch": b.sheets, "Pieces per sheet": b.piecesPerSheet, "Total pieces": b.totalPieces,
    "Extra stock pieces": b.extraStockPieces, "Extra stock pieces per layout": b.extraPiecesPerSheet,
    "Layout stock sqft": b.stockSqft, "Layout net sqft": b.netSqft, "Layout waste %": b.wastePct, "Remaining waste %": b.remainingWastePct }));
  const parts = inputs.flatMap(input => input.parts);
  const cuts = parts.map(p => ({ SO: p.kitchen, Elevation: p.elevation, Cabinet: p.cabinet, "Part ID": p.id,
    "Main Group": p.role, Group: p.kind, "Item Name": p.panel, "Material ID": p.materialId, Material: p.material,
    Length: p.length, Width: p.kind === "profile" ? "" : p.width, Qty: p.qty, Thickness: p.thickness,
    Grain: "See material settings", Finish: p.finish, "Edge band": p.edgeBand, "Banded edges": p.edgeBand ? "All four" : "None", Drilling: p.drill }));
  const hardware = consolidateProductionSupplies(inputs).map(p => ({ "RM Item Name": p.item, "Item Code": p.itemCode,
    "Order From": p.orderFrom, "Material Type": p.pack, Quantity: p.qty,
    "Order Qty": /^(nos|pcs|set)$/i.test(p.unit) ? Math.ceil(p.qty - 1e-9) : p.qty, UOM: p.unit, Kitchens: p.kitchens.join(", ") }));
  const routing = inputs.flatMap(input => input.supplies.map(p => ({ "Tab (Source)": p.pack, "BOM Location": p.kitchen,
    "Hardware Pack": p.pack, "Cabinet / Type": p.cabinet, Elevation: p.elevation, "Item Name": p.item,
    "Item Code": p.itemCode, "Order From": p.orderFrom, "Route From": "Unassigned", Qty: p.qty, UOM: p.unit })));
  const layouts = groups.flatMap((g, index) => g.layouts.flatMap((layout, layoutIndex) => layout.placements.map(p => ({
    "Cutting batch": batchLookup.get(`${index}:${layoutIndex}`) ?? "",
    "Material group": index + 1, Material: g.material, Finish: g.finish, Thickness: g.thickness,
    "Stock type": g.kind === "profile" ? "Length" : g.kind === "foil" ? "Roll" : "Sheet", "Sheet / Roll": layout.number,
    Purpose: p.extraStock ? "Extra stock" : "Required",
    "Repeat count": layout.repeatCount ?? 1, "Last sheet": layout.number + (layout.repeatCount ?? 1) - 1,
    "Stock length mm": layout.length, "Stock width mm": layout.width,
    "Part ID": p.part.id, Piece: p.piece, Kitchen: p.part.kitchen, Elevation: p.part.elevation, Cabinet: p.part.cabinet,
    Panel: p.part.panel, "X mm": p.x, "Y mm": p.y, "Cut length mm": p.length, "Cut width mm": p.width, Rotated: p.rotated ? "Yes" : "No",
  }))));
  const summary = groups.map(g => ({
    "Material group": groups.indexOf(g) + 1, Material: g.material, Finish: g.finish, Thickness: g.thickness,
    Status: g.skipped ? "Cut list only — stock not enabled" : "Optimized",
    "Stock type": g.kind === "profile" ? "Length" : g.kind === "foil" ? "Roll" : "Sheet", "Sheet count": isSheetMaterial(g.kind) ? productionSheetCount(g) : "Not applicable",
    "Stock lengths": g.kind === "profile" ? productionSheetCount(g) : "", "Stock length mm": g.stock.length,
    "Cutting batches": cuttingBatches.filter(b => b.groupKey === g.key).length,
    "Roll width mm": g.kind === "foil" ? 1420 : "", "Roll length mm": g.kind === "foil" ? g.rollLengthMm : "",
    "Placed net sqft": g.netSqft, "Layout stock sqft": g.purchasedSqft, "Layout waste %": g.wastePct,
    "Extra stock pieces": g.extraStockCount ?? 0, "Extra stock sqft": g.extraStockSqft ?? 0,
    "Extra stock metres": g.extraStockMetres ?? 0,
    "Extra processing estimate Rs": extraStockMetrics(g.layouts, g.kind, g.purchasedSqft, g.netSqft).extraProcessingCost ?? "Not defined",
    "Remaining waste %": g.remainingWastePct ?? g.wastePct,
    "Unplaced pieces": g.unplaced.reduce((sum, item) => sum + item.part.qty, 0),
  }));
  const offcuts = groups.flatMap((g, index) => g.layouts.flatMap((l, layoutIndex) => l.offcuts.map(r => ({
    "Cutting batch": batchLookup.get(`${index}:${layoutIndex}`) ?? "",
    "Material group": index + 1, Material: g.material, Finish: g.finish, Thickness: g.thickness, "Sheet / Roll": l.number,
    "Repeat count": l.repeatCount ?? 1,
    "X mm": r.x, "Y mm": r.y, "Length mm": r.length, "Width mm": r.width,
  }))));
  const settings = groups.map((g, index) => ({ "Material group": index + 1, Material: g.material, Finish: g.finish,
    Thickness: g.thickness, "Sheet length mm": g.kind === "foil" ? "Variable" : g.stock.length,
    "Sheet width mm": g.stock.width,
    "Saw kerf mm": g.stock.kerf, "Edge trim per side mm": g.stock.trim,
    Enabled: g.skipped ? "No" : "Yes", Priority: g.stock.priority ?? "auto", Overproduction: g.stock.overproduction ? "Yes" : "No",
    "Extra processing rate": g.stock.extraProcessingRate ?? "Use part rate if defined",
    "Grain direction locked": g.stock.grainLocked ? "Yes" : "No", "Quoted costing": "Extra stock not added to kitchen quantities" }));
  const extraStock = productionExtraStockRows(groups).map(p => ({ Material: p.material, Finish: p.finish, Thickness: p.thickness,
    Type: p.kind, "Source cabinet": p.sourceCabinet, Panel: p.panel, "Length mm": p.length, "Width mm": p.kind === "profile" ? "" : p.width,
    "Extra stock pieces": p.qty, "Extra stock sqft": p.kind === "profile" ? "" : p.areaSqft, "Extra stock metres": p.kind === "profile" ? p.metres : "",
    "Processing rate": p.processingRate ?? "Not defined", "Rate unit": p.kind === "profile" ? "Rs/m" : "Rs/sqft",
    "Processing estimate Rs": p.processingCost ?? "Not defined", Purpose: "Extra stock — excluded from kitchen requirements" }));
  const warnings = [...inputs.flatMap(input => input.warnings), ...groups.flatMap(g => [...g.unplaced.map(p => `${p.part.kitchen} / ${p.part.panel}: ${p.reason}`), ...(g.optimizationNote ? [g.optimizationNote] : [])])];
  return { cuts, hardware, routing, layouts, summary, batchSummary, offcuts, settings, extraStock, warnings };
}

/** Stone-builder-style factory workbook, separate from the quotation export. */
export function exportProductionWorkbook(inputs: ProductionInput[], groups: OptimizedGroup[]) {
  const workbook = XLSX.utils.book_new();
  const tables = productionExportTables(inputs, groups);
  const add = (name: string, rows: Record<string, unknown>[]) => {
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "No items" }]);
    sheet["!cols"] = Object.keys(rows[0] ?? { Note: "" }).map(key => ({ wch: /name|material|panel|cabinet|description/i.test(key) ? 42 : 20 }));
    sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
    for (let col = 0; col < Object.keys(rows[0] ?? { Note: "" }).length; col++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: col })];
      if (cell) cell.s = { fill: { patternType: "solid", fgColor: { rgb: "22685E" } }, font: { bold: true, color: { rgb: "FFFFFF" } } };
    }
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };
  add("Batch", inputs.map(input => ({ "Kitchen ID": input.id, Kitchen: input.name, "Saved version": input.version,
    "Panel records": input.parts.length, "Quoted costing": "Unchanged", Algorithm: "Guillotine heuristic; review before factory cutting" })));
  add("Sheet Summary", tables.summary);
  add("Batch Summary", tables.batchSummary);
  add("Full BOM", inputs.flatMap(input => (input.bom ?? []).map(row => ({ Kitchen: input.name, ...row }))));
  add("BOM", tables.cuts.filter(p => p.Group !== "foil"));
  add("Opti", tables.cuts);
  // Retain the Stone sample's technical OP fields. Unsupported drilling/edge codes stay blank, not invented.
  const opHeaders = ["[P_DRWINFO_1]", "[P_DESC1]", "[P_IDESC]", "[P_LENGTH]", "[P_WIDTH]", "[P_MINQ]", "[P_IIDESC]", "[P_GRAIN]", "[P_FINISHING]", "[P_CODE_MAT]", "[P_EDGING_CODE]", "[P_EDGING_INFO]", "[P_DRILL_CODE]", "[P_DRILL_INFO]", "[P_CODE]", "[P_EDGE_MAT_UP]", "[P_EGDE_MAT_LO]", "[P_EDGE_MAT_SX]", "[P_EDGE_MAT_DX]"];
  const op = XLSX.utils.aoa_to_sheet([opHeaders, ["Info 1", "Description 1", "I Description", "Length", "Width", "Min Q.", "II Description", "Grain", "Finishing", "Material", "Edging code", "Edging Infos", "Drilling Code", "Drilling infos", "Parts code", "Mat. edge Len1", "Mat. edge Len2", "Mat. edge Wdt1", "Mat. edge Wdt2"],
    ...inputs.flatMap(input => input.parts.filter(p => p.kind === "board").map(p => [p.kitchen, `${p.elevation} ${p.cabinet}`, p.panel, p.length, p.width, p.qty, p.thickness,
      groups.find(g => g.key === productionGroupKey(p))?.stock.grainLocked ? 1 : 0,
      p.finish, p.materialId, "", p.edgeBand, "", p.drill, p.id, "", "", "", ""]))]);
  op["!cols"] = opHeaders.map(() => ({ wch: 23 })); op["!freeze"] = { ySplit: 2, xSplit: 0 };
  XLSX.utils.book_append_sheet(workbook, op, "OP");
  add("Cut Layouts", tables.layouts);
  add("Extra Stock", tables.extraStock);
  add("Offcuts", tables.offcuts);
  add("Unplaced", groups.flatMap(g => g.unplaced.map(({ part, reason }) => ({ Kitchen: part.kitchen,
    Elevation: part.elevation, Cabinet: part.cabinet, "Part ID": part.id, Panel: part.panel,
    Material: part.material, Finish: part.finish, Thickness: part.thickness,
    "Length mm": part.length, "Width mm": part.width, Pieces: part.qty, Reason: reason }))));
  add("Hardware items", tables.hardware);
  add("Hardware Routing", tables.routing);
  add("Glass cuts", tables.cuts.filter(p => p.Group === "glass"));
  add("Profile cuts", tables.cuts.filter(p => p.Group === "profile"));
  add("Stone cuts", tables.cuts.filter(p => p.Group === "stone"));
  add("Foil costing", inputs.flatMap(input => input.foilCosting.map(p => ({ Kitchen: input.name, Role: p.role,
    "Billable sqft (existing waste)": p.quantity, "Rate per sqft": p.rate, Unit: p.unit, "Roll width mm": 1420,
    Note: "Roll layout length is a production plan only; no sheet conversion or costing write-back" }))));
  add("Settings", tables.settings);
  add("Review", [{ Note: "No stock integration: extra stock is a production estimate, not an inventory entry. Required BOM quantities exclude extra stock. Confirm stock dimensions at factory. OP template is not CNC drilling toolpaths. Disabled materials remain cut lists only." },
    ...tables.warnings.map(Note => ({ Note }))]);
  XLSX.writeFile(workbook, `Wood_Production_Batch_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
