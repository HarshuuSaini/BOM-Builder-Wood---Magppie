import { NextResponse } from "next/server";
import { getSavedCosting } from "@/lib/local-costing-store";
import { exposeSavedCosting } from "@/lib/costing-visibility";
import { localCostingActor, costingErrorResponse } from "@/lib/local-costing-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await localCostingActor();
    const { id } = await context.params;
    return NextResponse.json({ costing: exposeSavedCosting(getSavedCosting(id, actor), actor.role) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return costingErrorResponse(error); }
}
