# Code Documentation — Module & Symbol Index

Complete index of every module, component, exported symbol and key internal function, with its responsibility and where it is documented in depth.

> Deep dives: **`BUSINESS_LOGIC.md`** (every function: purpose/inputs/outputs/formula/edge cases), **`API.md`** (routes), **`DATABASE.md`** (models), **`UI_UX.md`** (components/screens).

---

## Pages (`src/app/`)

| File | Export | Responsibility |
|---|---|---|
| `layout.tsx` | `RootLayout` | Wraps all pages in `<AuthGate>`, mounts `<AiCopilot>`, loads `globals.css` |
| `page.tsx` | default | `/` → renders `<BomDashboard />` |
| `builder/page.tsx` | default | `/builder` → `<CarcassBomBuilder />` |
| `designer/page.tsx` | default | `/designer` → `<CarcassBomBuilder soMode />` |
| `planning/page.tsx` | default | `/planning` → `<CarcassBomBuilder soMode planningMode />` |
| `reorder/page.tsx` | default | `/reorder` → `<ReorderReport />` |
| `qr/bom/[orderId]/page.tsx` | default | `/qr/bom/:id` → `<QrBomPage orderId />` |

## API routes (`src/app/api/`) — see `API.md`

| Route | Methods | Purpose |
|---|---|---|
| `zoho/status` | GET | Health: org name, base URL, token-cache state |
| `zoho/items` · `items/[id]` | GET/POST · GET/PUT | Search/create items; get/update one |
| `zoho/items/[id]/vendors` | GET | Vendor history for an item |
| `zoho/compositeitems` · `[id]` | GET/POST · GET/PUT | Composite (BOM) items |
| `zoho/salesorders` · `[id]` | GET · GET/PUT | Search SOs; get/update one (line replacement) |
| `zoho/contacts` · `[id]` | GET · GET | Vendors/customers; lead & transit times |
| `zoho/purchaseorders` | POST | Create draft PO |
| `zoho/po-vendor-map` | GET/POST | Batch "item → most recent vendor/rate" |
| `zoho/reorder-report` | GET | Low-stock scan + vendor/lead-time hydration |
| `ai/chat` | POST | OpenAI `gpt-4o-mini` copilot proxy |

## Components (`src/components/`) — see `UI_UX.md`

| Component | Responsibility |
|---|---|
| **`CarcassBomBuilder`** | The heart (~11,200 lines): configurator, BOM engine, all sections ①–⑫, exports, Zoho push. Props: `soMode?`, `planningMode?` |
| `BomDashboard` | `/` multi-SO report, stock statuses, QR modals, packing-list modal, accessories subform, draft-PO entry |
| `BomOrderCard` | Renders one SO's expanded BOM tree (levels, type chips, deficits) |
| `ReorderReport` | Low-stock table, vendor pickers, per-row + bulk draft POs |
| `DraftPoModal` | Wizard: search SO → out-of-stock lines → vendors → one draft PO per vendor |
| `QrBomPage` | Chrome-less single-SO BOM card (QR target) |
| `AuthGate` | Full-screen client password gate; `localStorage.app_authenticated` |
| `AiCopilot` | Floating chat; posts `window.__BOM_CONTEXT__` to `/api/ai/chat` |

## Library (`src/lib/`)

| Module | Key exports | Responsibility |
|---|---|---|
| `types.ts` | `SalesOrderDetail`, `ItemDetail`, `CompositeItemDetail`, `SalesOrderLineItem`, `BomReportRow`, `StockStatus`, `BomRowType`, `ApiErrorBody` | Shared Zoho + report types |
| `zoho.ts` | `getZohoAccessToken`, `zohoInventoryGet/Put/Post`, `getZohoRuntimeInfo`, `toApiError` | Token cache (memory + tmpdir), 5-min pre-expiry refresh, **5-min cooldown** on refusal, 401/57/14 single retry |
| `rawmaterial.ts` | `searchStoneItems`, `searchProfileItems`, `searchHardwareItems`, `resolveRawMaterials`, `applyStoneChange`, `applyProfileChange`, types `StoneGroup`/`ProfileGroup`/`RawMaterialSelection`/`FoundPanel` | Zoho item matching (finish+thickness, **core-name matching**, thickness-from-name) + BOM-chain resolution |
| `stock.ts` | `getCfValue`, `isComposite`, `isService`, `getRawStock`, `getStockStatus`, `statusLabel`, `groupLabel`, `detectGroup`, `resolveSku`, `buildReportRowsForOrder`, `collectRequiredItemIds`, `collectMappedItemIds`, `annotateRowsForOrder` | BOM tree expansion + stock status (**low < 1.5× required**) + global stock consumption |
| `report.ts` | `loadBomReportForOrders`, `loadBomReport`, `LoadedBomReport` | Load & expand multi-SO BOM reports (max depth 6) |
| `export.ts` | `exportBomWorkbook`, `exportBomCsv`, `AccessoryExportRow` | Dashboard Excel/CSV |
| `naming.ts` | `splitDrillAndFinish`, `normalizePartOrPanelName`, `getPartBaseName`, `getPanelBaseName` | Part/panel name normalisation (drill + finish parsing) |

