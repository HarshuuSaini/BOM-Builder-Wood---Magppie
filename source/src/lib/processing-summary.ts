type ProcessingDetail = {
  category: string; itemCode: string; item: string; uom: string;
  billableQty: number; rate: number; amount: number;
};
export type ProcessingSummary = { key: string; material: string; sqft: number; rate: number; total: number };

/** Display-only consolidation: preserve the charged area and amount exactly. */
export function summarizeProcessingCosts(lines: ReadonlyArray<{ details: ReadonlyArray<ProcessingDetail> }>): ProcessingSummary[] {
  const groups = new Map<string, ProcessingSummary>();
  for (const line of lines) for (const detail of line.details) {
    if (!/processing$/i.test(detail.category)) continue;
    const key = JSON.stringify([detail.itemCode, detail.item, detail.uom, detail.rate]);
    const row = groups.get(key) ?? { key, material: detail.item, sqft: 0, rate: detail.rate, total: 0 };
    row.sqft += detail.billableQty;
    row.total += detail.amount;
    groups.set(key, row);
  }
  return [...groups.values()];
}
