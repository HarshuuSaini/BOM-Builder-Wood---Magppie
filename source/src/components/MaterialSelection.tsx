"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserSignOut } from "@/components/UserSignOut";
import { DRAWER_BRANDS, KITCHEN_ZONES, HANDLE_ZONES, DEFAULT_MATERIAL_SOURCES, MATERIAL_FIELDS, createsMaterialSourceCycle, handleSettingFor, type HandleSetting, type HandleZone, type KitchenMaterials, type KitchenZone, type MaterialSource, type MaterialChoice, type MaterialField, type ZoneMaterials } from "@/lib/kitchen-materials";

type Option = { id: string; group: string; subgroup: string; thicknessMm: number | null; type: string; boardSheetPrice: string };
const GROUPS: Record<MaterialField, { label: string; group: string }> = {
  carcass: { label: "Carcass / shelf material", group: "Carcass/ Shelf Material" },
  back: { label: "Carcass back material", group: "Carcass Back Material" },
  drawer: { label: "Drawer material", group: "Drawer Material" },
  shutter: { label: "Shutter material", group: "Shutter Material" },
  visible: { label: "Visible side material", group: "Shutter Material" },
};
const DEFAULT_IDS: Record<MaterialField, string> = {
  carcass: "KITCHEN-007", back: "KITCHEN-035", drawer: "KITCHEN-029", shutter: "KITCHEN-014", visible: "KITCHEN-014",
};
const fieldStyle: React.CSSProperties = { padding: "9px 10px", width: "100%", boxSizing: "border-box", border: "1px solid #ccd6d0", borderRadius: 5, background: "white", font: "inherit" };

function defaultZone(): ZoneMaterials {
  return Object.fromEntries(MATERIAL_FIELDS.map((field) => [field, { itemId: DEFAULT_IDS[field], frontSheetPrice: "550", backSheetPrice: "550" }])) as ZoneMaterials;
}
function copyZone(zone: ZoneMaterials): ZoneMaterials {
  return Object.fromEntries(MATERIAL_FIELDS.map((field) => [field, { ...zone[field] }])) as ZoneMaterials;
}
function defaultMaterials(): KitchenMaterials {
  return Object.fromEntries(KITCHEN_ZONES.map((zone) => [zone, defaultZone()])) as unknown as KitchenMaterials;
}
function typeOf(option: Option) {
  if (/^Membrane\b/i.test(option.subgroup)) return "Membrane";
  if (/^PU\b/i.test(option.subgroup)) return "PU";
  return /POSTLAM/i.test(option.type) ? "Postlam" : "Prelam";
}
const SYNC_TARGETS: Partial<Record<MaterialField, MaterialField[]>> = {
  carcass: ["back", "drawer"],
  shutter: ["visible"],
};

function updateMaterialChoices(choices: ZoneMaterials, field: MaterialField, change: Partial<MaterialChoice>, options: Option[]) {
  const next = copyZone(choices);
  next[field] = { ...next[field], ...change };
  // Back and drawer boards follow a carcass subgroup change, but their 8/16 mm
  // board and laminate prices belong to their own material selections.
  if (field === "carcass" && change.itemId === undefined) return { choices: next, unmatched: [] as MaterialField[] };
  const unmatched: MaterialField[] = [];
  for (const target of SYNC_TARGETS[field] ?? []) {
    const sourceOption = options.find((option) => option.id === next[field].itemId);
    const matchingOption = sourceOption && options.find((option) =>
      option.group === GROUPS[target].group && option.subgroup.toLowerCase() === sourceOption.subgroup.toLowerCase());
    if (!matchingOption) {
      unmatched.push(target);
      continue;
    }
    if (field === "carcass") {
      next[target] = {
        ...next[target], itemId: matchingOption.id,
        boardSheetPrice: next[target].itemId === matchingOption.id ? next[target].boardSheetPrice : undefined,
      };
    } else {
      const sourcePrice = next[field].boardSheetPrice ?? sourceOption.boardSheetPrice;
      next[target] = {
        itemId: matchingOption.id,
        frontSheetPrice: next[field].frontSheetPrice,
        backSheetPrice: next[field].backSheetPrice,
        boardSheetPrice: typeOf(sourceOption) === "Prelam" || typeOf(sourceOption) === "Postlam" ? sourcePrice : undefined,
      };
    }
  }
  return { choices: next, unmatched };
}