## Data (`src/data/`) — see `DATABASE.md`

| File | Shape |
|---|---|
| `stone_finishes.json` | finishes grouped by thickness: `5,6,7,9,12,15,16,20` |
| `profile_finishes.json` | profile code → available finishes (MD1/MD2/MD3, CM1/CM2, CL1/CL2, NEON20, GRAND, SKT, STP, ELEN, HM510/511/513, DIFFUSER, DADO, DUPLEY, C TYPE, J TYPE, CJ) |
| `planning_finishes.json` | `carcassShortCodes` (GC/ON/OM), `profileFinishMap` (Light Bronze→CHAMPAGNE), `shutterTypeMap` (MD1+CM1→MD1CM1…), `priceGroups` (PG-1 = 25 colours, PG-2 = 18) |

---

## Engine functions inside `CarcassBomBuilder.tsx`

> Full detail (inputs/outputs/formulas/edge cases) in **`BUSINESS_LOGIC.md`**.

### Types & tables
`Panel`, `Profile`, `Hardware`, `Consumable`, `Shutter`, `CarcassModel`, `ProjectLine`, `FillerRow`, `VisiblePanelRow`, `BacksplashRow`, `CountertopRow`, `CtPanel`, `CtGeom`, `OtherAccRow`, `AccessorySubformRow` · `ZONES`, `BASE/BLIND/WALL/TALL/LOFT/MD_FAMILIES`, `SIZES`, `CT_TYPES`, `SH_DESIGNS`, `SH_INSET`, `SH_FRAME`, `XCJ_DESIGNS`, `STD_DESIGNS`, `GLASS_SHUTTER_FAMS`, `ELEVATION_OPTIONS`, `TIPON_OPTIONS`, `HARDWARE_PACK_DEFINITIONS`, `LIGHT_PROFILE_BOMS`, `VP_PRESETS`, `FILLER_PRESETS`, `CHIMNEY_PRESETS`, `OTHER_ACC_ITEMS`, `ACCESSORY_ITEMS`, `OPTI_GROUPS`, `FULL_BOM_COLS`/`OOS_COLS`/`OPTI_COLS`/`ACC_COLS`

### Constants
`SQDIV` 92903.04 · `STONE_WASTE` .15 · `PROFILE_WASTE` .20 · `ELENOR_WASTE` .10 · `KG_SQFT` 3.45 · `SH_KGSQFT` 1.38 · `CJ_CUT` 23 · `SHELF_OFF` 40 · `STEP` 2 · `STP_SIZE`/`STP_KG`

### Selection / validity
`famSetOf(zone)` · `defSizes(zone)` · `isGlassShutterFam(fk)` · `validDesigns(zk, fk, v, W, handle)` · `shutSpec(zk, fk, v, inbuiltDrawers)` · `ctEdgingOptions(type)` · `ctHasDrop(type)`

### Geometry / rules
`sqft(w,h)` · `shThkOf(design, isGlass)` · `shDeduct(isBase, design, loc)` · `hingeN(h)` · `stepSil(run)` · `ctGeom(type, L, D, T, dropHeight)` · `shutterCornerName(fk, kind)` · `calcBoxDimension(size, isCarcass)` · `shThkOf`

### Builders
`buildModel` → `buildCarcassInner` → `buildCarcassInnerRaw` · `addDrawerBoxes` · `buildShutters` · `addElenor` · `shutterVDrill` · `mergeCarcassPanels` · `explodePanelForTree` · `formatProfileNameForTree` · `buildProfileBomRows` · `addPanelRow` · `addHardwareRow` · `addLightCutRow` · `makeRow`

### Outputs
`buildFullBomData` · `buildOosData` · `buildOptiData` · `buildRawRows` · `buildCSV` · `exportBuilderExcel` · `buildBuilderPackingHtml` · `buildAccessoryExportRows`

### Zoho
`resolveSimpleItem` · `resolveCompositeItem` · `resolveHardwarePackComposite` · `resolveHardwarePack` · `handleAddToZohoSO` · `parseCabinetCodeToModel` · `getRawMaterialNameAndSku`

### Designer / planning
`handleDesignerUpload` · `setLineShutterColour` · `applyColourToLine` · `applyBulkColour` · `pgsForZone` · `coloursForPriceGroup` · `lineMatchesBulk`
