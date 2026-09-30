# Workflows

## 1. Build a BOM for one cabinet

1. Open `/builder`, enter the password.
2. **Zone** — sets available families, default height and depth.
3. **Family** — sets variants and the standard width list.
4. **Configuration** — the variant; determines door/drawer counts and handing.
5. **Hand** — only if the variant is handed.
6. **Handle** — `STD` or `XCJ` (gola). Gola cuts the top depth by 23 and takes
   33mm off a base shutter.
7. **Carcass board** — A, B or C. Selects the core and its matched back.
8. **Shutter type** — six options. Locked to Glass for glass families, which
   instead offer a Neon profile choice.
9. **Drawer model** — only for drawer families.
10. **Finish** — the shade stamped on raw-material rows.
11. **W · H · D** — presets from the standard table; depth is free text.
12. **Elevation and quantity.**
13. **Add to project.**

Internally: `buildModel` → `buildCarcassInnerRaw` → `buildShutters` +
`addDrawerBoxes` → `mergeCarcassPanels`.

## 2. Review a cabinet before committing

The **Packets** tab shows panels, profiles, hardware and consumables for the
current configuration, updating live. The cabinet code under the Add button is
the checkable identifier. The **Raw BoM** tab flattens the same unit into
item/pack/uom/qty rows.

## 3. Accumulate a project and export

1. Add cabinets; each becomes a `ProjectLine` with its own elevation and qty.
2. **Project & totals** lists the lines and the board roll-up.
3. Board totals group by material + thickness + pack, apply the pack's wastage
   (carcass 10%, shutter 20%), and divide by 32.03 sqft to get sheets. Glass
   shows "by area" instead.
4. **CSV** → `buildCSV`, deduplicated by cabinet + item + pack + uom.
5. **Full BOM** → `buildFullBomData`, 26 columns, levels L0–L4.

## 4. Resolve a BOM against Zoho

1. `/dashboard`, find the sales order.
2. `GET /api/zoho/salesorders/[id]` returns line items.
3. `resolveRawMaterials` walks each composite via
   `/api/zoho/compositeitems/[id]`, descending to non-composite leaves.
4. Leaves matching `BOARD_GROUP_TOKENS` group into `BoardGroup` by
   `category|boardType|finish|thickness`; area accumulates with wastage.
5. `findDefaultBoard` searches for a default per group.
6. The planner may substitute via `searchBoardItems`.
7. `applyBoardChange` writes back — either applying the default across all
   panels, or cloning the cabinet tree with the new board.

**If `BOARD_GROUP_TOKENS` matches nothing, step 4 yields no groups and the
section is silently empty.** That is the first thing to check.

## 5. Stock check and reorder

`stock.ts` compares required against `available_stock`, marking each row
in-stock / low-stock / out-of-stock. `buildOosData` filters to shortfalls;
`buildOptiData` reshapes them for cutting optimisation. `/reorder` aggregates
across orders; `DraftPoModal` turns a shortfall into a Zoho PO via
`/api/zoho/items/[id]/vendors` and `POST /api/zoho/purchaseorders`.

## 6. Shop floor

`/qr/bom/[orderId]` renders a printable BOM. `JsBarcode` and `qrcode` generate
the labels; `jspdf` produces the packing slip.

## 7. Adding a new cabinet family

1. Add the record to the relevant `*_FAMILIES` map in `WoodBomBuilder.tsx`,
   with `p2`, variants, and flags (`shelf`, `drawers`, `glassFam`, `noBottom`,
   `noShutter`, `top: "frame"`, `backStrips`, `special`).
2. Add its width list to `WIDTHS`.
3. If it needs construction no existing branch covers, add it to
   `buildCarcassInnerRaw` — and if a dimension is unknown, **push a stub**.
4. Verify with `tools/smoke/run.js`.

## 8. Changing a construction rule

Constants sit at the top of `WoodBomBuilder.tsx`. Change there, never inline.
Then re-run the smoke harness and check the reference figure: a `BC.SH`
600×720×560 on board A must give **22.978 sqft** and **11.806 RMT** unless the
change was meant to move it.
