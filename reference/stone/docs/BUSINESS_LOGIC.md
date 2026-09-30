# Business Logic Reference — Magppie Carcass BOM Builder

Every load-bearing function, constant and rule in the app, with exact formulas and `file:line` citations.

Repo root: `/Users/Apple/Documents/bom-nextjs-app/Inventory - Magppie`
Heart file: `src/components/CarcassBomBuilder.tsx` (~11,220 lines). All unqualified line numbers below refer to that file.

**Units convention:** all linear dimensions are **millimetres (mm)**; areas are **sqft**; profile raw stock is **metres**; silicone is **ML** or **Kg**; stone slabs are **sqft**.

---

## 1. Core constants

`src/components/CarcassBomBuilder.tsx:431-438`

| Constant | Value | Meaning / where used |
|---|---|---|
| `STEP` | `2` | Stepper-profile clearance per side. Back-wall width `bw = W - 2*t - 2*STEP`; back-wall height `bh = H - 2*t - 2*STEP`. |
| `CJ_CUT` | `23` | Gola/handleless (XCJ) top-panel depth cut. Top panel depth becomes `D - CJ_CUT`; the pack label reads `"<D-23>-<D>"` (`:2107`, `:2130`). |
| `SHELF_OFF` | `40` | Base-zone shelf depth offset: shelf depth = `D - SHELF_OFF` (`:2170-2181`). |
| `SQDIV` | `92903.04` | mm² per sqft (= 304.8²). Sole divisor in `sqft()`. |
| `STONE_WASTE` | `0.15` | +15 % stone issuance on every stone panel (UI raw-material requirement calcs, `:6154`, `:6298`, `:6528`, `:8440`, `:9994`). |
| `PROFILE_WASTE` | `0.20` | +20 % aluminium-profile waste (`:5197`, `:6212`, `:8447`, `:10066`). |
| `ELENOR_WASTE` | `0.10` | +10 % waste for the Elenor light run (`:479`, `:3375`, `:3384`). |
| `KG_SQFT` | `3.45` | Carcass stone weight factor: `weight_kg = netSqft * 3.45` (`:8441`, `:9302`, `:9376`). |
| `SH_KGSQFT` | `1.38` | Shutter stone weight factor: `weight_kg = shSqft * 1.38` (`:775`, `:8467`, `:9344`). |

> ⚠️ **Waste inconsistency to be aware of.** `PROFILE_WASTE` (0.20) is the *UI/summary* number, but the **BOM export** hardcodes `25 %` for non-ELEN profiles and `20 %` for ELEN inside `addProfilePanelAndRawRow` (`:2634` — `const profileWaste = profileCode.toUpperCase() === "ELEN" ? 20 : 25;`). Carcass stone raw rows in the export use **17 %**, not 15 % (`addPanelRow`, `:2570`). These are deliberate divergences in the current code; do not "fix" without asking the business owner.

### `sqft(w, h)`
**`:493`** — `const sqft = (w, h) => (w * h) / SQDIV;`
Purpose: convert a mm×mm rectangle to sqft. Inputs: two numbers (mm). Output: number (sqft), unrounded.
Edge cases: no validation — `NaN` in ⇒ `NaN` out; negative dims produce negative area. Callers are expected to have parsed/defaulted first.
Dependency: `SQDIV`.

### `legCount(w)`
**`:492`** — `w <= 150 ? 2 : w >= 1050 ? 6 : 4`
Purpose: PVC leg count from cabinet width. Drives the pack name `HARDWARE PACK PVC LEG SET/${legN}` (`:1773`, `:2189`).

---

## 2. Stepper silicone

### `STP_SIZE` / `STP_KG`
**`:462-463`**
```
STP_SIZE = [75, 150, 300, 450, 500, 550, 600, 720, 850, 900, 1050, 1070, 1150, 1200, 2370]
STP_KG   = [0.01,0.01,0.02,0.02,0.02,0.02,0.03,0.03,0.05,0.05,0.06, 0.06, 0.06, 0.06, 0.09]
```
Parallel lookup tables: for a stepper run length (mm) → silicone consumption (Kg).

### `stepSil(run: number): number`
**`:465-477`**
Rule: **nearest-neighbour lookup** — scan `STP_SIZE`, keep the index with the smallest `|STP_SIZE[i] - run|`, return `STP_KG[i]`. First-wins on ties (strict `<`).
Edge cases: never interpolates; never extrapolates. A 3000 mm run clamps to the 2370 bucket → 0.09 Kg. `run = 0` → 0.01 Kg (bucket 75). No validation.
Consumers: every back-wall build. The standard emission is
```
qty = +(2 * stepSil(W) + 2 * stepSil(verticalRun)).toFixed(3)   // Kg
cons.push({ name: "STEPPER SILICONE (DOWSIL 789)", qty, uom: "Kg", pack: backPk })
```
at `:1678` (tall), `:1682`, `:1687` (special APP upper/lower), `:1847` (loft), `:1938` (MD), `:2014` (wall), `:2158` (base).

---

## 3. Elenor light

### `addElenor(H, profiles, cons, hardware, pkRows)`
**`:478-490`**
Purpose: append the "Elenor with Light" composite (a vertical LED strip in an alu profile, one per cabinet side) to the model arrays. Mutates in place; returns `void`.

Rules / exact values (`H` = the run length = the cabinet side-panel height):
- `lenWithWaste = Math.ceil(H * (1 + ELENOR_WASTE))` = `ceil(H * 1.10)`.
- `elenName = \`Elenor with Light ${H}mm\``.
- `pkRows.push(["elen_bom", elenName, \`L=${H}\`, 2, "Set"])` → a composite of **qty 2** (one per side).
- Profile: `ALU PROF FOR ELENOR 3000X15X15 ANODISED CHAMPAGNE HM-519 MINA`, `len = H`, `qty = 2`, `type = "ELEN"`.
- Consumables (all `pack = elenName`):
  - `LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED` → `2 * lenWithWaste` **MM**
  - `PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI` → `2 * lenWithWaste` **MM**
  - `TAPE FOR COVER CAP ADH 3M X20X 91031 3M` → `2 * lenWithWaste` **MM**
  - `LIGHT EXTENSION WIRE TWP SP XX 14/38 SNO` → `2` **Mtr**
- The **driver is NOT added here** — it is picked manually in the Accessories section (`DRIVER_OPTIONS`, `:410-414`).

Callers: tall (`:1652`, `H = sideH = H - 2t`), loft (`:1841`, `H` = cabinet height), wall non-WDR (`:2009`, `cH`). **Base zones and WDR get no Elenor.**

---

## 4. Catalog: zones, families, sizes

### `ZONES`
**`:634-649`** — 14 zones. Fields: `name`, `p1` (code prefix), `construct` (`fulltb` | `fullsides`), `mount` (`legs` | `wall`), `low?`, `blind?`, `tall?`, `kind?` (`wall`|`loft`|`md`), `fams` (family-set key).

`BC, BCL, BB, BBL, WC, WB, TC, TB, TCL, LO, LB, LBF, LOF, MD`

The **construction branch** in `buildCarcassInnerRaw` is selected by: `z.tall` → tall; `z.kind === "loft"` → loft; `z.kind === "md"` → MD; `z.kind === "wall"` → wall; else → base default.

### Family tables
- `BASE_FAMILIES` **`:496-559`** — `DW, HO, SK, SH, GD, AP, BPO, WBP`
- `BLIND_FAMILIES` **`:561-565`** — `LMC, BSH, PLB`
- `WALL_FAMILIES` **`:567-601`** — `WGL, WST, WOP, WDR`
- `TALL_FAMILIES` **`:603-613`** — `SHF, SHFG, APP, PAN, DPN, DPNG, PPN, PPNG, REF`
- `TALL_BLIND_FAMILIES` **`:615-618`** — `BLND, BLNG`
- `TALL_LOW_FAMILIES` **`:620-623`** — `LOWS, LOWSG`
- `LOFT_FAMILIES` **`:625-628`** — `LST, LGL`
- `MD_FAMILIES` **`:630-632`** — `MDR`

Family keys used by construction: `p2` (code segment 2), `top` (`"panel"`|`"frame"` — frame ⇒ sink profile frame + no top panel), `shelf` (n), `glass` (n), `backStrips` (bool ⇒ two 75 mm strips instead of a back wall), `bracket`/`holes` (tall drilling tokens), `applianceHeight` (APP).
Variant keys: `id`, `label`, `p3`, `p4`, `p5`, `handed`, `both`, `double`, `side`, `act`, `oth`, `blind`, `plain`, `lem`, `bothJD`, `handle`, `handP5`.

### `famSetOf(z: string)`
**`:651-683`**
Purpose: return the family map available for a zone. Signature: `(z: string) => Record<string, any>`.
Rules — **special cases first**, then the `ZONES[z].fams` switch:
1. `z === "BCL"` → `{ SH }` only.
2. `z === "BB"` → `{ LMC, BSH }` (PLB excluded).
3. `z === "BBL"` → `{ BSH }` only.
4. `z === "WB"` → `{ WGL, WST }` (WOP/WDR excluded).
5. Else by `ZONES[z]?.fams`: `blind`→`BLIND_FAMILIES`, `wall`→`WALL_FAMILIES`, `tall`→`TALL_FAMILIES`, `tallblind`→`TALL_BLIND_FAMILIES`, `talllow`→`TALL_LOW_FAMILIES`, `loft`→`LOFT_FAMILIES`, `md`→`MD_FAMILIES`, default → `BASE_FAMILIES`.
Edge case: an unknown zone falls through to `BASE_FAMILIES` (no throw).

### `SIZES`
**`:701-762`** — standard size table keyed `"<zone>.<family>"` → `{ w: number[], h: number[], d: number }`. Full contents:

| Key | w | h | d |
|---|---|---|---|
| BC.DW | 450, 600, 900 | 720 | 560 |
| BC.HO | 600, 900 | 720 | 560 |
| BC.SK | 600, 900, 1050, 1200 | 720 | 560 |
| BC.SH | 450, 500, 550, 600, 900 | 720 | 560 |
| BC.GD | 450, 600 | 720 | 560 |
| BC.AP | 600 | 720 | 560 |
| BC.BPO | 150, 300 | 720 | 560 |
| BC.WBP | 300, 600 | 720 | 560 |
| BCL.DW | 450, 600, 900 | 720 | 336 |
| BCL.HO | 600, 900 | 720 | 336 |
| BCL.SK | 600, 900, 1050, 1200 | 720 | 336 |
| BCL.SH | 450, 600 | 720 | 336 |
| BCL.GD | 450, 600 | 720 | 336 |
| BCL.AP | 600 | 720 | 336 |
| BCL.BPO | 150, 300 | 720 | 336 |
| BB.LMC | 1050 | 720 | 560 |
| BB.BSH | 1150 | 720 | 560 |
| BB.PLB | 1150 | 720 | 560 |
| BBL.LMC | 1050 | 720 | 336 |
| BBL.BSH | 1150 | 720 | 336 |
| BBL.PLB | 1150 | 720 | 336 |
| WC.WGL / WC.WST | 450, 500, 550, 600, 850, 900 | 1085, 725 | 336 |
| WC.WDR | 600, 900 | 1085, 725 | 336 |
| WC.WOP | 300 | 1085, 725 | 336 |
| WB.WGL / WB.WST | 900 | 1085, 725 | 336 |
| WB.WDR | 600, 900 | 1085, 725 | 336 |
| WB.WOP | 300 | 1085, 725 | 336 |
| TC.SHF / TC.SHFG | 450, 600, 900 | 2400, 2040 | 560 |
| TC.APP / TC.PAN / TC.DPN / TC.DPNG / TC.PPN / TC.PPNG / TC.REF | 600 | 2400, 2040 | 560 |
| TB.BLND / TB.BLNG | 1150 | 2400, 2040 | 560 |
| TCL.LOWS / TCL.LOWSG | 450, 600 | 2400, 2040 | 336 |
| LO.LST / LO.LGL | 450, 550, 600, 850 | 600 | 336 |
| LB.LST / LB.LGL | 900 | 600 | 336 |
| LBF.LST / LBF.LGL | 1050 | 600 | 560 |
| LOF.LST / LOF.LGL | 450, 500, 600 | 600 | 560 |
| MD.MDR | 600 | 1650, 1290 | 336 |

### `defSizes(zoneKey: string)`
**`:764-769`**
Purpose: fallback size set when `SIZES["<zone>.<fam>"]` is missing. Returns `{ w, h, d }`.
Exact rules:
- `d = z.low ? 336 : z.kind ? 336 : 560`
- `h = z.tall ? 2400 : z.kind === "wall" ? 1085 : z.kind === "loft" ? 600 : z.kind === "md" ? 1650 : 720` (returned as `h: [h]`)
- `w = [300, 450, 600, 900]` always.
Edge case: **throws** if `zoneKey` is not in `ZONES` (`z.low` on `undefined`). Caller `standardSizes` (`:6916`) always passes a real zone.

---

## 5. Shutter design system

### Design tables
**`:772-779`**
```
SH_INSET  = { MD1:5, MD2:5, MD3:3, MD1CM1:5, MD1CM2:5, MD2CM1:5, MD2CM2:5,
              MD3CM1:3, MD3CM2:3, CL1:118, CL2:149, NEON20:5 }
SH_FRAME  = { MD1:25, MD2:25, MD3:25, MD1CM1:25, MD1CM2:25, MD2CM1:25, MD2CM2:25,
              MD3CM1:25, MD3CM2:25, CL1:31, CL2:31, NEON20:25 }
SH_DESIGNS = [MD1, MD2, MD3, MD1CM1, MD1CM2, MD2CM1, MD2CM2, MD3CM1, MD3CM2, CL1, CL2, NEON20]
XCJ_DESIGNS = [MD1, MD3, MD1CM1, MD1CM2, MD3CM1, MD3CM2]   // handleless / gola
STD_DESIGNS = [MD2, MD2CM1, MD2CM2]                          // Titus handle
```
`inset` = how much smaller the stone/glass face is than the leaf: `pw = w - inset`, `ph = h - inset`. `frame` appears verbatim in the shutter code.

