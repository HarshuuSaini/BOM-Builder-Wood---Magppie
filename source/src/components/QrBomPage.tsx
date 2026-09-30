"use client";

import { useEffect, useState } from "react";
import { BomOrderCard } from "@/components/BomOrderCard";
import { loadBomReport } from "@/lib/report";
import type { BomReportRow, SalesOrderDetail } from "@/lib/types";

type QrBomPageProps = {
  orderId: string;
};

type LoadedReport = {
  order: SalesOrderDetail;
  rows: BomReportRow[];
};

export function QrBomPage({ orderId }: QrBomPageProps) {
  const [report, setReport] = useState<LoadedReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadBomReport(orderId)
      .then((result) => {
        if (active) setReport(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load BOM report.");
      });

    return () => {
      active = false;
    };
  }, [orderId]);

  return (
    <main className="qr-page">
      <section className="widget-frame">
        <header className="widget-title">
          <h1>BOM Items</h1>
        </header>
        <div className="widget-actionbar">
          <div className="widget-action-title">
            <strong>BOM Backorder Report</strong>
            <span>{report ? `${report.order.salesorder_number} · BOM Items` : "Loading BOM Items"}</span>
          </div>
        </div>
        <div className="qr-page-body">
          {error ? <div className="message error">{error}</div> : null}
          {!error && !report ? <div className="empty">Loading BOM items...</div> : null}
          {report ? <BomOrderCard order={report.order} rows={report.rows} /> : null}
        </div>
      </section>
    </main>
  );
}
