# Project Overview

## Name
**Magppie Wood Kitchen BOM Builder**

## Vision
Give Magppie one tool that turns a kitchen design into a manufacturing-ready
bill of materials for plywood carcass kitchens, with the same rigour their
stone-kitchen tool already provides — so a designer's selections become a
carpenter's cut list without a spreadsheet in between.

## Objective
Replace manual BOM preparation for wood kitchens. A designer configures
cabinets from a fixed catalog; the app derives every panel, its finished cut
size, hardware counts, consumable quantities and board sheet requirements, then
resolves those against Zoho Inventory for stock and purchasing.

## Scope

**In scope.** Cabinet configuration across 14 zones and ~30 families; carcass
and shutter construction; drawer boxes; edge banding; consumables; board sheet
counts with wastage; fillers; visible panels; a simplified bought-in countertop;
optional accessories; the 26-column levelled BOM; Excel/CSV export; Zoho sales
order, raw-material and stock integration.

**Out of scope.** Backsplash (explicitly removed). Countertop fabrication
geometry (stone-only). 3D visualisation. Pricing and quotation. Production
scheduling. Nesting optimisation beyond a flat wastage percentage.

## Features

- Per-cabinet configuration form, 25 fields, conditional on zone/family/type
- Six shutter types: prelaminated, post-laminated, membrane, PU one side,
  PU both sides, glass (Neon 20 / Neon 50 aluminium frame)
- Three carcass board options, each with a matched back material
- Automatic panel derivation with finished cut sizes
- Edge banding at 0.8mm on all edges except backs
- Bought-in drawer boxes with per-model bottom/back deductions
- Board roll-up converting sqft to 2440×1220 sheets at editable wastage
- Levelled BOM (L0 cabinet → L4 raw material), 26 columns
- CSV and Excel export, out-of-stock and optimisation views
- Zoho Inventory integration: sales orders, items, composites, stock,
  purchase orders, reorder report
- QR-coded BOM page for the shop floor
- Visible stubs for anything not yet specified

## Modules

| Module | Entry point |
|---|---|
| Builder | `src/components/WoodBomBuilder.tsx` |
| BOM dashboard | `src/components/BomDashboard.tsx` |
| Raw material resolution | `src/lib/rawmaterial.ts` |
| Export | `src/lib/export.ts` |
| Stock | `src/lib/stock.ts` |
| Zoho client | `src/lib/zoho.ts` |
| Reorder | `src/components/ReorderReport.tsx` |
| Auth | `src/components/AuthGate.tsx` |

## User roles

The app has a **single shared role** gated by one password. There is no
per-user identity, no permission model and no audit trail. Routes are
differentiated by purpose, not privilege:

| Route | Intended user |
|---|---|
| `/builder` | Production planner |
| `/designer` | Designer, sales-order mode |
| `/planning` | Planner, planning mode |
| `/dashboard` | Purchasing / stores |
| `/reorder` | Purchasing |

A real role model is a backlog item.

## Current implementation status

**Working.** Full catalog; all panel formulas; carcass, shutter, drawer, glass
and hardware emission; consumables; board totals and sheet counts; levelled BOM;
CSV export; the three builder tabs; all ported Zoho routes and dashboard.

**Specified but not built into the UI.** Fillers, visible panels, countertop,
accessories, raw-material selection panel, stock check panel, downloads panel.
The engine and spec cover them; the React sections are not written.

**Stubbed on purpose.** Drawer front heights; Lian deductions; MD back height;
REF short back wall; APP twin back walls; membrane adhesive rate.

**Unverified.** `BOARD_GROUP_TOKENS` against the real Zoho item master.

## Future roadmap

1. Close the open items in `BUGS.md`
2. Build the remaining UI sections
3. Verify and wire Zoho board/laminate resolution end to end
4. Move the auth password to an env var; add a real role model
5. Automated test suite
6. Nesting optimisation via `buildOptiData`
