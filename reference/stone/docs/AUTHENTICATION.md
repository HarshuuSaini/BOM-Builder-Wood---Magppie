# Authentication & Authorization

> **Read this before touching anything security-related.** The short version: this app has **no real authentication**. It has a cosmetic client-side password gate over an application whose every API route is **fully open to the internet** and acts on the company's live Zoho Inventory tenant with a single shared service account. Everything below documents the system exactly as it exists today, then gives a prioritized hardening plan.

---

## 1. What exists today: `AuthGate`

**File:** `src/components/AuthGate.tsx` (353 lines, `"use client"`)
**Mounted in:** `src/app/layout.tsx:15` — wraps *all* page content and the AI copilot:

```tsx
// src/app/layout.tsx:11-21
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthGate>
          {children}
          <AiCopilot />
        </AuthGate>
      </body>
    </html>
  );
}
```

Because it is mounted in the root layout, `AuthGate` gates **every page route**: `/`, `/builder`, `/designer`, `/planning`, `/reorder`, `/qr/bom/[orderId]`. It gates **no API route** (see §3).

### 1.1 Component signature and state

```tsx
// src/components/AuthGate.tsx:5-9
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
```

The tri-state `isAuthenticated: boolean | null` drives three render branches:

| `isAuthenticated` | Rendered branch | File:line |
| --- | --- | --- |
| `null` (hydration, not yet checked) | Loading screen | `AuthGate.tsx:37-43` |
| `false` | Full-screen login gate | `AuthGate.tsx:45-350` |
| `true` | `<>{children}</>` — the real app | `AuthGate.tsx:352` |

### 1.2 The loading screen

```tsx
// src/components/AuthGate.tsx:37-43
if (isAuthenticated === null) {
  return (
    <div className="auth-loading-screen">
      <div className="auth-spinner" />
    </div>
  );
}
```

- `.auth-loading-screen` (`AuthGate.tsx:99-106`): `display:flex`, `height:100vh`, `width:100vw`, centered, background `#090a0f`.
- `.auth-spinner` (`AuthGate.tsx:108-115`): 40×40px, `border: 3px solid rgba(255,255,255,0.05)`, `border-top: 3px solid #0f766e`, `border-radius: 50%`, `animation: auth-spin 1s linear infinite`.
- `@keyframes auth-spin` (`AuthGate.tsx:117-120`): `0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); }`.

**Note the CSS-scoping bug:** the loading branch returns *before* the `<style jsx global>` block (which lives only inside the `!isAuthenticated` branch at `AuthGate.tsx:98-347`) is ever rendered. On a cold first paint the `.auth-loading-screen` / `.auth-spinner` classes have **no styles attached** unless a previous render already injected the global style. This is a real (cosmetic) defect — the loading state is typically an unstyled blank flash.

### 1.3 The persistence check (mount)

```tsx
// src/components/AuthGate.tsx:11-18
useEffect(() => {
  const auth = localStorage.getItem("app_authenticated");
  if (auth === "true") {
    setIsAuthenticated(true);
  } else {
    setIsAuthenticated(false);
  }
}, []);
```

- **Storage key:** `app_authenticated` (exact string).
- **Storage value:** the literal string `"true"`. Any other value (including absent) → gate shown.
- **Storage medium:** `localStorage` — origin-scoped, no expiry, survives tab close, browser restart, and reboot. There is **no TTL, no signature, no nonce, no server round-trip**.
- The effect runs client-side only, after hydration, hence the `null` → loading state.

### 1.4 The login handler, the hard-coded password, and the ~600 ms delay

```tsx
// src/components/AuthGate.tsx:20-35
const handleLogin = (e: React.FormEvent) => {
  e.preventDefault();
  setIsLoading(true);
  setError("");

  // Artificially delay slightly for a premium feedback transition
  setTimeout(() => {
    if (password === "Factory@1234") {
      localStorage.setItem("app_authenticated", "true");
      setIsAuthenticated(true);
    } else {
      setError("Invalid access password. Please try again.");
      setIsLoading(false);
    }
  }, 600);
};
```

Facts a successor must know:

- **The password is a bare string literal `"Factory@1234"` inline at `src/components/AuthGate.tsx:27`.** It is not a named constant, not an env var, not hashed. It is compiled into the client JS bundle and shipped to every visitor. `view-source` / DevTools → Sources → search `Factory@` recovers it in seconds.
  - **This is intentionally documented, not redacted.** It is not a secret in any meaningful sense — it is public the moment the app is deployed. Treating it as a secret would give a false sense of protection. It *is* flagged as issue **SEC-1** below.
  - Contrast with `.env` values (`ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_SECRET`, `OPENAI_API_KEY`): those are **real** secrets, server-only, and must never appear in docs, commits, or client code. This document uses placeholders for them throughout.
