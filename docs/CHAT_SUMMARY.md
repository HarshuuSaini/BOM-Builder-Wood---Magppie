# Complete Chat Summary

Every requirement, decision, rejection and correction from the originating
conversation, in order. Nothing material omitted.

---

## 0. The brief

The user (Magppie, a kitchen manufacturer in India) uploaded a ZIP of their
existing **Stone Kitchen BOM Builder** — a Next.js app, 19,005 lines, with an
11,220-line `CarcassBomBuilder.tsx` at its centre.

The instruction: study that app, then produce the equivalent for **simple
wood-based (plywood/carcass) kitchens**. Treat the stone app as the template.
Keep the same structure, the same style of questions, the same BOM output
format. **Only the construction logic changes.**

Stated construction defaults, to be confirmed rather than assumed:

- Carcass 18mm BWP plywood, 6mm ply back
- Shutters 18mm ply + laminate (liner inside), 2mm PVC edge banding on fronts
- Base units 850mm high incl. 100mm skirting, 560–600 deep; wall 300–350 deep;
  standard widths 300/450/600/900
- Countertop, hardware, baskets: same categories as stone unless the logic
  does not apply

Working method requested: study the ZIP, list the stone sections/fields, then
ask **one question at a time** — "does this stay the same, change, or get
removed?" — flagging anything stone-specific and proposing a wood replacement.
All measurements in mm. Practical and carpenter-friendly. Prefer standard
module sizes. Don't over-design.

End goal: a complete field list + BOM formula spec, ready for a developer.

**Note:** two of the brief's own defaults were later overridden by the user —
the 6mm back became 8mm, and the 2mm edge band became 0.8mm. See §7 and §9.

---

## 1. Study of the stone app

Read `docs/BUSINESS_LOGIC.md`, `docs/UI_UX.md`, `CarcassBomBuilder.tsx`,
`naming.ts`, `rawmaterial.ts`, `types.ts`, `export.ts`.

Stone's **Configure Unit** form, in display order: Zone (P1) → Cabinet Family
(P2) → Configuration (P3·P4) → Drawer Model → Tip-On → Inbuilt Drawers → Hand →
Handle/Profile (P5) → Shutter Profile Design → Carcass Finish → Carcass Profile
Finish → Shutter Finish/Glass Colour → Shutter Profile Finish → Dimensions
W×H×D → Thickness (locked 15mm) → Elevation + Qty.

Right panel tabs: **Packets** / **Raw BoM (this unit)** / **Project & Totals**.

Project & Totals sections ①–⑬: Zoho Sales Order · Consolidated Totals · Stone
per finish · Project Lines · Fillers · Visible Panels · Countertop · Backsplash ·
Raw Material Selection · Stock Check · Accessories · Downloads · CSV Preview.

BOM output: one flat levelled table, **26 columns**, levels L0 cabinet master →
L1 pack → L2 part → L3 panel → L4 raw material.

Stone-specific machinery identified as having no wood equivalent: aluminium
stepper profile HM-509 + Dowsil 789 silicone (with a 15-bucket `stepSil`
lookup); shutter alu frame profiles MD1/MD2/MD3/CL/NEON20 with `SH_INSET` /
`SH_FRAME` / corner connectors; brass strip; dead-stock counter base; mitred
patti; Akemi polish; Bondtite; shelf profile HM-511; the sqft slab maths with
`KG_SQFT` 3.45 / `SH_KGSQFT` 1.38 and 17% stone waste.

---

## 2. Zones and families — KEPT IN FULL

**Q:** Does the Zone + Family catalog (14 zones, ~30 families) stay?
**A:** *Stay the same — all 14 zones.*

All 14 zones and the full family set carry over verbatim. Two notes raised:

- **SK / HO** have `top: "frame"` in stone — no top panel, an aluminium sink
  profile frame instead. Proposed wood replacement: two 18mm ply rails, front
  and back, ~100mm wide. *Not explicitly confirmed; still an assumption.*
- Glass-shutter families (WGL/SHFG/LGL etc.) remain valid; their door
  construction was deferred to the shutter discussion.

---

## 3. Base height stack — OPTION A

Conflict identified: stone uses **base carcass H = 720** on PVC legs with a
30mm stone counter; the brief said 850 including 100mm skirting. 720 + 100 =
820, leaving 30mm unaccounted.

Three options offered:

| | Skirting | Carcass | Counter | Total |
|---|---|---|---|---|
| **A** | 100 | 720 | 30 | 850 |
| B | 100 | 750 | extra | 850 + counter |
| C | 100 | 730 | 20 | 850 |

