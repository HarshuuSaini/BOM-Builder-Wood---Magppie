# Magppie Carcass BOM Builder — UI / UX Documentation

App root: `/Users/Apple/Documents/bom-nextjs-app/Inventory - Magppie`
Stack: Next.js 16.2.6 (App Router, `--webpack`, SWC-WASM), React 19.2.6, TypeScript 5.9.3. No CSS framework, no component library. All styling is hand-written CSS in `src/app/globals.css` plus per-component `<style>` blocks and heavy inline `style={{…}}` objects.

Client-side libraries used by the UI: `qrcode` (QR PNGs), `jsbarcode` (CODE128 barcodes), `jspdf` (label PDFs), `xlsx` / `xlsx-js-style` (Excel exports).

---

## 1. Navigation map

There is **no shared nav bar**. Navigation is a set of hard-coded `<a href>` links, different per page.

```
                     ┌────────────────────────────────────────────┐
                     │ AuthGate (src/components/AuthGate.tsx)      │
                     │ wraps EVERY route in layout.tsx             │
                     └───────────────┬────────────────────────────┘
                                     │ (password OK → localStorage)
   ┌─────────────────────────────────┼──────────────────────────────────────┐
   │                                 │                                      │
   ▼                                 ▼                                      ▼
 /  (BomDashboard)            /builder  /designer  /planning          /reorder
 "BOM Backorder Report"       (all three = CarcassBomBuilder)         (ReorderReport)
   │  actionbar links:          header links:                           header links:
   │   → /reorder               → /  (BOM Dashboard)                     → /  (← BOM Report)
   │   → /builder               → /reorder                               → /builder
   │                            → /builder  → /designer  → /planning
   │
   └── QR "BOM QR" images encode plain text, NOT a URL.
       /qr/bom/[orderId] (QrBomPage) is reachable only by typing the URL.

 AiCopilot (floating 💬 bubble) is rendered on EVERY page inside AuthGate.
```

Route → component table:

| Route | File | Renders | Notes |
|---|---|---|---|
| `/` | `src/app/page.tsx:1-5` | `<BomDashboard />` | Main Zoho BOM backorder dashboard |
| `/builder` | `src/app/builder/page.tsx:1-5` | `<CarcassBomBuilder />` | No props → full configure UI |
| `/designer` | `src/app/designer/page.tsx:1-7` | `<CarcassBomBuilder soMode />` | SO → BoM; Excel upload card |
| `/planning` | `src/app/planning/page.tsx:1-7` | `<CarcassBomBuilder soMode planningMode />` | SO → BoM; Zoho SO search card |
| `/reorder` | `src/app/reorder/page.tsx:1-5` | `<ReorderReport />` | Re-order level report |
| `/qr/bom/[orderId]` | `src/app/qr/bom/[orderId]/page.tsx:1-6` | `<QrBomPage orderId>` | Async `params` (Next 16), read-only |

`src/app/layout.tsx:11-21` — `<html lang="en"><body><AuthGate>{children}<AiCopilot /></AuthGate></body></html>`. Metadata title is `"BOM Backorder Report"` for **every** route (`layout.tsx:6-9`) — the browser tab never changes.

---

## 2. Component inventory

| Component | File | Lines | Renders |
|---|---|---:|---|
| `AuthGate` | `src/components/AuthGate.tsx` | 353 | Full-screen password gate + its own `<style jsx global>` |
| `AiCopilot` | `src/components/AiCopilot.tsx` | 276 | Floating chat bubble + panel (100% inline styles) |
| `BomDashboard` | `src/components/BomDashboard.tsx` | 2314 | `/` — search, tabs, summary strip, filters, order cards, QR modal, packing modal, raw-material modal, accessories subform |
| `BomOrderCard` | `src/components/BomOrderCard.tsx` | 124 | One SO card: header + grouped BOM tree table. Reused by `/` and `/qr/bom/[id]` |
| `DraftPoModal` | `src/components/DraftPoModal.tsx` | 447 | 5-step draft-PO wizard (inline styles) |
| `ReorderReport` | `src/components/ReorderReport.tsx` | 467 | `/reorder` — full page (inline styles) |
| `QrBomPage` | `src/components/QrBomPage.tsx` | 56 | `/qr/bom/[id]` wrapper around `BomOrderCard` |
| `CarcassBomBuilder` | `src/components/CarcassBomBuilder.tsx` | 11220 | `/builder`, `/designer`, `/planning` — the heart file |
| `SearchableSelect` | `CarcassBomBuilder.tsx:4718-4800+` | ~90 | Internal (not exported) combobox used all over the builder |

Data files powering dropdowns: `src/data/profile_finishes.json`, `src/data/planning_finishes.json`, `src/data/stone_finishes.json`.

---

## 3. Design system

There are **two visually unrelated design systems** in this app. They do not share tokens.

### 3.1 Dashboard system — `src/app/globals.css` (1532 lines)

Root variables (`globals.css:1-14`):

```css
:root {
  --background: #f6f5f1;   --foreground: #171717;
  --muted:      #6d706e;   --line:       #d7d8d2;
  --panel:      #ffffff;   --panel-soft: #ece9e0;
  --accent:     #0f766e;   --accent-strong: #115e59;   /* teal */
  --danger:     #b42318;   --warning:    #b7791f;   --success: #287d3c;
  --shadow: 0 14px 45px rgba(33, 38, 35, 0.1);
}
```

Note: `body` background is `#f7f8fd` (`globals.css:29`), **not** `var(--background)` — `--background` is declared but never used. Typography is `Arial, Helvetica, sans-serif` (`globals.css:31`). No web fonts are loaded anywhere in the app.

Key classes:

| Class | Line | Purpose |
|---|---:|---|
| `.app-shell` | 49 | Page padding wrapper, `min-height:100vh`, `padding:18px` |
| `.widget-frame` | 54 | White rounded card, `max-width:1480px`, `border-radius:18px` |
| `.widget-title` | 64 | 86px-tall header holding `<h1>` at 27px/700 |
| `.widget-actionbar` | 78 | Black (`#171714`) bar with title + tool buttons |
| `.dark-tool` | 113 | Dark 58px button used for DBG / Excel / CSV / Draft PO / links / Print |
| `.widget-tabs` / `.tab` / `.tab.active` | 131/140/151 | Tab strip; active = red `#c9402f` bottom border + text |
| `.summary-strip` / `.summary-cell` | 156/162 | 5-column KPI strip, `border-top: 5px solid currentColor` |
| `.summary-cell.purple/.blue/.red/.gold/.green` | 191-209 | `#9b5cc5`, `#1d5788`, `#c9402f`, `#a87407`, `#287d4d` |
| `.search-panel` / `.compact-search` | 226/232 | Search area; collapses when a report is loaded |
| `.search-row` | 237 | `grid-template-columns: minmax(220px,1fr) 160px auto` |
| `.field`, `.input`, `.select`, `.button` (+`.secondary`,`.dark`) | 243-287 | Form primitives, 44px min-height |
| `.message.error` / `.message.info` | 295/300 | `#fff1f0`/danger and `#eef8f5`/`#135a52` |
| `.connection` (+`.ok`,`.bad`) | 305/345/350 | Zoho connection strip; green/red tinted |
| `.orders-grid` / `.order-card` | 359/365 | `repeat(auto-fill, minmax(240px,1fr))` checkbox cards |
| `.bom-stage` | 415 | Report body, `padding: 0 44px 42px` |
| `.refresh-bar` | 426 | `1fr auto auto` grid: status / Auto toggle / Refresh Now |
| `.report-search` | 471 | Big 23px search input, `width:min(420px,100%)` |
| `.filter-pills` / `.pill` / `.pill.active` | 489/495/509 | Pill filters; active = black fill |
| `.change-orders` | 515 | "← Change Orders" outline button |
| `.bom-card` / `.bom-card-header` | 537/545 | Order card, black header |
| `.bom-group-bar` / `.group-dot` | 680/710 | Group header row; dot is `#c83d2d` |
| `.bom-table` | 718 | **`overflow-x:auto`** wrapper |
| `.bom-head` / `.bom-row` | 722 | 10-col grid, `min-width:1320px` (see §7) |
| `.type-chip` (+`.pack`,`.component`,`.sub`,`.plain`) | 819-851 | Row-type badges |
| `.stock-dot` (+ status modifiers) | 884-906 | 10px status dots |
| `.qty` (+`.avail`,`.deficit`,`.waste`) | 878/853/858/862 | Numeric cells |
| `.accessory-*` (panel, toolbar, tool, table, toggle, delete, empty…) | 931-1163 | Accessories Subform tab |
| `.width-badge` (+`.err`) | 1015/1027 | mm→m badge under the multi-select |
| `.qr-modal-backdrop` / `.qr-modal` / `.qr-item-*` | 1177-1278 | QR modal |
| `.packing-modal` / `.packing-download-btn` (+`.labels`) / `.packing-btn-row` / `.packing-order-list` | 1280-1404 | Packing list modal |
| `.qr-page` / `.qr-page-body` | 1406/1412 | `/qr/bom/[id]` page shell |
| `.empty` | 1419 | Centered muted placeholder, `padding:32px 18px` |

### 3.2 Builder system — inline `<style dangerouslySetInnerHTML>` at `CarcassBomBuilder.tsx:10631-11217`

A **completely separate, warm/paper-coloured token set**, scoped under `.builder-container` (`CarcassBomBuilder.tsx:10806-10824`):

```css
.builder-container {
  --paper:  #f4efe6;   --ink:    #1c1a17;
  --line:   #cdc4b4;   --line2:  #e2dacb;
  --accent: #c8521e;   /* burnt orange */
  --accent2:#1f5d6b;   /* teal-blue   */
  --good:   #3a6b35;   --warn:   #9a6b1a;   --purple: #7a4a8a;
  --panel:  #fbf8f2;
  --shadow: 0 1px 0 #fff inset, 0 2px 14px rgba(28,26,23,.08);
  background: radial-gradient(circle at 1px 1px, rgba(28,26,23,.05) 1px, transparent 0) 0 0/22px 22px, var(--paper);
  font-family: 'Spline Sans', system-ui, sans-serif;
  line-height: 1.45; padding: 20px; min-height: 100vh;
}
```

These `--accent`/`--line`/`--panel`/`--shadow` names **shadow the `:root` values from globals.css** inside `.builder-container`. The builder's `--accent` is orange, the dashboard's is teal.

Fonts referenced but **never loaded** (no `@font-face`, no Google Fonts link, no `next/font`): `'Spline Sans'`, `'Fraunces'` (serif headings/`.rc .big`), `'IBM Plex Mono'` (all mono UI). They silently fall back to `system-ui` / `serif` / the browser default monospace.

Builder classes (all in the 10631-11217 block):

