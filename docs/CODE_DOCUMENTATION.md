# Code Documentation

Reference for every module, type and significant function. Grouped by file.

---

## `src/components/WoodBomBuilder.tsx`

The builder. Laid out in the same section order as stone's
`CarcassBomBuilder.tsx`.

### Interfaces

| Type | Fields | Notes |
|---|---|---|
| `Panel` | `name, w, h, qty, drill, pack, t?, mat?, band?` | `mat` and `band` are wood additions — the material key for board grouping, and whether all four edges get 0.8mm band |
| `Profile` | `name, len, qty, type, pack` | Glass branch and light accessories only |
| `Hardware` | `name, qty, uom?, pack?` | |
| `Consumable` | `name, qty, uom, pack` | |
| `CarcassModel` | config + `panels, profiles, hardware, cons, pkRows, stubs` | One configured cabinet |
| `ProjectLine` | `id, m, qty, elevation` | A cabinet placed in a project |
| `FullBomRow` | 26 keys | **Contract.** `_type` is internal, read by `applyRowColors()` |
| `DrawerDed` | `line, code, backH, botWded, botDded, backWded, botT, backT` | One row of the drawer lookup |

### Constants

| Name | Value | Purpose |
|---|---|---|
| `SQDIV` | 92903.04 | mm² per sqft |
| `SHEET_SQFT` | 32.03 | 2440 × 1220 |
| `T` | 18 | Carcass nominal |
| `T_BACK` | 8 | Back nominal |
| `GROOVE` | 9 | Back groove allowance |
| `CJ_CUT` | 23 | Gola top-depth cut |
| `SHELF_W_CLR` / `SHELF_D_OFF` | 1 / 28 | Shelf clearances |
| `BAND_T` | 0.8 | Edge band |
| `LAM_ADH` | 25 | g/sqft/side |
| `PU_RATE` | 15 / 30 / 50 | epoxy / primer / topcoat, g/sqft/side |
| `MEMB_OVER` | 50 | mm per edge |
| `MEMB_ADH` | `null` | **Not supplied** — triggers a stub |
| `WASTE` | 10 / 20 / 20 | carcass / shutter / profile |

### Catalog

`ZONES` (14) · `BASE_FAMILIES` · `BLIND_FAMILIES` · `WALL_FAMILIES` ·
`TALL_FAMILIES` · `TALL_BLIND_FAMILIES` · `TALL_LOW_FAMILIES` ·
`LOFT_FAMILIES` · `MD_FAMILIES` · `WIDTHS` · `BOARDS` · `SHUTTER_TYPES` ·
`SH_INSET` · `SH_FRAME` · `DRAWER_DED`.

Family flags: `shelf`, `drawers`, `fixedDpn`, `glassFam`, `noBottom`,
`noShutter`, `backStrips`, `top: "frame"`, `special: "MD" | "REF" | "APP"`.

### Functions

**`famSetOf(z)`** → families for a zone. Four hard-coded exceptions (BCL, BB,
BBL, WB) carried from stone verbatim.

**`defSizes(zoneKey, fk)`** → `{ w[], h[], d }`. Widths from `WIDTHS` or a
fallback; heights by zone kind; depth 560 unless low/wall/loft/md, with
LBF/LOF forced back to 560.

**`shDeduct(isBase, handle, loc)`** → 3 normally; **33** on a gola base cabinet;
3 for the `ML` middle low-back drawer front. Unchanged from stone.

**`shelfMaterialOf(fk, board)`** → `{ mat, t, band }`. Glass family → 8mm
toughened glass, unbanded. Otherwise the carcass core, banded.

**`shelfCount(zk, fk, fam, H)`** → wall zones derive from height (WDR: 2 if
H ≥ 1085 else 0; others 3 or 1); everything else uses `fam.shelf`.

**`shutSpec(zk, fk, v)`** → `{ leaves }`. 0 if `noShutter`, else 2 for
`both`/`double`, else 1.

**`drawerBreakdown(fam, v)`** → `[{cls, n}]`. `fixedDpn` → 2 Low + 3 High;
`3dr` → 2 Low + 1 High; `2dr`/`2dw` → 2 High; default 1 High.

**`addDrawerBoxes(fk, v, W, D, model, panels, hardware, pkRows, stubs)`**
Pushes the bought-in box set, then per class emits
`bottom = (W − botWded) × (D − botDded)` and `back = (W − backWded) × backH`.
Missing model or class → stub, no panels. *Edge case:* Lian has no table entry
at all, so the box set is still costed and all panels withheld.