**A:** *Option A.*

Consequence: carcass H = 720 is **unchanged from stone**, so every derived
height formula survives — shutter deduction, the 360/180 drawer front slots,
the back-wall height chain.

---

## 4. Depths — UNCHANGED

Assumed and not contested: **560** full depth, **336** wall/loft/low depth.
Both sit inside the brief's stated ranges (560–600 base, 300–350 wall).

---

## 5. Widths — NEW TABLE

**Q:** Trim to 300/450/600/900, or keep stone's fuller table?
**A:** *"i'll tell you wait."* — then a handwritten note, "Project – Wood".

Transcribed, with four readings flagged for confirmation (HO's middle value
written as "760", read as **750**; SK's first value struck through, kept as
**500**; BB-Blind trailing off after 1150; a struck-out value before Tall's
450/600). Deliverable: `wood_kitchen_widths.xlsx`.

Key observation: the `{` braces in the note appear on **exactly** the four
hinged-door families (SH, SK, WGL/WST, Dishrack) and on none of the drawer or
full-height-front families — strong evidence they mark the **single/double door
split**, matching stone's existing `two = W > 600` rule.

**A:** *"every thing is fine take these as our standard cabinets."*

Final widths (53 sizes):

```
DW  450 600 800 900 1000
HO  600 750 800 900
GD  450 500 550 600
AP  600
SH  400 450 500 550 600 | 800 850 900 950 1000
SK  500 600 | 900 1000 1050 1100 1150 1200
BPO 150 300
WBP 300 600
BB-Blind 1050 1100 1150
WGL/WST 300 400 450 500 550 600 | 800 850 900 1000
Dishrack (WDR) 600 | 900
Tall 450 600
```

Zones absent from the note inherit: **BCL** takes base widths, **WB** the blind
list, **LO/LB/LBF/LOF** the WGL/WST list, **MD** stays 600, **WOP** stays 300.
Stated as an assumption; not contested.

---

## 6. Shutter types — SIX OPTIONS

**Q:** What replaces "Shutter Profile Design"?
**A:** *"wait i'm confirming"* — then a handwritten note, "Shutter types".

Read as three types / five buildable variants. The three substantive readings
reported back:

1. **"Board" is not one item** — prelam board in three variants, raw board in
   two. A branch in the BOM, not a finish attribute.
2. **Glue is measured two ways** — `+Glue (RMT)` off the edgeband on the
   prelaminated line; `+Glue (Sqft)` off the `(Raw Board + Laminates)` bracket
   on post-laminated. Two separate consumable lines, different UoM.
3. **Edgeband appears only under ① Laminated** — membrane wraps its own edges,
   PU is painted over. Inferred from absence, so flagged.

Deliverable: `wood_shutter_types.xlsx` with nine open questions.

### Round 1 answers

- No edge banding on Membrane and PU — **confirmed**
- Post-lam is **0.8mm laminate both sides** over a **16mm core** → 18mm
  finished (my draft had said 1.0mm outer + 0.8mm liner — wrong on both counts)
- Prelaminated needs **no** sqft glue, only edgeband adhesive
- PU one side uses a **prelam** board so the inner face needs no paint
- Laminate adhesive **25 g/sqft/side**
- Membrane oversize **+50mm per edge** confirmed
- PU rates 15/40/70 g/sqft *(revised in round 2)*
- **Carcass gets three board options**, each with a matched back
- **Glass shutters keep the aluminium frame** — "Neon 50 or Neon 22", same as
  the stone kitchen

### Round 2 answers (`wood_shutter_types_v2.xlsx`)

