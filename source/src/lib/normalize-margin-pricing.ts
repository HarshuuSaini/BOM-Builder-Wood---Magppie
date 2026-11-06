import type { KitchenWorkspaceEntry } from "./kitchen-workspace";
import { conversionMarginTotals, validConversionMargin } from "./conversion-margin";
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "profit" && key !== "profitPct").map(([key, child]) => [key, clean(child)]));
}
export function stripLegacyProfit<T>(value: T): T { return clean(value) as T; }
/** Read older quotes using the current margin rule; original revision records remain intact. */
export function normalizeMarginPricing(entry: KitchenWorkspaceEntry): KitchenWorkspaceEntry {
  let factors: Record<string, unknown> = {};
  const rows = (entry.rows ?? []).map(row => {
    if (row["Record Type"] !== "settings") return row;
    try {
      const settings = clean(JSON.parse(row.Data)) as Record<string, any>;
      if (settings.pricing && typeof settings.pricing === "object") {
        factors = settings.pricing;
        settings.pricing.conversionModel = "margin";
      }
      return { ...row, Data: JSON.stringify(settings) };
    } catch { return row; }
  });
  const priceChanges = entry.priceChanges?.filter(change => !/\.profitPct$/.test(change.key));
  const result = { ...entry, rows, ...(priceChanges ? { priceChanges } : {}) };
  const snapshot = entry.costing;
  if (!snapshot) return result;
  const cleaned = clean(snapshot) as typeof snapshot;
  if (![snapshot.materialCost, snapshot.transportation, snapshot.installation, snapshot.loading, snapshot.conversion].every(value => typeof value === "number" && Number.isFinite(value))) return { ...result, costing: cleaned };
  const combined = snapshot.materialCost + snapshot.transportation + snapshot.installation + snapshot.loading;
  const inferred = combined > 0 ? snapshot.conversion / (snapshot.conversionModel === "margin" ? combined + snapshot.conversion : combined) * 100 : 0;
  const conversionPct = factors.conversionPct === "" ? 0 : factors.conversionPct ?? inferred;
  if (!validConversionMargin(conversionPct)) throw new Error("Conversion must be at least 0% and below 100%.");
  const totals = conversionMarginTotals(combined, conversionPct as number, typeof factors.includeTax === "boolean" ? factors.includeTax : snapshot.tax > 0);
  return { ...result, costing: { ...cleaned, conversion: totals.conversion, tax: totals.tax, total: totals.total, conversionModel: "margin" } };
}
