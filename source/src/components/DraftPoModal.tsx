"use client";

import { useEffect, useState } from "react";
import { loadBomReportForOrders } from "@/lib/report";
import type { ApiErrorBody, BomReportRow, SalesOrderSummary } from "@/lib/types";

type Step = "search" | "loading" | "items" | "creating" | "done";

type VendorOption = {
  vendor_id: string;
  vendor_name: string;
  last_po_number?: string;
  last_po_date?: string;
  last_rate?: number;
  source: "history" | "item_default" | "all";
};

type OosLine = {
  row: BomReportRow;
  vendorOptions: VendorOption[];
  selectedVendorId: string;
  poQty: number;
  rate: number;
  loadingVendors: boolean;
  include: boolean;
};

type CreatedPo = { vendor_name: string; po_number: string; web_url?: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const b = await r.json();
  if (!r.ok) throw new Error((b as ApiErrorBody).error ?? "Request failed");
  return b as T;
}

export function DraftPoModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [orders, setOrders] = useState<SalesOrderSummary[]>([]);
  const [selectedSoId, setSelectedSoId] = useState("");
  const [error, setError] = useState("");
  const [oosLines, setOosLines] = useState<OosLine[]>([]);
  const [createdPos, setCreatedPos] = useState<CreatedPo[]>([]);
  const [allVendors, setAllVendors] = useState<VendorOption[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const body = await fetchJson<{ contacts: Array<{ contact_id: string; contact_name: string }> }>(
          "/api/zoho/contacts?contact_type=vendor",
        );
        setAllVendors(
          body.contacts.map((c) => ({
            vendor_id: c.contact_id,
            vendor_name: c.contact_name,
            source: "all" as const,
          })),
        );
      } catch {
        // non-fatal
      }
    })();
  }, []);

  async function search() {
    setError("");
    setSearching(true);
    try {
      const body = await fetchJson<{ salesorders: SalesOrderSummary[] }>(
        `/api/zoho/salesorders?q=${encodeURIComponent(query)}`,
      );
      setOrders(body.salesorders);
      if (!body.salesorders.length) setError("No sales orders found.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function chooseSo(soId: string) {
    setSelectedSoId(soId);
    setStep("loading");
    setError("");
    try {
      const { rows } = await loadBomReportForOrders([soId]);
      // Out-of-stock leaves: components or plain items with shortage
      const oos = rows.filter(
        (r) => (r.rowType === "component" || r.rowType === "plain") && r.status === "out-of-stock",
      );
      // Merge duplicates by itemId, summing deficit
      const merged = new Map<string, BomReportRow & { mergedDeficit: number }>();
      for (const r of oos) {
        const existing = merged.get(r.itemId);
        if (existing) existing.mergedDeficit += r.deficit;
        else merged.set(r.itemId, { ...r, mergedDeficit: r.deficit });
      }
      const lines: OosLine[] = Array.from(merged.values()).map((r) => ({
        row: r,
        vendorOptions: [],
        selectedVendorId: "",
        poQty: Math.ceil(r.mergedDeficit),
        rate: 0,
        loadingVendors: true,
        include: true,
      }));
      setOosLines(lines);
      setStep("items");

      // Batch-fetch real vendor history by walking recent POs server-side
      void (async () => {
        try {
          const ids = lines.map((l) => l.row.itemId).join(",");
          const body = await fetchJson<{ map: Record<string, VendorOption[]> }>(
            `/api/zoho/po-vendor-map?item_ids=${encodeURIComponent(ids)}&scan=100`,
          );
          setOosLines((curr) =>
            curr.map((c) => {
              const history = (body.map?.[c.row.itemId] ?? []).map((v) => ({ ...v, source: "history" as const }));
              const preferred = history[0];
              return {
                ...c,
                vendorOptions: history,
                selectedVendorId: preferred?.vendor_id ?? "",
                rate: preferred?.last_rate ?? c.rate,
                loadingVendors: false,
              };
            }),
          );
        } catch {
          setOosLines((curr) => curr.map((c) => ({ ...c, loadingVendors: false })));
        }
      })();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to expand SO");
      setStep("search");
    }
  }

  function updateLine(idx: number, patch: Partial<OosLine>) {
    setOosLines((curr) => curr.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  async function createDraftPos() {
    setError("");
    setStep("creating");
    const active = oosLines.filter((l) => l.include && l.selectedVendorId);
    if (!active.length) {
      setError("Select at least one item with a vendor.");
      setStep("items");
      return;
    }
    // Group by vendor
    const byVendor = new Map<string, OosLine[]>();
    for (const line of active) {
      if (!byVendor.has(line.selectedVendorId)) byVendor.set(line.selectedVendorId, []);
      byVendor.get(line.selectedVendorId)!.push(line);
    }

    const created: CreatedPo[] = [];
    try {
      for (const [vendorId, lines] of byVendor) {
        const vendorName =
          lines[0].vendorOptions.find((v) => v.vendor_id === vendorId)?.vendor_name ??
          allVendors.find((v) => v.vendor_id === vendorId)?.vendor_name ??
          "Vendor";
        const payload = {
          vendor_id: vendorId,
          line_items: lines.map((l) => ({
            item_id: l.row.itemId,
            name: l.row.itemName,
            quantity: l.poQty,
            rate: l.rate || 0,
            unit: l.row.unit,
          })),
          notes: `Draft PO auto-generated from SO #${oosLines[0]?.row.sourceOrderNumber ?? selectedSoId}`,
        };
        const body = await fetchJson<{ purchaseorder: { purchaseorder_number: string; web_url?: string } }>(
          "/api/zoho/purchaseorders",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        created.push({
          vendor_name: vendorName,
          po_number: body.purchaseorder.purchaseorder_number,
          web_url: body.purchaseorder.web_url,
        });
      }
      setCreatedPos(created);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "PO creation failed");
      setStep("items");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: "min(960px, 95vw)",
          maxHeight: "90vh",
          overflow: "auto",
          borderRadius: 8,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Create Draft PO from Sales Order</h2>
          <button onClick={onClose} style={{ padding: "4px 10px" }}>Close</button>
        </div>

        {error && (
          <div style={{ background: "#fde2e2", padding: 8, borderRadius: 4, marginBottom: 10, color: "#900" }}>
            {error}
          </div>
        )}

        {step === "search" && (
          <div>
            <p>Search for a sales order (min 2 chars), then pick one.</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="SO number, customer, etc."
                style={{ flex: 1, padding: 6 }}
                onKeyDown={(e) => e.key === "Enter" && void search()}
              />
              <button onClick={() => void search()} disabled={searching || query.trim().length < 2}>
                {searching ? "Searching..." : "Search"}
              </button>
            </div>
            <div style={{ maxHeight: 380, overflow: "auto", border: "1px solid #ddd", borderRadius: 4 }}>
              {orders.map((o) => (
                <div
                  key={o.salesorder_id}
                  onClick={() => void chooseSo(o.salesorder_id)}
                  style={{
                    padding: 10,
                    borderBottom: "1px solid #eee",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <strong>{o.salesorder_number}</strong> · {o.customer_name}
                  </div>
                  <div style={{ color: "#666" }}>
                    {o.date} · {o.status}
                  </div>
                </div>
              ))}
              {!orders.length && !searching && (
                <div style={{ padding: 20, textAlign: "center", color: "#888" }}>No results yet.</div>
              )}
            </div>
          </div>
        )}

        {step === "loading" && (
          <div style={{ padding: 30, textAlign: "center" }}>
            Resolving items & composite components, computing stock…
          </div>
        )}

        {step === "items" && (
          <div>
            <p>
              <strong>{oosLines.length}</strong> out-of-stock item{oosLines.length === 1 ? "" : "s"} found in this SO
              (including items under composites). Preferred vendor is pre-selected from the most recent purchase order
              for each item — change if needed.
            </p>
            {!oosLines.length && (
              <div style={{ padding: 16, background: "#e6f7e6", borderRadius: 4 }}>
                No out-of-stock items — nothing to purchase.
              </div>
            )}
            {oosLines.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f5f5f5" }}>
                    <th style={th}>✓</th>
                    <th style={th}>Item</th>
                    <th style={th}>Needed</th>
                    <th style={th}>Stock</th>
                    <th style={th}>Deficit</th>
                    <th style={th}>PO Qty</th>
                    <th style={th}>Rate</th>
                    <th style={th}>Vendor (preferred from latest PO)</th>
                  </tr>
                </thead>
                <tbody>
                  {oosLines.map((l, i) => {
                    const mergedVendors = [
                      ...l.vendorOptions,
                      ...allVendors.filter(
                        (av) => !l.vendorOptions.find((v) => v.vendor_id === av.vendor_id),
                      ),
                    ];
                    return (
                      <tr key={l.row.itemId} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={td}>
                          <input
                            type="checkbox"
                            checked={l.include}
                            onChange={(e) => updateLine(i, { include: e.target.checked })}
                          />
                        </td>
                        <td style={td}>
                          <div>{l.row.itemName}</div>
                          <div style={{ color: "#888", fontSize: 11 }}>
                            {l.row.sku} · {l.row.cfGroup}
                          </div>
                        </td>
                        <td style={td}>{l.row.actualQuantity.toFixed(2)}</td>
                        <td style={td}>{l.row.effectiveStock.toFixed(2)}</td>
                        <td style={td}>{l.row.deficit.toFixed(2)}</td>
                        <td style={td}>
                          <input
                            type="number"
                            value={l.poQty}
                            onChange={(e) => updateLine(i, { poQty: Number(e.target.value) })}
                            style={{ width: 70 }}
                          />
                        </td>
                        <td style={td}>
                          <input
                            type="number"
                            value={l.rate}
                            onChange={(e) => updateLine(i, { rate: Number(e.target.value) })}
                            style={{ width: 80 }}
                          />
                        </td>
                        <td style={td}>
                          {l.loadingVendors ? (
                            <span style={{ color: "#888" }}>loading…</span>
                          ) : (
                            <select
                              value={l.selectedVendorId}
                              onChange={(e) => {
                                const vid = e.target.value;
                                const v = l.vendorOptions.find((x) => x.vendor_id === vid);
                                updateLine(i, {
                                  selectedVendorId: vid,
                                  rate: v?.last_rate ?? l.rate,
                                });
                              }}
                              style={{ minWidth: 220 }}
                            >
                              <option value="">— pick vendor —</option>
                              {l.vendorOptions.length > 0 && (
                                <optgroup label="From purchase history">
                                  {l.vendorOptions.map((v) => (
                                    <option key={v.vendor_id} value={v.vendor_id}>
                                      {v.vendor_name}
                                      {v.last_po_date ? ` · last ${v.last_po_date}` : ""}
                                      {typeof v.last_rate === "number" ? ` · ₹${v.last_rate}` : ""}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              <optgroup label="All vendors">
                                {allVendors
                                  .filter((av) => !l.vendorOptions.find((v) => v.vendor_id === av.vendor_id))
                                  .map((v) => (
                                    <option key={v.vendor_id} value={v.vendor_id}>
                                      {v.vendor_name}
                                    </option>
                                  ))}
                              </optgroup>
                            </select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setStep("search")}>Back</button>
              <button
                onClick={() => void createDraftPos()}
                disabled={!oosLines.some((l) => l.include && l.selectedVendorId)}
                style={{ background: "#1f5be8", color: "#fff", padding: "6px 14px" }}
              >
                Create Draft PO(s)
              </button>
            </div>
          </div>
        )}

        {step === "creating" && (
          <div style={{ padding: 30, textAlign: "center" }}>Creating draft purchase order(s)…</div>
        )}

        {step === "done" && (
          <div>
            <h3>Draft PO(s) created</h3>
            <ul>
              {createdPos.map((p) => (
                <li key={p.po_number}>
                  <strong>
                    {p.web_url ? (
                      <a href={p.web_url} target="_blank" rel="noopener noreferrer">
                        {p.po_number} ↗
                      </a>
                    ) : (
                      p.po_number
                    )}
                  </strong>{" "}
                  · {p.vendor_name}
                </li>
              ))}
            </ul>
            <div style={{ textAlign: "right", marginTop: 16 }}>
              <button onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: 6, borderBottom: "1px solid #ddd" };
const td: React.CSSProperties = { padding: 6, verticalAlign: "top" };
