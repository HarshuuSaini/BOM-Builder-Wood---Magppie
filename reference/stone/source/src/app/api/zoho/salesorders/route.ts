import { NextRequest, NextResponse } from "next/server";
import { toApiError, zohoInventoryGet } from "@/lib/zoho";
import type { SalesOrderSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

type SalesOrdersResponse = {
  salesorders?: SalesOrderSummary[];
};

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const status = request.nextUrl.searchParams.get("status") ?? "";

    if (query.length < 2) {
      return NextResponse.json({ salesorders: [] });
    }

    const body = await zohoInventoryGet<SalesOrdersResponse>("/salesorders", {
      search_text: query,
      status: status || undefined,
      per_page: 50,
    });

    return NextResponse.json({ salesorders: body.salesorders ?? [] });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
