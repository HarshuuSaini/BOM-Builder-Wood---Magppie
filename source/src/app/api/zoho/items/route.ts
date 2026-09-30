import { NextRequest, NextResponse } from "next/server";
import { toApiError, zohoInventoryGet, zohoInventoryPost } from "@/lib/zoho";
import type { ItemDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

type ItemsResponse = {
  items?: ItemDetail[];
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const name = searchParams.get("name") || "";

    const params: Record<string, string | number | undefined> = {
      per_page: 200,
    };
    if (search) params.search_text = search;
    if (name) params.name_contains = name;

    const body = await zohoInventoryGet<ItemsResponse>("/items", params);

    return NextResponse.json({ items: body.items ?? [] });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const body = await zohoInventoryPost<{ item?: ItemDetail; code?: number; message?: string }>("/items", payload);

    if (!body.item) {
      return NextResponse.json({ error: body.message ?? "Creation failed" }, { status: 500 });
    }

    return NextResponse.json({ item: body.item });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
