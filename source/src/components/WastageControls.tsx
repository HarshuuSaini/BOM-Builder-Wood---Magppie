"use client";
type WasteValues = Record<"carcass" | "shutter" | "profile" | "edgeBand", number>;
export function WastageControls({ waste, overrides, onWaste, onOverrides, admin }: { waste: WasteValues; overrides?: Record<string, number>;
  onWaste: (value: WasteValues) => void; onOverrides: (value: Record<string, number>) => void; admin: boolean }) {
  const groups = [
    { label: "skirting", keys: ["KITCHEN-092", "KITCHEN-093", "KITCHEN-094", "KITCHEN-ALU-SKIRTING"], fallback: 25 },
    { label: "J handle", keys: ["KITCHEN-049"], fallback: 20 },
    { label: "C handle", keys: ["KITCHEN-050"], fallback: 15 },
    { label: "G handle", keys: ["KITCHEN-051"], fallback: 0 },
    { label: "light profile / diffuser", keys: ["KITCHEN-084", "KITCHEN-085"], fallback: 0 },
    { label: "foil", keys: ["foil:shutter", "foil:visible"], fallback: waste.shutter },
  ];
  return <div className="g3" style={{ maxWidth: 700, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
    {(["carcass", "shutter", "profile", "edgeBand"] as const).map(key => <label key={key} style={{ fontSize: 12, color: "var(--mut)" }}>{key}
      <input aria-label={`${key} waste percent`} type="number" min={0} max={99.9} step="0.1" value={waste[key]}
        onChange={e => onWaste({ ...waste, [key]: Math.min(99.9, Math.max(0, Number(e.target.value) || 0)) })} />
    </label>)}
    {admin && groups.map(group => {
      const values = group.keys.map(key => overrides?.[key] ?? group.fallback);
      const mixed = values.some(value => value !== values[0]);
      return <label key={group.label} style={{ fontSize: 12, color: "var(--mut)" }}>{group.label}
        <input aria-label={`${group.label} group waste percent`} type="number" min={0} max={99.99} step="0.01" placeholder={mixed ? "Mixed" : String(group.fallback)} value={mixed ? "" : values[0]}
          onChange={e => {
            const raw = e.target.value;
            if (raw !== "" && (!Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) >= 100)) return;
            const next = { ...overrides };
            group.keys.forEach(key => { if (raw === "") delete next[key]; else next[key] = Number(raw); });
            onOverrides(next);
          }} />
      </label>;
    })}
  </div>;
}
