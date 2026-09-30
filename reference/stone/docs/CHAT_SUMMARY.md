# Complete Chat Summary — Magppie Carcass BOM Builder

> Chronological record of the entire working conversation: every requirement, decision, business rule, bug, rejected idea, and implementation. Written for an AI continuing this project. Where a decision was later reversed, both the original and the reversal are shown so the reasoning survives.

---

## 0. Context & working agreement

**Project:** Magppie Carcass BOM Builder — a Next.js app that converts a kitchen-cabinet configuration into a cabinet code, shutter codes, a multi-level BOM, factory outputs, and Zoho Inventory records.

**Working directory:** `/Users/Apple/Documents/bom-nextjs-app/Inventory - Magppie`
**Heart file:** `src/components/CarcassBomBuilder.tsx` (~11,200 lines — nearly all domain logic).

### Hard rules established by the user (must be honoured by any future AI)
1. **NEVER deploy to Vercel unless the user explicitly authorizes it for that specific change.** ("deploy this", "publish on vercel"). All other work is local; the user tests locally.
2. **Verification loop after every change — all three must pass before reporting done:**
   - `npx tsc --noEmit`
   - `node scratch/test-drawers.js` → must print `ALL TESTS PASSED SUCCESSFULLY!`
   - `npm run build`
3. **Confirm-first for larger/ambiguous changes** — state understanding, wait for confirmation. The user explicitly used this pattern repeatedly ("let me know your understanding then i'll confirm then you can implement").
4. **Security:** never include secrets (`.env.local`, `vercel_env.log`, `add_envs.sh`) in any zip/bundle; never print secrets. Zoho data centre is **India** (`accounts.zoho.in` / `zohoapis.in`).

---

## 1. Early work — pages, Zoho token recovery, BOM correctness

### 1.1 Designer page (reverse flow)
- **Requirement:** a page where designers work from an existing Zoho Sales Order rather than configuring from scratch — cabinet codes are **fetched from the SO and decoded** back into models.
- **Rejected idea:** the user first asked for a *clone* of the builder page, then said **"no clone page needed if it already have the reverse case in this page"** → decided to reuse `CarcassBomBuilder` with a `soMode` prop instead of duplicating the component. Later, when features were genuinely missing, they said *"if those things are missing then create the new page"* → `/designer` route added as a thin wrapper.
- **Result:** `/designer` = `<CarcassBomBuilder soMode />`.

### 1.2 Planning page
- **Requirement:** clone the designer functionality for the **planning team**. Route `/planning` = `<CarcassBomBuilder soMode planningMode />`.
- Later refined: *"this page is for designers other one is for planning team you just change the names"*, and *"yes these features i'm telling you are to be implemented in the designer page"* — i.e. the **Excel upload + colour picking belongs to /designer**, planning keeps the SO push.

### 1.3 Zoho token recovery (incident)
- **Symptom:** UI showed *"Zoho token refresh is cooling down…"* then `invalid_code`.
- **Diagnosis:** **not a code bug** — the refresh token was dead.
- **Fix:** user supplied a grant code; it was exchanged for a new refresh token (70 chars, `.in` DC), written to `.env.local` (backup `.env.local.bak`), token cache cleared, server restarted, verified by an SO search returning `MSPL/SO/2627/000002`. Vercel env updated and the **old deployment redeployed** so the in-progress `/designer` page did **not** ship — per the user's explicit instruction *"update the token in vercel also don't append the new page just update the toke."*
- **Lesson for future AI:** cooldown/`invalid_code` usually means the refresh token is dead, not a logic bug.

