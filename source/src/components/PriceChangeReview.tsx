"use client";
import { groupPriceChanges, type PriceChange } from "@/lib/price-change-audit";
import { useEffect, useRef, useState } from "react";
const amount = (n: number | null) => n === null ? "Not defined" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 6 })}`;
/** Keep the exact text under the caret independent of derived audit summaries. */
export function PriceReasonInput({ value, required, label, onChange }: { value: string; required: boolean; label: string; onChange: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return <textarea required={required} aria-label={label} value={draft} placeholder={!required ? "Reason not recorded (existing price)" : "Why is this price changing? Required"}
    onFocus={() => { focused.current = true; }}
    onChange={e => { const text = e.target.value; setDraft(text); onChange(text); }}
    onBlur={() => { focused.current = false; onChange(draft); }}
    style={{ minWidth: 240, width: "100%", boxSizing: "border-box", padding: 9, border: `1px solid ${!draft.trim() && required ? "#b46a43" : "#c8d8ce"}`, borderRadius: 6, font: "inherit" }} />;
}
export function PriceChangeReview({ changes, onReason, accessoriesReadOnly = false }: { changes: PriceChange[]; onReason: (keys: string[], reason: string) => void; accessoriesReadOnly?: boolean }) {
  if (!changes.length) return null;
  return <section className="price-review" aria-label="Price change reasons" style={{ width: "100%", background: "#fff", padding: 16, border: "1px solid #d8e3dc", borderRadius: 10, boxSizing: "border-box" }}>
    <h3 style={{ margin: "0 0 6px" }}>Price changes — reasons required</h3><p>Explain each changed price before saving. The default, changed price and reason are saved with this kitchen and shown in comparison.</p>
    <div style={{ overflowX: "auto", maxHeight: 400 }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr>{["Material / item", "Price for", "Default", "Changed", "Reason"].map(h => <th key={h} style={{ textAlign: "left", padding: 8 }}>{h}</th>)}</tr></thead><tbody>
      {groupPriceChanges(changes).map(c => <tr key={JSON.stringify(c.keys)}><td style={{ padding: 8 }}>{c.material}<small style={{ display: "block" }}>{c.unit}</small></td><td style={{ padding: 8 }}>{c.rateType}</td><td style={{ padding: 8, whiteSpace: "nowrap" }}>{amount(c.defaultPrice)}</td><td style={{ padding: 8, whiteSpace: "nowrap" }}>{amount(c.changedPrice)}{c.previousPrice !== undefined && <small style={{ display: "block" }}>Previously {amount(c.previousPrice)}</small>}</td>
        <td style={{ padding: 8 }}>{accessoriesReadOnly && changes.some(change => c.keys.includes(change.key) &&
          (/^(accessory|linked-accessory-edit)\./.test(change.key) || change.key.startsWith("Purchase.") && /^Accessory\b/i.test(change.label)))
          ? <span>{c.reason || "Enter the reason beside the accessory price."}</span>
          : <PriceReasonInput required={c.required} label={`Reason for ${c.material} ${c.rateType}`} value={c.reason}
            onChange={text => onReason(c.keys, text)} />}</td></tr>)}
    </tbody></table></div>
  </section>;
}
