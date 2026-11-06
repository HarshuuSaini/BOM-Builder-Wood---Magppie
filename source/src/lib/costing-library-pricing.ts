import type { KitchenCostingSnapshot } from "@/lib/kitchen-workspace";

export function costingLibraryPricing(costing: Partial<KitchenCostingSnapshot>, admin: boolean): Array<[string, number]> {
  const rows: Array<[string, number]> = [["Item cost", costing.materialCost ?? 0]];
  if (admin) rows.push(
    ["Installation", costing.installation ?? 0], ["Transportation", costing.transportation ?? 0],
    ["Loading / Unloading", costing.loading ?? 0], ["Conversion", costing.conversion ?? 0],
    ["Tax", costing.tax ?? 0], ["Total", costing.total ?? 0],
  );
  return rows;
}
