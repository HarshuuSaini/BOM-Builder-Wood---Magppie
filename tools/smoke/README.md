# Smoke harness

Runs the BOM engine without React, Next or npm dependencies. This is how the
`FullBomRow._type` omission and the drawer-front defect were found.

```bash
./build.sh     # regenerate core.ts from the component and transpile
node run.js
```

`build.sh` takes everything in `WoodBomBuilder.tsx` above
`export function WoodBomBuilder`, strips the imports, substitutes `shim.ts` for
`naming.ts`, and transpiles with `tsc`. Re-run it after any engine change.

## Reference assertion

A `BC.SH` 600 × 720 × 560 on board option A must yield **22.978 sqft** and
**11.806 RMT**. If it does not and you did not intend it, stop.
