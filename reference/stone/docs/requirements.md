# Magppie BOM Builder — Product Requirements

_Reverse-engineered from the running product (UI as source of truth), 2026-07. Sufficient to rebuild the product in any tech stack._

## What the product is

A factory/back-office web application for **Magppie** (stone modular kitchens) that turns a **kitchen cabinet configuration** into: a canonical **cabinet code**, **shutter codes**, a complete multi-level **Bill of Materials** (stone panels, aluminium profiles, hardware packs, consumables, operations), purchase-quantity roll-ups with waste, factory outputs (cutting/opti lists, packing lists, labels, QR codes), and **Zoho Inventory (India)** records — composite items and Sales-Order lines — created idempotently. Secondary surfaces: a multi-SO **BOM backorder dashboard**, a **re-order level report** with draft-PO creation, a **designer** page (choose shutter colours per price group against a Zoho SO), and a **planning** page (decode SO service lines into BOMs and replace them on the SO).

## Requirement classification & IDs

Every requirement is classified as **UJ** (User Journey), **BR** (Business Rule), **AC** (Acceptance Criteria), or **DC** (Design Constraint). IDs are unique **within each numbered section**; cite as `§<section>.<id>` (e.g. `§2 BR-D3`). File citations point at the reference implementation (`src/…` in the original Next.js/React codebase) purely as provenance — the requirement text itself is implementation-agnostic.

## Global constants (used throughout)

- Area: `sqft = (w_mm × h_mm) / 92903.04`
- Waste: stone **+15%**, profile **+20%**, Elenor profile **+10%**, drilled raw panels **+17%**
- Weight: carcass stone **3.45 kg/sqft**, shutter stone **1.38 kg/sqft** (net area)
- Panel thickness: carcass stone 15 mm; shutter face stone 6 mm; glass shutter 5 mm; glass shelf 8 mm
- Currency INR; Zoho data centre India; organization: MAGPPIE SILVERSTONE PRIVATE LIMITED

---


# Section 1 — Cabinet Configurator (/builder)

Scope: the "① Configure Unit" card, cabinet-code output, add-to-project row, and Project Lines list in `src/components/CarcassBomBuilder.tsx` (rendered on the `/builder` route via `src/app/builder`).

---

### 1. User Journeys

#### UJ-1: Configure a cabinet and add it to the project
1. User opens /builder; the "① Configure Unit" card shows searchable dropdowns for Zone, Cabinet Family, Configuration, (conditionally) Drawer Model / Tip-On / Inbuilt Drawers / Hand, Handle/Profile, Shutter Profile Design, Carcass Finish, Carcass Profile Finish, Shutter (or Glass) Finish, Shutter Profile Finish, Dimensions (W×H×D), and Thickness. (CarcassBomBuilder.tsx:8560–8862)
2. Every selection live-recomputes the derived cabinet model; the 11-field Cabinet Code renders colour-coded in a code box with a "Copy" button. (7092–7098, 8868–8899)
3. Below the code, a meta line shows Construction ("Full Sides (wall-hung)" vs "Full Top/Bottom") and the unit description (family · variant · hand). (8927–8930)
4. User picks an Elevation (AA…KK, mandatory) and a Qty (min 1), then presses "+ Add to Project"; the line is appended to the project with the current model, qty, rate = SO rate default, and elevation. (8902–8925, 7850–7860)
5. The "Project & Totals" tab badge shows the total quantity of all project lines. (8935)

#### UJ-2: Review/edit project lines
1. User opens the "Project & Totals" tab → "④ Project Lines" table with columns #, Code, Finish, Rate (INR), Qty, Total (INR), and a remove action. (9386–9400)
2. Clicking a line's code toggles an inline "MAIN BOM DETAILS" expansion listing that cabinet's BOM packets (Packet / Dimensions / Qty / UoM). (9414–9519)
3. User can edit each line's Rate in-place; Total = rate × qty recomputes; a Grand Total row sums qty and value across lines (Indian-locale formatting). (9460–9474, 9522–9530)
4. "remove" deletes one line; "clear all" empties the project. (9477, 9388, 7881)
5. Empty state message: "No cabinets added yet. Configure a unit and tap "Add to Project"." (9405)

#### UJ-3: Add a new stone finish from the configurator
1. User clicks the "+" beside Carcass Finish (or Shutter/Fixed-Panel Finish); a modal opens pre-set to the relevant thickness (carcass → current thickness; shutter → 6). (8680–8702, 8734–8756, 8771–8793)
2. User enters a finish name; the app creates a Zoho item named `STONE <thickness>MM <NAME>` (SKU = name, upper-cased) with custom fields cf_group="Stone", cf_finish, cf_thickness, cf_height=2800, cf_width=1200, tracked inventory. (5750–5793)

---

### 2. Zones (BR)

- **BR-Z1**: The Zone dropdown offers exactly these 14 zones (value → display name → code P1 → construction → mounting):
  | Key/P1 | Name | Construction | Mount | Flags |
  |---|---|---|---|---|
  | BC | Base | fulltb | legs | |
  | BCL | Base — Low Depth | fulltb | legs | low |
  | BB | Base Blind | fulltb | legs | blind |
  | BBL | Base Blind — Low Depth | fulltb | legs | low, blind |
  | WC | Wall | fullsides | wall | kind=wall |
  | WB | Wall Blind | fullsides | wall | wall, blind |
  | TC | Tall | fulltb | legs | tall |
  | TB | Tall Blind | fulltb | legs | tall, blind |
  | TCL | Tall — Low Depth | fulltb | legs | tall, low |
  | LO | Loft | fullsides | wall | kind=loft |
  | LB | Loft Blind | fullsides | wall | loft, blind |
  | LBF | Loft Blind — Full Depth | fullsides | wall | loft, blind |
  | LOF | Loft — Full Depth | fullsides | wall | loft |
  | MD | Mid Rolling Shutter | fullsides | wall | kind=md |
  (CarcassBomBuilder.tsx:634–649, 7119–7124)
- **BR-Z2**: Construction label shown to user: `fullsides` → "Full Sides (wall-hung)", otherwise "Full Top/Bottom". (8928)
- **BR-Z3**: "Base zone" = a zone with neither `kind` nor `tall` (BC, BCL, BB, BBL); only base zones offer the XCJ handle. (6952–6963, 7158–7165)

### 3. Families per zone with variants (BR)

- **BR-F1: Base zones (BC)** — 8 families (496–559):
  - **DW** Base Drawer (P2=DW): variants "2 Drawers" (P3=XXX, P4=2HB) and "3 Drawers" (P3=2LB, P4=1HB).
  - **HO** Base Hob (P2=HO, frame top): same 2dr/3dr variants as DW.
  - **SK** Base Sink (P2=SK, frame top): "Single bowl (handed)" and "Double bowl" (P4=2HS).
  - **SH** Base Shutter (P2=SH, 1 shelf): "Single door (handed)" (P3=1SX) and "Double door" (P3=1SX, P4=2HS).
  - **GD** Base Grain Drawer (P2=GD): "Grain Drawer" (P3=1BL, P4=1HF).
  - **AP** Base Appliance (Oven) (P2=AP, back strips): "Oven" (P3=OVN, P4=1FP).
  - **BPO** Base Bottle Pullout (P2=AC): "Bottle Pullout (handed)" (P3=BPO).
  - **WBP** Base Waste Bin Pullout (P2=AC): "Waste Bin Pullout" (P3=WBP, P4=1HF).
- **BR-F2: Zone-specific family restriction (famSetOf)** (651–681):
  - BCL offers **only SH** (even though sizes exist for other BCL families in the size table, they are not user-selectable).
  - BB offers only **LMC** (LeMans Corner, P3=LMC, handed) and **BSH** (Blind + Shelf, P3=1SX, handed).
  - BBL offers only **BSH**. (PLB "Plain Blind" exists in the blind family set/size table but is unreachable from BB/BBL in the UI.)
  - WB offers only **WGL** and **WST**.
- **BR-F3: Wall zone (WC)** families (567–601):
  - **WGL** Wall Glass Shutter (P2=SH, 3 glass shelves): single (handed, P3=3SG) / double (P4=2HS).
  - **WST** Wall Stone Shutter (P2=SH, 3 shelves): single (handed, P3=1SG) / double.
  - **WOP** Wall Open Shelf (P2=OP, 3 glass shelves): "Open (no door)" (P3=3SG, P4=XXX).
  - **WDR** Wall Dish Rack (P2=AC, 2 glass shelves): single (handed) / double (P3=2SG), fixed handle token DSH.
- **BR-F4: Tall zone (TC)** families (603–613) — each carries a bracket + hole-drill token used in part names:
  - **SHF** Tall Shelf Stone (P2=SH, bracket TCS, 6H): single (handed, P3=6SX) / double (P4=2HS).
  - **SHFG** Tall Shelf Glass (P3=6SG): single/double.
  - **APP** Tall Appliance + DW (P2=AP, TMO, 4H): "+ 1 Drawer (handed)" (P4=1HB) / "+ 2 Drawers (handed)" (P4=2HB); hand goes to P5 position.
  - **PAN** Tall Tandem Pantry (P2=AC, TTP, 6H): handed, P3=1SX, P5=TPT.
  - **DPN** Tall Drawer Pantry Stone (P2=DW, T3A, 4H): handed, P3=1SX, P5=5BD.
  - **DPNG** Tall Drawer Pantry Glass: P3=1SG, P5=5BD.
  - **PPN** Tall PO Shelf Pantry Stone (P2=PO, TPO, 6H): handed, P3=2SX, P5=4PO.
  - **PPNG** Tall PO Shelf Pantry Glass: P3=2SG, P5=4PO.
  - **REF** Tall Refrigerator (P2=REF, TRC, 3H): handed, P3=1SX.
- **BR-F5: Tall Blind (TB)**: **BLND** (stone, P3=6SX) and **BLNG** (glass, P3=6SG), bracket TBC, both sides drilled JD. (615–618)
- **BR-F6: Tall Low (TCL)**: **LOWS** / **LOWSG** (P3=6SX/6SG, bracket TLD, 6H), handed. (620–623)
- **BR-F7: Loft zones (LO/LB/LBF/LOF)**: **LST** Loft Stone Shutter and **LGL** Loft Glass Shutter (both P2=SH, 1 glass shelf; single handed / double variants, P3=1SX). (625–628)
- **BR-F8: MD zone**: single family **MDR** Rolling Shutter (P2=RS, 3 glass shelves, P3=3SG, P4=1SX). (630–632)
- **BR-F9: Glass-shutter families** are exactly {WGL, SHFG, BLNG, DPNG, PPNG, LOWSG, LGL} — 5mm glass faces + 8mm glass shelves; all others are stone. (685–686)
- **BR-F10**: If the selected family disappears when zone changes, selection resets to the first family of the new zone; same for variant. (6930–6949)

### 4. Sizes (BR)

- **BR-S1: SIZES table** — valid W (mm options) / H (mm options) / fixed D per zone.family (701–762), verbatim:
  | zone.family | W | H | D |
  |---|---|---|---|
  | BC.DW | 450, 600, 900 | 720 | 560 |
  | BC.HO | 600, 900 | 720 | 560 |
  | BC.SK | 600, 900, 1050, 1200 | 720 | 560 |
  | BC.SH | 450, 550, 600, 900 | 720 | 560 |
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
  | WC.WGL | 450, 550, 600, 850, 900 | 1085, 725 | 336 |
  | WC.WST | 450, 550, 600, 850, 900 | 1085, 725 | 336 |
  | WC.WDR | 600, 900 | 1085, 725 | 336 |
  | WC.WOP | 300 | 1085, 725 | 336 |
  | WB.WGL | 900 | 1085, 725 | 336 |
  | WB.WST | 900 | 1085, 725 | 336 |
  | WB.WDR | 600, 900 | 1085, 725 | 336 |
  | WB.WOP | 300 | 1085, 725 | 336 |
  | TC.SHF / TC.SHFG | 450, 600, 900 | 2400, 2040 | 560 |
  | TC.APP / PAN / DPN / DPNG / PPN / PPNG / REF | 600 | 2400, 2040 | 560 |
  | TB.BLND / TB.BLNG | 1150 | 2400, 2040 | 560 |
  | TCL.LOWS / TCL.LOWSG | 450, 600 | 2400, 2040 | 336 |
  | LO.LST / LO.LGL | 450, 550, 600, 850 | 600 | 336 |
  | LB.LST / LB.LGL | 900 | 600 | 336 |
  | LBF.LST / LBF.LGL | 1050 | 600 | 560 |
  | LOF.LST / LOF.LGL | 450, 500, 600 | 600 | 560 |
  | MD.MDR | 600 | 1650, 1290 | 336 |
- **BR-S2: Fallback sizes** for a zone.family absent from the table: W = 300/450/600/900; H = 2400 (tall), 1085 (wall), 600 (loft), 1650 (md), else 720; D = 336 for low or any `kind` zone, else 560. (764–769)
- **BR-S3: Custom size** — each of W, H, D dropdowns appends a "Custom…" option; picking it reveals a numeric input (step 10). Defaults customW=600, customH=720, customD=560. (7171–7193, 8823–8849, 5592–5594)
- **BR-S4: Width↔Configuration coupling**: selecting/entering a width > 600 auto-switches to the family's "Double" variant (if one exists); selecting a Double variant with W ≤ 600 auto-bumps width to the first standard width > 600 (else custom 900); switching to a handed single variant with W > 600 drops width to the largest standard width ≤ 600 (else custom 600). An invariant effect re-raises width if a Double variant persists at ≤ 600 after a family switch. (6976–7035)
- **BR-S5: DW/HO 3-drawer excludes 450 width** — 450 is filtered from options and auto-bumped off when switching to 3dr. (7014–7019, 7174–7177)
- **BR-S6: Double variants hide widths ≤ 600** from the width dropdown. (7171–7173)
- **BR-S7: Blind zones never offer double-door variants** — variants with `both` or a "double" label are filtered out for blind zones. (6937–6949, 7133–7143)
- **BR-S8: Thickness** — default 15mm and locked; a lock button toggles editability; unlocked range 5–40 step 1 via number input; a separate thickness options list (5/6/7/9/12/15/16/20) exists for related selects. (8853–8861, 7195–7197)
- **BR-S9**: Changing zone/family resets W/H/D selects to the first standard values. (6920–6927)

### 5. Handle & design compatibility (BR)

- **BR-H1: Handle options**: base zones show "XCJ — CJ / Gola" + "STD — Standard"; all other zones show only STD. Default: XCJ for base zones, STD otherwise (auto-reset on zone change). (7158–7165, 6957–6963)
- **BR-H2: Design list** = `SH_DESIGNS = ["MD1","MD2","MD3","MD1CM1","MD1CM2","MD2CM1","MD2CM2","MD3CM1","MD3CM2","CL1","CL2","NEON20"]`. (774)
- **BR-H3: Design→handle lock (base zones only)**: `XCJ_DESIGNS = [MD1, MD3, MD1CM1, MD1CM2, MD3CM1, MD3CM2]` force handle=XCJ; `STD_DESIGNS = [MD2, MD2CM1, MD2CM2]` force handle=STD; CL1/CL2/NEON20 leave the handle free. When locked, the Handle dropdown is disabled and its hint reads "set by <design>". (778–779, 7072–7083, 8640–8647)
- **BR-H4: Valid designs per cabinet** (823–853):
  - No shutters (e.g., WOP open shelf) → empty list, design select disabled.
  - Glass-shutter families → only ["NEON20","CL1"] (CL1 here = 5mm glass classic profile).
  - Drawer-fronted cabinets → NEON20 removed; if any front is low-back (LB) → only ["MD1","MD2","MD3"].
  - BPO at W=150 → only ["MD1","MD2","MD3"].
  - (Export path only) with a handle argument, base-zone lists exclude the incompatible handle's designs.
- **BR-H5: Glass design lock**: glass families lock the design to NEON20; a "🔒 unlock / 🔓 lock" toggle beside the design label lets the user switch to CL1; leaving a glass family re-locks. (7046–7070, 8650–8676)
- **BR-H6: Design fallback**: if the current design is invalid for the new cabinet, it resets to the first valid design (or empty when none). (7058–7070)
- **BR-H7: Design geometry constants** (contractual, used in shutter codes/BOM): inset per design SH_INSET = MD1/MD2/MD1CM1/MD1CM2/MD2CM1/MD2CM2/NEON20: 5; MD3/MD3CM1/MD3CM2: 3; CL1: 118; CL2: 149. Frame width SH_FRAME = 25 for all MD*/NEON20, 31 for CL1/CL2. Stone face thickness: MD3 family 9mm, others 6mm, glass faces 5mm. Shutter weight 1.38 kg/sqft. (772–786)
- **BR-H8: Shutter height deduction**: non-base shutters −3mm; base with MD1/MD3-family designs −33mm (except ML mid-low fronts −3); other base designs −3. (788–792)
- **BR-H9: Hinge count by shutter height**: ≤900→3, ≤1600→4, ≤2100→5, else 6. Hinge pack: loft → `HARDWARE PACK HINGE W/OUT SOFT CLOSE Set/n`; glass → `HARDWARE PACK SLIM HINGE FOR GLASS Set/n`; else `HARDWARE PACK 3D HINGE 0 CRANK Set/n`. (794–796, 1063–1068)

### 6. Shutter placement rules (BR)

- **BR-SP1: Which cabinets get which fronts** (shutSpec, 798–821):
  - Blind zones → one hinged blind door of fixed width 450 (wall/loft) or 550 (base/tall) plus, if the cabinet is wider, a fixed dummy panel covering the remainder.
  - DW/HO 2dr → two high-back drawer fronts (UH+BH); 3dr → UL+ML low fronts + BH high front; 3dr with inbuilt "1lb" or "2hb1bl" → two high fronts (UH+BH).
  - GD/BPO/WBP → one full-height drawer front (FH).
  - Tall APP → bottom drawer front(s) (BH, or UH+BH for 2dw) + an upper hinged door of height 1085 (H≥2400) or 720.
  - SK, SH, WGL, WST, WDR, SHF, SHFG, PAN, DPN(G), PPN(G), REF, BLND, BLNG, LOWS(G), LST, LGL → hinged door(s).
  - AP (oven), WOP, MDR → no shutters.
- **BR-SP2: Single vs double doors**: doors double when the variant is Double/2HS **or W > 600**; double doors are each W/2−3 wide (leaf L + leaf R); single doors are W−3, hung per Hand (LHS→L, RHS→R). (1174–1195)
- **BR-SP3: Drawer front heights**: high-back front 360mm, low-back front 180mm, FH = cabinet height; front width W−3; panel = front − inset each way. (1071–1078)
- **BR-SP4: Blind fixed dummy panel** is always stone 6mm MD1 (even in glass families), code material token forced to ST, fastened with `HARDWARE PACK L BRACKET (fixed dummy)` ×2. (1148–1171, 2246–2251)
- **BR-SP5: Handed control visibility**: the Hand selector (LHS — active Left / RHS — active Right) shows only for handed variants, and is hidden for BPO wider than 150. (8628–8638, 7145–7148)

### 7. Materials & profile colours (BR)

- **BR-M1: Carcass Finish options** = stone finish list for the current thickness from `src/data/stone_finishes.json` (keyed by thickness); Shutter Finish options = the 6mm list. Defaults STATUARIO/STATUARIO. Invalid selections auto-snap to the first option. (5665–5720, src/data/stone_finishes.json)
- **BR-M2: Carcass Profile Finish options** = union of finishes for profile codes STP + ELEN from `src/data/profile_finishes.json`, sorted; default CHAMPAGNE. (5677–5684)
- **BR-M3: Shutter Profile Finish options** = union of finishes for the profile codes parsed out of the current design (e.g. MD1CM2 → MD1 + CM2; CL1; NEON20), from profile_finishes.json; default CHAMPAGNE; auto-snaps when the design changes. (5686–5698, 5728–5732)
- **BR-M4: Glass Shutter Color** — when a glass family is selected the Shutter Finish picker is replaced by a Glass Shutter Color picker with exactly: BROWN TINTED, EXTRA CLEAR, BROWN MIRROR, CLEAR, CLEAR MIRROR, CLEAR SHELF, BROWN FLUTED, CLEAR FLUTED, EXTRA CLEAR FLUTED, EXTRA CLEAR MIRROR, GREY TINTED, BLACK TINTED (default CLEAR). The chosen colour becomes the model's shutter material and appears in the glass item name `GLASS TOUGH EP <pw>X<ph>X5 <COLOR> SKV`. (4673–4677, 7093–7095, 2268)
- **BR-M5: Blind glass units show a second picker** "Fixed Panel Finish (Stone)" — the stone shade of the fixed dummy panel (the 6mm stone shutter list). Fixed panel material defaults to the shutter material when not set. (7049–7051, 8730–8765, 2240)
- **BR-M6: Material shade pickers only render when the cabinet has valid designs** (i.e., has shutters). (8719)
- **BR-M7: Add-finish "+" buttons** open the New Finish modal (target carcass pre-fills current thickness; target shutter pre-fills 6mm) and create Zoho stone items named `STONE <t>MM <NAME>`. (8680–8702, 5734–5793)

### 8. Drawer model / inbuilt drawers / tip-on (BR)

- **BR-D1: Drawer Model selector** appears only when the current configuration has drawer fronts; options exactly: Lian, Hettich, Blum, Hafele, Grass (default Lian). All five are treated identically by the BOM engine (any of them enables drawer-box generation). (8589–8598, 7150–7156, 880)
- **BR-D2: Inbuilt Drawers selector** shows **only** for DW or HO family with the 3-Drawer configuration; UI options exactly "None" (`none`) and "2HB + 1BL" (`2hb1bl`). Selection resets to none whenever the option is not applicable. (6911–6913, 8613–8626, 7085–7089)
- **BR-D3: Engine-forced inbuilt drawers** (not user-selectable): GD always gets one built-in low-back drawer (`1lb`); DPN always gets the fixed pantry set (`fixed_dpn` = 2 low + 3 semi-high boxes). Values 1sb/2lb/2sb exist in the engine but are unreachable from the UI. (873–878, 924–938)
- **BR-D4: 2HB+1BL behavior**: shows two high-back shutter faces; the boxes behind them are LOW boxes (back 63mm, `HARDWARE PACK LOW BACK DRAWER H90 SET/1`), and only the built-in low-back drawer gets a carcass-colour fascia; the cabinet code's P5/P6 change to `2HB-1BL` (vs 3dr's `2LB-1HB`) **only for BC.DW** — boxes unchanged. (899–946, 1085–1089, 2101–2104)
- **BR-D5: Drawer box variants and dimensions**: Low (back 63, fascia 110), Semi High (back 148, H175 hardware, fascia 210), High (back 212, H239 hardware, fascia 210); back W−72×back-height×15, bottom (W−50)×(D−77)×6, fascia (W−2t−8); side profile HM513 483mm ×2/drawer, centre profile HM535 (W−78) ×4/drawer; aggregated as `Drawer Pack- Cab Drawer Box <variant>`. (886–1032)
- **BR-D6: Tip-On selector** appears only for loft zones (LO/LB/LBF/LOF); options are exactly the two BLUM item names: `TIPON LONG VERSION W MAG LONG VERSION ADAPTER PLATE 80X20X15 GREY 1743112 BLUM` and `TIPON LONG VERSION 125XX GREY 3156257 BLUM` (default = first). Quantity in the BOM: 2 for double door, else 1; loft hinges are without-soft-close. (696–699, 8601–8611, 1841–1846, 5585)
- **BR-D7: WBP (waste-bin pullout) never gets a drawer box** (accessory-only); BPO likewise gets no standard drawer box. (870–872, 900)

