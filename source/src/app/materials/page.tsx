import { requireUser, userSession, sessionMaterials } from "@/lib/user-session";
import { COSTING_ITEMS } from "@/lib/costing";
import { MaterialSelection } from "@/components/MaterialSelection";

export default async function MaterialsPage() {
  await requireUser();
  const session = await userSession();
  const options = COSTING_ITEMS.filter((item) => ["Carcass/ Shelf Material", "Carcass Back Material", "Drawer Material", "Shutter Material"].includes(item.group))
    .map((item) => ({ id: item.id, group: item.group, subgroup: item.subgroup, thicknessMm: item.thicknessMm, type: item.type,
      boardSheetPrice: String(Number((item.currentRate * 32).toFixed(6))) }));
  return <MaterialSelection options={options} initial={sessionMaterials(session)} />;
}
