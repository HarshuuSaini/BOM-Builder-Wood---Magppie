# Project Overview — Magppie Carcass BOM Builder

## Project name
**Magppie Carcass BOM Builder** (Vercel project `inventory-magppie`) — part of the Magppie Inventory suite.

## Vision
Let Magppie configure any stone modular-kitchen cabinet once, and have every downstream artefact — the canonical code, the manufacturing Bill of Materials, cut/optimisation lists, packing lists and labels, purchase quantities, and the ERP records in Zoho Inventory — derive **automatically and identically** from that single configuration. Eliminate the manual spreadsheet chain between design, planning, purchase and the factory floor.

## Objective
1. Encode Magppie's cabinet construction rules once, in code, as the single source of truth.
2. Produce a **manufacturable** BOM (real cut sizes, real hardware packs, real waste) — not an estimate.
3. Push composite items and Sales-Order lines into **Zoho Inventory (India)** idempotently, so re-running never duplicates masters.
4. Give each team a purpose-built surface: designers pick finishes against a live SO; planning converts SO service lines into BOMs; purchase sees shortfalls and raises draft POs; the factory gets packing lists and labels.

## Scope

**In scope**
- Cabinet configurator across 14 zones and ~25 families with variants, sizes, handles, designs, materials.
- Full BOM engine: carcass panels, shutters/fronts, drawer boxes, blind fixed panels, profiles, hardware packs, consumables, cut/drill operations.
- Auxiliary sections: Fillers, Visible Panels, Countertop (9 constructions), Backsplash, Chimney/Dishwasher panels, Accessories (skirting/lights/handles).
- Raw-material resolution + purchase roll-ups with waste and weight.
- Exports: Full BOM Excel, OOS, Opti, All Combinations, All Shutter Codes, packing lists, labels, CSV, QR.
- Zoho: item/composite creation, SO line replacement, stock checks, re-order report, draft POs.
- Multi-SO BOM backorder dashboard.

**Out of scope (today)**
- Pricing/quotation engine beyond a per-line rate; CRM; production scheduling; a local database; per-user accounts/RBAC; mobile-native apps; multi-tenant/multi-org.

## Features
| Area | Feature |
|---|---|
| Configurator | Zone → family → variant → size/handle/design/material; live 11-field cabinet code + shutter codes; mandatory Elevation; project lines with qty/rate |
| BOM engine | Per-zone carcass construction, drawer boxes, shutters & blind dummy panels, Elenor light, hardware packs, consumables, operations |
| Sections | Fillers (+Elevation, presets), Visible Panels (presets), Countertop (9 types), Backsplash, Chimney/Dishwasher, Accessories |
| Roll-ups | Stone by finish+thickness (+15%), profiles by code+colour (+20%), hardware, consumables, weights |
| Raw material | Zoho item pick per bucket, stock display, slab-dimension warnings, core-name stone matching |
| Exports | Full BOM Excel (S.No + Elevation), OOS, Opti, All Combinations (+6 sqft columns), All Shutter Codes, carcass/shutter packing lists, labels, CSV |
| Zoho | Idempotent composites, SO push with service-line replacement, stock check, re-order report, per-row/bulk draft POs |
| Dashboard | Multi-SO BOM expansion, stock statuses, QR (BOM/user), packing-list modal, accessories subform |
| Designer | SO decode + Excel upload; per-line & bulk shutter colour by Price Group |
| Planning | SO decode → rebuild BOMs → replace SO service lines |
| Assistant | Floating AI copilot with page BOM context (OpenAI) |

## Modules
1. **Configurator & code engine** — zones/families/SIZES/codes.
2. **BOM engine** — `buildModel` → carcass/drawers/shutters/Elenor.
3. **Countertop engine** — `CT_TYPES` + `ctGeom` (9 constructions).
4. **Aux sections** — fillers, visible panels, backsplash, other accessories, accessories.
5. **Aggregation** — raw roll-ups + waste + weight.
6. **Raw-material resolver** — `src/lib/rawmaterial.ts`.
7. **Export engine** — Excel/CSV/HTML/QR/labels.
8. **Zoho integration** — `src/lib/zoho.ts` + `/api/zoho/*` + push orchestration.
9. **Dashboard & reports** — `BomDashboard`, `ReorderReport`, `QrBomPage`, `DraftPoModal`.
10. **Shell** — `AuthGate`, `AiCopilot`, layout.

## User roles (personas — enforced by route, not by RBAC)
| Role | Surface | Does |
|---|---|---|
| **Estimator / BOM engineer** | `/builder` | Configure cabinets, build the project, pick raw materials, export, push to Zoho |
| **Designer** | `/designer` | Load a Zoho SO or upload the Shutter Excel; pick shutter colours per Price Group (per-line & bulk) |
| **Planning** | `/planning` | Load an SO, rebuild BOMs, replace SO service lines with composites |
| **Purchase** | `/reorder`, dashboard draft-PO | Review shortfalls, vendor/lead times, raise draft POs (one per vendor) |
| **Factory / dispatch** | dashboard, `/qr/bom/:id` | Packing lists, labels, QR lookups |
> There is **no real authorization** — a single client-side password gates everything and all users share one Zoho service identity. See `AUTHENTICATION.md`.

## Current implementation status
**Live in production** — https://inventory-magppie.vercel.app (Vercel `inventory-magppie`, Zoho org `60063687231`, India DC).

Complete & shipped: configurator + code engine (incl. **P7 = `XXX`** de-duplication); BOM engine incl. drawer rules (**2HB+1BL High-takes-Low**, **hardware dedup**, **WBP no-drawer fix**); shutters/blind; **countertop 9-type model** with folded patti, drop-down mini-BOM, mitre issuance, 100 mm reductions, rounding-as-name; fillers/visible-panel/chimney presets; **filler Elevation**; **wall height 725**; **Loft Glass `1SG` fix**; **500 mm hinged+shelf width**; all exports; Zoho push; dashboard; re-order report; designer/planning flows.

Known gaps: no server-side auth, no persistence, no test framework, one very large component. See `TESTING_AND_BUGS.md` and `BACKLOG.md`.

## Future roadmap
**Now (P0 – integrity):** server-side auth + protect `/api`; remove the client password constant; rotate the Zoho refresh token; project save/restore.
**Next (P1 – confidence):** real test runner + unit tests for `ctGeom`/`shDeduct`/`addDrawerBoxes`/`validDesigns`/`parseCabinetCodeToModel`; pin MD3's profile item; retry/backoff on bulk Zoho pushes.
**Then (P2 – maintainability):** split `CarcassBomBuilder.tsx` into engine modules + UI; extract the domain tables (zones/families/SIZES) to data files; typed variants (drop `any`).
**Later (P3 – product):** per-user accounts & roles; pricing/quote output; production scheduling hooks; the Config-sheet zone-swap rules (Tall MD1→MD2, Wall MD2→MD1) if they should be enforced; the borderline 500 mm families (`BCL.SH`, `WDR`, `WOP`, `WB.*`) pending confirmation.