### 1.4 BOM correctness fixes (batch)
User reported 7 numbered issues; all confirmed and fixed:
1. **Neon 20 glass shutter corner connector** → glass shutters use `CORNER BRACKET FOR GLASS SHUTTER 62X62X GSP-CBM EBC`; stone uses `CORNER CONNECTOR FOR STONE 70X70X2 MAR`. Implemented via `shutterCornerName(fk, kind)`. (User confirmed "1 & 2 Yes (all glass)".)
2. **Neon 20 glass shutter hinge** → glass families use `HARDWARE PACK SLIM HINGE FOR GLASS Set/N`; loft uses `HARDWARE PACK HINGE W/OUT SOFT CLOSE Set/N`; else `HARDWARE PACK 3D HINGE 0 CRANK Set/N`. Added the corresponding `HARDWARE_PACK_DEFINITIONS`.
3. **Wall & Tall Elenor profile quantity** → Elenor profile qty 2 at length = cabinet H.
4. **HOB cabinet Opti sheet — sink profile appearing twice** → root cause: `subGroupFromPkType` mapped `"prof"` → `"Profile"`, which the Opti sheet also picked up. Fixed by mapping to **`"Profile Pack"`** so profile *sets* stop duplicating in Opti. (User: *"Set of Profile group → Profile Pack"*.)
5. **HOB cabinet drawer back quantity** → `addPanelRow` computed raw qty from `soQty` (per-parent = 1) instead of `actualQty`, under-counting drawer/multi-unit raw. Fixed: `rawActualQty = netSqft × actualQty × (1 + rawWaste/100)`; the drilled drawer panel now passes `pActual` (not `1*q`).
6. **Tip-On missing on Loft** → loft cabinets now push a Tip-On hardware (`tipOnQty = v.both ? 2 : 1`). `TIPON_OPTIONS` added; `tipOn` threaded `buildModel → buildCarcassInner → buildCarcassInnerRaw`.
7. **Without-soft-close hinge for Loft** → confirmed for all loft zones.
- Prerequisite the user demanded first: **"firstly add a column for serial no in the full bom sheet this is required first"** → `S. No.` column added to the Full BOM, incrementing **per project line item** (not per BOM row): `if (rest.Level === 0) sno++`.

### 1.5 Elenor light cut sizes
- **Bug:** *"light and diffuser are cutting with the length double but the cutting size would be same as per the elenor light with qty 2 not the full length."*
- **Confirmed rules:** cut length = **H**, **qty 2**, applies to both the Full BOM and the live Zoho push, **10% waste** (`ELENOR_WASTE`), countertop unchanged.
- **Implementation:** `addLightCutRow(...)` emits a cut piece (subGroup `Profile`, included in Opti) over a raw 3-mtr child (subGroup `Raw Material`, **excluded** from Opti).

### 1.6 Raw-material search improvements
- **Requirement:** *"for stone and profile selection search for them in item name if you are not able to find"* and *"the same finish would be defined in the item name also and thick is also in there… last 2 characters are the thickness… '06MM' this also it is the thickness."*
- **Implementation:** `searchStoneItems`/`searchProfileItems` gained item-name fallbacks and `thicknessFromName` (parses `…X…X15` or `06MM`; **ignores** large dims like `2800MM`).

### 1.7 Duplicate React keys bug
- **Symptom:** duplicate keys in Fillers/Visible Panels.
- **Cause:** a nested `setState` inside another updater double-fired under StrictMode.
- **Fix:** derive the new id purely from the current list inside a **single pure updater**.

### 1.8 Packing list — shutters
- **Requirement:** the shutter packing list must use **each shutter's full code** as a heading, with the assembled `Parts- SH {pw}x{ph} {design}` row beneath, and a box dimension of **(W+20) × (H+20) × (thickness+20)** (`calcBoxDimension`). Serial numbers follow **project line items**, not the full BOM tree.

---

## 2. Countertop — the largest thread

The countertop section (⑦) was designed iteratively from a whiteboard photo, two PDFs, and a `Countertop_Understanding.docx`.

### 2.1 Source documents
- `Counter top factory working pdf.pdf` (9 pages): p1 = universal **side-section**, p2–p6 = 5 run/wall types, p7–p9 = 3 island types.
- `Island counter top section format pdf no - 9.pdf` = **type 9** (the user pointed out it was initially skipped: *"you still skipped the 9th type"*).
- Text extraction alone was insufficient — pages had to be **rendered to images** (via PyMuPDF) and read visually. **Lesson:** for CAD-style PDFs, render pages and read them as images.

