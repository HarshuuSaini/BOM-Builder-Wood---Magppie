import { listCloudCostings } from "@/lib/supabase-costing-http";
import { notFound } from "next/navigation";
import { requireIdentity } from "@/lib/user-session";
import { listSavedCostings } from "@/lib/local-costing-store";
import { CostingLibrary } from "@/components/CostingLibrary";
import { exposeSavedCosting } from "@/lib/costing-visibility";
import { browserCostingsEnabled, cloudCostingsEnabled, costingPortalEnabled } from "@/lib/costing-storage-mode";

export const dynamic = "force-dynamic";
export default async function SavedCostingsPage() {
  if (!costingPortalEnabled()) notFound();
  const actor = await requireIdentity();
  return <CostingLibrary actor={actor} initial={cloudCostingsEnabled() ? await listCloudCostings(actor) : browserCostingsEnabled() ? [] : listSavedCostings(actor).map(costing => exposeSavedCosting(costing, actor.role))} />;
}