### 9. Cabinet code format (BR — contractual)

- **BR-C1: 11-field cabinet code**, hyphen-joined, plus a finish suffix:
  `P1(zone) - P2(family) - P3(handle: CJ|STD) - P4(material: GL|ST) - P5(variant p3) - P6(variant p4/hand) - P7 - W - H - D - t [- FINISH]`
  where handle token = `CJ` iff handle is XCJ else `STD`; material token = `GL` iff glass-shutter family else `ST`. (1609–1613, 2107 and parallel constructions at 1642/1814/1877/1976)
- **BR-C2: P7 = "XXX" rule**: for base, loft, MD and wall (non-handled) cabinets the 7th field is literally `XXX` (it formerly repeated the handle, now redundant — the handle is decoded from field 3). Exceptions: tall families put the P5 token (e.g. TPT/5BD/4PO) or, for APP, the hand (LHS/RHS) in field 7; WDR puts its fixed handle token `DSH` there. (2105–2107, 1638–1639, 1945)
- **BR-C3: Finish suffix** = `-<carcassMat>` when carcass and shutter finishes match (or no shutter finish), else `-<carcassMat>-<shutterMat>`; omitted when material is "(none)". (2234, 2107)
- **BR-C4: Special code substitutions**:
  - BC.DW 3dr + inbuilt 2HB+1BL → fields 5/6 become `2HB-1BL`. (2101–2104)
  - Tall APP: field 5 is height-derived (`3SX` at H≥2400 else `1SX`). (1635–1637)
  - Wall families: field 5's shelf digit is height-derived — WGL/WST/WOP: 1085→3, 725/720→1; WDR: 1085→2, 720→0 (token becomes `XXX`); WGL/WST hinge token in side-drill codes is height-driven via hingeN. (1947–1972)
- **BR-C5: Code display**: the on-screen code box strips the finish suffix from the hyphen fields, colour-codes each segment, and re-appends the finish as `CARCASS[/SHUTTER]`; a Copy button copies it. (8868–8898)
- **BR-C6: Round-trip parse**: a cabinet code can be parsed back into a full model (used when loading Sales Orders), including splitting a `MAT1-MAT2` suffix into carcass/shutter finishes and decoding handle from field 3 (CJ→XCJ). (4832–4919)

### 10. Shutter code format (BR — contractual)

- **BR-SC1: Shutter code** (per leaf/front):
  `SH-<CJ|STD>-<GL|ST>-<typeCode>-<W>x<HE>-<loc>-<w>-<h>-<frame>-<thk>-<design>`
  where typeCode = zone letter (B/W/T/L/M) + `HB`/`LB` for drawer fronts or `SH` for hinged doors; BPO/WBP use literal `BPO`/`WBP`; `loc` ∈ U/M/B/F (drawer front position initial) or L/R (door side) or X (fixed panel); `frame` = design frame width (25/31); `thk` = 5 (glass) / 6 / 9 (MD3 family). (1052–1195)
- **BR-SC2: Fixed dummy panel code** forces `ST`, thickness 6 and design MD1: `SH-<CJ|STD>-ST-<zp>SH-<W>x<H>-X-<w>-<h>-25-6-MD1`. (1157–1158)
- **BR-SC3**: Each shutter emits BOM rows: stone panel `Panels- SH <pw>x<ph>x<thk> <design>` (or glass `GLASS TOUGH EP <pw>X<ph>X5 <colour> SKV`), 2× vertical profile `Profile LH/RH (<design>) <h>mm`, 2× horizontal `Profile TP/BT (<design>) <w>mm`, corner connector (`CORNER BRACKET FOR GLASS SHUTTER 62X62X GSP-CBM EBC` for glass, `CORNER CONNECTOR FOR STONE 70X70X2 MAR` otherwise), plus hinge/drawer hardware pack. (2265–2277, 688–693)

### 11. Add-to-project & project lines

- **BR-P1: Elevation is mandatory** to add a cabinet: options are exactly AA, BB, CC, DD, EE, FF, GG, HH, II, JJ, KK; the empty option is labelled "Elevation *", the select shows a red border until chosen, the Add button is disabled without it, and a guard alert reads "Please select an Elevation before adding the cabinet to the project." (300–301, 7855–7860, 8902–8924)
- **BR-P2**: Line qty input min 1 (coerced ≥1 integer); the added line stores {qty, model, rate = current SO rate, elevation}. (8914–8921, 7860)
- **BR-P3: Project Lines table** shows per line: index; code (finish suffix stripped) with elevation sub-label; finish summary "Stone: CARCASS[/SHUTTER]" and "Profile: CARCASS[/SHUTTER]" (shutter part shown only when it differs and shutters exist); editable Rate (min 0); Qty; Total = rate×qty (en-IN locale); remove button. Grand Total row sums qty and value. (9410–9530)
- **BR-P4**: Clicking a line's code toggles the inline "MAIN BOM DETAILS — <code>" packet table (Packet/Dimensions/Qty/UoM with type chips Panel/Profile/Hardware/Consumable/Shutter/Elenor). (9480–9519)
- **BR-P5**: Lines loaded from a price-group source additionally show a "Pick colour (<group>)…" dropdown (red-bordered until picked) to set the shutter colour per line. (9443–9457)
- **BR-P6**: "clear all" empties the whole project in one click (no confirmation). (9388)
- **BR-P7**: Tab badge = Σ qty of all project lines; when a Sales Order is loaded the third tab is titled "Sales Order → BoM" instead of "Project & Totals". (8935)
- **BR-P8**: Elevation is stamped onto every exported BOM row of the cabinet and pushed to Zoho as the line description `Elevation: <value>`. (3661–3663, 6759)

### 12. Acceptance criteria (AC)

- **AC-1**: Given zone BC and family SH, When the user picks width 900, Then the Configuration auto-switches to "Double door" and the code's field 6 becomes 2HS. (6982–6991, 531)
- **AC-2**: Given a Double door configuration, When the user opens the width dropdown, Then no width ≤ 600 is listed (only wider standards + Custom…). (7171–7173)
- **AC-3**: Given DW 3 Drawers, When the width dropdown opens, Then 450 is absent; and Given W=450 with 2 Drawers, When the user switches to 3 Drawers, Then width bumps to 600. (7014–7019, 7175–7177)
- **AC-4**: Given design MD1 in a base zone, Then the Handle select is disabled showing XCJ and hint "set by MD1"; Given MD2, Then it is disabled showing STD; Given CL1/CL2, Then it is editable. (7075–7083, 8640–8647)
- **AC-5**: Given family WGL, Then the design select is disabled at NEON20 with a "🔒 unlock" button; When unlocked, Then only NEON20 and CL1 are offered; When the user moves to WST, Then the lock re-engages behavior resets. (7046–7056, 8651–8676)
- **AC-6**: Given family WOP (open shelf), Then the design select is disabled/empty and no shutter finish pickers render. (823–826, 8674, 8719)
- **AC-7**: Given zone WB + family WGL, Then both a "Glass Shutter Color" picker and a "Fixed Panel Finish (Stone)" picker render; the resulting fixed panel code uses `-ST-…-6-MD1` while doors use `-GL-…-5-NEON20`. (7051, 8721–8765, 1157–1158)
- **AC-8**: Given BPO at W=150, Then the Hand selector shows and designs are limited to MD1/MD2/MD3; at W=300 the Hand selector hides. (837–839, 8628)
- **AC-9**: Given no elevation selected, When user clicks "+ Add to Project", Then nothing is added (button disabled; guard alert if triggered programmatically). (8922, 7855–7858)
- **AC-10**: Given a base XCJ cabinet, Then the top panel depth is reduced by 23mm (CJ_CUT) and the code field 3 reads CJ; with STD it reads STD and full depth. (432, 2100, 2131)
- **AC-11**: Given a loft cabinet with double doors and a Tip-On selection, Then the BOM contains the selected BLUM tip-on item ×2. (1842–1846)
- **AC-12**: Given thickness locked, Then the thickness input is disabled at 15; When unlocked and set to another value, Then the Carcass Finish list switches to that thickness's finishes and an out-of-list selection snaps to the first option. (8853–8861, 5667–5669, 5710–5714)
- **AC-13**: Given carcass finish STATUARIO and shutter finish CARRARA, Then the cabinet code ends `…-15-STATUARIO-CARRARA` and the display shows `STATUARIO/CARRARA`. (2234, 8883–8889)
- **AC-14**: Given wall zone WC.WGL at H=725, Then the code's field 5 reads `1SG` (1 shelf) and side drilling uses 3H; at H=1085 it reads `3SG` with 4H. (1950–1972)
- **AC-15**: Given a project line, When the user edits Rate to 5000 with qty 3, Then Total shows 15,000 and Grand Total updates. (9460–9474, 9522–9528)
- **AC-16**: Given zone BCL, Then the Cabinet Family list contains only "Base Shutter". (651–654)
- **AC-17**: Given zone BB, Then families are exactly LeMans Corner and Blind + Shelf, widths fixed to 1050 / 1150 respectively, and no Double variants appear. (655–657, 719–720, 6941–6943)

### 13. Design constraints (DC)

- **DC-1**: All configurator pickers are searchable dropdowns (type-to-filter SearchableSelect) rather than native selects. (4718+, 8566 ff.)
- **DC-2**: Field hints tie each control to its code position: Zone "P1", Cabinet Family "P2", Configuration "P3·P4", Handle "P5", Dimensions "W × H × D". (8565, 8573, 8581, 8640, 8814)
- **DC-3**: Conditional visibility — Drawer Model only when the config has drawer fronts; Tip-On only for loft zones; Inbuilt Drawers only for DW/HO 3dr; Hand only for handed variants (minus BPO>150); glass vs stone shade pickers swap by family; the fixed-panel picker only for blind glass. (8589–8765)
- **DC-4**: The whole Configure card, code box, add row and meta line are hidden in Sales-Order (designer) mode; only the tabs/output remain. (8560–8562, 8868, 8902, 8927)
- **DC-5**: The cabinet code renders as colour-classed segments (s1/s2/s3/s4/s5 then dimension class) with dash separators, plus a Copy button with "Copied" feedback. (8870–8898)
- **DC-6**: Elevation select uses a red border and required-asterisk placeholder until a value is chosen; the Add button tooltip explains the block. (8907–8922)
- **DC-7**: Output area is tabbed: "Packets" (② Carcass Packets table), "Raw BoM (this unit)" (③ roll-up cards for Stone +15% waste, Profiles +20%, Hardware, Consumables, Operations, plus shutter stone/profile cards, and ④ Full Explosion tree), and "Project & Totals". (8932–9040)
- **DC-8**: Packet rows are chip-labelled by type (Panel/Profile/Hardware/Consumable/Shutter) with distinct colour classes. (8952–8963)
- **DC-9**: Thickness lock and glass-design lock use explicit 🔒/🔓 toggle buttons with state-dependent styling. (8853–8860, 8652–8667)
- **DC-10**: Currency figures use en-IN locale formatting; rate inputs are monospace right-aligned. (9469–9474, 9527)
- **DC-11**: The current configuration is published to `window.__BOM_CONTEXT__` (code, zone, family, dims, materials, design, validDesigns) for the AI copilot. (7100–7116)


# Section 2 — BOM Generation Engine

All citations are to `/Users/Apple/Documents/bom-nextjs-app/Inventory - Magppie/src/components/CarcassBomBuilder.tsx` unless stated. Line numbers are approximate.

### 1. User Journeys

**UJ-1: Cabinet expansion into a BOM model**
1. User selects zone, family, variant, handle, design, materials, W/H/D, thickness (t=15), hand, drawer model, inbuilt-drawer option, fixed-panel material, and Tip-On.
2. The engine builds a carcass model (panels, profiles, hardware, consumables, pack rows) via `buildModel` → `buildCarcassInner` → `buildCarcassInnerRaw` (CarcassBomBuilder.tsx:2214, 1554, 1590).
3. Drawer boxes are appended (`addDrawerBoxes`, :855) and shutters are built (`buildShutters`, :1036) and appended as "shut" pack rows with size labels (:2245–2252).
4. LH/RH and TP/BT combined panels are split into per-part rows with individual drill codes (`mergeCarcassPanels`, :1385+), and net sqft / panel / cut / drill counts are recomputed from merged panels (:1572–1585).
5. The model renders as a pack-row tree, exports to CSV (`buildCSV` :2282, header `SN,Item Name,Pack Name,Cabinet Code,UoM,Qty`), Full BOM Excel (`buildFullBomData` :3030), packing list, labels, and Zoho SO lines — each consuming the same panels/profiles/hardware/cons lists (`buildRawRows` :2256).

**UJ-2: Every-cabinet raw-row expansion (per shutter)**
1. For each shutter the raw rows emit: face (glass `GLASS TOUGH EP {pw}X{ph}X5 {shutterMat|CLEAR} SKV` or stone `Panels- SH {pw}x{ph}x{thk} {design}`), `Profile LH/RH ({design}) {profV}mm` ×2, `Profile TP/BT ({design}) {profH}mm` ×2, one corner connector set, and the hinge/drawer hardware pack if present (:2265–2277).

### 2. Zones & Carcass Construct

- **BR-1**: Each zone has a fixed construction type: `fulltb` (full top/bottom — sides sit between top & bottom; base + tall zones BC/BCL/BB/BBL/TC/TB/TCL) or `fullsides` (full sides, wall-hung — WC/WB/LO/LB/LBF/LOF/MD) (:635–648). The UI shows "Construction: Full Sides (wall-hung)" vs "Full Top/Bottom" (:8928).
- **BR-2**: Mounting follows the zone: `mount: "legs"` zones get a PVC leg pack; `mount: "wall"` zones get a wall-hanger bracket pack (:635–648; emission :1770/:1837/:1900/:2188 vs :2040).
- **BR-3**: Leg count by cabinet width: **W ≤ 150 → 2 legs; W ≥ 1050 → 6; otherwise 4**; emitted as one `HARDWARE PACK PVC LEG SET/{n}` set (:492, :1769–1771, :2187–2189).
- **BR-4**: Every cabinet carries exactly one `HARDWARE PACK CARCASS FIXING HPL 4 SET/1` — annotated "large" for leg-mounted (base/tall) and "small (wall)" for wall-mounted (wall/loft/MD) (:1772, :1839, :1902, :2042, :2190).
- **BR-5**: Blind zones fix the functional shutter width: **450mm** for wall/loft blinds, **550mm** for base/tall blinds (`blindW`, :800).
- **BR-6**: Global engine constants: STEP = 2 (back-wall rebate), CJ_CUT = 23 (gola cut), SHELF_OFF = 40 (base shelf depth offset), thickness t = 15mm (:431–434).

### 3. Cabinet Code (contractual)

- **BR-7**: Cabinet code format is `<P1 zone>-<P2 family>-<CJ|STD>-<GL|ST>-<P3>-<P4>-<P5>-W-H-D-t[-MAT]`, e.g. joined with "-" plus material suffix when material ≠ "(none)" (:1642, :1814, :1877, :1976, :2107). Handle token: XCJ → `CJ`, else `STD`; material token: glass-shutter family → `GL`, else `ST` (:1608–1613).
- **BR-8**: P5/P7 no longer repeats the handle; it is `XXX` (handle is decoded from the handle token) (:2105–2107).
- **BR-9**: When carcass and shutter materials differ, the code suffix is `{carcassMat}-{shutterMat}`; if equal or shutter empty, just `{carcassMat}` (:2234).
- **BR-10**: BC.DW 3-drawer with inbuilt "2HB+1BL" relabels the code only: P3 → `2HB`, P4 → `1BL` (instead of `2LB-1HB`); box content is set by the drawer rules (:2101–2104).

### 4. Base Carcass (fulltb, zones BC/BCL/BB/BBL)

- **BR-11**: Side panels: 2 × `Panels- Cab LH/RH {D}x{H−2t}x{t}`, one drilled `LH {lh}`, one `RH {rh}`, packed in `Set of Parts- Cab {Standard|CJ} Base[ (Low Depth)] LH({lh})+RH({rh}) {D}x{H−2t}x{t}` (:2114, :2123–2125). Handed variants swap the active/other drill codes by hand (LHS → LH gets `v.act`) (:2080–2090); blind variants use `BL`/`1S BL` codes with an L/R suffix on the blind side (:2069–2077).
- **BR-12**: Top/bottom — panel-top families: `Panels- Cab Top {W}x{D or D−23}x{t}` (drill JD, or `LEM L/R` for LeMans) + `Panels- Cab Bottom {W}x{D}x{t}` (drill "Leg holes", or `LEM L/R+LEG`), in set `Set of Parts- Cab {sn} Base {TP(JD)+BT(LEG)|TP(LEM x)+BT(LEM x+LEG)} {W}x{topDep}x{t}` (:2130–2148, :2095–2099).
- **BR-13**: **CJ sink cut**: when handle = XCJ on a base panel-top cabinet, the top panel depth is cut by CJ_CUT = 23mm (top = `D−23`), the pack size text reads `{D−23}-{D}`, and the panel name gains " CJ" (`Panels- Cab Top CJ …`); set name uses "CJ" instead of "Standard" (:2100, :2131–2134, :2091).
- **BR-14**: Frame-top families (SK sink, HO hob top="frame"… actually SK/WDR): instead of a top panel, a **Sink Profile Frame (HM510)** is emitted: `Prof Sink Frame (SINK) TP/BT` len W ×2, `Prof Sink Frame (SINK) LH/RH` len 530 ×2 (base) / len D ×2 (WDR), plus 1 × `CORNER BRACKET FOR GLASS SHUTTER` set; only a bottom panel (leg holes) remains (:2127–2129, :2163–2170; WDR :1998–2004).
- **BR-15**: Back wall (standard): `Panels- Cab Back Wall {W−2t−4}x{H−2t−4}x{t}` (no drill) in `Set of Parts- Cab Common Base Back Wall (Prof)`, with stepper profiles `Prof Stepper (STP) TP/BT` len W ×2 and `Prof Stepper (STP) LH/RH` len H ×2 (:2064–2066, :2156–2159).
- **BR-16**: **Back strips** (family flag `backStrips`, only BC/BCL AP oven): instead of a back wall, 2 × `Panels- Cab Back Strip {W−2t−4}x75x{t}` (pack rows "Back Wall TP(Prof)" and "Back Wall BT(Prof)"), no stepper profiles/silicone (:551 `backStrips: true`, :2151–2154).
- **BR-17**: **Stepper silicone**: every profile back wall adds `STEPPER SILICONE (DOWSIL 789)` in Kg = `2·stepSil(W) + 2·stepSil(vertical run)` rounded to 3 decimals, where `stepSil(run)` looks up the nearest size in the table SIZE=[75,150,300,450,500,550,600,720,850,900,1050,1070,1150,1200,2370] → KG=[0.01,0.01,0.02,0.02,0.02,0.02,0.03,0.03,0.05,0.05,0.06,0.06,0.06,0.06,0.09] (:463–476; usages :2160, :1682–1683, :1692, :1834, :1895, :2015).
- **BR-18**: **Assembly glue**: every cabinet gets `GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG` in ML = `round(((4·D + backPerimeter)/1000) · 15)`; backPerimeter = `2·(bw+bh)` for a back wall, `2·(2·(bw+75))` for back strips, `2·(bw+hUpper)+2·(bw+hLower)` for tall appliance split back, 0 when no back (REF@2040) (:2193–2196, :1774–1777, :1847–1850, :1904–1907, :2044–2047).
- **BR-19**: Base shelf (families with `shelf: 1`, e.g. SH/BSH): `Panels- Cab Shelf[ (Low)] {W−2t−5}x{D−40}x{t}` qty = family shelf count, plus shelf profile `Prof Shelf (HM511) LH/RH` len = `D−40−2` (standard) or `D−40` (low-depth) qty 2 per shelf (:2120–2121, :2172–2184).

### 5. Wall Carcass (fullsides, WC/WB)

- **BR-20**: Wall carcass height is reduced: cH = **H−15** for all wall families except Dish Rack (WDR) which is **H−30** (to fit the aluminium sink profile; at H=1085 the WDR carcass is 1055) (:1923–1928). Side depth sd = D−15 (WDR: D) (:1930).
- **BR-21**: Wall build: 2 sides `Panels- Cab Wall LH/RH {sd}x{cH}x{t}`; TP+BT `Panels- Cab Wall TP/BT {W−2t}x{D}x{t}` both JD (WDR: TP only, no bottom — bottom replaced by sink frame); back wall `Panels- Cab Wall Back {W−2t−4}x{cH−2t−4}x{t}` with stepper TP/BT len W ×2, LH/RH len cH ×2 + stepper silicone (:1991–2015).
- **BR-22**: **Wall shelf quantity is height-derived**: WGL/WST/WOP → **H ≥ 1085 → 3 shelves, else (725) → 1**; WDR → **H ≥ 1085 → 2, else 0** (no shelf emitted, code token becomes `XXX`) (:1950–1956).
- **BR-23**: The cabinet-code P3 shelf digit and the side-panel drill codes track that height-derived count (`3SG`→`1SG` etc.); for WGL/WST the hinge-count token in the drill code is also height-driven via hingeN (**725 → 3H, 1085 → 4H**); WDR/WOP keep their family hinge token (:1957–1972).
- **BR-24**: **Glass shelves — direct raw material** (WST and WGL): shelf item `GLASS TOUGH EP {W−36}X{D−49}X8 CLEAR SKV`, qty per BR-22, carried as the model's `glassShelf` and exported as a direct raw-material row (not a stone panel BOM) (:2019–2033, :2264).
- **BR-25**: **Glass shelves — legacy hardware pack** (WOP/WDR): pack-row `GLASS TOUGH EP {W−36}X{gd}X8 CLEAR SKV` plus a hardware line `GLASS TOUGH EP {W−36}X{gd}X8`, qty height-derived; **shelf depth gd = D−39 for WDR, D−49 for other wall families** (:1982–1984, :2034–2038).
- **DC-1**: Wall stone (WST) vs glass (WGL) shutters share the same p3 "SG" shelf token; the cabinet code differentiates them solely through the material token GL vs ST (:1973–1976).

