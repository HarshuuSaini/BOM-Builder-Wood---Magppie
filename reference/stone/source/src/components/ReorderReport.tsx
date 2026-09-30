"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  item_id: string;
  name: string;
  sku: string;
  unit: string;
  stock: number;
  reorder_level: number;
  msl: number;
  shortfall: number;
  vendor_id: string;
  vendor_name: string;
  last_po_number: string;
  last_po_date: string;
  last_rate?: number;
  lead_time: number;
  transit_time: number;
};

type FilterMode = "lead" | "transit" | "combined";

type RowState = {
  vendor_id: string;
  lead_time: number;
  transit_time: number;
  po_qty: number;
  rate: number;
  selected: boolean;
  posting: boolean;
  posted?: string;
  posted_url?: string;
  error?: string;
};

type Vendor = { contact_id: string; contact_name: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const b = await r.json();
  if (!r.ok) throw new Error((b as { error?: string }).error || "Request failed");
  return b as T;
}

export function ReorderReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState(0);
  const [mode, setMode] = useState<FilterMode>("combined");
  const [maxDays, setMaxDays] = useState<string>("");
  const [query, setQuery] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const b = await fetchJson<{ rows: Row[]; scanned_items: number }>("/api/zoho/reorder-report");
      setRows(b.rows);
      setScanned(b.scanned_items ?? 0);
      const init: Record<string, RowState> = {};
      for (const r of b.rows) {
        init[r.item_id] = {
          vendor_id: r.vendor_id,
          lead_time: r.lead_time,
          transit_time: r.transit_time,
          po_qty: Math.max(r.shortfall, r.reorder_level - r.stock) || 1,
          rate: r.last_rate ?? 0,
          selected: false,
          posting: false,
        };
      }
      setState(init);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void (async () => {
      try {
        const b = await fetchJson<{ contacts: Vendor[] }>("/api/zoho/contacts?contact_type=vendor");
        setVendors(b.contacts);
      } catch {
        // non-fatal
      }
    })();
  }, []);

  function updateRow(itemId: string, patch: Partial<RowState>) {
    setState((s) => ({ ...s, [itemId]: { ...s[itemId], ...patch } }));
  }

  async function onVendorChange(itemId: string, newVendorId: string) {
    updateRow(itemId, { vendor_id: newVendorId, lead_time: 0, transit_time: 0 });
    if (!newVendorId) return;
    try {
      const b = await fetchJson<{ lead_time: number; transit_time: number }>(
        `/api/zoho/contacts/${newVendorId}`,
      );
      updateRow(itemId, { lead_time: b.lead_time, transit_time: b.transit_time });
    } catch {
      // keep zeros
    }
  }

  async function createPoForRow(row: Row) {
    const s = state[row.item_id];
    if (!s.vendor_id) {
      updateRow(row.item_id, { error: "Pick a vendor first" });
      return;
    }
    updateRow(row.item_id, { posting: true, error: undefined });
    try {
      const payload = {
        vendor_id: s.vendor_id,
        line_items: [
          {
            item_id: row.item_id,
            name: row.name,
            quantity: s.po_qty,
            rate: s.rate || 0,
            unit: row.unit,
          },
        ],
        notes: "Draft PO from Re-order Level Report",
      };
      const b = await fetchJson<{ purchaseorder: { purchaseorder_number: string; web_url?: string } }>(
        "/api/zoho/purchaseorders",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      updateRow(row.item_id, {
        posting: false,
        posted: b.purchaseorder.purchaseorder_number,
        posted_url: b.purchaseorder.web_url,
      });
    } catch (e) {
      updateRow(row.item_id, {
        posting: false,
        error: e instanceof Error ? e.message : "Failed",
      });
    }
  }

  async function createBulkPos() {
    setBulkMsg("");
    setBulkBusy(true);
    try {
      const selected = rows.filter((r) => state[r.item_id]?.selected && state[r.item_id]?.vendor_id);
      if (!selected.length) {
        setBulkMsg("Select at least one row with a vendor.");
        setBulkBusy(false);
        return;
      }
      const byVendor = new Map<string, Row[]>();
      for (const r of selected) {
        const vid = state[r.item_id].vendor_id;
        if (!byVendor.has(vid)) byVendor.set(vid, []);
        byVendor.get(vid)!.push(r);
      }
      const created: string[] = [];
      for (const [vendorId, rs] of byVendor) {
        const payload = {
          vendor_id: vendorId,
          line_items: rs.map((r) => ({
            item_id: r.item_id,
            name: r.name,
            quantity: state[r.item_id].po_qty,
            rate: state[r.item_id].rate || 0,
            unit: r.unit,
          })),
          notes: "Bulk Draft PO from Re-order Level Report",
        };
        const b = await fetchJson<{ purchaseorder: { purchaseorder_number: string; web_url?: string } }>(
          "/api/zoho/purchaseorders",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        for (const r of rs)
          updateRow(r.item_id, {
            posted: b.purchaseorder.purchaseorder_number,
            posted_url: b.purchaseorder.web_url,
          });
        created.push(b.purchaseorder.purchaseorder_number);
      }
      setBulkMsg(`Created ${created.length} draft PO(s): ${created.join(", ")}`);
    } catch (e) {
      setBulkMsg(e instanceof Error ? e.message : "Bulk create failed");
    } finally {
      setBulkBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const limit = Number(maxDays);
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const s = state[r.item_id];
      if (q && ![r.name, r.sku, r.vendor_name].join(" ").toLowerCase().includes(q)) return false;
      if (!maxDays || Number.isNaN(limit)) return true;
      const lt = s?.lead_time ?? r.lead_time;
      const tt = s?.transit_time ?? r.transit_time;
      const metric = mode === "lead" ? lt : mode === "transit" ? tt : lt + tt;
      return metric <= limit;
    });
  }, [rows, mode, maxDays, query, state]);

  const selectedCount = useMemo(
    () => rows.filter((r) => state[r.item_id]?.selected).length,
    [rows, state],
  );

  function setAllSelected(v: boolean) {
    setState((s) => {
      const next = { ...s };
      for (const r of filtered) next[r.item_id] = { ...next[r.item_id], selected: v };
      return next;
    });
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Re-order Level Report</h1>
        <div>
          <a href="/" style={{ marginRight: 12, color: "#1f5be8" }}>← BOM Report</a>
          <a href="/builder" style={{ marginRight: 12, color: "#1f5be8" }}>Carcass Builder</a>
          <button onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#fde2e2", color: "#900", padding: 8, borderRadius: 4, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          background: "#f5f5f5",
          padding: 12,
          borderRadius: 6,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <strong>Filter by:</strong>
        <label>
          <input type="radio" checked={mode === "lead"} onChange={() => setMode("lead")} /> Lead Time
        </label>
        <label>
          <input type="radio" checked={mode === "transit"} onChange={() => setMode("transit")} /> Transit Time
        </label>
        <label>
          <input type="radio" checked={mode === "combined"} onChange={() => setMode("combined")} /> Lead + Transit
        </label>
        <span>≤</span>
        <input
          type="number"
          placeholder="max days"
          value={maxDays}
          onChange={(e) => setMaxDays(e.target.value)}
          style={{ width: 110, padding: 4 }}
        />
        <span>days</span>
        <input
          placeholder="Search item / SKU / vendor"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: 4 }}
        />
        <button onClick={() => { setMaxDays(""); setQuery(""); }}>Clear</button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 10,
          padding: "6px 10px",
          background: "#eef2ff",
          borderRadius: 4,
        }}
      >
        <strong>{selectedCount}</strong> selected
        <button onClick={() => setAllSelected(true)}>Select all (filtered)</button>
        <button onClick={() => setAllSelected(false)}>Deselect all</button>
        <button
          onClick={() => void createBulkPos()}
          disabled={bulkBusy || !selectedCount}
          style={{ background: "#1f5be8", color: "#fff", padding: "5px 12px" }}
        >
          {bulkBusy ? "Creating…" : "Create Draft PO(s) for Selected"}
        </button>
        {bulkMsg && <span style={{ color: bulkMsg.startsWith("Created") ? "#0a7d2c" : "#900" }}>{bulkMsg}</span>}
        <div style={{ marginLeft: "auto", color: "#555", fontSize: 13 }}>
          Showing <strong>{filtered.length}</strong> of {rows.length}
          {scanned ? ` · scanned ${scanned} items` : ""}
        </div>
      </div>

      <div style={{ overflow: "auto", border: "1px solid #ddd", borderRadius: 4 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ background: "#f0f0f0", position: "sticky", top: 0 }}>
            <tr>
              <th style={th}>✓</th>
              <th style={th}>Item</th>
              <th style={thNum}>Stock</th>
              <th style={thNum}>ROL</th>
              <th style={thNum}>MSL</th>
              <th style={thNum}>Shortfall</th>
              <th style={th}>Vendor</th>
              <th style={thNum}>Lead</th>
              <th style={thNum}>Transit</th>
              <th style={thNum}>Total</th>
              <th style={thNum}>PO Qty</th>
              <th style={thNum}>Rate</th>
              <th style={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={13} style={{ padding: 20, textAlign: "center" }}>
                  Scanning items, recent POs and vendor profiles…
                </td>
              </tr>
            )}
            {!loading && !filtered.length && (
              <tr>
                <td colSpan={13} style={{ padding: 20, textAlign: "center", color: "#666" }}>
                  No items match.
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const s = state[r.item_id];
              if (!s) return null;
              return (
                <tr key={r.item_id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={s.selected}
                      onChange={(e) => updateRow(r.item_id, { selected: e.target.checked })}
                    />
                  </td>
                  <td style={td}>
                    <div>{r.name}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>
                      {r.sku || "—"} · {r.unit}
                    </div>
                  </td>
                  <td style={tdNum}>{r.stock}</td>
                  <td style={tdNum}>{r.reorder_level}</td>
                  <td style={tdNum}>{r.msl || "—"}</td>
                  <td style={{ ...tdNum, color: "#b00020", fontWeight: 600 }}>{r.shortfall}</td>
                  <td style={td}>
                    <select
                      value={s.vendor_id}
                      onChange={(e) => void onVendorChange(r.item_id, e.target.value)}
                      style={{ minWidth: 200 }}
                    >
                      <option value="">— pick vendor —</option>
                      {r.vendor_id && !vendors.find((v) => v.contact_id === r.vendor_id) && (
                        <option value={r.vendor_id}>
                          {r.vendor_name} (latest PO: {r.last_po_number} · {r.last_po_date})
                        </option>
                      )}
                      {r.vendor_id && vendors.find((v) => v.contact_id === r.vendor_id) && (
                        <optgroup label="From latest PO">
                          <option value={r.vendor_id}>
                            {r.vendor_name} · {r.last_po_date}
                          </option>
                        </optgroup>
                      )}
                      <optgroup label="All vendors">
                        {vendors
                          .filter((v) => v.contact_id !== r.vendor_id)
                          .map((v) => (
                            <option key={v.contact_id} value={v.contact_id}>
                              {v.contact_name}
                            </option>
                          ))}
                      </optgroup>
                    </select>
                  </td>
                  <td style={tdNum}>{s.lead_time || "—"}</td>
                  <td style={tdNum}>{s.transit_time || "—"}</td>
                  <td style={tdNum}>{s.lead_time + s.transit_time || "—"}</td>
                  <td style={tdNum}>
                    <input
                      type="number"
                      value={s.po_qty}
                      onChange={(e) => updateRow(r.item_id, { po_qty: Number(e.target.value) })}
                      style={{ width: 70 }}
                    />
                  </td>
                  <td style={tdNum}>
                    <input
                      type="number"
                      value={s.rate}
                      onChange={(e) => updateRow(r.item_id, { rate: Number(e.target.value) })}
                      style={{ width: 80 }}
                    />
                  </td>
                  <td style={td}>
                    {s.posted ? (
                      <span style={{ color: "#0a7d2c" }}>
                        ✓{" "}
                        {s.posted_url ? (
                          <a href={s.posted_url} target="_blank" rel="noopener noreferrer" style={{ color: "#0a7d2c", textDecoration: "underline" }}>
                            {s.posted} ↗
                          </a>
                        ) : (
                          s.posted
                        )}
                      </span>
                    ) : (
                      <button
                        onClick={() => void createPoForRow(r)}
                        disabled={s.posting || !s.vendor_id}
                        style={{ padding: "3px 8px" }}
                      >
                        {s.posting ? "…" : "Create PO"}
                      </button>
                    )}
                    {s.error && (
                      <div style={{ color: "#900", fontSize: 11, marginTop: 2 }}>{s.error}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #ccc", fontSize: 12 };
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
