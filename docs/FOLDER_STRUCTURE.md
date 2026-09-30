# Folder Structure

```
magppie-wood-bom/
├── README.md
├── docs/
│   ├── AI_MEMORY.md            ← read first
│   ├── PORTING_NOTES.md        ← read second: what changed from stone
│   ├── CHAT_SUMMARY.md         full decision history
│   ├── PROJECT_OVERVIEW.md
│   ├── BUSINESS_LOGIC.md       construction rules and formulas
│   ├── CODE_DOCUMENTATION.md   every module, type and function
│   ├── FOLDER_STRUCTURE.md     this file
│   ├── DATABASE.md             (there is no local DB — Zoho is)
│   ├── API.md
│   ├── UI_UX.md
│   ├── WORKFLOWS.md
│   ├── INTEGRATIONS.md
│   ├── ENVIRONMENT.md
│   ├── AUTHENTICATION.md
│   ├── DEPLOYMENT.md
│   ├── TESTING.md
│   ├── BUGS.md
│   ├── BACKLOG.md
│   └── artefacts/              planning spreadsheets, in order produced
│       ├── wood_kitchen_widths.xlsx
│       ├── wood_shutter_types.xlsx
│       ├── wood_shutter_types_v2.xlsx
│       ├── wood_shutter_types_v3.xlsx
│       ├── drawer_deduction_template.xlsx
│       ├── wood_kitchen_spec.xlsx
│       └── wood-bom-builder.jsx        single-file prototype
├── tools/
│   └── smoke/                  headless engine harness
│       ├── build.sh
│       ├── run.js
│       └── shim.ts
├── reference/
│   └── stone/                  the original stone app — diff against this
└── source/
    ├── package.json
    ├── package-lock.json
    ├── tsconfig.json
    ├── next.config.ts
    ├── .env.example
    ├── .gitignore
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── globals.css
        │   ├── page.tsx                landing
        │   ├── builder/page.tsx
        │   ├── designer/page.tsx       soMode
        │   ├── planning/page.tsx       planningMode
        │   ├── dashboard/page.tsx
        │   ├── reorder/page.tsx
        │   ├── qr/bom/[orderId]/page.tsx
        │   └── api/
        │       ├── ai/chat/route.ts
        │       └── zoho/
        │           ├── status/route.ts
        │           ├── items/route.ts
        │           ├── items/[id]/route.ts
        │           ├── items/[id]/vendors/route.ts
        │           ├── compositeitems/route.ts
        │           ├── compositeitems/[id]/route.ts
        │           ├── salesorders/route.ts
        │           ├── salesorders/[id]/route.ts
        │           ├── contacts/route.ts
        │           ├── contacts/[id]/route.ts
        │           ├── purchaseorders/route.ts
        │           ├── po-vendor-map/route.ts
        │           └── reorder-report/route.ts
        ├── components/
        │   ├── WoodBomBuilder.tsx      ← the builder
        │   ├── BomDashboard.tsx        ported + renamed
        │   ├── BomOrderCard.tsx        verbatim
        │   ├── ReorderReport.tsx       verbatim
        │   ├── DraftPoModal.tsx        verbatim
        │   ├── QrBomPage.tsx           verbatim
        │   ├── AiCopilot.tsx           verbatim
        │   └── AuthGate.tsx            verbatim — NAMED export
        ├── lib/
        │   ├── rawmaterial.ts          ported + renamed
        │   ├── export.ts               ported + renamed
        │   ├── naming.ts               verbatim
        │   ├── types.ts                verbatim
        │   ├── stock.ts                verbatim
        │   ├── zoho.ts                 verbatim
        │   └── report.ts               verbatim
        └── data/
            ├── board_finishes.json
            ├── laminate_finishes.json
            └── edgeband_finishes.json
```
