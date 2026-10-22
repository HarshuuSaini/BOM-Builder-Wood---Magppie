import type { KitchenMaterials } from "@/lib/kitchen-materials";
import type { ProjectSetupRow } from "@/lib/export";

export const KITCHEN_WORKSPACE_KEY = "wood-bom-kitchen-workspace-v1";
export const ACTIVE_KITCHEN_KEY = "wood-bom-active-kitchen-v1";

export function kitchenNameFromPdfFilename(filename: string): string {
  const stem = filename.replace(/\.pdf$/i, "").trim();
  const withoutReport = stem.replace(/^BOM[\s_-]*Backorder[\s_-]*Report[\s_-]*/i, "");
  const beforeKitchen = withoutReport.replace(/\bKitchen\b.*$/i, "").replace(/[\s_-]+$/, "").trim();
  return beforeKitchen || stem;
}

export function normalizeImportedKitchenName(entry: KitchenWorkspaceEntry): KitchenWorkspaceEntry {
  if (!entry.sourceName || !/\.pdf$/i.test(entry.sourceName)) return entry;
  const oldDefault = entry.sourceName.replace(/\.pdf$/i, "").trim();
  return entry.name === oldDefault ? { ...entry, name: kitchenNameFromPdfFilename(entry.sourceName) } : entry;
}

export type KitchenCostingItem = {
  category: string; itemCode: string; item: string; unit: string;
  quantity: number; rate: number; amount: number;
};

export type KitchenCostingSnapshot = {
  areaSqft: number;
  materialCost: number;
  conversion: number;
  profit: number;
  transportation: number;
  installation: number;
  loading: number;
  tax: number;
  total: number;
  items: KitchenCostingItem[];
  unpriced: string[];
};

export type KitchenWorkspaceEntry = {
  id: string;
  name: string;
  sourceName?: string;
  rows: ProjectSetupRow[];
  materials?: KitchenMaterials;
  boardSheetInputs?: Record<string, string>;
  costing?: KitchenCostingSnapshot;
};

export function readKitchenWorkspace(): KitchenWorkspaceEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.sessionStorage.getItem(KITCHEN_WORKSPACE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((entry) =>
      entry && typeof entry.id === "string" && typeof entry.name === "string" && Array.isArray(entry.rows))
      .map(normalizeImportedKitchenName) : [];
  } catch { return []; }
}

export function writeKitchenWorkspace(entries: KitchenWorkspaceEntry[]) {
  window.sessionStorage.setItem(KITCHEN_WORKSPACE_KEY, JSON.stringify(entries));
}

export function activeKitchenId() {
  return typeof window === "undefined" ? "" : window.sessionStorage.getItem(ACTIVE_KITCHEN_KEY) ?? "";
}

export function setActiveKitchenId(id: string) {
  window.sessionStorage.setItem(ACTIVE_KITCHEN_KEY, id);
}
