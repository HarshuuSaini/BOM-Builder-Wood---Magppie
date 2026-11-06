type ProjectRow = { "Record Type": string; Data: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Designer restores receive item processing rates without any project pricing factors. */
export function stripDesignerProjectRows<T extends ProjectRow>(rows: readonly T[]): T[] {
  return rows.map(row => {
    if (row["Record Type"] !== "settings") return { ...row };
    let settings: unknown;
    try { settings = JSON.parse(row.Data); }
    catch { settings = undefined; }
    // Never forward unparsed settings at the API boundary: they may contain private factors.
    const data = isRecord(settings) ? settings : {};
    data.itemProcessingRates = isRecord(data.pricing) && isRecord(data.pricing.processingRates)
      ? data.pricing.processingRates
      : isRecord(data.itemProcessingRates) ? data.itemProcessingRates : {};
    if (isRecord(data.pricing) && isRecord(data.pricing.wasteOverrides)) data.itemWasteOverrides = data.pricing.wasteOverrides;
    delete data.pricing;
    return { ...row, Data: JSON.stringify(data) };
  });
}

const PRIVATE_SNAPSHOT_FIELDS = [
  "conversion", "profit", "transportation", "installation", "loading", "tax", "total",
  // Also omit derived aggregates if a caller supplies an extended pricing snapshot.
  "combinedSubtotal", "convertedCost", "subtotal", "grandTotal", "finalTotal",
] as const;

function omitPrivateSnapshotFields(value: Record<string, unknown>) {
  for (const key of PRIVATE_SNAPSHOT_FIELDS) delete value[key];
}

/**
 * View-only projection for both saved summaries and saved details. The generic
 * preserves existing caller assignment types; private view fields are absent at
 * runtime, so user-facing consumers must not assume those fields are populated.
 * Always retain the full original object for server persistence and calculations.
 */
export function exposeSavedCosting<T extends object>(saved: T, role: "admin" | "user"): T {
  if (role === "admin") return saved;
  const exposed = structuredClone(saved);
  const summary = exposed as Record<string, unknown>;
  omitPrivateSnapshotFields(summary);
  if (isRecord(summary.entry)) {
    const entry = summary.entry;
    if (Array.isArray(entry.rows)) entry.rows = stripDesignerProjectRows(entry.rows);
    if (isRecord(entry.costing)) omitPrivateSnapshotFields(entry.costing);
    if (Array.isArray(entry.priceChanges)) entry.priceChanges = entry.priceChanges.filter(change =>
      !isRecord(change) || typeof change.key !== "string" || !/\.pricing\.(transportation|installation|loading|conversionPct|profitPct|includeTax)(\.|$)/.test(change.key));
    // User-imported manual comparisons (including extraCharges) remain intact.
  }
  return exposed;
}

/**
 * The designer/admin split exists only where local accounts and saved costings run.
 * Without them (production) every login keeps the full pricing view; editing factors
 * still requires the admin password.
 */
export function showsProjectPricing(role: "admin" | "user", localCostingsEnabled: boolean) {
  return !localCostingsEnabled || role === "admin";
}
