import { COSTING_ITEMS, type CostingMasterItem } from "@/lib/costing";

export const PVC_FOIL_RATE = 75;
export const PVC_FOIL_ROLL_WIDTH_MM = 1420;
export function modernMembraneConstruction(item?: Pick<CostingMasterItem, "subgroup" | "thicknessMm">) {
  if (!item || !/^Membrane \(Modern\)/i.test(item.subgroup)) return undefined;
  const faces = /\bBSM\b/i.test(item.subgroup) ? 2 : 1;
  const core = /\bMDF\b/i.test(item.subgroup) ? "MDF" : "HDHMR";
  const subgroup = `${faces === 1 ? "Prelam" : "POSTlam"} ${core} BSL`;
  const board = COSTING_ITEMS.find((candidate) => candidate.group === "Shutter Material" &&
    candidate.subgroup === subgroup && candidate.thicknessMm === item.thicknessMm);
  return board ? { board, faces, foilRate: PVC_FOIL_RATE } : undefined;
}
