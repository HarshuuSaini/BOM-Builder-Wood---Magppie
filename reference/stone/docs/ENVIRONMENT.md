# Environment Configuration

## Files
| File | Purpose |
|---|---|
| `.env.local` | Real values for local dev. **Git-ignored. Never commit. Never bundle.** |
| `.env.example` | Template with placeholders (shipped in this package). |
| Vercel dashboard | Production values (Project → Settings → Environment Variables → Production). |

> Historical note: this repo has previously contained helper files with real values (`vercel_env.log`, `add_envs.sh`, `.env.local.bak`). **Those must never be included in any bundle or commit.** They are excluded from this package.

## Variables

| Variable | Required | Used by | Description |
|---|---|---|---|
| `ZOHO_ORGANIZATION_ID` | ✅ | every `/api/zoho/*` call | Numeric Zoho Inventory organization id. Sent as `organization_id` on each request. Verify via `GET /api/zoho/status`. |
| `ZOHO_CLIENT_ID` | ✅ | token refresh | OAuth client id from the **India** Zoho API console (`https://api-console.zoho.in`). Shape `1000.XXXX…`. |
| `ZOHO_CLIENT_SECRET` | ✅ | token refresh | OAuth client secret paired with the client id. |
| `ZOHO_REFRESH_TOKEN` | ✅ | token refresh | Long-lived refresh token (~70 chars, `1000.…`) issued from the **.in** DC. Exchanged for short-lived access tokens. **This is the app's entire Zoho authority — treat as a production credential.** |
| `ZOHO_ACCOUNTS_BASE_URL` | ✅ | token refresh | `https://accounts.zoho.in` — must match the org's DC. Using `.com` yields `invalid_code`. |
| `ZOHO_INVENTORY_BASE_URL` | ✅ | all Zoho API calls | `https://www.zohoapis.in/inventory/v1`. |
| `OPENAI_API_KEY` | ⬜ optional | `/api/ai/chat` | OpenAI key for the copilot (`gpt-4o-mini`). If missing, the endpoint returns "OpenAI API Key not configured on the server." and nothing else breaks. |

There are **no** `NEXT_PUBLIC_*` variables — no secret is exposed to the browser via env. (The client-side auth password is a **hard-coded constant in `AuthGate.tsx`**, not an env var — see `AUTHENTICATION.md`.)

## Setup — local
```bash
cp .env.example .env.local     # then fill in real values
npm install
npm run dev -- -p 3007         # port 3000 may be taken by another project
# → http://localhost:3007/builder
```
Verify Zoho wiring: open `http://localhost:3007/api/zoho/status` — it reports `ok`, the organization name, base URL, and token-cache state.

## Setup — Vercel (production)
1. Vercel → project `inventory-magppie` → Settings → Environment Variables.
2. Add each variable above for the **Production** environment (and Preview if you use it).
3. Redeploy: `vercel --prod` (only when explicitly authorized).

## Rotating the Zoho refresh token
See `docs/INTEGRATIONS.md` → "How to obtain a refresh token". Summary: create a Self Client in `api-console.zoho.in`, generate a grant code with the required scopes, exchange it for a refresh token, put it in `.env.local` **and** Vercel, then clear the token cache (restart the server / redeploy).

## Token cache location
Access tokens are cached in memory **and** on disk at `os.tmpdir()/magppie-cache/zoho-access-token.json`. Deleting that file forces a refresh. It contains a short-lived access token — treat it as sensitive; it is never bundled.

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `Missing ZOHO_…. Add it to .env.local.` | variable absent | add it; restart |
| `invalid_code` on refresh | dead/wrong-DC refresh token | re-issue from the **.in** console; update `.env.local` + Vercel |
| "Zoho token refresh is cooling down. Try again in about N seconds." | a refresh was rejected → 5-minute cooldown | wait, or fix the credential then restart to clear the cache |
| Copilot says key not configured | `OPENAI_API_KEY` unset | set it, or ignore (optional feature) |
