import type {
  BomReportRow,
  CompositeItemDetail,
  CompositeMappedItem,
  ItemDetail,
  SalesOrderDetail,
  SalesOrderLineItem,
  StockStatus,
  ZohoCustomField,
} from "./types";
import { normalizePartOrPanelName } from "./naming";

const MAX_BOM_DEPTH = 6;

export type GlobalConsumed = Record<string, number>;

export type BomExpansionContext = {
  itemsById: Record<string, ItemDetail | null>;
  compositesById: Record<string, CompositeItemDetail | null>;
  globalConsumed: GlobalConsumed;
};

export function getCfValue(
  source: ItemDetail | CompositeMappedItem | SalesOrderLineItem | null | undefined,
  key: string,
): string {
  if (!source) return "";
  const record = source as Record<string, unknown>;
  const direct = record[key];
  if (direct !== undefined && direct !== null && direct !== "") return String(direct);

  const hash = record.custom_field_hash as Record<string, unknown> | undefined;
  if (hash && hash[key] !== undefined && hash[key] !== null && hash[key] !== "") {
    return String(hash[key]);
  }

  const cfs = record.custom_fields as ZohoCustomField[] | undefined;
  if (Array.isArray(cfs)) {
    for (const cf of cfs) {
      const keyLower = key.toLowerCase();
      const match =
        cf.api_name === key ||
        cf.placeholder === key ||
        cf.label === key ||
        cf.api_name === keyLower ||
        cf.placeholder === keyLower;
      if (!match) continue;
      let v: string | number | boolean | null | undefined = cf.value;
      if (v === null || v === undefined || v === "" || v === false) {
        v = String(cf.value_formatted ?? "").replace(/%/g, "").trim();
      }
      if (v !== "" && v !== null && v !== undefined) return String(v);
    }
  }
  return "";
}

export function isComposite(item: ItemDetail | CompositeMappedItem | SalesOrderLineItem | null): boolean {
  if (!item) return false;
  const record = item as Record<string, unknown>;
  if (record.is_combo_product === true || record.is_combo_product === "true") return true;
  if (record.item_type === "composite" || record.item_type === "composite_item") return true;
  if (record.item_type === "group" || record.item_type === "bundle") return true;
  if (record.product_type === "composite") return true;
  if (typeof record.composite_item_id === "string" && record.composite_item_id !== "") return true;
  return false;
}

export function isService(item: ItemDetail | CompositeMappedItem | SalesOrderLineItem | null): boolean {
  if (!item) return false;
  const record = item as Record<string, unknown>;
  return record.item_type === "service" || record.product_type === "service" || record.type === "service";
}

export function getRawStock(item: ItemDetail | CompositeMappedItem | null): number {
  if (!item) return 0;
  const stockArray = (item as { stocks?: Array<{ stock_on_hand?: number }> }).stocks;
  const fromArray = stockArray?.[0]?.stock_on_hand;
  const candidates = [
    fromArray,
    (item as ItemDetail).actual_available_stock,
    (item as ItemDetail).stock_on_hand,
    (item as ItemDetail).available_stock,
    (item as CompositeMappedItem).quantity_available,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && !Number.isNaN(value)) return value;
  }
  return 0;
}

export function getStockStatus(actualQty: number, effectiveStock: number): StockStatus {
  if (effectiveStock <= 0 || effectiveStock < actualQty) return "out-of-stock";
  if (effectiveStock < actualQty * 1.5) return "low-stock";
  return "in-stock";
}

function statusLabels(): Record<StockStatus, string> {
  return {
    "in-stock": "In Stock",
    "low-stock": "Low Stock",
    "out-of-stock": "Out of Stock",
    unknown: "Unknown",
  };
}

export function statusLabel(status: StockStatus): string {
  return statusLabels()[status];
}

export function groupLabel(key: string): string {
  if (!key || key === "__other__") return "Other";
  return key;
}

export function detectGroup(value: string): string {
  const v = String(value || "").trim();
  return v || "__other__";
}

