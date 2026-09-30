import { NextRequest, NextResponse } from "next/server";
import { toApiError, zohoInventoryGet, zohoInventoryPut } from "@/lib/zoho";
import type { CompositeItemDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

type CompositeItemResponse = {
  composite_item?: CompositeItemDetail;
};

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await zohoInventoryGet<CompositeItemResponse>(`/compositeitems/${encodeURIComponent(id)}`);

    if (!body.composite_item) {
      return NextResponse.json({ error: "Composite item not found" }, { status: 404 });
    }

    return NextResponse.json({ compositeItem: body.composite_item });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const payload = await request.json();
    const body = await zohoInventoryPut<{ composite_item?: CompositeItemDetail; code?: number; message?: string }>(
      `/compositeitems/${encodeURIComponent(id)}`,
      payload,
    );

    if (!body.composite_item) {
      return NextResponse.json({ error: body.message ?? "Update failed" }, { status: 500 });
    }

    return NextResponse.json({ compositeItem: body.composite_item });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
