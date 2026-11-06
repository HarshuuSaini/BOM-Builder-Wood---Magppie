export type ProfileFinish = "Raw" | "Anodised" | "Powder coating";
export type ProfileFinishes = { handles: ProfileFinish; skirting: ProfileFinish; skirtingMaterial?: "PVC" | "Aluminium" };
export const DEFAULT_PROFILE_FINISHES: ProfileFinishes = { handles: "Powder coating", skirting: "Powder coating" };
export const PROFILE_DEVELOPED_WIDTHS: Record<string, number> = {
  "KITCHEN-041": 148.532, "KITCHEN-040": 192.981,
  "KITCHEN-049": 151.655, "KITCHEN-050": 216.918,
  "KITCHEN-ALU-SKIRTING": 123.322,
};
export function profileFinishCost(itemId: string, metres: number, selections?: ProfileFinishes) {
  const width = PROFILE_DEVELOPED_WIDTHS[itemId];
  if (!width) return undefined;
  const finish = (selections ?? DEFAULT_PROFILE_FINISHES)[itemId === "KITCHEN-ALU-SKIRTING" ? "skirting" : "handles"];
  if (finish === "Raw") return undefined;
  const rate = finish === "Anodised" ? 40 : 80;
  const area = metres * 1000 * width / 92903.04;
  return { finish, rate, area, amount: area * rate, width };
}