| Class | Line | Purpose |
|---|---:|---|
| `.builder-header` | 10825 | 2px `--ink` bottom rule, flex, `align-items:flex-end` |
| `.builder-header h1` | 10835 | `'Fraunces'` 26px/600 |
| `.sub` | 10851 | Mono 11px uppercase, `letter-spacing:.14em`, `--accent2` |
| `.tag` | 10858 | Dark chip (e.g. `STONE · v21`) |
| `.nav-header-link` | 10841 | Mono 11px underlined `--accent2`, hover → `--accent` |
| `.grid` | 10867 | `grid-template-columns: 330px 1fr; gap:22px` → `1fr` under 820px (10872) |
| **`.card`** | 10875 | `background:var(--panel); border:1px solid var(--line); border-radius:6px; box-shadow:var(--shadow); padding:18px; margin-bottom:18px` |
| `.card h2` | 10883 | **Mono 11px, uppercase, `letter-spacing:.16em`, colour `--accent` (orange)** — this is the numbered section title style |
| `label` | 10892 | 12px/600, flex space-between; `label .hint` = mono 10px `#8a8275` |
| `select, input` | 10907 | Full width, mono 13px, `border-radius:4px`; `:focus` → `outline:2px solid var(--accent2)` |
| `.dims` | 10925 | `1fr 1fr 1fr` W/H/D grid |
| `.lockbtn` / `.lockbtn.on` | 10933/10943 | Thickness lock toggle; `.on` = orange fill |
| `.codebox` / `.lbl` / `.code` / `.copy` | 10948-10991 | Dark cabinet-code panel |
| `.code .s1…s5, .sd` | 10971-10976 | Per-segment colours: `#ff9d6e`, `#7fd1c4`, `#e7c46b`, `#9db8ff`, `#f1a0c0`, `#cfe6a0` |
| `.addrow` / `.addbtn` | 10992/11002 | Add-to-project row; `.addbtn` = `--accent2` fill, mono uppercase |
| `.meta` | 11019 | Mono 12px construction/unit line |
| `table` / `thead th` / `tbody td` | 11030-11050 | `font-size:12.5px`; th mono 10px uppercase with `1.5px solid var(--ink)` rule |
| **`.grp`** | 11057 | Pill chip: mono 9px, uppercase, white text, `border-radius:10px` |
| **`.g-panel`/`.g-hard`/`.g-cons`/`.g-prof`** | 11068-11071 | `--accent2` (teal-blue) / `#6b5b3a` (brown) / `--good` (green) / `--purple` |
| `.dim`, `.qty` | 11072-11077 | Mono; `.qty` is `white-space:nowrap` |
| `.tabs` / `.tab` / `.tab.on` / `.badge` | 11078-11108 | Builder tabs; `.on` = `--ink` fill; `.badge` = orange count pill |
| **`.rollup`** | 11109 | `repeat(auto-fit, minmax(150px, 1fr))` |
| **`.rc`** (+`.rt`,`.big`,`.small`) | 11114-11139 | Roll-up cards; `.big` = `'Fraunces'` 24px |
| `.rc.stone/.prof/.hard/.cons/.ops` | 11140-11144 | 3px left border: `--accent2` / `--purple` / `#6b5b3a` / `--good` / `--accent` |
| `.tn` / `.tn .op` / `.tn .pn` / `.tn .pr` / `.lvl2` | 11145-11157 | Explosion tree node; op=orange, panel=teal, profile=purple |
| **`.rm`** | 11158 | "remove" button: transparent, `--accent` text, mono 11px |
| **`.empty`** | 11168 | Mono 12px `#8a8275`, centered, `padding:24px` (**shadows** globals `.empty`) |
| **`.clr`** | 11175 | Small ghost button (`clear all`, `+ add row`, `Retry`, `CSV`, `copy csv`): mono 10px uppercase, 1px `--line` border |
| `.assume` | 11187 | Dashed-border logic/assumption note; `b` = `--warn` mono uppercase |
| `.builder-footer` | 11210 | Mono 10px centered `#9a9384` |
| `.finish-modal-*` | 10633-10723 | Create-New-Finish modal (backdrop blur 8px, `modalFadeIn`/`modalSlideUp`) |
| `.searchable-select-*` | 10726-10805 | `SearchableSelect` trigger/dropdown/search-box/options-list/option-item(.selected)/no-options |

> **Global leakage warning:** the builder's style block is *not* scoped — bare selectors `label`, `select, input`, `table`, `thead th`, `tbody td`, `.card`, `.tab`, `.empty`, `.badge`, `.qty` are emitted globally whenever the builder mounts. `.tab` and `.empty` collide by name with `globals.css`. Because the builder is only ever mounted on its own three routes, the collision is currently invisible, but any future shared layout will break.

### 3.3 Colour semantics (cross-app)

**Stock statuses** (`getStockStatus`, `src/lib/stock.ts:92-95`):
- `out-of-stock` when `effectiveStock <= 0 || effectiveStock < actualQty` → red `--danger #b42318`
- `low-stock` when `effectiveStock < actualQty * 1.5` → gold `--warning #b7791f`
- `in-stock` otherwise → green `--success #287d3c`
- `unknown` → grey `#8b8f92`

Labels come from `statusLabel()` (`stock.ts:107-109`): "In Stock" / "Low Stock" / "Out of Stock" / "Unknown". Rendered as `.stock-dot.<status>` + label (`BomOrderCard.tsx:108-110`).

**Summary strip semantics** mirror this: purple = Sales Orders (count, not a status), blue = Components (neutral total), **red = Out of Stock**, **gold = Low Stock**, **green = Fulfilled/In Stock** (`BomDashboard.tsx:1454-1475`).

**Row types** (`.bom-row` left inset shadow, `globals.css:755-786`) and `.type-chip` (`typeBadge`, `BomOrderCard.tsx:35-40`):

| rowType | Chip text | Chip colours | Row inset bar |
|---|---|---|---|
| `master` | `PACK BOM` | `#fff1dd` bg / `#ffb34e` border / `#e04f00` text | red `#c83d2d`, bg `#faf8f5` |
| `sub_bom` | `SUB-BOM` | `#eef4fb` / `#c0d5ec` / `#1a4a72` | blue `#1f527c`, bg `#f4f8fd`, italic name, `opacity .92` |
| `plain` | `ITEM` | `#f3f0fc` / `#c9b8f0` / `#5b3fa6` | purple `#5b3fa6`, bg `#f3f0fc` |
| `component` | `COMPONENT` | `#eeebe5` / `#d8d3c9` / `#756f66` | lv1 blue `#1f527c`; **lv2 gold `#b7791f`**; lv3/lv4 green `#287d4d` |

Deficit emphasis: `.bom-row.has-deficit .qty.deficit` → red `#b42318`, weight 800 (`globals.css:793-796`). Waste% is always gold (`.qty.waste`, `#b7791f`). Available stock is always green (`.qty.avail`, `#287d4d`).

**Group chips in the builder** (`.grp`, `CarcassBomBuilder.tsx:8953-8954`, and the same map at `9500-9501` for the expanded project line): the row's first tuple element maps label→class:
`panel→Panel/.g-panel`, `prof→Profile/.g-prof`, `hard→Hardware/.g-hard`, `cons→Consumable/.g-cons`, `shut→Shutter/.g-prof`, and (project-line view only) `elen_bom→Elenor/.g-prof`. Unknown keys fall back to `.g-panel`.

**Builder status tags** (`⑩ Stock Check`, `CarcassBomBuilder.tsx:10331-10339`): `checking` (orange text) / `unknown` (grey `#888`) / `in stock` (`var(--good)`) / `deficit N` (`var(--warn)`) — rendered as `.tag` with inline background overrides.

### 3.4 Icons / emoji / numbering convention

- **Section numbers are circled Unicode digits typed literally into the JSX**: `①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬`. They are content, not CSS counters — renumbering means editing every `<h2>`.
- **The numbering restarts per tab.** Packets/Raw tabs use ①–④; the Project & Totals tab uses ①–⑬ again. So "① Configure Unit" and "① Zoho Sales Order" both exist.
- Arrows/glyphs: `▣` doc icon (`BomOrderCard.tsx:49`), `↓` on Excel/CSV buttons, `↑ Update SO`, `←`/`↩` for back, `▾`/`▸` expand chevrons (`CarcassBomBuilder.tsx:9421`), `▼` SearchableSelect arrow, `↳` tree op marker, `×` row delete, `✕` close, `✓` success, `⚠` warning, `↻ Retry All`, `↗` external link.
- Tree drawing uses ASCII box glyphs built by `treePrefix()` (`BomOrderCard.tsx:27-33`): level *n* → `"│  "` × (n−1) + `"├─ "`, rendered in `.tree-mark` (35px, `#b8b1a6`).
- Emoji: `💬` / `✕` on the AI Copilot trigger (`AiCopilot.tsx:118`), `🔒`/`🔓` on the thickness lock (`CarcassBomBuilder.tsx:8860`) and the design lock (`8666`).
- The Auth logo is the letter **`M`** in a gradient rounded square (`AuthGate.tsx:54`, styled at `189-202`).

---

## 4. AuthGate — the global login screen

File: `src/components/AuthGate.tsx`. Wraps all children in `layout.tsx:15-18`.

**States**
1. `isAuthenticated === null` → `.auth-loading-screen`: full-viewport `#090a0f` with a 40px teal spinner (`auth-spin`, 1s linear infinite) — `AuthGate.tsx:37-43`.
2. `false` → the login card.
3. `true` → renders `{children}` (`352`).

**Login screen** (`45-350`): fixed-inset `#07080c` root at `z-index:99999`, two 500px blurred glow spheres — teal `#0f766e` top-left, violet `#8b5cf6` bottom-right, `filter:blur(120px); opacity:.15`. Glass card: `rgba(255,255,255,.02)` + `backdrop-filter:blur(20px)`, `border-radius:24px`, `width:min(460px,92vw)`, animation `auth-fade-in` 0.4s `cubic-bezier(.16,1,.3,1)`.

Contents: `M` logo → `<h1>Magppie Inventory</h1>` → copy "Enter the factory authorization password to access the BOM Backorder Dashboard." → label "SECURITY PASSWORD" (uppercase 12px) → `<input type="password" placeholder="••••••••" autoFocus required>` → error bubble → submit button → footer "© 2026 Magppie Living Pvt Ltd. All rights reserved."

**Behaviour**
- Submit sets `isLoading`, then a **hard-coded `setTimeout(…, 600)`** ("artificially delay slightly for a premium feedback transition", `26`) before comparing.
- Success → `localStorage.setItem("app_authenticated", "true")` (`28`). Persisted check on mount at `11-18`.
- Failure → `setError("Invalid access password. Please try again.")` and the `.auth-error-bubble` plays `auth-shake` 0.35s (`259-277`).
- Button shows `.auth-btn-spinner` while loading, else "Verify Authorization" + `→` arrow that translates 3px on hover.

> **SECURITY ISSUE (must be fixed).** The gate compares against a **hard-coded plaintext password literal inside `AuthGate.tsx` (line 27)**. Because `AuthGate` is a `"use client"` component, that literal is shipped in the JS bundle and is readable by anyone. There is no server-side check: every `/api/zoho/*` route is fully open — the gate is decoration only, and `localStorage.app_authenticated = "true"` typed into a console bypasses it. There is **no logout control anywhere in the app**.
> Remediation direction: move the secret to a server-only env var (e.g. `APP_ACCESS_PASSWORD` — should contain the shared factory password, never committed), verify it in a route handler, issue an httpOnly session cookie, and enforce it in middleware in front of `/api/zoho/*`.

---

## 5. `/` — BomDashboard

File: `src/components/BomDashboard.tsx` (2314 lines). Layout: `.app-shell > .widget-frame`.

### 5.1 Chrome (always visible)

1. **`.widget-title`** — `<h1>BOM Backorder Report</h1>` (`1409-1411`).
2. **`.widget-actionbar`** (`1413-1443`) — left: `BOM Backorder Report` + `{selectedOrderCount || 0} Sales Order · BOM Report`. Right, in order:
   - `DBG` — **permanently `disabled`** (dead control, `1419-1421`).
   - `↓ Excel` — `exportExcel()` → `exportBomWorkbook(filteredRows, buildAccessoryExportRows())`. Disabled when `!filteredRows.length`.
   - `↓ CSV` — `exportCsv()` → `exportBomCsv(filteredRows)`. Same disable rule.
   - `+ Draft PO from SO` — opens `DraftPoModal`.
   - `Re-order Report` — `<a href="/reorder">` styled as a `.dark-tool`.
   - `Carcass Builder` — `<a href="/builder">`.
   - `Print` — `window.print()`.
3. **`.widget-tabs`** (`1445-1452`) — two tabs: **BOM Report** (`activeTab="bom"`) and **Accessories Subform** (`"accessories"`).
4. **`.summary-strip`** (`1454-1475`, `aria-label="BOM report summary"`) — 5 cells:
   | Cell | Value | Class |
   |---|---|---|
   | Sales Orders | `selectedOrderCount \|\| 0` | `purple` |
   | Components | `stats.total` | `blue` |
   | Out of Stock | `stats.outOfStock` | `red` |
   | Low Stock | `stats.lowStock` | `gold` |
   | Fulfilled | `stats.inStock` | `green` |

   `stats` (`736-744`) counts only rows where `rowType === "component" || "plain"`. `selectedOrderCount = showingReport ? loadedOrders.length : selectedOrderIds.length` (`1404`).

### 5.2 Connection strip

