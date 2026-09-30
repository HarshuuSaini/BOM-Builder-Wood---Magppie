# UI / UX Documentation

## Screens

| Route | Screen | Component |
|---|---|---|
| `/` | Landing — links to the five destinations | `app/page.tsx` |
| `/builder` | Cabinet builder | `WoodBomBuilder` |
| `/designer` | Builder, `soMode` | `WoodBomBuilder soMode` |
| `/planning` | Builder, `planningMode` | `WoodBomBuilder planningMode` |
| `/dashboard` | Zoho orders, raw material, stock | `BomDashboard` |
| `/reorder` | Reorder report | `ReorderReport` |
| `/qr/bom/[orderId]` | Shop-floor BOM, QR-linked | `QrBomPage` |

All builder routes are wrapped in `AuthGate`.

## Builder layout

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER   Wood Kitchen BOM Builder      cabinets 10  sheets 8.4│
├───────────────┬──────────────────────────────────────────────┤
│ RAIL (318px)  │ TABS  Packets | Raw BoM | Project & totals    │
│               ├──────────────────────────────────────────────┤
│ Configure     │                                              │
│  Zone         │  tables — panels, profiles, hardware,        │
│  Family       │  consumables, board totals                   │
│  Config       │                                              │
│  Hand         │                                              │
│  Handle       │                                              │
│  Board        │                                              │
│  Shutter type │                                              │
│  Drawer model │                                              │
│  Finish       │                                              │
│  W · H · D    │                                              │
│  Elev · Qty   │                                              │
│ [Add to proj] │  ┌────────────────────────────────────────┐  │
│  cabinet code │  │ amber: Not yet specified               │  │
└───────────────┴──┴────────────────────────────────────────┴──┘
```

Two-column flex. Below 820px the rail becomes full-width and stacks above the
output.

## Components

| Component | Role |
|---|---|
| `Fld` | Label + control + optional hint |
| `Hint` | Small muted explanatory line under a control |
| `Seg` | Segmented two/three-way toggle (Hand, Handle, Neon) |
| `Tbl` | Table with right-aligned numeric columns |
| `Stub` | Amber "Not yet specified" panel |

## Navigation & user flow

```
Landing → Builder → (login) → configure → Add to project
                                   ↓            ↓
                            Packets tab   Project & totals
                                   ↓            ↓
                              Raw BoM      CSV / Full BOM download
```

The primary loop is configure → add → repeat. The cabinet code under the Add
button updates live, giving the planner a checkable identifier before commit.

## Design system

Deliberately a shop-floor estimating tool, not a marketing surface: dense,
tabular, high information density. Numbers use `font-variant-numeric:
tabular-nums` so columns align down the page.

### Colour

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F4F5F3` | Page background |
| `--ink` | `#1B2430` | Text, header rule |
| `--mut` | `#66757F` | Labels, hints, table headers |
| `--line` | `#D8DEDA` | Borders |
| `--pnl` | `#FFFFFF` | Panels, rail, table body |
| `--acc` | `#15645A` | Primary action, active tab, key figures |
| `--flag` | `#9C5510` | Stub text, destructive actions |
| `--flagbg` | `#FBF2E6` | Stub panel background |

Amber is **reserved exclusively for stubs and removals** so unspecified items
are impossible to miss. Never use it decoratively.

### Typography

One family: `Inter`, falling back to `Segoe UI` / system UI. No display face.

| Element | Size | Weight |
|---|---|---|
| `h1` | 19px | 650 |
| Headline figures | 20px | 650 |
| `h3` | 15px | 650 |
| Body / table | 12.5–13px | 400 |
| Labels, hints, table heads | 11px | 600 |

Letter-spacing `-0.015em` on headings only.

### Spacing, radius, icons

4px rhythm. Rail padding 18px, panes 20/24px. Border radius a uniform 3px —
this is a tool, not a card kit. **No icon set.** Text labels only; nothing in
the interface depends on recognising a glyph.

### Responsiveness

Single breakpoint at **820px**, where the rail unpins to full width. Tables
scroll horizontally inside `.tw` rather than reflowing, because a cut list
loses meaning if columns wrap.

### Animation

Effectively none. Only `:hover` on the primary button and `:focus` outlines.
No entrance animation, no scroll effects, no transitions on cards. Motion would
be noise in a tool read for numbers.

### Accessibility

Visible `:focus` outlines on every control (2px, accent). Numeric table cells
right-aligned. Colour never carries meaning alone — stubs are amber *and*
headed "Not yet specified"; unbanded panels show an em dash, not just an absent
colour.

## Copy conventions

Sentence case. Active verbs — "Add to project", not "Submit". The action keeps
its name through the flow. Empty states instruct rather than apologise:
*"Configure a cabinet and add it to start a project."* Stub text always states
what is missing **and why**, never just that something failed.
