# Integrations

## Zoho Inventory — primary

The system of record. Every item, composite BOM, sales order, purchase order
and stock figure lives in Zoho.

**Region matters.** Defaults are the **India** datacentre
(`accounts.zoho.in`, `www.zohoapis.in`). A `.com` or `.eu` org will fail
authentication until `ZOHO_ACCOUNTS_BASE_URL` and `ZOHO_INVENTORY_BASE_URL` are
overridden.

### OAuth flow

Refresh-token grant. There is **no interactive OAuth in the app** — no login
redirect, no callback URL, no consent screen at runtime. The refresh token is
obtained once, out of band, and stored as an environment variable.

```
1. Register a Self Client at https://api-console.zoho.in
2. Generate a grant token for the scopes below
3. Exchange it once for a refresh token (refresh tokens do not expire)
4. Put that refresh token in ZOHO_REFRESH_TOKEN
```

At runtime, `src/lib/zoho.ts`:

```
POST {ZOHO_ACCOUNTS_BASE_URL}/oauth/v2/token
  grant_type=refresh_token
  refresh_token, client_id, client_secret
→ access_token (1 hour)
→ cached to the OS temp directory
→ attached upstream with organization_id
```

Access tokens are refreshed automatically on expiry. The cache is a
convenience; deleting it forces one extra exchange.

**Callback URL.** Only needed at registration time for the Self Client. Nothing
in this codebase serves a callback route.

### Required scopes

```
ZohoInventory.items.READ / CREATE / UPDATE
ZohoInventory.compositeitems.READ / CREATE / UPDATE
ZohoInventory.salesorders.READ / UPDATE
ZohoInventory.purchaseorders.READ / CREATE
ZohoInventory.contacts.READ
```

### Custom fields the app depends on

These must exist on the Zoho item master or resolution degrades silently.

| Field | Used for |
|---|---|
| `cf_group` | Board detection via `BOARD_GROUP_TOKENS` |
| `cf_finish` | Grouping and matching |
| `cf_thickness` | Grouping and matching |
| `cf_type` | Board option A/B/C |
| `cf_height`, `cf_width`, `cf_depth` | BOM row dimensions |
| `cf_waste_percentage` | Per-item override |

**The board tokens are unverified.** `BOARD_GROUP_TOKENS` in
`src/lib/rawmaterial.ts` is currently `["board","ply","plywood","mdf",
"particle"]`, a guess at Magppie's taxonomy. Check it against real `cf_group`
values before trusting any resolution. On no match there is no error — just an
empty raw-material section.

### Failure modes

| Symptom | Cause |
|---|---|
| 401 from every route | Bad or revoked refresh token, or wrong region |
| 500 mentioning a missing env var | One of the four required vars unset |
| Empty raw-material section | `BOARD_GROUP_TOKENS` matched nothing |
| Composite traversal hangs | Circular composite in Zoho — there is no cycle guard |

Probe with `GET /api/zoho/status` first.

## OpenAI — optional

Backs `AiCopilot.tsx` through `POST /api/ai/chat`. Requires `OPENAI_API_KEY`.
Without it the copilot is inert; nothing else is affected.

## Client-side libraries

| Library | Version | Use |
|---|---|---|
| `xlsx-js-style` | ^1.2.0 | Excel export with row colouring |
| `xlsx` | 0.18.5 | Sheet primitives |
| `jspdf` | ^4.2.1 | Packing slips |
| `jsbarcode` | ^3.12.3 | Barcodes |
| `qrcode` | ^1.5.4 | QR codes for `/qr/bom/[orderId]` |

## No other integrations

No webhooks. No inbound callbacks. No payment gateway, email service, SMS,
analytics or error tracking. Adding error tracking is a backlog item.
