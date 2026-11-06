"use client";

import { useEffect, useId, useRef, useState } from "react";

const paths = {
  view: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  edit: "m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5",
  clone: "M9 9h12v12H9V9ZM15 6V3H3v12h3",
  bin: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  restore: "M4 10a8 8 0 1 1 1 8M4 4v6h6",
};
type Props = { name: string; busy: boolean; bin: boolean; editLabel: string;
  onView: () => void; onEdit: () => void; onClone: () => void; onBin: () => void; onRestore: () => void };

export function CostingActions(props: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === "scroll" && event.target instanceof Node && panel.current?.contains(event.target)) return;
      panel.current?.hidePopover();
    };
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  const items = props.bin ? [{ key: "restore" as const, label: "Restore costing", action: props.onRestore }] : [
    { key: "view" as const, label: "View", action: props.onView },
    { key: "edit" as const, label: props.editLabel, action: props.onEdit },
    { key: "clone" as const, label: "Clone kitchen", action: props.onClone },
    { key: "bin" as const, label: "Move to bin", action: props.onBin },
  ];
  return <>
    <button ref={trigger} type="button" className="costing-menu-trigger" popoverTarget={id} aria-label={`Actions for ${props.name}`} aria-haspopup="menu" aria-expanded={open} disabled={props.busy}
      onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); panel.current?.showPopover(); } }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
    </button>
    <div ref={panel} id={id} popover="auto" role="menu" aria-label={`Kitchen actions for ${props.name}`} className="costing-menu" style={position}
      onToggle={e => {
        const opening = e.newState === "open";
        setOpen(opening);
        if (opening && trigger.current && panel.current) {
          const rect = trigger.current.getBoundingClientRect();
          const height = panel.current.offsetHeight, width = panel.current.offsetWidth;
          setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
            top: rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6) });
          panel.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        }
      }}
      onKeyDown={e => {
        const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          buttons[e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
        if (e.key === "Tab" || e.key === "Escape") {
          if (e.key === "Escape") e.preventDefault();
          panel.current?.hidePopover(); trigger.current?.focus();
        }
      }}>
      {items.map(item => <button type="button" key={item.key} role="menuitem" className={`costing-menu-item${item.key === "bin" ? " costing-menu-danger" : ""}`} disabled={props.busy}
        onClick={() => { panel.current?.hidePopover(); trigger.current?.focus(); item.action(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[item.key]} /></svg>
        <span>{item.label}</span>
      </button>)}
    </div>
  </>;
}
