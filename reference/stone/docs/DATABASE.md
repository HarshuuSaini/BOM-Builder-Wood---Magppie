# DATABASE — Data Model

## 0. There Is No Database

**This application has no local database.** There is no Postgres, MySQL, SQLite, Prisma schema, Drizzle schema, migration directory, or ORM anywhere in the repo. Do not go looking for one, and do not assume a persistence layer exists when adding features.

Persistence is split across exactly three tiers:

| Tier | What it is | Where | Lifetime |
| --- | --- | --- | --- |
| **System of record** | **Zoho Inventory (India DC)** — Items, Composite Items, Sales Orders, Contacts/Vendors, Purchase Orders | `https://www.zohoapis.in/inventory/v1` (see `src/lib/zoho.ts:44`) | Permanent, shared, multi-user |
| **Seed data** | 3 static JSON files bundled into the client build | `src/data/*.json` | Compile-time constant; changing them requires a redeploy |
| **Client state** | 3 `localStorage` keys | Browser | Per-browser, per-device, cleared by the user |

Everything the builder computes — cabinet models, panels, profiles, hardware, countertops, fillers — lives **only in React state** until the user clicks "Push to Zoho". See §6 for the consequences.

### Zoho connection

`src/lib/zoho.ts` is the only module that talks to Zoho. It requires four environment variables (`src/lib/zoho.ts:5-10`):

| Env var | Should contain |
| --- | --- |
| `ZOHO_ORGANIZATION_ID` | The numeric Zoho Inventory org id (all Magppie item ids start `3418412…`, consistent with this org) |
| `ZOHO_REFRESH_TOKEN` | A long-lived OAuth refresh token for the Zoho Inventory scope |
| `ZOHO_CLIENT_ID` | The Zoho API console client id |
| `ZOHO_CLIENT_SECRET` | The matching client secret |

Optional overrides: `ZOHO_ACCOUNTS_BASE_URL` (default `https://accounts.zoho.in`, `src/lib/zoho.ts:40`) and `ZOHO_INVENTORY_BASE_URL` (default `https://www.zohoapis.in/inventory/v1`, `src/lib/zoho.ts:44`). **The `.in` defaults are load-bearing — this org is on the India data centre.** Never commit real values; `.env.local` holds them.

Access tokens are cached in memory (`cachedToken`) and best-effort on disk at `os.tmpdir()/magppie-cache/zoho-access-token.json` (`src/lib/zoho.ts:24`), refreshed 5 minutes before expiry (`TOKEN_REFRESH_SKEW_MS`), with a 5-minute cooldown after a Zoho rate-limit rejection (`TOKEN_BACKOFF_MS`, `src/lib/zoho.ts:26`).

---

## 1. Zoho Entities Used As "Tables"

All access is proxied through `src/app/api/zoho/**` route handlers — the browser never holds a Zoho token.

### 1.1 Item (simple / service)

Zoho endpoint `/items`. Local type: `ItemDetail` (`src/lib/types.ts:53-80`).

**Read** via `GET /api/zoho/items?search=<text>` → Zoho `search_text`, or `?name=<text>` → Zoho `name_contains`; `per_page: 200` (`src/app/api/zoho/items/route.ts:17-23`).

**Written** by `resolveSimpleItem()` (`src/components/CarcassBomBuilder.tsx:4970-5027`) via `POST /api/zoho/items`.

| Field | Direction | Notes |
| --- | --- | --- |
| `item_id` | read | Zoho's primary key. The only true identity. |
| `name` | read/write | Set to `normalizePartOrPanelName(name)` |
| `sku` | read/write | **Written identical to `name`** (`CarcassBomBuilder.tsx:4996-4997`) |
| `rate`, `purchase_rate` | write | Always `0` |
| `can_be_sold`, `can_be_purchased`, `is_taxable` | write | Always `true` |
| `account_id` | write | Hard-coded `3418412000000000486` (sales account) |
| `purchase_account_id` | write | Hard-coded `3418412000000000567` |
| `inventory_account_id` | write | Hard-coded `3418412000000000626` — **only for goods, not services** |
| `track_inventory` | write | `true` for goods; omitted for services |
| `product_type` | read/write | `"service"` for service items; otherwise omitted (Zoho defaults to `goods`) |
| `unit` | **computed but NOT sent** | See the UOM note below |
| `custom_fields` | write | Array of `{ api_name, value }`; only non-empty values pushed (`CarcassBomBuilder.tsx:4975-5006`) |
| `stock_on_hand`, `available_stock`, `actual_available_stock` | read | Used by the stock/reorder reports |
| `reorder_level` | read | Reorder report only |
| `item_type`, `is_combo_product` | read | Composite detection |

> **UOM gotcha (`CarcassBomBuilder.tsx:4984-5014`):** the function derives a `unit` from the item name (`set`→`pcs`, `kg`/`glue`→`Kg`, `ml`/`silicone`→`ML`, `mtr`/`wire`→`Mtr`, `mm`/`led`/`diffuser`/`tape`/`prof`→`MM`) and then **deliberately does not send it** — line 5013 is commented out with the note "Omit unit field for now to avoid UOM creation restrictions in Zoho". The `uom` parameter is therefore currently dead weight on the simple-item path. Composites *do* send `unit: "pcs"`.

**Service items created by the app** (`isService = true`, `CarcassBomBuilder.tsx:6009-6013`): `Cutting-1`, `Drilling-1`, `Packing Item - Carcass`, `Packing Item - Shutter`, `Packing Item - Hardware`.

### 1.2 Composite Item (+ `mapped_items`)

Zoho endpoint `/compositeitems`. Local type: `CompositeItemDetail` (`src/lib/types.ts:104-110`), extending `ItemDetail`.

**Read** via `GET /api/zoho/compositeitems/:id` (`src/app/api/zoho/compositeitems/[id]/route.ts:11-24`) → `{ compositeItem }`.
**Written** via `POST /api/zoho/compositeitems` (`src/app/api/zoho/compositeitems/route.ts:13-26`) → `{ compositeItem }`, and `PUT /api/zoho/compositeitems/:id` for BOM edits.

Created by `resolveCompositeItem()` (`CarcassBomBuilder.tsx:5033-5102`). Payload is the simple-item payload **plus**:

```
unit: "pcs"
mapped_items: [{ item_id, quantity }, …]
```

**The `mapped_items` response shape is inconsistent across Zoho versions.** The app defensively reads five aliases (`CarcassBomBuilder.tsx:5130`, mirrored in `src/lib/types.ts:105-109`):

```
mapped_items | composite_item_line_items | bundle_items | line_items | items
```

Always use that fallback chain when reading a composite's children.

`CompositeMappedItem` (`src/lib/types.ts:82-102`) fields: `mapped_item_id`, `item_id`, `composite_item_id`, `item_order`, `name`/`item_name`, `sku`, `quantity`/`quantity_needed`, `unit`/`unit_name`, `available_stock`, `stock_on_hand`, `actual_available_stock`, `quantity_available`, `is_combo_product`, `item_type`, `product_type`, `stocks[]`.

Two Zoho quirks the code works around:

1. **Two-child minimum.** If a composite would have exactly one child with `quantity <= 1`, the app auto-appends the `Drilling-1` service at qty 1 (`CarcassBomBuilder.tsx:5048-5061`). The `Drilling-1` composite itself is exempted to avoid recursion.
2. **100-char name cap.** `truncZoho(s, max = 100)` (`CarcassBomBuilder.tsx:5029-5031`) hard-truncates name and SKU. **This silently breaks name-based idempotency for long names** — see §1.6.