### `GLASS_SHUTTER_FAMS` / `isGlassShutterFam(fk)`
**`:685-686`** — `new Set(["WGL","SHFG","BLNG","DPNG","PPNG","LOWSG","LGL"])`. Glass families carry a **5 mm glass face** and **8 mm glass shelves**.

### `shutterCornerName(fk, kind)`
**`:690-693`**
`isGlassShutterFam(fk) && kind !== "fixed"` → `"CORNER BRACKET FOR GLASS SHUTTER 62X62X GSP-CBM EBC"`, else `"CORNER CONNECTOR FOR STONE 70X70X2 MAR"`.
Key rule: the **fixed dummy panel of a blind cabinet is always stone**, even in a glass family.

### `shThkOf(design, isGlassShutter): number`
**`:782-786`**
```
if (isGlassShutter) return 5;                                   // glass face
if (["MD3","MD3CM1","MD3CM2"].includes(design)) return 9;       // MD3 family = 9mm stone
return 6;                                                        // everything else = 6mm stone
```
Edge case: an unknown design silently returns 6.

### `shDeduct(isBase, design, loc): number` — **the 33/3 rule**
**`:788-792`**
```
if (!isBase) return 3;
if (["MD1","MD1CM1","MD1CM2","MD3","MD3CM1","MD3CM2"].includes(design))
    return loc === "ML" ? 3 : 33;
return 3;
```
Plain language: shutter **height** is reduced by 3 mm by default. But on a **base cabinet** with a **handleless (MD1/MD3 family) design**, the deduction is **33 mm** — the extra 30 mm is the gola/finger gap — **except** for the middle low-back drawer front (`loc === "ML"`), which keeps 3 mm because it sits between two other fronts and needs no gap. MD2 family (Titus handle) never gets the 33.
`isBase` is computed at the call site as `!Z.kind && !Z.tall` (`:1049`).

### `hingeN(h): number`
**`:794-796`** — `h <= 900 ? 3 : h <= 1600 ? 4 : h <= 2100 ? 5 : 6`. Input is the **leaf height** (mm). Used for hinge-pack `Set/n` and for the wall-cabinet dynamic `nH` drilling token.

### `shutSpec(zk, fk, v, inbuiltDrawers = "none")`
**`:798-821`**
Returns the shutter face plan: `{ kind: "hinged"|"drawer"|"none", blindW?, fronts?, upperDoor? }`.
Rules in order:
1. `Z.blind` → `{ kind: "hinged", blindW: (Z.kind === "wall" || Z.kind === "loft") ? 450 : 550 }`.
2. `fk === "DW" || fk === "HO"`:
   - `v.id === "3dr" && inbuiltDrawers === "1lb"` → fronts `[{UH,hb:1},{BH,hb:1}]`
   - `v.id === "3dr" && inbuiltDrawers === "2hb1bl"` → fronts `[{UH,hb:1},{BH,hb:1}]` (**two** high-back faces; the third box is internal)
   - else `v.p4 === "2HB"` → `[{UH,hb:1},{BH,hb:1}]`; otherwise (3-drawer `2LB+1HB`) → `[{UL,hb:0},{ML,hb:0},{BH,hb:1}]`
3. `fk ∈ {GD, BPO, WBP}` → `{ kind:"drawer", fronts:[{loc:"FH", hb:1}] }` (full-height single front).
4. `Z.tall && fk === "APP"` → `{ kind:"drawer", upperDoor:true, fronts: v.p4==="2HB" ? [{UH},{BH}] : [{BH}] }`.
5. `fk ∈ {SK, SH, WGL, WST, WDR, SHF, SHFG, PAN, DPN, DPNG, PPN, PPNG, REF, BLND, BLNG, LOWS, LOWSG, LST, LGL}` → `{ kind: "hinged" }`.
6. Otherwise `{ kind: "none" }` (no shutter — e.g. `WOP`, `MDR`, `AP`).

`loc` codes: `UH` upper-high, `ML` middle-low, `UL` upper-low, `BH` bottom-high, `FH` full-height, `L`/`R` hinge side, `X` fixed dummy.

### `validDesigns(zk, fk, v, W?, handle?): string[]`
**`:823-853`**
Purpose: the design list offered for a cabinet. Rules in order:
1. `!v` → all `SH_DESIGNS`.
2. `spec.kind === "none"` → `[]`.
3. `isGlassShutterFam(fk)` → **`["NEON20", "CL1"]`** only (CL1 here is the glass classic).
4. Start from all `SH_DESIGNS`, then for `spec.kind === "drawer"`: drop `NEON20`; and **if any front is low-back (`!fr.hb`)** → collapse to **`["MD1","MD2","MD3"]`** (low-back fronts carry only flat profiles).
5. `fk === "BPO" && W === 150` → `["MD1","MD2","MD3"]`.
6. Handle compatibility — **only applied when `handle` is passed and the zone is base** (`isBase = !Z.kind && !Z.tall`): `handle === "XCJ"` drops `STD_DESIGNS`; `handle === "STD"` drops `XCJ_DESIGNS`. CL1/CL2/NEON20 are handle-agnostic and survive both filters. The live UI omits `handle` (design drives the handle); combination exports pass it.

---

## 6. `addDrawerBoxes(...)`

**`:855-1034`**
```
addDrawerBoxes(zk, fk, v, W, D, t, panels, profiles, hardware, cons, pkRows,
               drawerModel = "Lian", inbuiltDrawers = "none"): void
```
Purpose: emit the internal drawer-box composites for a cabinet. Mutates `panels`/`profiles`/`hardware`/`pkRows`.

