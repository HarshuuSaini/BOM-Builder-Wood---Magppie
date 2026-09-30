# Prioritised Backlog

## Completed

- Study of the stone app; section and field inventory
- Zone and family catalog carried over in full (14 zones, ~30 families)
- Standard width table (53 sizes) captured and confirmed
- Base height stack settled: 100 + 720 + 30 = 850
- Full-sides construction; all carcass panel formulas
- 8mm grooved back, `(W − 2t + 9) × (H − 2t + 9)`
- Three carcass board options with matched backs
- Six shutter types with consumable rates
- Glass branch: Neon 20 / Neon 50, insets and frames
- Edge banding rule: 0.8mm, all edges except backs, no size deduction
- Shelf material derived from shutter type
- PVC legs and skirting-as-accessory
- Bought-in drawer boxes; deductions for Hettich, Blum, Hafele, Grass
- Two drawer height classes; `fixed_dpn` collapsed
- Wastage 10 / 20 / 20, editable
- Countertop, filler and visible-panel simplifications; backsplash removed
- Repo port with stone's architecture; typecheck clean
- Headless smoke harness
- Full documentation set

## In progress

Nothing is mid-edit. The tree is consistent and typechecks.

## Pending — blocked on the user

Each needs a number or a decision only Magppie can give.

| P | Item | Blocks |
|---|---|---|
| 1 | Drawer front heights per class | All multi-drawer cabinets |
| 1 | Lian deductions | Any Lian cabinet |
| 2 | `BOARD_GROUP_TOKENS` verification | All Zoho resolution |
| 2 | MD back panel height | MD cabinets |
| 3 | REF short back wall | Over-orders material on REF |
| 3 | APP twin back walls | Over-orders material on APP |
| 3 | Membrane adhesive rate | Membrane consumable line |
| 4 | Handle / shutter-type compatibility | Unmanufacturable combinations |
| 4 | Confirm `fixed_dpn` = 2 Low + 3 High | Pantry drawer sizing |
| 4 | Confirm drawer panel material and banding | Drawer BOM accuracy |
| 4 | Confirm SK/HO/WDR ply rails | Sink and hob units |

## Pending — engineering

| P | Item |
|---|---|
| 1 | `middleware.ts` protecting `/api/:path*` |
| 1 | Move the auth password to an env var |
| 2 | ~~Build the remaining UI sections: fillers, visible panels, countertop, accessories, raw-material selection, stock check, downloads~~ — DONE (Sep 2026). Cabinet code also brought up to stone's 11-segment contract: `p1-p2-handleToken-matToken(GL\|WD)-p3-p4-p5-W-H-D-t[-FINISH]`. Raw-material section currently searches boards only; laminate/edge-band search helpers are wired but have no UI yet |
| 2 | Cycle guard on the composite traversal |
| 3 | Automated tests (see `TESTING.md`) |
| 3 | Warn when a board group yields zero Zoho candidates |
| 4 | Fix the two inherited `BomDashboard` type errors |
| 4 | Error tracking |

## Future enhancements

- Real role model: designer / planner / purchasing
- Audit trail on board substitutions
- Nesting optimisation via `buildOptiData`, replacing flat wastage
- Per-project wastage overrides
- Saved projects (would need the first real datastore)
- Shared catalog module so stone and wood stop diverging

## Blockers

**Only one hard blocker:** `BOARD_GROUP_TOKENS`. Until verified against the real
Zoho item master, no Zoho-backed feature can be trusted — and it fails silently,
so it will look like it works.

Everything else is either a stub that fails safely and visibly, or engineering
work that needs no external input.
