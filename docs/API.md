# API Documentation

All routes are Next.js App Router handlers under `src/app/api/`. They are a
**server-side proxy to Zoho Inventory** — the browser never sees Zoho
credentials. Every route was copied verbatim from the stone app.

## Common behaviour

**Base URL:** `http://127.0.0.1:3000` in development.

**Authentication.** None on the routes themselves. There is no bearer token, no
session cookie, no API key. Anyone who can reach the server can call them. The
only gate is `AuthGate`, which is **client-side only** and therefore not a
security control. See `AUTHENTICATION.md`.

**Headers.** `Content-Type: application/json` on requests with a body. No custom
headers required.

**Upstream auth.** Handled in `src/lib/zoho.ts`: the refresh token is exchanged
for an access token, cached in the OS temp directory, and attached upstream
along with `organization_id`.

**Error shape.** Uniform across routes:

```json
{ "error": "human readable message", "detail": {} }
```

| Status | Meaning |
|---|---|
| 200 | Success |
| 400 | Missing or invalid query parameter |
| 401 | Zoho rejected the credentials — check the four env vars |
| 404 | Entity not found upstream |
| 500 | Env var missing, or Zoho returned an unexpected payload |

**Validation.** Minimal. Routes read query parameters and forward them. There is
no schema validation library. Absent optional parameters are omitted upstream;
absent required path segments produce a 404 from the router itself.

---

## Zoho — Items

### `GET /api/zoho/items`
Search the item master. Used by `searchBoardItems`, `searchLaminateItems`,
`searchHardwareItems`.

| Param | Required | Notes |
|---|---|---|
| `search` | no | Free-text search term |
| `name` | no | Exact-ish name match |

```
GET /api/zoho/items?search=PLY%2018
```
```json
{ "items": [
  { "item_id": "460000000012345", "item_name": "BWP PLYWOOD 18MM WALNUT",
    "sku": "PLY-18-WAL", "group_name": "Plywood", "stock_on_hand": 42,
    "unit": "sqft", "cf_thickness": "18", "cf_finish": "Walnut" }
] }
```

### `POST /api/zoho/items`
Create an item. Body is a Zoho item payload, forwarded as-is.

### `GET /api/zoho/items/[id]`
Fetch one item. → `{ "item": { ... } }`

### `PUT /api/zoho/items/[id]`
Update one item. Used when applying a board change to a BOM tree.

### `GET /api/zoho/items/[id]/vendors`
Vendors supplying this item, with rates. Used by the draft-PO flow.

---

## Zoho — Composite Items

### `GET /api/zoho/compositeitems/[id]`
Fetch a composite with its `mapped_items`. The BOM traversal calls this
repeatedly, descending until it hits non-composite leaves.

→ `{ "composite_item": { "composite_item_id": "...", "mapped_items": [...] } }`

### `PUT /api/zoho/compositeitems/[id]`
Update a composite's mapped items — how a board substitution is written back.

### `POST /api/zoho/compositeitems`
Create a composite. Used when cloning a cabinet tree for a changed board.

---

## Zoho — Sales Orders

### `GET /api/zoho/salesorders`
| Param | Required | Notes |
|---|---|---|
| `q` | no | Search by number or customer |
| `status` | no | Zoho status filter |

→ `{ "salesorders": [ { "salesorder_id", "salesorder_number", "customer_name", "status", "date", "total" } ] }`

### `GET /api/zoho/salesorders/[id]`
Full order including `line_items`. The entry point for BOM resolution.

### `PUT /api/zoho/salesorders/[id]`
Update an order — used when a line item is repointed at a cloned cabinet.

---

## Zoho — Contacts

### `GET /api/zoho/contacts`
| Param | Required | Notes |
|---|---|---|
| `contact_type` | no | `vendor` or `customer` |
| `search` | no | Free text |

### `GET /api/zoho/contacts/[id]`
One contact.

---

## Zoho — Purchase Orders

### `GET /api/zoho/purchaseorders`
| Param | Required | Notes |
|---|---|---|
| `item_id` | no | POs containing this item |
| `per_page` | no | Page size |

### `POST /api/zoho/purchaseorders`
Create a PO. Body is a Zoho PO payload. Used by `DraftPoModal`.

---

## Zoho — Reorder & mapping

### `GET /api/zoho/reorder-report`
Aggregated reorder view: items below threshold with vendor and on-order
quantities. Backs `ReorderReport.tsx`.

### `GET /api/zoho/po-vendor-map`
| Param | Required | Notes |
|---|---|---|
| `item_ids` | yes | Comma-separated |
| `scan` | no | Deeper scan of historical POs |

Maps items to their most recent vendors and rates.

### `GET /api/zoho/status`
Connectivity probe. Returns whether credentials are present and whether a token
exchange succeeds. **Call this first when debugging Zoho.**

---

## AI

### `POST /api/ai/chat`
Backs `AiCopilot.tsx`. Requires `OPENAI_API_KEY`; without it the copilot is
inert but the rest of the app is unaffected.

```json
{ "messages": [ { "role": "user", "content": "..." } ] }
```

---

## Not an HTTP API

`WoodBomBuilder.tsx` calls **no** API to build a BOM. Configuration, panel
derivation, consumables, board totals and CSV export are entirely client-side
and work with no network and no environment variables. Zoho is only involved
once you resolve a BOM against real inventory.