### 1.3 Sales Order (+ `line_items`)

Zoho endpoint `/salesorders`. Local types: `SalesOrderSummary` (`src/lib/types.ts:1-8`), `SalesOrderDetail` (`:42-51`), `SalesOrderLineItem` (`:18-40`).

**Read:** `GET /api/zoho/salesorders?q=<text>` (list) and `GET /api/zoho/salesorders/:id` (detail with `line_items`).
**Written:** `PUT /api/zoho/salesorders/:id` with a full `line_items` array (`CarcassBomBuilder.tsx:6873-6879`).

The push flow (`CarcassBomBuilder.tsx:6800-6886`) is a **full line-items rebuild**, not a patch:

- Fetch the current SO.
- For each existing line: if `product_type === "service"` (case-insensitive, `:6838`) **and** `parseCabinetCodeToModel(orig.sku || orig.name || orig.description, design)` decodes to a cabinet code matching a newly-built composite, **replace** the line with the composite — carrying over the original `quantity` and `rate` (`:6846-6852`).
- Otherwise the line is preserved verbatim via `buildSoLineItem(orig)`.
- New composites that matched nothing (manually-added cabinets, Other Accessories) are **appended** (`:6861-6870`).

Each replaced/appended line copies tax fields from the source line, falling back to `line_items[0]` (`taxFields()`, `:6814-6820`): `tax_id`, `tax_name`, `tax_percentage`, `tax_type` (default `"tax"`), `gst_treatment_code` (default `"out_of_scope"`).

> **Design intent:** the sales team enters cabinets as **service lines** whose SKU is the cabinet code; the builder converts each into a real composite BOM in place. `usedNew` (`:6834`) ensures one composite consumes at most one service line, so duplicate codes map 1:1 in order.

Line-item description carries the elevation: `` `Elevation: ${currentElevation}` `` (`:6759`), or `` `Profile: ${row.profile} ${row.profileColor}` `` for Other Accessories (`:6796`).

### 1.4 Contact / Vendor

Zoho endpoint `/contacts`. **Read-only** — the app never creates or edits contacts.

- `GET /api/zoho/contacts?contact_type=vendor&search=<text>`, `per_page: 200` (`src/app/api/zoho/contacts/route.ts:13-29`). Fields: `contact_id`, `contact_name`, `contact_type`, `company_name`.
- `GET /api/zoho/contacts/:id` additionally reads the vendor's lead/transit times (`src/app/api/zoho/contacts/[id]/route.ts:46-48`).
- Sales-order customer identity is read from `SalesOrderDetail.customer_id` / `customer_name` (`src/lib/types.ts:2-4, 43`).

### 1.5 Purchase Order

Zoho endpoint `/purchaseorders`.

- **Read:** `GET /api/zoho/purchaseorders?item_id=<id>&per_page=<n>`, sorted `date` descending (`src/app/api/zoho/purchaseorders/route.ts:30-50`). Used to find each item's **last vendor and last rate** for the reorder report. Fields: `purchaseorder_id`, `purchaseorder_number`, `vendor_id`, `vendor_name`, `date`, `status`, `total`.
- **Written:** `POST /api/zoho/purchaseorders` (draft POs from `src/components/DraftPoModal.tsx`).
- The route builds a deep link back into the Zoho web UI by rewriting the API host: `zohoapis.in` → `inventory.zoho.in` (`src/app/api/zoho/purchaseorders/route.ts:4-16`).

### 1.6 Identity & Idempotency — read this carefully

There are **two** identity mechanisms, and they do not agree.

**(a) `item_id` — Zoho's real key.** Opaque string, e.g. `3418412000001249001`. The only reliable identity. Hard-coded `item_id`s exist in `ACCESSORY_ITEMS` (`CarcassBomBuilder.tsx:289-296`).

**(b) Name-based idempotency — how the app actually decides "does this exist?"**

Every create goes through `searchItemByName()` (`CarcassBomBuilder.tsx:4943-4968`):

1. Canonicalise the target with `normalizePartOrPanelName(name)` (`src/lib/naming.ts:36-146`).
2. `GET /api/zoho/items?search=<cleanName>` → Zoho `search_text`.
3. Match when `normalizeItemName(it.name) === target` **or** `normalizeItemName(it.sku) === target`.
4. If nothing matched, retry with `?name=<cleanName>` → Zoho `name_contains`, same match test.
5. Return the item, or `null`.

`normalizeItemName()` (`:4936-4941`) = collapse whitespace runs → trim → **lowercase**. So matching is case-insensitive and whitespace-insensitive, but otherwise exact.

`resolveSimpleItem` / `resolveCompositeItem` both call this first and **return the existing `item_id` instead of creating** (`:4972-4973`, `:5043-5046`). This is the entire dedupe strategy: **the item name is the natural key.**

> ### ⚠️ Known correctness hazards
>
> 1. **Truncation breaks dedupe.** `resolveCompositeItem` searches for the *truncated* 100-char name (`:5041-5043`) but Zoho stores what it stores. Two different cabinets whose names agree in the first 100 chars will collide onto one composite; conversely a name Zoho truncated differently will never be found and gets recreated. Any fix must make names short and deterministic rather than truncating.
> 2. **`search_text` is fuzzy, matching is exact.** If the correct item is past `per_page: 200` of a fuzzy search, it will not be found — and a **duplicate item is created in the live production Zoho org**. There is no transaction and no rollback.
> 3. **No optimistic concurrency.** The SO `PUT` sends the whole `line_items` array read moments earlier. Two users pushing to the same SO concurrently → last write wins, silently.
> 4. **`findExistingCompositeByRawMaterial()`** (`:5104-5139`) is a slower secondary lookup: search by name, then for each composite hit, `GET` its detail and check whether any `mapped_items[].item_id` equals a given raw-material id. Used to disambiguate same-named composites built from different stones.

---

## 2. Zoho Custom Fields

All custom fields are read through **`getCfValue(source, key)`** (`src/lib/stock.ts:23-50`), which tries three shapes in order:

1. A direct property on the record (`item.cf_group`) — Zoho returns these when the field is on the layout.
2. `custom_field_hash[key]`.
3. A scan of the `custom_fields[]` array matching `api_name`, `placeholder`, or a case-insensitive `label`.

It always returns a **string** (`""` when absent). **Never read `item.cf_x` directly — always go through `getCfValue`.** The reorder route has its own multi-alias variant, `readCf(record, ...keys)`.

Writes always use the `{ api_name, value }` array form, built from the `ItemCustomFields` shape (`CarcassBomBuilder.tsx:4926-4934`).

