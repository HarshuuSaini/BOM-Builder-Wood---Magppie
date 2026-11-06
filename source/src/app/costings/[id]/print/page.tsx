import { notFound } from "next/navigation";
import { requireIdentity } from "@/lib/user-session";
import { CostingAccessError, getSavedCosting } from "@/lib/local-costing-store";
import { exposeSavedCosting } from "@/lib/costing-visibility";
import { SavedCostingPrint } from "@/components/SavedCostingPrint";
import { browserCostingsEnabled, costingPortalEnabled } from "@/lib/costing-storage-mode";
import { BrowserCostingPrint } from "@/components/BrowserCostingPrint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PrintCostingPage({ params }: { params: Promise<{ id: string }> }) {
  if (!costingPortalEnabled()) notFound();
  const actor = await requireIdentity();
  const { id } = await params;
  if (browserCostingsEnabled()) return <BrowserCostingPrint id={id} admin={actor.role === "admin"} />;
  try {
    const costing = getSavedCosting(id, actor);
    return <SavedCostingPrint costing={exposeSavedCosting(costing, actor.role)} admin={actor.role === "admin"} />;
  } catch (error) {
    if (error instanceof CostingAccessError && error.status === 404) notFound();
    throw error;
  }
}
