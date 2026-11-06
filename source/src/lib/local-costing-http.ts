import { NextResponse } from "next/server";
import { currentIdentity } from "@/lib/user-session";
import { CostingAccessError, isLocalCostingsEnabled } from "@/lib/local-costing-store";

export async function localCostingActor() {
  if (!isLocalCostingsEnabled()) throw new CostingAccessError("Local saved costings are not enabled.", 404);
  const actor = await currentIdentity();
  if (!actor) throw new CostingAccessError("Sign in first.", 401);
  return actor;
}

export function checkCostingOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  try { if (origin && host && new URL(origin).host === host) return; } catch { /* invalid origin */ }
  throw new CostingAccessError("Invalid request origin.", 403);
}

export function costingErrorResponse(error: unknown) {
  const status = error instanceof CostingAccessError ? error.status : 500;
  return NextResponse.json({ error: status === 500 ? "Could not access saved costings." : (error as Error).message,
    ...(error instanceof CostingAccessError && error.code ? { code: error.code } : {}) },
    { status, headers: { "Cache-Control": "no-store" } });
}