- **The ~600 ms delay** is `setTimeout(..., 600)` at `AuthGate.tsx:26,34`. The inline comment states the intent verbatim: `// Artificially delay slightly for a premium feedback transition`. It is **pure UX theatre** — it simulates a network call that does not exist. It is *not* rate limiting, *not* brute-force mitigation, and *not* timing-attack defence (the comparison is a plain `===` string compare, done client-side, and an attacker never has to go through this code path at all).
- On success: write `localStorage["app_authenticated"] = "true"`, then `setIsAuthenticated(true)`. On failure: set the error string, clear `isLoading`. Note `isLoading` is **not** reset on success (the component unmounts the gate anyway).
- **Failure is unlimited.** No attempt counter, no lockout, no backoff, no logging, no telemetry.

### 1.5 The gate UI (what a user sees)

Rendered when `isAuthenticated === false` (`AuthGate.tsx:45-350`):

- `.auth-root` (`AuthGate.tsx:122-132`): `position:fixed; inset:0;` centered flex, background `#07080c`, `z-index: 99999`, system font stack.
- Two decorative blurred spheres `.auth-glow-1` / `.auth-glow-2` (`AuthGate.tsx:49-50`, styles `134-155`): 500×500px, `filter: blur(120px)`, `opacity: 0.15`; sphere 1 is teal `#0f766e` top-left, sphere 2 is violet `#8b5cf6` bottom-right.
- `.auth-card` (`AuthGate.tsx:52`, styles `157-171`): glassmorphic — `background: rgba(255,255,255,0.02)`, `backdrop-filter: blur(20px)`, `border-radius: 24px`, `padding: 48px 40px`, `width: min(460px, 92vw)`; entry animation `auth-fade-in 0.4s cubic-bezier(0.16,1,0.3,1)`.
- Header (`AuthGate.tsx:53-57`): a teal gradient `M` logo tile (`.auth-logo`, 54×54px, `linear-gradient(135deg,#0f766e,#14b8a6)`), the `<h1>` **"Magppie Inventory"**, and the copy **"Enter the factory authorization password to access the BOM Backorder Dashboard."**
- Form (`AuthGate.tsx:59-91`):
  - Label **"Security Password"** for `<input id="auth-password" type="password" placeholder="••••••••" required autoFocus>`.
  - Error bubble `.auth-error-bubble` (`AuthGate.tsx:74-79`, styles `259-277`) with a `⚠` icon and `animation: auth-shake 0.35s ease` (translateX −6/+4/−4px), rendered only when `error` is non-empty. Copy: **"Invalid access password. Please try again."**
  - Submit button `.auth-submit-btn`: shows `.auth-btn-spinner` while `isLoading`, otherwise **"Verify Authorization"** plus a `→` arrow that translates 3px on hover.
- Footer (`AuthGate.tsx:93-95`): **"© 2026 Magppie Living Pvt Ltd. All rights reserved."**
- All CSS is a single `<style jsx global>` block at `AuthGate.tsx:98-347` (styled-jsx, global scope — the class names leak into the whole document).

### 1.6 There is no logout

**Confirmed by grep across `src/`:** the only references to `app_authenticated` are `AuthGate.tsx:12` (read) and `AuthGate.tsx:28` (write). There is:

- **No logout button, link, or menu item** anywhere in the app (not in `CarcassBomBuilder.tsx`'s header at `:8523-8548`, not in `BomDashboard.tsx`, not in `ReorderReport.tsx`).
- **No `localStorage.removeItem("app_authenticated")` call anywhere.**
- **No session expiry.** Once set, `app_authenticated === "true"` persists forever on that browser profile.

The only way to "log out" is to clear site data / localStorage manually via DevTools or browser settings. On a **shared factory-floor machine — which is the stated deployment context ("factory authorization password")** — this means the first person to authenticate permanently authenticates every subsequent user of that machine.

Unrelated localStorage keys, for orientation (not auth): `bom_accessory_subform_rows` and `bom_accessory_subform_counter` in `src/components/BomDashboard.tsx:672-673, 1208-1209`.

---

## 2. The real security posture (honest assessment)

### 2.1 `AuthGate` is decorative

`AuthGate` is a **client-side React conditional render**. It is not a security boundary. It stops a curious employee from seeing the dashboard by accident. It stops nothing else. Concretely, every one of these bypasses it in under a minute, with no tooling beyond a browser:

1. **Read the password out of the bundle.** It is the string `Factory@1234` at `AuthGate.tsx:27`, shipped verbatim in the client JS. DevTools → Sources → Ctrl-F.
2. **Set the flag directly.** Open the console on the deployed origin and run `localStorage.setItem("app_authenticated","true")`, then reload. No password needed.
3. **Ignore the UI entirely.** `curl https://<deployment>/api/zoho/status` — the API routes never consult `AuthGate` (it is client code; it does not run on the server). See §3.
4. **Disable JavaScript / use a non-browser client.** There is no server-rendered check to fall back to.

There is **no Next.js middleware** protecting anything: no `src/middleware.ts` or `middleware.ts` exists in the repo (the only `middleware-*` files found are build artifacts under `.next/`). There is no `getServerSession`, no cookie, no JWT, no `Authorization` header check anywhere in `src/`.

### 2.2 The critical issue: `/api/**` is 100% unauthenticated

**Every API route handler begins by parsing input and calling Zoho. Not one of them checks any credential, cookie, header, origin, or referrer.** Verified by reading all 13 route files. The complete, unauthenticated attack surface:

| Route | Methods | Effect on the live Zoho tenant | File |
| --- | --- | --- | --- |
| `/api/zoho/status` | `GET` | Reads org info; **leaks `organizationId`, `organizationName`, `inventoryBaseUrl`, `tokenCached`** to anonymous callers | `src/app/api/zoho/status/route.ts:14` |
| `/api/zoho/items` | `GET`, `POST` | Search items; **CREATE items** | `src/app/api/zoho/items/route.ts:11,31` |
| `/api/zoho/items/[id]` | `GET`, `PUT` | Read item; **MODIFY any item by id** | `src/app/api/zoho/items/[id]/route.ts:11,26` |
| `/api/zoho/items/[id]/vendors` | `GET` | Reads vendor + **historical purchase rates** for an item | `src/app/api/zoho/items/[id]/vendors/route.ts:34` |
| `/api/zoho/compositeitems` | `POST` | **CREATE composite items (BOMs)** | `src/app/api/zoho/compositeitems/route.ts:13` |
| `/api/zoho/compositeitems/[id]` | `GET`, `PUT` | Read; **MODIFY any composite item** | `src/app/api/zoho/compositeitems/[id]/route.ts:11,26` |
| `/api/zoho/salesorders` | `GET` | Search sales orders (min query length 2) | `src/app/api/zoho/salesorders/route.ts:11` |
| `/api/zoho/salesorders/[id]` | `GET`, `PUT` | Read; **MODIFY any sales order** | `src/app/api/zoho/salesorders/[id]/route.ts:11,26` |
| `/api/zoho/purchaseorders` | `GET`, `POST` | List POs; **CREATE purchase orders** | `src/app/api/zoho/purchaseorders/route.ts:30,52` |
| `/api/zoho/po-vendor-map` | `GET` | **Bulk-reads PO details → vendor/rate map** (commercially sensitive pricing) | `src/app/api/zoho/po-vendor-map/route.ts:40` |
| `/api/zoho/contacts` | `GET` | Lists up to 200 vendors/customers (**PII + supplier list**) | `src/app/api/zoho/contacts/route.ts:13` |
| `/api/zoho/contacts/[id]` | `GET` | Reads a contact incl. custom fields | `src/app/api/zoho/contacts/[id]/route.ts:39` |
| `/api/zoho/reorder-report` | `GET` | Bulk item + PO crawl (**expensive**; burns Zoho rate limit) | `src/app/api/zoho/reorder-report/route.ts:81` |
| `/api/ai/chat` | `POST` | Proxies to `https://api.openai.com/v1/chat/completions` on the server's `OPENAI_API_KEY` — **an open, billed LLM proxy** | `src/app/api/ai/chat/route.ts:3` |

**Stated plainly for the successor:** anyone who can reach the deployment URL — no password, no login, no referrer — can create purchase orders, rewrite sales orders, mutate inventory items and BOMs, enumerate your vendor list and negotiated rates, and burn your OpenAI budget. The `Factory@1234` gate is irrelevant to all of it. **If this deployment is on a public URL, treat it as already exposed.**

Two amplifiers:

- **`/api/ai/chat` is an unmetered LLM proxy.** `POST { messages, context }` at `src/app/api/ai/chat/route.ts:5` is forwarded to OpenAI with a server-side key. There is no rate limit, no length cap, no auth. The system prompt is server-supplied (`:15-33`) but the caller controls `messages` entirely.
- **`/api/zoho/reorder-report` is a DoS-by-cost vector.** It fans out across items and PO details; a handful of concurrent anonymous requests can exhaust the Zoho API rate limit, which trips the token-refresh cooldown (§4.3) and takes the app down for legitimate users for ~5 minutes.

### 2.3 Enumerated issues

| ID | Severity | Issue |
| --- | --- | --- |
| **SEC-1** | High | Password `Factory@1234` hard-coded in client code (`AuthGate.tsx:27`); public in the shipped bundle; unchangeable without a redeploy; shared by everyone. |
| **SEC-2** | **Critical** | All 13 `/api/**` routes are unauthenticated and mutate live Zoho data / spend money (§2.2). |
| **SEC-3** | High | Auth state is an unsigned, non-expiring client-writable localStorage flag (`app_authenticated="true"`). |
| **SEC-4** | Medium | No logout, no expiry — a shared factory terminal stays authenticated forever (§1.6). |
| **SEC-5** | Medium | No rate limiting or lockout on login; the 600 ms delay is cosmetic only. |
| **SEC-6** | Medium | No audit trail. Zoho sees one identity (§4), so a bad or accidental PO/SO edit is **not attributable to a human**. |
| **SEC-7** | Medium | `/api/zoho/status` leaks org id, org name, region base URL, and token-cache state anonymously. |
| **SEC-8** | Medium | Long-lived `ZOHO_REFRESH_TOKEN` with no documented rotation; `.env.local` and `.env.local.bak` exist in the working tree — **verify they are gitignored and never committed**. Also present in the repo root: `vercel_env.log`, `add_envs.sh` — audit both for leaked values before sharing this repo. |
| **SEC-9** | Low | `/qr/bom/[orderId]` (`src/app/qr/bom/[orderId]/page.tsx`) is designed for QR-code scanning from the shop floor, yet sits behind the same password gate — so the "public" scan flow is *both* gated (annoying for scanners) *and* insecure (the gate is bypassable). The underlying data path (`loadBomReport` in `src/lib/report.ts`, called at `QrBomPage.tsx:22`) hits the open API anyway. |
| **SEC-10** | Low | Access-token cache is written unencrypted to `path.join(os.tmpdir(), "magppie-cache", "zoho-access-token.json")` (`src/lib/zoho.ts:24`). Fine on ephemeral serverless; a real exposure on a shared/long-lived host. |

---

## 3. Where the boundary actually is

```
Browser
  │
  ├─ Page routes (/, /builder, /designer, /planning, /reorder, /qr/bom/:id)
  │     └─ AuthGate  ← client-side render check only. Cosmetic. Bypassable.
  │
  └─ /api/**  ← NO CHECK OF ANY KIND. Directly reachable.
        └─ src/lib/zoho.ts  ← attaches the shared service-account token
              └─ Zoho Inventory (LIVE tenant, org id from ZOHO_ORGANIZATION_ID)
```

The dotted line labelled "security" that most readers assume exists between `AuthGate` and `/api/**` **does not exist**. `AuthGate` runs in the browser; API routes run on the server; they never meet.

---

## 4. Zoho authentication: the service-account model

**File:** `src/lib/zoho.ts` (242 lines). This is the *only* place Zoho credentials are handled, and it is server-side only (it imports `node:fs/promises`, `node:os`, `node:path`, so it can never be bundled into client code).

### 4.1 Identity model — one shared robot user

There is **no per-user Zoho OAuth**. The app holds **one long-lived refresh token** belonging to a single Zoho account (a service/integration user), and **every request from every human is made as that one identity**.

Consequences a successor must internalize:

- Zoho's own audit log, "created by" / "last modified by" fields, and record history will show **the single service account** for every PO, SO edit, item, and composite item this app touches. The app **cannot tell you which human did what**, and neither can Zoho.
- Zoho's role/permission model is therefore useless as a control here: whatever the service account can do, **every anonymous internet caller can do** (via §2.2).
- The blast radius of the refresh token is the full Zoho Inventory scope granted to that OAuth client.

### 4.2 Required environment variables

```ts
// src/lib/zoho.ts:5-10
const REQUIRED_ENV = [
  "ZOHO_ORGANIZATION_ID",
  "ZOHO_REFRESH_TOKEN",
  "ZOHO_CLIENT_ID",
  "ZOHO_CLIENT_SECRET",
] as const;
```

`getEnv(name)` (`src/lib/zoho.ts:31-37`) throws `` `Missing ${name}. Add it to .env.local.` `` if any is falsy.

| Variable | Secret? | What it must contain | Default |
| --- | --- | --- | --- |
| `ZOHO_ORGANIZATION_ID` | No (but leaked anyway via `/api/zoho/status`) | The numeric Zoho Inventory organization id for the Magppie tenant | none — required |
| `ZOHO_REFRESH_TOKEN` | **YES — highest value secret** | The OAuth 2.0 refresh token (`1000.xxxx…`) issued to the service account for the Inventory scopes. Long-lived. **Never commit; never log; never send to the client.** | none — required |
| `ZOHO_CLIENT_ID` | Semi | The Zoho API-console OAuth client id (`1000.XXXXXXXX`) | none — required |
| `ZOHO_CLIENT_SECRET` | **YES** | The OAuth client secret paired with `ZOHO_CLIENT_ID` | none — required |
| `ZOHO_ACCOUNTS_BASE_URL` | No | Zoho accounts host for the data-centre region | `"https://accounts.zoho.in"` (`src/lib/zoho.ts:40`) |
| `ZOHO_INVENTORY_BASE_URL` | No | Zoho Inventory API base for the region | `"https://www.zohoapis.in/inventory/v1"` (`src/lib/zoho.ts:44`) |
| `OPENAI_API_KEY` | **YES** | OpenAI API key used **only** by `/api/ai/chat` (`src/app/api/ai/chat/route.ts:7`). If absent the route returns `{ error: "OpenAI API Key not configured on the server." }` with status `500`. | none — route degrades |

The `.in` defaults mean the tenant lives in the **Zoho India data centre**. If you ever see `.com` behavior, `ZOHO_ACCOUNTS_BASE_URL` / `ZOHO_INVENTORY_BASE_URL` have been overridden.

`.env.example` (repo root) shows the shape (secrets are placeholders there — keep it that way):

```
ZOHO_ORGANIZATION_ID=<numeric-org-id>
ZOHO_REFRESH_TOKEN=replace-with-refresh-token
ZOHO_CLIENT_ID=replace-with-client-id
ZOHO_CLIENT_SECRET=replace-with-client-secret
ZOHO_ACCOUNTS_BASE_URL=https://accounts.zoho.in
ZOHO_INVENTORY_BASE_URL=https://www.zohoapis.in/inventory/v1
```

**Where real values live:** `.env.local` for local dev (plus a stray `.env.local.bak`), and Vercel project environment variables for the deployment. `NEXT_PUBLIC_*` is **not** used for any credential — correct, and it must stay that way.

### 4.3 Token lifecycle: cache, refresh, cooldown, retry

Constants (`src/lib/zoho.ts:24-29`):

```ts
const TOKEN_CACHE_PATH = path.join(os.tmpdir(), "magppie-cache", "zoho-access-token.json");
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;   // 300000 — refresh 5 min early
const TOKEN_BACKOFF_MS      = 5 * 60 * 1000;   // 300000 — cooldown after rate limit

let cachedToken: TokenCache | null = null;     // in-memory, per serverless instance
let refreshPromise: Promise<string> | null = null; // single-flight lock
```

`TokenCache` shape (`src/lib/zoho.ts:14-19`): `{ token: string; expiresAt: number; refreshBlockedUntil?: number; lastError?: string }`.

**Two-tier cache.** `readTokenCache()` (`:51-61`) returns the in-memory `cachedToken` if set, else parses `TOKEN_CACHE_PATH` from disk, else `null`. `writeTokenCache()` (`:63-72`) always sets memory first, then best-effort `mkdir -p` + `writeFile` inside a `try/catch` that swallows errors. The comment at `:21-23` explains why `os.tmpdir()` and not `process.cwd()`: **`cwd` is read-only on Vercel/Lambda**; if even tmp fails, the in-memory token keeps a warm instance working. `clearTokenCache()` (`:74-81`) nulls memory and `rm -f`s the file.

**Freshness test** (`:47-49`): `hasUsableToken(cache)` ⇔ `cache.token` truthy **and** `cache.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS` — i.e. a token expiring within 5 minutes is treated as already stale.

**`getZohoAccessToken()`** (`:123-142`) — the single entry point:

1. `readTokenCache()`.
2. If `hasUsableToken(cache)` → return `cache.token`.
3. If `cache.refreshBlockedUntil > Date.now()` → **throw** `` `Zoho token refresh is cooling down. Try again in about ${waitSeconds} seconds.` `` where `waitSeconds = Math.ceil((refreshBlockedUntil - Date.now())/1000)`.
4. Otherwise single-flight: if `refreshPromise` is null, set it to `refreshZohoAccessToken()` with a `.finally(() => { refreshPromise = null; })`; return `refreshPromise`. **Concurrent callers on one instance share one refresh** — this is the guard against self-inflicted rate limiting.

**`refreshZohoAccessToken()`** (`:88-121`):

- Builds `URLSearchParams { refresh_token, client_id, client_secret, grant_type: "refresh_token" }` from env.
- `POST ${ZOHO_ACCOUNTS_BASE_URL}/oauth/v2/token?<params>` with `cache: "no-store"`. **Note: the credentials go in the query string, not the body** — this is Zoho's documented behavior, but it means the refresh token can land in any intermediary's access logs. Flag for hardening.
- On failure (`!response.ok || !body.access_token`):
  - If `isTokenRateLimit(body)` (`:83-86` — lowercased `JSON.stringify(body)` contains `"too many requests"` **or** `"access denied"`), write a poisoned cache entry `{ token: "", expiresAt: 0, refreshBlockedUntil: Date.now() + TOKEN_BACKOFF_MS, lastError: JSON.stringify(body) }` → **the 5-minute cooldown**.
  - Then throw `` `Zoho token refresh failed: ${JSON.stringify(body)}` ``.
- On success: `expiresAt = Date.now() + Number(body.expires_in ?? 3600) * 1000 - 30_000` (30 s safety margin on top of the 5 min skew), write cache, return the token.

**Request path.** `zohoInventoryRequest(method, path, params, payload)` (`:190-225`) is the shared core behind `zohoInventoryGet` (`:167`), `zohoInventoryPut` (`:174`), `zohoInventoryPost` (`:182`):

- `buildUrl()` (`:156-165`) always injects `organization_id` from `ZOHO_ORGANIZATION_ID` into the query, then any non-`undefined`/non-empty params.
- Header: `Authorization: Zoho-oauthtoken ${token}` (`:202`); `Content-Type: application/json` only when a payload exists; `cache: "no-store"`.
- **One automatic retry on auth failure** (`:213-218`): if `response.status === 401 || body.code === 57 || body.code === 14`, it `clearTokenCache()`s, fetches a fresh token, and replays the request exactly once. (Zoho codes: `14` invalid token, `57` unauthorized.)
- Error surface (`:220-222`): throws `JSON.stringify(body)` when `!response.ok` **or** `typeof body.code === "number" && body.code > 0` — Zoho returns HTTP 200 with a non-zero `code` on logical errors, hence the second condition.

**`toApiError(error)`** (`:227-241`) — used by every route's `catch`:

- `console.error('[Zoho API Error]:', error)` — **this logs raw Zoho error bodies to the server log. Audit that a refresh failure body never carries the token.**
- Passes through the `"cooling down"` message verbatim.
- Rewrites any `"too many requests"` error to the friendly: *"Zoho is temporarily blocking token refresh because too many refresh requests were made. The app will reuse cached tokens and wait before trying again."*
- Otherwise `{ error: error.message }`, or `{ error: "Unknown server error", detail: error }` for non-`Error` throws.

**`getZohoRuntimeInfo()`** (`:144-154`) returns `{ organizationId, accountsBaseUrl, inventoryBaseUrl, tokenCached, tokenExpiresAt, refreshBlockedUntil }`. It reads the module-level `cachedToken` **directly (not `readTokenCache()`), so it never hits disk** and will report `tokenCached: false` on a cold instance even when a valid token exists on disk. It is consumed by `/api/zoho/status` (`src/app/api/zoho/status/route.ts:15`) — which is how org metadata leaks anonymously (SEC-7) — and by `buildPoWebUrl()` (`src/app/api/zoho/purchaseorders/route.ts:4-17`) to map the API host to a web host (`zohoapis.in` → `inventory.zoho.in`).

---

## 5. Roles & permissions as they exist

### 5.1 There is no RBAC. At all.

To be unambiguous for the next AI:

- There is **no user record, no user id, no username field**. The login form has a password input and nothing else (`AuthGate.tsx:59-91`).
- There is **no role, group, claim, scope, or permission** value anywhere in `src/`.
- There is **exactly one credential** (`Factory@1234`) and **exactly one authenticated state** (`app_authenticated === "true"`).
- Passing the gate grants **identical, total access to every route and every capability**. A designer, a planner, a purchase clerk, and an anonymous stranger with the URL all have the same power.

### 5.2 `/designer` vs `/planning` vs `/builder` are **feature flags, not permissions**

All three routes render the **same component**, `CarcassBomBuilder` (`src/components/CarcassBomBuilder.tsx`, ~11,200 lines), with different props:

```tsx
// src/app/builder/page.tsx:3-5
export default function BuilderPage() { return <CarcassBomBuilder />; }            // soMode=false, planningMode=false

// src/app/designer/page.tsx:5-7
export default function DesignerPage() { return <CarcassBomBuilder soMode />; }    // soMode=true,  planningMode=false

// src/app/planning/page.tsx:5-7
export default function PlanningPage() { return <CarcassBomBuilder soMode planningMode />; } // both true
```

Signature (`src/components/CarcassBomBuilder.tsx:5567`):

```tsx
export function CarcassBomBuilder({ soMode = false, planningMode = false }: { soMode?: boolean; planningMode?: boolean } = {})
```

What the props actually change — **presentation and default state only**:

| Behaviour | `file:line` | Effect |
| --- | --- | --- |
| Default tab | `:5602` | `useState<"pk"\|"raw"\|"proj">(soMode ? "proj" : "pk")` |
| SO → BoM auto-explode effect | `:5901` (`if (!soMode) return;`), deps `:5911` | Only runs in SO mode |
| Designer Excel upload | `:5914` — `const canDesignerUpload = soMode && !planningMode; // the /designer page only` | Upload UI **only on `/designer`** |
| Header subtitle | `:8526-8531` | `planningMode` → "Planning · Upload cabinet codes / Sales Order → choose shutter colour → BoM"; `soMode` → "Designer · Sales Order → cabinet codes fetched → Raw BoM → Project Totals"; else → "Kitchen Carcass · Code → Packets → Raw BoM → Project Totals" |
| Header `<h1>` | `:8532` | `"Planning → BoM"` / `"Sales Order → BoM (Designer)"` / `"Carcass Code & BoM Builder"` |
| Layout + hidden panels | `:8560, 8562, 8868, 8902, 8927, 8933, 8934, 8935` | `soMode` collapses the grid to `1fr` and applies `style={{ display: "none" }}` to the code-entry box, add-row, meta panel, and the **Packets** / **Raw BoM** tabs |

**Read that last row carefully: `soMode` hides tabs with CSS `display:none`.** The components are still mounted and every handler is still live. The "restriction" is visual. A planner can reach designer functionality by navigating to `/designer`, or by deleting a style attribute in DevTools, or by calling the API directly. **None of this is a permission boundary — do not document or reason about it as one.**

### 5.3 Intended personas (mapped from code comments and UI copy — aspirational, unenforced)

| Persona | Intended route | Intended job | What actually stops them from doing everything else |
| --- | --- | --- | --- |
| Factory / production floor | `/` (`BomDashboard`) and `/qr/bom/[orderId]` | View BOM backorder status; scan a QR to see the BOM for an order | Nothing |
| Kitchen designer / estimator | `/builder` | Type cabinet codes → packets → raw BoM → project totals (the create flow) | Nothing |
| Designer (SO-driven) | `/designer` | Fetch cabinet codes **from** a Zoho Sales Order and explode into BoM/exports (comment at `src/app/designer/page.tsx:3-4`); **exclusive** owner of the Excel cabinet-code upload (`CarcassBomBuilder.tsx:5914`) | Nothing |
| Planning team | `/planning` | Same SO → BoM behaviour "plus (upcoming) an Excel cabinet-code upload where the designer chooses the shutter colour" (comment at `src/app/planning/page.tsx:3-4`) | Nothing |
| Purchase / store | `/reorder` (`ReorderReport`) | Reorder report; raise draft POs via `DraftPoModal` → `POST /api/zoho/purchaseorders` | Nothing |
| Anonymous internet | any | — | Nothing (§2.2) |

The **persona-to-route mapping is a convention communicated by bookmark, not a control.** Every persona shares the one password; every persona can visit every route; every persona (and every stranger) can call every API.

---

## 6. Recommended hardening plan (prioritized)

Ordered by risk-reduction per unit of effort. **P0 items should be treated as incidents, not backlog.**

### P0 — do this first (hours, not sprints)

1. **Assume the current deployment is compromised, and contain it.**
   - If the Vercel deployment is on a public URL, **put it behind Vercel's Deployment Protection (password / SSO / trusted IPs) today**. This is a config toggle and is the single highest-value action available: it protects `/api/**`, which nothing in the code does.
   - **Rotate `ZOHO_REFRESH_TOKEN` and `ZOHO_CLIENT_SECRET` now**, and rotate `OPENAI_API_KEY`. Assume all are exposed until proven otherwise. Revoke the old refresh token in the Zoho API console so it cannot be replayed.
   - **Audit Zoho's history** for the service account: unexpected purchase orders, sales-order edits, item changes. Check the OpenAI usage dashboard for anomalous spend via `/api/ai/chat`.
   - **Audit the repo for leaked secrets** before this handover package goes anywhere: `.env.local`, `.env.local.bak`, `vercel_env.log`, `add_envs.sh`, and the several `*.zip` handoff bundles in the repo root. Confirm `.gitignore` covers `.env*` and that nothing secret is in git history (`git log -p -- .env.local`, or run `gitleaks`/`trufflehog`). If any secret was ever committed, rotation (above) is mandatory, not optional.

2. **Protect `/api/**` in the application itself (defence in depth — do not rely on the platform toggle alone).**
   - Add `src/middleware.ts` with `export const config = { matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"] }` and reject any request without a valid session **before** any handler runs. Fail **closed** — deny by default, allowlist explicitly.
   - Verify with `curl -i https://<deployment>/api/zoho/status` from a clean session: it must return `401`, not org metadata.
   - Add a per-IP/per-session rate limit on `/api/zoho/reorder-report`, `/api/zoho/po-vendor-map` (both fan out) and `/api/ai/chat` (billed).

### P1 — replace the gate with real server-side auth (days)

3. **Delete the client-side gate; move the decision to the server.**
   - Remove the `password === "Factory@1234"` literal (`AuthGate.tsx:27`) and the `app_authenticated` localStorage flag entirely. Do not "fix" it by moving the string to an env var — a client-side comparison is a client-side comparison regardless of where the string came from.
   - Add `POST /api/auth/login` that verifies credentials **server-side** and sets an **`httpOnly`, `Secure`, `SameSite=Lax`, signed** session cookie with a real expiry (e.g. 8 h idle / 12 h absolute — one factory shift). `AuthGate` shrinks to a presentational component that renders the (now genuinely enforced) redirect from middleware; keep the existing card UI, it's fine.
   - Delete the `setTimeout(..., 600)` theatre (`AuthGate.tsx:26,34`) — a real network round-trip supplies the latency, and honestly.
   - Prefer **not building auth yourself**: NextAuth/Auth.js or Clerk with **Google Workspace SSO on the `mymagppie.com` domain** is less code and better security than any bespoke password flow. Employees already have accounts; offboarding then actually revokes access.

4. **Per-user identity + real roles.**
   - Give each human a user record. Introduce a `role` enum sized to the personas already in §5.3: `factory` (`/`, `/qr/*` read-only), `designer` (`/builder`, `/designer`), `planning` (`/planning`), `purchase` (`/reorder`, PO creation), `admin`.
   - **Enforce in middleware and in each route handler, not in the component.** Replace `style={{ display: "none" }}` gating (`CarcassBomBuilder.tsx:8562, 8868, 8902, 8927, 8933-8935`) with server-checked capability props — keep the hiding for UX, but never let it be the only check.
   - Map write capability to role: `POST /api/zoho/purchaseorders` → `purchase`+`admin`; `PUT /api/zoho/salesorders/[id]` and `PUT /api/zoho/items/[id]` → `admin` (these are the most destructive endpoints and are currently anonymous).
   - Decide `/qr/bom/[orderId]` deliberately (SEC-9): either genuinely public with an **unguessable signed token in the URL** and a **read-only, minimal payload**, or fully authenticated. It cannot stay "gated by something that doesn't gate."

5. **Secret management.**
   - Secrets live only in Vercel env vars (Production/Preview/Development scoped separately) or a manager (Doppler / 1Password / Vercel + `vercel env pull`). Nothing in git, nothing in `.zip` handoffs, nothing in `*.log`.
   - **Give Preview deployments their own Zoho sandbox org and their own OAuth client.** Today a Preview URL — often less protected — points at the production tenant.
   - Scrub logs: review `console.error('[Zoho API Error]:', error)` (`src/lib/zoho.ts:228`) and the thrown `` `Zoho token refresh failed: ${JSON.stringify(body)}` `` (`:111`) so no credential can reach a log sink. Redact before logging.
   - Ask Zoho support / check the console whether the refresh-token grant can be sent as a **POST body** rather than a query string (`src/lib/zoho.ts:96`) to keep it out of intermediary access logs.

### P2 — durability and accountability (weeks)

6. **Refresh-token rotation, as a routine.**
   - Document and calendar a rotation (quarterly, and immediately on any offboarding or suspected exposure). Write the runbook: generate in the Zoho API console → update Vercel env → redeploy → verify `GET /api/zoho/status` → revoke the old token.
   - Scope the OAuth client to the **minimum** Zoho scopes actually used (items, compositeitems, salesorders, purchaseorders, contacts, organizations — read/write as needed). Today's grant is almost certainly broader than the code needs.
   - Surface refresh health: `refreshBlockedUntil` / `lastError` already exist on `TokenCache` (`src/lib/zoho.ts:17-18`) — alert on the cooldown instead of letting users discover it as a 500.

7. **Audit trail — the fix for SEC-6.**
   - Log every mutating call server-side: `{ timestamp, userId, userEmail, role, ip, method, route, zohoObjectType, zohoObjectId, requestSummary, outcome }`. Persist outside the app (Vercel Log Drain, or a `audit_log` table).
   - Stamp attribution **into Zoho** so it survives outside this app: write the acting user's email into a custom field or the notes/reference field on records created by `POST /api/zoho/purchaseorders` and `POST /api/zoho/compositeitems`. Without this, Zoho's own history is permanently useless for attribution (§4.1) — the shared service account is unavoidable, so compensate at the record level.
   - Log auth events too: login success/failure, lockout, logout.

8. **Login hygiene.** Once auth is server-side: per-IP and per-account rate limiting with exponential backoff, account lockout after N failures, structured logging of failures. (These are meaningless before P1 — there is nothing to brute-force when the front door is the API.)

9. **Session UX.** Add a visible logout control in the shared app header (`CarcassBomBuilder.tsx:8534-8548` alongside the existing `BOM Dashboard` nav link, and equivalently in `BomDashboard` / `ReorderReport`) that clears the server session and cookie. Add an idle timeout — this is the direct remedy for the shared-factory-terminal problem (SEC-4).

10. **Regression-proof it.** Add a test that asserts every route under `src/app/api/**` returns `401` without a session — so the next feature route cannot silently reopen SEC-2. A simple filesystem-walk test over `src/app/api` that fetches each route unauthenticated is enough, and it is the single most valuable test this repo could have.