- Neon naming: **Neon 20** is correct (matching stone's `NEON20`), plus a
  second profile **Neon 50**, 50mm wide. "Neon 22" was a slip.
- Insets: **Neon 20 → 5mm**, **Neon 50 → 8mm**. Glass **5mm** on both.
- **PU rates revised to 15 / 30 / 50 g/sqft per side** (epoxy / base primer /
  top coat)
- PU both sides uses an **18mm raw** core — a distinct stores item from
  post-lam's 16mm
- **Edge band is 0.8mm on all sides of all panels except the back**, in both
  carcass and shutters. This **supersedes the brief's "2mm PVC on fronts"**.
- **Cut list shows the FINISHED size.** Pre-milling removes 0.8mm, the band
  restores it → **no size deduction anywhere**.
- Field name confirmed as **"Shutter Type"** with six options
- Membrane adhesive rate: to be supplied later

### Round 3 answers (`wood_shutter_types_v3.xlsx`)

All seven remaining questions confirmed, including the two that mattered:

- The apparent contradiction resolved: carcass panels and **laminated**
  shutters get the 0.8mm band; **membrane and PU get none**.
- "All sides of all panels" is meant **literally** — all four edges, including
  the rear edge of a side panel against the wall. This is ~11.8 RMT per
  600×720×560 carcass versus ~2.8 for front edges only. Confirmed knowingly.
- Neon 50 frame width **50mm**; both profiles available on **all** glass
  families; no band on the back; shelves banded on all four edges.

---

## 7. Carcass board — SELECTABLE

**Q:** How is the carcass finished internally?
**A:** *Varies — make it a selectable field.*

Resolved in the shutter round to three concrete options:

| | Core | Back |
|---|---|---|
| A | 16mm ply + 0.8mm laminate both faces | 6mm ply + 0.8mm laminate both faces |
| B | 18mm prelaminated MDF | 8mm prelaminated MDF |
| C | 18mm prelaminated particle board | 8mm prelaminated particle board |

**The back is 8mm nominal, not the 6mm in the brief.** This also retroactively
explained the 9mm groove (see §8) — a 9mm groove houses an 8mm panel; it never
made sense for 6mm.

Raw-material key changes from stone's `carcass|<finish>|15` to
`carcass|<boardType>|<finish>|18`.

---

## 8. Back panel — GROOVED

**Q:** How is the back fixed?
**A:** *"Grooved into sides/top/bottom, 9mm groove × 5mm deep.
(W − 2t + 9) × (H − 2t + 9)"*

Formula taken as authoritative. My reading of the +9: 5mm groove depth per side
= 10mm, less 1mm total clearance so the panel seats without binding.

Deletes: `STEP`, `stepSil` (15-bucket silicone lookup), `STP_SIZE`, `STP_KG`,
the HM-509 stepper profile and Dowsil 789.

---

## 9. Construction flip — FULL SIDES

User correction, unprompted:

> "top/bottom sit between sides in all cabinets so.
> Side LH/RH `D × H` · Top `(W − 2t) × D` · Bottom `(W − 2t) × D` ·
> Shelf `(W − 2t − 1) × (D − 28)`"

Significant: stone branched on `ZONES.construct` between `fulltb` (base/tall)
and `fullsides` (wall/loft/MD). Wood is `fullsides` **universally**, so the
`construct` field becomes a constant and the branch is deleted.

The back formula survives the flip: clear width between sides is still
`W − 2t`, clear height between top and bottom still `H − 2t`.

Shelf clearance tightens 5 → **1mm**, depth setback 40 → **28mm**, both because
the aluminium shelf profile is gone.

---

## 10. Skirting — PVC LEGS + PVC PROFILE

**A:** *PVC legs + PVC skirting profile.*

- `legCount(w)` unchanged: ≤150 → 2, ≥1050 → 6, else 4
- Leg holes stay drilled on the bottom panel (its underside is still flush with
  the bottom of the sides)
- Skirting becomes an **accessory row**, reusing stone's existing machinery
  (cabinet multi-select → `getRowWidthMm` → metres → 10% waste). Only the item
  changes, from `HM-507` alu to a PVC profile.

---

## 11. Handle — BOTH RETAINED

**A:** *Both — keep gola/handleless and standard handle.*

`CJ_CUT = 23` (gola cuts the top panel depth) and the **33/3 rule** in
`shDeduct` both survive, as does the `<CJ|STD>` token at code position 3.

Open dependency: stone's handle choice also **filters the design dropdown**
(`XCJ_DESIGNS` / `STD_DESIGNS`). That filter was written against the stone
design list and has no wood rule yet.

---

## 12. Drawer boxes — BOUGHT-IN

**A:** *Bought-in metal box (Tandembox, InnoTech, Lian) with bottom and back.*

- Drops out: `HM-513` (fixed 483 cut, ×2) and `HM-535` (`W−78`, ×4)
- Stays: bottom + back as cut ply; `2HB+1BL` high-takes-low; `fixed_dpn`;
  runner dedup
- Changes character: the **fascia** now follows the *shutter* board branch, not
  the carcass one, because it is built like a shutter

**Q:** Same deductions for every model, or per model?
**A:** *Per drawer model — needs a lookup table.*

Deliverable: `drawer_deduction_template.xlsx`, 15 rows.

### Returned table

| Model | Line | Low | High | Bottom ded W/D | Back W ded | Thk |
|---|---|---|---|---|---|---|
| Hettich | INNOTECH / ATIRA | H70 → 68 | H144 → 144 | 108 / 80 | 120 | 16/16 |
| Blum | ANTARO | H69 → 69 | H183 → 183 | 111 / 69 | 123 | 16/16 |
| Hafele | MATRIX | H69 → 69 | H164 → 164 | 111 / 69 | 123 | 16/16 |
| Grass | DWD | H68 → 68 | H164 → 164 | 111 / 69 | 111 | 16/16 |

Two gaps reported: **Lian was left as the template's example row** (the stone
builder's old 63/50/77/72 numbers, still labelled "EXAMPLE ONLY — overwrite"),
and **Semi High was blank for every model**.

**A:** *"semi high is not required."*

So the class set is **Low and High only**. Consequence: stone's `fixed_dpn` was
2 Low + 3 Semi-High; collapsed to **2 Low + 3 High**. *Flagged as my own
reading — worth a carpenter confirming a five-drawer pantry really wants three
full-height drawers.*

---

## 13. Shelf material — DERIVED

**A:** *"Glass door units will use 8 mm thick glass shelf, and on other units
which have laminate or membrane or PU shutters, it will use the shelf material
same as carcass."*

```
shelfMaterial = isGlassShutter(fk) ? "8mm toughened glass" : carcassBoardOption
```

Deletes stone's zone-by-zone shelf table entirely — one derivation replaces six
special cases.

**Behaviour change flagged:** in stone, a **WST** wall unit got glass shelves
unconditionally because that was a wall-zone rule. Under the new rule a WST with
a laminated shutter gets a **ply** shelf. Correct by the user's logic, but
different from how the stone app behaves — noted so it isn't mistaken for a
porting bug later.

Glass shelf sizing assumed to use the same formula as the ply shelf at 8mm;
stone's `W−36` / `D−49` offsets existed only because of alu profiles.

---

## 14. MD rolling shutter — KEPT

**A:** *Keep MD, rolling shutter is a bought-in unit.*
**A (bottom panel):** *"No bottom panel and keep the query related to
construction for other stage."*

So: MD keeps no bottom panel; the **back height formula is parked**. With only
the top inset, the back is grooved on three edges and the +9 allowance does not
apply symmetrically.

---

## 15. Countertop — SIMPLIFIED

**A:** *"keep it simple now base item need just a single sheet with the required
size."*

Collapses to five fields — Length, Depth, Thickness, Material, Qty — emitting
one bought-in line.

Deletes: `CT_TYPES` (all 9), `ctGeom()`, `ctHasDrop()`, `ctEdgingOptions()`,
brass strip, dead-stock base, drop-down mini-BOMs, mitred patti, Akemi/Bondtite/
silicone consumables, the Grand Counter band light, and the Type / Rounding /
Drop Height / Light columns.

---

## 16. Fillers, Visible Panels, Backsplash

**A:** *"Let me comment on each"* → then:

- **Fillers** — proposal accepted. A shutter-type panel with 0.8mm band; no
  `HM-504` profile, no silicone. 80mm default width retained.
- **Visible Panels** — *"generally no Visible panel only when customer request.
  if requested size will be: height will match the shutter, and width will be
  equal to carcass depth + 20 mm. size can be adjustable."* Deletes
  `VP_PRESETS`; stone used depth + 25.
- **Backsplash** — *"not required."* Section removed entirely.

---

## 17. Accessories — ALL OPTIONAL

**A:** *"everything is optional."*

Biggest consequence: **the Elenor light stops being automatic.** In stone,
`addElenor()` is called inside `buildCarcassInnerRaw` and fires on every tall,
loft and non-WDR wall cabinet, emitting 2 sets per unit. It becomes an opt-in
accessory alongside the rest.

Accessory sizing (sum selected cabinet widths → metres) is material-agnostic
and works unchanged.

---

## 18. Wastage

**A:** *"Carcass:10%, shutters : 20%, Profile :20% but all are changeable."*

Three editable inputs replacing stone's `STONE_WASTE` / `PROFILE_WASTE`. Also
resolves an inconsistency in the stone code, where profile waste is 20% in the
summary but hard-coded to 25% in the export.

---

## 19. New wood fields

Proposed and not contested. Six of the nine are conditional, appearing only for
the relevant Shutter Type — the same pattern stone already uses for Drawer
Model, Tip-On and Hand.

Ply sheet size (2440×1220) · sheet wastage % · laminate outer · laminate liner ·
carcass laminate (option A only) · edge band shade · membrane design · PU shade
+ gloss · glass tint.

The two stone "Profile Finish" slots map to **Carcass Edge Band** and **Shutter
Edge Band** rather than being deleted — same position in the form, same
"belongs to the panel it's on" logic.

---

## 20. Deliverables produced, in order

1. `wood_kitchen_widths.xlsx` — 53 standard sizes, import-ready matrix
2. `wood_shutter_types.xlsx` → `_v2` → `_v3` — the shutter Q&A cycle
3. `drawer_deduction_template.xlsx` — filled and returned
4. `wood_kitchen_spec.xlsx` — the consolidated field list + BOM formula spec
5. `wood-bom-builder.jsx` — a single-file working prototype
6. **`magppie-wood-bom`** — the full repo port, same construction as stone

---

## 21. Bugs found and fixed during the port

The user challenged an early build: *"you have run the old page which for stone
kitchen planning."* They were right, and investigation found more:

| # | Defect | Cause |
|---|---|---|
| 1 | `/` rendered the stone dashboard | `app/page.tsx` copied verbatim without reading it |
| 2 | `src/lib/export.ts` missing entirely | listed as "adapt" in my own notes, then not written |
| 3 | `BomDashboard` wouldn't compile | I wrongly classified it material-agnostic; it consumes `stoneGroups` / `defaultStoneId` / `searchStoneItems` / `applyStoneChange` |
| 4 | `rawmaterial.ts` had an invented API | I rewrote it from scratch instead of porting; signatures diverged from stone's |
| 5 | `AuthGate` imported as default | it is a **named** export |
| 6 | `globals.css` never copied | scaffolding omission |
| 7 | `FullBomRow` had 25 fields | missing `_type`, stone's 26th, read by `applyRowColors()` |
| 8 | Drawer units emitted one full-height shutter | `buildShutters` counted leaves from the door variant, ignoring the drawer breakdown |

Fix for #4 was to discard the rewrite, re-port stone's `rawmaterial.ts` and
`export.ts` verbatim, then apply a mechanical `Stone → Board` rename across both
plus `BomDashboard`.

#7 and #8 were found by **running the engine headlessly** (see
`tools/smoke/`), after the npm registry proved unreachable in the authoring
sandbox (403 from the egress proxy) so the dev server could not be started.

