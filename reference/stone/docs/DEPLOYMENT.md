# Deployment

## Hosting
**Vercel** — project **`inventory-magppie`** (org/team `magppiesilverstonepvtltd`).
Production URL: **https://inventory-magppie.vercel.app**
The repo is **not a git repository** — deploys are made **directly from the local working copy** with the Vercel CLI. There is therefore **no git-push-triggered CI**; a deploy ships exactly what is on disk.

## Prerequisites
- Vercel CLI logged in (`vercel login`), project already linked (`.vercel/project.json` holds `projectId`/`orgId` — do **not** bundle it).
- All environment variables set in Vercel → Settings → Environment Variables → **Production** (see `ENVIRONMENT.md`).

## Deploy procedure (MANDATORY)
> **Rule:** never deploy unless the user explicitly authorizes that change ("deploy this" / "publish on vercel").

```bash
cd "Inventory - Magppie"

# 1) Verification loop — ALL THREE must pass first
npx tsc --noEmit                     # must be silent
node scratch/test-drawers.js         # must print: ALL TESTS PASSED SUCCESSFULLY!
npm run build                        # must complete

# 2) Ship
vercel --prod --yes

# 3) Confirm
curl -s -o /dev/null -w "%{http_code}\n" https://inventory-magppie.vercel.app/builder   # expect 200
```
The CLI prints a deployment id and aliases the production domain. Verify `readyState: READY`.

## Rollback
```bash
vercel ls inventory-magppie             # list deployments
vercel inspect <deployment-url>         # confirm the target
vercel promote <deployment-url>         # re-alias production to a previous good build
```
(Historically used: a previous deployment was re-promoted so an in-progress page would not ship while only env vars were updated.)

## Build configuration
`package.json` scripts pin the **webpack** builder and the wasm SWC binary — do not "modernise" these without testing; the wasm dir is required on this machine:
```json
"dev":   "NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs next dev --webpack -H 127.0.0.1",
"build": "NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs next build --webpack",
"start": "next start -H 127.0.0.1"
```
Output: `/`, `/builder`, `/designer`, `/planning`, `/reorder` prerender as **static**; `/api/**` and `/qr/bom/[orderId]` are **dynamic** (server-rendered on demand).

## Docker
**None today.** The app is a stock Next.js 16 app; if containerising: `node:24-alpine`, `npm ci`, `npm run build`, `next start -p $PORT`, pass the env vars listed in `ENVIRONMENT.md`. Note the wasm SWC env var must be set in the image too.

## CI/CD
**None today** (no git remote wired to Vercel, no test runner). Recommended: put the repo on git, add GitHub Actions running the 3-step verification loop on PR, and connect Vercel to the repo so production deploys require a green check.

## Reverse proxy / SSL / domains
Handled entirely by Vercel: automatic TLS, HTTP/2, the `*.vercel.app` alias. No custom domain configured. If one is added, set it in Vercel → Domains; no nginx/Apache is involved.

## Monitoring & logging
- Vercel dashboard: build logs, runtime logs, per-deployment inspector.
- `GET /api/zoho/status` is a live health probe (org name, base URL, token-cache state) — use it for uptime checks.
- No APM, error tracker (Sentry), or alerting is configured. **Recommended:** add Sentry + an uptime monitor on `/api/zoho/status`.
- Client errors surface only in the browser console and inline UI error slots.

## Backup strategy
- **Application data lives in Zoho Inventory**, not in this app — Zoho is the system of record and its own backup/retention applies. There is no database to back up.
- **Source:** currently only the local working copy → **risk**. Put it under git with an off-machine remote (P0 in `BACKLOG.md`).
- **Secrets:** `.env.local` exists only locally + in Vercel; store the Zoho client id/secret/refresh token in a password manager. Rotate the refresh token (see `INTEGRATIONS.md`).
- **Generated artefacts** (Excel/packing lists) are ephemeral downloads — regenerate from a Sales Order at any time.

## Environment parity
| | Local | Production |
|---|---|---|
| Host | `127.0.0.1:3000` (or `-p 3007`) | Vercel edge/serverless |
| Env | `.env.local` | Vercel env vars |
| Zoho | **same live India org** | same live India org |
> ⚠️ There is **no Zoho sandbox** — local development writes to the **real** Zoho organization. Be deliberate when testing pushes.

## Troubleshooting deploys
| Symptom | Fix |
|---|---|
| Build fails on SWC | ensure `@next/swc-wasm-nodejs` installed; `NEXT_TEST_WASM_DIR` set by the npm scripts |
| Deploy OK but Zoho errors | env vars missing/expired in Vercel; check `/api/zoho/status` |
| Wrong app on localhost | port 3000 may be another project — `lsof -a -p $(lsof -ti:3000 -sTCP:LISTEN) -d cwd`; run `npm run dev -- -p 3007` |
| Old code live | you deployed from a different directory — deploys come from the local CWD, not git |
