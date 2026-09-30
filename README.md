# Magppie — Wood Kitchen BOM Builder

Configure plywood kitchen cabinets and generate a manufacturing bill of
materials: panel cut list, hardware, consumables and board sheet counts,
resolved against Zoho Inventory for stock and purchasing.

This is a **port of Magppie's Stone Kitchen BOM Builder**. Same catalog, same
BOM pipeline, same output format. Only construction logic differs. A reference
copy of the original lives in `reference/stone/`.

---

## Quick start

Requires **Node 20+**.

```bash
cd source
npm ci
npm run dev
```

Open **http://127.0.0.1:3000** → *Builder*. Password: `Factory@1234`.

No environment file is needed to build cabinets and export a BOM. Zoho
variables are only required for the sales-order, stock and reorder features.

---

## Documentation

Read in this order:

1. **`docs/AI_MEMORY.md`** — philosophy, architecture, business rules,
   assumptions, limitations. Everything needed to continue.
2. **`docs/PORTING_NOTES.md`** — what changed from stone, and crucially the
   **delete list**. Without it you will hunt for a wood equivalent of a stepper
   profile that was removed on purpose.
3. **`docs/BUSINESS_LOGIC.md`** — construction rules and formulas.

Then as needed: `CHAT_SUMMARY.md` (full decision history) ·
`PROJECT_OVERVIEW.md` · `CODE_DOCUMENTATION.md` · `FOLDER_STRUCTURE.md` ·
`API.md` · `DATABASE.md` · `UI_UX.md` · `WORKFLOWS.md` · `INTEGRATIONS.md` ·
`ENVIRONMENT.md` · `AUTHENTICATION.md` · `DEPENDENCIES.md` · `DEPLOYMENT.md` ·
`TESTING.md` · `BUGS.md` · `BACKLOG.md`.

Planning artefacts, including the original handwritten notes, are in
`docs/artefacts/`.

---

## Routes

| Route | Purpose |
|---|---|
| `/` | Landing |
| `/builder` | Cabinet builder |
| `/designer` | Builder, sales-order mode |
| `/planning` | Builder, planning mode |
| `/dashboard` | Zoho orders, raw material, stock |
| `/reorder` | Reorder report |
| `/qr/bom/[orderId]` | Shop-floor BOM |

---

## Setup

```bash
cd source
cp .env.example .env.local
```

Fill the four Zoho values (`ZOHO_ORGANIZATION_ID`, `ZOHO_REFRESH_TOKEN`,
`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`). See `docs/ENVIRONMENT.md` for how to
obtain them and `docs/INTEGRATIONS.md` for the required scopes.

Verify with `GET /api/zoho/status`.

---

## Build

```bash
npm run build
npm start
```

Both `dev` and `start` bind `127.0.0.1`. In a container override to `0.0.0.0`.

---

## Verify a change

```bash
npx tsc --noEmit          # 2 inherited BomDashboard errors are expected
cd tools/smoke && ./build.sh && node run.js
```

A `BC.SH` 600 × 720 × 560 on board option A must yield **22.978 sqft** and
**11.806 RMT**.

---

## Troubleshooting

**`npm install` fails with 403.** A proxy is blocking the registry. Not a
project fault.

**Build tries to fetch a native SWC binary.** `--webpack` or
`NEXT_TEST_WASM_DIR` was dropped from `package.json`. See
`docs/DEPENDENCIES.md`.

**Not reachable from another machine.** Both scripts bind `127.0.0.1`. Change
the `-H` flag.

**Raw material section is empty.** Almost certainly `BOARD_GROUP_TOKENS` in
`src/lib/rawmaterial.ts` not matching your Zoho `cf_group` values. **It fails
silently** — no error, just nothing. This is the most common Zoho problem.

**401 from every Zoho route.** Bad refresh token, or wrong region. Defaults are
the India datacentre.

**A cabinet is missing panels.** Look for the amber stub panel — it names what
is missing and why. See `docs/BUGS.md`.

---

## FAQ

**Why is there no database?** Zoho Inventory remains the system of record for
orders and stock. Product costing is intentionally different: the approved
`KITCHEN` master is bundled as `source/src/data/costing_master.json` so costing
does not depend on the Zoho custom module.

**Why do so many files say "verbatim from stone"?** Because porting beats
rewriting. Every time that rule was broken during the build it produced a bug.

**Why do some cabinets refuse to emit panels?** They are stubbed — a real
dimension is unknown. Guessing a drawer height produces scrap. Supply the
number and the stub disappears.

**A WST wall unit gets a ply shelf, but stone gave it glass.** Correct. Shelf
material now derives from shutter type, not zone. Not a porting bug.

**Is it production ready?** No. The API routes are unauthenticated and the app
password sits in the client bundle. See `docs/BUGS.md` D1 and D2.
