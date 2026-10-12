# Raw board pricing — 12 October 2026

Postlam laminate faces are charged separately using the current kitchen's
material-selection prices. Do not deduct those selected prices dynamically
from the raw-board rate.

The confirmed embedded allowance is Rs 431 per face (Rs 862 per sheet for
two faces). The HDHMR raw rates in the checked-in costing master are:

| Item | Raw price per 32 sqft sheet |
| --- | ---: |
| KITCHEN-004, carcass/shelf HDHMR 18 mm | 2201.91 |
| KITCHEN-011, shutter HDHMR 18 mm | 2201.91 |
| KITCHEN-026, drawer HDHMR 16 mm | 2202.00 |
| KITCHEN-037, back HDHMR 9 mm | 1116.00 |
| KITCHEN-029, BWP drawer 15 mm | 2412.00 |
| KITCHEN-035, BWP back 8 mm | 1399.51 |
| KITCHEN-030, RAW BWR counter base 16 mm | 2612.30 |

The 18 mm shutter HDHMR rate is aligned to the carcass/shelf raw rate.
The last two BWP rates are explicit user overrides; thicknesses are unchanged.
Matching shutter rows now use the carcass/shelf price for the exact subgroup
and thickness, as confirmed by the user. This includes Prelam Particle
(1153.44/sheet), Prelam MDF (1784.628/sheet), Postlam Particle (3188/sheet),
Postlam MDF (2279/sheet), and Postlam BWP (2612.40/sheet), all 18 mm.
This replaces the earlier instruction to preserve those shutter entries.
Particle is still excluded from the laminate deduction; matching its rate
does not apply a deduction. Unmatched PU/paint and membrane prices remain
unchanged. PU/membrane board prices are treated as raw by user instruction;
their underlying supplier composition has not been independently verified.

Do not reapply the deduction to these already-adjusted values. Preserve these
confirmed rates when regenerating the master from a supplier workbook.

Purchase quantities round to two decimals after aggregation (no whole-unit round-up). Edge-band glue
consumption is 6 g/metre at Rs 400/kg. Board sheet-quantity overrides affect
only board cost, not laminate, processing or consumable quantities. They are
temporary current-session inputs, reset on refresh/import.
