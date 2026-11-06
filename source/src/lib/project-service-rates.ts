import type { KitchenWorkspaceEntry } from "./kitchen-workspace";
import { conversionMarginTotals, validConversionMargin } from "./conversion-margin";
import { normalizeMarginPricing } from "./normalize-margin-pricing";
export type ProjectServiceRates = { transportation: number; installation: number; loading: number; conversionPct: number; includeTax: boolean;
  modes?: Partial<Record<"transportation" | "installation" | "loading", "sqft" | "direct">> };
export const DEFAULT_SERVICE_RATES: ProjectServiceRates = { transportation: 15, installation: 95, loading: 5, conversionPct: 40, includeTax: false };
export function validServiceRates(value: unknown): value is ProjectServiceRates {
  if (!value || typeof value !== "object") return false;
  const rates = value as ProjectServiceRates;
  return validConversionMargin(rates.conversionPct) && (rates.modes === undefined || !!rates.modes && typeof rates.modes === "object" && !Array.isArray(rates.modes) && Object.entries(rates.modes).every(([key, mode]) => ["transportation", "installation", "loading"].includes(key) && ["sqft", "direct"].includes(mode))) && typeof rates.includeTax === "boolean" && (["transportation", "installation", "loading", "conversionPct"] as const)
    .every(key => typeof rates[key] === "number" && Number.isFinite(rates[key]) && rates[key] >= 0 && rates[key] <= (key.endsWith("Pct") ? 1000 : 1_000_000));
}
export function servicePricingFactors(rates: ProjectServiceRates, reason: string) {
  return { conversionPct: rates.conversionPct, conversionModel: "margin" as const, includeTax: rates.includeTax,
    transportation: { mode: rates.modes?.transportation ?? "sqft", value: rates.transportation }, installation: { mode: rates.modes?.installation ?? "sqft", value: rates.installation },
    loading: { mode: rates.modes?.loading ?? "sqft", value: rates.loading }, _serviceRateApproval: { rates, reason } };
}
export function servicePriceTotals(itemCost: number, area: number, rates: ProjectServiceRates) {
  const charge = (key: "transportation" | "installation" | "loading") => rates[key] * (rates.modes?.[key] === "direct" ? 1 : area);
  const transportation = charge("transportation"), installation = charge("installation"), loading = charge("loading");
  const combined = itemCost + transportation + installation + loading;
  const { conversion, tax, total } = conversionMarginTotals(combined, rates.conversionPct, rates.includeTax);
  return { transportation, installation, loading, conversion, tax, total, conversionModel: "margin" as const };
}
/** Changes quote factors only; saved material quantities and item prices stay intact. */
export function withServiceRates(entry: KitchenWorkspaceEntry, rates: ProjectServiceRates, reason: string): KitchenWorkspaceEntry {
  if (!entry.costing) throw new Error("A saved item breakdown is required before changing service rates.");
  let found = false;
  const rows = entry.rows.map(row => {
    if (row["Record Type"] !== "settings") return row;
    found = true;
    const settings = JSON.parse(row.Data);
    return { ...row, Data: JSON.stringify({ ...settings, pricing: { ...settings.pricing, ...servicePricingFactors(rates, reason) } }) };
  });
  if (!found) rows.push({ "Record Type": "settings", Data: JSON.stringify({ pricing: servicePricingFactors(rates, reason) }) });
  return normalizeMarginPricing({ ...entry, rows, costing: { ...entry.costing, ...servicePriceTotals(entry.costing.materialCost, entry.costing.areaSqft, rates) } });
}
