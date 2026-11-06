import { NextResponse } from "next/server";
import { authenticateUserCredentials, currentIdentity, isOpenCostingAccess, userLoginConfigured, userSession } from "@/lib/user-session";

export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function GET() {
  const identity = await currentIdentity();
  return NextResponse.json({ user: identity?.username ?? null, role: identity?.role ?? null, openAccess: isOpenCostingAccess() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (isOpenCostingAccess()) {
    const identity = await currentIdentity();
    return NextResponse.json({ user: identity?.username, role: "admin", openAccess: true,
      localCostingsEnabled: process.env.NODE_ENV === "development" && process.env.LOCAL_COSTINGS_ENABLED === "1" }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!process.env.USER_SESSION_SECRET || process.env.USER_SESSION_SECRET.length < 32 || !userLoginConfigured()) {
    return NextResponse.json({ error: "User login is not configured on this server." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const user = typeof body?.user === "string" ? body.user : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const identity = authenticateUserCredentials(user, password);
  if (!identity) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }
  const session = await userSession();
  session.user = identity.username;
  session.credentialVersion = identity.credentialVersion;
  delete session.materials;
  delete session.materialsCompressed;
  await session.save();
  return NextResponse.json({ user: identity.username, role: identity.role,
    localCostingsEnabled: process.env.NODE_ENV === "development" && process.env.LOCAL_COSTINGS_ENABLED === "1",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const session = await userSession();
  session.destroy();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
