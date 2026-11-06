import { notFound } from "next/navigation";
import { requireIdentity } from "@/lib/user-session";
import { listSavedCostings } from "@/lib/local-costing-store";
import { CostingLibrary } from "@/components/CostingLibrary";
import { exposeSavedCosting } from "@/lib/costing-visibility";
import { browserCostingsEnabled, costingPortalEnabled } from "@/lib/costing-storage-mode";

export const dynamic = "force-dynamic";
export default async function SavedCostingsPage() {
  if (!costingPortalEnabled()) notFound();
  const actor = await requireIdentity();
  return <CostingLibrary actor={actor} initial={browserCostingsEnabled() ? [] : listSavedCostings(actor).map(costing => exposeSavedCosting(costing, actor.role))} />;
}