| API name | Type | Meaning | Written by | Read by |
| --- | --- | --- | --- | --- |
| `cf_group` | Text | Top-level material/BOM group. Known values written: `Carcass`, `Shutters`, `Shutter Panel Pack`, `Aluminium Profile & Parts`, `Glass`, `Hardware Part`, `Other Accessory` | `resolveSimpleItem` `:4976`, `resolveCompositeItem` `:5064` | `stock.ts:128` (via `detectGroup`), `types.ts:69` |
| `cf_sub_group` | Text | Zone within the group — `base`, `tall`, `wall`, `loft`, `mid` (the `zoneName`) | `:4977`, `:5065` | `stock.ts:129` |
| `cf_finish` | Text | Stone shade / profile colour / glass colour (e.g. `MAGPPIE CREMA`, `CHAMPAGNE`, `CLEAR`) | `:4978`, `:5066` | `stock.ts:134`, `rawmaterial.ts` |
| `cf_thickness` | Text (mm) | Stone thickness — `5`, `6`, `8`, `10`, `12`, `15`, `18`, `20`, `30`. Shutter stone is always `"6"` (`:6606`, `:6783`) | `:4979`, `:5067` | `stock.ts:133`, stone grouping key |
| `cf_height` | Text (mm) | Height. **On a raw stone item this is the SLAB LENGTH** — see the slab-area note below | `:4980`, `:5068` | `stock.ts:130`, `getSlabArea` `:7218` |
| `cf_width` | Text (mm) | Width. **On a raw stone item this is the SLAB WIDTH** | `:4981`, `:5069` | `stock.ts:131`, `getSlabArea` `:7219` |
| `cf_depth` | Text (mm) | Depth (cabinets/panels) | `:4982`, `:5070` | `stock.ts:132` |
| `cf_type` | Text | Item sub-type | *never written by the app* | `stock.ts:135`, `types.ts:76` |
| `cf_sqft` | Decimal | Slab area in ft², **authoritative when > 0**; falls back to `cf_height × cf_width / (304.8×304.8)` | *never written* | `BomDashboard.tsx:904, 1009`; `rawmaterial.ts:512` |
| `cf_waste_percentage` | Decimal | Per-item waste % override, read off the **raw material** item | *never written* | `stock.ts:136`; `rawmaterial.ts:308, 387, 489, 555` |
| `cf_profile_code` | Text | Profile design code (`MD1`, `CM1`, `C TYPE`…) used to match profile raw materials | *never written* | `rawmaterial.ts:811` |
| `cf_msl` / `cf_minimum_stock_level` | Decimal | Minimum stock level (aliases; also matched by labels `MSL`, `Minimum Stock Level`) | *never written* | `src/app/api/zoho/reorder-report/route.ts:195` |
| `cf_lead_time` / `cf_leadtime` | Decimal (days) | **Vendor** field — manufacturing lead time (labels `Lead Time`, `lead_time`) | *never written* | `contacts/[id]/route.ts:46`; `reorder-report/route.ts:171` |
| `cf_transit_time` / `cf_transittime` | Decimal (days) | **Vendor** field — shipping transit time | *never written* | `contacts/[id]/route.ts:48`; `reorder-report/route.ts:173` |

> **The app is overwhelmingly a custom-field *writer* for item/BOM fields and a *reader* for planning fields.** `cf_sqft`, `cf_waste_percentage`, `cf_profile_code`, `cf_msl`, `cf_lead_time`, `cf_transit_time` and `cf_type` are all maintained **by hand in Zoho** and are never set by this app. If they are blank in Zoho, the app silently falls back to a computed value or `0`.

### Slab area & waste — the central quantity formula

```
SQDIV   = 92903.04            // mm² per ft² (=304.8²)   CarcassBomBuilder.tsx:434
sqft(w, h) = (w * h) / SQDIV                            //  :493

STONE_WASTE   = 0.15   // +15% on every stone panel      :435
PROFILE_WASTE = 0.20   // +20% on aluminium profile      :436
ELENOR_WASTE  = 0.10   // +10% on Elenor light profile    :437
```

`getSlabArea(item)` (`CarcassBomBuilder.tsx:7217-7224`) reads `cf_height × cf_width / 92903.04`, returning `0` if either is missing.

The stone quantity pushed onto a `mapped_items` line is a **fraction of a slab**:

```
area     = sqft(width, height) * (1 + STONE_WASTE)
stoneQty = round( (slabArea > 0 ? area / slabArea : area) * 10000 ) / 10000
```

(verbatim at `CarcassBomBuilder.tsx:6778-6779` for Other Accessories; the same shape recurs for carcass and shutter stone.) Note the fallback: **when `slabArea` is 0 — i.e. the raw stone item has no `cf_height`/`cf_width` in Zoho — the quantity silently becomes raw ft² instead of a slab fraction.** That is a data-quality landmine, not a designed behaviour. Rounding is to 4 decimals.

---

## 3. The Composite BOM Tree

One **cabinet** produces one Level-1 composite, pushed as one Sales-Order line. Everything below is created bottom-up: leaves first (`resolveSimpleItem`), then each assembly node (`resolveCompositeItem`) referencing the ids returned by its children.

```
Sales Order  (Zoho /salesorders)
└── line_item  { item_id → Cabinet composite, quantity, rate, description:"Elevation: AA" }
    │
    └── L1  CABINET COMPOSITE            "<SO-prefix> <cabinet code>"        :6747-6753
        │       cf_group=Carcass  cf_sub_group=<zone>  cf_finish=<carcass stone>
        │       cf_thickness/height/width/depth = dims.t/H/W/D
        │
        ├── L2  "Set of Parts- Cab <sn> Base LH(..)+RH(..) <W>x<H>x<t>"      :2114
        │   │       (one packet per panel group: sides / top+bottom / back wall)
        │   │       cf_group=Carcass
        │   │
        │   ├── L3  "Panel - …  <w>x<h>x<t> <FINISH>"  (composite)          :6157
        │   │   ├── L4  raw STONE item        qty = area×1.15 / slabArea
        │   │   └── L4  Cutting-1             (service)
        │   │
        │   ├── L3  "Part - … LH <drill> <w>x<h>x<t> <FINISH>"  (composite)  :6171
        │   │   ├── L4  Panel composite (above)
        │   │   └── L4  Drilling-1            (service)
        │   │
        │   ├── L3  "Cut …"  profile cut composite                           :6214
        │   │   ├── L4  raw ALUMINIUM PROFILE  cf_group="Aluminium Profile & Parts"
        │   │   │        cf_finish=<profile colour>, uom "Mtr", qty ×1.20
        │   │   └── L4  Cutting-1             (service)
        │   │
        │   └── L3  Packing Item - Carcass    (service)
        │
        ├── L2  "Drawer Pack- Cab Drawer Box <variant>"                      :959
        │   │       one per drawer variant; qty = per-drawer × drawer count
        │   ├── L3  Panel / Part composites  (drawer box panels)
        │   ├── L3  drawer hardware items    (fascia drawers keep hardware here)
        │   └── L3  Packing Item - Hardware  (service)
        │
        ├── L2  "<SO-prefix> <shutter code> Ready"   Fully-Ready Shutter     :6601-6608
        │   │       cf_group="Shutter Panel Pack"  cf_thickness="6"
        │   │
        │   ├── L3  "Parts- SH <pw>x<ph> <design>"   assembly node           :3608, :4318
        │   │   ├── L4  Panel composite  (stone)  OR  raw GLASS item  cf_group=Glass  :6518
        │   │   ├── L4  Set of Profile  →  L5 raw profile + Cutting-1
        │   │   └── L4  Corner Connector (glass vs stone variant)            :3645
        │   ├── L3  shutter assembly hardware
        │   └── L3  Packing Item - Shutter   (service)
        │
        ├── L2  "<SO-prefix> <shutter code>"         Shutter BOM             :6618-6626
        │   │       cf_group=Shutters  cf_sub_group=<zone>  cf_thickness="6"
        │   ├── L3  Fully-Ready Shutter  (the L2 above, qty 1)
        │   └── L3  Fitting Hardware Pack  (hinge + Packing Item - Hardware)  :6611-6614
        │
        ├── L2  "Elenor with Light …"  composite                             :6736
        │   ├── L3  raw profile (qty ×1.10 ELENOR_WASTE) + Cutting-1
        │   └── L3  Elenor hardware / consumables
        │
        ├── L2  hardware items       (Hardware[]  → resolveSimpleItem/Pack)  :6635+
        ├── L2  consumable items     (Consumable[] → resolveSimpleItem)      :6662
        └── L2  glassShelf raw item  cf_group=Glass  cf_finish=CLEAR         :6670
```

