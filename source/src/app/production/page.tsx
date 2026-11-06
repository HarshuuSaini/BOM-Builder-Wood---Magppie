import { notFound } from "next/navigation";
import { requireIdentity, isOpenCostingAccess } from "@/lib/user-session";
import { isLocalCostingsEnabled, listSavedCostings } from "@/lib/local-costing-store";
import { ProductionBatch } from "@/components/ProductionBatch";
import { browserCostingsEnabled } from "@/lib/costing-storage-mode";
import { BrowserProductionBatch } from "@/components/BrowserProductionBatch";

export const dynamic = "force-dynamic";
export default async function ProductionPage() {
  const actor = await requireIdentity();
  if (actor.role !== "admin") notFound();
  if (browserCostingsEnabled()) return <BrowserProductionBatch />;
  if (!isLocalCostingsEnabled()) {
    if (!isOpenCostingAccess()) notFound();
    return <ProductionBatch kitchens={[]} browserWorkspace />;
  }
  return <ProductionBatch kitchens={listSavedCostings(actor).map(({ id, name, owner, version }) => ({ id, name, owner, version }))} />;
}
