import type { KitchenWorkspaceEntry } from "./kitchen-workspace";
import { normalizeMarginPricing } from "./normalize-margin-pricing";

export function comparisonProjectPricing(entry: KitchenWorkspaceEntry) {
  entry = normalizeMarginPricing(entry);
  let factors: Record<string, unknown> = {};
  for (const row of entry.rows ?? []) {
    if (row["Record Type"] !== "settings") continue;
    try { const data = JSON.parse(row.Data); if (data?.pricing && typeof data.pricing === "object") factors = data.pricing; } catch { /* A missing rate does not invalidate the saved amounts. */ }
  }
  const snapshot = entry.costing;
  const combined = (snapshot?.materialCost ?? 0) + (snapshot?.transportation ?? 0) + (snapshot?.installation ?? 0) + (snapshot?.loading ?? 0);
  const subtotal = combined + (snapshot?.conversion ?? 0);
  const percentage = (key: string, amount: number, base: number) => typeof factors[key] === "number" ? factors[key] as number : base > 0 ? amount / base * 100 : null;
  const service = (key: "transportation" | "installation" | "loading") => {
    const saved = factors[key] as { mode?: unknown; value?: unknown } | undefined;
    return saved && (saved.mode === "sqft" || saved.mode === "direct") && typeof saved.value === "number"
      ? { mode: saved.mode as "sqft" | "direct", value: saved.value } : null;
  };
  return { transportation: snapshot?.transportation ?? 0, installation: snapshot?.installation ?? 0, loading: snapshot?.loading ?? 0,
    combined, conversion: snapshot?.conversion ?? 0, subtotal, tax: snapshot?.tax ?? 0,
    total: snapshot?.total ?? 0,
    rates: { transportation: service("transportation"), installation: service("installation"), loading: service("loading"),
      conversionPct: percentage("conversionPct", snapshot?.conversion ?? 0, subtotal),
      includeTax: typeof factors.includeTax === "boolean" ? factors.includeTax : !!snapshot?.tax } };
}
