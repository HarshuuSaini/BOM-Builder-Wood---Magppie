# AI_MEMORY.md

Read this first. It contains everything needed to continue development without
asking questions.

---

## What this is

**Magppie Wood Kitchen BOM Builder.** A Next.js app that lets a kitchen
designer configure plywood cabinets and emits a manufacturing bill of
materials — panel cut list, hardware, consumables, board sheet counts — which
resolves against Zoho Inventory for stock and purchasing.

It is a **port of Magppie's existing Stone Kitchen BOM Builder**. That
relationship is the single most important fact about this codebase. The
catalog, the BOM pipeline, the output format and roughly half the files are the
stone app verbatim. Only construction logic differs.

A reference copy of the stone source is in `reference/stone/`. **Diff against
it before assuming anything is intentional.**

---

## Project philosophy

**Port, don't reinvent.** Every time this rule was broken during the original
build, it produced a bug. `rawmaterial.ts` was rewritten from scratch with an
invented API and silently broke `BomDashboard`; the fix was to throw the
rewrite away and re-port stone's file with a mechanical rename. If a stone file
does the job, copy it and rename identifiers. Do not "improve" it.

**Stub, don't guess.** Where a real-world number is unknown — a drawer front
height, a back panel dimension — the code raises a visible note and withholds
the line rather than emitting a plausible-looking number. Guessing a drawer
height produces scrap on the shop floor. Search `stubs.push` to find all of
them. **Never replace a stub with an estimate.**

**Carpenter-first.** Everything in mm. Standard module sizes preferred. Cut
sizes are what a carpenter cuts. No cleverness that a workshop can't act on.

---

## Architecture

Next.js 16 App Router, React 19, TypeScript. Zoho Inventory is the system of
record for orders and stock. Costing is deliberately local: the approved Excel
`KITCHEN` sheet is generated into `src/data/costing_master.json`, bundled with
the application, and exposed read-only at `/admin` after server-side password
verification. The old Zoho `cm_wood_costing` module is not read or written.

```
buildCarcassInnerRaw  →  mergeCarcassPanels  →  buildModel
                      →  buildRawRows / buildCSV
                      →  buildFullBomData  →  buildOosData  →  buildOptiData
```

That pipeline and the 26-column `FullBomRow` are a **contract**. The Excel
export, stock check and QR BOM page all read it. Changing the shape breaks
three consumers that were copied unmodified from stone.

### Where things live

| Path | Role |
|---|---|
| `src/components/WoodBomBuilder.tsx` | The builder. All construction logic. Start here. |
| `src/lib/rawmaterial.ts` | Board/laminate resolution against Zoho. Ported + renamed. |
| `src/data/costing_master.json` | The 122-row costing master used by the app. |
| `tools/generate-costing-master.mjs` | Regenerates costing JSON from the approved Excel workbook. |
| `src/lib/export.ts` | Excel/CSV export. Ported + renamed. |
| `src/lib/naming.ts` | Panel/part name normalisation. **Verbatim from stone.** |
| `src/lib/types.ts` `stock.ts` `zoho.ts` `report.ts` | **Verbatim from stone.** |
| `src/components/BomDashboard.tsx` | Zoho orders + raw material. Ported + renamed. |
| `src/components/AuthGate.tsx` etc. | **Verbatim from stone.** |
| `src/app/api/**` | Zoho proxy routes. **Verbatim from stone.** |

`docs/PORTING_NOTES.md` has the authoritative copied-verbatim list. Keep it
accurate — it is what stops the next person hunting for a wood equivalent of a
stepper profile that was deliberately deleted.

---

## Coding standards & conventions

- **Naming follows stone.** `buildCarcassInnerRaw`, `mergeCarcassPanels`,
  `explodePanelForTree`, `buildFullBomData` — same names, same order in the
  file. Section banner comments mirror stone's.
- Panel names follow stone's string format: `Panels- CR Side 18mm 560x720`,
  `Panels- SH 16mm 300x717`. `naming.ts` parses these; don't change the shape.
