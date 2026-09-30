"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { jsPDF } from "jspdf";
import { BomOrderCard } from "@/components/BomOrderCard";
import { DraftPoModal } from "@/components/DraftPoModal";
import { exportBomCsv, exportBomWorkbook, type AccessoryExportRow } from "@/lib/export";
import { loadBomReportForOrders } from "@/lib/report";
import { groupLabel, statusLabel, getCfValue } from "@/lib/stock";
import {
  resolveRawMaterials,
  searchStoneItems,
  searchProfileItems,
  applyStoneChange,
  applyProfileChange,
  type RawMaterialSelection,
} from "@/lib/rawmaterial";
import type {
  ApiErrorBody,
  BomReportRow,
  SalesOrderDetail,
  SalesOrderSummary,
  StockStatus,
} from "@/lib/types";

type LoadState = "idle" | "searching" | "loading";

type ConnectionState = {
  ok: boolean;
  organizationId?: string;
  organizationName?: string;
  inventoryBaseUrl?: string;
  checkedAt?: string;
  error?: string;
};

type QrKind = "bom" | "user";

type QrModalState = {
  title: string;
  subtitle: string;
  imageUrl: string;
  filename: string;
  kind: QrKind;
  rows: BomReportRow[];
};

type QrPreviewUrls = Record<string, { bom?: string; user?: string }>;

type ActiveTab = "bom" | "accessories";

type AccessoryKey = "skirting" | "duplay" | "lprofile" | "jhandle" | "chandle";

type AccessoryItem = {
  key: AccessoryKey;
  label: string;
  itemId: string;
  condition: (subGroup: string, cfType: string) => boolean;
};

type AccessoryEntry = {
  enabled: boolean;
  size: string;
  elevation: string;
  actualQty: number | null;
};

type AccessorySubformRow = {
  id: number;
  soId: string;
  itemIds: string[];
  accessories: Record<AccessoryKey, AccessoryEntry>;
};

const ACCESSORY_ITEMS: AccessoryItem[] = [
  {
    key: "skirting",
    label: "Skirting with light",
    itemId: "3418412000001249001",
    condition: (subGroup) => {
      const sg = (subGroup || "").toLowerCase();
      return sg.includes("base") || sg.includes("tall");
    },
  },
  {
    key: "duplay",
    label: "Duplay Profile Light",
    itemId: "3418412000001249010",
    condition: (subGroup, cfType) => {
      const sg = (subGroup || "").toLowerCase();
      const tp = (cfType || "").toLowerCase();
      return sg.includes("wall") && !tp.includes("dishrack") && !tp.includes("dish rack");
    },
  },
  {
    key: "lprofile",
    label: "L Profile Dado Light",
    itemId: "3418412000001249037",
    condition: (subGroup) => (subGroup || "").toLowerCase().includes("wall"),
  },
  { key: "jhandle", label: "J type handle", itemId: "3418412000001249019", condition: () => true },
  { key: "chandle", label: "C type handle", itemId: "3418412000001249028", condition: () => true },
];

const PROFILE_KEYS: AccessoryKey[] = ["skirting", "duplay", "lprofile"];

function getExclusionGroup(key: AccessoryKey): AccessoryKey[] | null {
  if (PROFILE_KEYS.includes(key)) return PROFILE_KEYS;
  return null;
}

