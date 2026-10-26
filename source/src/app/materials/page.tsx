import { requireUser, userSession, sessionMaterials } from "@/lib/user-session";
import { COSTING_ITEMS, SINK_STONE_BOARD_ID, SINK_STONE_SLAB_SQFT } from "@/lib/costing";
import { MaterialSelection } from "@/components/MaterialSelection";

export default async function MaterialsPage() {
  await requireUser();
  const session = await userSession();
  const options = COSTING_ITEMS.filter((item) => ["Carcass/ Shelf Material", "Carcass Back Material", "Drawer Material", "Shutter Material", "Edge Band"].includes(item.group) ||
    (item.group === "Glass Type" && item.type === "Shutter Glass" && item.thicknessMm === 5))
    .map((item) => ({ id: item.id, group: item.group, subgroup: item.subgroup, thicknessMm: item.thicknessMm, type: item.type,
      boardSheetPrice: String(Number((item.currentRate * (item.id === SINK_STONE_BOARD_ID ? SINK_STONE_SLAB_SQFT : 32)).toFixed(6))), currentRate: item.currentRate }));
  return <MaterialSelection options={options} initial={sessionMaterials(session)} />;
}
