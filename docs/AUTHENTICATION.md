# Authentication

## Honest summary

**There is effectively no authentication.** What exists is a client-side
password prompt with a hardcoded value. It keeps casual visitors out of a
LAN-hosted tool. It is not a security control and must not be treated as one.
This was inherited from the stone app.

## How it works

`src/components/AuthGate.tsx` wraps the builder routes.

```
mount → read localStorage["app_authenticated"]
  → "true"  → render children
  → else    → render password form
              → compare against "Factory@1234"  (hardcoded, line 27)
              → match  → localStorage["app_authenticated"] = "true"
              → no     → show error
```

## What this means

| Property | Reality |
|---|---|
| Where the check runs | Browser only |
| Where the password lives | In the JS bundle, readable by anyone |
| Session store | `localStorage`, no expiry |
| Token | None — no JWT, no cookie, no session ID |
| Refresh flow | None; the flag never expires |
| Logout | None in the UI; clear `localStorage` manually |
| Server enforcement | **None** |

**The API routes are unprotected.** `/api/zoho/*` can be called directly with
curl, with no credential, regardless of `AuthGate`. Anyone who reaches the
server reaches Zoho through it. This is the single most important security
fact in the codebase.

## Roles and permissions

One shared role. No user identity, no permissions, no audit trail. Routes
differ by purpose, not privilege — anyone past the prompt can reach every
screen, including purchase-order creation.

## Middleware

There is no `middleware.ts`. Nothing intercepts requests.

## Zoho credentials — separate and correct

Do not confuse the two. Zoho credentials live **server-side only**, are never
sent to the browser, and use a proper refresh-token flow with automatic access
token renewal (`src/lib/zoho.ts`). That part is sound. It is app-level user
auth that does not exist.

## Fixing it — recommended order

1. **Move the password out of the bundle.** Server-side check via a route,
   comparing against an env var.
2. **Protect the API routes.** A `middleware.ts` matching `/api/:path*`,
   rejecting unauthenticated requests. Without this, step 1 is cosmetic.
3. **Real sessions.** Signed, httpOnly cookie with an expiry, or NextAuth.
4. **Roles.** Designer / planner / purchasing, at minimum gating PO creation.
5. **Audit trail.** Who changed which board on which order.

Steps 1 and 2 are the minimum before this is reachable from anything but a
trusted LAN.
