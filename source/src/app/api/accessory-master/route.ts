import { cloudCostingResponse } from "@/lib/supabase-costing-http";
import { NextResponse } from "next/server";
import { listAccessoryMaster } from "@/lib/local-costing-store";
import { localCostingActor, costingErrorResponse } from "@/lib/local-costing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const cloud = await cloudCostingResponse(request);
  if (cloud) return cloud;
  try {
    await localCostingActor();
    return NextResponse.json({ items: listAccessoryMaster() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return costingErrorResponse(error); }
}
