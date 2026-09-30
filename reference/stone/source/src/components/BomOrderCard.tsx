import { groupLabel, statusLabel } from "@/lib/stock";
import type { BomReportRow, SalesOrderDetail } from "@/lib/types";
import type { ReactNode } from "react";

type BomOrderCardProps = {
  order: SalesOrderDetail;
  rows: BomReportRow[];
  headerActions?: ReactNode;
  footer?: ReactNode;
};

function groupRowsByMasterGroup(rows: BomReportRow[]): Array<{ key: string; label: string; rows: BomReportRow[] }> {
  const buckets = new Map<string, BomReportRow[]>();
  for (const row of rows) {
    const key = row.masterGroup || row.cfGroup || "__other__";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }
  const ordered = Array.from(buckets.entries()).sort((a, b) => {
    if (a[0] === "__other__") return 1;
    if (b[0] === "__other__") return -1;
    return a[0].localeCompare(b[0]);
  });
  return ordered.map(([key, list]) => ({ key, label: groupLabel(key), rows: list }));
}

function treePrefix(level: number): string {
  if (level === 0) return "";
  let prefix = "";
  for (let i = 1; i < level; i++) prefix += "│  ";
  prefix += "├─ ";
  return prefix;
}

function typeBadge(row: BomReportRow): { className: string; text: string } {
  if (row.rowType === "master") return { className: "type-chip pack", text: "PACK BOM" };
  if (row.rowType === "sub_bom") return { className: "type-chip sub", text: "SUB-BOM" };
  if (row.rowType === "plain") return { className: "type-chip plain", text: "ITEM" };
  return { className: "type-chip component", text: "COMPONENT" };
}

export function BomOrderCard({ order, rows, headerActions, footer }: BomOrderCardProps) {
  const groups = groupRowsByMasterGroup(rows);

  return (
    <article className="bom-card">
      <header className="bom-card-header">
        <div className="order-title">
          <span className="doc-icon">▣</span>
          <strong>{order.salesorder_number}</strong>
          {headerActions}
          <span className="customer-name">{order.customer_name}</span>
        </div>
        <time>{order.date ?? "—"}</time>
      </header>

      {groups.map((group) => {
        const leafCount = group.rows.filter((r) => r.rowType === "component" || r.rowType === "plain").length;
        return (
          <section className="bom-group" key={`${order.salesorder_id}-${group.key}`}>
            <div className="bom-group-bar">
              <div>
                <span className="group-dot" />
                <strong>{group.label}</strong>
              </div>
              <span>{leafCount} components</span>
            </div>
            <div className="bom-table">
              <div className="bom-head">
                <span>Item / Component</span>
                <span>SKU</span>
                <span>Type</span>
                <span>SO Qty</span>
                <span>Waste%</span>
                <span>Actual Qty</span>
                <span>Eff. Stock</span>
                <span>Deficit</span>
                <span>Status</span>
                <span>Unit</span>
              </div>
              {group.rows.map((row, index) => {
                const badge = typeBadge(row);
                const prefix = treePrefix(row.level);
                const showWaste = row.rowType === "component" || row.rowType === "plain";
                return (
                  <div
                    className={`bom-row ${row.rowType} lv${Math.min(row.level, 4)}${row.deficit > 0 ? " has-deficit" : ""}`}
                    key={`${row.sourceOrderId}-${row.parentItemId ?? "root"}-${row.itemId}-${row.level}-${index}`}
                  >
                    <span className="item-cell">
                      {prefix ? <span className="tree-mark">{prefix}</span> : null}
                      <strong>{row.itemName}</strong>
                    </span>
                    <span className="sku-cell">{row.sku || "-"}</span>
                    <span>
                      <span className={badge.className}>{badge.text}</span>
                    </span>
                    <span className="qty need">{row.quantityNeeded}</span>
                    <span className="qty waste">{showWaste && row.wastePercent > 0 ? `${row.wastePercent}%` : "—"}</span>
                    <span className="qty need">{Number.isFinite(row.actualQuantity) ? row.actualQuantity.toFixed(2).replace(/\.?0+$/, "") : "—"}</span>
                    <span className="qty avail">{row.rowType === "master" ? "—" : row.effectiveStock}</span>
                    <span className="qty deficit">{row.deficit > 0 ? `-${row.deficit.toFixed(2).replace(/\.?0+$/, "")}` : "—"}</span>
                    <span>
                      {row.rowType === "master" ? (
                        <span className="status-na">—</span>
                      ) : (
                        <>
                          <span className={`stock-dot ${row.status}`} />
                          {statusLabel(row.status)}
                        </>
                      )}
                    </span>
                    <span className="unit-cell">{row.unit}</span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {footer}
    </article>
  );
}
