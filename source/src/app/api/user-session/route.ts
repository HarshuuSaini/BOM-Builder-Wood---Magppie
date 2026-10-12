import { NextResponse } from "next/server";
import { currentUser, userCredentialVersion, userSession, verifyUserCredentials } from "@/lib/user-session";

export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function GET() {
  return NextResponse.json({ user: await currentUser() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (!process.env.USER_SESSION_SECRET || !process.env.USER_LOGIN_NAME || !process.env.USER_LOGIN_PASSWORD) {
    return NextResponse.json({ error: "User login is not configured on this server." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const user = typeof body?.user === "string" ? body.user : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (user.length > 256 || password.length > 1024 || !verifyUserCredentials(user, password)) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }
  const session = await userSession();
  session.user = user;
  session.credentialVersion = userCredentialVersion();
  delete session.materials;
  delete session.materialsCompressed;
  await session.save();
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const session = await userSession();
  session.destroy();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
