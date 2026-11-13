import { cloudCostingResponse } from "@/lib/supabase-costing-http";
import { NextResponse } from "next/server";
import { CostingAccessError, updateComparisonServiceRates } from "@/lib/local-costing-store";
import { localCostingActor, checkCostingOrigin, costingErrorResponse } from "@/lib/local-costing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const cloud = await cloudCostingResponse(request);
  if (cloud) return cloud;
  try {
    const actor = await localCostingActor();
    if (actor.role !== "admin") throw new CostingAccessError("Only admins can edit service rates.", 403);
    checkCostingOrigin(request);
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 100_000) throw new CostingAccessError("Pricing update is too large.", 413);
    return NextResponse.json({ updated: updateComparisonServiceRates(JSON.parse(text), actor).map(costing => ({ id: costing.id, version: costing.version })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid pricing update." }, { status: 400 });
    return costingErrorResponse(error);
  }
}