export function resolveSku(sku: string, name: string): string {
  const s = String(sku || "").trim();
  return s === "" || s === "-" ? name : s;
}

function extractItemCustomFields(item: ItemDetail | CompositeMappedItem | null) {
  return {
    cfGroup: detectGroup(getCfValue(item, "cf_group")),
    cfSubGroup: getCfValue(item, "cf_sub_group"),
    cfHeight: getCfValue(item, "cf_height"),
    cfWidth: getCfValue(item, "cf_width"),
    cfDepth: getCfValue(item, "cf_depth"),
    cfThickness: getCfValue(item, "cf_thickness"),
    cfFinish: getCfValue(item, "cf_finish"),
    cfType: getCfValue(item, "cf_type"),
    cfWastePercent: parseFloat(getCfValue(item, "cf_waste_percentage")) || 0,
  };
}

export function buildReportRowsForOrder(order: SalesOrderDetail, ctx: BomExpansionContext): BomReportRow[] {
  const rows: BomReportRow[] = [];

  for (const line of order.line_items ?? []) {
    const itemId = line.item_id || line.composite_item_id;
    if (!itemId) continue;

    const masterItem = ctx.itemsById[itemId] ?? null;
    const composite = ctx.compositesById[itemId] ?? null;
    const lineIsComposite = isComposite(line) || isComposite(masterItem) || Boolean(composite);

    const soQty = Number(line.quantity ?? 1);
    const masterCfRaw = extractItemCustomFields(masterItem);
    const lineCfGroup = detectGroup(getCfValue(line, "cf_group"));
    const cfGroup = lineCfGroup !== "__other__" ? lineCfGroup : masterCfRaw.cfGroup;
    const masterCf = { ...masterCfRaw, cfGroup };
    const rawStock = getRawStock(masterItem ?? composite);

    const masterRow: BomReportRow = {
      sourceOrderId: order.salesorder_id,
      sourceOrderNumber: order.salesorder_number,
      customerName: order.customer_name,
      orderDate: order.date,
      itemId,
      itemName: normalizePartOrPanelName(line.name ?? line.item_name ?? masterItem?.name ?? "-"),
      sku: line.sku ?? masterItem?.sku ?? "-",
      groupName: cfGroup,
      masterGroup: cfGroup,
      cfGroup,
      cfSubGroup: masterCf.cfSubGroup,
      cfHeight: masterCf.cfHeight,
      cfWidth: masterCf.cfWidth,
      cfDepth: masterCf.cfDepth,
      cfThickness: masterCf.cfThickness,
      cfFinish: masterCf.cfFinish,
      cfType: masterCf.cfType,
      level: 0,
      quantityNeeded: soQty,
      wastePercent: 0,
      actualQuantity: soQty,
      rawStock,
      effectiveStock: rawStock,
      deficit: 0,
      unit: line.unit ?? masterItem?.unit ?? "Nos",
      status: "unknown",
      rowType: lineIsComposite ? "master" : "plain",
      typeLabel: lineIsComposite ? "PACK BOM" : "ITEM",
      underProfile: false,
    };

    if (!lineIsComposite) {
      const status = getStockStatus(soQty, rawStock);
      masterRow.status = status;
      masterRow.deficit = Math.max(0, soQty - rawStock);
    }

    rows.push(masterRow);

    if (lineIsComposite && composite) {
      const children = expandComposite(composite, soQty, 1, 0, cfGroup, itemId, masterRow.itemName, ctx);
      rows.push(...children);
    }
  }

  return rows;
}

