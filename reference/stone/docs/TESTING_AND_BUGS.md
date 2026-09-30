# Testing & Known Bugs / Risks

Project: **Magppie Carcass BOM Builder** — Next.js 16.2.6 / React 19.2.6 / TypeScript 5.9.3
Root: `/Users/Apple/Documents/bom-nextjs-app/Inventory - Magppie`
Heart file: `src/components/CarcassBomBuilder.tsx` (11,220 lines)

---

# PART 1 — TESTING

## 1.1 The one and only existing test gate

There is exactly **one** executable test in the repository:

| Path | Lines | Type | Runner |
|---|---|---|---|
| `scratch/test-drawers.js` | 501 | Hand-written Node script, plain `throw new Error(...)` assertions | `node` (no framework) |

It is a **plain CommonJS script with zero imports**. It does **not** import `CarcassBomBuilder.tsx`. It contains hand-maintained *copies* ("mirrors") of four pieces of production logic, and asserts against the copies:

| Test-script function | Mirrors production symbol | Production location |
|---|---|---|
| `shutSpec(zk, fk, v, inbuiltDrawers)` — `scratch/test-drawers.js:17` | `shutSpec` | `src/components/CarcassBomBuilder.tsx:798` |
| `addDrawerBoxes(...)` — `scratch/test-drawers.js:37` | `addDrawerBoxes` | `src/components/CarcassBomBuilder.tsx` (drawer-pack emitter) |
| `getDrawerCount(packName, panels)` — `scratch/test-drawers.js:136` | `getDrawerCount` | `src/components/CarcassBomBuilder.tsx` |
| `mockBuildFullBomData(m, q)` — `scratch/test-drawers.js:148` | Drawer-Pack branch of `buildFullBomData` | `src/components/CarcassBomBuilder.tsx` |
| `mockHandleAddToZohoSO(m)` — `scratch/test-drawers.js:209` | Drawer-Pack branch of `handleAddToZohoSO` | `src/components/CarcassBomBuilder.tsx:6001` |

> **CRITICAL CAVEAT FOR THE NEXT AI:** because the test mirrors the logic rather than importing it, **`node scratch/test-drawers.js` can pass while the real component is broken.** Any change to `addDrawerBoxes`, `shutSpec`, `getDrawerCount`, the Drawer-Pack branch of `buildFullBomData`, or the Drawer-Pack branch of `handleAddToZohoSO` **must be mirrored by hand into `scratch/test-drawers.js`** in the same commit. Treat the two as a paired edit.

### The architecture the test locks in

Every drawer variant (Low / High / Semi High) collapses into **ONE composite per variant**:

```
Drawer Pack- Cab Drawer Box <variant>      ← Level 1, qty = number of drawers
  ├─ Panels- Cab Drawer Box Back <variant> <W-72>x<backH>x15  → Part (JD) → Panel → Raw   [drilled]
  ├─ Panels- Cab Drawer Box Bottom <W-50>x<D-77>x6            → flat Panel                [no drill, no Part wrapper]
  ├─ ALU PROF DRAWER BOTTOM SIDE (HM513) LH/RH   len 483      → Set of Profile Parts DBS (LH/RH) wrapper
  ├─ ALU PROF FOR DRAWER BOTTOM CENTER (HM535) MID  len W-78  → flat cut profile (DBC)
  └─ HARDWARE PACK …                                          → flat at Level 2  [built-in/fascia drawers ONLY]

Panels- Cab Drawer Box Fascia <variant> <W-2t-8>x<fasciaH>x15  ← cabinet-level OWN pack, NOT nested
```

### Constants the test pins (from `scratch/test-drawers.js:48–121`)

| Variant | `backH` | Hardware | `fasciaH` (built-in only) |
|---|---|---|---|
| Low | `63` | `HARDWARE PACK LOW BACK DRAWER H90 SET/1` | `110` |
| Semi High | `148` | `HARDWARE PACK HIGH BACK DRAWER H175 SET/1` | `210` |
| High | `212` | `HARDWARE PACK HIGH BACK DRAWER H239 SET/1` | `210` |
| High **under `2hb1bl`** | `63` (takes the **Low** config) | `HARDWARE PACK LOW BACK DRAWER H90 SET/1` | `null` (no fascia) |

Geometry (`scratch/test-drawers.js:95–98`):

```js
const backW   = W - 72;      // 600 → 528
const bottomW = W - 50;      // 600 → 550
const bottomD = D - 77;      // 560 → 483
const faciaW  = W - 2*t - 8; // 600, t=15 → 562
```

Per-drawer profile quantities (`scratch/test-drawers.js:114–115`):
- `DBS` (HM513): `qty = 2 * n`, `len = 483` (fixed)
- `DBC` (HM535): `qty = 4 * n`, `len = W - 78`

Supported drawer models (`scratch/test-drawers.js:45`): `Lian`, `Hettich`, `Blum`, `Hafele`, `Grass`. Anything else → **no drawer boxes emitted at all**.

Family → `effectiveInbuiltDrawers` overrides (`scratch/test-drawers.js:39–43`):
- `fk === "GD"` → forced to `"1lb"`
- `fk === "DPN"` → forced to `"fixed_dpn"` (= 2 Low + 3 Semi High)
- `fk === "BPO"` or `"WBP"` → accessory, **no standard drawer boxes** (`isAcc`, line 59)

Inbuilt-drawer token map (`scratch/test-drawers.js:82–87`): `1lb`→1 Low · `1sb`→1 Semi · `2lb`→2 Low · `2sb`→2 Semi · `2hb1bl`→1 Low (built-in) · `fixed_dpn`→2 Low + 3 Semi.

---

### Scenario A — `DW-3dr` default (`inbuiltDrawers = "none"`)
`scratch/test-drawers.js:291–327`
Call: `addDrawerBoxes("BC", "DW", { id:"3dr", p3:"2LB", p4:"1HB" }, W=600, D=560, t=15, …, "Lian", "none")`
Expected: 2 Low + 1 High **shutter-faced** drawers, **no fascia, no drawer-pack hardware**.

| # | Line | Assertion |
|---|---|---|
| A1 | 299 | `Drawer Pack- Cab Drawer Box Low` pkRow qty **= 2** |
| A2 | 300 | `Drawer Pack- Cab Drawer Box High` pkRow qty **= 1** |
| A3 | 301 | Exactly **2** `Drawer Pack-` pkRows |
| A4 | 302 | **No** `Set of Parts- Cab Drawer Box` pkRow may exist |
| A5 | 304 | Every panel's `pack` starts with `Drawer Pack- Cab Drawer Box` |
| A6 | 305 | Every profile's `pack` starts with `Drawer Pack- Cab Drawer Box` |
| A7 | 306 | Every hardware's `pack` starts with `Drawer Pack- Cab Drawer Box` (vacuous — array is empty) |
| A8 | 310 | `mergePanels` yields exactly **4** panel groups (Low back+bottom, High back+bottom) |
| A9 | 313 | LB back name **=** `Panels- Cab Drawer Box Back Low 528x63x15`, qty **= 2** |
| A10 | 314 | HB back name **=** `Panels- Cab Drawer Box Back High 528x212x15`, qty **= 1** |
| A11 | 319 | Low `DBS` qty **= 4**, Low `DBC` qty **= 8** |
| A12 | 320 | High `DBS` qty **= 2** |
| A13 | 323 | `hardwareA.length === 0` — shutter-faced drawers must **not** carry runner hardware in the pack (it lives on the shutter via `buildShutters` `hinge`) |
| A14 | 326 | Neither `HARDWARE PACK LOW BACK DRAWER H90 SET/1` nor `…H239 SET/1` present |

### Scenario B — `GD` (standard High front + 1 built-in Low Back with fascia)
`scratch/test-drawers.js:329–345`
Call: `addDrawerBoxes("BC", "GD", { id:"gd", p3:"GD", p4:"1HF" }, 600, 560, 15, …, "Lian", "none")` — `GD` forces `effectiveInbuiltDrawers = "1lb"`.

| # | Line | Assertion |
|---|---|---|
| B1 | 336 | `Drawer Pack- Cab Drawer Box Low` qty **= 1** |
| B2 | 337 | `Drawer Pack- Cab Drawer Box High` qty **= 1** |
| B3 | 339 | Fascia panel at `h = 110` exists, `w = 562`, `qty = 1` |
| B4 | 341 | Fascia `pack` **=** `Panels- Cab Drawer Box Fascia Low 562x110x15` (its **own** cabinet-level pack) |
| B5 | 342 | **No** panel whose `pack` starts `Drawer Pack-` may have `Fascia` in its name |
| B6 | 344 | A pkRow named `Panels- Cab Drawer Box Fascia Low 562x110x15` exists at cabinet level |

### Scenario C — `DPN` (fixed 2 Low + 3 Semi High built-in, no standard drawers)
`scratch/test-drawers.js:347–372`
Call: `addDrawerBoxes("BC", "DPN", { id:"h" }, 600, 560, 15, …, "Lian", "none")` — forced to `"fixed_dpn"`.

| # | Line | Assertion |
|---|---|---|
| C1 | 354 | `Drawer Pack- Cab Drawer Box Low` qty **= 2** |
| C2 | 355 | `Drawer Pack- Cab Drawer Box Semi High` qty **= 3** |
| C3 | 361 | Back panel `h = 63` qty **= 2** |
| C4 | 362 | Back panel `h = 148` qty **= 3** |
| C5 | 363 | Semi back name **=** `Panels- Cab Drawer Box Back Semi High 528x148x15` |
| C6 | 364 | Fascia `h = 110` qty **= 2** |
| C7 | 365 | Fascia `h = 210` qty **= 3** |
| C8 | 367 | Semi `DBC` qty **= 12** (`4 × 3`) |
| C9 | 370 | `HARDWARE PACK LOW BACK DRAWER H90 SET/1` qty **= 2** |
| C10 | 371 | `HARDWARE PACK HIGH BACK DRAWER H175 SET/1` qty **= 3** |

> Note C6/C7 pin the intentional asymmetry: Semi High uses `backH = 148` but `fasciaH = 210` (`scratch/test-drawers.js:91`).

### Scenario D — `DW-3dr` with `inbuiltDrawers = "2hb1bl"`
`scratch/test-drawers.js:374–405`
Call: same as A but last arg `"2hb1bl"`. Two High-Back **shutters** face boxes that are internally **Low** config; plus one built-in Low Back **with** fascia.

| # | Line | Assertion |
|---|---|---|
| D1 | 382 | `Drawer Pack- Cab Drawer Box High` qty **= 2** |
| D2 | 383 | `Drawer Pack- Cab Drawer Box Low` qty **= 1** |
| D3 | 384 | Exactly **2** `Drawer Pack-` pkRows |
| D4 | 390 | **No** `Fascia High` panel may exist |
| D5 | 391 | Exactly **1** `Fascia Low`, `h = 110`, `w = 562` |
| D6 | 396 | `Back High` panel has `h = 63` (Low config!), qty **= 2** |
| D7 | 397 | `Back Low` panel has `h = 63`, qty **= 1** |
| D8 | 398 | **No** `h = 212` back panel anywhere |
| D9 | 403 | **No** `HARDWARE PACK HIGH BACK DRAWER H239 SET/1` |
| D10 | 404 | Total `HARDWARE PACK LOW BACK DRAWER H90 SET/1` qty **= 1** (only the built-in Low keeps hardware) |

### Architecture tests — mocked BOM tree
`scratch/test-drawers.js:407–453`
Fixture: `mockCabinetModel` (line 410) = `{ code: "BC-DW-2LB-1HB", panels: mergePanels(panelsA), profiles: profilesA, hardware: hardwareA, cons: consA, pkRows: pkRowsA, carcassMat: "STONE", W:600, H:720, D:560, t:15 }` — i.e. Scenario A's output fed into `mockBuildFullBomData(model, q=1)`.

| # | Line | Assertion |
|---|---|---|
| T1 | 420 | Exactly **2** Level-1 rows starting `Drawer Pack- Cab Drawer Box` |
| T2 | 421 | **No** row named `Set of Parts- Cab Drawer Box` |
| T3 | 426 | Level-1 `…Low` row `qty = 2` (equals drawer count) |
| T4 | 427 | Level-1 `…High` row `qty = 1` |
| T5 | 437 | Each pack has a Level-2 child containing `Back` **and** `(JD)` → drilled Part wrapper |
| T6 | 438 | Each pack has a Level-2 child containing `Bottom` → flat panel (no Part wrapper) |
| T7 | 439 | Each pack has a Level-2 child with `type === "DBS"` whose name starts `Set of Profile Parts` |
| T8 | 440 | Each pack has a Level-2 child with `type === "DBC"` (flat) |
| T9 | 443 | If a pack carries hardware, its per-drawer `qty` must be **1** |
| T10 | 445 | Back per-drawer `qty = 1` |
| T11 | 446 | Bottom per-drawer `qty = 1` |
| T12 | 447 | DBC per-drawer `qty = 4` |
| T13 | 452 | **Zero** Level-1 rows starting `HARDWARE PACK` — drawer hardware is nested only |

