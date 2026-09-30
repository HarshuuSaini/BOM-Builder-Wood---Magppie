import { NextRequest, NextResponse } from "next/server";
import { toApiError, zohoInventoryGet } from "@/lib/zoho";

export const dynamic = "force-dynamic";

type ZohoCf = { api_name?: string; placeholder?: string; label?: string; value?: unknown; value_formatted?: string };

type Item = {
  item_id: string;
  name?: string;
  item_name?: string;
  sku?: string;
  unit?: string;
  reorder_level?: number | string;
  available_stock?: number;
  actual_available_stock?: number;
  stock_on_hand?: number;
  custom_field_hash?: Record<string, unknown>;
  custom_fields?: ZohoCf[];
};

type PoSummary = {
  purchaseorder_id: string;
  purchaseorder_number: string;
  vendor_id: string;
  vendor_name: string;
  date?: string;
};

type PoDetail = PoSummary & {
  line_items?: Array<{ item_id?: string; rate?: number }>;
};

type Contact = {
  contact_id: string;
  contact_name: string;
  custom_field_hash?: Record<string, unknown>;
  custom_fields?: ZohoCf[];
};

async function batched<I, O>(items: I[], size: number, worker: (i: I) => Promise<O>): Promise<O[]> {
  const out: O[] = [];
  for (let i = 0; i < items.length; i += size) {
    const r = await Promise.all(items.slice(i, i + size).map(worker));
    out.push(...r);
  }
  return out;
}

function readCf(record: Item | Contact | undefined | null, ...keys: string[]): string {
  if (!record) return "";
  const rec = record as unknown as Record<string, unknown>;
  const hash = (rec.custom_field_hash ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    if (hash[k] != null && hash[k] !== "") return String(hash[k]);
    const direct = rec[k];
    if (direct != null && direct !== "") return String(direct);
  }
  const cfs = (rec.custom_fields ?? []) as ZohoCf[];
  for (const cf of cfs) {
    const ok = keys.some(
      (k) =>
        cf.api_name === k ||
        cf.placeholder === k ||
        cf.label?.toLowerCase() === k.toLowerCase(),
    );
    if (!ok) continue;
    const v = cf.value ?? cf.value_formatted;
    if (v != null && v !== "") return String(v);
  }
  return "";
}

function stockOf(it: Item): number {
  if (typeof it.actual_available_stock === "number") return it.actual_available_stock;
  if (typeof it.available_stock === "number") return it.available_stock;
  if (typeof it.stock_on_hand === "number") return it.stock_on_hand;
  return 0;
}

