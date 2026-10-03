# Hardware Pack Master

Hardware-pack composition comes from the approved workbook's `pack` sheet and
is generated into `source/src/data/hardware_packs.json`. Pack component names
are already the approved wood item descriptions, so there is no stone-to-wood
translation layer.

The 16 current definitions cover:

- Hinge 0-crank packs for 2, 3 and 5 hinges
- Blind-hinge packs for 2, 3 and 5 hinges
- Base, wall/loft and tall cabinet-joint packs
- Base top-profile packs for 300, 450, 600, 900 and 1050 mm
- Wall dish-rack bottom-profile packs for 600 and 900 mm

## Components without a KITCHEN rate

- PVC INSERT 13XX5 ID 5 UTA
- SCREW FOR CHIP BOARD 16XX4 SS 304 CINE
- DOOR BUMPER XX BS2-6 EBC
- MINI FIX SET OF 3 PCS XX 9290887+9289656+4005 HET
- WOODEN DOWEL DOWEL 40XX8 DP840 EBC
- ALU PROF FOR SINK 3000X20X20 ANODISED 2412 OML
- END CONNECTOR FOR SINK PROF XX BLACK UTA

These are expanded in the BOM but remain visibly unpriced until matching rows
are added to the KITCHEN sheet.
