# Integrations

External systems the Magppie Carcass BOM Builder talks to.

| # | Integration | Purpose | Server module / route | Required env |
|---|---|---|---|---|
| 1 | **Zoho Inventory** (India DC) | Item / composite-item / SO / PO master data; BOM push-back | `src/lib/zoho.ts` + `src/app/api/zoho/**` | `ZOHO_*` (6 vars) |
| 2 | **OpenAI** | "Magppie BOM Copilot" chat assistant | `src/app/api/ai/chat/route.ts` | `OPENAI_API_KEY` |
| 3 | **Vercel** | Hosting / deploy | `.vercel/project.json`, `deploy.sh` | (platform) |
| 4 | Webhooks / callbacks | **None exist.** See [§4](#4-webhooks--callbacks). | — | — |

Everything Zoho-facing is **server-side only**. The browser never sees a Zoho token: `CarcassBomBuilder.tsx` calls same-origin `/api/zoho/*` routes, which proxy to Zoho using credentials held in `process.env` on the server.

---

## 1. Zoho Inventory (India DC)

### 1.1 Required environment variables

Zoho lives on **regional data centres**. This app is wired to the **India DC** (`.in`), *not* `.com`. A token minted on the US DC will fail with `invalid_code` / `invalid_client` here.

| Variable | Required | Default (if unset) | Contents |
|---|---|---|---|
| `ZOHO_ORGANIZATION_ID` | **Yes** | — (throws) | Numeric Zoho Inventory org id, ~11 digits. The real production value is committed in `.env.example`. |
| `ZOHO_REFRESH_TOKEN` | **Yes** | — (throws) | Long-lived refresh token, shape `1000.<32-hex>.<32-hex>`. **Placeholder: `<ZOHO_REFRESH_TOKEN>`** |
| `ZOHO_CLIENT_ID` | **Yes** | — (throws) | Self-client id, shape `1000.<26 alphanumerics>`. **Placeholder: `<ZOHO_CLIENT_ID>`** |
| `ZOHO_CLIENT_SECRET` | **Yes** | — (throws) | Self-client secret, ~42 hex chars. **Placeholder: `<ZOHO_CLIENT_SECRET>`** |
| `ZOHO_ACCOUNTS_BASE_URL` | No | `https://accounts.zoho.in` | OAuth token host. India DC. |
| `ZOHO_INVENTORY_BASE_URL` | No | `https://www.zohoapis.in/inventory/v1` | Inventory API host + version prefix. |

The four **required** vars are enforced by the `REQUIRED_ENV` tuple at `src/lib/zoho.ts:5-10`; `getEnv()` (`src/lib/zoho.ts:31-37`) throws `` `Missing ${name}. Add it to .env.local.` `` when any is blank. The two base URLs are optional and fall back via `getAccountsBaseUrl()` (`src/lib/zoho.ts:39-41`) and `getInventoryBaseUrl()` (`src/lib/zoho.ts:43-45`).

> **SECURITY — action required.** `add_envs.sh` (repo root) contains **live, hard-coded** `ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` values passed to `npx vercel env add`. It is committed alongside `vercel_env.log`, which echoes the same. Both should be treated as **compromised**: revoke the self-client in the Zoho API console, mint a new refresh token, set the values through the Vercel dashboard only, and delete `add_envs.sh` + `vercel_env.log` (and purge from git history). Do not reuse this script as-is. `.env.local` and `.env.local.bak` also hold live values and must never be committed.

### 1.2 OAuth refresh-token flow, end to end

The app **only ever performs the refresh-token grant** at runtime. The authorization-code leg is done once by a human, out of band (see §1.3).

`refreshZohoAccessToken()` — `src/lib/zoho.ts:88-121`:

```
POST https://accounts.zoho.in/oauth/v2/token?refresh_token=<...>&client_id=<...>&client_secret=<...>&grant_type=refresh_token
```

Exact details, all load-bearing:

- Params are sent in the **query string**, not the body (`URLSearchParams` → `?${params.toString()}`), with `method: "POST"` and **no request body**. Zoho accepts this; do not "fix" it into a form-encoded body without testing.
- `cache: "no-store"` — required, or Next.js will cache the token response.
- `grant_type` is the literal string `refresh_token`.
- Success requires **both** `response.ok` **and** a truthy `body.access_token` (`src/lib/zoho.ts:102`). Zoho returns HTTP 200 with an `error` field on failure, so the status check alone is insufficient.
- On success the token is cached with
  `expiresAt = Date.now() + Number(body.expires_in ?? 3600) * 1000 - 30_000`
  (`src/lib/zoho.ts:116`) — i.e. **30 s of safety margin** subtracted from Zoho's stated lifetime (normally 3600 s).
- On failure it throws `` `Zoho token refresh failed: ${JSON.stringify(body)}` ``.

**Single-flight.** `getZohoAccessToken()` (`src/lib/zoho.ts:123-142`) memoises the in-progress refresh in a module-level `refreshPromise` (`src/lib/zoho.ts:29`), cleared in `.finally()`. Concurrent callers on one instance share **one** network refresh. This matters — Zoho rate-limits refreshes aggressively (§1.8).

Refresh tokens are **permanent** unless revoked. Zoho allows a limited number of live refresh tokens per client (historically 20); minting a 21st silently invalidates the oldest.

### 1.3 Obtaining a refresh token from scratch (self-client, India DC)

Do this in a browser signed in as the Zoho account that owns the Inventory org (`info@mymagppie.com`).

**Step 1 — register a Self Client.**
1. Go to **`https://api-console.zoho.in`** (`.in` — the India console; `api-console.zoho.com` creates a US-DC client that will not work).
2. **Add Client → Self Client → Create**.
3. Copy the **Client ID** (`1000.XXXX…`) and **Client Secret** → these become `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET`.

**Step 2 — generate a grant code.**
1. In the Self Client, open the **Generate Code** tab.
2. **Scope** — paste this comma-separated list (see §1.4 for why each is needed):
   ```
   ZohoInventory.items.CREATE,ZohoInventory.items.READ,ZohoInventory.items.UPDATE,ZohoInventory.compositeitems.CREATE,ZohoInventory.compositeitems.READ,ZohoInventory.compositeitems.UPDATE,ZohoInventory.salesorders.READ,ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.READ,ZohoInventory.contacts.READ,ZohoInventory.settings.READ
   ```
   (`ZohoInventory.fullaccess.all` also works and is what most Magppie-era tokens use, but is broader than needed.)
3. **Time Duration**: 3–10 minutes. **Scope Description**: anything.
4. **Create → pick the Inventory organization → Create**. Copy the **grant code** immediately — it is single-use and expires in minutes.

**Step 3 — exchange the grant code for a refresh token.** Within the code's lifetime:

```bash
curl -X POST "https://accounts.zoho.in/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=<ZOHO_CLIENT_ID>" \
  -d "client_secret=<ZOHO_CLIENT_SECRET>" \
  -d "code=<GRANT_CODE_FROM_STEP_2>" \
  -d "redirect_uri=https://www.zoho.in"
```

Response:

```json
{
  "access_token": "1000.<...>",
  "refresh_token": "1000.<...>",
  "expires_in": 3600,
  "api_domain": "https://www.zohoapis.in",
  "token_type": "Bearer"
}
```

- `refresh_token` → `ZOHO_REFRESH_TOKEN`. **It is returned only on this first exchange** — if you lose it, generate a new grant code and repeat.
- `api_domain` **must** read `https://www.zohoapis.in`. If it says `.com`, you used the wrong console; delete the client and redo on `api-console.zoho.in`.
- For a Self Client, `redirect_uri` is not strictly registered; `https://www.zoho.in` is conventional. If Zoho rejects it, omit the param entirely.

**Step 4 — find the organization id.** Either read it from Zoho Inventory → *Settings → Organizations → Organization ID*, or:

```bash
curl "https://www.zohoapis.in/inventory/v1/organizations" \
  -H "Authorization: Zoho-oauthtoken <ACCESS_TOKEN_FROM_STEP_3>"
```

Take `organizations[].organization_id` → `ZOHO_ORGANIZATION_ID`.

**Step 5 — verify.** Put all six vars in `.env.local`, `npm run dev`, then hit `http://127.0.0.1:3000/api/zoho/status`. A healthy response (`src/app/api/zoho/status/route.ts:20-27`):

```json
{ "ok": true, "organizationId": "…", "organizationName": "…",
  "inventoryBaseUrl": "https://www.zohoapis.in/inventory/v1",
  "tokenCached": true, "checkedAt": "2026-07-17T…" }
```

`/api/zoho/status` is the **canonical health check** — it round-trips a real `GET /organizations` and cross-matches the returned org against `ZOHO_ORGANIZATION_ID` (`src/app/api/zoho/status/route.ts:18`). If `organizationName` falls back to the literal `"Zoho Inventory"`, the token is valid but **the org id doesn't match any org the token can see** — almost always a wrong `ZOHO_ORGANIZATION_ID` or a token from a different Zoho account.

### 1.4 Scopes / permissions actually exercised

Derived from the routes under `src/app/api/zoho/`:

| Zoho endpoint | Verbs used | Scope | Used by |
|---|---|---|---|
| `/organizations` | GET | `ZohoInventory.settings.READ` | `api/zoho/status/route.ts:17` |
| `/items` | GET, POST | `ZohoInventory.items.READ` / `.CREATE` | `api/zoho/items/route.ts:23,34` |
| `/items/{id}` | GET, PUT | `ZohoInventory.items.READ` / `.UPDATE` | `api/zoho/items/[id]/route.ts:14,30` |
| `/compositeitems` | POST | `ZohoInventory.compositeitems.CREATE` | `api/zoho/compositeitems/route.ts:16` |
| `/compositeitems/{id}` | GET, PUT | `ZohoInventory.compositeitems.READ` / `.UPDATE` | `api/zoho/compositeitems/[id]/route.ts:14,30` |
| `/salesorders` | GET | `ZohoInventory.salesorders.READ` | `api/zoho/salesorders/route.ts:20` |
| `/purchaseorders`, `/purchaseorders/{id}` | GET, POST | `ZohoInventory.purchaseorders.READ` / `.CREATE` | `api/zoho/purchaseorders/route.ts:42,55`; `po-vendor-map/route.ts:52,62`; `items/[id]/vendors/route.ts:39,57` |
| `/contacts`, `/contacts/{id}` | GET | `ZohoInventory.contacts.READ` | `api/zoho/contacts/route.ts:25`; `reorder-report/route.ts:168` |

The Zoho **user** whose account owns the self-client must also have role permissions for these modules — scopes narrow a user's rights, they never widen them. A read-only Zoho user will produce `code: 57` on item creation no matter how broad the scope string.

### 1.5 `organization_id` handling

Injected automatically for **every** Inventory call by `buildUrl()` (`src/lib/zoho.ts:156-165`):

```ts
const url = new URL(`${getInventoryBaseUrl()}${path}`);
url.searchParams.set("organization_id", getEnv("ZOHO_ORGANIZATION_ID"));
```

Per-call `params` are then layered on, **skipping `undefined` and `""`** (`src/lib/zoho.ts:159-163`) — so an empty search term never becomes `search_text=`. Route handlers must never set `organization_id` themselves; it is always present and always wins from env. It is a query param, never a header.

`getZohoRuntimeInfo()` (`src/lib/zoho.ts:144-154`) exposes the org id plus cache state for diagnostics — it is what `/api/zoho/status` reports, and `purchaseorders/route.ts:15` uses the org id to build deep links of the form
`https://<host>/app/<organizationId>#/purchaseorders/<purchaseorderId>?filter_by=Status.All&per_page=25&sort_column=created_time&sort_order=D`.

### 1.6 Access-token cache

Two tiers, both best-effort. Defined at `src/lib/zoho.ts:24-29`:

```ts
const TOKEN_CACHE_PATH = path.join(os.tmpdir(), "magppie-cache", "zoho-access-token.json");
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;  // 5 min
const TOKEN_BACKOFF_MS      = 5 * 60 * 1000;  // 5 min
let cachedToken: TokenCache | null = null;
let refreshPromise: Promise<string> | null = null;
```

**Tier 1 — in-memory** (`cachedToken`). Survives across requests on a warm serverless instance; dies on cold start. Read first and short-circuits disk entirely (`src/lib/zoho.ts:52`).

**Tier 2 — disk**, at `os.tmpdir()/magppie-cache/zoho-access-token.json`. `os.tmpdir()` is deliberate (comment at `src/lib/zoho.ts:21-23`): `process.cwd()` is **read-only on Vercel/Lambda**, whereas `/tmp` is writable and shared between invocations on the same instance. Every disk operation is wrapped in a swallowing `try/catch` — `writeTokenCache` (`:63-72`), `readTokenCache` (`:51-61`), `clearTokenCache` (`:74-81`). A read-only or full filesystem degrades to memory-only; it never fails a request.

Cached shape (`TokenCache`, `src/lib/zoho.ts:14-19`):

```json
{ "token": "1000.<access token>", "expiresAt": 1770000000000,
  "refreshBlockedUntil": 1770000300000, "lastError": "{…}" }
```

**5-minute pre-expiry refresh.** `hasUsableToken()` (`src/lib/zoho.ts:47-49`):

```ts
return Boolean(cache?.token && cache.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS);
```

A token is considered stale **5 minutes before** it actually expires, so no in-flight request is ever handed a token that dies mid-call. Combined with the 30 s subtracted at mint time (§1.2), the effective usable window of a 3600 s token is ~54.5 minutes.

**Resolution order** in `getZohoAccessToken()` (`src/lib/zoho.ts:123-142`): usable cache → cooldown check → single-flight refresh.

### 1.7 5-minute cooldown on refusal

When Zoho *refuses* to refresh (rather than erroring transiently), the app stops hammering it.

`isTokenRateLimit()` (`src/lib/zoho.ts:83-86`) serialises the whole error body and lowercases it, matching on either substring:

- `"too many requests"`
- `"access denied"`

On a match, `refreshZohoAccessToken` writes a **poison-pill cache entry** (`src/lib/zoho.ts:103-110`) — `token: ""`, `expiresAt: 0`, `refreshBlockedUntil: Date.now() + 5 min`, plus the raw body in `lastError` — then still throws.

Every subsequent `getZohoAccessToken()` sees the block and throws early **without a network call** (`src/lib/zoho.ts:130-133`):

```
Zoho token refresh is cooling down. Try again in about <N> seconds.
```

Note the cooldown is persisted to `/tmp`, so it survives warm restarts on that instance — but it is **per-instance**: N Vercel lambdas hold N independent cooldowns. If you keep tripping the limiter under load, that fan-out is why.

### 1.8 401 / code 57 / code 14 retry

`zohoInventoryRequest()` (`src/lib/zoho.ts:190-225`) is the single choke point for GET/PUT/POST. Requests carry:

```
Authorization: Zoho-oauthtoken <access_token>
Content-Type: application/json      // only when a payload exists
cache: "no-store"
```

Note the scheme is **`Zoho-oauthtoken`**, *not* `Bearer` — a `Bearer` header returns 401 from Zoho Inventory.

**Retry condition** (`src/lib/zoho.ts:213`):

```ts
if ((response.status === 401 || body.code === 57 || body.code === 14) && accessToken) {
  await clearTokenCache();            // nuke memory + disk
  accessToken = await getZohoAccessToken();   // force a fresh mint
  response = await doFetch(accessToken);
  body = await response.json();
}
```

- **HTTP 401** — token rejected at the transport layer.
- **`code: 57`** — Zoho's "you are not authorized to perform this operation".
- **`code: 14`** — Zoho's "invalid oauth token".

Zoho returns 57/14 inside a **HTTP 200** body, which is why the body codes are checked alongside the status. **Exactly one retry** — no exponential backoff, no loop. If the second attempt also fails, the error propagates.

**Failure detection** (`src/lib/zoho.ts:220-222`) is likewise dual: `!response.ok` **or** a numeric `body.code > 0`. Zoho uses `code: 0` for success, so any positive code is an error even on HTTP 200. On failure it throws the raw JSON body as the message string.

### 1.9 Error surface to users

`toApiError()` (`src/lib/zoho.ts:227-242`) converts a thrown error into the JSON body every `/api/zoho/*` route returns with **HTTP 500**. It always `console.error('[Zoho API Error]:', error)` first — that prefix is the string to grep in Vercel runtime logs.

Three branches:

1. Message contains `"cooling down"` → passed through verbatim: `{ error: "Zoho token refresh is cooling down. Try again in about 240 seconds." }`
2. Message lowercased contains `"too many requests"` → replaced with the friendly copy:
   > `"Zoho is temporarily blocking token refresh because too many refresh requests were made. The app will reuse cached tokens and wait before trying again."`
3. Any other `Error` → `{ error: error.message }` — **this leaks the raw Zoho JSON body to the browser**, since `zohoInventoryRequest` throws `JSON.stringify(body)`. Useful for debugging, but it is an information-disclosure smell worth tightening.
4. Non-`Error` throw → `{ error: "Unknown server error", detail: error }`.

Routes uniformly do `return NextResponse.json(toApiError(error), { status: 500 })`. In the UI, `resolveSimpleItem` / `resolveCompositeItem` surface it as `` `Failed to create item "<name>": <errData.error ?? statusText>` `` (`CarcassBomBuilder.tsx:5023`, `:5097`) — so the Zoho message reaches the operator's screen largely intact.

### 1.10 Rate limits & pagination

Zoho enforces limits at two levels, and this app touches both.

**Token endpoint.** The tightest constraint and the reason §1.6–1.7 exist. Zoho throttles refreshes per client (roughly ~5–10/minute; it responds `"Access Denied"` / `"too many requests"` and can lock a client out for minutes). Mitigations already in place: the 5-min skew, the single-flight promise, and the 5-min cooldown. **Never** call `refreshZohoAccessToken()` directly — always go through `getZohoAccessToken()`.

**API endpoint.** Zoho Inventory allows roughly 100 req/min per org and a per-day call cap tied to plan. Nothing in this codebase throttles, queues, or backs off API (non-token) calls — a `429` will simply surface as a 500 through `toApiError`.

**The hot spots** — these fan out and are the realistic way to hit the API limit:

- `src/app/api/zoho/reorder-report/route.ts` — paginates `/items` at `per_page: 200` for **up to 10 pages per filter candidate** (`:96-104`), then issues **one `GET /items/{id}` per item** (`:115`), plus `per_page: 100` of `/purchaseorders` each followed by a per-PO detail GET (`:130-137`) and per-contact GETs (`:168`). Easily hundreds of calls in one request. Treat as expensive; cache aggressively if it is ever put on a timer.
- `src/app/api/zoho/po-vendor-map/route.ts:52-62` and `items/[id]/vendors/route.ts:39-57` — list POs then fan out to per-PO detail GETs.
- **`resolveSimpleItem` / `resolveCompositeItem` do 1–2 search GETs per item before every create** (§1.11). A large BOM push is inherently chatty and strictly sequential (`await` in a `for` loop). This is slow but *deliberate* — it is what makes the push idempotent and it keeps burst rate low.

Default page sizes by route: `/items` → `per_page: 200` (`items/route.ts:18`); `/contacts` → `200` (`contacts/route.ts:21`); `/salesorders` → `50` (`salesorders/route.ts:23`); `/purchaseorders` → `10`, caller-overridable via `?per_page=` (`purchaseorders/route.ts:34-36`). Only `reorder-report` walks `page_context.has_more_page`; the others take the first page only, so >200 matching items are silently truncated.

### 1.11 Idempotent item resolution

The BOM push must be **safely re-runnable** — an operator hitting "push" twice must not duplicate Zoho masters. Idempotency is achieved by **search-before-create on a normalised name**, not by any Zoho-side upsert (Zoho has no upsert for items).

#### `normalizeItemName` — `CarcassBomBuilder.tsx:4936-4941`

```ts
String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase()
```

Collapse whitespace runs → trim → lowercase. Used **only** for comparison, never for what gets written.

#### `normalizePartOrPanelName` — `src/lib/naming.ts:36`

The canonical writer-side normaliser, applied to every name/SKU before search **and** before create. Notable transforms:

- collapse whitespace (`naming.ts:37`)
- `LH+RH` → `LH/RH`, case-insensitive (`naming.ts:40`)
- strip a trailing SO suffix matching `/-SO-\d+(?:-\d+)?$/i`, e.g. `-SO-00029` (`naming.ts:43-48`)
- strip a trailing `-Project` (`naming.ts:51-52`)

Stripping the SO suffix is what lets a panel created for SO-00029 be **reused** by SO-00031 instead of duplicated.

#### `searchItemByName(name)` — `CarcassBomBuilder.tsx:4943-4968`

Two-stage lookup; returns the raw Zoho item or `null`.

1. `GET /api/zoho/items?search=<cleanName>` → Zoho `search_text` (`items/route.ts:20`)
2. Fallback `GET /api/zoho/items?name=<cleanName>` → Zoho `name_contains` (`items/route.ts:21`)

Both stages apply the same `findMatch` predicate (`:4947-4951`) — an **exact** match after `normalizeItemName` on **either** `it.name` **or** `it.sku`:

```ts
normalizeItemName(it.name) === target || normalizeItemName(it.sku) === target
```

So Zoho's fuzzy search is only a candidate generator; the equality test is exact-after-normalisation. Two stages exist because `search_text` and `name_contains` have different Zoho-side matching behaviour and each misses cases the other catches.

#### `resolveSimpleItem(name, isService = false, customFields?, uom?)` — `CarcassBomBuilder.tsx:4970-5027`

Returns an `item_id`, creating the item only if absent.

1. `normName = normalizePartOrPanelName(name)`.
2. `searchItemByName(normName)` → if found, **return `existing.item_id`** (idempotent exit, `:4973`).
3. Build custom fields — each present key maps to a Zoho `api_name` (`:4975-4982`):

   | `ItemCustomFields` key | Zoho `api_name` |
   |---|---|
   | `group` | `cf_group` |
   | `subGroup` | `cf_sub_group` |
   | `finish` | `cf_finish` |
   | `thickness` | `cf_thickness` |
   | `height` | `cf_height` |
   | `width` | `cf_width` |
   | `depth` | `cf_depth` |

   These `cf_*` fields **must already exist** in Zoho Inventory (Settings → Preferences → Items → Custom Fields) with exactly these API names, or creation fails.
4. **UOM inference** (`:4984-4993`) — `uom` param wins; otherwise, lowercased-name substring match, **first hit wins in this order**: `set`→`pcs`; `kg`/`glue`→`Kg`; `ml`/`silicone`→`ML`; `mtr`/`wire`→`Mtr`; `mm`/`led`/`diffuser`/`tape`/`prof`→`MM`. **The computed `unit` is then never sent** — `payload.unit` is commented out at `:5012-5013` ("Omit unit field for now to avoid UOM creation restrictions in Zoho"), because Zoho rejects unknown UOM strings. The whole inference block is presently **dead code**; the `uom` argument threaded through `resolveHardwarePackComposite` has no effect. Re-enabling it requires pre-creating each UOM in Zoho first.
5. Payload (`:4995-5014`) — note `sku` is set **equal to** `name`:

   ```jsonc
   {
     "name": "<normName>", "sku": "<normName>",
     "rate": 0, "purchase_rate": 0,
     "can_be_sold": true, "can_be_purchased": true,
     "account_id": "3418412000000000486",           // sales account
     "purchase_account_id": "3418412000000000567",  // purchase account
     "is_taxable": true,
     "custom_fields": [ { "api_name": "cf_group", "value": "…" } ],  // omitted when empty
     // service items:
     "product_type": "service",
     // goods items instead get:
     "inventory_account_id": "3418412000000000626",
     "track_inventory": true
   }
   ```

   > **The three account ids are hard-coded, org-specific magic numbers** (`:5002-5003`, `:5010`). They are valid **only** for org `60063687231`. Pointing the app at a different Zoho org **requires replacing all three** — they should be env vars. This is the single biggest portability blocker in the integration.

6. `POST /api/zoho/items` → returns `createData.item.item_id`. Non-OK throws `` `Failed to create item "<name>": <errData.error ?? statusText>` ``.

**Race caveat:** search-then-create is not atomic. Two concurrent pushes of the same new item can both miss and both create. The BOM push is sequential (`await` in `for`), so this only bites if two operators push overlapping BOMs simultaneously. Zoho has no unique-name constraint to catch it.

#### `resolveCompositeItem(rawName, rawSku, mappedItems, customFields?)` — `CarcassBomBuilder.tsx:5033-5102`

Same contract for composite (multi-component) items.

1. Normalise **both** name and SKU via `normalizePartOrPanelName`, then **truncate to 100 chars** via `truncZoho(s, max = 100)` (`:5029-5031`, `:5041-5042`) — Zoho's hard limit on item names. Truncation is a plain `slice`, so two long names sharing a 100-char prefix **collide into one Zoho item**. Watch for this on long profile/panel names.
2. `searchItemByName(name)` → if found, return `existing.item_id || existing.composite_item_id` (`:5043-5046`). Composite endpoints return the id under a different key depending on the call, hence the `||`.
3. **Two-component minimum** (`:5048-5061`). Zoho rejects a composite with a single unit-quantity child. When `mappedItems.length === 1 && mappedItems[0].quantity <= 1`, the code auto-appends the `Drilling-1` **service** item at qty 1 — resolved through `resolveSimpleItem("Drilling-1", true)`. Guarded so `Drilling-1` never pads itself (`:5051`) and never duplicates (`:5054`). A failure here is logged and swallowed (`:5057-5059`) — the composite create then proceeds and will likely fail at Zoho.
4. Same `cf_*` mapping as above (`:5063-5070`).
5. Payload (`:5072-5087`) — identical account ids, plus `unit: "pcs"` (**hard-coded**, unlike simple items) and `mapped_items: finalMappedItems`, each `{ item_id, quantity }`.
6. `POST /api/zoho/compositeitems` → returns `createData.compositeItem.composite_item_id || createData.compositeItem.item_id`.

#### `findExistingCompositeByRawMaterial(rawMaterialId, itemName)` — `CarcassBomBuilder.tsx:5104-5139`

A **stronger** idempotency check used for profile panels (`resolveProfileBOM`, `:5191`). Name equality alone is insufficient there: the same panel name can legitimately exist against different raw profiles. So it searches by name (same two-stage `search`→`name` fallback, `:5107-5118`), then for each candidate that looks composite — `is_combo_product === true || === "true" || item_type === "composite"` (`:5123`) — fetches `GET /api/zoho/compositeitems/{id}` and returns the id **only if** its component list contains `rawMaterialId` (`:5131`). Note the defensive read of the child list (`:5130`), since Zoho names it inconsistently across responses:

```ts
composite.mapped_items || composite.composite_item_line_items ||
composite.bundle_items || composite.line_items || composite.items || []
```

Errors per-candidate are swallowed via `continue` (`:5133-5135`); returns `null` when nothing matches, whereupon the caller creates a new panel.

#### `resolveHardwarePackComposite(packName, customFields?)` — `CarcassBomBuilder.tsx:5518-5546`

Turns a **pack name** into a Zoho composite backed by `HARDWARE_PACK_DEFINITIONS`.

1. `searchItemByName(packName)` → if found, return `item_id || composite_item_id` (`:5522-5525`). **Note: `packName` is passed raw here**, unlike the other resolvers — `searchItemByName` normalises internally, so this works, but it is an inconsistency.
2. `def = HARDWARE_PACK_DEFINITIONS[packName]` — an **exact, case-sensitive** key lookup (`:5527`).
3. `hwCf = { group: "Hardware Pack", ...customFields }` (`:5528`) — spread order means a caller-supplied `group` **overrides** the default.
4. **If defined**: resolve each component **sequentially** via `resolveSimpleItem(comp.component, false, { group: "Hardware Part", ...customFields }, comp.uom)`, collecting `{ item_id, quantity: comp.qty }`, then `resolveCompositeItem(packName, packName, mappedItems, hwCf)` — name and SKU are the same string (`:5531-5541`). Components are tagged `cf_group = "Hardware Part"`; the pack itself `cf_group = "Hardware Pack"`.
5. **If not defined**: silently falls back to `resolveSimpleItem(packName, false, hwCf, "Set")` — a flat, non-composite item (`:5544`). **A typo in a pack name does not raise an error**; it quietly creates a component-less item in Zoho. When a pack pushes with no children, suspect a key mismatch against `HARDWARE_PACK_DEFINITIONS` first.

#### `resolveHardwarePack(hardwareName, qty, packingHardwareId, customFields?)` — `CarcassBomBuilder.tsx:5548-5565`

A **different, simpler** helper — do not confuse it with the above. Wraps an arbitrary hardware item plus its packing item into a 2-child composite named:

```
Pack Hardware <hardwareName> x<qty>
```

SKU equals the name. Children: `{ physicalHardwareId, qty }` and `{ packingHardwareId, 1 }`. The physical item gets `cf_group = "Hardware Part"`; the pack gets `cf_group = "Hardware Pack"`.

#### `HARDWARE_PACK_DEFINITIONS` — `CarcassBomBuilder.tsx:5334-5516`

`Record<string, Array<{ component: string; qty: number; uom: string }>>` — the **hardware bill-of-materials master**, 33 packs. Keys are the exact pack names emitted by BOM generation; a mismatch triggers the silent fallback above.

Conventions visible in the data:
- Key suffix encodes pack size: `Set/3`, `SET/2`, `SET/1`. **Casing is inconsistent** (`Set/N` for hinges, `SET/N` for legs/drawers/fittings) and the lookup is case-sensitive — copy keys verbatim.
- Component strings are the full Zoho item names: `<TYPE> <DESCRIPTOR> <DIMENSIONS> <COLOR> <MODEL> <VENDOR-CODE>`, e.g. `HINGE 0 CRANK SOFT CLOSE 5 HOLE XX BLACK 3D MS CRY`. Trailing tokens are vendor abbreviations (`CRY`, `LIAN`, `CINE`, `EBC`, `REH`, `AGG`, `MOD`, `FTL`, `HI GOLD`, `NOUMI`, `HILTI`, `LOC`).
- `XX` is a literal placeholder inside names where a dimension is unspecified — **keep it**; it is part of the item name in Zoho.
- `uom` casing is inconsistent (`PCS` vs `Pcs`, `SET` vs `Set`). Harmless today because `unit` is never sent (§ step 4 above), but it would matter if UOM were re-enabled.
- `qty` may be fractional for consumables — e.g. `GLUE BONDTITE … XX AGG` at `0.04` Kg per 2-leg set, scaling linearly (`0.04`/`0.08`/`0.12` for SET/2, /4, /6 — `:5424`, `:5429`, `:5434`).

The 33 keys, grouped:

| Group | Keys |
|---|---|
| 3D hinge | `HARDWARE PACK 3D HINGE 0 CRANK Set/3`, `Set/4`, `Set/6` |
| Carcass hinge | `HARDWARE PACK HINGE 0 CRANK CARCASS Set/3` |
| Glass shutter hinge | `HARDWARE PACK SLIM HINGE FOR GLASS Set/3`, `Set/4`, `Set/5`, `Set/6` |
| Loft hinge (no soft close) | `HARDWARE PACK HINGE W/OUT SOFT CLOSE Set/3`, `Set/4`, `Set/5`, `Set/6` |
| Slim hinge | `HARDWARE PACK SLIM HINGE 0 CRANK Set/3`, `Set/5` |
| Blind hinge | `HARDWARE PACK BLIND HINGE 0 CRANK Set/3`, `Set/4`, `Set/6` |
| PVC leg | `HARDWARE PACK PVC LEG SET/2`, `SET/4`, `SET/6` |
| Carcass fixing | `HARDWARE PACK CARCASS FIXING HPL 4 SET/1` |
| Low-back drawer | `HARDWARE PACK LOW BACK DRAWER H90 SET/1`, `SET/2`, `SET/3` |
| High-back drawer | `HARDWARE PACK HIGH BACK DRAWER H175 SET/2`, `HARDWARE PACK HIGH BACK DRAWER H239 SET/1`, `SET/2` |
| Wall hanger | `HARDWARE PACK WALL HANGER BRACKET SET/1` |
| Drawer fixing | `HARDWARE PACK HB DRAWER 600MM FIXING SET/1`, `HARDWARE PACK DRAWER 450MM FIXING SET/1`, `DRAWER 600MM FIXING SET/1`, `DRAWER 900MM FIXING SET/1` |
| Bottle pullout | `HARDWARE PACK BOTTLE PULLOUT 150MM SET/1`, `300MM SET/1` |
| Kaku fitting | `HARDWARE PACK KAKU FITTING SET/2`, `SET/4` |

Two known data irregularities, preserved verbatim from the source sheet — **do not "fix" without confirming against the business owner**:

- `HARDWARE PACK LOW BACK DRAWER H90 SET/3` (`:5453-5458`) has `SCREW FOR CHIP BOARD 13XX4.8 SS 304 CINE` at qty **12**, while SET/1 is 12 and SET/2 is 24. The linear pattern implies 36. **Likely a data-entry bug.**
- `HARDWARE PACK WALL HANGER BRACKET SET/1` (`:5477-5483`) lists `COVER CAP LH …` with `uom: "SET"` but the RH counterpart with `uom: "PCS"`. Cosmetic while UOM is unsent.

A related lookup exists at `CarcassBomBuilder.tsx:2713` (`const def = HARDWARE_PACK_DEFINITIONS[itemName];`) used for on-screen pack expansion — it reads the same table, so edits stay consistent between the UI preview and the Zoho push.

### 1.12 Troubleshooting — Zoho

| Symptom | Likely cause | Fix |
|---|---|---|
| `Missing ZOHO_REFRESH_TOKEN. Add it to .env.local.` | One of the 4 required vars is unset/empty (`zoho.ts:34`) | Populate `.env.local` locally, or Vercel → Settings → Environment Variables. **Redeploy after adding** — Vercel env changes need a new deployment. |
| `Zoho token refresh failed: {"error":"invalid_client"}` | Client id/secret wrong, **or** minted on the `.com` (US) console | Re-do §1.3 on **`api-console.zoho.in`**. Check `ZOHO_ACCOUNTS_BASE_URL` is `https://accounts.zoho.in`. |
| `Zoho token refresh failed: {"error":"invalid_code"}` | Refresh token revoked, or evicted by the per-client token cap | Mint a fresh refresh token (§1.3). |
| `Zoho token refresh is cooling down. Try again in about N seconds.` | 5-min cooldown tripped (§1.7) | Wait N seconds. If recurring, look for a refresh loop or a torn cache — `rm -rf $TMPDIR/magppie-cache` locally to clear. |
| `Zoho is temporarily blocking token refresh…` | Zoho refresh rate limit hit | Wait ~5 min. Confirm the single-flight guard (`zoho.ts:135-139`) is intact and nothing calls `refreshZohoAccessToken()` directly. |
| Everything 500s only on Vercel, fine locally | Env vars set for the wrong Vercel environment, or set but not redeployed | Confirm the var exists on **Production** *and* **Preview**; redeploy. |
| `/api/zoho/status` returns `ok:true` but `organizationName: "Zoho Inventory"` | `ZOHO_ORGANIZATION_ID` matches no org the token can see (`status/route.ts:18`) | Re-derive the org id (§1.3 step 4); confirm the token belongs to the same Zoho account. |
| `{"code":57,"message":"You are not authorized…"}` — persists after retry | Scope too narrow, **or** the Zoho user's role lacks the module permission | Re-mint with the §1.3 scope list; check the user's role in Zoho admin. |
| Item created with **no** custom fields | A `cf_*` custom field doesn't exist in Zoho with that exact API name | Create the missing `cf_group` / `cf_sub_group` / `cf_finish` / `cf_thickness` / `cf_height` / `cf_width` / `cf_depth` in Zoho Settings. |
| `Failed to create item "…": {"code":…,"message":"Invalid value passed for account_id"}` | Hard-coded account ids don't belong to this org (`:5002-5003`, `:5010`) | Only org `60063687231` is supported. For another org, replace all three ids. |
| **Duplicate** items appear in Zoho after a re-push | `searchItemByName` missed — usually a name that changed shape (whitespace, `LH+RH` vs `LH/RH`, SO suffix) so normalisation no longer matches | Compare the two Zoho names after `normalizePartOrPanelName`. Never rename items in Zoho by hand — it breaks the idempotency key. |
| Two different panels **merged** into one Zoho item | 100-char `truncZoho` collision (`:5029-5031`) | Shorten the source names so they differ within the first 100 chars. |
| Composite create fails: "at least two items" | The `Drilling-1` auto-pad failed and was swallowed (`:5057-5059`) | Check the browser console for `Failed to auto-append Drilling-1 service`; ensure a `Drilling-1` service item is resolvable. |
| A hardware pack pushes as a flat item with no components | `packName` not an exact key of `HARDWARE_PACK_DEFINITIONS` → silent fallback (`:5544`) | Diff the name against the key list (§1.11). Mind `Set/N` vs `SET/N` casing. |
| Reorder report times out / 429s | Fan-out in `reorder-report/route.ts` (§1.10) | Reduce page depth or add caching. Consider raising the function timeout. |
| A search returns nothing though the item exists in Zoho | >200 matches; only page 1 is read (`items/route.ts:18`) | Narrow the search term, or add pagination to the route. |

---

## 2. OpenAI

### 2.1 Required environment variables

| Variable | Required | Contents |
|---|---|---|
| `OPENAI_API_KEY` | Yes (for the copilot only) | Standard OpenAI secret key, `sk-…`. **Placeholder: `<OPENAI_API_KEY>`** |

Present in `.env.local`, but **absent from `.env.example`** — add it there. Server-side only; the `OPENAI_` prefix (no `NEXT_PUBLIC_`) keeps it out of the client bundle. It is read at request time (`src/app/api/ai/chat/route.ts:7`), not module load, so a missing key degrades one feature rather than breaking boot.

### 2.2 `POST /api/ai/chat`

Implemented at `src/app/api/ai/chat/route.ts` (64 lines — the whole integration).

**Request body:**

```jsonc
{
  "messages": [ { "role": "user" | "assistant", "content": "…" } ],  // full prior turns, no system msg
  "context": { /* arbitrary JSON — see §2.4 */ }
}
```

**Upstream call** (`:30-44`) — plain `fetch`, no SDK dependency:

```
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer <OPENAI_API_KEY>
Content-Type: application/json

{ "model": "gpt-4o-mini", "temperature": 0.7,
  "messages": [ { "role": "system", "content": "<system prompt>" }, ...messages ] }
```

- **Model: `gpt-4o-mini`** — hard-coded at `:37`. Not configurable by env.
- **Temperature: `0.7`** — hard-coded at `:42`.
- No `max_tokens`, no streaming, no tool/function calling, no `response_format`. One shot, one reply.
- The system prompt is **always prepended server-side** and any client-sent `system` message is not stripped — a crafted client could inject a second system turn. Low risk (the app is password-gated) but worth noting.

**Response:** `{ "message": data.choices[0].message.content }` (`:55-57`). Unguarded index — a response with an empty `choices` array throws, caught by the outer handler and returned as a 500 (`:58-63`).

**Errors:** upstream non-OK → `{ error: "OpenAI API error: <raw body text>" }` at OpenAI's own status code (`:46-52`). Any throw → `{ error: <message> }` at 500.

### 2.3 System prompt

Built at `src/app/api/ai/chat/route.ts:15-28`. Verbatim domain knowledge it hard-codes — **this duplicates rules that also live in `CarcassBomBuilder.tsx`; if the engine's rules change, this prompt must be edited by hand or the copilot will confidently state stale rules**:

- **Identity:** "You are the Magppie BOM Copilot, an advanced AI assistant integrated into Magppie's Custom Cabinet Bill of Materials (BOM) & Inventory Management system." Goal: "assist the user in analyzing BOM data, verifying specs, estimating materials, and planning custom cabinet constructions."
- **Zones:** `BC/BCL` (Base), `BB/BBL` (Blind Base), `WC/WB` (Wall), `TC/TCL` (Tall), `LO/LB` (Loft).
- **Shutter designs:** `MD1`, `MD2`, `MD1CM1`, `MD1CM2`, `MD2CM1`, `MD2CM2`, `CL1`, `CL2`, `NEON20`.
- **Key Rule:** CM1/2 and CL1/2 styles are **EXCLUDED** for low-back drawer fronts (H90) and 150 mm-wide Bottle Pull Outs (BPO).
- **Key Rule:** `NEON20` is **never** allowed on drawer fronts.
- **Waste factors:** 17 % carcass panels · 0 % shutter panels · 20 % Elenor profiles · 25 % other profiles · 15 % stone. (Compare the `ELENOR_WASTE` / `PROFILE_WASTE` constants used at `CarcassBomBuilder.tsx:5197`.)
- Then, interpolated live: `` `Current application context provided by the page:\n${JSON.stringify(context || {}, null, 2)}` `` (`:25-26`).
- Closing instruction: "Be concise, helpful, and technically accurate. Format your responses in Markdown."

### 2.4 The `window.__BOM_CONTEXT__` contract

An **implicit global** that pages populate and the copilot reads. There is no shared type — it is `any` on both ends. Keep producer and consumer in sync manually.

**Consumer** — `src/components/AiCopilot.tsx:38`, read fresh on **every** send:

```ts
const context = (window as any).__BOM_CONTEXT__ || {};
```

Defaults to `{}`, so a page that sets nothing yields a working (context-free) copilot. It is read at send time, never cached, so it always reflects the latest render.

**Producer** — currently **only** `src/components/BomDashboard.tsx:793-812`, inside a `useEffect` keyed on `[stats, loadedOrders, filteredRows]`, so it re-publishes whenever the dashboard's data changes:

```ts
(window as any).__BOM_CONTEXT__ = {
  page: "dashboard",
  stats,
  orders: loadedOrders.map((o) => ({
    number: o.salesorder_number,
    customer: o.customer_name,
    status: o.status,
  })),
  criticalComponents: filteredRows
    .filter((r) => r.status === "out-of-stock" || r.status === "low-stock")
    .slice(0, 30)
    .map((r) => ({ name: r.itemName, sku: r.sku, status: r.status, qty: r.actualQuantity, uom: r.unit })),
};
```

The de-facto shape:

| Key | Type | Notes |
|---|---|---|
| `page` | `string` | Discriminator. Only `"dashboard"` exists today. Set it on any new producer. |
| `stats` | object | Dashboard aggregate, passed through whole. |
| `orders` | `Array<{ number, customer, status }>` | Projected — deliberately not the full SO object. |
| `criticalComponents` | `Array<{ name, sku, status, qty, uom }>` | **Only** `out-of-stock` / `low-stock` rows, **capped at 30** (`.slice(0, 30)`). |

The projection and the 30-cap are **prompt-budget controls** — the whole object is `JSON.stringify(..., null, 2)`'d into the system prompt on every turn (`chat/route.ts:26`), so it is re-billed each message. Adding a big field here inflates every request. Keep new producers projected and capped.

**Adding context to a new page:** set `window.__BOM_CONTEXT__` in a `useEffect` keyed on the data, with a distinct `page` value. No teardown exists today — the object persists across client-side navigation, so a page that doesn't set it will show the **previous** page's context to the copilot. Consider a cleanup return if this matters.

**PII note:** `orders[].customer` puts real customer names into an OpenAI request. Acceptable for an internal tool; flag if Magppie's data policy tightens.

### 2.5 Failure mode when the key is missing

`src/app/api/ai/chat/route.ts:7-13`:

```ts
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  return NextResponse.json({ error: "OpenAI API Key not configured on the server." }, { status: 500 });
}
```

The client (`AiCopilot.tsx:50-53`) reads `errData.error` and renders it as an assistant turn (`:56-64`):

> **Sorry, I encountered an error: OpenAI API Key not configured on the server.**

So a missing key is **contained**: the chat panel reports it inline, `loading` clears in `finally` (`:65-67`), and the rest of the app — including the entire Zoho BOM flow — is unaffected. **The copilot is strictly optional.** Deployments without `OPENAI_API_KEY` are fully functional apart from chat.

### 2.6 Troubleshooting — OpenAI

| Symptom | Cause | Fix |
|---|---|---|
| "OpenAI API Key not configured on the server." | `OPENAI_API_KEY` unset in that environment | Add it locally to `.env.local`, or Vercel → Env Vars → **redeploy**. |
| `OpenAI API error: {"error":{"code":"invalid_api_key"…}}` | Key wrong/revoked | Mint a new key at platform.openai.com. |
| `OpenAI API error: …insufficient_quota…` | Billing exhausted | Top up the OpenAI account. |
| `OpenAI API error: …rate_limit_exceeded…` (429) | Org rate limit | No retry/backoff exists — retry by hand, or add backoff at `:30`. |
| `OpenAI API error: …model_not_found…` | Key's org lacks `gpt-4o-mini` | Grant access, or change the hard-coded model at `:37`. |
| Copilot answers with generic, context-free replies | `window.__BOM_CONTEXT__` unset on that page | Only `BomDashboard` publishes it (§2.4). Add a producer. |
| Copilot cites a **stale** BOM rule | The system prompt duplicates engine rules and drifted | Edit `chat/route.ts:15-28` to match the engine. |
| Copilot shows the **previous** page's data | Context is a global with no teardown (§2.4) | Set `__BOM_CONTEXT__` on the new page, or clear it on unmount. |
| 500 with a `Cannot read properties of undefined` message | Empty `choices` at `:55` | Usually a transient upstream issue; guard the index if it recurs. |
| Long conversations get slow/expensive | Full history **plus** the re-stringified context are resent every turn | Truncate `messages` client-side, or cap context size. |

---

## 3. Vercel

### 3.1 Project

From `.vercel/project.json`:

| Field | Value |
|---|---|
| `projectName` | **`inventory-magppie`** |
| `projectId` | `prj_482trt4DNyT5BN0iA2JPWoVfH1rQ` |
| `orgId` | `team_3kNUUimkx3oLM7Mfudka1f6S` |
| Scope / team slug | `info-38418418s-projects` |
| Account | `info@mymagppie.com` |

Framework: Next.js **16.2.6** / React **19.2.6** (`package.json`). Builds run with the **WASM SWC** binary — `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs next build --webpack`. Both `--webpack` and the WASM env var are deliberate workarounds; dropping them may break the build on this toolchain.

### 3.2 Deploy

`deploy.sh` (repo root) is the sanctioned path:

```bash
#!/bin/bash
set -e
npx vercel login info@mymagppie.com
npx vercel link --scope info-38418418s-projects --yes
npx vercel --prod --yes
```

Or, once linked, simply:

```bash
npx vercel --prod          # production
npx vercel                 # preview
```

If the Vercel Git integration is connected, pushing to the default branch also triggers production.

### 3.3 Environment variable configuration (dashboard)

**Set env vars through the Vercel dashboard — not `add_envs.sh`** (which hard-codes live secrets; see §1.1).

1. Vercel → team `info-38418418s-projects` → project **`inventory-magppie`** → **Settings → Environment Variables**.
2. Add each of the seven, ticking **Production** *and* **Preview** (Development too if you use `vercel dev`):

   | Name | Value |
   |---|---|
   | `ZOHO_ORGANIZATION_ID` | `<ZOHO_ORGANIZATION_ID>` |
   | `ZOHO_REFRESH_TOKEN` | `<ZOHO_REFRESH_TOKEN>` — mark **Sensitive** |
   | `ZOHO_CLIENT_ID` | `<ZOHO_CLIENT_ID>` |
   | `ZOHO_CLIENT_SECRET` | `<ZOHO_CLIENT_SECRET>` — mark **Sensitive** |
   | `ZOHO_ACCOUNTS_BASE_URL` | `https://accounts.zoho.in` |
   | `ZOHO_INVENTORY_BASE_URL` | `https://www.zohoapis.in/inventory/v1` |
   | `OPENAI_API_KEY` | `<OPENAI_API_KEY>` — mark **Sensitive** |

3. **Redeploy.** Vercel bakes env vars at build/deploy time; an existing deployment will not pick them up.

CLI equivalent (prompts for the value — **never** pass secrets via `--value` in a committed script):

```bash
npx vercel env add ZOHO_REFRESH_TOKEN production --scope info-38418418s-projects
```

Pull them locally with `npx vercel env pull .env.local`.

**Serverless notes.**
- `/tmp` is writable — this is exactly why the token cache lives at `os.tmpdir()/magppie-cache/` (`zoho.ts:21-24`). The app directory is read-only.
- **Cache and cooldown are per-instance.** Multiple concurrent lambdas each hold their own token and their own cooldown (§1.7), multiplying refresh calls under fan-out. If Zoho refresh throttling becomes chronic, the fix is a **shared** token store (Vercel KV / Redis), replacing `readTokenCache`/`writeTokenCache` in `src/lib/zoho.ts`.
- `reorder-report` may exceed the default function timeout (§1.10); raise `maxDuration` if it does.
- All `/api/zoho/*` routes are dynamic (`export const dynamic = "force-dynamic"`), so they are never statically optimised.

### 3.4 Troubleshooting — Vercel

| Symptom | Cause | Fix |
|---|---|---|
| Build fails with an SWC/native-binary error | The WASM SWC workaround was dropped | Keep `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs` and `--webpack` in the `build` script. |
| App deploys but every Zoho call 500s | Env vars missing on that environment, or added without a redeploy | Check Settings → Env Vars for **Production** *and* **Preview**; redeploy. |
| Preview works, production doesn't (or vice versa) | Var ticked for only one environment | Tick both. |
| Zoho throttles refreshes only in production | Per-instance token cache × N lambdas (§3.3) | Move the cache to a shared store. |
| `vercel link` picks the wrong project | Wrong scope | `npx vercel link --scope info-38418418s-projects --yes`, or verify `.vercel/project.json`. |
| Reorder report 504s | Function timeout under fan-out | Raise `maxDuration`; cache; reduce page depth. |
| Need runtime logs | — | Vercel → project → **Logs**. Grep `[Zoho API Error]:` (`zoho.ts:228`). |

---

## 4. Webhooks / callbacks

**There are none.** A repo-wide search for `webhook`, `redirect_uri`, and `/api/callback` across `src/` returns no matches.

Specifically:

- **No inbound webhooks.** Zoho does not call this app. Nothing under `src/app/api/` is an event receiver — every route is a **pull**-side proxy invoked by this app's own UI.
- **No OAuth callback route.** The authorization-code leg is done once, by hand, via the Zoho **Self Client** console (§1.3). No `redirect_uri` is registered or served; the app only ever performs the refresh-token grant. Do not add an OAuth callback route expecting the current flow to use it.
- **No OpenAI callbacks.** `/api/ai/chat` is synchronous request/response — no streaming, no async job callback.
- **No Vercel deploy hooks** are referenced in the repo.

**Consequence — data is only ever as fresh as the last read.** Items, stock, SOs and POs changed *in Zoho* are invisible to the app until a user triggers a fetch. If near-real-time sync is ever needed, register a Zoho Inventory webhook against a new `POST /api/zoho/webhook` route and verify its signature — none of that exists today.

---

## 5. Cross-cutting security notes

Flagged here because they cut across the integrations:

1. **`add_envs.sh` and `vercel_env.log` contain live Zoho credentials in plaintext**, committed at the repo root. Revoke the self-client, re-mint, delete both files, and purge them from git history. See §1.1.
2. **The client auth password is hard-coded**: `src/components/AuthGate.tsx:27` compares against the string literal `"Factory@1234"` — shipped in the **client bundle** and readable by anyone who opens devtools. Auth state persists via `localStorage.getItem("app_authenticated")` (`AuthGate.tsx:12`), which is trivially forgeable. This gate is **cosmetic, not a security boundary**. It is the only thing standing between the public internet and every `/api/zoho/*` route — those routes have **no server-side auth at all**, so anyone who finds the deployment URL can create items in the production Zoho org directly. Replace with real server-side auth (middleware + session) before treating this app as protected.
3. **Zoho error bodies are echoed to the browser** verbatim via `toApiError` branch 3 (§1.9), leaking internal ids and Zoho schema details.
4. **`.env.local` / `.env.local.bak`** hold live secrets. Confirm `.gitignore` covers both.
5. **Hard-coded org-specific account ids** (`3418412000000000486`, `3418412000000000567`, `3418412000000000626`) at `CarcassBomBuilder.tsx:5002-5003`, `:5010`, `:5079-5081` — not a leak, but they bind the code to one Zoho org and belong in env.