export async function GET(_request: NextRequest) {
  try {
    // 1. Use Zoho's low-stock filter to narrow down. Try several known filter names — Zoho version differences.
    const filterCandidates = ["Status.LowStock", "Status.Lowstock", "Status.lowstock", "Status.Reorder"];
    const summaryItems: Item[] = [];
    const perPage = 200;
    let chosenFilter = "";
    for (const cand of filterCandidates) {
      try {
        const r = await zohoInventoryGet<{ items?: Item[]; page_context?: { has_more_page?: boolean } }>(
          "/items",
          { per_page: perPage, page: 1, filter_by: cand },
        );
        chosenFilter = cand;
        summaryItems.push(...(r.items ?? []));
        if (r.page_context?.has_more_page) {
          for (let page = 2; page <= 10; page++) {
            const rr = await zohoInventoryGet<{ items?: Item[]; page_context?: { has_more_page?: boolean } }>(
              "/items",
              { per_page: perPage, page, filter_by: cand },
            );
            summaryItems.push(...(rr.items ?? []));
            if (!rr.page_context?.has_more_page) break;
          }
        }
        break;
      } catch {
        // try next filter
      }
    }

    // 2. Hydrate each item to read reorder_level, stock, and MSL custom field
    const hydrated = await batched(summaryItems, 8, async (it) => {
      try {
        const b = await zohoInventoryGet<{ item?: Item }>(`/items/${encodeURIComponent(it.item_id)}`);
        return b.item ?? null;
      } catch {
        return null;
      }
    });

    const reorderItems = hydrated.filter((it): it is Item => {
      if (!it) return false;
      const rol = Number(it.reorder_level || 0);
      return rol > 0 && stockOf(it) < rol;
    });
    const idSet = new Set(reorderItems.map((it) => it.item_id));

    // 3. Build itemId -> latest vendor map from recent PO details
    const poList = await zohoInventoryGet<{ purchaseorders?: PoSummary[] }>("/purchaseorders", {
      per_page: 100,
      sort_column: "date",
      sort_order: "D",
    });
    const poDetails = await batched(poList.purchaseorders ?? [], 8, async (po) => {
      try {
        const b = await zohoInventoryGet<{ purchaseorder?: PoDetail }>(
          `/purchaseorders/${encodeURIComponent(po.purchaseorder_id)}`,
        );
        return b.purchaseorder ?? null;
      } catch {
        return null;
      }
    });

    const vendorByItem: Record<
      string,
      { vendor_id: string; vendor_name: string; po_date: string; po_number: string; rate?: number }
    > = {};
    for (const po of poDetails) {
      if (!po) continue;
      for (const li of po.line_items ?? []) {
        if (!li.item_id || !idSet.has(li.item_id) || vendorByItem[li.item_id]) continue;
        vendorByItem[li.item_id] = {
          vendor_id: po.vendor_id,
          vendor_name: po.vendor_name,
          po_date: po.date ?? "",
          po_number: po.purchaseorder_number,
          rate: typeof li.rate === "number" ? li.rate : undefined,
        };
      }
    }

    // 4. Fetch vendor details for lead / transit times
    const vendorIds = Array.from(new Set(Object.values(vendorByItem).map((v) => v.vendor_id))).filter(Boolean);
    const vendors = await batched(vendorIds, 6, async (id) => {
      try {
        const b = await zohoInventoryGet<{ contact?: Contact }>(`/contacts/${encodeURIComponent(id)}`);
        const c = b.contact;
        if (!c) return null;
        const leadTime = Number(readCf(c, "cf_lead_time", "cf_leadtime", "Lead Time", "lead_time")) || 0;
        const transitTime =
          Number(readCf(c, "cf_transit_time", "cf_transittime", "Transit Time", "transit_time")) || 0;
        return { id, leadTime, transitTime };
      } catch {
        return null;
      }
    });
    const vendorInfo: Record<string, { leadTime: number; transitTime: number }> = {};
    for (const v of vendors) if (v) vendorInfo[v.id] = { leadTime: v.leadTime, transitTime: v.transitTime };

    // 5. Build rows
    const rows = reorderItems.map((it) => {
      const v = vendorByItem[it.item_id];
      const vInfo = v ? vendorInfo[v.vendor_id] : undefined;
      const rol = Number(it.reorder_level || 0);
      const stock = stockOf(it);
      return {
        item_id: it.item_id,
        name: it.name ?? it.item_name ?? "",
        sku: it.sku ?? "",
        unit: it.unit ?? "",
        stock,
        reorder_level: rol,
        msl: Number(readCf(it, "cf_msl", "cf_minimum_stock_level", "MSL", "Minimum Stock Level")) || 0,
        shortfall: Math.max(0, rol - stock),
        vendor_id: v?.vendor_id ?? "",
        vendor_name: v?.vendor_name ?? "",
        last_po_number: v?.po_number ?? "",
        last_po_date: v?.po_date ?? "",
        last_rate: v?.rate,
        lead_time: vInfo?.leadTime ?? 0,
        transit_time: vInfo?.transitTime ?? 0,
      };
    });

    return NextResponse.json({
      rows,
      total: rows.length,
      scanned_items: summaryItems.length,
      filter_used: chosenFilter || "none",
    });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