`.connection` (`1479-1496`), always shown. Class `ok` / `bad` / `""`. Text: "Checking Zoho Inventory..." → "Live Zoho Inventory connected" (+ `Org name (orgId)`) or "Zoho Inventory not connected" (+ error). Right side: `Auto refresh: 10 min · Next <time>` or `Auto refresh: off`, then a **Check** button hitting `/api/zoho/status` (`650-664`).

### 5.3 Search → select → load flow

```
[type ≥2 chars] ──Enter/Search Orders──▶ GET /api/zoho/salesorders?q=&status=
        │                                        │
        │                            .orders-grid of checkbox .order-card
        │                                        │
        │                          [Load Selected (n)]  ─┐
        │                                               ▼
        │              GET /api/zoho/salesorders/:id  ×n  →  resolveRawMaterials()
        │                                               │
        │             stoneGroups/profileGroups empty ──┴── non-empty
        │                        │                            │
        │                        ▼                            ▼
        │             fetchReportForOrderIds()      ┌─ Raw Material Selection modal ─┐
        │                        │                  │  toggle / pick / actual pcs    │
        │                        │                  │  [Cancel]  [Confirm & Load BOM]│
        │                        │                  └───────────┬────────────────────┘
        │                        │       applyStoneChange / applyProfileChange per group
        │                        ▼                              ▼
        └──────────────── report renders (search-panel gets .compact-search) ────────┘
```

Details:
- Search row hidden entirely once `showingReport` (`1498`). Fields: **`#order-query`** (`minLength=2`, placeholder `Example: SO-00011 or customer name`, Enter submits when `query.trim().length >= 2`), **`#order-status`** select with `All statuses / draft / confirmed / sent / void` (`1516-1522`), **Search Orders** button (`.button.dark`, disabled while `busy || query.trim().length < 2`; label flips to "Searching...").
- `searchOrders()` (`815-834`) clears rows/loadedOrders/selection first; sets message "Select one or more orders, then load the BOM report." or "No sales orders found."
- `.order-card` is a `<label>` wrapping a checkbox + `<strong>{salesorder_number}</strong>`, customer name, status (`1536-1549`). Toggle via `toggleOrder()` (`836-840`).
- `Load Selected (n)` (`1551-1553`) — disabled when `busy || !selectedOrderIds.length`; label → "Loading BOM...". Interim message "Resolving raw materials..." (`888`).
- **Fallback:** if none of the SO detail fetches succeed, it logs a warning and loads the BOM directly, skipping the raw-material modal (`878-883`).

### 5.4 Report controls (`activeTab === "bom" && showingReport`)

- **`.refresh-bar`** (`1562-1581`): headline "Auto refresh every 10 minutes" / "Refreshing live Zoho data..."; sub-line "Last updated <t> · Next <t>" or "Refresh starts after loading orders"; **Auto** checkbox (`autoRefreshEnabled`, default `true`); **Refresh Now** (`.refresh-now`, disabled while refreshing). Interval is `10 * 60 * 1000` ms (`692-712`) — refreshes the loaded report, or re-checks the connection when nothing is loaded.
- **`.report-search`** (`1582-1587`): placeholder "Search name, SKU...". Filters on `itemName, sku, groupName, sourceOrderNumber, customerName, cfType` joined and lowercased (`714-729`).
- **`.filter-pills`** (`1589-1611`, `aria-label="Stock filters"`): **All / Out of Stock / Low Stock / In Stock**. Master rows always survive the status filter (`row.rowType === "master" ||` in `718-721`).
- **`← Change Orders`** (`1612-1621`): clears `rows`, `loadedOrders`, resets `stockFilter` to `all` → returns to the search screen.
- **`.component-count`**: "<n> components" for the filtered set (`1623-1625`).

### 5.5 Order cards

`rowsByOrder` (`746-753`) buckets `filteredRows` per loaded order and drops empty ones. Each renders `<BomOrderCard order rows headerActions>` (`1629-1703`).

`BomOrderCard` structure:
- `.bom-card-header`: `▣` + SO number + `headerActions` + customer name; right = `<time>{order.date ?? "—"}</time>`.
- Groups via `groupRowsByMasterGroup()` (`BomOrderCard.tsx:12-25`): bucket key = `row.masterGroup || row.cfGroup || "__other__"`, sorted `localeCompare` with `__other__` forced last; label from `groupLabel()` (identity, "Other" for `__other__`).
- `.bom-group-bar`: red dot + group label + "<n> components" where n counts `component` + `plain` rows.
- `.bom-table` (overflow-x) with a 10-column `.bom-head`: **Item / Component · SKU · Type · SO Qty · Waste% · Actual Qty · Eff. Stock · Deficit · Status · Unit**.
- Row cells (`BomOrderCard.tsx:90-113`): tree prefix + bold name; SKU or `-`; type chip; `quantityNeeded`; waste `N%` only for component/plain with `wastePercent > 0` else `—`; `actualQuantity.toFixed(2)` with trailing zeros stripped via `.replace(/\.?0+$/, "")`; Eff. Stock `—` for master rows; deficit rendered as `-N` when `> 0`; status dot + label (`—` for master); unit.

`headerActions` (`.so-qr-actions`) contains three controls:
1. **BOM QR** group — 44px preview `<img>` (or `.so-qr-placeholder`) + `View` / `Download`.
2. **User QR** group — same.
3. **Packing List** button (`.packing-list-button`) — presets group to `getPackingGroups()[0]` (= `"Carcass"`), selects only this order, opens the packing modal (`1688-1699`).

QR previews for every visible order are generated eagerly in an effect (`762-791`) and cached in `qrPreviewUrls`.

### 5.6 QR modals

`handleQrAction(kind, action, order, orderRows)` (`1367-1400`); busy key format `` `${action}-${kind}-${order.salesorder_id}` `` disables just that button.

**Payloads** (`buildQrPayload`, `1328-1356`):
- `kind="bom"` → plain text:
  ```
  SO: <salesorder_number>
  Cust: <customer_name>
  Date: <date|->
  <blank line>
  - <itemName> x<actualQuantity>      ← one line per component/plain leaf
  ```
- `kind="user"` → `JSON.stringify({ type:"USER_DETAILS", salesOrder, salesOrderId, customerId, customerName, email, date, status, referenceNumber, salesperson, billingAddress, shippingAddress, contactPersons })`.

QR options (`createQrImage`, `1358-1365`): `errorCorrectionLevel:"L"`, `margin:2`, `scale:8`, dark `#171714` on `#ffffff`.

**Download filename:** `` `${order.salesorder_number}-${kind === "bom" ? "bom-items" : "user-details"}-qr.png` ``.

**View** opens `.qr-modal` (`1987-2029`): backdrop click closes; inner click `stopPropagation`; `role="dialog" aria-modal="true"`. Header = "BOM Items QR Code" / "User Details QR Code" + subtitle `SO · customer` + Close. Then the QR `<img>` (max 280px). For `kind === "bom"` only, a `.qr-item-list` table follows with columns **Item / Component · SKU · Type · SO Qty · Actual Qty** (non-master names prefixed `"- "`). Footer: **Download QR**.

> Note: the payload embeds every leaf line, so large BOMs can exceed CODE/QR capacity; `createQrImage` will reject and the error surfaces via `setError` (`1395-1397`). The label PDF QR wraps the same risk in a silent `try/catch` (`537-538`).

### 5.7 Packing-list modal

`.packing-modal` (`2030-2094`). Title "Packing List & Labels", subtitle "<n> order(s) selected".
- **Select Orders** checkbox list (`.packing-order-list`) — rendered **only when `loadedOrders.length > 1`** (`2041`).
- **Select Group** `<select id="packing-group-select">` — options are hard-coded `["Carcass", "Shutter", "Both"]` (`getPackingGroups`, `150-152`; the `orderRows` arg is ignored).
- **`.packing-btn-row`** (2 columns): **Download Packing List** (dark) and **Print Labels** (`.labels`, outlined). Both disabled when `!packingGroup || !packingSelectedOrderIds.length`.

Filenames (`1117-1127`): `<SO>-<Group>-packing-list.xls` and `<SO>-<Group>-labels.pdf`, both passed through `sanitizeFilename()` (`146-148`: non-alnum → `-`, collapse, trim).

Packing list is an **HTML table served with the `application/vnd.ms-excel` MIME type** (`buildPackingListHtml`, `372-507`; Times New Roman, black 1px borders). Header block: title `<GROUP> PACKING LIST`, `MAGPPIE LIVING PRIVATE LIMITED`, `PLOT NO- 68, SECTOR- 03, IMT MANESAR GURUGRAM, HARYANA-122050`, then `MRP NO / COMPLAINT NO`, `DATE`, `CUSTOMER NAME`, `PRODUCT : KITCHEN`, `DESTINATION`, `VEHICLE NO`, `PAPER PERSON`, `CONTACT NUMBER`. Main table columns: `S.NO. · ITEM NAME - <GROUP> · ITEM COLOR · PACK · PCS · BOX · BOX DIMENSION ( L x W x H )`. Master groups get a shaded `A.` / `B.` … letter row (`alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"`). Pack labels are literally `PACK - <n>`. A second `HARDWARE PACK & OTHER ITEMS` section is appended when hardware rows exist, with `rowspan`-merged PACK/BOX cells.

Label PDF (`buildLabelsPdf`, `520-610`): jsPDF landscape, **150 × 100 mm** per label, one page per box. Contains MAGPPIE wordmark, product name (right, wrapped to 80mm), From/To blocks split by a vertical rule at `W/2`, a CODE128 barcode of the SKU (`JsBarcode`, `width:3, height:80, fontSize:16, margin:4`, `509-518`), a QR of `` `${salesorder_number}\n${customer_name}` ``, then `Box i of N`, `Box b of B | P pcs`, `Finish:`, `Dim:`, SO number and SKU.

Packing maths worth knowing when touching the UI: `consolidatePackingRows` (`262-325`) merges hardware/glue rows by name, treats "glue silicone" as **270 units per piece**, and doubles `pcsPerBox` for "set" items (`isSetItem`, `233-242`). `calcBoxDimension` (`244-253`) adds **20mm padding** to W and H and uses `t*2 + 20` for sets, `t + 20` otherwise.

### 5.8 Raw Material Selection modal

Rendered as `.packing-modal` with `maxWidth:700` inside a `.qr-modal-backdrop` (`2097-2306`). Title "Raw Material Selection" / "Select stone and profile raw materials before loading BOM". Body scrolls at `maxHeight:70vh`.

Structure: two category sections rendered in order **Shutter**, then **Carcass** (`renderCategorySection`, `2115-2272`), each with a `Stone Selection` and a `Profile Selection` subheading (uppercase 13px, `letter-spacing:.05em`).

Per **stone** group card (`#f9fafb`, 8px radius, `#e5e7eb` border):
- Left: `<finish> — <thickness>mm` + `Total: N sqft (incl. waste)`.
- Right: **Change stone** checkbox. When the default stone could not be found, `group.changed` arrives `true` and the checkbox is `disabled`, label becomes **"Change stone (required)"** — the user *must* pick a replacement (`2143-2148`, guard at `1002`).
- Unchecked → grey box "**Default:** `<name>` (`<sku>`)". Checked → "Loading items..." then a `<select>` "Select stone..." listing `name (sku)`.
- **Pieces panel** (`2181-2208`), only when the active slab area > 0: `Slab Area: N sqft` · `Calculated Pcs: N pcs` · **Actual Pcs** number input (`step=.01`) that overrides via `customPcs`. Selecting a different stone resets `customPcs` to `undefined` (`1044`).

Per **profile** group card: `<profileCode> — <finish>` + `Size: Nmm | Total: N mm (incl. waste)`; **Change profile** checkbox; default box or "Select profile..." dropdown.

Empty state: "No raw materials found to configure."

Footer: **Cancel** (`.btn`) and **Confirm & Load BOM** (`.btn .btn-primary`) — the latter disabled while `rawMatLoading` or while any group has `changed && !newStoneId` / `changed && !newProfileId` (`2299`). During apply, `message` narrates: "Cloning BOM tree with new stone: X…" / "Applying default stone: X to all panels…" / "Cloning BOM tree with new profile: X…".

