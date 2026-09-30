# Reference

`stone/` is the original **Magppie Stone Kitchen BOM Builder**, unmodified.

This project is a port of it. Roughly half the files here are copied verbatim;
the rest are the same files with a mechanical `Stone → Board` rename.

**Diff against this before assuming anything is intentional.** If a wood file
looks odd, check whether stone does the same thing — it usually does, and
usually for a reason.

`stone/docs/BUSINESS_LOGIC.md` is the authoritative description of the original
construction rules, including the ones deliberately deleted for wood
(stepper profile, silicone lookup, countertop geometry, brass strip).
`docs/PORTING_NOTES.md` in the wood repo lists every deletion.
