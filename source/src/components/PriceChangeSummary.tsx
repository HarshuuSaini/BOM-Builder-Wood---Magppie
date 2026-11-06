import { groupPriceChanges, type PriceChange } from "@/lib/price-change-audit";
const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
export function PriceChangeSummary({ changes, title = "Material prices — changes and reasons" }: { changes: PriceChange[]; title?: string }) {
  const rows = groupPriceChanges(changes);
  return <section aria-label={title} style={{ marginTop: 20 }}><h3>{title}</h3>
    {!rows.length ? <p>No price changes recorded for this kitchen.</p> : <div style={{ overflowX: "auto" }}><table className="costing-comparison"><thead><tr>
      {["Material / item", "Price for", "Unit", "Default price", "Changed price", "Reason for changing"].map(h => <th key={h}>{h}</th>)}
    </tr></thead><tbody>{rows.map(row => <tr key={row.id}><th style={{ whiteSpace: "normal", minWidth: 180 }}>{row.material}</th><td>{row.rateType}</td>
      <td>{row.unit}</td><td>{row.defaultPrice === null ? "Not defined" : money(row.defaultPrice)}</td>
      <td>{money(row.changedPrice)}{row.previousPrice !== undefined && <small style={{ display: "block" }}>Previously {money(row.previousPrice)}</small>}</td>
      <td style={{ whiteSpace: "pre-wrap", minWidth: 200 }}>{row.reason.trim() ? row.reason : "Reason not recorded"}</td></tr>)}</tbody></table></div>}
  </section>;
}