### 6. Loft & Mid-Rolling-Shutter Carcass

- **BR-26**: Loft (LO/LB/LBF/LOF): sides full height H, sd = D−15; TP + BT `Panels- Cab Loft TP/BT {W−2t}x{D}x{t}` both JD; back wall `{W−2t−4}x{H−2t−4}` with stepper (W, H runs) + silicone; glass shelf hardware `GLASS TOUGH EP {W−36}X{D−49}X8` qty = family `glass` (LST/LGL: 1); wall hanger + small carcass fixing; glue per BR-18 (:1795–1850).
- **BR-27**: **Tip-On (loft only)**: if a Tip-On option is selected, it is added qty = 2 for double-door variants else 1 (loft hinges are without soft-close, closed by Tip-On) (:1841–1846; options list :764–767: `TIPON LONG VERSION W MAG LONG VERSION ADAPTER PLATE 80X20X15 GREY 1743112 BLUM` / `TIPON LONG VERSION 125XX GREY 3156257 BLUM`).
- **BR-28**: MD (Mid Rolling Shutter): sides full H×D; **top only** (`Part Cab Standard TP JD`, "no bottom"); back wall height = **H−17**; glass shelves `GLASS 08 MM {W−36}X{D−62}` qty 3; plus a fixed stone shelf `Panels- Cab MD Stone Shelf {W−2t−4}x{D−32}x{t}`; wall hanger + small fixing + glue (:1866–1907).

### 7. Tall Carcass (fulltb, TC/TB/TCL)

- **BR-29**: Tall build: sides `Panels- Cab Tall LH/RH {H−2t}x{D−15}x{t}` ×2 (pack `Set of Parts- Cab Standard Tall LH({lh})+RH({rh})`); top `Panels- Cab Top {W}x{D}x{t}` JD + bottom `Panels- Cab Bottom {W}x{D}x{t}` "Leg holes" in `Set of Parts- Cab Standard Base TP(JD)+BT(LEG)`; back wall `Panels- Cab Tall Back {W−2t−4}x{H−2t−4}x{t}` with stepper TP/BT len W ×2 and LH/RH len `bh+2t+2·STEP` ×2 + silicone (:1615–1692).
- **BR-30**: Tall side drill codes combine the family bracket + holes tokens: bracket ∈ {TCS, TMO, TTP, T3A, TPO, TRC, TBC, TLD}, holes ∈ {6H, 4H, 3H, JD}; both `JD` for tall-blind (`bothJD`), both `{br} {ho}` for doubles, else active side `{br} {ho}` / other side `{br} JD` by hand (:1622–1634; family table :605–625).
- **BR-31**: **Tall built-in Elenor light**: every standard tall (and every wall non-WDR, and every loft) cabinet automatically includes the Elenor light BOM at the side height (tall: H−2t; wall: cH; loft: H) (:1656, :2009, :1829 — see §11).
- **BR-32**: Tall shelf count = the leading digit of the P3 token (e.g. `6SX` → 6, `3SX` → 3, `1SX` → 1); APP derives P3 from height: **H ≥ 2400 → `3SX` (3 shelves), else `1SX`** (:1635–1637).
- **BR-33**: Tall stone shelves: `Panels- Cab Shelf[ (Low)] {W−2t−5}x{D−49}x{t}` qty = shelf count, plus `Prof Shelf (HM511) LH/RH` len `D−49−2` ×2 per shelf (:1646–1647, :1710–1724).
- **BR-34**: **Tall glass shelves** (SHFG/BLNG and other glass families): replaced by direct raw material `GLASS TOUGH EP {W−36}X{D−49}X8 CLEAR SKV` qty = shelf count (no stone panel, no shelf profile) (:1694–1709).
- **BR-35**: **Tall Refrigerator (REF)**: back wall height = **H−1874**; the vertical stepper follows that shortened back (`bh+2t+4`); at **H=2040 the REF has no back wall and no shelves at all** (and glue back perimeter = 0); REF also adds one extra shelf at depth **D−13** with its HM511 profile (:1620–1621, :1663, :1727–1742).
- **BR-36**: **Tall Appliance + DW (APP 1dw/2dw)**: back wall splits into Upper `{W−2t−4}x{H−1349}x{t}` and Lower `{W−2t−4}x{286 (1dw) | 686 (2dw)}x{t}` sets, each with its own stepper profiles (W and its own height) and its own stepper-silicone quantity; APP also adds extra shelves at depth D−13: qty **3 for 1dw, 2 for 2dw** (:1660–1683, :1744–1767).
- **BR-37**: **Tall DPN (Drawer Pantry) fixed drawers**: DPN always forces the inbuilt-drawer configuration to **2 Low + 3 Semi-High** built-in drawer boxes (`fixed_dpn`) regardless of user selection (:877–879, :941–944).

### 8. Drawer Boxes (`addDrawerBoxes`, :855–1032)