Also discovered during the rename: `rawmaterial.ts` matches Zoho items on
`cf_group.includes("stone")` and searches `` `STONE ${thickness}` ``. These are
**live data matches**, not cosmetic, so they became a configurable
`BOARD_GROUP_TOKENS` list — flagged as needing verification against the real
Zoho item master.

---

## 22. Rejected / superseded ideas

| Idea | Outcome |
|---|---|
| Trim widths hard to 300/450/600/900 | Rejected — the real table is much richer |
| 6mm back (from the brief) | Superseded by 8mm |
| 2mm PVC edge band on fronts (from the brief) | Superseded by 0.8mm on all edges |
| 1.0mm outer + 0.8mm liner laminate | Wrong — it is 0.8mm both sides |
| PU at 15/40/70 g/sqft | Revised to 15/30/50 |
| "Neon 22" | A slip; it is Neon 20, plus a separate Neon 50 |
| Base carcass at 750 or 730 (options B, C) | Rejected in favour of 720 |
| Keeping the 9 countertop construction types | Rejected — one bought-in line |
| Backsplash section | Removed |
| Semi-High drawer class | Not required |
| Band front edges only (~2.8 RMT) | Rejected — all four edges, knowingly |

---

## 23. State at handover

**Settled and implemented:** 14 zones · full family set · 53 widths · 850 height
stack · depths 560/336 · full-sides construction · all panel formulas · 8mm
grooved back · three carcass board options · six shutter types with rates ·
0.8mm banding on all edges except backs · Neon 20/50 glass · derived shelf
material · PVC legs + skirting accessory · bought-in drawer boxes with four
models' deductions · wastage 10/20/20 · countertop/filler/visible-panel
simplifications · everything optional.

**Resolved Sep 2026:** drawer fronts use the stone 180/360mm slot construction;
Lian uses the stone drawer-box deductions; drawer/door fronts inherit shutter
edge banding. Remaining open items are tracked in `BUGS.md` and `BACKLOG.md`.
deductions · MD back height · REF short back wall · APP twin back walls ·
membrane adhesive rate · `BOARD_GROUP_TOKENS` verification · handle/shutter-type
compatibility rule.
