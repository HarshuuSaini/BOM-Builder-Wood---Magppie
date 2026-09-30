# Magppie Carcass BOM Builder — Architecture & Logic

_Last updated: 2026-06-29_

## Stack & routes
- **Next.js 16** (App Router, webpack), **React 19**, **TypeScript 5.9**, Node 24. Deployed on **Vercel** (`inventory-magppie`), integrates **Zoho Inventory India**.
- One heart file: `src/components/CarcassBomBuilder.tsx` (~10,900 lines). Routes: **`/builder`** (full tool), **`/designer`** (`soMode`), **`/planning`** (`soMode planningMode`).

## Core domain model
- **Zones** (`ZONES`): base (BC), base-low (BCL), base-blind (BB/BBL), wall (WC/WB), tall (TC/TB/TCL), loft (LO/LB), mid (MD). Each has kind/tall/low flags and a default depth/height.
- **Families** per zone (`*_FAMILIES`) with variants — e.g. DW (drawer), HO (hob), SK (sink), SH (shutter), GD (grain drawer), BPO (bottle pullout), WBP (waste-bin pullout), WGL/WST (wall glass/stone), PPN/DPN (pantry), etc.
- **SIZES** table: valid W/H/D per `zone.family`. Wall standard height is **725** (was 720); base 720; tall 2400; mid 1650; loft 600.
- **Cabinet code** (11 fields): `p1-p2-handleToken(CJ|STD)-matToken(GL|ST)-p3-p4-p5-W-H-D-t` + optional `-carcassMat(-shutterMat)`. **P7 is now `XXX`** (the handle used to be repeated there — removed as redundant; handle is decoded from **P3**).

## BOM build pipeline
`buildModel` → `buildCarcassInner` → `buildCarcassInnerRaw` (per-zone build) → `buildShutters` + `addDrawerBoxes` + `addElenor`. Produces a **`CarcassModel`**: `panels[]`, `profiles[]`, `hardware[]`, `cons[]`, `pkRows[]`, `shutters[]`, `netSqft`, `ops`.
- **Full BOM**: `buildFullBomData` → multi-level `FullBomRow[]` (S. No. per project line, Elevation column) → `exportBuilderExcel`. Also `buildOosData`, `buildOptiData` (groups: profile / panels-sh / panels-cab).
- **Raw roll-up** (`useMemo`): aggregates stone (net +15% waste), profiles (+20% / ELEN +10%), hardware, consumables across all cabinets + fillers + visible panels + backsplash + countertop + other accessories.

## Key business logic

### Drawers (`addDrawerBoxes`)
- Drawer box = Back (drilled JD) + Bottom + DBS/DBC profiles + runner hardware pack.
- Variants: **Low** (back 63, H90), **High** (back 212, H239), **Semi High** (148, H175).
- **2HB+1BL**: the "High" pack takes the **Low** configuration (back 63, H90) — the tall face is just a fascia; its shutter also carries H90.
- **Hardware dedup**: shutter-faced drawers carry the runner pack on the **shutter** (`hinge`), not the Drawer Pack. **Built-in/fascia** drawers (no shutter) keep it on the Drawer Pack.
- **WBP** (waste-bin pullout) = accessory with **no drawer** (fixed — was wrongly emitting a drawer box).

### Shutters / hinges (`buildShutters`)
- Hinge count `hingeN(h)`: ≤900→3, ≤1600→4, ≤2100→5, else 6.
- Hinge pack: loft → **W/OUT soft close** (closed by Tip-On); glass → **slim glass hinge**; else **3D hinge**. Loft cabinets get a **Tip-On** hardware.
- Glass shutter corner = glass bracket; stone = stone corner connector.

### Countertop (section ⑦) — 9 construction types
Dropdown order (with "Linear + BSV" moved to 2nd):
1. Linear
2. Linear + BSV
3. Linear + LHV with LH Drop
4. Linear + RHV with RH Drop
5. Linear + BSV with Both Side Drop
6. Island Compact
7. Island Table
8. Island with 350mm Sitting
9. Island Both Side Cabinets

