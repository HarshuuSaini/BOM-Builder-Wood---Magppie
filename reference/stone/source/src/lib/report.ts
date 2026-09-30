import {
  annotateRowsForOrder,
  buildReportRowsForOrder,
  collectMappedItemIds,
  collectRequiredItemIds,
  isComposite,
} from "@/lib/stock";
import type {
  ApiErrorBody,
  BomReportRow,
  CompositeItemDetail,
  ItemDetail,
  SalesOrderDetail,
} from "@/lib/types";
import type { BomExpansionContext, GlobalConsumed } from "@/lib/stock";

const MAX_DEPTH = 6;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) {
    throw new Error((body as ApiErrorBody).error ?? "Request failed");
  }
  return body as T;
}

async function fetchItem(
  id: string,
  itemsById: Record<string, ItemDetail | null>,
): Promise<ItemDetail | null> {
  if (id in itemsById) return itemsById[id];
  try {
    const body = await fetchJson<{ item: ItemDetail }>(`/api/zoho/items/${id}`);
    itemsById[id] = body.item;
    return body.item;
  } catch {
    itemsById[id] = null;
    return null;
  }
}

async function fetchComposite(
  id: string,
  compositesById: Record<string, CompositeItemDetail | null>,
): Promise<CompositeItemDetail | null> {
  if (id in compositesById) return compositesById[id];
  try {
    const body = await fetchJson<{ compositeItem: CompositeItemDetail }>(`/api/zoho/compositeitems/${id}`);
    compositesById[id] = body.compositeItem;
    return body.compositeItem;
  } catch {
    compositesById[id] = null;
    return null;
  }
}

async function resolveCompositeTree(
  rootIds: string[],
  itemsById: Record<string, ItemDetail | null>,
  compositesById: Record<string, CompositeItemDetail | null>,
): Promise<void> {
  const queue: Array<{ id: string; depth: number }> = rootIds.map((id) => ({ id, depth: 0 }));
  const seen = new Set<string>();

  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (seen.has(id) || depth > MAX_DEPTH) continue;
    seen.add(id);

    const item = await fetchItem(id, itemsById);
    if (item && isComposite(item)) {
      const composite = await fetchComposite(id, compositesById);
      if (composite) {
        for (const childId of collectMappedItemIds(composite)) {
          if (!seen.has(childId)) queue.push({ id: childId, depth: depth + 1 });
        }
      }
    }
  }
}

export type LoadedBomReport = {
  orders: SalesOrderDetail[];
  rows: BomReportRow[];
};

export async function loadBomReportForOrders(orderIds: string[]): Promise<LoadedBomReport> {
  const orders = await Promise.all(
    orderIds.map(async (id) => {
      const body = await fetchJson<{ salesorder: SalesOrderDetail }>(`/api/zoho/salesorders/${id}`);
      return body.salesorder;
    }),
  );

  const itemsById: Record<string, ItemDetail | null> = {};
  const compositesById: Record<string, CompositeItemDetail | null> = {};
  const rootIds = collectRequiredItemIds(orders);

  await resolveCompositeTree(rootIds, itemsById, compositesById);

  const globalConsumed: GlobalConsumed = {};
  const ctx: BomExpansionContext = { itemsById, compositesById, globalConsumed };
  const rows: BomReportRow[] = [];

  for (const order of orders) {
    const orderRows = buildReportRowsForOrder(order, ctx);
    rows.push(...annotateRowsForOrder(orderRows, order));
  }

  return { orders, rows };
}

export async function loadBomReport(orderId: string): Promise<{ order: SalesOrderDetail; rows: BomReportRow[] }> {
  const { orders, rows } = await loadBomReportForOrders([orderId]);
  return { order: orders[0], rows };
}
