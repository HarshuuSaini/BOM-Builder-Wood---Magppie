# Prioritized Backlog

Status legend: ✅ Done (shipped to production) · 🟡 In progress / partial · ⬜ Pending · 🚧 Blocker

---

## ✅ Completed (shipped)

| # | Item | Notes |
|---|---|---|
| 1 | Configurator, 11-field cabinet code, shutter codes | 14 zones, ~25 families |
| 2 | BOM engine: carcass per zone, shutters, blind fixed panel, Elenor light | |
| 3 | **Drawer: 2HB+1BL "High takes Low config"** | back 212→63, H239→H90; shutter carries H90 |
| 4 | **Drawer hardware de-duplication** | shutter-faced → on shutter; built-in/fascia → on Drawer Pack |
| 5 | **WBP no-drawer fix** | WBP was wrongly grouped with GD forcing a built-in drawer |
| 6 | 2HB+1BL fascia fix | only the built-in low back gets a fascia |
| 7 | Drawer raw-qty fix | `addPanelRow` used `soQty` not `actualQty` |
| 8 | **Countertop: 9 constructions** (`CT_TYPES` + `ctGeom`) | final names + display-only reorder |
| 9 | Countertop: side & front patti folded into the top slab | `topL = L+30×folds`, `topD = D+30` |
| 10 | Countertop: drop-down = mini-counter sub-BOM | visible stone + dead base `dropHeight−100` + pasting |
| 11 | Countertop: +15/+30 mitre issuance; 100 mm cabinet reductions; type-7 exempt; type-8 full top depth + 350 sitting drop (2 dead stones) | |
| 12 | Countertop: **Rounding = name-only note** (`Rounding LH/RH/Both (-600)`) | no stone, no deduction |
| 13 | Countertop: brass strip as a cut-size BOM material (`Depth × 30`) | |
| 14 | **Cabinet code P7 → `XXX`** (handle de-duplication) | handle decodes from P3; old codes still decode |
| 15 | **Loft Glass `LGL` p3 `1SX` → `1SG`** | fixes live code + both exports |
| 16 | **Wall standard height 720 → 725** | thresholds unaffected |
| 17 | **500 mm width** on hinged+shelf (`BC.SH`, `WC.WGL`, `WC.WST`) | flows to exports automatically |
| 18 | Visible Panel size presets; **Chimney Panel presets** (1082×336, 717×336) | "Wall Chimney Area" moved out of Visible Panels |
| 19 | Filler height presets + **Filler Elevation** (AA–KK or custom, stamped on BOM rows) | |
| 20 | Elenor light cut sizes (len = H, qty 2, 10% waste) | |
| 21 | Glass shutter corner connector + slim glass hinge; loft w/out-soft-close + Tip-On | |
| 22 | Opti: `prof` → **Profile Pack** (stops sink-profile duplication) | |
| 23 | Full BOM **S. No.** per project line + **Elevation** column | |
| 24 | Export All Combinations: **+6 net sqft columns** (Shelf Qty/Sqft, Drawer Bottom, Drawer Back, Fascia, Shutter) | |
| 25 | Stone search: item-name fallback + `thicknessFromName` + **core-name matching** (colour-qualifier optional) | fixed 15 mm resolving to a 6 mm slab |
| 26 | `/designer` (soMode) + `/planning` (soMode+planningMode) | reuse via props, no clone |
| 27 | Designer Excel upload + per-line & **bulk colour by Price Group** (Zone→PG→Colour) | PG-1 = 25, PG-2 = 18 |
| 28 | Zoho token recovery + cooldown handling | |
| 29 | Duplicate React key fix (Fillers/Visible Panels) | |
| 30 | Docs: `requirements.md` (461 reqs), `APP_ARCHITECTURE_FULL.md`, `ARCHITECTURE.md` | |

---

## 🟡 In progress / partial

