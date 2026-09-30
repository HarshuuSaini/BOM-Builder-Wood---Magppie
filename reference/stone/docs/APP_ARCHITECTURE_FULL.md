# Magppie Carcass BOM Builder — Full Application Architecture

> Self-contained architecture reference. Upload this file to any AI to give it complete context on the system: what it does, how it is structured, the data model, the data flow, every module's responsibility, external integrations, and the core domain rules. Paired document: `requirements.md` (461 implementation-agnostic requirements). Last updated 2026-07.

---

## 1. What the product is

A factory / back-office web app for **Magppie** (a stone modular-kitchen manufacturer). A user configures a kitchen cabinet (zone, family, variant, size, handle, design, materials); the app derives:

- a canonical **11-field cabinet code** and per-leaf **shutter codes**,
- a full multi-level **Bill of Materials** (stone panels, aluminium profiles, hardware packs, consumables, cut/drill operations),
- **purchase roll-ups** with waste and weight,
- factory outputs (**cutting/opti lists, packing lists, box labels, QR codes, Excel/CSV**),
- and idempotent **Zoho Inventory (India)** records — composite items + Sales-Order lines.

Secondary surfaces: a multi-SO **BOM backorder dashboard**, a **re-order level report** with draft-PO creation, a **designer** page (per-price-group shutter-colour picking against a Zoho SO), and a **planning** page (decode SO service lines into BOMs and replace them on the SO).

## 2. Tech stack

- **Next.js 16** (App Router, **webpack** builder + wasm SWC — not Turbopack), **React 19**, **TypeScript 5.9**, **Node 24**.
- Client-heavy: nearly all domain logic runs in the browser inside one large React component; Next API routes are thin Zoho/OpenAI proxies.
- Dependencies (only these): `next`, `react`, `react-dom`, `xlsx` + `xlsx-js-style` (Excel), `jspdf` (PDF), `qrcode`, `jsbarcode`.
- Scripts: `dev` / `build` use `next --webpack` with `NEXT_TEST_WASM_DIR`; host bound to `127.0.0.1`.
- **Deploy:** Vercel (project `inventory-magppie`, `vercel --prod`). **Verification loop** before any deploy: `npx tsc --noEmit`; `node scratch/test-drawers.js` (must print `ALL TESTS PASSED SUCCESSFULLY!`); `npm run build`.
- **Secrets** in `.env.local` (never bundled): `ZOHO_ORGANIZATION_ID`, `ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `OPENAI_API_KEY`, `APP` security password (client gate hard-codes `Factory@1234`). Zoho DC = India (`accounts.zoho.in` / `zohoapis.in`), org **60063687231** (MAGPPIE SILVERSTONE PRIVATE LIMITED).

## 3. Directory & file map (real, with line counts)

```
src/
├── app/                                    # Next.js App Router
│   ├── layout.tsx (22)                      # wraps everything in <AuthGate> + <AiCopilot>
│   ├── page.tsx (5)                         # "/"        → BomDashboard
│   ├── builder/page.tsx (5)                 # "/builder" → <CarcassBomBuilder/>
│   ├── designer/page.tsx (7)                # "/designer"→ <CarcassBomBuilder soMode/>
│   ├── planning/page.tsx (7)                # "/planning"→ <CarcassBomBuilder soMode planningMode/>
│   ├── reorder/page.tsx (5)                 # "/reorder" → ReorderReport
│   ├── qr/bom/[orderId]/page.tsx (6)        # "/qr/bom/:id" → QrBomPage (chrome-less)
│   ├── globals.css
│   └── api/
│       ├── ai/chat/route.ts (64)            # OpenAI gpt-4o-mini copilot proxy
│       └── zoho/
│           ├── status/route.ts (31)         # health + token-cache state
│           ├── items/route.ts (44)          # search/create items
│           ├── items/[id]/route.ts (43)     # get/update item
│           ├── items/[id]/vendors/route.ts (95)
│           ├── compositeitems/route.ts (26) + [id]/route.ts (43)
│           ├── salesorders/route.ts (30) + [id]/route.ts (43)
│           ├── contacts/route.ts (30) + [id]/route.ts (57)
│           ├── purchaseorders/route.ts (71)     # create draft PO
│           ├── po-vendor-map/route.ts (95)      # batch "item → last vendor" lookup
│           └── reorder-report/route.ts (216)    # low-stock scan + vendor/lead-time hydrate
├── components/
│   ├── AuthGate.tsx (353)                   # full-screen password gate; localStorage app_authenticated
│   ├── AiCopilot.tsx (276)                  # floating chat; posts window.__BOM_CONTEXT__ to /api/ai/chat
│   ├── CarcassBomBuilder.tsx (11,220)       # ★ the heart: configurator + BOM engine + all sections + exports + Zoho push
│   ├── BomDashboard.tsx (2,314)             # "/" multi-SO backorder report, QR, packing modal, accessories subform, draft-PO
│   ├── BomOrderCard.tsx (124)               # one SO's expanded BOM tree row-renderer
│   ├── DraftPoModal.tsx (447)               # "Draft PO from SO" wizard (group by vendor)
│   ├── ReorderReport.tsx (467)              # "/reorder" table + per-row / bulk draft POs
│   └── QrBomPage.tsx (56)                   # "/qr" single-SO card
├── lib/
│   ├── types.ts (152)                       # Zoho + BOM report shared TS types
│   ├── zoho.ts (242)                        # token cache/refresh/cooldown; GET/PUT/POST helpers; toApiError
│   ├── rawmaterial.ts (1,386)               # stone/profile/hardware search + BOM-chain stock resolution + apply changes
│   ├── stock.ts (338)                       # BOM tree expansion, stock status, cf helpers, row builder
│   ├── report.ts (117)                      # load multi-SO BOM report (expands composites, global stock)
│   ├── export.ts (402)                      # dashboard Excel/CSV export
│   └── naming.ts (159)                      # part/panel name normalization, drill+finish split
└── data/
    ├── stone_finishes.json (176)            # stone finishes grouped by thickness 5/6/7/9/12/15/16/20
    ├── profile_finishes.json (23)           # profile item names per design/profile code
    └── planning_finishes.json (34)          # designer/planning maps: carcassShortCodes, profileFinishMap,
                                             #   shutterTypeMap, priceGroups (PG-1: 25, PG-2: 18)
