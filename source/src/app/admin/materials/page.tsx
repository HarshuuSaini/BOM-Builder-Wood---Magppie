"use client";

import { useState } from "react";
import { COSTING_ITEMS } from "@/lib/costing";
import { validateMaterialMaster, type MaterialMaster } from "@/lib/material-master";

const visibleBoards = COSTING_ITEMS.filter((item) => item.group === "Shutter Material" && item.thicknessMm === 18);
const faceFields: Array<[keyof MaterialMaster["postlam"], string]> = [
  ["carcassFrontId", "Carcass · front laminate"], ["carcassBackId", "Carcass · back laminate"],
  ["shutterFrontId", "Shutter · front laminate"], ["shutterBackId", "Shutter · back laminate"],
];
const inputStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid #C9D1CC", borderRadius: 4, font: "inherit", background: "#fff", width: "100%", boxSizing: "border-box" };
const buttonStyle: React.CSSProperties = { padding: "9px 13px", border: 0, borderRadius: 4, background: "#15645A", color: "#fff", fontWeight: 650, cursor: "pointer" };

export default function MaterialMasterAdminPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [master, setMaster] = useState<MaterialMaster | null>(null);
  const [baseSha, setBaseSha] = useState<string | null>(null);
  const [writable, setWritable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [newName, setNewName] = useState("");

  const load = async (pass = password) => {
    setBusy(true); setMessage("");
    try {
      const result = await fetch("/api/material-master", { headers: { "x-admin-password": pass }, cache: "no-store" });
      const data = await result.json();
      if (!result.ok) throw new Error(result.status === 401 ? "Incorrect admin password." : data.error ?? "Could not load materials.");
      setMaster(validateMaterialMaster(data.master)); setBaseSha(data.sha); setWritable(!!data.writable); setUnlocked(true);
      if (!data.writable) setMessage("Read-only: a server-side GitHub contents token is needed to save and redeploy changes.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load materials."); }
    finally { setBusy(false); }
  };
  const update = (change: Partial<MaterialMaster>) => setMaster((old) => old ? { ...old, ...change } : old);
  const updateLaminate = (id: string, change: Partial<MaterialMaster["laminates"][number]>) => setMaster((old) => old ? {
    ...old, laminates: old.laminates.map((item) => item.id === id ? { ...item, ...change } : item),
  } : old);
  const addLaminate = () => {
    const name = newName.trim(); if (!name || !master) return;
    const id = `LAM-${Date.now().toString(36).toUpperCase()}`;
    update({ laminates: [...master.laminates, { id, name, pricePerSheet: master.includedLaminateSheetPrice }] });
    setNewName("");
  };
  const save = async () => {
    if (!master || !baseSha) return;
    setBusy(true); setMessage("");
    try {
      const checked = validateMaterialMaster(master);
      const result = await fetch("/api/material-master", {
        method: "PUT", headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ master: checked, baseSha }),
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error ?? "Could not save the master.");
      setBaseSha(data.sha); setMessage(`${data.message} Commit ${String(data.commit ?? "").slice(0, 7)}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the master."); }
    finally { setBusy(false); }
  };
  const download = () => {
    if (!master) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`${JSON.stringify(master, null, 2)}\n`], { type: "application/json" }));
    link.download = "material_master.json"; link.click(); URL.revokeObjectURL(link.href);
  };
  const page: React.CSSProperties = { minHeight: "100vh", background: "#F4F5F3", color: "#1B2430", fontFamily: 'Inter,"Segoe UI",system-ui,sans-serif', fontSize: 13, padding: 24 };
  const card: React.CSSProperties = { maxWidth: 1000, margin: "0 auto", background: "#fff", border: "1px solid #D8DEDA", borderRadius: 6, padding: 24 };

  if (!unlocked) return <main style={page}><section style={{ ...card, maxWidth: 380, margin: "80px auto 0" }}>
    <h1 style={{ marginTop: 0 }}>Admin — Material Master</h1>
    <p>Enter the separate admin password to manage Postlam laminates and visible-side material.</p>
    <input aria-label="Admin password" type="password" style={inputStyle} value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} />
    <button style={{ ...buttonStyle, width: "100%", marginTop: 12 }} disabled={busy || !password.trim()} onClick={() => void load()}>{busy ? "Checking…" : "Continue"}</button>
    {message && <p role="alert" style={{ color: "#9C5510" }}>{message}</p>}
  </section></main>;

  return <main style={page}><section style={card}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div><h1 style={{ margin: 0 }}>Choose Materials · Admin Master</h1><p style={{ color: "#66757F" }}>Stored in source/src/data/material_master.json; changes take effect after redeployment.</p></div>
      <a href="/admin">Costing master →</a>
    </header>
    {master && <>
      <h2>Postlam laminate materials</h2>
      <p>Prices are per {master.sheetAreaSqft} sqft sheet. The finished-board Kitchen master rate already includes ₹{master.includedLaminateSheetPrice} per face; costing adjusts only the difference.</p>
      <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", minWidth: 660 }}>
        <thead><tr>{["Laminate", "Price / sheet (₹)", "Equivalent / sqft (₹)", ""].map((label) => <th key={label} style={{ textAlign: "left", padding: 8, background: "#E7ECE9" }}>{label}</th>)}</tr></thead>
        <tbody>{master.laminates.map((item) => <tr key={item.id}>
          <td style={{ padding: 6 }}><input aria-label={`Name for ${item.id}`} style={inputStyle} value={item.name} onChange={(event) => updateLaminate(item.id, { name: event.target.value })} /></td>
          <td style={{ padding: 6 }}><input aria-label={`Price for ${item.name}`} type="number" min={0} step="0.01" style={inputStyle} value={item.pricePerSheet} onChange={(event) => updateLaminate(item.id, { pricePerSheet: event.target.value === "" ? Number.NaN : Number(event.target.value) })} /></td>
          <td style={{ padding: 6 }}>₹{Number.isFinite(item.pricePerSheet) ? (item.pricePerSheet / master.sheetAreaSqft).toFixed(2) : "—"}</td>
          <td style={{ padding: 6 }}><button type="button" disabled={master.laminates.length === 1 || Object.values(master.postlam).includes(item.id)} onClick={() => update({ laminates: master.laminates.filter((row) => row.id !== item.id) })}>Remove</button></td>
        </tr>)}</tbody>
      </table></div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}><input aria-label="New laminate name" placeholder="New laminate name" style={{ ...inputStyle, maxWidth: 330 }} value={newName} onChange={(event) => setNewName(event.target.value)} />
        <button type="button" style={buttonStyle} onClick={addLaminate}>+ Add laminate</button></div>

      <h2 style={{ marginTop: 28 }}>Postlam face defaults</h2>
      <p>These defaults apply to new cabinets; existing saved kitchens keep their recorded prices.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
        {faceFields.map(([key, label]) => <label key={key}>{label}<select style={inputStyle} value={master.postlam[key]} onChange={(event) => update({ postlam: { ...master.postlam, [key]: event.target.value } })}>
          {master.laminates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>)}
      </div>

      <h2 style={{ marginTop: 28 }}>Visible cabinet sides</h2>
      <p>When a cabinet is marked LH, RH or Both, the chosen 18 mm shutter board replaces only those carcass side panels.</p>
      <label>Shutter material for visible sides<select style={inputStyle} value={master.visibleSideShutterMaterialId} onChange={(event) => update({ visibleSideShutterMaterialId: event.target.value })}>
        {visibleBoards.map((item) => <option key={item.id} value={item.id}>{item.subgroup} — {item.materialDescription}</option>)}
      </select></label>

      {message && <p role="status" style={{ marginTop: 20, padding: 10, background: "#FBF2E6", color: "#9C5510" }}>{message}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button style={buttonStyle} disabled={busy || !writable} onClick={() => void save()}>{busy ? "Saving…" : "Save JSON and redeploy"}</button>
        <button type="button" onClick={download}>Download JSON</button>
        <button type="button" onClick={() => void load()}>Reload source</button>
      </div>
    </>}
  </section></main>;
}
