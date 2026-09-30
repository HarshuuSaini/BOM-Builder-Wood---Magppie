# Testing

## Current state

**There is no automated test suite.** No Jest, Vitest, Playwright or Cypress.
Verification today is a headless smoke harness plus a reference figure.

## The smoke harness

`tools/smoke/` strips the React layer off `WoodBomBuilder.tsx`, transpiles the
pure engine and runs it under Node. This is how two real defects were found
(`FullBomRow` missing `_type`; drawer units emitting one full-height shutter).

```bash
cd tools/smoke
./build.sh      # regenerate core.ts from the component and transpile
node run.js
```

It exercises four cabinets across base, wall and tall zones, three board
options, four shutter types and three drawer models, then prints panels, board
totals, BOM row counts, CSV head and stubs raised.

## The reference figure

The single most useful regression check. A **`BC.SH` 600 × 720 × 560 on board
option A**:

| | Expected |
|---|---|
| Panel area | **22.978 sqft** |
| Edge band | **11.806 RMT** |
| Side | 560 × 720 × 2 @18 |
| Top | 564 × 560 @18 |
| Bottom | 564 × 560 @18 |
| Back | 573 × 693 @8, **no band** |
| Shelf | 563 × 532 @18 |

If a refactor moves these and you did not intend it, stop.

## Test data

```js
{ zk:'BC', fk:'SH',  vid:'double', handle:'STD', board:'A', shType:'POSTLAM', W:600,  H:720,  D:560 }
{ zk:'BC', fk:'DW',  vid:'3dr',    handle:'XCJ', board:'A', shType:'PRELAM',  W:600,  H:720,  D:560, drawerModel:'Blum' }
{ zk:'WC', fk:'WGL', vid:'dbl',    handle:'STD', board:'B', shType:'POSTLAM', W:900,  H:1085, D:336, neon:'NEON50' }
{ zk:'TC', fk:'DPN', vid:'h',      handle:'STD', board:'A', shType:'PU2',     W:600,  H:2400, D:560, drawerModel:'Grass' }
```

## Manual checklist

### Construction
- [ ] Side is `D × H`; top and bottom are `(W − 2t) × D` — not the reverse
- [ ] Gola cuts the top to `D − 23` (537 at D 560); standard leaves 560
- [ ] Gola base shutter is `H − 33` (687 at H 720); standard is `H − 3`
- [ ] Back is `(W − 2t + 9) × (H − 2t + 9)` at 8mm and is **never** banded
- [ ] Shelf is `(W − 2t − 1) × (D − 28)`
- [ ] Cut sizes carry **no** edge-band deduction

### Boards and shelves
- [ ] Option A → 16mm core, 6mm back core, laminate + adhesive lines present
- [ ] Options B and C → no laminate lines
- [ ] Glass family → 8mm glass shelf; non-glass → carcass core material
- [ ] A WST with a laminated shutter gets a **ply** shelf (differs from stone —
      this is correct)

### Shutters
- [ ] Prelam and post-lam are banded; membrane and PU are not
- [ ] Post-lam emits outer + liner laminate and adhesive at 25 g/sqft/side
- [ ] PU emits epoxy 15 / primer 30 / topcoat 50, doubled for both-sides
- [ ] Neon 20 inset 5, Neon 50 inset 8; glass 5mm; 4 corner connectors per leaf
- [ ] `W > 600` or a `both`/`double` variant → 2 leaves

### Drawers
- [ ] Hettich 3dr → bottoms 492×480, backs 480×68 ×2 and 480×144 ×1
- [ ] Grass DPN → 5 bottoms, 2 backs at 489×68, 3 at 489×164
- [ ] Multi-drawer cabinets raise the front-height stub
- [ ] Lian raises its stub and still costs the box set

### Totals and output
- [ ] Carcass pack takes 10% wastage, shutter 20%
- [ ] Glass shows "by area", not a sheet count
- [ ] Sheet divisor is 32.03 sqft
- [ ] `FullBomRow` has **26** keys including `_type`
- [ ] Levels 0–4 all present
- [ ] CSV deduplicates by cabinet + item + pack + uom

### UI
- [ ] Changing zone resets family, variant and dimensions coherently
- [ ] Glass families hide Shutter Type and show the Neon toggle
- [ ] Drawer Model appears only for drawer families
- [ ] Stubs render amber and name what is missing
- [ ] Layout collapses cleanly below 820px
- [ ] Focus outlines visible on every control

### Zoho — needs credentials
- [ ] `GET /api/zoho/status` reports healthy
- [ ] A sales order resolves to non-empty board groups
      *(if empty, suspect `BOARD_GROUP_TOKENS` before anything else)*
- [ ] Board substitution writes back and the tree reflects it

## Recommended suite

**Unit** — panel formulas across zones and families; `shDeduct`; `legCount`;
`hingeN`; `shelfCount`; `drawerBreakdown`; `mergeCarcassPanels` LH/RH pairing;
`buildBoardTotals` wastage and glass exclusion.

**Integration** — `buildModel` snapshots for the four test cabinets;
`buildFullBomData` column count and levels; `buildCSV` dedup; `resolveRawMaterials`
against a mocked Zoho fixture, including the zero-match case.

**E2E** — configure, add, export; verify the downloaded CSV.
