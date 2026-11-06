import { WoodBomBuilder } from "@/components/WoodBomBuilder";
import { requireIdentity, userSession, sessionMaterials, isOpenCostingAccess } from "@/lib/user-session";
import { isLocalCostingsEnabled } from "@/lib/local-costing-store";
import { showsProjectPricing } from "@/lib/costing-visibility";
import { redirect } from "next/navigation";

export default async function Page() {
  const identity = await requireIdentity();
  const session = await userSession();
  if (!sessionMaterials(session)) redirect("/materials");
  return <WoodBomBuilder planningMode openAccessAdmin={isOpenCostingAccess()} materials={sessionMaterials(session)} canViewProjectPricing={showsProjectPricing(identity.role, isLocalCostingsEnabled())} />;
}
