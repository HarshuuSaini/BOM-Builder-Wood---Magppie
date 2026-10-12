"use client";

import { useState } from "react";
import { COSTING_ITEMS, type CostingMasterItem } from "@/lib/costing";
import { KITCHEN_ZONES, DEFAULT_MATERIAL_SOURCES, createsMaterialSourceCycle, type KitchenZone, type MaterialSource } from "@/lib/kitchen-materials";

const cabinetTypes = KITCHEN_ZONES;
const materialGroups = [
  { key: "carcass", name: "Carcass / shelf material", masterGroup: "Carcass/ Shelf Material" },
  { key: "back", name: "Carcass back material", masterGroup: "Carcass Back Material" },
  { key: "drawer", name: "Drawer material", masterGroup: "Drawer Material" },
  { key: "shutter", name: "Shutter material", masterGroup: "Shutter Material" },
  { key: "visible", name: "Visible side material", masterGroup: "Shutter Material" },
] as const;
type MaterialKey = (typeof materialGroups)[number]["key"];
type MaterialChoice = { itemId: string; frontSheetPrice: string; backSheetPrice: string; boardSheetPrice?: string };
type ZoneMaterialChoices = Record<MaterialKey, MaterialChoice>;
const choice = (itemId: string): MaterialChoice => ({
  itemId, frontSheetPrice: "550", backSheetPrice: "550",
});
const materialType = (item: CostingMasterItem): string => {
  if (/^Membrane\b/i.test(item.subgroup)) return "Membrane";
  if (/^PU\b/i.test(item.subgroup)) return "PU";
  if (item.type.toUpperCase() === "POSTLAM") return "Postlam";
  if (item.type.toUpperCase() === "PRELAM") return "Prelam";
  return "Other";
};
const conversionTypes = ["Prelam", "Postlam", "PU", "Membrane"] as const;
const typeOrder = [...conversionTypes, "Other"];
const initialChoices: ZoneMaterialChoices = {
  carcass: choice("KITCHEN-007"), back: choice("KITCHEN-035"),
  drawer: choice("KITCHEN-029"), shutter: choice("KITCHEN-014"), visible: choice("KITCHEN-014"),
};
const copyChoices = (source: ZoneMaterialChoices): ZoneMaterialChoices => ({
  carcass: { ...source.carcass }, back: { ...source.back },
  drawer: { ...source.drawer }, shutter: { ...source.shutter }, visible: { ...source.visible },
});
const inputStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid #C9D1CC", borderRadius: 4, font: "inherit", background: "#fff", width: "100%", boxSizing: "border-box" };
const fieldRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,250px),1fr))", gap: 12, alignItems: "start" };
const cabinetRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(160px,185px) minmax(0,1fr)", gap: 16, alignItems: "start" };
const buttonStyle: React.CSSProperties = { padding: "9px 13px", border: 0, borderRadius: 4, background: "#15645A", color: "#fff", fontWeight: 650, cursor: "pointer" };

