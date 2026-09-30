# Dependencies

Single Node package at `source/package.json`. No Python, PHP, Go, Rust or
Flutter components. `package-lock.json` is committed — use `npm ci` for
reproducible installs.

## Runtime

| Package | Version | Purpose |
|---|---|---|
| `next` | 16.2.6 | Framework, App Router |
| `react` | 19.2.6 | UI |
| `react-dom` | 19.2.6 | DOM renderer |
| `xlsx` | 0.18.5 | Sheet primitives |
| `xlsx-js-style` | ^1.2.0 | Excel export with row fills — reads `FullBomRow._type` |
| `jspdf` | ^4.2.1 | Packing slips |
| `jsbarcode` | ^3.12.3 | Barcodes |
| `qrcode` | ^1.5.4 | QR codes for `/qr/bom/[orderId]` |

## Development

| Package | Version | Purpose |
|---|---|---|
| `typescript` | 5.9.3 | |
| `@types/node` | 24.10.1 | |
| `@types/react` | 19.2.7 | |
| `@types/react-dom` | 19.2.3 | |
| `@types/qrcode` | ^1.5.6 | |
| `eslint` | 9.39.1 | |
| `eslint-config-next` | 16.2.6 | |
| `@next/swc-wasm-nodejs` | 16.2.6 | **WASM compiler — see below** |
| `@next/swc-wasm-web` | 16.2.4 | |

## Overrides

```json
"overrides": { "postcss": "8.5.14" }
```

Pinned in stone; carried over. Do not remove without testing the build.

## The WASM compiler

Inherited from stone and easy to break by accident. The scripts run Next on the
WASM compiler rather than the native SWC binary:

```
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs next dev --webpack
```

Keep both `--webpack` and `NEXT_TEST_WASM_DIR`. Removing either makes Next
reach for a native binary. Builds are slower than a stock Next project as a
result — that is expected, not a fault.

## Not used

No database driver, ORM, state library, CSS framework, component library, test
runner, or HTTP client. Data fetching is plain `fetch`; styling is a `<style>`
block inside `WoodBomBuilder.tsx` plus `globals.css`.

## Node

**20+** required by Next 16 / React 19.

## Install

```bash
cd source
npm ci        # preferred — respects the lockfile
npm install   # if the lockfile is stale
```

Behind a restrictive proxy the install may 403 on transitive packages. That is
a network policy issue, not a project one.
