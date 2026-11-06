"use client";
import { defaultStockForGroup, type ProductionGroup, type StockSettings } from "@/lib/production-optimizer";

export function OptiMaterialOptions({ groups, settings, onChange, busy = false }: { groups: ProductionGroup[];
  settings: Record<string, Partial<StockSettings>>; onChange: (key: string, patch: Partial<StockSettings>) => void; busy?: boolean }) {
  return <section aria-label="Opti raw material options">
    <h4>Opti options — raw materials</h4>
    <p>Grain pattern locks panel orientation along the stock length. Quantity first sorts the most-used sizes first; Length first sorts descending panel length. Extra stock prefers regular panels matching the cut lengths already on that sheet, then other regular panels, then fillers. The selected priority applies within each group. It fills only existing offcuts with the same material’s parts and never buys more stock. Hardware and liquids are not cuttable.</p>
    <p>Glass, stone and profiles can be enabled after confirming stock sizes. Foil stays a 1420 mm wide, variable-length roll. Profiles are linear stock and cannot rotate sideways. Extra processing is estimated separately at the entered rate, or the part’s defined processing rate; missing rates are shown as not defined.</p>
    <div style={{ overflowX: "auto" }}><table className="production-table"><thead><tr>
      {["Material / finish / thickness", "Optimize", "Grain pattern", "Overproduction / extra stock", "Priority", "Stock length mm", "Stock width mm", "Kerf mm", "Trim mm", "Extra processing ₹/sqft (₹/m for profiles)"].map(label => <th key={label}>{label}</th>)}
    </tr></thead><tbody>{groups.map(g => {
      const s = { ...defaultStockForGroup(g), ...settings[g.key] };
      const title = `${g.material} ${g.finish} ${g.thickness}mm`;
      return <tr key={g.key}><td>{g.material} · {g.finish} · {g.thickness || "—"} mm · {g.kind}</td>
        <td><input type="checkbox" aria-label={`${title} optimize`} checked={s.enabled !== false} disabled={busy} onChange={e => onChange(g.key, { enabled: e.target.checked })} /></td>
        <td><input type="checkbox" aria-label={`${title} grain pattern`} checked={s.grainLocked} disabled={busy} onChange={e => onChange(g.key, { grainLocked: e.target.checked })} /></td>
        <td><input type="checkbox" aria-label={`${title} overproduction`} checked={s.overproduction ?? false} disabled={busy} onChange={e => onChange(g.key, { overproduction: e.target.checked })} /></td>
        <td><select aria-label={`${title} cutting priority`} disabled={busy} value={s.priority ?? "quantity"} onChange={e => onChange(g.key, { priority: e.target.value as StockSettings["priority"] })}>
          <option value="quantity">Quantity first ↓</option><option value="length">Length first ↓</option>{s.priority === "auto" && <option value="auto">Existing automatic plan</option>}
        </select></td>
        {(["length", "width", "kerf", "trim"] as const).map(field => <td key={field}>{g.kind === "foil" ? field === "width" ? "1420 (fixed)" : field === "length" ? "Variable" : "0"
          : g.kind === "profile" && field === "width" ? "Linear stock" : <input style={{ width: 90 }} aria-label={`${title} ${field}`} type="number" min={0} step="any" disabled={busy} value={s[field] || ""}
            onChange={e => onChange(g.key, { [field]: Number(e.target.value) })} />}</td>)}
        <td><input style={{ width: 100 }} aria-label={`${title} extra processing rate`} type="number" min={0} step="any" placeholder="Part rate / not defined" disabled={busy} value={s.extraProcessingRate ?? ""}
          onChange={e => onChange(g.key, { extraProcessingRate: e.target.value === "" ? undefined : Number(e.target.value) })} /></td>
      </tr>;
    })}</tbody></table></div>
  </section>;
}
