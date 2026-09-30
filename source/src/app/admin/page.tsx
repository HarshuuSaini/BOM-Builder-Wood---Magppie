"use client";

import { useEffect, useMemo, useState } from "react";
import type { CostingMasterItem } from "@/lib/costing";

const COLUMNS: Array<{ key: keyof CostingMasterItem; label: string; numeric?: boolean }> = [
  { key: "sNo", label: "S.No", numeric: true }, { key: "elevation", label: "Elevation" },
  { key: "sourceSubgroup", label: "Source Subgroup" }, { key: "materialDescription", label: "Material Description" },
  { key: "remark", label: "Remark" }, { key: "unitCost", label: "Unit Cost", numeric: true },
  { key: "unit", label: "Unit" }, { key: "sqft", label: "SQFT", numeric: true },
  { key: "price", label: "Price", numeric: true }, { key: "sqftPrice", label: "Sq.FT Price", numeric: true },
  { key: "group", label: "Group" }, { key: "subgroup", label: "Subgroup" },
  { key: "type", label: "Type" }, { key: "brand", label: "Brand" },
  { key: "thicknessMm", label: "Thickness (mm)", numeric: true }, { key: "rateBasis", label: "Rate Basis" },
  { key: "previousRate", label: "Previous Rate", numeric: true }, { key: "currentRate", label: "Current Rate", numeric: true },
  { key: "rateChange", label: "Rate Change (₹)", numeric: true }, { key: "rateChangePercent", label: "Rate Change (%)", numeric: true },
];
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<CostingMasterItem[]>([]);
  const [source, setSource] = useState("loading…");
  const [generatedAt, setGeneratedAt] = useState("");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("All");

  useEffect(() => { fetch("/api/costing").then((r) => r.json()).then((data) => {
    setItems(Array.isArray(data?.items) ? data.items : []); setSource(data?.source ?? "local-json");
    setGeneratedAt(data?.master?.generatedAt ?? "");
  }).catch(() => setSource("unavailable")); }, []);

  const groups = useMemo(() => ["All", ...Array.from(new Set(items.map((item) => item.group))).sort()], [items]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => (group === "All" || item.group === group) &&
      (!needle || Object.values(item).some((value) => String(value ?? "").toLowerCase().includes(needle))));
  }, [group, items, query]);

  const unlock = async () => {
    const pass = password.trim(); if (!pass) return;
    setChecking(true); setMessage("");
    try {
      const response = await fetch("/api/costing", { method: "POST", headers: { "x-admin-password": pass } });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok) setUnlocked(true);
      else setMessage(response.status === 401 ? "Incorrect admin password." : data.error ?? `Could not verify (HTTP ${response.status}).`);
    } catch { setMessage("Could not reach the server."); } finally { setChecking(false); }
  };

  const input: React.CSSProperties = { padding: "8px 10px", border: "1px solid #C9D1CC", borderRadius: 4, font: "inherit", background: "#fff" };
  const page: React.CSSProperties = { minHeight: "100vh", background: "#F4F5F3", color: "#1B2430", fontFamily: 'Inter,"Segoe UI",system-ui,sans-serif', fontSize: 13, padding: 24 };

  if (!unlocked) return <main style={page}><section style={{ maxWidth: 380, margin: "80px auto", background: "white", border: "1px solid #D8DEDA", borderRadius: 6, padding: 24 }}>
    <h1 style={{ margin: "0 0 4px", fontSize: 19 }}>Admin — Costing Master</h1>
    <p style={{ color: "#66757F", fontSize: 12 }}>Enter the separate admin password to view the master rates.</p>
    <input style={{ ...input, width: "100%", boxSizing: "border-box" }} type="password" value={password} placeholder="Admin password" onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }} />
    <button style={{ width: "100%", marginTop: 12, padding: 10, border: 0, borderRadius: 4, background: "#15645A", color: "white", fontWeight: 650 }} disabled={!password.trim() || checking} onClick={() => void unlock()}>{checking ? "Checking…" : "Continue"}</button>
    {message && <p style={{ color: "#9C5510", fontSize: 12 }}>{message}</p>}
  </section></main>;

  return <main style={page}><section style={{ maxWidth: 1800, margin: "0 auto", background: "white", border: "1px solid #D8DEDA", borderRadius: 6, padding: 20 }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}><div>
      <h1 style={{ margin: "0 0 4px", fontSize: 19 }}>Costing Master</h1>
      <p style={{ margin: 0, color: "#66757F", fontSize: 12 }}>Source: {source} · {items.length} items{generatedAt ? ` · generated ${new Date(generatedAt).toLocaleString("en-IN")}` : ""}</p>
    </div><div style={{ display: "flex", gap: 8 }}>
      <input aria-label="Search costing master" style={{ ...input, width: 280 }} value={query} placeholder="Search item, type, brand, remark…" onChange={(e) => setQuery(e.target.value)} />
      <select aria-label="Filter by group" style={input} value={group} onChange={(e) => setGroup(e.target.value)}>{groups.map((value) => <option key={value}>{value}</option>)}</select>
    </div></header>
    <p style={{ margin: "14px 0", padding: "10px 12px", background: "#EEF6F3", borderLeft: "3px solid #15645A", color: "#36534E" }}>This page reads bundled JSON. For a monthly revision, move Current Rate to Previous Rate in the approved Excel, enter the new Current Rate, regenerate JSON, and redeploy.</p>
    <p style={{ color: "#66757F", fontSize: 12 }}>Showing {filtered.length} of {items.length} items.</p>
    <div style={{ overflow: "auto", maxHeight: "calc(100vh - 235px)", border: "1px solid #D8DEDA" }}><table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: 2500, width: "100%" }}>
      <thead><tr>{COLUMNS.map((column) => <th key={column.key} style={{ position: "sticky", top: 0, zIndex: 1, padding: "9px 10px", background: "#E7ECE9", borderBottom: "1px solid #C9D1CC", textAlign: column.numeric ? "right" : "left", whiteSpace: "nowrap" }}>{column.label}</th>)}</tr></thead>
      <tbody>{filtered.map((item) => <tr key={item.id}>{COLUMNS.map((column) => { const value = item[column.key]; return <td key={column.key} style={{ padding: "8px 10px", borderBottom: "1px solid #EEF1EE", textAlign: column.numeric ? "right" : "left", whiteSpace: column.key === "materialDescription" || column.key === "remark" ? "normal" : "nowrap", minWidth: column.key === "materialDescription" ? 340 : undefined }}>{value === null || value === "" ? "—" : column.numeric && typeof value === "number" ? number.format(value) : String(value)}</td>; })}</tr>)}</tbody>
    </table></div>
  </section></main>;
}
