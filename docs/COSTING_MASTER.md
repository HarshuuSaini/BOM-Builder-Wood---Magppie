# Costing Master

## Source of truth

The application uses `source/src/data/costing_master.json`. It contains the
122 records from the approved Excel workbook's `KITCHEN` sheet. It replaces the
previous hand-entered 18-rate table and all reads/writes to the Zoho custom
module `cm_wood_costing`.

The other workbook sheets are deliberately ignored.

## Fields

Each item retains the original sheet fields plus:

- Group and Subgroup
- Type and Brand
- Thickness (mm)
- Rate Basis (`SQFT`, `MTR`, `KG`, `SET`, or `PCS`)
- Previous Rate and Current Rate
- Rate Change (₹) and Rate Change (%)

Boards are costed per square foot. Profiles use metre rates when the source
item is length-based. Hinges and drawer systems retain their Type and Brand,
including Hettich, Hafele, Blum, Lian and other brands found in the source.

## Monthly update

1. Open the approved master workbook.
2. Change only the `KITCHEN` sheet.
3. Copy each affected old Current Rate to Previous Rate.
4. Enter the new Current Rate. Do not derive Previous Rate from Unit Cost.
5. Recalculate Rate Change and Rate Change % in Excel.
6. From `source/`, run:

   ```bash
   node tools/generate-costing-master.mjs /absolute/path/to/master.xlsx
   npm run build
   ```

7. Review the `/admin` table, commit, and deploy.

The admin route is read-only because deployed Vercel code cannot persist a
change to a bundled JSON file. The password is provided through the
`ADMIN_PASSWORD` environment variable and is never committed.
