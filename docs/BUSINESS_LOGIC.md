# Business logic — wood

## Construction

Every cabinet is **full sides**: sides run the full height. Base cabinets omit
the top panel. Wall dish-rack cabinets omit the bottom panel.

| Panel | Formula | Thk | Band |
|---|---|---|---|
| Side LH/RH | `D × H`, qty 2 | 18 | yes |
| Top | `(W − 2t) × D` — non-base only; gola cuts depth to `D − 23` | 18 | yes |
| Bottom | `(W − 2t) × D` — omitted for WDR dish-rack | 18 | yes |
| Back | `(W − 2t + 9) × (H − 2t + 9)` | 8 | **no** |
| Shelf | `(W − 2t − 1) × (D − 28)` | 18 or 8 glass | yes / no |
| Top rails (SK, HO, WDR) | `(W − 2t) × 100`, qty 2 | 18 | yes |

Base height stack: 100 skirting + 720 carcass + 30 counter = 850.

## Edge banding

0.8mm, all four edges, every panel except the back. Cut sizes are finished
sizes — no deduction, because pre-milling removes exactly what the band adds.

## Shutter types

| Type | Core | Face | Band |
|---|---|---|---|
| Prelaminated | 18mm prelam | — | yes |
| Post-laminated | 16mm ply | 0.8mm laminate × 2 | yes |
| Membrane | 18mm prelam | membrane, +50mm/edge | no |
| PU one side | 18mm prelam | paint 1 face | no |
| PU both sides | 18mm ply | paint 2 faces | no |
| Glass | 5mm toughened | alu frame | n/a |

Leaf: `W / leaves` × `H − deduction`, where deduction is 3, or 33 on a gola
base cabinet (the ML drawer front keeps 3).

Glass inset: Neon 20 → 5mm, frame 25. Neon 50 → 8mm, frame 50.

## Carcass board options

| | Core | Back |
|---|---|---|
| A | 16mm ply + 0.8mm laminate × 2 | 6mm ply + 0.8mm laminate × 2 |
| B | 18mm prelam MDF | 8mm prelam MDF |
| C | 18mm prelam particle board | 8mm prelam particle board |

## Shelf material

```
isGlassShutterFam(fk) ? "8mm toughened glass" : BOARDS[board].core
```

## Consumable rates

- Laminate adhesive 25 g/sqft/side
- PU epoxy 15, base primer 30, top coat 50 g/sqft/side
- Membrane oversize +50mm/edge; adhesive rate **not yet supplied**

## Sheets

`sheets = sqft × (1 + waste%) / 32.03` where a sheet is 2440 × 1220.
Waste: carcass 10%, shutter 20%, profile 20% — all editable.
Glass is bought by area, not by the sheet.

## Hardware

`legCount(w)` = 2 if w ≤ 150, 6 if w ≥ 1050, else 4.
Workbook hinge packs use 2 hinges per leaf when H ≤ 720, 3 when H ≤ 1050,
and 5 above 1050.
Drawer boxes, rolling shutters and skirting are bought-in.

## Drawer boxes

Metal box is bought in. We cut the bottom and back.

```
Bottom = (W − botWded) × (D − botDded)
Back   = (W − backWded) × backH
```

| Model | Line | Low back H | High back H | Bottom ded W/D | Back W ded | Thk |
|---|---|---|---|---|---|---|
| Hettich | INNOTECH / ATIRA | 68 | 144 | 108 / 80 | 120 | 16 |
| Blum | ANTARO | 69 | 183 | 111 / 69 | 123 | 16 |
| Hafele | MATRIX | 69 | 164 | 111 / 69 | 123 | 16 |
| Grass | DWD | 68 | 164 | 111 / 69 | 111 | 16 |

Lian is **not supplied** — the returned template still held the example row.

Two height classes only; stone's Semi-High is unused. Drawer mix per variant:
`2dr`/`2dw` → 2 High · `3dr` → 2 Low + 1 High · `fixed_dpn` (DPN/DPNG) →
2 Low + 3 High.

**Drawer fronts are not emitted** for multi-drawer cabinets — front heights per
class were never supplied. The carcass, box sets and bottom/back panels are
still produced; a stub names the gap.

## Edge cases worth knowing

| Case | Behaviour |
|---|---|
| Glass material | Bought by area — `buildBoardTotals` returns `sheets: null` |
| `AP` family | `backStrips` — two 75mm rails instead of a full back |
| `SK` / `HO` / `WDR` | `top: "frame"` — two 100mm ply rails, no top panel *(assumption)* |
| `MD` | No bottom panel; back height parked, stub raised |
| `REF` / `APP` | Full-height back emitted plus a stub — **over-orders material** |
| `WOP` | No shutter; open shelving |
| Merged panels | LH/RH pairs collapse to one row, `drill` promoted to `LH/RH` |
| Membrane adhesive | Rate unset — emitted by area, stub raised |

## Reference figure

`BC.SH` 600 × 720 × 560, board option A → **22.978 sqft**, **11.806 RMT**.
# Project pricing factors

The bottom of the project Costing section applies commercial factors after the
cabinet/item costing has been calculated:

1. `conversion = base costing × conversion %`
2. `converted cost = base costing + conversion`
3. `profit = converted cost × profit %`
4. Transportation, installation, and loading/unloading are each either a
   direct project amount or `rate × billable project sqft`.
5. `subtotal = converted cost + profit + all three service charges`
6. When enabled, `GST = subtotal × 18%`; the final project price is subtotal + GST.

Billable project sqft is the sum of all square-foot costing rows after their
applicable board wastage. The screen shows this area beside the factor inputs so
that per-square-foot service charges remain auditable.

The project summary also shows billable sqft and service charges cabinet by
cabinet. Per-sqft charges are calculated directly for each cabinet. A direct
project charge is allocated between cabinets in proportion to their billable
square footage; the allocation does not alter the project charge total.
