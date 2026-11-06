/** Fixed purchase wastage for cut-length accessories; hardware and LEDs unchanged. */
export function accessoryWastePercent(itemId: string): number {
  if (["KITCHEN-092", "KITCHEN-093", "KITCHEN-094", "KITCHEN-ALU-SKIRTING"].includes(itemId)) return 25;
  if (itemId === "KITCHEN-049") return 20;
  if (itemId === "KITCHEN-050") return 15;
  return 0;
}
