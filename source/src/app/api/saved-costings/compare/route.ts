import { NextResponse } from "next/server";
import { CostingAccessError, getSavedCosting } from "@/lib/local-costing-store";
import { localCostingActor, checkCostingOrigin, costingErrorResponse } from "@/lib/local-costing-http";
import { compareCostings } from "@/lib/costing-comparison";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const actor = await localCostingActor();
    if (actor.role !== "admin") throw new CostingAccessError("Comparison is available to admins only.", 403);
    checkCostingOrigin(request);
    const body = await request.json();
    if (!Array.isArray(body?.ids) || body.ids.length < 2 || body.ids.length > 100 || new Set(body.ids).size !== body.ids.length)
      throw new CostingAccessError("Select at least two kitchens to compare (up to 100).", 400);
    return NextResponse.json({ comparison: compareCostings(body.ids.map((id: string) => getSavedCosting(id, actor))) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid comparison data." }, { status: 400 });
    return costingErrorResponse(error);
  }
}