export default function MaterialMasterAdminPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Local UI preview only; these selections are not yet part of the JSON contract.
  const [allChoices, setAllChoices] = useState<ZoneMaterialChoices>(copyChoices(initialChoices));
  const [zoneChoices, setZoneChoices] = useState<Record<string, ZoneMaterialChoices>>({ Base: initialChoices });
  const [sources, setSources] = useState<Record<KitchenZone, MaterialSource>>({ ...DEFAULT_MATERIAL_SOURCES });
  const effectiveChoices = (zone: KitchenZone, seen = new Set<KitchenZone>()): ZoneMaterialChoices => {
    if (seen.has(zone)) return zoneChoices[zone] ?? initialChoices;
    seen.add(zone);
    const source = sources[zone];
    if (source === "All") return allChoices;
    return source === "Own" ? zoneChoices[zone] ?? initialChoices : effectiveChoices(source, seen);
  };
  const changeAllChoice = (key: MaterialKey, change: Partial<MaterialChoice>) => setAllChoices((old) => ({
    ...old, [key]: { ...old[key], ...change },
  }));
  const changeZoneChoice = (zone: string, key: MaterialKey, change: Partial<MaterialChoice>) => setZoneChoices((old) => ({
    ...old, [zone]: { ...(old[zone] ?? initialChoices), [key]: { ...(old[zone] ?? initialChoices)[key], ...change } },
  }));
  const changeSource = (zone: KitchenZone, source: MaterialSource) => {
    if (source !== "Own" && source !== "All" && createsMaterialSourceCycle(zone, source, sources)) {
      const sourceSnapshot = copyChoices(effectiveChoices(source));
      setZoneChoices((old) => ({ ...old, [source]: sourceSnapshot }));
      setSources((old) => ({ ...old, [source]: "Own", [zone]: source }));
      return;
    }
    if (source === "Own" && sources[zone] !== "Own") {
      setZoneChoices((old) => ({ ...old, [zone]: copyChoices(effectiveChoices(zone)) }));
    }
    setSources((old) => ({ ...old, [zone]: source }));
  };

  const load = async (pass = password) => {
    setBusy(true); setMessage("");
    try {
      const result = await fetch("/api/material-master", { headers: { "x-admin-password": pass }, cache: "no-store" });
      const data = await result.json();
      if (!result.ok) throw new Error(result.status === 401 ? "Incorrect admin password." : data.error ?? "Could not load materials.");
      setUnlocked(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load materials."); }
    finally { setBusy(false); }
  };
  const page: React.CSSProperties = { minHeight: "100vh", background: "#F4F5F3", color: "#1B2430", fontFamily: 'Inter,"Segoe UI",system-ui,sans-serif', fontSize: 13, padding: 24 };
  const card: React.CSSProperties = { maxWidth: 1600, margin: "0 auto", background: "#fff", border: "1px solid #D8DEDA", borderRadius: 6, padding: 24 };
  const materialRows = (sectionName: string, choices: ZoneMaterialChoices, disabled: boolean,
    onChange: (key: MaterialKey, change: Partial<MaterialChoice>) => void) =>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(250px,1fr))", gap: 12, minWidth: 1298 }}>
      {materialGroups.map(({ key, name, masterGroup }) => {
        const options = COSTING_ITEMS.filter((item) => item.group === masterGroup && (key !== "visible" || item.thicknessMm === 18));
        const selected = choices[key];
        const chosen = options.find((item) => item.id === selected.itemId);
        const selectedType = chosen ? materialType(chosen) : "";
        const isPostlam = selectedType === "Postlam";
        const availableTypes = typeOrder.filter((type) => options.some((item) => materialType(item) === type));
        return <div key={key} style={{ border: "1px solid #E0E5E1", borderRadius: 5, padding: 14, display: "grid", gap: 8 }}>
          <strong>{name}</strong>
          <div style={fieldRowStyle}>
            <label style={{ display: "grid", gap: 5 }}>Subgroup
              <select aria-label={`${sectionName} ${name} subgroup`} style={inputStyle} disabled={disabled} value={selected.itemId}
                onChange={(event) => onChange(key, { itemId: event.target.value, boardSheetPrice: undefined })}>
                {availableTypes.map((type) => <optgroup key={type} label={type}>
                  {options.filter((item) => materialType(item) === type).map((item) =>
                    <option key={item.id} value={item.id}>{item.subgroup} · {item.thicknessMm ?? "—"} mm</option>)}
                </optgroup>)}
              </select>
              <span style={{ color: "#66757F", fontSize: 12 }}>Kitchen item: {chosen?.id ?? "No item selected"}</span>
            </label>
            {selectedType === "Prelam" && <label style={{ display: "grid", gap: 5 }}>Prelam board · ₹ per 32 sqft sheet
              <input aria-label={`${sectionName} ${name} Prelam board sheet price`} type="number" min="0" max="1000000" step="any" inputMode="decimal"
                style={inputStyle} disabled={disabled} value={selected.boardSheetPrice ?? Number(((chosen?.currentRate ?? 0) * 32).toFixed(6))}
                onChange={(event) => onChange(key, { boardSheetPrice: event.target.value })} />
            </label>}
            {isPostlam && <>
              <label style={{ display: "grid", gap: 5 }}>Front-side laminate · ₹ per 32 sqft sheet
                <input aria-label={`${sectionName} ${name} front laminate sheet price`} type="number" min="0" step="0.01" inputMode="decimal"
                  style={inputStyle} disabled={disabled} value={selected.frontSheetPrice}
                  onChange={(event) => onChange(key, { frontSheetPrice: event.target.value })} />
              </label>
              <label style={{ display: "grid", gap: 5 }}>Back-side laminate · ₹ per 32 sqft sheet
                <input aria-label={`${sectionName} ${name} back laminate sheet price`} type="number" min="0" step="0.01" inputMode="decimal"
                  style={inputStyle} disabled={disabled} value={selected.backSheetPrice}
                  onChange={(event) => onChange(key, { backSheetPrice: event.target.value })} />
              </label>
            </>}
          </div>
        </div>;
      })}
    </div>;

  if (!unlocked) return <main style={page}><section style={{ ...card, maxWidth: 380, margin: "80px auto 0" }}>
    <h1 style={{ marginTop: 0 }}>Admin — Material Master</h1>
    <p>Enter the separate admin password to preview cabinet material defaults.</p>
    <input aria-label="Admin password" type="password" style={inputStyle} value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} />
    <button style={{ ...buttonStyle, width: "100%", marginTop: 12 }} disabled={busy || !password.trim()} onClick={() => void load()}>{busy ? "Checking…" : "Continue"}</button>
    {message && <p role="alert" style={{ color: "#9C5510" }}>{message}</p>}
  </section></main>;

  return <main style={page}><section style={card}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div><h1 style={{ margin: 0 }}>Choose Materials · Cabinet Defaults</h1><p style={{ color: "#66757F" }}>Local layout preview for Base, Sink, Wall, Tall, Loft, and Mid cabinets.</p></div>
      <a href="/admin">Costing master →</a>
    </header>
      <h2 style={{ marginTop: 28 }}>Cabinet material defaults</h2>
      <p>Material groups are fixed. Select a Kitchen-master subgroup for each one. Carcass / shelf material covers both the carcass and its shelves.</p>
      <p role="note" style={{ padding: 10, background: "#FFF4E6", color: "#8A4D08", borderLeft: "4px solid #B86B16" }}>
        Local UI preview only: these material defaults are not saved here. Processing costs and project factors are edited in the Builder’s admin popup for each kitchen.
      </p>
      <section style={{ ...cabinetRowStyle, border: "1px solid #BFCFC6", borderRadius: 6, padding: 16, marginBottom: 16, background: "#F5FAF7" }}>
        <div>
          <h3 style={{ margin: 0 }}>All cabinets</h3>
          <p style={{ color: "#617069" }}>Shared defaults for any cabinet type.</p>
        </div>
        <div style={{ overflowX: "auto", paddingBottom: 4 }}>
          {materialRows("All cabinets", allChoices, false, changeAllChoice)}
        </div>
      </section>
      <div style={{ display: "grid", gap: 16 }}>
        {cabinetTypes.map((zone) => {
          const inherited = sources[zone] !== "Own";
          const choices = effectiveChoices(zone);
          return <section key={zone} style={{ ...cabinetRowStyle, border: "1px solid #D8DEDA", borderRadius: 6, padding: 16, background: inherited ? "#F8FAF8" : "#fff" }}>
            <div>
              <h3 style={{ margin: 0 }}>{zone} cabinets</h3>
              <label style={{ display: "grid", gap: 5, marginTop: 12 }}>Materials from
                <select aria-label={`${zone} material source`} style={inputStyle} value={sources[zone]}
                  onChange={(event) => changeSource(zone, event.target.value as MaterialSource)}>
                  <option value="Own">Choose separately</option>
                  <option value="All">All cabinets</option>
                  {KITCHEN_ZONES.filter((candidate) => candidate !== zone).map((candidate) => <option key={candidate} value={candidate}>{candidate} cabinets</option>)}
                </select>
              </label>
            </div>
            <div style={{ overflowX: "auto", paddingBottom: 4 }}>
              {materialRows(zone, choices, inherited, (key, change) => changeZoneChoice(zone, key, change))}
            </div>
          </section>;
        })}
      </div>
      {message && <p role="status" style={{ marginTop: 20, padding: 10, background: "#FBF2E6", color: "#9C5510" }}>{message}</p>}
  </section></main>;
}