> `.btn` and `.btn-primary` **are not defined in `globals.css`** — these two footer buttons render with the browser's default button styling. Real bug, visible in the UI.

Slab-sqft fallback in the dropdown mapper (`902-911`, duplicated at `1008-1017`): `cf_sqft`, else `(cf_height * cf_width) / (304.8 * 304.8)`, rounded to 2 dp.

### 5.9 Accessories Subform tab

`.accessory-panel` (`1707-1980`), shown when `showingReport && activeTab === "accessories"`.

**Toolbar** (`1708-1729`): title **Accessories Subform** + helper "Select Carcass items (combined width ≤ 3000mm), toggle accessories, then update existing SOs."; optional `.update-status` chip (`info`/`ok`/`err`); buttons **Add Row**, **Save** (disabled when empty), **↑ Update SO** (`.accessory-tool.update-so`, orange `#e07020`; label → "Updating...").

**Table** (`.accessory-table`, `min-width:1160px` inside `.accessory-table-wrap` overflow-x). Columns: `(#) · SO · Carcass Items · Accessory · Size · Elevation · Total (m) · Actual Qty · (delete)`.

Row rendering uses `rowSpan` on the first 4 and last cell; each enabled accessory produces its own sub-row (`.accessory-sub-row`, dashed top border). With none enabled, one placeholder row shows `-` in Size/Elevation/Actual Qty.

Controls per row:
- **SO** `<select>` — "Select SO" + all `loadedOrders`. Changing it **resets** `itemIds` and all accessory entries (`1770-1775`).
- **Carcass Items** — `<select multiple className="accessory-items-select">` (min-height 118px) listing `getCarcassItemsForOrder(soId)` = master rows whose `cfGroup` or `masterGroup` contains "carcass" (`1179-1185`), labelled `<itemName> (<cfWidth>mm)`. On change it sums `cfWidth`; **if > 3000 it aborts the selection and sets the page error "Combined width exceeds 3000mm."** (`1798-1801`). Accessories no longer applicable are auto-disabled (`1804-1814`).
- Below the multiselect: `.width-badge` → `<mm>mm → <m>m` (+ ` ⚠ >3000` and `.err` red styling when over), or `.accessory-help` → "<n> carcass items available" / "No carcass items in this SO". Before an SO is picked: `.accessory-muted` "Select SO first".
- **Accessory** — `.accessory-toggle-list` of checkboxes; `.yes` (green) when enabled, `.blocked` (grey, `cursor:not-allowed`) when the same accessory is already used for an overlapping item in another row (`isAccessoryUsedForItems`, `1170-1177`), with `title="Already assigned to one of the selected items"`. Enabling a profile accessory disables its siblings (mutual exclusion, `1862-1869`). Enabling seeds `actualQty` from the row total when it is still `null` (`1874-1877`).
- **Size**, **Elevation** — free text `.accessory-input`.
- **Total (m)** — read-only `.accessory-number` = `getRowTotalMeters()` = `widthMm / 1000` to 3 dp (`1194-1197`).
- **Actual Qty** — `type="number" step="0.001"`, `""` → `null`.
- **Delete** — `.accessory-delete` `×`.

**Accessory catalogue** (`ACCESSORY_ITEMS`, `77-105`) — visibility rules via `getApplicableAccessories` (`1199-1205`); with no items selected **all** accessories show:

| key | Label | Zoho item_id | Condition (on `cfSubGroup \|\| cfGroup`, `cfType`) |
|---|---|---|---|
| `skirting` | Skirting with light | `3418412000001249001` | subgroup contains `base` or `tall` |
| `duplay` | Duplay Profile Light | `3418412000001249010` | subgroup contains `wall` **and** type does not contain `dishrack` / `dish rack` |
| `lprofile` | L Profile Dado Light | `3418412000001249037` | subgroup contains `wall` |
| `jhandle` | J type handle | `3418412000001249019` | always |
| `chandle` | C type handle | `3418412000001249028` | always |

`PROFILE_KEYS = ["skirting","duplay","lprofile"]` is the mutual-exclusion group (`107-112`).

**Empty state:** `.accessory-empty` "Add a row to start the Accessories Subform." (colSpan 9).

**Persistence:** `Save` writes `localStorage["bom_accessory_subform_rows"]` + `["bom_accessory_subform_counter"]` and shows "Accessories Subform saved locally." (`1207-1211`); restored on mount (`670-690`).

**↑ Update SO** (`1242-1326`): groups rows by SO, re-fetches each SO, and `PUT`s `line_items = [...existing, ...new]` where each new line is `{ item_id, name: <accessory label>, description: "Elev: X | Size: Y | For: <carcass names>", quantity }`. Progress: "Preparing updates..." → "Updating <SO>..." → "✓ Updated N SOs." Guard message when nothing is toggled: "No accessories selected. Toggle at least one accessory to Yes."

**Excel export mapping** (`buildAccessoryExportRows`, `1213-1240`): sheet columns `SO, Carcass Items, Accessory, Selected("Yes"), Item Name, Size, Elevation, Total, Actual Qty, Zoho Item ID`; **Item Name** is built as `` `${accessory.label} ${elevation} ${size}` `` (blanks dropped, joined by a space).

### 5.10 Draft PO modal

`DraftPoModal` (`src/components/DraftPoModal.tsx`), 100% inline styles, `zIndex:100`, `width:min(960px,95vw)`, `maxHeight:90vh`. Header "Create Draft PO from Sales Order" + Close.

Five steps (`Step` type, `7`):
1. **`search`** — copy "Search for a sales order (min 2 chars), then pick one."; text input (Enter submits) + Search button (disabled `searching || query.trim().length < 2`). Results list (`maxHeight:380`) rows: `**SO-num** · customer` on the left, `date · status` grey on the right; clicking a row goes to step 2. Empty: "No results yet."
2. **`loading`** — "Resolving items & composite components, computing stock…"
3. **`items`** — headline "<n> out-of-stock item(s) found in this SO (including items under composites). Preferred vendor is pre-selected from the most recent purchase order for each item — change if needed." Green box "No out-of-stock items — nothing to purchase." when empty. Table columns: **✓ · Item · Needed · Stock · Deficit · PO Qty · Rate · Vendor (preferred from latest PO)**. Item cell shows name + grey `sku · cfGroup`. PO Qty seeds to `Math.ceil(mergedDeficit)` (duplicates merged by `itemId`, deficits summed, `94-108`). Vendor `<select>` has `— pick vendor —`, an **optgroup "From purchase history"** (`name · last <date> · ₹<rate>`) and an **optgroup "All vendors"**; picking a history vendor copies `last_rate` into Rate. While loading: grey "loading…". Footer: **Back** and **Create Draft PO(s)** (blue `#1f5be8`, disabled unless some line has `include && selectedVendorId`).
4. **`creating`** — "Creating draft purchase order(s)…"
5. **`done`** — "Draft PO(s) created" + `<ul>` of `PO-number ↗` (linked to `web_url` when present) `· vendor_name`, plus a **Done** button.

Lines are grouped by vendor into one PO each; notes are `` `Draft PO auto-generated from SO #<number>` `` (`178`). Vendor list preloads from `/api/zoho/contacts?contact_type=vendor` (non-fatal on failure, `48-65`).

---

## 6. `/builder`, `/designer`, `/planning` — CarcassBomBuilder

One component, three modes (`CarcassBomBuilder.tsx:5567`):

| Page | `soMode` | `planningMode` | `canDesignerUpload` (`5914`) |
|---|---|---|---|
| `/builder` | `false` | `false` | `false` |
| `/designer` | `true` | `false` | **`true`** |
| `/planning` | `true` | `true` | `false` |

### 6.1 Header (`8523-8558`)

- `.sub` eyebrow, mode-dependent (`8525-8531`):
  - planning → `Planning · Upload cabinet codes / Sales Order → choose shutter colour → BoM`
  - designer → `Designer · Sales Order → cabinet codes fetched → Raw BoM → Project Totals`
  - builder → `Kitchen Carcass · Code → Packets → Raw BoM → Project Totals`
- `<h1>` (`8532`): `Planning → BoM` / `Sales Order → BoM (Designer)` / `Carcass Code & BoM Builder`.
- Right: five `.nav-header-link`s (**BOM Dashboard, Re-order Report, Builder, Designer, Planning**), then two `.addbtn`s — **Export All Combinations (.xlsx)** (title: "Download an Excel of every possible carcass combination (15mm, finish = ANY)") and **Export All Shutter Codes (.xlsx)** — then the `.tag` **`STONE · v21`**.

### 6.2 Layout

`.grid` = `330px 1fr` (`10867`), collapsed to a single column when `soMode` via an inline override (`8560`) and to `1fr` under 820px via media query (`10872-10874`). The left column (the Configure card) is `display:none` in `soMode`; likewise `.codebox`, `.addrow`, `.meta` and the first two tabs (`8868, 8902, 8927, 8933-8934`).

### 6.3 ① Configure Unit (`8563-8862`) — left column, `/builder` only

`.card` with `<h2>① Configure Unit</h2>`. Every dropdown is a `SearchableSelect` (click to open → autofocused filter box → filtered `.option-item` list → "No matches found" when empty; closes on outside mousedown). Controls in DOM order:

| # | Label (hint) | Control | Options | Conditional |
|---|---|---|---|---|
| 1 | Zone `P1` | SearchableSelect | 14 `ZONES` (`634-649`): BC Base, BCL Base — Low Depth, BB Base Blind, BBL Base Blind — Low Depth, WC Wall, WB Wall Blind, TC Tall, TB Tall Blind, TCL Tall — Low Depth, LO Loft, LB Loft Blind, LBF Loft Blind — Full Depth, LOF Loft — Full Depth, MD Mid Rolling Shutter | always |
| 2 | Cabinet Family `P2` | SearchableSelect | `currentFams` from `famSetOf(zone)` (`651-683`) | always |
| 3 | Configuration `P3·P4` | SearchableSelect | `currentFam.variants`; **double-door variants filtered out for blind zones** (`7133-7143`) | always |
| 4 | Drawer Model | SearchableSelect | Lian, Hettich, Blum, Hafele, Grass (`7150-7156`) | `hasDrawers` |
| 5 | Tip-On (`push-to-open`) | SearchableSelect | 2 BLUM codes (`TIPON_OPTIONS`, `696-699`) | `ZONES[zone]?.kind === "loft"` |
| 6 | Inbuilt Drawers | SearchableSelect | `None`, `2HB + 1BL` | `hasInbuiltDrawerOption` |
| 7 | Hand (`active side`) | SearchableSelect | `LHS — active Left`, `RHS — active Right` | `currentVariant?.handed && !(activeFamilyKey === "BPO" && finalW > 150)` |
| 8 | Handle / Profile (`P5`, or `set by <design>` when locked) | SearchableSelect | `XCJ — CJ / Gola` (base zones only) + `STD — Standard` (`7158-7165`) | always; `disabled={handleLockedByDesign}` = base zone && design ∈ `XCJ_DESIGNS`/`STD_DESIGNS` (`7075`) |
| 9 | Shutter Profile Design | SearchableSelect + optional lock button | `designsList` | disabled when `designsList.length === 0 \|\| designLocked` |
| 10 | Carcass Finish + `+` | SearchableSelect | `finishesMap[String(thickness)]` (`5667-5669`) | always |
| 11 | Carcass Profile Finish | SearchableSelect | union of `profile_finishes.json` for codes `["STP","ELEN"]`, sorted (`5677-5684`) | always |
| 12a | Glass Shutter Color | SearchableSelect | `GLASS_COLORS` — 12 values incl. BROWN TINTED, EXTRA CLEAR, CLEAR MIRROR, BROWN FLUTED… (`4673-4677`) | `designsList.length > 0 && isGlassShutterSelected` |
| 12b | Fixed Panel Finish (Stone) + `+` | SearchableSelect | `finishesMap["6"]` | `isBlindGlassSelected` = glass family **and** `ZONES[zone].blind` (`7051`) |
| 12c | Shutter Finish + `+` | SearchableSelect | `finishesMap["6"]` (`5671-5675`) | `designsList.length > 0 && !isGlassShutterSelected` |
| 13 | Shutter Profile Finish | SearchableSelect | finishes for codes parsed out of `design` via `/(MD\d\|CM\d\|CL\d\|NEON\d*)/g` (`5686-5700`) | `designsList.length > 0` |
| 14 | Dimensions (mm) `W × H × D` | `.dims` — 3 SearchableSelects | `standardSizes.w/.h/.d` + `Custom…`; **double-door variants only get widths > 600**; **DW/HO + `3dr` drops 450** (`7171-7193`) | always |
| 14b | custom W / H / D | `<input class="dimCustom" type="number" step="10">` | placeholders `custom W` / `custom H` / `custom D` | only when the matching select === `"custom"` |
| 15 | Thickness (mm) + lock | `<input type="number" min=5 max=40 step=1>` | — | `disabled={tLocked}` |

