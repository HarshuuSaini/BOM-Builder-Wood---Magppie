"use client";
import { useState } from "react";
import type { CostingComparisonData } from "@/lib/costing-comparison";
import { PriceChangeSummary } from "@/components/PriceChangeSummary";
import { ComparisonServiceRateEditor } from "@/components/ComparisonServiceRateEditor";
const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
function ComparisonPrices({ columns, amounts, present, highlight = false }: { columns: CostingComparisonData["columns"]; amounts: number[]; present?: boolean[]; highlight?: boolean }) {
  const different = highlight && columns.every(c => c.hasSnapshot) && Math.max(...amounts) - Math.min(...amounts) > 0.005;
  return <>{amounts.map((value, i) => <td key={columns[i].id} className={different ? "comparison-different" : undefined}>{!columns[i].hasSnapshot ? "Not available" : present && !present[i] ? "—" : money(value)}</td>)}
    <td className={different ? "comparison-different" : undefined}>{columns.every(c => c.hasSnapshot) ? money(Math.max(...amounts) - Math.min(...amounts)) : "—"}</td></>;
}
export function ComparisonCategory({ category, data, simple = false }: { category: CostingComparisonData["categories"][number]; data: CostingComparisonData; simple?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const rows = data.breakdowns[category];
  const regionId = `comparison-${category.replace(/[^a-z0-9]/gi, "-")}`;
  return <tbody>
    <tr><th><button type="button" className="comparison-category-toggle" aria-expanded={expanded} aria-controls={regionId}
      onClick={() => setExpanded(value => !value)}><span aria-hidden="true">{expanded ? "▾" : "▸"}</span> {category}</button></th>
      <ComparisonPrices columns={data.columns} amounts={data.columns.map(c => c.totals[category])} highlight={simple} /></tr>
    {expanded && <tr id={regionId}><td colSpan={data.columns.length + 2} className="comparison-category-detail">
      <section aria-label={`${category} material comparison`}>
        <h3>{category === "Accessories" ? "Accessories — individual prices" : `${category} — material breakdown`}</h3>
        <table className="costing-comparison"><thead><tr><th>Material / component</th>{data.columns.map(c => <th key={c.id}>{c.name}</th>)}<th>{simple ? "Difference" : "Highest − lowest"}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.key}><th style={{ whiteSpace: "normal", minWidth: 260 }}>
            {row.name}<small style={{ display: "block", fontWeight: 400, color: "#607168" }}>{row.component}{row.thicknessMm !== null ? ` · ${row.thicknessMm} mm` : ""}</small>
          </th><ComparisonPrices columns={data.columns} amounts={row.amounts} present={row.present} highlight={simple} /></tr>)}
          {!rows.length && <tr><td colSpan={data.columns.length + 2}>{category === "Accessories" ? "No priced accessories in the selected saved costings." : "No saved items in this category."}</td></tr>}
          </tbody>
        </table>
      </section>
    </td></tr>}
  </tbody>;
}
export const SIMPLE_COMPARISON_GROUPS = [
  { name: "Materials", categories: ["Carcass", "Shutter", "Visible side", "Drawer", "Counter ply", "Laminate", "Edge band", "Consumables / other"] },
  { name: "Hardware & profiles", categories: ["Hardware", "Hinges", "Handles", "Profiles", "Lighting"] },
  { name: "Accessories", categories: ["Accessories"] },
  { name: "Processing", categories: ["Processing"] },
] as const;
export function SimpleComparisonGroup({ group, data }: { group: typeof SIMPLE_COMPARISON_GROUPS[number]; data: CostingComparisonData }) {
  const [expanded, setExpanded] = useState(false);
  const categories = group.categories.filter(category => data.breakdowns[category].some(row => row.amounts.some(amount => amount !== 0)));
  const regionId = `simple-comparison-${group.name.replace(/[^a-z0-9]/gi, "-")}`;
  if (!categories.length) return null;
  if (group.name === "Accessories") return <ComparisonCategory category="Accessories" data={data} simple />;
  return <tbody><tr><th><button type="button" className="comparison-category-toggle" aria-expanded={expanded} aria-controls={regionId}
    onClick={() => setExpanded(value => !value)}><span aria-hidden="true">{expanded ? "▾" : "▸"}</span> {group.name}</button></th>
    <ComparisonPrices columns={data.columns} amounts={data.columns.map(column => group.categories.reduce((sum, category) => sum + column.totals[category], 0))} highlight /></tr>
    {expanded && <tr id={regionId}><td colSpan={data.columns.length + 2} className="comparison-category-detail"><table className="costing-comparison">
      <thead><tr><th>Category</th>{data.columns.map(column => <th key={column.id}>{column.name}</th>)}<th>Difference</th></tr></thead>
      {categories.map(category => <ComparisonCategory key={category} category={category} data={data} simple />)}
    </table></td></tr>}
  </tbody>;
}
export function ProjectPricingComparison({ data, onUpdated }: { data: CostingComparisonData; onUpdated?: () => Promise<void> }) {
  if (onUpdated) return <ComparisonServiceRateEditor key={data.columns.map(column => `${column.id}:${column.version}`).join("|")} data={data} onUpdated={onUpdated} />;
  const rows = [
    { key: "transportation", label: "Transportation" }, { key: "installation", label: "Installation" },
    { key: "loading", label: "Loading / unloading" }, { key: "combined", label: "Items + services subtotal" },
    { key: "conversion", label: "Conversion margin" },
    { key: "subtotal", label: "Subtotal before tax" }, { key: "tax", label: "GST (18%)" }, { key: "total", label: "Final project price" },
  ] as const;
  function rateLabel(column: CostingComparisonData["columns"][number], key: typeof rows[number]["key"]) {
    const rates = column.projectPricing.rates;
    if (key === "transportation" || key === "installation" || key === "loading") {
      const rate = rates[key]; return rate ? `${money(rate.value)}${rate.mode === "sqft" ? " / sqft" : " direct charge"}` : "";
    }
    if (key === "conversion") {
      const rate = rates.conversionPct;
      return rate === null ? "" : `${Number(rate.toFixed(4))}% margin · combined cost ÷ (1 − margin)`;
    }
    return key === "tax" ? rates.includeTax ? "Included" : "Not included" : "";
  }
  return <tbody><tr><th colSpan={data.columns.length + 2} style={{ background: "#eef4f0" }}>Services & final price</th></tr>
    {rows.map(row => {
      const amounts = data.columns.map(column => column.projectPricing[row.key]);
      const different = data.columns.every(column => column.hasSnapshot) && Math.max(...amounts) - Math.min(...amounts) > 0.005;
      return <tr key={row.key} className={row.key === "total" ? "comparison-item-total" : undefined}><th>{row.label}</th>
        {data.columns.map(column => <td key={column.id} className={different ? "comparison-different" : undefined}>
          {column.hasSnapshot ? <>{money(column.projectPricing[row.key])}<small style={{ display: "block", fontWeight: 400 }}>{rateLabel(column, row.key)}</small></> : "Not available"}
        </td>)}<td className={different ? "comparison-different" : undefined}>{data.columns.every(column => column.hasSnapshot) ? money(Math.max(...amounts) - Math.min(...amounts)) : "—"}</td>
      </tr>;
    })}</tbody>;
}
export function CostingComparison({ data, onClose, onPricingUpdated, onRefresh }: { data: CostingComparisonData; onClose: () => void; onPricingUpdated?: () => Promise<void>; onRefresh?: () => void }) {
  const [version, setVersion] = useState<1 | 2>(2);
  const { columns, categories } = data;
  const prices = (amounts: number[]) => <ComparisonPrices columns={columns} amounts={amounts} highlight={version === 2} />;
  const headers = <tr><th>{version === 2 ? "Cost group" : "Category / price"}</th>{columns.map(c => <th key={c.id}>{c.name}<small style={{ display: "block" }}>Saved version {c.version}</small></th>)}<th>{version === 2 ? "Difference" : "Highest − lowest"}</th></tr>;
  return <section aria-label="Kitchen comparison" style={{ marginTop: 24 }}>
    <style>{`.comparison-category-toggle{display:flex;gap:8px;align-items:center;border:0;background:transparent;color:#17645b;font:inherit;font-weight:650;padding:3px 0;cursor:pointer;text-align:left}.comparison-category-toggle:hover{text-decoration:underline}.comparison-category-toggle:focus-visible{outline:2px solid #17645b;outline-offset:4px;border-radius:3px}.costing-comparison td.comparison-category-detail{padding:16px;background:#f6faf7;white-space:normal}.comparison-category-detail h3{margin:0 0 12px}.comparison-category-detail table{background:white}.comparison-close{float:right;border:1px solid #bad0c2;border-radius:8px;background:white;color:#245a49;padding:9px 15px;font:inherit;cursor:pointer}`}</style>
    <button type="button" className="comparison-close" onClick={onClose}>Close comparison</button><h2>Kitchen price comparison</h2>
    <style>{`.comparison-version-switch{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.comparison-version-switch button{border:1px solid #bad0c2;border-radius:8px;background:white;color:#245a49;padding:9px 15px;font:inherit;cursor:pointer}.comparison-version-switch button[aria-pressed=true]{background:#17645b;color:white;border-color:#17645b}.comparison-version-switch button:focus-visible{outline:2px solid #17645b;outline-offset:3px}.costing-comparison td.comparison-different{background:#fff4d9;color:#734e0c;font-weight:600}.comparison-item-total th,.comparison-item-total td{font-weight:700;background:#e9f3ed}.comparison-price-changes{margin-top:20px}.comparison-price-changes>summary{cursor:pointer;color:#17645b;font-weight:650}`}</style>
    <div className="comparison-version-switch" role="group" aria-label="Comparison version">
      <button type="button" aria-pressed={version === 2} onClick={() => setVersion(2)}>Version 2 · Simple</button>
      <button type="button" aria-pressed={version === 1} onClick={() => setVersion(1)}>Version 1 · Detailed</button>
      {onRefresh && <button type="button" onClick={onRefresh}>Refresh comparison</button>}
    </div>
    <p>{version === 2 ? `Expand a cost group to see its materials. Accessories are shown separately; expand Accessories to see every priced item. Only differences are highlighted.${columns.length > 2 ? " Difference shows the highest minus the lowest cost." : ""}` : "Saved prices per kitchen. Expand a category to compare its materials and components. Processing is shown separately. Accessories include priced items only. Each cost is counted once."}</p>
    {columns.filter(c => !c.hasSnapshot).map(c => <p key={c.id} role="alert">{c.name}: no saved item breakdown. Open and save the costing to compare it.</p>)}
    <div style={{ overflowX: "auto" }}><table className="costing-comparison"><thead>{headers}</thead>
      <tbody><tr><th>Total sqft</th>{columns.map(c => <td key={c.id}>{c.areaSqft.toFixed(2)} sqft</td>)}<td>—</td></tr></tbody>
      {version === 2 ? SIMPLE_COMPARISON_GROUPS.map(group => <SimpleComparisonGroup key={group.name} group={group} data={data} />)
        : categories.map(category => <ComparisonCategory key={category} category={category} data={data} />)}
      <tbody>
      {columns.some(c => Math.abs(c.adjustment) > 0.01) && <tr><th>Saved total adjustment</th>{prices(columns.map(c => c.adjustment))}</tr>}
      <tr className="comparison-item-total"><th>{version === 2 ? "Total item cost" : "Item cost total"}</th>{prices(columns.map(c => c.itemCost))}</tr>
      {version === 1 && <>
      <tr><th>Item cost / visible sqft</th>{columns.map(c => <td key={c.id}>{c.hasSnapshot && c.areaSqft > 0 ? money(c.itemCost / c.areaSqft) : "—"}</td>)}<td>—</td></tr>
      </>}
    </tbody><ProjectPricingComparison data={data} onUpdated={onPricingUpdated} /></table></div>
    {version === 2 ? columns.some(c => c.priceChanges.length > 0) && <details className="comparison-price-changes"><summary>Price changes</summary>
      {columns.filter(c => c.priceChanges.length > 0).map(c => <PriceChangeSummary key={c.id} changes={c.priceChanges} title={`${c.name} — price changes and reasons`} />)}</details>
      : columns.filter(c => c.priceChanges.length > 0).map(c => <PriceChangeSummary key={c.id} changes={c.priceChanges} title={`${c.name} — price changes and reasons`} />)}
    {columns.filter(c => c.unpriced.length).map(c => <p key={c.id}>{c.name} — rates awaiting definition: {c.unpriced.join(", ")}</p>)}
  </section>;
}
