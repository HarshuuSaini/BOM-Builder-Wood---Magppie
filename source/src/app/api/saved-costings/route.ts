import { NextResponse } from "next/server";
import { CostingAccessError, listSavedCostings, saveCosting, getSavedCosting } from "@/lib/local-costing-store";
import { exposeSavedCosting } from "@/lib/costing-visibility";
import { priceDesignerCosting } from "@/lib/server-project-pricing";
import { localCostingActor, checkCostingOrigin, costingErrorResponse } from "@/lib/local-costing-http";
import type { KitchenWorkspaceEntry } from "@/lib/kitchen-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await localCostingActor();
    return NextResponse.json({ actor, costings: listSavedCostings(actor, request ? new URL(request.url).searchParams.get("bin") === "1" : false).map(costing => exposeSavedCosting(costing, actor.role)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return costingErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await localCostingActor();
    checkCostingOrigin(request);
    const expectedUser = request.headers.get("x-costing-user");
    if (expectedUser && expectedUser !== actor.username) throw new CostingAccessError("The signed-in account changed. Reload this page before saving.", 409);
    if (Number(request.headers.get("content-length") ?? 0) > 2_000_000) throw new CostingAccessError("This costing exceeds the 2 MB save limit.", 413);
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 2_000_000) throw new CostingAccessError("This costing exceeds the 2 MB save limit.", 413);
    let entry: KitchenWorkspaceEntry;
    try { entry = JSON.parse(text) as KitchenWorkspaceEntry; } catch { throw new CostingAccessError("Invalid costing data.", 400); }
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.rows) || !entry.rows.every(row => row && typeof row === "object" &&
      typeof row["Record Type"] === "string" && typeof row.Data === "string")) throw new CostingAccessError("Invalid kitchen costing.", 400);
    const linked = entry.savedCostingId ? getSavedCosting(entry.savedCostingId, actor, true) : undefined;
    if (linked?.deletedAt) throw new CostingAccessError("This costing is in the bin. Restore it from Saved costings → Bin before editing.", 409, "COSTING_IN_BIN");
    const previous = linked?.entry;
    const saved = saveCosting(actor.role === "admin" ? entry : priceDesignerCosting(entry, previous), actor);
    return NextResponse.json({ costing: exposeSavedCosting(saved, actor.role) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return costingErrorResponse(error); }
}
