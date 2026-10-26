"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserSignOut } from "@/components/UserSignOut";
import { SINK_STONE_BOARD_ID } from "@/lib/costing";
import edgebandFinishesData from "@/data/edgeband_finishes.json";
import boardFinishesData from "@/data/board_finishes.json";
import { DRAWER_BRANDS, KITCHEN_ZONES, HANDLE_ZONES, DEFAULT_MATERIAL_SOURCES, MATERIAL_FIELDS, createsMaterialSourceCycle, handleSettingFor, edgeBandForMaterial, stoneSlabAreaFromDimensions, type HandleSetting, type HandleZone, type KitchenMaterials, type KitchenZone, type MaterialSource, type MaterialChoice, type MaterialField, type ZoneMaterials, type SpecialWallMaterials, type SpecialWallSource, type EdgeBandChoice } from "@/lib/kitchen-materials";
import { activeKitchenId, readKitchenWorkspace, setActiveKitchenId, writeKitchenWorkspace, type KitchenWorkspaceEntry } from "@/lib/kitchen-workspace";

type Option = { id: string; group: string; subgroup: string; thicknessMm: number | null; type: string; boardSheetPrice: string; currentRate?: number };
type MaterialSection = KitchenZone | "All" | "Wall Open Shelf" | "Wall Glass Shutter";
const MATERIAL_SECTIONS: MaterialSection[] = ["All", "Base", "Sink", "Wall", "Wall Open Shelf", "Wall Glass Shutter", "Tall", "Loft", "Mid"];
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
  return Object.fromEntries(MATERIAL_FIELDS.map((field) => [field, { itemId: DEFAULT_IDS[field], frontSheetPrice: "550", backSheetPrice: "550" }])) as unknown as ZoneMaterials;
}
function copyZone(zone: ZoneMaterials): ZoneMaterials {
  return { ...Object.fromEntries(MATERIAL_FIELDS.map((field) => [field, {
    ...zone[field], backSheetPrice: field === "shutter" || field === "visible" ? zone[field].backSheetPrice : zone[field].frontSheetPrice,
  }])), glassCarcassLaminate: zone.glassCarcassLaminate ? { ...zone.glassCarcassLaminate } : undefined,
  edgeBand: zone.edgeBand ? { ...zone.edgeBand, byMaterial: zone.edgeBand.byMaterial ? { ...zone.edgeBand.byMaterial } : undefined } : undefined } as ZoneMaterials;
}
function defaultEdgeBand(options: Option[]): EdgeBandChoice {
  return { finish: (edgebandFinishesData as string[])[0] ?? "White 0.8mm",
    carcassPricePerRmt: String(options.find((option) => option.group === "Edge Band" && option.subgroup === "Carcass")?.currentRate ?? 6),
    shutterPricePerRmt: String(options.find((option) => option.group === "Edge Band" && option.subgroup === "Shutter")?.currentRate ?? 10.3) };
}
function defaultMaterials(): KitchenMaterials {
  return Object.fromEntries(KITCHEN_ZONES.map((zone) => [zone, defaultZone()])) as unknown as KitchenMaterials;
}
function defaultSpecialWall(zone: ZoneMaterials, glass: boolean, options: Option[]): SpecialWallMaterials {
  const shutterBoard = options.find((option) => option.id === zone.shutter.itemId && option.group === "Shutter Material")
    ?? options.find((option) => option.id === DEFAULT_IDS.shutter);
  const glassItem = options.find((option) => option.id === "KITCHEN-GLASS-5-TINTED")
    ?? options.find((option) => option.group === "Glass Type");
  return {
    carcass: { ...zone.shutter, itemId: shutterBoard?.id ?? DEFAULT_IDS.shutter },
    back: { ...zone.back }, visible: { ...zone.visible },
    edgeBand: { ...(zone.edgeBand ?? defaultEdgeBand(options)), byMaterial: {
      ...zone.edgeBand?.byMaterial, carcass: edgeBandForMaterial(zone.edgeBand ?? defaultEdgeBand(options), "shutter"),
    } },
    ...(glass && glassItem ? { glass: { itemId: glassItem.id, pricePerSqft: String(glassItem.currentRate ?? 0) } } : {}),
  };
}
function specialWallSourceFor(materials: KitchenMaterials | undefined, kind: "open" | "glass", options: Option[]): SpecialWallSource {
  const saved = materials?._wallSpecialSources?.[kind];
  if (saved) return saved;
  const special = kind === "open" ? materials?._wallOpen : materials?._wallGlass;
  if (!special) return "Wall";
  const wallDefault = defaultSpecialWall(materials?.Wall ?? defaultZone(), kind === "glass", options);
  return (["carcass", "back", "visible"] as const).every((field) => JSON.stringify(special[field]) === JSON.stringify(wallDefault[field])) &&
    JSON.stringify(special.edgeBand) === JSON.stringify(wallDefault.edgeBand) ? "Wall" : "Own";
}
function typeOf(option: Option) {
  if (option.id === SINK_STONE_BOARD_ID) return "Stone";
  if (/^Membrane\b/i.test(option.subgroup)) return "Membrane";
  if (/^PU\b/i.test(option.subgroup)) return "PU";
  return /POSTLAM/i.test(option.type) ? "Postlam" : "Prelam";
}
const SYNC_TARGETS: Partial<Record<MaterialField, MaterialField[]>> = {
  carcass: ["back", "drawer"],
  shutter: ["visible"],
};