- **BR-38**: Drawer boxes are only generated for supported runner models: **Lian, Hettich, Blum, Hafele, Grass** (:884).
- **BR-39**: Drawer variants and constants: **Low → back height 63, `HARDWARE PACK LOW BACK DRAWER H90 SET/1`; High → back 212, `HARDWARE PACK HIGH BACK DRAWER H239 SET/1`; Semi High → back 148, `HARDWARE PACK HIGH BACK DRAWER H175 SET/1`** (:907–914, :949–957).
- **BR-40**: Panel size formulas (per drawer): back width **W−72** (×backH×15, drilled JD), bottom **(W−50)×(D−77)×6** (no drill), fascia width **W−2t−8** (:1155 area — exact lines :954? actually) (:955–958: `backW=W−72; bottomW=W−50; bottomD=D−77; faciaW=W−2t−8`).
- **BR-41**: Profiles per drawer: `ALU PROF DRAWER BOTTOM SIDE (HM513) LH/RH` **len 483, qty 2** (set-wrapped LH/RH); `ALU PROF FOR DRAWER BOTTOM CENTER (HM535) MID` **len W−78, qty 4** (flat) (:1000–1014).
- **BR-42**: Boxes of the same variant collapse into a single composite `Drawer Pack- Cab Drawer Box {Low|High|Semi High}` whose qty = drawer count; children carry total quantities and are divided back per-set at render/Zoho (:889–893, :960+).
- **BR-43**: Standard (shutter-faced) drawer boxes come from the shutter spec fronts: DW/HO 2-drawer → 2 High; 3-drawer → 2 Low + 1 High; hb=0 → Low, hb=1 → High (:900–915, :811–814).
- **BR-44**: **2HB+1BL high-takes-low rule**: in the DW 3-drawer "2HB+1BL" inbuilt option, the two shutter-faced boxes are labeled "High" but take the **Low configuration** (back 63, H90 hardware) — only the fascia'd built-in Low Back is a true fascia drawer; the cabinet face shows two identical High-Back shutters (:806–811, :896–898, :909–911, :927–931).
- **BR-45**: **Built-in (fascia) drawers**: selection maps 1lb→1 Low, 1sb→1 Semi, 2lb→2 Low, 2sb→2 Semi, 2hb1bl→1 Low (fascia'd), fixed_dpn→2 Low+3 Semi. GD (grain drawer) always forces 1 built-in Low Back (:873–876, :922–944).
- **BR-46**: **Fascia heights**: built-in Low → **110mm**; High and Semi High → **210mm**. Fascia panel `Panels- Cab Drawer Box Fascia {variant} {W−2t−8}x{110|210}x15` is carcass-colour, drilled JD, and lives at cabinet level as its OWN pack (not nested in the Drawer Pack) (:946–957, :976–996).
- **BR-47**: **Hardware dedup rule**: the drawer-runner hardware pack is emitted in the Drawer Pack **only for built-in (fascia) drawers**; shutter-faced drawers carry the pack on their shutter instead (buildShutters `hinge`), so it is never emitted twice for the same Zoho item (:1018–1029, :1090–1094).
- **BR-48**: **BPO/WBP accessory exception**: Bottle Pullout and Waste Bin Pullout get a full-height drawer-style shutter front (loc FH) but **no drawer box** (skipped in step 1) and **no drawer hardware on the shutter** (hinge = "") — the pull-out accessory supplies its own mechanism (:816, :872–875 comment, :902 `isAcc`, :1088–1090).

### 9. Shutters (`buildShutters`, :1036–1211)

- **BR-49**: Shutter code format (contractual): `SH-<CJ|STD>-<GL|ST>-<zone token><type>-{W}x{HE}-<loc>-{w}-{h}-{frame}-{thk}-{design}`; zone token: base→B, wall→W, tall→T, loft→L, MD→M; type: HB/LB (drawer), SH (hinged), BPO/WBP for accessories; loc ∈ U/M/B/F (drawer front position initial) or L/R/X (:1057–1063, :1080–1105).
- **BR-50**: Drawer-front heights: **FH front → HE = full cabinet H; high-back → 360; low-back → 180** (:1073).
- **BR-51**: Deduction (`shDeduct`): non-base shutters always **3mm**; base shutters with handleless designs MD1/MD1CM1/MD1CM2/MD3/MD3CM1/MD3CM2 → **3mm for the middle-low front (ML), 33mm otherwise**; other base designs → 3mm. Width deduction is always 3mm (w = W−3; double doors w = W/2−3) (:788–792, :1075–1076, :1176–1178).
- **BR-52**: Face panel size = leaf size minus the design inset on both dims (pw = w−inset, ph = h−inset). Insets (SH_INSET): MD1/MD2/MD1CM*/MD2CM*/NEON20 = 5, MD3/MD3CM* = 3, CL1 = 118, CL2 = 149. Frame widths (SH_FRAME): all MD/NEON = 25, CL1/CL2 = 31 (:772–773, :1046–1047).
- **BR-53**: Face thickness: glass shutter faces = **5mm** (incl. NEON20/CL1 on glass fams); MD3 family = **9mm** stone; all other stone = **6mm** (:781–785).
- **BR-54**: Design catalog = MD1, MD2, MD3, MD1CM1, MD1CM2, MD2CM1, MD2CM2, MD3CM1, MD3CM2, CL1, CL2, NEON20 (:774). Glass-shutter families may only use **NEON20 or CL1**; drawer fronts exclude NEON20; any low-back front restricts the set to **MD1/MD2/MD3**; BPO@150mm restricts to MD1/MD2/MD3; on base zones handle XCJ excludes MD2-family, STD excludes MD1/MD3-family (:824–853, :776–778).
- **BR-55**: **Hinge count** `hingeN(h)`: **h ≤ 900 → 3; ≤ 1600 → 4; ≤ 2100 → 5; else 6** (:794–796).
- **BR-56**: **Hinge pack by zone/material**: loft → `HARDWARE PACK HINGE W/OUT SOFT CLOSE Set/{n}`; glass shutter → `HARDWARE PACK SLIM HINGE FOR GLASS Set/{n}`; all others → `HARDWARE PACK 3D HINGE 0 CRANK Set/{n}` (:1064–1069).
- **BR-57**: Shutter-faced drawer fronts carry the drawer hardware pack: high-back → `HARDWARE PACK HIGH BACK DRAWER H239 SET/1`, low-back → `HARDWARE PACK LOW BACK DRAWER H90 SET/1`; under 2HB+1BL a high front carries the **H90 (low)** pack (BR-44) (:1088–1094).
- **BR-58**: **Blind cabinets**: one functional hinged shutter of width **blindW−3** (blindW 450 wall/loft, 550 base/tall), hinge pack qty 1, hand-located L/R; plus, when W > blindW, a **fixed dummy panel** of size (W−blindW−3) × (H−3) at loc X (:1129–1173).
- **BR-59**: **Fixed dummy panel is always stone MD1 6mm** — code forced to `SH-<handle>-ST-…-6-MD1` with MD1 inset/frame, even when the functional shutter family is glass; it carries `HARDWARE PACK L BRACKET (fixed dummy)` **qty 2** instead of hinges (:1150–1170, :2246–2250, :2266–2270).
- **BR-60**: Double-door rule: two leaves when the variant is `double`/`2HS` **or W > 600**; each leaf w = W/2−3, locs L and R; single doors are located by hand (RHS → R) (:1175–1180). In the combinations export, handed singles are only enumerated up to 600mm and doubles only above 600mm for hinged non-blind specs (:7936–7950).
- **BR-61**: **Tall APP upper door**: appliance cabinets add an upper hinged door of height **HE = 1085 when H ≥ 2400, else 720**, width W−3, located by hand (:1106–1127, :817–819).
- **BR-62**: **Corner connector (verbatim)**: glass shutters → `CORNER BRACKET FOR GLASS SHUTTER 62X62X GSP-CBM EBC`; stone shutters and the fixed dummy panel → `CORNER CONNECTOR FOR STONE 70X70X2 MAR`; one set per shutter (:757–762, :2274).
- **BR-63**: Shutter vertical-profile drilling mirrors the carcass sides: single door inherits `LH(m.lh)+RH(m.rh)`; in a double pair the left leaf is `LH(lh)+RH(JD)` and the right `LH(JD)+RH(rh)` — inner meeting edges are plain joints (:1216–1236).
- **DC-2**: Shutter pack-row label shows `{w}×{h} · glass {pw}×{ph}×5` for glass or `… · panel {pw}×{ph}×{thk}` for stone; fixed panels always render the stone form (:2245–2251).

### 10. Elenor Light BOM (`addElenor`, :478–490)

- **BR-64**: The Elenor light is a composite `Elenor with Light {H}mm`, qty **2 Set** per cabinet, auto-added to every standard tall, wall (non-WDR) and loft carcass at the relevant side height (:1656, :2009, :1829).
- **BR-65**: Composite children (per cabinet, i.e. for the 2 sets): profile `ALU PROF FOR ELENOR 3000X15X15 ANODISED CHAMPAGNE HM-519 MINA` len H qty 2; `LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED` and `PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI` and `TAPE FOR COVER CAP ADH 3M X20X 91031 3M`, each qty = `2 × ceil(H × 1.10)` MM; `LIGHT EXTENSION WIRE TWP SP XX 14/38 SNO` qty 2 Mtr. The driver is chosen manually in Accessories, never auto-added (:479–489).
- **BR-66**: In the Full BOM export the Elenor composite nests: the profile, LED and diffuser each become a cut-to-size piece of the same length (the Elenor profile length) qty 2 over a raw 3-mtr stock child (raw excluded from cutting optimisation); tape/wire remain flat consumables (:3365–3405).

### 11. Weights, Waste & Area Formulas

- **BR-67**: **Sqft formula**: `sqft(w,h) = (w×h)/92903.04` (mm² per sqft) (:433, :493).
- **BR-68**: **Weights**: carcass weight = net panel sqft × **3.45 kg/sqft** (KG_SQFT); shutter weight = shutter face sqft × **1.38 kg/sqft** (SH_KGSQFT) (:438, :775, :8441, :8467; shown in UI as "weight ≈ … kg" :9302, :9344, :9376).
- **BR-69**: **Waste percentages (builder view)**: stone panels **+15%** (STONE_WASTE 0.15), aluminium profiles **+20%** (PROFILE_WASTE 0.20), Elenor profile/LED/diffuser **+10%** (ELENOR_WASTE 0.10) (:435–437; applied :8440–8448, :8463–8466, :6154, :6212).
- **BR-70**: **Waste percentages (Full BOM export)**: raw carcass stone under drilled panels = **17%**; raw stone under shutter panels = **0%** in the panel-row path; raw profile stock = **25%** (ELEN profile 20%) — note these export figures intentionally differ from the builder-view 15/20 constants (:2570–2576, :2590, :2638–2640).
- **BR-71**: Purchase quantities shown per unit: panel purchase sqft = net × 1.15; profile purchase length = Σ(len×qty)/1000 × (1+waste) with ELEN profiles at 10% and all others 20%; shutter stone purchase = shutter sqft × 1.15 (:8440–8467).
- **BR-72**: Profile classification for waste/drilling: profile type codes STP (stepper), SLF (shelf HM511), SINK (sink frame HM510), DBS (drawer side HM513, 483mm), DBC (drawer centre HM535, W−78), ELEN (HM-519); STP/ELEN/SLF/SINK are "no-drill" profiles (:5141).

### 12. Acceptance Criteria (spot-checks)

- **AC-1**: Given a BC.SH single-door 600×720×560 STD cabinet, when expanded, then it contains: LH/RH side set (560×690×15), TP(JD)+BT(LEG) set 600×560, back wall 566×686 + stepper W=600 ×2 / H=720 ×2 + 0.06 kg silicone (2×0.03+2×0.03), 1 shelf 565×520 + HM511 profile 518mm ×2, `HARDWARE PACK PVC LEG SET/4`, carcass fixing pack, glue = round(((2240+2×(566+686))/1000)×15) ML, and one hinged shutter 597×717 with `HARDWARE PACK 3D HINGE 0 CRANK Set/3` (:2063–2211, :1036+).
- **AC-2**: Given the same cabinet with handle XCJ and design MD1, when expanded, then the top panel is `Panels- Cab Top CJ 600x537x15` (D−23), the set label reads `537-560`, and the shutter height uses a 33mm deduction (687) (:2100–2134, :788–792).
- **AC-3**: Given a WC.WST at H=1085, when expanded, then 3 glass shelves `GLASS TOUGH EP {W−36}X{D−49}X8 CLEAR SKV` appear as direct raw material and the side drill token starts `3S` with `4H`; at H=725 only 1 shelf and `3H` (:1950–1972, :2019–2033).
- **AC-4**: Given a WC.WDR at H=725, when expanded, then no glass shelf line is emitted at all and the p3 code token is `XXX` (:1953–1958, :2034–2038).
- **AC-5**: Given a BC.DW 3-drawer with inbuilt "2HB+1BL", when expanded, then the cabinet code carries `2HB-1BL`, the Drawer Pack "High" has back height 63 and H90 hardware, exactly one fascia'd Low drawer (fascia 110mm) exists, both visible shutters are 360-high HB fronts carrying H90 packs, and no drawer hardware appears twice (:2101–2104, :896–931, :1088–1094).
- **AC-6**: Given a TC.DPN cabinet, when expanded, then exactly 2 Low + 3 Semi High built-in drawer boxes with fascias (110/210) are produced regardless of the inbuilt-drawer selector (:877–879, :941–944).
- **AC-7**: Given a TC.REF at H=2040, when expanded, then no back wall, no shelves, no stepper, no stepper silicone are emitted and glue = round((4×560/1000)×15) = 34 ML; at H=2400 the back wall is 526-high (H−1874) with a REF extra shelf at D−13 (:1620–1621, :1663, :1727–1742, :1774–1775).
- **AC-8**: Given any blind cabinet (e.g. WB.WGL 900) where W > blindW, when expanded, then two shutters exist: a 447-wide glass functional door (blindW 450−3) with slim glass hinges, and a fixed stone MD1 6mm dummy panel 447×(H−3) with L-bracket qty 2 and stone corner connector (:1129–1170, :757–762).
- **AC-9**: Given a loft cabinet with a Tip-On selected and a double-door variant, when expanded, then Tip-On qty = 2 and the hinge packs are the without-soft-close variant (:1841–1846, :1065–1066).
- **AC-10**: Given any project export to CSV, when generated, then rows are aggregated by (cabinet code, item, pack, UoM), quantity = per-unit qty × line qty, non-integers rounded to 3 decimals (:2282–2307).

### 13. Design Constraints

- **DC-3**: Panel counts / net sqft / cut / drill operation counts shown in the UI are recomputed from the merged (split LH/RH, TP/BT) panel list so on-screen stats always match the exported part rows (:1570–1585).
- **DC-4**: Drawer-pack children display per-set quantities (totals divided back down) while the composite row carries the drawer count (:886–893).
- **DC-5**: The builder UI shows per-cabinet stats "net {sqft} +15% / weight ≈ {sqft×3.45} kg" for panels and "net {sqft} +15% / weight ≈ {sqft×1.38} kg · {n} corner sets" for shutters (:9302, :9344).
- **DC-6**: Fascia packs and glass shelves appear at the cabinet level (own pack / direct raw), never nested inside the Drawer Pack or a stone-panel set (:986–996, :2019–2033).


# Section 3 — Auxiliary Sections (Fillers, Visible Panels, Countertop, Backsplash, Other Accessories, Accessories, Roll-ups)

All citations are to `src/components/CarcassBomBuilder.tsx` unless noted. Areas are user-visible: on-page cards ⑤–⑪, the Consolidated Totals cards, the ⑨ Raw Material Selection roll-up, the exported Excel (Full BOM / Accessories sheets), and Zoho SO pushes.

---

### Shared / cross-section

- **BR-X1**: Area everywhere is computed as `W × H / 92903.04` (mm² → sqft). (`CarcassBomBuilder.tsx:434` SQDIV)
- **BR-X2**: Zone-default resolution — for a chosen zone (base|tall|wall|loft|mid), the default shutter shade, height, depth, and profile colour are taken from the FIRST project cabinet whose zone code matches (base→BC/BCL/BB/BBL, tall→TC/TB/TCL, wall→WC/WB, loft→LO/LB/LBF/LOF, mid→MD); fallback when no cabinet matches: shade = current builder shutter material; height = base 715, tall 2095, wall 715, loft 355, mid 1195, else 720; depth = 560 (base/tall/loft) else 330; profile colour = builder shutter-profile colour else "CHAMPAGNE". (`:7614-7707`)
- **DC-X1**: Elevation options everywhere are the fixed list `AA BB CC DD EE FF GG HH II JJ KK`, offered via a datalist so free-text custom values are also accepted. (`:301`, `:9563-9565`)
- **BR-X3**: Row qty inputs in all these sections clamp to a minimum of 1. (`:9590`, `:9705`, `:9849`, `:9933`, `:10410`)
- **DC-X2**: All five row-list sections (⑤⑥⑦⑧ + Other Accessories) are dynamic tables with a "+ add row" button, a per-row remove "×"/"remove" button, and an empty-state hint text; a zone may repeat across rows. (`:9537-9947`, `:10353-10418`)

---

### ⑤ Fillers

#### UJ-F1: Add a filler strip
1. User clicks "+ add row" in card "⑤ Fillers" → a row appears with defaults zone=Base, qty=1, shade/height/width blank (placeholders show zone defaults), elevation blank. (`:5617-5621`, `:9541`)
2. User picks Zone (Base/Tall/Wall/Loft/Mid), Qty, Shutter Shade (dropdown, first option "Default ({zone default})"), optionally a Height preset, Height (mm), Width (mm), Elevation (AA–KK or custom text). (`:9566-9648`)
3. The filler's BOM appears in the Full BOM/exports, its stone/profile/glue feed the raw roll-up and Consolidated Totals.

#### Fields & rules
- **DC-F1**: Columns: Zone | Qty | Shutter Shade | Height preset | Height (mm) | Width (mm) | Elevation | remove. (`:9550-9560`)
- **BR-F1**: Height presets per zone (mm): base [717]; wall [1082, 717]; tall [2037, 2397]; loft [597]; mid [1647, 1287]. Picking a preset writes it into the Height field; the preset select itself stays on "Custom / pick…". (`:358-364`, `:9606-9614`)
- **BR-F2**: Effective values: Height = custom height else zone-default shutter height; **Width = custom width else 80 mm**; Finish = custom shade else zone-default shutter shade. (`:3671-3673`)

#### BOM expansion (per filler row)
- **BR-F3**: Master item (Level 0, Main Group "Shutter") named `Panels- SH Filler {H}x{W}x6`, SKU `SH-Filler-{ZONE}-{H}x{W}-{qty}`, thickness 6, qty = row qty. (`:3679-3682`)
- **BR-F4**: Sub-BOM (Level 1) code `SH-Filler-{ZONE}-{H}x{W}`, qty 1 (actual = row qty). (`:3684-3688`)
- **BR-F5**: Level 2 stone panel `Panels- SH {W}x{H}x6 Plain` in the filler finish — full W×H, **no deduction**. (`:3690-3698`)
- **BR-F6**: Level 2 raw profile: HM-504 in the zone's profile colour; default item name verbatim `ALU FILLER PROFILE HM-504 SIZE 76X8.2 WITH ANODISED {COLOUR} 3 MTR W 0.75 KG/MTR MINA`; SO qty = H/1000 metres (×row qty for actual, 0% waste on the BOM row). (`:3700-3714`, fallback also `:2628-2629`)
- **BR-F7**: Level 2 consumable `GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG` at **15 ml per metre of height**: SO qty = (H/1000)×15 ml, actual ×row qty. (`:3716-3724`)
- **BR-F8**: The row's Elevation value is stamped onto every BOM row the filler produced. (`:3726-3728`)

#### Roll-ups
- **BR-F9**: Raw aggregation: filler adds W×H sqft × qty into stone bucket `shutter|{finish}|6`; H/1000 × qty metres into profile bucket `shutter|HM-504|{zone profile colour}`; (H/1000)×15×qty ml of DOWSIL 789 silicone into hardware/consumables. (`:7366-7396`)
- **BR-F10**: Consolidated Totals (aggregates): filler area counts into Shutter Stone sqft and per-finish table (+qty panels), H-metres into profile bucket "HM-504", silicone into extra consumables list. (`:7768-7795`)

#### AC
- **AC-F1**: Given a base filler with no custom size, When BOM is generated, Then the panel is (zone-default shutter height)×80×6 in the zone's first cabinet's shutter shade.
- **AC-F2**: Given filler H=717, qty=2, When exported, Then silicone SO qty = 10.755 ml and actual = 21.51 ml (0.717×15, ×2).

---

### ⑥ Visible Panels

#### Fields
- **DC-V1**: Columns: Zone | Qty | Profile Style | Shutter Shade | Size preset | Height (mm) | Width (mm) | remove. New row defaults: zone=base, qty=1, profile=MD1. (`:9669-9678`, `:5628-5632`)
- **DC-V2**: Profile Style options exactly: `MD1 (Default)`, `MD3`, `MD1 + CM1/2`, `MD3 + CM1/3`. (`:9715-9718`)
- **DC-V3**: Visible Panels rows have **no Elevation column** (the field exists in state but is not rendered or stamped).
- **BR-V1**: Size presets per zone (label verbatim, Height×Width), picking one fills BOTH Height and Width:
  - base: `Base STD (717×586)`, `Base Low Depth (717×362)`
  - wall: `Wall STD (1082×362)`, `Wall STD (717×362)`
  - tall: `Tall STD (2037×586)`, `Tall STD (2397×586)`, `Tall Low Depth (2037×362)`, `Tall Low Depth (2397×362)`
  - loft: `Loft STD (597×362)`, `Loft Full Depth (597×586)`
  - mid: `MID STD (1647×362)`, `MID STD (1287×362)`, `MID Full Depth (1647×586)`, `MID Full Depth (1287×586)` (`:323-348`, `:9733-9741`)
- **BR-V2**: Effective values: Height = custom else zone-default shutter height; **Width = custom else zone-default cabinet depth + 25 mm**; Finish = custom shade else zone default. (`:3735-3737`, `:9685`)

#### BOM expansion (per VP row)
- **BR-V3**: Master (Level 0, "Shutter") `Panels- SH Visible {H}x{W}x6`, SKU `SH-Visible-{ZONE}-{H}x{W}-{qty}`; Level 1 sub-BOM code `SH-Visible-{ZONE}-{H}x{W}`. (`:3742-3752`)
- **BR-V4**: Main profile = MD3 if style contains "MD3", else MD1; panel thickness from design: MD3 → 9 mm, MD1 → 6 mm. (`:3757-3758`, `:782-786`)
- **BR-V5**: Level 2 assembly node `Parts- SH {W-5}x{H-5} {MD1|MD3}` — **net panel size is W−5 × H−5**. (`:3754-3763`)
- **BR-V6**: Level 3 stone panel `Panels- SH {W-5}x{H-5}x{thk} {profile}` under the Parts-SH node. (`:3765-3771`)
- **BR-V7**: Level 3+ main-profile set in the zone profile colour: `Profile LH/RH ({profile})` ×2 at length H and `Profile TP/BT ({profile})` ×2 at length W (standard profile BOM rows, shifted one level down under Parts-SH). (`:3773-3793`)
- **BR-V8**: When the style contains "CM", an additional full CM1 mould-profile set is emitted (same 2×H + 2×W lengths, code CM1). (`:3795-3816`)
- **BR-V9**: Level 3 hardware: `CORNER CONNECTOR FOR STONE 70X70X2 MAR`, 1 set per panel (actual ×qty). (`:3818-3822`)

#### Roll-ups
- **BR-V10**: Raw aggregation: stone (W−5)×(H−5) sqft ×qty into `shutter|{finish}|{6 or 9}` (thickness follows MD1/MD3); (2H+2W)/1000 ×qty metres into `shutter|{MD1|MD3}|{colour}`; if CM style, the same length again into `shutter|CM1|{colour}`. (`:7398-7432`)
- **BR-V11**: Consolidated Totals: adds panel sqft & count per finish, profile metres (doubled when CM style via multiplier 2 into total, and separately into MD-code and CM1 buckets), and **1 corner-connector set per panel qty** shown as "corner sets". (`:7797-7825`, `:9344`)

#### AC
- **AC-V1**: Given style "MD3 + CM1/3" and size 1082×362, When BOM generates, Then panel is 357×1077×9 with MD3 and CM1 profile sets each totalling 2×1082+2×362 mm and one corner-connector set.

---

### ⑦ Countertop

#### Fields / DC
- **DC-C1**: Columns: Length (mm) | Depth (mm, placeholder 600) | Thick. (select 30/40) | Color (default = base-zone shade) | Type (9-option select) | Rounding (side select + height input) | Drop Ht | Light (checkbox) | Qty | remove. New-row defaults: depth "600", thickness "30", ctType 1, edging "none", edgingHeight "600", dropHeight "705", baseLight **checked**, qty 1. (`:9786-9798`, `:5650-5654`)
- **BR-C1**: The 9 construction types, exact display order and labels (stored `value` in parens):
  1. `1 · Linear` (1)
  2. `2 · Linear + BSV` (5)
  3. `3 · Linear + LHV with LH Drop` (2)
  4. `4 · Linear + RHV with RH Drop` (3)
  5. `5 · Linear + BSV with Both Side Drop` (4)
  6. `6 · Island Compact` (6, island)
  7. `7 · Island Table` (7, island)
  8. `8 · Island with 350mm Sitting` (8, island)
  9. `9 · Island Both Side Cabinets` (9, island) (`:127-137`)
- **BR-C2**: Rounding (edging) side options depend on type: type 1 → None/LH/RH/Both; type 2 (LH drop) → None/RH; type 3 (RH drop) → None/LH; all other types (5, 4, islands) → None only (control disabled). Changing type resets an invalid edging to "none" and syncs the island flag. (`:102-107`, `:9826`, `:9831-9838`)
- **DC-C2**: Rounding-height input is enabled only when a rounding side is selected (default 600); Drop Ht input is enabled only when the type has a drop (types 2/3/4 and all islands), default 705. (`:9836`, `:156`, `:9841-9843`)

#### Shared build (every type) — BR
- **BR-C3**: Master (Level 0, Main Group "Countertop") named `Countertop Pasting Material {T}mm {L}x{D}{roundLabel}`, SKU `CT-{L}x{D}x{T}-{qty}`; Level 1 sub-BOM code `CT-{L}x{D}x{T}`. (`:3886-3893`)
- **BR-C4**: **Rounding is name-only**: when a side is selected the master name gains ` Rounding LH (-{h})` / ` Rounding RH (-{h})` / ` Rounding Both (-{h})` with h = rounding height (default 600); no geometry/deduction changes. (`:3881-3886`)
- **BR-C5**: Slab is pasted from two half-thickness stones: pt = T/2 → **30 mm counter = 2×15 mm stone; 40 mm = 2×20 mm stone** (panel names carry pt). (`:3873`)
- **BR-C6**: Top slab `Panels- CT Stone {pt}mm {topL}x{topD}` where `topL = L + 30×edgeFolds − 100×sideDrops×reduce` and `topD = D + 30 − 100×backDrops×reduce×topDepthReduce` (front fold always +30; type-5 gains +30 per side ×2; each side drop and the island back drop remove 100 mm — see BR-C9). (`:161-196`, `:3897-3900`)
- **BR-C7**: Dead-stock counter base `Panels- CT Counter Base Stone {pt}mm {baseL}x{baseD}` with `baseL = L − 100×sideDrops×reduce`, `baseD = max(0, D − 40 − 100×backDrops×reduce)` — i.e. **base depth is always D−40** before island reductions; finish is literally "DEAD STOCK". (`:194`, `:3901-3904`)
- **BR-C8**: Per-type extra pieces (`ctGeom`): type 2 → Drop-Down Left; type 3 → Drop-Down Right; type 4 → both; type 5 → no pieces, edge folds only; islands (6-9) → both side drops plus: type 6 `Island Back Panel (single-side)` (L−60)×dropHt; type 7 `Island Vertical Panel (double-side)` (L−60)×dropHt **and grandLights = 2**; type 8 `Island Sitting Drop` (L−80)×**350** with **deadQty 2**; type 9 `Island Back Panel (section)` (L−60)×dropHt. Each side drop panel is Depth×dropHt. (`:165-183`)
- **BR-C9**: **100 mm cabinet-mitre reductions**: each side drop shortens top & base LENGTH by 100; the island back drop shortens top & base DEPTH by 100. **Type 7 is fully exempt** (reduce=0); **type 8 keeps full top depth** (only the base depth is cut). (`:184-194`)
- **BR-C10**: Drop-down sub-BOM (each "dropdown" piece): node `Drop-Down {Label} {len}x{dropHt}` (sub_bom, Level 2) containing:
  - visible drop stone `Panels- CT {Label} Stone {pt}mm {len}x{dropHt + issue}` where **issue = +15 mm (single-side) or +30 mm for type 7 (double-side-visible)**, counter colour;
  - dead base `Panels- CT {Label} Base Stone {pt}mm {len}x{dropHt − 100}` in "DEAD STOCK", qty = deadQty (**2 for type 8's sitting drop**, else 1);
  - pasting consumables per BR-C13 over area len×(dropHt+issue). (`:3877-3879`, `:3924-3939`)
- **BR-C11**: Flat pieces (back patti, when present) emit a single counter-colour stone line `Panels- CT {Label} {pt}mm {len}x{wid}` at Level 2. (`:3940-3945`)
- **BR-C12**: Brass strip — one per drop-down side: item `BRASS STRIP 05MM 600 X 30 MM {D}x30` (SKU `BRASS STRIP 05MM 600 X 30 MM`), cut length = Depth, width 30, thickness 5, qty = number of drop sides (×row qty). (`:3948-3955`)
- **BR-C13**: Pasting consumables per sqft (emitted at counter level over L×D and again per drop over its visible area):
  - `AKEMI 5010 FOR STONE POLISH 2.25 PER KG S` — 10 gram/sqft
  - `GLUE BONDTITE FAST & CLEAR FOR STONE XX AGG` — 10 gram/sqft
  - `GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG` — 40 ml/sqft (`:3907-3918`, `:3973-3974`)
- **BR-C14**: Grand band light (only when the row's Light checkbox is on): node `Counter Band Light{ Front| Back}? {len}mm` with **len = max(0, L − 30 × sideDrops)**; type 7 emits TWO nodes tagged " Front" and " Back", all other types one untagged node. Each node holds three cut-to-size components (cut piece `{Label} Cut {len}mm` + raw 3-mtr stock child, 0% waste):
  - `ALU PROF GRAND COUNTER 3000X20X15.5 ANODISED CHAMPAGNE HM-512 MINA` (finish CHAMPAGNE)
  - `LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED`
  - `PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI` (`:3957-3971`, cut mechanics `:2654-2683`)

#### Roll-up
- **BR-C15**: Raw aggregation mirrors the BOM geometry: counter-colour bucket `shutter|{color}|{pt}` receives top-slab area + each flat piece + each visible drop (len×(dropHt+issue)); `shutter|DEAD STOCK|{pt}` receives base area + each drop base (len×(dropHt−100))×deadQty; consumables accrue at 10 g/10 g/40 ml per sqft over (top area + drop visible areas) × qty. (`:7454-7502`)

#### AC
- **AC-C1**: Given type 5 (Linear + BSV), L=2400, D=600, T=30 → top slab = 2460×630 (L+60 fold, D+30), base = 2400×560, no brass, no drop panels, light len 2400.
- **AC-C2**: Given type 4, L=2400, D=600, dropHt=705 → top 2200×630, base 2200×560, two Drop-Down panels 600×705 (visible stone 600×720, base 600×605 dead), 2 brass strips 600×30, light len 2340.
- **AC-C3**: Given type 7 with Light on → NO 100 mm reductions anywhere, visible drops issued +30, two Counter Band Light nodes (Front/Back).
- **AC-C4**: Given type 8, L=2400 → top depth stays D+30 (no −100), sitting drop 2320×350 with 2 dead base stones 2320×250.
- **AC-C5**: Given type 1 with Rounding=Both, height 650 → master name ends ` Rounding Both (-650)` and no other BOM rows change.

---

### ⑧ Backsplash

- **DC-B1**: Columns: Width (mm) | Height (mm) | Thickness (mm, default "15") | Color (default = base-zone shade) | Qty | remove. (`:9877-9884`, `:5641-5643`)
- **BR-B1**: Per row, own master under Main Group "Backsplash": Level 0 `Back Splash {T}mm {W}x{H}` (SKU `BS-{W}x{H}x{T}-{qty}`), Level 1 sub-BOM `BS-{W}x{H}x{T}`; T falls back to 15 when blank. (`:3828-3847`)
- **BR-B2**: Level 2 stone panel `Panels- BS Stone {T}mm {W}x{H}` in the chosen colour (full size, no deduction). (`:3849-3854`)
- **BR-B3**: Level 2 consumable `GLUE LATRICATE SUPER FLEX 20KG XX WHITE 335 AGG` at **1.25 kg per sqft**: SO qty = 1.25 × (W×H sqft); actual ×qty. (`:3856-3860`)
- **BR-B4**: Raw aggregation: W×H sqft ×qty into stone bucket `shutter|{color}|{T}` (so a 15 mm backsplash lands in a 15 mm bucket, distinct from 6 mm shutter stone); 1.25 kg/sqft of the LATICRETE glue into consumables. Stone waste (+15%) is applied at the roll-up/raw-selection layer, not on the BOM row. (`:7434-7452`)
- **AC-B1**: Given W=1000, H=600, qty=2 → glue SO qty = 1.25 × 6.458 = 8.073 kg, actual 16.146 kg; stone bucket gains 12.917 sqft.

---

### Other Accessories (Chimney / Dishwasher panels)

- **DC-O1**: Card "Other Accessories" appears only when the project has at least one cabinet line; each row shows Item select, chimney-only Size preset, Width, Height, Profile (code) select with note "Colour: {shutter profile colour} (shutter)", Color (Stone) select, Qty, remove. (`:10353-10418`)
- **BR-O1**: Item options: `Chimney Panel`, `Dishwasher Panel`. Chimney size presets verbatim: `Chimney Area (1082×336)` and `Chimney Area (717×336)` (Height×Width); dishwasher is custom-size only (no presets). (`:306-309`, `:351-354`, `:10374-10382`)
- **BR-O2**: New-row defaults: item=chimney, width/height = current builder custom W/H, profile = current shutter design, profile colour = shutter profile colour, stone colour = shutter material, qty 1. Profile colour is display-only (follows shutter). (`:7866-7873`, `:315-317`)
- **BR-O3**: Raw aggregation: each row adds W×H sqft ×qty into stone bucket `shutter|{color}|6` (always 6 mm). (`:7504-7512`)
- **BR-O4**: Accessories export sheet row: Accessory = "Other Accessory", Item Name = `{Label} - {color} ({profile} {profileColor})`, Size = `{width}x{height}`, Actual Qty = qty. (`:8340-8356`)
- **UJ-O1 / BR-O5**: Zoho push — each Other Accessory row becomes its **own SO line**:
  1. Requires the 6 mm stone raw material for its colour to be selected in ⑨; otherwise the push aborts with error `Stone raw material not selected for Other Accessory "{label}" finish "{color}" (6mm)…`. (`:6770-6774`)
  2. Stone qty = (W×H sqft × 1.15 stone waste) ÷ selected slab area, rounded to 4 dp (falls back to raw sqft if slab size unknown). (`:6776-6779`)
  3. Composite item created named `{Label} {W}x{H}x6 {color} ({profile} {profileColor})` with custom fields group="Other Accessory", finish, thickness 6, H, W; components = the selected stone + 1 Cutting service. (`:6781-6790`)
  4. Appended to the SO as a line with the row qty, **rate 0**, description `Profile: {profile} {profileColor}`. (`:6792-6798`, appended not replaced `:6859-6870`)
- **AC-O1**: Given a chimney preset 1082×336 in colour X on a pushed SO, Then Zoho gains a composite `Chimney Panel 336x1082x6 X ({design} {colour})` line at rate 0.

---

### ⑪ Accessories (skirting / lights / handles)

- **DC-A1**: Card "⑪ Accessories" appears only when the project has cabinet lines; each row = a cabinet multi-select (checkbox per project line, labelled with the first 3 code segments) + a list of applicable accessory checkboxes. (`:10420-10464`)
- **BR-A1**: Accessory catalog with Zoho item IDs (contractual):
  - `Skirting with light` — 3418412000001249001 — offered when any selected cabinet zone starts with B or T
  - `Duplay Profile Light` — 3418412000001249010 — zone starts with W
  - `L Profile Dado Light` — 3418412000001249037 — zone starts with W
  - `J type handle` — 3418412000001249019 — base (B*) AND CJ-styled cabinets only
  - `C type handle` — 3418412000001249028 — base + CJ only
  - `Grand Profile Light` — 3418412000001249046 — zone starts with B
  (labels/IDs `:289-296`; row-level applicability `:8226-8257`)
- **BR-A2**: Total width = Σ selected cabinets' widths (mm), shown live as "Total width: {mm}mm = {m}m"; metres = mm/1000 to 3 dp. Width exclusions per accessory: Duplay skips Wall Dishrack cabinets (family WDR or code containing `-DSH-`); C-handle skips hinged-door base families SH, SK, LMC, BSH, PLB; J/C handles count only base CJ cabinets. (`:8259-8289`, `:10462`)
- **BR-A3**: The four light-profile accessories (skirting, duplay, lprofile, grandlight) are **mutually exclusive within a row** — checking one unchecks the others; handles can coexist. (`:298`, `:10477-10479`)
- **DC-A2**: When enabled, an accessory exposes Size (text), Elevation (text), Qty (number, prefilled with the computed total metres, editable override); skirting additionally exposes Straight and L-conn connector counts; every light profile exposes a Driver select with options `LIGHT DRIVER LED STRIP 12V, 2AMP , 24W XX LED` and `LIGHT DRIVER LED STRIP 12V, 5AMP , 60W XX LED`. (`:10487-10519`, `:410-414`)
- **BR-A4**: Light-profile BOM expansion (Accessories export sheet): length = (override qty in m, else total m) ×1000 mm; **issued length = ceil(length × 1.10)** (10% waste, all packs). Rows emitted per enabled light accessory, item names verbatim:
  - Profile (per pack): skirting `ALU PROF FOR SKIRTING WITH LIGHT 3000X100X9.8 ANODISED CHAMPAGNE HM-507 MINA`; duplay `ALU PROF DUPLY LIGHT 3000X45X14 ANODISED CHAMPAGNE HM-534 MINA`; lprofile `ALU PROF DADO TOOL 3000X35..5X28 ANODISED CHAMPAGNE HM-514 MINA`; grandlight `ALU PROF GRAND COUNTER 3000X20X15.5 ANODISED CHAMPAGNE HM-512 MINA` — Actual Qty = issued length, carries Size/Elevation/Total m and the Zoho item ID.
  - LED `LIGHT FLEXIBLE LED LIGHT 3000K, 180 LED/MTR, 72W, W-5MM XX LED` — issued length × multiplier (**duplay ×2**, others ×1).
  - Diffuser `PVC DIFFUSER FOR GRAND PROF 3000X6X WHITE 9099 VAI` — issued length × multiplier (**duplay ×2**, others ×1).
  - Wire `LIGHT EXTENSION WIRE TWP SP XX 14/38 SNO` — fixed qty (**duplay 2**, skirting/lprofile/grandlight 1).
  - Tape: duplay `TAPE THERMAL 210 MIC 50 MTR X50X0.3 391990 EURO` ×issued length; grandlight `TAPE FOR COVER CAP ADH 3M X20X 91031 3M` ×issued length; skirting/lprofile none.
  - Driver: the selected driver, qty 1 (only if chosen).
  (`:367-408`, `:8304-8324`)
- **BR-A5**: Skirting connectors export as `SKIRTING STRAIGHT CONNECTOR` and `SKIRTING L CONNECTOR` with the user-entered counts (only when > 0). (`:8326-8333`)
- **BR-A6**: Handles (J/C) export a single row: Item Name = the accessory label, Total = computed metres, Actual Qty = override else metres, with Size/Elevation and the Zoho item ID. (`:8334-8337`)
- **DC-A3**: The Accessories rows land in the exported workbook as **Sheet "Accessories"** (columns SO, Carcass Items, Accessory, Selected, Item Name, Size, Elevation, Total, Actual Qty, Zoho Item ID); rows with no cabinets selected are skipped. (`:4132-4136`, `:8294-8295`)
- **AC-A1**: Given two base cabinets 600+900 mm with Skirting enabled and no override, Then Total = 1.5 m and profile/LED/diffuser Actual Qty = ceil(1500×1.10) = 1650.

---

### Project summary & raw roll-up

#### ② Consolidated Totals / ③ Stone — per finish (project summary cards)
- **DC-S1**: Shown only when the project has lines. Cards: Stone (all finishes) — net sqft, +15% total, panel count, weight ≈ net×3.45 kg; Profiles — net m, +20% total, per-code breakdown; Hardware counts; Consumables (assembly glue ml, stepper silicone kg, plus extra consumables incl. filler silicone); Operations (cut+drill); and, when any shutter-side area exists, **Shutter Stone (6mm)** (+15%, weight, "corner sets" count) and **Shutter Profiles** (+20%). (`:9293-9353`, constants `:435-438`)
- **BR-S1**: Fillers contribute to these totals per BR-F10; Visible Panels per BR-V11; Countertop/Backsplash/Other-Accessories do **not** feed the Consolidated Totals cards (they only feed ⑨). (`:7847` deps)
- **DC-S2**: "③ Stone — per finish" table lists Finish | Panels | Net sqft | +15% sqft | Weight kg, including filler/VP finishes; note text: profiles/hardware/consumables are finish-agnostic. (`:9356-9382`)

#### ⑨ Raw Material Selection (raw roll-up)
- **BR-R1**: `rawAggregation` sums three collections from cabinets + all auxiliary sections (deps: activeItems, design, fillers, visiblePanels, backsplashes, countertops, otherAccRows):
  - **stones**, keyed `category|finish|thickness` — carcass buckets from cabinets; shutter buckets: fillers → finish@6, VPs → finish@6 or 9 (MD3), backsplash → colour@T (15 default), countertop → colour@(T/2 =15 or 20) plus `DEAD STOCK@(T/2)`, other accessories → colour@6. So 6 mm shutter stone and 15/20 mm counter stone stay separate buckets.
  - **profiles**, keyed `category|profileCode|colour` (HM-504 from fillers; MD1/MD3/CM1 from VPs; cabinet codes from carcasses), in net metres.
  - **hardware/consumables**, keyed by item name (+uom), e.g. DOWSIL silicone ml, LATICRETE kg, AKEMI/BONDTITE gram. (`:7366-7519`)
- **DC-R1**: The card renders Carcass and Shutter subsections; each stone bucket shows "Stone — {finish} ({thickness}mm)", "Net: X sqft | Total (+15%): Y sqft", a searchable Zoho item picker, the picked slab's SKU/stock/slab size, Calculated Slabs = required sqft ÷ slab area (2 dp), and an editable "Actual Slabs" override. Each profile bucket shows "Profile — {code} ({colour})", "Net: Xm | Total (+{20|10 for ELEN}%): Ym" with its own picker. Zoho fetch errors show a per-bucket Retry and a "↻ Retry All". (`:9949-10075`, waste `:435-437`)
- **BR-R2**: The header states the aggregation source: "Aggregated from SO: {number}" when an SO is loaded, else "Aggregated from Project: {n} units", else "Aggregated from Configured Unit (Fallback)". (`:9957-9964`)
- **BR-R3**: Raw-material selections made here are what the BOM export and Zoho push consume (e.g. filler HM-504 raw name and the Other-Accessory stone requirement in BR-O5). (`:3704-3706`, `:6770-6774`)

#### Scope notes (user-visible boundaries)
- **BR-R4**: The Zoho SO push covers cabinets and Other Accessories only; Fillers, Visible Panels, Countertops and Backsplashes appear in the exported Full BOM/roll-ups but are **not** pushed as SO lines. (push loop `:6764-6798`; no filler/VP/CT/BS handling in `:5700-7360`)
- **DC-R2**: In the export workbook, filler/VP/backsplash/countertop rows appear in the Full BOM sheet with row-type colouring (master/sub_bom/component/plain) and, for fillers, the stamped Elevation column. (`:4052-4059`, `:3728`)


# Section 4 — Exports & Printable Outputs

All logic lives in `src/components/CarcassBomBuilder.tsx` (referred to as `CBB` below) unless noted. UI entry points: header buttons "Export All Combinations (.xlsx)" / "Export All Shutter Codes (.xlsx)" (CBB:8540–8556), and the "⑫ Downloads" card (visible only when the project has ≥1 line) with a Packing/Labels filter dropdown and buttons **Excel BOM · Packing List (.xls) · Labels (PDF) · CSV · copy csv** (CBB:10535–10566), plus a read-only "⑬ CSV Preview" textarea (CBB:10568–10573).

---

### 1. Full BOM Excel workbook ("Excel BOM" button)

#### UJ-EXP-01 — Download project BOM workbook
1. User builds a project (cabinets, fillers, visible panels, backsplashes, countertops, accessories), optionally against a selected Sales Order.
2. User clicks **Excel BOM** in "⑫ Downloads" (CBB:10559).
3. App builds accessory export rows, then calls `exportBuilderExcel` with project, stock map, selected raw-material choices, and per-zone defaults (CBB:8190–8205).
4. A multi-sheet `.xlsx` downloads named **`Builder_BOM_{SO}_{YYYY-MM-DD}.xlsx`** (SO falls back to `"Project"` when no SO selected) (CBB:4191).

#### BR — Workbook sheet structure
- **BR-EXP-01**: Workbook contains up to 5 sheets, each appended **only if it has rows**: `Full BOM`, `Out of Stock`, `Opti`, `Accessories`, `Hardware items` (CBB:4106–4190).

#### Full BOM sheet
- **BR-EXP-02 (columns)**: Row columns in order: `S. No.`, `SO`, `Elevation`, `Main Group`, `Sub Group`, `Level`, `Item`, `SKU`, `Type`, `Height`, `Width`, `Depth`, `Thickness`, `Finish`, `Grain`, `CF Type`, `Profile Code`, `SO Qty`, `Waste %`, `Actual Qty`, `Pcs`, `In Stock`, `Eff. Stock`, `Deficit`, `Unit`, `Status` (FullBomRow type CBB:2339–2366; S.No. prepended CBB:4103–4110; column widths `FULL_BOM_COLS` CBB:2311).
- **BR-EXP-03 (S.No. semantics)**: `S. No.` increments **only on Level-0 (master) rows**; every sub-row of that project line carries the same serial — it is a per-project-line number, not per-row (CBB:4100–4109).
- **BR-EXP-04 (Elevation)**: Every row generated for a cabinet line is stamped with that line's Elevation code (AA/BB/…); Elevation is a **mandatory field at cabinet add** (Add button disabled + alert "Please select an Elevation before adding the cabinet to the project.") (CBB:3662–3664, 7856, 8905–8922). Filler rows get the filler's elevation similarly (CBB:3728).
- **BR-EXP-05 (level indentation)**: The `Item` cell is prefixed with two spaces per level: `"  ".repeat(level) + item`; `Level` is also a numeric column (0 = cabinet master, 1 = pack, 2 = part/panel, 3 = raw/sub-component) (CBB:2528).
- **BR-EXP-06 (row colouring by type)**: Whole rows (26 cells) are fill-coloured by row semantic type: `master` = `FFF1DD` (peach), `sub_bom` = `EEF4FB` (pale blue), `component` = `D6EAF8` (blue), `plain` = `F3F0FC` (lavender) (`ROW_TYPE_FILLS` CBB:2332–2337; `applyRowColors` CBB:4054–4064).
- **BR-EXP-07 (row-type classification)**: pack type → row type: `panel` → sub_bom, `prof` → component, `hard`/`cons` → plain, `shut` → sub_bom, `elen_bom` → sub_bom, else plain (`classifyRowType` CBB:2477–2484).
- **BR-EXP-08 (SKU suffixing)**: Cabinet/pack/part SKUs get suffix `-{SO number}` appended, but **only** when an SO is selected and it isn't `"Project"`/`"DRAFT"`: `skuSuffix = so && so !== "Project" && so !== "DRAFT" ? "-" + so : ""` (CBB:3048). Raw-material rows use the actual Zoho SKU of the user-selected raw item (or `-`) instead (CBB:2451–2470).
- **BR-EXP-09 (Sub Group naming)**: pack type → Sub Group: shutter → `Shutter`; `panel` → `Carcass Pack`; `prof` → `Profile Pack` (deliberately NOT "Profile" so the pack wrapper is excluded from the Opti sheet); `hard` → `Hardware`; `cons` → `Consumable`; `elen_bom` → `Elenor Light`; default `Carcass` (`subGroupFromPkType` CBB:2486–2497). Any item whose name contains "hardware pack" is re-grouped to Sub Group `Hardware Pack` (CBB:2522–2524).
- **BR-EXP-10 (stock/deficit/status per row)**: `In Stock` = stock map lookup by trimmed item name; `Deficit = max(0, Actual Qty − Eff. Stock)`; `Status` = "In Stock" / "Out of Stock" if the item exists in the stock map, else "Unknown" (CBB:2503–2506).
- **BR-EXP-11 (Pcs for stone)**: For stone items, `Pcs = round((Actual Qty ÷ slabArea) × 100)/100` where slabArea (sqft) is parsed from `HxW` in the item name as `(h×w)/(304.8²)`; blank if no dims found; `-` for non-stone (CBB:2508–2517, `parseSlabArea` CBB:2434).
- **BR-EXP-12 (Type extraction)**: `Type` column shows side/direction extracted from the item name: LH/RH/TP/BT combos like `LH(...) + RH(...)`, `LH/RH`, `TP/BT`, single `LH`/`RH`/`TP`/`BT`, else `-` (`extractSideType` CBB:2392–2406).
- **BR-EXP-13 (panel → raw material child)**: Every stone panel row gets a level+1 `Raw Material` child: carcass panels use raw key `carcass|{finish}|{thickness}` with **17% waste**; shutter panels `shutter|{finish}|{t or 6}` with **0% waste**. Raw SO Qty = panel sqft × per-parent qty; raw Actual Qty = sqft × total qty × (1+waste) — scaled by total panel qty so drawer packs/multi-unit projects don't under-count (CBB:2568–2600).
- **BR-EXP-14 (profile → raw child)**: Profile cut rows get a raw profile child in metres; waste = **20% for ELEN**, **25% for all other profiles**; HM-504 fallback raw name = `ALU FILLER PROFILE HM-504 SIZE 76X8.2 WITH ANODISED {FINISH} 3 MTR W 0.75 KG/MTR MINA` (CBB:2624–2650).
- **BR-EXP-15 (light cut rows)**: Linear light components (Elenor, counter band light) export as a cut piece `"{label} Cut {len}mm"` (Sub Group `Profile`, lands in Opti) over a **raw 3-mtr stock child** (Sub Group `Raw Material`, excluded from Opti) (`addLightCutRow` CBB:2655–2686 and comment CBB:2651–2654).
- **BR-EXP-16 (hardware pack explosion)**: Hardware rows matching `HARDWARE_PACK_DEFINITIONS` explode into level+1 component rows with qty = component qty × pack qty (CBB:2714–2729).
- **BR-EXP-17 (Profile Code)**: Filled for profile sub-groups via keyword mapping — SLF/HM-511, STP/HM-509, SINK/HM-510, ELEN/HM-519, DBS/HM-513, DBC/HM-535, MD1/MD2/MD3, CL1/CL2, CM1/CM2, NEON — else the 3 chars before the last dash of the item name (`extractProfileCode` CBB:2408–2432).
- **BR-EXP-18 (drawer box pack)**: `Drawer Pack- Cab Drawer Box` exports as a single Level-1 composite; children carry per-drawer qty (`p.qty / drawerCount`), profile children multiply by `q × drawerCount`, runner hardware sits flat under the pack (CBB:3120–3185).
- **AC-EXP-01**: Given a project with 2 cabinets and no SO selected, When Excel BOM is downloaded, Then the file is `Builder_BOM_Project_{date}.xlsx`, master SKUs have no `-SO` suffix, and S.No. runs 1,1,1…,2,2,2… per cabinet's row block.

#### Out of Stock sheet
- **BR-EXP-19 (qualification)**: OOS rows = all non-`master` Full-BOM rows with `Deficit > 0` (CBB:3981).
- **BR-EXP-20 (aggregation)**: Deduplicated by `SKU || trimmed Item`; on merge: `SO Qty` and `Actual Qty` are summed, `Deficit` recomputed as `max(0, ΣActual − In Stock)`, and the `SO` cell becomes the comma-joined set of contributing SO numbers; first-seen order preserved; `Pcs` always `-` (CBB:3982–4027).
- **BR-EXP-21 (columns)**: `SO, Main Group, Sub Group, BOM Path (always empty), Item, SKU, Type, Height, Width, Depth, Thickness, Finish, Grain, CF Type, Profile Code, SO Qty, Waste %, Actual Qty, Pcs, In Stock, Deficit, Unit` (OosRow CBB:2368–2390).
- **AC-EXP-02**: Given the same panel appears under two cabinets each with deficit, When exported, Then OOS shows one row with summed Actual Qty and deficit recomputed against single In Stock.

#### Opti sheet (cutting optimisation)
- **BR-EXP-22 (inclusion)**: Only OOS rows whose Sub Group (case-insensitive, exact match) is one of `OPTI_GROUPS = ["profile", "panels- sh", "panels- cab"]` (CBB:4030–4035). Consequences: raw 3-mtr light stock (Sub Group `Raw Material`) is excluded; the "Set of Profile …" pack wrapper is excluded because its Sub Group is `Profile Pack` (CBB:2490–2493, 2651–2654).
- **BR-EXP-23 (columns/mapping)**: `SO, Main Group, Group (=Sub Group), Item Name (=SKU||Item), Profile Code (row value or extracted from name), Type (=CF Type), Length (=Height), Width, Min Q. (=Deficit or 0), Thickness, Grain (empty), Finish` (CBB:4036–4051).
- **AC-EXP-03**: Given an Elenor light with deficit, When exported, Then its "…Cut {len}mm" piece appears in Opti but its 3-mtr raw stock item appears only in Out of Stock.

#### Accessories sheet
- **BR-EXP-24**: One row per enabled accessory per accessory-row, columns `SO, Carcass Items (comma-joined cabinet codes), Accessory, Selected, Item Name, Size, Elevation, Total, Actual Qty, Zoho Item ID`. Light-profile accessories explode to Profile (length with waste: `ceil(mm × (1+waste))`), LED (`len × ledMultiplier`), Diffuser, Wire (fixed `wireQty`), optional Tape, optional Driver (qty 1); skirting adds `SKIRTING STRAIGHT CONNECTOR` / `SKIRTING L CONNECTOR` rows when counts > 0. Chimney/Dishwasher "Other Accessory" rows export as `{label} - {color} ({profile} {profileColor})` with Size `{width}x{height}` (CBB:8291–8360).

#### Hardware items sheet
- **BR-EXP-25**: Aggregates all Full-BOM rows whose Sub Group ∈ {`Raw Material`, `Consumable`, `Hardware`} by trimmed item name; Quantity uses `Pcs` when numeric, else `Actual Qty`, summed and rounded to 3 dp; columns `Item, Group, Quantity, Unit` (CBB:4139–4189).

---

### 2. Export All Combinations (.xlsx)

#### UJ-EXP-02
1. User clicks header button **Export All Combinations (.xlsx)** (tooltip: "Download an Excel of every possible carcass combination (15mm, finish = ANY)") (CBB:8540–8547).
2. App enumerates every zone × family × variant × handle × width × height × handedness × inbuilt-drawer option, building each model with thickness 15 and placeholder design MD1 (CBB:7914–7960).
3. Single-sheet workbook `All Combinations` downloads as **`carcass-all-combinations-{rowCount}.xlsx`** with bold white-on-dark (`44403A`) header row (CBB:8070–8081).

#### BR — Enumeration rules (CBB:7924–7953)
- **BR-EXP-26**: Base zones (not `kind`, not `tall`) enumerate handles `["XCJ","STD"]`; all others only `["STD"]`.
- **BR-EXP-27**: Blind zones never enumerate double-door variants.
- **BR-EXP-28**: A handed single hinged variant (when the family also has a Double variant) is only enumerated up to W ≤ 600mm; the Double variant only above 600mm.
- **BR-EXP-29**: Base drawer families DW/HO variant `3dr` skip width 450.
- **BR-EXP-30**: Zone BC + family DW + variant `3dr` additionally enumerates the inbuilt `2HB + 1BL` branch, which yields a distinct carcass code (`…-2HB-1BL-…` vs `…-2LB-1HB-…`) (CBB:7943–7945).
- **BR-EXP-31**: Any combination the model engine throws on is silently skipped.

#### BR — Per-row columns (CBB:7994–8027, header CBB:8055–8065)
- **BR-EXP-32**: Columns: `Cabinet Code, Zone Key, Zone Name, Family Key, Family Name, Variant Id, Variant Label, Inbuilt Drawers ("2HB + 1BL" or "—"), Handed, P1–P4 (the 4 dash-separated code parts), Handle, Width, Height, Depth, Thickness, Construction, Mount, Tall?, Blind?, Low-depth?, Finish (always "ANY"), Carcass Net Sqft, # Panels, # Shutters, Shelf Qty, Shelf Sqft, Drawers Bottom Sqft, Drawer Back Sqft, Fascia Sqft, Shutter Sqft, Side Spec`, then one `Design {code}` Yes/No column per shutter design profile in canonical `SH_DESIGNS` order (`MD1, MD2, MD3, MD1CM1, MD1CM2, MD2CM1, MD2CM2, MD3CM1, MD3CM2, CL1, CL2, NEON20`; unknown codes appended sorted) (CBB:8040–8053; SH_DESIGNS CBB:774).
- **BR-EXP-33 (sqft formulas, single cabinet, no waste, 3-dp rounding)**: `Shutter Sqft = Σ sqft(pw,ph)` over shutters; panels classified by name regex — `/Drawer Box Fascia/` → Fascia Sqft, `/Drawer Box Back/` → Drawer Back Sqft, `/Drawer Box Bottom/` → Drawers Bottom Sqft, `/shelf/` → Shelf Sqft + Shelf Qty (+= p.qty); glass shelves parsed from pkRows Sub Group `glass shelf` with W×D from the item name, added to Shelf Sqft/Qty (CBB:7972–7993).
- **AC-EXP-04**: Given the export, When opened, Then every enumerated cabinet has a Yes/No cell for each design code indicating whether that shutter design is valid for it (`validDesigns`) (CBB:7956–7959, 8046–8052).

#### Export All Shutter Codes (.xlsx) — sibling export
- **BR-EXP-34**: Same enumeration plus fan-out over every valid design; rows **de-duplicated by shutter code** (unique universe of shutter codes, 15mm, finish ANY); sheet `All Shutter Codes`, file `shutter-all-codes-{n}.xlsx`; columns `Shutter Code, Cabinet Code, Zone/Family/Variant fields, Inbuilt Drawers, Design, Handle, Handed, Kind, Loc, Shutter W/H, Panel W/H, Face Thk (5 for glass, else by design), Face ("Glass" / "Fixed Stone Panel" / "Stone"), Profile V (mm), Profile H (mm), Hinge, Hinge Qty, Cabinet W/H/D` (CBB:8076–8290).

---

### 3. Packing List (.xls, HTML)

#### UJ-EXP-03
1. User picks Packing/Labels filter: `Both (Carcass & Shutter)` / `Carcass Only` / `Shutter Only` (CBB:10539–10556).
2. User clicks **Packing List (.xls)**; file downloads as `{sanitized SO}-packing-list[-carcass|-shutter].xls` (SO falls back to `DRAFT`, customer to `—`, date to today) — actually an HTML table served as `application/vnd.ms-excel` (CBB:8421–8429).

#### BR — Document content (`buildBuilderPackingHtml` CBB:4243–4460)
- **BR-EXP-35 (header block)**: Title `PACKING LIST`, company `MAGPPIE LIVING PRIVATE LIMITED`, address `PLOT NO- 68, SECTOR- 03, IMT MANESAR GURUGRAM, HARYANA-122050`, then labelled rows: `MRP NO / COMPLAINT NO :- {SO}`, `DATE :- {SO date}`, `CUSTOMER NAME : {customer}`, `PRODUCT : KITCHEN`, blank `DESTINATION`, `VEHICLE NO`, `PAPER PERSON`, `CONTACT NUMBER` (CBB:4432–4456).
- **BR-EXP-36 (columns)**: Both carcass and shutter sections use: `S.NO. | ITEM NAME - CARCASS/SHUTTER | ITEM COLOR | PACK | PCS | BOX | BOX DIMENSION ( L x W x H )` (CBB:4358–4370).
- **BR-EXP-37 (carcass section)**: One heading row per cabinet — letter `A.`, `B.`… + `{cabinet code} ×{qty}` — followed by one row **per box**: pack rows are all pkRows except types shut/hard/cons; total boxes = pack qty × line qty; pack numbering is a single running counter across the whole document (`PACK - n`) (CBB:4258–4293).
- **BR-EXP-38 (set-of-parts rule)**: An item whose name contains "set of parts" packs **2 pcs per box**; all others 1 (CBB:4274–4276, mirrored in labels CBB:4510).
- **BR-EXP-39 (box dimension formula)**: From `WxHxT` in the item dims: box = `(W+20) x (H+20) x (T+20)`, except sets where thickness = `T×2 + 20` (padding constant 20) (`calcBoxDimension` CBB:4218–4229).
- **BR-EXP-40 (shutter section)**: Each shutter's full code is its own lettered heading (`{shutter code} ×{qty}`); under it the assembled item `Parts- SH {pw}x{ph} {design}` with color = shutter finish; box dimension computed from `{w}x{h}x{shutter thickness}` (CBB:4306–4335).
- **BR-EXP-41 (shutter thickness by design)**: face thickness = **5mm** for glass shutters, **9mm** for MD3/MD3CM1/MD3CM2, **6mm** otherwise (`shThkOf` CBB:782–786; used at CBB:4310).
- **BR-EXP-42 (hardware/consumable collection & filter)**: All `hard` pkRows are aggregated by name into a final "HARDWARE PACK & OTHER ITEMS" section (single shared `PACK - n`, BOX 1, rows merged via rowspan). Filter split uses `isShutterHardware(name)` = name contains `HINGE` or `CORNER CONNECTOR` (uppercased): Carcass-only export drops shutter hardware, Shutter-only drops the rest. Consumables join the hardware section; `isShutterConsumable` always returns false so consumables only appear on Carcass/Both exports (CBB:4234–4241, 4337–4413).
- **BR-EXP-43 (glue rounding)**: Items containing "glue silicone" show pcs = `ceil(qty / 270)`; all other hardware pcs = `ceil(qty)` (CBB:4393–4395).
- **DC-EXP-01**: Empty project renders a single row "No items in the project."; document styled Times New Roman, bordered table, section heads shaded (`#e8e4df` carcass / `#e4e8ef` shutter / `#f0f0f0` hardware) (CBB:4358–4429).
- **AC-EXP-05**: Given a cabinet with a "Set of Parts- …" pack sized 690x560x15 qty 1 and line qty 2, When the packing list is exported, Then 2 box rows print, each PCS=2, box dimension `710x580x50`.

---

### 4. Labels (PDF)

#### UJ-EXP-04
1. Same filter dropdown applies; user clicks **Labels (PDF)** → `{sanitized SO}-labels[-filter].pdf` (CBB:8431–8437).
2. One 150×100mm landscape page per box (`buildBuilderLabelsPdf` CBB:4479–4614): pkRows minus hard/cons; shut rows use shutter finish and group "Shutter", others carcass finish/"Carcass"; boxes = qty × line qty; "set of parts" = 2 pcs/box.
- **BR-EXP-44 (label content)**: Border; `MAGPPIE` + item name header; From block (MAGPPIE LIVING PVT LTD, Plot No-68, Sector-03, IMT Manesar, Gurugram, Haryana - 122050) and To block (customer + SO); **CODE128 barcode of the cabinet code** and **QR code of `{SO}\n{customer}`**; footer: global `Box i of N` (all labels), per-item `Box b of B | p pcs`, Finish, Dim (extracted from item name), and right-aligned SO, cabinet code, group CARCASS/SHUTTER (CBB:4540–4610; barcode CBB:4448–4472).

---

### 5. CSV export / preview

- **UJ-EXP-05**: The "⑬ CSV Preview" card shows live CSV in a read-only monospace textarea; **CSV** downloads it as `carcass_bom.csv`; **copy csv** copies to clipboard and flips the button label to "copied" (CBB:7849–7908, 10562–10573).
- **BR-EXP-45 (format)**: Header `SN,Item Name,Pack Name,Cabinet Code,UoM,Qty`. Rows are flat per-cabinet raw rows (panels, profiles as `{name} {len}mm`, hardware, consumables, glass shelf, shutter parts + `Profile LH/RH ({design}) {len}mm` ×2 + `Profile TP/BT ({design}) {len}mm` ×2 + corner connector + hinge), aggregated by (cabinet code, item, pack, uom) with qty × line qty summed; non-integers rounded to 3 dp; CSV-escaped (`buildCSV` CBB:2282–2307, `buildRawRows` CBB:2256–2280).
- **BR-EXP-46**: Glass-family shutters export raw item `GLASS TOUGH EP {pw}X{ph}X5 {SHUTTER FINISH|CLEAR} SKV`; stone shutters `Panels- SH {pw}x{ph}x{thk} {design}`; a blind cabinet's fixed dummy panel is always stone 6mm even in glass families (CBB:2266–2271).

---

### 6. QR route `/qr/bom/[orderId]`

- **UJ-EXP-06**: Scanning/visiting `/qr/bom/{orderId}` renders a public read-only page titled "BOM Items / BOM Backorder Report" that loads the sales order's BOM report live and displays `{SO number} · BOM Items` with the per-order BOM card; shows a loading state and an error message on failure (`src/app/qr/bom/[orderId]/page.tsx:1-6`, `src/components/QrBomPage.tsx:17-56`, data via `src/lib/report.ts` `loadBomReport`).

---

### 7. Print behavior

- **DC-EXP-02**: The Builder itself has no print button — its printable outputs are the downloaded packing-list HTML/.xls and labels PDF. Browser print (`window.print()`) and a "Print Labels" action exist only on the BOM Dashboard (`src/components/BomDashboard.tsx:1439-1440, 2088`), outside the Builder.
- **DC-EXP-03**: All Builder downloads are client-side blob downloads via a temporary anchor (`downloadBlob` CBB:4616–4623; XLSX via `XLSX.writeFile`); filenames are sanitized to `[a-z0-9-]` (`sanitizeFilename` CBB:4204).
- **DC-EXP-04**: The Downloads and CSV Preview cards are hidden until the project has at least one line (`project.length > 0` guards, CBB:10535, 10569).


# Section 5 — Zoho Inventory Integration

Scope: user-visible Zoho behavior — connection/status, token handling, SO search/select, raw-material selection, and the "Add to Zoho Sales Order" push. Waste constants referenced throughout: `STONE_WASTE = 0.15`, `PROFILE_WASTE = 0.20`, `ELENOR_WASTE = 0.10` (src/components/CarcassBomBuilder.tsx:435-437).

---

### 1. Connection status & token behavior

#### UJ-Z1: Dashboard connection check
1. On opening the BOM Dashboard, the app automatically calls the Zoho status check (src/components/BomDashboard.tsx:666).
2. While checking, the banner reads "Checking Zoho Inventory...".
3. On success it shows "Live Zoho Inventory connected" with the organization name and organization ID; on failure it shows "Zoho Inventory not connected" plus the error text (src/components/BomDashboard.tsx:1479-1487).
4. A "Check" button re-runs the status check on demand (disabled while checking) (src/components/BomDashboard.tsx:1493-1495).
5. With auto-refresh enabled, the connection (or the loaded report) is re-checked every 10 minutes; the banner shows "Auto refresh: 10 min · Next HH:MM:SS" or "Auto refresh: off" (src/components/BomDashboard.tsx:692-712, 1488-1492).

#### BR-Z1: Status endpoint content
When `/api/zoho/status` is called, the server fetches Zoho `/organizations`, matches the configured `ZOHO_ORGANIZATION_ID`, and returns `{ok, organizationId, organizationName, inventoryBaseUrl, tokenCached, checkedAt}`; any failure returns `{ok:false, error}` with HTTP 500 (src/app/api/zoho/status/route.ts:14-30).

#### BR-Z2: Access-token caching & refresh
- Access token is cached in memory and on disk at `$TMPDIR/magppie-cache/zoho-access-token.json`; it is reused while more than 5 minutes (`TOKEN_REFRESH_SKEW_MS = 5*60*1000`) remain before expiry (src/lib/zoho.ts:24-26, 47-49, 123-128).
- A refreshed token's expiry = now + `expires_in` (default 3600 s) − 30 s (src/lib/zoho.ts:114-117).
- Concurrent requests share a single in-flight refresh promise (src/lib/zoho.ts:135-141).

#### BR-Z3: Refresh cooldown (rate-limit backoff)
When Zoho's token endpoint responds with a body containing "too many requests" or "access denied", the app blocks further refresh attempts for 5 minutes (`TOKEN_BACKOFF_MS = 5*60*1000`). During the block, any Zoho call fails with "Zoho token refresh is cooling down. Try again in about N seconds." (src/lib/zoho.ts:83-133).

#### BR-Z4: Automatic 401 retry
Any Zoho Inventory request that returns HTTP 401 or Zoho error code 57/14 clears the token cache, refreshes once, and retries the same request once; if still failing, the raw Zoho error body is surfaced (src/lib/zoho.ts:213-222).

#### BR-Z5: User-facing error translation
Server errors are converted: cooldown messages pass through verbatim; "too many requests" becomes "Zoho is temporarily blocking token refresh because too many refresh requests were made. The app will reuse cached tokens and wait before trying again."; other errors surface their message (src/lib/zoho.ts:227-242).

#### DC-Z1: Regional endpoints
Defaults: accounts base `https://accounts.zoho.in`, inventory base `https://www.zohoapis.in/inventory/v1`; overridable by env vars `ZOHO_ACCOUNTS_BASE_URL` / `ZOHO_INVENTORY_BASE_URL`. Every request carries `organization_id` as a query param (src/lib/zoho.ts:39-45, 156-165).

#### BR-Z6: API route inventory (what each serves)
- `GET /api/zoho/status` — org connectivity + token-cached flag (src/app/api/zoho/status/route.ts).
- `GET /api/zoho/salesorders?q=&status=` — SO search via Zoho `search_text`, `per_page=50`; queries shorter than 2 characters return an empty list without hitting Zoho (src/app/api/zoho/salesorders/route.ts:12-27).
- `GET/PUT /api/zoho/salesorders/[id]` — SO detail fetch / line-item update (src/app/api/zoho/salesorders/[id]/route.ts).
- `GET /api/zoho/items?search=|name=` — item search (`search_text` / `name_contains`, `per_page=200`); `POST` creates an item (src/app/api/zoho/items/route.ts).
- `GET/PUT /api/zoho/items/[id]` — item detail / update (src/app/api/zoho/items/[id]/route.ts).
- `POST /api/zoho/compositeitems` — create composite; `GET/PUT /api/zoho/compositeitems/[id]` — composite detail / update (src/app/api/zoho/compositeitems/*).
- `GET /api/zoho/contacts?contact_type=vendor&search=` — contact search (default vendors, per_page 200); `GET /api/zoho/contacts/[id]` — contact detail incl. custom-field reads (src/app/api/zoho/contacts/*).
- `GET/POST /api/zoho/purchaseorders` — recent-PO lookup per item (sorted by date desc) and PO creation, returning a deep link to the Zoho web UI PO page (src/app/api/zoho/purchaseorders/route.ts:4-40).
- `GET /api/zoho/items/[id]/vendors` — vendor options for an item with last PO number/date/rate (src/app/api/zoho/items/[id]/vendors/route.ts).
- `GET /api/zoho/po-vendor-map` — batch vendor-history map from recent POs (src/app/api/zoho/po-vendor-map/route.ts).
- `GET /api/zoho/reorder-report` — items vs reorder level with stock and vendor info (src/app/api/zoho/reorder-report/route.ts).

---

### 2. Sales Order search & select (Builder/Planning "Project" tab)

#### UJ-Z2: Find and select a Sales Order
1. In the "① Zoho Sales Order" card the user types into "Search Sales Order" (placeholder "Type SO-00001 or Customer...") (src/components/CarcassBomBuilder.tsx:9127-9138).
2. After a 500 ms debounce and minimum 2 characters, matching SOs load from Zoho (src/components/CarcassBomBuilder.tsx:5848-5873).
3. A dropdown lists each result as "**SO-number** — Customer name"; clicking one selects it and fills the search box with the SO number (src/components/CarcassBomBuilder.tsx:9163-9199).
4. A confirmation strip shows "Selected: SO-number · Customer: name · Status: status" (src/components/CarcassBomBuilder.tsx:9202-9214).
5. Selecting an SO auto-fetches its full detail (line items) with a "Loading Sales Order line items & materials..." indicator in the Raw Material card (src/components/CarcassBomBuilder.tsx:5875-5894, 9969-9972).

#### BR-Z7: SO search error surfacing
If the search API fails (e.g. token cooldown), the dropdown is cleared and a red "⚠ {Zoho error}" / "Sales Order search failed — network error." message appears under the search box (src/components/CarcassBomBuilder.tsx:5861-5869, 9157-9161).

#### BR-Z8: SO-mode reverse decode
On the /designer and /planning pages (`soMode`), selecting an SO replaces the Project: every SO line's cabinet code (read from `sku`, then `name`, then `description` — service lines carry the code in description) is decoded back into a cabinet model with the line's qty and rate. Clearing the SO does not wipe the project (so an Excel upload can stand) (src/components/CarcassBomBuilder.tsx:5896-5911).

#### DC-Z2: Page variants
- /builder: full builder, SO card visible.
- /designer: `soMode` — SO card replaced by "① Upload Cabinet Codes (.xls)" Excel upload (src/components/CarcassBomBuilder.tsx:9122-9123, 9234-9291; src/app/designer/page.tsx).
- /planning: `soMode + planningMode` (src/app/planning/page.tsx).

#### DC-Z3: Add-button gating
"Add to Zoho Sales Order" is disabled (60% opacity, not-allowed cursor) unless an SO is selected and no push is running; while running it reads "Processing..." (src/components/CarcassBomBuilder.tsx:9141-9153).

#### DC-Z4: Live progress log
During the push, a monospace status strip streams step messages ("Resolving Drilling, Cutting, and Packing Service items...", "Creating BOM Level 4 Panel: …", etc.); error states render on a red background with the text prefixed "Error:" (src/components/CarcassBomBuilder.tsx:6004-6892, 9216-9230).

---

### 3. Raw Material Selection (⑨ card)

#### UJ-Z3: Select raw materials per aggregated bucket
1. The card header shows the aggregation source: "Aggregated from SO: {number}" / "Aggregated from Project: N units" / "Select a Sales Order to load materials" (soMode, empty) / "Aggregated from Configured Unit (Fallback)" (src/components/CarcassBomBuilder.tsx:9957-9965; activeItems priority src:7231-7249).
2. Materials are grouped into Carcass → Stones/Profiles, Shutter → Stones/Profiles, and Hardware & Consumables sections (src/components/CarcassBomBuilder.tsx:9976-10288).
3. For each stone bucket "Stone — {finish} ({thickness}mm)" a searchable dropdown lists matching Zoho items labelled "{name} ({sku})"; the first result is auto-selected (existing selections are kept) (src/components/CarcassBomBuilder.tsx:7534-7560, 10018-10023).
4. Selecting an item shows SKU, Stock (stock_on_hand, or "N/A"), Slab Size "{cf_height}x{cf_width}mm ({area} sqft)", "Calculated Slabs: X.XX pcs" and an editable "Actual Slabs" number input (customPcsMap) (src/components/CarcassBomBuilder.tsx:10024-10041).
5. Profiles and hardware rows show a similar dropdown plus SKU · Stock chip.

#### BR-Z9: Aggregation buckets & keys
- Carcass stone: keyed `carcass|{finish}|{thickness}`, netSqft summed from each model × qty (src/components/CarcassBomBuilder.tsx:7258-7271).
- Shutter stone: keyed `shutter|{finish}|{thickness}`; per-shutter thickness is design-driven (`MD3/MD3CM1/MD3CM2` = 9 mm, else 6 mm; glass faces = 5 mm and are excluded from stone), glass-family fixed panels use the fixed-panel shade (src/components/CarcassBomBuilder.tsx:782-787, 7274-7297).
- Carcass profile: `carcass|{profileCode}|{finish}`; length = Σ(len×qty)/1000 m. Shutter profile: `shutter|{design}|{finish}`; length = (2·profV + 2·profH)/1000 per shutter (src/components/CarcassBomBuilder.tsx:7299-7334).
- Hardware: named hardware packs found in `HARDWARE_PACK_DEFINITIONS` are exploded into their components with qty = comp.qty × pack.qty × line qty; others aggregate as-is (src/components/CarcassBomBuilder.tsx:7336-7354).
- Fillers, Visible Panels, Backsplash, Countertop and Other Accessories all add their own stone/profile/consumable buckets (e.g. backsplash glue "GLUE LATRICATE SUPER FLEX 20KG XX WHITE 335 AGG" at 1.25 kg/sqft; countertop consumables AKEMI polish 10 g/sqft, Bondtite 10 g/sqft, Dowsil silicone 40 ml/sqft; countertop dead-stock bucket `shutter|DEAD STOCK|{T/2}`) (src/components/CarcassBomBuilder.tsx:7366-7512).

#### BR-Z10: Net vs +waste display
- Stones show "Net: X.XX sqft | Total (+15%): Y.YY sqft" where Y = net × 1.15 (src/components/CarcassBomBuilder.tsx:9994, 10005).
- Profiles show "Net: X.XXm | Total (+{waste}%): Y.YYm" where waste = 10% for ELEN, 20% otherwise (src/components/CarcassBomBuilder.tsx:10066-10073).
- Calculated Slabs = (net × 1.15) / slabArea, rounded to 2 dp; slabArea = cf_height × cf_width / 92903.04 (mm²→sqft) (src/components/CarcassBomBuilder.tsx:7217-7224, 9993-9996).

#### BR-Z11: Slab-dimension warning
If the selected stone item lacks positive `cf_height`/`cf_width`, the detail box shows "Slab dimensions missing in Zoho custom fields (cf_height / cf_width)." and no slab count is computed (src/components/CarcassBomBuilder.tsx:10038-10040).

#### BR-Z12: Stone search matching rules (`searchStoneItems`)
- Sequential Zoho queries: `STONE {thickness}`, then `{finish}`, then `STONE`; results deduped by item_id; first query that yields ranked hits wins (src/lib/rawmaterial.ts:658-679).
- Item must be non-composite and stone-flagged (cf_group / group_name / name contains "stone") (src/lib/rawmaterial.ts:608-615).
- Thickness comes from `cf_thickness` OR is parsed from the item name: last dimension of "W×H×T" (e.g. "2800X1200X15" → 15) or an "NNMM" token of ≤2 digits (e.g. "06MM" → 6); large "2800MM" is ignored (src/lib/rawmaterial.ts:620-627).
- Ranking: exact finish matches (cf_finish or name contains the full requested finish) with matching thickness first, then "core" matches where colour-qualifier words are optional — the set `black, white, grey, gray, beige, cream, brown, gold, golden, silver, ivory, green, blue, red, pink, sand, taupe, charcoal, dark, light` is dropped and every remaining token must appear (so "BLACK STATUARIO NUVOLATO" matches a "STATUARIO NUVOLATO" slab) (src/lib/rawmaterial.ts:599-654).
- If nothing matches the thickness, last resort returns core-finish matches of any thickness (paired with the UI's "No matching {t}mm stone items" style warnings); if every query fails at network level the error is thrown so the UI shows the retry state (src/lib/rawmaterial.ts:681-686).

#### BR-Z13: Profile search matching rules (`searchProfileItems`)
- Profile-code equivalences (either alias matches): HM509↔STP, HM511↔SLF, HM510↔SINK, HM519↔ELEN, HM513↔DBS, HM535↔DBC; MD1CM1/MD2CM1→CM1, MD1CM2/MD2CM2→CM2; hyphenated and non-hyphenated `hm###`/`hm-###` forms are both searched (src/lib/rawmaterial.ts:688-711, 772-781).
- All aliases plus the finish are searched concurrently; results deduped; a match requires profile-code presence in cf_profile_code/name/sku AND finish presence in cf_finish/name (src/lib/rawmaterial.ts:783-825).
- Fallback 1: relax finish, match code in name/SKU only. Fallback 2: return a synthetic option named "{DEFAULT_PROFILE_NAME} (Not in Zoho - Will Create)" with id `MOCK_CREATE|{name}`; the default names table maps codes to canonical item names (e.g. `elen/hm519` → "ALU PROF FOR ELENOR 3000X15X15 ANODISED CHAMPAGNE HM-519 MINA", `stp/hm509` → "ALU PROF FOR STEPPER 3000X31.5X22 ANODISED CHAMPAGNE MG-01 VARN", `slf/hm511` → "ALU PROF FOR SHELF 3000X22X1.2 W/OUT ANODISED HM-511 VARN", `sink/hm510` → "ALU PROF FOR SINK NEW 3000X27X22 ANODISED CHAMPAGNE HM-510 MINA", `dbs/hm513`, `dbc/hm535`, plus skirting/duplay/lprofile/grand/md1/md2/cl1/cl2/cm1/cm2/neon20 entries); non-CHAMPAGNE finishes substitute the finish word ("WITHOUT/W/OUT/UNANODISED" replaces the whole "ANODISED CHAMPAGNE") (src/lib/rawmaterial.ts:713-857).

#### BR-Z14: Hardware search
Hardware/consumable dropdowns search Zoho by exact item name and filter out composites; an exact case-insensitive name match is auto-selected, else the first result (src/lib/rawmaterial.ts:860-865; src/components/CarcassBomBuilder.tsx:7587-7602).

#### AC-Z1: Fetch error & retry
Given a bucket's Zoho fetch fails, When the card renders, Then that bucket shows "⚠ Zoho API error — check your network connection." with a per-bucket "Retry" button, and a "↻ Retry All" button appears in the card header; Retry clears the cached options/error so the effect re-fetches (src/components/CarcassBomBuilder.tsx:7521-7531, 9954-9956, 10009-10013).

#### AC-Z2: Empty results
Given no Zoho items match, Then the bucket shows "No matching {thickness}mm stone items found in Zoho for finish "{finish}"." (stones) / "No matching profile items found in Zoho for finish "{finish}" with code "{code}"." (profiles) / "No matching items found in Zoho for "{name}"." (hardware) (src/components/CarcassBomBuilder.tsx:10014-10015, 10082-10083, 10266-10267).

#### UJ-Z4: Add a new stone finish to Zoho
1. User opens the "Add finish" modal, enters finish name and thickness.
2. On save, an item named/SKU'd `STONE {t}MM {FINISH}` is created in Zoho with cf_group=Stone, cf_finish, cf_thickness, cf_height=2800, cf_width=1200, unit pcs, sale/purchase/inventory accounts and taxable flags (src/components/CarcassBomBuilder.tsx:5734-5794).
3. The finish list updates locally and the new finish is auto-selected for the target (carcass sets thickness too); success closes the modal after ~1 s; failures show the Zoho error (src/components/CarcassBomBuilder.tsx:5800-5834).

---

### 4. Add to Zoho Sales Order (handleAddToZohoSO)

#### UJ-Z5: End-to-end push
1. User selects an SO and clicks "Add to Zoho Sales Order" (button disabled otherwise).
2. Items to push = all project lines, or (Builder fallback) the single currently-configured cabinet with its qty/rate/elevation (src/components/CarcassBomBuilder.tsx:6015-6018).
3. Step 1 resolves five service/packing items by name (create-if-missing): "Cutting-1", "Drilling-1" (services), "Packing Item - Carcass", "Packing Item - Shutter", "Packing Item - Hardware" (src/components/CarcassBomBuilder.tsx:6007-6013).
4. For each cabinet, the full composite BOM tree is created bottom-up in Zoho (Panels → Parts → Sets/Drawer Packs → Shutters → Cabinet), then Other Accessories are built, then the SO is updated in one PUT (src/components/CarcassBomBuilder.tsx:6020-6886).
5. Final message: "Sales Order {number} updated — N service item(s) replaced with BOMs, M added." (src/components/CarcassBomBuilder.tsx:6886).

#### BR-Z15: Mandatory raw selections (user-visible aborts)
The push aborts with an alert-style error message if any needed selection is missing:
- "Carcass stone raw material not selected for finish "{finish}" ({t}mm) in cabinet "{code}". Please choose a raw material selection first." (src:6034-6036)
- "Shutter stone raw material not selected for finish "{finish}" ({t}mm) in cabinet "{code}"…" (src:6068-6070)
- "Raw profile item not selected for carcass profile: "{type}" ({finish})" (src:6192-6193, 6430-6431)
- "Raw profile item not selected for shutter profile design: "{design}" ({finish})" (src:6556-6557)
- "Stone raw material not selected for Other Accessory "{label}" finish "{colour}" (6mm)…" (src:6772-6774)
Token/Zoho errors bubble into the red status strip as "Error: {message}" (src:6887-6889).

#### BR-Z16: Idempotent item resolution
- `resolveSimpleItem(name)`: normalizes the name, searches Zoho by `search` then `name_contains`, matching on normalized name OR SKU; if found returns its id, else creates the item (rate 0, accounts 3418412000000000486 / 3418412000000000567 / inventory 3418412000000000626, taxable, track_inventory for goods, `product_type:"service"` for services) with any provided cf_group/sub_group/finish/thickness/height/width/depth custom fields (src/components/CarcassBomBuilder.tsx:4943-5027).
- `resolveCompositeItem(name, sku, mapped, cf)`: names/SKUs truncated to 100 chars; reuses any existing item of the same normalized name; if the composite would have a single child with qty ≤ 1, a Drilling-1 service line is auto-appended (avoids Zoho error 2056); creates via POST /compositeitems with unit "pcs" and the same accounts/custom fields (src/components/CarcassBomBuilder.tsx:5029-5102).
- `findExistingCompositeByRawMaterial(rawId, name)`: a same-named composite is only reused when its mapped items actually contain the currently selected raw stone/profile — otherwise a new SO-prefixed composite is created (src/components/CarcassBomBuilder.tsx:5104-5139).

#### BR-Z17: SO-prefix (dedup) rule
Before building, the app checks whether a panel composite for this cabinet's stone already exists containing the selected raw material. If yes, names are created WITHOUT prefix (reuse); if no, every newly created composite name/SKU is prefixed with the SO number (e.g. "SO-00123 Panel …"). Carcass and shutter sides evaluate this independently (src/components/CarcassBomBuilder.tsx:6105-6109, 6486-6497).

#### BR-Z18: Composite structure per cabinet (order of creation)
1. **Panel (Level 4)**: name `Panel {panel} {finish}` (via getPanelBaseName/normalizePartOrPanelName; src/lib/naming.ts:148-160). Mapped items: selected raw stone at qty = round₄(panelSqft × 1.15 / slabArea) (slab fraction; falls back to raw sqft if slab area unknown) + "Cutting-1" ×1. cf: group "Panels- Cab", sub_group = zone name, finish, thickness, height, width (src:6280-6316).
2. **Part (Level 3)**: only for panels with a drill spec (not blank/"no drill"): `Part {panel} {drill} {finish}` containing the Panel ×1 + Drilling-1 ×1; cf group "Part Cab". Combined "LH/RH" panels split into separate LH and RH Parts (each qty p.qty/2, drill split on "/"); "TP/BT" splits into Top/Bottom Parts (src:6318-6413).
3. **Set of Parts (Level 2)**: `{packName} {finish}` (e.g. "Set of Parts- … STATUARIO") containing all Parts/Panels, profile sets, and one "Packing Item - Carcass"; cf group "Carcass Pack" with cabinet dims (src:6460-6478).
4. **Drawer Pack**: packs starting "Drawer Pack- Cab Drawer Box"/"Drawer Pack- Cab Pullout Shelf" hold per-drawer quantities (each child qty divided by drawerCount, derived from the back/base panel qty) and include drawer hardware INSIDE the pack — named "HARDWARE PACK …" items resolve via the pack definitions (built-in), everything else wraps as `Pack Hardware {name} x{qty}`; DBC (HM-535) center profiles become flat cut composites `{name} {len}mm {finish}` (raw + Cutting-1, len×1.20 waste in metres, 4-dp); the pack composite enters the cabinet at quantity = drawerCount (src:6133-6274).
5. **Profile sets** (resolveProfileBOM, src:5143-5332): per length, a Profile Panel `{cleaned} {len}mm {finish}` = raw profile qty round₄((len/1000)×1.20 (ELEN 1.10)) + Cutting-1. No-drill codes {STP, ELEN, SLF, SINK}: panels go straight into sub-sets `Set of Profile {code} {finish} (LH/RH|TP/BT)` wrapped by a parent `Set of Profile {code} {finish} LH/RH+TP/BT`; ELEN itself is skipped entirely (handled by Elenor composite). Drill codes: each side becomes `Part Profile LH/RH/Top/Bottom {name} {len}mm {finish}` (panel + Drilling-1) grouped into `Set of Profile Parts {code} {finish} …`. Vertical shutter profile sets carry per-side drill tags mirroring the carcass side panels (src:6564-6580).
6. **Shutters**: per shutter — stone face panel `Panel Shutter {pw}x{ph}x{t} {finish}` (stone + Cutting-1, +15% waste, slab-normalized) OR for glass families a simple Glass item named exactly `GLASS TOUGH EP {pw}X{ph}X5 {COLOR} SKV` (group "Glass"); plus its profile sets, a corner-connector hardware pack, and Packing Item - Shutter ×1 → composite `{shutterCode} Ready` (cf group "Shutter Panel Pack", thickness "6"). Then `{shutterCode}` = Ready ×1 + fitting hinge pack ×1 (cf group "Shutters") (src:6499-6628).
7. **Hinge/fitting packs**: names starting "HARDWARE PACK" resolve through `resolveHardwarePackComposite` — reuse by name; if the name is in `HARDWARE_PACK_DEFINITIONS` a composite is created from its components (each resolved/created as simple items, cf group "Hardware Part"), otherwise it is created as a plain Set item (src:5518-5546). Non-pack hardware wraps as composite `Pack Hardware {name} x{qty}` = hardware ×qty + Packing Item - Hardware ×1 (src:5548-5565).
8. **Cabinet-level hardware/consumables** (not in Elenor/Drawer/Set packs): hardware as packs (above); consumables as simple items with their UOM (src:6638-6664). Glass shelf resolves as a simple Glass CLEAR item (src:6667-6672).
9. **Elenor composite**: for each pack named "Elenor with Light…", a composite of: per profile piece a cut composite `Elenor Profile Cut {len}mm` (raw 3 m stock in metres + Cutting-1); LED/diffuser consumables become `LED Light Cut {len}mm` / `Diffuser Cut {len}mm` cut composites ×2 at the same Elenor length; tape/wire stay raw simple items; Elenor hardware as simple items. cf group "Elenor Light"; enters the cabinet at the elen_bom row qty (src:6674-6744).
10. **Cabinet (Level 1)**: composite named the cabinet code (SO-prefixed when new), containing all packet composites + shutter BOMs + loose hardware/consumables/Elenor; cf: group "Carcass", sub_group = zone name, finish, thickness, height, width, depth (src:6746-6753).

#### BR-Z19: Custom fields written to Zoho
Every created item/composite may carry cf_group, cf_sub_group, cf_finish, cf_thickness, cf_height, cf_width, cf_depth (values as listed per level above) (src/components/CarcassBomBuilder.tsx:4975-4982, 5063-5070). (Note: cf_sqft is read for defaults elsewhere but not written by the builder push.)

#### BR-Z20: HARDWARE_PACK_DEFINITIONS (built-in pack names, verbatim)
(src/components/CarcassBomBuilder.tsx:5334-5516)
- HARDWARE PACK 3D HINGE 0 CRANK Set/3, Set/4, Set/6
- HARDWARE PACK HINGE 0 CRANK CARCASS Set/3
- HARDWARE PACK SLIM HINGE FOR GLASS Set/3, Set/4, Set/5, Set/6
- HARDWARE PACK HINGE W/OUT SOFT CLOSE Set/3, Set/4, Set/5, Set/6
- HARDWARE PACK SLIM HINGE 0 CRANK Set/3, Set/5
- HARDWARE PACK BLIND HINGE 0 CRANK Set/3, Set/4, Set/6
- HARDWARE PACK PVC LEG SET/2, SET/4, SET/6
- HARDWARE PACK CARCASS FIXING HPL 4 SET/1
- HARDWARE PACK LOW BACK DRAWER H90 SET/1, SET/2, SET/3
- HARDWARE PACK HIGH BACK DRAWER H175 SET/2
- HARDWARE PACK HIGH BACK DRAWER H239 SET/1, SET/2
- HARDWARE PACK WALL HANGER BRACKET SET/1
- HARDWARE PACK HB DRAWER 600MM FIXING SET/1
- HARDWARE PACK DRAWER 450MM FIXING SET/1, 600MM SET/1, 900MM SET/1
- HARDWARE PACK BOTTLE PULLOUT 150MM SET/1, 300MM SET/1
- HARDWARE PACK KAKU FITTING SET/4, SET/2
Each expands to exact component names/qtys/UOMs (e.g. "3D HINGE Set/3" = HINGE 0 CRANK SOFT CLOSE 5 HOLE XX BLACK 3D MS CRY ×3 PCS + SCREW FOR CHIP BOARD 16XX4 SS 304 CINE ×12 PCS + DOOR BUMPERS 12.0 MM X 3.2 MM BS2-1 EBC ×4 PCS; PVC LEG SET/2 includes GLUE BONDTITE… ×0.04 Kg; etc.).

#### BR-Z21: Mock profile creation on push
If a selected raw profile id begins `MOCK_CREATE|`, the item is created in Zoho at push time (name from the token after "|", group "Aluminium Profile & Parts", cf_finish, UOM Mtr) before it is consumed (src/components/CarcassBomBuilder.tsx:6195-6198, 6433-6437, 6559-6563).

#### BR-Z22: Other Accessories push shape
Each Other Accessory row (Chimney/Dishwasher panels) becomes its own SO line: composite `{label} {W}x{H}x6 {colour} ({profile} {profileColour})` = selected 6 mm stone (slab-normalized, +15%) + Cutting-1; cf group "Other Accessory"; SO line qty = row qty, rate 0, description "Profile: {profile} {profileColour}" (src/components/CarcassBomBuilder.tsx:6764-6798).

#### BR-Z23: Countertop & Backsplash — aggregation only
Countertops and backsplashes feed the Raw Material Selection quantities (stone buckets incl. "DEAD STOCK", per-sqft consumables) but are NOT pushed to the Zoho SO by handleAddToZohoSO (no push branch exists for them) (src/components/CarcassBomBuilder.tsx:7434-7502 vs 6001-6893).

#### BR-Z24: SO line rebuild (replace vs append)
- The SO detail is re-fetched just before update.
- Each existing SERVICE line whose decoded cabinet code matches a freshly built composite is REPLACED by that composite, keeping the service line's quantity and rate; non-service (already-BOM) lines are kept untouched with their tax/discount fields preserved.
- New composites without a matching service line (manually added cabinets, Other Accessories) are APPENDED, inheriting tax fields (tax_id, tax_name, tax_percentage, tax_type, gst_treatment_code default "out_of_scope") from the SO's first line.
- One PUT updates all line items (src/components/CarcassBomBuilder.tsx:6800-6884).

#### BR-Z25: Elevation on the SO line
A cabinet line's description is set to `Elevation: {elevation}` when the project line has an elevation; the elevation itself is a per-line free-text field in the Project table (src/components/CarcassBomBuilder.tsx:6755-6761).

#### BR-Z26: Name normalization contract
All created Part/Panel names pass through `normalizePartOrPanelName`: whitespace collapsed, "LH+RH"→"LH/RH", trailing "-SO-nnnnn" suffix and trailing "Project" stripped then re-applied, drill vs finish words separated after the size token (drill words: LH/RH/LHS/RHS, nS, nH, nHB, JD/JD1/JD2) (src/lib/naming.ts:1-100). Names and SKUs sent to Zoho are truncated to 100 characters (src/components/CarcassBomBuilder.tsx:5029-5031).

#### AC-Z3: Push happy path
Given an SO is selected, all stone/profile buckets have selections, When the user clicks "Add to Zoho Sales Order", Then the status strip streams each creation step, the SO in Zoho gains/updates lines pointing at the Level-1 cabinet composites, and the final message reports "{N} service item(s) replaced with BOMs, {M} added".

#### AC-Z4: Push failure mid-way
Given Zoho rejects any item/composite creation or the SO update, Then the loop stops, the strip shows "Error: Failed to create item/composite item "{name}": {zoho error}" or "Error: Failed to update Sales Order: …", and no further items are created (already-created composites remain in Zoho and are reused on retry via name resolution) (src/components/CarcassBomBuilder.tsx:5021-5023, 5095-5097, 6881-6889).

#### AC-Z5: Token cooldown during push/search
Given the token refresh is rate-limited, When any Zoho call is made, Then the user sees the cooldown message ("Zoho token refresh is cooling down. Try again in about N seconds.") in the SO-search error line, the raw-material Retry blocks, or the push error strip (src/lib/zoho.ts:130-133; src/components/CarcassBomBuilder.tsx:5862-5864).


# Section 6 — Designer & Planning Pages, Re-order Report, QR Pages, Cross-Page Behavior

### 1. Routes & page identity

- **DC-1.1** — Route map: `/` = BOM Dashboard (`BomDashboard`), `/builder` = plain Carcass Code & BoM Builder, `/designer` = `CarcassBomBuilder` with `soMode`, `/planning` = `CarcassBomBuilder` with `soMode + planningMode`, `/reorder` = Re-order Level Report, `/qr/bom/[orderId]` = public read-only BOM report for one Sales Order. (src/app/page.tsx:1, src/app/builder/page.tsx:1, src/app/designer/page.tsx:1-7, src/app/planning/page.tsx:1-7, src/app/reorder/page.tsx:1-5, src/app/qr/bom/[orderId]/page.tsx:1-6)
- **DC-1.2** — Page header title/subtitle vary by mode: `/planning` shows H1 "Planning → BoM" with subtitle "Planning · Upload cabinet codes / Sales Order → choose shutter colour → BoM"; `/designer` shows "Sales Order → BoM (Designer)" with "Designer · Sales Order → cabinet codes fetched → Raw BoM → Project Totals"; `/builder` shows "Carcass Code & BoM Builder" with "Kitchen Carcass · Code → Packets → Raw BoM → Project Totals". (src/components/CarcassBomBuilder.tsx:8524-8532)
- **DC-1.3** — Every builder-family page carries a shared nav header with links: "BOM Dashboard" (/), "Re-order Report" (/reorder), "Builder" (/builder), "Designer" (/designer), "Planning" (/planning), plus two export buttons ("Export All Combinations (.xlsx)" — every carcass combination at 15mm, finish = ANY; "Export All Shutter Codes (.xlsx)") and version tag "STONE · v21". These exports are available in ALL modes including designer/planning. (CarcassBomBuilder.tsx:8534-8556)

### 2. /designer & /planning vs /builder — visibility differences (soMode)

- **DC-2.1** — In soMode (both /designer and /planning) the two-column grid collapses to a single column (`gridTemplateColumns: "1fr"`) and the entire "① Configure Unit" card (zone/family/variant/finishes/size pickers) is hidden. (CarcassBomBuilder.tsx:8560-8562)
- **DC-2.2** — In soMode the Cabinet Code box (colour-coded code + Copy button), the "Add to Project" row (Elevation* select + Qty + button), and the construction/unit meta line are all hidden. (CarcassBomBuilder.tsx:8868, 8902, 8927)
- **DC-2.3** — In soMode the "Packets" and "Raw BoM (this unit)" tab buttons are hidden; only the project tab remains and it is relabelled "Sales Order → BoM" (with a badge showing total unit qty). The active tab initialises to "proj" in soMode (vs "pk" on /builder). (CarcassBomBuilder.tsx:8933-8935, 5602)
- **DC-2.4** — `/designer` only (`canDesignerUpload = soMode && !planningMode`): the "① Zoho Sales Order" card is HIDDEN and replaced by the "① Upload Cabinet Codes (.xls)" card. `/planning` and `/builder` show the Zoho Sales Order card instead. (CarcassBomBuilder.tsx:5914, 9123, 9235)
- **BR-2.5** — In soMode with no SO selected and no project lines, the materials aggregation is EMPTY (no fallback to the default configured unit); /builder falls back to the single configured cabinet (`qty 1`). The Raw Material Selection card caption reads "Select a Sales Order to load materials" in that state (vs "Aggregated from Configured Unit (Fallback)" on /builder; "Aggregated from SO: {number}" / "Aggregated from Project: N units" when populated). (CarcassBomBuilder.tsx:7231-7249, 9957-9964)
- **DC-2.6** — Everything else on the project tab (Consolidated Totals, Stone-per-finish, Project Lines, Fillers, Visible Panels, Backsplash, Countertops, Raw Material Selection) renders identically in all three modes.

### 3. UJ — SO fetch flow (/planning, and /builder's project tab)

- **UJ-3.1** — Decode a Sales Order into a BOM:
  1. User types ≥2 characters in "Search Sales Order" (placeholder "Type SO-00001 or Customer..."); typing clears any selection.
  2. After a 500 ms debounce the app queries Zoho (`/api/zoho/salesorders?q=…` → Zoho `search_text`, `per_page 50`); an absolutely-positioned dropdown lists matches as "**SO-number** — Customer name".
  3. Clicking a match selects the SO, sets the search box to the SO number, and fetches full SO detail; a summary strip shows "Selected: {number} · Customer: {name} · Status: {status}".
  4. Each SO line item's cabinet code is decoded (from `sku || name || description` — service lines carry the code in `description`) via the 11-field parser; every decodable line becomes a Project Line with qty = line quantity (default 1) and rate = line rate (default 0). Undecodable lines are silently ignored.
  5. All totals, per-finish stone tables, raw-material aggregation and exports now reflect the SO. (CarcassBomBuilder.tsx:5848-5911, 9127-9214)
- **BR-3.2** — Selecting an SO REPLACES the Project lines; clearing the SO does NOT wipe the project (so an Excel upload can stand). (CarcassBomBuilder.tsx:5896-5911)
- **AC-3.3** — Given a query under 2 characters, When typed, Then no search fires and results/errors are cleared. (CarcassBomBuilder.tsx:5849-5853)
- **AC-3.4** — Given the SO search API fails (e.g. Zoho token cooldown), When results return non-OK, Then a red warning "⚠ {Zoho error}" (fallback "Sales Order search failed — Zoho is unavailable." / "— network error.") is shown under the search box instead of failing silently. (CarcassBomBuilder.tsx:5858-5870, 9157-9161)

### 4. BR — Cabinet-code parser (`parseCabinetCodeToModel`) — contractual format

- **BR-4.1** — Code format (11 fields + optional finish suffix): `p1-p2-handleToken(CJ|STD)-matToken(GL|ST)-p3-p4-p5-W-H-D-t[-finishSuffix]`. Anything after `-SO-` is stripped before parsing. Codes with <11 dash fields, unknown zone p1, or non-numeric W/H/D/t are rejected (line skipped). (CarcassBomBuilder.tsx:4836-4854)
- **BR-4.2** — Family resolution: match zone families on p2; if several share a p2, disambiguate by material token (`GL` ⇒ glass-shutter family), then by a variant whose p3 matches; first surviving candidate wins. (CarcassBomBuilder.tsx:4856-4874)
- **BR-4.3** — Variant resolution: token `2HS` in any of p3/p4/p5 ⇒ the double-door variant (a variant flagged both/double or whose id/label matches /double|dbl/); otherwise the non-double variant whose p3 matches (fallback: first non-double variant, then first variant). (CarcassBomBuilder.tsx:4876-4888)
- **BR-4.4** — Hand = "RHS" iff p4 or p5 contains `RHS`, else "LHS". Handle = "XCJ" when the handle token is `CJ`, else "STD". (CarcassBomBuilder.tsx:4890-4891)
- **BR-4.5** — Finish suffix (fields 12+, re-joined on "-"): form `CARCASS/SHUTTER` splits on "/" into carcass and shutter finishes; else if it contains "-", the first segment is the carcass finish and the remainder (re-joined) the shutter finish; a single segment sets both; absent suffix defaults both to `STATUARIO`. (CarcassBomBuilder.tsx:4893-4912)
- **BR-4.6** — Explicit overrides (from the Designer Excel upload) beat the code's finish suffix: carcass finish, shutter finish (may be forced to empty = "unchosen"), and profile colour (default `CHAMPAGNE`). Design/profile comes from the caller (current `design` state for SO decode; mapped design for Excel rows). (CarcassBomBuilder.tsx:4914-4919)
- **AC-4.7** — Given a parse throws, When decoding a line, Then the line is skipped with a console warning only — no user-facing error per line. (CarcassBomBuilder.tsx:4920-4923)

### 5. UJ/BR — Designer Excel upload (/designer only)

- **UJ-5.1** — Upload flow:
  1. User clicks "Choose Excel…" in card "① Upload Cabinet Codes (.xls)" (accepts .xls/.xlsx; the file input resets after each pick so the same file can be re-uploaded).
  2. The sheet named **"Shutter"** is parsed (fallback: first sheet). Columns read per row: `Cabinet Code`, `Shutter Type`, `Cabinet Finish`, `Profile Finish`, `Shutter Finish` (this column holds the PRICE GROUP, not a colour), `Shutter Qty`.
  3. Each row with a cabinet code is decoded (parser above) with shutter colour deliberately left EMPTY; rows that fail to decode are counted as skipped.
  4. On success the current SO selection is cleared, the Project is replaced with the uploaded lines, and the message "Loaded N cabinet(s)[, M skipped]. Choose shutter colours below." appears. Empty result ⇒ "No valid cabinet codes found in the sheet."; parse failure ⇒ "Could not read the file: {reason}". (CarcassBomBuilder.tsx:5966-5999, 9235-9257)
- **BR-5.2** — Column mappings (src/data/planning_finishes.json):
  - `Shutter Type` → design via `shutterTypeMap`: `MD1+CM1→MD1CM1`, `MD1+CM2→MD1CM2`, `MD2+CM1→MD2CM1`, `MD2+CM2→MD2CM2`, `MD3+CM1→MD3CM1`, `MD3+CM2→MD3CM2`; unmapped values have "+" (with surrounding spaces) stripped; blank ⇒ `MD1`. (CarcassBomBuilder.tsx:5981-5982)
  - `Cabinet Finish` → carcass finish via `carcassShortCodes`: `GC→GALAXY CREMA`, `ON→ONYX OMAN`, `OM→ONYX OMAN` (data file notes this map is a placeholder); unmapped values pass through verbatim; blank ⇒ `STATUARIO`. (CarcassBomBuilder.tsx:5983)
  - `Profile Finish` → profile colour via `profileFinishMap`: `Light Bronze→CHAMPAGNE`; anything unmapped ⇒ `CHAMPAGNE`. (CarcassBomBuilder.tsx:5984)
  - `Shutter Qty` → integer, minimum 1 (invalid/blank ⇒ 1). (CarcassBomBuilder.tsx:5986)
- **BR-5.3** — Each uploaded line stores its provenance (`upCode`, `upDesign`, `upCarcass`, `upProfile`, `priceGroup`) so the shutter colour can later be re-applied by re-parsing the original code with the new colour, and rate starts at 0. (CarcassBomBuilder.tsx:5989, 5950-5958)

### 6. BR/DC — Shutter colour selection (per-line + bulk, /designer)

- **BR-6.1** — Price-group colour lists (src/data/planning_finishes.json `priceGroups`): **PG-1 = 25 colours** (MAGPPIE ART, PALACE, KING, JEWEL, ELEGANCE, CALM, D'ESTE, ROMANO, VETICANO, TRAVERTINO, TIMELESS, RIVER, EARTH, ONYX GOLD, ONYX MYSTIC, TAJ, FOREST, ONYX BLACK, FLURRY, SANTORINI, GULNAAR, PERSIAN TRAVENTINE, VEILSTONE, CREMA, GLACIER); **PG-2 = 18 colours** (MAGPPIE TERRAZO GREY, EARTH TAUPE, EARTH GREY, SAHARA, WHITE MUSE, BEIGE MUSE, MYRA SAND, NEO BROWN, CREAM STONE, GRAPHITE, DUSK, SAGE, AMBER, CLOUDSTONE, BREEZE, GALAXY, VANILLA, COSMIC). An unknown/absent PG offers the deduplicated union of all PG colours, sorted. (CarcassBomBuilder.tsx:5915-5921)
- **DC-6.2** — Per-line picker: in the Project Lines table, any line with a `priceGroup` shows a small dropdown in the Finish column titled "Shutter colour ({PG})", listing only that row's PG colours, with placeholder "Pick colour ({PG})…". Until a colour is chosen the dropdown border is red (#c0392b). Choosing a colour rebuilds that line's model from its original uploaded code, keeping design/carcass/profile. (CarcassBomBuilder.tsx:9443-9457, 5950-5960)
- **DC-6.3** — Bulk apply bar appears in the upload card only when at least one project line has a price group. Three dependent dropdowns + button: **Zone** (All/Base/Wall/Tall/Loft/Mid), **Price Group** ("All" + only the PGs actually present among lines of the chosen zone), **Colour** (PG's list when a PG is chosen, else union of all PG colours), and "Apply to filtered" (disabled until a colour is chosen). Changing Zone resets PG to All and clears Colour; changing PG clears Colour. (CarcassBomBuilder.tsx:9258-9288, 5938-5942)
- **BR-6.4** — Bulk match rule (`lineMatchesBulk`): a line matches when (zone filter = "all" OR the line's zone-kind equals it) AND (PG filter = "all" OR the line's priceGroup equals it); zone-kind derives from the code's zone prefix → wall/loft/tall/md/base (default base). Apply sets the chosen shutter colour on every matching line via the same code re-parse. (CarcassBomBuilder.tsx:5928-5947, 5961-5964)

### 7. /planning page differences

- **BR-7.1** — /planning = /designer minus the Excel upload: it is soMode (all §2 hidings apply) but `canDesignerUpload` is false, so it shows the "① Zoho Sales Order" card with search AND the "Add to Zoho Sales Order" push button — the same SO decode + SO update flow as /builder's project tab. Per-line/bulk colour pickers never appear on /planning because `priceGroup` is only set by the Excel upload. (CarcassBomBuilder.tsx:5914, 9123-9232; src/app/planning/page.tsx:3-7)
- **BR-7.2** — "Add to Zoho Sales Order" (planning/builder): after building all composite BOM items, the SO is re-fetched and its line items rebuilt: a SERVICE line whose decoded cabinet code matches a newly built composite is REPLACED by that composite (keeping the original line's qty, rate, and tax fields); non-service lines are kept unchanged; unmatched new composites are appended (inheriting the first line's tax fields). Progress messages show "…(N replaced, M added)…" and end with "Sales Order {number} updated — N service item(s) replaced with BOMs, M added." (CarcassBomBuilder.tsx:6800-6886)

### 8. /reorder — Re-order Level Report

- **UJ-8.1** — Flow:
  1. On load the page scans Zoho for low-stock items and shows "Scanning items, recent POs and vendor profiles…"; header offers "← BOM Report" (/), "Carcass Builder" (/builder) and Refresh.
  2. Rows show Item (name, SKU, unit), Stock, ROL, MSL, Shortfall (red), Vendor picker, Lead, Transit, Total days, editable PO Qty and Rate, and an action.
  3. User can create a draft PO per row ("Create PO", disabled without vendor) or select rows (checkbox / "Select all (filtered)" / "Deselect all") and "Create Draft PO(s) for Selected" — bulk POs are grouped one PO per vendor.
  4. Success replaces the button with "✓ {PO number}" linking to Zoho (`web_url`); bulk shows "Created N draft PO(s): PO-…, …". (src/components/ReorderReport.tsx:60-208, 237-459)
- **BR-8.2** — Report inclusion rule (server): items come from Zoho's low-stock filter (tries `Status.LowStock`, `Status.Lowstock`, `Status.lowstock`, `Status.Reorder`; up to 10 pages × 200), each hydrated; an item is listed only if `reorder_level > 0 AND stock < reorder_level`, where stock = `actual_available_stock` → `available_stock` → `stock_on_hand` → 0. `shortfall = max(0, ROL − stock)`; MSL read from item custom fields (`cf_msl`/`cf_minimum_stock_level`/"MSL"/"Minimum Stock Level"). (src/app/api/zoho/reorder-report/route.ts:84-127, 183-205)
- **BR-8.3** — Default vendor/rate per item = the vendor and line rate of the MOST RECENT purchase order (last 100 POs by date desc) containing that item; vendor lead/transit days come from vendor-contact custom fields (`cf_lead_time`/`cf_transit_time` variants), default 0. (reorder-report/route.ts:130-180)
- **BR-8.4** — Default PO Qty = `max(shortfall, ROL − stock)` or 1; changing a row's vendor resets lead/transit to 0 then refetches them from that vendor's contact record. (ReorderReport.tsx:73, 103-114)
- **BR-8.5** — Filters: free-text search over name+SKU+vendor; day-limit filter with mode Lead Time / Transit Time / Lead + Transit (default combined), keeping rows whose chosen metric ≤ max days; footer shows "Showing X of Y · scanned N items". Draft PO notes are fixed: "Draft PO from Re-order Level Report" / "Bulk Draft PO from Re-order Level Report". (ReorderReport.tsx:210-222, 135, 185, 318-321)
- **AC-8.6** — Given no row is selected (or selected rows lack vendors), When "Create Draft PO(s) for Selected" is clicked, Then message "Select at least one row with a vendor." appears and nothing posts. Given a per-row Create PO without a vendor, Then inline error "Pick a vendor first". (ReorderReport.tsx:118-121, 163-167)

### 9. /qr/bom/[orderId] — QR BOM page

- **BR-9.1** — Purpose: a standalone, chrome-less page (framed widget titled "BOM Items" / "BOM Backorder Report") that loads one Sales Order live from Zoho by the `orderId` URL segment, expands every SO line's composite-item tree (breadth-first, max depth 6, with global stock consumption across rows) and renders the same `BomOrderCard` used by the dashboard; header subtitle shows "{SO number} · BOM Items" once loaded. States: "Loading BOM items..." then card, or an error message. (src/components/QrBomPage.tsx:17-56, src/lib/report.ts:60-140)
- **BR-9.2** — Related but distinct: the QR codes generated on the BOM Dashboard encode TEXT payloads, not this URL — "BOM Items" QR = `SO: …\nCust: …\nDate: …` + one `- {item} x{qty}` per leaf row; "User Details" QR = a JSON of SO/customer/address fields; box-label QRs = `"{SO number}\n{customer}"`. (src/components/BomDashboard.tsx:1328-1364, 535-538)

### 10. Guard rails — Zoho token / API failures (cross-page)

- **BR-10.1** — Access tokens are cached (memory + `os.tmpdir()/magppie-cache/zoho-access-token.json`) and refreshed when within 5 minutes of expiry; a refresh rejected with "too many requests"/"access denied" blocks further refresh attempts for 5 minutes. (src/lib/zoho.ts:24-26, 88-121)
- **BR-10.2** — During the cooldown every Zoho-backed API returns the user-facing error "Zoho token refresh is cooling down. Try again in about N seconds." (or the friendlier "Zoho is temporarily blocking token refresh… will reuse cached tokens and wait…"). This surfaces in each page's own error slot: red ⚠ line under the SO search (designer/planning/builder), red banner on /reorder, error message on /qr, `Error: …` box in the Zoho card during SO push. (zoho.ts:130-133, 227-242; CarcassBomBuilder.tsx:9157-9161, 9216-9230; ReorderReport.tsx:250-254; QrBomPage.tsx:49)
- **BR-10.3** — A Zoho 401 (or body code 57/14) on any request clears the cached token and retries exactly once with a fresh token; any remaining non-OK/positive-code response propagates as an error. (zoho.ts:213-224)
- **AC-10.4** — Given required env (`ZOHO_ORGANIZATION_ID`, `ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`) is missing, When any Zoho call runs, Then the API errors with "Missing {NAME}. Add it to .env.local.". A health endpoint `/api/zoho/status` reports `ok`, organization name, base URL and token-cache state. (zoho.ts:31-37; src/app/api/zoho/status/route.ts:15-31)


# Section 7 — Global & Dashboard Features (Auth Gate, AI Copilot, Builder Tabs, Stock Check, BOM Dashboard, Accessories Subform, Draft PO, Persistence)

Verified against the codebase; all are user-visible. Areas already covered (configurator, bom-engine, sections, exports, zoho, other-pages) do not mention any of the following.

---

### 1. Global password gate (AuthGate)

- **UJ-G1: Unlock the app**
  1. On first visit to ANY route, the entire app is replaced by a full-screen dark login card titled "Magppie Inventory" with prompt "Enter the factory authorization password to access the BOM Backorder Dashboard." (src/components/AuthGate.tsx:45-96; wraps all pages via src/app/layout.tsx:15-18)
  2. User enters the Security Password and presses "Verify Authorization →"; the button shows a spinner for a deliberate ~600 ms delay before verdict. (AuthGate.tsx:20-35)
  3. On success the app renders; on failure a shaking error bubble shows "Invalid access password. Please try again." (AuthGate.tsx:31, 74-79)
- **BR-G1**: The only accepted password is the hard-coded string `Factory@1234`; comparison is exact, client-side. (AuthGate.tsx:27)
- **BR-G2**: Successful login persists as `localStorage["app_authenticated"]="true"`; the user is never re-prompted on the same browser (no logout control exists anywhere in the UI). (AuthGate.tsx:12-18, 28)
- **DC-G1**: While auth state is being read, a full-screen spinner ("auth-loading-screen") is shown instead of content. (AuthGate.tsx:37-43)
- **AC-G1**: Given a cleared localStorage, When any route (/, /builder, /reorder, /qr/...) is opened, Then the login screen blocks all content until the correct password is entered.

### 2. AI Copilot chat (all pages)

- **UJ-A1: Ask the copilot about the current BOM**
  1. A floating circular 💬 button sits bottom-right of every page (renders inside AuthGate, so only after login). (src/components/AiCopilot.tsx:86-119; src/app/layout.tsx:17)
  2. Clicking it opens a 380×500 chat window "Magppie AI Copilot — BOM & Estimate Assistant" with the greeting "Hi! I'm your Magppie BOM Copilot. Ask me anything about your current BOM report, inventory stock levels, or cabinet building specifications!". (AiCopilot.tsx:12-17, 122-158)
  3. Sending a message shows an italic "Thinking..." bubble, then the assistant reply; errors render inline as "Sorry, I encountered an error: …". (AiCopilot.tsx:57-64, 207-223)
- **BR-A1**: Each request POSTs the chat history plus a page-supplied context object `window.__BOM_CONTEXT__` (set by the dashboard at BomDashboard.tsx:794 and by the builder at CarcassBomBuilder.tsx:7101) to `/api/ai/chat`, which calls OpenAI `gpt-4o-mini` (temperature 0.7) with a Magppie-specific system prompt embedding zone codes, design-exclusion rules, and waste factors; missing `OPENAI_API_KEY` returns "OpenAI API Key not configured on the server." (src/app/api/ai/chat/route.ts:5-60)
- **DC-A1**: Send button is disabled while loading or when input is empty; messages auto-scroll to bottom. (AiCopilot.tsx:22-26, 254-267)

### 3. /builder "Packets" and "Raw BoM (this unit)" tabs

(The bom-engine catalog covers the data model; nobody catalogs these two rendered tabs. Hidden in soMode — that much is in other-pages.)

- **DC-P1**: /builder has three tabs: "Packets" (default), "Raw BoM (this unit)", and the project tab; the first two show the CURRENTLY CONFIGURED unit only. (CarcassBomBuilder.tsx:8933-8934, 5602)
- **DC-P2**: Packets tab card "② Carcass Packets" is a table Packet | Dimensions | Qty | UoM where each row carries a coloured group chip labelled Panel / Profile / Hardware / Consumable / Shutter. (CarcassBomBuilder.tsx:8938-8969)
- **BR-P1**: Raw BoM tab card "③ Raw Roll-up — this unit" shows tiles: Stone purchase sqft (net +15%) with panel count and weight ≈ net sqft × 3.45 kg; Profiles purchase metres (net +20%); Hardware count with item names; Consumables (assembly glue ml, stepper silicone kg, extras); Operations as "{cut}+{drill}" cutting/drilling counts; and, when shutters exist, Shutter Stone (6mm) sqft +15% with weight @1.38 kg/sqft and Shutter Profiles metres +20% with corner-set count. (CarcassBomBuilder.tsx:8975-9027, 9109)
- **DC-P3**: Card "④ Full Explosion" renders collapsible `<details>` groups per pack; parts show their drill operation ("↳ Drilling-1 (code)"), child panels with "↳ Cutting-1 {sqft} sqft ea", profiles with "↳ Cutting-1 {len} mm ea", and silicone lines; a "Logic" assumptions box states the +15%/+20%, ×3.45 kg, 2×t reduction, "CJ top −23", and "No edge-banding" rules verbatim. (CarcassBomBuilder.tsx:9032-9114)

### 4. /builder "⑩ Stock Check" card (hardware & consumables)

- **UJ-S1**: On the project tab, when the project has ≥1 line, a "⑩ Stock Check" card appears with a "Check Stock" button (label "Checking..." while running); before first run it shows the hint 'Click "Check Stock" to verify hardware & consumable availability in Zoho.'. (CarcassBomBuilder.tsx:10294-10350)
- **BR-S1**: The check aggregates required qty per hardware and consumable item name across all project lines (qty × line qty) and looks up live Zoho stock; the table shows Item | Required | In Stock | Status with tags: "in stock" (deficit 0), "deficit N" (needed − stock), "unknown" (item not found, stock "N/A"), and a per-row "checking" state. (CarcassBomBuilder.tsx:10314-10344)

### 5. BOM Dashboard (/) — core report workflow

(Only the Zoho connection banner was catalogued; the rest of BomDashboard's 2,300 lines is uncovered.)

- **UJ-D1: Load a multi-SO backorder report**
  1. User searches by "Sales order number or customer" (min 2 chars, Enter or "Search Orders") with a Status filter (All / Draft / Confirmed / Sent / Void). (BomDashboard.tsx:1499-1527)
  2. Matching SOs appear as checkbox cards (number, customer, status); user selects several and clicks "Load Selected (N)" ("Loading BOM..." while busy). (BomDashboard.tsx:1534-1556)
  3. Each SO's composite items are expanded up to 6 BOM levels via Zoho item/composite lookups (src/lib/report.ts:17, 57+), rendered as per-order cards; a success message reads "Loaded N components." (BomDashboard.tsx:852)
- **DC-D1**: Header toolbar: disabled "DBG", "↓ Excel", "↓ CSV" (both disabled until rows exist), "+ Draft PO from SO", links to "Re-order Report" and "Carcass Builder", and a "Print" button that invokes the browser print dialog. (BomDashboard.tsx:1417-1441)
- **DC-D2**: Two tabs: "BOM Report" and "Accessories Subform"; a summary strip shows counts — Sales Orders (purple), Components (blue), Out of Stock (red), Low Stock (gold), Fulfilled (green). (BomDashboard.tsx:1444-1475)
- **BR-D1**: Stock status per row: out-of-stock when effective stock < actual qty; **low-stock when effective stock < actual qty × 1.5**; else in-stock; effective stock is depleted globally across the loaded orders so the same item cannot double-count. (src/lib/stock.ts:94-101)
- **DC-D3**: Report controls: free-text "Search name, SKU...", stock filter pills All / Out of Stock / Low Stock / In Stock, a live "N components" count, and "← Change Orders" which clears the report and returns to search. (BomDashboard.tsx:1585-1630)
- **BR-D2**: A refresh bar offers "Refresh Now" plus an "Auto" toggle; with auto on, the loaded report re-fetches every 10 minutes and shows "Last updated HH:MM:SS · Next HH:MM:SS". (BomDashboard.tsx:692-712, 1563-1583)
- **DC-D4**: Each order card (BomOrderCard) lists rows grouped with a group bar; columns Item (tree-indented) | SKU | type chip (PACK BOM / SUB-BOM / ITEM / COMPONENT) | SO Qty | Waste % | Actual Qty | Eff. Stock; deficit rows are highlighted. (src/components/BomOrderCard.tsx:35-101)
- **UJ-D2: QR codes per order** — each order card header has "BOM QR" and "User QR" groups with View/Download buttons and inline previews. BOM QR encodes `SO: … / Cust: … / Date: …` plus one `- {item} x{qty}` line per leaf component; User QR encodes a JSON `USER_DETAILS` payload (SO ids, customer, email, addresses, salesperson, contacts). Download saves `{SO}-bom-items-qr.png` / `{SO}-user-details-qr.png`; View opens a modal. (BomDashboard.tsx:1329-1398, 1636-1690)
- **UJ-D3: Packing List modal** — a "Packing List" button per order opens a modal with a packing-group selector rendering a printable packing-list HTML document (with an embedded SO+customer QR image) built by `buildPackingListHtml`. (BomDashboard.tsx:372, 534-538, 1691-1699, 2030-2038)

### 6. Dashboard "Accessories Subform" tab

- **UJ-AS1**: With a report loaded, the Accessories Subform tab lets the user add rows; per row: pick an SO from the loaded orders, multi-select its Carcass items (each option shows its width, e.g. "(586mm)"), toggle accessories, edit Size / Elevation / Actual Qty, then "Save" or "↑ Update SO". (BomDashboard.tsx:1706-1900)
- **BR-AS1**: Exactly five accessories with fixed Zoho item IDs and applicability rules: "Skirting with light" (item 3418412000001249001; only Base/Tall sub-groups), "Duplay Profile Light" (…249010; Wall only, excluding Dishrack), "L Profile Dado Light" (…249037; Wall only), "J type handle" (…249019; any), "C type handle" (…249028; any). (BomDashboard.tsx:77-105)
- **BR-AS2**: The three profile-light accessories (skirting/duplay/lprofile) are mutually exclusive within a row — enabling one disables the others. (BomDashboard.tsx:107-112, 1862-1872)
- **BR-AS3**: Combined width of the selected carcass items must be ≤ 3000 mm; over-limit selections are rejected with "Combined width exceeds 3000mm." and the row shows a width badge "{mm}mm → {m}m ⚠ >3000". (BomDashboard.tsx:1797-1804, 1826-1829)
- **BR-AS4**: Enabling an accessory defaults its Actual Qty to the selected items' total width in metres; an accessory already assigned to any of the same items in another row is blocked ("Already assigned to one of the selected items"). (BomDashboard.tsx:1170, 1849-1886)
- **BR-AS5**: "↑ Update SO" appends the enabled accessory items as new line items onto the existing Zoho Sales Orders (PUT per SO), reporting "✓ Updated N SOs." or the error. (BomDashboard.tsx:1300-1327)
- **BR-AS6**: Subform rows and the row counter persist in `localStorage` keys `bom_accessory_subform_rows` / `bom_accessory_subform_counter` and are restored on reload. (BomDashboard.tsx:672-688, 1208-1209)

### 7. "Create Draft PO from Sales Order" modal

- **UJ-PO1**:
  1. From the dashboard toolbar, "+ Draft PO from SO" opens a modal wizard (steps: search → loading → items → creating → done). (BomDashboard.tsx:1429; src/components/DraftPoModal.tsx:37-45, 227)
  2. User searches and picks one SO; its BOM is expanded and only out-of-stock lines are listed, each with an include checkbox, PO qty, rate, and a vendor dropdown. (DraftPoModal.tsx:19-26, 100-133)
  3. Vendor dropdowns are pre-filled from real purchase history (batch lookup over the last ~100 POs via `/api/zoho/po-vendor-map`), preferring the most recent vendor; the full vendor list is the fallback. (DraftPoModal.tsx:47-60, 112-133)
  4. On create, selected lines are grouped by vendor and one **draft** Zoho Purchase Order is created per vendor; the done step lists each created PO number with a deep link to open it in Zoho. (DraftPoModal.tsx:149-196)
- **AC-PO1**: Given no line has both include + vendor set, When Create is pressed, Then the error "Select at least one item with a vendor." is shown and nothing is created. (DraftPoModal.tsx:149-152)

### 8. Persistence constraint (cross-cutting)

- **DC-PR1**: The ONLY client-side persistence in the app is `app_authenticated` (login) and the two accessory-subform keys; the entire /builder /designer /planning state (project lines, section rows, raw-material choices, selected SO) is in-memory only and is lost on page reload — there is no session restore. (grep: only AuthGate.tsx:12,28 and BomDashboard.tsx:672-673,1208-1209 touch local/sessionStorage)
