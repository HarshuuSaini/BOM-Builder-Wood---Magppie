/**
 * Raw Material Selection Logic
 *
 * Traverses the BOM tree to find stone (panel) raw materials at the deepest level.
 * Groups carcass/shutter items by finish + thickness for selection.
 * Groups profile items by size + finish + profile code for selection.
 */

import type {
  CompositeItemDetail,
  ItemDetail,
  CompositeMappedItem,
  SalesOrderDetail,
} from "@/lib/types";
import { isComposite, collectMappedItemIds, getCfValue } from "@/lib/stock";
import { normalizePartOrPanelName } from "@/lib/naming";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type StoneGroup = {
  key: string; // category|finish|thickness
  category: "carcass" | "shutter";
  finish: string;
  thickness: string;
  defaultStoneId: string;
  defaultStoneName: string;
  defaultStoneSku: string;
  defaultStoneSqft?: number;
  totalSqft: number; // including waste %
  /** The BOM chain from Panel up to Carcass/Shutter */
  chainItems: BomChainItem[];
  /** All carcass/shutter item IDs in this group */
  carcassItemIds: string[];
  changed: boolean;
  newStoneId: string;
  newStoneName: string;
  newStoneSqft?: number;
  customPcs?: string;
};

export type ProfileGroup = {
  key: string; // profileCode|finish|size
  category: "carcass" | "shutter";
  profileCode: string;
  finish: string;
  size: string;
  defaultProfileId: string;
  defaultProfileName: string;
  defaultProfileSku: string;
  totalLength: number; // including waste %
  chainItems: BomChainItem[];
  profileItemIds: string[];
  changed: boolean;
  newProfileId: string;
  newProfileName: string;
};

export type BomChainItem = {
  level: number;
  itemId: string;
  itemName: string;
  isComposite: boolean;
  parentItemId?: string;
  /** The raw material item found inside this composite's BOM */
  stoneItemId?: string;
  stoneItemName?: string;
};

