# Artefacts

Everything produced or received during planning, in the order it happened.
Useful for tracing *why* a rule is what it is.

## Source material from the client

| File | What it is |
|---|---|
| `note-01-widths.jpg` | Handwritten "Project – Wood" note: the standard width table |
| `note-02-shutter-types.jpg` | Handwritten "Shutter types" note: laminated / membrane / PU |

Both were transcribed with readings flagged; see `../CHAT_SUMMARY.md` §5 and §6.
Photos downscaled from the originals.

## Spreadsheets — the Q&A cycle

| File | Role |
|---|---|
| `wood_kitchen_widths.xlsx` | 53 standard sizes, summary + import-ready matrix |
| `wood_shutter_types.xlsx` | Round 1 questions |
| `wood_shutter_types_ANSWERED.xlsx` | Round 1 as returned by the client |
| `wood_shutter_types_v2.xlsx` | Round 2 questions |
| `wood_shutter_types_v2_ANSWERED.xlsx` | Round 2 as returned |
| `wood_shutter_types_v3.xlsx` | Round 3 questions |
| `wood_shutter_types_v3_ANSWERED.xlsx` | Round 3 as returned |
| `drawer_deduction_template.xlsx` | Blank per-model deduction template |
| `drawer_deduction_FILLED.xlsx` | As returned — **Lian still holds the example row** |
| `wood_kitchen_spec.xlsx` | Consolidated field list + BOM formula spec |

The `_ANSWERED` files are the authoritative record of what the client actually
said, in their own words, in the "Still Open" / "Open Questions" sheets.

## Prototype

`wood-bom-builder.jsx` — a single-file React prototype written before the full
port. Superseded by `source/src/components/WoodBomBuilder.tsx`. Kept because it
is a readable, dependency-free expression of the same construction logic.