function expandComposite(
  composite: CompositeItemDetail,
  parentQty: number,
  level: number,
  parentWastePct: number,
  masterGroup: string,
  parentItemId: string,
  parentItemName: string,
  ctx: BomExpansionContext,
): BomReportRow[] {
  if (level > MAX_BOM_DEPTH) return [];
  const out: BomReportRow[] = [];

  const mapped =
    composite.mapped_items ??
    composite.composite_item_line_items ??
    composite.bundle_items ??
    composite.line_items ??
    composite.items ??
    [];

  for (const child of mapped) {
    const childId = child.item_id || child.composite_item_id;
    if (!childId) continue;
    if (isService(child)) continue;

    const perUnit = Number(child.quantity ?? child.quantity_needed ?? 1);
    const totalQty = perUnit * parentQty;

    const masterDetail = ctx.itemsById[childId] ?? null;
    const childComposite = ctx.compositesById[childId] ?? null;
    const childIsComposite = isComposite(child) || isComposite(masterDetail) || Boolean(childComposite);

    const cf = extractItemCustomFields(masterDetail);
    const ownWaste = cf.cfWastePercent;
    const displayWaste = childIsComposite ? 0 : ownWaste > 0 ? ownWaste : parentWastePct;
    const actualQty = childIsComposite ? totalQty : totalQty + totalQty * (displayWaste / 100);

    const rawStock = getRawStock(masterDetail ?? child);
    if (ctx.globalConsumed[childId] === undefined) ctx.globalConsumed[childId] = 0;
    const effective = Math.max(0, rawStock - ctx.globalConsumed[childId]);
    ctx.globalConsumed[childId] += actualQty;
    const deficit = Math.max(0, actualQty - effective);
    const childName = normalizePartOrPanelName(child.name ?? child.item_name ?? masterDetail?.name ?? "-");
    const selfIsProfile =
      cf.cfGroup.toLowerCase().includes("profile") || childName.toLowerCase().includes("profile");

    const row: BomReportRow = {
      sourceOrderId: "",
      sourceOrderNumber: "",
      customerName: "",
      orderDate: undefined,
      itemId: childId,
      parentItemId,
      itemName: childName,
      sku: child.sku ?? masterDetail?.sku ?? "-",
      groupName: cf.cfGroup,
      masterGroup,
      cfGroup: cf.cfGroup,
      cfSubGroup: cf.cfSubGroup,
      cfHeight: cf.cfHeight,
      cfWidth: cf.cfWidth,
      cfDepth: cf.cfDepth,
      cfThickness: cf.cfThickness,
      cfFinish: cf.cfFinish,
      cfType: cf.cfType,
      level,
      quantityNeeded: totalQty,
      wastePercent: displayWaste,
      actualQuantity: actualQty,
      rawStock,
      effectiveStock: effective,
      deficit,
      unit: child.unit ?? child.unit_name ?? masterDetail?.unit ?? "Nos",
      status: getStockStatus(actualQty, effective),
      rowType: childIsComposite ? "sub_bom" : "component",
      typeLabel: childIsComposite ? "SUB-BOM" : "COMPONENT",
      underProfile: selfIsProfile,
    };

    out.push(row);

    if (childIsComposite && childComposite) {
      const subRows = expandComposite(
        childComposite,
        totalQty,
        level + 1,
        ownWaste,
        masterGroup,
        childId,
        childName,
        ctx,
      );
      out.push(...subRows);
    }
  }

  return out;
}

export function collectRequiredItemIds(orders: SalesOrderDetail[]): string[] {
  const ids = new Set<string>();
  orders.forEach((o) =>
    (o.line_items ?? []).forEach((li) => {
      const id = li.item_id || li.composite_item_id;
      if (id) ids.add(id);
    }),
  );
  return Array.from(ids);
}

export function collectMappedItemIds(composite: CompositeItemDetail | null): string[] {
  if (!composite) return [];
  const mapped =
    composite.mapped_items ??
    composite.composite_item_line_items ??
    composite.bundle_items ??
    composite.line_items ??
    composite.items ??
    [];
  return mapped.map((m) => m.item_id || m.composite_item_id || "").filter(Boolean);
}

export function annotateRowsForOrder(rows: BomReportRow[], order: SalesOrderDetail): BomReportRow[] {
  return rows.map((row) => ({
    ...row,
    sourceOrderId: order.salesorder_id,
    sourceOrderNumber: order.salesorder_number,
    customerName: order.customer_name,
    orderDate: order.date,
  }));
}
