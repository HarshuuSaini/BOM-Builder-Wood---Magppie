import { NextRequest, NextResponse } from "next/server";
import { toApiError, zohoInventoryGet, zohoInventoryPut } from "@/lib/zoho";
import type { ItemDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

type ItemResponse = {
  item?: ItemDetail;
};

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await zohoInventoryGet<ItemResponse>(`/items/${encodeURIComponent(id)}`);

    if (!body.item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ item: body.item });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const payload = await request.json();
    const body = await zohoInventoryPut<{ item?: ItemDetail; code?: number; message?: string }>(
      `/items/${encodeURIComponent(id)}`,
      payload,
    );

    if (!body.item) {
      return NextResponse.json({ error: body.message ?? "Update failed" }, { status: 500 });
    }

    return NextResponse.json({ item: body.item });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