### 2.2 Confirmed universal build (every type)
- Top slab **30 mm** (= 2 × 15 mm pasted; 40 mm = 2 × 20) cut to Length × Depth (typically 600).
- **Front 30 mm drop patti, mitred**; **3 mm edge radius**.
- **Alu Grand Light HM-512** under the front lip.
- **Counter base stone** = dead stock, **Depth − 40** (10 mm back gap).
- Consumables per sqft: AKEMI polish 10 g, BONDTITE 10 g, DOWSIL silicone 40 ml.

### 2.3 The 9 types (final names + order)
The names and order were changed twice. **Final** dropdown:
1. Linear
2. **Linear + BSV** ← moved up from 5th
3. Linear + LHV with LH Drop
4. Linear + RHV with RH Drop
5. Linear + BSV with Both Side Drop
6. **Island Compact**
7. **Island Table**
8. **Island with 350mm Sitting**
9. **Island Both Side Cabinets**

**Critical implementation decision:** the reorder is **display-only** — the `CT_TYPES` array order/labels changed but each entry keeps its original `value`, which still maps to the existing `ctGeom` logic. This preserves geometry and any saved countertops. (The user first said *"just rename these nothing else"*, then later asked for the 5→2 move; both were honoured this way.)

### 2.4 Countertop rules — evolution (each reversal matters)
| Topic | Initial | Final (authoritative) |
|---|---|---|
| **Side patti** | separate stone piece (D×30) | **Fold into the top slab**: `topL = L + 30 × sideFolds`; not a separate line. User: *"the side patti … are part of the counter top and would be cutted on site but the size i'm writing is excluding those side patti so you need to increase the size of the count"* |
| **Front patti** | separate piece (L×30) | **Fold into top depth**: `topD = D + 30`. User: *"Patti front is not a separate piece it is under the counter top panel"* |
| **Edging / Rounding** | a patti piece of `edgingHeight × 30`, default 620 | **RENAMED to "Rounding"** (*"it is rounding not edging"*), then **reduced to a NAME-ONLY note** with **no stone and no deduction**: appends `Rounding LH/RH/Both (-600)` to the counter name; default height **600**, editable. User: *"there is no deduction it is just mentioned in the counter Name"* |
| **Drop-down** | a single flat stone panel | **A mini-counter sub-BOM** (*"dropdown is also a type of counter top so it also has the Bom"*): visible drop stone + reduced dead base + pasting |
| **Drop base** | `dropHeight − 40` | **`dropHeight − 100`** (confirmed from the section drawing: 500 vs 600 visible) |
| **Drop-down front/back patti** | separate pieces (len×30, len×100) | **Removed** — they're mitred folds of the single visible drop stone |
| **Island back patti** | separate flat piece | **Removed** — the back is itself a drop-down panel |
| **Drop height** | fixed 830 (from a drawing) | **`dropHeight` field, default 705, editable** |

### 2.5 Countertop rules — final specifics
- **Mitre issuance:** the visible drop stone is issued **+15 mm** if single-side-visible, **+30 mm** if double-side-visible (type 7) — *"same as we are taking for the plain counter"*.
- **100 mm cabinet reduction:** each drop side trims **top + base**; **side** drops come off the **length**, **back/island** drops off the **depth**. Confirmed via question: "Both top+base, side→length/back→depth".
- **Type 7 (Island Table)** is **exempt** from the 100 mm rule — *"this construction is island table counter not on the cabinets"* (freestanding).
- **Type 8 (Island with 350mm Sitting):** the **upper counter keeps full depth** (front drop & top same depth); **only the dead stock changes** because of the 350 mm sitting visible + the 100 mm cabinet mitre. Its back drop = **Island Sitting Drop (L−80) × 350** with a **two-stone** dead base.
- **Brass strip** = a BOM material with a **specific cut size** (`Depth × 30`), 1 per drop-down side; item `BRASS STRIP 05MM 600 X 30 MM` (sold in 1200 mm).
- **Grand Light length** = `L − 30 × sideDrops`; type 7 emits **two** runs (front + back).
- **Single source of truth:** `CT_TYPES` + `ctGeom(type, L, D, T, dropHeight)` — used by **both** the BOM build and the raw-stone aggregation. Any future change must go through `ctGeom`.

