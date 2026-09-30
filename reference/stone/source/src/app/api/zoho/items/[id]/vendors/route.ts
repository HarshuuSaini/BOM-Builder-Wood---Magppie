import { NextRequest, NextResponse } from "next/server";
import { toApiError, zohoInventoryGet } from "@/lib/zoho";
import type { ItemDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

type PoLineItem = {
  item_id?: string;
  rate?: number;
  quantity?: number;
};

type PoSummary = {
  purchaseorder_id: string;
  purchaseorder_number: string;
  vendor_id: string;
  vendor_name: string;
  date?: string;
};

type PoDetailResponse = {
  purchaseorder?: PoSummary & { line_items?: PoLineItem[] };
};

export type VendorOption = {
  vendor_id: string;
  vendor_name: string;
  last_po_number?: string;
  last_po_date?: string;
  last_rate?: number;
  source: "history" | "item_default";
};

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;

    const [poList, itemBody] = await Promise.all([
      zohoInventoryGet<{ purchaseorders?: PoSummary[] }>("/purchaseorders", {
        item_id: id,
        per_page: 25,
        sort_column: "date",
        sort_order: "D",
      }).catch(() => ({ purchaseorders: [] as PoSummary[] })),
      zohoInventoryGet<{ item?: ItemDetail & { vendor_id?: string; vendor_name?: string } }>(
        `/items/${encodeURIComponent(id)}`,
      ).catch(() => ({ item: undefined })),
    ]);

    const seen = new Map<string, VendorOption>();
    const lines = poList.purchaseorders ?? [];

    // Resolve top 5 most recent POs in detail to grab rate for this item
    const topPos = lines.slice(0, 5);
    const detailed = await Promise.all(
      topPos.map((po) =>
        zohoInventoryGet<PoDetailResponse>(`/purchaseorders/${encodeURIComponent(po.purchaseorder_id)}`).catch(
          () => ({ purchaseorder: undefined }),
        ),
      ),
    );

    for (let i = 0; i < topPos.length; i++) {
      const po = topPos[i];
      const detail = detailed[i].purchaseorder;
      const matching = detail?.line_items?.find((li) => li.item_id === id);
      const rate = matching?.rate;
      if (!seen.has(po.vendor_id)) {
        seen.set(po.vendor_id, {
          vendor_id: po.vendor_id,
          vendor_name: po.vendor_name,
          last_po_number: po.purchaseorder_number,
          last_po_date: po.date,
          last_rate: typeof rate === "number" ? rate : undefined,
          source: "history",
        });
      }
    }

    // Append item default vendor if not present
    const itemVendor = itemBody.item as (ItemDetail & { vendor_id?: string; vendor_name?: string }) | undefined;
    if (itemVendor?.vendor_id && !seen.has(itemVendor.vendor_id)) {
      seen.set(itemVendor.vendor_id, {
        vendor_id: itemVendor.vendor_id,
        vendor_name: itemVendor.vendor_name ?? "(unnamed vendor)",
        source: "item_default",
      });
    }

    const vendors = Array.from(seen.values());
    return NextResponse.json({ vendors, preferred_vendor_id: vendors[0]?.vendor_id ?? "" });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
