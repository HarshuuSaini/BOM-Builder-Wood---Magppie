import { NextRequest, NextResponse } from "next/server";
import { toApiError, zohoInventoryGet, zohoInventoryPut } from "@/lib/zoho";
import type { SalesOrderDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

type SalesOrderResponse = {
  salesorder?: SalesOrderDetail;
};

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await zohoInventoryGet<SalesOrderResponse>(`/salesorders/${encodeURIComponent(id)}`);

    if (!body.salesorder) {
      return NextResponse.json({ error: "Sales order not found" }, { status: 404 });
    }

    return NextResponse.json({ salesorder: body.salesorder });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const payload = await request.json();
    const body = await zohoInventoryPut<SalesOrderResponse & { code?: number; message?: string }>(
      `/salesorders/${encodeURIComponent(id)}`,
      payload,
    );

    if (!body.salesorder) {
      return NextResponse.json({ error: body.message ?? "Update failed" }, { status: 500 });
    }

    return NextResponse.json({ salesorder: body.salesorder });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
