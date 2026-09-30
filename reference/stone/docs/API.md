# Magppie Carcass BOM Builder — API Reference

All server routes live under `src/app/api/**` and are Next.js 16 App Router **Route Handlers**. Every Zoho route is a thin proxy over **Zoho Inventory v1** using the shared helpers in `src/lib/zoho.ts`. There is **no middleware** (`middleware.ts` does not exist) and **no server-side authentication** on any route.

Base URL in development: `http://localhost:3000`

---

## Table of Contents

- [1. Conventions](#1-conventions)
  - [1.1 Auth model (important)](#11-auth-model-important)
  - [1.2 Headers](#12-headers)
  - [1.3 Error envelope](#13-error-envelope)
  - [1.4 `dynamic = "force-dynamic"`](#14-dynamic--force-dynamic)
- [2. Shared Zoho helpers — `src/lib/zoho.ts`](#2-shared-zoho-helpers--srclibzohots)
  - [2.1 Environment variables](#21-environment-variables)
  - [2.2 `getZohoAccessToken()`](#22-getzohoaccesstoken)
  - [2.3 Token cache + 5-minute refresh cooldown](#23-token-cache--5-minute-refresh-cooldown)
  - [2.4 `zohoInventoryGet` / `zohoInventoryPut` / `zohoInventoryPost`](#24-zohoinventoryget--zohoinventoryput--zohoinventorypost)
  - [2.5 The 401 / code-57 / code-14 single-retry rule](#25-the-401--code-57--code-14-single-retry-rule)
  - [2.6 `getZohoRuntimeInfo()`](#26-getzohoruntimeinfo)
  - [2.7 `toApiError()`](#27-toapierror)
- [3. Route index](#3-route-index)
- [4. `GET /api/zoho/status`](#4-get-apizohostatus)
- [5. `/api/zoho/items`](#5-apizohoitems)
  - [5.1 `GET /api/zoho/items`](#51-get-apizohoitems)
  - [5.2 `POST /api/zoho/items`](#52-post-apizohoitems)
- [6. `/api/zoho/items/[id]`](#6-apizohoitemsid)
  - [6.1 `GET /api/zoho/items/[id]`](#61-get-apizohoitemsid)
  - [6.2 `PUT /api/zoho/items/[id]`](#62-put-apizohoitemsid)
- [7. `GET /api/zoho/items/[id]/vendors`](#7-get-apizohoitemsidvendors)
- [8. `POST /api/zoho/compositeitems`](#8-post-apizohocompositeitems)
- [9. `/api/zoho/compositeitems/[id]`](#9-apizohocompositeitemsid)
  - [9.1 `GET /api/zoho/compositeitems/[id]`](#91-get-apizohocompositeitemsid)
  - [9.2 `PUT /api/zoho/compositeitems/[id]`](#92-put-apizohocompositeitemsid)
- [10. `GET /api/zoho/salesorders`](#10-get-apizohosalesorders)
- [11. `/api/zoho/salesorders/[id]`](#11-apizohosalesordersid)
  - [11.1 `GET /api/zoho/salesorders/[id]`](#111-get-apizohosalesordersid)
  - [11.2 `PUT /api/zoho/salesorders/[id]`](#112-put-apizohosalesordersid)
- [12. `GET /api/zoho/contacts`](#12-get-apizohocontacts)
- [13. `GET /api/zoho/contacts/[id]`](#13-get-apizohocontactsid)
- [14. `/api/zoho/purchaseorders`](#14-apizohopurchaseorders)
  - [14.1 `GET /api/zoho/purchaseorders`](#141-get-apizohopurchaseorders)
  - [14.2 `POST /api/zoho/purchaseorders`](#142-post-apizohopurchaseorders)
- [15. `GET /api/zoho/po-vendor-map`](#15-get-apizohopo-vendor-map)
- [16. `GET /api/zoho/reorder-report`](#16-get-apizohoreorder-report)
- [17. `POST /api/ai/chat`](#17-post-apiaichat)
- [18. Upstream Zoho endpoint map](#18-upstream-zoho-endpoint-map)
- [19. Client call sites](#19-client-call-sites)
- [20. Known gaps and security issues](#20-known-gaps-and-security-issues)

---

## 1. Conventions

### 1.1 Auth model (important)

**Every route under `src/app/api/**` is unauthenticated and publicly reachable.** There is no session cookie check, no bearer token, no middleware, and no per-route guard. Anyone who can reach the deployment can read and mutate the connected Zoho Inventory organization and burn OpenAI credit.

The only auth in the product is **client-side cosmetic gating** in `src/components/AuthGate.tsx`:

- `src/components/AuthGate.tsx:27` compares the typed password against a **hard-coded string literal** (the constant is the inline comparison `if (password === "Factory@1234")` — the value ships in the client bundle).
- On success it writes `localStorage.setItem("app_authenticated", ...)`; the gate re-reads `localStorage.getItem("app_authenticated")` at `src/components/AuthGate.tsx:12`.

**Security issue — must be fixed by whoever continues this work:** the password is in client JavaScript (trivially readable via View Source / devtools), the `localStorage` flag is user-settable, and — decisively — the gate protects only the UI. Direct `curl` against `/api/zoho/*` bypasses it entirely. A real fix needs server-side auth (e.g. a signed cookie validated in `middleware.ts` matching `/api/:path*`) plus moving the secret to an env var.

Zoho credentials themselves never reach the browser: the OAuth refresh happens server-side in `src/lib/zoho.ts` and only the proxied response body is returned.

### 1.2 Headers

**Request headers**

| Header | When required | Value |
| --- | --- | --- |
| `Content-Type` | On every `POST` / `PUT` | `application/json` — the handlers call `request.json()` and a non-JSON body throws, surfacing as a `500`. |
| `Authorization` | Never | Routes accept no credentials. |

**Response headers** — all handlers return via `NextResponse.json(...)`, so `Content-Type: application/json` is always set. No CORS headers are added, so the API is same-origin-only from a browser (but not from `curl`/server-side callers).

### 1.3 Error envelope

Every Zoho route wraps its body in `try/catch` and returns `toApiError(error)` with **HTTP 500**:

```json
{ "error": "human readable message" }
```

or, for a non-`Error` throw:

```json
{ "error": "Unknown server error", "detail": { } }
```

This shape is typed as `ApiErrorBody` in `src/lib/types.ts:149-152`.

Notable consequence: **upstream Zoho HTTP status codes are not propagated.** A Zoho 400/401/429 all collapse into a local `500` whose `error` string contains the stringified Zoho JSON body (because `zohoInventoryRequest` throws `new Error(JSON.stringify(body))` at `src/lib/zoho.ts:221`). The only non-500 error status any route emits is the hand-written **404** on the four "not found" paths.

### 1.4 `dynamic = "force-dynamic"`

Every Zoho route exports `export const dynamic = "force-dynamic";` (e.g. `src/app/api/zoho/status/route.ts:4`), disabling Next.js route caching so every request hits Zoho live. `src/app/api/ai/chat/route.ts` does **not** export it (it is a `POST`-only route, so it is dynamic anyway).

---

## 2. Shared Zoho helpers — `src/lib/zoho.ts`

242 lines. Exports: `getZohoAccessToken`, `getZohoRuntimeInfo`, `zohoInventoryGet`, `zohoInventoryPut`, `zohoInventoryPost`, `toApiError`.

### 2.1 Environment variables

Required, enumerated in `REQUIRED_ENV` at `src/lib/zoho.ts:5-10`. Each is read through `getEnv()` (`src/lib/zoho.ts:31-37`), which throws `` `Missing ${name}. Add it to .env.local.` `` when absent or empty.

| Variable | Required | Default | What it must contain |
| --- | --- | --- | --- |
| `ZOHO_ORGANIZATION_ID` | Yes | — | The numeric Zoho Inventory organization id (e.g. `60000000000`). Appended as `organization_id` to **every** upstream URL by `buildUrl()` (`src/lib/zoho.ts:158`). |
| `ZOHO_REFRESH_TOKEN` | Yes | — | Long-lived OAuth refresh token issued by Zoho Accounts for a self-client/server app with `ZohoInventory.*.ALL` scopes. **Placeholder — never commit the real value.** |
| `ZOHO_CLIENT_ID` | Yes | — | OAuth client id from the Zoho API console (`1000.XXXXXXXX`). **Placeholder.** |
| `ZOHO_CLIENT_SECRET` | Yes | — | OAuth client secret paired with the client id. **Placeholder.** |
| `ZOHO_ACCOUNTS_BASE_URL` | No | `https://accounts.zoho.in` (`src/lib/zoho.ts:40`) | Zoho Accounts DC host. Change per data centre (`.com`, `.eu`, `.au`). |
| `ZOHO_INVENTORY_BASE_URL` | No | `https://www.zohoapis.in/inventory/v1` (`src/lib/zoho.ts:44`) | Zoho Inventory API root **including** `/inventory/v1`. Must stay in the same DC as the accounts URL. |
| `OPENAI_API_KEY` | Only for `/api/ai/chat` | — | OpenAI secret key (`sk-...`). Read at `src/app/api/ai/chat/route.ts:7`. **Placeholder.** |

Put all of these in `.env.local` (dev) or the platform env store (Vercel). None are `NEXT_PUBLIC_*`; none may become `NEXT_PUBLIC_*`.

### 2.2 `getZohoAccessToken()`

```ts
export async function getZohoAccessToken(): Promise<string>
```
`src/lib/zoho.ts:123-142`. Resolution order:

1. `readTokenCache()` — returns the module-level `cachedToken` if set, otherwise parses the JSON cache file, otherwise `null` (`src/lib/zoho.ts:51-61`).
2. If `hasUsableToken(cache)` → return `cache.token` immediately.
3. If `cache.refreshBlockedUntil > Date.now()` → **throw** `` `Zoho token refresh is cooling down. Try again in about ${waitSeconds} seconds.` `` (`src/lib/zoho.ts:130-133`).
4. Otherwise dedupe through the module-level `refreshPromise` (`src/lib/zoho.ts:135-141`) so concurrent callers on the same instance trigger **one** refresh; the promise is nulled in `.finally()`.

`refreshZohoAccessToken()` (`src/lib/zoho.ts:88-121`) does:

```
POST {ZOHO_ACCOUNTS_BASE_URL}/oauth/v2/token
  ?refresh_token=…&client_id=…&client_secret=…&grant_type=refresh_token
  (cache: "no-store", no body — all params in the query string)
```

On success it caches `{ token: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 - 30_000 }` — i.e. **30 s of hard safety margin** subtracted from Zoho's stated expiry. On failure it throws `` `Zoho token refresh failed: ${JSON.stringify(body)}` ``.

### 2.3 Token cache + 5-minute refresh cooldown

**Cache shape** (`TokenCache`, `src/lib/zoho.ts:14-19`):

```ts
type TokenCache = {
  token: string;
  expiresAt: number;            // epoch ms, already minus 30_000
  refreshBlockedUntil?: number; // epoch ms; set only on rate-limit
  lastError?: string;           // stringified Zoho rate-limit body
};
```

**Two layers:**

1. **In-memory** — `let cachedToken: TokenCache | null` (`src/lib/zoho.ts:28`). Survives across requests on a warm Node/Lambda instance; dies on cold start.
2. **On-disk** — `TOKEN_CACHE_PATH = path.join(os.tmpdir(), "magppie-cache", "zoho-access-token.json")` (`src/lib/zoho.ts:24`). The OS temp dir is used deliberately because `process.cwd()` is read-only on Vercel/Lambda. Both `writeTokenCache` (`:63-72`) and `clearTokenCache` (`:74-81`) swallow all filesystem errors — disk persistence is **best-effort**; the in-memory copy alone keeps a warm instance working.

**Constants** (`src/lib/zoho.ts:25-26`):

| Constant | Value | Meaning |
| --- | --- | --- |
| `TOKEN_REFRESH_SKEW_MS` | `5 * 60 * 1000` (5 min) | A cached token is only "usable" if `expiresAt > Date.now() + 5 min` (`hasUsableToken`, `:47-49`). So the token is proactively refreshed 5 minutes before it would expire — never used inside its final 5-minute window. |
| `TOKEN_BACKOFF_MS` | `5 * 60 * 1000` (5 min) | The refresh **cooldown**. |

**The 5-minute refresh cooldown behaviour.** `isTokenRateLimit(body)` (`src/lib/zoho.ts:83-86`) lowercases `JSON.stringify(body)` and returns true if it contains `"too many requests"` **or** `"access denied"`. When a refresh fails *and* `isTokenRateLimit` matches, the cache is overwritten with:

```ts
{ token: "", expiresAt: 0, refreshBlockedUntil: Date.now() + TOKEN_BACKOFF_MS, lastError: JSON.stringify(body) }
```
(`src/lib/zoho.ts:104-109`). For the next **5 minutes** every `getZohoAccessToken()` call short-circuits at step 3 and throws the `"cooling down"` message — no HTTP request is made to Zoho Accounts. This is the app's protection against Zoho's aggressive per-refresh-token rate limiter, which locks the token out for far longer if you keep hammering it.

Note the trade-off: the backoff write **clobbers any still-valid token** (sets `token: ""`, `expiresAt: 0`), so a rate-limit while a good token was cached costs 5 minutes of total outage rather than continuing to serve the good token. That is a known wart, not a deliberate design.

**Operator note:** to force a fresh token during development, delete `$TMPDIR/magppie-cache/zoho-access-token.json` and restart the dev server (restart is required to clear the in-memory `cachedToken`).

### 2.4 `zohoInventoryGet` / `zohoInventoryPut` / `zohoInventoryPost`

```ts
export async function zohoInventoryGet<T>(path: string, params?: Record<string, string|number|undefined>): Promise<T>
export async function zohoInventoryPut<T>(path: string, payload: unknown, params?: Record<string, string|number|undefined>): Promise<T>
export async function zohoInventoryPost<T>(path: string, payload: unknown, params?: Record<string, string|number|undefined>): Promise<T>
```
`src/lib/zoho.ts:167-188`. All three delegate to the private `zohoInventoryRequest<T>(method, path, params, payload?)` (`:190-225`).

- **URL building** — `buildUrl(path, params)` (`:156-165`) produces `` `${getInventoryBaseUrl()}${path}` ``, always sets `organization_id`, then sets each param **skipping `undefined` and `""`** (so `status: status || undefined` idioms in the routes correctly omit the param).
- **Headers sent upstream** — `Authorization: Zoho-oauthtoken <token>`, plus `Content-Type: application/json` **only when a payload is present** (`:202-205`). `cache: "no-store"` on every fetch.
- **Body** — `JSON.stringify(payload)` when payload is defined; note Zoho Inventory also accepts the legacy `JSONString=` form-encoded style, which this codebase does **not** use.
- **Success test** (`:220-222`): throws unless `response.ok` **and** not (`typeof body.code === "number" && body.code > 0`). Zoho signals success with `code: 0`, so any positive `code` — even inside an HTTP 200 — is treated as an error. The thrown message is the raw `JSON.stringify(body)`.
- `path` is caller-supplied and route handlers `encodeURIComponent()` the id segment before interpolation.

### 2.5 The 401 / code-57 / code-14 single-retry rule

`src/lib/zoho.ts:213-218`:

```ts
if ((response.status === 401 || body.code === 57 || body.code === 14) && accessToken) {
  await clearTokenCache();
  accessToken = await getZohoAccessToken();
  response = await doFetch(accessToken);
  body = await response.json();
}
```

Semantics:

- **Trigger** — HTTP `401`, **or** Zoho error `code: 14` (*"Invalid value passed for authtoken"*), **or** Zoho error `code: 57` (*"You are not authorized to perform this operation"* / stale-token variant). These are the three ways Zoho reports a dead access token, including inside an HTTP 200 body.
- **Action** — wipe both cache layers via `clearTokenCache()`, force a brand-new token, replay the *identical* request (same method, URL, payload).
- **Exactly once.** This is straight-line code, not a loop: if the retry also 401s, the result falls through to the `!response.ok` check and throws. There is no exponential backoff and no second attempt.
- **Guard** — `&& accessToken` prevents retrying when no token was obtained in the first place.
- **Interaction with the cooldown**: if the forced `getZohoAccessToken()` inside the retry hits the rate limiter, it throws the `"cooling down"` error out of `zohoInventoryRequest`, and `toApiError` passes that message through untouched (`src/lib/zoho.ts:230-232`).

### 2.6 `getZohoRuntimeInfo()`

```ts
export function getZohoRuntimeInfo(): {
  organizationId: string;
  accountsBaseUrl: string;
  inventoryBaseUrl: string;
  tokenCached: boolean;
  tokenExpiresAt?: number;
  refreshBlockedUntil?: number;
}
```
`src/lib/zoho.ts:144-154`. **Synchronous** — it reads the module-level `cachedToken` only and never touches disk, so `tokenCached` is `false` on a cold instance even when a valid on-disk cache exists. It calls `getEnv("ZOHO_ORGANIZATION_ID")`, so it **throws** if that env var is missing. Consumed by `/api/zoho/status` and by `buildPoWebUrl()` in `/api/zoho/purchaseorders`. Never expose `tokenExpiresAt`/`refreshBlockedUntil` beyond internal diagnostics — the status route deliberately returns only `tokenCached`.

### 2.7 `toApiError()`

```ts
export function toApiError(error: unknown): { error: string; detail?: unknown }
```
`src/lib/zoho.ts:227-242`. Always `console.error('[Zoho API Error]:', error)` first (grep server logs for `[Zoho API Error]`). Then, in order:

1. `error.message.includes("cooling down")` → pass the message through verbatim.
2. `error.message.toLowerCase().includes("too many requests")` → replace with the fixed operator-friendly string: *"Zoho is temporarily blocking token refresh because too many refresh requests were made. The app will reuse cached tokens and wait before trying again."*
3. Any other `Error` → `{ error: error.message }` (this is where stringified Zoho JSON leaks into the client-visible message).
4. Non-`Error` throw → `{ error: "Unknown server error", detail: error }`.

---

## 3. Route index

| Route | Methods | Upstream | Purpose |
| --- | --- | --- | --- |
| `/api/zoho/status` | GET | `/organizations` | Connectivity + org name probe |
| `/api/zoho/items` | GET, POST | `/items` | Search items; create item |
| `/api/zoho/items/[id]` | GET, PUT | `/items/{id}` | Read/update one item |
| `/api/zoho/items/[id]/vendors` | GET | `/purchaseorders`, `/purchaseorders/{id}`, `/items/{id}` | Vendor options for one item |
| `/api/zoho/compositeitems` | POST | `/compositeitems` | Create composite (BOM) item |
| `/api/zoho/compositeitems/[id]` | GET, PUT | `/compositeitems/{id}` | Read/update composite item |
| `/api/zoho/salesorders` | GET | `/salesorders` | Search sales orders |
| `/api/zoho/salesorders/[id]` | GET, PUT | `/salesorders/{id}` | Read/update one SO |
| `/api/zoho/contacts` | GET | `/contacts` | List/search vendors or customers |
| `/api/zoho/contacts/[id]` | GET | `/contacts/{id}` | Vendor lead/transit time |
| `/api/zoho/purchaseorders` | GET, POST | `/purchaseorders` | List POs; create draft PO |
| `/api/zoho/po-vendor-map` | GET | `/purchaseorders`, `/purchaseorders/{id}` | Bulk itemId → vendor history |
| `/api/zoho/reorder-report` | GET | `/items`, `/items/{id}`, `/purchaseorders`, `/purchaseorders/{id}`, `/contacts/{id}` | Full below-reorder-level report |
| `/api/ai/chat` | POST | OpenAI `chat/completions` | BOM Copilot chat |

---

## 4. `GET /api/zoho/status`

**File:** `src/app/api/zoho/status/route.ts`

**Purpose:** Health probe. Confirms env vars are present, the refresh token still mints access tokens, and the configured `ZOHO_ORGANIZATION_ID` actually appears in the account's org list. This is the first thing to call when the app "can't see Zoho".

**Auth:** none. **Query params:** none. **Request body:** none.

**Behaviour:** calls `getZohoRuntimeInfo()`, then `zohoInventoryGet<OrganizationsResponse>("/organizations")`, then finds the org whose `organization_id === runtime.organizationId` (`:18`). The org name falls back `organization?.name ?? organization?.organization_name ?? "Zoho Inventory"` (`:23`).

**Success — 200**

```json
{
  "ok": true,
  "organizationId": "60000000000",
  "organizationName": "Magppie Interior Products Pvt Ltd",
  "inventoryBaseUrl": "https://www.zohoapis.in/inventory/v1",
  "tokenCached": true,
  "checkedAt": "2026-07-17T06:12:44.108Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | `boolean` | `true` only on the success path. |
| `organizationId` | `string` | Echo of `ZOHO_ORGANIZATION_ID`. |
| `organizationName` | `string` | `"Zoho Inventory"` literal means the configured org id was **not** found in the returned list — a real misconfiguration signal even though `ok` is `true`. |
| `inventoryBaseUrl` | `string` | Effective base URL (env or default). |
| `tokenCached` | `boolean` | In-memory-cache-only; `false` on a cold instance. |
| `checkedAt` | `string` | ISO-8601 timestamp. |

**Errors — 500** (the only failure status). Uniquely, this route merges `ok: false` and `checkedAt` into the error body (`:29`):

```json
{ "ok": false, "error": "Missing ZOHO_REFRESH_TOKEN. Add it to .env.local.", "checkedAt": "2026-07-17T06:12:44.108Z" }
```

Other realistic `error` values: `"Zoho token refresh is cooling down. Try again in about 214 seconds."`, `"Zoho token refresh failed: {\"error\":\"invalid_code\"}"`, or the fixed too-many-requests sentence.

**curl**

```bash
curl -s http://localhost:3000/api/zoho/status
# {"ok":true,"organizationId":"60000000000","organizationName":"Magppie Interior Products Pvt Ltd","inventoryBaseUrl":"https://www.zohoapis.in/inventory/v1","tokenCached":true,"checkedAt":"2026-07-17T06:12:44.108Z"}
```

---

## 5. `/api/zoho/items`

**File:** `src/app/api/zoho/items/route.ts`

### 5.1 `GET /api/zoho/items`

**Purpose:** Item lookup. The BOM builder uses this constantly to resolve a generated panel/hardware name to an existing Zoho item id before deciding whether to create it.

**Query params**

| Param | Type | Default | Maps to upstream | Notes |
| --- | --- | --- | --- | --- |
| `search` | string | `""` | `search_text` | Zoho fuzzy search across name/SKU/description. |
| `name` | string | `""` | `name_contains` | Substring match on item name only — use this for exact-ish name resolution. |

Both may be supplied together (both are forwarded). If neither is supplied, `per_page: 200` is still sent and Zoho returns the first 200 items in the org. `per_page: 200` is **hard-coded** at `:18` and is not overridable — there is **no pagination** on this route; results beyond 200 are silently dropped.

**Validation:** none. Empty strings are dropped by `buildUrl`.

**Success — 200**

```json
{
  "items": [
    {
      "item_id": "460000000123456",
      "name": "Panel-18mm-BWP-720x560",
      "sku": "PNL-18-BWP-720560",
      "unit": "nos",
      "actual_available_stock": 12,
      "stock_on_hand": 14,
      "group_name": "Carcass Panels",
      "cf_group": "Carcass",
      "cf_thickness": "18",
      "cf_height": "720",
      "cf_width": "560",
      "cf_finish": "BWP",
      "custom_field_hash": { "cf_waste_percentage": "17" }
    }
  ]
}
```

`items` is `ItemDetail[]` (`src/lib/types.ts:53-80`) and is **always an array** — `body.items ?? []` (`:25`). An empty array means "no match", not an error.

**Errors:** `500` with `{ "error": "..." }` only.

**curl**

```bash
curl -s "http://localhost:3000/api/zoho/items?name=Panel-18mm-BWP-720x560"
# {"items":[{"item_id":"460000000123456","name":"Panel-18mm-BWP-720x560","sku":"PNL-18-BWP-720560","unit":"nos","actual_available_stock":12}]}
```

### 5.2 `POST /api/zoho/items`

**Purpose:** Create a plain (non-composite) Zoho Inventory item — used when the builder generates a panel/edge-band/hardware line that does not yet exist.

**Headers:** `Content-Type: application/json`.

**Request body:** **passed through verbatim** to Zoho (`:33-34`). The route does **no validation, no whitelisting, no defaulting** — whatever you send is what Zoho receives. Zoho's own required fields apply (at minimum `name`; `item_type`/`product_type`/`unit`/`rate` in practice).

```json
{
  "name": "Panel-18mm-BWP-720x560",
  "sku": "PNL-18-BWP-720560",
  "unit": "nos",
  "item_type": "inventory",
  "product_type": "goods",
  "rate": 0,
  "purchase_rate": 0,
  "custom_fields": [
    { "api_name": "cf_group", "value": "Carcass" },
    { "api_name": "cf_thickness", "value": "18" }
  ]
}
```

**Success — 200**

```json
{ "item": { "item_id": "460000000123456", "name": "Panel-18mm-BWP-720x560", "sku": "PNL-18-BWP-720560", "unit": "nos" } }
```

Note the response key is `item` (singular), mirroring Zoho.

**Errors**

| Status | Body | When |
| --- | --- | --- |
| `500` | `{ "error": "Creation failed" }` or `{ "error": "<Zoho message>" }` | Zoho returned 200 but no `item` object (`:36-38`) — `body.message ?? "Creation failed"`. |
| `500` | `{ "error": "{\"code\":1001,\"message\":\"Item with the name already exists.\"}" }` | Zoho threw (non-2xx or `code > 0`); the raw Zoho JSON is stringified into `error`. |

**curl**

```bash
curl -s -X POST http://localhost:3000/api/zoho/items \
  -H 'Content-Type: application/json' \
  -d '{"name":"Panel-18mm-BWP-720x560","sku":"PNL-18-BWP-720560","unit":"nos","item_type":"inventory","product_type":"goods","rate":0}'
# {"item":{"item_id":"460000000123456","name":"Panel-18mm-BWP-720x560","sku":"PNL-18-BWP-720560","unit":"nos"}}
```

---

## 6. `/api/zoho/items/[id]`

**File:** `src/app/api/zoho/items/[id]/route.ts`

`[id]` is the Zoho `item_id` (numeric string). Next.js 16 passes `context.params` as a **Promise** — `const { id } = await context.params;` (`:13`, `:28`). The id is `encodeURIComponent()`-ed before URL interpolation.

### 6.1 `GET /api/zoho/items/[id]`

**Purpose:** Fetch full item detail (custom fields, stock, group) for BOM stock resolution.

**Query params / body:** none.

**Success — 200** — `{ "item": ItemDetail }`

```json
{
  "item": {
    "item_id": "460000000123456",
    "name": "Panel-18mm-BWP-720x560",
    "sku": "PNL-18-BWP-720560",
    "unit": "nos",
    "actual_available_stock": 12,
    "available_stock": 12,
    "stock_on_hand": 14,
    "reorder_level": 5,
    "group_name": "Carcass Panels",
    "cf_group": "Carcass",
    "cf_sub_group": "Side Panel",
    "cf_waste_percentage": "17",
    "custom_field_hash": { "cf_msl": "10" },
    "custom_fields": [{ "api_name": "cf_msl", "label": "MSL", "value": "10" }]
  }
}
```

**Errors**

| Status | Body | When |
| --- | --- | --- |
| `404` | `{ "error": "Item not found" }` | Zoho responded successfully but with no `item` key (`:16-18`). |
| `500` | `{ "error": "..." }` | Any throw — including a Zoho "not found" that arrives as `code: 1001` (which throws in the helper and therefore returns **500, not 404**). |

**curl**

```bash
curl -s http://localhost:3000/api/zoho/items/460000000123456
# {"item":{"item_id":"460000000123456","name":"Panel-18mm-BWP-720x560","actual_available_stock":12,"unit":"nos"}}
```

### 6.2 `PUT /api/zoho/items/[id]`

**Purpose:** Update an existing item (rename, re-SKU, edit custom fields such as `cf_waste_percentage`).

**Request body:** verbatim pass-through to Zoho, no validation (`:29-33`). Zoho PUT on `/items/{id}` is a partial update — send only the fields you intend to change.

```json
{ "name": "Panel-18mm-BWP-720x560", "custom_fields": [{ "api_name": "cf_waste_percentage", "value": "17" }] }
```

**Success — 200** — `{ "item": ItemDetail }` (the updated item).

**Errors**

| Status | Body | When |
| --- | --- | --- |
| `500` | `{ "error": "Update failed" }` or `{ "error": "<Zoho message>" }` | 200 from Zoho but no `item` (`:35-37`). |
| `500` | `{ "error": "<stringified Zoho error>" }` | Helper threw. |

There is **no 404** on the PUT path.

**curl**

```bash
curl -s -X PUT http://localhost:3000/api/zoho/items/460000000123456 \
  -H 'Content-Type: application/json' \
  -d '{"name":"Panel-18mm-BWP-720x560-REV2"}'
# {"item":{"item_id":"460000000123456","name":"Panel-18mm-BWP-720x560-REV2"}}
```

---

## 7. `GET /api/zoho/items/[id]/vendors`

**File:** `src/app/api/zoho/items/[id]/vendors/route.ts`

**Purpose:** Return the plausible vendors for a single item — recent purchase history first, then the item's default vendor — with the last rate paid, so a draft PO can be pre-filled.

> **Note for the next developer:** no client code currently calls this route (the UI uses the bulk `/api/zoho/po-vendor-map` instead). It works and is exercised only by direct calls. `VendorOption` is exported from this file (`:25-32`).

**Query params / body:** none. `[id]` = `item_id`.

**Algorithm**

1. In parallel (`Promise.all`, `:38-48`):
   - `GET /purchaseorders?item_id={id}&per_page=25&sort_column=date&sort_order=D` — `.catch(() => ({ purchaseorders: [] }))`, so PO-list failure degrades silently.
   - `GET /items/{id}` — `.catch(() => ({ item: undefined }))`.
2. Take the **top 5** most-recent POs (`topPos = lines.slice(0, 5)`, `:54`) and hydrate each with `GET /purchaseorders/{poId}` in parallel; each individually `.catch`es to `undefined`.
3. For each, find the line item where `li.item_id === id` and read its `rate` (`:66-67`).
4. De-duplicate by `vendor_id` via a `Map` — **first (most recent) wins**, later POs from the same vendor are skipped (`:68`). `source: "history"`.
5. Append the item's own `vendor_id` if not already in the map, with `vendor_name` defaulting to `"(unnamed vendor)"` and `source: "item_default"` (`:82-88`). This entry carries **no** `last_po_*` or `last_rate`.
6. `preferred_vendor_id` = `vendors[0]?.vendor_id ?? ""` — i.e. the vendor on the most recent PO, or the item default if there is no history, or `""`.

**Cost:** up to **7** upstream Zoho calls per request (1 PO list + 1 item + 5 PO details).

**Success — 200**

```json
{
  "vendors": [
    {
      "vendor_id": "460000000098765",
      "vendor_name": "Greenply Distributors",
      "last_po_number": "PO-00412",
      "last_po_date": "2026-06-28",
      "last_rate": 1850.5,
      "source": "history"
    },
    { "vendor_id": "460000000011122", "vendor_name": "Century Ply Depot", "source": "item_default" }
  ],
  "preferred_vendor_id": "460000000098765"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `vendors[].vendor_id` | `string` | Zoho contact id. |
| `vendors[].vendor_name` | `string` | `"(unnamed vendor)"` when the item default vendor has no name. |
| `vendors[].last_po_number` | `string?` | Absent for `item_default`. |
| `vendors[].last_po_date` | `string?` | `YYYY-MM-DD`. |
| `vendors[].last_rate` | `number?` | Only when the matching PO line carried a numeric `rate`. |
| `vendors[].source` | `"history" \| "item_default"` | — |
| `preferred_vendor_id` | `string` | `""` when `vendors` is empty. |

**Errors:** `500` only — and only if something outside the `.catch`ed calls throws (e.g. token cooldown). Because of the per-call `.catch`es, a valid item with no PO history and no default vendor returns `200 {"vendors":[],"preferred_vendor_id":""}`, and so does a **non-existent** item id.

**curl**

```bash
curl -s http://localhost:3000/api/zoho/items/460000000123456/vendors
# {"vendors":[{"vendor_id":"460000000098765","vendor_name":"Greenply Distributors","last_po_number":"PO-00412","last_po_date":"2026-06-28","last_rate":1850.5,"source":"history"}],"preferred_vendor_id":"460000000098765"}
```

---

## 8. `POST /api/zoho/compositeitems`

**File:** `src/app/api/zoho/compositeitems/route.ts`

**Purpose:** Create a Zoho **composite item** (Zoho's name for a BOM / bundle). This is the write-side endpoint the Carcass BOM Builder ultimately calls to persist a generated carcass BOM. **This route has no `GET`** — to read a composite you must know its id and use `/api/zoho/compositeitems/[id]`, or find it through `/api/zoho/items?name=...`.

**Headers:** `Content-Type: application/json`.

**Request body:** verbatim pass-through, no validation (`:14-16`). Zoho expects `name`, `unit`, and `mapped_items` (each `{ item_id, quantity }`).

```json
{
  "name": "BC-600-720-560-MD1",
  "sku": "BC-600-720-560-MD1",
  "unit": "nos",
  "product_type": "goods",
  "rate": 0,
  "mapped_items": [
    { "item_id": "460000000123456", "quantity": 2 },
    { "item_id": "460000000123457", "quantity": 1 }
  ]
}
```

**Success — 200** — note the response key is camelCase `compositeItem`, **renamed** from Zoho's `composite_item` (`:22`):

```json
{
  "compositeItem": {
    "item_id": "460000000200001",
    "name": "BC-600-720-560-MD1",
    "sku": "BC-600-720-560-MD1",
    "unit": "nos",
    "mapped_items": [
      { "mapped_item_id": "460000000200011", "item_id": "460000000123456", "name": "Panel-18mm-BWP-720x560", "quantity": 2, "unit": "nos" }
    ]
  }
}
```

Typed `CompositeItemDetail` (`src/lib/types.ts:104-110`) — extends `ItemDetail` and tolerates Zoho returning the component list under any of `mapped_items`, `composite_item_line_items`, `bundle_items`, `line_items`, or `items`. **Do not assume `mapped_items`;** the client normalizes across all five.

**Errors**

| Status | Body | When |
| --- | --- | --- |
| `500` | `{ "error": "Creation failed" }` / `{ "error": "<Zoho message>" }` | 200 but no `composite_item` (`:18-20`). |
| `500` | `{ "error": "{\"code\":1001,\"message\":\"...\"}" }` | Helper threw. |

**curl**

```bash
curl -s -X POST http://localhost:3000/api/zoho/compositeitems \
  -H 'Content-Type: application/json' \
  -d '{"name":"BC-600-720-560-MD1","unit":"nos","mapped_items":[{"item_id":"460000000123456","quantity":2}]}'
# {"compositeItem":{"item_id":"460000000200001","name":"BC-600-720-560-MD1","mapped_items":[{"item_id":"460000000123456","quantity":2}]}}
```

---

## 9. `/api/zoho/compositeitems/[id]`

**File:** `src/app/api/zoho/compositeitems/[id]/route.ts`

`[id]` is the composite item's `item_id` (also referred to as `composite_item_id`).

### 9.1 `GET /api/zoho/compositeitems/[id]`

**Purpose:** Expand one BOM into its component lines — the core read used when exploding a sales-order line into its raw materials.

**Success — 200** — `{ "compositeItem": CompositeItemDetail }`

```json
{
  "compositeItem": {
    "item_id": "460000000200001",
    "name": "BC-600-720-560-MD1",
    "sku": "BC-600-720-560-MD1",
    "unit": "nos",
    "actual_available_stock": 3,
    "mapped_items": [
      {
        "mapped_item_id": "460000000200011",
        "item_id": "460000000123456",
        "name": "Panel-18mm-BWP-720x560",
        "sku": "PNL-18-BWP-720560",
        "quantity": 2,
        "unit": "nos",
        "actual_available_stock": 12,
        "is_combo_product": false
      }
    ]
  }
}
```

Each mapped item is `CompositeMappedItem` (`src/lib/types.ts:82-102`). Recursion note: when a mapped item has `is_combo_product: true` / `composite_item_id`, the client calls this route again on that id to expand a sub-BOM.

**Errors**

| Status | Body | When |
| --- | --- | --- |
| `404` | `{ "error": "Composite item not found" }` | 200 from Zoho with no `composite_item` (`:16-18`). |
| `500` | `{ "error": "..." }` | Helper threw. Passing a **plain** item's id here typically yields a Zoho error → `500`, not `404`. |

**curl**

```bash
curl -s http://localhost:3000/api/zoho/compositeitems/460000000200001
# {"compositeItem":{"item_id":"460000000200001","name":"BC-600-720-560-MD1","mapped_items":[{"item_id":"460000000123456","name":"Panel-18mm-BWP-720x560","quantity":2,"unit":"nos"}]}}
```

### 9.2 `PUT /api/zoho/compositeitems/[id]`

**Purpose:** Update an existing BOM — most importantly to **replace** its `mapped_items` when a carcass is re-generated.

**Request body:** verbatim pass-through. **Zoho replaces the whole `mapped_items` array** — omitting a component deletes it from the BOM. Always send the complete intended component list.

```json
{
  "name": "BC-600-720-560-MD1",
  "unit": "nos",
  "mapped_items": [
    { "item_id": "460000000123456", "quantity": 2 },
    { "item_id": "460000000123458", "quantity": 4 }
  ]
}
```

**Success — 200** — `{ "compositeItem": CompositeItemDetail }`.

**Errors:** `500` `{ "error": "Update failed" }` (or Zoho's `message`) when 200-with-no-`composite_item` (`:35-37`); `500` with stringified Zoho JSON on a throw. **No 404 on PUT.**

**curl**

```bash
curl -s -X PUT http://localhost:3000/api/zoho/compositeitems/460000000200001 \
  -H 'Content-Type: application/json' \
  -d '{"name":"BC-600-720-560-MD1","unit":"nos","mapped_items":[{"item_id":"460000000123456","quantity":2},{"item_id":"460000000123458","quantity":4}]}'
# {"compositeItem":{"item_id":"460000000200001","name":"BC-600-720-560-MD1","mapped_items":[{"item_id":"460000000123456","quantity":2},{"item_id":"460000000123458","quantity":4}]}}
```

---

## 10. `GET /api/zoho/salesorders`

**File:** `src/app/api/zoho/salesorders/route.ts`

**Purpose:** Typeahead search over sales orders — the entry point of the whole dashboard (pick an SO, then explode it into a BOM).

**Query params**

| Param | Type | Default | Maps to | Notes |
| --- | --- | --- | --- | --- |
| `q` | string | `""` | `search_text` | `.trim()`ed (`:13`). |
| `status` | string | `""` | `status` | Zoho SO status filter: `draft`, `open`, `confirmed`, `closed`, `void`, `partially_invoiced`, `invoiced`, `overdue`, `all`. Sent as `status || undefined` (`:22`), so an empty value is omitted entirely. |

`per_page: 50` hard-coded (`:23`). No pagination.

**Validation rule (the one real guard in the codebase):** `if (query.length < 2) return NextResponse.json({ salesorders: [] });` (`:16-18`). A query shorter than 2 characters returns **200 with an empty array and makes no upstream call** — a deliberate typeahead debounce guard. This means a bare `GET /api/zoho/salesorders` yields `{"salesorders":[]}`, **not** a list of all SOs.

**Success — 200**

```json
{
  "salesorders": [
    {
      "salesorder_id": "460000000300001",
      "salesorder_number": "SO-00187",
      "customer_name": "Sobha Dream Acres — Flat 1204",
      "status": "confirmed",
      "date": "2026-07-02",
      "total": 486320.0
    }
  ]
}
```

`salesorders` is `SalesOrderSummary[]` (`src/lib/types.ts:1-8`), always an array (`body.salesorders ?? []`).

**Errors:** `500` `{ "error": "..." }`.

**curl**

```bash
curl -s "http://localhost:3000/api/zoho/salesorders?q=SO-00187&status=confirmed"
# {"salesorders":[{"salesorder_id":"460000000300001","salesorder_number":"SO-00187","customer_name":"Sobha Dream Acres — Flat 1204","status":"confirmed","date":"2026-07-02","total":486320.0}]}

curl -s "http://localhost:3000/api/zoho/salesorders?q=S"
# {"salesorders":[]}        <- length < 2 guard, no Zoho call made
```

---

## 11. `/api/zoho/salesorders/[id]`

**File:** `src/app/api/zoho/salesorders/[id]/route.ts`

`[id]` = `salesorder_id`.

### 11.1 `GET /api/zoho/salesorders/[id]`

**Purpose:** Full SO with `line_items` — the input to the BOM explosion. Each line's `item_id` / `composite_item_id` / `is_combo_product` determines whether the client recurses into `/api/zoho/compositeitems/[id]`.

**Success — 200** — `{ "salesorder": SalesOrderDetail }` (`src/lib/types.ts:42-51`)

```json
{
  "salesorder": {
    "salesorder_id": "460000000300001",
    "salesorder_number": "SO-00187",
    "customer_id": "460000000055555",
    "customer_name": "Sobha Dream Acres — Flat 1204",
    "status": "confirmed",
    "date": "2026-07-02",
    "reference_number": "MAG/2026/187",
    "salesperson_name": "R. Kumar",
    "total": 486320.0,
    "billing_address": { "address": "Flat 1204, Tower 3", "city": "Bengaluru", "zip": "560067" },
    "shipping_address": { "address": "Flat 1204, Tower 3", "city": "Bengaluru", "zip": "560067" },
    "line_items": [
      {
        "line_item_id": "460000000300011",
        "item_id": "460000000200001",
        "composite_item_id": "460000000200001",
        "item_name": "BC-600-720-560-MD1",
        "name": "BC-600-720-560-MD1",
        "sku": "BC-600-720-560-MD1",
        "quantity": 3,
        "rate": 12500,
        "unit": "nos",
        "group_name": "Kitchen — Base",
        "is_combo_product": true,
        "cf_group": "Base",
        "item_total": 37500
      }
    ]
  }
}
```

**Errors**

| Status | Body | When |
| --- | --- | --- |
| `404` | `{ "error": "Sales order not found" }` | 200 from Zoho with no `salesorder` (`:16-18`). |
| `500` | `{ "error": "..." }` | Helper threw. |

**curl**

```bash
curl -s http://localhost:3000/api/zoho/salesorders/460000000300001
# {"salesorder":{"salesorder_id":"460000000300001","salesorder_number":"SO-00187","customer_name":"Sobha Dream Acres — Flat 1204","status":"confirmed","line_items":[{"item_id":"460000000200001","item_name":"BC-600-720-560-MD1","quantity":3,"is_combo_product":true}]}}
```

### 11.2 `PUT /api/zoho/salesorders/[id]`

**Purpose:** Update an SO — e.g. swap a placeholder line for the freshly created composite item, or edit line custom fields.

**Request body:** verbatim pass-through, no validation. As with Zoho generally, sending `line_items` **replaces** the entire line set; include `line_item_id` on existing lines to preserve them.

```json
{
  "line_items": [
    { "line_item_id": "460000000300011", "item_id": "460000000200001", "quantity": 3, "rate": 12500 }
  ]
}
```

**Success — 200** — `{ "salesorder": SalesOrderDetail }`.

**Errors:** `500` `{ "error": "Update failed" }` (or Zoho's `message`) at `:35-37`; `500` with stringified Zoho JSON on throw. **No 404 on PUT.**

**curl**

```bash
curl -s -X PUT http://localhost:3000/api/zoho/salesorders/460000000300001 \
  -H 'Content-Type: application/json' \
  -d '{"line_items":[{"line_item_id":"460000000300011","item_id":"460000000200001","quantity":3,"rate":12500}]}'
# {"salesorder":{"salesorder_id":"460000000300001","salesorder_number":"SO-00187","line_items":[{"line_item_id":"460000000300011","quantity":3,"rate":12500}]}}
```

---

## 12. `GET /api/zoho/contacts`

**File:** `src/app/api/zoho/contacts/route.ts`

**Purpose:** Populate the vendor dropdown in the Draft-PO modal.

**Query params**

| Param | Type | Default | Maps to | Notes |
| --- | --- | --- | --- | --- |
| `contact_type` | string | **`"vendor"`** | `contact_type` | Defaults to `vendor` (`:16`) — pass `customer` explicitly to list customers. |
| `search` | string | `""` | `search_text` | Omitted when empty. |

`per_page: 200` hard-coded (`:21`). No pagination.

**Validation:** none. `contact_type` is not whitelisted — an invalid value is forwarded and Zoho decides.

**Success — 200**

```json
{
  "contacts": [
    { "contact_id": "460000000098765", "contact_name": "Greenply Distributors", "contact_type": "vendor", "company_name": "Greenply Industries Ltd" },
    { "contact_id": "460000000011122", "contact_name": "Century Ply Depot", "contact_type": "vendor", "company_name": "Century Plyboards" }
  ]
}
```

Local `Contact` type at `:6-11`: `{ contact_id: string; contact_name: string; contact_type?: string; company_name?: string }`. Always an array (`body.contacts ?? []`). Zoho returns more fields than these; they pass through untouched.

**Errors:** `500` `{ "error": "..." }`.

**curl**

```bash
curl -s "http://localhost:3000/api/zoho/contacts?contact_type=vendor&search=Greenply"
# {"contacts":[{"contact_id":"460000000098765","contact_name":"Greenply Distributors","contact_type":"vendor","company_name":"Greenply Industries Ltd"}]}
```

---

## 13. `GET /api/zoho/contacts/[id]`

**File:** `src/app/api/zoho/contacts/[id]/route.ts`

**Purpose:** Read a vendor's **lead time** and **transit time** custom fields to compute PO/reorder dates. This route deliberately returns a **narrowed** projection — only `contact_id` and `contact_name` are echoed (`:50`); the rest of the Zoho contact is dropped.

**Query params / body:** none. `[id]` = `contact_id`.

**Custom-field resolution — `readCf(record, ...keys)` (`:15-37`).** Zoho exposes custom fields inconsistently across API versions, so `readCf` probes three places, in order, returning the **first non-null, non-empty** hit as a `string`:

1. `record.custom_field_hash[key]`
2. `record[key]` (top-level, for Zoho's flattened `cf_*` mirrors)
3. `record.custom_fields[]` where `cf.api_name === key` **or** `cf.placeholder === key` **or** `cf.label?.toLowerCase() === key.toLowerCase()` (case-insensitive on label only), then `cf.value ?? cf.value_formatted`.

Returns `""` if nothing matches.

**Field key aliases probed** (`:46-48`) — order matters:

| Output | Keys tried, in order |
| --- | --- |
| `lead_time` | `cf_lead_time`, `cf_leadtime`, `Lead Time`, `lead_time` |
| `transit_time` | `cf_transit_time`, `cf_transittime`, `Transit Time`, `transit_time` |

Both are coerced with `Number(...) || 0` — a missing field, a blank field, **and a non-numeric field all yield `0`**, indistinguishable from a genuine zero. Units are days (per Zoho field convention).

**Success — 200**

```json
{
  "contact": { "contact_id": "460000000098765", "contact_name": "Greenply Distributors" },
  "lead_time": 7,
  "transit_time": 3
}
```

**Errors**

| Status | Body | When |
| --- | --- | --- |
| `404` | `{ "error": "Contact not found" }` | 200 from Zoho with no `contact` (`:43-45`). |
| `500` | `{ "error": "..." }` | Helper threw. |

**curl**

```bash
curl -s http://localhost:3000/api/zoho/contacts/460000000098765
# {"contact":{"contact_id":"460000000098765","contact_name":"Greenply Distributors"},"lead_time":7,"transit_time":3}
```

---

## 14. `/api/zoho/purchaseorders`

**File:** `src/app/api/zoho/purchaseorders/route.ts`

### 14.1 `GET /api/zoho/purchaseorders`

**Purpose:** List recent POs, newest first, optionally filtered to a single item.

**Query params**

| Param | Type | Default | Maps to | Notes |
| --- | --- | --- | --- | --- |
| `item_id` | string | `""` | `item_id` | Omitted when empty → returns all recent POs. |
| `per_page` | number | `10` | `per_page` | `Number(searchParams.get("per_page") || 10)` (`:34`) — **unvalidated and uncapped**. A non-numeric value produces `NaN`, which `buildUrl` stringifies to the literal `"NaN"` and forwards to Zoho. |

Always sends `sort_column: "date"`, `sort_order: "D"` (descending) — hard-coded at `:37-38`.

**Success — 200**

```json
{
  "purchaseorders": [
    {
      "purchaseorder_id": "460000000400001",
      "purchaseorder_number": "PO-00412",
      "vendor_id": "460000000098765",
      "vendor_name": "Greenply Distributors",
      "date": "2026-06-28",
      "status": "issued",
      "total": 74020.0
    }
  ]
}
```

Local `PurchaseOrderSummary` at `:20-28`. Always an array. **Line items are not included** — the summary list omits them; that is why `/po-vendor-map` and `/reorder-report` must hydrate each PO individually.

**Errors:** `500` `{ "error": "..." }`.

**curl**

```bash
curl -s "http://localhost:3000/api/zoho/purchaseorders?item_id=460000000123456&per_page=5"
# {"purchaseorders":[{"purchaseorder_id":"460000000400001","purchaseorder_number":"PO-00412","vendor_id":"460000000098765","vendor_name":"Greenply Distributors","date":"2026-06-28","status":"issued","total":74020.0}]}
```

### 14.2 `POST /api/zoho/purchaseorders`

**Purpose:** Create a draft purchase order. Called by `src/components/DraftPoModal.tsx:181` — the modal groups out-of-stock BOM rows by selected vendor and fires **one POST per vendor**.

**Headers:** `Content-Type: application/json`.

**Upstream param:** the route hard-codes `{ ignore_auto_number_generation: "false" }` (`:59`), i.e. **Zoho generates the PO number**; do not send `purchaseorder_number`.

**Request body:** verbatim pass-through, no validation. The exact shape the modal sends (`src/components/DraftPoModal.tsx:169-178`):

```json
{
  "vendor_id": "460000000098765",
  "line_items": [
    { "item_id": "460000000123456", "name": "Panel-18mm-BWP-720x560", "quantity": 24, "rate": 1850.5, "unit": "nos" }
  ],
  "notes": "Draft PO auto-generated from SO #SO-00187"
}
```

`rate` is sent as `l.rate || 0`, so an unpriced line becomes `0`. The `notes` string is the literal template `` `Draft PO auto-generated from SO #${oosLines[0]?.row.sourceOrderNumber ?? selectedSoId}` ``.

**Success — 200.** The route **augments** Zoho's `purchaseorder` object with a `web_url` field (`:65-67`), computed by `buildPoWebUrl()` (`:4-16`):

- Parses `inventoryBaseUrl` and matches its hostname against `/zohoapis\.(\w+)$/i`; the captured TLD maps the API host to the web host (`zohoapis.in` → `inventory.zoho.in`, `zohoapis.com` → `inventory.zoho.com`). Fallback if the regex or `new URL()` fails: `inventory.zoho.com`.
- Template: `` `https://${host}/app/${organizationId}#/purchaseorders/${purchaseorderId}?filter_by=Status.All&per_page=25&sort_column=created_time&sort_order=D` ``

```json
{
  "purchaseorder": {
    "purchaseorder_id": "460000000400009",
    "purchaseorder_number": "PO-00418",
    "status": "draft",
    "web_url": "https://inventory.zoho.in/app/60000000000#/purchaseorders/460000000400009?filter_by=Status.All&per_page=25&sort_column=created_time&sort_order=D"
  }
}
```

**Errors**

| Status | Body | When |
| --- | --- | --- |
| `500` | `{ "error": "Failed to create purchase order" }` or `{ "error": "<Zoho message>" }` | 200 but no `purchaseorder` (`:61-63`). |
| `500` | `{ "error": "{\"code\":1002,\"message\":\"Invalid value passed for vendor_id\"}" }` | Helper threw. |

**Partial-failure caveat:** the modal loops vendors sequentially and any single failure aborts the loop (`src/components/DraftPoModal.tsx:196-199`), leaving already-created POs in Zoho. There is **no transactional rollback** — a retry after a mid-loop failure will duplicate the POs that already succeeded.

**curl**

```bash
curl -s -X POST http://localhost:3000/api/zoho/purchaseorders \
  -H 'Content-Type: application/json' \
  -d '{"vendor_id":"460000000098765","line_items":[{"item_id":"460000000123456","name":"Panel-18mm-BWP-720x560","quantity":24,"rate":1850.5,"unit":"nos"}],"notes":"Draft PO auto-generated from SO #SO-00187"}'
# {"purchaseorder":{"purchaseorder_id":"460000000400009","purchaseorder_number":"PO-00418","status":"draft","web_url":"https://inventory.zoho.in/app/60000000000#/purchaseorders/460000000400009?filter_by=Status.All&per_page=25&sort_column=created_time&sort_order=D"}}
```

---

## 15. `GET /api/zoho/po-vendor-map`

**File:** `src/app/api/zoho/po-vendor-map/route.ts`

**Purpose:** Bulk version of `/items/[id]/vendors`. Given many item ids at once, scan recent POs and return, per item, its recent vendors with the last rate paid. Called by `src/components/DraftPoModal.tsx` as `` `/api/zoho/po-vendor-map?item_ids=${encodeURIComponent(ids)}&scan=100` `` — this is what pre-fills the vendor+rate columns for every out-of-stock line in one round trip.

**Query params**

| Param | Type | Default | Validation |
| --- | --- | --- | --- |
| `item_ids` | comma-separated string | `""` | Split on `,`, each `.trim()`ed, falsy entries filtered out, deduped via a `Set` (`:44`). **Required in practice.** |
| `scan` | number | `100` | `Math.min(Number(searchParams.get("scan") || 100), 200)` — **capped at 200** (`:45`). A non-numeric value gives `NaN`, and `Math.min(NaN, 200)` is `NaN`, which reaches Zoho as `"NaN"` — a real (unguarded) edge case. |

**Validation rule:** `if (!itemIds.size) return NextResponse.json({ map: {} });` (`:47-49`) — empty/absent `item_ids` returns **200 `{"map":{}}`** with no upstream call. Note this early return omits the `scanned` field that the success path includes.

**Algorithm**

1. `GET /purchaseorders?per_page={scan}&sort_column=date&sort_order=D` — **not** filtered by item; it scans the newest `scan` POs org-wide (`:52-56`).
2. Hydrate **every** summary with `GET /purchaseorders/{id}` via `fetchInBatches(summaries, 8, ...)` (`:26-38`, `:60-69`) — **batch size 8**, sequential batches, `Promise.all` within a batch. Individual failures `.catch` to `null` and are skipped.
3. Walk each PO's `line_items`; keep only lines whose `item_id` is in the requested set; append to `map[item_id]`. Because summaries were date-descending and hydration preserves order, **entries are most-recent-first**. Duplicate vendors for the same item are skipped — `if (map[iid].some(e => e.vendor_id === po.vendor_id)) continue;` (`:80`) — so each item lists each vendor at most once, at its most recent PO.

**Cost:** `1 + scan` upstream calls (up to **201** at `scan=200`). This is the heaviest routine endpoint in the app; expect multi-second latency and watch Zoho's per-minute API cap.

**Success — 200**

```json
{
  "map": {
    "460000000123456": [
      { "vendor_id": "460000000098765", "vendor_name": "Greenply Distributors", "last_po_number": "PO-00412", "last_po_date": "2026-06-28", "last_rate": 1850.5 },
      { "vendor_id": "460000000011122", "vendor_name": "Century Ply Depot", "last_po_number": "PO-00390", "last_po_date": "2026-05-14", "last_rate": 1795.0 }
    ],
    "460000000123457": [
      { "vendor_id": "460000000098765", "vendor_name": "Greenply Distributors", "last_po_number": "PO-00412", "last_po_date": "2026-06-28" }
    ]
  },
  "scanned": 100
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `map` | `Record<string, VendorHistoryEntry[]>` | Keyed by `item_id`. **Items with no PO history in the scanned window are absent from the map entirely** — not present with an empty array. |
| `map[].last_po_date` | `string` | `""` when the PO had no `date`. |
| `map[].last_rate` | `number?` | Omitted when the line's `rate` was not a number. |
| `scanned` | `number` | Count of PO summaries actually returned by Zoho (≤ `scan`). Absent on the empty-`item_ids` early return. |

`VendorHistoryEntry` is exported from this file (`:18-24`).

**Errors:** `500` `{ "error": "..." }` — only from the PO-list call or a token failure; per-PO hydration failures are swallowed (a partial map is returned as 200).

**curl**

```bash
curl -s "http://localhost:3000/api/zoho/po-vendor-map?item_ids=460000000123456,460000000123457&scan=100"
# {"map":{"460000000123456":[{"vendor_id":"460000000098765","vendor_name":"Greenply Distributors","last_po_number":"PO-00412","last_po_date":"2026-06-28","last_rate":1850.5}]},"scanned":100}
```

---

## 16. `GET /api/zoho/reorder-report`

**File:** `src/app/api/zoho/reorder-report/route.ts` (216 lines — the largest route). Consumed by `src/components/ReorderReport.tsx`.

**Purpose:** Build the full "what must I re-order right now" table: every item below its reorder level, its shortfall, its most recent vendor, that vendor's last rate, and the vendor's lead/transit times.

**Query params / body:** **none.** The request object is ignored (`_request`). Nothing about this report is parameterizable — all thresholds and page sizes are hard-coded.

**Algorithm (5 phases)**

1. **Narrow via Zoho's low-stock filter** (`:84-110`). Zoho's filter name differs across account versions, so the route tries candidates **in order** and keeps the first that does not throw:
   `["Status.LowStock", "Status.Lowstock", "Status.lowstock", "Status.Reorder"]`
   Then `GET /items?per_page=200&page=N&filter_by={cand}`, paginating while `page_context.has_more_page` up to a **hard ceiling of page 10** (`:97`) — i.e. at most **2000** low-stock items are considered. The winning filter is echoed as `filter_used`; if every candidate throws, `chosenFilter` stays `""` → `"none"` and `rows` is `[]`.
2. **Hydrate** each summary item with `GET /items/{item_id}`, `batched(..., 8, ...)` (`:41-48`, `:113-120`); failures → `null`.
3. **Filter to true reorder rows** (`:122-126`): keep items where `Number(it.reorder_level || 0) > 0` **and** `stockOf(it) < reorder_level`. `stockOf()` (`:74-79`) picks the **first numeric** of, in order: `actual_available_stock` → `available_stock` → `stock_on_hand`, else `0`. Items with no reorder level set are excluded even at zero stock.
4. **Vendor resolution** (`:130-162`): `GET /purchaseorders?per_page=100&sort_column=date&sort_order=D` (**100 hard-coded**), hydrate each in batches of 8, walk line items, and record the **first** (= most recent) PO per item id — `if (... || vendorByItem[li.item_id]) continue;`. Items whose last PO is older than the newest 100 POs get **no vendor**.
5. **Vendor lead/transit times** (`:165-180`): unique vendor ids → `GET /contacts/{id}` in batches of **6**, read via the same `readCf` alias-probing as `/api/zoho/contacts/[id]` (`:50-72`), aliases identical (`cf_lead_time`/`cf_leadtime`/`Lead Time`/`lead_time`, and the transit equivalents).

**Row assembly (`:183-205`) — exact formulas**

| Field | Formula / source |
| --- | --- |
| `item_id` | `it.item_id` |
| `name` | `it.name ?? it.item_name ?? ""` |
| `sku` | `it.sku ?? ""` |
| `unit` | `it.unit ?? ""` |
| `stock` | `stockOf(it)` — see above |
| `reorder_level` | `Number(it.reorder_level \|\| 0)` |
| `msl` | `Number(readCf(it, "cf_msl", "cf_minimum_stock_level", "MSL", "Minimum Stock Level")) \|\| 0` |
| `shortfall` | **`Math.max(0, reorder_level - stock)`** — quantity to bring stock back to the reorder level. Note it targets `reorder_level`, **not** `msl`; `msl` is informational only. |
| `vendor_id` / `vendor_name` | most-recent PO's vendor, else `""` |
| `last_po_number` / `last_po_date` | from that PO, else `""` |
| `last_rate` | that PO line's `rate` if numeric, else `undefined` (key omitted in JSON) |
| `lead_time` / `transit_time` | vendor contact CFs, else `0` |

**Cost:** roughly `1..4 (filter probes) + pages + N_items + 1 + 100 (PO details) + V (vendors)` upstream calls. Easily **200+** Zoho calls and tens of seconds on a real org. There is no caching (`force-dynamic`) and no request-level timeout — on Vercel this route is a serverless-timeout risk and is the most likely trigger of the token rate limiter.

**Success — 200**

```json
{
  "rows": [
    {
      "item_id": "460000000123456",
      "name": "Panel-18mm-BWP-720x560",
      "sku": "PNL-18-BWP-720560",
      "unit": "nos",
      "stock": 3,
      "reorder_level": 20,
      "msl": 10,
      "shortfall": 17,
      "vendor_id": "460000000098765",
      "vendor_name": "Greenply Distributors",
      "last_po_number": "PO-00412",
      "last_po_date": "2026-06-28",
      "last_rate": 1850.5,
      "lead_time": 7,
      "transit_time": 3
    }
  ],
  "total": 1,
  "scanned_items": 84,
  "filter_used": "Status.LowStock"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `rows` | array | See table above. Always present, possibly `[]`. |
| `total` | `number` | `rows.length`. |
| `scanned_items` | `number` | Count returned by the low-stock filter **before** hydration/filtering — always ≥ `total`. |
| `filter_used` | `string` | The winning candidate, or the literal `"none"`. **`"none"` + `total: 0` means the filter probing failed, not that stock is healthy** — the key diagnostic when the report is mysteriously empty. |

**Errors:** `500` `{ "error": "..." }`. Because phases 1, 2, 4 and 5 all `.catch` internally, most partial failures degrade into a thinner report rather than an error; a `500` here almost always means token/env trouble or the phase-4 PO-list call throwing.

**curl**

```bash
curl -s http://localhost:3000/api/zoho/reorder-report
# {"rows":[{"item_id":"460000000123456","name":"Panel-18mm-BWP-720x560","sku":"PNL-18-BWP-720560","unit":"nos","stock":3,"reorder_level":20,"msl":10,"shortfall":17,"vendor_id":"460000000098765","vendor_name":"Greenply Distributors","last_po_number":"PO-00412","last_po_date":"2026-06-28","last_rate":1850.5,"lead_time":7,"transit_time":3}],"total":1,"scanned_items":84,"filter_used":"Status.LowStock"}
```

---

## 17. `POST /api/ai/chat`

**File:** `src/app/api/ai/chat/route.ts` (64 lines). Consumed by `src/components/AiCopilot.tsx:41`.

**Purpose:** The "Magppie BOM Copilot" chat. Proxies to OpenAI, injecting a system prompt that carries the BOM domain rules plus a JSON dump of the page's current state.

**Auth:** none on the route. The OpenAI key lives server-side only (`process.env.OPENAI_API_KEY`, `:7`). **This route is the only one that spends money per call and it is completely open** — rate-limit or authenticate it before any public deployment.

**Headers:** `Content-Type: application/json`.

**Request body**

```json
{
  "messages": [
    { "role": "user", "content": "Why is MD2CM1 disallowed on this drawer front?" }
  ],
  "context": { "zone": "BC", "width": 600, "shutterDesign": "MD2CM1", "rows": 42 }
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `messages` | `Array<{ role: "user" \| "assistant" \| "system"; content: string }>` | **Yes in effect** | Spread directly after the system message (`:38-41`). **Unvalidated** — if omitted, `...messages` throws `TypeError: messages is not iterable` → `500`. The full history is resent every turn; there is no server-side truncation, so long chats will eventually exceed the model's context window. |
| `context` | any JSON | No | `JSON.stringify(context \|\| {}, null, 2)` is embedded in the system prompt (`:26`). Whatever the page passes is sent verbatim to OpenAI. |

**Fixed OpenAI call** (`:30-44`): `POST https://api.openai.com/v1/chat/completions`, `Authorization: Bearer <OPENAI_API_KEY>`, `model: "gpt-4o-mini"` (hard-coded, `:37`), `temperature: 0.7` (hard-coded, `:42`). **Non-streaming.**

**System prompt** (`:15-28`) — verbatim domain facts pinned into every request, and the canonical statement of these rules in the API layer:

- Zones: `BC/BCL` (Base), `BB/BBL` (Blind Base), `WC/WB` (Wall), `TC/TCL` (Tall), `LO/LB` (Loft).
- Shutter designs: `MD1, MD2, MD1CM1, MD1CM2, MD2CM1, MD2CM2, CL1, CL2, NEON20`.
- Rule: CM1/2 and CL1/2 styles are **EXCLUDED** for low-back drawer fronts (`H90`) and 150 mm-wide Bottle Pull Outs (`BPO`).
- Rule: `NEON20` is **never** allowed on drawer fronts.
- Waste factors: **17%** carcass panels, **0%** shutter panels, **20%** Elenor profiles, **25%** other profiles, **15%** stone.
- Response format instruction: concise, technically accurate, **Markdown**.

**Success — 200**

```json
{ "message": "MD2CM1 is a CM-family design, and CM1/CM2 styles are excluded on low-back (H90) drawer fronts because the cross-moulding cannot land cleanly on the reduced face height.\n\n- Allowed here: **MD1**, **MD2**\n- Blocked: MD1CM1/2, MD2CM1/2, CL1/2, NEON20" }
```

Only `data.choices[0].message.content` is returned (`:55-57`); token usage, `finish_reason`, and the model id are discarded.

**Errors**

| Status | Body | When |
| --- | --- | --- |
| `500` | `{ "error": "OpenAI API Key not configured on the server." }` | `OPENAI_API_KEY` missing/empty (`:8-13`). |
| **passthrough** (e.g. `401`, `429`, `400`, `500`) | `{ "error": "OpenAI API error: <raw response text>" }` | OpenAI returned non-2xx. **Unique in this codebase: `status: response.status` forwards OpenAI's real status** (`:46-52`). The raw OpenAI error text is embedded — this can leak upstream detail to the client. |
| `500` | `{ "error": "<message>" }` or `{ "error": "Internal Server Error" }` | Any throw — malformed JSON body, missing `messages`, or `data.choices[0]` being undefined (unguarded at `:56`). |

Note this route does **not** use `toApiError`; it has its own inline `catch` (`:58-63`) and does **not** log to the console.

**curl**

```bash
curl -s -X POST http://localhost:3000/api/ai/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"What waste factor applies to carcass panels?"}],"context":{"zone":"BC","width":600}}'
# {"message":"Carcass panels use a **17%** waste factor. For contrast: shutter panels 0%, Elenor profiles 20%, other profiles 25%, stone 15%."}
```

---

## 18. Upstream Zoho endpoint map

Every path below is relative to `ZOHO_INVENTORY_BASE_URL` (default `https://www.zohoapis.in/inventory/v1`) and automatically receives `?organization_id={ZOHO_ORGANIZATION_ID}`.

| Local route | Upstream call(s) | Extra params set by the app |
| --- | --- | --- |
| `GET /api/zoho/status` | `GET /organizations` | — |
| `GET /api/zoho/items` | `GET /items` | `per_page=200`, `search_text?`, `name_contains?` |
| `POST /api/zoho/items` | `POST /items` | — |
| `GET /api/zoho/items/[id]` | `GET /items/{id}` | — |
| `PUT /api/zoho/items/[id]` | `PUT /items/{id}` | — |
| `GET /api/zoho/items/[id]/vendors` | `GET /purchaseorders`; `GET /items/{id}`; `GET /purchaseorders/{poId}` ×5 | `item_id={id}`, `per_page=25`, `sort_column=date`, `sort_order=D` |
| `POST /api/zoho/compositeitems` | `POST /compositeitems` | — |
| `GET /api/zoho/compositeitems/[id]` | `GET /compositeitems/{id}` | — |
| `PUT /api/zoho/compositeitems/[id]` | `PUT /compositeitems/{id}` | — |
| `GET /api/zoho/salesorders` | `GET /salesorders` | `search_text`, `status?`, `per_page=50` |
| `GET /api/zoho/salesorders/[id]` | `GET /salesorders/{id}` | — |
| `PUT /api/zoho/salesorders/[id]` | `PUT /salesorders/{id}` | — |
| `GET /api/zoho/contacts` | `GET /contacts` | `contact_type` (default `vendor`), `per_page=200`, `search_text?` |
| `GET /api/zoho/contacts/[id]` | `GET /contacts/{id}` | — |
| `GET /api/zoho/purchaseorders` | `GET /purchaseorders` | `per_page` (default 10), `sort_column=date`, `sort_order=D`, `item_id?` |
| `POST /api/zoho/purchaseorders` | `POST /purchaseorders` | `ignore_auto_number_generation=false` |
| `GET /api/zoho/po-vendor-map` | `GET /purchaseorders`; `GET /purchaseorders/{id}` ×`scan` | `per_page={scan≤200}`, `sort_column=date`, `sort_order=D` |
| `GET /api/zoho/reorder-report` | `GET /items` (paged); `GET /items/{id}` ×N; `GET /purchaseorders`; `GET /purchaseorders/{id}` ×100; `GET /contacts/{id}` ×V | `filter_by=Status.LowStock\|Status.Lowstock\|Status.lowstock\|Status.Reorder`, `per_page=200`, `page=1..10`; PO list `per_page=100` |
| `POST /api/ai/chat` | `POST https://api.openai.com/v1/chat/completions` | model `gpt-4o-mini`, `temperature=0.7` |

Token endpoint (all Zoho routes, indirectly): `POST {ZOHO_ACCOUNTS_BASE_URL}/oauth/v2/token?refresh_token=…&client_id=…&client_secret=…&grant_type=refresh_token`.

---

## 19. Client call sites

Exhaustive list of API URLs referenced anywhere under `src/` (from a literal grep of string and template literals):

```
"/api/zoho/status"
"/api/zoho/items"
`/api/zoho/items?search=${encodeURIComponent(...)}`        // query | term | name | cleanName | "Drilling-1"
`/api/zoho/items?name=${encodeURIComponent(...)}`          // name | itemName | cleanName
`/api/zoho/items/${id}`
"/api/zoho/compositeitems"
`/api/zoho/compositeitems/${compositeId | id | encodeURIComponent(itemId)}`
`/api/zoho/salesorders?q=${encodeURIComponent(query|soQuery)}[&status=${encodeURIComponent(status)}]`
`/api/zoho/salesorders/${id | orderId | soId | encodeURIComponent(selectedSo.salesorder_id)}`
"/api/zoho/contacts?contact_type=vendor"
`/api/zoho/contacts/${newVendorId}`
"/api/zoho/purchaseorders"
`/api/zoho/po-vendor-map?item_ids=${encodeURIComponent(ids)}&scan=100`
"/api/zoho/reorder-report"
"/api/ai/chat"
```

**`/api/zoho/items/[id]/vendors` has zero client call sites** — it is dead code from the UI's perspective, superseded by `po-vendor-map`. Keep it or delete it deliberately; do not assume it is load-bearing.

---

## 20. Known gaps and security issues

Ranked by severity, for whoever picks this up:

1. **No server-side auth on any route.** `AuthGate.tsx` is client-only and its password is a hard-coded literal in the bundle (`src/components/AuthGate.tsx:27`), with a user-settable `localStorage` flag (`:12`). `curl` bypasses it entirely; the entire Zoho org is exposed read/write, and `/api/ai/chat` spends OpenAI credit for anyone. Fix: `middleware.ts` matching `/api/:path*` validating a signed session cookie, plus the password moved to a server-only env var.
2. **Unvalidated pass-through bodies** on `POST /items`, `PUT /items/[id]`, `POST /compositeitems`, `PUT /compositeitems/[id]`, `PUT /salesorders/[id]`, `POST /purchaseorders`. Arbitrary caller-supplied JSON reaches Zoho. Add a zod schema per route.
3. **Upstream status codes are collapsed to 500.** Clients cannot distinguish "bad request" from "Zoho is down" from "rate limited" except by string-matching the `error` field. Consider carrying the upstream status through `zohoInventoryRequest`.
4. **Raw Zoho error JSON is returned to the client** (`src/lib/zoho.ts:221` → `toApiError` case 3), leaking upstream internals. Same for OpenAI's raw error text at `src/app/api/ai/chat/route.ts:49`.
5. **The rate-limit backoff discards a still-valid token** (`src/lib/zoho.ts:104-109` sets `token: ""`), turning a transient refresh rate-limit into a guaranteed 5-minute outage.
6. **`reorder-report` and `po-vendor-map` are call-storms** (200+ upstream requests, no caching, no timeout) — the most likely cause of hitting Zoho's rate limiter and of serverless timeouts.
7. **No pagination anywhere except `reorder-report`**; `per_page` is hard-coded (200/50/200/10) and results beyond the cap are silently dropped.
8. **`Number(...)` on unvalidated query params** yields `NaN`, which is forwarded to Zoho as the literal string `"NaN"` (`purchaseorders?per_page`, `po-vendor-map?scan`).
9. **404 is unreachable for genuinely missing records** — Zoho reports "not found" as `code: 1001`, which throws in the helper and surfaces as 500. The `404` branches only fire on the rare 200-with-empty-body case.
