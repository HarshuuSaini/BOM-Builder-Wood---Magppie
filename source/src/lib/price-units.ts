/** Price units, not quantities or line totals. Unknown pack/piece ratios are never guessed. */
export function priceUnit(value: string): string {
  const unit = value.replace(/^₹\s*\/?\s*/, "").trim().toLowerCase().replace(/²/g, "2").replace(/[.\s_]/g, "");
  if (["sqft", "sqfeet", "ft2", "squarefeet", "squarefoot"].includes(unit)) return "sqft";
  if (["sqm", "sqmeter", "sqmetre", "m2", "squaremeter", "squaremetre"].includes(unit)) return "sqm";
  if (["mtr", "rmt", "m", "meter", "metre", "meters", "metres"].includes(unit)) return "m";
  if (["g", "gm", "gms", "gram", "grams"].includes(unit)) return "g";
  if (["kg", "kgs", "kilogram", "kilograms"].includes(unit)) return "kg";
  if (["nos", "no", "pc", "pcs", "piece", "pieces", "each"].includes(unit)) return "piece";
  if (["set", "sets"].includes(unit)) return "set";
  if (["sheet", "sheets"].includes(unit)) return "sheet";
  if (["slab", "slabs"].includes(unit)) return "slab";
  return unit;
}

export function rateInUnit(rate: number, from: string, to: string, stockAreaSqft?: number): number | undefined {
  const source = priceUnit(from), target = priceUnit(to);
  if (source === target) return rate;
  const factors: Record<string, { dimension: string; factor: number }> = {
    sqft: { dimension: "area", factor: 1 }, sqm: { dimension: "area", factor: 1_000_000 / 92903.04 },
    m: { dimension: "length", factor: 1 }, mm: { dimension: "length", factor: 0.001 }, cm: { dimension: "length", factor: 0.01 },
    ft: { dimension: "length", factor: 0.3048 }, inch: { dimension: "length", factor: 0.0254 },
    kg: { dimension: "mass", factor: 1 }, g: { dimension: "mass", factor: 0.001 },
  };
  if (stockAreaSqft && stockAreaSqft > 0) {
    factors.sheet = { dimension: "area", factor: stockAreaSqft };
    factors.slab = { dimension: "area", factor: stockAreaSqft };
  }
  const a = factors[source], b = factors[target];
  return a && b && a.dimension === b.dimension ? rate * b.factor / a.factor : undefined;
}