**Lock buttons**
- **Design lock** (`8651-8668`): only rendered when `isGlassShutterSelected`. `designLocked = isGlassShutterSelected && !designUnlocked` (`7048`). Shows `🔒 unlock` (cream `#fff7e0` / `#8a6d00`, title "Locked to NEON20 — click to unlock and change") or `🔓 lock` (green `#e7f5e7` / `#256029`, title "Unlocked — click to re-lock to NEON20").
- **Thickness lock** (`.lockbtn`, `8853-8860`): `🔒 locked` (default) / `🔓 unlocked` (`.on`, orange). **Re-locking force-resets thickness to `15`.**

**"+ Add New Finish" modal** (`10581-10628`) — triggered from the `+` next to Carcass Finish (`finishModalTarget="carcass"`, seeds thickness = current) or Shutter/Fixed-Panel Finish (`target="shutter"`, seeds thickness `"6"`). Title "Create New Finish"; fields **Finish Name** (`placeholder="e.g. EMERALD GOLD"`, required, autoFocus) and **Thickness (mm)** SearchableSelect over `["5","6","7","9","12","15","16","20"]` rendered `"<t> mm"` (`7195-7197`). `.finish-modal-error` (red) / `.finish-modal-success` "✓ Saved & Selected!". Buttons **Cancel** / **Save Finish** (label → "Saving..."), both disabled while `isSavingFinish || finishSuccess`. Backdrop: `rgba(28,26,23,.4)` + `blur(8px)`, `z-index:1000`, `modalFadeIn` 0.2s + `modalSlideUp` 0.25s.

### 6.4 Output column, above the tabs (all hidden in `soMode`)

- **`.codebox`** (`8868-8899`) — label "CABINET CODE", the code rendered segment-by-segment. The cabinet code is built at `CarcassBomBuilder.tsx:1642` (and its siblings `1814`, `1877`, `1976`, `2107`) as:
  ```
  [P1 zone]-[P2 family]-[handleToken]-[matToken]-[P3]-[P4]-[P5]-[W]-[H]-[D]-[t]   +  ("-" + MAT  when MAT && MAT !== "(none)")
  ```
  The renderer (`8871-8894`) strips the trailing `-<matSuffix>` (where `matSuffix = carcassMat` when carcass===shutter or shutter is empty, else `` `${carcassMat}-${shutterMat}` ``), splits on `-`, and colour-codes positions with `["s1","s2","s3","s4","s5","sd","sd","sd","sd"]`, joining with grey `#6a6256` hyphens. The finish is re-appended in `.s3` as `<carcassMat>` or `<carcassMat>/<shutterMat>` when shutters exist and the finishes differ. **Copy** button (`.copy`) flips to "Copied".
  Shutter codes use a different shape (`1093`, `1115`, `1135`, `1158`, `1183`), e.g.
  `SH-${handleSeg}-${matSeg}-${zp}SH-${W}x${HE}-${loc}-${dw}-${h}-${frame}-${shThk}-${design}`.
- **`.addrow`** (`8902-8925`) — **Elevation** `<select>` (required; first option `Elevation *`; `ELEVATION_OPTIONS = AA BB CC DD EE FF GG HH II JJ KK`, `301`). Its border turns red `#c0392b` while empty. Then **Qty** number input (min 1) and **+ Add to Project** (`.addbtn`, `disabled={!elevation}`, title "Select an Elevation first" / "Add to Project").
- **`.meta`** (`8927-8930`) — `Construction: <Full Sides (wall-hung) | Full Top/Bottom>` and `Unit: <family> · <variant> (<hand>)`.

### 6.5 The three tabs (`.tabs`, `8932-8936`)

| Tab | key | Label | Visible on |
|---|---|---|---|
| 1 | `pk` | **Packets** | `/builder` only |
| 2 | `raw` | **Raw BoM (this unit)** | `/builder` only |
| 3 | `proj` | **Project & Totals** (`/builder`) / **Sales Order → BoM** (`soMode`) + `.badge` showing `project.reduce((a,l)=>a+l.qty,0)` | all three |

#### Tab 1 — Packets → **② Carcass Packets** (`8940-8969`)
`.card` + `<table>`: **Packet · Dimensions · Qty (right) · UoM**. Packet cell = `.grp` chip (`§3.3`) + `.pk` name. Rows come from `model.pkRows` tuples `[group, name, dims, qty, uom]`.

#### Tab 2 — Raw BoM (`8973-9117`)

**③ Raw Roll-up — this unit** (`8975-9028`) — `.rollup` of `.rc` cards:

| Card | Big value | Small text |
|---|---|---|
| `.rc.stone` **Stone** | `purSqft.toFixed(2)` sqft | `<n> panels · net <netSqft> +15%` / `weight ≈ <wt> kg` |
| `.rc.prof` **Profiles** | `purProf.toFixed(2)` m | `net <netProf> +20%` (+ `(none)` when 0) |
| `.rc.hard` **Hardware** | `model.hardware.length` | one line per hardware name |
| `.rc.cons` **Consumables** | `glueLine.qty` ml | `assembly glue`, `stepper silicone <n> kg`, extra consumables |
| `.rc.ops` **Operations** | `<cut>+<drill>` | `<n> cutting · <n> drilling` |
| `.rc.stone` **Shutter Stone (6mm)** | `unitShStoneP` sqft | `<n> shutter(s) · net <n> +15%` / `weight ≈ <n> kg @1.38` — **only when `model.shutters.length > 0`** |
| `.rc.prof` **Shutter Profiles** | `unitShProfP` m | `design <design> · +20%` / `corner sets <n>` — same condition |

**④ Full Explosion** (`9033-9115`) — a `<details>`/`<summary>` accordion per tree group. Inside `.tree`: level-2 `.tn` rows (`.pn` teal for parts — bold — / `.pr` purple for panels & profiles) with `×qty`; level-3 `.lvl2` children showing `↳ Drilling-1 (<drill>)` and `↳ Cutting-1` with `N sqft ea` or `N mm ea`; silicone rows in `--good`.

Below it, the `.assume` **Logic** box (`9106-9114`) states verbatim:
- `Stone area W×H÷92903 sqft +15%; weight net sqft×3.45 kg.`
- `Thickness <locked 15 | UNLOCKED n> mm → 2×t reductions.`
- `Profiles +20%. Stepper (STP)=2×W+2×H; stepper silicone separate.`
- `BT-LEG=1 bottom panel. CJ top −23. No edge-banding.`

Backing constants (`431-438`): `STEP=2`, `CJ_CUT=23`, `SHELF_OFF=40`, `SQDIV=92903.04`, `STONE_WASTE=0.15`, `PROFILE_WASTE=0.20`, `ELENOR_WASTE=0.10`, `KG_SQFT=3.45`, `SH_KGSQFT=1.38` (`775`).

#### Tab 3 — Project & Totals / Sales Order → BoM (`9120-9576`)

**① Zoho Sales Order** (`9124-9232`) — rendered when **`!canDesignerUpload`**, i.e. on `/builder` and `/planning`, hidden on `/designer`.
- **Search Sales Order** text input, `placeholder="Type SO-00001 or Customer..."`; typing clears the current selection.
- **Add to Zoho Sales Order** `.addbtn` — disabled (and dimmed to `opacity:.6`, `cursor:not-allowed`) unless `selectedSo && !zohoLoading`; label → "Processing...".
- `soSearchError` → red `⚠ <msg>`.
- `.so-dropdown` — absolutely positioned (`z-index:10`, `maxHeight:150px`, `width:calc(100% - 36px)`, `left:18px`), shown while `salesOrders.length > 0 && !selectedSo`; rows `**SO-num** — customer`, hover background `var(--line)`.
- Selected banner: `Selected: <SO> · Customer: <name> · Status: <.tag>`.
- `zohoMessage` panel: red `#fde8e8`/`#f8b4b4`/`#9b1c1c` when it starts with `"Error"`, else neutral; `white-space:pre-wrap`.

**① Upload Cabinet Codes (.xls)** (`9235-9291`) — rendered when **`canDesignerUpload`** (i.e. `/designer` only).
- `<label class="addbtn">Choose Excel…</label>` hiding `<input type="file" accept=".xls,.xlsx">`; the input value is cleared after each pick so the same file can be re-uploaded.
- Copy: "Upload the planning **Shutter** sheet. Cabinets load into Project Lines; pick the shutter colour per line (filtered by its price group) or in bulk below."
- `uploadMsg` turns red `#c0392b` when it contains "could not" or "no valid", else `var(--accent)`.
- **Bulk colour bar**, only when `project.some(l => l.priceGroup)`: **Zone** (`All / Base / Wall / Tall / Loft / Mid`) → **Price Group** (`All` + `pgsForZone(bulkZone)`, `5938-5943`) → **Colour** (`coloursForPriceGroup(bulkPG)` or `allPgColours` when PG = all; `5916-5921`) → **Apply to filtered** (`.addbtn`, disabled until a colour is picked). Changing Zone resets PG to `all` and clears Colour; changing PG clears Colour.

> Naming quirk to keep in mind: `/planning` shows the **Zoho SO search**, while `/designer` shows the **Excel upload** — the inverse of what the page names and the `designer/page.tsx` comment suggest.

**② Consolidated Totals — combined** (`9296-9354`) and **③ Stone — per finish** (`9357-9382`) — both wrapped in `{project.length > 0 && (…)}`.

② is a `.rollup` mirroring ③-of-tab-2 but aggregated: Stone (all finishes) `netSqft*1.15`; Profiles `Σ profAgg * 1.2` with a per-code breakdown `CODE: N m`; Hardware `Σ hardAgg` with `N × name` lines; Consumables `glue` ml + `stepper silicone N kg` + extras; Operations `cut+drill`; and — when `aggregates.shSqft > 0` — Shutter Stone (6mm) (`*1.15`, weight `* SH_KGSQFT`, `<n> corner sets`) and Shutter Profiles (`*1.2`).

③ is a table **Finish · Panels · Net sqft · +15% sqft · Weight kg** over `aggregates.finAgg`, with the `.assume` note: "Stone is finish-specific. Profiles, hardware & consumables are finish-agnostic and shown only in combined totals."

**④ Project Lines** (`9387-9535`) — `<h2>` carries a floated `.clr` **clear all** (`setProject([])`).
- Columns: **# · Code · Finish · Rate (INR) · Qty · Total (INR) · (remove)**.
- Empty state (`.empty`): "No cabinets added yet. Configure a unit and tap "Add to Project"."
- **Code cell** is clickable (`title="Show Main BOM Details"`), toggling `expandedLine`; a `▸`/`▾` chevron in `--accent` precedes the mat-suffix-stripped code. `Elevation: <x>` renders beneath in 10px `--accent`.
- **Finish cell** shows `Stone: <carcassMat>[/<shutterMat>]`, optionally `Profile: <carcassProfileColor>[/<shutterProfileColor>]` in `--accent2` 10px, and — when the line has a `priceGroup` (planning/designer upload) — a small `<select>` "Pick colour (<PG>)…" restricted to `coloursForPriceGroup(l.priceGroup)`, **red-bordered until a colour is chosen**.
- **Rate** is an editable number input (min 0, right-aligned, mono); **Total** = `(rate||0) * qty` via `toLocaleString("en-IN")`.
- **remove** = `.rm`.
- **Expanded row** (`9480-9519`) reveals `MAIN BOM DETAILS — <code>` and a nested table **Packet · Dimensions · Qty · UoM** over `l.m.pkRows` (same `.grp` chip mapping, plus `elen_bom → Elenor`), or `.empty` "No BOM packets for this item."
- **Grand Total row**: colSpan-3 label, total qty, total INR (`en-IN`).