function createAccessoryEntries(): Record<AccessoryKey, AccessoryEntry> {
  return Object.fromEntries(
    ACCESSORY_ITEMS.map((accessory) => [accessory.key, { enabled: false, size: "", elevation: "", actualQty: null }]),
  ) as Record<AccessoryKey, AccessoryEntry>;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error((body as ApiErrorBody).error ?? "Request failed");
  }
  return body as T;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeFilename(value: string) {
  return value.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function getPackingGroups(orderRows: BomReportRow[]): string[] {
  return ["Carcass", "Shutter", "Both"];
}

function isShutterDescendant(row: BomReportRow, allRows: BomReportRow[]): boolean {
  if (row.level <= 1) {
    return (
      row.cfGroup?.toLowerCase() === "shutter" ||
      row.cfGroup?.toLowerCase() === "shutters" ||
      row.itemName.toLowerCase().includes("shutter")
    );
  }
  const parent = allRows.find((r) => r.itemId === row.parentItemId && r.level === row.level - 1);
  if (!parent) {
    const fallback = allRows.find((r) => r.itemId === row.parentItemId);
    if (!fallback) return false;
    return isShutterDescendant(fallback, allRows);
  }
  return isShutterDescendant(parent, allRows);
}

function isShutterRow(row: BomReportRow, allRows: BomReportRow[]): boolean {
  if (row.level > 1) {
    return isShutterDescendant(row, allRows);
  }
  if (row.level === 1) {
    const isL1Shutter =
      row.cfGroup?.toLowerCase() === "shutter" ||
      row.cfGroup?.toLowerCase() === "shutters" ||
      row.itemName.toLowerCase().includes("shutter");
    return isL1Shutter && row.rowType !== "sub_bom";
  }
  return false;
}

function isCarcassRow(row: BomReportRow): boolean {
  if (row.level !== 1) return false;
  if (row.rowType !== "plain" && row.rowType !== "component" && row.rowType !== "sub_bom") return false;
  const isShutter =
    row.cfGroup?.toLowerCase() === "shutter" ||
    row.cfGroup?.toLowerCase() === "shutters" ||
    row.itemName.toLowerCase().includes("shutter");
  return !isShutter;
}

function isPackingListRow(row: BomReportRow): boolean {
  return (
    row.rowType === "plain" ||
    row.rowType === "component" ||
    row.rowType === "sub_bom"
  );
}

function isHardwareOrOther(row: BomReportRow): boolean {
  const name = row.itemName.toLowerCase();
  const sg = (row.cfSubGroup || row.cfGroup || "").toLowerCase();
  return name.startsWith("hardware pack") || name.includes("glue silicone") || sg.includes("hardware");
}

function filterPackingRowsByGroup(orderRows: BomReportRow[], group: string): BomReportRow[] {
  const groupLower = group.toLowerCase();
  if (groupLower === "carcass") {
    return orderRows.filter(isCarcassRow);
  }
  if (groupLower === "shutter") {
    return orderRows.filter((r) => isShutterRow(r, orderRows));
  }
  if (groupLower === "both") {
    return orderRows.filter((r) => isCarcassRow(r) || isShutterRow(r, orderRows));
  }
  return [];
}

function extractDimension(itemName: string): string {
  const multi = itemName.match(/(\d+x\d+)-?\s*(\d+x\d+x\d+)/i);
  if (multi) return `${multi[1]} - ${multi[2]}`;
  const triple = itemName.match(/(\d+x\d+x\d+)/i);
  if (triple) return triple[1];
  const double = itemName.match(/(\d+x\d+)/i);
  if (double) return double[1];
  return "";
}

function isSetItem(row: BomReportRow): boolean {
  const sub = (row.cfSubGroup || "").toLowerCase();
  const grp = (row.cfGroup || "").toLowerCase();
  const sku = (row.sku || "").toLowerCase();
  const isCarcassPack = sub.includes("carcass pack") || grp.includes("carcass pack");
  const isProfilePack = sub.includes("profile pack") || grp.includes("profile pack");
  if (isCarcassPack && !sku.includes("prof")) return true;
  if (isProfilePack) return true;
  return false;
}

function calcBoxDimension(itemName: string, isSet: boolean): string {
  const triple = itemName.match(/(\d+)x(\d+)x(\d+)/i);
  if (!triple) return "";
  const w = parseInt(triple[1], 10);
  const h = parseInt(triple[2], 10);
  const t = parseInt(triple[3], 10);
  const padding = 20;
  const thickness = isSet ? t * 2 + padding : t + padding;
  return `${w + padding}x${h + padding}x${thickness}`;
}

type ConsolidatedPackingRow = {
  row: BomReportRow;
  totalQty: number;
  boxes: number;
  pcsPerBox: number;
};

function consolidatePackingRows(rows: BomReportRow[], allOrderRows: BomReportRow[]): ConsolidatedPackingRow[] {
  const masterQtyMap = new Map<string, number>();
  for (const r of allOrderRows) {
    if (
      r.rowType === "master" ||
      r.rowType === "plain" ||
      (r.level === 1 && r.rowType === "sub_bom")
    ) {
      masterQtyMap.set(r.itemId, r.quantityNeeded);
    }
  }

  const result: ConsolidatedPackingRow[] = [];
  const hwMergeMap = new Map<string, { row: BomReportRow; mergedQty: number }>();
  const mergeMap = new Map<string, { row: BomReportRow; totalQty: number; parentSoQty: number }>();

  for (const row of rows) {
    const qty = row.quantityNeeded || 1;
    const parentSoQty = (row.parentItemId ? masterQtyMap.get(row.parentItemId) : undefined) ?? qty;

    if (row.rowType === "sub_bom" && isHardwareOrOther(row)) {
      const key = row.itemName;
      if (hwMergeMap.has(key)) {
        hwMergeMap.get(key)!.mergedQty += qty;
      } else {
        hwMergeMap.set(key, { row, mergedQty: qty });
      }
    } else if (row.rowType === "sub_bom") {
      const setMultiplier = isSetItem(row) ? 2 : 1;
      result.push({
        row,
        totalQty: qty,
        boxes: Math.ceil(parentSoQty),
        pcsPerBox: setMultiplier,
      });
    } else {
      const key = row.itemId;
      if (mergeMap.has(key)) {
        const existing = mergeMap.get(key)!;
        existing.totalQty += qty;
        existing.parentSoQty += parentSoQty;
      } else {
        mergeMap.set(key, { row, totalQty: qty, parentSoQty });
      }
    }
  }

  for (const { row, mergedQty } of hwMergeMap.values()) {
    const isGlue = row.itemName.toLowerCase().includes("glue silicone");
    const pcs = isGlue ? Math.ceil(mergedQty / 270) : Math.ceil(mergedQty);
    result.push({ row, totalQty: mergedQty, boxes: 1, pcsPerBox: pcs });
  }

  for (const { row, totalQty, parentSoQty } of mergeMap.values()) {
    const isGlue = row.itemName.toLowerCase().includes("glue silicone");
    const boxes = isGlue ? Math.ceil(totalQty / 270) : Math.ceil(parentSoQty);
    const perUnit = parentSoQty > 0 ? Math.round(totalQty / parentSoQty) : 1;
    const setMultiplier = isSetItem(row) ? 2 : 1;
    const pcsPerBox = isGlue ? 1 : perUnit * setMultiplier;
    result.push({ row, totalQty, boxes, pcsPerBox });
  }

  return result;
}

function findLevel0ParentId(row: BomReportRow, allRows: BomReportRow[]): string {
  if (row.level === 0 || !row.parentItemId) {
    return row.itemId;
  }
  const parent = allRows.find((r) => r.itemId === row.parentItemId && r.level === row.level - 1);
  if (!parent) {
    const fallback = allRows.find((r) => r.itemId === row.parentItemId);
    if (fallback) return findLevel0ParentId(fallback, allRows);
    return row.parentItemId;
  }
  return findLevel0ParentId(parent, allRows);
}

type PackingGroup = {
  masterName: string;
  masterFinish: string;
  items: ConsolidatedPackingRow[];
};

function groupByParentMaster(
  consolidated: ConsolidatedPackingRow[],
  allOrderRows: BomReportRow[],
): PackingGroup[] {
  const masterMap = new Map<string, { name: string; finish: string }>();
  for (const row of allOrderRows) {
    if (row.rowType === "master") {
      masterMap.set(row.itemId, { name: row.itemName, finish: row.cfFinish || "" });
    }
  }
  const groups = new Map<string, PackingGroup>();
  for (const entry of consolidated) {
    const parentId = findLevel0ParentId(entry.row, allOrderRows);
    if (!groups.has(parentId)) {
      const master = masterMap.get(parentId);
      groups.set(parentId, {
        masterName: master?.name || entry.row.groupName || "Other",
        masterFinish: master?.finish || "",
        items: [],
      });
    }
    groups.get(parentId)!.items.push(entry);
  }
  return Array.from(groups.values());
}

function buildPackingListHtml(order: SalesOrderDetail, orderRows: BomReportRow[], group: string) {
  const allRows = filterPackingRowsByGroup(orderRows, group);
  const consolidated = consolidatePackingRows(allRows, orderRows);
  const mainConsolidated = consolidated.filter((e) => !isHardwareOrOther(e.row));
  const hwConsolidated = consolidated.filter((e) => isHardwareOrOther(e.row));

  const title = `${group.toUpperCase()} PACKING LIST`;
  const mainHeader = `ITEM NAME - ${group.toUpperCase()}`;

  const packingGroups = groupByParentMaster(mainConsolidated, orderRows);
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let packNum = 0;

  let mainBodyHtml = "";
  packingGroups.forEach((pg, gi) => {
    const letter = alpha[gi] || `${gi + 1}`;
    mainBodyHtml += `<tr style="background:#f5f3ef;">
      <td class="center" style="font-weight:900;">${letter}.</td>
      <td colspan="6" style="font-weight:900;">${escapeHtml(pg.masterName)}</td>
    </tr>`;
    for (const entry of pg.items) {
      const { row, boxes, pcsPerBox } = entry;
      const itemColor = row.cfFinish || "-";
      const set = isSetItem(row);
      const boxDim = calcBoxDimension(row.itemName, set);
      for (let b = 0; b < boxes; b++) {
        packNum++;
        mainBodyHtml += `<tr>
          <td class="center">${packNum}</td>
          <td>${escapeHtml(row.itemName)}</td>
          <td>${escapeHtml(itemColor)}</td>
          <td class="center">PACK - ${packNum}</td>
          <td class="center">${pcsPerBox}</td>
          <td class="center">1</td>
          <td class="center">${escapeHtml(boxDim)}</td>
        </tr>`;
      }
    }
  });

  const mainTableHtml = mainBodyHtml
    ? `<tr>
        <th class="head">S.NO.</th>
        <th class="head">${mainHeader}</th>
        <th class="head">ITEM COLOR</th>
        <th class="head">PACK</th>
        <th class="head">PCS</th>
        <th class="head">BOX</th>
        <th class="head">BOX DIMENSION ( L x W x H )</th>
      </tr>
      ${mainBodyHtml}`
    : "";

  let hwTableHtml = "";
  if (hwConsolidated.length) {
    packNum++;
    const hwPackNum = packNum;
    const midIdx = Math.floor((hwConsolidated.length - 1) / 2);
    let hwRowsHtml = "";
    const hwCount = hwConsolidated.length;
    hwConsolidated.forEach((entry, idx) => {
      hwRowsHtml += `<tr>
        <td class="center">${idx + 1}</td>
        <td>${escapeHtml(entry.row.itemName)}</td>
        <td>${escapeHtml(entry.row.cfFinish || "-")}</td>
        ${idx === 0 ? `<td class="center" rowspan="${hwCount}" style="vertical-align:middle;">PACK - ${hwPackNum}</td>` : ""}
        <td class="center">${entry.pcsPerBox}</td>
        ${idx === 0 ? `<td class="center" rowspan="${hwCount}" style="vertical-align:middle;">${entry.boxes}</td>` : ""}
        <td class="center"></td>
      </tr>`;
    });
    hwTableHtml = `<tr>
        <td class="section-head" colspan="7" style="font-size:16px;font-weight:700;text-align:center;background:#f0f0f0;">HARDWARE PACK & OTHER ITEMS</td>
      </tr>
      <tr>
        <th class="head">S.NO.</th>
        <th class="head">ITEM NAME</th>
        <th class="head">ITEM COLOR</th>
        <th class="head">PACK</th>
        <th class="head">PCS</th>
        <th class="head">BOX</th>
        <th class="head">BOX DIMENSION ( L x W x H )</th>
      </tr>
      ${hwRowsHtml}`;
  }

  const bodyHtml = mainTableHtml || hwTableHtml
    ? `${mainTableHtml}${hwTableHtml}`
    : `<tr><td class="center" colspan="7">No items found for this packing list.</td></tr>`;

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: "Times New Roman", serif; color: #000; }
          table { border-collapse: collapse; width: 100%; }
          td, th { border: 1px solid #222; font-size: 12px; padding: 6px 5px; vertical-align: middle; }
          .title { font-size: 34px; font-weight: 700; text-align: center; }
          .company { font-size: 20px; font-weight: 700; text-align: center; }
          .address { font-size: 12px; text-align: center; }
          .label { font-weight: 700; }
          .head { font-weight: 700; text-align: center; }
          .center { text-align: center; }
        </style>
      </head>
      <body>
        <table>
          <tr><td class="title" colspan="7">${title}</td></tr>
          <tr><td class="company" colspan="7">MAGPPIE LIVING PRIVATE LIMITED</td></tr>
          <tr><td class="address" colspan="7">PLOT NO- 68, SECTOR- 03, IMT MANESAR GURUGRAM, HARYANA-122050</td></tr>
          <tr>
            <td class="label" colspan="3">MRP NO / COMPLAINT NO :- ${escapeHtml(order.reference_number || order.salesorder_number)}</td>
            <td colspan="2"></td>
            <td class="label" colspan="2">DATE :- ${escapeHtml(order.date ?? "")}</td>
          </tr>
          <tr>
            <td class="label" colspan="3">CUSTOMER NAME : ${escapeHtml(order.customer_name)}</td>
            <td colspan="2"></td>
            <td class="label" colspan="2">PRODUCT : KITCHEN</td>
          </tr>
          <tr>
            <td class="label" colspan="3">DESTINATION :</td>
            <td colspan="2"></td>
            <td class="label" colspan="2">VEHICLE NO :</td>
          </tr>
          <tr>
            <td class="label" colspan="3">PAPER PERSON :</td>
            <td colspan="2"></td>
            <td class="label" colspan="2">CONTACT NUMBER :</td>
          </tr>
          ${bodyHtml}
        </table>
      </body>
    </html>`;
}

function generateBarcodeDataUrl(text: string): string {
  if (!text || text === "-") return "";
  const canvas = document.createElement("canvas");
  try {
    JsBarcode(canvas, text, { format: "CODE128", width: 3, height: 80, displayValue: true, fontSize: 16, margin: 4 });
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

async function buildLabelsPdf(order: SalesOrderDetail, orderRows: BomReportRow[], group: string): Promise<Blob> {
  const allRows = filterPackingRowsByGroup(orderRows, group);
  const consolidated = consolidatePackingRows(allRows, orderRows);
  const labelEntries: Array<{ row: BomReportRow; boxNum: number; totalBoxes: number; pcsPerBox: number }> = [];
  for (const entry of consolidated) {
    for (let b = 1; b <= entry.boxes; b++) {
      labelEntries.push({ row: entry.row, boxNum: b, totalBoxes: entry.boxes, pcsPerBox: entry.pcsPerBox });
    }
  }
  const totalLabels = labelEntries.length;
  const W = 150;
  const H = 100;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [W, H] });

  const qrPayload = `${order.salesorder_number}\n${order.customer_name}`;
  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "L", margin: 1, scale: 4 });
  } catch { /* skip QR if too large */ }

  for (let i = 0; i < labelEntries.length; i++) {
    if (i > 0) doc.addPage([W, H], "landscape");
    const { row, boxNum, totalBoxes, pcsPerBox } = labelEntries[i];
    const isHw = isHardwareOrOther(row);
    const dimension = isHw ? "" : extractDimension(row.itemName);
    const finish = isHw ? "" : (row.cfFinish || "");
    const sku = (row.sku && row.sku !== "-") ? row.sku : row.itemName;

    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(2, 2, W - 4, H - 4);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("MAGPPIE", 6, 12);

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const productLines = doc.splitTextToSize(row.itemName, 80);
    doc.text(productLines, W - 6, 8, { align: "right" });

    doc.line(4, 18, W - 4, 18);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("From :", 6, 23);
    doc.setFont("helvetica", "normal");
    doc.text("MAGPPIE LIVING PVT LTD", 18, 23);
    doc.text("Plot No-68, Sector-03", 18, 27);
    doc.text("IMT Manesar, Gurugram", 18, 31);
    doc.text("Haryana - 122050", 18, 35);

    doc.line(W / 2, 19, W / 2, 40);

    doc.setFont("helvetica", "bold");
    doc.text("To :", W / 2 + 4, 23);
    doc.setFont("helvetica", "normal");
    const custLines = doc.splitTextToSize(order.customer_name, 60);
    doc.text(custLines, W / 2 + 12, 23);
    doc.text(order.salesorder_number, W / 2 + 12, 27 + (custLines.length - 1) * 3.5);

    doc.line(4, 40, W - 4, 40);

    const barcodeUrl = generateBarcodeDataUrl(sku);
    if (barcodeUrl) {
      doc.addImage(barcodeUrl, "PNG", 6, 43, 55, 18);
    }

    if (qrDataUrl) {
      doc.addImage(qrDataUrl, "PNG", W - 32, 43, 26, 26);
    }

    doc.line(4, 72, W - 4, 72);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`Box ${i + 1} of ${totalLabels}`, 6, 78);
    doc.setFont("helvetica", "normal");
    doc.text(`Box ${boxNum} of ${totalBoxes} | ${pcsPerBox} pcs`, 6, 83);
    if (finish) doc.text(`Finish: ${finish}`, 6, 88);
    if (dimension) doc.text(`Dim: ${dimension}`, 6, 93);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(order.salesorder_number, W - 6, 78, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.text(sku, W - 6, 83, { align: "right" });
  }

  return doc.output("blob");
}

export function BomDashboard() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [orders, setOrders] = useState<SalesOrderSummary[]>([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [loadedOrders, setLoadedOrders] = useState<SalesOrderDetail[]>([]);
  const [rows, setRows] = useState<BomReportRow[]>([]);
  const [stockFilter, setStockFilter] = useState<StockStatus | "all">("all");
  const [itemFilter, setItemFilter] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [nextRefreshAt, setNextRefreshAt] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("bom");
  const [qrModal, setQrModal] = useState<QrModalState | null>(null);
  const [qrBusyKey, setQrBusyKey] = useState<string>("");
  const [qrPreviewUrls, setQrPreviewUrls] = useState<QrPreviewUrls>({});
  const [accessoryRows, setAccessoryRows] = useState<AccessorySubformRow[]>([]);
  const [accessoryCounter, setAccessoryCounter] = useState(0);
  const [accessoryMessage, setAccessoryMessage] = useState("");
  const [updatingSO, setUpdatingSO] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [packingModalOpen, setPackingModalOpen] = useState(false);
  const [packingGroup, setPackingGroup] = useState<string>("");
  const [packingSelectedOrderIds, setPackingSelectedOrderIds] = useState<string[]>([]);
  const [rawMatModal, setRawMatModal] = useState(false);
  const [rawMatSelection, setRawMatSelection] = useState<RawMaterialSelection | null>(null);
  const [rawMatLoading, setRawMatLoading] = useState(false);
  const [rawMatDropdownItems, setRawMatDropdownItems] = useState<Record<string, Array<{ id: string; name: string; sku: string; sqft?: number }>>>({});
  const [rawMatDropdownLoading, setRawMatDropdownLoading] = useState<Record<string, boolean>>({});
  const [rawMatOrders, setRawMatOrders] = useState<SalesOrderDetail[]>([]);
  const [draftPoOpen, setDraftPoOpen] = useState(false);

  async function checkConnection() {
    setConnectionLoading(true);
    try {
      const body = await fetchJson<ConnectionState>("/api/zoho/status");
      setConnection(body);
    } catch (err) {
      setConnection({
        ok: false,
        error: err instanceof Error ? err.message : "Could not connect to Zoho Inventory.",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setConnectionLoading(false);
    }
  }

  useEffect(() => {
    void checkConnection();
  }, []);

  useEffect(() => {
    try {
      const savedRows = window.localStorage.getItem("bom_accessory_subform_rows");
      const savedCounter = window.localStorage.getItem("bom_accessory_subform_counter");
      if (savedRows) {
        const parsedRows = JSON.parse(savedRows) as AccessorySubformRow[];
        setAccessoryRows(
          parsedRows.map((row) => ({
            ...row,
            accessories: { ...createAccessoryEntries(), ...(row.accessories ?? {}) },
          })),
        );
      }
      if (savedCounter) {
        setAccessoryCounter(Number(savedCounter) || 0);
      }
    } catch {
      setAccessoryRows([]);
      setAccessoryCounter(0);
    }
  }, []);

  useEffect(() => {
    if (!autoRefreshEnabled) {
      setNextRefreshAt(null);
      return;
    }

    setNextRefreshAt(new Date(Date.now() + 10 * 60 * 1000));
    const timer = window.setInterval(() => {
      if (loadedOrders.length) {
        void refreshLoadedReport();
      } else {
        if (!connection || connection.ok) {
          void checkConnection();
        }
        setNextRefreshAt(new Date(Date.now() + 10 * 60 * 1000));
      }
    }, 10 * 60 * 1000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshEnabled, loadedOrders.length]);

  const filteredRows = useMemo(() => {
    const needle = itemFilter.trim().toLowerCase();
    return rows.filter((row) => {
      const statusMatch =
        stockFilter === "all" ||
        row.rowType === "master" ||
        row.status === stockFilter;
      const textMatch =
        !needle ||
        [row.itemName, row.sku, row.groupName, row.sourceOrderNumber, row.customerName, row.cfType]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      return statusMatch && textMatch;
    });
  }, [rows, stockFilter, itemFilter]);

  const componentRows = useMemo(
    () => rows.filter((row) => row.rowType === "component" || row.rowType === "plain"),
    [rows],
  );

  const stats = useMemo(
    () => ({
      total: componentRows.length,
      inStock: componentRows.filter((row) => row.status === "in-stock").length,
      lowStock: componentRows.filter((row) => row.status === "low-stock").length,
      outOfStock: componentRows.filter((row) => row.status === "out-of-stock").length,
    }),
    [componentRows],
  );

  const rowsByOrder = useMemo(() => {
    return loadedOrders
      .map((order) => ({
        order,
        rows: filteredRows.filter((row) => row.sourceOrderId === order.salesorder_id),
      }))
      .filter((entry) => entry.rows.length);
  }, [filteredRows, loadedOrders]);

  const loadedRowsByOrder = useMemo(() => {
    return loadedOrders.map((order) => ({
      order,
      rows: rows.filter((row) => row.sourceOrderId === order.salesorder_id),
    }));
  }, [loadedOrders, rows]);

  useEffect(() => {
    let cancelled = false;

    async function generateQrPreviews() {
      if (!rowsByOrder.length) {
        setQrPreviewUrls({});
        return;
      }

      const entries = await Promise.all(
        rowsByOrder.map(async ({ order, rows: orderRows }) => {
          const [bom, user] = await Promise.all([
            createQrImage(buildQrPayload("bom", order, orderRows)),
            createQrImage(buildQrPayload("user", order, orderRows)),
          ]);
          return [order.salesorder_id, { bom, user }] as const;
        }),
      );

      if (!cancelled) {
        setQrPreviewUrls(Object.fromEntries(entries));
      }
    }

    void generateQrPreviews();

    return () => {
      cancelled = true;
    };
  }, [rowsByOrder]);

  useEffect(() => {
    (window as any).__BOM_CONTEXT__ = {
      page: "dashboard",
      stats,
      orders: loadedOrders.map((o) => ({
        number: o.salesorder_number,
        customer: o.customer_name,
        status: o.status,
      })),
      criticalComponents: filteredRows
        .filter((r) => r.status === "out-of-stock" || r.status === "low-stock")
        .slice(0, 30)
        .map((r) => ({
          name: r.itemName,
          sku: r.sku,
          status: r.status,
          qty: r.actualQuantity,
          uom: r.unit,
        })),
    };
  }, [stats, loadedOrders, filteredRows]);

  async function searchOrders() {
    setError("");
    setMessage("");
    setRows([]);
    setLoadedOrders([]);
    setSelectedOrderIds([]);
    setLoadState("searching");

    try {
      const body = await fetchJson<{ salesorders: SalesOrderSummary[] }>(
        `/api/zoho/salesorders?q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}`,
      );
      setOrders(body.salesorders);
      setMessage(body.salesorders.length ? "Select one or more orders, then load the BOM report." : "No sales orders found.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not search sales orders.");
    } finally {
      setLoadState("idle");
    }
  }

  function toggleOrder(orderId: string) {
    setSelectedOrderIds((current) =>
      current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId],
    );
  }

  async function fetchReportForOrderIds(orderIds: string[]) {
    try {
      const { orders: nextOrders, rows: reportRows } = await loadBomReportForOrders(orderIds);
      setLoadedOrders(nextOrders);
      setRows(reportRows);
      setLastRefreshedAt(new Date());
      if (autoRefreshEnabled) {
        setNextRefreshAt(new Date(Date.now() + 10 * 60 * 1000));
      }
      const componentCount = reportRows.filter((row) => row.rowType === "component" || row.rowType === "plain").length;
      setMessage(`Loaded ${componentCount} component${componentCount === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load selected orders.");
      throw err;
    }
  }

  async function loadSelectedOrders() {
    setError("");
    setMessage("");
    setLoadState("loading");

    try {
      // Fetch orders first to resolve raw materials
      const orderResults = await Promise.all(
        selectedOrderIds.map(async (id) => {
          const resp = await fetch(`/api/zoho/salesorders/${id}`, { cache: "no-store" });
          const body = await resp.json();
          if (!resp.ok || !body.salesorder) {
            console.error(`[RawMat] Failed to fetch order ${id}: status=${resp.status}`, JSON.stringify(body));
            return null;
          }
          return body.salesorder as SalesOrderDetail;
        }),
      );
      const orderDetails = orderResults.filter((o): o is SalesOrderDetail => o !== null);
      if (orderDetails.length === 0) {
        // Fallback: skip raw material popup and load BOM directly
        console.warn("[RawMat] Could not fetch order details for raw material resolution, loading BOM directly...");
        await fetchReportForOrderIds(selectedOrderIds);
        return;
      }

      const itemsCache: Record<string, import("@/lib/types").ItemDetail | null> = {};
      const compositesCache: Record<string, import("@/lib/types").CompositeItemDetail | null> = {};

      setMessage("Resolving raw materials...");
      const selection = await resolveRawMaterials(orderDetails, itemsCache, compositesCache);

      if (selection.stoneGroups.length > 0 || selection.profileGroups.length > 0) {
        // Show modal for raw material selection — store orders so we don't refetch
        setRawMatOrders(orderDetails);
        setRawMatSelection(selection);
        setRawMatModal(true);
        setLoadState("idle");

        // Auto-load dropdown for groups where default was not found (changed=true)
        for (const g of selection.stoneGroups) {
          if (g.changed) {
            setRawMatDropdownLoading((prev) => ({ ...prev, [g.key]: true }));
            void searchStoneItems(g.finish, g.thickness, g.defaultStoneId).then((items) => {
              const mapped = items.map((i) => {
                const sqftStr = getCfValue(i, "cf_sqft");
                let stoneSqft = parseFloat(sqftStr) || 0;
                if (stoneSqft <= 0) {
                  const h = parseFloat(getCfValue(i, "cf_height")) || 0;
                  const w = parseFloat(getCfValue(i, "cf_width")) || 0;
                  stoneSqft = (h * w) / (304.8 * 304.8);
                }
                stoneSqft = Math.round(stoneSqft * 100) / 100;
                return { id: i.item_id, name: i.name || i.item_name || "", sku: i.sku || "", sqft: stoneSqft };
              });

              setRawMatDropdownItems((prev) => ({
                ...prev,
                [g.key]: mapped,
              }));
              setRawMatDropdownLoading((prev) => ({ ...prev, [g.key]: false }));
            });
          }
        }

        return; // Wait for user to confirm via modal
      }

      // No raw materials to select — load BOM directly
      await fetchReportForOrderIds(selectedOrderIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load selected orders.");
    } finally {
      setLoadState("idle");
    }
  }

  async function handleRawMatConfirm() {
    if (!rawMatSelection) return;
    setRawMatLoading(true);
    setError("");

    try {
      // Use orders stored from initial fetch (avoid refetching / rate limits)
      const firstOrder = rawMatOrders[0];
      if (!firstOrder) {
        setError("Could not fetch sales order details. Please try again.");
        setRawMatLoading(false);
        return;
      }
      const orderId = firstOrder.salesorder_id || selectedOrderIds[0] || "";
      const soNumber = firstOrder.salesorder_number || "";

      // Apply stone changes for ALL groups:
      //   Scenario 2 (unchanged): update all panels to default stone
      //   Scenario 1 (changed): clone entire tree with new stone
      for (const group of rawMatSelection.stoneGroups) {
        console.log(`[RawMat] Stone group "${group.key}": changed=${group.changed} newStoneId="${group.newStoneId}" defaultStoneId="${group.defaultStoneId}" carcasses=${group.carcassItemIds.length}`);
        if (group.changed) {
          setMessage(`Cloning BOM tree with new stone: ${group.newStoneName}...`);
        } else {
          setMessage(`Applying default stone: ${group.defaultStoneName} to all panels...`);
        }
        const result = await applyStoneChange(group, soNumber, orderId, firstOrder);
        if (!result.success) {
          setError(`Failed to update stone: ${result.error}`);
          setRawMatLoading(false);
          return;
        }
      }

      // Apply profile changes
      for (const group of rawMatSelection.profileGroups) {
        if (group.changed && group.newProfileId) {
          setMessage(`Cloning BOM tree with new profile: ${group.newProfileName}...`);
          const result = await applyProfileChange(group, soNumber, orderId, firstOrder);
          if (!result.success) {
            setError(`Failed to update profile: ${result.error}`);
            setRawMatLoading(false);
            return;
          }
        }
      }

      // Close modal and load BOM
      setRawMatModal(false);
      setRawMatSelection(null);
      setLoadState("loading");
      await fetchReportForOrderIds(selectedOrderIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply raw material changes.");
    } finally {
      setRawMatLoading(false);
      setLoadState("idle");
    }
  }

  function handleStoneGroupToggle(groupKey: string) {
    if (!rawMatSelection) return;
    const updated = { ...rawMatSelection };
    updated.stoneGroups = updated.stoneGroups.map((g) => {
      if (g.key === groupKey) {
        // Cannot uncheck if default stone was not found — change is mandatory
        if (g.changed && !g.defaultStoneId) return g;
        const toggled = !g.changed;
        if (toggled && !rawMatDropdownItems[groupKey]) {
          // Fetch items for dropdown
          setRawMatDropdownLoading((prev) => ({ ...prev, [groupKey]: true }));
          void searchStoneItems(g.finish, g.thickness, g.defaultStoneId).then((items) => {
            const mapped = items.map((i) => {
              const sqftStr = getCfValue(i, "cf_sqft");
              let stoneSqft = parseFloat(sqftStr) || 0;
              if (stoneSqft <= 0) {
                const h = parseFloat(getCfValue(i, "cf_height")) || 0;
                const w = parseFloat(getCfValue(i, "cf_width")) || 0;
                stoneSqft = (h * w) / (304.8 * 304.8);
              }
              stoneSqft = Math.round(stoneSqft * 100) / 100;
              return { id: i.item_id, name: i.name || i.item_name || "", sku: i.sku || "", sqft: stoneSqft };
            });

            setRawMatDropdownItems((prev) => ({
              ...prev,
              [groupKey]: mapped,
            }));
            setRawMatDropdownLoading((prev) => ({ ...prev, [groupKey]: false }));
          });
        }
        return { ...g, changed: toggled, newStoneId: "", newStoneName: "" };
      }
      return g;
    });
    setRawMatSelection(updated);
  }

  function handleStoneSelect(groupKey: string, itemId: string, itemName: string, itemSqft: number) {
    if (!rawMatSelection) return;
    const updated = { ...rawMatSelection };
    updated.stoneGroups = updated.stoneGroups.map((g) => {
      if (g.key === groupKey) {
        return {
          ...g,
          newStoneId: itemId,
          newStoneName: itemName,
          newStoneSqft: itemSqft,
          customPcs: undefined, // reset user override when stone changes
        };
      }
      return g;
    });
    setRawMatSelection(updated);
  }

  function handlePcsChange(groupKey: string, val: string) {
    if (!rawMatSelection) return;
    const updated = { ...rawMatSelection };
    updated.stoneGroups = updated.stoneGroups.map((g) => {
      if (g.key === groupKey) return { ...g, customPcs: val };
      return g;
    });
    setRawMatSelection(updated);
  }

  function handleProfileGroupToggle(groupKey: string) {
    if (!rawMatSelection) return;
    const updated = { ...rawMatSelection };
    updated.profileGroups = updated.profileGroups.map((g) => {
      if (g.key === groupKey) {
        const toggled = !g.changed;
        if (toggled && !rawMatDropdownItems[groupKey]) {
          setRawMatDropdownLoading((prev) => ({ ...prev, [groupKey]: true }));
          void searchProfileItems(g.finish, g.profileCode).then((items) => {
            setRawMatDropdownItems((prev) => ({
              ...prev,
              [groupKey]: items.map((i) => ({ id: i.item_id, name: i.name || i.item_name || "", sku: i.sku || "" })),
            }));
            setRawMatDropdownLoading((prev) => ({ ...prev, [groupKey]: false }));
          });
        }
        return { ...g, changed: toggled, newProfileId: "", newProfileName: "" };
      }
      return g;
    });
    setRawMatSelection(updated);
  }

  function handleProfileSelect(groupKey: string, itemId: string, itemName: string) {
    if (!rawMatSelection) return;
    const updated = { ...rawMatSelection };
    updated.profileGroups = updated.profileGroups.map((g) => {
      if (g.key === groupKey) return { ...g, newProfileId: itemId, newProfileName: itemName };
      return g;
    });
    setRawMatSelection(updated);
  }

  async function refreshLoadedReport() {
    if (!loadedOrders.length || refreshing) return;

    setRefreshing(true);
    setError("");
    try {
      await fetchReportForOrderIds(loadedOrders.map((order) => order.salesorder_id));
    } catch {
      // Error state is already shown by fetchReportForOrderIds.
    } finally {
      setRefreshing(false);
    }
  }

  function exportCsv() {
    exportBomCsv(filteredRows);
  }

  function exportExcel() {
    exportBomWorkbook(filteredRows, buildAccessoryExportRows());
  }

  function downloadPackingList(order: SalesOrderDetail, orderRows: BomReportRow[], group: string) {
    const html = buildPackingListHtml(order, orderRows, group);
    const filename = `${sanitizeFilename(order.salesorder_number)}-${sanitizeFilename(group)}-packing-list.xls`;
    downloadBlob(filename, new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }));
  }

  async function downloadLabels(order: SalesOrderDetail, orderRows: BomReportRow[], group: string) {
    const blob = await buildLabelsPdf(order, orderRows, group);
    const filename = `${sanitizeFilename(order.salesorder_number)}-${sanitizeFilename(group)}-labels.pdf`;
    downloadBlob(filename, blob);
  }

  async function handlePackingDownload(mode: "packing" | "labels") {
    const group = packingGroup;
    if (!group) return;
    for (const soId of packingSelectedOrderIds) {
      const order = loadedOrders.find((o) => o.salesorder_id === soId);
      if (!order) continue;
      const orderRows = rows.filter((r) => r.sourceOrderId === soId);
      if (mode === "packing") {
        downloadPackingList(order, orderRows, group);
      } else {
        await downloadLabels(order, orderRows, group);
      }
    }
  }

  function makeAccessoryRow(nextId: number): AccessorySubformRow {
    return {
      id: nextId,
      soId: loadedOrders.length === 1 ? loadedOrders[0].salesorder_id : "",
      itemIds: [],
      accessories: createAccessoryEntries(),
    };
  }

  function addAccessoryRow() {
    const nextId = accessoryCounter + 1;
    setAccessoryCounter(nextId);
    setAccessoryRows((current) => [...current, makeAccessoryRow(nextId)]);
    setAccessoryMessage("");
  }

  function updateAccessoryRow(rowId: number, updater: (row: AccessorySubformRow) => AccessorySubformRow) {
    setAccessoryRows((current) => current.map((row) => (row.id === rowId ? updater(row) : row)));
    setAccessoryMessage("");
  }

  function removeAccessoryRow(rowId: number) {
    setAccessoryRows((current) => current.filter((row) => row.id !== rowId));
    setAccessoryMessage("");
  }

  function isAccessoryUsedForItems(accKey: AccessoryKey, itemIds: string[], excludeRowId: number): boolean {
    return accessoryRows.some(
      (row) =>
        row.id !== excludeRowId &&
        row.accessories[accKey]?.enabled &&
        row.itemIds.some((id) => itemIds.includes(id)),
    );
  }

  function getCarcassItemsForOrder(soId: string): BomReportRow[] {
    const entry = loadedRowsByOrder.find(({ order }) => order.salesorder_id === soId);
    if (!entry) return [];
    return entry.rows.filter(
      (row) => row.rowType === "master" && (row.cfGroup.toLowerCase().includes("carcass") || row.masterGroup.toLowerCase().includes("carcass")),
    );
  }

  function getRowWidthMm(soId: string, itemIds: string[]): number {
    const items = getCarcassItemsForOrder(soId);
    return items
      .filter((item) => itemIds.includes(item.itemId))
      .reduce((sum, item) => sum + (parseFloat(item.cfWidth) || 0), 0);
  }

  function getRowTotalMeters(soId: string, itemIds: string[]): number {
    const widthMm = getRowWidthMm(soId, itemIds);
    return parseFloat((widthMm / 1000).toFixed(3));
  }

  function getApplicableAccessories(row: AccessorySubformRow): AccessoryItem[] {
    const items = getCarcassItemsForOrder(row.soId).filter((item) => row.itemIds.includes(item.itemId));
    if (!items.length) return ACCESSORY_ITEMS;
    return ACCESSORY_ITEMS.filter((accessory) =>
      items.some((item) => accessory.condition(item.cfSubGroup || item.cfGroup, item.cfType)),
    );
  }

  function saveAccessorySubform() {
    window.localStorage.setItem("bom_accessory_subform_rows", JSON.stringify(accessoryRows));
    window.localStorage.setItem("bom_accessory_subform_counter", String(accessoryCounter));
    setAccessoryMessage("Accessories Subform saved locally.");
  }

  function buildAccessoryExportRows(): AccessoryExportRow[] {
    const out: AccessoryExportRow[] = [];
    accessoryRows.forEach((row) => {
      const order = loadedOrders.find((entry) => entry.salesorder_id === row.soId);
      if (!order || !row.itemIds.length) return;
      const items = getCarcassItemsForOrder(row.soId).filter((item) => row.itemIds.includes(item.itemId));
      const itemNames = items.map((item) => item.itemName).join(", ");
      const total = getRowTotalMeters(row.soId, row.itemIds);
      ACCESSORY_ITEMS.forEach((accessory) => {
        const entry = row.accessories[accessory.key];
        if (!entry.enabled) return;
        const itemName = [accessory.label, entry.elevation, entry.size].filter(Boolean).join(" ");
        out.push({
          SO: order.salesorder_number,
          "Carcass Items": itemNames,
          Accessory: accessory.label,
          Selected: "Yes",
          "Item Name": itemName,
          Size: entry.size,
          Elevation: entry.elevation,
          Total: total,
          "Actual Qty": entry.actualQty ?? total,
          "Zoho Item ID": accessory.itemId,
        });
      });
    });
    return out;
  }

  async function updateExistingSOs() {
    setUpdatingSO(true);
    setUpdateMessage({ kind: "info", text: "Preparing updates..." });

    try {
      const bySO = new Map<string, AccessorySubformRow[]>();
      accessoryRows.forEach((row) => {
        if (!row.soId || !row.itemIds.length) return;
        const hasEnabled = ACCESSORY_ITEMS.some((acc) => row.accessories[acc.key]?.enabled);
        if (!hasEnabled) return;
        if (!bySO.has(row.soId)) bySO.set(row.soId, []);
        bySO.get(row.soId)!.push(row);
      });

      if (!bySO.size) {
        setUpdateMessage({ kind: "info", text: "No accessories selected. Toggle at least one accessory to Yes." });
        return;
      }

      let updatedCount = 0;
      for (const [soId, soRows] of bySO) {
        const order = loadedOrders.find((entry) => entry.salesorder_id === soId);
        if (!order) continue;

        setUpdateMessage({ kind: "info", text: `Updating ${order.salesorder_number}...` });

        const fresh = await fetchJson<{ salesorder: SalesOrderDetail }>(`/api/zoho/salesorders/${soId}`);
        const existingLineItems = (fresh.salesorder.line_items ?? []).map((li) => ({
          line_item_id: li.line_item_id,
          item_id: li.item_id,
          name: li.name,
          description: li.description ?? "",
          rate: li.rate,
          quantity: li.quantity,
          unit: li.unit,
          item_total: li.item_total,
        }));

        const newLines: Array<{ item_id: string; name: string; description: string; quantity: number }> = [];
        soRows.forEach((row) => {
          ACCESSORY_ITEMS.forEach((accessory) => {
            const entry = row.accessories[accessory.key];
            if (!entry?.enabled) return;
            const qty = entry.actualQty ?? getRowTotalMeters(row.soId, row.itemIds);
            const carcNames = row.itemIds
              .map((id) => {
                const carc = getCarcassItemsForOrder(row.soId).find((c) => c.itemId === id);
                return carc?.itemName ?? id;
              })
              .join(", ");
            const parts: string[] = [];
            if (entry.elevation) parts.push(`Elev: ${entry.elevation}`);
            if (entry.size) parts.push(`Size: ${entry.size}`);
            if (carcNames) parts.push(`For: ${carcNames}`);
            newLines.push({
              item_id: accessory.itemId,
              name: accessory.label,
              description: parts.join(" | "),
              quantity: qty,
            });
          });
        });

        if (!newLines.length) continue;

        const payload = { line_items: [...existingLineItems, ...newLines] };
        await fetchJson(`/api/zoho/salesorders/${soId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        updatedCount++;
      }

      setUpdateMessage({ kind: "ok", text: `✓ Updated ${updatedCount} SO${updatedCount === 1 ? "" : "s"}.` });
    } catch (err) {
      setUpdateMessage({
        kind: "err",
        text: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setUpdatingSO(false);
    }
  }

  function buildQrPayload(kind: QrKind, order: SalesOrderDetail, orderRows: BomReportRow[]) {
    if (kind === "bom") {
      const leafRows = orderRows.filter((row) => row.rowType === "component" || row.rowType === "plain");
      const lines = [
        `SO: ${order.salesorder_number}`,
        `Cust: ${order.customer_name}`,
        `Date: ${order.date ?? "-"}`,
        ``,
        ...leafRows.map((row) => `- ${row.itemName} x${row.actualQuantity}`),
      ];
      return lines.join("\n");
    }

    return JSON.stringify({
      type: "USER_DETAILS",
      salesOrder: order.salesorder_number,
      salesOrderId: order.salesorder_id,
      customerId: order.customer_id,
      customerName: order.customer_name,
      email: order.email,
      date: order.date,
      status: order.status,
      referenceNumber: order.reference_number,
      salesperson: order.salesperson_name,
      billingAddress: order.billing_address,
      shippingAddress: order.shipping_address,
      contactPersons: order.contact_person_details,
    });
  }

  async function createQrImage(payload: string) {
    return QRCode.toDataURL(payload, {
      errorCorrectionLevel: "L",
      margin: 2,
      scale: 8,
      color: { dark: "#171714", light: "#ffffff" },
    });
  }

  async function handleQrAction(
    kind: QrKind,
    action: "view" | "download",
    order: SalesOrderDetail,
    orderRows: BomReportRow[],
  ) {
    const key = `${action}-${kind}-${order.salesorder_id}`;
    setQrBusyKey(key);
    try {
      const payload = buildQrPayload(kind, order, orderRows);
      const imageUrl = await createQrImage(payload);
      const label = kind === "bom" ? "BOM Items" : "User Details";
      const filename = `${order.salesorder_number}-${kind === "bom" ? "bom-items" : "user-details"}-qr.png`;

      if (action === "download") {
        const response = await fetch(imageUrl);
        downloadBlob(filename, await response.blob());
        return;
      }

      setQrModal({
        title: `${label} QR Code`,
        subtitle: `${order.salesorder_number} · ${order.customer_name}`,
        imageUrl,
        filename,
        kind,
        rows: orderRows,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate QR code.");
    } finally {
      setQrBusyKey("");
    }
  }

  const busy = loadState !== "idle";
  const showingReport = rows.length > 0;
  const selectedOrderCount = showingReport ? loadedOrders.length : selectedOrderIds.length;

  return (
    <div className="app-shell">
      <section className="widget-frame">
        <header className="widget-title">
          <h1>BOM Backorder Report</h1>
        </header>

        <div className="widget-actionbar">
          <div className="widget-action-title">
            <strong>BOM Backorder Report</strong>
            <span>{selectedOrderCount || 0} Sales Order · BOM Report</span>
          </div>
          <div className="widget-actions">
            <button className="dark-tool" disabled>
              DBG
            </button>
            <button className="dark-tool" disabled={!filteredRows.length} onClick={exportExcel}>
              <span>↓</span>
              Excel
            </button>
            <button className="dark-tool" disabled={!filteredRows.length} onClick={exportCsv}>
              <span>↓</span>
              CSV
            </button>
            <button className="dark-tool" onClick={() => setDraftPoOpen(true)}>
              + Draft PO from SO
            </button>
            <a className="dark-tool" href="/reorder" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Re-order Report
            </a>
            <a className="dark-tool" href="/builder" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Carcass Builder
            </a>
            <button className="dark-tool" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </div>

        <div className="widget-tabs">
          <button className={activeTab === "bom" ? "tab active" : "tab"} onClick={() => setActiveTab("bom")}>
            BOM Report
          </button>
          <button className={activeTab === "accessories" ? "tab active" : "tab"} onClick={() => setActiveTab("accessories")}>
            Accessories Subform
          </button>
        </div>

        <section className="summary-strip" aria-label="BOM report summary">
          <div className="summary-cell purple">
            <strong>{selectedOrderCount || 0}</strong>
            <span>Sales Orders</span>
          </div>
          <div className="summary-cell blue">
            <strong>{stats.total}</strong>
            <span>Components</span>
          </div>
          <div className="summary-cell red">
            <strong>{stats.outOfStock}</strong>
            <span>Out of Stock</span>
          </div>
          <div className="summary-cell gold">
            <strong>{stats.lowStock}</strong>
            <span>Low Stock</span>
          </div>
          <div className="summary-cell green">
            <strong>{stats.inStock}</strong>
            <span>Fulfilled</span>
          </div>
        </section>

        <main className="main">
          <section className={`panel search-panel ${showingReport ? "compact-search" : ""}`}>
            <div className={`connection ${connection?.ok ? "ok" : connection ? "bad" : ""}`}>
              <strong>
                {connectionLoading ? "Checking Zoho Inventory..." : connection?.ok ? "Live Zoho Inventory connected" : "Zoho Inventory not connected"}
              </strong>
              <span>
                {connection?.ok
                  ? `${connection.organizationName ?? "Organization"} (${connection.organizationId})`
                  : connection?.error ?? "Connection status will appear here."}
              </span>
              <small className="connection-refresh">
                {autoRefreshEnabled
                  ? `Auto refresh: 10 min${nextRefreshAt ? ` · Next ${nextRefreshAt.toLocaleTimeString()}` : ""}`
                  : "Auto refresh: off"}
              </small>
              <button className="connection-check" disabled={connectionLoading} onClick={checkConnection}>
                {connectionLoading ? "Checking" : "Check"}
              </button>
            </div>

            {!showingReport ? (
              <div className="search-row">
                <div className="field">
                  <label htmlFor="order-query">Sales order number or customer</label>
                  <input
                    className="input"
                    id="order-query"
                    minLength={2}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && query.trim().length >= 2) searchOrders();
                    }}
                    placeholder="Example: SO-00011 or customer name"
                    value={query}
                  />
                </div>
                <div className="field">
                  <label htmlFor="order-status">Status</label>
                  <select className="select" id="order-status" onChange={(event) => setStatus(event.target.value)} value={status}>
                    <option value="">All statuses</option>
                    <option value="draft">Draft</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="sent">Sent</option>
                    <option value="void">Void</option>
                  </select>
                </div>
                <button className="button dark" disabled={busy || query.trim().length < 2} onClick={searchOrders}>
                  {loadState === "searching" ? "Searching..." : "Search Orders"}
                </button>
              </div>
            ) : null}

            {error ? <div className="message error">{error}</div> : null}
            {!showingReport && message ? <div className="message info">{message}</div> : null}

            {!showingReport && orders.length ? (
              <>
                <div className="orders-grid">
                  {orders.map((order) => (
                    <label className="order-card" key={order.salesorder_id}>
                      <input
                        checked={selectedOrderIds.includes(order.salesorder_id)}
                        onChange={() => toggleOrder(order.salesorder_id)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{order.salesorder_number}</strong>
                        <span>{order.customer_name}</span>
                        <span>{order.status}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <button className="button" disabled={busy || !selectedOrderIds.length} onClick={loadSelectedOrders}>
                  {loadState === "loading" ? "Loading BOM..." : `Load Selected (${selectedOrderIds.length})`}
                </button>
              </>
            ) : null}
          </section>

          <section className="bom-stage">
            {showingReport && activeTab === "bom" ? (
              <>
                <div className="report-controls">
                  <div className="refresh-bar">
                    <div>
                      <strong>{refreshing ? "Refreshing live Zoho data..." : "Auto refresh every 10 minutes"}</strong>
                      <span>
                        {lastRefreshedAt ? `Last updated ${lastRefreshedAt.toLocaleTimeString()}` : "Refresh starts after loading orders"}
                        {nextRefreshAt && autoRefreshEnabled ? ` · Next ${nextRefreshAt.toLocaleTimeString()}` : ""}
                      </span>
                    </div>
                    <label className="refresh-toggle">
                      <input
                        checked={autoRefreshEnabled}
                        onChange={(event) => setAutoRefreshEnabled(event.target.checked)}
                        type="checkbox"
                      />
                      Auto
                    </label>
                    <button className="refresh-now" disabled={refreshing} onClick={refreshLoadedReport}>
                      {refreshing ? "Refreshing" : "Refresh Now"}
                    </button>
                  </div>
                  <input
                    className="report-search"
                    onChange={(event) => setItemFilter(event.target.value)}
                    placeholder="Search name, SKU..."
                    value={itemFilter}
                  />
                  <div className="report-filter-row">
                    <div className="filter-pills" aria-label="Stock filters">
                      <button className={stockFilter === "all" ? "pill active" : "pill"} onClick={() => setStockFilter("all")}>
                        All
                      </button>
                      <button
                        className={stockFilter === "out-of-stock" ? "pill active" : "pill"}
                        onClick={() => setStockFilter("out-of-stock")}
                      >
                        Out of Stock
                      </button>
                      <button
                        className={stockFilter === "low-stock" ? "pill active" : "pill"}
                        onClick={() => setStockFilter("low-stock")}
                      >
                        Low Stock
                      </button>
                      <button
                        className={stockFilter === "in-stock" ? "pill active" : "pill"}
                        onClick={() => setStockFilter("in-stock")}
                      >
                        In Stock
                      </button>
                    </div>
                    <button
                      className="change-orders"
                      onClick={() => {
                        setRows([]);
                        setLoadedOrders([]);
                        setStockFilter("all");
                      }}
                    >
                      ← Change Orders
                    </button>
                  </div>
                  <div className="component-count">
                    {filteredRows.filter((row) => row.rowType === "component" || row.rowType === "plain").length} components
                  </div>
                </div>

                <div className="bom-cards">
                  {rowsByOrder.map(({ order, rows: orderRows }) => (
                    <BomOrderCard
                      key={order.salesorder_id}
                      order={order}
                      rows={orderRows}
                      headerActions={
                        <div className="so-qr-actions" aria-label={`QR codes for ${order.salesorder_number}`}>
                          <div className="so-qr-group">
                            {qrPreviewUrls[order.salesorder_id]?.bom ? (
                              <img alt="BOM items QR" className="so-qr-image" src={qrPreviewUrls[order.salesorder_id]?.bom} />
                            ) : (
                              <span className="so-qr-placeholder" aria-hidden="true" />
                            )}
                            <div className="so-qr-meta">
                              <span>BOM QR</span>
                              <div>
                                <button
                                  className="so-qr-button"
                                  disabled={qrBusyKey === `view-bom-${order.salesorder_id}`}
                                  onClick={() => handleQrAction("bom", "view", order, orderRows)}
                                >
                                  View
                                </button>
                                <button
                                  className="so-qr-button"
                                  disabled={qrBusyKey === `download-bom-${order.salesorder_id}`}
                                  onClick={() => handleQrAction("bom", "download", order, orderRows)}
                                >
                                  Download
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="so-qr-group">
                            {qrPreviewUrls[order.salesorder_id]?.user ? (
                              <img alt="User details QR" className="so-qr-image" src={qrPreviewUrls[order.salesorder_id]?.user} />
                            ) : (
                              <span className="so-qr-placeholder" aria-hidden="true" />
                            )}
                            <div className="so-qr-meta">
                              <span>User QR</span>
                              <div>
                                <button
                                  className="so-qr-button"
                                  disabled={qrBusyKey === `view-user-${order.salesorder_id}`}
                                  onClick={() => handleQrAction("user", "view", order, orderRows)}
                                >
                                  View
                                </button>
                                <button
                                  className="so-qr-button"
                                  disabled={qrBusyKey === `download-user-${order.salesorder_id}`}
                                  onClick={() => handleQrAction("user", "download", order, orderRows)}
                                >
                                  Download
                                </button>
                              </div>
                            </div>
                          </div>
                          <button
                            className="packing-list-button"
                            onClick={() => {
                              const allRows = rows.filter((r) => isPackingListRow(r));
                              const groups = getPackingGroups(allRows);
                              setPackingGroup(groups[0] || "");
                              setPackingSelectedOrderIds([order.salesorder_id]);
                              setPackingModalOpen(true);
                            }}
                          >
                            Packing List
                          </button>
                        </div>
                      }
                    />
                  ))}
                </div>
              </>
            ) : showingReport && activeTab === "accessories" ? (
              <section className="accessory-panel">
                <div className="accessory-toolbar">
                  <div>
                    <strong>Accessories Subform</strong>
                    <span>Select Carcass items (combined width ≤ 3000mm), toggle accessories, then update existing SOs.</span>
                  </div>
                  {updateMessage ? (
                    <span className={`update-status ${updateMessage.kind}`}>{updateMessage.text}</span>
                  ) : null}
                  <button className="accessory-tool" onClick={addAccessoryRow}>
                    Add Row
                  </button>
                  <button className="accessory-tool" disabled={!accessoryRows.length} onClick={saveAccessorySubform}>
                    Save
                  </button>
                  <button
                    className="accessory-tool update-so"
                    disabled={!accessoryRows.length || updatingSO}
                    onClick={updateExistingSOs}
                  >
                    {updatingSO ? "Updating..." : "↑ Update SO"}
                  </button>
                </div>
                {accessoryMessage ? <div className="message info">{accessoryMessage}</div> : null}
                <div className="accessory-table-wrap">
                  <table className="accessory-table">
                    <thead>
                      <tr>
                        <th />
                        <th>SO</th>
                        <th>Carcass Items</th>
                        <th>Accessory</th>
                        <th>Size</th>
                        <th>Elevation</th>
                        <th>Total (m)</th>
                        <th>Actual Qty</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {accessoryRows.length ? (
                        accessoryRows.map((row) => {
                          const availableItems = getCarcassItemsForOrder(row.soId);
                          const applicableAccessories = getApplicableAccessories(row);
                          const enabledAccessories = applicableAccessories.filter((acc) => row.accessories[acc.key]?.enabled);
                          const visibleAccessories: Array<AccessoryItem | null> = enabledAccessories.length
                            ? enabledAccessories
                            : [null];
                          const widthMm = getRowWidthMm(row.soId, row.itemIds);
                          const widthOver = widthMm > 3000;
                          const totalMeters = getRowTotalMeters(row.soId, row.itemIds);

                          return visibleAccessories.map((accessory, index) => (
                            <tr className={index > 0 ? "accessory-sub-row" : ""} key={`${row.id}-${accessory?.key ?? "empty"}`}>
                              {index === 0 ? (
                                <>
                                  <td rowSpan={visibleAccessories.length}>
                                    <span className="accessory-row-num">{row.id}</span>
                                  </td>
                                  <td rowSpan={visibleAccessories.length}>
                                    <select
                                      className="accessory-select"
                                      onChange={(event) =>
                                        updateAccessoryRow(row.id, () => ({
                                          ...row,
                                          soId: event.target.value,
                                          itemIds: [],
                                          accessories: createAccessoryEntries(),
                                        }))
                                      }
                                      value={row.soId}
                                    >
                                      <option value="">Select SO</option>
                                      {loadedOrders.map((order) => (
                                        <option key={order.salesorder_id} value={order.salesorder_id}>
                                          {order.salesorder_number}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td rowSpan={visibleAccessories.length}>
                                    {row.soId ? (
                                      <div>
                                        <select
                                          className="accessory-select accessory-items-select"
                                          multiple
                                          onChange={(event) => {
                                            const selected = Array.from(event.target.selectedOptions).map((opt) => opt.value);
                                            const testWidth = selected
                                              .map((id) => availableItems.find((c) => c.itemId === id)?.cfWidth ?? "0")
                                              .reduce((sum, w) => sum + (parseFloat(w) || 0), 0);
                                            if (testWidth > 3000) {
                                              setError("Combined width exceeds 3000mm.");
                                              return;
                                            }
                                            setError("");
                                            updateAccessoryRow(row.id, (current) => {
                                              const applicable = ACCESSORY_ITEMS.filter((acc) =>
                                                availableItems
                                                  .filter((it) => selected.includes(it.itemId))
                                                  .some((it) => acc.condition(it.cfSubGroup || it.cfGroup, it.cfType)),
                                              ).map((a) => a.key);
                                              const accessories = { ...current.accessories };
                                              ACCESSORY_ITEMS.forEach((item) => {
                                                if (!applicable.includes(item.key)) {
                                                  accessories[item.key] = { ...accessories[item.key], enabled: false };
                                                }
                                              });
                                              return { ...current, itemIds: selected, accessories };
                                            });
                                          }}
                                          value={row.itemIds}
                                        >
                                          {availableItems.map((item) => (
                                            <option key={item.itemId} value={item.itemId}>
                                              {item.itemName}
                                              {item.cfWidth ? ` (${item.cfWidth}mm)` : ""}
                                            </option>
                                          ))}
                                        </select>
                                        {row.itemIds.length ? (
                                          <span className={`width-badge ${widthOver ? "err" : ""}`}>
                                            {widthMm}mm → {(widthMm / 1000).toFixed(3)}m{widthOver ? " ⚠ >3000" : ""}
                                          </span>
                                        ) : (
                                          <span className="accessory-help">
                                            {availableItems.length ? `${availableItems.length} carcass items available` : "No carcass items in this SO"}
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="accessory-muted">Select SO first</span>
                                    )}
                                  </td>
                                  <td rowSpan={visibleAccessories.length}>
                                    {row.soId && row.itemIds.length ? (
                                      <div className="accessory-toggle-list">
                                        {applicableAccessories.map((item) => {
                                          const entry = row.accessories[item.key];
                                          const duplicateBlocked = !entry.enabled && isAccessoryUsedForItems(item.key, row.itemIds, row.id);
                                          return (
                                            <label
                                              className={`accessory-toggle${entry.enabled ? " yes" : ""}${duplicateBlocked ? " blocked" : ""}`}
                                              key={item.key}
                                              title={duplicateBlocked ? "Already assigned to one of the selected items" : ""}
                                            >
                                              <input
                                                checked={entry.enabled}
                                                disabled={duplicateBlocked}
                                                onChange={(event) => {
                                                  const enabling = event.target.checked;
                                                  if (enabling && duplicateBlocked) return;
                                                  updateAccessoryRow(row.id, (current) => {
                                                    const accessories = { ...current.accessories };
                                                    if (enabling) {
                                                      const group = getExclusionGroup(item.key);
                                                      if (group) {
                                                        for (const gk of group) {
                                                          if (gk !== item.key) {
                                                            accessories[gk] = { ...accessories[gk], enabled: false };
                                                          }
                                                        }
                                                      }
                                                    }
                                                    accessories[item.key] = {
                                                      ...accessories[item.key],
                                                      enabled: enabling,
                                                      actualQty:
                                                        enabling && accessories[item.key].actualQty === null
                                                          ? getRowTotalMeters(current.soId, current.itemIds)
                                                          : accessories[item.key].actualQty,
                                                    };
                                                    return { ...current, accessories };
                                                  });
                                                }}
                                                type="checkbox"
                                              />
                                              {item.label}
                                            </label>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <span className="accessory-muted">Select items first</span>
                                    )}
                                  </td>
                                </>
                              ) : null}
                              {accessory ? (
                                <>
                                  <td>
                                    <input
                                      className="accessory-input"
                                      onChange={(event) =>
                                        updateAccessoryRow(row.id, (current) => ({
                                          ...current,
                                          accessories: {
                                            ...current.accessories,
                                            [accessory.key]: { ...current.accessories[accessory.key], size: event.target.value },
                                          },
                                        }))
                                      }
                                      placeholder="Size"
                                      value={row.accessories[accessory.key].size}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      className="accessory-input"
                                      onChange={(event) =>
                                        updateAccessoryRow(row.id, (current) => ({
                                          ...current,
                                          accessories: {
                                            ...current.accessories,
                                            [accessory.key]: { ...current.accessories[accessory.key], elevation: event.target.value },
                                          },
                                        }))
                                      }
                                      placeholder="Elevation"
                                      value={row.accessories[accessory.key].elevation}
                                    />
                                  </td>
                                  <td className="accessory-number">{totalMeters || "-"}</td>
                                  <td>
                                    <input
                                      className="accessory-input number"
                                      onChange={(event) =>
                                        updateAccessoryRow(row.id, (current) => ({
                                          ...current,
                                          accessories: {
                                            ...current.accessories,
                                            [accessory.key]: {
                                              ...current.accessories[accessory.key],
                                              actualQty: event.target.value === "" ? null : Number(event.target.value),
                                            },
                                          },
                                        }))
                                      }
                                      placeholder="-"
                                      step="0.001"
                                      type="number"
                                      value={row.accessories[accessory.key].actualQty ?? ""}
                                    />
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="accessory-muted">-</td>
                                  <td className="accessory-muted">-</td>
                                  <td className="accessory-number">{totalMeters || "-"}</td>
                                  <td className="accessory-muted">-</td>
                                </>
                              )}
                              {index === 0 ? (
                                <td rowSpan={visibleAccessories.length}>
                                  <button className="accessory-delete" onClick={() => removeAccessoryRow(row.id)}>
                                    ×
                                  </button>
                                </td>
                              ) : null}
                            </tr>
                          ));
                        })
                      ) : (
                        <tr>
                          <td className="accessory-empty" colSpan={9}>
                            Add a row to start the Accessories Subform.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <div className="empty panel">Search for sales orders, select them, and load the report.</div>
            )}
          </section>
        </main>
      </section>
      {qrModal ? (
        <div className="qr-modal-backdrop" role="presentation" onClick={() => setQrModal(null)}>
          <section className="qr-modal" role="dialog" aria-modal="true" aria-label={qrModal.title} onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>{qrModal.title}</h2>
                <p>{qrModal.subtitle}</p>
              </div>
              <button onClick={() => setQrModal(null)}>Close</button>
            </header>
            <img alt={qrModal.title} src={qrModal.imageUrl} />
            {qrModal.kind === "bom" ? (
              <div className="qr-item-list">
                <div className="qr-item-head">
                  <span>Item / Component</span>
                  <span>SKU</span>
                  <span>Type</span>
                  <span>SO Qty</span>
                  <span>Actual Qty</span>
                </div>
                {qrModal.rows.map((row, index) => (
                  <div className={`qr-item-row ${row.rowType}`} key={`${row.sourceOrderId}-${row.parentItemId ?? "root"}-${row.itemId}-${row.level}-${index}`}>
                    <span>{row.rowType !== "master" ? `- ${row.itemName}` : row.itemName}</span>
                    <span>{row.sku || "-"}</span>
                    <span>{row.typeLabel}</span>
                    <span>{row.quantityNeeded}</span>
                    <span>{row.actualQuantity}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <button
              className="qr-download-large"
              onClick={async () => {
                const response = await fetch(qrModal.imageUrl);
                downloadBlob(qrModal.filename, await response.blob());
              }}
            >
              Download QR
            </button>
          </section>
        </div>
      ) : null}
      {packingModalOpen ? (
        <div className="qr-modal-backdrop" role="presentation" onClick={() => setPackingModalOpen(false)}>
          <section className="packing-modal" role="dialog" aria-modal="true" aria-label="Packing List" onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <h2>Packing List & Labels</h2>
                <p>{packingSelectedOrderIds.length} order(s) selected</p>
              </div>
              <button onClick={() => setPackingModalOpen(false)}>Close</button>
            </header>
            <div className="packing-modal-body">
              {loadedOrders.length > 1 ? (
                <>
                  <label>Select Orders</label>
                  <div className="packing-order-list">
                    {loadedOrders.map((o) => (
                      <label key={o.salesorder_id} className="packing-order-item">
                        <input
                          type="checkbox"
                          checked={packingSelectedOrderIds.includes(o.salesorder_id)}
                          onChange={(e) => {
                            setPackingSelectedOrderIds((prev) =>
                              e.target.checked
                                ? [...prev, o.salesorder_id]
                                : prev.filter((id) => id !== o.salesorder_id),
                            );
                          }}
                        />
                        <strong>{o.salesorder_number}</strong>
                        <span>{o.customer_name}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : null}
              <label htmlFor="packing-group-select">Select Group</label>
              <select
                id="packing-group-select"
                value={packingGroup}
                onChange={(e) => setPackingGroup(e.target.value)}
              >
                {getPackingGroups(rows).map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <div className="packing-btn-row">
                <button
                  className="packing-download-btn"
                  disabled={!packingGroup || !packingSelectedOrderIds.length}
                  onClick={() => handlePackingDownload("packing")}
                >
                  Download Packing List
                </button>
                <button
                  className="packing-download-btn labels"
                  disabled={!packingGroup || !packingSelectedOrderIds.length}
                  onClick={() => handlePackingDownload("labels")}
                >
                  Print Labels
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* Raw Material Selection Modal */}
      {rawMatModal && rawMatSelection ? (
        <div className="qr-modal-backdrop" role="presentation" onClick={() => { setRawMatModal(false); setRawMatSelection(null); setRawMatOrders([]); }}>
          <section className="packing-modal" role="dialog" aria-modal="true" aria-label="Raw Material Selection" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <header>
              <div>
                <h2>Raw Material Selection</h2>
                <p>Select stone and profile raw materials before loading BOM</p>
              </div>
              <button type="button" onClick={() => { setRawMatModal(false); setRawMatSelection(null); setRawMatOrders([]); }}>✕</button>
            </header>
            <div className="packing-modal-body" style={{ maxHeight: "70vh", overflow: "auto", padding: "16px" }}>

              {(() => {
                const shutterStones = rawMatSelection.stoneGroups.filter((g) => g.category === "shutter");
                const carcassStones = rawMatSelection.stoneGroups.filter((g) => g.category === "carcass");
                const shutterProfiles = rawMatSelection.profileGroups.filter((g) => g.category === "shutter");
                const carcassProfiles = rawMatSelection.profileGroups.filter((g) => g.category === "carcass");

                const renderCategorySection = (cat: "shutter" | "carcass", stones: typeof shutterStones, profiles: typeof shutterProfiles) => {
                  if (stones.length === 0 && profiles.length === 0) return null;

                  const title = cat === "shutter" ? "Shutter" : "Carcass";

                  return (
                    <div style={{ marginBottom: 32 }} key={cat}>
                      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, borderBottom: "2px solid #e5e7eb", paddingBottom: 6, color: "#111827" }}>
                        {title}
                      </h3>

                      {stones.length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                          <h4 style={{ fontSize: 13, fontWeight: 600, color: "#4b5563", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Stone Selection
                          </h4>
                          {stones.map((group) => (
                            <div key={group.key} style={{ background: "#f9fafb", borderRadius: 8, padding: 14, marginBottom: 10, border: "1px solid #e5e7eb" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                <div>
                                  <strong style={{ fontSize: 14 }}>{group.finish} — {group.thickness}mm</strong>
                                  <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 12 }}>
                                    Total: {group.totalSqft.toFixed(2)} sqft (incl. waste)
                                  </span>
                                </div>
                                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={group.changed}
                                    disabled={group.changed && !group.defaultStoneId}
                                    onChange={() => handleStoneGroupToggle(group.key)}
                                  />
                                  {group.changed && !group.defaultStoneId ? "Change stone (required)" : "Change stone"}
                                </label>
                              </div>

                              {!group.changed ? (
                                <div style={{ fontSize: 13, color: "#374151", background: "#fff", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}>
                                  <span style={{ fontWeight: 600 }}>Default:</span> {group.defaultStoneName}
                                  {group.defaultStoneSku ? ` (${group.defaultStoneSku})` : ""}
                                </div>
                              ) : (
                                <div>
                                  {rawMatDropdownLoading[group.key] ? (
                                    <div style={{ fontSize: 13, color: "#6b7280", padding: 8 }}>Loading items...</div>
                                  ) : (
                                    <select
                                      value={group.newStoneId}
                                      onChange={(e) => {
                                        const sel = rawMatDropdownItems[group.key]?.find((i) => i.id === e.target.value);
                                        handleStoneSelect(group.key, e.target.value, sel?.name || "", (sel as any)?.sqft || 0);
                                      }}
                                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
                                    >
                                      <option value="">Select stone...</option>
                                      {(rawMatDropdownItems[group.key] || []).map((item) => (
                                        <option key={item.id} value={item.id}>
                                          {item.name} {item.sku ? `(${item.sku})` : ""}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              )}

                              {/* Pieces calculation section */}
                              {(() => {
                                const activeStoneSqft = !group.changed ? group.defaultStoneSqft : group.newStoneSqft;
                                if (!activeStoneSqft || activeStoneSqft <= 0) return null;
                                const calcPcs = group.totalSqft / activeStoneSqft;
                                const roundedCalcPcs = Math.round(calcPcs * 100) / 100;
                                const displayPcs = group.customPcs !== undefined ? group.customPcs : roundedCalcPcs.toString();

                                return (
                                  <div style={{ marginTop: 10, display: "flex", gap: 16, alignItems: "center", background: "#f3f4f6", padding: "8px 12px", borderRadius: 6, border: "1px solid #e5e7eb" }}>
                                    <div style={{ fontSize: 13, color: "#4b5563" }}>
                                      Slab Area: <strong>{activeStoneSqft.toFixed(2)} sqft</strong>
                                    </div>
                                    <div style={{ fontSize: 13, color: "#4b5563" }}>
                                      Calculated Pcs: <strong>{roundedCalcPcs.toFixed(2)} pcs</strong>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                                      <label style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>Actual Pcs:</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        style={{ width: 80, padding: "4px 8px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: 13 }}
                                        value={displayPcs}
                                        onChange={(e) => handlePcsChange(group.key, e.target.value)}
                                      />
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                      )}

                      {profiles.length > 0 && (
                        <div>
                          <h4 style={{ fontSize: 13, fontWeight: 600, color: "#4b5563", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Profile Selection
                          </h4>
                          {profiles.map((group) => (
                            <div key={group.key} style={{ background: "#f9fafb", borderRadius: 8, padding: 14, marginBottom: 10, border: "1px solid #e5e7eb" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                <div>
                                  <strong style={{ fontSize: 14 }}>{group.profileCode} — {group.finish}</strong>
                                  <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 12 }}>
                                    Size: {group.size}mm | Total: {group.totalLength.toFixed(1)}mm (incl. waste)
                                  </span>
                                </div>
                                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={group.changed}
                                    onChange={() => handleProfileGroupToggle(group.key)}
                                  />
                                  Change profile
                                </label>
                              </div>

                              {!group.changed ? (
                                <div style={{ fontSize: 13, color: "#374151", background: "#fff", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}>
                                  <span style={{ fontWeight: 600 }}>Default:</span> {group.defaultProfileName}
                                  {group.defaultProfileSku ? ` (${group.defaultProfileSku})` : ""}
                                </div>
                              ) : (
                                <div>
                                  {rawMatDropdownLoading[group.key] ? (
                                    <div style={{ fontSize: 13, color: "#6b7280", padding: 8 }}>Loading items...</div>
                                  ) : (
                                    <select
                                      value={group.newProfileId}
                                      onChange={(e) => {
                                        const sel = rawMatDropdownItems[group.key]?.find((i) => i.id === e.target.value);
                                        handleProfileSelect(group.key, e.target.value, sel?.name || "");
                                      }}
                                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
                                    >
                                      <option value="">Select profile...</option>
                                      {(rawMatDropdownItems[group.key] || []).map((item) => (
                                        <option key={item.id} value={item.id}>
                                          {item.name} {item.sku ? `(${item.sku})` : ""}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <>
                    {renderCategorySection("shutter", shutterStones, shutterProfiles)}
                    {renderCategorySection("carcass", carcassStones, carcassProfiles)}
                    {rawMatSelection.stoneGroups.length === 0 && rawMatSelection.profileGroups.length === 0 && (
                      <p style={{ color: "#6b7280", textAlign: "center", padding: 20 }}>No raw materials found to configure.</p>
                    )}
                  </>
                );
              })()}
            </div>

            <footer style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 16px", borderTop: "1px solid #e5e7eb" }}>
              <button
                type="button"
                className="btn"
                onClick={() => { setRawMatModal(false); setRawMatSelection(null); setRawMatOrders([]); }}
                disabled={rawMatLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleRawMatConfirm}
                disabled={rawMatLoading || rawMatSelection.stoneGroups.some((g) => g.changed && !g.newStoneId) || rawMatSelection.profileGroups.some((g) => g.changed && !g.newProfileId)}
              >
                {rawMatLoading ? "Applying..." : "Confirm & Load BOM"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {draftPoOpen ? <DraftPoModal onClose={() => setDraftPoOpen(false)} /> : null}
    </div>
  );
}

// Make TypeScript treat groupLabel re-export as used.
export const __groupLabel = groupLabel;
