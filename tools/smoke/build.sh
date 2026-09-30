#!/usr/bin/env bash
# Regenerate the headless engine from WoodBomBuilder.tsx and transpile it.
# Strips the React component, keeping only the pure BOM logic.
set -e
cd "$(dirname "$0")"
SRC=../../source/src/components/WoodBomBuilder.tsx
LINE=$(grep -n "^export function WoodBomBuilder" "$SRC" | cut -d: -f1)
head -n $((LINE-1)) "$SRC" | grep -v "^import " > core.ts
cat >> core.ts << 'EXPORTS'

export { buildModel, buildRawRows, buildCSV, buildFullBomData, buildBoardTotals,
         famSetOf, ZONES, defSizes, BOARDS, SHUTTER_TYPES, DRAWER_DED, SHEET_SQFT };
EXPORTS
# BSD/GNU-portable prepend; the export/report types are stubbed for headless runs.
{ printf '%s\n' 'import { getPartBaseName, getPanelBaseName, normalizePartOrPanelName } from "./shim";' \
    'type AccessoryExportRow = Record<string, unknown>;' \
    'type BomReportRow = Record<string, any>;' \
    'const exportBomWorkbook: any = null, exportBomCsv: any = null;' \
    'void exportBomWorkbook; void exportBomCsv;' \
    'type CostingRates = Record<string, number>;' \
    'const DEFAULT_RATES: any = {}, CARCASS_RATE_KEY: any = {}, SHUTTER_RATE_KEY: any = {};' \
    'void DEFAULT_RATES;'; cat core.ts; } > core.tmp && mv core.tmp core.ts
# Use the app's own TypeScript (npx may resolve an unrelated "tsc" package).
../../source/node_modules/.bin/tsc core.ts shim.ts --target ES2020 --module commonjs --outDir out --skipLibCheck
echo "built → out/  now run: node run.js"