**⑤ Fillers** (`9538-9653`) — `<h2>` with a `.clr` **+ add row**. Empty: "No fillers. Click "+ add row" to add a filler for any zone (a zone can be added more than once)." Table inside `overflowX:auto`. Columns and controls:

| Column | Control | Options / default |
|---|---|---|
| Zone | `<select>` | `base tall wall loft mid`, capitalised |
| Qty | number, min 1 | — |
| Shutter Shade | `<select>` | `Default (<getDefaultShutterShadeForZone(zone)>)` + `shutterOptions` |
| Height preset | `<select value="">` | `Custom / pick…` + `FILLER_PRESETS[zone]` (`358-364`: base `[717]`, wall `[1082,717]`, tall `[2037,2397]`, loft `[597]`, mid `[1647,1287]`). Writes into Height and resets itself. |
| Height (mm) | number, `placeholder = getDefaultShutterHeightForZone(zone)` | — |
| Width (mm) | number, `placeholder="80"` (hard-coded `defaultWidth = 80`, `9570`) | — |
| Elevation | `<input list="filler-elev-list" placeholder="AA / custom">` | `<datalist>` of `ELEVATION_OPTIONS` — free text allowed here (unlike ④) |
| — | `.clr` `×` (red `#c0392b`), `title="Remove row"` | — |

**⑥ Visible Panels** (`9656-9771`) — same shape. Empty: "No visible panels. Click "+ add row" to add a visible panel for any zone (a zone can be added more than once)." Columns: **Zone · Qty · Profile Style · Shutter Shade · Size preset · Height (mm) · Width (mm) · (×)**.
- **Profile Style** `<select>`: `MD1 (Default)`, `MD3`, `MD1 + CM1/2`, `MD3 + CM1/3` (`9715-9718`).
- **Size preset** `<select>` writes **both** height and width from `VP_PRESETS[zone]` (`323-350`), e.g. `Base STD (717×586)`, `Base Low Depth (717×362)`, `Wall STD (1082×362)`, `Wall STD (717×362)`.
- Width default placeholder = `getDefaultCabinetDepthForZone(zone) + 25` (`9685`).

**⑦ Countertop** (`9774-9861`) — empty: "No countertops. Click "+ add row". Base-stone, patti, brass & light are derived from Length / Depth / Thickness / sides." Columns: **Length (mm) · Depth (mm) · Thick. · Color · Type · Rounding · Drop Ht · Light · Qty · (×)**.
- **Depth** placeholder `600`; **Thick.** `<select>` = `30` / `40` only.
- **Color** `<select>` = `Default (<base-zone shade>)` + `shutterOptions`.
- **Type** `<select>` over `CT_TYPES` (`127-137`), 9 entries whose labels are *renumbered* relative to their values:
  | value | label | island |
  |---:|---|---|
  | 1 | `1 · Linear` | false |
  | 5 | `2 · Linear + BSV` | false |
  | 2 | `3 · Linear + LHV with LH Drop` | false |
  | 3 | `4 · Linear + RHV with RH Drop` | false |
  | 4 | `5 · Linear + BSV with Both Side Drop` | false |
  | 6 | `6 · Island Compact` | true |
  | 7 | `7 · Island Table` | true |
  | 8 | `8 · Island with 350mm Sitting` | true |
  | 9 | `9 · Island Both Side Cabinets` | true |

  Changing Type re-derives the allowed `edging` list (`ctEdgingOptions(t)`) and resets `edging` to `"none"` when the current value is no longer valid, and sets `island` from the table (`9826`).
- **Rounding** column = a stacked `<select>` (`CtEdging` = `none | left | right | both`; `disabled` when `opts.length <= 1`, dimmed to `opacity:.5`) plus a number input **rounding height** (`placeholder="600"`, `title="Rounding height (shown in counter name)"`, disabled + `opacity:.4` when edging is `none`).
- **Drop Ht** number (`placeholder="705"`, `title="Drop-down panel height"`), enabled only when `ctHasDrop(ctType)`.
- **Light** = `baseLight` checkbox; **Qty** number min 1.

**⑧ Backsplash** (`9864-9947`) — empty: "No backsplashes. Click "+ add row" to add one (you can add as many as you like)." Columns: **Width (mm) · Height (mm) · Thickness (mm) (`placeholder="15"`) · Color (`Default (<base shade>)` + `shutterOptions`) · Qty · (×)**.

**⑨ Raw Material Selection** (`9950-10292`) — always rendered (not gated on `project.length`).
- `<h2>` right side: a `.clr` **↻ Retry All** button (only when `Object.keys(rawErrorMap).length > 0`) and a provenance line in `--accent`:
  - `Aggregated from SO: <SO number>` when `selectedSo && loadedSoDetail`
  - `Aggregated from Project: <n> units` when `project.length > 0`
  - `Select a Sales Order to load materials` when `soMode`
  - `Aggregated from Configured Unit (Fallback)` otherwise
- While `isSoDetailLoading`: centered "Loading Sales Order line items & materials..."
- Three `<h3>` sub-sections with a 2px `--accent` underline: **Carcass** (always), **Shutter** (only when any stone/profile has `category === "shutter"`), **Hardware & Consumables** (only when `rawAggregation.hardware.length > 0`). Carcass and Shutter each contain `<h4>` **Stones** and **Profiles**.
- **Stone block** per key: header `Stone — <finish> (<thickness>mm)` + `Net: N sqft | Total (+15%): N sqft`. States, in order: `Loading stone items...` → `⚠ Zoho API error — check your network connection.` + `.clr` **Retry** → `No matching <t>mm stone items found in Zoho for finish "<finish>".` (in `--warn`) → the `SearchableSelect` ("Search stone...", labels `<name> (<sku>)`). Once selected, an info box shows `SKU: <sku|N/A> · Stock: <stock_on_hand|N/A>`, then either `Slab Size: <cf_height>x<cf_width>mm (N sqft)` + `Calculated Slabs: N pcs` + **Actual Slabs** input (`step=.01`, overrides via `customPcsMap`), or the `--warn` message `Slab dimensions missing in Zoho custom fields (cf_height / cf_width).`
- **Profile block**: header `Profile — <code> (<finish>)` + `Net: N m | Total (+<waste>%): N m` where waste = **10% for `ELEN`**, 20% otherwise (`10066`, `10198`). Same loading/error/empty ladder; empty message `No matching profile items found in Zoho for finish "<f>" with code "<c>".`
- **Hardware block**: `<name>` + `Qty: <int or 3dp> <uom>`; states `Searching Zoho...` / error+Retry / `No matching items found in Zoho for "<name>".` / SearchableSelect ("Search item...") + `SKU · Stock` box.
- Empty sub-messages: `No carcass stone materials required.` / `No carcass profile materials required.` / `No shutter stone materials required.` / `No shutter profile materials required.`

**⑩ Stock Check** (`10295-10351`) — gated on `project.length > 0`. `<h2>` with a floated `.clr` **Check Stock** (label → "Checking...", `disabled={stockCheckLoading}`). Before running: `.empty` "Click "Check Stock" to verify hardware & consumable availability in Zoho." After: table **Item · Required · In Stock · Status**; requirements aggregate `l.m.hardware` and `l.m.cons` × line qty by name (`10315-10319`). Numbers print as integers or 3-dp. Status column per `§3.3`.

**Other Accessories** (`10354-10418`) — **un-numbered section sitting between ⑩ and ⑪**. Gated on `project.length > 0`. `.clr` **+ add row**. Empty: "No other accessories. Click "+ add row" to add a Chimney Panel or Dishwasher Panel." Each row is a flex card with:
- **Item** `<select>`: `Chimney Panel` (`chimney`) / `Dishwasher Panel` (`dishwasher`) (`OTHER_ACC_ITEMS`, `306-309`).
- **Size preset** `<select>` — **only when `item === "chimney"`**: `Custom / pick…` + `CHIMNEY_PRESETS` (`351-354`): `Chimney Area (1082×336)`, `Chimney Area (717×336)`.
- **Width (mm)**, **Height (mm)** numbers.
- **Profile (code)** `<select>` over `SH_DESIGNS` (`774`: MD1, MD2, MD3, MD1CM1, MD1CM2, MD2CM1, MD2CM2, MD3CM1, MD3CM2, CL1, CL2, NEON20), with the current value prepended if missing; caption `Colour: <profileColor> (shutter)` in `--accent2`.
- **Color (Stone)** `<select>` over `shutterOptions` (current value prepended if missing).
- **Qty** number min 1, and a `.rm` **remove** pushed right with `marginLeft:"auto"`.

**⑪ Accessories** (`10421-10532`) — gated on `project.length > 0`. `.clr` **+ add row**. Empty: "No accessory rows. Click "+ add row" to configure accessories for cabinets."
Each row card:
- Header `Accessory Row #<id>` + `.rm` **remove**.
- **Select Cabinets** — a checkbox per project line labelled with the first 3 code segments (`l.m.code.split("-").slice(0,3).join("-")`). Once any is checked: `Total width: <mm>mm = <m>m` in `--accent` 10px. **No 3000mm cap here** (unlike the dashboard subform).
- Then one row per **applicable** accessory (`getApplicableAccessories(row)`), from the builder's own `ACCESSORY_ITEMS` (`289-297`) — note this list has **six** entries and keys off **zone**, not `cfSubGroup`:
  | key | Label | itemId | Condition (zone string) |
  |---|---|---|---|
  | `skirting` | Skirting with light | `3418412000001249001` | contains `base` or `tall` |
  | `duplay` | Duplay Profile Light | `3418412000001249010` | contains `wall` |
  | `lprofile` | L Profile Dado Light | `3418412000001249037` | contains `wall` |
  | `jhandle` | J type handle | `3418412000001249019` | always |
  | `chandle` | C type handle | `3418412000001249028` | always |
  | `grandlight` | **Grand Profile Light** | `3418412000001249046` | contains `base` |

  `PROFILE_ACC_KEYS = ["skirting","duplay","lprofile","grandlight"]` (`298`) — checking one unchecks the others.
- When enabled, the row expands with: **Size** text, **Elevation** text, **Qty:** number (`step=.01`, defaults to the row total metres), plus:
  - **Straight:** and **L-conn:** integer inputs — **only for `skirting`** (`10496-10507`).
  - **Driver:** `<select>` — for any key in `PROFILE_ACC_KEYS` (`10509-10519`). Options `— select —` + `DRIVER_OPTIONS` (`410-414`): `LIGHT DRIVER LED STRIP 12V, 2AMP , 24W XX LED`, `LIGHT DRIVER LED STRIP 12V, 5AMP , 60W XX LED`. Labels longer than 40 chars are truncated with `…` **in the option text only** (`10515`).

**⑫ Downloads** (`10535-10566`) — gated on `project.length > 0`.
- **Packing List/Labels Filter:** `<select>` → `Both (Carcass & Shutter)` (`both`, default) / `Carcass Only` (`carcass`) / `Shutter Only` (`shutter`).
- Buttons: `.addbtn` **Excel BOM** (`handleExcelDownload`), `.addbtn` **Packing List (.xls)** (`handlePackingDownload`), `.addbtn` **Labels (PDF)** (`handleLabelsDownload`), `.clr` **CSV** (`downloadCsvFile`), `.clr` **copy csv** (label flips to `copied` via `copiedCsv`).

**⑬ CSV Preview** (`10569-10574`) — gated on `project.length > 0`. `<h2>⑬ CSV Preview <span>raw · flat · per-cabinet</span></h2>` (the span drops the uppercase transform and is `#8a8275`), then a **read-only** `<textarea>`: `height:160px`, mono 11px, `white-space:pre`.

### 6.6 Footer

`.builder-footer` (`10579`): "Base zone · v4 — single-unit BoM + multi-unit project consolidation. Project list is session-only."

