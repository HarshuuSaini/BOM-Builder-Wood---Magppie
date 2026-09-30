# Magppie Carcass BOM Builder — Step-by-Step Workflows

End-to-end operator + developer workflows. Every step names the exact UI control, the exact
function that runs, the exact item-name format produced, and the exact side-effects.

**Repo root:** `/Users/Apple/Documents/bom-nextjs-app/Inventory - Magppie`
**Heart file:** `src/components/CarcassBomBuilder.tsx` (~11,220 lines)

## Route → component map

| Route | File | Component call | Mode |
|---|---|---|---|
| `/` | `src/app/page.tsx:3` | `<BomDashboard />` | Dashboard |
| `/builder` | `src/app/builder/page.tsx:4` | `<CarcassBomBuilder />` | `soMode=false, planningMode=false` |
| `/designer` | `src/app/designer/page.tsx:6` | `<CarcassBomBuilder soMode />` | `soMode=true, planningMode=false` |
| `/planning` | `src/app/planning/page.tsx:6` | `<CarcassBomBuilder soMode planningMode />` | `soMode=true, planningMode=true` |
| `/reorder` | `src/app/reorder/page.tsx:4` | `<ReorderReport />` | — |
| `/qr/bom/[orderId]` | `src/app/qr/bom/[orderId]/page.tsx:3` | `<QrBomPage orderId={orderId} />` | — |

All routes are wrapped by `<AuthGate>` in `src/app/layout.tsx:15`, plus a floating `<AiCopilot />`.

> **Security issue (documented, not fixed):** the gate password is a hard-coded string literal
> compared inline in `src/components/AuthGate.tsx:30` (`if (password === "Factory@1234")`), and the
> pass is persisted as `localStorage.setItem("app_authenticated", "true")` (`AuthGate.tsx:31`).
> This is client-side only — it protects nothing. The `/api/zoho/**` routes have **no auth at all**.
> Any real fix must move the check server-side. All `ZOHO_*` / `OPENAI_API_KEY` values live in
> `.env.local` and must be treated as placeholders (see `src/lib/zoho.ts:5-10` for the required set:
> `ZOHO_ORGANIZATION_ID`, `ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`; optional
> `ZOHO_ACCOUNTS_BASE_URL` default `https://accounts.zoho.in`, `ZOHO_INVENTORY_BASE_URL` default
> `https://www.zohoapis.in/inventory/v1`).

## Global constants used across workflows

| Constant | Value | File:line |
|---|---|---|
| `CJ_CUT` | `23` (mm removed from top depth on XCJ handle) | `CarcassBomBuilder.tsx:432` |
| `STONE_WASTE` | `0.15` | `CarcassBomBuilder.tsx:435` |
| `PROFILE_WASTE` | `0.20` | `CarcassBomBuilder.tsx:436` |
| `ELENOR_WASTE` | `0.10` | `CarcassBomBuilder.tsx:437` |
| `ELEVATION_OPTIONS` | `["AA","BB","CC","DD","EE","FF","GG","HH","II","JJ","KK"]` | `CarcassBomBuilder.tsx:301` |
| `NO_DRILL_PROFILES` | `Set(["STP","ELEN","SLF","SINK"])` | `CarcassBomBuilder.tsx:5141` |
| Zoho account ids (hard-coded in item payloads) | `account_id 3418412000000000486`, `purchase_account_id 3418412000000000567`, `inventory_account_id 3418412000000000626` | `CarcassBomBuilder.tsx:5002-5010`, `:5079-5081` |
| sqft conversion | `(mm × mm) / 92903.04` | `CarcassBomBuilder.tsx:7221` |
| sqft conversion (dashboard/export path) | `(h × w) / (304.8 × 304.8)` | `BomDashboard.tsx:909`, `export.ts:67` |

---

## 1) Configure a cabinet → code → add to project

**Page:** `/builder`. Left column, card `① Configure Unit` (`CarcassBomBuilder.tsx:8564`).
This whole column is hidden when `soMode` is true (`CarcassBomBuilder.tsx:8562`).

### Steps

1. **Pick Zone.** `zoneOptions` (`:7119`) → `setZone`. Default state `"BC"` (`:5568`).
   The zone key is the first segment of the cabinet code and drives construction/mount:
   `ZONES[zone].construct` is `"fullsides"` (wall-hung) or `"fulltb"` (full top/bottom),
   surfaced in the meta strip at `:8928`.
2. **Pick Family.** `familyOptions` (`:7126`), fed by `famSetOf(zone)` (`:6896`).
   If the current `family` isn't valid for the zone, `activeFamilyKey` (`:6897`) falls back to the
   first key of the set.
3. **Pick Variant.** `variantOptions` (`:7133`) → `handleVariantChange` (`:6998`).
   `currentVariant` (`:6901`) resolves by id, else falls back to `variants[0]`.
   - `hasDrawers` = `shutSpec(zone, activeFamilyKey, currentVariant, inbuiltDrawers).kind === "drawer"` (`:6906`).
   - `hasInbuiltDrawerOption` is true only for `activeFamilyKey === "DW" || "HO"` **and** `variant.id === "3dr"` (`:6911`). Choosing `inbuiltDrawers = "2hb1bl"` produces a **different carcass code** (`…-2HB-1BL-…` instead of `…-2LB-1HB-…`).
4. **Pick Handed** (`LHS`/`RHS`, only for `variant.handed`) and **Handle**.
   `handleOptions` (`:7158`). Base zones offer `XCJ` + `STD`; everything else `STD` only
   (the enumeration mirror of this rule is `const isBase = !z.kind && !z.tall` at `:7925`).
   `handleLockedByDesign` (`:7075`) locks the handle when the chosen design is in
   `XCJ_DESIGNS` / `STD_DESIGNS` and the zone is a base zone.
5. **Pick Design** (shutter profile family: `MD1`, `MD2`, `MD3`, `CL1`, `CL2`, `NEON20`, …).
   `designOptions` (`:7167`). For glass-shutter families the picker defaults to `NEON20` and is
   **locked** until the user flips `designUnlocked` (`:5576`); leaving the glass family re-locks it.
6. **Pick W / H / D.** `wOptions` (`:7171`), `hOptions` (`:7183`), `dOptions` (`:7189`), driven by
   `standardSizes = SIZES[zone + "." + activeFamilyKey] || defSizes(zone)` (`:6916`).
   `handleWidthSelect` (`:6988`) / `handleCustomWidth` (`:6993`) allow a custom width.
   `doubleVariantId` (`:6971`) auto-converts a handed single-door variant to the family's
   Double variant above 600mm.
7. **Pick Thickness.** `thicknessOptions` = `["5","6","7","9","12","15","16","20"]` (`:7196`).
   Default `15` (`:5596`) and **locked** (`tLocked`, `:5597`); the lock button is at `:8853`.
8. **Pick finishes.**
   - `carcassMat` — options = `finishesMap[String(thickness)]` (`carcassOptions`, `:7667`).
   - `shutterMat` — options = `finishesMap["6"]` (`shutterOptions`, `:5671`) — shutter stone is
     always sourced from the 6mm finish list regardless of carcass thickness.
   - `glassColor` (`:5581`, default `"CLEAR"`) — shown only for glass-shutter families.
   - `carcassProfileColor` — union of `profileFinishesData` for codes `["STP","ELEN"]` (`:5677`).
   - `shutterProfileColor` — union of `profileFinishesData` for the design's parsed codes
     (regex `/(MD\d|CM\d|CL\d|NEON\d*)/g`, `:5689`).
   Four `useEffect`s at `:5710`, `:5716`, `:5722`, `:5728` auto-snap each selection to
   `options[0]` whenever the current value drops out of the option list.
9. **(Optional) Create a new finish.** Opens the modal at `:10581`; submit runs
   `handleSaveFinish` (`:5734`). It POSTs `/api/zoho/items` with
   `name = sku = \`STONE ${tVal}MM ${cleanFinishName}\`` (`:5752`), `unit: "pcs"`, and custom fields
   `cf_group="Stone"`, `cf_finish`, `cf_thickness`, `cf_height="2800"`, `cf_width="1200"`
   (`:5771-5792`). On success it merges the finish into `finishesMap` (`:5802`) and selects it
   (`:5815`). **Side-effect: creates a real Zoho item.**
10. **Read the code.** The `codebox` (`:8868`) renders `model.code`, colour-segmented, with the
    material suffix appended as `CARCASS` or `CARCASS/SHUTTER` (`:8872`, `:8888`).
    `copyCode` (`:7885`) copies `model.code` (plain, un-segmented) to the clipboard.
11. **Select an Elevation — MANDATORY.** The `<select>` at `:8903` starts empty with the option
    label `"Elevation *"`; its border is red (`#c0392b`) while unset (`:8907`).
12. **Set Qty** (`lineQty`, min 1, `:8914`).
13. **Click `+ Add to Project`** (`:8922`). The button is `disabled={!elevation}` with the title
    `"Select an Elevation first"`.

### What happens internally on add

`addLine` (`:7854`):
```js
if (!elevation) { alert("Please select an Elevation before adding the cabinet to the project."); return; }
const q = Math.max(1, lineQty);
setProject((curr) => [...curr, { qty: q, m: model, rate: soRate, elevation }]);
```
So there are **two** guards — the disabled button and the `alert()`. The alert text is exact.

**Output/side-effects:** one `ProjectLine` appended to the in-memory `project` array
(`{ qty, m: CarcassModel, rate, elevation }`). Nothing is persisted — the footer at `:10579`
says so explicitly: *"Project list is session-only."* A page reload loses the project.
The elevation later becomes the Zoho SO line description (`Elevation: ${currentElevation}`,
`:6759`) and the `Elevation` column on Full-BOM rows (`:3663`).

---

## 2) Build a full project → review Packets / Raw roll-up / Full Explosion

Three tabs (`:8932-8936`). On `/builder` the default tab is `"pk"`; on `/designer` + `/planning`
it is `"proj"` (`activeTab` init, `:5602`). The `pk` and `raw` tabs are `display:none` in `soMode`.