- All share: **top slab** (30 mm = 2×15, or 40), **dead-stock base** (D−40), **front 30 mm patti folded into the top depth (D+30)**, **Alu Grand Light HM-512** under the front, 3 mm edge radius, polish/glue consumables.
- **Side patti fold into the top length** (+30/side, cut on site). **Brass strip** = cut-to-size BOM material (Depth × 30, 1/drop side).
- **Drop-down = mini-counter sub-BOM**: single visible drop stone `len × dropHeight` (issued **+15 single-side / +30 double-side (type 7)** for the mitre; front/back patti folded in) + dead base `dropHeight − 100`.
- **100 mm cabinet reduction**: each drop side trims top+base — side drops off **length**, back/island drops off **depth**. **Type 7 exempt** (freestanding table).
- **Type 8**: upper counter keeps **full depth**, only dead stock changes — 350 mm **Island Sitting Drop** with a **two-stone** base + 100 mm cabinet mitre.
- **Rounding** = **name-only note** (no stone / no deduction): appends `Rounding LH/RH/Both (-600)` to the counter name.
- **Drop height** field default **705**, editable.
- `CT_TYPES` (display order + labels) and `ctGeom(type, L, D, T, dropHeight)` are the single source of truth (shared by the BOM build and the raw-stone aggregation).

### Stone resolution (`src/lib/rawmaterial.ts`)
`searchStoneItems` matches finish + thickness; colour-qualifier words (BLACK/WHITE/…) are optional so a 15 mm "STATUARIO NUVOLATO" slab resolves for the colour "BLACK STATUARIO NUVOLATO". Exact-finish matches rank before core matches.

### Fillers & Visible Panels
Dynamic rows per zone. **Size presets** (Height × Width-depth):
- Base 717×586 / Base Low Depth 717×362
- Wall 1082×362 / 717×362
- Tall 2037/2397×586 · Tall Low Depth 2037/2397×362
- Loft 597×362 / Loft Full Depth 597×586
- MID 1647/1287×362 · MID Full Depth 1647/1287×586

**Filler height presets** per zone (Base 717; Wall 1082/717; Tall 2037/2397; Loft 597; MID 1647/1287). Fillers have an **Elevation** field (AA–KK or custom), stamped onto their BOM rows.

### Backsplash (⑧)
Own stone panel + LATICRETE glue (1.25 kg/sqft).

### Other Accessories
Chimney Panel (presets **1082×336 / 717×336**) + Dishwasher Panel, pushed as their own Zoho SO lines.

### Accessories (⑪)
Skirting / duplay / L-profile / grand / handles per selected cabinets, length-driven with straight/L connectors + LED packs.

## Zoho integration
- Idempotent: `resolveSimpleItem` / `resolveCompositeItem` / `resolveHardwarePackComposite` reuse items by name/SKU. `handleAddToZohoSO` builds the SO with per-cabinet composites (Set of Parts, Drawer Pack, Parts-SH, hardware packs). `HARDWARE_PACK_DEFINITIONS` expands packs into components. India DC (`accounts.zoho.in`); org **60063687231** (MAGPPIE SILVERSTONE PRIVATE LIMITED).
- **Designer / Planning** pages: reverse-decode cabinet codes from a Zoho SO (`parseCabinetCodeToModel`) + Excel upload where the designer picks shutter colour, filtered by **Price Group (PG-1 / PG-2)**.

## Exports
Full BOM Excel (multi-level tree, S.No + Elevation), OOS sheet, Opti (cut-optimization) sheet, Export All Combinations (with shelf/fascia/drawer/shutter sqft columns), packing lists (carcass + shutter, with box dims), CSV.

## Verification (dev workflow)
Every change is validated locally with three checks, all must pass:
1. `npx tsc --noEmit`
2. `node scratch/test-drawers.js` → `ALL TESTS PASSED SUCCESSFULLY!`
3. `npm run build`

Deploys go to Vercel production (`vercel --prod`) only on explicit authorization. Secrets (`.env.local`) are never bundled.