export function updateMaterialChoices(choices: ZoneMaterials, field: MaterialField, change: Partial<MaterialChoice>, options: Option[]) {
  const next = copyZone(choices);
  next[field] = { ...next[field], ...change };
  if (change.itemId !== undefined && change.itemId !== choices[field].itemId &&
      (change.itemId === SINK_STONE_BOARD_ID || choices[field].itemId === SINK_STONE_BOARD_ID)) {
    next[field].boardFinish = undefined;
    next[field].slabSqft = undefined;
    next[field].slabLengthMm = undefined;
    next[field].slabWidthMm = undefined;
  }
  if (change.frontSheetPrice !== undefined && field !== "shutter" && field !== "visible") next[field].backSheetPrice = change.frontSheetPrice;
  if (field === "carcass" && change.frontSheetPrice !== undefined) {
    for (const target of ["back", "drawer"] as const) {
      next[target] = { ...next[target], frontSheetPrice: change.frontSheetPrice, backSheetPrice: change.frontSheetPrice };
    }
  }
  // Back and drawer boards follow a carcass subgroup change, but their 8/16 mm
  // raw-board prices belong to their own material selections.
  if (field === "carcass" && change.itemId === undefined) return { choices: next, unmatched: [] as MaterialField[] };
  const unmatched: MaterialField[] = [];
  if (field === "carcass" && next.carcass.itemId === SINK_STONE_BOARD_ID) return { choices: next, unmatched };
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
        boardFinish: next[field].boardFinish,
      };
    }
  }
  return { choices: next, unmatched };
}

