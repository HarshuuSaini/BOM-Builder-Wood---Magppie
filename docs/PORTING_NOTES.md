# Porting notes — Stone → Wood

This repo is the stone Carcass BOM Builder with the construction layer replaced.
Read this before touching anything, so you know which files you can diff against
stone and which are genuinely new.

## Copied verbatim — do not re-derive

These are material-agnostic. If stone changes them, copy the change across.

```
src/app/api/**                  all Zoho routes, unchanged
src/app/layout.tsx
src/app/page.tsx
src/app/qr/bom/[orderId]/       QR BOM page
src/app/reorder/
src/lib/types.ts                incl. FullBomRow / OosRow / BomReportRow
src/lib/naming.ts               splitDrillAndFinish, normalizePartOrPanelName,
                                getPartBaseName, getPanelBaseName
src/lib/stock.ts                isComposite, collectMappedItemIds, getCfValue
src/lib/zoho.ts
src/lib/report.ts
src/components/AuthGate.tsx
src/components/BomOrderCard.tsx
src/components/ReorderReport.tsx
src/components/DraftPoModal.tsx
src/components/QrBomPage.tsx
src/components/AiCopilot.tsx
next.config.ts  package.json  tsconfig.json
```

## Rewritten

| File | Was | Now |
|---|---|---|
| `src/components/WoodBomBuilder.tsx` | `CarcassBomBuilder.tsx` | Same pipeline, wood construction |
| `src/lib/rawmaterial.ts` | `StoneGroup` keyed `category\|finish\|thk` | `BoardGroup` keyed `category\|boardType\|finish\|thk`, plus `LaminateGroup` |
| `src/data/board_finishes.json` | `stone_finishes.json` | Board shades |
| `src/data/laminate_finishes.json` | — | New |
| `src/data/edgeband_finishes.json` | `profile_finishes.json` | 0.8mm band shades |
| `src/app/{builder,designer,planning}/page.tsx` | mounted `CarcassBomBuilder` | mount `WoodBomBuilder` |
| `src/lib/export.ts` | stone identifiers | renamed Stone→Board |
| `src/components/BomDashboard.tsx` | consumed `StoneGroup` API | renamed Stone→Board |
| `src/app/page.tsx` | rendered `BomDashboard` at `/` | landing page with links |
| `src/app/dashboard/page.tsx` | — | `BomDashboard` moved here |

### BomDashboard is NOT material-agnostic

It consumes the raw-material selection layer directly — `stoneGroups`,
`defaultStoneId`, `searchStoneItems`, `applyStoneChange`. Those were renamed to
their Board equivalents. If you diff it against stone, expect a pure
Stone→Board identifier rename and nothing else.

## Zoho matching — VERIFY THIS FIRST

`rawmaterial.ts` finds board items by matching `cf_group` / `group_name`. Stone
matched the single token `"stone"`. Wood has several board families, so it now
matches any of:

```ts
export const BOARD_GROUP_TOKENS = ["board", "ply", "plywood", "mdf", "particle"];
```

**These are a guess.** Check them against the real `cf_group` values in your
Zoho item master. If none match, `findDefaultBoard` returns nothing, every
panel resolves to no raw material, and the failure is silent — no error, just
an empty raw-material section.

The search terms tried per thickness are in `boardQueries()` in the same file.

## Pipeline — unchanged contract

```
buildCarcassInnerRaw  →  mergeCarcassPanels  →  buildModel
                      →  buildRawRows / buildCSV
                      →  buildFullBomData  →  buildOosData  →  buildOptiData
```

`FullBomRow` keeps all 26 columns and the L0→L4 levelling, so the Excel export,
the stock check and the QR BOM page all work without modification. The 26th is
`_type`, which is internal — `applyRowColors()` in `export.ts` keys the row fill
off it. Drop it and the Excel export silently loses its colour coding.

## Construction changes

**Full sides everywhere.** Stone branched on `ZONES.construct` between `fulltb`
and `fullsides`. Wood is `fullsides` for every cabinet — sides run `D × H`, top
and bottom sit between them at `(W − 2t) × D`. The `construct` field is gone.

**Back is grooved.** `(W − 2t + 9) × (H − 2t + 9)` at 8mm nominal. The +9 is a
5mm groove per side less 1mm total clearance. This deletes `STEP`, `stepSil`
(the 15-bucket silicone lookup), `STP_SIZE`, `STP_KG` and the HM-509 stepper
profile.

**Edge banding.** 0.8mm on all four edges of every panel except the back.
Cut sizes in the BOM are **finished** sizes — pre-milling removes 0.8mm and the
band restores it, so there is no deduction anywhere.

