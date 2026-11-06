import { notFound, redirect } from "next/navigation";
import { requireIdentity } from "@/lib/user-session";
import { listSavedCostings } from "@/lib/local-costing-store";
import { CostingLibrary } from "@/components/CostingLibrary";
import { browserCostingsEnabled, costingPortalEnabled } from "@/lib/costing-storage-mode";

export const dynamic = "force-dynamic";
export default async function AdminCostingsPage() {
  if (!costingPortalEnabled()) notFound();
  const actor = await requireIdentity();
  if (actor.role !== "admin") redirect("/costings");
  return <CostingLibrary actor={actor} initial={browserCostingsEnabled() ? [] : listSavedCostings(actor)} />;
}