export function MaterialSelection({ options, initial }: { options: Option[]; initial?: KitchenMaterials }) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<KitchenZone | "All">("All");
  const [hingeBrand, setHingeBrand] = useState(() => initial?._hingeChoice?.split(" ")[0] ?? "Hettich");
  const [hingeType, setHingeType] = useState(() => initial?._hingeChoice?.endsWith("Non Soft Close") ? "Non Soft Close" : "Soft Close");
  const [drawerBrand, setDrawerBrand] = useState(() => initial?._drawerBrand ?? "Hettich");
  const [handleDefaults, setHandleDefaults] = useState<Record<HandleZone, HandleSetting>>(() =>
    Object.fromEntries(HANDLE_ZONES.map((zone) => [zone, handleSettingFor(initial, zone)])) as Record<HandleZone, HandleSetting>);
  const normalizeVisible = (zone: ZoneMaterials): ZoneMaterials => {
    const copy = copyZone(zone);
    if (!options.some((option) => option.id === copy.visible.itemId && option.group === "Shutter Material" && [18, 25].includes(option.thicknessMm ?? 0))) {
      copy.visible.itemId = DEFAULT_IDS.visible;
    }
    return copy;
  };
  const [all, setAll] = useState<ZoneMaterials>(normalizeVisible(initial?.Base ?? defaultZone()));
  const [zones, setZones] = useState<KitchenMaterials>(() => {
    const source = initial ?? defaultMaterials();
    return Object.fromEntries(KITCHEN_ZONES.map((zone) => [zone, normalizeVisible(source[zone] ?? source.Base ?? defaultZone())])) as unknown as KitchenMaterials;
  });
  const [sources, setSources] = useState<Record<KitchenZone, MaterialSource>>(() => {
    if (!initial) return { ...DEFAULT_MATERIAL_SOURCES };
    const restored = Object.fromEntries(KITCHEN_ZONES.map((zone) => [zone, initial._sources?.[zone] ?? "Own"])) as Record<KitchenZone, MaterialSource>;
    if (!initial._sources && (!initial.Sink || MATERIAL_FIELDS.every((field) =>
      initial.Sink[field].itemId === initial.Base[field].itemId &&
      initial.Sink[field].frontSheetPrice === initial.Base[field].frontSheetPrice &&
      initial.Sink[field].backSheetPrice === initial.Base[field].backSheetPrice &&
      initial.Sink[field].boardSheetPrice === initial.Base[field].boardSheetPrice))) restored.Sink = "Base";
    return restored;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [syncWarning, setSyncWarning] = useState("");

  const effective = (zone: KitchenZone, seen = new Set<KitchenZone>()): ZoneMaterials => {
    if (seen.has(zone)) return zones[zone];
    seen.add(zone);
    const source = sources[zone];
    if (source === "All") return all;
    if (source !== "Own") return effective(source, seen);
    return zones[zone];
  };
  const update = (zone: KitchenZone | "All", field: MaterialField, change: Partial<MaterialChoice>) => {
    const missing = new Set<MaterialField>();
    if (zone === "All") {
      const allUpdated = updateMaterialChoices(all, field, change, options);
      allUpdated.unmatched.forEach((target) => missing.add(target));
      const snapshots = Object.fromEntries(KITCHEN_ZONES.map((current) => {
        const updated = updateMaterialChoices(effective(current), field, change, options);
        updated.unmatched.forEach((target) => missing.add(target));
        return [current, updated.choices];
      })) as unknown as KitchenMaterials;
      setAll(allUpdated.choices);
      setZones(snapshots);
      // Material sources apply to whole zones. Snapshotting before this one-field
      // broadcast keeps unrelated, zone-specific choices intact.
      setSources(Object.fromEntries(KITCHEN_ZONES.map((current) => [current, "Own"])) as Record<KitchenZone, MaterialSource>);
    }
    else {
      const updated = updateMaterialChoices(zones[zone], field, change, options);
      updated.unmatched.forEach((target) => missing.add(target));
      setZones((old) => ({ ...old, [zone]: updated.choices }));
    }
    setSyncWarning(missing.size ? `No matching master board for ${[...missing].map((target) => GROUPS[target].label).join(" and ")}. Those selections were left unchanged.` : "");
  };
  const changeSource = (zone: KitchenZone, source: MaterialSource) => {
    if (source !== "Own" && source !== "All" && createsMaterialSourceCycle(zone, source, sources)) {
      const sourceSnapshot = copyZone(effective(source));
      setZones((old) => ({ ...old, [source]: sourceSnapshot }));
      setSources((old) => ({ ...old, [source]: "Own", [zone]: source }));
      return;
    }
    if (source === "Own" && sources[zone] !== "Own") {
      setZones((old) => ({ ...old, [zone]: copyZone(effective(zone)) }));
    }
    setSources((old) => ({ ...old, [zone]: source }));
  };

  function materialCards(section: KitchenZone | "All", choices: ZoneMaterials, disabled: boolean) {
    return <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(225px,1fr))", gap: 12, minWidth: 1185 }}>
      {MATERIAL_FIELDS.map((field) => {
        const meta = GROUPS[field];
        const available = options.filter((option) => option.group === meta.group && (field !== "visible" || [18, 25].includes(option.thicknessMm ?? 0)));
        const selected = choices[field];
        const selectedOption = available.find((option) => option.id === selected.itemId);
        const postlam = selectedOption && typeOf(selectedOption) === "Postlam";
        const boardWithSeparateRate = selectedOption && ["Prelam", "Postlam"].includes(typeOf(selectedOption));
        const types = (field === "shutter" || field === "visible" ? ["Prelam", "Postlam", "PU", "Membrane"] : ["Prelam", "Postlam"])
          .filter((type) => available.some((option) => typeOf(option) === type));
        return <div key={field} style={{ border: "1px solid #dae2dc", borderRadius: 7, padding: 12, background: "white", minWidth: 0 }}>
          <strong style={{ display: "block", marginBottom: 10 }}>{meta.label}</strong>
          <label style={{ display: "grid", gap: 5 }}>Subgroup
            <select aria-label={`${section} ${meta.label}`} value={selected.itemId} disabled={disabled} onChange={(event) => update(section, field, { itemId: event.target.value, boardSheetPrice: undefined })} style={fieldStyle}>
              {types.map((type) => <optgroup key={type} label={type}>{available.filter((option) => typeOf(option) === type).map((option) =>
                <option key={option.id} value={option.id}>{option.subgroup} · {option.thicknessMm ?? "—"} mm</option>)}</optgroup>)}
            </select>
          </label>
          <small style={{ color: "#65786e" }}>Kitchen item: {selected.itemId}</small>
          {boardWithSeparateRate && <label style={{ display: "grid", gap: 4, marginTop: 12 }}>{postlam ? "Postlam raw board" : "Prelam board"} · ₹ / 32 sqft sheet
            <input aria-label={`${section} ${meta.label} ${postlam ? "Postlam raw board" : "Prelam board"} sheet price`} type="number" min="0" max="1000000" step="any" inputMode="decimal"
              value={selected.boardSheetPrice ?? selectedOption.boardSheetPrice} disabled={disabled}
              onChange={(event) => update(section, field, { boardSheetPrice: event.target.value })} style={fieldStyle} />
          </label>}
          {boardWithSeparateRate && (field === "back" || field === "drawer") && selected.boardSheetPrice !== undefined &&
            selected.boardSheetPrice !== selectedOption.boardSheetPrice &&
            <button type="button" disabled={disabled} onClick={() => update(section, field, { boardSheetPrice: undefined })}
              style={{ border: 0, background: "none", padding: "7px 0 0", color: "#17645b", cursor: "pointer", textAlign: "left" }}>
              Use this board’s master price: ₹{selectedOption.boardSheetPrice} / sheet
            </button>}
          {postlam && <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <label style={{ display: "grid", gap: 4 }}>Front laminate · ₹ / 32 sqft sheet
              <input type="number" min="0" max="1000000" step="0.01" inputMode="decimal" value={selected.frontSheetPrice} disabled={disabled}
                onChange={(event) => update(section, field, { frontSheetPrice: event.target.value })} style={fieldStyle} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>Back laminate · ₹ / 32 sqft sheet
              <input type="number" min="0" max="1000000" step="0.01" inputMode="decimal" value={selected.backSheetPrice} disabled={disabled}
                onChange={(event) => update(section, field, { backSheetPrice: event.target.value })} style={fieldStyle} />
            </label>
          </div>}
        </div>;
      })}
    </div>;
  }

  async function continueToBuilder() {
    setBusy(true); setError("");
    try {
      const selected = Object.fromEntries(KITCHEN_ZONES.map((zone) => [zone, copyZone(effective(zone))])) as unknown as KitchenMaterials;
      selected._sources = { ...sources };
      selected._hingeChoice = `${hingeBrand} ${hingeType}`;
      selected._drawerBrand = drawerBrand;
      selected._handleDefaults = { ...handleDefaults };
      const response = await fetch("/api/kitchen-materials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selected) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setError(result.error ?? "Could not apply material choices.");
        return;
      }
      router.push("/builder");
    } catch { setError("Could not reach the server."); }
    finally { setBusy(false); }
  }

  return <main style={{ minHeight: "100vh", padding: "24px clamp(12px,3vw,40px)", background: "#f3f5f3", color: "#1b2430", font: "13px system-ui,sans-serif" }}>
    <div style={{ maxWidth: 1600, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", marginBottom: 18 }}>
        <div><h1 style={{ margin: "0 0 5px", fontSize: 25 }}>Kitchen material selection</h1>
          <p style={{ margin: 0, color: "#607168" }}>Choose the materials for this kitchen before opening the Builder. These choices are not added to the admin master.</p></div>
        <UserSignOut />
      </header>
      <nav className="kitchen-step-nav" aria-label="Kitchen setup steps" style={{ marginBottom: 15, paddingLeft: 0 }}>
        <span aria-current="page">1 · Material selection</span>
        <button type="button" disabled={busy} onClick={() => void continueToBuilder()}>2 · Builder configuration</button>
      </nav>
      <section style={{ background: "#fff", border: "1px solid #d6dfd8", borderRadius: 8, padding: 16, marginBottom: 15 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 5px" }}>Hinges for this kitchen</h2>
        <p style={{ color: "#607168", margin: "0 0 13px" }}>Choose the brand and type once. These apply across this kitchen.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 5 }}>Hinge brand
            <select value={hingeBrand} onChange={(event) => setHingeBrand(event.target.value)} style={fieldStyle}>
              {["Hettich", "Hafele", "Blum", "Magppie"].map((brand) => <option key={brand} value={brand}>{brand}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 5 }}>Hinge type
            <select value={hingeType} onChange={(event) => setHingeType(event.target.value)} style={fieldStyle}>
              <option value="Soft Close">Soft Close</option><option value="Non Soft Close">Non Soft Close</option>
            </select>
          </label>
        </div>
      </section>
      <section style={{ background: "#fff", border: "1px solid #d6dfd8", borderRadius: 8, padding: 16, marginBottom: 15 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 5px" }}>Drawers for this kitchen</h2>
        <p style={{ color: "#607168", margin: "0 0 13px" }}>Choose the drawer system brand used for drawer cabinets.</p>
        <label style={{ display: "grid", gap: 5, maxWidth: 420 }}>Drawer brand
          <select value={drawerBrand} onChange={(event) => setDrawerBrand(event.target.value)} style={fieldStyle}>
            {DRAWER_BRANDS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
          </select>
        </label>
      </section>
      <section style={{ background: "#fff", border: "1px solid #d6dfd8", borderRadius: 8, padding: 16, marginBottom: 15 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 5px" }}>Handle / profile defaults</h2>
        <p style={{ color: "#607168", margin: "0 0 13px" }}>Choose a default per zone. Sink follows Base; Middle follows Wall. You can change a cabinet later.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(235px,1fr))", gap: 12 }}>
          {HANDLE_ZONES.map((zone) => <div key={zone} style={{ display: "grid", alignContent: "start", gap: 10, border: "1px solid #dae2dc", borderRadius: 7, padding: 12 }}>
            <label style={{ display: "grid", gap: 5 }}>{zone} cabinets · handle
              <select value={handleDefaults[zone].type} onChange={(event) => setHandleDefaults((old) => ({ ...old, [zone]: { ...old[zone], type: event.target.value as HandleSetting["type"] } }))} style={fieldStyle}>
                <option value="XCJ">C/J/G Gola</option><option value="PUSH">Push to Open</option><option value="KNOB">Knob</option><option value="HANDLE">Handle</option><option value="NONE">No Handle</option>
              </select>
            </label>
            {(["PUSH", "KNOB", "HANDLE"] as string[]).includes(handleDefaults[zone].type) && <label style={{ display: "grid", gap: 5 }}>Price · ₹ / piece
              <input type="number" min="0" step="0.01" value={handleDefaults[zone].price} onChange={(event) => setHandleDefaults((old) => ({ ...old, [zone]: { ...old[zone], price: event.target.value } }))} style={fieldStyle} />
            </label>}
            {handleDefaults[zone].type === "PUSH" && <label style={{ display: "grid", gap: 5 }}>Push to Open brand
              <select value={handleDefaults[zone].brand || "Hettich"} onChange={(event) => setHandleDefaults((old) => ({ ...old, [zone]: { ...old[zone], brand: event.target.value } }))} style={fieldStyle}>
                {["Hettich", "Hafele", "Blum", "Magppie"].map((brand) => <option key={brand} value={brand}>{brand}</option>)}
              </select>
            </label>}
          </div>)}
        </div>
      </section>
      <section style={{ background: "#fff", border: "1px solid #d6dfd8", borderRadius: 8, padding: 16, marginBottom: 15 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Material groups</h2>
        <p style={{ color: "#607168", margin: "0 0 12px" }}>Back and drawer material prices can be changed separately from carcass prices, even when their board subgroup matches.</p>
        <div role="tablist" aria-label="Cabinet material groups" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 15 }}>
          {(["All", ...KITCHEN_ZONES] as const).map((section) => <button key={section} type="button" role="tab" aria-selected={activeSection === section}
            onClick={() => setActiveSection(section)} style={{ padding: "9px 14px", border: "1px solid #cbd8d0", borderRadius: 30, background: activeSection === section ? "#17645b" : "white", color: activeSection === section ? "white" : "#496157", cursor: "pointer" }}>{section === "All" ? "All cabinets" : section}</button>)}
        </div>
        {activeSection === "All" && <div style={{ overflowX: "auto" }}>{materialCards("All", all, false)}</div>}
      {KITCHEN_ZONES.filter((zone) => zone === activeSection).map((zone) => {
        const inherited = sources[zone] !== "Own";
        return <div key={zone} style={{ background: inherited ? "#f9fbf9" : "#fff" }}>
          <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>{zone} cabinets</h2>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>Materials from
              <select aria-label={`${zone} material source`} value={sources[zone]} onChange={(event) => changeSource(zone, event.target.value as MaterialSource)}
                style={{ ...fieldStyle, width: "auto", minWidth: 190 }}>
                <option value="Own">Choose separately</option>
                <option value="All">All cabinets</option>
                {KITCHEN_ZONES.filter((candidate) => candidate !== zone).map((candidate) => <option key={candidate} value={candidate}>{candidate} cabinets</option>)}
              </select>
            </label>
          </header>
          <div style={{ overflowX: "auto" }}>{materialCards(zone, effective(zone), inherited)}</div>
        </div>;
      })}
      </section>
      {syncWarning && <p role="status" style={{ color: "#945615" }}>{syncWarning}</p>}
      {error && <p role="alert" style={{ color: "#a4412e" }}>{error}</p>}
      <button type="button" disabled={busy} onClick={() => void continueToBuilder()} style={{ padding: "11px 18px", border: 0, borderRadius: 6, background: "#15645a", color: "white", font: "inherit", fontWeight: 700, cursor: "pointer" }}>{busy ? "Applying…" : "Continue to Builder →"}</button>
    </div>
  </main>;
}
