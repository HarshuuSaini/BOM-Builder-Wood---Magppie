import { cloudCostingResponse } from "@/lib/supabase-costing-http";
import { NextResponse } from "next/server";
import { changeSavedCostings, CostingAccessError } from "@/lib/local-costing-store";
import { exposeSavedCosting } from "@/lib/costing-visibility";
import { localCostingActor, checkCostingOrigin, costingErrorResponse } from "@/lib/local-costing-http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const cloud = await cloudCostingResponse(request);
  if (cloud) return cloud;
  try {
    const actor = await localCostingActor();
    checkCostingOrigin(request);
    const body = await request.json();
    if (!body || !["bin", "restore", "clone"].includes(body.action)) throw new CostingAccessError("Invalid costing action.", 400);
    const costings = changeSavedCostings(body.ids, body.action, actor, body.copies ?? 1);
    return NextResponse.json({ costings: costings.map(s => exposeSavedCosting(s, actor.role)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid action data." }, { status: 400 });
    return costingErrorResponse(error);
  }
}
