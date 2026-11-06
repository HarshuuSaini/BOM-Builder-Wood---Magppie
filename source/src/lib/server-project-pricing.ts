import type { KitchenWorkspaceEntry } from "@/lib/kitchen-workspace";
import { conversionMarginTotals } from "./conversion-margin";

const defaults = { conversionPct: 40, conversionModel: "margin", includeTax: false,
  transportation: { mode: "sqft", value: 15 }, installation: { mode: "sqft", value: 95 }, loading: { mode: "sqft", value: 5 } };

function settings(entry?: KitchenWorkspaceEntry): Record<string, any> {
  const row = entry?.rows.find(row => row["Record Type"] === "settings");
  try { const parsed = row && JSON.parse(row.Data); return parsed && typeof parsed === "object" ? parsed : {}; }
  catch { return {}; }
}

/** Designer edits retain the server's approved quote factors, never client-supplied factors. */
export function priceDesignerCosting(entry: KitchenWorkspaceEntry, previous?: KitchenWorkspaceEntry): KitchenWorkspaceEntry {
  const stored = settings(previous).pricing ?? {};
  const factors = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, stored[key] ?? fallback]));
  if (stored._serviceRateApproval) factors._serviceRateApproval = stored._serviceRateApproval;
  const incoming = settings(entry);
  const processingRates = incoming.pricing?.processingRates ?? incoming.itemProcessingRates ?? stored.processingRates ?? {};
  const rows = entry.rows.map(row => {
    if (row["Record Type"] !== "settings") return row;
    const data: Record<string, unknown> = { ...incoming, pricing: { ...factors, processingRates, ...(stored.wasteOverrides ? { wasteOverrides: stored.wasteOverrides } : {}) } };
    delete data.itemWasteOverrides;
    delete data.itemProcessingRates;
    return { ...row, Data: JSON.stringify(data) };
  });
  if (!entry.costing) return { ...entry, rows };
  const item = entry.costing;
  const charge = (key: string) => {
    const service = factors[key] as { mode: string; value: number | "" };
    return Number(service.value || 0) * (service.mode === "sqft" ? item.areaSqft : 1);
  };
  const transportation = charge("transportation"), installation = charge("installation"), loading = charge("loading");
  const combined = item.materialCost + transportation + installation + loading;
  const { conversion, tax, total } = conversionMarginTotals(combined, Number(factors.conversionPct || 0), !!factors.includeTax);
  const { profit: _legacy, ...snapshot } = item as typeof item & { profit?: number };
  return { ...entry, rows, costing: { ...snapshot, transportation, installation, loading, conversion, conversionModel: "margin", tax, total } };
}