- Prefix codes: `CR` carcass, `SH` shutter, `DR` drawer, `CT` countertop.
- Pack names: `Carcass Pack`, `Shutter Pack`, `Drawer Pack`, `Hardware Pack`.
- Cabinet code follows stone's 11-segment hyphen contract: `p1-p2-handleToken(CJ|STD)-matToken(GL|WD)-p3-p4-p5-W-H-D-t[-FINISH]`. Hand rides in p4/p5.
- Identifiers renamed from stone use **Board** where stone said **Stone**.
- All dimensions in **mm**; areas in **sqft**; lengths in **RMT/mtr**;
  adhesives and paint in **grams**.
- Constants live at the top of `WoodBomBuilder.tsx`, uppercase.
- Two-space indent, double quotes, semicolons. Match surrounding code.

---

## Business rules — the ones that matter

**Construction is full-sides, universally.** Sides run `D × H`; top and bottom
sit *between* them at `(W − 2t) × D`. Stone branched on `ZONES.construct`
between `fulltb` and `fullsides`; wood does not. The field is gone.

**Base height stack:** 100 skirting + 720 carcass + 30 counter = 850. The 720
is unchanged from stone, which is why every derived height formula survived.

**Thicknesses:** carcass 18 nominal, back 8 nominal, shutter 18 nominal. Board
option A is a 16mm core plus 0.8mm laminate on each face; its back is a 6mm core
plus 0.8mm each face.

**Back is grooved:** `(W − 2t + 9) × (H − 2t + 9)`. The +9 is a 5mm groove per
side less 1mm total clearance.

**Edge band is 0.8mm on all four edges of every panel except the back.** Taken
literally and confirmed knowingly — including the rear edge of a side panel
against a wall. That is ~11.8 RMT per 600×720×560 carcass, versus ~2.8 for front
edges only. **Cut sizes are finished sizes** — pre-milling removes 0.8mm and the
band restores it, so there is no deduction anywhere.

**Shutter type is one flat list of the 13 `Shutter_Material.xlsx` rows** (Sep
2026) — `SHUTTER_TYPES` is keyed `PRELAM_HDHMR`, `POSTLAM_BWP`, `PU2_MDF`, … and
each entry carries the sheet verbatim: `mat` is its NOTES string, `t` its USE
BOARD THICKNESS, `fam` groups rows for the consumable rules, `rate` names its
/admin costing key. Every shutter is 18mm nominal but **post-lam cuts at 16**
(0.8mm laminate per face restores 18). Default is `POSTLAM_BWP`. Add a shutter
option by adding a row here — nothing else needs touching.

**Shelf material is derived, never configured:**
`isGlassShutterFam(fk) ? "8mm toughened glass" : BOARDS[board].core`.
Note this differs from stone, where wall zones got glass shelves regardless of
door type. A WST with a laminated shutter now gets a ply shelf. **This is
correct, not a porting bug.**

**Gola (`XCJ`) cuts `CJ_CUT = 23` off the top panel depth** and takes 33mm off a
base shutter height (3mm normal gap + 30mm finger gap). The middle low-back
drawer front keeps 3. Unchanged from stone.

**Drawer height classes are Low and High only.** Stone's Semi-High is not used
in wood. `fixed_dpn` was 2 Low + 3 Semi-High and is now **2 Low + 3 High** —
this collapse was my inference, not a user instruction, and is worth confirming.

**Nothing is automatic.** Every accessory is opt-in, including the Elenor light,
which in stone fired automatically inside the carcass build.

**Wastage:** carcass 10%, shutter 20%, profile 20%. All editable, not constants.

**Glass is bought by area, not by the sheet.** `buildBoardTotals` returns
`sheets: null` for anything matching `/glass/i`.

---

## Assumptions I made that were never explicitly confirmed

Treat these as soft. If a decision depends on one, verify it first.

1. **SK / HO / WDR top rails** — stone used an aluminium sink profile frame;
   wood emits two 18mm ply rails, front and back, 100mm wide.
2. **Depths 560 / 336** — inherited from stone, inside the brief's ranges,
   never contested.
3. **Zones absent from the width note inherit** — BCL from base, WB from blind,
   loft from WGL/WST, MD 600, WOP 300.