**Shutter Type replaces Shutter Profile Design.** Six options. Laminated
(prelam / post-lam) carries the band; membrane and PU do not. Glass keeps the
aluminium frame and is the only surviving user of `SH_INSET` / `SH_FRAME`, now
a two-entry table (Neon 20 inset 5 frame 25; Neon 50 inset 8 frame 50).

**Shelf material is derived, not configured.**

```ts
isGlassShutterFam(fk) ? "8mm toughened glass" : BOARDS[board].core
```

Note this is a behaviour change from stone: a WST wall unit with a laminated
shutter now gets a ply shelf, where stone gave it glass unconditionally.

**Drawer boxes are bought in.** HM-513 and HM-535 are gone. The metal box is a
purchased set; we cut the bottom and back from `DRAWER_DED`, keyed by model and
height class:

```
Bottom = (W − botWded) × (D − botDded)
Back   = (W − backWded) × backH
```

| Model | Line | Low | High | Bottom ded W/D | Back W ded |
|---|---|---|---|---|---|
| Hettich | INNOTECH / ATIRA | 68 | 144 | 108 / 80 | 120 |
| Blum | ANTARO | 69 | 183 | 111 / 69 | 123 |
| Hafele | MATRIX | 69 | 164 | 111 / 69 | 123 |
| Grass | DWD | 68 | 164 | 111 / 69 | 111 |

All bottoms and backs are 16mm.

**Two height classes only.** Stone's Semi-High is not used in wood. The counting
rules survive with one change: `fixed_dpn` (DPN / DPNG) was 2 Low + 3 Semi-High
and is now **2 Low + 3 High**. `2HB+1BL` high-takes-low and the runner dedup are
unchanged.

**Nothing is automatic.** `addElenor()` no longer fires inside the carcass
build; Elenor is an opt-in accessory alongside the rest.

## Deleted from stone

`ctGeom` · `CT_TYPES` · `ctHasDrop` · `ctEdgingOptions` · brass strip · dead-stock
counter base · drop-down geometry · mitred patti · Akemi · Bondtite · Latricate ·
the whole Backsplash section · `VP_PRESETS` · `SH_DESIGNS` · `XCJ_DESIGNS` /
`STD_DESIGNS` · `shThkOf` (except glass) · `STONE_WASTE` · `KG_SQFT` ·
`SH_KGSQFT` · HM-504 · HM-509 · HM-510 · HM-511 · HM-513 · HM-535

## Stubs — deliberately not guessed

These raise a visible amber note in the UI rather than emitting a wrong number.
Search `stubs.push` to find them.

1. **Drawer fronts — resolved.** Per user direction, use stone's 180mm Low and
   360mm High slots, applying the shutter gap deduction and selected shutter
   edge-banding rule.
2. **Drawer — Lian — resolved.** Per user direction, use the stone drawer-box
   construction: bottom `(W−50) × (D−77)`, back `W−72`, back heights 63/212,
   bottom 6mm and back 15mm.
3. **Drawer panel material.** Not specified. `DRAWER_PANEL_MAT` assumes BWP ply
   at the given thickness; change it in one place if that is wrong.
4. **Drawer panel edge banding.** Assumed none — the "all panels except the
   back" rule was stated for carcass and shutters, and a drawer bottom sitting
   in a metal box is neither.
5. **MD back panel height** — no bottom panel, so the back is grooved on three
   edges and the +9 allowance does not apply symmetrically.
6. **REF short back wall** — stone uses `H − 1874`.
7. **APP twin back walls** — stone splits upper/lower at `H − 1349`.
8. **Membrane adhesive rate** — g/sqft not yet supplied; the line is emitted by
   area only.

## Constants

| | |
|---|---|
| Carcass `t` | 18 nominal (Option A is a 16mm core + 0.8 × 2) |
| Back | 8 nominal (Option A is a 6mm core + 0.8 × 2) |
| Groove allowance | +9 |
| `CJ_CUT` | 23 — unchanged |
| Shutter deduction | 3, or 33 on a gola base cabinet; ML front keeps 3 |
| Shelf | `(W − 2t − 1) × (D − 28)` |
| Sheet | 2440 × 1220 = 32.03 sqft |
| Waste | carcass 10% · shutter 20% · profile 20%, all editable |
| Laminate adhesive | 25 g/sqft/side |
| PU | epoxy 15 · primer 30 · top coat 50 g/sqft/side |
| Membrane oversize | +50mm per edge |

## Reference figure

A `BC.SH` 600 × 720 × 560 on board option A yields **22.978 sqft** of panel and
**11.806 RMT** of edge band. Use it to check any refactor.
