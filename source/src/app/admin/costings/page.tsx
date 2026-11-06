import { notFound, redirect } from "next/navigation";
import { requireIdentity } from "@/lib/user-session";
import { isLocalCostingsEnabled, listSavedCostings } from "@/lib/local-costing-store";
import { CostingLibrary } from "@/components/CostingLibrary";

export const dynamic = "force-dynamic";
export default async function AdminCostingsPage() {
  if (!isLocalCostingsEnabled()) notFound();
  const actor = await requireIdentity();
  if (actor.role !== "admin") redirect("/costings");
  return <CostingLibrary actor={actor} initial={listSavedCostings(actor)} />;
}