scratch/test-drawers.js                      # mirror of drawer/shutter logic + assertions (CI gate)
```

## 4. Routes & pages

| Route | Component | Purpose |
|---|---|---|
| `/` | `BomDashboard` | Search & load multiple Zoho SOs → multi-level BOM backorder report, stock status, QR codes, packing lists, accessories subform, draft-PO wizard, Excel/CSV/print |
| `/builder` | `CarcassBomBuilder` (default) | Full configurator → cabinet code, BOM, all aux sections, exports, push to Zoho SO |
| `/designer` | `CarcassBomBuilder soMode` | Decode a Zoho SO's cabinet codes + Excel-upload flow → pick shutter colours per price group |
| `/planning` | `CarcassBomBuilder soMode planningMode` | Decode a Zoho SO, rebuild BOMs, replace SO service lines with composites (no Excel upload) |
| `/reorder` | `ReorderReport` | Low-stock report with vendor/lead-time; create per-row or bulk draft POs (one per vendor) |
| `/qr/bom/:orderId` | `QrBomPage` | Chrome-less single-SO BOM card (QR-target) |
| `/api/zoho/*`, `/api/ai/chat` | route handlers | Thin server proxies (see §3) |

All pages are wrapped by `AuthGate` (client password gate) and get a floating `AiCopilot`.

## 5. Core data model (from CarcassBomBuilder.tsx & lib/types.ts)

**Configuration → model.** A cabinet is `zone.family.variant` + handle + design + materials + W/H/D + thickness (t=15) + hand + drawer options. `buildModel()` → `buildCarcassInner()` → `buildCarcassInnerRaw()` produces a **`CarcassModel`**:

```ts
CarcassModel {
  code, mat, carcassMat, shutterMat, fixedPanelMat,
  carcassProfileColor, shutterProfileColor,
  W, H, D, t, isCJ, lh, rh, zk, fk,
  panels: Panel[]        // {name, w, h, qty, drill, pack, t}     stone parts
  profiles: Profile[]    // {name, len, qty, type, pack}          aluminium
  hardware: Hardware[]   // {name, qty, uom, pack}
  cons: Consumable[]     // {name, qty, uom, pack}
  pkRows: [type, name, dims, qty, uom][]   // "packet" view rows: panel/prof/hard/cons/shut/elen_bom
  shutters: Shutter[]    // {code, kind: drawer|hinged|fixed, design, w,h,pw,ph, profV,profH, hinge, hq, loc}
  netSqft, nPanels, ops:{cut,drill}, glassShelf?
}
```

`ProjectLine { qty, m: CarcassModel, rate, elevation, priceGroup?, upCode?, upDesign?, upCarcass?, upProfile? }` — the project is `ProjectLine[]`. The `up*` fields carry provenance for the designer colour re-parse.

**Zoho/report types** (`lib/types.ts`): `SalesOrderDetail`, `ItemDetail`, `CompositeItemDetail`, `SalesOrderLineItem`, `BomReportRow {type: master|plain|sub_bom|component, level, soQty, wastePct, actualQty, effStock, …}`, `StockStatus = in-stock|low-stock|out-of-stock|unknown`.

## 6. The BOM build pipeline (data flow)

```
UI selections ─(useMemo)→ buildModel()
    └ buildCarcassInner() → buildCarcassInnerRaw()   // per-zone carcass: sides/top/bottom/back/shelves,
          ├ addDrawerBoxes()                          //   legs vs wall-hanger, CJ sink cut, glue, back strips
          ├ buildShutters()                           // shutter/drawer-front/blind-fixed panels + hinges
          └ addElenor()                               // Elenor light BOM (wall/tall)
    → CarcassModel {panels, profiles, hardware, cons, pkRows, shutters, netSqft, ops}

Per-unit views:   ② Carcass Packets (pkRows)   ③ Raw Roll-up (net+waste, weight)   ④ Full Explosion tree
Project views:    ④ Project Lines, Consolidated Totals, ⑨ Raw-Material Selection (Zoho item pick per finish/profile bucket)
Aux sections add their own models: Fillers, Visible Panels, Countertop (ctGeom), Backsplash, Other Accessories, Accessories ⑪

buildFullBomData()  → FullBomRow[] (multi-level, S.No per project line, Elevation) → exportBuilderExcel()
buildOosData / buildOptiData / Export-All-Combinations / packing-list HTML / labels
handleAddToZohoSO() → idempotent composite items + SO line replacement (India Zoho)
```

Single source of truth for shared logic:
- **Countertop:** `CT_TYPES` (9 types, display order/labels) + `ctGeom(type,L,D,T,dropHeight)` — used by both the BOM build and the raw-stone aggregation.
- **Drawers/shutters** mirrored in `scratch/test-drawers.js` for the test gate.

## 7. Domain logic reference (the rules that make it correct)

**Global constants:** `SQDIV=92903.04` (sqft = w·h/SQDIV); waste `STONE=0.15`, `PROFILE=0.20`, `ELENOR=0.10`, drilled-raw `+17%`; weight `KG_SQFT=3.45` (carcass), `SH_KGSQFT=1.38` (shutter); `CJ_CUT=23`, `SHELF_OFF=40`.

**Zones (14):** BC, BCL, BB, BBL (base family set); WC, WB (wall); TC, TB, TCL (tall); LO, LB, LBF, LOF (loft); MD (mid rolling shutter). `construct` = `fulltb` (top/bottom) or `fullsides` (wall-hung); mount = legs or wall.

**Cabinet code (11 fields):** `p1-p2-handleToken(CJ|STD)-matToken(GL|ST)-p3-p4-p5-W-H-D-t` + optional `-carcassMat(-shutterMat)`. **P7 = `XXX`** (handle no longer repeated there; handle decoded from P3). Handle: XCJ (handleless/gola, base zones only) pairs with `XCJ_DESIGNS = MD1/MD3/MD1CM1/MD1CM2/MD3CM1/MD3CM2`; STD (Titus) pairs with `STD_DESIGNS = MD2/MD2CM1/MD2CM2`.

**Shutter designs:** `MD1,MD2,MD3,MD1CM1,MD1CM2,MD2CM1,MD2CM2,MD3CM1,MD3CM2,CL1,CL2,NEON20`. Glass families `{WGL,SHFG,BLNG,DPNG,PPNG,LOWSG,LGL}` → NEON20/CL1 glass only.

**Drawers (`addDrawerBoxes`):** variants Low (back 63, `H90`), High (back 212, `H239`), Semi (148, `H175`); back=W−72, bottom=(W−50)×(D−77), fascia=(W−2t−8); DBS profile 483, DBC W−78. **2HB+1BL** high pack takes the Low config (back 63, H90). **Hardware dedup:** shutter-faced drawers carry the runner pack on the shutter (`hinge`); built-in/fascia drawers keep it on the Drawer Pack. **WBP** = accessory, no drawer.

**Shutters/blind (`buildShutters`):** front heights FH / 360 (HB) / 180 (LB); hinge count `hingeN(h)` ≤900→3, ≤1600→4, ≤2100→5, else 6; hinge pack loft→W/OUT soft close (+Tip-On), glass→slim glass hinge, else 3D hinge. Blind cabinets: door width `blindW` = 550 (base/tall) / 450 (wall/loft); **fixed dummy panel** = `(W−blindW−3) × (H−3)`, always stone MD1 6 mm, only if `W−blindW>0`.

**Countertop (9 types, `ctGeom`):** 1 Linear · 2 Linear+BSV · 3 Linear+LHV w/ LH Drop · 4 Linear+RHV w/ RH Drop · 5 Linear+BSV w/ Both Side Drop · 6 Island Compact · 7 Island Table · 8 Island with 350mm Sitting · 9 Island Both Side Cabinets. Shared: top slab 2×15 (or 2×20), dead base D−40, front 30 mm patti folded into top depth (D+30), Grand Light HM-512, 3 mm edge radius, polish/glue cons. Side patti fold into top length (+30/side). Drop-down = mini-counter sub-BOM (visible stone `len × dropHeight`, +15/+30 mitre issuance, dead base dropHeight−100). 100 mm cabinet reduction (side→length, back→depth); Type 7 exempt; Type 8 keeps full top depth + 350 mm sitting drop w/ two dead stones. Rounding = name-only note `Rounding LH/RH/Both (-600)`. dropHeight default 705.

**Wall standard height = 725** (was 720). **Fillers/Visible Panels** have per-zone size/height presets; fillers carry an Elevation (AA–KK/custom). **Chimney panel** presets 1082×336 / 717×336; dishwasher panel custom.

**Stone resolution (`rawmaterial.ts`):** match finish + thickness; colour-qualifier words (BLACK/WHITE/…) optional so a 15 mm "STATUARIO NUVOLATO" slab resolves for "BLACK STATUARIO NUVOLATO"; thickness read from cf or item name (`…X15`, `06MM`). Exact-finish ranked before core matches.

## 8. External integrations

- **Zoho Inventory (India)** (`lib/zoho.ts` + `/api/zoho/*`): OAuth refresh-token flow; access token cached in memory + `os.tmpdir()/magppie-cache`; refreshes within 5 min of expiry; a rejected refresh triggers a **5-minute cooldown** with a user-facing "cooling down" message; 401/code-57/14 clears token and retries once. Idempotent item resolution by name/SKU (`resolveSimpleItem/resolveCompositeItem/resolveHardwarePackComposite`); composite BOMs written with custom fields `cf_group/cf_sub_group/cf_height/cf_width/cf_thickness/cf_finish/cf_sqft`. `handleAddToZohoSO` replaces a decoded SERVICE line with its composite (keeping qty/rate/tax) and appends unmatched composites.
- **OpenAI** (`/api/ai/chat`): `gpt-4o-mini`, temp 0.7, Magppie system prompt; page supplies `window.__BOM_CONTEXT__`.

## 9. Persistence & auth

- **AuthGate:** client-only password gate; success stored as `localStorage.app_authenticated="true"` (no logout UI). Accepted password hard-coded `Factory@1234`.
- Only other client persistence: dashboard accessories-subform rows (`bom_accessory_subform_rows/_counter`). **All builder/designer/planning state is in-memory** — lost on reload; no session restore.

## 10. Build, test, deploy

1. `npx tsc --noEmit` — type-clean.
2. `node scratch/test-drawers.js` — must print `ALL TESTS PASSED SUCCESSFULLY!` (drawer/shutter/2HB+1BL invariants).
3. `npm run build` — production build.
4. Deploy only on explicit authorization: `vercel --prod` (Vercel project `inventory-magppie`). No secrets bundled.

---

**Companion file:** `requirements.md` — 461 implementation-agnostic requirements (UJ/BR/AC/DC) with exact tables, formulas, and file citations, sufficient to rebuild the product in any stack.