export type RawMaterialSelection = {
  stoneGroups: StoneGroup[];
  profileGroups: ProfileGroup[];
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

async function fetchItem(id: string, cache: Record<string, ItemDetail | null>): Promise<ItemDetail | null> {
  if (id in cache) return cache[id];
  try {
    const body = await fetchJson<{ item: ItemDetail }>(`/api/zoho/items/${id}`);
    cache[id] = body.item;
    return body.item;
  } catch {
    cache[id] = null;
    return null;
  }
}

async function fetchComposite(id: string, cache: Record<string, CompositeItemDetail | null>): Promise<CompositeItemDetail | null> {
  if (id in cache) return cache[id];
  try {
    const body = await fetchJson<{ compositeItem: CompositeItemDetail }>(`/api/zoho/compositeitems/${id}`);
    cache[id] = body.compositeItem;
    return body.compositeItem;
  } catch {
    cache[id] = null;
    return null;
  }
}

function getMappedItems(composite: CompositeItemDetail): CompositeMappedItem[] {
  return composite.mapped_items
    ?? composite.composite_item_line_items
    ?? composite.bundle_items
    ?? composite.line_items
    ?? composite.items
    ?? [];
}

function extractProfileCode(itemName: string): string {
  const lastDash = itemName.lastIndexOf("-");
  if (lastDash < 3) return "";
  return itemName.substring(lastDash - 3, lastDash);
}

function getCarcassCategory(item: ItemDetail): "carcass" | "shutter" | null {
  const group = getCfValue(item, "cf_group").toLowerCase();
  const subGroup = getCfValue(item, "cf_sub_group").toLowerCase();
  if (group.includes("shutter") || subGroup.includes("shutter")) return "shutter";
  if (group.includes("carcass") || subGroup.includes("carcass")) return "carcass";
  return null;
}

/**
 * Check if a composite item belongs to a Panel group where stone replacement happens.
 * Groups: "Panels- SH Strip", "Panels- SH", "Panels- Cab"
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNewFinishFromProfileName(profileName: string, defaultColor: string = "CHAMPAGNE"): string {
  const nameUpper = profileName.toUpperCase();
  for (const color of ["CHAMPAGNE", "GOLD", "BLACK", "SILVER", "BRONZE", "WHITE"]) {
    if (nameUpper.includes(color)) return color;
  }
  return defaultColor;
}

const PANEL_GROUPS = ["panels- sh strip", "panels- sh", "panels- cab"];

async function resolveDrillingServiceId(itemsCache: Record<string, ItemDetail | null>): Promise<string | null> {
  const cacheKey = "SERVICE_DRILLING_1";
  if (itemsCache[cacheKey]) return itemsCache[cacheKey]?.item_id || null;
  
  try {
    const body = await fetchJson<{ items: ItemDetail[] }>(
      `/api/zoho/items?search=${encodeURIComponent("Drilling-1")}`
    );
    const match = (body.items || []).find((item) => {
      const n = (item.name || item.item_name || "").toLowerCase();
      return n === "drilling-1";
    });
    if (match) {
      itemsCache[cacheKey] = match;
      return match.item_id;
    }
  } catch (e) {
    console.error("[RawMat] Error resolving Drilling-1:", e);
  }
  return null;
}

function isPanelGroupMatch(item: ItemDetail): boolean {
  const name = (item.name || item.item_name || "").toLowerCase().trim();
  if (name.startsWith("part ")) return false;
  if (name.startsWith("panel ") || name.startsWith("panels-") || name.startsWith("panels ")) {
    return true;
  }

  const cfGroup = getCfValue(item, "cf_group").toLowerCase().trim();
  const groupName = (item.group_name || "").toLowerCase().trim();
  if (!cfGroup && !groupName) return false;
  return PANEL_GROUPS.some((pg) =>
    (cfGroup && (cfGroup.includes(pg) || pg.includes(cfGroup))) ||
    (groupName && (groupName.includes(pg) || pg.includes(groupName))),
  );
}

function isProfileItem(item: ItemDetail): boolean {
  const group = getCfValue(item, "cf_group").toLowerCase();
  const subGroup = getCfValue(item, "cf_sub_group").toLowerCase();
  const name = (item.name || item.item_name || "").toLowerCase();
  return group.includes("profile") || subGroup.includes("profile") || name.includes("profile");
}

function isHardwareItem(item: ItemDetail | CompositeMappedItem): boolean {
  const name = (item.name || item.item_name || "").toLowerCase();
  return (
    name.startsWith("hardware pack") ||
    name.includes("glue silicone") ||
    name.includes("screw") ||
    name.includes("insert nylon") ||
    name.includes("hinge mounting") ||
    name.includes("leg pvc")
  );
}

function isHardwareComposite(item: ItemDetail): boolean {
  const name = (item.name || item.item_name || "").toLowerCase();
  const group = getCfValue(item, "cf_group").toLowerCase();
  const subGroup = getCfValue(item, "cf_sub_group").toLowerCase();
  return (
    name.startsWith("hardware pack") ||
    group.includes("hardware") ||
    subGroup.includes("hardware") ||
    group.includes("stores")
  );
}

/* ------------------------------------------------------------------ */
/*  BOM Tree Traversal — find deepest stone in each composite chain   */
/* ------------------------------------------------------------------ */

type TraversalResult = {
  stoneItem: CompositeMappedItem | null;
  stoneParentCompositeId: string;
  chain: BomChainItem[];
  wastePercent: number;
  quantity: number;
  dimensions: { height: number; width: number };
  /** Thickness from the Panel (deepest composite) — actual stone thickness */
  stoneThickness: string;
};

/**
 * Traverse BOM tree to find the raw material at the deepest composite level.
 *
 * Strategy: go as deep as possible through composite children (skipping hardware).
 * At the deepest composite (one with NO composite children), the non-composite
 * children are the raw materials. Pick the first non-hardware one — that's the stone.
 *
 * BOM chain: Carcass → Set of Parts → Part → Panel → Stone (raw material)
 */
async function findStoneInBomChain(
  rootItemId: string,
  rootQty: number,
  itemsCache: Record<string, ItemDetail | null>,
  compositesCache: Record<string, CompositeItemDetail | null>,
  depth: number = 0,
): Promise<TraversalResult | null> {
  if (depth > 6) return null;

  const item = await fetchItem(rootItemId, itemsCache);
  if (!item || !isComposite(item)) return null;

  // Skip hardware composites entirely
  if (isHardwareComposite(item)) return null;

  const composite = await fetchComposite(rootItemId, compositesCache);
  if (!composite) return null;

  const mapped = getMappedItems(composite);

  // Pre-fetch all children
  const childItems: Array<{ mapped: CompositeMappedItem; detail: ItemDetail }> = [];
  for (const child of mapped) {
    const childItem = await fetchItem(child.item_id, itemsCache);
    if (childItem) childItems.push({ mapped: child, detail: childItem });
  }

  const compositeName = item.name || item.item_name || "";
  console.log(`[RawMat] depth=${depth} composite="${compositeName}" children=${childItems.length}`);
  for (const { detail } of childItems) {
    const n = detail.name || detail.item_name || "";
    console.log(`  child: "${n}" composite=${isComposite(detail)} cf_group="${getCfValue(detail, "cf_group")}" group_name="${detail.group_name || ""}"`);
  }

  // Check if there are non-hardware composite children to recurse into
  const nonHwCompositeChildren = childItems.filter(({ detail }) => isComposite(detail) && !isHardwareComposite(detail));

  // If we CAN go deeper, recurse first
  if (nonHwCompositeChildren.length > 0) {
    for (const { mapped: child, detail: childItem } of nonHwCompositeChildren) {
      const childQty = rootQty * (child.quantity || child.quantity_needed || 1);
      const result = await findStoneInBomChain(child.item_id, childQty, itemsCache, compositesCache, depth + 1);
      if (result) {
        result.chain.unshift({
          level: depth,
          itemId: rootItemId,
          itemName: compositeName,
          isComposite: true,
        });
        return result;
      }
    }
  }

  // We're at the deepest level (or deeper levels had nothing).
  // Only replace stone in Panel composites (Panels- SH Strip, Panels- SH, Panels- Cab)
  if (!isPanelGroupMatch(item)) return null;

  // Find the first non-composite, non-hardware child — that's the stone raw material
  for (const { mapped: child, detail: childItem } of childItems) {
    if (isComposite(childItem)) continue;
    if (isHardwareItem(childItem)) continue;

    const wasteStr = getCfValue(item, "cf_waste_percentage");
    const waste = parseFloat(wasteStr) || 0;
    const height = parseFloat(getCfValue(item, "cf_height")) || 0;
    const width = parseFloat(getCfValue(item, "cf_width")) || 0;
    const panelThickness = getCfValue(item, "cf_thickness"); // actual stone thickness from Panel

    console.log(`[RawMat] FOUND stone: "${child.name || child.item_name}" at depth=${depth} in "${compositeName}" thickness="${panelThickness}"`);

    return {
      stoneItem: child,
      stoneParentCompositeId: rootItemId,
      chain: [{
        level: depth,
        itemId: rootItemId,
        itemName: compositeName,
        isComposite: true,
        stoneItemId: child.item_id,
        stoneItemName: child.name || child.item_name || "",
      }],
      wastePercent: waste,
      quantity: rootQty * (child.quantity || child.quantity_needed || 1),
      dimensions: { height, width },
      stoneThickness: panelThickness,
    };
  }

  return null;
}

export type FoundPanel = {
  itemId: string;
  itemName: string;
  quantity: number;
  height: number;
  width: number;
  wastePercent: number;
  stoneThickness: string;
};

async function findAllStonesInBomChain(
  rootItemId: string,
  rootQty: number,
  itemsCache: Record<string, ItemDetail | null>,
  compositesCache: Record<string, CompositeItemDetail | null>,
  depth: number = 0,
): Promise<FoundPanel[]> {
  if (depth > 6) return [];

  const item = await fetchItem(rootItemId, itemsCache);
  if (!item || !isComposite(item)) return [];

  if (isHardwareComposite(item)) return [];

  const composite = await fetchComposite(rootItemId, compositesCache);
  if (!composite) return [];

  const mapped = getMappedItems(composite);

  const childItems: Array<{ mapped: CompositeMappedItem; detail: ItemDetail }> = [];
  for (const child of mapped) {
    const childItem = await fetchItem(child.item_id, itemsCache);
    if (childItem) childItems.push({ mapped: child, detail: childItem });
  }

  const results: FoundPanel[] = [];

  const nonHwCompositeChildren = childItems.filter(({ detail }) => isComposite(detail) && !isHardwareComposite(detail));

  for (const { mapped: child, detail: childItem } of nonHwCompositeChildren) {
    const childQty = rootQty * (child.quantity || child.quantity_needed || 1);
    const subResults = await findAllStonesInBomChain(child.item_id, childQty, itemsCache, compositesCache, depth + 1);
    results.push(...subResults);
  }

  if (isPanelGroupMatch(item)) {
    for (const { mapped: child, detail: childItem } of childItems) {
      if (isComposite(childItem)) continue;
      if (isHardwareItem(childItem)) continue;

      const wasteStr = getCfValue(item, "cf_waste_percentage");
      const waste = parseFloat(wasteStr) || 0;
      const height = parseFloat(getCfValue(item, "cf_height")) || 0;
      const width = parseFloat(getCfValue(item, "cf_width")) || 0;
      const panelThickness = getCfValue(item, "cf_thickness");

      results.push({
        itemId: child.item_id,
        itemName: child.name || child.item_name || "",
        quantity: rootQty * (child.quantity || child.quantity_needed || 1),
        height,
        width,
        wastePercent: waste,
        stoneThickness: panelThickness,
      });

      break;
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Main — resolve raw materials for all orders                        */
/* ------------------------------------------------------------------ */

/**
 * Find the default stone item from Zoho by matching:
 *   group = "Stone", finish, thickness, height = 2800, width = 1200
 */
async function findDefaultStone(finish: string, stoneThickness: string): Promise<ItemDetail | null> {
  const targetThickness = parseFloat(stoneThickness) || 0;
  const finishLower = finish.toLowerCase();

  const matchItem = (item: ItemDetail): boolean => {
    if (isComposite(item)) return false;
    const cfGroup = getCfValue(item, "cf_group").toLowerCase();
    const groupName = (item.group_name || "").toLowerCase();
    if (!cfGroup.includes("stone") && !groupName.includes("stone")) return false;
    const itemFinish = getCfValue(item, "cf_finish").toLowerCase();
    const itemThickness = parseFloat(getCfValue(item, "cf_thickness")) || 0;
    const matchFinish = itemFinish.includes(finishLower) || finishLower.includes(itemFinish);
    return matchFinish && itemThickness === targetThickness;
  };

  const queries = [`STONE ${stoneThickness}`, finish, "STONE"];

  for (const query of queries) {
    try {
      const body = await fetchJson<{ items: ItemDetail[] }>(
        `/api/zoho/items?search=${encodeURIComponent(query)}`,
      );
      const match = (body.items || []).find(matchItem);
      if (match) return match;
    } catch { continue; }
  }

  return null;
}

export async function resolveRawMaterials(
  orders: SalesOrderDetail[],
  itemsCache: Record<string, ItemDetail | null>,
  compositesCache: Record<string, CompositeItemDetail | null>,
): Promise<RawMaterialSelection> {
  const stoneGroupMap = new Map<string, StoneGroup>();
  const profileGroupMap = new Map<string, ProfileGroup>();

  for (const order of orders) {
    if (!order) continue;
    const lineItems = order.line_items ?? [];

    for (const li of lineItems) {
      const itemId = li.composite_item_id || li.item_id;
      if (!itemId) continue;

      const item = await fetchItem(itemId, itemsCache);
      if (!item) continue;

      const soQty = li.quantity ?? 1;

      // Check if this is a carcass/shutter composite
      const category = isComposite(item) ? getCarcassCategory(item) : null;
      if (category) {
        const finish = getCfValue(item, "cf_finish");

        // Resolve BOM chain — needed for panel dimensions, stone thickness, and Scenario 1 duplication
        const chain = await findStoneInBomChain(itemId, soQty, itemsCache, compositesCache);

        // Find all panels in BOM tree to sum up their sqft areas
        let totalSqft = 0;
        const panels = await findAllStonesInBomChain(itemId, soQty, itemsCache, compositesCache);
        if (panels.length > 0) {
          for (const panel of panels) {
            const sqft = panel.quantity * (1 + panel.wastePercent / 100);
            totalSqft += sqft;
          }
        } else {
          // Fallback to carcass/shutter dimensions if no panels found
          const panelH = parseFloat(getCfValue(item, "cf_height")) || 0;
          const panelW = parseFloat(getCfValue(item, "cf_width")) || 0;
          const waste = parseFloat(getCfValue(item, "cf_waste_percentage")) || 0;
          const sqft = (panelH * panelW * (1 + waste / 100)) / (304.8 * 304.8);
          totalSqft = sqft * soQty;
        }

        // Carcass: use carcass item's own cf_thickness
        // Shutter: use panel's thickness (from BOM traversal)
        const thickness = category === "carcass"
          ? getCfValue(item, "cf_thickness")
          : (chain?.stoneThickness || getCfValue(item, "cf_thickness"));
        const key = `${category}|${finish}|${thickness}`.toLowerCase();

        console.log(`[RawMat] ${category} "${item.name || item.item_name}" finish="${finish}" thickness="${thickness}" panels=${panels.length} totalSqft=${totalSqft.toFixed(2)}`);

        if (stoneGroupMap.has(key)) {
          const existing = stoneGroupMap.get(key)!;
          existing.totalSqft += totalSqft;
          existing.carcassItemIds.push(itemId);
          if (chain) existing.chainItems.push(...chain.chain);
        } else {
          // Find default stone: group=Stone + finish + thickness + 2800x1200
          const defaultStone = await findDefaultStone(finish, thickness);
          const defaultStoneSqft = defaultStone ? (() => {
            const sqftStr = getCfValue(defaultStone, "cf_sqft");
            let stoneSqft = parseFloat(sqftStr) || 0;
            if (stoneSqft <= 0) {
              const h = parseFloat(getCfValue(defaultStone, "cf_height")) || 0;
              const w = parseFloat(getCfValue(defaultStone, "cf_width")) || 0;
              stoneSqft = (h * w) / (304.8 * 304.8);
            }
            return Math.round(stoneSqft * 100) / 100;
          })() : 0;
          const notFound = !defaultStone;

          stoneGroupMap.set(key, {
            key,
            category,
            finish,
            thickness,
            defaultStoneId: defaultStone?.item_id || "",
            defaultStoneName: defaultStone?.name || defaultStone?.item_name || "(not found)",
            defaultStoneSku: defaultStone?.sku || "",
            defaultStoneSqft,
            totalSqft,
            chainItems: chain?.chain || [],
            carcassItemIds: [itemId],
            changed: notFound, // mandatory if default not found
            newStoneId: "",
            newStoneName: "",
          });
        }
      }

      // Check if this is a profile composite
      if (isComposite(item) && isProfileItem(item)) {
        const finish = getCfValue(item, "cf_finish");
        const height = getCfValue(item, "cf_height");
        const profileCode = extractProfileCode(item.name || item.item_name || "");
        const profileCategory = getCarcassCategory(item) || (
          (item.name || item.item_name || "").toLowerCase().includes("carcass") ||
          getCfValue(item, "cf_group").toLowerCase().includes("carcass") ||
          getCfValue(item, "cf_sub_group").toLowerCase().includes("carcass")
            ? "carcass"
            : "shutter"
        );
        const key = `${profileCategory}|${profileCode}|${finish}|${height}`.toLowerCase();
        const waste = parseFloat(getCfValue(item, "cf_waste_percentage")) || 0;
        const length = (parseFloat(height) || 0) * soQty * (1 + waste / 100);

        const result = await findStoneInBomChain(itemId, soQty, itemsCache, compositesCache);

        if (profileGroupMap.has(key)) {
          const existing = profileGroupMap.get(key)!;
          existing.totalLength += length;
          existing.profileItemIds.push(itemId);
        } else {
          profileGroupMap.set(key, {
            key,
            category: profileCategory,
            profileCode,
            finish,
            size: height,
            defaultProfileId: result?.stoneItem?.item_id || "",
            defaultProfileName: result?.stoneItem?.name || result?.stoneItem?.item_name || "",
            defaultProfileSku: result?.stoneItem?.sku || "",
            totalLength: length,
            chainItems: result?.chain || [],
            profileItemIds: [itemId],
            changed: false,
            newProfileId: "",
            newProfileName: "",
          });
        }
      }
    }
  }

  return {
    stoneGroups: Array.from(stoneGroupMap.values()),
    profileGroups: Array.from(profileGroupMap.values()),
  };
}

/* ------------------------------------------------------------------ */
/*  Search items from Zoho for dropdown                                */
/* ------------------------------------------------------------------ */

// Colour-qualifier words that some Zoho slabs omit from the finish name (the bare stone name
// is catalogued). Dropping these lets "BLACK STATUARIO NUVOLATO" match a "STATUARIO NUVOLATO"
// 15 mm slab while still requiring the distinctive stone tokens to be present.
const STONE_COLOR_QUALIFIERS = new Set([
  "black", "white", "grey", "gray", "beige", "cream", "brown", "gold", "golden", "silver",
  "ivory", "green", "blue", "red", "pink", "sand", "taupe", "charcoal", "dark", "light",
]);

export async function searchStoneItems(finish: string, stoneThickness: string, excludeStoneId?: string): Promise<ItemDetail[]> {
  const targetThickness = parseFloat(stoneThickness) || 0;
  const finishLower = finish.toLowerCase();

  const isStoneItem = (item: ItemDetail): boolean => {
    if (isComposite(item)) return false;
    if (excludeStoneId && item.item_id === excludeStoneId) return false;
    const cfGroup = getCfValue(item, "cf_group").toLowerCase();
    const groupName = (item.group_name || "").toLowerCase();
    const name = (item.name || "").toLowerCase();
    return cfGroup.includes("stone") || groupName.includes("stone") || name.includes("stone");
  };

  // Thickness encoded in the item name: either the last dimension of W×H×T (e.g.
  // "2800X1200X15" → 15) or a small "NNMM" token (e.g. "06MM" → 6). Large dimensions
  // like "2800MM" are ignored (>2 digits before MM).
  const thicknessFromName = (raw: string): number => {
    const n = (raw || "").toUpperCase();
    let m = n.match(/\d+\s*[X×]\s*\d+\s*[X×]\s*(\d{1,2})\s*(?:MM)?\b/);
    if (m) return parseInt(m[1]);
    m = n.match(/\b(\d{1,2})\s*MM\b/);
    if (m) return parseInt(m[1]);
    return 0;
  };

  // Finish / thickness can come from the custom fields OR the item name (cf fields are
  // often blank on stone slabs).
  // EXACT: the item's finish (cf or name) contains the full requested finish string.
  const finishMatchesExact = (item: ItemDetail): boolean => {
    const cf = getCfValue(item, "cf_finish").toLowerCase();
    const name = (item.name || "").toLowerCase();
    return (!!cf && (cf.includes(finishLower) || finishLower.includes(cf))) || name.includes(finishLower);
  };
  // CORE: colour-qualifier words (BLACK / WHITE / …) are optional, so a slab catalogued under
  // the bare stone name (e.g. "STATUARIO NUVOLATO" for the colour "BLACK STATUARIO NUVOLATO")
  // still matches. Requires every non-qualifier token of the requested finish to appear.
  const coreTokens = finishLower.split(/\s+/).filter((t) => t && !STONE_COLOR_QUALIFIERS.has(t));
  const finishMatchesCore = (item: ItemDetail): boolean => {
    if (coreTokens.length === 0) return finishMatchesExact(item);
    const hay = (getCfValue(item, "cf_finish").toLowerCase() + " " + (item.name || "").toLowerCase());
    return coreTokens.every((t) => hay.includes(t));
  };
  const thicknessOf = (item: ItemDetail): number =>
    (parseFloat(getCfValue(item, "cf_thickness")) || 0) || thicknessFromName(item.name || "");
  const thickOk = (item: ItemDetail): boolean => targetThickness === 0 || thicknessOf(item) === targetThickness;

  // Ranked result: exact finish+thickness first, then core finish+thickness (qualifier dropped).
  const ranked = (cands: ItemDetail[]): ItemDetail[] => {
    const exact = cands.filter((i) => isStoneItem(i) && finishMatchesExact(i) && thickOk(i));
    const exactIds = new Set(exact.map((i) => i.item_id));
    const core = cands.filter((i) => isStoneItem(i) && finishMatchesCore(i) && thickOk(i) && !exactIds.has(i.item_id));
    return [...exact, ...core];
  };

  const queries = [`STONE ${stoneThickness}`, finish, "STONE"];
  const seen = new Set<string>();
  const candidates: ItemDetail[] = [];
  let lastError: unknown = null;
  let anySucceeded = false;

  for (const query of queries) {
    try {
      const body = await fetchJson<{ items: ItemDetail[] }>(
        `/api/zoho/items?search=${encodeURIComponent(query)}`,
      );
      anySucceeded = true;
      for (const item of body.items || []) {
        if (item.item_id && !seen.has(item.item_id)) {
          seen.add(item.item_id);
          candidates.push(item);
        }
      }
      const hits = ranked(candidates);
      if (hits.length > 0) return hits;
    } catch (err) { lastError = err; continue; }
  }

  // If ALL queries failed (network/auth), throw so caller knows it's an error vs empty results
  if (!anySucceeded && lastError) throw lastError;

  // No thickness match at all → last resort: core-finish matches of any thickness (with a UI warning).
  return candidates.filter((i) => isStoneItem(i) && finishMatchesCore(i));
}

const PROFILE_CODE_EQUIVALENCES: Record<string, string[]> = {
  "hm509": ["hm509", "stp"],
  "stp": ["hm509", "stp"],
  
  "hm511": ["hm511", "slf"],
  "slf": ["hm511", "slf"],
  
  "hm510": ["hm510", "sink"],
  "sink": ["hm510", "sink"],
  
  "hm519": ["hm519", "elen"],
  "elen": ["hm519", "elen"],
  
  "hm513": ["hm513", "dbs"],
  "dbs": ["hm513", "dbs"],
  
  "hm535": ["hm535", "dbc"],
  "dbc": ["hm535", "dbc"],

  "md1cm1": ["md1cm1", "cm1"],
  "md1cm2": ["md1cm2", "cm2"],
  "md2cm1": ["md2cm1", "cm1"],
  "md2cm2": ["md2cm2", "cm2"]
};

const DEFAULT_PROFILE_NAMES: Record<string, string> = {
  "elen": "ALU PROF FOR ELENOR 3000X15X15 ANODISED CHAMPAGNE HM-519 MINA",
  "hm519": "ALU PROF FOR ELENOR 3000X15X15 ANODISED CHAMPAGNE HM-519 MINA",
  "stp": "ALU PROF FOR STEPPER 3000X31.5X22 ANODISED CHAMPAGNE MG-01 VARN",
  "hm509": "ALU PROF FOR STEPPER 3000X31.5X22 ANODISED CHAMPAGNE MG-01 VARN",
  "slf": "ALU PROF FOR SHELF 3000X22X1.2 W/OUT ANODISED HM-511 VARN",
  "hm511": "ALU PROF FOR SHELF 3000X22X1.2 W/OUT ANODISED HM-511 VARN",
  "sink": "ALU PROF FOR SINK NEW 3000X27X22 ANODISED CHAMPAGNE HM-510 MINA",
  "hm510": "ALU PROF FOR SINK NEW 3000X27X22 ANODISED CHAMPAGNE HM-510 MINA",
  "dbs": "ALU PROF DRAWER BOTTOM SIDE PROFILE 3000X18X16 ANODISED CHAMPAGNE HM-513 MINA",
  "hm513": "ALU PROF DRAWER BOTTOM SIDE PROFILE 3000X18X16 ANODISED CHAMPAGNE HM-513 MINA",
  "dbc": "ALU PROF FOR DRAWER BOTTOM CENTER 3000X45X14 ANODISED CHAMPAGNE HM-535 MINA",
  "hm535": "ALU PROF FOR DRAWER BOTTOM CENTER 3000X45X14 ANODISED CHAMPAGNE HM-535 MINA",
  
  // Acc/Light
  "skirting": "ALU PROF FOR SKIRTING WITH LIGHT 3000X100X9.8 ANODISED CHAMPAGNE HM-507 MINA",
  "duplay": "ALU PROF DUPLY LIGHT 3000X45X14 ANODISED CHAMPAGNE HM-534 MINA",
  "lprofile": "ALU PROF DADO TOOL 3000X35..5X28 ANODISED CHAMPAGNE HM-514 MINA",
  "grand": "ALU PROF GRAND COUNTER 3000X20X15.5 ANODISED CHAMPAGNE HM-512 MINA",
  
  // Shutter designs
  "md1": "ALU PROF DAP 101 NEW 3000X45.5X24.24 ANODISED CHAMPAGNE HM-517 MINA",
  "md2": "ALU PROF DAP 107 TITUS HANDLE 3000X45.5X40 ANODISED CHAMPAGNE HM-527 MINA",
  "cl1": "ALU PROF CLASSIC 3000X70X31 ANODISED CHAMPAGNE HM-501 MINA",
  "cl2": "ALU PROF CLASSIC 3000X78X16.87 ANODISED CHAMPAGNE HM-502 MINA",
  "cm1": "ALU PROF CLASSIC MOULDING 3000X25X9 ANODISED CHAMPAGNE HM-530 MINA",
  "cm2": "ALU PROF CLASSIC MOULDING 3000X25X9 ANODISED CHAMPAGNE HM-531 MINA",
  "neon20": "ALU PROF NEON 20 HANDLE 3000X40X19.5 ANODISED CHAMPAGNE HM-533 MINA"
};

function getDefaultProfileName(profileCode: string, finish: string): string | null {
  const code = profileCode.toLowerCase().trim();
  let defaultName = DEFAULT_PROFILE_NAMES[code];
  if (!defaultName) {
    const aliases = PROFILE_CODE_EQUIVALENCES[code] || [];
    for (const alias of aliases) {
      if (DEFAULT_PROFILE_NAMES[alias]) {
        defaultName = DEFAULT_PROFILE_NAMES[alias];
        break;
      }
    }
  }
  if (!defaultName) return null;

  const upperFinish = finish.toUpperCase().trim();
  if (upperFinish !== "CHAMPAGNE") {
    if (upperFinish.includes("WITHOUT") || upperFinish.includes("W/OUT") || upperFinish.includes("UNANODISED")) {
      defaultName = defaultName.replace("ANODISED CHAMPAGNE", upperFinish);
    } else {
      defaultName = defaultName.replace("CHAMPAGNE", upperFinish);
    }
  }
  return defaultName;
}

export async function searchProfileItems(finish: string, profileCode: string): Promise<ItemDetail[]> {
  const cleanCode = profileCode.toLowerCase().trim();
  const baseAliases = PROFILE_CODE_EQUIVALENCES[cleanCode] || [cleanCode];

  // Dynamically add both hyphenated (e.g. hm-511) and non-hyphenated (e.g. hm511) forms of all aliases
  const searchAliases: string[] = [];
  baseAliases.forEach((alias) => {
    searchAliases.push(alias);
    if (/^hm-?\d+$/.test(alias)) {
      const numericPart = alias.replace(/[^0-9]/g, "");
      searchAliases.push(`hm${numericPart}`);
      searchAliases.push(`hm-${numericPart}`);
    }
  });

  // Combine search aliases and the finish as search terms to maximize Zoho match candidates
  const searchTerms = Array.from(new Set([...searchAliases, finish.trim()]));

  // Search Zoho using all search terms concurrently — track errors vs successes
  let errorCount = 0;
  const fetchPromises = searchTerms.map((term) =>
    fetchJson<{ items: ItemDetail[] }>(
      `/api/zoho/items?search=${encodeURIComponent(term)}`
    )
      .then((body) => body.items || [])
      .catch((err) => { errorCount++; if (errorCount === searchTerms.length) throw err; return [] as ItemDetail[]; })
  );
  const resultsArrays = await Promise.all(fetchPromises);

  // Flatten and de-duplicate items by item_id
  const allItemsMap = new Map<string, ItemDetail>();
  resultsArrays.forEach((items) => {
    items.forEach((item) => {
      if (item.item_id) {
        allItemsMap.set(item.item_id, item);
      }
    });
  });
  const combinedItems = Array.from(allItemsMap.values());

  const filtered = combinedItems.filter((item) => {
    if (isComposite(item)) return false;

    const itemProfileCode = (getCfValue(item, "cf_profile_code") || "").toLowerCase().trim();
    const itemFinish = (getCfValue(item, "cf_finish") || "").toLowerCase().trim();

    const matchProfile = searchAliases.some((alias) =>
      itemProfileCode.includes(alias) ||
      (item.name || "").toLowerCase().includes(alias) ||
      (item.sku || "").toLowerCase().includes(alias)
    );

    const matchFinish =
      itemFinish.includes(finish.toLowerCase()) ||
      (item.name || "").toLowerCase().includes(finish.toLowerCase());

    return matchProfile && matchFinish;
  });

  if (filtered.length > 0) return filtered;

  // Fallback 1: relax the finish requirement and match the profile by item NAME / SKU (the
  // cf_finish field may be missing). Show any aluminium profile whose name carries the code.
  const nameFallback = combinedItems.filter((item) => {
    if (isComposite(item)) return false;
    const name = (item.name || "").toLowerCase();
    const sku = (item.sku || "").toLowerCase();
    return searchAliases.some((alias) => name.includes(alias) || sku.includes(alias));
  });
  if (nameFallback.length > 0) return nameFallback;

  // Fallback 2: if no matching profile found in Zoho, return a mock item to allow UI selection/creation
  const defaultName = getDefaultProfileName(profileCode, finish);
  if (defaultName) {
    return [
      {
        item_id: `MOCK_CREATE|${defaultName}`,
        name: `${defaultName} (Not in Zoho - Will Create)`,
        item_name: `${defaultName} (Not in Zoho - Will Create)`,
        sku: defaultName,
        status: "active",
        can_be_sold: true,
        can_be_purchased: true,
        track_inventory: true,
        stock_on_hand: 0,
      } as any
    ];
  }

  return [];
}

export async function searchHardwareItems(name: string): Promise<ItemDetail[]> {
  const body = await fetchJson<{ items: ItemDetail[] }>(
    `/api/zoho/items?search=${encodeURIComponent(name)}`,
  );
  return (body.items || []).filter((item) => !isComposite(item));
}

/* ------------------------------------------------------------------ */
/*  Helpers for API calls                                              */
/* ------------------------------------------------------------------ */

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

async function putJson<T>(url: string, payload: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

/* ------------------------------------------------------------------ */
/*  Helpers: create composite, check duplicity, build SO line items    */
/* ------------------------------------------------------------------ */

/** Check if a composite with this name already exists — avoids duplicates */
async function findExistingComposite(name: string): Promise<string | null> {
  try {
    const body = await fetchJson<{ items: ItemDetail[] }>(
      `/api/zoho/items?name=${encodeURIComponent(name)}`,
    );
    const match = (body.items || []).find((item) => {
      const n = (item.name || item.item_name || "").toLowerCase();
      return n === name.toLowerCase() && isComposite(item);
    });
    if (match) {
      console.log(`[RawMat] ✓ Existing composite found: "${name}" id=${match.item_id}`);
      return match.item_id;
    }
  } catch { /* proceed to create */ }
  return null;
}

/** Copy tax fields from a Zoho composite/item into a payload */
function copyTaxFields(source: Record<string, unknown>, target: Record<string, unknown>) {
  for (const f of [
    "tax_id", "tax_name", "tax_percentage", "tax_exemption_id",
    "tax_exemption_code", "hsn_or_sac", "sat_item_key_code",
    "purchase_tax_id", "purchase_tax_percentage",
  ]) {
    if (source[f] !== undefined && source[f] !== null && source[f] !== "") {
      target[f] = source[f];
    }
  }
}

/** Build SO line item payload preserving all tax fields from original */
function buildSoLineItem(li: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    item_id: li.composite_item_id || li.item_id,
    quantity: li.quantity,
    rate: li.rate,
    unit: li.unit,
  };
  for (const field of [
    "line_item_id", "tax_id", "tax_name", "tax_type", "tax_percentage",
    "tax_exemption_id", "tax_exemption_code", "hsn_or_sac",
    "item_tax", "item_tax_id", "item_tax_name", "item_tax_type",
    "item_tax_percentage", "discount", "discount_amount",
  ]) {
    if (li[field] !== undefined && li[field] !== null && li[field] !== "") {
      result[field] = li[field];
    }
  }
  return result;
}

/** Create a new composite item in Zoho */
async function createComposite(
  name: string,
  sku: string,
  original: CompositeItemDetail,
  mappedItems: Array<{ item_id: string; quantity: number }>,
  itemsCache: Record<string, ItemDetail | null>,
): Promise<string> {
  let finalMapped = [...mappedItems];
  if (finalMapped.length === 1 && finalMapped[0].quantity <= 1) {
    if (name !== "Drilling-1") {
      const drillingId = await resolveDrillingServiceId(itemsCache);
      if (drillingId && finalMapped[0].item_id !== drillingId) {
        console.log(`[RawMat] Auto-appending Drilling-1 service to composite "${name}" to avoid error 2056`);
        finalMapped.push({ item_id: drillingId, quantity: 1 });
      }
    }
  }

  const payload: Record<string, unknown> = {
    name,
    sku,
    unit: original.unit || "pcs",
    item_type: "inventory",
    mapped_items: finalMapped,
  };
  copyTaxFields(original as unknown as Record<string, unknown>, payload);
  if (original.custom_fields) payload.custom_fields = original.custom_fields;

  console.log(`[RawMat] Creating composite: "${name}" with ${finalMapped.length} items`);
  const { compositeItem: created } = await postJson<{ compositeItem: CompositeItemDetail }>(
    "/api/zoho/compositeitems",
    payload,
  );
  return created.item_id || (created as unknown as Record<string, string>).composite_item_id || "";
}

/* ------------------------------------------------------------------ */
/*  Scenario 2: Update ALL panels in the tree to use default stone     */
/* ------------------------------------------------------------------ */

/**
 * Recursively walk the BOM tree from a carcass/shutter down to all Panels.
 * At each Panel (deepest composite — no composite children), replace the
 * non-hardware raw material with the default stone. Uses PUT on existing items.
 */
async function updateStonesInTree(
  compositeId: string,
  defaultStoneId: string,
  itemsCache: Record<string, ItemDetail | null>,
  compositesCache: Record<string, CompositeItemDetail | null>,
  depth: number = 0,
): Promise<number> {
  if (depth > 6) return 0;

  const item = await fetchItem(compositeId, itemsCache);
  if (!item || !isComposite(item) || isHardwareComposite(item)) return 0;

  const composite = await fetchComposite(compositeId, compositesCache);
  if (!composite) return 0;

  const mapped = getMappedItems(composite);
  let updatedCount = 0;
  const originalName = item.name || item.item_name || "";
  const normalizedName = normalizePartOrPanelName(originalName);
  const nameChanged = normalizedName.toLowerCase() !== originalName.toLowerCase();

  if (originalName.toLowerCase().startsWith("part ")) {
    const drillingId = await resolveDrillingServiceId(itemsCache);
    let needsUpdate = false;
    let newMapped = mapped.map(mi => ({
      item_id: mi.item_id,
      quantity: mi.quantity || mi.quantity_needed || 1
    }));

    if (drillingId) {
      const hasDrilling = mapped.some(mi => mi.item_id === drillingId);
      if (!hasDrilling) {
        console.log(`[RawMat] Update: Adding missing Drilling-1 service to Part "${originalName}"`);
        newMapped.push({ item_id: drillingId, quantity: 1 });
        needsUpdate = true;
      }
    }

    if (needsUpdate || nameChanged) {
      const payload: Record<string, unknown> = { mapped_items: newMapped };
      if (nameChanged) {
        console.log(`[RawMat] Part name normalization: "${originalName}" -> "${normalizedName}"`);
        payload.name = normalizedName;
      }
      await putJson(`/api/zoho/compositeitems/${compositeId}`, payload);
      delete compositesCache[compositeId]; // invalidate cache
      updatedCount++;
    }
  }

  // Pre-fetch children to classify them
  const children: Array<{ mi: CompositeMappedItem; detail: ItemDetail }> = [];
  for (const mi of mapped) {
    const d = await fetchItem(mi.item_id, itemsCache);
    if (d) children.push({ mi, detail: d });
  }

  // Check if THIS composite is a Panel (Panels- SH Strip, Panels- SH, Panels- Cab)
  const isPanel = isPanelGroupMatch(item);

  if (isPanel) {
    // This is a Panel — replace the first non-composite, non-hardware item (shade/stone) with default
    let needsUpdate = false;
    const newMapped: Array<{ item_id: string; quantity: number }> = [];
    let stoneReplaced = false;

    for (const { mi, detail } of children) {
      const qty = mi.quantity || mi.quantity_needed || 1;
      if (!stoneReplaced && !isComposite(detail) && !isHardwareItem(detail)) {
        if (mi.item_id !== defaultStoneId) {
          // First non-composite, non-hardware item → replace with default stone
          console.log(`[RawMat] Panel "${originalName}": replacing "${detail.name || detail.item_name}" -> default ${defaultStoneId}`);
          newMapped.push({ item_id: defaultStoneId, quantity: qty });
          needsUpdate = true;
        } else {
          newMapped.push({ item_id: mi.item_id, quantity: qty });
        }
        stoneReplaced = true;
      } else {
        newMapped.push({ item_id: mi.item_id, quantity: qty });
      }
    }

    if (needsUpdate || nameChanged) {
      const payload: Record<string, unknown> = { mapped_items: newMapped };
      if (nameChanged) {
        console.log(`[RawMat] Panel name normalization: "${originalName}" -> "${normalizedName}"`);
        payload.name = normalizedName;
      }
      await putJson(`/api/zoho/compositeitems/${compositeId}`, payload);
      delete compositesCache[compositeId]; // invalidate cache
      updatedCount++;
    }
  } else {
    // Not a Panel — recurse into ALL composite children
    for (const { mi, detail } of children) {
      if (isComposite(detail) && !isHardwareComposite(detail)) {
        updatedCount += await updateStonesInTree(mi.item_id, defaultStoneId, itemsCache, compositesCache, depth + 1);
      }
    }
  }
  return updatedCount;
}

/* ------------------------------------------------------------------ */
/*  Scenario 1: Clone the ENTIRE BOM tree with new stone               */
/* ------------------------------------------------------------------ */

/**
 * Recursively clone a composite tree top-down. At every Panel (deepest
 * composite), replace the stone raw material with newStoneId.
 * Each intermediate composite (Set of Parts, Part) is cloned with
 * "-{soNumber}" appended. Checks for existing clones to avoid duplicates.
 * Returns the new composite's item_id.
 */
async function cloneCompositeTree(
  compositeId: string,
  soNumber: string,
  newStoneId: string,
  oldFinish: string,
  newFinish: string,
  itemsCache: Record<string, ItemDetail | null>,
  compositesCache: Record<string, CompositeItemDetail | null>,
  depth: number = 0,
): Promise<string> {
  if (depth > 6) throw new Error("BOM tree too deep (>6 levels)");

  const composite = await fetchComposite(compositeId, compositesCache);
  if (!composite) throw new Error(`Could not fetch composite ${compositeId}`);
  let originalName = composite.name || composite.item_name || "";
  if (oldFinish && newFinish) {
    const regex = new RegExp(escapeRegExp(oldFinish), "gi");
    originalName = originalName.replace(regex, newFinish);
  }
  originalName = normalizePartOrPanelName(originalName);
  const newName = `${originalName}-${soNumber}`;

  let originalSku = composite.sku || "";
  if (oldFinish && newFinish) {
    const regex = new RegExp(escapeRegExp(oldFinish), "gi");
    originalSku = originalSku.replace(regex, newFinish);
  }
  const newSku = originalSku ? `${originalSku}-${soNumber}` : "";

  // Duplicity check — reuse if already exists
  const existingId = await findExistingComposite(newName);
  if (existingId) return existingId;

  const mapped = getMappedItems(composite);

  // Pre-fetch children to classify them
  const children: Array<{ mi: CompositeMappedItem; detail: ItemDetail | null }> = [];
  for (const mi of mapped) {
    const d = await fetchItem(mi.item_id, itemsCache);
    children.push({ mi, detail: d });
  }

  // Check if this composite is a Panel (Panels- SH Strip, Panels- SH, Panels- Cab)
  const item = await fetchItem(compositeId, itemsCache);
  const isPanel = item ? isPanelGroupMatch(item) : false;

  // Build new mapped items
  const newMappedItems: Array<{ item_id: string; quantity: number }> = [];
  let stoneReplaced = false;

  for (const { mi, detail } of children) {
    const qty = mi.quantity || mi.quantity_needed || 1;

    if (detail && isComposite(detail) && !isHardwareComposite(detail)) {
      // Composite child — recursively clone it
      const clonedId = await cloneCompositeTree(
        mi.item_id,
        soNumber,
        newStoneId,
        oldFinish,
        newFinish,
        itemsCache,
        compositesCache,
        depth + 1
      );
      newMappedItems.push({ item_id: clonedId, quantity: qty });
    } else if (isPanel && !stoneReplaced && detail && !isComposite(detail) && !isHardwareItem(detail)) {
      // Panel-level: first non-composite, non-hardware item → replace with new stone
      console.log(`[RawMat] Clone: Panel "${originalName}" replacing "${detail.name || detail.item_name}" → newStone ${newStoneId}`);
      newMappedItems.push({ item_id: newStoneId, quantity: qty });
      stoneReplaced = true;
    } else {
      // Hardware, service items, or non-panel items — keep as-is
      newMappedItems.push({ item_id: mi.item_id, quantity: qty });
    }
  }
  
  // If this is a Part (Level 3), ensure Drilling-1 service is attached
  if (originalName.toLowerCase().startsWith("part ")) {
    const drillingId = await resolveDrillingServiceId(itemsCache);
    if (drillingId) {
      const hasDrilling = newMappedItems.some(mi => mi.item_id === drillingId);
      if (!hasDrilling) {
        console.log(`[RawMat] Clone: Adding missing Drilling-1 service to Part "${originalName}"`);
        newMappedItems.push({ item_id: drillingId, quantity: 1 });
      }
    }
  }

  // Create the cloned composite
  const newId = await createComposite(newName, newSku, composite, newMappedItems, itemsCache);
  return newId;
}

/* ------------------------------------------------------------------ */
/*  Apply Changes — handles ALL carcasses, ALL panels in the tree      */
/* ------------------------------------------------------------------ */

/**
 * Scenario 2 (default, checkbox unchecked):
 *   Update ALL panels in ALL carcasses to use the default stone.
 *   No new items created — uses PUT on existing panel composites.
 *
 * Scenario 1 (checkbox checked, user selected new stone):
 *   Clone the ENTIRE BOM tree (all branches) for each carcass.
 *   Replace stone in every Panel with user-selected stone.
 *   Update SO to point to new carcass items.
 */
export async function applyStoneChange(
  group: StoneGroup,
  soNumber: string,
  orderId: string,
  order: SalesOrderDetail,
): Promise<{ success: boolean; error?: string; newCarcassIds?: Record<string, string> }> {
  const itemsCache: Record<string, ItemDetail | null> = {};
  const compositesCache: Record<string, CompositeItemDetail | null> = {};

  try {
    if (!group.changed) {
      // Scenario 2: apply default stone to ALL panels in all carcasses
      if (!group.defaultStoneId) {
        console.log(`[RawMat] Scenario 2: no default stone found, skipping`);
        return { success: true };
      }
      console.log(`[RawMat] Scenario 2: applying default stone "${group.defaultStoneName}" to ${group.carcassItemIds.length} carcass(es)`);
      let totalUpdated = 0;
      for (const carcassId of group.carcassItemIds) {
        const count = await updateStonesInTree(carcassId, group.defaultStoneId, itemsCache, compositesCache);
        totalUpdated += count;
      }
      console.log(`[RawMat] Scenario 2: updated ${totalUpdated} panels`);
      return { success: true };
    }

    // Scenario 1: clone entire tree with new stone
    if (!group.newStoneId) {
      return { success: false, error: "No stone selected" };
    }

    console.log(`[RawMat] Scenario 1: cloning ${group.carcassItemIds.length} carcass(es) with new stone "${group.newStoneName}"`);
    const newCarcassIds: Record<string, string> = {};

    for (const carcassId of group.carcassItemIds) {
      const newId = await cloneCompositeTree(
        carcassId,
        soNumber,
        group.newStoneId,
        group.finish,
        group.newStoneName,
        itemsCache,
        compositesCache
      );
      newCarcassIds[carcassId] = newId;
      console.log(`[RawMat] Cloned carcass: ${carcassId} → ${newId}`);
    }

    // Update SO — replace old carcass items with new cloned ones
    if (Object.keys(newCarcassIds).length > 0 && order.line_items) {
      const updatedLineItems = order.line_items.map((li) => {
        const itemId = li.composite_item_id || li.item_id || "";
        if (newCarcassIds[itemId]) {
          return { ...li, item_id: newCarcassIds[itemId], composite_item_id: newCarcassIds[itemId] };
        }
        return li;
      });

      await putJson(`/api/zoho/salesorders/${orderId}`, {
        line_items: updatedLineItems.map((li) => buildSoLineItem(li as unknown as Record<string, unknown>)),
      });
      console.log(`[RawMat] SO ${soNumber} updated with new carcass items`);
    }

    return { success: true, newCarcassIds };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Apply profile raw material change — same tree-wide approach.
 */
async function resolveRawProfileId(rawProfileId: string, finish: string): Promise<string> {
  if (!rawProfileId.startsWith("MOCK_CREATE|")) {
    return rawProfileId;
  }
  const itemName = rawProfileId.split("|")[1];

  try {
    // Search Zoho first to check if the item has since been created
    const body = await fetchJson<{ items: ItemDetail[] }>(
      `/api/zoho/items?name=${encodeURIComponent(itemName)}`
    );
    const match = (body.items || []).find(
      (item) => (item.name || item.item_name || "").toLowerCase() === itemName.toLowerCase()
    );
    if (match) {
      return match.item_id;
    }
  } catch (err) {
    console.error("[RawMat] Error checking Zoho for raw profile:", err);
  }

  // Create it in Zoho
  const payload = {
    name: itemName,
    sku: itemName,
    rate: 0,
    purchase_rate: 0,
    can_be_sold: true,
    can_be_purchased: true,
    account_id: "3418412000000000486",
    purchase_account_id: "3418412000000000567",
    inventory_account_id: "3418412000000000626",
    track_inventory: true,
    is_taxable: true,
    custom_fields: [
      { api_name: "cf_group", value: "Aluminium Profile & Parts" },
      { api_name: "cf_finish", value: finish }
    ]
  };

  const created = await postJson<{ item?: ItemDetail; error?: string }>("/api/zoho/items", payload);
  if (!created.item || !created.item.item_id) {
    throw new Error(`Failed to create raw profile item: ${created.error || "unknown error"}`);
  }
  return created.item.item_id;
}

export async function applyProfileChange(
  group: ProfileGroup,
  soNumber: string,
  orderId: string,
  order: SalesOrderDetail,
): Promise<{ success: boolean; error?: string }> {
  if (!group.changed || !group.newProfileId) {
    return { success: true };
  }

  const itemsCache: Record<string, ItemDetail | null> = {};
  const compositesCache: Record<string, CompositeItemDetail | null> = {};

  try {
    const realProfileId = await resolveRawProfileId(group.newProfileId, group.finish);
    const newTopIds: Record<string, string> = {};
    const newFinish = getNewFinishFromProfileName(group.newProfileName, group.finish);
    for (const profileItemId of group.profileItemIds) {
      const newId = await cloneCompositeTree(
        profileItemId,
        soNumber,
        realProfileId,
        group.finish,
        newFinish,
        itemsCache,
        compositesCache
      );
      newTopIds[profileItemId] = newId;
    }

    if (Object.keys(newTopIds).length > 0 && order.line_items) {
      const updatedLineItems = order.line_items.map((li) => {
        const itemId = li.composite_item_id || li.item_id || "";
        if (newTopIds[itemId]) {
          return { ...li, item_id: newTopIds[itemId], composite_item_id: newTopIds[itemId] };
        }
        return li;
      });

      await putJson(`/api/zoho/salesorders/${orderId}`, {
        line_items: updatedLineItems.map((li) => buildSoLineItem(li as unknown as Record<string, unknown>)),
      });
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
