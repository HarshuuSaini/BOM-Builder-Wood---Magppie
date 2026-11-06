import { notFound } from "next/navigation";
import { requireIdentity } from "@/lib/user-session";
import { isLocalCostingsEnabled, listSavedCostings } from "@/lib/local-costing-store";
import { CostingLibrary } from "@/components/CostingLibrary";
import { exposeSavedCosting } from "@/lib/costing-visibility";

export const dynamic = "force-dynamic";
export default async function SavedCostingsPage() {
  if (!isLocalCostingsEnabled()) notFound();
  const actor = await requireIdentity();
  return <CostingLibrary actor={actor} initial={listSavedCostings(actor).map(costing => exposeSavedCosting(costing, actor.role))} />;
}
