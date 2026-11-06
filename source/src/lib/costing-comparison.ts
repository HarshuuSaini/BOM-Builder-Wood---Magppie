import type { KitchenCostingItem } from "./kitchen-workspace";
import type { SavedCosting } from "./local-costing-store";
import { priceChangesFor } from "./price-change-audit";
import { COSTING_ITEMS } from "./costing";
import { comparisonProjectPricing } from "./comparison-project-pricing";

export const COMPARISON_CATEGORIES = ["Carcass", "Shutter", "Visible side", "Drawer", "Counter ply", "Edge band", "Laminate", "Processing", "Hardware", "Accessories", "Handles", "Hinges", "Profiles", "Lighting", "Consumables / other"] as const;
type Category = typeof COMPARISON_CATEGORIES[number];
const masters = new Map(COSTING_ITEMS.map(item => [item.id, item]));
const materialFor = (item: KitchenCostingItem) => masters.get(item.itemCode.replace(/-PROC$|-FINISH-.*$/i, ""));
/** Each priced row belongs to exactly one category, including its finishing charge. */
export function comparisonCategory(item: KitchenCostingItem): Category {
  const category = item.category.toLowerCase(), text = `${item.itemCode} ${item.item}`;
  const master = materialFor(item);
  if (/processing\b/.test(category)) return "Processing";
  if (!/adhesive|glue/i.test(`${category} ${text}`)) {
    if (/edge\s*band/i.test(`${category} ${text}`) || master?.group === "Edge Band") return "Edge band";
    // Membrane PVC foil is a facing like laminate, retained as its own detail line.
    if (/laminate|pvc foil/i.test(`${category} ${text}`)) return "Laminate";
  }
  if (/visible side/.test(category)) return "Visible side";
  if (/shutter/.test(category)) return "Shutter";
  if (/carcass|glass shelf/.test(category)) return "Carcass";
  if (/counter ply/.test(category)) return "Counter ply";
  if (/drawer/.test(category) && !/system/.test(category)) return "Drawer";
  // Explicit accessory rows include manually priced catalog and custom items.
  // Their names must not accidentally send them to hardware/profile categories.
  if (category === "accessory" && (!master || master.group === "Accessory")) return "Accessories";
  if (/\bhinge/i.test(text)) return "Hinges";
  if (/hardware|drawer system|skirting \/ leg/.test(category) || /Hardware|Skirting \/ Leg/i.test(master?.group ?? "") || /\bFIXING PLATE\b/i.test(text)) return "Hardware";
  if (/\bhandle\b|KITCHEN-(?:040|043|049|050|051)(?:\b|-)|END CAP FOR [CJ] TYPE/i.test(text)) return "Handles";
  if (/profile/.test(category) || /\b(?:ALU PROF|DIFFUSER|PROFILE|SKIRTING)\b/i.test(text)) return "Profiles";
  if (master?.group === "LIGHT" || /\b(?:LED|LIGHT DRIVER|LIGHT EXTENSION)\b/i.test(text)) return "Lighting";
  if (/accessor/.test(category)) return "Accessories";
  if (/hardware|drawer system|skirting \/ leg/.test(category)) return "Hardware";
  return "Consumables / other";
}

function comparisonMaterial(item: KitchenCostingItem) {
  const master = materialFor(item);
  // Saved item names preserve the selected material/finish. The master supplies
  // thickness only when that dimension is not already in the saved name.
  const savedThickness = /(?:^|[- ·])(\d+(?:\.\d+)?)\s*mm\b/i.exec(item.item)?.[1];
  const thicknessMm = savedThickness ? Number(savedThickness) : master?.thicknessMm ?? null;
  return { name: item.item, component: item.category, thicknessMm };
}

export function compareCostings(costings: SavedCosting[]) {
  const columns = costings.map(s => {
    const totals = Object.fromEntries(COMPARISON_CATEGORIES.map(c => [c, 0])) as Record<Category, number>;
    const accessories: Record<string, number> = {};
    const names: Record<string, string> = {};
    const details = Object.fromEntries(COMPARISON_CATEGORIES.map(c => [c, {}])) as Record<Category, Record<string, ReturnType<typeof comparisonMaterial> & { amount: number }>>;
    for (const item of s.entry.costing?.items ?? []) {
      const category = comparisonCategory(item);
      totals[category] += item.amount;
      if (category !== "Accessories" || item.rate > 0 && item.amount > 0) {
        const material = comparisonMaterial(item);
        const key = JSON.stringify([item.itemCode, material.name, material.component, material.thicknessMm, item.unit]);
        details[category][key] = { ...material, amount: (details[category][key]?.amount ?? 0) + item.amount };
      }
      if (category === "Accessories" && item.rate > 0 && item.amount > 0) {
        const key = JSON.stringify([item.itemCode, item.item]);
        accessories[key] = (accessories[key] ?? 0) + item.amount;
        names[key] = item.item;
      }
    }
    return { id: s.id, name: s.name, totals, accessories, names, details, hasSnapshot: !!s.entry.costing,
      projectPricing: comparisonProjectPricing(s.entry),
      priceChanges: priceChangesFor(s.entry, s.entry),
      itemCost: s.materialCost, areaSqft: s.areaSqft, total: s.total, version: s.version,
      unpriced: s.entry.costing?.unpriced ?? [],
      adjustment: s.materialCost - Object.values(totals).reduce((sum, n) => sum + n, 0) };
  });
  const accessoryNames = Object.assign({}, ...columns.map(c => c.names)) as Record<string, string>;
  const accessories = Object.keys(accessoryNames).sort((a, b) => accessoryNames[a].localeCompare(accessoryNames[b])).map(key => ({
    key, name: accessoryNames[key], amounts: columns.map(c => c.accessories[key] ?? 0),
  }));
  const breakdowns = Object.fromEntries(COMPARISON_CATEGORIES.map(category => {
    const materials = Object.assign({}, ...columns.map(c => c.details[category])) as typeof columns[number]["details"][Category];
    return [category, Object.entries(materials).sort(([, a], [, b]) => a.component.localeCompare(b.component) || a.name.localeCompare(b.name)).map(([key, material]) => ({
      key, name: material.name, component: material.component, thicknessMm: material.thicknessMm,
      amounts: columns.map(c => c.details[category][key]?.amount ?? 0), present: columns.map(c => !!c.details[category][key]),
    }))];
  })) as Record<Category, { key: string; name: string; component: string; thicknessMm: number | null; amounts: number[]; present: boolean[] }[]>;
  return { columns, accessories, breakdowns, categories: COMPARISON_CATEGORIES };
}
export type CostingComparisonData = ReturnType<typeof compareCostings>;