> Version strings disagree: the header tag says **`STONE · v21`** and the footer says **v4**. Both are hard-coded.

---

## 7. `/reorder` — ReorderReport

File: `src/components/ReorderReport.tsx`. **Not** using `globals.css` classes at all — the whole page is inline-styled with `fontFamily: "system-ui, sans-serif"`, `padding:24`. It looks like a different application from `/`.

- **Header row**: `<h1>Re-order Level Report</h1>`; right: `← BOM Report` → `/`, `Carcass Builder` → `/builder` (both `#1f5be8`), and a **Refresh** button (label → "Loading…").
- **Error banner**: `#fde2e2` / `#900`.
- **Filter bar** (`#f5f5f5`, flex-wrap): `Filter by:` + three radios — **Lead Time** (`lead`), **Transit Time** (`transit`), **Lead + Transit** (`combined`, default) — then `≤` + a `max days` number input + `days`, then a free-text `Search item / SKU / vendor`, then **Clear** (resets both). Filter metric: `lead` → `lt`, `transit` → `tt`, `combined` → `lt + tt`; kept when `metric <= limit` (`210-222`).
- **Selection bar** (`#eef2ff`): `<n> selected`, **Select all (filtered)**, **Deselect all**, **Create Draft PO(s) for Selected** (blue, disabled when `bulkBusy || !selectedCount`; label → "Creating…"), a `bulkMsg` that is green `#0a7d2c` when it starts with `"Created"` and red `#900` otherwise, and right-aligned `Showing <n> of <m> · scanned <k> items`.
- **Table** (`overflow:auto`, `<thead>` is `position:sticky; top:0`): **✓ · Item · Stock · ROL · MSL · Shortfall · Vendor · Lead · Transit · Total · PO Qty · Rate · Action**. Numeric headers/cells are right-aligned and `white-space:nowrap`.
  - Item cell: name + `<sku|—> · <unit>` in 11px `#888`.
  - Shortfall is red `#b00020`, weight 600.
  - Vendor `<select>`: `— pick vendor —`; if the latest-PO vendor is not in the contacts list it renders as a bare option `<name> (latest PO: <po#> · <date>)`; if it is, it appears in an **optgroup "From latest PO"** as `<name> · <date>`; then optgroup **"All vendors"**. Changing the vendor zeroes Lead/Transit and re-fetches `/api/zoho/contacts/:id` for them (`103-114`).
  - Lead / Transit / Total show `—` when 0.
  - **Action**: **Create PO** (`disabled={s.posting || !s.vendor_id}`, label → `…`), or once posted a green `✓ <PO-number> ↗` (linked when `web_url` exists). Row errors render in 11px `#900`.
- **Loading state**: single row "Scanning items, recent POs and vendor profiles…" (colSpan 13). **Empty**: "No items match."
- Initial `po_qty` seed: `Math.max(shortfall, reorder_level - stock) || 1` (`73`); initial rate: `last_rate ?? 0`.

---

## 8. `/qr/bom/[orderId]` — QrBomPage

File: `src/components/QrBomPage.tsx`. `<main class="qr-page"> > .widget-frame`. Chrome: `.widget-title` `<h1>BOM Items</h1>`; `.widget-actionbar` with `BOM Backorder Report` + `"<SO> · BOM Items"` (or `"Loading BOM Items"` before data arrives). Body `.qr-page-body`:
- error → `.message.error`
- loading → `.empty` "Loading BOM items..."
- loaded → `<BomOrderCard order rows />` **with no `headerActions` and no `footer`** — read-only, no QR buttons, no packing list.

Data via `loadBomReport(orderId)` (`src/lib/report.ts`), aborted with an `active` flag on unmount. Fallback error text: "Could not load BOM report."

**No auth exception exists for this route** — `AuthGate` still gates it, so a scanned QR would land a shop-floor user on the password screen. (Moot today: the BOM QR encodes plain text, not this URL, so nothing actually links here.)

---

## 9. AiCopilot — the floating assistant

File: `src/components/AiCopilot.tsx`. Rendered on every page (`layout.tsx:17`). Entirely inline-styled; one `<style>` tag defines `@keyframes ai-slide-up`.

- **Trigger** (`86-119`): `position:fixed; bottom:24px; right:24px`, 56px circle, gradient `linear-gradient(135deg, #7928CA 0%, #FF0080 100%)`, `box-shadow: 0 8px 32px rgba(0,0,0,.25)`, **`zIndex: 9999`**, glyph `💬` → `✕` when open. Hover handlers scale to `1.08` and deepen the shadow. `aria-label="Open AI Copilot"` (never updated to "Close").
- **Panel** (`122-273`): `bottom:96px; right:24px`, `380 × 500`, `border-radius:16px`, `rgba(255,255,255,.85)` + `backdrop-filter: blur(20px)`, `zIndex:9998`, `animation: ai-slide-up .25s cubic-bezier(.16,1,.3,1)`, font `Segoe UI, -apple-system, …`.
  - Header: dark gradient `#1f2937 → #111827`; `Magppie AI Copilot` + `BOM & Estimate Assistant`; `✕` close.
  - Messages: user bubbles right-aligned, purple `#7928CA` on white; assistant bubbles left-aligned `rgba(243,244,246,.95)` with `#1f2937` text; `max-width:80%`; `white-space:pre-wrap`. Auto-scroll via `messagesEndRef.scrollIntoView({behavior:"smooth"})` on `[messages, isOpen]`.
  - Loading placeholder: italic grey **"Thinking..."**.
  - Input form: pill text input `placeholder="Ask a question..."` + gradient **Send** (disabled and `opacity:.6` when `loading || !input.trim()`).
- Seed message: "Hi! I'm your Magppie BOM Copilot. Ask me anything about your current BOM report, inventory stock levels, or cabinet building specifications!"
- Error bubble: `` `Sorry, I encountered an error: ${err.message || "Please check API configuration."}` ``.
- **Context bridge:** it reads `(window as any).__BOM_CONTEXT__` (`38`) and POSTs `{ messages, context }` to `/api/ai/chat`. Only `BomDashboard` populates it (`793-813`) with `{ page:"dashboard", stats, orders:[{number,customer,status}], criticalComponents: first 30 out-of/low-stock rows as {name,sku,status,qty,uom} }`. **On `/builder`, `/designer`, `/planning`, `/reorder` and `/qr/*` the context is `{}`** — the Copilot answers blind there.
  (`CarcassBomBuilder.tsx:7104` writes a `code:` field into an unrelated object; it does not set `__BOM_CONTEXT__`.)
- The server route requires an LLM API key from the environment (`src/app/api/ai/chat/route.ts`) — treat that value as a placeholder; it should contain the provider API key and must never be committed or exposed to the client.

---

## 10. Table & layout patterns

1. **CSS-grid "tables"** — `.bom-head` / `.bom-row` are `display:grid` with an explicit 10-column track list and a **`min-width:1320px`** (`globals.css:722-728`):
   ```
   minmax(240px,1.6fr) minmax(85px,.6fr) minmax(135px,.85fr) minmax(85px,.55fr)
   minmax(95px,.6fr)   minmax(115px,.65fr) minmax(115px,.7fr) minmax(110px,.65fr)
   minmax(135px,.8fr)  minmax(70px,.45fr)
   ```
   Every cell is a flex row with `min-height:78px; padding: 0 28px`. Same technique for `.qr-item-head`/`.qr-item-row` (5 cols, `min-width:650px`).