**`buildShutters(...)`** Returns `{leaves, leafW, leafH}`.
*Edge case:* a drawer family with more than one drawer returns zero leaves and
raises the front-height stub, rather than emitting one oversized leaf.
Glass branch emits the inset panel, two profile cuts and four corner
connectors. Non-glass emits one leaf per door at the shutter board thickness.
Hinges always `hingeN(H) × leaves`.

**`mergeCarcassPanels(panels)`** Groups by pack + name-without-LH/RH + w + h +
t + mat + band, sums quantities, promotes `drill` to `LH/RH` when both sides
merge. Ported from stone.

**`explodePanelForTree(p, finish)`** One panel → L2 panel, L3 part, L4 raw
material (sqft), plus an L4 edge band row (RMT) when banded.

**`buildCarcassInnerRaw(cfg)`** The heart. Emits sides, top (with `CJ_CUT`
where gola), bottom unless `noBottom`, back (or strips, or a stub for MD), sink
rails for `top: "frame"`, shelves, then delegates to `buildShutters` and
`addDrawerBoxes`, adds legs, and computes consumables from the merged panels.
*Edge cases:* REF and APP emit a full-height back plus a stub, which
**over-orders material** until their real formulas land.

**`buildModel(cfg)`** Resolves the variant, builds, and composes the cabinet
code per stone's contract: `p1-p2-handleToken-matToken-p3-p4-p5-W-H-D-t[-FINISH]`.

**`buildRawRows(m)`** / **`buildCSV(project)`** Flatten to item/pack/uom/qty;
CSV dedups by cabinet + item + pack + uom and multiplies by line qty.

**`wasteFor(pack, uom)`** RMT/mtr → profile 20%; Shutter Pack → 20%; else 10%.

**`makeRow(o)`** Defaults all 26 `FullBomRow` keys, setting `_type` from `Type`.

**`buildFullBomData(project, so, finish)`** L0 cabinet → L1 pack → panel
explosion → profiles → hardware → consumables.

**`buildBoardTotals(project)`** Groups by material + thickness + pack, applies
pack wastage, divides by `SHEET_SQFT`. *Edge case:* anything matching
`/glass/i` returns `sheets: null` — glass is bought by area.

---

## `src/lib/rawmaterial.ts`

Ported from stone with a mechanical `Stone → Board` rename, plus wood
additions.

| Export | Notes |
|---|---|
| `BOARD_GROUP_TOKENS` | **Unverified.** Zoho `cf_group` matching. Fails silently. |
| `boardQueries(finish, thickness)` | Search terms tried in order |
| `BoardGroup` | Was `StoneGroup`; keyed `category\|boardType\|finish\|thickness` |
| `LaminateGroup` | New — faces, liners, band |
| `ProfileGroup` | Reachable only from the glass branch and light accessories |
| `RawMaterialSelection` | `{ boardGroups, profileGroups }` |
| `resolveRawMaterials(orders, itemsCache, compositesCache)` | Stone's signature |
| `searchBoardItems(finish, thickness, excludeBoardId?)` | Was `searchStoneItems` |
| `searchLaminateItems(finish, kind)` | New |
| `searchProfileItems`, `searchHardwareItems` | Unchanged |
| `applyBoardChange(group, soNumber, orderId, order)` | Was `applyStoneChange` |
| `applyProfileChange(...)` | Unchanged |

*Edge case:* the composite traversal has **no cycle guard**.

---

## Verbatim from stone — do not rewrite

| File | Exports |
|---|---|
| `lib/naming.ts` | `splitDrillAndFinish`, `normalizePartOrPanelName`, `getPartBaseName`, `getPanelBaseName` |
| `lib/types.ts` | Zoho and BOM report types |
| `lib/stock.ts` | `isComposite`, `collectMappedItemIds`, `getCfValue`, stock status |
| `lib/zoho.ts` | Token exchange, caching, upstream requests |
| `lib/report.ts` | Report shaping |
| `lib/export.ts` | Excel/CSV export, `applyRowColors` (reads `_type`) |
| `components/AuthGate.tsx` | `AuthGate` — **named export** |
| `components/BomOrderCard.tsx`, `ReorderReport.tsx`, `DraftPoModal.tsx`, `QrBomPage.tsx`, `AiCopilot.tsx` | |
| `app/api/**` | All Zoho routes |

`components/BomDashboard.tsx` is ported **with the same rename** — it consumes
the raw-material API directly and is not material-agnostic.

---

## Presentational components

`Fld` label+control+hint · `Hint` muted line · `Seg` segmented toggle ·
`Stub` amber panel · `Tbl` table with right-aligned numeric columns.