**Step 0 — effective inbuilt override (`:868-874`):**
- `fk === "GD"` → force `"1lb"` (grain drawer always carries one built-in low-back).
- `fk === "DPN"` → force `"fixed_dpn"`.
- `WBP` is explicitly **not** given a drawer box (it's a waste-bin accessory) — enforced by `isAcc` below.

**Step 0b — supported model (`:876`):** `drawerModel ∈ {Lian, Hettich, Blum, Hafele, Grass}`. Any other value ⇒ **no boxes at all**.

**Step 1 — standard (shutter-faced) boxes (`:894-914`):** skipped when `isAcc` (`fk === "BPO" || fk === "WBP"`). For each front from `shutSpec(zk, fk, v, effectiveInbuiltDrawers)`:
- `fr.hb === 0` → `bump("Low", 63, "HARDWARE PACK LOW BACK DRAWER H90 SET/1", null)`
- `fr.hb === 1`:
  - if `is2hb1bl` → `bump("High", **63**, "HARDWARE PACK LOW BACK DRAWER H90 SET/1", null)` — **high-takes-low**: in the 2HB+1BL build the box behind each high front is physically a *low* box (short back, H90 runner); only the fascia is tall.
  - else → `bump("High", 212, "HARDWARE PACK HIGH BACK DRAWER H239 SET/1", null)`

**Step 2 — built-in (fascia) boxes (`:918-950`):**
| `effectiveInbuiltDrawers` | Low | Semi High | High |
|---|---|---|---|
| `1lb` | 1 | 0 | 0 |
| `1sb` | 0 | 1 | 0 |
| `2lb` | 2 | 0 | 0 |
| `2sb` | 0 | 2 | 0 |
| `2hb1bl` | 1 | 0 | 0 |
| `fixed_dpn` | 2 | 3 | 0 |

Emission per variant: High → `bump("High", 212, "…HIGH BACK DRAWER H239 SET/1", fascia **210**)`; Low → `bump("Low", 63, "…LOW BACK DRAWER H90 SET/1", fascia **110**)`; Semi High → `bump("Semi High", 148, "…HIGH BACK DRAWER H175 SET/1", fascia **210**)`.
`numHigh` is never set to > 0 by any branch — the High-with-fascia loop (`:940`) is currently dead code.

**Back-height constants:** Low `63`, Semi High `148`, High `212`.
**Hardware packs:** `HARDWARE PACK LOW BACK DRAWER H90 SET/1` / `HARDWARE PACK HIGH BACK DRAWER H175 SET/1` / `HARDWARE PACK HIGH BACK DRAWER H239 SET/1`.

**Step 3 — emit one Drawer Pack per variant (`:953-1034`).** Geometry (`:953-956`):
```
backW   = W - 72
bottomW = W - 50
bottomD = D - 77
faciaW  = W - 2*t - 8
```
Per variant `a` with count `n`, pack name `Drawer Pack- Cab Drawer Box ${variant}`:
- Back panel: `Panels- Cab Drawer Box Back ${variant} ${backW}x${a.backH}x15`, qty `n`, drill `"JD"`, `t = 15`.
- Bottom panel: `Panels- Cab Drawer Box Bottom ${bottomW}x${bottomD}x6`, qty `n`, **no drill**, `t = 6`.
- Fascia (only if `a.fasciaH !== null`): `Panels- Cab Drawer Box Fascia ${variant} ${faciaW}x${a.fasciaH}x15`, qty `n`, drill `"JD"`, `t = 15`, **carcass colour**, and it is **its own pack** (`pack = fasciaPk`) — deliberately NOT nested inside the Drawer Pack composite, because it is the visible cabinet face.
- Side profile: `ALU PROF DRAWER BOTTOM SIDE (HM513) LH/RH`, `len = 483` (**fixed**), qty `2 * n`, `type = "DBS"`.
- Centre profile: `ALU PROF FOR DRAWER BOTTOM CENTER (HM535) MID`, `len = W - 78`, qty `4 * n`, `type = "DBC"`.
- Runner hardware: **only emitted when `a.fasciaH !== null`** (`:1015-1021`). **Hardware dedup, shutter-vs-pack:** shutter-faced drawers already carry the runner pack on their shutter (`buildShutters` sets `s.hinge` to the drawer hardware, `:1093-1095`), so emitting it in the Drawer Pack too would double-count the Zoho item. Only fascia (shutter-less) drawers keep it here.
- `pkRows.push(["panel", drawerPackName, "Set", n, "Set"])`, guarded by a `some(row => row[1] === …)` dedup.

**WBP/BPO exceptions:** `isAcc` skips step 1 entirely; neither gets a standard box. `WBP`'s `1HF`/`1HB` variant tokens do **not** produce a drawer. `BPO`/`WBP` shutters get `hinge = ""` (`:1091`) so no runner hardware at all.
**DPN fixed:** `fixed_dpn` always emits 2 Low + 3 Semi High fascia boxes regardless of the UI's inbuilt selection.

---

## 7. `buildShutters(...)`

**`:1036-1202`**
```
buildShutters(zk, fk, v, design, handle, W, H, hand, inbuiltDrawers = "none"): Shutter[]
```
Returns `Shutter[]` (`:198-211`: `{code, kind, design, w, h, pw, ph, profV, profH, hinge, hq?, loc?}`).

**Guards:** `!design` → `[]`; `spec.kind === "none"` → `[]`.

**Tokens (`:1050-1057`):**
- `inset = SH_INSET[design] || 5`, `frame = SH_FRAME[design] || 25`
- `handleSeg = handle === "XCJ" ? "CJ" : "STD"`
- `matSeg = isGlassShutterFam(fk) ? "GL" : "ST"`
- `shThk = String(shThkOf(design, isGlassShutter))`
- `zp = isBase ? "B" : Z.kind === "wall" ? "W" : Z.tall ? "T" : Z.kind === "loft" ? "L" : "M"`

**Hinge packs — `hingePackFor(hh)` (`:1060-1065`):**
- `Z.kind === "loft"` → `HARDWARE PACK HINGE W/OUT SOFT CLOSE Set/${hingeN(hh)}` (loft doors close via Tip-On)
- `isGlassShutter` → `HARDWARE PACK SLIM HINGE FOR GLASS Set/${hingeN(hh)}`
- else → `HARDWARE PACK 3D HINGE 0 CRANK Set/${hingeN(hh)}`

### 7a. Drawer branch (`:1068-1152`)
Per front:
```
HE  = fr.loc === "FH" ? H : (fr.hb ? 360 : 180)     // ← the 360/180/FH rule
ded = shDeduct(isBase, design, fr.loc)
w   = W - 3
h   = HE - ded
pw  = w - inset ;  ph = h - inset
profV = h ; profH = w
```
Plain language: a **high-back** drawer front is a fixed **360 mm** slot, a **low-back** front is **180 mm**, and a `FH` (grain-drawer / bottle-pullout / waste-bin) front spans the **whole cabinet height `H`**.

`tc` (type code) = `zp + (fr.hb ? "HB" : "LB")`, overridden to `"BPO"` for BPO and `"WBP"` for WBP.
`hinge` = `""` if `isAcc`; else if `inbuiltDrawers === "2hb1bl" && fr.hb` → `HARDWARE PACK LOW BACK DRAWER H90 SET/1` (high-takes-low again); else `HARDWARE PACK ${fr.hb ? "HIGH BACK DRAWER H239" : "LOW BACK DRAWER H90"} SET/1`.

**Shutter code format:**
```
SH-<CJ|STD>-<GL|ST>-<tc>-<W>x<HE>-<loc>-<w>-<h>-<frame>-<shThk>-<design>
e.g. SH-CJ-ST-BHB-600x360-B-597-327-25-6-MD1
```

**`upperDoor` (APP) (`:1121-1141`):** for `Tall + APP`, an extra hinged door above the drawers.
```
HE  = H >= 2400 ? 1085 : 720
ded = shDeduct(isBase, design, "RH")     // isBase is false for tall ⇒ always 3
h   = HE - ded ; dw = W - 3
loc = hand === "RHS" ? "R" : "L"
code = SH-<CJ|STD>-<GL|ST>-<zp>SH-<W>x<HE>-<loc>-<dw>-<h>-<frame>-<shThk>-<design>
hinge = hingePackFor(h)
```

### 7b. Blind branch (`:1154-1194`) — `spec.blindW`
`blindW = 550` for base/tall zones, `450` for wall/loft (from `shutSpec`).
**Functional leaf:**
```
ded  = shDeduct(isBase, design, "RH")
h    = H - ded
dw1  = blindW - 3
loc1 = hand === "RHS" ? "R" : "L"
hq   = 1
```
**Fixed dummy panel** (only when `rem = W - blindW > 0`):
```
dw2 = rem - 3
h2  = H - 3                     // ← always 3, never 33
fi  = SH_INSET["MD1"] = 5 ; ff = SH_FRAME["MD1"] = 25
code = SH-<handleSeg>-ST-<zp>SH-<W>x<H>-X-<dw2>-<h2>-25-6-MD1
kind = "fixed" ; design = "MD1" ; loc = "X" ; hq = 2
hinge = "HARDWARE PACK L BRACKET (fixed dummy)"
```
**Hard rule:** the dummy is **always stone MD1 6 mm** — material token forced to `ST`, thickness forced to `6`, regardless of `matSeg`/`shThk`. It returns immediately after (`:1194`).

### 7c. Hinged branch (`:1196-1201`)
```
two   = v.double || v.p4 === "2HS" || W > 600          // ← auto-split above 600mm
ded   = shDeduct(isBase, design, "RH")
h     = H - ded
dw    = two ? W/2 - 3 : W - 3
doors = two ? [{loc:"L"},{loc:"R"}] : [{ loc: hand === "RHS" ? "R" : "L" }]
hinge = hingePackFor(h)
```
Edge case: odd `W` with `two` gives a fractional `dw` (e.g. `W=901` → `447.5`) — the code string will contain the decimal.

---

## 8. `shutterVDrill(lh, rh, shutters, s)`

**`:1205-1221`**
```
shutterVDrill(lh: string|null|undefined, rh: string|null|undefined,
              shutters: Shutter[], s: Shutter): { lh: string; rh: string } | undefined
```
Purpose: per-shutter vertical **profile** drill codes, mirroring the carcass side-panel drilling.
Rules:
1. If either `lh` or `rh` is falsy → `undefined` (no tags).
2. `isDoublePair` = the hinged shutters of this cabinet include **both** `loc "L"` and `loc "R"`.
3. If `isDoublePair && s.kind === "hinged"`: left leaf → `{ lh: L, rh: "JD" }`; right leaf → `{ lh: "JD", rh: R }`. Each leaf is drilled only on its own outer (hinge) side; the inner meeting edge is a plain joint.
4. Otherwise (single door, fixed dummy, drawer front) → `{ lh: L, rh: R }` (inherits the cabinet's codes).
Consumer: `buildFullBomData` shutter loop (`:3607`) → `buildProfileBomRows(..., vDrill)`.

---

## 9. `mergeCarcassPanels(panels)`

**`:1223-1369`** — `(panels: Panel[]) => Panel[]`
Purpose: collapse the raw per-side panel list into Zoho-shaped merged rows (e.g. separate `LH …` + `RH …` become one `LH/RH …` with a combined drill string).

Regexes (`:1224-1225`): `dirRegex = /\b(Top|TP|Bottom|BT)\b/gi`, `sideRegex = /\b(LH\/RH|LH\+RH|LH|RH|LHS|RHS)\b/gi`.
> ⚠️ Both are **global** regexes reused via `.test()` — `lastIndex` statefulness is a live footgun in `isSidePanel`/`isDirPanel`.

**`parseSideDrill(drill)` (`:1232-1255`)** — the drill-string parser:
- `null` → `{lh:null, rh:null}`
- `"no drill"` (case-insensitive) → `{lh:"no drill", rh:"no drill"}`
- contains `/` and splits into exactly 2 → `{lh: parts[0].trim(), rh: parts[1].trim()}`
- `/^LH\s+(.*)$/i` → `{lh: capture, rh: null}`
- `/^RH\s+(.*)$/i` → `{lh: null, rh: capture}`
- else → `{lh: str, rh: str}`

**Bucketing (`:1257-1273`):** three maps keyed by
- side: `side_${normalizeSideName(name)}_w${w}_h${h}_pack${pack}` (**drill deliberately excluded** so LH and RH merge)
- dir: `dir_${normalizeDirName(name)}_w${w}_h${h}_drill${drill||""}_pack${pack}`
- raw: `raw_${name}_w${w}_h${h}_drill${drill||""}_pack${pack}`

**Side groups (`:1278-1317`):**
- Group of exactly 1 with `qty === 1` → emit as a **single side**: name's side token replaced with `LH` if `/\b(LH|LHS)\b/i` matched the name or `parsed.lh` is truthy, else `RH`; drill = the corresponding parsed half.
- Else → merge: sum `qty`, take the last non-null `lh`/`rh` drill, combine as `lhDrill === rhDrill ? lhDrill : \`${lhDrill} / ${rhDrill}\`` (or whichever single one exists), name normalised to `LH/RH`.

**Dir groups (`:1320-1355`):** single → passthrough. Multiple → sum qty, keep `first.drill`, and pick the combined token by which directions appeared: `Top`/`Bottom` → `"Top/Bottom"`; `TP`/`BT` → `"TP/BT"`; lowercase variants → `"top/bottom"` / `"tp/bt"`; default `"TP/BT"`.

**Raw groups (`:1358-1368`):** single → passthrough; multiple → spread `first` and sum `qty`.

Edge case: the merged output **drops `t`** (thickness) for side and dir merges (the object is rebuilt literally, not spread) — downstream falls back to `m.t`.
Caller: `buildCarcassInner` (`:1571`) only.

---

## 10. `explodePanelForTree(p, cFinish)`

**`:1388-1541`** — `(p: Panel, cFinish: string) => TreeItem[]`
Purpose: render-time expansion of one merged panel into the UI tree (`Part` → `Panel` nesting), mirroring Zoho's structure. `TreeItem` at `:1377-1386`.

Rules:
- `hasDrill = p.drill && trim !== "" && trim.toLowerCase() !== "no drill"`.
- **No drill** → a single `type:"panel"` node named `getPanelBaseName(p.name, null, cFinish)`, `qty = p.qty`.
- **Drilled + combined side** (`/LH\/RH|LH\+RH/i`): split the drill on `/` into `lhDrill`/`rhDrill` (both = `p.drill` if no `/`), produce **two `part` nodes** (`getPartBaseName(lhName, lhDrill, cFinish)` and the RH twin), each `qty = p.qty / 2`, each with **one shared `panel` child** `getPanelBaseName(p.name, null, cFinish)` at `qty 1`.
- **Drilled + combined dir** (`/TP\/BT|Top\/Bottom|TP\+BT/i`): same shape; the tag is `"Top"`/`"Bottom"` if the name contains "top", else `"TP"`/`"BT"`; both parts share `p.drill`.
- **Drilled, single** → one `part` node at `qty = p.qty` with one `panel` child at `qty 1`.
Edge case: `p.qty / 2` on an odd qty yields `.5`.

### `formatProfileNameForTree(p, carcassProfileColor)`
**`:1543-1552`** — strips `V|H|Top|Bottom|vertical|horizontal|edge` word tokens, normalises `LH+RH`→`LH/RH` and `TP+BT`→`TP/BT`, collapses whitespace, then returns `` `${cleaned} ${p.len}mm ${pFinish}` `` with `pFinish = carcassProfileColor || "CHAMPAGNE"`.

---

## 11. `buildCarcassInner` / `buildCarcassInnerRaw`

### `buildCarcassInner(zk, fk, v, handle, W, H, D, t, mat, hand, drawerModel="Lian", inbuiltDrawers="none", tipOn="")`
**`:1554-1588`** → `CarcassModel`
Thin wrapper: calls `buildCarcassInnerRaw`, then `model.panels = mergeCarcassPanels(model.panels)`, then **recomputes** `netSqft`, `nPanels`, `ops.cut`, `ops.drill` from the merged list so the summary matches what is displayed:
```
netSqft += sqft(p.w, p.h) * p.qty ;  nPanels += p.qty ;  nCut += p.qty ;  if (p.drill) nDrill += p.qty
```

### `buildCarcassInnerRaw(...)`
**`:1590-2213`** → `CarcassModel` (`:213-247`)
Common preamble (`:1605-1612`):
```
z = ZONES[zk] ; f = famSetOf(zk)[fk] ; p4 = v.p4 || hand
isCJ = handle === "XCJ"
handleToken = handle === "XCJ" ? "CJ" : "STD"
matToken = isGlassShutterFam(fk) ? "GL" : "ST"
```
**Cabinet code format (all branches):**
```
<p1>-<p2>-<CJ|STD>-<GL|ST>-<p3>-<p4>-<p5>-<W>-<H>-<D>-<t>[-<mat>]
```
`mat` is appended only when `mat && mat !== "(none)"`. In `buildModel` `mat` is `carcassMat` or `` `${carcassMat}-${shutterMat}` `` when they differ.

**Universal assembly glue (every branch):**
```
backPerim = <per-branch>            // 2*(bw+bh), or the APP/backStrips variants
glue = Math.round(((4*D + backPerim) / 1000) * 15)      // ML
cons.unshift({ name: "GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG", qty: glue, uom: "ML", pack: "Assembly Glue" })
```
(`:1780-1782` tall, `:1867` loft, `:1958` MD, `:2045` wall, `:2196` base.) Plain language: 15 ML per metre of (4 side edges + back-wall perimeter).

#### 11a. Tall branch (`z.tall`) — `:1614-1793`
```
sideH = H - 2*t ;  sd = D - 15 ;  shD = D - 49
bw = W - 2*t - 2*STEP
bh = fk === "REF" ? H - 1874 : H - 2*t - 2*STEP     // REF back wall is short
```
Drilling (`:1620-1633`): `br = f.bracket`, `ho = f.holes`.
- `v.bothJD` → `lh = rh = \`${br} JD\``
- `v.double` → `lh = rh = \`${br} ${ho}\``
- else handed: `LHS` → `lh = \`${br} ${ho}\``, `rh = \`${br} JD\``; `RHS` → mirrored.

Code segments (`:1634-1641`): `isApp = f.applianceHeight`; `p3 = isApp ? (H >= 2400 ? "3SX" : "1SX") : (v.p3 || "1SX")`; `shelves = parseInt(p3) || 1`; `p4t = isApp ? v.p4 : (v.p4 || hand || "XXX")`; `p5t = isApp ? (hand || "XXX") : (v.p5 || "XXX")`.

Packs & panels:
- Sides: `Set of Parts- Cab Standard Tall LH(${lh})+RH(${rh}) ${sideH}x${sd}x${t}`, panel `Panels- Cab Tall LH/RH …` qty 2, drill `` `${lh} / ${rh}` ``.
- `addElenor(sideH, …)`.
- Top/bottom: `Set of Parts- Cab Standard Base${lowT} TP(JD)+BT(LEG) ${W}x${D}x${t}` — Top drill `"JD"`, Bottom drill `"Leg holes"`.
- **`isSpecialApp`** = `fk === "APP" && (v.id === "1dw" || v.id === "2dw")` → **two** back walls (`:1661-1685`):
  `hUpper = H - 1349` (= 1051 at H=2400), `hLower = v.id === "1dw" ? 286 : 686`. Each gets `Prof Stepper (STP) TP/BT` len `W` qty 2 + `Prof Stepper (STP) LH/RH` len `hUpper`/`hLower` qty 2 and its own silicone.
- **`refNoBackShelf`** = `isRef && H === 2040` → **no back wall and no shelves at all**.
- Standard back wall (`:1686-1697`): `backVProf = bh + 2*t + 2*STEP`; steppers `W`×2 and `backVProf`×2; silicone `2*stepSil(W) + 2*stepSil(backVProf)`.
- Shelves (`:1700-1740`): `shelfW = W - 2*t - 5`.
  - Glass tall families (`isTallGlass`) → `glassShelf = { name: \`GLASS TOUGH EP ${W-36}X${shD}X8 CLEAR SKV\`, w: W-36, d: shD, t: 8, qty: shelves }` — emitted as a **direct raw material**, not a stone-panel BOM.
  - Else stone shelf panel `Panels- Cab Shelf${lowSh} ${shelfW}x${shD}x${t}` qty `shelves`, plus `Prof Shelf (HM511) LH/RH` len `shD - 2`, qty `2 * shelves`, type `SLF`.
- **REF extra shelf** (`:1743-1758`): one shelf at depth `D - 13`, profile len `D - 13 - 2`.
- **APP extra shelves** (`:1760-1785`): `v.id === "1dw"` → 3; `v.id === "2dw"` → 2; at depth `D - 13`, profile len `D - 15`.
- Hardware: `HARDWARE PACK PVC LEG SET/${legCount(W)}` qty 1; `HARDWARE PACK CARCASS FIXING HPL 4 SET/1` qty 1 (label "large").
- `backPerim = isSpecialApp ? (2*(bw+hUpper) + 2*(bw+hLower)) : (refNoBackShelf ? 0 : 2*(bw+bh))`.
- `addDrawerBoxes(...)`, then totals. Returns with `sn: "Standard"`, `isCJ: false` (**tall never CJ**), plus `glassShelf`.

#### 11b. Loft branch (`z.kind === "loft"`) — `:1795-1875`
```
sideH = H ;  sd = D - 15 ;  bw = W - 2*t - 2*STEP ;  bh = H - 2*t - 2*STEP ;  tbw = W - 2*t
gw = W - 36 ;  gd = D - 49 ;  gN = f.glass || 1
```
Drilling: `v.both` → `lh = rh = v.side`; else handed `lh = L ? v.act : v.oth`, `rh = L ? v.oth : v.act`.
Panels: sides qty 2 drill `` `${lh} / ${rh}` ``; `Panels- Cab Loft TP` + `BT` (`tbw × D`), both drill `"JD"`; `addElenor(H, …)`; back wall `bw × bh` no drill + steppers `W`×2, `H`×2 + silicone.
Glass shelf: `GLASS TOUGH EP ${gw}X${gd}X8 CLEAR SKV` qty `gN` — **legacy path**: pushed to `hardware` as `` `GLASS TOUGH EP ${gw}X${gd}X8` `` (name without the `CLEAR SKV` suffix), pack `"Glass Shelf"`.
Mount: `HARDWARE PACK WALL HANGER BRACKET SET/1` + `HARDWARE PACK CARCASS FIXING HPL 4 SET/1` (label "small (wall)"). **No legs.**
**Tip-On** (`:1859-1864`, loft only): if `tipOn` is non-empty, qty = `v.both ? 2 : 1` (one per door). Options in `TIPON_OPTIONS` (`:696-699`).
`backPerim = 2*(bw+bh)`. **No drawer boxes.**

#### 11c. MD branch (`z.kind === "md"`, rolling shutter) — `:1877-1965`
```
sideH = H ;  sd = D ;  bw = W - 2*t - 2*STEP ;  bh = H - 17 ;  tbw = W - 2*t
gw = W - 36 ;  gd = D - 62 ;  gN = f.glass || 3
lh = rh = v.side
```
Panels: sides (`sd × sideH`) qty 2; `Panels- Cab MD TP` (`tbw × D`) drill `"JD"` — **no bottom panel**; back `bw × bh` + steppers `W`×2, `H`×2 + silicone; a **fixed stone shelf** `Panels- Cab MD Stone Shelf ${bw}x${D-32}x${t}` qty 1.
Glass shelf item name here is the **other format**: `GLASS 08 MM CLEAR TOUGH EP ${gw} X ${gd} MM` in `pkRows`, `GLASS 08 MM ${gw}X${gd}` in `hardware`.
Mount: wall hanger + carcass fixing (small). No legs, no drawers, no Elenor.

#### 11d. Wall branch (`z.kind === "wall"`) — `:1967-2060`
```
isWDR = fk === "WDR"
cH    = isWDR ? H - 30 : H - 15          // WDR loses an extra 15mm for the sink profile
sideH = cH ;  sd = isWDR ? D : D - 15
bw = W - 2*t - 2*STEP ;  bh = cH - 2*t - 2*STEP ;  tbw = W - 2*t
gw = W - 36 ;  gd = D - (isWDR ? 39 : 49)
```
Drilling: `v.both` → `lh = rh = v.side`; `v.handed` → `lh = L ? v.act : v.oth`, `rh = L ? v.oth : v.act`; else `lh = rh = v.side`.

**Height-derived shelf count (`:1990-1994`):**
```
wallShelfQty = isWDR ? (H >= 1085 ? 2 : 0)
             : (fk ∈ {WGL, WST, WOP}) ? (H >= 1085 ? 3 : 1) : 0
shelfTok = wallShelfQty === 0 ? "XXX" : `${wallShelfQty}S`
p3Code   = isWallShelfFam ? (wallShelfQty === 0 ? "XXX" : v.p3.replace(/^\d+/, String(wallShelfQty))) : v.p3
```
**Height-derived drilling tokens (`:1999-2009`):** for `isWallShelfFam`, `lh`/`rh` have their leading `\d+S` replaced by `shelfTok`; and for `WGL`/`WST` only, `\d+H` is replaced by `` `${hingeN(H)}H` `` (720 → 3H, 1085 → 4H).

**WDR specifics (`:1988-2004`):** only a `TP(JD)` panel (**no bottom**); a sink profile frame pack `Sink Profile Frame (HM510)` with `Prof Sink Frame (SINK) TP/BT` len `W` qty 2 and `LH/RH` len `D` qty 2, plus `CORNER BRACKET FOR GLASS SHUTTER` qty 1. **No Elenor.**
Non-WDR: `TP(JD)+BT(JD)` panels + `addElenor(cH, …)`.

Back wall `bw × bh`; steppers `W`×2 and `cH`×2; silicone `2*stepSil(W) + 2*stepSil(cH)`.
**Shelves (`:2018-2040`):**
- `WST`/`WGL` → `glassShelf` **direct raw material** `GLASS TOUGH EP ${gw}X${gd}X8 CLEAR SKV`, qty `wallShelfQty`.
- Other wall families with `f.glass && wallShelfQty > 0` (WOP/WDR) → **legacy** hardware-pack glass shelf.
Mount: wall hanger + carcass fixing (small).

#### 11e. Base default branch — `:2062-2212`
```
sideH = H - 2*t ;  bw = W - 2*t - 2*STEP ;  bh = H - 2*t - 2*STEP
sn    = isCJ ? "CJ" : "Standard"
lowS  = z.low && !z.blind ? " (Low Depth)" : ""
lowT  = z.low ? " (Low Depth)" : ""
lowSh = z.low ? " (Low)" : ""
shelfW  = W - 2*t - 5
shelfPk = `Panels- Cab Shelf${lowSh} ${shelfW}x${D - SHELF_OFF}x${t}`
```
**Blind drilling (`:2066-2076`):** `v.plain` → `LHS`: `lh="BL L"`, `rh="BL"`; `RHS`: `lh="BL"`, `rh="BL R"`. Non-plain blind → `LHS`: `lh="1S BL L"`, `rh="1S BL"`; `RHS`: `lh="1S BL"`, `rh="1S BL R"`.
Non-blind: `v.both` → `lh=rh=v.side`; `v.handed` → `LHS`: `lh=v.act, rh=v.oth`, `RHS`: mirrored; else `lh=rh=v.side`.

**LeMans (`v.lem`) top/bottom code (`:2081-2085`):** `LHS` → `TP(LEM L)+BT(LEM L+LEG)`, `RHS` → `TP(LEM R)+BT(LEM R+LEG)`; else `TP(JD)+BT(LEG)`.

**CJ cut (`:2086`):** `topDepTxt = isCJ ? \`${D - CJ_CUT}-${D}\` : String(D)`; top panel depth `td = isCJ ? D - CJ_CUT : D`, name `Panels- Cab Top${isCJ ? " CJ" : ""} ${W}x${td}x${t}` (`:2110`).

**2HB+1BL code relabel (`:2088-2090`):** `isInbuilt2hb1bl = z.p1 === "BC" && fk === "DW" && v.id === "3dr" && inbuiltDrawers === "2hb1bl"` → `codeP3 = "2HB"`, `codeP4 = "1BL"`. **Boxes are unchanged** — this is a naming-only override.
**P5/P7 (`:2091-2093`):** always `"XXX"` — the handle is decoded from the `handleToken` (P3 position in the code string).

Sides (`:2107-2109`): **two separate qty-1 panels** `Panels- Cab LH/RH ${D}x${sideH}x${t}` with drills `` `LH ${lh}` `` and `` `RH ${rh}` `` — these are what `mergeCarcassPanels` later merges.
`f.top === "frame"` (SK/HO) → **no top panel**; only `Part Cab Common BT LEG ${W}x${D}x${t}` (drill `"Leg holes"`), plus a sink frame: `Prof Sink Frame (SINK) TP/BT` len `W` qty 2 and `LH/RH` len **530** (fixed) qty 2, plus `CORNER BRACKET FOR GLASS SHUTTER` qty 1 (`:2160-2167`).
**Back strips (`f.backStrips`, i.e. `AP`) (`:2140-2144`):** instead of a back wall, **two** `Panels- Cab Back Strip ${bw}x75x${t}` (75 mm tall, no drill, no steppers, no silicone); pack `Back Wall Strips ${bw}x75x${t}`; `pkRows` gets `Back Wall TP(Prof)` and `Back Wall BT(Prof)`.
Else standard back wall + steppers `W`×2 and **`H`**×2 (note: `H`, not `bh + 2t + 2STEP` as in the tall branch) + silicone.
`f.shelf` (`:2170-2182`): shelf panel qty `f.shelf` at `shelfW × (D - SHELF_OFF)`; profile `Prof Shelf (HM511) LH/RH` len `z.low ? (D - SHELF_OFF) : (D - SHELF_OFF - 2)`, qty `2 * f.shelf`, type `SLF`.
Legs + carcass fixing (label "large").
`backPerim = f.backStrips ? 2 * (2*(bw + 75)) : 2*(bw + bh)`.
`addDrawerBoxes(...)`, totals, return with real `sn` and `isCJ`.

---

## 12. `buildModel(...)`

**`:2214-2254`**
```
buildModel(zk, fk, v, handle, design, carcassMat, shutterMat, carcassProfileColor,
           shutterProfileColor, W, H, D, t, hand, drawerModel="Lian",
           inbuiltDrawers="none", fixedPanelMat="", tipOn=""): CarcassModel
```
Rules:
1. `matSuffix = (carcassMat === shutterMat || !shutterMat) ? carcassMat : \`${carcassMat}-${shutterMat}\`` — the code's finish suffix.
2. `m = buildCarcassInner(zk, fk, v, handle, W, H, D, t, matSuffix, hand, drawerModel, inbuiltDrawers, tipOn)`.
3. Stamp `zk`, `fk`, `carcassMat`, `shutterMat`, `fixedPanelMat = fixedPanelMat || shutterMat`, `carcassProfileColor`, `shutterProfileColor`, `mat = carcassMat` (fallback).
4. `m.shutters = buildShutters(zk, fk, v, design, handle, W, H, hand, inbuiltDrawers)`.
5. For each shutter push `["shut", s.code, label, 1, "Set"]` into `pkRows`, where
   `label = isGlassShutterFam(fk) && s.kind !== "fixed" ? \`${s.w}×${s.h} · glass ${s.pw}×${s.ph}×5\` : \`${s.w}×${s.h} · panel ${s.pw}×${s.ph}×${shThkOf(s.design, false)}\``.

---

## 13. Countertops

### `CT_TYPES`
**`:127-137`** — the 9 construction types. `value` is what is **stored/decoded**; the label carries the **display** number (note types 2 and 5 are swapped on screen).

| Display | `value` | Label | `island` |
|---|---|---|---|
| 1 | 1 | Linear | false |
| 2 | **5** | Linear + BSV | false |
| 3 | **2** | Linear + LHV with LH Drop | false |
| 4 | **3** | Linear + RHV with RH Drop | false |
| 5 | **4** | Linear + BSV with Both Side Drop | false |
| 6 | 6 | Island Compact | true |
| 7 | 7 | Island Table | true |
| 8 | 8 | Island with 350mm Sitting | true |
| 9 | 9 | Island Both Side Cabinets | true |

### `ctHasDrop(type): boolean`
**`:156`** — `type === 2 || type === 3 || type === 4 || (CT_TYPES.find(t => t.value === type)?.island ?? false)`. True ⇒ the editable **drop height** field applies.

### `ctEdgingOptions(type)`
**`:102-107`** — the **Rounding** options (name-only; **no stone piece, no deduction**).
- `type === 1` → `None, LH (left), RH (right), Both`
- `type === 2` (LH drops) → `None, RH` (only the free side)
- `type === 3` (RH drops) → `None, LH`
- everything else (4, 5, islands) → `None` (no free side)

### `ctGeom(type, L, D, T, dropHeight = 705): CtGeom`
**`:161-196`** — the single source of truth for countertop geometry. Returns `{ topL, topD, baseL, baseD, panels, brass, brassLen, grandLights, sideDrops }` (`:143-154`).

```
dh        = dropHeight > 0 ? dropHeight : 705
isl       = CT_TYPES.find(t => t.value === type)?.island ?? false
dropLeft  = type === 2 || type === 4 || isl
dropRight = type === 3 || type === 4 || isl
edgeBoth  = type === 5
```
**Panels (`:171-186`):**
- `dropLeft`  → `{ label:"Drop-Down Left",  len: D, wid: dh, kind:"dropdown" }`; `brass++`; `sideDrops++`
- `dropRight` → `{ label:"Drop-Down Right", len: D, wid: dh, kind:"dropdown" }`; `brass++`; `sideDrops++`
- `edgeBoth`  → `edgeFolds += 2` (no panel, no brass)
- island extras:
  - `type === 6` → `{ label:"Island Back Panel (single-side)", len: max(0, L-60), wid: dh, kind:"dropdown" }`
  - `type === 7` → `{ label:"Island Vertical Panel (double-side)", len: max(0, L-60), wid: dh, kind:"dropdown" }` **and `grandLights = 2`**
  - `type === 8` → `{ label:"Island Sitting Drop", len: max(0, L-80), wid: **350**, kind:"dropdown", deadQty: 2 }`
  - `type === 9` → `{ label:"Island Back Panel (section)", len: max(0, L-60), wid: dh, kind:"dropdown" }`

**Folds & reductions (`:190-196`):**
```
reduce         = type === 7 ? 0 : 1        // type 7 = freestanding island table → EXEMPT entirely
backDrops      = isl ? 1 : 0
topDepthReduce = (type === 7 || type === 8) ? 0 : 1   // type 8: upper counter keeps full depth

topL  = L + 30*edgeFolds - 100*sideDrops*reduce
topD  = D + 30 - 100*backDrops*reduce*topDepthReduce
baseL = L - 100*sideDrops*reduce
baseD = max(0, D - 40 - 100*backDrops*reduce)
return { topL, topD, baseL, baseD, panels, brass, brassLen: D, grandLights, sideDrops }
```
**Plain language (the shared build, `:108-125`):** every type has a top slab `L×D`, a **dead-stock counter base at `D − 40`** (560 deep at D=600, set back 10 mm), a 30 mm front mitred drop-down patti (which is why `topD` always gets **`+30`**), a Grand Light HM-512 under the front lip, a 3 mm edge radius, and polish/glue.
- A **side drop-down** is a *mitred fold* of the top slab, so it is **not** a separate patti piece; instead the cabinet mitre takes **100 mm** off the top & base **LENGTH** on that side. Each drop side also gets **1 brass strip** (cut `D × 30`) and a `D × dropHeight` visible stone panel.
- **Type 5** side *edges* (no drop) fold **+30 mm each** into the top slab length instead (`edgeFolds = 2` ⇒ `+60`).
- The **island back drop** takes 100 mm off the **DEPTH** (top & base).
- **`brassLen = D`** always (the brass runs the side edge).
- Rounding is **name-only** — it never appears in `ctGeom`.

### Countertop BOM emission (inside `buildFullBomData`) — `:3892-3977`
```
q  = max(1, c.qty) ; L = parseFloat(c.length)||0 ; D = parseFloat(c.depth)||0 ; T = parseFloat(c.thickness)||30
pt = T / 2                        // each pasted slab: 15 for a 30mm top, 20 for 40mm
color = c.color || getDefaultShutterShadeForZone("base")
areaSqft = sqft(L, D)
geom = ctGeom(c.ctType || 1, L, D, T, parseFloat(c.dropHeight) || 705)
dropIssue = (c.ctType === 7) ? 30 : 15        // ← the +15 / +30 issuance
```
**Naming (`:3906-3911`):**
```
roundLabel = (c.edging && c.edging !== "none")
  ? ` Rounding ${c.edging === "left" ? "LH" : c.edging === "right" ? "RH" : "Both"} (-${parseFloat(c.edgingHeight) || 600})`
  : ""
masterItem = `Countertop Pasting Material ${T}mm ${L}x${D}${roundLabel}`
subCode    = `CT-${L}x${D}x${T}`
masterSku  = `CT-${L}x${D}x${T}-${q}` + skuSuffix
```
**Rows:**
- L0 master `Countertop / Countertop`, qty `q`.
- L1 sub-BOM `subCode`.
- L2 `Panels- CT Stone ${pt}mm ${geom.topL}x${geom.topD}`, finish `color`.
- L2 `Panels- CT Counter Base Stone ${pt}mm ${geom.baseL}x${geom.baseD}`, finish **`"DEAD STOCK"`**.
- Per `geom.panels`:
  - **`kind === "dropdown"` → a mini-BOM** (`:3937-3951`):
    ```
    dh      = p.wid ;  visH = dh + dropIssue ;  deadQty = p.deadQty || 1
    node    = `Drop-Down ${p.label.replace(/^Drop-Down /,"")} ${p.len}x${dh}`   // L2 sub_bom, Sub Group "Drop-Down"
    L3 visible : `Panels- CT ${p.label} Stone ${pt}mm ${p.len}x${visH}`   finish=color, qty 1
    L3 base    : `Panels- CT ${p.label} Base Stone ${pt}mm ${p.len}x${max(0, dh-100)}`  finish="DEAD STOCK", qty deadQty
    L3 cons    : emitCons(node, sqft(p.len, visH), 3)
    ```
    **`dropHeight − 100`** is the dead-stock base reduction. **`deadQty = 2`** only for type 8's sitting drop.
  - `kind === "flat"` → a single L2 `Panels- CT ${p.label} ${pt}mm ${p.len}x${p.wid}` line in `color`.
- **Brass (`:3955-3960`)**, only when `geom.brass > 0`:
  `Item = \`BRASS STRIP 05MM 600 X 30 MM ${geom.brassLen}x30\``, `SKU = "BRASS STRIP 05MM 600 X 30 MM" + skuSuffix`, Height `geom.brassLen`, Width `"30"`, Thickness `"5"`, qty `geom.brass`, Sub Group `Hardware`.
- **Band light (`:3965-3976`)**, only when `c.baseLight`:
  ```
  lightLen = max(0, L - 30 * geom.sideDrops)
  for gi in 0..geom.grandLights-1:
      tag = grandLights > 1 ? (gi === 0 ? " Front" : " Back") : ""
      L2 sub_bom `Counter Band Light${tag} ${lightLen}mm`  (Sub Group "Light")
      L3 addLightCutRow ALU PROF GRAND COUNTER 3000X20X15.5 ANODISED CHAMPAGNE HM-512 MINA — "Grand Counter Profile", finish CHAMPAGNE, waste 0
      L3 addLightCutRow LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED — "LED Light", waste 0
      L3 addLightCutRow PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI — "Diffuser", waste 0
  ```
- **Consumables — `emitCons(parentRef, area, level)` (`:3925-3932`)**, per-sqft rates:
  | Item | Rate | UoM |
  |---|---|---|
  | `AKEMI 5010 FOR STONE POLISH 2.25 PER KG S` | 10 | gram |
  | `GLUE BONDTITE FAST & CLEAR FOR STONE XX AGG` | 10 | gram |
  | `GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG` | 40 | ml |
  `soQ = +(rate * area).toFixed(3)`; `Actual = +(soQ * q).toFixed(3)`.
  Counter-level call: `emitCons(subCode, areaSqft, 2)` (`:3977`) — **uses the raw `L×D` area, not `topL×topD`**.

---

## 14. `buildFullBomData(...)`

**`:3030-3979`**
```
buildFullBomData(project, soNumber, stockMap, selectedRawIds = {}, rawOptionsMap = {},
                 fillers = [], visiblePanels = [], backsplashes = [], countertops = [],
                 getDefaultShutterShadeForZone = () => "STATUARIO",
                 getDefaultShutterHeightForZone = () => 715,
                 getDefaultCabinetDepthForZone = () => 560,
                 getShutterProfileForZone = () => "MD1",
                 getProfileColorForZone = () => "CHAMPAGNE"): FullBomRow[]
```
Purpose: the master flattened, levelled BOM used by every export (Full BOM sheet → OOS → Opti). `FullBomRow` shape at `:2339-2366`.

**SKU suffix (`:3049`):** `skuSuffix = (so && so !== "Project" && so !== "DRAFT") ? "-" + so : ""`.

**Per project line (`:3051-3665`):**
- `zone = m.code.split("-")[0]`; `zoneName = ZONES[zone]?.name || zone`; `cFinish = m.carcassMat || m.mat`; `sFinish = m.shutterMat || m.mat`.
- **L0 cabinet master** (`:3059-3062`): Main Group `Carcass`, Sub Group `Carcass`, Item `m.code`, SKU `m.code + skuSuffix`, dims `H/W/D/t`, CF Type `` `${zoneName} ${m.sn}` ``, `SO Qty = Actual = q`, `_type = "master"`, and **`stockMap` is passed as `{}`** so masters never show stock.
- Lookups `panelsByPack` / `profilesByPack` / `consByPack` and the prefix-matching finders `findPanelsForPk` / `findProfilesForPk` / `findConsForPk` (`:3070-3100`) — panel `pack` strings carry dimension suffixes that `pkRow` names lack, hence the `startsWith` fallback.
- **L1 pkRows loop** (`:3103-3406`): skips `shut`/`hard`/`cons` (handled separately). Emits the pack row, then:
  - **Drawer Pack special-case** (`:3121-3185`): `dCount = getDrawerCount(name, m.panels) || 1`; `qN = q * dCount`. Children carry `perDrawerQty = +(p.qty / dCount).toFixed(3)` as SO Qty but `pActual = +(p.qty * q).toFixed(3)` as Actual. `DBC` profiles go through `addProfilePanelAndRawRow` directly (flat); everything else through `buildProfileBomRows` with `qN`. Hardware whose `pack === name` is nested at L2. Then `return`.
  - **`pkType === "panel"`** (`:3187-3352`): each panel → drilled/undrilled × combined-side / combined-dir / single, exactly mirroring `explodePanelForTree` but emitting rows (Part Cab at L2, `addPanelRow` at L3; undrilled → `addPanelRow` at L2). Then profiles of this pack grouped by `type` → `buildProfileBomRows`, then consumables of this pack at L2.
  - **`pkType === "prof"`** (`:3354-3379`): profiles grouped by type → `buildProfileBomRows`.
  - **`pkType === "elen_bom"`** (`:3384-3406`): `elenCutLen` = the `ELEN` profile's len; profile → `addLightCutRow(..., ELENOR_WASTE)`; each linear consumable (`/\bLED\b|DIFFUSER/i`) → **`addLightCutRow(..., elenCutLen, pieceQty = 2, ..., ELENOR_WASTE)`** — deliberately **2 cut pieces of the Elenor length, NOT one double-length cut**; tape/wire stay flat L2 consumables; Elenor hardware nested at L2.
- **Orphan detection** (`:3409-3421`): panels/profiles/cons/hardware whose `pack` matches no pkRow name are emitted one level shallower (L1/L2 instead of L2/L3). `isMatchedHardware` treats anything under `Drawer Pack- Cab Drawer Box` or `Elenor with Light` as already nested.
- **L1 flat hardware** (`:3553-3561`) → `addHardwareRow`; **L1 flat consumables** (`:3564-3572`).
- **L1 glass shelf** (`:3575-3582`): `m.glassShelf` → a **direct Raw Material row** (finish `"CLEAR"`, CF Type `"Glass Shelf"`), not a BOM.
- **Shutter sub-tree** (`:3585-3660`), per shutter:
  ```
  isGlassShutter = isGlassShutterFam(m.fk) && s.kind !== "fixed"
  glassColor = m.shutterMat || "CLEAR"
  shFinish   = s.kind === "fixed" ? (m.fixedPanelMat || m.shutterMat || m.mat) : sFinish
  shThkVal   = shThkOf(s.design, isGlassShutter)     // display thickness
  shStoneThk = shThkOf(s.design, false)              // stone thickness
  ```
  - L1 `Shutter / Shutter` master = `s.code`, CF Type `` `${s.kind} ${s.design}` ``.
  - L2 **`Parts- SH ${s.pw}x${s.ph} ${s.design}`** — present for **all** shutters; Panel/Glass + Set of Profile + Corner Connector reparent under it; only the hinge pack stays a direct child of the shutter.
  - L3 face: glass → a direct Raw Material `GLASS TOUGH EP ${s.pw}X${s.ph}X5 ${glassColor} SKV`; stone → `addPanelRow` with `Panels- SH ${s.pw}x${s.ph}x${shStoneThk} ${s.design}`.
  - L3+ profiles: `buildProfileBomRows(so, s.design, shProfFinish, [{len: s.profV, qty: 2, name: \`Profile LH/RH (${s.design})\`}, {len: s.profH, qty: 2, name: \`Profile TP/BT (${s.design})\`}], …, shutterVD)` then **`r.Level += 1`** on every returned row (the builder emits sets at L2; they must sit at L3 under `Parts- SH`).
  - L3 corner connector = `shutterCornerName(m.fk, s.kind)`.
  - L2 hinge pack (if `s.hinge`) qty `s.hq || 1`.
- **Elevation stamping** (`:3663-3664`): every row produced for the line gets `Elevation = l.elevation || ""`.

**Fillers (`:3668-3737`):**
```
finish = f.customShade || getDefaultShutterShadeForZone(zone)
H = f.customHeight ? parseFloat||0 : getDefaultShutterHeightForZone(zone)
W = f.customWidth  ? parseFloat||0 : 80
fCode = `SH-Filler-${ZONE}-${H}x${W}`
```
L0 master `Panels- SH Filler ${H}x${W}x6` (SKU `SH-Filler-${ZONE}-${H}x${W}-${q}` + suffix) → L1 `fCode` → L2 `Panels- SH ${W}x${H}x6 Plain` (via `addPanelRow`) + L2 Raw `HM-504` profile (`ALU FILLER PROFILE HM-504 SIZE 76X8.2 WITH ANODISED ${COLOR} 3 MTR W 0.75 KG/MTR MINA` fallback, `rawSoQty = H/1000` mtr, **waste 0**) + L2 silicone `+(H/1000 * 15).toFixed(3)` **ml** (15 mL per metre). All rows stamped with `f.elevation`.

**Visible Panels (`:3740-3846`):**
```
W  = vp.customWidth ? parseFloat||0 : (getDefaultCabinetDepthForZone(zone) + 25)
pw = W - 5 ; ph = H - 5
mainProfile = vp.profile.includes("MD3") ? "MD3" : "MD1"     // everything else collapses to MD1
vpThk = shThkOf(mainProfile, false)                          // 9 for MD3, else 6
```
L0 `Panels- SH Visible ${H}x${W}x6` → L1 `SH-Visible-${ZONE}-${H}x${W}` → L2 `Parts- SH ${pw}x${ph} ${mainProfile}` → L3 panel + L3+ profiles (`len H`/`len W`, qty 2 each, `Level += 1`) + L3 `CORNER CONNECTOR FOR STONE 70X70X2 MAR`. If `vp.profile.includes("CM")` an **extra `CM1` profile set** of the same lengths is added.

**Backsplash (`:3852-3888`):**
```
q = max(1, b.qty) ; T = parseFloat(b.thickness) || 15 ; areaSqft = sqft(W, H)
masterItem = `Back Splash ${T}mm ${W}x${H}` ; masterSku = `BS-${W}x${H}x${T}-${q}` + skuSuffix
subCode    = `BS-${W}x${H}x${T}`
L2 panel   = `Panels- BS Stone ${T}mm ${W}x${H}`
L2 glue    = GLUE LATRICATE SUPER FLEX 20KG XX WHITE 335 AGG, soQ = +(1.25 * areaSqft).toFixed(3) kg
```

**Countertop** — see §13.

### Helper functions used by `buildFullBomData`

| Function | Line | Rule |
|---|---|---|
| `extractSideType(name)` | `:2393-2406` | First `LH(..)+RH(..)` / `TP(..)+BT(..)` bracket form wins; else `LH/RH`, `TP/BT`, `LH`, `RH`, `TP`, `BT`; else `"-"`. |
| `extractProfileCode(itemName)` | `:2408-2430` | Upper-cased substring scan in fixed order: SLF/HM-511/HM511 → `SLF`; STP/HM-509 → `STP`; SINK/HM-510 → `SINK`; ELEN/HM-519 → `ELEN`; DBS/HM-513 → `DBS`; DBC/HM-535 → `DBC`; MD1/MD2/MD3/CL1/CL2/CM1/CM2/NEON. Fallback: the 3 chars before the **last** `-` (only if `lastDash >= 3`), else `""`. |
| `parseSlabArea(itemName)` | `:2432-2440` | `/(\d{3,4})\s*[xX]\s*(\d{3,4})/` → `(h * w) / (304.8 * 304.8)` sqft; no match → `0`. |
| `getRawMaterialNameAndSku(key, selectedRawIds, rawOptionsMap, fallbackName)` | `:2442-2463` | No selection → `{fallbackName, "-", 0}`. `MOCK_CREATE\|<name>` → `{name: split("\|")[1], "-", 0}`. Else find by `item_id` or `sku` in `rawOptionsMap[key]` → `{name, sku, stock_on_hand}`; not found → `{name: selectedId, "-", 0}`. |
| `classifyRowType(pkType)` | `:2465-2472` | `panel`→`sub_bom`, `prof`→`component`, `hard`/`cons`→`plain`, `shut`→`sub_bom`, `elen_bom`→`sub_bom`, default `plain`. Drives `ROW_TYPE_FILLS` (`:2332-2337`: master `FFF1DD`, sub_bom `EEF4FB`, component `D6EAF8`, plain `F3F0FC`). |
| `extractDim(dim)` | `:2474-2477` | Strip everything but `0-9 x × - .`, split on `[xX×]` → `{h: [0], w: [1], d: "", t: [2]}`. **`d` is always empty.** |
| `subGroupFromPkType(pkType, isShutter)` | `:2479-2490` | `isShutter`→`Shutter`; `panel`→`Carcass Pack`; `prof`→**`Profile Pack`** (deliberately *not* `Profile`, so the Opti sheet doesn't double-count the wrapper alongside real cuts); `hard`→`Hardware`; `cons`→`Consumable`; `elen_bom`→`Elenor Light`; default `Carcass`. |
| `makeRow(...)` | `:2492-2535` | See below. |
| `addPanelRow(...)` | `:2537-2600` | See below. |
| `addProfilePanelAndRawRow(...)` | `:2602-2652` | See below. |
| `addLightCutRow(...)` | `:2658-2683` | See below. |
| `addHardwareRow(...)` | `:2685-2728` | Emits the pack row, then — if `HARDWARE_PACK_DEFINITIONS[itemName]` exists (`:5334+`) — one L+1 `Hardware` component row per definition entry with `compSoQty = +(comp.qty * soQty).toFixed(3)` and `compActualQty = +(comp.qty * actualQty).toFixed(3)`. |
| `buildProfileBomRows(...)` | `:2730-3013` | See below. |
| `getDrawerCount(packName, panels)` | `:3015-3028` | For `Pullout Shelf` packs, search `packName.replace("Drawer Pack-","Set of Parts-")` and return the "base" panel's qty (default **4**). Otherwise return the qty of the panel whose name contains "back" (default **1**). |

#### `makeRow(so, mainGroup, subGroup, level, item, sku, type, h, w, d, t, finish, cfType, soQty, waste, actualQty, unit, stockMap, _type, profileCode = "")`
**`:2492-2535`** → `FullBomRow`
```
stock    = stockMap[item.trim()]?.stock ?? 0
effStock = stock
deficit  = Math.max(0, actualQty - effStock)
status   = stockMap[item.trim()] ? (deficit <= 0 ? "In Stock" : "Out of Stock") : "Unknown"
```
**Pcs (slab count)** — only for stone-ish rows:
```
isStone = item.toLowerCase().includes("stone")
       || subGroup.toLowerCase().includes("stone")
       || mainGroup.toLowerCase().includes("stone")
Pcs = isStone ? (parseSlabArea(item) > 0 ? Math.round((actualQty / slabArea) * 100) / 100 : "") : "-"
```
`Profile Code = profileCode || (subGroup.toLowerCase().includes("profile") ? extractProfileCode(item) : "")`.
**Hardware Pack override:** if `item.trim().toLowerCase().includes("hardware pack")` → `Sub Group = "Hardware Pack"` regardless of what was passed.
`Item` is **indented**: `"  ".repeat(level) + item` — always `.trim()` it before matching.
`Type` ignores the `type` argument and is computed as `extractSideType(item)`.

#### `addPanelRow(..., carcassT?)`
**`:2537-2600`**
Pushes the panel row, then **its raw-stone child at `level + 1`**:
```
rawKey   = mainGroup === "Carcass" ? `carcass|${finish}|${carcassT || t}` : `shutter|${finish}|${t || "6"}`
rawWaste = mainGroup === "Carcass" ? 17 : 0          // ← 17% carcass, 0% shutter
netSqft      = (parseFloat(h)||0) * (parseFloat(w)||0) / (304.8*304.8)
rawSoQty     = +(netSqft * soQty).toFixed(3)
rawActualQty = +(netSqft * actualQty * (1 + rawWaste/100)).toFixed(3)
```
Row: Sub Group `Raw Material`, Type `-`, Unit `sqft`, CF Type = the parent panel's item name, `_type = "plain"`.
**Critical rule (`:2589-2591`):** raw stone scales with the panel's **total `actualQty`**, not the per-parent `soQty` — otherwise drawer-pack panels (per-drawer qty 1, total = drawer count) and multi-unit projects under-count stone.
Fallback name: `` `Raw Material ${finish}` ``.

#### `addProfilePanelAndRawRow(so, parentGroup, level, pPanelName, skuSuffix, len, qty, finish, parentRef, stockMap, profileCode, selectedRawIds, rawOptionsMap, q, items)`
**`:2602-2652`**
- Panel row: Sub Group `Profile`, Height `= String(len)`, `SO Qty = qty`, `Waste % = 0`, `Actual = +(qty * q).toFixed(3)`, Unit `pcs`, `_type = "component"`.
- Raw row at `level + 1`:
  ```
  profileKey    = `${parentGroup === "Carcass" ? "carcass" : "shutter"}|${profileCode}|${finish}`
  defaultFallback = profileCode === "HM-504"
      ? `ALU FILLER PROFILE HM-504 SIZE 76X8.2 WITH ANODISED ${FINISH} 3 MTR W 0.75 KG/MTR MINA`
      : `Raw Profile ${profileCode} ${finish}`
  rawSoQty      = +(len/1000 * qty).toFixed(3)                       // mtr
  profileWaste  = profileCode.toUpperCase() === "ELEN" ? 20 : 25     // ← 25% here, not PROFILE_WASTE
  rawActualQty  = +(rawSoQty * (1 + profileWaste/100) * q).toFixed(3)
  ```
  Sub Group `Raw Material`, Unit `mtr`, `_type = "plain"`.

#### `addLightCutRow(so, parentGroup, level, rawName, cutLabel, len, pieceQty, finish, parentRef, stockMap, items, q, waste = 0)`
**`:2658-2683`**
Emits a **cut piece over a raw 3-mtr stock child** — the cut lands in the Opti sheet, the raw child (Sub Group `Raw Material`) is excluded from it.
```
cutName      = `${cutLabel} Cut ${len}mm`                    // L: Sub Group "Profile", Unit "Pcs", _type "component"
rawSoQty     = +(len/1000 * pieceQty).toFixed(3)
rawActualQty = +(rawSoQty * (1 + waste) * q).toFixed(3)      // ← `waste` is a FRACTION here (0.10), not a percent
                                                             //    but the row's "Waste %" column stores waste*100
```
Used by the Elenor composite (`waste = ELENOR_WASTE`) and the countertop band light (`waste = 0`).

#### `buildProfileBomRows(so, profileCode, finish, lengths, skuSuffix, stockMap, parentGroup, subGroup, q, parentName, selectedRawIds, rawOptionsMap, vDrill?)`
**`:2730-3013`** → `FullBomRow[]`
```
noDrill = NO_DRILL_PROFILES.has(profileCode.toUpperCase())    // Set(["STP","ELEN","SLF","SINK"]) at :5141
lhTag = vDrill ? `(${vDrill.lh})` : "" ;  rhTag = vDrill ? `(${vDrill.rh})` : ""
vSideLabel = vDrill ? `LH${lhTag}+RH${rhTag}` : "(LH/RH)"
```
Classification per length (`:2758-2759`):
- vertical: `/(^|\s|\()(V|vertical|LH[+/]RH|LH|RH|ELEN)(\s|\)|$)/i`
- horizontal: `/(^|\s|\()(H|horizontal|TP[+/]BT|TP|BT|edge)(\s|\)|$)/i`

Panel name: `` `${cleanedNameForPanel} ${len}mm ${finish}` `` where `cleanedNameForPanel` strips `V|H|Top|Bottom|vertical|horizontal|edge` and normalises `LH+RH`→`LH/RH`, `TP+BT`→`TP/BT`.

- **`noDrill` path:** the Panel goes straight under the `Set of Profile` (L2) with no Part wrapper (`addProfilePanelAndRawRow` at L3). Sets are named `Set of Profile ${profileCode} ${finish} ${vSideLabel}` / `… (TP/BT)` / `… ${finish}` (other). If **more than one** sub-set exists, a **parent set** `Set of Profile ${profileCode} ${finish} ${vDrill ? \`${vSideLabel}+TP/BT\` : "LH/RH+TP/BT"}` is emitted at L2 and the sub-sets are re-levelled to L3 (their panels to L4, raw children to `lastPanelLevel + 1`).
- **Drill path:** each length becomes a `Part Profile …` wrapper at L3 (Sub Group `Profile - Part`, `_type = "sub_bom"`) with the Panel at L4. When `qty === 2` and the length is vertical → **split into LH/RH parts** (`Part Profile LH${lhTag} …` / `Part Profile RH${rhTag} …`, qty 1 each); horizontal → **Top/Bottom parts** (`Part Profile Top …` / `Part Profile Bottom …`). Otherwise one `Part Profile …` at the given qty. Sets are named `Set of Profile Parts ${profileCode} ${finish} ${vSideLabel}` / `… (TP/BT)` / `… ${finish}` — **no** combined parent set in this path.
All set rows carry Sub Group `Profile Pack`, `_type = "sub_bom"`, Unit `set`.

---

## 15. `buildOosData(fullBom)`

**`:3980-4027`** — `(fullBom: FullBomRow[]) => OosRow[]`
Purpose: the Out-Of-Stock / purchase sheet.
1. Filter: `r._type !== "master" && r.Deficit > 0` — **masters excluded, only rows with a real shortfall**.
2. Dedup key: `r.SKU || r.Item.trim()`.
3. First occurrence seeds the row (`Item` is `.trim()`-ed to drop the level indent; `Pcs` is forced to `"-"`; `_soSet` collects SO numbers).
4. Subsequent hits: `SO Qty += `, `Actual Qty += `, and **`Deficit = Math.max(0, Actual Qty - In Stock)`** recomputed from the *first* row's `In Stock` (stock is not re-summed).
5. Output preserves first-seen order; `SO` becomes `Array.from(_soSet).join(", ")`.

## 16. `buildOptiData(oosRows)`

**`:4029-4050`**
`OPTI_GROUPS = ["profile", "panels- sh", "panels- cab"]`; filter is an **exact** lowercase `Sub Group` equality (so `Profile Pack`, `Profile - Part` and `Raw Material` are all excluded — only real cut pieces survive).
Mapping: `SO`, `Main Group`, `Group ← Sub Group`, `Item Name ← SKU || Item`, `Profile Code ← r["Profile Code"] || extractProfileCode(r.Item)`, `Type ← CF Type`, **`Length ← Height`**, `Width`, **`Min Q. ← Deficit || 0`**, `Thickness`, `Grain: ""`, `Finish`.

## 17. `buildRawRows(m)`

**`:2256-2280`** — `(m: CarcassModel) => Array<{item, pack, uom, qty}>`
Flat per-model list:
- panels → `{item: p.name, pack: p.pack, uom: "Pcs", qty: p.qty}`
- profiles → `{item: \`${p.name} ${p.len}mm\`, …, uom: "Pcs"}`
- hardware → `{item: h.name, pack: h.pack || h.name, uom: h.uom || "Set"}`
- cons → `{item: c.name, pack: c.pack || "Consumable", uom: c.uom}`
- `m.glassShelf` → `{pack: "Glass Shelf", uom: "Pcs"}`
- per shutter: face (`GLASS TOUGH EP ${pw}X${ph}X5 ${m.shutterMat || "CLEAR"} SKV` for glass non-fixed, else `Panels- SH ${pw}x${ph}x${shThkOf(s.design,false)} ${s.design}`), `Profile LH/RH (${design}) ${profV}mm` ×2, `Profile TP/BT (${design}) ${profH}mm` ×2, `shutterCornerName(m.fk, s.kind)` ×1, and `s.hinge` ×`s.hq || 1` if set.

## 18. `buildCSV(project)`

**`:2282-2309`** — `(project: ProjectLine[]) => string`
Aggregation key: `` `${code}||${item}||${pack}||${uom}` ``; `qty += r.qty * l.qty`. Insertion order preserved via an `order[]` array.
Escaping: `/[",\n]/` → wrap in `"` and double inner `"`.
Header: `SN,Item Name,Pack Name,Cabinet Code,UoM,Qty`. Qty is emitted as an integer when `Number.isInteger`, else `+qty.toFixed(3)`.

## 19. `calcBoxDimension(dims, isSet)`

**`:4218-4232`** — `(dims: string, isSet: boolean) => string`
```
triple = dims.match(/(\d+)[x×](\d+)[x×](\d+)/i)    // no match → ""
w = parseInt(triple[1]) ; h = parseInt(triple[2]) ; t = parseInt(triple[3])
padding   = 20
thickness = isSet ? t*2 + padding : t + padding
return `${w + padding}x${h + padding}x${thickness}`
```
Plain language: packing-carton size = the piece + 20 mm on width and height; thickness gets 20 mm plus **double** the material thickness when the carton holds a *set* (two pieces, e.g. LH+RH).
Companion: `extractDimension(itemName)` (`:4208-4216`) — tries `(\d+x\d+)-?\s*(\d+x\d+x\d+)` → `"AxB - CxDxE"`, then `(\d+x\d+x\d+)`, then `(\d+x\d+)`, else `""`.

## 20. `parseCabinetCodeToModel(code, currentDesign = "MD1", overrides?)`

**`:4829-4924`** — `(code, currentDesign, overrides?: {carcassMat?, shutterMat?, profileColor?}) => CarcassModel | null`
Purpose: reverse a cabinet code back into a live model (used by the Designer Excel upload and QR/BOM pages). Whole body is wrapped in `try/catch` → `console.warn` + `null`.

Steps:
1. `cleanCode = code.split("-SO-")[0].trim()`; `parts = cleanCode.split("-")`; **`parts.length < 11` → `null`**.
2. Positional: `zk=[0]`, `p2=[1]`, `handleToken=[2]`, `matToken=[3]`, `p3=[4]`, `p4=[5]`, `p5=[6]`, `W=[7]`, `H=[8]`, `D=[9]`, `t=[10]`. Unknown `zk` → `null`. Any `NaN` in W/H/D/t → `null`.
3. **Family resolution:** candidates = families in `famSetOf(zk)` with `f.p2 === p2`. None → `null`. If >1, disambiguate by `isGlassShutterFam(k) === (matToken === "GL")`; if that still isn't unique, filter by a variant whose `p3` matches; fall back to the glass-filtered set, else the raw candidates. `fk = candidates[0]`.
4. **Variant resolution:** `isDouble = [p3,p4,p5].includes("2HS")`. `isDoubleVar(v) = v.both || v.double || /double|dbl/i.test(v.id + v.label)`. Double → first double variant; else the first non-double variant whose `p3` matches, else the first non-double variant, else `variants[0]`.
5. `hand = [p4,p5].includes("RHS") ? "RHS" : "LHS"`; `handle = handleToken === "CJ" ? "XCJ" : "STD"`.
6. **Finish suffix** `matPart = parts.slice(11).join("-")`, defaults `carcassMat = shutterMat = "STATUARIO"`:
   - contains `/` → split on `/` → `[carcassMat, shutterMat]`
   - else split on `-`: `>= 2` segments → `carcassMat = segs[0]`, `shutterMat = segs.slice(1).join("-")`; else both = `matPart`.
   > ⚠️ Finishes are space-delimited in the codes, so a single multi-word finish is safe; but a hyphenated single finish would be mis-split.
7. `overrides.carcassMat` / `overrides.shutterMat` win; `profCol = overrides?.profileColor || "CHAMPAGNE"` is used for **both** carcass and shutter profile colours.
8. Returns `buildModel(zk, fk, variantObj, handle, currentDesign, carcassMat, shutterMat, profCol, profCol, W, H, D, t, hand)` — note `drawerModel`/`inbuiltDrawers`/`tipOn` fall back to defaults, so **inbuilt-drawer selections are NOT round-trippable through the code**.

---

## 21. The raw-material aggregation `useMemo`

**`:7252-7509`** — deps `[activeItems, design, fillers, visiblePanels, backsplashes, countertops, otherAccRows]`
Returns `{ stones: AggregatedStone[], profiles: AggregatedProfile[], hardware: AggregatedHardware[] }` (types at `:4806-4827`). This drives the raw-material picker dropdowns and the summary panel. **Keys here must match the `rawKey`/`profileKey` built in `addPanelRow`/`addProfilePanelAndRawRow`.**

Per project line `{qty, m}`:
1. **Carcass stone** — key `` `carcass|${m.carcassMat || m.mat || "STATUARIO"}|${m.t || 15}` ``; `netSqft += m.netSqft * qty`.
2. **Shutter stone** — per shutter, **skipped entirely for glass faces** (`isGlassShutterFam(m.fk) && s.kind !== "fixed"`). Fixed panels in glass families use `m.fixedPanelMat || m.shutterMat || m.mat`. Key `` `shutter|${sFinish}|${shThkOf(s.design, false)}` ``; `netSqft += sqft(s.pw, s.ph) * qty`.
3. **Carcass profiles** — key `` `carcass|${p.type}|${m.carcassProfileColor || "CHAMPAGNE"}` ``; `lenMeters += (p.len * p.qty / 1000) * qty`. Profiles with no `type` are skipped.
4. **Shutter profiles** — grouped **per shutter design** (so a fixed MD1 dummy gets its own selection alongside glass NEON20 doors). Key `` `shutter|${s.design || design || "MD1"}|${m.shutterProfileColor || "CHAMPAGNE"}` ``; `lenMeters += ((2*s.profV + 2*s.profH) / 1000) * qty`.
5. **Hardware** — if `HARDWARE_PACK_DEFINITIONS[h.name]` exists, the pack is **exploded into components**: key `hw|${comp.component}`, `totalQty += comp.qty * h.qty * qty`. Otherwise key `hw|${h.name}`, `totalQty += h.qty * qty`.
6. **Consumables** — key `hw|${c.name}`, `totalQty += c.qty * qty`.

Then the non-cabinet sections:
- **Fillers** (`:7362-7392`): stone `shutter|${finish}|6` += `sqft(W, H) * q`; profile `shutter|HM-504|${profColour}` += `(H/1000) * q`; consumable `hw|GLUE SILICONE…` += `(H/1000) * 15 * q`.
- **Visible Panels** (`:7395-7431`): stone `shutter|${finish}|${shThkOf(mainProfile,false)}` += `sqft(W-5, H-5) * q`; profile `shutter|${mainProfile}|${col}` += `((2*H + 2*W)/1000) * q`; if `vp.profile.includes("CM")` an extra `shutter|CM1|${col}` of the same length.
- **Backsplash** (`:7435-7449`): stone `shutter|${color}|${T}` += `sqft(W,H) * q`; `hw|GLUE LATRICATE SUPER FLEX 20KG XX WHITE 335 AGG|kg` += `1.25 * areaSqft * q`.
- **Countertop** (`:7453-7497`) — **mirrors the BOM build exactly; `ctGeom` is the single source of truth**:
  ```
  colorArea = sqft(geom.topL, geom.topD)          // top slab incl. folds & 100mm reductions
  deadArea  = sqft(geom.baseL, geom.baseD)
  pasteArea = sqft(L, D)                          // ← raw L×D, matching emitCons(subCode, areaSqft, 2)
  for p of geom.panels:
      if dropdown: visH = p.wid + dropIssue
                   colorArea += sqft(p.len, visH)
                   deadArea  += sqft(p.len, max(0, p.wid - 100)) * (p.deadQty || 1)
                   pasteArea += sqft(p.len, visH)
      else:        colorArea += sqft(p.len, p.wid)
  stones[`shutter|${color}|${pt}`]      += colorArea * q
  stones[`shutter|DEAD STOCK|${pt}`]    += deadArea  * q
  hw AKEMI 5010 …        (gram) += 10 * pasteArea * q
  hw GLUE BONDTITE …     (gram) += 10 * pasteArea * q
  hw GLUE SILICONE …     (ml)   += 40 * pasteArea * q
  ```
- **Other Accessories** (chimney/dishwasher panels, `:7500-7506`): stone `shutter|${row.color}|6` += `sqft(row.width, row.height) * q`.

---

## 22. `src/lib/rawmaterial.ts` — Zoho search & resolution

### `searchStoneItems(finish, stoneThickness, excludeStoneId?)`
**`src/lib/rawmaterial.ts:604-693`** — `Promise<ItemDetail[]>`
Purpose: find candidate stone slabs in Zoho for a `finish`+`thickness` bucket.

**`isStoneItem(item)`** (`:608-616`): not a composite; not `excludeStoneId`; and `cf_group` **or** `group_name` **or** `name` contains `"stone"` (case-insensitive).

**`thicknessFromName(raw)`** (`:621-628`) — **thickness-from-name** rule (cf fields are often blank on slabs):
1. `/\d+\s*[X×]\s*\d+\s*[X×]\s*(\d{1,2})\s*(?:MM)?\b/` → the **last** dimension of W×H×T (e.g. `2800X1200X15` → 15).
2. else `/\b(\d{1,2})\s*MM\b/` → a small `NNMM` token (e.g. `06MM` → 6).
3. else `0`.
The `{1,2}` digit cap is deliberate: it makes large dimensions like `2800MM` **not** match.

**Finish matching — two tiers:**
- **EXACT** (`:634-638`): `(cf_finish && (cf.includes(finishLower) || finishLower.includes(cf))) || name.includes(finishLower)`.
- **CORE — colour-qualifier-optional** (`:642-648`): `coreTokens` = the requested finish's words **minus** anything in `STONE_COLOR_QUALIFIERS` (`:599-602`: `black, white, grey, gray, beige, cream, brown, gold, golden, silver, ivory, green, blue, red, pink, sand, taupe, charcoal, dark, light`). A candidate matches if **every** core token appears in `cf_finish + " " + name`. This lets `"BLACK STATUARIO NUVOLATO"` match a slab catalogued as `"STATUARIO NUVOLATO"`. If `coreTokens` is empty (the finish is *only* qualifiers) it falls back to EXACT.

**Thickness gate** (`:649-651`): `thicknessOf(item) = parseFloat(cf_thickness) || thicknessFromName(name)`; `thickOk = targetThickness === 0 || thicknessOf(item) === targetThickness` (**strict equality**, no tolerance).

**Ranking** (`:654-659`): exact-finish + thickness first, then core-finish + thickness (deduped by `item_id`).

**Query loop** (`:661-683`): tries `` [`STONE ${stoneThickness}`, finish, "STONE"] `` in order against `/api/zoho/items?search=…`, accumulating de-duplicated candidates; **returns as soon as `ranked()` is non-empty**.
Edge cases: if **all** queries threw → rethrows the last error (callers can distinguish "network/auth failure" from "no results"). Otherwise the last resort (`:686`) returns **core-finish matches of any thickness** (the UI shows a warning).

### `searchProfileItems(finish, profileCode)`
**`src/lib/rawmaterial.ts:768-858`** — `Promise<ItemDetail[]>`
1. `baseAliases = PROFILE_CODE_EQUIVALENCES[code] || [code]` (`:688-711`): `hm509↔stp`, `hm511↔slf`, `hm510↔sink`, `hm519↔elen`, `hm513↔dbs`, `hm535↔dbc`, `md1cm1→[md1cm1, cm1]`, `md1cm2→[md1cm2, cm2]`, `md2cm1→[md2cm1, cm1]`, `md2cm2→[md2cm2, cm2]`.
2. For any alias matching `/^hm-?\d+$/`, **both** hyphenated and non-hyphenated forms are added (`hm511` **and** `hm-511`).
3. `searchTerms = unique([...searchAliases, finish.trim()])`; all fetched **concurrently**; an error only propagates if **every** term failed (`errorCount === searchTerms.length`).
4. De-duplicate by `item_id`.
5. **Primary filter:** `!isComposite` **and** `matchProfile` (`cf_profile_code` **or** `name` **or** `sku` contains any alias) **and** `matchFinish` (`cf_finish` **or** `name` contains the finish).
6. **Fallback 1** (`:840-847`): drop the finish requirement — match the code in `name`/`sku` only (`cf_finish` is often missing).
7. **Fallback 2** (`:850-857`): `getDefaultProfileName(profileCode, finish)` → a **mock item** `{ item_id: \`MOCK_CREATE|${defaultName}\`, name: \`${defaultName} (Not in Zoho - Will Create)\`, sku: defaultName, stock_on_hand: 0 }` so the UI can offer creation. Consumed by `getRawMaterialNameAndSku`'s `MOCK_CREATE|` branch.
8. Else `[]`.

**`getDefaultProfileName(profileCode, finish)`** (`:743-766`): look up `DEFAULT_PROFILE_NAMES` (`:713-741` — exact Zoho names for `elen/hm519, stp/hm509, slf/hm511, sink/hm510, dbs/hm513, dbc/hm535, skirting, duplay, lprofile, grand, md1, md2, cl1, cl2, cm1, cm2, neon20`), falling back through the alias list. Then colour substitution: if `finish.toUpperCase() !== "CHAMPAGNE"` — when the finish contains `WITHOUT`/`W/OUT`/`UNANODISED`, replace the substring **`"ANODISED CHAMPAGNE"`** with it; otherwise replace just **`"CHAMPAGNE"`**. Returns `null` if the code is unknown.

### `searchHardwareItems(name)`
**`src/lib/rawmaterial.ts:860-865`** — one `/api/zoho/items?search=<name>` call, filtered to `!isComposite(item)`. No finish/thickness logic.

### `resolveRawMaterials(orders, itemsCache, compositesCache)`
**`src/lib/rawmaterial.ts:448-587`** — `Promise<RawMaterialSelection>` = `{ stoneGroups, profileGroups }`
Purpose: walk real Zoho sales orders, group every carcass/shutter composite into stone buckets and every profile composite into profile buckets, and pre-resolve a default raw item per bucket.

Per line item (`itemId = li.composite_item_id || li.item_id`, `soQty = li.quantity ?? 1`):
- **`category = isComposite(item) ? getCarcassCategory(item) : null`** — `getCarcassCategory` (`:126-136`) reads `cf_group`/`cf_sub_group`: contains `"shutter"` → `"shutter"`; contains `"carcass"` → `"carcass"`; else `null` (skipped).
- `chain = await findStoneInBomChain(itemId, soQty, …)` (`:240-334`) — DFS to depth 6, **skipping hardware composites** (`isHardwareComposite`, `:209-219`), recursing into non-hardware composite children first; at the deepest level, **only `isPanelGroupMatch` composites qualify** (`:174-188`: name starts with `panel `/`panels-`/`panels ` — but **not** `part ` — or `cf_group`/`group_name` fuzzy-matches `PANEL_GROUPS = ["panels- sh strip", "panels- sh", "panels- cab"]`). The **first non-composite, non-hardware child** is the stone. Returns waste (`cf_waste_percentage`), dims (`cf_height`/`cf_width`) and `stoneThickness = cf_thickness` **of the Panel**.
- `panels = await findAllStonesInBomChain(...)` (`:345-406`) — same walk but collects **every** panel (one stone per panel composite, `break` after the first qualifying child).
- **Total sqft:**
  ```
  if panels.length > 0:  totalSqft = Σ panel.quantity * (1 + panel.wastePercent/100)
  else (fallback):       totalSqft = ((cf_height * cf_width * (1 + cf_waste_percentage/100)) / (304.8*304.8)) * soQty
  ```
  ⚠️ In the primary branch `panel.quantity` is treated as if it were already sqft — the dimensions are not applied. This is existing behaviour.
- **Thickness:** `category === "carcass"` → the carcass item's own `cf_thickness`; `"shutter"` → `chain?.stoneThickness || cf_thickness` (the **panel's** thickness).
- **Group key:** `` `${category}|${finish}|${thickness}`.toLowerCase() ``. Existing key → accumulate `totalSqft`, push `itemId`, append chain items. New key → `findDefaultStone(finish, thickness)` (`:412-446`: group contains `"stone"`, `cf_finish` fuzzy-matches both ways, `cf_thickness === target`; queries `` [`STONE ${thickness}`, finish, "STONE"] ``), and:
  ```
  defaultStoneSqft = parseFloat(cf_sqft) || ((cf_height * cf_width) / (304.8*304.8)), rounded to 2dp
  changed = !defaultStone      // ← a missing default makes the picker MANDATORY
  ```
- **Profile composites** (`:539-583`): gated on `isComposite(item) && isProfileItem(item)` (`:190-195`: `cf_group`/`cf_sub_group`/`name` contains `"profile"`).
  ```
  profileCode = extractProfileCode(name)        // :120-124 — 3 chars before the LAST "-", "" if lastDash < 3
  profileCategory = getCarcassCategory(item) || (name/cf_group/cf_sub_group contains "carcass" ? "carcass" : "shutter")
  key    = `${profileCategory}|${profileCode}|${finish}|${height}`.toLowerCase()
  length = (parseFloat(cf_height) || 0) * soQty * (1 + cf_waste_percentage/100)
  ```
  Existing key → `totalLength += length`. New key → seeded with `findStoneInBomChain`'s stone as the default profile.

---

## 23. `src/lib/stock.ts`

### `getStockStatus(actualQty, effectiveStock): StockStatus`
**`src/lib/stock.ts:92-96`**
```
if (effectiveStock <= 0 || effectiveStock < actualQty) return "out-of-stock";
if (effectiveStock < actualQty * 1.5)                  return "low-stock";
return "in-stock";
```
**The 1.5× rule:** stock is "low" when it covers the requirement but is **less than 1.5× it** — i.e. under a 50 % buffer. Zero/negative stock is always out-of-stock, even for a zero requirement.
Labels via `statusLabel` (`:107-109`) → `In Stock` / `Low Stock` / `Out of Stock` / `Unknown`.

### `getRawStock(item): number`
**`src/lib/stock.ts:75-90`**
Candidate order (**first numeric, non-NaN wins**):
1. `item.stocks[0].stock_on_hand`
2. `actual_available_stock`
3. `stock_on_hand`
4. `available_stock`
5. `quantity_available` (composite mapped items)
Default `0`. `null` item → `0`.

### `getCfValue(source, key)`
**`src/lib/stock.ts:23-56`**
Three-tier lookup: (1) a direct property `record[key]`; (2) `custom_field_hash[key]`; (3) scan `custom_fields[]` matching `api_name`/`placeholder`/`label` against the key **or** its lowercase form. Within a match, if `value` is `null`/`undefined`/`""`/`false`, fall back to `String(value_formatted).replace(/%/g,"").trim()` — this is how percentages get read. Returns `""` when nothing is found.

### `isComposite(item)` / `isService(item)`
**`:58-67` / `:69-73`** — composite when any of: `is_combo_product === true|"true"`, `item_type ∈ {composite, composite_item, group, bundle}`, `product_type === "composite"`, or a non-empty string `composite_item_id`. Service when `item_type`/`product_type`/`type` is `"service"`.

### `buildReportRowsForOrder(order, ctx): BomReportRow[]`
**`src/lib/stock.ts:140-205`**
Purpose: expand a Zoho sales order into a levelled report.
Per line (`itemId = line.item_id || line.composite_item_id`, skipped if absent):
- `lineIsComposite = isComposite(line) || isComposite(masterItem) || Boolean(composite)`.
- `soQty = Number(line.quantity ?? 1)`.
- **Group precedence:** the **line's** `cf_group` wins if it isn't `"__other__"`; else the master item's (`detectGroup`, `:116-119`: trim, empty → `"__other__"`).
- The L0 master row: `itemName = normalizePartOrPanelName(line.name ?? line.item_name ?? masterItem?.name ?? "-")`, `level 0`, `wastePercent 0`, `actualQuantity = soQty`, `effectiveStock = rawStock`, `deficit 0`, `status "unknown"`, `rowType/typeLabel = composite ? master/"PACK BOM" : plain/"ITEM"`.
- **Non-composite lines only** get a real status: `getStockStatus(soQty, rawStock)` and `deficit = max(0, soQty - rawStock)`. **Composite masters never consume stock** (their children do).
- Composite lines → `expandComposite(composite, soQty, 1, 0, cfGroup, itemId, masterRow.itemName, ctx)`.

### `expandComposite(...)` — the global-consumption engine
**`src/lib/stock.ts:207-305`**
Depth guard: `level > MAX_BOM_DEPTH (6)` → `[]` (`:13`).
Children come from the first non-null of `mapped_items ?? composite_item_line_items ?? bundle_items ?? line_items ?? items ?? []`. Services are skipped.
```
perUnit  = Number(child.quantity ?? child.quantity_needed ?? 1)
totalQty = perUnit * parentQty

ownWaste     = cf_waste_percentage of the child's master detail
displayWaste = childIsComposite ? 0 : (ownWaste > 0 ? ownWaste : parentWastePct)   // ← waste inherits down
actualQty    = childIsComposite ? totalQty : totalQty + totalQty * (displayWaste/100)
```
**Global consumption (`:246-249`) — the key cross-order rule:**
```
if (ctx.globalConsumed[childId] === undefined) ctx.globalConsumed[childId] = 0;
effective = Math.max(0, rawStock - ctx.globalConsumed[childId]);
ctx.globalConsumed[childId] += actualQty;
deficit   = Math.max(0, actualQty - effective);
status    = getStockStatus(actualQty, effective);
```
Plain language: a shared `ctx.globalConsumed` ledger is carried across **all** orders and all BOM branches. Each time an item is consumed, its available stock for every *later* row drops. **Order of traversal therefore determines who gets flagged short** — the first order to claim the stock keeps it. `globalConsumed` is keyed by `item_id`, never reset inside the walk; the caller owns its lifetime.
`underProfile = cf_group.includes("profile") || childName.includes("profile")` (both lowercase).
`rowType/typeLabel = childIsComposite ? sub_bom/"SUB-BOM" : component/"COMPONENT"`.
Recursion passes `ownWaste` (not `displayWaste`) as the next `parentWastePct`.

### Other exports
- `collectRequiredItemIds(orders)` (`:307-316`) — unique `item_id || composite_item_id` across all order lines.
- `collectMappedItemIds(composite)` (`:318-328`) — child ids from the same 5-way fallback chain.
- `annotateRowsForOrder(rows, order)` (`:330-337`) — stamps `sourceOrderId`, `sourceOrderNumber`, `customerName`, `orderDate` onto each row (immutably).
- `resolveSku(sku, name)` (`:121-124`) — `""` or `"-"` → the name.
- `groupLabel(key)` (`:111-114`) — `""`/`"__other__"` → `"Other"`.

---

## 24. `src/lib/naming.ts`

The canonical item-name normaliser. Zoho item names must match **byte-for-byte** across the builder, the dashboard and the reorder report — always go through these helpers.

### `splitDrillAndFinish(afterSizeStr)`
**`src/lib/naming.ts:1-34`** — `{ drill: string; finish: string }`
Splits the text *after* the size token into a drill prefix and a finish remainder. A word is a **drill word** iff (`isDrillWord`, `:6-14`):
- `LH`, `RH`, `LHS`, `RHS`, `/`
- `/^\d+S$/i` (e.g. `3S`), `/^\d+H$/i` (e.g. `4H`), `/^\d+HB$/i` (e.g. `2HB`)
- `JD`, `JD1`, `JD2`

Scanning is **left-to-right and one-way**: the first non-drill word flips `inFinish = true`, and **everything after it is finish**, even if it looks like a drill word.

### `normalizePartOrPanelName(name)`
**`src/lib/naming.ts:36-146`**
1. Collapse whitespace; `LH+RH` → `LH/RH`.
2. Strip a trailing SO suffix `/-SO-\d+(?:-\d+)?$/i` (remembered and re-appended at the very end).
3. Strip a trailing `-Project` or ` Project` (8 chars).
4. `isPart = /^(Part|Parts)\b/i`, `isPanel = /^(Panel|Panels)\b/i`. **If neither → return `cleanName + soSuffix`** unchanged.
5. Find the size token: `/\b\d+x\d+x\d+\b/` first, else `/\b\d+mm\b/`. **No size token → return the ORIGINAL `name`** (not `cleanName`).
6. Split into `beforeSize` / `afterSize`; `{drill, finish} = splitDrillAndFinish(afterSize)`.
7. **Prefix normalisation:** `isProfile = /\bProfile\b/i.test(beforeSize)`.
   - Part + profile → `Part Profile …`; Part + non-profile → **`Part - …`**
   - Panel + profile → `Panel Profile …`; Panel + non-profile → **`Panel - …`**
8. **Side extraction:** if `drill` starts with `LH`/`RH` (`/^(LH|RH)(?:\s+(.*))?$/i`) → that's the `side`, and `actualDrill` is the rest. Else, if `beforeSize` does **not** contain `LH/RH|LHS|RHS`, look for a standalone `LH`/`RH` in `beforeSize`.
9. **Output assembly:**
   - With a side: every `LH/RH|LH|RH|LHS|RHS` in the prefix is replaced by that side. Then:
     - Part **with** a real drill (not `"no drill"`) → `` `${prefixNoSide} ${side} ${actualDrill} ${sizeIndicator} ${finish}` `` — **note the drill sits before the size**.
     - Otherwise → `` `${prefix} ${sizeIndicator} ${finish}` ``.
   - Without a side:
     - Part **with** a real drill → `` `${prefix} ${sizeIndicator} ${actualDrill} ${finish}` `` — **drill after the size**.
     - Otherwise → `` `${prefix} ${sizeIndicator} ${finish}` ``.
   Whitespace is collapsed and the SO suffix re-appended in every branch.

### `getPartBaseName(pName, drill, finish)`
**`src/lib/naming.ts:148-152`** — strips a leading `Panels` from `pName`, builds `` `Part ${cleanPName} ${drill || ""} ${finish}` ``, and runs it through `normalizePartOrPanelName`.

### `getPanelBaseName(pName, drill, finish)`
**`src/lib/naming.ts:154-159`** — strips a leading `Panels`; if `drill` starts with `LH`/`RH`, that token becomes a `sidePrefix`; builds `` `Panel ${cleanPName} ${sidePrefix}${finish}` `` → `normalizePartOrPanelName`. **The drill itself is intentionally dropped** — this is why LH and RH parts share one common panel child in the BOM tree.

---

## 25. Security note

`src/components/AuthGate.tsx:27` contains a **hard-coded client-side password constant** compared as `if (password === "Factory@1234")`. This is shipped in the browser bundle and is trivially readable by anyone who loads the page — it is a gate against casual access only, **not** authentication. Any real authorization must move server-side (an API route + httpOnly session cookie, or a proper auth provider).

All Zoho credentials (client id / client secret / refresh token / organization id) must live in `.env` / `.env.local` and be read **only** in `src/app/api/**` server routes and `src/lib/zoho.ts`. Placeholders:
```
ZOHO_CLIENT_ID=<your Zoho OAuth client id>
ZOHO_CLIENT_SECRET=<your Zoho OAuth client secret>
ZOHO_REFRESH_TOKEN=<long-lived refresh token issued for the Inventory scope>
ZOHO_ORGANIZATION_ID=<numeric Zoho Inventory org id>
```
Never inline any of these into a `NEXT_PUBLIC_*` variable or a client component.