Separate top-level SO lines (siblings of the cabinet, **not** nested):

```
└── line_item → "Chimney Panel <W>x<H>x6 <COLOUR> (<profile> <profileColor>)"   :6785-6790
    │            cf_group="Other Accessory"  cf_thickness="6"
    ├── raw STONE   qty = sqft(w,h)×1.15 / slabArea
    └── Cutting-1   (service)
```

Backsplash and Countertop rows likewise each become their own master BOM under their own main group.

**Naming is the schema.** Because identity is name-based (§1.6), these formats are contracts — changing a template string re-creates every item in Zoho as a duplicate:

| Node | Format | Example |
| --- | --- | --- |
| Cabinet (L1) | `<SO-prefix> <code>` | `SO-00029 BS-600-2D` |
| Panel packet | `Set of Parts- Cab <sn> Base<lowS> LH(<lh>)+RH(<rh>) <D>x<sideH>x<t>` | `Set of Parts- Cab Standard Tall LH(JD)+RH(JD) 2100x580x18` |
| Back wall | `Set of Parts- Cab Common Base Back Wall (Prof) <bw>x<bh>x<t>` | |
| Drawer pack | `Drawer Pack- Cab Drawer Box <variant>` | `Drawer Pack- Cab Drawer Box H90` |
| Shutter parts | `Parts- SH <pw>x<ph> <design>` | `Parts- SH 596x717 MD1CM1` |
| Fully-ready shutter | `<SO-prefix> <shutter code> Ready` | |
| Other accessory | `<label> <W>x<H>x6 <COLOUR> (<profile> <profileColor>)` | `Chimney Panel 600x700x6 MAGPPIE CREMA (MD1 CHAMPAGNE)` |

`src/lib/naming.ts` canonicalises panel/part names before every search and create:

- `normalizePartOrPanelName()` (`:36`) — collapse whitespace; `LH+RH` → `LH/RH`; strip a trailing `-SO-<digits>` suffix (preserved and re-appended); strip trailing `Project`/`-Project`; then, **only for names starting `Part`/`Parts`/`Panel`/`Panels`**, locate the size token (`\d+x\d+x\d+` or `\d+mm`), split the remainder into drill vs finish, normalise the prefix to `Part - ` / `Panel - ` / `Part Profile` / `Panel Profile`, and re-emit as `<prefix> [<side>] [<drill>] <size> <finish>`. Names not matching Part/Panel pass through unchanged.
- `splitDrillAndFinish()` (`:1-34`) — leading tokens are drill words while they match `LH`/`RH`/`LHS`/`RHS`/`/`, `\d+S`, `\d+H`, `\d+HB`, `JD`/`JD1`/`JD2`; the first non-drill token switches to finish and everything after is finish.
- `getPartBaseName()` (`:148`) / `getPanelBaseName()` (`:154`) — build the raw string then normalise. A drill of `"no drill"` (case-insensitive) is dropped.

---

## 4. Local TypeScript Models

### 4.1 `src/lib/types.ts` — Zoho wire shapes

| Type | Line | Purpose |
| --- | --- | --- |
| `SalesOrderSummary` | `:1` | `salesorder_id`, `salesorder_number`, `customer_name`, `status`, `date?`, `total?` |
| `ZohoCustomField` | `:10` | `api_name?`, `placeholder?`, `label?`, `value?`, `value_formatted?` |
| `SalesOrderLineItem` | `:18` | See below |
| `SalesOrderDetail` | `:42` | `SalesOrderSummary` + `customer_id?`, `email?`, `reference_number?`, `salesperson_name?`, `billing_address?`, `shipping_address?`, `contact_person_details?[]`, `line_items?[]` |
| `ItemDetail` | `:53` | See below |
| `CompositeMappedItem` | `:82` | §1.2 |
| `CompositeItemDetail` | `:104` | `ItemDetail` + the 5 mapped-item aliases |
| `StockStatus` | `:112` | `"in-stock" \| "low-stock" \| "out-of-stock" \| "unknown"` |
| `BomRowType` | `:114` | `"master" \| "plain" \| "sub_bom" \| "component"` |
| `BomReportRow` | `:116` | Flattened report row — see below |
| `ApiErrorBody` | `:149` | `{ error: string; detail?: unknown }` |

**`SalesOrderLineItem`** (`:18-40`): `line_item_id?`, `item_id?`, `composite_item_id?`, `item_name?`, `name?`, `sku?`, `description?`, `quantity?`, `rate?`, `unit?`, `group_name?`, `is_combo_product?`, `item_type?`, `product_type?`, `stock_on_hand?`, `quantity_available?`, `actual_available_stock?`, `cf_group?`, `custom_field_hash?`, `custom_fields?`, `item_total?`.

**`ItemDetail`** (`:53-80`): `item_id` (**required — the only required field**), `name?`, `item_name?`, `sku?`, `available_stock?`, `stock_on_hand?`, `actual_available_stock?`, `group_name?`, `category_name?`, `unit?`, `is_combo_product?` (`boolean | string` — Zoho returns both), `combo_type?`, `item_type?`, `product_type?`, `composite_item_id?`, `cf_group?`, `cf_sub_group?`, `cf_height?`, `cf_width?`, `cf_depth?`, `cf_thickness?`, `cf_finish?`, `cf_type?`, `cf_waste_percentage?`, `custom_field_hash?`, `custom_fields?`.

**`BomReportRow`** (`:116-147`): `sourceOrderId`, `sourceOrderNumber`, `customerName`, `orderDate?`, `itemId`, `parentItemId?`, `itemName`, `sku`, `groupName`, `masterGroup`, `cfGroup`, `cfSubGroup`, `cfHeight`, `cfWidth`, `cfDepth`, `cfThickness`, `cfFinish`, `cfType`, `level` (number), `quantityNeeded`, `wastePercent`, `actualQuantity`, `rawStock`, `effectiveStock`, `deficit`, `unit`, `status: StockStatus`, `rowType: BomRowType`, `typeLabel: "PACK BOM" | "COMPONENT" | "SUB-BOM" | "ITEM"`, `underProfile: boolean`.

### 4.2 `CarcassBomBuilder.tsx` — domain models

**`Panel`** (`:15-23`)

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | `string` | Panel label; feeds `getPanelBaseName` |
| `w`, `h` | `number` | Width, height (mm) |
| `qty` | `number` | Count in the cabinet |
| `drill` | `string \| null` | Drill code (`JD`, `3S`, `2HB`, `LH`…); `null`/`"no drill"` → omitted from name |
| `pack` | `string` | Which `Set of Parts-` packet this panel belongs to |
| `t?` | `number` | Thickness (mm); defaults to the model's `t` |

**`Profile`** (`:25-31`) — `name`, `len` (mm), `qty`, `type`, `pack`.

