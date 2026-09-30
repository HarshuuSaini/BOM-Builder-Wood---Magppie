import { NextRequest, NextResponse } from "next/server";
import { toApiError, zohoInventoryPost } from "@/lib/zoho";
import type { CompositeItemDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

type CompositeResponse = {
  composite_item?: CompositeItemDetail;
  code?: number;
  message?: string;
};

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const body = await zohoInventoryPost<CompositeResponse>("/compositeitems", payload);

    if (!body.composite_item) {
      return NextResponse.json({ error: body.message ?? "Creation failed" }, { status: 500 });
    }

    return NextResponse.json({ compositeItem: body.composite_item });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
