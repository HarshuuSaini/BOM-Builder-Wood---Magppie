# Database Documentation

## There is no local database

This is deliberate and inherited from the stone app. **Zoho Inventory is the
system of record.** The app holds no persistent store of its own — no Postgres,
no MongoDB, no SQLite, no ORM, no migrations.

Client state lives in React `useState` for the duration of a session. The only
thing written to disk on the client is a single `localStorage` key.

| Key | Store | Value | Written by |
|---|---|---|---|
| `app_authenticated` | `localStorage` | `"true"` | `AuthGate.tsx` |

There is also a server-side token cache written to the OS temp directory by
`src/lib/zoho.ts` (it imports `node:fs/promises`, `node:os`, `node:path`) to
avoid re-exchanging the Zoho refresh token on every request. It is a cache, not
a database; deleting it is safe.

## The effective data model — Zoho Inventory

The app reads and writes these Zoho entities. Field names below are Zoho's.

### Item
The atomic record. A panel, a board, a piece of hardware, a consumable.

| Field | Type | Notes |
|---|---|---|
| `item_id` | string | PK |
| `item_name` / `name` | string | Parsed by `naming.ts` |
| `sku` | string | |
| `group_name` | string | Matched by `BOARD_GROUP_TOKENS` |
| `stock_on_hand`, `available_stock`, `actual_available_stock` | number | |
| `unit` | string | nos / sqft / RMT / mtr / gm |
| `is_combo_product`, `item_type`, `product_type` | | Composite detection |
| `cf_group` | custom | Matched by `BOARD_GROUP_TOKENS` |
| `cf_sub_group` | custom | |
| `cf_height`, `cf_width`, `cf_depth`, `cf_thickness` | custom | mm |
| `cf_finish` | custom | Shade |
| `cf_type` | custom | Board option A/B/C |
| `cf_waste_percentage` | custom | |

### Composite Item
An item with `mapped_items`. This is how the BOM tree is stored — a cabinet is a
composite of packs, a pack of parts, a part of panels, a panel of raw material.
Recursion terminates at a non-composite item.

| Field | Type |
|---|---|
| `composite_item_id` | string |
| `mapped_items[]` | `{ item_id, quantity, ... }` |

Aliases tolerated by the traversal: `composite_item_line_items`,
`bundle_items`, `line_items`, `items`.

### Sales Order
| Field | Notes |
|---|---|
| `salesorder_id`, `salesorder_number` | |
| `customer_name`, `customer_id` | |
| `status`, `date`, `total` | |
| `line_items[]` | each referencing an item or composite |

### Purchase Order, Contact (vendor)
Used by the reorder report and draft-PO flow. See `API.md`.

## Relationships

```
SalesOrder 1─────* SalesOrderLineItem
                        │
                        ▼  item_id / composite_item_id
                  CompositeItem (Cabinet, L0)
                        │ mapped_items
                        ▼
                  CompositeItem (Pack, L1)
                        │
                        ▼
                  CompositeItem (Part, L2/L3)
                        │
                        ▼
                  Item (Raw material, L4)   ← board, laminate, band, hardware

Item *─────* Vendor  (via /api/zoho/items/[id]/vendors)
PurchaseOrder *───── Vendor
```

## Constraints and indexes

Enforced by Zoho, not by this app. The app assumes:

- `item_id` is unique and stable
- A composite's `mapped_items` never cycles — the traversal has no cycle guard,
  so a circular composite in Zoho would recurse until the stack overflows
- `cf_thickness` parses as a number; `parseFloat` failures fall back to 0
- `cf_group` or `group_name` contains one of `BOARD_GROUP_TOKENS` for any item
  intended as a board. **If not, resolution silently returns nothing.**

## Sample data

A cabinet as the app generates it, before Zoho resolution — `BC.SH`
600 × 720 × 560, board option A, post-laminated shutter:

```
L0  BC·SH·1SX·2HS·STD                         qty 1
L1  Carcass Pack
L2    Panel - CR Side 18mm 560x720 Walnut     qty 2
L3      Part - CR Side 18mm 560x720 Walnut    qty 2
L4        16mm BWP Plywood Walnut          8.680 sqft   +10%  → 0.298 sheets
L4        EDGE BAND 0.8MM Walnut           5.120 RMT
L2    Panel - CR Top 18mm 564x560 Walnut      qty 1
...
L2    Panel - CR Back 8mm 573x693 Walnut      qty 1   (no band)
L1  Shutter Pack
L2    Panel - SH 16mm 300x717 Walnut          qty 2
L4        16mm BWP Plywood Walnut          4.631 sqft   +20%
L4        EDGE BAND 0.8MM Walnut           4.068 RMT
L1  Hardware Pack
L2    HINGE                                   qty 6
L2    HARDWARE PACK PVC LEG SET/4              qty 4
```

Totals for that cabinet: **22.978 sqft** panel, **11.806 RMT** band.

## Backup

Backup is Zoho's responsibility. This app stores nothing that needs backing up.
Clearing `localStorage` only forces a re-login; deleting the Zoho token cache
only forces a token refresh.