2. **Real `<table>`s** — the accessories subform (`min-width:1160px`), all builder tables, `ReorderReport` and `DraftPoModal`.
3. **Horizontal-scroll wrappers** (the app's one responsive strategy for wide data):
   - `.bom-table { overflow-x: auto }` (`globals.css:718-720`)
   - `.accessory-table-wrap { overflow-x: auto }` (`1033-1035`)
   - `.qr-item-list { overflow: auto }` (`1238-1242`)
   - Builder: inline `<div style={{ overflowX: "auto" }}>` around the ⑤/⑥/⑦/⑧ tables (`9548`, `9666`, `9784`, `9874`)
   - ReorderReport: `<div style={{ overflow:"auto", border:"1px solid #ddd" }}>` (`324`)
   - `html, body { max-width:100vw; overflow-x:hidden }` (`globals.css:20-25`) is the backstop — the page never scrolls sideways; the tables do.
4. **Modal pattern (dashboard)** — `.qr-modal-backdrop` (`rgba(18,18,16,.55)`, `z-index:30`) with `role="presentation"` + `onClick={close}`, inner `<section role="dialog" aria-modal="true" aria-label=…>` with `onClick={e => e.stopPropagation()}`. `.qr-modal` caps at `max-height: calc(100vh - 40px); overflow:auto`.
   `DraftPoModal` re-implements the same thing inline at `zIndex:100`; the builder's finish modal at `z-index:1000`; the AI Copilot at 9998/9999; AuthGate at 99999. **Five unmanaged z-index tiers.**
5. **Master/detail expansion** — `<details>/<summary>` in ④ Full Explosion; controlled `expandedLine` state + `▸/▾` in ④ Project Lines; `rowSpan` merging in the accessories subform.
6. **Section rhythm** — dashboard: `.widget-title` → `.widget-actionbar` → `.widget-tabs` → `.summary-strip` → `.search-panel` → `.bom-stage`. Builder: repeated `.card`s, each `<h2>` numbered, `margin-bottom:18px`.

---

## 11. Responsiveness

- **Dashboard**: exactly one breakpoint, `@media (max-width: 860px)` (`globals.css:1425-1532`): `.app-shell` padding 18→8px; `.widget-title` 86→64px tall; `.widget-actionbar` becomes a column; `.widget-tabs` gets `overflow-x:auto` with `white-space:nowrap` tabs at 18px; **`.summary-strip` drops from 5 to 2 columns**; `.search-row`, `.report-filter-row`, `.refresh-bar`, `.qr-actions`, `.stats` all collapse to `1fr`; `.button { width:100% }`; `.search-panel`/`.bom-stage` padding 44→18px; `.connection` stacks; `.pill` 20→15px; `.bom-card-header` stacks (SO 28→22px, customer/date 23/21→16px); `.so-qr-group { flex: 1 1 210px }`.
- **Builder**: exactly one breakpoint, `@media (max-width: 820px)` (`CarcassBomBuilder.tsx:10872-10874`) → `.grid { grid-template-columns: 1fr }`. Nothing else adapts: the header link row, the `.dims` 3-column grid, the `.addrow`, and every table keep desktop metrics. `.rollup` self-adapts via `auto-fit, minmax(150px, 1fr)`.
- **Never responsive**: `/reorder` (13-column table, fixed inline paddings), `DraftPoModal` (`min(960px,95vw)` but an 8-column table inside), the AI Copilot (a fixed `380 × 500` panel that will overflow a 360px-wide phone).
- **No viewport meta is declared** — `layout.tsx` exports only `title`/`description`, with no `viewport` export. On mobile Safari/Chrome the pages render at the default ~980px virtual width and are zoomed out.
- `.bom-row .item-cell strong` at **27px** and `.bom-head` at 19px make the report render at roughly kiosk/TV scale — it was designed for a large factory display, not a laptop.

---

## 12. Animations & loading states

**Animations**
| Name | Where | Definition |
|---|---|---|
| `auth-spin` | AuthGate boot spinner + button spinner | `AuthGate.tsx:117-120`, 1s / 0.8s linear infinite |
| `auth-fade-in` | login card entry | `173-182`, 0.4s `cubic-bezier(.16,1,.3,1)`, `translateY(16px) scale(.98)` → none |
| `auth-shake` | wrong password | `272-277`, 0.35s, ±6/4px |
| `ai-slide-up` | Copilot panel | `AiCopilot.tsx:73-82`, 0.25s `cubic-bezier(.16,1,.3,1)` |
| `modalFadeIn` | finish-modal backdrop | `CarcassBomBuilder.tsx:10659-10662`, 0.2s ease-out |
| `modalSlideUp` | finish-modal card | `10663-10666`, 0.25s |
| — | `.addbtn:active { transform: translateY(1px) }` | `11016-11018` |
| — | `.auth-submit-btn:hover` lift + `.auth-btn-arrow` translate 3px | `301-323` |
| — | `.searchable-select-trigger` / `.option-item:hover` | `10792-10794` |
| — | AiCopilot trigger hover scale 1.08 (JS mouse handlers, not CSS) | `109-116` |

There are **no skeletons and no CSS spinners outside AuthGate**. Every other loading state is a **text swap**:

| Surface | Loading copy |
|---|---|
| Dashboard connection | `Checking Zoho Inventory...` / button `Checking` |
| Search button | `Searching...` |
| Load button | `Loading BOM...` |
| Raw-material resolution | `Resolving raw materials...` / `Cloning BOM tree with new stone: X...` / `Applying default stone: X to all panels...` |
| Raw-mat modal dropdown | `Loading items...` ; confirm button → `Applying...` |
| Refresh bar | `Refreshing live Zoho data...` / button `Refreshing` |
| QR buttons | per-button `disabled` via `qrBusyKey` (no visual change beyond `:disabled { opacity:.55 }`) |
| Update SO | `Preparing updates...` → `Updating <SO>...` → `✓ Updated N SOs.` ; button `Updating...` |
| DraftPoModal | `Resolving items & composite components, computing stock…` / `Creating draft purchase order(s)…` / vendor cell `loading…` |
| ReorderReport | `Scanning items, recent POs and vendor profiles…` / `Loading…` / `Creating…` / action `…` |
| Builder ⑨ | `Loading Sales Order line items & materials...` / `Loading stone items...` / `Loading profiles...` / `Searching Zoho...` |
| Builder ⑩ | button `Checking...`, cell `...`, tag `checking` |
| Builder ① SO | `Processing...` |
| Finish modal | `Saving...` → `✓ Saved & Selected!` |
| AI Copilot | italic `Thinking...` |
| QrBomPage | `.empty` `Loading BOM items...` |

Global disabled affordance: `button:disabled { cursor: not-allowed; opacity: .55 }` (`globals.css:44-47`).

---

## 13. Print styles

**There are none.** `grep -rn "@media print\|@page" src/` returns nothing.

The dashboard's **Print** button (`BomDashboard.tsx:1439-1441`) calls bare `window.print()`. Consequences you will see on paper:
- the black `.widget-actionbar` and `.bom-card-header` print as large solid black blocks (or drop out entirely if the user's "background graphics" setting is off, taking the white SO number with them);
- `.bom-table { overflow-x:auto }` + `min-width:1320px` means **the right-hand columns (Eff. Stock, Deficit, Status, Unit) are clipped off the page**;
- the AI Copilot bubble and any open modal print on top of the content;
- `.stock-dot` colours are the only status signal and disappear in greyscale.

The two genuinely printable artefacts are generated documents, not the DOM: the packing list (`buildPackingListHtml`, Times New Roman + explicit `1px solid #222` borders) and the 150×100mm jsPDF labels.

---

## 14. End-to-end user flows by role

### Factory / store user — "what is short for this order?"
1. Land on any URL → AuthGate → type the shared factory password → land on `/`.
2. Check the `.connection` strip says "Live Zoho Inventory connected".
3. Type an SO number or customer (≥2 chars) → **Search Orders**.
4. Tick one or more `.order-card`s → **Load Selected (n)**.
5. If a Raw Material Selection modal appears, accept the defaults (or pick a stone/profile where flagged "Change stone (required)"), optionally override **Actual Pcs** → **Confirm & Load BOM**.
6. Read the summary strip (red/gold/green), narrow with the pills and the search box.
7. Expand nothing — the tree is fully expanded by default; read the grouped `BomOrderCard`s.
8. Export: **↓ Excel** / **↓ CSV**, or **Print**.
9. Leave the tab open — it auto-refreshes every 10 minutes; **Refresh Now** forces it.

### Dispatch / packing user
1. Load the order(s) as above.
2. On the SO card, hit **Packing List**.
3. In the modal, tick the orders (only offered when >1 is loaded), pick **Carcass / Shutter / Both**.
4. **Download Packing List** → `<SO>-<Group>-packing-list.xls` (opens in Excel), and/or **Print Labels** → `<SO>-<Group>-labels.pdf` (150×100mm, one page per box, barcode + QR).
5. For shop-floor scanning, use **BOM QR** → **View**/**Download** (plain-text item list) or **User QR** (JSON customer/address payload).

### Purchase user — reactive (per SO)
1. `/` → **+ Draft PO from SO**.
2. Search → click an SO → wait for "Resolving items & composite components…".
3. Review the out-of-stock lines; the preferred vendor and rate are pre-filled from the most recent PO; adjust PO Qty / Rate / Vendor; untick lines to exclude.
4. **Create Draft PO(s)** → one draft PO per vendor → **done** step lists `PO-number ↗`.

### Purchase user — proactive (re-order levels)
1. `/reorder` (from the dashboard actionbar or the builder header).
2. Wait for "Scanning items, recent POs and vendor profiles…".
3. Filter by Lead / Transit / Lead+Transit ≤ N days, and/or search item/SKU/vendor.
4. Either **Create PO** per row, or tick rows → **Select all (filtered)** → **Create Draft PO(s) for Selected** (grouped by vendor).
5. Confirm via the green `✓ PO-number ↗` links.

### Design / estimation user — build a kitchen from scratch (`/builder`)
1. `/builder` → **① Configure Unit**: Zone → Cabinet Family → Configuration → (Drawer Model / Tip-On / Inbuilt Drawers / Hand as they appear) → Handle → Design → Carcass Finish (`+` to create one on the fly) → profile finishes → Shutter/Glass finish → W×H×D (or Custom…) → Thickness (unlock only if truly needed).
2. Read the `.codebox`; **Copy** the cabinet code if needed.
3. Sanity-check the **Packets** and **Raw BoM** tabs (roll-up + Full Explosion + the Logic box).
4. Pick an **Elevation** (mandatory — the button stays disabled otherwise) and a Qty → **+ Add to Project**. Repeat for every cabinet.
5. **Project & Totals** tab: review ② Consolidated Totals and ③ Stone per finish; enter **Rate** per line in ④ (Grand Total in `en-IN`); expand any line to see its packets.
6. Add ⑤ Fillers / ⑥ Visible Panels / ⑦ Countertop / ⑧ Backsplash / Other Accessories / ⑪ Accessories as required.
7. ⑨ Raw Material Selection: pick the real Zoho stone/profile/hardware items; override **Actual Slabs** where the calculation is impractical.
8. ⑩ **Check Stock** for hardware & consumables.
9. ⑫ Downloads: choose the Carcass/Shutter/Both filter → **Excel BOM**, **Packing List (.xls)**, **Labels (PDF)**, **CSV** / **copy csv**; ⑬ shows the CSV inline.
10. ① Zoho Sales Order: search the SO → **Add to Zoho Sales Order** to push the lines.
> The project list is **session-only** (per the footer) — a refresh loses everything.

### Designer (`/designer`)
1. `/designer` — the Configure card, code box and first two tabs are hidden; only the **Sales Order → BoM** tab exists.
2. **① Upload Cabinet Codes (.xls)** → **Choose Excel…** → upload the planning **Shutter** sheet.
3. Lines land in ④ Project Lines carrying a `priceGroup`; each shows a red-bordered "Pick colour (<PG>)…" select until a shutter colour is chosen.
4. Use the bulk bar (**Zone → Price Group → Colour → Apply to filtered**) to colour many lines at once.
5. Continue with ⑨/⑩/⑫ as above.

### Planning (`/planning`)
Same as `/designer` **except** step 2: there is no upload card; planning uses **① Zoho Sales Order** search → select → the SO's lines drive ⑨ Raw Material Selection ("Aggregated from SO: <number>"), then **Add to Zoho Sales Order**.

---

## 15. Accessibility — honest assessment

**What exists**
- Semantic landmarks on the dashboard: `<header>`, `<main class="main">`, `<section>`, `<article class="bom-card">`, `<time>`.
- `aria-label` on: the summary strip ("BOM report summary"), the stock filter group ("Stock filters"), the per-SO QR group (`QR codes for <SO>`), the Copilot trigger ("Open AI Copilot"), and each modal `<section>`.
- Modals use `role="dialog" aria-modal="true"` with `role="presentation"` backdrops.
- `<label htmlFor>` is correctly wired for `#order-query`, `#order-status`, `#packing-group-select`, `#auth-password`; `.order-card`, `.refresh-toggle`, `.accessory-toggle` and `.packing-order-item` wrap their inputs in a `<label>`.
- `alt` text on the QR images ("BOM items QR", "User details QR"); the placeholder span is `aria-hidden="true"`.
- `:focus` is visibly styled in the builder (`outline: 2px solid var(--accent2)`).

**Gaps (real, and worth fixing)**
1. **`SearchableSelect` is not accessible.** It is `<div onClick>` + `<div onClick>` options — no `role="combobox"`/`role="listbox"`/`role="option"`, no `tabIndex`, no `aria-expanded`, no `aria-activedescendant`, no keyboard support at all (no Enter/Space/Arrow/Escape). It cannot be reached by Tab and cannot be operated without a mouse. It is the **primary control of the entire builder** — ① Configure Unit is effectively keyboard-inaccessible.
2. **No focus management in any modal.** Focus is never moved into the dialog, never trapped, and never restored on close; **Escape closes nothing** anywhere in the app (QR, packing, raw-material, draft-PO, finish modal, Copilot).
3. **No visible focus ring on the dashboard.** `globals.css` never styles `:focus`/`:focus-visible`; the UA default is the only indicator, and it is invisible on the black `.dark-tool` buttons.
4. **Clickable non-buttons**: the DraftPoModal SO result rows (`<div onClick>`, `DraftPoModal.tsx:254-263`), the builder's `.so-dropdown` rows (`9178-9197`), and the ④ Project Lines code cell (`<td onClick>`, `9414-9418`) — no `role`, no `tabIndex`, no key handlers.
5. **Colour is the only channel for status.** `.stock-dot` carries the meaning; the adjacent text label is the saving grace on `.bom-row`, but the builder's ⑩ tags, the `.summary-cell` colours, the `.grp` chips and the `.rc` left borders are colour-only. Several pairs also fail contrast: `.pill` text `#746f66` on `#fffdf9`, `.summary-cell span` `#7b766f`, `.accessory-help` `#8b8479`, `.builder-footer` `#9a9384`, `.empty` `#8a8275`, `.tab` `#7b766f`.
6. **No live regions.** Every async status ("Refreshing live Zoho data…", "✓ Updated 2 SOs.", "Combined width exceeds 3000mm.", `.message.error`) renders silently for a screen-reader user. The Copilot's message list has no `aria-live`, so replies are never announced.
7. **CSS-grid tables have no table semantics.** `.bom-head`/`.bom-row` and `.qr-item-*` are `<div>`s/`<span>`s — no `role="table"/"row"/"columnheader"/"cell"`, so screen readers get an undifferentiated run of text with no header association.
8. **`<h1>` duplication / heading order.** `/` and `/qr/bom/[id]` render an `<h1>` and then repeat the same string as `<strong>` in the actionbar. The builder jumps `h1 → h2 (card titles at 11px) → h3 → h4`, where the visual hierarchy is inverted (the `h2`s are the smallest text on the card).
9. **Icon-only controls without accessible names**: `.accessory-delete` `×`, the `.clr` `×` row-removers (they have `title="Remove row"` but no `aria-label`), the `+` finish buttons (`title="Add New Finish"` only), the raw-mat modal close `✕`, and the `▸/▾` chevron. `title` is not a reliable accessible name.
10. **The AuthGate boot spinner** is a bare animated `<div>` with no `role="status"` and no text alternative — a screen reader hears nothing at all while `isAuthenticated === null`.
11. **`aria-label="Open AI Copilot"` never becomes "Close AI Copilot"** even though the glyph flips to `✕` (`AiCopilot.tsx:88-118`).
12. **No `prefers-reduced-motion` guard** on any of the animations in §12.
13. **No skip link**, and the dashboard actionbar puts 7 controls before the main content on every page load.
14. **The `<select multiple>` in the accessories subform** silently rejects a selection that busts 3000mm — the only feedback is the page-level `.message.error` far above the table, which is not associated with the control and is not announced.
