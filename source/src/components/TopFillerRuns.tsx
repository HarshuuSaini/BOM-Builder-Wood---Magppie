"use client";
import { useState } from "react";
import { mergeTopFillers, type TopFillerMerge, type TopFillerPiece, type TopFillerSegment } from "@/lib/top-fillers";

export function TopFillerRuns({ segments, pieces, merges, onChange }: { segments: TopFillerSegment[]; pieces: TopFillerPiece[];
  merges: TopFillerMerge[]; onChange: (value: TopFillerMerge[]) => void }) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const runs = new Map<string, TopFillerSegment[]>();
  for (const s of segments) runs.set(s.runKey, [...(runs.get(s.runKey) ?? []), s]);
  return <section aria-label="Automatic top filler runs">
    <h4>Automatic top fillers</h4>
    <p className="hint">Full lengths are included in costing. Expand a run to select and merge its pieces. Unselected pieces remain combined; one remaining piece stays separate. Different materials/finishes cannot be merged. Long runs must fit the chosen cutting stock; no joints are added automatically.</p>
    {!runs.size && <p className="hint">No eligible cabinets. Enable top fillers, select Wall/Tall cabinets and set the height on Material Selection.</p>}
    {[...runs].map(([runKey, members]) => {
      const first = members[0];
      const cuts = pieces.filter(p => p.runKey === runKey);
      const checked = (selected[runKey] ?? []).filter(id => members.some(s => s.id === id));
      return <details key={runKey} style={{ border: "1px solid #d6dfd8", borderRadius: 6, padding: 10, marginBottom: 10 }}>
        <summary>{first.elevation || "No elevation"} · {first.zone === "wall" ? "Wall" : "Tall"} · {first.finish} · Full length {members.reduce((sum, s) => sum + s.width, 0)} mm × {first.height} mm · {cuts.length} {cuts.length === 1 ? "piece" : "pieces"}</summary>
        <div style={{ display: "flex", gap: 10, margin: "12px 0", flexWrap: "wrap" }}>
          <button type="button" disabled={checked.length < 2} onClick={() => { onChange(mergeTopFillers(merges, runKey, checked)); setSelected(old => ({ ...old, [runKey]: [] })); }}>Merge selected ({checked.length})</button>
          <button type="button" disabled={!merges.some(m => m.runKey === runKey)} onClick={() => { onChange(merges.filter(m => m.runKey !== runKey)); setSelected(old => ({ ...old, [runKey]: [] })); }}>Reset to one combined run</button>
        </div>
        {cuts.map((piece, index) => <fieldset key={piece.id} style={{ marginBottom: 12 }}>
          <legend>{piece.members.length > 1 ? "Combined top filler" : "Separate top filler"} {index + 1} · {piece.width} × {piece.height} mm</legend>
          <table style={{ width: "100%", textAlign: "left" }}><thead><tr><th>Select</th><th>Cabinet / filler</th><th>Width (mm)</th><th>Height (mm)</th></tr></thead>
            <tbody>{piece.members.map(s => <tr key={s.id}><td><input type="checkbox" aria-label={`Select top filler ${s.label}`} checked={checked.includes(s.id)}
              onChange={event => { const enabled = event.target.checked; setSelected(old => ({ ...old, [runKey]: enabled ? [...new Set([...(old[runKey] ?? []), s.id])] : (old[runKey] ?? []).filter(id => id !== s.id) })); }} /></td>
              <td>{s.label}</td><td>{s.width}</td><td>{s.height}</td></tr>)}</tbody>
          </table>
        </fieldset>)}
      </details>;
    })}
  </section>;
}
