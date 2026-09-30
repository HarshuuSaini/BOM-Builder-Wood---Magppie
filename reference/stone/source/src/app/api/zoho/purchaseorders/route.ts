import { NextRequest, NextResponse } from "next/server";
import { getZohoRuntimeInfo, toApiError, zohoInventoryGet, zohoInventoryPost } from "@/lib/zoho";

function buildPoWebUrl(purchaseorderId: string): string {
  const { inventoryBaseUrl, organizationId } = getZohoRuntimeInfo();
  // Map API host -> web host: zohoapis.in -> inventory.zoho.in, zohoapis.com -> inventory.zoho.com, etc.
  let host = "inventory.zoho.com";
  try {
    const u = new URL(inventoryBaseUrl);
    const m = u.hostname.match(/zohoapis\.(\w+)$/i);
    if (m) host = `inventory.zoho.${m[1]}`;
  } catch {
    // keep default
  }
  return `https://${host}/app/${organizationId}#/purchaseorders/${purchaseorderId}?filter_by=Status.All&per_page=25&sort_column=created_time&sort_order=D`;
}

export const dynamic = "force-dynamic";

type PurchaseOrderSummary = {
  purchaseorder_id: string;
  purchaseorder_number: string;
  vendor_id: string;
  vendor_name: string;
  date?: string;
  status?: string;
  total?: number;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get("item_id") || "";
    const perPage = Number(searchParams.get("per_page") || 10);
    const params: Record<string, string | number | undefined> = {
      per_page: perPage,
      sort_column: "date",
      sort_order: "D",
    };
    if (itemId) params.item_id = itemId;

    const body = await zohoInventoryGet<{ purchaseorders?: PurchaseOrderSummary[] }>(
      "/purchaseorders",
      params,
    );
    return NextResponse.json({ purchaseorders: body.purchaseorders ?? [] });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const body = await zohoInventoryPost<{
      purchaseorder?: { purchaseorder_id: string; purchaseorder_number: string; status?: string };
      code?: number;
      message?: string;
    }>("/purchaseorders", payload, { ignore_auto_number_generation: "false" });

    if (!body.purchaseorder) {
      return NextResponse.json({ error: body.message ?? "Failed to create purchase order" }, { status: 500 });
    }
    const po = body.purchaseorder;
    return NextResponse.json({
      purchaseorder: { ...po, web_url: buildPoWebUrl(po.purchaseorder_id) },
    });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
