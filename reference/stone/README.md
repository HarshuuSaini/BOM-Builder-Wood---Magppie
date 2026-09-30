# Magppie Carcass BOM Builder — AI Handover Package

**Complete, self-contained handover.** Everything an engineer *or an AI assistant* needs to continue this project with zero additional context: full source, exhaustive documentation, every business rule, the entire decision history, and the operational runbook.

> **Live:** https://inventory-magppie.vercel.app · **Stack:** Next.js 16 · React 19 · TypeScript 5.9 · Node 24 · Zoho Inventory (India) · Vercel

---

## 🚀 If you are an AI, read in this order

| # | File | Why |
|---|---|---|
| 1 | **`docs/AI_MEMORY.md`** | Working rules, philosophy, coding standards, all constants, non-negotiables. **Start here.** |
| 2 | `docs/PROJECT_OVERVIEW.md` | Vision, scope, features, modules, roles, status, roadmap |
| 3 | `docs/APP_ARCHITECTURE_FULL.md` | The map: file tree, data model, pipeline, integrations |
| 4 | `docs/CHAT_SUMMARY.md` | Every requirement, decision, reversal and rejected idea, in order |
| 5 | `docs/BUSINESS_LOGIC.md` | Every important function: purpose, formula, edge cases |
| 6 | `docs/requirements.md` | 461 classified requirements (UJ/BR/AC/DC) — rebuild-grade spec |
| 7 | `docs/BACKLOG.md` | What's done, what's next, what's blocked |

Then dip into `API.md`, `DATABASE.md`, `UI_UX.md`, `WORKFLOWS.md`, `INTEGRATIONS.md`, `AUTHENTICATION.md`, `TESTING_AND_BUGS.md` as needed.

---

## What this product does

A user configures a kitchen cabinet (zone → family → variant → size, handle, design, materials). The app derives, from that single configuration:

- a canonical **11-field cabinet code** + per-leaf **shutter codes**
- a complete multi-level **BOM** — stone panels, aluminium profiles, hardware packs, consumables, cut/drill operations
- **purchase roll-ups** with waste (+15% stone, +20% profile) and weight (3.45 / 1.38 kg per sqft)
- factory outputs — **Full BOM Excel, Opti/cut lists, OOS, packing lists, labels, QR, CSV**
- idempotent **Zoho Inventory** composite items and Sales-Order lines

Plus: a multi-SO **BOM backorder dashboard**, a **re-order report** with draft POs, a **designer** page (shutter colours per price group against a live SO), and a **planning** page (replace SO service lines with real BOMs).

---

## Package contents

```
magppie-bom-handover/
├── README.md                    ← you are here
├── .env.example                 ← env template (placeholders only — no secrets)
├── source/                      ← COMPLETE source, structure preserved
│   ├── src/                     ← app, components, lib, data
│   ├── scratch/test-drawers.js  ← the automated test gate
│   ├── package.json  package-lock.json  tsconfig.json  next.config.ts  .gitignore
└── docs/
    ├── AI_MEMORY.md             ← ★ read first
    ├── PROJECT_OVERVIEW.md      ← vision, scope, features, roles, roadmap
    ├── CHAT_SUMMARY.md          ← full decision history incl. rejected ideas
    ├── APP_ARCHITECTURE_FULL.md ← architecture map
    ├── ARCHITECTURE.md          ← concise business-logic brief
    ├── requirements.md          ← 461 requirements (UJ/BR/AC/DC)
    ├── FOLDER_STRUCTURE.md      ← directory tree + what lives where
    ├── BUSINESS_LOGIC.md        ← every function documented
    ├── WORKFLOWS.md             ← every workflow, step by step
    ├── API.md                   ← every endpoint (request/response/errors/curl)
    ├── DATABASE.md              ← Zoho data model, custom fields, TS models, seed data
    ├── UI_UX.md                 ← every screen, component, design system, flows
    ├── INTEGRATIONS.md          ← Zoho OAuth, OpenAI, Vercel + setup & troubleshooting
    ├── AUTHENTICATION.md        ← auth model + honest security posture + hardening plan
    ├── ENVIRONMENT.md           ← every env var explained
    ├── TESTING_AND_BUGS.md      ← test gate, manual checklist, proposed tests, known bugs
    └── BACKLOG.md               ← prioritized backlog + blockers
```