The divide-back mechanism under test (`scratch/test-drawers.js:166–169`): `dCount = getDrawerCount(packName, panels)` (read off the **Back** panel's qty, `scratch/test-drawers.js:143–144`), then `perParent = +(p.qty / dCount).toFixed(3)` and `actualQty = +(p.qty * q).toFixed(3)`.

### Architecture tests — mocked Zoho SO sync
`scratch/test-drawers.js:455–462`, using `mockHandleAddToZohoSO(mockCabinetModel)`.

| # | Line | Assertion |
|---|---|---|
| Z1 | 459 | **No** `Set of Parts- Cab Drawer Box` composite in `packetCompositeIds` |
| Z2 | 460 | `Drawer Pack- Cab Drawer Box Low STONE` composite `quantity = 2` |
| Z3 | 461 | `Drawer Pack- Cab Drawer Box High STONE` composite `quantity = 1` |

Structure exercised: pack composite name = `` `${packName} STONE` `` (line 279); components = part children + `{ item_id: "packing-carcass", quantity: 1 }` (line 280); Level-1 quantity = `isDrawerPack ? drawerCount : 1` (line 282). Child quantities are `p.qty / drawerCount` (lines 241, 243, 257).

### PPN test — Pullout Shelf Pantry (legacy structure, deliberately unchanged)
`scratch/test-drawers.js:464–499`
Fixture `mockPPNModel` (line 483), code `TC-PO-2SX-LHS-4PO-600-2400-560-15`, `W=600, H=2400, D=560, t=15`. Built by looping 4× (`scratch/test-drawers.js:473–479`) pushing into `Set of Parts- Cab Pullout Shelf`:

```js
poW = W - 60 = 540;  poD = D - 40 = 520
sideStripW = D - 55 = 505;  sideStripH = 15
frontStripW = W - 60 = 540; frontStripH = 60
spacerW = D - 80 = 480;     spacerH = 50
```
per iteration: Base ×1, Side Strip ×2, Front Strip ×1, Spacer ×1 → all in `Set of Parts- Cab Pullout Shelf`; plus `Quadro channel set` ×1 in `Drawer Pack- Cab Pullout Shelf`.

| # | Line | Assertion |
|---|---|---|
| P1 | 491 | Level-1 `Set of Parts- Cab Pullout Shelf` exists with `qty = 1` |
| P2 | 493 | Level-1 `Drawer Pack- Cab Pullout Shelf` exists with `qty = 1` |
| P3 | 498 | Zoho composite `Drawer Pack- Cab Pullout Shelf …` has `quantity = 4` |

P3 exercises the special `getDrawerCount` branch (`scratch/test-drawers.js:137–142`): for a `Pullout Shelf` pack the name is rewritten `Drawer Pack-` → `Set of Parts-`, the count is read off the **Base** panel's qty, and defaults to `4` if no base panel is found (versus `1` for drawer boxes).

> **Known inconsistency the test itself encodes:** P2 asserts the BOM-tree Level-1 qty is **1** while P3 asserts the Zoho composite qty is **4**. The BOM tree uses the hard-coded `pkRow` qty; Zoho uses `getDrawerCount`. These disagree by design in the mock. Verify against production before "fixing" either.

### How to run

```bash
cd "/Users/Apple/Documents/bom-nextjs-app/Inventory - Magppie"
node scratch/test-drawers.js
```

Success = exit code `0` and final stdout line:

```
ALL TESTS PASSED SUCCESSFULLY!
```

Any failure = an uncaught `throw new Error(...)`, non-zero exit, stack trace. There is no `npm test` script (`package.json` `scripts` = `dev`, `build`, `start`, `lint` only).

## 1.2 The mandatory 3-step verification loop

Run **all three, in order, from the project root**, before considering any change done. Verified working as of this writing (`tsc` exit 0; test prints the pass line).

```bash
cd "/Users/Apple/Documents/bom-nextjs-app/Inventory - Magppie"

# 1. Type check — must produce NO output
npx tsc --noEmit

# 2. Drawer/BOM-architecture gate — must end with "ALL TESTS PASSED SUCCESSFULLY!"
node scratch/test-drawers.js

# 3. Production build — must complete without errors
npm run build
```

Notes:
- `npm run build` is `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs next build --webpack` — the SWC **wasm** fallback and `--webpack` are deliberate (native SWC is not used on this machine). Do not "simplify" these scripts.
- `npm run dev` binds to `127.0.0.1` only.
- `npm run lint` exists (`eslint-config-next`) but is **not** part of the loop and is not enforced anywhere.

## 1.3 What is NOT tested — state this plainly

- **No test runner.** No Jest, no Vitest, no Mocha, no Playwright, no Cypress. No `npm test` script. No `__tests__` / `*.test.ts` / `*.spec.ts` files anywhere.
- **No CI.** No `.github/workflows`, no pipeline, no pre-commit hook. Nothing runs the test automatically. `scratch/` is a junk drawer of ~250 one-off inspection scripts; `test-drawers.js` is the only maintained one.
- **No coverage measurement** of any kind.
- **Zero tests** for:
  - **Countertop** — `ctGeom` (`src/components/CarcassBomBuilder.tsx:161`), `ctHasDrop` (:156), the 9 `CT_TYPES`, the Countertop BOM branch (:3863–3970), drop-downs, brass strip, grand lights, dead stock.
  - **Shutters** — `shDeduct` (:788), `shThkOf` (:782), `hingeN` (:794), `validDesigns` (:823), `SH_INSET`/`SH_FRAME` (:772–773), `buildShutters`, XCJ/STD handle pairing (:844–849), glass families.
  - **Exports** — `exportBomWorkbook` (`src/lib/export.ts:365`), `exportBomCsv` (:383), PDF/jsPDF, QR (`qrcode`), barcode (`jsbarcode`), packing list.
  - **Zoho** — every function in `src/lib/zoho.ts`, every route under `src/app/api/zoho/**`, `resolveSimpleItem` (:4970), `resolveCompositeItem` (:5033), `resolveProfileBOM` (:5143), `resolveHardwarePack` (:5548), `searchItemByName` (:4943), `findExistingCompositeByRawMaterial` (:5104), the whole `handleAddToZohoSO` (:6001).
  - **Raw material resolution** — `resolveRawMaterials` (`src/lib/rawmaterial.ts:448`), `searchStoneItems` (:604), `searchProfileItems` (:768), `searchHardwareItems` (:860), `applyStoneChange` (:1218), `applyProfileChange` (:1338), `getDefaultProfileName` (:743).
  - **Stock/report** — everything in `src/lib/stock.ts` and `src/lib/report.ts`.
  - **Code round-trip** — `parseCabinetCodeToModel` (:4829) ↔ `buildModel` code emission (:1814, :1877, :2107).
  - **Any React component.** No rendering tests at all.

## 1.4 Manual testing checklist

`tsc` + `test-drawers.js` + `build` cover roughly the drawer-pack logic and nothing else. **Every other change must be verified by hand.** Run `npm run dev` → `http://127.0.0.1:3000`.

### Screens / routes

| Route | File | Component | Notes |
|---|---|---|---|
| `/` | `src/app/page.tsx` | `BomDashboard` | "BOM Backorder Report" |
| `/builder` | `src/app/builder/page.tsx` | `CarcassBomBuilder` (no props) | manual cabinet build |
| `/designer` | `src/app/designer/page.tsx` | `CarcassBomBuilder soMode` | SO → BOM |
| `/planning` | `src/app/planning/page.tsx` | `CarcassBomBuilder soMode planningMode` | SO → BOM + Excel upload |
| `/reorder` | `src/app/reorder/page.tsx` | `ReorderReport` | re-order report |
| `/qr/bom/[orderId]` | `src/app/qr/bom/[orderId]/page.tsx` | `QrBomPage` | QR landing (see BUG-12) |

All routes are wrapped by `AuthGate` in `src/app/layout.tsx:15`; `AiCopilot` is mounted globally at `src/app/layout.tsx:17`.

### CHK-A — Auth gate (`src/components/AuthGate.tsx`)
- [ ] A1. Clear `localStorage`, load `/` → password screen appears.
- [ ] A2. Wrong password → error `Invalid access password. Please try again.` (`AuthGate.tsx:31`), no access.
- [ ] A3. Correct password → app renders; `localStorage["app_authenticated"] === "true"` (`AuthGate.tsx:28`).
- [ ] A4. Reload → still authenticated (read at `AuthGate.tsx:12`).
- [ ] A5. **Confirm the known hole:** with `localStorage` cleared, `curl 'http://127.0.0.1:3000/api/zoho/status'` still returns data → API is unauthenticated (BUG-01).

### CHK-B — `/builder` cabinet configuration
- [ ] B1. Each zone in `ZONES` selectable: `BC, BCL, BB, BBL, WC, WB, TC, TB, TCL, LO, LB, LBF, LOF, MD` (`CarcassBomBuilder.tsx:~600–649`).
- [ ] B2. Changing zone re-filters families via `famSetOf` (:651) — `currentFams` memo (:6896); `activeFamilyKey` falls back to the first key when the current family is invalid (:6898).
- [ ] B3. Selecting `BCL` shows **only** `SH`. Selecting `BB` shows **only** `LMC, BSH`. Selecting `BBL` → only `BSH`. Selecting `WB` → only `WGL, WST`. (Expected per code — see BUG-08.)
- [ ] B4. Variant list updates per family; handed variants offer LHS/RHS.
- [ ] B5. W/H/D dropdowns match the `SIZES` entry (`:701`) for `<ZONE>.<FAM>`; unlisted combos fall back sanely.
- [ ] B6. Design list = `validDesigns(zone, activeFamilyKey, currentVariant, finalW)` (:7043). For a drawer family, `NEON20` is absent (:833). For a 3-drawer variant with a Low front, only `MD1, MD2, MD3` (:835). For `BPO` at `W = 150`, only `MD1, MD2, MD3` (:837).
- [ ] B7. Glass families → design list is exactly `["NEON20", "CL1"]` (:830).
- [ ] B8. **MD3 end-to-end** — pick `MD3`, build, push to Zoho. Confirm the shutter profile resolves (BUG-05 predicts it will not).
- [ ] B9. Handle token: `XCJ` → code field 3 = `CJ`; `STD` → `STD` (:1814/:2107). Field 7 (P7) is always literal `XXX` (:2105–2107).
- [ ] B10. Drawer model selector — verify `Lian, Hettich, Blum, Hafele, Grass` produce drawer boxes and any other value produces none.
- [ ] B11. Inbuilt-drawer selector: `none, 1lb, 1sb, 2lb, 2sb, 2hb1bl` → box counts match the table in §1.1.
- [ ] B12. Cabinet code string matches `p1-p2-handleToken-matToken-p3-p4-XXX-W-H-D-t[-carcassMat[-shutterMat]]` (:2107).
- [ ] B13. Copy-code button flashes for 1200 ms (:7889); copy-CSV likewise (:7896).

### CHK-C — BOM tree rendering
- [ ] C1. Level 0 = master (cabinet code); Level 1 = packs; Level 2 = parts/panels/profiles/hardware; Level 3 = raw.
- [ ] C2. Drilled panels render as `<name> (<drill>) <finish>` → child `<name> <finish>`; undrilled render flat with no Part wrapper.
- [ ] C3. Drawer-Pack Level-1 qty = drawer count; children show per-drawer quantities (see T1–T13).
- [ ] C4. Fascia appears at cabinet level, **never** inside a Drawer Pack.
- [ ] C5. No `Set of Parts- Cab Drawer Box` node anywhere (drawer boxes only).
- [ ] C6. PPN/pullout still uses `Set of Parts- Cab Pullout Shelf`.
- [ ] C7. Rounding: quantities show at most 3 decimals (`.toFixed(3)`).

### CHK-D — Countertop (**completely untested code — verify by hand every time**)
- [ ] D1. All 9 `CT_TYPES` selectable.
- [ ] D2. Drop-height field is editable **only** for types 2, 3, 4 and islands (`ctHasDrop`, :156); default `705` (:161–162).
- [ ] D3. Type 2 → 1 `Drop-Down Left`; type 3 → 1 `Drop-Down Right`; type 4 → both; `brass` increments per drop (:171–172).
- [ ] D4. Type 5 → `edgeFolds = 2`, **no** brass, **no** back panel (:167, :173).
- [ ] D5. Type 6 → `Island Back Panel (single-side)`, `len = max(0, L-60)`; `grandLights = 1`.
- [ ] D6. Type 7 → `Island Vertical Panel (double-side)`, `grandLights = 2` (:180), and **exempt from mitre**: `reduce = 0` (:188).
- [ ] D7. Type 8 → `Island Sitting Drop`, `len = max(0, L-80)`, `wid = 350`, `deadQty = 2` (:181); `topDepthReduce = 0` (:190).
- [ ] D8. Type 9 → `Island Back Panel (section)`.
- [ ] D9. Verify formulas (:191–194) with L=3000, D=600, T=40:
      `topL = L + 30*edgeFolds - 100*sideDrops*reduce`
      `topD = D + 30 - 100*backDrops*reduce*topDepthReduce`
      `baseL = L - 100*sideDrops*reduce`
      `baseD = max(0, D - 40 - 100*backDrops*reduce)`
- [ ] D10. Master item name = `Countertop Pasting Material {T}mm {L}x{D}{roundLabel}` (:3886).
- [ ] D11. Base stone is **−40 mm** vs top (`baseD` formula); patti/brass strip/LED band light rows present.
- [ ] D12. Rounding label is annotation only — geometry unchanged (:159–160).
- [ ] D13. Multiple countertop rows accumulate independently (`countertops.forEach`, :3868).

### CHK-E — Shutters
- [ ] E1. `SH_INSET` applied: `MD3/MD3CM1/MD3CM2 = 3`, `CL1 = 118`, `CL2 = 149`, rest `5` (:772).
- [ ] E2. `SH_FRAME`: `CL1/CL2 = 31`, rest `25` (:773).
- [ ] E3. Thickness: `MD3` family = **9 mm**; glass = **5 mm**; else **6 mm** (`shThkOf`, :782–786).
- [ ] E4. `shDeduct` (:788): non-base → `3`; base + `MD1/MD1CM1/MD1CM2/MD3/MD3CM1/MD3CM2` → `33` unless `loc === "ML"` → `3`; base + anything else → `3`.
- [ ] E5. `hingeN` (:794): `h ≤ 900 → 3`, `≤1600 → 4`, `≤2100 → 5`, else `6`. Test boundaries **900 / 901 / 1600 / 1601 / 2100 / 2101**.
- [ ] E6. `SH_KGSQFT = 1.38` (:775) used in weight.
- [ ] E7. Shutter-faced drawers carry runner hardware on the shutter, **not** the pack.
- [ ] E8. Blind cabinets: `blindW = 450` for wall/loft, `550` otherwise (:800).

### CHK-F — `/designer` and `/planning` (SO → BOM)
- [ ] F1. SO search requires ≥2 chars (`src/app/api/zoho/salesorders/route.ts:16`) — 1 char returns `{salesorders: []}`.
- [ ] F2. Select an SO → line items decoded by `parseCabinetCodeToModel` (:5906, :7236).
- [ ] F3. Unparseable code → `null`, warn in console (:4921), row flagged not crashed.
- [ ] F4. Code with `-SO-nnnnn` suffix is stripped before parsing (:4838) and by `normalizePartOrPanelName` (`src/lib/naming.ts:43`).
- [ ] F5. `/planning` Excel upload → per-row carcass/shutter/profile overrides win over the code's finish suffix (:4915–4917); default profile colour `CHAMPAGNE` (:4917).
- [ ] F6. Raw-material panel: every (finish, thickness) group resolves; "Retry" (:7522) and "Retry All" (:7527) work after a forced network failure.
- [ ] F7. Stone dropdown ranking: exact-finish matches appear **above** core-token matches (`src/lib/rawmaterial.ts:651–656`) — see BUG-06.
- [ ] F8. Push to Zoho blocked with a clear error when a raw material is unselected (:6034–6036).

### CHK-G — Zoho push (`handleAddToZohoSO`, :6001) — **use a sandbox/dummy SO**
- [ ] G1. Services resolve first: `Cutting-1`, `Drilling-1`, `Packing Item - Carcass`, `Packing Item - Shutter`, `Packing Item - Hardware` (:6009–6013).
- [ ] G2. Second push of the **same** cabinet creates **zero** new items (name-based dedup via `searchItemByName`, :4943).
- [ ] G3. Rename any part → next push creates a **duplicate** (BUG-07 — confirm and document, do not "fix" by renaming in prod).
- [ ] G4. Composite with a single mapped item of qty ≤ 1 gets `Drilling-1` auto-appended (:5048–5061).
- [ ] G5. Names longer than 100 chars are truncated (`truncZoho`, :5029) — check for collisions (BUG-10).
- [ ] G6. SO line rebuild: service lines replaced, extras appended, message reports `N replaced, M added` (:6872).
- [ ] G7. Kill the network mid-push → confirm partial items remain in Zoho with no rollback (BUG-11).
- [ ] G8. Push a 20+ cabinet project → watch for Zoho rate-limit errors (BUG-09).
- [ ] G9. Force a 401 → token auto-refresh retry fires once (`src/lib/zoho.ts:213–218`).
- [ ] G10. Force a token rate-limit → 5-minute cooldown message (`src/lib/zoho.ts:130–133`, `TOKEN_BACKOFF_MS = 5*60*1000`).

### CHK-H — `/` BOM Dashboard
- [ ] H1. Tabs `bom` / `accessories` switch (`BomDashboard.tsx:628`, :1446, :1449).
- [ ] H2. Accessory subform rows persist across reload via `localStorage["bom_accessory_subform_rows"]` / `["bom_accessory_subform_counter"]` (:672–673 read, :1208–1209 write). **This is the only persisted app state** (contrast BUG-03).
- [ ] H3. Stock status colours: `getStockStatus` (`src/lib/stock.ts:92`) — out-of-stock / low-stock / in-stock.
- [ ] H4. QR modal (:1992) and Packing List & Labels modal (:2035) render.
- [ ] H5. Raw Material Selection modal (:2102) lists stone groups; changing a stone marks the group `changed`.
- [ ] H6. A stone group whose default is not found is force-marked `changed: true` (`src/lib/rawmaterial.ts:535`) and named `(not found)` (:529).

### CHK-I — Exports
- [ ] I1. `exportBomWorkbook` (`src/lib/export.ts:365`) → `.xlsx` opens in Excel; styling intact (`xlsx-js-style`).
- [ ] I2. `exportBomCsv` (:383) → CSV opens; commas/quotes in item names escaped correctly.
- [ ] I3. PDF export (`jspdf`) renders.
- [ ] I4. QR codes (`qrcode`) scan to `/qr/bom/<orderId>`; barcodes (`jsbarcode`) scan.
- [ ] I5. **Scan a QR from a phone that has never authenticated** → confirm the auth wall blocks it (BUG-12).

### CHK-J — Reorder + AI Copilot
- [ ] J1. `/reorder` loads from `/api/zoho/reorder-report`; PO vendor map (`/api/zoho/po-vendor-map`) populates.
- [ ] J2. `DraftPoModal` opens, vendors list, draft PO submits.
- [ ] J3. AI Copilot without `OPENAI_API_KEY` → HTTP 500 `OpenAI API Key not configured on the server.` (`src/app/api/ai/chat/route.ts:9–13`).
- [ ] J4. With a key → chat responds; **verify no secrets leak into the prompt**.
- [ ] J5. **Confirm the hole:** `curl -X POST /api/ai/chat` unauthenticated works → arbitrary OpenAI spend (BUG-01).

### CHK-K — Regression guards after any drawer change
- [ ] K1. Mirror the change into `scratch/test-drawers.js` **in the same commit**.
- [ ] K2. Re-run the 3-step loop.
- [ ] K3. Rebuild Scenarios A–D by hand in `/builder` and compare against the table in §1.1.

## 1.5 Proposed unit test cases (highest-risk logic)

Recommended runner: **Vitest** (`npm i -D vitest`, `"test": "vitest run"`). Blocker: the target functions are **module-private inside an 11k-line `"use client"` component**. Extract them to `src/lib/geometry.ts`, `src/lib/shutters.ts`, `src/lib/drawers.ts`, `src/lib/codes.ts` and re-export first — that extraction is prerequisite work for tests **and** the fix for BUG-04. `src/lib/rawmaterial.ts` and `src/lib/stock.ts` are already importable today.

### `ctGeom(type, L, D, T, dropHeight = 705)` — `src/components/CarcassBomBuilder.tsx:161`

| id | Target | Input | Expected |
|---|---|---|---|
| CT-01 | `ctGeom` | `(1, 3000, 600, 40)` | `topL=3000`, `topD=630`, `baseL=3000`, `baseD=560`, `panels=[]`, `brass=0`, `sideDrops=0`, `grandLights=1` |
| CT-02 | `ctGeom` | `(2, 3000, 600, 40)` | one panel `{label:"Drop-Down Left", len:600, wid:705, kind:"dropdown"}`; `brass=1`, `sideDrops=1`, `topL=2900`, `baseL=2900`, `topD=630`, `baseD=560` |
| CT-03 | `ctGeom` | `(3, 3000, 600, 40)` | one panel `Drop-Down Right`; `brass=1`, `sideDrops=1`, `topL=2900` |
| CT-04 | `ctGeom` | `(4, 3000, 600, 40)` | two panels (Left, Right); `brass=2`, `sideDrops=2`, `topL=2800`, `baseL=2800` |
| CT-05 | `ctGeom` | `(5, 3000, 600, 40)` | `edgeFolds=2` → `topL = 3000 + 60 = 3060`; `brass=0`; `panels=[]`; `baseL=3000` |
| CT-06 | `ctGeom` | `(2, 3000, 600, 40, 0)` | `dropHeight ≤ 0` → falls back to `705` (`dh` guard, :162) → panel `wid=705` |
| CT-07 | `ctGeom` | `(2, 3000, 600, 40, 900)` | panel `wid=900` |
| CT-08 | `ctGeom` | `(6, 3000, 600, 40)` | panel `{label:"Island Back Panel (single-side)", len:2940, wid:705}`; island → `sideDrops=2`, `brass=2`, `backDrops=1`, `topD = 600+30-100 = 530`, `baseD = 600-40-100 = 460`, `grandLights=1` |
| CT-09 | `ctGeom` | `(7, 3000, 600, 40)` | `grandLights=2`; `reduce=0` → `topL=3000`, `baseL=3000`, `topD=630`, `baseD=560`; panel `len=2940` |
| CT-10 | `ctGeom` | `(8, 3000, 600, 40)` | panel `{label:"Island Sitting Drop", len:2920, wid:350, deadQty:2}`; `topDepthReduce=0` → `topD=630`; `baseD = 600-40-100 = 460` |
| CT-11 | `ctGeom` | `(9, 3000, 600, 40)` | panel `Island Back Panel (section)`, `len=2940` |
| CT-12 | `ctGeom` | `(6, 50, 600, 40)` | `len = max(0, 50-60) = 0` — clamp holds, no negative |
| CT-13 | `ctGeom` | `(8, 50, 600, 40)` | `len = max(0, 50-80) = 0` |
| CT-14 | `ctGeom` | `(6, 3000, 100, 40)` | `baseD = max(0, 100-40-100) = 0` — clamp holds |
| CT-15 | `ctGeom` | `(4, 100, 600, 40)` | `topL = 100 - 200 = -100` — **`topL` is NOT clamped** (:191). Assert current behaviour, then decide (see BUG-13) |
| CT-16 | `ctHasDrop` | `1,2,3,4,5,6,7,8,9` | `false,true,true,true,false,true,true,true,true` (islands via `CT_TYPES.island`) |

### `shDeduct(isBase, design, loc)` — `:788`

| id | Target | Input | Expected |
|---|---|---|---|
| SD-01 | `shDeduct` | `(false, "MD1", "UL")` | `3` (non-base short-circuits) |
| SD-02 | `shDeduct` | `(false, "CL1", "ML")` | `3` |
| SD-03 | `shDeduct` | `(true, "MD1", "UL")` | `33` |
| SD-04 | `shDeduct` | `(true, "MD1", "ML")` | `3` |
| SD-05 | `shDeduct` | `(true, "MD3", "BH")` | `33` |
| SD-06 | `shDeduct` | `(true, "MD3", "ML")` | `3` |
| SD-07 | `shDeduct` | `(true, "MD1CM1", "RH")` | `33` |
| SD-08 | `shDeduct` | `(true, "MD3CM2", "ML")` | `3` |
| SD-09 | `shDeduct` | `(true, "MD2", "UL")` | `3` (MD2 not in the 33-list) |
| SD-10 | `shDeduct` | `(true, "MD2", "ML")` | `3` |
| SD-11 | `shDeduct` | `(true, "CL1", "UL")` | `3` |
| SD-12 | `shDeduct` | `(true, "NEON20", "UL")` | `3` |
| SD-13 | `shDeduct` | `(true, "md1", "UL")` | `3` — **case-sensitive** `includes`; lowercase silently misses the 33 branch. Lock the contract |
| SD-14 | `shDeduct` | `(true, "", "UL")` | `3` |
| SD-15 | `shThkOf` | `("MD3", false)` / `("MD3CM1", false)` / `("MD3CM2", false)` | `9` |
| SD-16 | `shThkOf` | `("MD1", false)` / `("CL2", false)` | `6` |
| SD-17 | `shThkOf` | `("MD3", true)` | `5` — glass flag wins over MD3 |
| SD-18 | `hingeN` | `900 / 901 / 1600 / 1601 / 2100 / 2101` | `3 / 4 / 4 / 5 / 5 / 6` |

### `addDrawerBoxes(zk, fk, v, W, D, t, panels, profiles, hardware, cons, pkRows, drawerModel, inbuiltDrawers)`

| id | Target | Input | Expected |
|---|---|---|---|
| DB-01 | `addDrawerBoxes` | `("BC","DW",{id:"3dr",p3:"2LB",p4:"1HB"},600,560,15,…,"Lian","none")` | pkRows: `Drawer Pack- Cab Drawer Box Low` qty 2, `…High` qty 1; `hardware.length === 0`; backs `528x63x15` ×2, `528x212x15` ×1 |
| DB-02 | `addDrawerBoxes` | same, `"2hb1bl"` | High qty 2 with `backH = 63`; Low qty 1; exactly 1 `Fascia Low 562x110x15`; no `H239`; total `H90 = 1`; **no** `h = 212` panel |
| DB-03 | `addDrawerBoxes` | `("BC","GD",{id:"gd",p3:"GD",p4:"1HF"},600,560,15,…,"Lian","none")` | `GD` → `"1lb"`; Low 1 + High 1; fascia in own pack `Panels- Cab Drawer Box Fascia Low 562x110x15` |
| DB-04 | `addDrawerBoxes` | `("BC","DPN",{id:"h"},600,560,15,…,"Lian","none")` | `fixed_dpn` → Low 2 + Semi High 3; `H90` qty 2; `H175` qty 3; Semi `DBC` qty 12; Semi back `528x148x15`; fascias 110×2 + 210×3 |
| DB-05 | `addDrawerBoxes` | `(…, "BPO", …)` | `isAcc` → **no** standard drawer boxes emitted |
| DB-06 | `addDrawerBoxes` | `(…, "WBP", …)` | `isAcc` → no standard boxes |
| DB-07 | `addDrawerBoxes` | `(…, drawerModel: "Unknown", …)` | `supportedModel === false` → `panels/profiles/hardware/pkRows` all empty |
| DB-08 | `addDrawerBoxes` | `(…,"Hettich","none")` / `"Blum"` / `"Hafele"` / `"Grass"` | identical output to `"Lian"` |
| DB-09 | `addDrawerBoxes` | `W = 900, D = 600, t = 18` | `backW = 828`, `bottomW = 850`, `bottomD = 523`, `faciaW = 856`, `DBC len = 822`, `DBS len = 483` (fixed) |
| DB-10 | `addDrawerBoxes` | `("BC","DW",{id:"3dr",…},…,"1lb")` | `shutSpec` → 2 HB fronts + 1 built-in Low; High keeps `backH = 212` (unlike `2hb1bl`) |
| DB-11 | `addDrawerBoxes` | `(…, "1sb")` | 1 Semi High built-in: `backH = 148`, `fasciaH = 210`, `H175` qty 1 |
| DB-12 | `addDrawerBoxes` | `(…, "2lb")` | 2 built-in Low: `H90` qty 2, 2 fascias at 110 |
| DB-13 | `addDrawerBoxes` | `(…, "2sb")` | 2 built-in Semi: `H175` qty 2, 2 fascias at 210 |
| DB-14 | `addDrawerBoxes` | call **twice** with the same arrays | fascia pkRow and pack pkRow are **not** duplicated (`pkRows.some` guards, `test-drawers.js:111`, `:121`) |
| DB-15 | `getDrawerCount` | `("Drawer Pack- Cab Drawer Box Low", panelsA)` | `2` (from the Back panel qty) |
| DB-16 | `getDrawerCount` | `("Drawer Pack- Cab Drawer Box Low", [])` | `1` (default for drawer boxes) |
| DB-17 | `getDrawerCount` | `("Drawer Pack- Cab Pullout Shelf", [])` | `4` (default for pullout) |
| DB-18 | `getDrawerCount` | `("Drawer Pack- Cab Pullout Shelf", panelsE)` | `4` (from the Base panel qty; name rewritten to `Set of Parts-`) |

### `validDesigns(zk, fk, v, W?, handle?)` — `:823`

| id | Target | Input | Expected |
|---|---|---|---|
| VD-01 | `validDesigns` | `("BC","DW",null)` | all 12 `SH_DESIGNS` (null variant short-circuit, :824) |
| VD-02 | `validDesigns` | `("BC","SHF",{…})` where `shutSpec.kind === "none"` | `[]` |
| VD-03 | `validDesigns` | `("WC","WGL",{…})` (glass family) | exactly `["NEON20","CL1"]` |
| VD-04 | `validDesigns` | `("BC","DW",{id:"2dr",p3:"XXX",p4:"2HB"})` | all designs **minus** `NEON20` (all fronts `hb=1`) |
| VD-05 | `validDesigns` | `("BC","DW",{id:"3dr",p3:"2LB",p4:"1HB"})` | exactly `["MD1","MD2","MD3"]` (has `hb=0` fronts) |
| VD-06 | `validDesigns` | `("BC","BPO",{…}, 150)` | exactly `["MD1","MD2","MD3"]` |
| VD-07 | `validDesigns` | `("BC","BPO",{…}, 300)` | not narrowed to the MD-only list |
| VD-08 | `validDesigns` | `("BC","DW",{id:"2dr",…}, undefined, "XCJ")` | `STD_DESIGNS` (`MD2,MD2CM1,MD2CM2`) removed |
| VD-09 | `validDesigns` | `("BC","DW",{id:"2dr",…}, undefined, "STD")` | `XCJ_DESIGNS` (`MD1,MD3,MD1CM1,MD1CM2,MD3CM1,MD3CM2`) removed |
| VD-10 | `validDesigns` | `("WC","WST",{…}, undefined, "XCJ")` | handle filter **skipped** (`isBase` false) |
| VD-11 | `validDesigns` | `("TC","PAN",{…}, undefined, "XCJ")` | handle filter skipped (`Z.tall`) |
| VD-12 | `validDesigns` | `("BC","DW",{id:"3dr",p3:"2LB",p4:"1HB"}, undefined, "STD")` | `["MD2"]` — MD1/MD3 stripped by the XCJ filter |
| VD-13 | `validDesigns` | `("BC","DW",{id:"3dr",…}, undefined, "XCJ")` | `["MD1","MD3"]` |
| VD-14 | `validDesigns` | any input | result is a **fresh** array — mutating it must not corrupt `SH_DESIGNS` |

### `parseCabinetCodeToModel(code, currentDesign, overrides?)` — `:4829`

| id | Target | Input | Expected |
|---|---|---|---|
| PC-01 | `parseCabinetCodeToModel` | `("BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15")` | `zk="BC"`, `W=600`, `H=720`, `D=560`, `t=15`, `handle="XCJ"`, `carcassMat="STATUARIO"`, `shutterMat="STATUARIO"` (defaults, :4896–4897) |
| PC-02 | `…` | `("BC-DW-STD-ST-2LB-1HB-XXX-600-720-560-15")` | `handle = "STD"` (:4891) |
| PC-03 | `…` | `("")` | `null` (:4835) |
| PC-04 | `…` | `("BC-DW-CJ-ST-2LB-1HB-XXX-600-720")` (10 fields) | `null` (`parts.length < 11`, :4840) |
| PC-05 | `…` | `("ZZ-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15")` | `null` (unknown zone, :4843) |
| PC-06 | `…` | `("BC-DW-CJ-ST-2LB-1HB-XXX-abc-720-560-15")` | `null` (`isNaN(W)`, :4854) |
| PC-07 | `…` | `("BC-ZZZ-CJ-ST-2LB-1HB-XXX-600-720-560-15")` | `null` (no family with that p2, :4860) |
| PC-08 | `…` | `("BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15-SO-00029")` | `-SO-…` stripped (:4838); parses identically to PC-01 |
| PC-09 | `…` | `("BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15-BLACK MARQUINA")` | `carcassMat = shutterMat = "BLACK MARQUINA"` (:4909) |
| PC-10 | `…` | `("…-15-STATUARIO-CALACATTA")` | `carcassMat="STATUARIO"`, `shutterMat="CALACATTA"` (:4906–4907) |
| PC-11 | `…` | `("…-15-STATUARIO/CALACATTA")` | slash form → same split (:4899–4902) |
| PC-12 | `…` | `("…-15-BLACK-MARQUINA")` | **BUG-14**: yields `carcass="BLACK"`, `shutter="MARQUINA"`. Assert current behaviour and flag |
| PC-13 | `…` | `("…-15-STATUARIO-CALACATTA-GOLD")` | `shutterMat = "CALACATTA-GOLD"` (`slice(1).join("-")`, :4907) |
| PC-14 | `…` | code containing `2HS` in p3/p4/p5 | double-door variant selected (:4878–4882) |
| PC-15 | `…` | code with `RHS` in p4/p5 | `hand = "RHS"`; otherwise `"LHS"` (:4890) |
| PC-16 | `…` | `WC` code with `matToken = "GL"` and shared p2 `SH` | glass family (`WGL`) chosen (:4862–4864) |
| PC-17 | `…` | `WC` code with `matToken = "ST"`, p2 `SH` | stone family (`WST`) chosen |
| PC-18 | `…` | `overrides = { carcassMat:"X", shutterMat:"Y", profileColor:"BLACK" }` | overrides win over the suffix (:4915–4917) |
| PC-19 | `…` | `overrides = {}` | `profCol` defaults to `"CHAMPAGNE"` (:4917) |
| PC-20 | `…` | round-trip: `buildModel(...).code` → `parseCabinetCodeToModel(code)` | recovers zone, family, variant, W/H/D/t, handle, finishes for **every** zone×family×variant |

### `searchStoneItems(finish, stoneThickness, excludeStoneId?)` — `src/lib/rawmaterial.ts:604`
Mock `fetch` for `/api/zoho/items?search=…`.

| id | Target | Input | Expected |
|---|---|---|---|
| SS-01 | `searchStoneItems` | finish `"STATUARIO"`, thk `"15"`; catalog has `STONE STATUARIO 2800X1200X15` | that item returned, ranked first (exact) |
| SS-02 | `searchStoneItems` | finish `"BLACK STATUARIO NUVOLATO"`, thk `"15"`; catalog has only `STONE STATUARIO NUVOLATO … X15` | returned via `finishMatchesCore` (qualifier `black` dropped, :599–602, :640) |
| SS-03 | `searchStoneItems` | as SS-02 but catalog has **both** the exact and the core item | **exact first**, core second (`ranked`, :651–656) |
| SS-04 | `searchStoneItems` | finish `"BLACK MARQUINA"`, thk `"15"`; catalog has `WHITE MARQUINA … X15` only | **BUG-06**: `WHITE MARQUINA` is returned (`marquina` is the only core token). Assert & flag |
| SS-05 | `searchStoneItems` | finish `"BLACK"` (all-qualifier), thk `"15"` | `coreTokens = []` → falls back to `finishMatchesExact` (:642) |
| SS-06 | `searchStoneItems` | thk `"6"`; item name `06MM` | matched via `thicknessFromName` `\b(\d{1,2})\s*MM\b` (:624) |
| SS-07 | `searchStoneItems` | thk `"15"`; item name `…2800X1200X15` | matched via the `W×H×T` regex (:622) |
| SS-08 | `searchStoneItems` | thk `"2800"`; item name `2800MM` | **not** matched — `\d{1,2}` guard rejects 4-digit MM (:624) |
| SS-09 | `searchStoneItems` | thk `"0"` / `""` | `targetThickness = 0` → `thickOk` always true (:648) |
| SS-10 | `searchStoneItems` | `excludeStoneId = "X"` and item `X` in the catalog | item `X` excluded (:610) |
| SS-11 | `searchStoneItems` | a composite item in the catalog | excluded (`isComposite`, :609) |
| SS-12 | `searchStoneItems` | item with `cf_group="Stone"` / `group_name="Stone"` / name containing `stone` | each qualifies as stone (:611–614) |
| SS-13 | `searchStoneItems` | **all 3** queries throw | the last error **rethrows** (`!anySucceeded && lastError`, :682) |
| SS-14 | `searchStoneItems` | queries succeed but nothing matches the thickness | last-resort: core-finish matches of **any** thickness (:685) |
| SS-15 | `searchStoneItems` | query 1 hits | returns immediately; queries 2 and 3 are **not** issued (:677) |
| SS-16 | `searchStoneItems` | verify query order | `["STONE 15", finish, "STONE"]` (:658) |

### `getStockStatus(actualQty, effectiveStock)` — `src/lib/stock.ts:92`

| id | Target | Input | Expected |
|---|---|---|---|
| GS-01 | `getStockStatus` | `(10, 0)` | `"out-of-stock"` |
| GS-02 | `getStockStatus` | `(10, -5)` | `"out-of-stock"` |
| GS-03 | `getStockStatus` | `(10, 9)` | `"out-of-stock"` (`effectiveStock < actualQty`) |
| GS-04 | `getStockStatus` | `(10, 10)` | `"low-stock"` (`10 < 15`) |
| GS-05 | `getStockStatus` | `(10, 14.99)` | `"low-stock"` |
| GS-06 | `getStockStatus` | `(10, 15)` | `"in-stock"` (boundary is **exclusive**) |
| GS-07 | `getStockStatus` | `(10, 100)` | `"in-stock"` |
| GS-08 | `getStockStatus` | `(0, 0)` | `"out-of-stock"` — **`effectiveStock <= 0` wins even when nothing is required**. Assert & review |
| GS-09 | `getStockStatus` | `(0, 5)` | `"in-stock"` (`5 < 0` false) |
| GS-10 | `getStockStatus` | `(0.5, 0.7)` | `"low-stock"` (`0.7 < 0.75`) |
| GS-11 | `getStockStatus` | `(NaN, 10)` | current: `10 < NaN` false, `10 < NaN` false → `"in-stock"`. **NaN silently reads as in-stock** — assert & review |
| GS-12 | `getRawStock` | item with `stocks:[{stock_on_hand: 7}]` | `7` (array wins, `stock.ts:77–78`) |
| GS-13 | `getRawStock` | item with only `actual_available_stock: 3` | `3` (candidate order, :79–85) |
| GS-14 | `getRawStock` | `null` / no stock fields | `0` (:76, :89) |
| GS-15 | `getRawStock` | `stock_on_hand: NaN` | falls through NaN, keeps scanning (:87) |

## 1.6 Proposed integration tests

Recommended: Vitest + `msw` (mock Zoho) for IT-01…IT-08; Playwright for IT-09…IT-12. Point at a **sandbox Zoho org** — never production.

| id | Scope | Setup | Steps | Expected |
|---|---|---|---|---|
| IT-01 | Cabinet code round-trip | none (pure) | For every zone × family × variant × handle, `buildModel(...)` → `.code` → `parseCabinetCodeToModel(code)` → compare `zk/fk/variant.id/W/H/D/t/handle/carcassMat/shutterMat` | Every code round-trips. Any `null` is a bug |
| IT-02 | Full BOM tree for a drawer cabinet | none | Build `BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15`, run `buildFullBomData(model, 1)` | Structure matches T1–T13 against the **real** function, not the mock. **This is the highest-value test in the list** — it removes the mirror-drift risk (§1.1) |
| IT-03 | Countertop BOM | none | Build each of the 9 `CT_TYPES` at `L=3000, D=600, T=40` and snapshot the rows (`:3863–3970`) | Stable snapshots; master item `Countertop Pasting Material 40mm 3000x600…` (:3886) |
| IT-04 | Zoho push idempotency | `msw` fake Zoho with an in-memory item store | Push the same cabinet twice | Second push issues **zero** `POST /items` — every name resolves via `searchItemByName` |
| IT-05 | Zoho push after rename | as IT-04 | Push; rename one part in the generator; push again | Reproduces BUG-07: a duplicate item is created. Lock this until an SKU/hash key exists |
| IT-06 | Zoho push partial failure | `msw`; fail the SO `PUT` (`:6873`) | Push a 3-cabinet project | Items **are** created, SO is not updated, no rollback → reproduces BUG-11 |
| IT-07 | Zoho rate limit | `msw` returning HTTP 429 on the 5th `POST /items` | Push a 10-cabinet project | Reproduces BUG-09: the push aborts, no retry/backoff |
| IT-08 | Token refresh | `msw`; `GET` returns 401 once, then 200 | Any `zohoInventoryGet` | One refresh + one retry (`zoho.ts:213–218`), then success. A second 401 must **not** loop |
| IT-09 | API auth (E2E) | dev server, cleared `localStorage` | `GET /api/zoho/status`, `GET /api/zoho/items?search=x`, `POST /api/ai/chat` | **Currently all 200** → reproduces BUG-01. After the fix: **401** |
| IT-10 | Builder → export (E2E) | Playwright | Auth → `/builder` → configure `BC-DW` → export XLSX | File downloads; parse with `xlsx` and assert the Drawer Pack rows |
| IT-11 | State loss (E2E) | Playwright | `/builder` → add 3 cabinets to the project → **reload** | Project is empty → reproduces BUG-03. After the fix: restored |
| IT-12 | SO → BOM (E2E) | Playwright + sandbox SO | `/designer` → search SO → select → tree renders | Every line decodes; unparseable lines flagged, not crashed |

## 1.7 Test data fixtures

### Sample cabinet codes
Format (11 fields + optional finish suffix), from `:1814`, `:2107`, `:4836–4837`:
`p1 - p2 - handleToken(CJ|STD) - matToken(GL|ST) - p3 - p4 - p5 - W - H - D - t - [carcassMat[-shutterMat]]`
`p5` (P7) is **always** the literal `XXX` since the P7 change (`:2105–2107`).

```
# Base drawer, XCJ handle, stone, 2 Low + 1 High Back — the Scenario A cabinet
BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15

# Same, with an explicit dual finish (carcass STATUARIO, shutter CALACATTA)
BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15-STATUARIO-CALACATTA

# Same, single finish with a space (must NOT split)
BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15-BLACK MARQUINA

# Slash-form dual finish
BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15-STATUARIO/CALACATTA

# With the SO suffix (must be stripped at :4838)
BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15-SO-00029

# Base 2-drawer (2HB), STD/Titus handle
BC-DW-STD-ST-XXX-2HB-XXX-600-720-560-15

# Base sink, single bowl handed (p3 XXX, hand in p4/p5)
BC-SK-CJ-ST-XXX-LHS-XXX-900-720-560-15
BC-SK-CJ-ST-XXX-RHS-XXX-900-720-560-15

# Base sink, double bowl (2HS token → double variant at :4878)
BC-SK-CJ-ST-XXX-2HS-XXX-1200-720-560-15

# Base garbage drawer (GD → forced inbuiltDrawers "1lb")
BC-GD-CJ-ST-GD-1HF-XXX-600-720-560-15

# Base bottle pull-out at W=150 (design list narrows to MD1/MD2/MD3 at :837)
BC-BPO-CJ-ST-XXX-XXX-XXX-150-720-560-15

# Low-depth base (BCL — famSetOf returns ONLY SH, see BUG-08)
BCL-SH-CJ-ST-XXX-LHS-XXX-600-720-336-15

# Blind base — plain blind (BB.PLB is in SIZES but NOT reachable via famSetOf, BUG-08)
BB-SH-CJ-ST-XXX-LHS-XXX-1150-720-560-15

# Wall glass (matToken GL disambiguates WGL from WST at :4862)
WC-SH-CJ-GL-2SG-XXX-XXX-600-720-350-15

# Wall stone, same p2 (matToken ST → WST)
WC-SH-CJ-ST-2S-XXX-XXX-600-720-350-15

# Tall pantry (DPN → forced inbuiltDrawers "fixed_dpn": 2 Low + 3 Semi High)
TC-DPN-CJ-ST-XXX-LHS-XXX-600-2400-560-15

# Tall pullout-shelf pantry — the PPN fixture from test-drawers.js:484
TC-PO-2SX-LHS-4PO-600-2400-560-15

# Loft
LO-SH-CJ-ST-XXX-LHS-XXX-600-400-350-15

# --- Negative fixtures (all must return null from parseCabinetCodeToModel) ---
""                                             # empty            (:4835)
"BC-DW-CJ-ST-2LB-1HB-XXX-600-720"              # 10 fields        (:4840)
"ZZ-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15"       # unknown zone     (:4843)
"BC-ZZZ-CJ-ST-2LB-1HB-XXX-600-720-560-15"      # unknown family   (:4860)
"BC-DW-CJ-ST-2LB-1HB-XXX-abc-720-560-15"       # non-numeric W    (:4854)
```

### Sample Sales Order fixture
Shape from `src/lib/types.ts` / `src/app/api/zoho/salesorders/[id]/route.ts`. Recorded live responses already exist in the repo and are the best real-world fixtures:
- `scratch_so.json` — SO list response
- `scratch_detail.json` — SO detail response
- `scratch_items.json` — items response (for `searchItemByName` / `searchStoneItems` mocks)

Minimal synthetic SO for `msw`:

```json
{
  "salesorder": {
    "salesorder_id": "3418412000000999001",
    "salesorder_number": "SO-00029",
    "customer_name": "Test Customer",
    "status": "draft",
    "line_items": [
      {
        "line_item_id": "3418412000000999101",
        "item_id": "3418412000000999201",
        "name": "BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15-STATUARIO-CALACATTA",
        "sku": "BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15-STATUARIO-CALACATTA",
        "description": "Base drawer cabinet 600 — Elevation A",
        "quantity": 2,
        "rate": 25000,
        "item_type": "service"
      },
      {
        "line_item_id": "3418412000000999102",
        "item_id": "3418412000000999202",
        "name": "TC-DPN-CJ-ST-XXX-LHS-XXX-600-2400-560-15-STATUARIO",
        "sku": "TC-DPN-CJ-ST-XXX-LHS-XXX-600-2400-560-15-STATUARIO",
        "quantity": 1,
        "rate": 68000,
        "item_type": "service"
      }
    ]
  }
}
```

Stone item fixtures for `searchStoneItems` tests:

```json
{ "items": [
  { "item_id": "stone-stat-15",  "name": "STONE STATUARIO 2800X1200X15",           "group_name": "Stone", "custom_fields": [{"api_name":"cf_finish","value":"STATUARIO"},{"api_name":"cf_thickness","value":"15"}] },
  { "item_id": "stone-nuv-15",   "name": "STONE STATUARIO NUVOLATO 2800X1200X15",  "group_name": "Stone", "custom_fields": [] },
  { "item_id": "stone-marq-w15", "name": "STONE WHITE MARQUINA 2800X1200X15",      "group_name": "Stone", "custom_fields": [] },
  { "item_id": "stone-stat-06",  "name": "STONE STATUARIO 06MM",                   "group_name": "Stone", "custom_fields": [] },
  { "item_id": "stone-big",      "name": "STONE STATUARIO 2800MM SLAB",            "group_name": "Stone", "custom_fields": [] }
] }
```
(`stone-marq-w15` is the SS-04 trap; `stone-big` is the SS-08 trap.)

### Constants fixture (`W = 600, D = 560, t = 15`)

| Quantity | Formula | Value |
|---|---|---|
| `backW` | `W - 72` | `528` |
| `bottomW` | `W - 50` | `550` |
| `bottomD` | `D - 77` | `483` |
| `faciaW` | `W - 2t - 8` | `562` |
| `DBC len` | `W - 78` | `522` |
| `DBS len` | fixed | `483` |

---

# PART 2 — KNOWN BUGS & RISKS

Severity: **Critical** = data loss / security breach / production corruption · **High** = major functional or maintainability failure · **Medium** = wrong output in real cases · **Low** = limited or cosmetic.

---

## BUG-01 — [Critical] Client-side-only auth; every `/api` route is unauthenticated

**Verified.** `AuthGate` is a **client component** (`src/components/AuthGate.tsx:3` `import React, { useState, useEffect }`) that merely conditionally renders its children based on `localStorage["app_authenticated"]` (`AuthGate.tsx:12`). It wraps the tree in `src/app/layout.tsx:15`. There is **no middleware** (no `middleware.ts` anywhere) and **no auth check in any route handler** — `grep -rn "auth|cookie|session|token" src/app/api/zoho/items/route.ts` returns **nothing**. Every handler goes straight to Zoho:
- `src/app/api/zoho/items/route.ts:12` — `export async function GET(request: NextRequest)`, no guard
- `src/app/api/zoho/salesorders/route.ts:11` — same
- `src/app/api/ai/chat/route.ts:3` — `export async function POST(req: NextRequest)`, no guard
- …and `contacts`, `purchaseorders`, `compositeitems`, `reorder-report`, `po-vendor-map`, `status`, plus the `[id]` variants — 14 route files total, zero auth checks.

**Reproduction**
1. Deploy (or `npm run dev`).
2. From a browser that has **never** authenticated (or after `localStorage.clear()`):
   `curl 'https://<host>/api/zoho/items?search=STONE'` → **200** with the full item catalogue.
   `curl 'https://<host>/api/zoho/salesorders?q=SO'` → **200** with sales orders.
   `curl -X POST 'https://<host>/api/ai/chat' -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}'` → **200**, billed to `OPENAI_API_KEY`.
3. The `POST` handlers (`items`, `purchaseorders`) and `PUT` (`salesorders/[id]`, `items/[id]`) are equally open — an anonymous caller can **create items in and mutate the production Zoho org**.

**Impact** Total exposure of the Zoho Inventory org (item catalogue, customers, sales orders, purchase orders, pricing) to anyone who knows the URL, plus **write** access to create/modify items and sales orders, plus unmetered OpenAI spend. The password screen protects nothing but the pixels. If this is deployed on a public Vercel URL, treat it as **already breached**.

**Suggested fix**
1. Short term: add a `middleware.ts` matching `/api/:path*` that requires a **signed, HttpOnly, Secure cookie** (not a `localStorage` flag), and have a `POST /api/auth/login` route verify the password **server-side** against a hashed value in an env var and set that cookie.
2. Proper: real identity (NextAuth / Auth.js / Clerk) with per-user sessions and roles (`builder`, `designer`, `planning`, `factory`), enforced in middleware **and** re-checked in each handler.
3. Separate the write routes (`POST`/`PUT`) behind a stricter role than the reads.
4. Add IT-09 as a permanent regression test.

---

## BUG-02 — [Critical] Access password is hard-coded in the client bundle

**Verified.** `src/components/AuthGate.tsx:27`:

```tsx
if (password === "Factory@1234") {
  localStorage.setItem("app_authenticated", "true");
```

`AuthGate.tsx` is a client component rendered from `src/app/layout.tsx:15`, so this comparison — **and the literal string** — is compiled into the JavaScript that is served to every visitor. The constant is a bare inline string literal (not even a named constant), and there is no server round-trip.

**Reproduction**
1. Load any page.
2. DevTools → Sources (or `view-source` the bundle) → search the client chunks for `Factory@1234`.
3. It appears verbatim. Or: `npm run build && grep -r "Factory@1234" .next/static/` .
4. Anyone who has ever loaded the page — including an unauthenticated visitor stopped at the password screen, since the gate itself ships the answer — can read it.

**Impact** The "gate" is decorative: the password is handed to the attacker along with the lock. It is also almost certainly shared/reused by the factory team, so leaking it may compromise other systems. Combined with BUG-01 the app has, effectively, **no access control**. It is also unrotatable without a redeploy.

**Suggested fix**
1. Remove the literal from the client **immediately**. Move verification to a server route (`POST /api/auth/login`) comparing against a **bcrypt/argon2 hash** in a server-only env var (e.g. `AUTH_PASSWORD_HASH` — value should contain a hash of the chosen password, never the plaintext, and never `NEXT_PUBLIC_`-prefixed).
2. Issue an HttpOnly + Secure + SameSite=Strict session cookie; delete the `localStorage["app_authenticated"]` flag entirely (it is trivially forged with one console command regardless).
3. **Rotate the password** — assume the current one is public.
4. Fix together with BUG-01; neither is worth anything alone.

> Env-var note: `.env.example` documents `ZOHO_ORGANIZATION_ID`, `ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_ACCOUNTS_BASE_URL`, `ZOHO_INVENTORY_BASE_URL`; `src/app/api/ai/chat/route.ts:7` additionally requires `OPENAI_API_KEY`. `.env.local` and `.env.local.bak` exist on disk and hold **live credentials** — never commit, print, or paste them. Every value in this document is a placeholder. **`.env.local.bak` is not covered by a `*.bak` rule — verify `.gitignore` before any commit.**

---

## BUG-03 — [High] No persistence: all builder/project state is lost on reload

**Verified.** The only `localStorage` writes in the entire `src/` tree are:
- `src/components/BomDashboard.tsx:1208–1209` — `bom_accessory_subform_rows`, `bom_accessory_subform_counter` (read at :672–673)
- `src/components/AuthGate.tsx:28` — `app_authenticated`

`grep -rn "localStorage|sessionStorage|indexedDB" src/` returns **nothing else**. `CarcassBomBuilder.tsx` — the 11k-line component holding `model`, `project`, `countertops`, `selectedRawIds`, `rawOptionsMap`, `selectedSo`, `elevation`, `lineQty`, `soRate` — persists **none** of it. There is no session restore, no autosave, no draft, no URL state, no server-side store.

**Reproduction**
1. `/builder` → configure a cabinet → add 10 cabinets + 3 countertops to the project → select raw materials for every stone group (each selection is a Zoho round-trip).
2. Press F5 (or close the tab, or let the laptop sleep and the tab get evicted, or trip any unhandled render error).
3. Everything is gone. The project list is empty; every raw-material selection must be re-made; every Zoho search re-runs.

**Impact** A realistic kitchen project is 20–40 cabinets and takes a long session to assemble. One reflex reload, one crash, one accidental back-navigation destroys it with no warning and no recovery. This is the single most likely cause of day-to-day user pain, and it silently punishes exactly the largest, most valuable jobs. It also makes bug reports irreproducible — the reporter cannot hand you their state.

**Suggested fix**
1. Quick win (hours): debounced autosave of `{ project, countertops, selectedRawIds, model, elevation, soRate }` to `localStorage` under a versioned key (e.g. `magppie_builder_state_v1`), with a "Restore previous session?" prompt on mount. Add a schema `version` field and discard mismatches.
2. Add `beforeunload` warning while the project is non-empty.
3. Proper (days): server-side drafts (Zoho custom module, or a small Postgres/Supabase table) keyed by user + project name, with explicit Save/Load/Duplicate. This also unlocks multi-user collaboration and audit.
4. Add IT-11 as a regression test.

---

## BUG-04 — [High] 11,220-line single component — maintainability and performance risk

**Verified.** `wc -l src/components/CarcassBomBuilder.tsx` → **11220**. It is a single `"use client"` module holding, at minimum: `ZONES` (~:600–649), `BASE/BLIND/WALL/TALL/LOFT_FAMILIES` (~:490–598), `SIZES` (:701), `famSetOf` (:651), `CT_TYPES`/`ctGeom`/`ctHasDrop` (:109–196), `SH_*` constants + `shThkOf`/`shDeduct`/`hingeN`/`shutSpec`/`validDesigns` (:772–850), `buildModel` (~:1600–2110), `parseCabinetCodeToModel` (:4829), the entire Zoho resolution layer (`searchItemByName` :4943, `resolveSimpleItem` :4970, `resolveCompositeItem` :5033, `findExistingCompositeByRawMaterial` :5104, `resolveProfileBOM` :5143, `resolveHardwarePackComposite` :5518, `resolveHardwarePack` :5548), `buildFullBomData` (~:3039–3970), `handleAddToZohoSO` (:6001–6893), and ~4,000 lines of JSX (roughly :7900–11220). The three routes `/builder`, `/designer`, `/planning` are all thin wrappers over this one component (`src/app/builder/page.tsx`, `designer/page.tsx`, `planning/page.tsx`), differing only by the `soMode` / `planningMode` props.

**Reproduction (maintainability)**
1. Open the file in any editor — LSP/IntelliSense degrades, `tsc` is slow, editor search is the only navigation.
2. Try to unit-test `ctGeom`: impossible without a refactor — it is module-private in a client component (this is why §1.5 lists an extraction as prerequisite work, and why `scratch/test-drawers.js` **copies** logic instead of importing it, which is itself the mirror-drift risk in §1.1).
3. Any two developers touching different features collide in the same file on every merge.

**Reproduction (performance)**
1. `/builder` → add 30+ cabinets to the project.
2. Type in any input.
3. Every keystroke re-renders the whole component; the BOM tree and the ~4k-line JSX re-evaluate. `useMemo` is used only sparingly (`currentFams` :6896, `activeFamilyKey` :6897, design list :7043) — most derived data is recomputed inline. Expect visible input lag.
4. The single client bundle for `/builder` also ships the entire Zoho layer to `/designer` and `/planning`, which mostly do not need it.

**Impact** Every change is high-risk and slow. Nothing in the file is unit-testable, which is the root cause of the "no tests for countertop/shutters/exports/Zoho" gap in §1.3. Bugs like BUG-05 and BUG-14 survive precisely because the logic is unreachable from a test. Onboarding cost is severe.

**Suggested fix** (incremental, safest order; each step ends with the §1.2 loop)
1. **Pure geometry first** (zero React, zero risk): `src/lib/geometry.ts` ← `ctGeom`, `ctHasDrop`, `CT_TYPES`. Then `src/lib/shutters.ts` ← `SH_INSET`, `SH_FRAME`, `SH_DESIGNS`, `XCJ_DESIGNS`, `STD_DESIGNS`, `SH_KGSQFT`, `shThkOf`, `shDeduct`, `hingeN`, `shutSpec`, `validDesigns`. Then `src/lib/drawers.ts` ← `addDrawerBoxes`, `getDrawerCount`. Then `src/lib/catalog.ts` ← `ZONES`, `*_FAMILIES`, `SIZES`, `famSetOf`. Then `src/lib/codes.ts` ← `buildModel`, `parseCabinetCodeToModel`, `normalizeItemName`.
2. **Rewrite `scratch/test-drawers.js` to `import` from `src/lib/drawers.ts`** instead of mirroring — this kills the drift risk in one move and is the single highest-value follow-up.
3. **Zoho layer** → `src/lib/zoho-sync.ts` (`resolve*`, `searchItemByName`, `findExistingCompositeByRawMaterial`, `handleAddToZohoSO` body). Fix BUG-09/BUG-11 there once it is isolated.
4. **UI split** → `<ZoneFamilyPicker>`, `<DimensionsPanel>`, `<CountertopSection>`, `<BomTree>`, `<RawMaterialPanel>`, `<ZohoPushPanel>`; move project state into a reducer or a small store (Zustand) so typing does not re-render the tree. Add `React.memo` on the tree.
5. Do **not** attempt a big-bang rewrite. Extract → run the loop → commit → repeat.

---

## BUG-05 — [Medium] `MD3` has no entry in `DEFAULT_PROFILE_NAMES` → default profile resolution returns `null`

**Verified.** `DEFAULT_PROFILE_NAMES` (`src/lib/rawmaterial.ts:713–741`) contains `"md1"` (:734) and `"md2"` (:735) but **no `"md3"`**. `PROFILE_CODE_EQUIVALENCES` (`:688–711`) has `"md1cm1"`, `"md1cm2"`, `"md2cm1"`, `"md2cm2"` — but **no `"md3"`, `"md3cm1"`, or `"md3cm2"`**. So `getDefaultProfileName("MD3", finish)` (`:743`) finds no direct key (:745), finds no alias (:747–753), and returns **`null`** at `:755`.

Meanwhile `MD3` is a fully-supported, first-class design everywhere else:
- `SH_INSET.MD3 = 3` — `CarcassBomBuilder.tsx:772` (and `MD3CM1: 3`, `MD3CM2: 3`)
- `SH_FRAME.MD3 = 25` — `:773`
- `SH_DESIGNS` includes `"MD3"`, `"MD3CM1"`, `"MD3CM2"` — `:774`
- `XCJ_DESIGNS` includes `"MD3"`, `"MD3CM1"`, `"MD3CM2"` — `:778`
- `shThkOf` gives the MD3 family **9 mm** stone — `:784`
- `shDeduct` treats MD3 like MD1 (`33` / `3` on `ML`) — `:790`
- `validDesigns` offers `MD3` for low-back drawer fronts and `BPO@150` — `:835`, `:838`
- `extractProfileCode`-style mapping returns `"MD3"` — `:2418` (`if (upper.includes("MD3")) return "MD3";`)
- `src/data/profile_finishes.json:14` declares `"MD3": ["CERAMIC BLACK"]`
- `:3757`, `:7410`, `:7809` all branch `vp.profile.includes("MD3") ? "MD3" : "MD1"`

So the app happily routes users into `MD3` and then cannot name its profile. Note the asymmetric fallback at `:3757` etc. (`… ? "MD3" : "MD1"`) means a **non-MD3** profile silently resolves as MD1 — MD3 itself gets no such safety net.

**Reproduction**
1. `/builder` → any base drawer family → select design **`MD3`** (offered by `validDesigns`).
2. Build the BOM and push to Zoho / open the raw-material panel.
3. The MD3 shutter profile has no default name → `getDefaultProfileName` returns `null` → depending on the call site the profile group shows no default (`defaultProfileName: ""`, `src/lib/rawmaterial.ts:572`) or the push fails to resolve the profile item. `MD3CM1` / `MD3CM2` fail identically.

**Impact** Every MD3-family cabinet (a real, offered, ceramic-black product per `profile_finishes.json`) is silently un-resolvable. The user sees a blank/missing profile rather than a clear error, and may push an incomplete BOM to Zoho. Because the same `null` return also feeds `applyProfileChange` (`:1338`), a "fix it in the UI" workaround may not stick.

**Suggested fix**
1. Add the correct MD3 profile part number to `DEFAULT_PROFILE_NAMES` — **ask the factory/procurement team for the exact catalogue string** (it must follow the existing convention, e.g. `ALU PROF <DESC> 3000X<W>X<D> ANODISED CHAMPAGNE HM-<NNN> <VENDOR>`). Do **not** invent one; a wrong part number silently orders the wrong extrusion.
2. Add `"md3cm1": ["md3cm1", "cm1"]` and `"md3cm2": ["md3cm2", "cm2"]` to `PROFILE_CODE_EQUIVALENCES` (:688) to mirror the existing md1/md2 CM aliasing.
3. Make `getDefaultProfileName` returning `null` **loud** — surface an explicit "no default profile configured for `<code>`" error in the UI instead of an empty string, so the next gap is caught at build time rather than at the factory.
4. Add a unit test asserting `getDefaultProfileName(d, "CHAMPAGNE") !== null` for **every** `d` in `SH_DESIGNS` — that single test prevents the whole class.

---

## BUG-06 — [Medium] Stone search can fall back across finishes via core-token matching → wrong shade

**Verified.** `src/lib/rawmaterial.ts:599–602` defines `STONE_COLOR_QUALIFIERS`:

```ts
const STONE_COLOR_QUALIFIERS = new Set([
  "black", "white", "grey", "gray", "beige", "cream", "brown", "gold", "golden", "silver",
  "ivory", "green", "blue", "red", "pink", "sand", "taupe", "charcoal", "dark", "light",
]);
```

`coreTokens` (`:640`) strips **every** qualifier from the requested finish, and `finishMatchesCore` (`:641–645`) requires only that the remaining tokens appear in `cf_finish + name`:

```ts
const coreTokens = finishLower.split(/\s+/).filter((t) => t && !STONE_COLOR_QUALIFIERS.has(t));
const finishMatchesCore = (item) => {
  if (coreTokens.length === 0) return finishMatchesExact(item);
  const hay = (getCfValue(item, "cf_finish").toLowerCase() + " " + (item.name || "").toLowerCase());
  return coreTokens.every((t) => hay.includes(t));
};
```

Crucially the qualifier is **dropped, not made optional-but-preferred within the same rank**: `ranked` (`:651–656`) puts exact matches first, but if there is **no** exact match, core matches are returned as if they were valid, and `:685` returns core matches of **any thickness** as a last resort. The intent (comment at `:596–598`) is to let a request for `BLACK STATUARIO NUVOLATO` match a slab catalogued as `STATUARIO NUVOLATO`. The side effect is that it equally matches `WHITE STATUARIO NUVOLATO`.

**Reproduction**
1. Cabinet finish = `BLACK MARQUINA`, thickness `15`.
2. Zoho contains **no** `BLACK MARQUINA 15mm` but **does** contain `STONE WHITE MARQUINA 2800X1200X15`.
3. `coreTokens = ["marquina"]` (`black` stripped). `finishMatchesCore` → `hay` contains `marquina` → **true**.
4. `ranked` finds no exact match, so the **white** slab is returned as the ranked-first candidate and can be auto-selected as the default stone.
5. Worse case (`:685`): with no thickness match at all, a `WHITE MARQUINA` slab of a **different thickness** is returned too.
6. Same class: `BLACK STATUARIO` ↔ `WHITE STATUARIO`; `DARK GREY <stone>` ↔ `LIGHT GREY <stone>` (both `dark` and `light` and `grey` are qualifiers, so `DARK GREY X` and `LIGHT GREY X` reduce to the identical core `["x"]`).

**Impact** A cabinet is manufactured in the **wrong colour stone**. This is not a UI glitch — it flows into the Zoho BOM, the purchase order, and the factory cut list. Cost of a wrong slab on a countertop-scale job is material and the error is invisible in the BOM tree (the name shown is the item's own name, so it looks legitimate). The `black`/`white` pair is the most dangerous possible confusion in this catalogue.

**Suggested fix**
1. **Never silently return a cross-qualifier match.** Keep core matching, but tag each result with `matchType: "exact" | "core"` and require an **explicit user confirmation** for anything not `exact`.
2. Stronger: if the requested finish contains a qualifier and a candidate contains a **different** qualifier from the same set, **reject** it outright (`BLACK X` may match `X`, but never `WHITE X`). This preserves the original intent and removes the failure mode entirely.
3. Surface a loud UI warning for the `:685` any-thickness last resort (the comment there already says "with a UI warning" — verify one actually renders).
4. Add unit tests SS-02, SS-03, **SS-04** (§1.5).

---

## BUG-07 — [Medium] Zoho idempotency is item-**name**-based → renames/format changes create duplicates

**Verified.** Deduplication is purely by normalised name. `resolveSimpleItem` (`src/lib/rawmaterial.ts`… no — `CarcassBomBuilder.tsx:4970`):

```ts
const normName = normalizePartOrPanelName(name);
const existing = await searchItemByName(normName);
if (existing) return existing.item_id;
// …otherwise POST /api/zoho/items and create a brand-new item
```

`resolveCompositeItem` (`:5033`) does the same (`:5039–5046`). `searchItemByName` (`:4943–4967`) matches on `normalizeItemName(it.name) === target || normalizeItemName(it.sku) === target` — i.e. whitespace-collapsed, lower-cased **string equality on the name/SKU**. `normalizeItemName` is `:4936–4941`. `normalizePartOrPanelName` (`src/lib/naming.ts:36`) only collapses whitespace, rewrites `LH+RH`→`LH/RH`, and strips a trailing `-SO-nnnnn`. `findExistingCompositeByRawMaterial` (`:5104`) also **searches by name first** (`:5107`) and only then checks the raw-material link — so a renamed composite is never found either.

There is **no stable key**: no SKU derived from a content hash, no `cf_` fingerprint, no external-ID field. The item name **is** the primary key.

**The P7 precedent — this has already happened.** `CarcassBomBuilder.tsx:2105–2107`:

```ts
// P7 (p5) used to repeat the handle as XCJ/STD — redundant with P3's handle token (CJ/STD) and
// confusing for the team, so it is now "XXX". The handle is decoded from P3 (handleToken).
const code = [z.p1, f.p2, handleToken, matToken, codeP3, codeP4, "XXX", W, H, D, t].join("-") + …
```

Every cabinet code emitted before that change carried `XCJ`/`STD` in field 7; every code emitted after carries `XXX`. Since the code **is** the item name, the same physical cabinet now resolves to a **different** name → `searchItemByName` misses → a **duplicate Zoho item** is created. The old items remain, still linked to historical SOs.

**Reproduction**
1. Push cabinet `BC-DW-CJ-ST-2LB-1HB-XCJ-600-720-560-15` (pre-P7 naming). Item created.
2. Apply the P7 change (or any rename: a panel name format tweak, an extra space that survives normalisation, a finish-suffix format change, `Set of Parts-` → `Drawer Pack-`).
3. Push the **same physical cabinet** again → name is now `…-XXX-…` → `searchItemByName` returns `null` → **a second item is created**.
4. Repeat with any of the drawer-pack renames the architecture has already been through (`Set of Parts- Cab Drawer Box` → `Drawer Pack- Cab Drawer Box`, per `scratch/test-drawers.js:302`, `:421`, `:459`) — same outcome for every affected composite and every panel/part beneath it.

**Impact** Zoho fills with near-duplicate items and composites. Stock is split across duplicates, so `getStockStatus` (`src/lib/stock.ts:92`) reports **false out-of-stock** on one twin while inventory sits on the other; the re-order report over-orders; purchase history and costing fragment; the item list becomes unnavigable. Cleanup is manual, risky (historical SOs reference the old IDs), and grows with every naming change — which the code comments show is a recurring event. **Every future naming decision is now a migration.**

**Suggested fix**
1. Introduce a **stable identity independent of the display name**: compute a deterministic hash/fingerprint of the *semantic* spec (zone, family, variant, W/H/D/t, finishes, drill, design) and store it in a dedicated Zoho custom field (e.g. `cf_bom_key`) **and/or** as the SKU. Resolve by that key first; fall back to name only for legacy items.
2. Ship a **one-off reconciliation script** (`scratch/` is the natural home) that walks existing items, computes `cf_bom_key`, and reports duplicate clusters for a human to merge. Do not auto-merge.
3. Until (1) lands, treat **any** change to a generated name as a **breaking migration**: state it in the PR, and plan the reconciliation.
4. Add IT-04 and IT-05 (§1.6) so a rename that creates duplicates fails CI rather than production.

---

## BUG-08 — [Low] `famSetOf` restricts BCL/BB families → several `SIZES` entries are unreachable from the UI

**Verified.** `famSetOf` (`CarcassBomBuilder.tsx:651–663`) hard-restricts four zones:

```ts
const famSetOf = (z: string) => {
  if (z === "BCL") return { SH: BASE_FAMILIES.SH };                          // :652–654
  if (z === "BB")  return { LMC: BLIND_FAMILIES.LMC, BSH: BLIND_FAMILIES.BSH }; // :655–657
  if (z === "BBL") return { BSH: BLIND_FAMILIES.BSH };                       // :658–660
  if (z === "WB")  return { WGL: WALL_FAMILIES.WGL, WST: WALL_FAMILIES.WST }; // :661–663
  …
```

But `SIZES` (`:701`) still defines entries for families those zones no longer expose:

| `SIZES` key | Line | Reachable via `famSetOf`? |
|---|---|---|
| `BCL.DW` — `w:[450,600,900], h:[720], d:336` | `:711` | **No** (BCL → `SH` only) |
| `BCL.HO` — `w:[600,900], h:[720], d:336` | `:712` | **No** |
| `BCL.SK` — `w:[600,900,1050,1200], h:[720], d:336` | `:713` | **No** |
| `BCL.SH` — `w:[450,600], h:[720], d:336` | `:714` | **Yes** |
| `BCL.GD` — `w:[450,600], h:[720], d:336` | `:715` | **No** |
| `BCL.AP` — `w:[600], h:[720], d:336` | `:716` | **No** |
| `BCL.BPO` — `w:[150,300], h:[720], d:336` | `:717` | **No** |
| `BB.PLB` — `w:[1150], h:[720], d:560` | `:721` | **No** (BB → `LMC`, `BSH` only; `PLB` is defined at `:564`) |

`famSetOf` also drives `parseCabinetCodeToModel` (`:4858`), so these codes are **un-decodable too**: `parseCabinetCodeToModel("BB-SH-CJ-ST-XXX-LHS-XXX-1150-720-560-15")` resolves `fams = famSetOf("BB")`, which has no family with `p2 === "SH"` for `PLB` → returns `null` at `:4860`.

**Reproduction**
1. `/builder` → zone `BCL` → family dropdown offers **only** `SH`. `DW`, `HO`, `SK`, `GD`, `AP`, `BPO` are absent despite having size tables.
2. Zone `BB` → only `LMC` and `BSH`. `PLB` (Plain Blind, `:564`) is absent despite `BB.PLB` sizing at `:721`.
3. Feed a legacy `BB-…PLB…` or `BCL-DW-…` code to `/designer` → the line fails to decode (`null`, warned at `:4921`) rather than rendering.

**Impact** Low **if the restriction is intentional** (these products were withdrawn) — in which case the dead `SIZES` rows are merely confusing and mislead the next developer into thinking the families are supported. **Higher if unintentional**: a whole product line is silently unbuildable, and any historical SO containing those codes silently fails to explode in `/designer` (the failure is a `console.warn`, not a user-visible error — see BUG-15).

**Suggested fix**
1. **Decide intent first** — ask the product/factory owner whether `BCL.DW/HO/SK/GD/AP/BPO` and `BB.PLB` are withdrawn products or an accidental regression. The answer determines everything below.
2. If **withdrawn**: delete the dead `SIZES` rows (`:711–713`, `:715–717`, `:721`), and add a comment at `famSetOf:652` explaining *why* each zone is restricted. Keep `parseCabinetCodeToModel` able to decode legacy codes (read-only) even though the builder no longer offers them — otherwise historical SOs break.
3. If **accidental**: restore the families in `famSetOf` and add IT-01 (round-trip over every zone × family) to catch the next drop.
4. Either way add a startup/dev assertion that every `SIZES` key `"<Z>.<F>"` satisfies `famSetOf(Z)[F] !== undefined` — that turns this whole class into a build-time failure.

---

## BUG-09 — [Medium] No rate limiting, throttling, or retry/backoff on bulk Zoho pushes

**Verified.** `handleAddToZohoSO` (`CarcassBomBuilder.tsx:6001`) loops cabinets with `for (const item of itemsToAdd)` (`:6022`) and, per cabinet, calls `resolveSimpleItem` / `resolveCompositeItem` / `resolveProfileBOM` / `resolveHardwarePack` for **every** panel, part, profile, cut, hardware pack and composite. Each `resolve*` issues **at least one** `GET /api/zoho/items?search=…` (`:4953`), often a second `GET …?name=…` fallback (`:4960`), and a `POST /api/zoho/items` (`:5016`) on miss; `findExistingCompositeByRawMaterial` (`:5104`) additionally issues a `GET /api/zoho/compositeitems/{id}` **per candidate** (`:5125`) inside a loop (`:5120`). Finally one `PUT /api/zoho/salesorders/{id}` (`:6873`).

`grep -n "setTimeout|sleep|delay|retry|backoff" CarcassBomBuilder.tsx` finds **no** throttle: the only `setTimeout`s are UI (`:5823`, `:5854`, `:7889` copy-flash, `:7896`), and the only "retry" is the **manual, user-clicked** raw-material refetch (`:7522` `retryRawFetch`, `:7527` `retryAllRawFetch`, wired to buttons at `:9955`, `:10012`, `:10080`, `:10144`, `:10212`, `:10264`).

On the server, `src/lib/zoho.ts` handles **only** the token: `zohoInventoryRequest` retries **once** on `401 || code 57 || code 14` (`:213–218`) and throws on anything else (`:220–222`). `TOKEN_BACKOFF_MS = 5*60*1000` (`:26`) and `isTokenRateLimit` (`:83–86`) apply **only to the token-refresh endpoint** (`refreshZohoAccessToken`, `:88–121`), **not** to Inventory API calls. A `429` from `/items` hits `:220` and throws immediately — no backoff, no retry, no queue.

**Reproduction**
1. `/builder` or `/designer` → assemble a project of 20–40 cabinets (a normal kitchen).
2. Click Add-to-Zoho.
3. The loop fires hundreds-to-thousands of Zoho API calls back-to-back with no pacing.
4. Zoho Inventory's per-minute/per-day rate limits trip → a request returns 429/"too many requests" → `zohoInventoryRequest` throws (`:221`) → the error propagates to `handleAddToZohoSO`'s catch (`:6887`) → the whole push aborts with `Error: {…}` in `setZohoMessage` (`:6889`).
5. Retry from the UI → the whole sequence restarts from cabinet 1, re-issuing every call, making the rate-limit worse. (And see BUG-11: the items already created stay created.)

**Impact** Large projects — precisely the ones worth pushing — are the ones that fail. The failure is mid-flight, partial (BUG-11), and the only recovery is a full retry that re-triggers the limit. The raw Zoho error JSON is dumped at the user. Sustained retry storms risk the org being throttled org-wide, affecting other Zoho users at Magppie.

**Suggested fix**
1. Add a **concurrency-limited, rate-aware queue** in the Zoho layer (after the BUG-04 extraction): cap in-flight requests (e.g. 2–4), and pace to Zoho Inventory's documented limits.
2. Add **exponential backoff with jitter** on `429` and `5xx` in `zohoInventoryRequest` (`src/lib/zoho.ts:190`), honouring `Retry-After` when present; cap attempts and surface a clean, human error. Reuse the existing `isTokenRateLimit` (`:83`) idea, generalised beyond the token endpoint.
3. **Cache aggressively per push**: `searchItemByName` is called repeatedly for the same names across cabinets in one project — an in-memory `Map<name, item_id>` for the duration of a push would cut call volume dramatically for free.
4. **Batch** where Zoho permits, and consider moving the whole push server-side (a route handler or background job) so it survives tab closure and can be resumed.
5. Add a progress indicator with a **cancel** button (there is none today — only `setZohoMessage` text at `:6028`, `:6872`).
6. Add IT-07 (§1.6).

---

## BUG-10 — [Medium] `truncZoho` silently truncates item names at 100 chars → collisions

**Verified.** `CarcassBomBuilder.tsx:5029–5031`:

```ts
function truncZoho(s: string, max = 100): string {
  return s.length <= max ? s : s.slice(0, max);
}
```

Used in `resolveCompositeItem` (`:5041–5042`) on **both** the name and the SKU. The truncation is a blind `slice` — no hash, no ellipsis, no uniqueness suffix.

Generated names are long and **carry their distinguishing information at the end** — the finish suffix. E.g. `Drawer Pack- Cab Drawer Box Semi High STATUARIO NUVOLATO` plus a dual-finish suffix, or `Panels- Cab Drawer Box Fascia Semi High 562x210x15 (JD) <LONG FINISH NAME>`. Cut at exactly 100 characters, two genuinely different items can produce the **identical** truncated string.

**Reproduction**
1. Construct two cabinets whose generated composite names share their first 100 characters but differ afterwards (long finish names such as `BLACK STATUARIO NUVOLATO` / `BLACK STATUARIO NUVOLATO GOLD`, or a dual-finish suffix, make this easy).
2. Push both.
3. `searchItemByName(truncZoho(name))` for the second one **finds the first** → the second cabinet is silently mapped onto the **wrong** Zoho composite. No warning is emitted anywhere.

**Impact** Two different products share one BOM in Zoho: wrong components, wrong stone, wrong stock accounting, wrong purchasing — and, unlike BUG-07 (which creates *extra* items, visibly), this creates *too few*, invisibly. Interacts badly with BUG-07: the name is the primary key, so truncation corrupts the key itself.

**Suggested fix**
1. Verify Zoho Inventory's actual name/SKU limit (the 100 here is a magic number with no citation — confirm it against the API docs; if it is 100, cite it in a comment).
2. When truncation is required, append a short deterministic hash of the **full** name (e.g. `…${sha1(full).slice(0,8)}`) so distinct inputs stay distinct within the limit.
3. Better: fix BUG-07 first — with a `cf_bom_key`/SKU fingerprint as the real identity, the display name may truncate harmlessly.
4. Log a warning whenever truncation fires, so the frequency is known.
5. Add test G5 (§1.4) and a unit test for `truncZoho` collision behaviour.

---

## BUG-11 — [Medium] Zoho push is not transactional — partial failure leaves orphaned items, no rollback or resume

**Verified.** `handleAddToZohoSO` (`:6001`) creates items **as it goes**: services first (`:6009–6013`), then per-cabinet panels/parts/profiles/hardware/composites throughout the loop from `:6022`, and only **at the very end** issues the single SO `PUT` (`:6873`). Every failure path — an unselected raw material (`throw` at `:6035`), an item-create failure (`throw` at `:5023`), any Zoho error (`throw` at `src/lib/zoho.ts:221`), a rate limit (BUG-09) — lands in the same catch (`:6887–6890`), which only sets a message:

```ts
} catch (err: any) {
  console.error("Zoho integration flow error:", err);
  setZohoMessage(`Error: ${err.message || "An unexpected error occurred."}`);
} finally {
  setZohoLoading(false);
}
```

There is **no** rollback, **no** cleanup of the items already created, **no** checkpoint, and **no** resume. Everything created before the throw stays in Zoho, unreferenced by any SO.

**Reproduction**
1. Assemble a 3-cabinet project; ensure cabinet 3 will fail (e.g. omit one raw-material selection → `:6034–6036` throws, or kill the network before the SO `PUT`).
2. Push.
3. Cabinets 1 and 2 (and all their panels, parts, profiles, composites) are **created in Zoho**. The SO is **not** updated. The user sees only `Error: …`.
4. Fix the issue and push again → the loop restarts from cabinet 1. `searchItemByName` finds the orphans and reuses them (so it "works"), **unless** a rename (BUG-07) or truncation (BUG-10) is in play — then it duplicates instead.

**Impact** Zoho accumulates orphaned items from every failed push. Combined with BUG-09 (large pushes fail mid-flight) this is the routine case, not the edge case. The user has no idea what was or was not created, and no way to clean up from the UI.

**Suggested fix**
1. **Two-phase**: resolve/compute the *entire* item graph first (dry run — search only, no writes), report exactly what will be created, then create only after the user confirms.
2. **Checkpoint & resume**: persist per-push progress (ties into BUG-03's persistence work) so a retry skips completed cabinets instead of restarting.
3. **Report, don't swallow**: on failure, list the item IDs already created so a human can clean up. Consider an explicit "undo this push" that deletes items created in the failed run (only if they are not referenced elsewhere).
4. Move the push server-side (see BUG-09 fix 4) so it can be a durable, resumable job.
5. Add IT-06 (§1.6).

---

## BUG-12 — [Low/Medium] The QR route sits behind the client auth gate — factory phone scans hit a password wall

**Verified.** `AuthGate` wraps **all** children in the root layout (`src/app/layout.tsx:15`), and `/qr/bom/[orderId]` (`src/app/qr/bom/[orderId]/page.tsx` → `QrBomPage`, 56 lines) is a child of that layout like every other route. `AuthGate` gates on `localStorage["app_authenticated"]` (`AuthGate.tsx:12`) — which is **per-device, per-browser**.

**Reproduction**
1. Generate a QR from the dashboard (`BomDashboard.tsx:1992` QR modal) encoding `/qr/bom/<orderId>`.
2. Scan it with a factory-floor phone that has never opened the app.
3. Instead of the BOM, the scanner lands on the `Factory@1234` password screen (`AuthGate.tsx:56` — "Enter the factory authorization password…").

**Impact** Defeats the purpose of the QR workflow — a scan should be instant. In practice this pressures the team to share the hard-coded password around the shop floor (worsening BUG-02), or to paste it into every phone. Note the flip side: once BUG-01/BUG-02 are fixed properly, this route needs a *deliberate* access design, not an accident.

**Suggested fix**
1. Decide the intended access model for QR: (a) public read-only with an unguessable signed token in the URL, (b) a short-lived signed link, or (c) authenticated like everything else.
2. If (a)/(b): move `AuthGate` out of the root layout into a route-group layout covering only the app routes (`(app)/layout.tsx`), leaving `/qr/**` outside; sign the `orderId` (HMAC) so IDs cannot be enumerated, and expose **only** the fields the shop floor needs.
3. Handle alongside BUG-01 — the middleware matcher must exempt `/qr/**` explicitly and consciously.

---

## BUG-13 — [Low] `ctGeom` does not clamp `topL` / `baseL` — negative lengths are possible

**Verified.** `CarcassBomBuilder.tsx:191–194`:

```ts
const topL  = L + 30 * edgeFolds - 100 * sideDrops * reduce;
const topD  = D + 30 - 100 * backDrops * reduce * topDepthReduce;
const baseL = L - 100 * sideDrops * reduce;
const baseD = Math.max(0, D - 40 - 100 * backDrops * reduce);
```

`baseD` is clamped with `Math.max(0, …)`; the island panel lengths are clamped (`Math.max(0, L - 60)` at `:179`/`:180`/`:182`, `Math.max(0, L - 80)` at `:181`). But **`topL`, `topD` and `baseL` are not**. With `type = 4` (both side drops → `sideDrops = 2`, `reduce = 1`) and `L = 100`, `topL = 100 - 200 = -100` and `baseL = -100`. Similarly `topD` can go negative for a small `D` on an island type.

**Reproduction**
1. `/builder` → Countertop → type **4** (both drop-downs) → `L = 100`, `D = 600`, `T = 40`.
2. `ctGeom(4, 100, 600, 40)` → `{ topL: -100, baseL: -100, … }`.
3. The negative length flows into the countertop name (`:3886`, `Countertop Pasting Material 40mm -100x630`) and the panel rows (`:3898`, `:3902`), and into any area/cost computation.

**Impact** Low in practice — a 100 mm countertop with two drop-downs is not a real order — but the inconsistency is a trap: the author clearly *intended* clamping (it is applied to `baseD` and to every panel length) and simply missed three expressions. There is no input validation upstream forcing a sane minimum `L`, so a typo (`300` → `30`) produces a silently negative BOM rather than an error.

**Suggested fix**
1. Clamp for consistency: `Math.max(0, …)` on `topL`, `topD`, `baseL`.
2. Better: **validate the input** — reject `L` below the physical minimum (`100 * sideDrops` plus a sensible margin) in the Countertop UI with a clear message, rather than silently producing zeros. Zeros are only marginally better than negatives.
3. Add unit tests CT-12…CT-15 (§1.5) — CT-15 deliberately pins the *current* behaviour so the fix is a conscious, reviewed change.

---

## BUG-14 — [Low] `parseCabinetCodeToModel` mis-splits a finish name containing a hyphen

**Verified.** `CarcassBomBuilder.tsx:4895–4912`. After the 11 fixed fields, the remainder is rejoined and split:

```ts
const matPart = parts.slice(11).join("-");
…
} else {
  const segs = matPart.split("-");
  if (segs.length >= 2) {
    carcassMat = segs[0];
    shutterMat = segs.slice(1).join("-");
  } else {
    carcassMat = shutterMat = matPart;
  }
}
```

The dual-finish convention is `carcassMat-shutterMat`, and the comment at `:4893–4894` reasons that "finishes are space-delimited, so the dual form splits cleanly on the first `-`". That holds **only** while no finish name contains a hyphen. If one does, the code cannot tell `STATUARIO-CALACATTA` (two finishes) from `BLACK-MARQUINA` (one hyphenated finish) — the parser always assumes the former.

**Reproduction**
1. Emit/receive `BC-DW-CJ-ST-2LB-1HB-XXX-600-720-560-15-BLACK-MARQUINA`, intending the single finish `BLACK-MARQUINA`.
2. `parseCabinetCodeToModel` → `segs = ["BLACK","MARQUINA"]`, `length >= 2` → `carcassMat = "BLACK"`, `shutterMat = "MARQUINA"`.
3. The cabinet is built with **two wrong finishes** instead of one right one. Neither `BLACK` nor `MARQUINA` will resolve to the intended stone — and per BUG-06, `MARQUINA` may resolve to *some* Marquina of the wrong colour, so the failure can be silent rather than loud.

**Impact** Low **today** — the current catalogue appears to use space-delimited finish names, so the assumption holds. But it is an undocumented, unenforced invariant: the day someone adds a hyphenated finish to Zoho, every code carrying it silently mis-parses. The slash form (`:4899–4902`) exists precisely because the hyphen form is ambiguous, which suggests the ambiguity was already felt.

**Suggested fix**
1. **Prefer the unambiguous separator**: emit the slash form (`carcass/shutter`, already parsed at `:4899`) for all *new* codes; keep the hyphen branch only for legacy decoding.
2. Enforce the invariant: validate on ingest that no finish name contains `-` (or normalise it away), and add a comment at `:4893` naming the invariant explicitly.
3. Add tests PC-09…PC-13 (§1.5), with **PC-12** pinning the current mis-split so the fix is deliberate.

---

## BUG-15 — [Low] Parse failures are swallowed to `console.warn` — SO lines vanish silently

**Verified.** `parseCabinetCodeToModel` wraps its whole body in `try { … } catch (e) { console.warn("Error parsing cabinet code:", code, e); return null; }` (`:4834`, `:4920–4923`), and returns bare `null` at **six** other points without any message: `:4835` (empty code), `:4840` (<11 fields), `:4843` (unknown zone), `:4854` (non-numeric dimension), `:4860` (no family for p2). Its callers — `:5906`, `:5952`, `:5987`, `:6840`, `:7236` — receive `null` with no reason attached.

**Reproduction**
1. `/designer` → select an SO containing a legacy or malformed cabinet code (e.g. a `BB-…PLB…` code per BUG-08, a pre-P7 code, or one with 10 fields).
2. The line does not explode into a BOM. Depending on the call site it is skipped or rendered blank.
3. The **only** trace is a `console.warn` — and only for codes that *throw*; the six `return null` paths are completely silent.

**Impact** A user pushing an SO to Zoho can silently ship an **incomplete** BOM: cabinets are missing from the output with no visible error. This is the delivery mechanism that makes BUG-08 dangerous — a whole withdrawn-family line disappears rather than erroring. Also makes support impossible: "some cabinets didn't come through" with nothing to point at.

**Suggested fix**
1. Change the return type to a discriminated result (`{ ok: true, model } | { ok: false, reason, code }`) and give each `return null` a specific reason (`"empty"`, `"too_few_fields"`, `"unknown_zone"`, `"bad_dimension"`, `"unknown_family"`, `"threw"`).
2. Render unparseable SO lines as an explicit, visible error row in `/designer` and `/planning` — never skip silently.
3. **Block the Zoho push** when any line failed to parse, or require an explicit "push anyway" acknowledgement.
4. Add test F3 (§1.4) and PC-03…PC-07 (§1.5).

---

## Risk summary

| id | Severity | Title | Key locations |
|---|---|---|---|
| BUG-01 | **Critical** | Client-side-only auth; all 14 `/api` routes unauthenticated | `AuthGate.tsx:12`; `layout.tsx:15`; `api/zoho/items/route.ts:12`; `api/ai/chat/route.ts:3`; no `middleware.ts` |
| BUG-02 | **Critical** | Password `Factory@1234` hard-coded in the client bundle | `AuthGate.tsx:27` |
| BUG-03 | **High** | No persistence — builder/project state lost on reload | `CarcassBomBuilder.tsx` (no `localStorage`); cf. `BomDashboard.tsx:1208` |
| BUG-04 | **High** | 11,220-line single component — maintainability + perf | `CarcassBomBuilder.tsx` (whole file) |
| BUG-05 | **Medium** | `MD3` missing from `DEFAULT_PROFILE_NAMES` → resolves `null` | `rawmaterial.ts:713–741`, `:743–755`; `CarcassBomBuilder.tsx:774` |
| BUG-06 | **Medium** | Stone search falls back across finishes (BLACK↔WHITE) | `rawmaterial.ts:599–602`, `:640–645`, `:651–656`, `:685` |
| BUG-07 | **Medium** | Name-based Zoho idempotency → renames duplicate items (P7 precedent) | `CarcassBomBuilder.tsx:4943`, `:4970`, `:5033`, `:2105–2107` |
| BUG-08 | **Low** | `famSetOf` hides families that `SIZES` still defines | `CarcassBomBuilder.tsx:651–663`, `:711–721`, `:4858` |
| BUG-09 | **Medium** | No rate limit / retry / backoff on bulk Zoho pushes | `CarcassBomBuilder.tsx:6001`, `:6022`; `zoho.ts:190–222` |
| BUG-10 | **Medium** | `truncZoho` 100-char blind truncation → name collisions | `CarcassBomBuilder.tsx:5029`, `:5041–5042` |
| BUG-11 | **Medium** | Non-transactional push → orphaned items, no rollback/resume | `CarcassBomBuilder.tsx:6873`, `:6887–6892` |
| BUG-12 | **Low/Med** | QR route behind the client auth gate | `layout.tsx:15`; `app/qr/bom/[orderId]/page.tsx` |
| BUG-13 | **Low** | `ctGeom` does not clamp `topL`/`topD`/`baseL` | `CarcassBomBuilder.tsx:191–194` |
| BUG-14 | **Low** | Hyphenated finish name mis-splits into carcass/shutter | `CarcassBomBuilder.tsx:4895–4912` |
| BUG-15 | **Low** | Parse failures swallowed to `console.warn` / bare `null` | `CarcassBomBuilder.tsx:4834–4860`, `:4920–4923` |

### Suggested order of work

1. **BUG-01 + BUG-02 together** — until both are fixed the app has no access control and the Zoho org is exposed. Rotate the password. Nothing else matters as much.
2. **BUG-03** — highest daily user pain, cheapest meaningful win (a debounced `localStorage` autosave is hours, not days).
3. **BUG-04 step 1–2** — extract the pure logic to `src/lib/*` and repoint `scratch/test-drawers.js` at the real `addDrawerBoxes`. This removes the mirror-drift risk (§1.1) and unblocks every unit test in §1.5.
4. **BUG-05** — small, self-contained, but needs the correct part number from the factory. Start the ask early; it is a blocking dependency.
5. **BUG-06, BUG-07, BUG-10** — the wrong-material / wrong-item cluster. All three corrupt the Zoho BOM; BUG-07's fingerprint fix largely subsumes BUG-10.
6. **BUG-09 + BUG-11** — fix together once the Zoho layer is extracted (BUG-04 step 3): queue + backoff + two-phase push.
7. **BUG-08, BUG-12, BUG-13, BUG-14, BUG-15** — BUG-08 and BUG-12 need a **product decision** before code; raise them early even though they are low severity.
