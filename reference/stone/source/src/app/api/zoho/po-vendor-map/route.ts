import { NextRequest, NextResponse } from "next/server";
import { toApiError, zohoInventoryGet } from "@/lib/zoho";

export const dynamic = "force-dynamic";

type PoSummary = {
  purchaseorder_id: string;
  purchaseorder_number: string;
  vendor_id: string;
  vendor_name: string;
  date?: string;
};

type PoDetail = PoSummary & {
  line_items?: Array<{ item_id?: string; rate?: number; quantity?: number }>;
};

export type VendorHistoryEntry = {
  vendor_id: string;
  vendor_name: string;
  last_po_number: string;
  last_po_date: string;
  last_rate?: number;
};

async function fetchInBatches<I, O>(
  items: I[],
  batchSize: number,
  worker: (item: I) => Promise<O>,
): Promise<O[]> {
  const out: O[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    const results = await Promise.all(slice.map(worker));
    out.push(...results);
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get("item_ids") || "";
    const itemIds = new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean));
    const scanCount = Math.min(Number(searchParams.get("scan") || 100), 200);

    if (!itemIds.size) {
      return NextResponse.json({ map: {} });
    }

    // 1. Fetch recent PO summaries
    const list = await zohoInventoryGet<{ purchaseorders?: PoSummary[] }>("/purchaseorders", {
      per_page: scanCount,
      sort_column: "date",
      sort_order: "D",
    });
    const summaries = list.purchaseorders ?? [];

    // 2. Hydrate each PO (batched) to read its line items
    const detailed = await fetchInBatches(summaries, 8, async (po) => {
      try {
        const body = await zohoInventoryGet<{ purchaseorder?: PoDetail }>(
          `/purchaseorders/${encodeURIComponent(po.purchaseorder_id)}`,
        );
        return body.purchaseorder ?? null;
      } catch {
        return null;
      }
    });

    // 3. Build itemId -> vendor history, preserving date order (recent first since summaries were sorted desc)
    const map: Record<string, VendorHistoryEntry[]> = {};
    for (const po of detailed) {
      if (!po) continue;
      for (const li of po.line_items ?? []) {
        const iid = li.item_id;
        if (!iid || !itemIds.has(iid)) continue;
        if (!map[iid]) map[iid] = [];
        // Skip duplicate vendor entries (keep most recent only)
        if (map[iid].some((e) => e.vendor_id === po.vendor_id)) continue;
        map[iid].push({
          vendor_id: po.vendor_id,
          vendor_name: po.vendor_name,
          last_po_number: po.purchaseorder_number,
          last_po_date: po.date ?? "",
          last_rate: typeof li.rate === "number" ? li.rate : undefined,
        });
      }
    }

    return NextResponse.json({ map, scanned: summaries.length });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
