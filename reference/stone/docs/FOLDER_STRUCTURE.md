# Folder Structure

Complete project directory (as shipped in `source/`). Line counts show where the weight sits.

```
Inventory - Magppie/                      # repo root (Vercel project: inventory-magppie)
├── package.json                          # deps + scripts (dev/build use --webpack + wasm SWC)
├── package-lock.json
├── tsconfig.json
├── next.config.ts
├── .gitignore
├── .env.local                            # SECRETS — git-ignored, never bundled (see .env.example)
├── scratch/
│   └── test-drawers.js                   # drawer/shutter logic MIRROR + assertions (CI gate)
└── src/
    src/app/api/ai/chat/route.ts                               64 lines
    src/app/api/zoho/compositeitems/[id]/route.ts              43 lines
    src/app/api/zoho/compositeitems/route.ts                   26 lines
    src/app/api/zoho/contacts/[id]/route.ts                    57 lines
    src/app/api/zoho/contacts/route.ts                         30 lines
    src/app/api/zoho/items/[id]/route.ts                       43 lines
    src/app/api/zoho/items/[id]/vendors/route.ts               95 lines
    src/app/api/zoho/items/route.ts                            44 lines
    src/app/api/zoho/po-vendor-map/route.ts                    95 lines
    src/app/api/zoho/purchaseorders/route.ts                   71 lines
    src/app/api/zoho/reorder-report/route.ts                  216 lines
    src/app/api/zoho/salesorders/[id]/route.ts                 43 lines
    src/app/api/zoho/salesorders/route.ts                      30 lines
    src/app/api/zoho/status/route.ts                           31 lines
    src/app/builder/page.tsx                                    5 lines
    src/app/designer/page.tsx                                   7 lines
    src/app/globals.css                                      1532 lines
    src/app/layout.tsx                                         22 lines
    src/app/page.tsx                                            5 lines
    src/app/planning/page.tsx                                   7 lines
    src/app/qr/bom/[orderId]/page.tsx                           6 lines
    src/app/reorder/page.tsx                                    5 lines
    src/components/AiCopilot.tsx                              276 lines
    src/components/AuthGate.tsx                               353 lines
    src/components/BomDashboard.tsx                          2314 lines
    src/components/BomOrderCard.tsx                           124 lines
    src/components/CarcassBomBuilder.tsx                    11220 lines
    src/components/DraftPoModal.tsx                           447 lines
    src/components/QrBomPage.tsx                               56 lines
    src/components/ReorderReport.tsx                          467 lines
    src/data/planning_finishes.json                            34 lines
    src/data/profile_finishes.json                             23 lines
    src/data/stone_finishes.json                              176 lines
    src/lib/export.ts                                         402 lines
    src/lib/naming.ts                                         159 lines
    src/lib/rawmaterial.ts                                   1386 lines
    src/lib/report.ts                                         117 lines
    src/lib/stock.ts                                          338 lines
    src/lib/types.ts                                          152 lines
    src/lib/zoho.ts                                           242 lines
```

## What lives where

| Path | Responsibility |
|---|---|
| `src/app/layout.tsx` | Wraps every page in `AuthGate` + mounts `AiCopilot` |
| `src/app/page.tsx` | `/` → BOM backorder dashboard |
| `src/app/builder/page.tsx` | `/builder` → `<CarcassBomBuilder />` |
| `src/app/designer/page.tsx` | `/designer` → `<CarcassBomBuilder soMode />` |
| `src/app/planning/page.tsx` | `/planning` → `<CarcassBomBuilder soMode planningMode />` |
| `src/app/reorder/page.tsx` | `/reorder` → re-order level report |
| `src/app/qr/bom/[orderId]/page.tsx` | `/qr/bom/:id` → chrome-less single-SO BOM card |
| `src/app/api/zoho/**` | Thin server proxies to Zoho Inventory (India) |
| `src/app/api/ai/chat/route.ts` | OpenAI copilot proxy |
| `src/app/globals.css` | Design system: CSS variables, `.card`, `.clr`, `.grp`, print styles |
| `src/components/CarcassBomBuilder.tsx` | **The heart** — configurator + BOM engine + sections + exports + Zoho push |
| `src/components/BomDashboard.tsx` | Multi-SO report, QR, packing modal, accessories subform |
| `src/components/ReorderReport.tsx` / `DraftPoModal.tsx` | Purchase surfaces |
| `src/components/AuthGate.tsx` / `AiCopilot.tsx` | Shell |
| `src/lib/zoho.ts` | Token cache/refresh/cooldown + GET/PUT/POST helpers |
| `src/lib/rawmaterial.ts` | Stone/profile/hardware search + BOM-chain resolution |
| `src/lib/stock.ts` | BOM tree expansion, stock status, custom-field helpers |
| `src/lib/report.ts` / `export.ts` / `naming.ts` / `types.ts` | Report loading, dashboard export, name normalisation, shared types |
| `src/data/*.json` | Seed data: stone finishes by thickness, profile finishes, planning/PG maps |

## Conventions
- **One component per file**, PascalCase; routes are thin wrappers that only choose props.
- **Domain logic is NOT in `src/app`** — pages render components; components own logic (today, mostly `CarcassBomBuilder.tsx`).
- `scratch/test-drawers.js` is a required gate — keep it in sync with `addDrawerBoxes` / `shutSpec`.
