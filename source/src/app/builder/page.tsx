import { WoodBomBuilder } from "@/components/WoodBomBuilder";
import { requireIdentity, userSession, sessionMaterials, isOpenCostingAccess } from "@/lib/user-session";
import { costingPortalEnabled } from "@/lib/costing-storage-mode";
import { showsProjectPricing } from "@/lib/costing-visibility";
import { redirect } from "next/navigation";

export default async function Page() {
  const identity = await requireIdentity();
  const session = await userSession();
  if (!sessionMaterials(session)) redirect("/materials");
  const localCostings = costingPortalEnabled();
  return <WoodBomBuilder materials={sessionMaterials(session)} openAccessAdmin={isOpenCostingAccess()} canViewProjectPricing={showsProjectPricing(identity.role, localCostings)} localCostingUser={localCostings ? identity : undefined} />;
}
