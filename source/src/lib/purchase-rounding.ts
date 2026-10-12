export type PurchaseDetail = {
  category: string; itemCode: string; item: string;
  billableQty: number; uom: string; rate: number; amount: number;
  allocatedBillableQty?: number;
};

export type PurchaseTotal = {
  key: string; itemCode: string; item: string; categories: string[];
  unit: string; requiredQty: number; quantity: number; rate: number; amount: number;
  rounded: boolean;
};

export const roundQuantity = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** Preserve partial input while typing, but never retain more than two decimals. */
export function sheetQuantityInput(value: string): string {
  if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) return value;
  const quantity = Number(value);
  return Number.isFinite(quantity) ? roundQuantity(quantity).toFixed(2) : "";
}

// Suppress floating-point noise at whole-number boundaries, not genuine fractions.
export function ceilQuantity(value: number): number {
  if (value <= 0) return 0;
  const nearest = Math.round(value);
  return Math.abs(value - nearest) <= Number.EPSILON * Math.max(1, Math.abs(value)) * 16
    ? nearest : Math.ceil(value);
}

function purchaseBasis(detail: PurchaseDetail) {
  const processing = /processing$/i.test(detail.category);
  const sheet = detail.uom === "sqft" && !processing &&
    (/board|laminate|counter ply/i.test(detail.category)) && !/glass/i.test(detail.category);
  const divisor = sheet ? 32 : detail.uom === "gm" ? 1000 : 1;
  const unit = sheet ? "sheet" : detail.uom === "gm" ? "kg" : detail.uom;
  const rate = Number((detail.rate * divisor).toPrecision(14));
  // Categories and waste percentages do not split the same purchased item.
  // Distinct quoted prices remain separate (e.g. different laminate selections).
  const identity = detail.itemCode === "—" || detail.itemCode.startsWith("CUSTOM")
    ? `${detail.itemCode}|${detail.item}` : detail.itemCode;
  const key = JSON.stringify([identity, unit, rate, processing]);
  // Whole-unit rounding stays disabled; round consolidated quantities to two decimals.
  return { key, unit, rate, divisor, rounded: false };
}

export function purchaseTotals(details: PurchaseDetail[]): PurchaseTotal[] {
  const groups = new Map<string, PurchaseTotal>();
  for (const detail of details) {
    const basis = purchaseBasis(detail);
    const found = groups.get(basis.key);
    if (found) {
      found.requiredQty += detail.billableQty / basis.divisor;
      if (!found.categories.includes(detail.category)) found.categories.push(detail.category);
    } else groups.set(basis.key, {
      key: basis.key, itemCode: detail.itemCode, item: detail.item, categories: [detail.category],
      unit: basis.unit, requiredQty: detail.billableQty / basis.divisor,
      quantity: 0, rate: basis.rate, amount: 0, rounded: basis.rounded,
    });
  }
  return [...groups.values()].map(group => {
    const quantity = roundQuantity(group.requiredQty);
    return { ...group, quantity, amount: quantity * group.rate };
  });
}

/** Allocate each whole-project purchase cost by usage; never round each cabinet. */
export function allocatePurchaseCosts<T extends { details: PurchaseDetail[]; qty: number; cost: number; unitCost: number }>(
  lines: T[], wholeProject?: PurchaseTotal[],
): PurchaseTotal[] {
  const totals = wholeProject ?? purchaseTotals(lines.flatMap(line => line.details));
  const groups = new Map(totals.map(group => [group.key, group]));
  for (const line of lines) {
    for (const detail of line.details) {
      const basis = purchaseBasis(detail);
      const group = groups.get(basis.key);
      if (!group) throw new Error(`Missing project purchase total for ${detail.itemCode}`);
      const factor = group.requiredQty > 0 ? group.quantity / group.requiredQty : 0;
      detail.allocatedBillableQty = detail.billableQty * factor;
      detail.amount = group.requiredQty > 0
        ? (detail.billableQty / basis.divisor / group.requiredQty) * group.amount : 0;
    }
    line.cost = line.details.reduce((sum, detail) => sum + detail.amount, 0);
    line.unitCost = line.qty ? line.cost / line.qty : 0;
  }
  return totals;
}
