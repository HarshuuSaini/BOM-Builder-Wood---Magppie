import { requireUser, userSession, sessionMaterials, isOpenCostingAccess } from "@/lib/user-session";
import { COSTING_ITEMS, SINK_STONE_BOARD_ID, SINK_STONE_SLAB_SQFT } from "@/lib/costing";
import { MaterialSelection } from "@/components/MaterialSelection";
import { isLocalCostingsEnabled } from "@/lib/local-costing-store";

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  await requireUser();
  const fresh = (await searchParams).new === "1";
  const session = await userSession();
  const options = COSTING_ITEMS.filter((item) => ["Countertop Base PLY", "Carcass/ Shelf Material", "Carcass Back Material", "Drawer Material", "Shutter Material", "Edge Band"].includes(item.group) ||
    (item.group === "Glass Type" && item.type === "Shutter Glass" && item.thicknessMm === 5))
    .map((item) => ({ id: item.id, group: item.group, subgroup: item.subgroup, thicknessMm: item.thicknessMm, type: item.type,
      boardSheetPrice: String(Number((item.currentRate * (item.id === SINK_STONE_BOARD_ID ? SINK_STONE_SLAB_SQFT : 32)).toFixed(6))), currentRate: item.currentRate }));
  return <>{(isLocalCostingsEnabled() || isOpenCostingAccess()) && <nav style={{ padding: "14px 24px", background: "#e6f1eb", display: "flex", gap: 18 }}>{isLocalCostingsEnabled() && <a href="/costings">Saved costings · view / edit</a>}<a href="/production">Production batch / Opti</a>{isOpenCostingAccess() && <span>Open costing preview · full admin access</span>}</nav>}
    <MaterialSelection options={options} initial={fresh ? undefined : sessionMaterials(session)} /></>;
}