---

## Installation

**Prerequisites:** Node **24+**, npm, a Zoho Inventory (India) org, Vercel CLI (only to deploy).

```bash
# 1. Put the source in place
cp -r source/ "Inventory - Magppie/" && cd "Inventory - Magppie"

# 2. Install
npm install

# 3. Configure
cp ../.env.example .env.local     # then fill in real values — see docs/ENVIRONMENT.md
```

## Running locally

```bash
npm run dev -- -p 3007            # port 3000 is often taken by another project
```
- Builder → http://localhost:3007/builder
- Dashboard → http://localhost:3007/ · Designer → `/designer` · Planning → `/planning` · Re-order → `/reorder`
- Health → http://localhost:3007/api/zoho/status

> First screen is a **password gate**. The accepted value is a constant in `src/components/AuthGate.tsx` (see `docs/AUTHENTICATION.md` — this is a known security issue, not a real auth system).

## Build

```bash
npm run build     # Next.js production build (webpack + wasm SWC — pinned in package.json)
npm start         # serve the build
```

## The verification loop (run before every commit/deploy — non-negotiable)

```bash
npx tsc --noEmit                  # must be silent
node scratch/test-drawers.js      # must print: ALL TESTS PASSED SUCCESSFULLY!
npm run build                     # must complete
```

## Deployment

```bash
vercel --prod --yes               # ONLY when explicitly authorized
```
Full runbook, rollback, monitoring and backup: **`docs/DEPLOYMENT.md`**.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **"This isn't the app I expect" on localhost** | port 3000 owned by another project | `lsof -a -p $(lsof -ti:3000 -sTCP:LISTEN) -d cwd`; run `npm run dev -- -p 3007` |
| **"Zoho token refresh is cooling down…"** | a refresh was rejected → 5-min cooldown | wait; if it repeats the refresh token is dead → re-issue (`docs/INTEGRATIONS.md`) |
| **`invalid_code`** on Zoho | dead token or wrong data centre | token must come from the **India** console (`accounts.zoho.in`) |
| **`Missing ZOHO_… Add it to .env.local`** | env var absent | see `docs/ENVIRONMENT.md` |
| **A 15 mm stone resolves to a 6 mm slab** | Zoho lacks that finish at that thickness | the resolver does core-name matching; add the item in Zoho or pick manually |
| **Copilot: "OpenAI API Key not configured"** | `OPENAI_API_KEY` unset | optional feature — set it or ignore |
| **Project lost after refresh** | no persistence (known) | rebuild; see backlog item 37 |
| **Build fails on SWC** | wasm binary/env | `npm i` then use the provided npm scripts (they set `NEXT_TEST_WASM_DIR`) |

## FAQs

**Where is the database?** There isn't one. **Zoho Inventory (India) is the system of record.** The app holds state in memory and writes composites/SO lines to Zoho. See `docs/DATABASE.md`.

**Why is one file 11,200 lines?** `CarcassBomBuilder.tsx` grew as the domain engine. It's a known maintainability risk (backlog P2). Change it with targeted greps + ranged reads, never a full rewrite.

**Why must `scratch/test-drawers.js` pass?** It's the only automated gate. It **mirrors** drawer/shutter logic — if you change `addDrawerBoxes`/`shutSpec`, update the mirror **and** its assertions.

**Can I change a cabinet code format?** Only deliberately. Codes are baked into **Zoho item names** and idempotency matches on name — a format change creates new items (this happened, accepted, for the P7 → `XXX` change).

**Is it safe to test against Zoho locally?** It writes to the **real** org — there is no sandbox. Be deliberate.

**Is the app secure?** No. Auth is a client-side password and **all `/api` routes are unauthenticated**. See `docs/AUTHENTICATION.md` for the honest posture and the hardening plan (backlog P0).

**Where do I change a business rule?** Find its single source: countertop → `ctGeom`/`CT_TYPES`; drawers → `addDrawerBoxes`; shutters → `buildShutters`/`shDeduct`/`validDesigns`; sizes → the `SIZES` table. Then run the loop.

---

## Security notice

This package contains **no secrets** — `.env*`, logs, `.vercel/`, and helper scripts with credentials were excluded and the bundle was swept. `.env.example` uses placeholders only. Before going further, rotate the Zoho refresh token and read `docs/AUTHENTICATION.md`.
