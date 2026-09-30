import { NextResponse } from "next/server";
import { COSTING_ITEMS, COSTING_MASTER, DEFAULT_RATES } from "@/lib/costing";

export const dynamic = "force-dynamic";

export async function GET() {
  const { items: _items, ...metadata } = COSTING_MASTER;
  return NextResponse.json({ ok: true, source: "local-json", master: metadata, items: COSTING_ITEMS, rates: DEFAULT_RATES });
}

export async function POST(req: Request) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return NextResponse.json({ ok: false, error: "ADMIN_PASSWORD is not configured on the server." }, { status: 500 });
  const ok = req.headers.get("x-admin-password") === adminPassword;
  return NextResponse.json({ ok }, { status: ok ? 200 : 401 });
}

export async function PUT() {
  return NextResponse.json({ ok: false, error: "Update the approved Excel master, regenerate the bundled JSON, and redeploy." }, { status: 405, headers: { Allow: "GET, POST" } });
}