1. **Repeat workflow #1** for every cabinet. The `Project & Totals` tab shows a live badge:
   `project.reduce((a, l) => a + l.qty, 0)` (`:8935`).
2. **Tab `Packets` → card `② Carcass Packets`** (`:8941`). Renders `model.pkRows` for the
   *currently configured unit only*. `pkRows` tuples are `[type, name, dims, qty]` where `type` is
   one of `"panel" | "prof" | "shut" | "hard" | "cons" | "elen_bom"` (`:4262`, `:6734`).
   Packet names follow these exact prefixes, which the Zoho push keys off:
   - `Set of Parts- …`
   - `Drawer Pack- Cab Drawer Box …` / `Drawer Pack- Cab Pullout Shelf …`
   - `Elenor with Light …`
3. **Tab `Raw BoM (this unit)` → card `③ Raw Roll-up — this unit`** (`:8976`).
   Built by `buildRawRows(m)` (`:2256`). Stepper numbers computed at `:8440-8452`:
   - `purSqft = model.netSqft * (1 + STONE_WASTE)` → net sqft +15%
   - `wt = model.netSqft * KG_SQFT`
   - `netProf` = `Σ (p.len * p.qty) / 1000`; `purProf` = `Σ pLen * (1 + waste)` where
     `waste = ELENOR_WASTE` for `p.type === "ELEN"` else `PROFILE_WASTE` (`:8447`)
   - `glueLine` = first consumable with `uom === "ML"`; `silLine` = first with `uom === "Kg"` (`:8450`)
   - shutter stats per unit at `:8455-8459` (`unitShSqft += sqft(s.pw, s.ph)`)
4. **Card `④ Full Explosion`** (`:9034`). The full multi-level tree for the configured unit.
5. **Tab `Project & Totals`** (`soMode` label: `Sales Order → BoM`) shows, in order:
   - `① Zoho Sales Order` (`:9125`) — hidden on `/designer` (which uses the upload instead)
   - `① Upload Cabinet Codes (.xls)` (`:9238`) — **only** when `canDesignerUpload` (`:5914`)
   - `② Consolidated Totals — combined` (`:9297`)
   - `③ Stone — per finish` (`:9358`)
   - `④ Project Lines` (`:9388`) with a `clear all` button → `setProject([])`
   - `⑤ Fillers` (`:9540`) · `⑥ Visible Panels` (`:9658`) · `⑦ Countertop` (`:9776`) · `⑧ Backsplash` (`:9866`)
   - `⑨ Raw Material Selection` (`:9952`) · `⑩ Stock Check` (`:10298`) · `⑪ Accessories` (`:10424`)
   - `⑫ Downloads` (`:10537`) · `⑬ CSV Preview` (`:10571`)
6. **Expand a project line** — accordion, one at a time via `expandedLine` (`:5601`).
7. **Remove a line** — `removeLine(idx)` (`:7881`).

The consolidated aggregation memo (ends `:7832-7847`) returns
`{ netSqft, nPanels, cut, drill, glue, sil, shSqft, shProf, shCorner, profAgg, hardAgg, finAgg, extraCons }`
and depends on `[project, fillers, visiblePanels, shutterMat, design, shutterProfileColor]`.
Notable inline rules inside it:
- Fillers use profile design `"HM-504"` (`:7788`) and glue qty `(H / 1000) * 15 * q` of
  `"GLUE SILICONE XX TRANSPERENT DOWSIL 789 AGG"` (`:7791-7792`).
- Visible panels: `pw = W - 5`, `ph = H - 5` (`:7805`), default `W = depthForZone + 25` (`:7803`),
  profile length `((2*H + 2*W) / 1000) * q * multiplier` where `multiplier = 2` if the profile
  name contains `CM` (`:7810-7811`), and a `CM1` roll-up row is added when so (`:7822`).

---

## 3) Select raw materials (⑨) → resolve stone / profile Zoho items

**Card `⑨ Raw Material Selection`** (`:9950`), split into **Carcass** and **Shutter** subsections.
This step is a **hard prerequisite for workflow #4** — the Zoho push throws if any key is unset.

### 3.1 What gets aggregated

`activeItems` (`:7231`) picks the source with this priority:
1. Zoho SO line items (when `selectedSo && loadedSoDetail.line_items`) — each line decoded via
   `parseCabinetCodeToModel(line.sku || line.name || line.description, design)` (`:7236`)
2. else `project` lines (`:7243`)
3. else — **only on `/builder`** — the single configured `model`; `/designer` and `/planning`
   return `[]` (`return soMode ? [] : [{ qty: 1, m: model }]`, `:7248`)

`rawAggregation` (`:7252`, deps `[activeItems, design, fillers, visiblePanels, backsplashes, countertops, otherAccRows]`)
produces `{ stones, profiles, hardware }` keyed as follows:

| Group | Key format | Accumulator | Line |
|---|---|---|---|
| Carcass stone | `carcass\|{finish}\|{thickness}` | `netSqft += m.netSqft * qty` | `:7261`, `:7271` |
| Shutter stone | `shutter\|{finish}\|{thk}` | `netSqft += sqft(s.pw, s.ph) * qty` | `:7285`, `:7295` |
| Carcass profile | `carcass\|{p.type}\|{finish}` | `lenMeters += ((p.len * p.qty) / 1000) * qty` | `:7303`, `:7313` |
| Shutter profile | `shutter\|{s.design}\|{finish}` | per-shutter design | `:7322` |
| Other accessory stone | `shutter\|{row.color}\|6` | `netSqft += sqft(row.width, row.height) * q` | `:7511`, `:6770` |

Stone thickness rules (`:7284`): `sThk = shThkOf(s.design, false)` → **9 for the MD3 family, else 6**.
Glass rules (`:7275-7283`): in a glass-shutter family (`isGlassShutterFam(m.fk)`) a non-`fixed`
shutter is **glass, not stone** and is skipped; a `fixed` shutter uses `m.fixedPanelMat` as the
stone shade. Carcass profile finish defaults to `"CHAMPAGNE"` (`:7302`, `:7319`).

### 3.2 The fetch effect

`useEffect` at `:7534` (deps `[rawAggregation.stones, rawAggregation.profiles, rawAggregation.hardware]`).
For each key where `rawOptionsMap[key] === undefined && !rawLoadingMap[key]`:

- **Stones** → `searchStoneItems(finish, thickness.toString())` from `src/lib/rawmaterial.ts:604`
- **Profiles** → `searchProfileItems(finish, profileCode)` from `src/lib/rawmaterial.ts:768`
- **Hardware** → `searchHardwareItems(name)` from `src/lib/rawmaterial.ts:860`

On success: `setRawOptionsMap({...prev, [key]: items})`, clear `rawErrorMap[key]`, and **auto-select**
`items[0].item_id` **only if nothing is already selected** (`if (prev[key]) return prev;`, `:7546`).
Hardware additionally prefers an exact case-insensitive name match before `items[0]` (`:7599`).

On failure: `console.warn` (deliberately **not** `console.error` — see the comment at `:7553`, it
would pop the Next.js dev error overlay) and `setRawErrorMap({...prev, [key]: err?.message || "Zoho API unreachable"})`.

### 3.3 UI actions

1. **Read the header context line** (`:9958-9964`), which is one of:
   `Aggregated from SO: {number}` / `Aggregated from Project: {N} units` /
   `Select a Sales Order to load materials` (soMode, no SO) / `Aggregated from Configured Unit (Fallback)`.
2. **Per stone group** (`:10001`) the row shows
   `Stone — {finish} ({thickness}mm)` and `Net: {netSqft} sqft | Total (+15%): {reqSqft} sqft`
   where `reqSqft = netSqft * (1 + STONE_WASTE)` (`:9994`).
3. **Choose the item** in the `SearchableSelect` (`:10018`); option label is
   `` `${item.name} ${item.sku ? `(${item.sku})` : ""}` `` (`:10021`).
   `onChange` → `setSelectedRawIds(prev => ({...prev, [key]: val}))`.
4. **Slab maths.** `getSlabArea(item)` (`:7217`) = `(cf_height * cf_width) / 92903.04`, reading via
   `getCfValue` (`:7207`) which checks the flat property first, then `custom_fields[].api_name`.
   - `calcPcs = reqSqft / slabArea` → shown as `Calculated Slabs` rounded to 2dp (`:9995-9996`)
   - The user may override with `Actual Slabs` → `customPcsMap[key]` (`:10034`)
   - If `slabArea === 0` the row shows: *"Slab dimensions missing in Zoho custom fields (cf_height / cf_width)."* (`:10039`)
5. **Profiles** — same pattern (`:10059`), with
   `waste = profileCode.toUpperCase() === "ELEN" ? ELENOR_WASTE : PROFILE_WASTE` (`:10066`) and
   `reqProf = lenMeters * (1 + waste)` (`:10067`).
6. **Error handling.** A per-key inline error shows *"⚠ Zoho API error — check your network connection."*
   with a `Retry` button → `retryRawFetch(key)` (`:7522`, deletes the key from all three maps so the
   effect refires). A header-level `↻ Retry All` (`:9955`) → `retryAllRawFetch()` (`:7527`) blanks all three maps.
7. **Empty result** shows: *"No matching {thickness}mm stone items found in Zoho for finish "{finish}"."* (`:10015`).

### 3.4 The `MOCK_CREATE|` escape hatch

A profile selection may carry the sentinel value `MOCK_CREATE|<Item Name>`. The Zoho push detects
the prefix (`:6195`, `:6433`, `:6559`) and creates the raw item on the fly:
```js
const itemName = rawProfileId.split("|")[1];
rawProfileId = await resolveSimpleItem(itemName, false, { group: "Aluminium Profile & Parts", finish: pFinish }, "Mtr");
```