### 2.6 Countertop items still open (assumptions the user waved through)
- Exact **type-8 cabinet-zone base depth** split (implemented as `baseD = D − 40 − 100`).
- **Type 9** back panel `(L−60) × dropHeight` was added by inference (it had none after the back patti was folded).
- The user closed both with **"no nedd"** — do not re-open unless asked.

---

## 3. Drawers — rules and fixes

### 3.1 2HB + 1BL fascia bug
- **Symptom (screenshot):** *"there is 1 built low back here but facia is showing for both low back and high back."*
- **Fix:** section 1 (no-fascia standard boxes) is no longer skipped for `2hb1bl`; section 2 sets `numLow = 1` only, so **only the built-in low back gets a fascia**.
- Test mirror updated (Scenario D) — its `shutSpec` lacked a `2hb1bl` branch.

### 3.2 2HB+1BL — High pack takes the Low configuration
- **Requirement:** *"Where there are 2HB … then the Drawer Pack of High would have the configuration of Drawer Pack Low."*
- **Confirmed scope (explicit Q&A):** **(C)** only where there is **2HB+1BL**; **(D)** the High pack adopts **both** the Low back height (212→**63**) **and** the Low hardware (H239→**H90**); **(E)** nothing else changes.
- Rationale: the box behind each tall front is really a **low box** — only the fascia is tall.

### 3.3 Drawer hardware-pack duplication
- **Requirement:** *"the high back hardware packs and low back packs to be included in the shutter if there is a drawer … both the drawer pack and shutter are containing the same hardware pack it is creating item duplicacy remove this."*
- **Implementation:** **shutter-faced** drawers carry the runner pack on the **shutter** (`hinge`) only; **built-in / fascia** drawers (no shutter) keep it on the **Drawer Pack**.
- For consistency, the **2hb1bl** shutter front also carries **H90** (matching its Low box).
- **Follow-up dispute:** the user later reported the duplication persisted. Investigation (running the model for 2dr / 3dr / 2hb1bl / GD) **proved** pure shutter-faced cabinets emit **zero** drawer-pack hardware; the apparent "duplication" is a cabinet like **2HB+1BL** that legitimately has **both** kinds of drawer — 2 shutter-faced HB (pack on shutters) + 1 built-in Low (pack on the Drawer Pack) — i.e. 3 different drawers each needing an H90. The user confirmed **"Keep on Drawer Pack"** for built-in. **Status: working as designed; no code change.**

### 3.4 WBP (Waste-Bin Pull-out) had a drawer — bug
- **Symptom (screenshot):** a WBP showed `Drawer Box Fascia Low` + `Drawer Pack Low`.
- **Root cause:** WBP was grouped with **GD** in `addDrawerBoxes` (`if (fk === "GD" || fk === "WBP") effectiveInbuiltDrawers = "1lb"`), forcing a built-in drawer.
- **Fix:** removed WBP from that line (only **GD** genuinely carries the built-in low-back). WBP is already `isAcc`, so it now emits **zero** drawer parts. Mirrored in `scratch/test-drawers.js`.
- **Swept for the same class:** BPO was already correct; WBP was the only offender.

### 3.5 Drawer geometry (confirmed reference)
- Variants: **Low** (back 63, `H90`), **High** (back 212, `H239`), **Semi High** (148, `H175`).
- Per drawer: Back `(W−72) × backH × 15`; Bottom `(W−50) × (D−77) × 6`; Fascia (built-in only) `(W−2t−8) × 110|210 × 15`; DBS **HM513 483 × 2**; DBC **HM535 (W−78) × 4**; hardware × 1.
- Fronts: **FH** = H, **HB** = 360, **LB/ML** = 180; face = `HE − deduction`.

---

## 4. Shutters, deductions and codes

### 4.1 Deduction rule (`shDeduct`)
- Non-base → **3**. Base + handleless family (MD1/MD3 + their CM) → **33**, **except the middle drawer (`ML`) → 3**. MD2 family / CL1 / CL2 / NEON20 → **3**.
- **Handle mapping:** **CJ (XCJ, handleless/gola)** ⇒ MD1/MD3(+CM); **STD (Titus)** ⇒ MD2(+CM); CL/NEON are handle-agnostic.
- The user's own **Config sheet** matched the code exactly; the code's matrix was **completed** with the missing MD3/MD3CM1/MD3CM2 columns.