4. **Glass shelves use the ply shelf formula** at 8mm; stone's `W−36` / `D−49`
   offsets existed only because of aluminium shelf profiles.
5. **Drawer panel material is BWP ply** (`DRAWER_PANEL_MAT`) — not specified.
6. **Drawer panels carry no edge band** — the "all panels except the back" rule
   was stated for carcass and shutters; a bottom inside a metal box is neither.
7. **`fixed_dpn` = 2 Low + 3 High** — see above.
8. **`BOARD_GROUP_TOKENS`** — a guess at the Zoho taxonomy. See below.

---

## Known limitations

**`BOARD_GROUP_TOKENS` is unverified and fails silently.** `rawmaterial.ts`
finds board items by matching `cf_group` / `group_name` against
`["board","ply","plywood","mdf","particle"]`. If none match the real Zoho item
master, `findDefaultBoard` returns nothing, every panel resolves to no raw
material, and there is **no error** — just an empty raw-material section. This
is the highest-risk item in the codebase. Verify before anything else Zoho.

**The auth password is hardcoded** at `AuthGate.tsx:27` (`Factory@1234`),
carried over from stone. Must move to an env var before deployment.

**Two pre-existing type errors** at `BomDashboard.tsx:1631` and `:1794`. Both
exist in stone; verified by typechecking the original. Not introduced here.

**No automated tests.** Verification is a headless smoke harness
(`tools/smoke/`) plus the reference figure below.

**Fillers, visible panels, countertop, accessories, raw-material selection,
stock check and downloads are now built** (Sep 2026) in the Project & totals
tab, per spec: a filler/VP is a plain banded shutter-type panel (no HM-504, no
silicone, no VP profile machinery), countertop is one bought-in line, and every
accessory (PVC skirting, Elenor) is opt-in. The cabinet code follows stone's
11-segment contract with `WD` in place of stone's `ST` material token and the
finish appended: `BC-SH-STD-WD-1SX-LHS-XXX-600-720-560-18-WHITE`.

---

## Reference figure — use this to check any refactor

A `BC.SH` 600 × 720 × 560 on board option A yields:

- **22.978 sqft** of panel
- **11.806 RMT** of edge band
- Panels: Side 560×720 ×2 · Top 564×560 · Bottom 564×560 · Back 573×693 @8mm ·
  Shelf 563×532

Run `node tools/smoke/run.js` to reproduce this and more.

---

## Future plans

Short term: close the eight open items in `BUGS.md`, then build the remaining
UI sections. Medium term: wire the Zoho raw-material selection for boards and
laminates, which is ported but untested against real wood items. Longer term:
the user has hinted at nesting/optimisation beyond a flat wastage percentage —
`buildOptiData` exists in stone and is the hook for that.

---

## Costing master workflow (Sep 2026)

- Only the Excel `KITCHEN` sheet feeds costing; `Sheet1` and `Sheet2` are not
  modified or imported.
- Every master row carries Group, Subgroup, Type, Brand, Thickness, Rate Basis,
  Previous Rate, Current Rate, Rate Change and Rate Change %.
- Boards use `SQFT`; profiles use `MTR` where applicable; hardware uses its
  actual `PCS`, `SET` or `KG` basis.
- `Previous Rate` is not calculated from Unit Cost. On a monthly update, copy
  the old Current Rate into Previous Rate, then enter the new Current Rate.
- Regenerate with:
  `node tools/generate-costing-master.mjs /absolute/path/to/approved.xlsx`
- Verify `npm run build`, commit the JSON, and redeploy. Vercel functions cannot
  persist edits back into a bundled JSON file, so `/admin` is intentionally a
  searchable read-only view rather than a misleading save form.

---

## How to work with this user

They answer decisively and correct errors directly. They uploaded handwritten
notes twice; both times transcription flags were worth raising, and both times
some readings were wrong in ways only they could catch. They said "wait" twice
rather than guess — respect that and park the question.

They caught a real bug by running the app. Take their reports seriously and
investigate beyond the symptom: "you have run the old page" turned out to be
six defects, not one.

Ask one question at a time. Flag what you inferred versus what you were told.
