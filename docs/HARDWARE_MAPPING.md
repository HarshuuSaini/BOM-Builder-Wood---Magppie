# Stone-to-Wood Hardware Mapping

Hardware-pack composition comes from `source/src/data/hardware_packs.json`.
Confirmed replacements from the approved wood costing master are maintained in
`source/src/data/hardware_component_mapping.json`. The application replaces
the stone description with the wood master description before UI, BOM, CSV,
stock and costing processing.

## Confirmed replacements

12 component descriptions map to wood master rows: KITCHEN-054, 061, 062,
067, 083, 084, 086, 100, 102, 121 and 122 (KITCHEN-086 is used by two matching
slim-hinge descriptions).

## Still requiring a wood equivalent

- Hinge 0 crank without soft close (Lian)
- Handle screw 8×4
- Bondtite fast and clear for stone
- HPL 2.5mm carcass fixing
- Dowsil 789 transparent silicone
- Lian tandem Low H90 drawer
- Nylon insert for stone
- Chipboard screw 13×4.8
- Lian tandem High H175 drawer
- Lian tandem High H239 drawer
- Wall-hanger LH cover cap
- Wall-hanger RH cover cap
- Hilti PVC insert 120×8
- Wall-hanging PVC packing 100×100×12

These remain unmapped rather than borrowing a non-equivalent wood rate.
