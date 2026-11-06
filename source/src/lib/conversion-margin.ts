export function validConversionMargin(value: unknown): boolean {
  return (value === "" || typeof value === "number") && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) < 100;
}
export function conversionMarginTotals(combinedCost: number, conversionPct: number | "", includeTax: boolean) {
  if (!validConversionMargin(conversionPct)) throw new Error("Conversion must be at least 0% and below 100%.");
  const subtotal = combinedCost / (1 - Number(conversionPct || 0) / 100);
  const conversion = subtotal - combinedCost;
  const tax = includeTax ? subtotal * 0.18 : 0;
  return { conversion, subtotal, tax, total: subtotal + tax };
}