**Output/side-effects:** `selectedRawIds` (key → Zoho `item_id`), `rawOptionsMap`, `customPcsMap`.
No writes to Zoho at this stage except the optional Create-Finish modal (workflow #1 step 9).

---

## 4) Push project to a Zoho Sales Order — `handleAddToZohoSO`

**Entry:** button at `:9144`, label `"Add to Zoho Sales Order"` / `"Processing..."` while
`zohoLoading` (`:9152`). `disabled={!selectedSo || zohoLoading}` (`:9145`).
**Function:** `handleAddToZohoSO` (`:6001`–`:6893`).
Progress text lands in `zohoMessage`; the banner at `:9216` turns red when the string starts with
`"Error"` (`zohoMessage.startsWith("Error")`, `:9235`).

### 4.0 Prerequisite: select the Sales Order

Type ≥2 chars into the SO search (`soQuery`). A debounced effect (`:5848`, **500 ms**, `:5871`)
GETs `/api/zoho/salesorders?q=…`. Errors surface via `soSearchError` (`:5864`). Selecting an SO
fires the detail fetch effect (`:5875`) → `GET /api/zoho/salesorders/{id}` → `loadedSoDetail`.

### 4.1 Full ordered sequence

**Step 1 — resolve the five service/packing items** (`:6008-6013`), in this exact order:
```
resolveSimpleItem("Cutting-1", true)              → cuttingServiceId
resolveSimpleItem("Drilling-1", true)             → drillingServiceId
resolveSimpleItem("Packing Item - Carcass", true) → packingCarcassId
resolveSimpleItem("Packing Item - Shutter", true) → packingShutterId
resolveSimpleItem("Packing Item - Hardware", true)→ packingHardwareId
```
`isService = true` ⇒ payload gets `product_type: "service"` and **omits** inventory tracking (`:5007-5013`).

**Step 2 — determine `itemsToAdd`** (`:6016`):
```js
project.length > 0
  ? project.map(l => ({ model: l.m, qty: l.qty, rate: l.rate || soRate, elevation: l.elevation || "" }))
  : [{ model, qty: lineQty, rate: soRate, elevation }]
```

**Then, per cabinet** (`for (const item of itemsToAdd)`, `:6022`):

**2a. Resolve the carcass stone** (`:6031-6039`).
Key = `carcass|{carcassMatOfModel}|{currentModel.t}` where
`carcassMatOfModel = currentModel.mat || currentModel.carcassMat || carcassMat`.
**Failure point:** throws
`` `Carcass stone raw material not selected for finish "${carcassMatOfModel}" (${currentModel.t}mm) in cabinet "${currentModel.code}". Please choose a raw material selection first.` ``
`carcassSlabArea = getSlabArea(carcassStoneItem)`.

**2b. Resolve shutter stones** into `shutterStoneByKey` (`:6059-6074`).
One entry per distinct `(finish, thickness)` combo — a single cabinet can need several, because
MD3 = 9mm and the fixed blind panel is always 6mm MD1.
- `stoneFinishOf(s)` (`:6049`): glass-family **fixed** shutter → `fixedPanelMat || shutterMat`; else `shutterMat`.
- `isStoneShutter(s)` (`:6053`): `!isGlassFamModel || s.kind === "fixed"`.
**Failure point:** `` `Shutter stone raw material not selected for finish "${sFin}" (${sThk}mm) in cabinet "${currentModel.code}". …` ``

**2c. Group panels & profiles by packet** (`:6077-6094`).
`carcassProfilesByPack` **skips** profiles whose `pack` starts with `"Elenor with Light"` (`:6089`).

**2d. Derive metadata** (`:6097-6103`): `codeZone = code.split("-")[0]`,
`zoneName = ZONES[codeZone]?.name || codeZone`, `dims = {W,H,D,t}`, `soNumber`,
`hwCf = { group: "Hardware Pack", subGroup: zoneName }`.

**2e. Dedup probe → the `soPrefix` decision** (`:6106-6109`) — *the single most important rule:*
```js
const basePanelSearchName = `Panel ${(currentModel.panels[0]?.name || "Carcass").replace(/^Panels/i, "")} ${carcassMatOfModel}`;
const existingCarcassPanel = await findExistingCompositeByRawMaterial(carcassStoneId, basePanelSearchName);
const soPrefix = existingCarcassPanel ? "" : soNumber;
```
If a composite with that base name **already consumes this exact raw stone**, names stay **unprefixed**
(shared/reused across SOs). Otherwise every name for this cabinet is prefixed with the SO number
(`"SO-00029 Panel …"`), forking a private tree for this SO.

**2f. Build packets bottom-up** (`:6112-6481`).
`carcassPacks` (`:6118`) = union of panel packs + profile packs + hardware packs whose name starts
with `"Set of Parts-"` or `"Drawer Pack-"` (`:6116`), sorted so `Set of Parts-` precedes `Drawer Pack-` (`:6122-6126`).

*Branch A — Drawer packs* (`packName.startsWith("Drawer Pack- Cab Drawer Box" | "Drawer Pack- Cab Pullout Shelf")`, `:6133`):
`drawerCount = getDrawerCount(packName, currentModel.panels)` (`:6135`). All child quantities are
divided by `drawerCount` so the composite holds per-drawer parts; the packet is then pushed with
`quantity: drawerCount` (`:6274`).
- Panels (`:6140`): `panelBase = getPanelBaseName(p.name, null, carcassMatOfModel)`; composite children
  `[{carcassStoneId, roundedStoneQty}, {cuttingServiceId, 1}]` where
  `panelArea = sqft(p.w, p.h)`, `reqArea = panelArea * (1 + STONE_WASTE)`,
  `stoneQty = carcassSlabArea > 0 ? reqArea / carcassSlabArea : reqArea`,
  `roundedStoneQty = Math.round(stoneQty * 10000) / 10000` (`:6153-6156`).
  cf: `{group:"Panels- Cab", subGroup: zoneName, finish, thickness, height, width}`.
- Drilled panels get a **Part wrapper**: `partBase = getPartBaseName(p.name, p.drill, carcassMatOfModel)`,
  children `[{panelId,1},{drillingServiceId,1}]`, cf group `"Part Cab"` (`:6165-6175`).
  `hasDrill` = drill non-empty and not `"no drill"` (case-insensitive) (`:6163`).
- Profiles: **`DBC` (HM535) is special** (`:6201`) — a flat cut composite, no set wrapper:
  name `` `${p.name} ${p.len}mm ${pFinish}` ``, children
  `[{rawProfileId, roundedLen}, {cuttingServiceId, 1}]` with
  `reqLen = (p.len / 1000) * (1 + PROFILE_WASTE)` (`:6212`), cf `{group:"Profile", subGroup, finish, height:String(p.len)}`.
  All other types → `resolveProfileBOM(...)` (`:6223`).
- Hardware (`:6239`): grouped by name and summed; `HARDWARE PACK…` names → `resolveHardwarePackComposite`,
  else `resolveHardwarePack(hName, qty / drawerCount, packingHardwareId, hwCf)` (`:6257`).
- Packet composite (`:6262-6274`): name `` `${packName} ${carcassMatOfModel}` `` (SO-prefixed if `soPrefix`),
  children `[...partChildren, {packingCarcassId, 1}]`, cf group `"Carcass Pack"`.

*Branch B — everything else* (`:6276-6479`):
`isDrawerBoxSet` = pack starts with `"Set of Parts- Cab Drawer Box"` or `"Set of Parts- Cab Pullout Shelf"` (`:6277`);
`setDrawerCount` = `getDrawerCount(...)` when so, else `1`.
Drill handling splits **combined** panels (`:6320-6410`):
- `isCombinedSide` — name matches `/LH\/RH|LH\+RH/i` → two Parts (LH, RH), each `quantity: (p.qty / 2) / setDrawerCount`.
  If `p.drill` contains `/`, it is split on `/` into `lhDrill` / `rhDrill` (`:6327-6333`).
- `isCombinedDir` — name matches `/TP\/BT|Top\/Bottom|TP\+BT/i` → two Parts (Top/TP, Bottom/BT),
  each `quantity: (p.qty / 2) / setDrawerCount`. The tag chosen is `"Top"`/`"Bottom"` when the name
  contains those words, else `"TP"`/`"BT"` (`:6365-6366`).
- else a single Part at `p.qty / setDrawerCount`.
Packet composite (`:6460-6478`) only created `if (partChildren.length > 0)`; pushed with
`quantity: setDrawerCount` when `isDrawerBoxSet`, else `1`.

**2g. Shutters** (`:6484-6630`). A **separate dedup probe** runs against the first stone shutter:
```js
shutterPanelSearchName = `Panel Shutter ${firstStone.pw}x${firstStone.ph}x${firstStoneThk} ${stoneFinishOf(firstStone)}`
shutterSoPrefix = existingShutterPanel ? "" : soNumber
```
(`:6487-6497`) — so carcass and shutter trees can independently be shared or SO-forked.
Per shutter `s`:
1. **Face** — glass family & `s.kind !== "fixed"` →
   `` resolveSimpleItem(`GLASS TOUGH EP ${s.pw}X${s.ph}X5 ${glassColorOfModel} SKV`, false, {group:"Glass", finish: glassColorOfModel}, "Pcs") `` (`:6516-6518`).
   Else a stone panel composite named `` `Panel Shutter ${s.pw}x${s.ph}x${sThk} ${sFin}` ``, children
   `[{shutterStoneId, roundedShStoneQty}, {cuttingServiceId, 1}]`, cf group `"Panels- SH"` (`:6508-6546`).
2. **Set of shutter profiles** — `resolveProfileBOM(shDesign, sFinish, [{len: s.profV, qty: 2, name: \`Profile LH/RH (${shDesign})\`}, {len: s.profH, qty: 2, name: \`Profile TP/BT (${shDesign})\`}], …)` (`:6564-6580`),
   with `vDrill: shutterVDrill(currentModel.lh, currentModel.rh, currentModel.shutters, s)` (`:6578`) —
   mirrors carcass side-panel drilling onto the shutter verticals (single door = full LH/RH;
   double door = per-leaf split, inner edge = `JD`).
   **Failure point:** `` `Raw profile item not selected for shutter profile design: "${shDesign}" (${sFinish})` ``
3. **Corner-connector hardware** — `resolveHardwarePack(shutterCornerName(currentModel.fk, s.kind), 1, packingHardwareId, shutterHwCf)` (`:6589`).
4. **`packingShutterId`** pushed (`:6598`).
5. **Level 2 "Fully Ready Shutter"** — name `` `${s.code} Ready` `` (`:6601`), cf
   `{group:"Shutter Panel Pack", subGroup: zoneName, finish: shutterMatOfModel, thickness:"6", height:String(s.h), width:String(s.w)}`.
   *(Note: `thickness` is hard-coded `"6"` here even for MD3/9mm — a known inconsistency with the
   stone thickness used in the panel composite.)*
6. **Fitting hardware** — `s.hinge` starting with `HARDWARE PACK` → `resolveHardwarePackComposite`,
   else `resolveHardwarePack(s.hinge, s.hq || 1, …)` (`:6612-6614`).
7. **Level 2 "Shutter BOM"** — name `s.code`, children `[{fullyReadyShutterId,1},{fittingHardwareId,1}]`,
   cf group `"Shutters"` (`:6617-6627`). Pushed to `shutterCompositeIds`.

**2h. Cabinet-level hardware / consumables / glass shelf** (`:6633-6672`).
Skips anything whose `pack` starts with `"Elenor with Light"`, `"Drawer Pack-"`, or `"Set of Parts-"`
(`:6640-6642`, `:6657-6659`). Note the asymmetry at `:6646-6651`:
`HARDWARE PACK…` composites go in at `quantity: h.qty`; plain hardware wrapped by
`resolveHardwarePack(h.name, h.qty, …)` goes in at `quantity: 1` (the qty lives inside the pack).
Glass shelf → `resolveSimpleItem(gs.name, false, {group:"Glass", finish:"CLEAR"}, "Pcs")` (`:6670`).

**2i. Elenor composites** (`:6675-6744`). One per distinct `"Elenor with Light…"` pack.
`makeCutComposite(rawName, cutLabel, lenMm, rawGroup)` (`:6694`) builds
`` `${cutLabel} Cut ${Math.round(lenMm)}mm` `` = `[{rawId, lenM}, {cuttingServiceId, 1}]`, cf
`{group:"Profile", subGroup: zoneName}` — so the raw 3-mtr stock stays out of the Opti sheet.
- Profiles → `makeCutComposite(ep.name, "Elenor Profile", ep.len, "Aluminium Profile & Parts")` at `qty: ep.qty`.
- Consumables matching `/\bLED\b|DIFFUSER/i` → `makeCutComposite(ec.name, "Diffuser"|"LED Light", elenCutLen, "Light")` at **`quantity: 2`** (two cuts of the Elenor length, *not* one double-length cut — see comment `:6711`). Tape/wire stay raw simple items.
- Hardware → `resolveSimpleItem(eh.name, false, {group:"Hardware Part", subGroup: zoneName}, eh.uom)`.
- Composite named exactly `elenPackName`, cf group `"Elenor Light"`; quantity taken from the
  matching `pkRows` tuple `[t,n] where t === "elen_bom" && n === elenPackName` → `elenorPkRow[3]`, default `1` (`:6734-6735`).

**2j. Level 1 Cabinet** (`:6746-6761`). Name = `soPrefix ? \`${soPrefix} ${code}\` : code`,
children `[...packetCompositeIds, ...shutterCompositeIds, …hardware, …cons, …elenor]`, cf
`{group:"Carcass", subGroup: zoneName, finish: carcassMatOfModel, thickness, height, width, depth}`.
Pushed to `newCabinetLines` as `{ item_id, quantity, rate, description: elevation ? \`Elevation: ${elevation}\` : undefined, code }`.

**Step 2b — Other Accessories** (`:6765-6798`), each becoming its **own SO line**.
Stone key `shutter|{row.color}|6`. **Failure point:**
`` `Stone raw material not selected for Other Accessory "${accLabel}" finish "${row.color}" (6mm). …` ``
Name format (`:6785`): `` `${accLabel} ${row.width}x${row.height}x6 ${row.color} (${row.profile} ${row.profileColor})` ``
(`accLabel` ∈ `"Chimney Panel"`, `"Dishwasher Panel"` — `OTHER_ACC_ITEMS`, `:306`).
cf group `"Other Accessory"`. Line pushed with `quantity: Math.max(1, row.qty)`, `rate: 0`,
`description: \`Profile: ${row.profile} ${row.profileColor}\``, and **no `code`** — so it can never
replace a service line and always appends.

**Step 3 — fetch, rebuild, PUT the SO** (`:6800-6886`).
1. `GET /api/zoho/salesorders/{id}` (`:6802`). Throws `` `Failed to fetch Sales Order detail: ${soRes.statusText}` `` or `"Sales order detail not found in response."`.
2. `taxFields(src)` (`:6814`) carries `tax_id`, `tax_name`, `tax_percentage`, `tax_type`,
   `gst_treatment_code` from the source line, **falling back to `line_items[0]`**, with final
   defaults `""`, `""`, `0`, `"tax"`, `"out_of_scope"`.
3. `newByCode` — index `newCabinetLines` by canonical cabinet `code` (`:6823`).
4. **Replacement loop** (`:6837-6857`) — the append rule:
   - `isService` = `String(orig.product_type || "").toLowerCase() === "service"`.
   - Service line → decode via `parseCabinetCodeToModel(orig.sku || orig.name || orig.description, design)`.
     If the decoded `code` matches an **unused** new composite, that line becomes
     `{ item_id: replacement.item_id, quantity: orig.quantity, rate: orig.rate, …description, …taxFields(orig) }`
     — **the service line's own qty and rate win**, not the builder's. `replacedCount++`.
   - Non-service (already a BOM) or unmatched → kept via `buildSoLineItem(orig)` (`:4628`).
   - `usedNew` (a `Set`) guarantees each new composite replaces **at most one** service line.
5. **Append rule** (`:6861-6870`): anything left in `newCabinetLines` and not in `usedNew` is
   appended with its **own** quantity/rate and `taxFields(firstLine)`. This covers manually-added
   `/builder` cabinets and all Other Accessories.
6. `PUT /api/zoho/salesorders/{id}` with body `{ line_items: rebuilt }` (`:6873-6879`).
   Throws `` `Failed to update Sales Order: ${errData.error || updateRes.statusText}` ``.
7. Final message (`:6886`):
   `` `Sales Order ${currentSo.salesorder_number} updated — ${replacedCount} service item(s) replaced with BOMs, ${appended.length} added.` ``

Any throw is caught at `:6887` → `console.error("Zoho integration flow error:", err)` and
`` setZohoMessage(`Error: ${err.message || "An unexpected error occurred."}`) ``; `finally` clears `zohoLoading` (`:6891`).

### 4.2 Resolver primitives

| Function | File:line | Behaviour |
|---|---|---|
| `searchItemByName(name)` | `:4943` | Normalizes, GETs `/api/zoho/items?search=…`, matches on normalized `name` **or** `sku`; falls back to `?name=…`. Returns `null` if no exact normalized match. |
| `normalizeItemName` | `:4940` | lower-cased normalization used for comparison only. |
| `resolveSimpleItem(name, isService, cf, uom)` | `:4970` | Find-or-create. Sets `name = sku = normalizePartOrPanelName(name)`. Custom fields mapped to `cf_group / cf_sub_group / cf_finish / cf_thickness / cf_height / cf_width / cf_depth`. **Unit inference exists (`:4986-4993`) but is dead — `payload.unit` is commented out (`:5013`) to dodge Zoho UOM-creation restrictions.** Throws `` `Failed to create item "${name}": …` ``. |
| `truncZoho(s, max=100)` | `:5029` | Hard-truncates names/SKUs to 100 chars for Zoho. |
| `resolveCompositeItem(rawName, rawSku, mappedItems, cf)` | `:5033` | Find-or-create composite. **Quirk (`:5048-5061`): a composite with exactly one mapped item of quantity ≤ 1 gets `Drilling-1` auto-appended**, because Zoho rejects single-child composites. Always `unit: "pcs"`. Returns `composite_item_id || item_id`. |
| `findExistingCompositeByRawMaterial(rawMaterialId, itemName)` | `:5104` | Searches by name, then for each combo hit GETs `/api/zoho/compositeitems/{id}` and returns the first whose mapped items include `rawMaterialId`. This is what drives the `soPrefix` decision. |
| `resolveProfileBOM(...)` | `:5143` | See below. |
| `resolveHardwarePackComposite(packName, cf)` | `:5518` | Looks `packName` up in `HARDWARE_PACK_DEFINITIONS` (`:5334`, ~30 packs). Found → composite of `resolveSimpleItem`'d components (cf group `"Hardware Part"`). **Not found → falls back to a plain simple item with unit `"Set"` (`:5544`)**. |
| `resolveHardwarePack(hardwareName, qty, packingHardwareId, cf)` | `:5548` | Wraps one physical hardware item: composite named `` `Pack Hardware ${hardwareName} x${qty}` ``, children `[{physical, qty}, {packingHardwareId, 1}]`, cf group `"Hardware Pack"`. |

### 4.3 `resolveProfileBOM` in detail (`:5143`)

- **`ELEN` returns `[]` immediately** (`:5152`) — Elenor is handled by the separate composite.
- `noDrill = NO_DRILL_PROFILES.has(code.toUpperCase())` → `STP`, `ELEN`, `SLF`, `SINK`.
- Orientation regexes (`:5171-5172`):
  vertical `/(^|\s|\()(V|vertical|LH[+/]RH|LH|RH|ELEN)(\s|\)|$)/i`,
  horizontal `/(^|\s|\()(H|horizontal|TP[+/]BT|TP|BT|edge)(\s|\)|$)/i`.
- **Level 4 Profile Panel**: `` `${cleanedNameForPanel} ${len}mm ${finish}` ``, children
  `[{rawProfileId, roundedLen}, {cuttingServiceId, 1}]`,
  `reqLen = (len / 1000) * (1 + wasteFactor)` (`:5198`), cf group `"Profile"`.
  Dedup-probed with `findExistingCompositeByRawMaterial` first (`:5191`).
- **noDrill** → panels go straight into sub-sets, then a parent wrapper (`:5283-5311`):
  - `Set of Profile {code} {finish} {vSideLabel}` / `… (TP/BT)` / `… {finish}`
  - parent: `Set of Profile {code} {finish} LH/RH+TP/BT` (or `{vSideLabel}+TP/BT` when `vDrill` given)
- **drill profiles** → Part wrappers `[{pPanelId,1},{drillingServiceId,1}]`, cf group `"Profile - Part"`:
  - `qty === 2 && isVertical` → `Part Profile LH{lhTag} {cleaned} {len}mm {finish}` + `Part Profile RH{rhTag} …`
  - `qty === 2 && isHorizontal` → `Part Profile Top …` + `Part Profile Bottom …`
  - else → `Part Profile {cleaned} {len}mm {finish}` at `quantity: qty`
  - sets (**no parent wrapper**, `:5312-5328`): `Set of Profile Parts {code} {finish} {vSideLabel}` / `… (TP/BT)` / `… {finish}`
- `vSideLabel` (`:5159`) = `` `LH(${vDrill.lh})+RH(${vDrill.rh})` `` when `vDrill` is supplied, else `"(LH/RH)"`.
- **SO-prefix subtlety (`:5229`, `:5247`, `:5265`):** Part names use
  `ctx.soPrefix && !existingPanel` — if the *panel* was found pre-existing, the Parts are **not**
  prefixed even when `soPrefix` is set. Sets use plain `ctx.soPrefix` (`:5289` etc.). This asymmetry
  is intentional but easy to break.

### 4.4 Item-name format reference (all normalized through `normalizePartOrPanelName`)

| Kind | Format | Source |
|---|---|---|
| Carcass panel | `Panel - {name} {WxHxT} {finish}` | `getPanelBaseName` (`naming.ts:154`) |
| Carcass part | `Part - {name} {side} {drill} {WxHxT} {finish}` | `getPartBaseName` (`naming.ts:148`) |
| Shutter panel | `Panel Shutter {pw}x{ph}x{thk} {finish}` | `:6508` |
| Shutter glass | `GLASS TOUGH EP {pw}X{ph}X5 {glassColor} SKV` | `:6516` |
| Fully ready shutter | `{s.code} Ready` | `:6601` |
| Shutter BOM | `{s.code}` | `:6617` |
| Profile panel | `{cleanedNameForPanel} {len}mm {finish}` | `:5190` |
| Profile part | `Part Profile [LH(..)\|RH(..)\|Top\|Bottom] {cleaned} {len}mm {finish}` | `:5227`, `:5245`, `:5264` |
| Profile set | `Set of Profile[ Parts] {code} {finish} [(LH/RH)\|(TP/BT)\|LH/RH+TP/BT]` | `:5288`-`:5327` |
| DBC flat cut | `{p.name} {len}mm {finish}` | `:6204` |
| Elenor cut | `{Elenor Profile\|LED Light\|Diffuser} Cut {len}mm` | `:6697` |
| Hardware pack (wrapper) | `Pack Hardware {hardwareName} x{qty}` | `:5557` |
| Carcass packet | `{packName} {carcassMat}` | `:6262`, `:6461` |
| Cabinet | `{model.code}` | `:6747` |
| Other accessory | `{label} {W}x{H}x6 {color} ({profile} {profileColor})` | `:6785` |
| New stone finish | `STONE {t}MM {FINISH}` | `:5752` |
| SO-prefixed variant | `{salesorder_number} {baseName}` | throughout |

`normalizePartOrPanelName` (`naming.ts:36`) additionally: collapses whitespace, rewrites `LH+RH`→`LH/RH`,
strips a trailing `-SO-\d+(-\d+)?` suffix and re-appends it at the end, strips a trailing
`-Project`/` Project`, normalizes `Part`/`Parts` → `Part - ` (or `Part Profile` when the name
contains `Profile`) and likewise for `Panel`. `splitDrillAndFinish` (`naming.ts:1`) treats
`LH RH LHS RHS / \d+S \d+H \d+HB JD JD1 JD2` as drill words; the first non-drill word starts the finish.

### 4.5 Complete failure-point list

| # | Condition | Message / behaviour | Line |
|---|---|---|---|
| 1 | `!selectedSo` | silent `return` (button also disabled) | `:6002` |
| 2 | Carcass stone key unselected | `Carcass stone raw material not selected for finish "…" (…mm) in cabinet "…". Please choose a raw material selection first.` | `:6035` |
| 3 | Shutter stone key unselected | `Shutter stone raw material not selected for finish "…" (…mm) in cabinet "…". …` | `:6069` |
| 4 | Carcass profile key unselected | `Raw profile item not selected for carcass profile: "{pType}" ({pFinish})` | `:6193`, `:6431` |
| 5 | Shutter profile key unselected | `Raw profile item not selected for shutter profile design: "{shDesign}" ({sFinish})` | `:6557` |
| 6 | Other-accessory stone unselected | `Stone raw material not selected for Other Accessory "…" finish "…" (6mm). …` | `:6773` |
| 7 | Item creation failed | `Failed to create item "{name}": {error}` | `:5023` |
| 8 | Composite creation failed | `Failed to create composite item "{name}": {error}` | `:5097` |
| 9 | SO fetch failed | `Failed to fetch Sales Order detail: {statusText}` | `:6804` |
| 10 | SO detail missing | `Sales order detail not found in response.` | `:6810` |
| 11 | SO update failed | `Failed to update Sales Order: {error}` | `:6883` |

**Non-idempotency warning:** the flow creates Zoho items **as it goes**. A failure at step 11 leaves
every composite created in steps 1–2j orphaned in Zoho. A re-run is *mostly* safe because every
resolver is find-or-create — but the `soPrefix` probe may now find the partially-created tree and
flip `soPrefix` from `soNumber` to `""` on the retry, silently changing the naming scheme.

---

## 5) Export flows

### 5.1 Full BOM Excel — `⑫ Downloads` → `Excel BOM`

Button `:10559` → `handleExcelDownload` (`:8190`) → `buildAccessoryExportRows()` (`:8291`) →
`exportBuilderExcel(...)` (`:4065`), passing `project`, the accessory rows, `selectedSo?.salesorder_number`,
`stockMap`, `selectedRawIds`, `rawOptionsMap`, `fillers`, `visiblePanels`, `backsplashes`,
`countertops`, and five zone-default getters.

Sheets, in order:
1. **`Full BOM`** — `buildFullBomData(...)` (`:3030`). Row `_type` ∈ `master | plain | sub_bom | component`
   drives `applyRowColors` (`:4052`, 26 columns). A `S. No.` column is prepended and **increments only
   on `Level === 0` rows**, carried down onto sub-rows (`:4105-4109`). `!cols = FULL_BOM_COLS`.
2. **`Out of Stock`** — `buildOosData(fullBom)` (`:3980`). Filters `_type !== "master" && Deficit > 0`,
   merges by `SKU || Item.trim()`, sums `SO Qty` and `Actual Qty`, recomputes
   `Deficit = Math.max(0, Actual Qty - In Stock)` (`:4019`), and joins contributing SOs with `", "` (`:4025`).
3. **`Opti`** — `buildOptiData(oosRows)` (`:4029`). Keeps only rows whose lower-cased `Sub Group`
   **exactly equals** one of `["profile", "panels- sh", "panels- cab"]` (`OPTI_GROUPS`, `:4030`).
   Columns: `SO, Main Group, Group, Item Name (= SKU || Item), Profile Code (|| extractProfileCode(Item)),
   Type, Length (= Height), Width, Min Q. (= Deficit || 0), Thickness, Grain, Finish`.
4. **`Accessories`** — the `buildAccessoryExportRows()` output.
5. **`Hardware items`** — rebuilt from `fullBom` rows whose `Sub Group` ∈ `{"Raw Material","Consumable","Hardware"}`
   (`:4140`). Qty prefers `Pcs` when it is not `""`/`"-"`/null and parses to a number, else `Actual Qty`
   (`:4151-4163`); merged by trimmed item name, rounded to 3dp; unit defaults to `"pcs"`.

**Filename:** `` `Builder_BOM_${so}_${new Date().toISOString().slice(0,10)}.xlsx` `` (`:4192`), where
`so = soNumber || "Project"` (`:4083`). Written with `XLSX.writeFile` (client-side download).

### 5.2 OOS & Opti
Not separate buttons — they are sheets 2 and 3 of the Full BOM workbook (see above). A sheet is
**omitted entirely** if it has zero rows (`if (oosRows.length)` `:4118`, `if (optiRows.length)` `:4126`).

### 5.3 Export All Combinations
`exportAllCombinations` (`:7914`). Enumerates zone × family × variant × handed × handle × W × H at a
**fixed `t = 15`**, `placeholderDesign = "MD1"`, `Finish = "ANY"`.
Skip rules:
- `if (z.blind && (v.both || /double/i.test(v.label)))` → blind units never offer double doors (`:7934`)
- `if (isHandedSingle && hasDoubleVariant && isHingedDoublable && W > 600) return;` (`:7948`)
- `if (isDoubleVariant && isHingedDoublable && W <= 600) return;` (`:7949`)
- `if ((fk === "DW" || fk === "HO") && v.id === "3dr" && W === 450) return;` (`:7951`)
- `BC` + `DW` + `3dr` fans out `inbuiltOpts = ["none", "2hb1bl"]` (`:7945`)
- any `buildModel` throw → the combination is silently skipped (`try/catch`, `:7957-7961`)
Adds one `Design {code}` Yes/No column per shutter design from `validDesigns(zk, fk, v, W, handle)`
(`:7965`), ordered by `SH_DESIGNS` with unknown codes appended sorted (`:8038-8041`).
Header row styled bold white on `#44403A` (`:8064-8068`).
**Filename:** `` `carcass-all-combinations-${rows.length}.xlsx` ``, sheet `"All Combinations"` (`:8073-8074`).

### 5.4 Export All Shutter Codes
`exportAllShutterCodes` (`:8081`). Same enumeration, but additionally fans out over every
`validDesigns(...)` and **de-duplicates by `s.code`** via a `seen` Set (`:8084`, `:8123`).
`if (designs.length === 0) return;` skips families with no shutters (`:8110`).
`Face Thk` = `5` for glass faces, else `shThkOf(s.design, false)`; `Face` ∈
`"Glass" | "Fixed Stone Panel" | "Stone"` (`:8145-8146`).
**Filename:** `` `shutter-all-codes-${rows.length}.xlsx` ``, sheet `"All Shutter Codes"` (`:8186-8187`).

### 5.5 Packing lists (carcass / shutter)
1. Set the dropdown `Packing List/Labels Filter` (`:10540`) → `packingFilter` ∈ `"both" | "carcass" | "shutter"`.
2. Click `Packing List (.xls)` (`:10560`) → `handlePackingDownload` (`:8421`) →
   `buildBuilderPackingHtml(project, soNum, custName, soDate, packingFilter)` (`:4243`).
   - `soNum = selectedSo?.salesorder_number || "DRAFT"`, `custName = … || "—"`,
     `soDate = selectedSo?.date || new Date().toISOString().slice(0,10)` (`:8422-8424`)
   - Carcass section takes `pkRows` where `r[0] !== "shut" && r[0] !== "hard" && r[0] !== "cons"` (`:4262`)
   - Cabinet group letter = `String.fromCharCode(65 + li)` → `A.`, `B.`, … (`:4265`)
   - `isSet = name.toLowerCase().includes("set of parts")` → `pcsPerBox = 2` else `1` (`:4273-4275`)
   - `totalBoxes = qty * lineQty`; `packNum` increments **per box** (`:4276-4278`)
   - `calcBoxDimension(dims, isSet)` (`:4218`): parses `WxHxT`, `padding = 20`,
     `thickness = isSet ? t*2 + padding : t + padding` → `` `${w+20}x${h+20}x${thickness}` ``
   - `extractDimension(itemName)` (`:4208`) tries `WxH-WxHxT` → `"WxH - WxHxT"`, then `WxHxT`, then `WxH`
   - `isShutterHardware(name)` (`:4234`) = name contains `HINGE` or `CORNER CONNECTOR`.
     **`isShutterConsumable` always returns `false` (`:4239`) — a stub.**
   - Output is an Excel-flavoured HTML string.
3. `downloadBlob(filename, new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }))` (`:8428`).
   **Filename:** `` `${sanitizeFilename(soNum)}-packing-list${suffix}.xls` `` where
   `suffix = packingFilter === "both" ? "" : \`-${packingFilter}\`` (`:8426-8427`).
   `sanitizeFilename` (`:4204`) = `replace(/[^a-z0-9-]+/gi,"-").replace(/-+/g,"-").replace(/^-|-$/g,"")`.

### 5.6 Labels (PDF)
Button `Labels (PDF)` (`:10561`) → `handleLabelsDownload` (`:8431`) →
`buildBuilderLabelsPdf(project, soNum, custName, packingFilter)` (`:4480`).
- One label per box: `totalBoxes = unitQty * q` (`:4514`)
- Barcode via `generateBarcodeDataUrl(text)` (`:4457`, JsBarcode → canvas data URL)
- `new jsPDF({ orientation: "landscape", unit: "mm", format: [W, H] })` (`:4535`)
- **Filename:** `` `${sanitizeFilename(soNum)}-labels${suffix}.pdf` `` (`:8436`)

### 5.7 CSV
- `csvText` memo (`:7850`) = `buildCSV(project)` (`:2282`), which walks `buildRawRows(l.m)` per line (`:2287`).
- `CSV` button (`:10562`) → `downloadCsvFile` (`:7900`) → Blob `text/csv`, **filename hard-coded
  `"carcass_bom.csv"`** (`:7904`).
- `copy csv` button (`:10563`) → `copyCsvData` (`:7893`) → `navigator.clipboard.writeText(csvText)`,
  flips the label to `copied` for 1200 ms.
- `⑬ CSV Preview` (`:10571`) renders the same text in a read-only monospace textarea.

All `⑫`/`⑬` cards render **only when `project.length > 0`** (`:10535`, `:10569`).

---

## 6) Designer workflow (`/designer`)

`<CarcassBomBuilder soMode />`. `canDesignerUpload = soMode && !planningMode` (`:5914`) — the upload
card exists **only here**. Header title: `"Sales Order → BoM (Designer)"` (`:8532`).

### Path A — search SO → decode codes
1. Type ≥2 chars in `① Zoho Sales Order`. Debounced 500 ms → `GET /api/zoho/salesorders?q=…` (`:5856`).
2. Select an SO → `GET /api/zoho/salesorders/{id}` → `loadedSoDetail` (`:5881`).
3. The soMode effect (`:5900`) rebuilds the project from the SO:
   ```js
   const m = parseCabinetCodeToModel(line.sku || line.name || line.description, design);
   if (m) lines.push({ qty: line.quantity || 1, m, rate: line.rate || 0, elevation: "" });
   setProject(lines);
   ```
   Service lines carry the cabinet code in `description` (sku/name are empty) — hence the 3-way fallback.
   Undecodable lines are silently dropped. **Selecting an SO replaces the project; clearing the SO
   does NOT wipe it** (so an Excel upload can stand — comment `:5896-5899`).

### Path B — Excel upload (`① Upload Cabinet Codes (.xls)`, `:9238`)
1. Pick a file → `handleDesignerUpload(file)` (`:5966`). The input resets `e.target.value = ""` so the
   same file can be re-picked (`:9245`).
2. `setUploadMsg("Reading file…")`; `XLSX.read(buf, {type:"array"})`.
3. **Sheet selection:** `wb.Sheets["Shutter"] || wb.Sheets[wb.SheetNames[0]]` (`:5971`) — the sheet
   must be named **`Shutter`**, else the first sheet is used blind.
4. **Columns read** (exact header strings, `defval: ""`):

   | Column | Maps to | Mapping source | Default |
   |---|---|---|---|
   | `Cabinet Code` | the code to decode | — | skip row if empty |
   | `Shutter Type` | `design2` | `planning_finishes.json → shutterTypeMap`, else `rawType.replace(/\s*\+\s*/g,"")` | `"MD1"` |
   | `Cabinet Finish` | `cabFin` | `→ carcassShortCodes` | `"STATUARIO"` |
   | `Profile Finish` | `profCol` | `→ profileFinishMap` | `"CHAMPAGNE"` |
   | `Shutter Finish` | `pg` — **this column is the PRICE GROUP, not a colour** (`:5985`) | — | `""` |
   | `Shutter Qty` | `qty` | `Math.max(1, parseInt(...) \|\| 1)` | `1` |

5. `parseCabinetCodeToModel(code, design2, { carcassMat: cabFin, shutterMat: "", profileColor: profCol })`
   — note `shutterMat: ""`: **the shutter colour is deliberately left blank**, to be chosen in step 7.
   Undecodable rows increment `skipped` (`:5988`).
6. Outcome (`:5991-5994`):
   - zero valid rows → `"No valid cabinet codes found in the sheet."` and **no state change**
   - else `setSelectedSo(null)` then `setProject(lines)`, message
     `` `Loaded ${lines.length} cabinet(s)${skipped ? `, ${skipped} skipped` : ""}. Choose shutter colours below.` ``
   Each line keeps `priceGroup`, and the round-trip fields `upCode`, `upDesign`, `upCarcass`, `upProfile`.
   Parse errors → `console.warn` + `` `Could not read the file: ${err?.message || "invalid format"}` `` (`:5997`).
7. **Per-line colour.** `applyColourToLine(idx, colour)` (`:5959`) → `setLineShutterColour(line, colour)` (`:5950`),
   which **rebuilds the model** from `line.upCode` + `upDesign` + `upCarcass` + the new colour + `upProfile`.
   **`if (!line.upCode) return line;`** — lines that came from an SO (not an upload) cannot be recoloured.
8. **Bulk colour by price group.** Three controls:
   - `bulkZone` ∈ `all | base | wall | tall | loft | md` (`:5924`) — matched by `zoneKindOfLine(l)` (`:5928`),
     which reads `ZONES[l.m.code.split("-")[0]]` and returns `wall` / `loft` / `tall` (when `z.tall`) /
     `md` / `base` (default, incl. unknown zones).
   - `bulkPG` — options from `pgsForZone(zone)` (`:5938`), i.e. only the price groups actually present
     among the lines of the chosen zone (dependent dropdown).
   - `bulkColour` — options from `coloursForPriceGroup(pg)` (`:5920`) =
     `planning_finishes.json → priceGroups[pg]`, falling back to `allPgColours`
     (the deduped sorted union of every price group, `:5916`).
   Click `Apply to filtered` (`:9287`; `disabled={!bulkColour}`) → `applyBulkColour` (`:5961`) →
   applies to every line where `lineMatchesBulk(l)` (`:5943`).
9. Proceed to `⑨` (workflow #3) then `Add to Zoho Sales Order` (workflow #4) — which on this page
   requires re-selecting an SO, since the upload cleared `selectedSo`.

---

## 7) Planning workflow (`/planning`)

`<CarcassBomBuilder soMode planningMode />`. Header title `"Planning → BoM"` (`:8532`).
Identical to Designer **minus the Excel upload** (`canDesignerUpload` is false, `:5914`).

1. **Search SO** — `① Zoho Sales Order` card, ≥2 chars, 500 ms debounce (`:5848`).
2. **Select SO** → detail fetch (`:5875`) → the soMode effect (`:5900`) decodes every line via
   `parseCabinetCodeToModel(line.sku || line.name || line.description, design)` and replaces `project`.
3. **Review** `④ Project Lines`, `② Consolidated Totals — combined`, `③ Stone — per finish`.
4. **Add Fillers / Visible Panels / Countertop / Backsplash** (`⑤`–`⑧`) as needed — these feed
   `rawAggregation` (`:7519`) and the Full BOM export, and are project-local (not on the SO).
5. **Rebuild BOMs** — resolve every key under `⑨ Raw Material Selection` (workflow #3).
6. **Replace service lines** — click `Add to Zoho Sales Order` (`:9144`). This is the *same*
   `handleAddToZohoSO` as workflow #4; from Planning's point of view its job is precisely the
   replacement loop at `:6837`: every SO line with `product_type === "service"` whose decoded cabinet
   code matches a freshly-built composite is swapped for that composite, **keeping the service line's
   original quantity, rate and tax fields** (`:6848-6851`). Non-service lines pass through unchanged
   via `buildSoLineItem(orig)` (`:6856`). Watch the counter in the final message:
   `"… — N service item(s) replaced with BOMs, M added."`

---

## 8) Dashboard workflow (`/`)

`<BomDashboard />` (`src/components/BomDashboard.tsx:612`).

1. **Connection check** — `checkConnection()` (`:650`) hits `/api/zoho/status`.
2. **Search** — `searchOrders()` (`:815`) →
   `GET /api/zoho/salesorders?q={query}&status={status}`. It first **clears** `rows`,
   `loadedOrders` and `selectedOrderIds` (`:818-820`). Message on success:
   `"Select one or more orders, then load the BOM report."`, else `"No sales orders found."`.
3. **Select multiple SOs** — checkbox → `toggleOrder(orderId)` (`:836`).
4. **Load** — `loadSelectedOrders()` (`:859`):
   1. `GET /api/zoho/salesorders/{id}` for each selected id, `cache: "no-store"` (`:868`).
      Failures are logged `[RawMat] Failed to fetch order …` and dropped (`:871`).
      **If all fail** → warn `[RawMat] Could not fetch order details…` and go straight to
      `fetchReportForOrderIds(selectedOrderIds)` (`:881`) — the raw-material modal is skipped.
   2. `resolveRawMaterials(orderDetails, itemsCache, compositesCache)` (`rawmaterial.ts:448`).
   3. If any `stoneGroups` / `profileGroups` exist → open the raw-material modal (`:895`) and
      **return** (`:924`) — the BOM load waits for confirmation. For every group with `changed === true`
      (i.e. the default wasn't found), the dropdown is pre-loaded via `searchStoneItems(g.finish, g.thickness, g.defaultStoneId)`;
      sqft is read from `cf_sqft`, falling back to `(cf_height * cf_width) / (304.8 * 304.8)` (`:904-911`).
   4. Else → `fetchReportForOrderIds(selectedOrderIds)` (`:928`).
5. **Confirm raw materials** — `handleRawMatConfirm()` (`:936`):
   - Uses `rawMatOrders[0]` (stored, **not** refetched — "avoid refetching / rate limits", `:942`).
     If missing → `"Could not fetch sales order details. Please try again."`
   - Every stone group runs `applyStoneChange(group, soNumber, orderId, firstOrder)` (`:962`,
     `rawmaterial.ts:1218`), **including unchanged ones**: unchanged → update all panels to the default
     stone; changed → clone the entire tree with the new stone (`:952-961`).
     Progress: `` `Cloning BOM tree with new stone: ${group.newStoneName}...` `` /
     `` `Applying default stone: ${group.defaultStoneName} to all panels...` ``
   - Profile groups run `applyProfileChange(...)` (`:974`, `rawmaterial.ts:1338`) **only when
     `group.changed && group.newProfileId`**.
   - First failure aborts with `` `Failed to update stone: ${result.error}` `` / `Failed to update profile: …`
   - Success → close modal, `fetchReportForOrderIds(selectedOrderIds)`.
   **Side-effect: this rewrites composites in Zoho.**
6. **BOM report** — `loadBomReportForOrders(orderIds)` (`src/lib/report.ts:88`):
   fetches each SO, `collectRequiredItemIds(orders)`, `resolveCompositeTree(rootIds, …)` — a BFS with
   `MAX_DEPTH = 6` (`report.ts:17`) and a `seen` Set, then `buildReportRowsForOrder` +
   `annotateRowsForOrder` per order with a shared `globalConsumed` ledger. Message:
   `` `Loaded ${componentCount} component${componentCount === 1 ? "" : "s"}.` `` counting
   `rowType === "component" || "plain"` (`:851`).
   Item/composite fetch failures are swallowed and cached as `null` (`report.ts:37`, `:53`).
7. **Stock statuses** — `filteredRows` (`:714`) filters by `stockFilter` ∈
   `"all" | "in-stock" | "low-stock" | "out-of-stock" | "unknown"` (`types.ts:112`).
   Each `BomReportRow` (`types.ts:116`) carries `rawStock`, `effectiveStock`, `deficit`, `status`,
   `rowType`, `typeLabel` (`"PACK BOM" | "COMPONENT" | "SUB-BOM" | "ITEM"`), `wastePercent`,
   `actualQuantity`, `underProfile`.
8. **Auto-refresh** — a 10-minute interval (`:699`); `nextRefreshAt = Date.now() + 10*60*1000` (`:849`);
   manual `refreshLoadedReport()` (`:1095`).
9. **QR** — `handleQrAction(kind, action, order, orderRows)` (`:1367`), `kind` ∈ `"bom" | "user"`.
   - `buildQrPayload` (`:1328`): `"bom"` → plain text
     `SO: …` / `Cust: …` / `Date: …` / blank / `- {itemName} x{actualQuantity}` per leaf row
     (leaves = `rowType === "component" || "plain"`).
     `"user"` → `JSON.stringify({ type: "USER_DETAILS", salesOrder, salesOrderId, customerId,
     customerName, email, date, status, referenceNumber, salesperson, billingAddress,
     shippingAddress, contactPersons })`.
   - `createQrImage` (`:1358`): `QRCode.toDataURL(payload, { errorCorrectionLevel: "L", margin: 2,
     scale: 8, color: { dark: "#171714", light: "#ffffff" } })`.
   - `action: "download"` → `{salesorder_number}-{bom-items|user-details}-qr.png`;
     `action: "view"` → opens `qrModal`. Errors → `"Could not generate QR code."`
   - The `/qr/bom/[orderId]` route renders the same BOM list as a scannable page.
10. **Packing list** — pick `packingGroup` (from `getPackingGroups(orderRows)`, `:150`) and
    `packingSelectedOrderIds`, then `handlePackingDownload("packing" | "labels")` (`:1129`).
    It loops **per selected SO** and emits one file each:
    - packing: `buildPackingListHtml(order, orderRows, group)` (`:372`)
    - labels: `buildLabelsPdf(order, orderRows, group)` (`:520`) →
      `{salesorder_number}-{group}-labels.pdf` (`:1125`)
    Row classification helpers: `isShutterDescendant` (`:154`), `isShutterRow` (`:171`),
    `isCarcassRow` (`:185`), `isPackingListRow` (`:195`), `isHardwareOrOther` (`:203`),
    `filterPackingRowsByGroup` (`:209`), `consolidatePackingRows` (`:262`),
    `findLevel0ParentId` (`:327`), `groupByParentMaster` (`:346`).
    `if (!group) return;` — nothing downloads until a packing group is chosen (`:1131`).
11. **Accessories subform** — `addAccessoryRow()` (`:1153`) → `makeAccessoryRow(nextId)` (`:1144`),
    which auto-fills `soId` **only when exactly one order is loaded** (`:1147`).
    `getCarcassItemsForOrder(soId)` (`:1179`) offers master rows whose `cfGroup`/`masterGroup`
    contains `"carcass"`. `isAccessoryUsedForItems` (`:1170`) prevents double-assigning an accessory
    to the same carcass across rows. `getRowWidthMm` (`:1187`) sums `cfWidth` over the picked items.
12. **Update SO** — `updateExistingSOs()` (`:1242`):
    - Groups rows by `soId`, dropping rows with no `soId`, no `itemIds`, or no enabled accessory (`:1249-1251`).
    - Nothing selected → `"No accessories selected. Toggle at least one accessory to Yes."`
    - Per SO: **refetches** the SO (`:1268`), maps existing lines to
      `{line_item_id, item_id, name, description, rate, quantity, unit, item_total}` (`:1269-1278`),
      builds new lines `{item_id: accessory.itemId, name: accessory.label,
      description: [\`Elev: …\`, \`Size: …\`, \`For: …\`].join(" | "), quantity}` where
      `qty = entry.actualQty ?? getRowTotalMeters(row.soId, row.itemIds)` (`:1285`).
    - `PUT /api/zoho/salesorders/{soId}` with `{ line_items: [...existing, ...new] }` (`:1307-1312`)
      — **pure append; nothing is replaced.**
    - Result: `` `✓ Updated ${updatedCount} SO${updatedCount === 1 ? "" : "s"}.` ``

---

## 9) Re-order report (`/reorder`)

`<ReorderReport />` (`src/components/ReorderReport.tsx:45`).

1. **Load** — `load()` (`:57`) → `GET /api/zoho/reorder-report`, returns `{ rows, scanned_items }`.
   Server side (`src/app/api/zoho/reorder-report/route.ts`):
   - Lists items, then hydrates each to read `reorder_level`, stock, and the MSL custom field (`:112`)
   - `rol = Number(it.reorder_level || 0)` (`:124`, `:186`)
   - `msl = readCf(it, "cf_msl", "cf_minimum_stock_level", "MSL", "Minimum Stock Level") || 0` (`:195`)
   - `shortfall = Math.max(0, rol - stock)` (`:196`)
   - Vendor lead times: `leadTime = readCf(c, "cf_lead_time", "cf_leadtime", "Lead Time", "lead_time") || 0` (`:171`);
     `transitTime = readCf(c, "cf_transit_time", "cf_transittime", "Transit Time", "transit_time") || 0` (`:173`)
   - `readCf` (`:48`) checks `custom_field_hash` → direct property → `custom_fields[]`
     matching on `api_name` / `placeholder` / case-insensitive `label`
   - `batched(items, size, worker)` (`:39`) throttles the fan-out
   - Response includes `scanned_items: summaryItems.length` (`:210`)
2. **Per-row state init** (`:64-74`):
   `po_qty = Math.max(r.shortfall, r.reorder_level - r.stock) || 1`, `rate = r.last_rate ?? 0`,
   `vendor_id/lead_time/transit_time` from the row, `selected: false`.
3. **Vendors dropdown** — `GET /api/zoho/contacts?contact_type=vendor` (`:86`); failure is non-fatal.
4. **Change vendor** — `onVendorChange(itemId, newVendorId)` (`:98`) zeroes the times, then
   `GET /api/zoho/contacts/{vendorId}` → `{ lead_time, transit_time }` (`:103`). On failure the zeros stand.
5. **Filter** — `mode` ∈ `"lead" | "transit" | "combined"` (default `"combined"`, `:52`), `maxDays`, `query`.
6. **Per-row draft PO** — `createPoForRow(row)` (`:110`).
   No vendor → `"Pick a vendor first"`. Else `POST /api/zoho/purchaseorders` with
   `{ vendor_id, line_items: [{ item_id, name, quantity: s.po_qty, rate: s.rate || 0, unit }],
   notes: "Draft PO from Re-order Level Report" }` (`:117-127`).
   Success stores `posted` (PO number) + `posted_url`.
7. **Bulk draft POs — one per vendor** — `createBulkPos()` (`:148`).
   Filters `state[r.item_id]?.selected && state[r.item_id]?.vendor_id`; nothing → `"Select at least one row with a vendor."`.
   Groups into `byVendor: Map<vendorId, Row[]>` (`:159-164`) and POSTs **one PO per vendor** with all
   its lines. `dynamic = "force-dynamic"` on the route.

---

## 10) Draft PO from SO modal

`<DraftPoModal onClose />` (`src/components/DraftPoModal.tsx:35`). Steps: `search → loading → items → creating → done`.

1. **Mount** — loads all vendors from `/api/zoho/contacts?contact_type=vendor` into `allVendors`
   with `source: "all"` (`:47-60`); failure is non-fatal (silent catch).
2. **Search** — `search()` (`:64`) → `GET /api/zoho/salesorders?q={query}` (min 2 chars, per the UI copy
   at `:239`). Empty → `"No sales orders found."`
3. **Choose an SO** — `chooseSo(soId)` (`:79`):
   - `loadBomReportForOrders([soId])` (`:84`)
   - Filter to OOS leaves: `(r.rowType === "component" || r.rowType === "plain") && r.status === "out-of-stock"` (`:86`)
   - **Merge duplicates by `itemId`, summing `deficit` → `mergedDeficit`** (`:91-96`)
   - Line init: `poQty = Math.ceil(r.mergedDeficit)`, `rate = 0`, `include: true`, `loadingVendors: true` (`:97-105`)
   - `step = "items"`, then a background fetch of real vendor history:
     `GET /api/zoho/po-vendor-map?item_ids={csv}&scan=100` (`:112`) — walks the last 100 POs server-side.
     Per line: `vendorOptions = history` (`source: "history"`), `selectedVendorId = history[0]?.vendor_id ?? ""`,
     `rate = history[0]?.last_rate ?? c.rate` (`:121-128`). Failure → just clears `loadingVendors` (`:133`).
   - Errors → `"Failed to expand SO"` and back to `step: "search"`.
4. **Review lines** — toggle `include`, pick vendor, edit `poQty` / `rate` via `updateLine(idx, patch)` (`:142`).
5. **Create** — `createDraftPos()` (`:146`):
   - `active = oosLines.filter(l => l.include && l.selectedVendorId)`; empty →
     `"Select at least one item with a vendor."` and back to `step: "items"`.
   - Group by vendor (`:156-160`) → **one `POST /api/zoho/purchaseorders` per vendor**, body
     `{ vendor_id, line_items: [{ item_id, name, quantity: poQty, rate: rate || 0, unit }],
     notes: \`Draft PO auto-generated from SO #${oosLines[0]?.row.sourceOrderNumber ?? selectedSoId}\` }` (`:169-179`).
   - Vendor name resolution order: `vendorOptions` → `allVendors` → literal `"Vendor"` (`:165-168`).
   - Success → `createdPos` + `step: "done"` (shows PO numbers + `web_url` links).
   - Failure → `"PO creation failed"` and back to `step: "items"` — **POs already created in the loop
     are NOT rolled back.**

---

## 11) Developer verification loop & deploy

There is **no test runner** in `package.json` — no `test` script, no jest/vitest. Verification is the
manual three-step loop below. Run everything from the repo root
(`/Users/Apple/Documents/bom-nextjs-app/Inventory - Magppie`; note the space in the path — quote it).

### Step 1 — typecheck
```bash
npx tsc --noEmit
```
`tsconfig.json` has `"strict": true` (`:11`) and `"noEmit": true` (`:12`), plus a `paths` alias
(`:25`) mapping `@/*` → `src/*`.

### Step 2 — engine regression script
```bash
node scratch/test-drawers.js
```
`scratch/test-drawers.js` is a **standalone mirror** of the drawer engine — it re-implements
`ZONES`, `shutSpec` and `addDrawerBoxes` inline (header comment lines 1–13) so it can run under bare
node with no bundler. Its contract, quoted from the header:

> Every drawer variant (Low / High / Semi High) collapses into ONE composite
> `"Drawer Pack- Cab Drawer Box <variant>"` whose Level-1 quantity equals the number of drawers.
> Its children carry the total (per-drawer consumption × drawer count) and are divided back down at
> render/Zoho:
> - Back panel: `Part(JD) → Panel → Raw` (drilled)
> - Bottom panel: flat `Panel` (no drill, no Part wrapper)
> - Fascia: cabinet-level OWN pack: `Part(JD) → Panel → Raw` (built-in only, carcass colour)
> - HM513 (DBS): `Set of Profile Parts (LH/RH)` wrapper (has LH/RH drilling)
> - HM535 (DBC): flat cut profile (like the bottom panel)
> - Hardware: flat under the pack (Level 2)

**Because it is a copy, it drifts.** If you change `addDrawerBoxes` (`CarcassBomBuilder.tsx:855`) or
`shutSpec`, you must hand-port the change into `scratch/test-drawers.js` or the script validates the
old behaviour. Sibling scratch scripts worth knowing: `test-resolve-rawmaterials.js`, `test_naming.js`,
`test_bom.js`, `test_drilling.js`, `test_profile_split.js`, `test_panel_match.js`,
`test_merge_cabinet.js`, `test_replace_finish.js`, `test-drawer-carcass.js`, `test-search-stone.js`,
`test_local_api.js`.

### Step 3 — production build
```bash
npm run build
```
Which is literally:
```
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs next build --webpack
```
**Both flags are load-bearing** — this project runs Next 16.2.6 on the **WASM** SWC binary with the
**webpack** builder (not Turbopack). `dev` and `build` both set `NEXT_TEST_WASM_DIR`; dropping it
breaks the build on this machine. Dev server: `npm run dev` → `next dev --webpack -H 127.0.0.1`.
`start` → `next start -H 127.0.0.1`. Lint → `npm run lint` (`eslint-config-next` 16.2.6).
`package.json` pins `"overrides": { "postcss": "8.5.14" }`.

### Deploy
Vercel. From `scratch/vercel-deploy.log`, the production command is:
```bash
vercel deploy --prod
```
(logged as the *"Promote to production"* step). Env vars must be set in the Vercel project — the
same `ZOHO_*` set plus `OPENAI_API_KEY` (for `/api/ai/chat`). `scratch/add_env.sh` / `scratch/add_envs.sh`
/ `scratch/add_env.js` exist as helpers; `vercel_env.log` records past pushes. **Never commit
`.env.local` / `.env.local.bak`.**

Serverless note: `src/lib/zoho.ts:24` caches the Zoho access token at
`path.join(os.tmpdir(), "magppie-cache", "zoho-access-token.json")` — deliberately the OS temp dir,
because `process.cwd()` is read-only on Vercel. Disk writes are best-effort; the in-memory
`cachedToken` keeps a warm lambda working. `TOKEN_REFRESH_SKEW_MS = 5 min` (`:25`),
`TOKEN_BACKOFF_MS = 5 min` (`:26`). On a rate-limited refresh the cache stores
`refreshBlockedUntil` and subsequent calls throw
`` `Zoho token refresh is cooling down. Try again in about ${waitSeconds} seconds.` `` (`:132`).
`zohoInventoryRequest` retries **once** after clearing the cache on HTTP 401 / body `code === 57` /
`code === 14` (`:213`).

### Manual smoke checklist after any BOM-engine change
1. `/builder` → configure a `BC` `DW` `3dr` cabinet at 600×720×560, t=15 → confirm the code renders
   and `+ Add to Project` is disabled until an Elevation is picked.
2. Flip `inbuiltDrawers` to `2hb1bl` → the code must change from `…-2LB-1HB-…` to `…-2HB-1BL-…`.
3. Tab `Packets` → confirm exactly one `Drawer Pack- Cab Drawer Box …` row with qty = drawer count.
4. `⑫ Downloads → Excel BOM` → confirm the `Full BOM`, `Out of Stock`, `Opti` sheets and that
   `S. No.` increments once per project line.
5. `Export All Combinations` → confirm the row count is stable vs. the previous run (a large delta
   means a skip rule changed).
6. Only then attempt `Add to Zoho Sales Order`, and **against a throwaway SO** — the flow writes
   real items and composites into Zoho Inventory and has no rollback.
