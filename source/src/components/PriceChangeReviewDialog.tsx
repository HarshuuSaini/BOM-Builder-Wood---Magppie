"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function PriceChangeReviewDialog({ children, hasChanges, required = false, openRequest = 0 }: { children: ReactNode; hasChanges: boolean; required?: boolean; openRequest?: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const handledRequest = useRef(0);
  useEffect(() => {
    if (openRequest > handledRequest.current && hasChanges) {
      handledRequest.current = openRequest;
      if (!dialog.current?.open) dialog.current?.showModal();
    }
  }, [openRequest, hasChanges]);
  if (!hasChanges) return null;
  return <>
    <style>{`.price-review-dialog{width:min(1200px,94vw);max-width:94vw;max-height:88dvh;box-sizing:border-box;padding:22px;border:1px solid #cfddd4;border-radius:14px;background:#f5f8f5;color:#24392d;box-shadow:0 24px 70px #183e2638;font:14px system-ui;overflow:auto}.price-review-dialog::backdrop{background:#18312766}.price-review-dialog .price-review{margin-top:12px}`}</style>
    <button type="button" onClick={() => dialog.current?.showModal()} style={{ padding: "9px 15px", border: "1px solid #bad0c2", borderRadius: 8, background: "white", color: "#245a49", font: "600 13px system-ui", cursor: "pointer" }}>Review price changes{required ? " (required)" : ""}</button>
    <dialog ref={dialog} aria-labelledby={title} className="price-review-dialog">
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, marginBottom: 18 }}>
        <h2 id={title} style={{ margin: 0 }}>Price-change remarks</h2>
        <button type="button" onClick={() => dialog.current?.close()} style={{ padding: "8px 14px", border: "1px solid #bad0c2", borderRadius: 8, background: "white", color: "#245a49", font: "inherit", cursor: "pointer" }}>Close</button>
      </header>
      {children}
    </dialog>
  </>;
}
