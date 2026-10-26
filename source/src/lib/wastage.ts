/** Waste is a share of gross material, so net = gross × (1 - waste%). */
export function quantityWithWaste(net: number, wastePercent: number): number {
  if (!Number.isFinite(wastePercent) || wastePercent < 0 || wastePercent >= 100) {
    throw new RangeError("Wastage must be at least 0% and below 100%.");
  }
  return net / (1 - wastePercent / 100);
}