### 4.2 Cabinet code — P7 de-duplication
- **Problem raised:** `BC-DW-CJ-ST-2HB-1BL-XCJ-…` repeats the handle at **P3 (`CJ`)** and **P7 (`XCJ`)** — *"you don't think it is a bit confusing for the team."*
- **Decision:** keep **P3** as the single handle token; set **P7 = `XXX`**, preserving the 11-field layout and the decoder.
- **Verified safe:** the decoder reads the handle from **P3** (`handleToken === "CJ" ? "XCJ" : "STD"`); P7 is only tested for `2HS`/`RHS`. **Old codes still decode.**
- **Known consequence (accepted):** codes are baked into Zoho item names and idempotency matches on name → cabinets pushed under old codes won't re-match; future pushes create new items.

### 4.3 Loft Glass token bug
- **Symptom:** *"loft glass is still getting 1SX but it should be 1SG."*
- **Fix:** `LGL` (Loft Glass Shutter) variants had `p3: "1SX"` → changed to **`1SG`**. LST (stone) keeps `1SX`. Because both live code creation and the export enumerate the same family data, this corrected **both** at once. **Deployed.**

### 4.4 NEON20 on base — logic explained (no change made)
- Current logic: NEON20 is **removed for all drawer cabinets**; **allowed on base hinged** cabinets (it survives the handle filter because it's handle-agnostic). On a base *stone* family it yields a **6 mm stone** face with the NEON20 handle profile (5 mm only applies in glass families).
- This **matches the user's Config sheet** (NEON20 = `Na` on drawer rows, `HE-3` on base RH/LH). **No change requested.**

---

## 5. Sizes, presets and sections

- **Wall standard height 720 → 725** (all `WC.*` / `WB.*`). Shelf/hinge logic keys on thresholds (`H ≥ 1085`, `≤ 900`), so 725 behaves exactly like 720 — nothing else shifted.
- **Visible Panel size presets** (Height × Width-depth) added per zone: Base 717×586 / 717×362; Wall 1082×362 / 717×362; Tall 2037|2397×586 and ×362; Loft 597×362 / 597×586; MID 1647|1287×362 and ×586. The **"Wall Chimney Area"** sizes were **removed** from Visible Panels and moved to the **Chimney Panel** presets (**1082×336**, **717×336**) — *"chimney area is for chimney panel remove that."*
- **Filler height presets** per zone: Base 717; Wall 1082/717; Tall 2037/2397; Loft 597; MID 1647/1287 (width stays custom, default 80).
- **Filler Elevation** field added (AA–KK **or custom**, via an editable datalist), **stamped onto every Full-BOM row** the filler produces.
- **500 mm width** added to the **hinged + shelf** units: `BC.SH`, `WC.WGL`, `WC.WST`. Confirmed it flows into the export sheets automatically because exports enumerate the same `SIZES` table. *(Borderline families deliberately NOT changed — `BCL.SH`, `WDR`, `WOP`, `WB.WGL/WST` — pending the user's word.)*
- **Duplicate item removed:** `PVC PACKING FOR WALL HANGING 100X100X12 K018 LOC` and `PACKING 12 MM M STONE CABINET HANGING 100X100 MM` are the same — keep the **first**, remove the other everywhere.

---

## 6. Designer / Planning specifics

- **Designer page:** the **Sales Order card is hidden** when the Excel-upload flow is active (`canDesignerUpload = soMode && !planningMode`) — *"remove sales order section from the designer page."*
- **Excel upload** parses the **"Shutter"** sheet; maps via `src/data/planning_finishes.json`: `shutterTypeMap` (MD1+CM1 → MD1CM1 …), `carcassShortCodes` (GC → GALAXY CREMA; **ON/OM → ONYX OMAN** — user: *"Consider it OM… Onyx Oman"*), `profileFinishMap` (**Light Bronze → CHAMPAGNE**).
- **Colour picking by Price Group:** per-line dropdown limited to that row's PG; **bulk apply** with **Zone → Price Group → Colour** filters, where the **PG dropdown is dependent on the Zone selection** — *"there would be a Separate dropdown for Price Group based on the first filter that is Zone Selection."*
- **PG lists:** PG-1 = 25 MAGPPIE colours, PG-2 = 18.
- **Planning page** = designer minus the upload; it keeps SO search + the **service-line → composite replacement** push.

---

## 7. Exports

- **Full BOM:** `S. No.` per project line + an **Elevation** column (2nd), stamped per cabinet.
- **Export All Combinations** gained 6 columns, all **net** areas, computed per combination: **Shelf Qty, Shelf Sqft, Drawers Bottom Sqft, Drawer Back Sqft, Fascia Sqft, Shutter Sqft** (user confirmed: *"1. include all. 2. combined shelf qty and shelf sqft. 3. Yes all 6 are net."*). Glass shelves parse their size from the pkRow name.
- **Opti sheet:** groups `["profile", "panels- sh", "panels- cab"]`; raw 3-mtr light stock and **Profile Pack** are excluded.

---

## 8. Documentation deliverables produced during the conversation

- `ARCHITECTURE.md` — concise business-logic brief (+ an early zip).
- `requirements.md` — **461 requirements** (29 UJ / 315 BR / 55 AC / 62 DC) reverse-engineered by a 7-agent fan-out with a completeness critic; UI treated as source of truth; sufficient to rebuild in any stack.
- `APP_ARCHITECTURE_FULL.md` — self-contained full architecture (real file tree, data model, pipeline, integrations) for uploading to any AI.
- Excel references generated on request: blind fixed-panel sizes; visible-panel/filler/chimney/dishwasher codes; drawer packs + derived formulas; deduction scenarios; the shutter Config-style matrix (validated against code, **completed with the missing MD3 columns**).

---

## 9. Deployment history (all explicitly authorized)

Each deploy ran the 3-step verification first, then `vercel --prod --yes`. Notable ships:
1. Countertop 9-type model, `/designer`, `/planning`, Excel upload, PG filters.
2. 2HB+1BL High-takes-Low.
3. Drawer hardware dedup + Rounding-as-name + drop-down construction set.
4. P7 handle de-duplication (`XXX`).
5. Countertop renames/reorder + Visible-Panel/Chimney/Filler presets.
6. Filler Elevation + wall height 725.
7. **Loft Glass `1SG` fix + 500 mm width** (latest).

**Live:** https://inventory-magppie.vercel.app · Vercel project `inventory-magppie` · org `MAGPPIE SILVERSTONE PRIVATE LIMITED` (Zoho org id `60063687231`, India DC).

---

## 10. Environment gotcha (important for the next AI)

`localhost:3000` was found to be occupied by an **unrelated project** (`Purchase_Store_QC`). The Magppie app was started on **port 3007** instead. **Always verify which project owns a port** (`lsof -a -p <pid> -d cwd`) before telling the user a local URL — the user hit this exact confusion (*"this is not the same app which is published on vercel"*).

---

## 11. Rejected / superseded ideas (do not re-propose)

| Idea | Outcome |
|---|---|
| Clone the builder into a separate designer component | **Rejected** — reuse via `soMode` prop |
| Countertop "edging" as a stone patti with a 620 deduction | **Superseded** — it's "Rounding", name-only, no stone, default 600 |
| Side/front patti as separate BOM pieces | **Superseded** — folded into the top slab size |
| Drop-down as a single flat panel | **Superseded** — it's a mini-counter sub-BOM |
| Drop base = height − 40 | **Superseded** — height − 100 |
| Fixed 830 drop height | **Superseded** — `dropHeight` field, default 705 |
| Renumbering `ctType` values when reordering the dropdown | **Rejected** — display-only reorder; values preserved to protect saved data |
| Moving built-in drawer hardware to the shutter | **Rejected** — user chose "Keep on Drawer Pack" |
| Changing the stone resolver beyond core-name matching | **Settled** — colour-qualifier-optional matching, exact ranked first |