**`Hardware`** (`:33-38`) — `name`, `qty`, `uom?`, `pack?`. A `pack` starting `"Elenor with Light"` is **skipped** in the main hardware loop (handled inside the Elenor composite, `:6640`).

**`Consumable`** (`:40-45`) — `name`, `qty`, `uom`, `pack`.

**`FillerRow`** (`:49-57`) — `id`, `zone` (`base|tall|wall|loft|mid`, may repeat across rows), `customShade`, `qty`, `customHeight`, `customWidth`, `elevation` (`AA`/`BB`/… or free text; stamped onto the filler's BOM rows).

**`VisiblePanelRow extends FillerRow`** (`:58-60`) — adds `profile: string`.

**`BacksplashRow`** (`:65-72`) — `id`, `width`, `height`, `thickness`, `color`, `qty`. Each row is its own master BOM under the `Backsplash` group: 1 stone panel (+15% waste) + a glue consumable priced per ft² × area × qty.

**`CountertopRow`** (`:80-95`)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `number` | Row key |
| `length`, `depth` | `string` | L, D (mm) |
| `thickness` | `string` | `"30"` or `"40"` |
| `color` | `string` | Stone shade |
| `ctType` | `number` | 1–9 construction type (`CT_TYPES`) |
| `edging` | `CtEdging` | Rounding side — **name-only**, no geometry |
| `edgingHeight` | `string` | Rounding height shown in the name; default `600` |
| `dropHeight` | `string` | Drop-down panel height; default `705` |
| `left`, `right` | `CtSide` | **Legacy**, kept for back-compat; geometry now derives from `ctType` |
| `island` | `boolean` | Legacy island flag |
| `baseLight` | `boolean` | Base LED light |
| `qty` | `number` | Count |

Supporting types: `CtSide = "none" | "dropdown" | "edging"` (`:79`); `CtEdging = "none" | "left" | "right" | "both"` (`:101`); `ctEdgingOptions(type)` (`:102-107`) — type 1 → both/left/right/none, type 2 (LH drops) → RH free only, type 3 (RH drops) → LH free only, types 4/5/islands → none; `ctHasDrop(type)` (`:156`) — true for 2, 3, 4 and all islands.

`CT_TYPES` (`:127-137`) — **display order ≠ stored value.** The stored `value` drives construction logic; the label's leading number is only the on-screen position:

| `value` | Label |
| --- | --- |
| 1 | `1 · Linear` |
| 5 | `2 · Linear + BSV` |
| 2 | `3 · Linear + LHV with LH Drop` |
| 3 | `4 · Linear + RHV with RH Drop` |
| 4 | `5 · Linear + BSV with Both Side Drop` |
| 6 | `6 · Island Compact` (island) |
| 7 | `7 · Island Table` (island) |
| 8 | `8 · Island with 350mm Sitting` (island) |
| 9 | `9 · Island Both Side Cabinets` (island) |

`CtPanel` (`:142`) — `label`, `len`, `wid`, `kind: "flat" | "dropdown"`, `deadQty?`.
`CtGeom` (`:143-153`) — `topL`, `topD`, `baseL`, `baseD`, `panels[]`, `brass`, `brassLen`, `grandLights`, `sideDrops`.

`ctGeom(type, L, D, T, dropHeight = 705)` (`:161-196`) — the exact derivation:

```
dh          = dropHeight > 0 ? dropHeight : 705
isl         = CT_TYPES.find(t => t.value === type)?.island ?? false
dropLeft    = type === 2 || type === 4 || isl
dropRight   = type === 3 || type === 4 || isl
edgeBoth    = type === 5
reduce      = type === 7 ? 0 : 1          // freestanding island table is exempt
backDrops   = isl ? 1 : 0
topDepthReduce = (type === 7 || type === 8) ? 0 : 1

topL  = L + 30*edgeFolds - 100*sideDrops*reduce
topD  = D + 30 - 100*backDrops*reduce*topDepthReduce
baseL = L - 100*sideDrops*reduce
baseD = max(0, D - 40 - 100*backDrops*reduce)
brassLen = D
```

Every type shares the same base build: a top slab L×D, a **dead-stock** base stone L×(D−40) (set back 10 mm at the back), a 30 mm front mitred drop-down patti (length L), an **Alu Grand Light HM-512** under the front lip, a 3 mm edge radius, and polish/glue consumables. Types differ only in side/back treatment:

- **Side drop-down** — the 30 mm side patti is a *mitred fold of the top slab*, not a separate piece; each drop side adds 1 brass strip (D×30) and a D×`dropHeight` drop panel, and takes 100 mm off top+base **length**.
- **Side edge only (type 5)** — both side patti fold into the top slab length (`+30` each); no brass, no panel.
- **Islands (6–9)** — both sides drop + a back drop. Type 6: `Island Back Panel (single-side)` `(L−60)×dh`. Type 7: `Island Vertical Panel (double-side)` `(L−60)×dh` and **`grandLights = 2`**. Type 8: `Island Sitting Drop` `(L−80)×350` with `deadQty: 2`. Type 9: `Island Back Panel (section)` `(L−60)×dh`.

**`Shutter`** (`:198-211`) — `code`, `kind: "drawer" | "hinged" | "fixed"`, `design`, `w`, `h` (leaf size), `pw`, `ph` (panel size), `profV`, `profH` (vertical/horizontal profile lengths), `hinge`, `hq?` (hinge qty), `loc?` (`L`/`R`/`U`/`F`/`X` — side/position).

**`CarcassModel`** (`:213-247`)

| Field | Type | Meaning |
| --- | --- | --- |
| `code` | `string` | Cabinet code — the SO/name key |
| `mat` | `string` | Primary material |
| `carcassMat?`, `shutterMat?` | `string` | Stone shades |
| `fixedPanelMat?` | `string` | Stone for the fixed/dummy blind panel — only for glass-shutter blind cabinets where the glass shade differs |
| `carcassProfileColor?`, `shutterProfileColor?` | `string` | Profile colours |
| `f`, `v` | `any` | Config/variant blobs — **untyped** |
| `sn` | `string` | Series/short name used in packet names |
| `lh?`, `rh?` | `string \| null` | Left/right drill codes |
| `W`, `H`, `D` | `number` | Cabinet dims (mm) |
| `t` | `number` | Panel thickness (mm) |
| `isCJ` | `boolean` | CJ-profile variant |
| `pkRows` | `Array<[string,string,string,number,string]>` | Packing-list rows: `[kind, name, size, qty, uom]` |
| `panels` | `Panel[]` | |
| `profiles` | `Profile[]` | |
| `hardware` | `Hardware[]` | |
| `cons` | `Consumable[]` | Consumables |
| `netSqft` | `number` | Net stone area |
| `nPanels` | `number` | Panel count |
| `ops` | `{ cut: number; drill: number }` | Operation counts |
| `shutters?` | `Shutter[]` | |
| `zk?`, `fk?` | `string` | Zone key / finish key |
| `glassShelf?` | `{ name, w, d, t, qty }` | Wall stone/glass-shutter cabinets emit glass shelves as a **direct raw material**, not a stone-panel BOM; qty derives from height |

**`ProjectLine`** (`:249-261`) — `qty`, `m: CarcassModel`, `rate?`, `elevation?`, plus Designer-upload metadata: `priceGroup?` (`"PG-1"`/`"PG-2"`), `upCode?` (cabinet code, no finish suffix), `upDesign?` (e.g. `MD1CM1`), `upCarcass?`, `upProfile?`. The `up*` fields let the shutter-colour picker rebuild the line's model with a new finish, filtered by the row's price group.

**`OtherAccRow`** (`:310-319`) — `id`, `item: "chimney" | "dishwasher"`, `width`, `height`, `profile` (profile CODE, default = shutter design), `profileColor` (follows shutter profile colour), `color` (stone finish, default = shutter stone), `qty`.

**Accessory models** (`:264-298`)

- `AccessoryKey = "skirting" | "duplay" | "lprofile" | "jhandle" | "chandle" | "grandlight"`
- `AccessoryItem` — `{ key, label, itemId, condition: (zone) => boolean }`
- `AccessoryEntry` — `{ enabled, size, elevation, actualQty: number|null, straightConnectors, lConnectors, driver }`
- `AccessorySubformRow` — `{ id, cabinetIndices: number[], accessories: Record<AccessoryKey, AccessoryEntry> }`
- `PROFILE_ACC_KEYS = ["skirting", "duplay", "lprofile", "grandlight"]` (`:298`)

`ACCESSORY_ITEMS` (`:289-296`) — **hard-coded live Zoho `item_id`s**:

| key | label | itemId | zone condition |
| --- | --- | --- | --- |
| `skirting` | Skirting with light | `3418412000001249001` | zone contains `base` or `tall` |
| `duplay` | Duplay Profile Light | `3418412000001249010` | zone contains `wall` |
| `lprofile` | L Profile Dado Light | `3418412000001249037` | zone contains `wall` |
| `jhandle` | J type handle | `3418412000001249019` | always |
| `chandle` | C type handle | `3418412000001249028` | always |
| `grandlight` | Grand Profile Light | `3418412000001249046` | zone contains `base` |

`ELEVATION_OPTIONS` (`:301`) = `["AA","BB","CC","DD","EE","FF","GG","HH","II","JJ","KK"]` — mandatory at cabinet add.

`VP_PRESETS` (`:323+`) — standard Visible-Panel sizes per zone (Height × Width/depth mm), e.g. `base: [{ "Base STD (717×586)", h:717, w:586 }, { "Base Low Depth (717×362)", h:717, w:362 }]`, `wall: [{ "Wall STD (1082×362)" }, { "Wall STD (717×362)" }]`. Wall-chimney sizes live in `CHIMNEY_PRESETS`, not here.

### 4.3 `src/lib/rawmaterial.ts` — selection models

`StoneGroup` (`:22-40`) — `key` (`category|finish|thickness`), `category: "carcass" | "shutter"`, `finish`, `thickness`, `defaultStoneId/Name/Sku`, `defaultStoneSqft?`, `totalSqft` (**including waste %**), `chainItems: BomChainItem[]` (the BOM chain from Panel up to Carcass/Shutter), `carcassItemIds[]`, `changed`, `newStoneId`, `newStoneName`, `newStoneSqft?`, `customPcs?`.

`ProfileGroup` (`:42-59`) — `key` (`profileCode|finish|size`), `category`, `profileCode`, `finish`, `size`, `defaultProfileId/Name/Sku`, `totalLength` (including waste %), `chainItems`, `profileItemIds[]`, `changed`, `newProfileId`, `newProfileName`.

Exported functions: `resolveRawMaterials()` (`:448`), `searchStoneItems(finish, stoneThickness, excludeStoneId?)` (`:604`), `searchProfileItems(finish, profileCode)` (`:768`), `searchHardwareItems(name)` (`:860`), `applyStoneChange()` (`:1218`), `applyProfileChange()` (`:1338`).

---

## 5. Seed Data Files

Three JSON files under `src/data/`, imported directly into the client bundle (`CarcassBomBuilder.tsx:9-11`). **They are compile-time constants — editing them requires a rebuild/redeploy. They are not synced from Zoho and can drift from the live item master.**

### 5.1 `src/data/stone_finishes.json` (176 lines)

Structure: `Record<thicknessMm, string[]>` — thickness (as a string key) → sorted array of stone shade names. Keys observed: `"5"`, `"6"`, `"8"`, `"10"`, `"12"`, `"15"`, `"18"`, `"20"`, `"30"`.

```json
{
  "5":  ["ARLON PISTA", "BEIGE HYDRA", "BIANCO HYDRA", "BIANCO LASA", "CLOUDY OLIVE",
         "CLOUDY WHITE", "HONEY BEIGE", "IRON BEIGE", "MYRA SAND", "NEO DARK BROWN",
         "NEW MACHIA", "ONYX GREEN", "PANTAGONIA", "SANDUNE BEIGE", "VANILLA CREAM",
         "VERONICA ARBESQUE"],
  "6":  ["BLACK STATUARIO NUVOLATO", "BRECCIA BIANCO", "CALACATTA PERLATO", "CAROL",
         "CLASSICO BIANCO", "CLASSICO CHOCO", "CORALLO GREY", "CREAM", "DIAMOND GREY",
         "DINAN DARK GREY", "DINAN LIGHT GREY", "DRY VERDE ALPI", "EVEREST GREY",
         "EVEREST TAUPE", "FENDI WHITE", "FLURRY BLACK", "FOREST GREEN", "ICELAND WHITE",
         "INTERSTELLAR", "INVISIBLE ROYAL", "…"]
}
```

Drives the stone-shade dropdowns. `"6"` is the shutter-stone thickness the push flow hard-codes (`cf_thickness: "6"`).

### 5.2 `src/data/profile_finishes.json` (23 lines)

Structure: `Record<profileCode, string[]>` — profile design code → the finishes it is available in. Complete file:

| Code | Finishes |
| --- | --- |
| `C TYPE` | BRUSH GOLD, CERAMIC BLACK, CHAMPAGNE |
| `CJ` | BRUSH GOLD, CERAMIC BLACK, CHAMPAGNE |
| `CL1` | BRUSH GOLD, CHAMPAGNE |
| `CL2` | BRUSH GOLD |
| `CM1` | BRUSH GOLD, CERAMIC BLACK, CHAMPAGNE |
| `CM2` | BRUSH GOLD, CERAMIC BLACK, CHAMPAGNE |
| `DADO` | BRUSH GOLD, CHAMPAGNE |
| `DUPLEY` | BRUSH GOLD, CERAMIC BLACK, CHAMPAGNE |
| `GRAND` | CHAMPAGNE |
| `J TYPE` | BRUSH GOLD, CERAMIC BLACK, CHAMPAGNE |
| `MD1` | CERAMIC BLACK |
| `MD2` | BRUSH GOLD, CERAMIC BLACK, CHAMPAGNE |
| `MD3` | CERAMIC BLACK |
| `SKT` | BRUSH GOLD |
| `STP` | CHAMPAGNE |
| `ELEN` | CHAMPAGNE |
| `HM510` | CHAMPAGNE, W/OUT ANODISED |
| `HM511` | CHAMPAGNE |
| `HM513` | CHAMPAGNE |
| `DIFFUSER` | WHITE |
| `NEON20` | CERAMIC BLACK, CHAMPAGNE |

These codes correspond to the `cf_profile_code` custom field used to match profile raw materials (`rawmaterial.ts:811`).

### 5.3 `src/data/planning_finishes.json` (34 lines)

Maps for the **Designer-page Excel upload** (`/designer`). Four keys plus a `_note`.

**`carcassShortCodes`** — Excel short code → full carcass finish. The file's own `_note` says this is *"a placeholder until the full short-code sheet is provided"* — **this map is knowingly incomplete**:

```json
{ "GC": "GALAXY CREMA", "ON": "ONYX OMAN", "OM": "ONYX OMAN" }
```

**`profileFinishMap`** — designer profile name → app profile finish:

```json
{ "Light Bronze": "CHAMPAGNE" }
```

**`shutterTypeMap`** — Excel shutter type → app design code (strips the `+`):

```json
{ "MD1+CM1": "MD1CM1", "MD1+CM2": "MD1CM2", "MD2+CM1": "MD2CM1",
  "MD2+CM2": "MD2CM2", "MD3+CM1": "MD3CM1", "MD3+CM2": "MD3CM2" }
```

**`priceGroups`** — `"PG-1" | "PG-2"` → shutter stone shade names. Feeds `ProjectLine.priceGroup`, which filters the shutter-colour picker.

- **PG-1** (25 shades): MAGPPIE ART, MAGPPIE PALACE, MAGPPIE KING, MAGPPIE JEWEL, MAGPPIE ELEGANCE, MAGPPIE CALM, MAGPPIE D'ESTE, MAGPPIE ROMANO, MAGPPIE VETICANO, MAGPPIE TRAVERTINO, MAGPPIE TIMELESS, MAGPPIE RIVER, MAGPPIE EARTH, MAGPPIE ONYX GOLD, MAGPPIE ONYX MYSTIC, MAGPPIE TAJ, MAGPPIE FOREST, MAGPPIE ONYX BLACK, MAGPPIE FLURRY, MAGPPIE SANTORINI, MAGPPIE GULNAAR, MAGPPIE PERSIAN TRAVENTINE, MAGPPIE VEILSTONE, MAGPPIE CREMA, MAGPPIE GLACIER
- **PG-2** (18 shades): MAGPPIE TERRAZO GREY, MAGPPIE EARTH TAUPE, MAGPPIE EARTH GREY, MAGPPIE SAHARA, MAGPPIE WHITE MUSE, MAGPPIE BEIGE MUSE, MAGPPIE MYRA SAND, MAGPPIE NEO BROWN, MAGPPIE CREAM STONE, MAGPPIE GRAPHITE, MAGPPIE DUSK, MAGPPIE SAGE, MAGPPIE AMBER, MAGPPIE CLOUDSTONE, MAGPPIE BREEZE, MAGPPIE GALAXY, MAGPPIE VANILLA, MAGPPIE COSMIC

> Note the two naming universes: `stone_finishes.json` uses **raw quarry names** (`ARLON PISTA`, `FENDI WHITE`); `planning_finishes.json` `priceGroups` uses **MAGPPIE-branded names**. They are not the same list and there is no mapping file between them.

---

## 6. localStorage & The "No Persistence" Constraint

Three keys, total. There is no IndexedDB, no cookie state, no server session.

| Key | Written at | Read at | Value |
| --- | --- | --- | --- |
| `app_authenticated` | `AuthGate.tsx:28` | `AuthGate.tsx:12` | The literal string `"true"` |
| `bom_accessory_subform_rows` | `BomDashboard.tsx:1208` | `BomDashboard.tsx:672` | `JSON.stringify(accessoryRows)` — an `AccessorySubformRow[]` |
| `bom_accessory_subform_counter` | `BomDashboard.tsx:1209` | `BomDashboard.tsx:673` | `String(accessoryCounter)` — the next row id |

### 6.1 Authentication — security issue

`src/components/AuthGate.tsx` gates the whole client. The check is **a hard-coded plaintext string comparison in client-side code** (`AuthGate.tsx:27`):

```ts
if (password === "Factory@1234") {          // AuthGate.tsx:27  ← hard-coded constant
  localStorage.setItem("app_authenticated", "true");
  setIsAuthenticated(true);
}
```

> ### 🔴 This is not authentication.
>
> - The password ships in the JS bundle — visible to anyone who opens DevTools or fetches the chunk.
> - The gate is bypassed entirely by typing `localStorage.setItem("app_authenticated","true")` in the console.
> - It is **purely cosmetic**. Every `/api/zoho/**` route is **completely unauthenticated** — no session check, no token, no middleware. Anyone who can reach the deployed URL can read and write the live production Zoho Inventory org.
> - There is no logout, no expiry, no per-user identity, and therefore **no audit trail**: every Zoho write is attributed to the single service refresh token, so nothing records *which human* created or replaced a BOM.
> - The 600 ms `setTimeout` (`:26`, commented "premium feedback transition") is cosmetic only.
>
> Treat this as the top security finding for the handover. A real fix needs server-side auth (middleware over `/api/zoho/**` plus a session), not a better client-side constant. Rotate the shared password and the Zoho refresh token as part of any remediation, since both have been exposed in the bundle and in git history.

### 6.2 No persistence for builder state

**Everything in `CarcassBomBuilder.tsx` lives in React `useState` and nowhere else.** The project line list (`ProjectLine[]`), the current `CarcassModel`, filler/visible-panel/backsplash/countertop/other-accessory rows, raw-material selections (`selectedRawIds`, `rawOptionsMap`), and the selected sales order are **all lost on refresh, tab close, or crash.**

Practical consequences to design around:

- A user who has configured 30 cabinets and hits F5 starts from zero. There is no draft, no autosave, no recovery.
- The **only** durable output is the "Push to Zoho" flow. Until it runs, the work does not exist anywhere.
- The push is **not atomic**: it creates dozens of items and composites one at a time and only then `PUT`s the SO (`CarcassBomBuilder.tsx:6800-6884`). A failure midway leaves orphaned items and composites in the live Zoho org with no rollback — and because dedupe is name-based (§1.6), a retry will *find and reuse* the orphans rather than duplicating them, which is the one thing that makes this survivable.
- The `AccessorySubformRow[]` list in `BomDashboard` is the sole exception — it survives refresh via the two localStorage keys above.
- Because it is `localStorage` and not a server, accessory rows are **per-browser**: a user on a second device or an incognito window sees an empty list, and two users never share state.

Anyone adding persistence should be aware the app is built on the assumption that Zoho *is* the database — a local draft store would be a genuine architectural addition, not a refactor.

---

## 7. Sample Data

Representative shapes. IDs are real-format examples; stone/profile names are drawn from the seed files.

### Item — raw stone (read from Zoho)

```json
{
  "item_id": "3418412000001887044",
  "name": "MAGPPIE CREMA 6mm Slab 3200x1600",
  "sku": "STN-CREMA-6-3200X1600",
  "unit": "Pcs",
  "item_type": "inventory",
  "product_type": "goods",
  "stock_on_hand": 42,
  "available_stock": 38,
  "actual_available_stock": 38,
  "custom_field_hash": {
    "cf_group": "Stone",
    "cf_finish": "MAGPPIE CREMA",
    "cf_thickness": "6",
    "cf_height": "3200",
    "cf_width": "1600",
    "cf_sqft": "55.11",
    "cf_waste_percentage": "15"
  }
}
```

`getSlabArea()` → `3200 × 1600 / 92903.04` = **55.11 ft²**, matching `cf_sqft`.

### Item — service (created by the app)

```json
{
  "name": "Cutting-1",
  "sku": "Cutting-1",
  "rate": 0,
  "purchase_rate": 0,
  "can_be_sold": true,
  "can_be_purchased": true,
  "account_id": "3418412000000000486",
  "purchase_account_id": "3418412000000000567",
  "is_taxable": true,
  "product_type": "service"
}
```

No `inventory_account_id`, no `track_inventory`, no `unit`.

### Item — panel composite (created by the app)

```json
{
  "name": "Panel - Cab Standard Base LH 580x717x18 MAGPPIE CREMA",
  "sku":  "Panel - Cab Standard Base LH 580x717x18 MAGPPIE CREMA",
  "rate": 0,
  "purchase_rate": 0,
  "can_be_sold": true,
  "can_be_purchased": true,
  "account_id": "3418412000000000486",
  "purchase_account_id": "3418412000000000567",
  "inventory_account_id": "3418412000000000626",
  "track_inventory": true,
  "is_taxable": true,
  "unit": "pcs",
  "custom_fields": [
    { "api_name": "cf_group",     "value": "Carcass" },
    { "api_name": "cf_sub_group", "value": "base" },
    { "api_name": "cf_finish",    "value": "MAGPPIE CREMA" },
    { "api_name": "cf_thickness", "value": "18" },
    { "api_name": "cf_height",    "value": "717" },
    { "api_name": "cf_width",     "value": "580" }
  ],
  "mapped_items": [
    { "item_id": "3418412000001887044", "quantity": 0.0868 },
    { "item_id": "3418412000001887100", "quantity": 1 }
  ]
}
```

Quantity check: `sqft(580, 717) = 4.476 ft²` → `× 1.15 = 5.147` → `/ 55.11 = 0.0934`. (The exact figure depends on the slab actually selected; the shape is what matters.)

### Composite — cabinet master (read back from Zoho)

```json
{
  "composite_item_id": "3418412000001890555",
  "item_id": "3418412000001890555",
  "name": "SO-00029 BS-600-2D",
  "sku": "SO-00029 BS-600-2D",
  "unit": "pcs",
  "is_combo_product": true,
  "custom_field_hash": {
    "cf_group": "Carcass",
    "cf_sub_group": "base",
    "cf_finish": "MAGPPIE CREMA",
    "cf_thickness": "18",
    "cf_height": "717",
    "cf_width": "600",
    "cf_depth": "580"
  },
  "mapped_items": [
    { "mapped_item_id": "…01", "item_id": "3418412000001890100",
      "name": "Set of Parts- Cab Standard Base LH(JD)+RH(JD) 580x717x18",
      "quantity": 1, "item_order": 1 },
    { "mapped_item_id": "…02", "item_id": "3418412000001890200",
      "name": "Drawer Pack- Cab Drawer Box H90", "quantity": 2, "item_order": 2 },
    { "mapped_item_id": "…03", "item_id": "3418412000001890300",
      "name": "SO-00029 BS-600-2D-SH1", "quantity": 1, "item_order": 3 }
  ]
}
```

Read `mapped_items` via the 5-alias fallback chain (§1.2), never the bare property.

### Sales Order line — before and after the push

Before (as the sales team entered it — a service line):

```json
{
  "line_item_id": "3418412000001900001",
  "item_id": "3418412000001200777",
  "name": "BS-600-2D",
  "sku": "BS-600-2D",
  "description": "Base unit 600mm 2 drawer",
  "product_type": "service",
  "quantity": 2,
  "rate": 18500,
  "tax_id": "3418412000000075001",
  "tax_percentage": 18,
  "tax_type": "tax",
  "gst_treatment_code": "out_of_scope"
}
```

After (rebuilt by `CarcassBomBuilder.tsx:6846-6852` — the composite replaces it; `quantity` and `rate` carry over):

```json
{
  "item_id": "3418412000001890555",
  "quantity": 2,
  "rate": 18500,
  "description": "Elevation: AA",
  "tax_id": "3418412000000075001",
  "tax_name": "GST18",
  "tax_percentage": 18,
  "tax_type": "tax",
  "gst_treatment_code": "out_of_scope"
}
```

### Contact — vendor (read-only)

```json
{
  "contact_id": "3418412000000123456",
  "contact_name": "Stonex India Pvt Ltd",
  "company_name": "Stonex India Pvt Ltd",
  "contact_type": "vendor",
  "custom_field_hash": {
    "cf_lead_time": "21",
    "cf_transit_time": "5"
  }
}
```

### Reorder report row (computed, `reorder-report/route.ts:183-204`)

```json
{
  "item_id": "3418412000001887044",
  "name": "MAGPPIE CREMA 6mm Slab 3200x1600",
  "sku": "STN-CREMA-6-3200X1600",
  "unit": "Pcs",
  "stock": 38,
  "reorder_level": 60,
  "msl": 40,
  "shortfall": 22,
  "vendor_id": "3418412000000123456",
  "vendor_name": "Stonex India Pvt Ltd",
  "last_po_number": "PO-00412",
  "last_po_date": "2026-05-30",
  "last_rate": 1250,
  "lead_time": 21,
  "transit_time": 5
}
```

`shortfall = max(0, reorder_level − stock)` (`:198`). `msl`, `lead_time` and `transit_time` all default to `0` when the custom field is blank in Zoho — **a `0` here means "not configured", not "zero days"**, and the report cannot tell the difference.

### `AccessorySubformRow` (localStorage `bom_accessory_subform_rows`)

```json
[
  {
    "id": 1,
    "cabinetIndices": [0, 2],
    "accessories": {
      "skirting":   { "enabled": true,  "size": "600", "elevation": "AA",
                      "actualQty": 2, "straightConnectors": 1, "lConnectors": 0,
                      "driver": "60W" },
      "duplay":     { "enabled": false, "size": "", "elevation": "",
                      "actualQty": null, "straightConnectors": 0, "lConnectors": 0, "driver": "" },
      "lprofile":   { "enabled": false, "size": "", "elevation": "",
                      "actualQty": null, "straightConnectors": 0, "lConnectors": 0, "driver": "" },
      "jhandle":    { "enabled": true,  "size": "", "elevation": "AA",
                      "actualQty": 4, "straightConnectors": 0, "lConnectors": 0, "driver": "" },
      "chandle":    { "enabled": false, "size": "", "elevation": "",
                      "actualQty": null, "straightConnectors": 0, "lConnectors": 0, "driver": "" },
      "grandlight": { "enabled": false, "size": "", "elevation": "",
                      "actualQty": null, "straightConnectors": 0, "lConnectors": 0, "driver": "" }
    }
  }
]
```

All six `AccessoryKey`s are always present (`Record<AccessoryKey, AccessoryEntry>`), gated by `enabled`. `actualQty: null` means "auto-derive"; a number is a manual override.

### `CountertopRow` — type 7 island table

```json
{
  "id": 3,
  "length": "2400",
  "depth": "900",
  "thickness": "30",
  "color": "MAGPPIE ONYX BLACK",
  "ctType": 7,
  "edging": "none",
  "edgingHeight": "600",
  "dropHeight": "705",
  "left": "none",
  "right": "none",
  "island": true,
  "baseLight": true,
  "qty": 1
}
```

`ctGeom(7, 2400, 900, 30, 705)` → `reduce = 0` (type 7 is exempt), so `topL = 2400`, `topD = 930`, `baseL = 2400`, `baseD = 860`; `panels = [{ label: "Island Vertical Panel (double-side)", len: 2340, wid: 705, kind: "dropdown" }]`; `brass = 2`, `brassLen = 900`, `grandLights = 2`, `sideDrops = 2`.
