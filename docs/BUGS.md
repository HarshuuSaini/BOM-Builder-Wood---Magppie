# Bugs & Open Items

## Legend

**Stub** — a known-unknown. The code deliberately withholds output and raises a
visible amber note. Not a defect; a decision pending. **Never replace a stub
with an estimate.**

**Defect** — something wrong that should be fixed.

**Risk** — works, but fails badly under conditions not yet tested.

---

## Critical

### R1 · `BOARD_GROUP_TOKENS` unverified, fails silently — Risk
`src/lib/rawmaterial.ts`

Board items are found by matching `cf_group` / `group_name` against
`["board","ply","plywood","mdf","particle"]` — a guess at Magppie's Zoho
taxonomy. If none match, `findDefaultBoard` returns nothing, every panel
resolves to no raw material, and **there is no error** — just an empty section.

*Repro:* resolve any sales order whose board items use a `cf_group` outside the
list.
*Fix:* read the real `cf_group` values from the item master and correct the
constant. Consider logging a warning when a group yields zero candidates.

### D1 · API routes are unauthenticated — Defect
`src/app/api/**`

`AuthGate` is client-side only. Every Zoho route can be called directly with
curl, with no credential. Anyone reaching the server reaches Zoho.

*Fix:* `middleware.ts` matching `/api/:path*`. See `AUTHENTICATION.md`.

### D2 · Auth password hardcoded in the client bundle — Defect
`src/components/AuthGate.tsx:27`

`Factory@1234`, inherited from stone. Readable by anyone who opens devtools.

*Fix:* server-side check against an env var. Only meaningful alongside D1.

---

## High

### S1 · Drawer front heights not supplied — Stub
`WoodBomBuilder.tsx` → `buildShutters`

A drawer cabinet's fronts must be one per drawer, each sized to its drawer
height. Stone derived these from its 360/180 front slots; wood front heights
were never supplied. Multi-drawer cabinets emit carcass, box sets and
bottom/back panels but **no fronts**. Single-front families (GD) are fine.

*Needs:* front height per drawer class (Low, High), and the inter-front gap.

### S2 · Lian deductions missing — Stub
`WoodBomBuilder.tsx` → `DRAWER_DED`

The returned template still held the example row — stone's old
63 / 50 / 77 / 72 with a 6mm bottom and 18mm back, labelled "EXAMPLE ONLY".
Selecting Lian costs the box set and withholds the panels.

*Needs:* real Lian Slim Box figures for Low and High.

### S3 · MD back panel height undefined — Stub
`buildCarcassInnerRaw`, `fam.special === "MD"`

MD has no bottom panel, so the back is grooved on three edges and the +9
allowance does not apply symmetrically. Parked by the user at their request.

*Needs:* the back height formula for a three-edge groove.

---

## Medium

### S4 · REF short back wall — Stub
Stone uses `H − 1874` to clear the fridge recess. No wood equivalent. A
full-height back is emitted meanwhile, which over-orders material.

### S5 · APP twin back walls — Stub
Stone splits upper/lower at `H − 1349`. A single back is emitted meanwhile.

### S6 · Membrane adhesive rate — Stub
Every other consumable has a g/sqft rate; membrane adhesive is emitted by area
only. The user deferred it.

### D3 · Handle / shutter-type compatibility rule missing — Defect
Stone filtered the design dropdown by handle (`XCJ_DESIGNS` / `STD_DESIGNS`).
That filter was written against the stone design list and has no wood
equivalent, so any handle can pair with any shutter type. Some combinations may
not be manufacturable.

### D4 · Composite traversal has no cycle guard — Defect
`rawmaterial.ts` recurses through `mapped_items` with no visited set. A
circular composite in Zoho would recurse until the stack overflows.

*Fix:* carry a `Set<string>` of visited IDs.

---

## Low

### D5 · Two pre-existing type errors — Defect (inherited)
`BomDashboard.tsx:1631` — `key` passed inside a props object.
`BomDashboard.tsx:1794` — property access on `unknown`.

**Both exist in stone**, verified by typechecking the original. Not introduced
by the port. Harmless at runtime; noisy in CI.

### A1 · `fixed_dpn` collapse — Assumption
Stone's DPN/DPNG pattern was 2 Low + 3 Semi-High. Semi-High was dropped, so it
became 2 Low + 3 High. **This was my inference, not an instruction.** Worth a
carpenter confirming a five-drawer pantry wants three full-height drawers.

### A2 · Drawer panel material and banding — Assumption
Material assumed BWP ply (`DRAWER_PANEL_MAT`); banding assumed none. Neither
was specified.

### A3 · SK / HO / WDR top rails — Assumption
Stone used an aluminium sink profile frame; wood emits two 18mm ply rails,
100mm wide. Proposed and never contested, but never explicitly confirmed.

---

## Fixed during the original build

Recorded so they are not reintroduced.

| Defect | Cause |
|---|---|
| `/` rendered the stone dashboard | `app/page.tsx` copied without reading it |
| `src/lib/export.ts` missing | listed as "adapt", never written |
| `BomDashboard` wouldn't compile | wrongly classified material-agnostic |
| `rawmaterial.ts` had an invented API | rewritten instead of ported |
| `AuthGate` imported as default | it is a named export |
| `globals.css` never copied | scaffolding omission |
| `FullBomRow` had 25 fields | missing `_type`, read by `applyRowColors()` |
| Drawer units emitted one full-height shutter | leaves counted from the door variant |