| # | Item | State |
|---|---|---|
| 31 | Countertop assumptions flagged to user | Type-8 cabinet-zone base depth (`D−40−100`) and the inferred Type-9 back panel `(L−60)×dropHeight` were **accepted with "no nedd"**. Revisit only if the factory disputes a cut. |
| 32 | Config-sheet **zone-swap rules** (Tall MD1→MD2, Wall MD2→MD1, "Tall with external handle only") | Present in the user's spec sheet, **not enforced in code**. Awaiting a decision. |

---

## ⬜ Pending — P0 (integrity / security)

| # | Item | Why | Sketch |
|---|---|---|---|
| 33 | **Server-side authentication** | The gate is client-side only and trivially bypassed | Real session (cookie/JWT), server-rendered guard |
| 34 | **Protect every `/api/*` route** | All routes are unauthenticated; anyone reaching the deployment can drive Zoho (create items, update SOs, create POs) | Middleware auth check on `/api/**` |
| 35 | **Remove the hard-coded password** from the client bundle | It ships to every browser | Move to server auth (33) |
| 36 | **Rotate the Zoho refresh token** | It has been handled in chat/logs during this project | Re-issue in `api-console.zoho.in`, update `.env.local` + Vercel |
| 37 | **Project persistence** (save/restore) | A reload destroys the whole project; painful for long BOMs | localStorage autosave first; server-side saved projects later |

## ⬜ Pending — P1 (confidence)

| # | Item | Why |
|---|---|---|
| 38 | Real test runner (Vitest/Jest) + CI | Only `scratch/test-drawers.js` exists; it's a **mirror**, so the real code can drift |
| 39 | Unit tests for `ctGeom`, `shDeduct`, `addDrawerBoxes`, `validDesigns`, `parseCabinetCodeToModel`, `searchStoneItems`, `getStockStatus` | Highest-risk logic; each has caused a real bug |
| 40 | Golden-file tests for exports (Full BOM / Opti / Combinations) | Column/format regressions are invisible today |
| 41 | Pin **MD3**'s profile item in `DEFAULT_PROFILE_NAMES` | MD3 has no default → can fail to resolve |
| 42 | Retry/backoff + partial-failure recovery on the Zoho push | A mid-push failure leaves the SO half-updated |
| 43 | Guard against stone core-name mis-match | Could pick a wrong tint; add a confirmation when only a core match exists |

## ⬜ Pending — P2 (maintainability)

| # | Item |
|---|---|
| 44 | Split `CarcassBomBuilder.tsx` (~11,200 lines) into engine modules (`engine/carcass`, `engine/drawers`, `engine/shutters`, `engine/countertop`, `engine/export`) + thin UI |
| 45 | Move domain tables (ZONES, families, SIZES, hardware packs) into `src/data/*.json` so non-devs can edit |
| 46 | Type the variant objects (remove `any`) |
| 47 | Delete `scratch/` cruft; keep the test mirror only until (38) lands |

## ⬜ Pending — P3 (product)

| # | Item |
|---|---|
| 48 | Per-user accounts + roles (estimator / designer / planning / purchase / factory) |
| 49 | Pricing & quotation output |
| 50 | Borderline **500 mm** families — `BCL.SH`, `WDR`, `WOP`, `WB.WGL/WST` — add if confirmed |
| 51 | Carcass finish **short-code full sheet** (planning) — placeholder map only (GC/ON/OM) in `planning_finishes.json` |
| 52 | Multi-org / multi-DC support |

---

## 🚧 Blockers / dependencies

| Blocker | Blocks | Note |
|---|---|---|
| Zoho catalog gaps (e.g. no 15 mm slab for some finishes; MD3 profile item) | 41, 43 | Needs a catalog decision from the user, not code |
| The user's Config-sheet zone-swap intent is unconfirmed | 32 | Needs a yes/no |
| No CI runner configured on the repo | 38, 40 | Trivial once a decision is made |
| Refresh-token rotation requires Zoho console access | 36 | User action |
