# Environment Configuration

Copy `source/.env.example` to `source/.env.local` and fill it in. Never commit
`.env.local` — it is in `.gitignore`.

## Nothing is required to build cabinets

The builder, all three tabs, board totals and CSV export are entirely
client-side. You can run the app with **no environment file at all** and use
`/builder` fully. Variables are only needed for Zoho-backed features.

## Variables

### Required for Zoho

| Variable | Description |
|---|---|
| `ZOHO_ORGANIZATION_ID` | Numeric org ID. Zoho Inventory → Settings → Organisation Profile. |
| `ZOHO_REFRESH_TOKEN` | Long-lived token from the one-time grant exchange. Does not expire; revoking it in the API console breaks the app immediately. |
| `ZOHO_CLIENT_ID` | Self Client ID from api-console. |
| `ZOHO_CLIENT_SECRET` | Self Client secret. Server-side only — never expose to the browser. |

All four are read by `src/lib/zoho.ts` via `getEnv()`, which **throws** if one
is missing. A partially filled file fails as loudly as an empty one.

### Optional

| Variable | Default | Description |
|---|---|---|
| `ZOHO_ACCOUNTS_BASE_URL` | `https://accounts.zoho.in` | OAuth host. Change for `.com` / `.eu` orgs. |
| `ZOHO_INVENTORY_BASE_URL` | `https://www.zohoapis.in/inventory/v1` | API host. Must match the accounts region. |
| `OPENAI_API_KEY` | — | AI copilot only. |

## Naming and exposure

No variable is prefixed `NEXT_PUBLIC_`, and none should be. Every one is read
in server-side route handlers or `src/lib/zoho.ts`. Prefixing any of these
would ship the secret to the browser.

## Setup

1. `cd source && cp .env.example .env.local`
2. Get the org ID from Zoho Inventory settings.
3. Register a **Self Client** at `https://api-console.zoho.in`.
4. Generate a grant token with the scopes in `INTEGRATIONS.md`.
5. Exchange it once for a refresh token (grant tokens expire in minutes).
6. Fill all four values.
7. `npm run dev`, then check `GET /api/zoho/status`.

## Not in the environment — but should be

The `AuthGate` password is **hardcoded** at `src/components/AuthGate.tsx:27`
as `Factory@1234`, carried over from stone. Move it to an env var before
deployment. It is currently in the client bundle and readable by anyone.

## Per-environment guidance

| | Development | Production |
|---|---|---|
| Zoho org | A sandbox org if available | Live |
| Secrets | `.env.local` | Platform secret store, never a file in the image |
| `OPENAI_API_KEY` | Optional | Optional |
| Auth password | Hardcoded (known issue) | Must be an env var |