export function MaterialSelection({ options, initial }: { options: Option[]; initial?: KitchenMaterials }) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<MaterialSection>("All");
  const [allZonesExpanded, setAllZonesExpanded] = useState(false);
  const [hingeBrand, setHingeBrand] = useState(() => initial?._hingeChoice?.split(" ")[0] ?? "Hettich");
  const [hingeType, setHingeType] = useState(() => initial?._hingeChoice?.endsWith("Non Soft Close") ? "Non Soft Close" : "Soft Close");
  const [drawerBrand, setDrawerBrand] = useState(() => initial?._drawerBrand ?? "Hettich");
  const [handleDefaults, setHandleDefaults] = useState<Record<HandleZone, HandleSetting>>(() =>
    Object.fromEntries(HANDLE_ZONES.map((zone) => [zone, handleSettingFor(initial, zone)])) as Record<HandleZone, HandleSetting>);
  const normalizeVisible = (zone: ZoneMaterials): ZoneMaterials => {
    const copy = copyZone(zone);
    copy.edgeBand ??= defaultEdgeBand(options);
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
  const [wallOpen, setWallOpen] = useState<SpecialWallMaterials>(() => initial?._wallOpen ?? defaultSpecialWall(initial?.Wall ?? defaultZone(), false, options));
  const [wallGlass, setWallGlass] = useState<SpecialWallMaterials>(() => ({
    ...defaultSpecialWall(initial?.Wall ?? defaultZone(), true, options), ...initial?._wallGlass,
    glass: initial?._wallGlass?.glass ?? defaultSpecialWall(initial?.Wall ?? defaultZone(), true, options).glass,
  }));
  const [wallSpecialSources, setWallSpecialSources] = useState<{ open: SpecialWallSource; glass: SpecialWallSource }>(() => ({
    open: specialWallSourceFor(initial, "open", options), glass: specialWallSourceFor(initial, "glass", options),
  }));
  const [sinkStoneFullBack, setSinkStoneFullBack] = useState(initial?._sinkStoneFullBack ?? true);
  const [sources, setSources] = useState<Record<KitchenZone, MaterialSource>>(() => {
    if (!initial) return { ...DEFAULT_MATERIAL_SOURCES };
    const restored = Object.fromEntries(KITCHEN_ZONES.map((zone) => [zone, initial._sources?.[zone] ?? "Own"])) as Record<KitchenZone, MaterialSource>;
    if (!initial._sources && (!initial.Sink || MATERIAL_FIELDS.every((field) =>
      initial.Sink[field].itemId === initial.Base[field].itemId &&
      initial.Sink[field].frontSheetPrice === initial.Base[field].frontSheetPrice &&
      initial.Sink[field].backSheetPrice === initial.Base[field].backSheetPrice &&
      initial.Sink[field].boardSheetPrice === initial.Base[field].boardSheetPrice) &&
      JSON.stringify(initial.Sink.glassCarcassLaminate) === JSON.stringify(initial.Base.glassCarcassLaminate) &&
      JSON.stringify(initial.Sink.edgeBand) === JSON.stringify(initial.Base.edgeBand))) restored.Sink = "Base";
    return restored;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [syncWarning, setSyncWarning] = useState("");
  const [kitchens, setKitchens] = useState<KitchenWorkspaceEntry[]>([]);
  const [activeKitchen, setActiveKitchen] = useState("");
  const [kitchenName, setKitchenName] = useState("");
  const [kitchenNameDraft, setKitchenNameDraft] = useState("");
  useEffect(() => { setKitchenNameDraft(kitchenName); }, [kitchenName]);

  const loadKitchenMaterials = (selected: KitchenMaterials) => {
    setHingeBrand(selected._hingeChoice?.split(" ")[0] ?? "Hettich");
    setHingeType(selected._hingeChoice?.endsWith("Non Soft Close") ? "Non Soft Close" : "Soft Close");
    setDrawerBrand(selected._drawerBrand ?? "Hettich");
    setHandleDefaults(Object.fromEntries(HANDLE_ZONES.map((zone) => [zone, handleSettingFor(selected, zone)])) as Record<HandleZone, HandleSetting>);
    setAll(normalizeVisible(selected.Base ?? defaultZone()));
    setZones(Object.fromEntries(KITCHEN_ZONES.map((zone) => [zone, normalizeVisible(selected[zone] ?? selected.Base ?? defaultZone())])) as unknown as KitchenMaterials);
    setWallOpen(selected._wallOpen ?? defaultSpecialWall(selected.Wall ?? defaultZone(), false, options));
    setWallGlass({ ...defaultSpecialWall(selected.Wall ?? defaultZone(), true, options), ...selected._wallGlass,
      glass: selected._wallGlass?.glass ?? defaultSpecialWall(selected.Wall ?? defaultZone(), true, options).glass });
    setWallSpecialSources({ open: specialWallSourceFor(selected, "open", options), glass: specialWallSourceFor(selected, "glass", options) });
    setSinkStoneFullBack(selected._sinkStoneFullBack ?? true);
    setSources(Object.fromEntries(KITCHEN_ZONES.map((zone) => [zone, selected._sources?.[zone] ?? "Own"])) as Record<KitchenZone, MaterialSource>);
  };
  useEffect(() => {
    const entries = readKitchenWorkspace();
    if (!entries.length) {
      const first: KitchenWorkspaceEntry = { id: crypto.randomUUID(), name: "", rows: [], materials: initial };
      writeKitchenWorkspace([first]); setActiveKitchenId(first.id);
      setKitchens([first]); setActiveKitchen(first.id);
      return;
    }
    const selected = entries.find((entry) => entry.id === activeKitchenId()) ?? entries[0];
    setKitchens(entries); setActiveKitchen(selected.id); setKitchenName(selected.name);
    loadKitchenMaterials(selected.materials ?? defaultMaterials());
  // Read the active kitchen once when this page opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const updateSpecial = (current: SpecialWallMaterials): SpecialWallMaterials => {
        const next = { ...current };
        if (field === "back" || field === "visible") next[field] = { ...allUpdated.choices[field] };
        if (field === "shutter") {
          next.carcass = { ...allUpdated.choices.shutter };
          next.visible = { ...allUpdated.choices.visible };
        }
        if (field === "carcass") {
          const general = options.find((option) => option.id === allUpdated.choices.carcass.itemId);
          const matching = general && options.find((option) => option.group === "Shutter Material" &&
            option.subgroup.toLowerCase() === general.subgroup.toLowerCase() && option.thicknessMm === general.thicknessMm);
          next.carcass = { ...next.carcass, frontSheetPrice: allUpdated.choices.carcass.frontSheetPrice,
            backSheetPrice: allUpdated.choices.carcass.backSheetPrice,
            ...(matching ? { itemId: matching.id, boardSheetPrice: undefined } : {}) };
        }
        return next;
      };
      setWallOpen(updateSpecial);
      setWallGlass(updateSpecial);
    }
    else {
      const updated = updateMaterialChoices(zones[zone], field, change, options);
      updated.unmatched.forEach((target) => missing.add(target));
      setZones((old) => ({ ...old, [zone]: updated.choices }));
    }
    setSyncWarning(missing.size ? `No matching master board for ${[...missing].map((target) => GROUPS[target].label).join(" and ")}. Those selections were left unchanged.` : "");
  };
  const updateEdgeBand = (zone: KitchenZone | "All", field: MaterialField, change: Partial<{ finish: string; pricePerRmt: string }>) => {
    const withChoice = (choices: ZoneMaterials): ZoneMaterials => {
      const old = choices.edgeBand ?? defaultEdgeBand(options);
      return { ...copyZone(choices), edgeBand: { ...old, byMaterial: {
        ...old.byMaterial, [field]: { ...edgeBandForMaterial(old, field), ...change },
      } } };
    };
    if (zone === "All") {
      setAll(withChoice(all));
      setZones(Object.fromEntries(KITCHEN_ZONES.map((current) => [current, withChoice(effective(current))])) as unknown as KitchenMaterials);
      setSources(Object.fromEntries(KITCHEN_ZONES.map((current) => [current, "Own"])) as Record<KitchenZone, MaterialSource>);
      setWallOpen((old) => ({ ...old, edgeBand: withChoice({ ...defaultZone(), edgeBand: old.edgeBand }).edgeBand }));
      setWallGlass((old) => ({ ...old, edgeBand: withChoice({ ...defaultZone(), edgeBand: old.edgeBand }).edgeBand }));
    } else setZones((old) => ({ ...old, [zone]: withChoice(old[zone]) }));
  };

  function edgeBandFields(title: string, value: { finish: string; pricePerRmt: string }, change: (update: Partial<{ finish: string; pricePerRmt: string }>) => void, disabled = false) {
    const listId = `material-edge-band-finishes-${title.replace(/[^a-z0-9]/gi, "-")}`;
    return <div style={{ marginTop: 12, borderTop: "1px solid #e3e9e5", paddingTop: 12 }}>
      <strong style={{ display: "block", marginBottom: 10 }}>Edge band</strong>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 5 }}>Finish name
          <input aria-label={`${title} edge band finish`} list={listId} value={value.finish} disabled={disabled}
            onChange={(event) => change({ finish: event.target.value })} style={fieldStyle} />
          <datalist id={listId}>{(edgebandFinishesData as string[]).map((finish) => <option key={finish} value={finish} />)}</datalist>
        </label>
        <label style={{ display: "grid", gap: 5 }}>Rate · ₹ / RMT
          <input aria-label={`${title} edge band rate per RMT`} type="number" min="0" max="1000000" step="0.01" inputMode="decimal"
            value={value.pricePerRmt} disabled={disabled} onChange={(event) => change({ pricePerRmt: event.target.value })} style={fieldStyle} />
        </label>
      </div>
    </div>;
  }
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
        const available = options.filter((option) => option.group === meta.group &&
          (option.id !== SINK_STONE_BOARD_ID || (section === "Sink" && field === "carcass")) &&
          (field !== "visible" || [18, 25].includes(option.thicknessMm ?? 0)));
        const selected = choices[field];
        const selectedOption = available.find((option) => option.id === selected.itemId);
        const postlam = selectedOption && typeOf(selectedOption) === "Postlam";
        const boardWithSeparateRate = selectedOption && ["Prelam", "Postlam", "Stone"].includes(typeOf(selectedOption));
        const types = (field === "shutter" || field === "visible" ? ["Prelam", "Postlam", "PU", "Membrane"] :
          section === "Sink" && field === "carcass" ? ["Prelam", "Postlam", "Stone"] : ["Prelam", "Postlam"])
          .filter((type) => available.some((option) => typeOf(option) === type));
        return <div key={field} style={{ border: "1px solid #dae2dc", borderRadius: 7, padding: 12, background: "white", minWidth: 0 }}>
          <strong style={{ display: "block", marginBottom: 10 }}>{section === "Sink" && field === "carcass" ? "Sink cabinet material" : meta.label}</strong>
          <label style={{ display: "grid", gap: 5 }}>Subgroup
            <select aria-label={`${section} ${meta.label}`} value={selected.itemId} disabled={disabled} onChange={(event) => update(section, field, { itemId: event.target.value, boardSheetPrice: undefined })} style={fieldStyle}>
              {types.map((type) => <optgroup key={type} label={type}>{available.filter((option) => typeOf(option) === type).map((option) =>
                <option key={option.id} value={option.id}>{option.subgroup} · {option.thicknessMm ?? "—"} mm</option>)}</optgroup>)}
            </select>
          </label>
          <small style={{ color: "#65786e" }}>Kitchen item: {selected.itemId}</small>
          {boardWithSeparateRate && <label style={{ display: "grid", gap: 4, marginTop: 12 }}>{selected.itemId === SINK_STONE_BOARD_ID ? "Stone slab · ₹ / slab" : postlam ? "Postlam raw board · ₹ / 32 sqft sheet" : "Prelam board · ₹ / 32 sqft sheet"}
            <input aria-label={`${section} ${meta.label} ${selected.itemId === SINK_STONE_BOARD_ID ? "Stone board" : postlam ? "Postlam raw board" : "Prelam board"} sheet price`} type="number" min="0" max="1000000" step="any" inputMode="decimal"
              value={selected.boardSheetPrice ?? selectedOption.boardSheetPrice} disabled={disabled}
              onChange={(event) => update(section, field, { boardSheetPrice: event.target.value })} style={fieldStyle} />
          </label>}
          {selected.itemId === SINK_STONE_BOARD_ID && <>
            <label style={{ display: "grid", gap: 4, marginTop: 12 }}>Stone colour / finish
              <input aria-label="Sink stone colour or finish" value={selected.boardFinish ?? "Pearl White HG"} disabled={disabled}
                onChange={(event) => update(section, field, { boardFinish: event.target.value || undefined })} style={fieldStyle} />
            </label>
            {(["slabLengthMm", "slabWidthMm"] as const).map((dimension) => <label key={dimension} style={{ display: "grid", gap: 4, marginTop: 12 }}>
              Slab {dimension === "slabLengthMm" ? "length" : "width"} · mm
              <input aria-label={`Sink stone slab ${dimension === "slabLengthMm" ? "length" : "width"} mm`} type="number" min="1" max="10000" step="1"
                value={selected[dimension] ?? (dimension === "slabLengthMm" ? "2400" : "800")} disabled={disabled}
                onChange={(event) => {
                  const length = Number(dimension === "slabLengthMm" ? event.target.value : selected.slabLengthMm ?? "2400");
                  const width = Number(dimension === "slabWidthMm" ? event.target.value : selected.slabWidthMm ?? "800");
                  update(section, field, { [dimension]: event.target.value,
                    ...(length > 0 && width > 0 ? { slabSqft: stoneSlabAreaFromDimensions(length, width) } : {}) });
                }} style={fieldStyle} />
            </label>)}
            <label style={{ display: "grid", gap: 4, marginTop: 12 }}>Slab area · sqft (2400 × 800 mm ≈ 21 sqft)
              <input aria-label="Sink stone slab area sqft" type="number" min="1" max="1000" step="0.01" value={selected.slabSqft ?? "21"} disabled={disabled}
                onChange={(event) => update(section, field, { slabSqft: event.target.value })} style={fieldStyle} />
            </label>
          </>}
          {boardWithSeparateRate && (field === "back" || field === "drawer") && selected.boardSheetPrice !== undefined &&
            selected.boardSheetPrice !== selectedOption.boardSheetPrice &&
            <button type="button" disabled={disabled} onClick={() => update(section, field, { boardSheetPrice: undefined })}
              style={{ border: 0, background: "none", padding: "7px 0 0", color: "#17645b", cursor: "pointer", textAlign: "left" }}>
              Use this board’s master price: ₹{selectedOption.boardSheetPrice} / sheet
            </button>}
          {selectedOption && typeOf(selectedOption) === "Prelam" && <label style={{ display: "grid", gap: 4, marginTop: 12 }}>Prelam board finish
            <select aria-label={`${section} ${meta.label} prelam board finish`} value={selected.boardFinish ?? ""} disabled={disabled}
              onChange={(event) => update(section, field, { boardFinish: event.target.value || undefined })} style={fieldStyle}>
              <option value="">Use cabinet finish</option>
              {(boardFinishesData as string[]).map((finish) => <option key={finish} value={finish}>{finish}</option>)}
            </select>
          </label>}
          {postlam && <label style={{ display: "grid", gap: 4, marginTop: 12 }}>{field === "shutter" || field === "visible" ? "Front laminate" : "Laminate (both faces)"} · ₹ / 32 sqft sheet
            <input aria-label={`${section} ${meta.label} ${field === "shutter" || field === "visible" ? "front laminate" : "laminate"} sheet price`} type="number" min="0" max="1000000" step="0.01" inputMode="decimal" value={selected.frontSheetPrice} disabled={disabled}
              onChange={(event) => update(section, field, { frontSheetPrice: event.target.value })} style={fieldStyle} />
          </label>}
          {postlam && (field === "shutter" || field === "visible") && <label style={{ display: "grid", gap: 4, marginTop: 12 }}>Back laminate · ₹ / 32 sqft sheet
            <input aria-label={`${section} ${meta.label} back laminate sheet price`} type="number" min="0" max="1000000" step="0.01" inputMode="decimal" value={selected.backSheetPrice} disabled={disabled}
              onChange={(event) => update(section, field, { backSheetPrice: event.target.value })} style={fieldStyle} />
          </label>}
          {edgeBandFields(`${section} ${meta.label}`, edgeBandForMaterial(choices.edgeBand ?? defaultEdgeBand(options), field),
            (change) => updateEdgeBand(section, field, change), disabled)}
        </div>;
      })}
    </div>;
  }

  function zoneMaterialRow(zone: KitchenZone) {
    const inherited = sources[zone] !== "Own";
    return <div key={zone} aria-label={`${zone} cabinet materials`} style={{ background: inherited ? "#f9fbf9" : "#fff", borderTop: "1px solid #dae2dc", padding: "16px 0" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <h3 style={{ fontSize: 18, margin: 0 }}>{zone} cabinets</h3>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>Materials from
          <select aria-label={`${zone} material source`} value={sources[zone]} onChange={(event) => changeSource(zone, event.target.value as MaterialSource)}
            style={{ ...fieldStyle, width: "auto", minWidth: 190 }}>
            <option value="Own">Choose separately</option>
            <option value="All">All cabinets</option>
            {KITCHEN_ZONES.filter((candidate) => candidate !== zone).map((candidate) => <option key={candidate} value={candidate}>{candidate} cabinets</option>)}
          </select>
        </label>
      </header>
      {zone === "Sink" && inherited && <p style={{ margin: "0 0 12px", color: "#607168" }}>To choose Stone for sink cabinets, change “Materials from” to “Choose separately.”</p>}
      <div style={{ overflowX: "auto" }}>{materialCards(zone, effective(zone), inherited)}</div>
      {zone === "Sink" && <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <input type="checkbox" checked={sinkStoneFullBack} onChange={(event) => setSinkStoneFullBack(event.target.checked)} />
        Stone sink cabinet: include full stone back by default
      </label>}
    </div>;
  }

  const effectiveSpecialWall = (kind: "open" | "glass"): SpecialWallMaterials => {
    const saved = kind === "open" ? wallOpen : wallGlass;
    if (wallSpecialSources[kind] === "Own") return saved;
    return { ...defaultSpecialWall(effective("Wall"), kind === "glass", options), glass: saved.glass };
  };
  const changeSpecialWallSource = (kind: "open" | "glass", source: SpecialWallSource) => {
    if (source === "Own" && wallSpecialSources[kind] === "Wall") {
      const snapshot = effectiveSpecialWall(kind);
      if (kind === "open") setWallOpen(snapshot);
      else setWallGlass(snapshot);
    }
    setWallSpecialSources((old) => ({ ...old, [kind]: source }));
  };
  const updateSpecialWallField = (kind: "open" | "glass", field: "carcass" | "back" | "visible", change: Partial<MaterialChoice>) => {
    if (wallSpecialSources[kind] === "Wall") {
      const updated = updateMaterialChoices(effective("Wall"), field === "carcass" ? "shutter" : field, change, options);
      setZones((old) => ({ ...old, Wall: updated.choices }));
      setSources((old) => ({ ...old, Wall: "Own" }));
      setSyncWarning(updated.unmatched.length ? `No matching master board for ${updated.unmatched.map((target) => GROUPS[target].label).join(" and ")}. Those selections were left unchanged.` : "");
      return;
    }
    const setter = kind === "open" ? setWallOpen : setWallGlass;
    setter((old) => ({ ...old, [field]: { ...old[field], ...change } }));
  };
  const updateSpecialWallEdgeBand = (kind: "open" | "glass", field: "carcass" | "back" | "visible", change: Partial<{ finish: string; pricePerRmt: string }>) => {
    if (wallSpecialSources[kind] === "Wall") {
      const wall = effective("Wall");
      const edgeBand = wall.edgeBand ?? defaultEdgeBand(options);
      const target = field === "carcass" ? "shutter" : field;
      setZones((old) => ({ ...old, Wall: { ...copyZone(wall), edgeBand: { ...edgeBand, byMaterial: {
        ...edgeBand.byMaterial, [target]: { ...edgeBandForMaterial(edgeBand, target), ...change },
      } } } }));
      setSources((old) => ({ ...old, Wall: "Own" }));
      return;
    }
    const setter = kind === "open" ? setWallOpen : setWallGlass;
    setter((old) => {
      const edgeBand = old.edgeBand ?? defaultEdgeBand(options);
      return { ...old, edgeBand: { ...edgeBand, byMaterial: {
        ...edgeBand.byMaterial, [field]: { ...edgeBandForMaterial(edgeBand, field), ...change },
      } } };
    });
  };

  function specialWallSection(kind: "open" | "glass") {
    const glass = kind === "glass";
    const value = effectiveSpecialWall(kind);
    const setValue = glass ? setWallGlass : setWallOpen;
    const title = glass ? "Wall glass shutter units" : "Wall open shelf units";
    return <div aria-label={`${title} materials`} style={{ borderTop: "1px solid #dae2dc", padding: "16px 0" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{title}</h2>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>Materials from
          <select aria-label={`${title} material source`} value={wallSpecialSources[kind]}
            onChange={(event) => changeSpecialWallSource(kind, event.target.value as SpecialWallSource)}
            style={{ ...fieldStyle, width: "auto", minWidth: 190 }}>
            <option value="Wall">Wall shutter finish (shared)</option>
            <option value="Own">Choose separately</option>
          </select>
        </label>
      </header>
      <p style={{ color: "#607168", margin: "0 0 14px" }}>{glass
        ? "The carcass uses a shutter-board choice. Internal glass shelves remain 6 mm clear glass."
        : "The carcass and open shelves use the same shutter-board choice."}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(245px,1fr))", gap: 12 }}>
        {(["carcass", "back", "visible"] as const).map((field) => {
          const selected = value[field];
          const catalog = field === "carcass" || field === "visible" ? "Shutter Material" : "Carcass Back Material";
          const available = options.filter((option) => option.group === catalog && (field !== "visible" || [18, 25].includes(option.thicknessMm ?? 0)));
          const option = available.find((candidate) => candidate.id === selected.itemId);
          const postlam = option && typeOf(option) === "Postlam";
          const setField = (change: Partial<MaterialChoice>) => updateSpecialWallField(kind, field, change);
          const label = field === "carcass" ? "Carcass" : field === "back" ? "Carcass back" : "Visible panel";
          return <div key={field} style={{ border: "1px solid #dae2dc", borderRadius: 7, padding: 12 }}>
            <strong style={{ display: "block", marginBottom: 10 }}>{label}</strong>
            <label style={{ display: "grid", gap: 5 }}>Subgroup
              <select aria-label={`${title} ${label}`} value={selected.itemId} onChange={(event) => setField({ itemId: event.target.value, boardSheetPrice: undefined })} style={fieldStyle}>
                {available.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.subgroup} · {candidate.thicknessMm ?? "—"} mm</option>)}
              </select>
            </label>
            <small style={{ color: "#65786e" }}>Kitchen item: {selected.itemId}</small>
            {option && ["Prelam", "Postlam"].includes(typeOf(option)) && <label style={{ display: "grid", gap: 4, marginTop: 12 }}>Board · ₹ / 32 sqft sheet
              <input aria-label={`${title} ${label} board sheet price`} type="number" min="0" max="1000000" step="any" value={selected.boardSheetPrice ?? option.boardSheetPrice}
                onChange={(event) => setField({ boardSheetPrice: event.target.value })} style={fieldStyle} />
            </label>}
            {option && typeOf(option) === "Prelam" && <label style={{ display: "grid", gap: 4, marginTop: 12 }}>Prelam board finish
              <select aria-label={`${title} ${label} prelam board finish`} value={selected.boardFinish ?? ""}
                onChange={(event) => setField({ boardFinish: event.target.value || undefined })} style={fieldStyle}>
                <option value="">Use cabinet finish</option>
                {(boardFinishesData as string[]).map((finish) => <option key={finish} value={finish}>{finish}</option>)}
              </select>
            </label>}
            {postlam && (["carcass", "visible"].includes(field) ? (["frontSheetPrice", "backSheetPrice"] as const) : (["frontSheetPrice"] as const)).map((face) =>
              <label key={face} style={{ display: "grid", gap: 4, marginTop: 12 }}>{face === "frontSheetPrice" ? "Front laminate" : "Back laminate"} · ₹ / 32 sqft sheet
                <input aria-label={`${title} ${label} ${face === "frontSheetPrice" ? "front" : "back"} laminate price`} type="number" min="0" max="1000000" step="0.01" value={selected[face]}
                  onChange={(event) => setField(face === "frontSheetPrice" && field === "back"
                    ? { frontSheetPrice: event.target.value, backSheetPrice: event.target.value } : { [face]: event.target.value })} style={fieldStyle} />
              </label>)}
            {edgeBandFields(`${title} ${label}`, edgeBandForMaterial(value.edgeBand ?? defaultEdgeBand(options), field),
              (change) => updateSpecialWallEdgeBand(kind, field, change))}
          </div>;
        })}
        {glass && <div style={{ border: "1px solid #dae2dc", borderRadius: 7, padding: 12 }}>
          <strong style={{ display: "block", marginBottom: 10 }}>Glass shutter</strong>
          <label style={{ display: "grid", gap: 5 }}>Glass finish
            <select aria-label="Wall glass shutter finish" value={value.glass?.itemId ?? ""} onChange={(event) => {
              const item = options.find((candidate) => candidate.id === event.target.value);
              setValue((old) => ({ ...old, glass: { itemId: event.target.value, pricePerSqft: String(item?.currentRate ?? 0) } }));
            }} style={fieldStyle}>
              {options.filter((item) => item.group === "Glass Type").map((item) => <option key={item.id} value={item.id}>{item.subgroup}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, marginTop: 12 }}>Glass price · ₹ / sqft
            <input aria-label="Wall glass shutter price per sqft" type="number" min="0" max="1000000" step="0.01" value={value.glass?.pricePerSqft ?? ""}
              onChange={(event) => setValue((old) => ({ ...old, glass: { itemId: old.glass?.itemId ?? "", pricePerSqft: event.target.value } }))} style={fieldStyle} />
          </label>
        </div>}
      </div>
    </div>;
  }

  const selectedMaterials = () => {
    const selected = Object.fromEntries(KITCHEN_ZONES.map((zone) => [zone, copyZone(effective(zone))])) as unknown as KitchenMaterials;
    selected._sources = { ...sources };
    selected._hingeChoice = `${hingeBrand} ${hingeType}`;
    selected._drawerBrand = drawerBrand;
    selected._handleDefaults = { ...handleDefaults };
    selected._wallOpen = effectiveSpecialWall("open");
    selected._wallGlass = effectiveSpecialWall("glass");
    selected._wallSpecialSources = { ...wallSpecialSources };
    selected._sinkStoneFullBack = sinkStoneFullBack;
    return selected;
  };
  const saveKitchenSelection = () => {
    const selected = selectedMaterials();
    if (activeKitchen) {
      const entries = readKitchenWorkspace().map((entry) => entry.id === activeKitchen
        ? { ...entry, name: kitchenName, materials: selected } : entry);
      writeKitchenWorkspace(entries); setKitchens(entries);
    }
    return selected;
  };
  const switchKitchen = (id: string) => {
    saveKitchenSelection();
    const selected = readKitchenWorkspace().find((entry) => entry.id === id);
    if (!selected) return;
    setActiveKitchenId(id); setActiveKitchen(id); setKitchenName(selected.name);
    loadKitchenMaterials(selected.materials ?? initial ?? defaultMaterials());
  };
  const renameKitchen = (name: string) => {
    setKitchenName(name);
    const entries = readKitchenWorkspace().map((entry) => entry.id === activeKitchen ? { ...entry, name } : entry);
    writeKitchenWorkspace(entries); setKitchens(entries);
  };
  const removeImportedKitchen = () => {
    const current = kitchens.find((entry) => entry.id === activeKitchen);
    if (!current?.sourceName || !window.confirm(`Remove ${current.name || current.sourceName} and its locally saved cabinets, materials, and costing?`)) return;
    const remaining = readKitchenWorkspace().filter((entry) => entry.id !== current.id);
    const next = remaining[0] ?? { id: crypto.randomUUID(), name: "", rows: [], materials: defaultMaterials() };
    const updated = remaining.length ? remaining : [next];
    writeKitchenWorkspace(updated); setKitchens(updated);
    setActiveKitchenId(next.id); setActiveKitchen(next.id); setKitchenName(next.name);
    loadKitchenMaterials(next.materials ?? defaultMaterials());
  };

  async function continueToBuilder() {
    setBusy(true); setError("");
    try {
      const selected = saveKitchenSelection();
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
      <section style={{ background: "#fff", border: "1px solid #d6dfd8", borderRadius: 8, padding: 16, marginBottom: 15, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 5, minWidth: 230 }}>Kitchen
          <select aria-label="Select kitchen" value={activeKitchen} onChange={(event) => switchKitchen(event.target.value)} style={fieldStyle}>
            {kitchens.map((entry, index) => <option key={entry.id} value={entry.id}>{entry.name.trim() || entry.sourceName || `Kitchen ${index + 1}`}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 5, minWidth: 250 }}>Kitchen name (required for costing downloads)
          <input aria-label="Kitchen name" value={kitchenNameDraft} onChange={(event) => setKitchenNameDraft(event.target.value)} style={fieldStyle} placeholder="Enter kitchen name" />
        </label>
        <button type="button" disabled={!kitchenNameDraft.trim() || kitchenNameDraft.trim() === kitchenName.trim()} onClick={() => renameKitchen(kitchenNameDraft.trim())}>Save name</button>
        {kitchens.find((entry) => entry.id === activeKitchen)?.sourceName &&
          <button type="button" onClick={removeImportedKitchen}>Remove imported PDF</button>}
      </section>
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
                {(zone === "Base" || zone === "Tall") && <option value="XCJ">C/J/G Gola</option>}<option value="PUSH">Push to Open</option><option value="KNOB">Knob</option><option value="HANDLE">Handle</option><option value="NONE">No Handle</option>
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
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Material groups</h2>
          <button type="button" aria-pressed={allZonesExpanded} aria-controls="material-zone-rows"
            onClick={() => setAllZonesExpanded((expanded) => !expanded)}
            style={{ padding: "9px 14px", border: "1px solid #17645b", borderRadius: 6, background: allZonesExpanded ? "#17645b" : "white", color: allZonesExpanded ? "white" : "#17645b", font: "inherit", cursor: "pointer" }}>
            {allZonesExpanded ? "Collapse all zones" : "Expand all zones"}
          </button>
        </header>
        <p style={{ color: "#607168", margin: "0 0 12px" }}>Back and drawer raw-board prices remain separate. The carcass laminate price fills their laminate prices; you can then change either one individually.</p>
        <div role="tablist" aria-label="Cabinet material groups" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 15 }}>
          {MATERIAL_SECTIONS.map((section) => <button key={section} type="button" role="tab" aria-selected={!allZonesExpanded && activeSection === section}
            onClick={() => { setActiveSection(section); setAllZonesExpanded(false); }} style={{ padding: "9px 14px", border: "1px solid #cbd8d0", borderRadius: 30, background: !allZonesExpanded && activeSection === section ? "#17645b" : "white", color: !allZonesExpanded && activeSection === section ? "white" : "#496157", cursor: "pointer" }}>{section === "All" ? "All cabinets" : section}</button>)}
        </div>
        <div id="material-zone-rows">
          {(allZonesExpanded || activeSection === "All") && <div style={{ overflowX: "auto", paddingBottom: allZonesExpanded ? 16 : 0 }}>
            {allZonesExpanded && <h3 style={{ fontSize: 18, margin: "0 0 12px" }}>All cabinets</h3>}
            {materialCards("All", all, false)}
          </div>}
          {(allZonesExpanded ? KITCHEN_ZONES : KITCHEN_ZONES.filter((zone) => zone === activeSection)).map(zoneMaterialRow)}
          {(allZonesExpanded || activeSection === "Wall Open Shelf") && specialWallSection("open")}
          {(allZonesExpanded || activeSection === "Wall Glass Shutter") && specialWallSection("glass")}
        </div>
      </section>
      {syncWarning && <p role="status" style={{ color: "#945615" }}>{syncWarning}</p>}
      {error && <p role="alert" style={{ color: "#a4412e" }}>{error}</p>}
      <button type="button" disabled={busy} onClick={() => void continueToBuilder()} style={{ padding: "11px 18px", border: 0, borderRadius: 6, background: "#15645a", color: "white", font: "inherit", fontWeight: 700, cursor: "pointer" }}>{busy ? "Applying…" : "Continue to Builder →"}</button>
    </div>
  </main>;
}
