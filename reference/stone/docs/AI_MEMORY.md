# AI_MEMORY.md — Everything you need to continue this project

> Read this **first**. It is written for an AI assistant taking over the Magppie Carcass BOM Builder with no prior context. If you follow this file you should not need to ask the user anything to start working.

---

## 1. Identity & philosophy

**Product:** Magppie Carcass BOM Builder — an internal factory/back-office tool for **Magppie** (stone modular kitchens, India). A user configures a kitchen cabinet; the app derives a canonical **code**, a complete **multi-level BOM**, factory outputs (cut lists, packing lists, labels, QR), and writes **Zoho Inventory** composite items + Sales-Order lines.

**Philosophy (learned from the user's decisions):**
- **The factory is the customer.** Numbers must be manufacturable, not merely plausible. A wrong formula becomes a wrong stone cut and a real cost.
- **The user is the domain expert; the code is not.** When the user says a rule, that rule wins over what the code currently does. Ask when genuinely ambiguous — but only when the ambiguity would change the output.
- **One source of truth per rule.** Shared logic lives in one function used by every consumer (build, aggregation, export). See `ctGeom`.
- **Codes and item names are contracts.** They're embedded in Zoho item names, and idempotency matches on the name. Changing a format creates new Zoho items. Never change a code format casually.
- **Local-first.** The user tests locally; production is sacred.

---

## 2. Non-negotiable working rules

1. **NEVER deploy to Vercel unless the user explicitly authorizes it for that change** ("deploy this", "publish on vercel"). Otherwise say "local only — not deployed".
2. **Verification loop after EVERY change** — all three must pass before you report done:
   ```bash
   npx tsc --noEmit
   node scratch/test-drawers.js      # must print: ALL TESTS PASSED SUCCESSFULLY!
   npm run build
   ```
3. **Confirm-first** for larger or ambiguous changes: state your understanding, wait. The user often says *"let me know your understanding then i'll confirm"*.
4. **Never** bundle or print secrets (`.env.local`, `vercel_env.log`, `add_envs.sh`). Zoho DC is **India** (`accounts.zoho.in`, `zohoapis.in`).
5. When you change drawer/shutter logic, **update the mirror** `scratch/test-drawers.js` and its assertions too — it is the only automated gate.

---

## 3. Where things live

- **Heart file:** `src/components/CarcassBomBuilder.tsx` (~11,200 lines) — configurator + BOM engine + all sections + exports + Zoho push. Almost every change lands here.
- Routes: `/` dashboard · `/builder` · `/designer` (`soMode`) · `/planning` (`soMode planningMode`) · `/reorder` · `/qr/bom/[orderId]`.
- `src/lib/`: `zoho.ts` (token/cooldown/HTTP), `rawmaterial.ts` (stone/profile search + resolution), `stock.ts` (BOM expansion + stock status), `report.ts`, `export.ts`, `naming.ts`, `types.ts`.
- `src/data/`: `stone_finishes.json` (by thickness), `profile_finishes.json`, `planning_finishes.json` (PG lists + designer maps).
- `scratch/test-drawers.js` — the CI gate (a **mirror** of drawer/shutter logic; keep in sync).

Read `APP_ARCHITECTURE_FULL.md` for the map, `requirements.md` (461 requirements) for exhaustive behavior, `CHAT_SUMMARY.md` for how every decision was reached.

---

## 4. Architecture in one breath

```
UI selections ─(useMemo)→ buildModel()
   └ buildCarcassInner() → buildCarcassInnerRaw()   (per-zone carcass)
        ├ addDrawerBoxes()      (drawer boxes + fascias)
        ├ buildShutters()       (shutter/drawer fronts, blind fixed panel, hinges)
        └ addElenor()           (Elenor light BOM)
   → CarcassModel {panels, profiles, hardware, cons, pkRows, shutters, netSqft, ops}

Views: ② Carcass Packets (pkRows) · ③ Raw Roll-up (net+waste, weight) · ④ Full Explosion
Aux sections build their own models: Fillers, Visible Panels, Countertop (ctGeom), Backsplash,
   Other Accessories (chimney/dishwasher), Accessories ⑪
buildFullBomData() → FullBomRow[] → exportBuilderExcel(); buildOosData/buildOptiData;
handleAddToZohoSO() → idempotent composites + SO line replacement
```

Client-heavy: all domain logic runs in the browser; the Next API routes are thin Zoho/OpenAI proxies.

---

## 5. Coding standards & conventions (match these)

- **TypeScript strict**; no `any` in new code unless the surrounding code forces it (the legacy variant objects are `any`).
- **Comments explain WHY / the constraint**, never what the next line does. Match the existing density. Real examples from the file:
  > `// 2HB+1BL: the box behind each high front is a LOW box, so its shutter carries the LOW BACK (H90) drawer hardware, not the high-back H239.`
- **Naming:** `buildX` (constructs rows/models), `addX` (mutates arrays in place), `ctX` (countertop), `shX`/`SH_*` (shutter), `pk*` (packet rows). Constants `UPPER_SNAKE`. Zone keys `BC/BCL/BB/BBL/WC/WB/TC/TB/TCL/LO/LB/LBF/LOF/MD`; family keys `DW/HO/SK/SH/GD/AP/BPO/WBP/WGL/WST/...`.
- **Item names are data, not prose** — copy them verbatim from the user/Zoho, including odd spellings (`GLUE LATRICATE`, `TRANSPERENT`). Do not "fix" them.
- **Single source of truth:** when a rule feeds both the BOM and an aggregation, put it in one function and call it from both (`ctGeom` is the model to copy).
- **Formulas inline with units**, e.g. `const backW = W - 72;` with a comment only if the constant is non-obvious.
- UI: numbered section cards (①…⑫), inline styles (no CSS-in-JS lib), tables wrapped in `overflow-x: auto`.

---

## 6. Domain constants (memorize)

| Constant | Value | Meaning |
|---|---|---|
| `SQDIV` | 92903.04 | `sqft = w_mm × h_mm / SQDIV` |
| `STONE_WASTE` | 0.15 | +15% on stone |
| `PROFILE_WASTE` | 0.20 | +20% on profiles |
| `ELENOR_WASTE` | 0.10 | +10% Elenor |
| raw drilled | +17% | drilled raw panels |
| `KG_SQFT` | 3.45 | carcass stone kg/sqft (net area) |
| `SH_KGSQFT` | 1.38 | shutter stone kg/sqft (net area) |
| `CJ_CUT` | 23 | CJ sink top cut |
| `SHELF_OFF` | 40 | shelf offset |
| thickness | 15 carcass · 6 shutter stone · 5 glass shutter · 8 glass shelf · 9 MD3 face | |

---

## 7. Business rules you must not break

**Cabinet code (11 fields):** `p1-p2-handleToken(CJ|STD)-matToken(GL|ST)-p3-p4-p5-W-H-D-t` + optional `-carcassMat(-shutterMat)`.
- **P7 = `XXX`** (the handle used to be repeated there; removed as redundant). Handle decodes from **P3**.
- Decoder reads code from `sku || name || description`.

**Handle ↔ design:** `XCJ` (CJ, handleless/gola) ⇔ MD1/MD3(+CM); `STD` (Titus) ⇔ MD2(+CM); CL1/CL2/NEON20 handle-agnostic. Handle filter applies **base zones only**.

**Shutter face deduction (`shDeduct`):** non-base → 3. Base + handleless family → **33**, **except middle drawer `ML` → 3**. MD2/CL/NEON → 3.

**Shutter geometry:** face = `HE − ded`; HE = FH→H, HB→360, LB/ML→180. Net panel = `(w − inset) × (h − inset)`; inset 5 (MD1/MD2/CM/NEON20), 3 (MD3 family), 118 (CL1), 149 (CL2). Frame 25 (31 for CL).

**Drawers:** Low(63,H90) · High(212,H239) · Semi(148,H175). Back `(W−72)×backH×15`; Bottom `(W−50)×(D−77)×6`; Fascia `(W−2t−8)×110|210×15`; DBS 483×2; DBC `(W−78)`×4.
- **2HB+1BL:** the High pack takes the **Low** config (63 / H90), and its **shutter** carries H90.
- **Hardware dedup:** shutter-faced drawers → pack on the **shutter**; built-in/fascia drawers → pack on the **Drawer Pack**. (Confirmed correct; do not "fix" the apparent duplication on 2HB+1BL — those are different drawers.)
- **WBP** is an accessory with **no drawer**. **BPO** likewise.

**Blind:** `blindW` = 550 (base/tall) / 450 (wall/loft). Fixed dummy panel = `(W − blindW − 3) × (H − 3)`, **always stone MD1 6 mm**, only when `W − blindW > 0`.

**Wall shelves:** `WGL/WST/WOP` → 3 if `H ≥ 1085` else 1; `WDR` → 2 if `H ≥ 1085` else 0 (token `XXX`). Wall short height is **725**.

**Countertop (9 types, via `ctGeom`):** shared = top slab (2×15 or 2×20) + dead base `D−40` + front 30 mm patti **folded into topD (D+30)** + Grand Light HM-512 + 3 mm radius + polish/glue. Side patti **fold into topL** (`+30/side`). Drop-down = **mini-counter sub-BOM** (visible stone `len × dropHeight` **+15/+30 mitre issuance**; dead base `dropHeight − 100`). **100 mm** cabinet reduction: side→length, back→depth; **type 7 exempt**; **type 8** keeps full top depth (350 mm sitting drop, `deadQty 2`). **Rounding** = name-only note `Rounding LH/RH/Both (-600)`, default 600. `dropHeight` default 705.
- **CT_TYPES is display-order only** — each entry's `value` maps to the original construction logic. **Never renumber `value`.**

---

## 8. Assumptions currently baked in (flagged, user-accepted)

- Type-8 cabinet-zone base depth = `D − 40 − 100`.
- Type-9 back panel `(L−60) × dropHeight` (added by inference after folding the back patti).
- Island panel lengths `L−60` (types 6/7) and `L−80` (type 8), from 1500 → 1440/1420.
- Side back-visible panel length = the counter **Depth**.
- The user closed these with **"no nedd"** — do not re-open unless asked.

---

## 9. Known limitations (be honest about these)

- **Security:** auth is a **client-side password gate only** (constant in `AuthGate.tsx`), and **every `/api` route is unauthenticated**. Anyone reaching the deployment can drive Zoho. See `AUTHENTICATION.md`.
- **No persistence:** all builder/designer/planning state is in-memory; a reload loses the project. Only `app_authenticated` and the dashboard accessory-subform rows persist.
- **One 11,200-line component** — hard to test/maintain; changes are surgical greps + ranged reads.
- **No test framework/CI** — only `scratch/test-drawers.js` (a mirror) and the 3-step loop.
- **MD3** has no default profile item in `DEFAULT_PROFILE_NAMES` (`rawmaterial.ts`) — resolves only if Zoho has a match.
- **Stone matching** drops colour-qualifier words (BLACK/WHITE/…) to find core-name slabs — can theoretically pick a wrong tint; exact-finish matches rank first.
- **Zoho idempotency is name-based** — a format change creates new items (accepted for the P7 change).
- Some `SIZES` rows are unreachable from the UI because `famSetOf` restricts families (e.g. `BCL.*` except SH, `BB.PLB`).

---

## 10. Future plans / backlog pointers

See `BACKLOG.md`. Highest value next: server-side auth + protecting `/api`; project persistence (save/restore); splitting the heart file; a real test runner; pinning MD3's profile item; the borderline 500 mm families (`BCL.SH`, `WDR`, `WOP`, `WB.*`) if the user confirms.

---

## 11. Environment gotcha

`localhost:3000` may be taken by an **unrelated project**. Verify the owner before quoting a URL:
```bash
lsof -a -p "$(lsof -ti:3000 -sTCP:LISTEN)" -d cwd
```
Start this app on a free port: `npm run dev -- -p 3007` → http://localhost:3007/builder.

---

## 12. Tone & reporting the user expects

- Lead with the outcome, then the detail. Plain sentences, no filler.
- Always state the verification result explicitly ("tsc clean · ALL TESTS PASSED · build OK").
- Always end a non-deployed change with **"local only — not deployed"**.
- When you find that the user's bug report is actually correct behavior, **prove it with evidence** (run the model, show the output) rather than asserting — that is what resolved the drawer-hardware dispute.
