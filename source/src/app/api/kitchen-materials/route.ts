import { NextResponse } from "next/server";
import { COSTING_ITEMS, SINK_STONE_BOARD_ID } from "@/lib/costing";
import { currentUser, userSession, setSessionMaterials } from "@/lib/user-session";
import { DRAWER_BRANDS, KITCHEN_ZONES, HANDLE_ZONES, HANDLE_TYPES, MATERIAL_FIELDS, createsMaterialSourceCycle, validBoardSheetPrice, validStoneDimension, type KitchenMaterials, type MaterialField, type MaterialSource, type SpecialWallMaterials } from "@/lib/kitchen-materials";

const GROUP: Record<MaterialField, string> = {
  carcass: "Carcass/ Shelf Material", back: "Carcass Back Material", drawer: "Drawer Material",
  shutter: "Shutter Material", visible: "Shutter Material",
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function POST(request: Request) {
  if (!await currentUser()) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 12000) return NextResponse.json({ error: "Material selection is too large." }, { status: 413 });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Invalid materials." }, { status: 400 });
  const materials = value as KitchenMaterials;
  const validEdgeBand = (edge: unknown) => edge && typeof edge === "object" &&
    typeof (edge as { finish?: unknown }).finish === "string" &&
    /^(?=.{1,80}$)[\p{L}\p{N} ._()+&/-]+$/u.test((edge as { finish: string }).finish) &&
    ["carcassPricePerRmt", "shutterPricePerRmt"].every((key) => {
      const price = (edge as Record<string, unknown>)[key];
      return typeof price === "string" && /^(?:\d{1,7})(?:\.\d{1,2})?$/.test(price) && Number(price) <= 1000000;
    }) && (() => {
      const byMaterial = (edge as Record<string, unknown>).byMaterial;
      if (byMaterial === undefined) return true;
      if (!byMaterial || typeof byMaterial !== "object" || Array.isArray(byMaterial)) return false;
      return Object.entries(byMaterial).every(([field, value]) => MATERIAL_FIELDS.includes(field as typeof MATERIAL_FIELDS[number]) &&
        !!value && typeof value === "object" &&
        typeof (value as { finish?: unknown }).finish === "string" &&
        /^(?=.{1,80}$)[\p{L}\p{N} ._()+&/-]+$/u.test((value as { finish: string }).finish) &&
        typeof (value as { pricePerRmt?: unknown }).pricePerRmt === "string" &&
        /^(?:\d{1,7})(?:\.\d{1,2})?$/.test((value as { pricePerRmt: string }).pricePerRmt) &&
        Number((value as { pricePerRmt: string }).pricePerRmt) <= 1000000);
    })();
  if (materials._sinkStoneFullBack !== undefined && typeof materials._sinkStoneFullBack !== "boolean") {
    return NextResponse.json({ error: "Invalid stone sink back default." }, { status: 400 });
  }
  if (materials._hingeChoice !== undefined && !["Hettich", "Hafele", "Blum", "Magppie"].some((brand) =>
    ["Soft Close", "Non Soft Close"].some((type) => materials._hingeChoice === `${brand} ${type}`))) {
    return NextResponse.json({ error: "Invalid kitchen hinge choice." }, { status: 400 });
  }
  if (materials._drawerBrand !== undefined && !DRAWER_BRANDS.some((brand) => brand === materials._drawerBrand)) {
    return NextResponse.json({ error: "Invalid kitchen drawer brand." }, { status: 400 });
  }
  if (materials._handleDefaults !== undefined && (!materials._handleDefaults ||
    !HANDLE_ZONES.every((zone) => {
      const choice = materials._handleDefaults?.[zone];
      if (choice === "STD" || choice === "XCJ") return true; // older saved selections
      return !!choice && typeof choice === "object" && HANDLE_TYPES.includes(choice.type) &&
        typeof choice.price === "string" && (choice.price === "" || /^(?:\d{1,7})(?:\.\d{1,2})?$/.test(choice.price)) &&
        typeof choice.brand === "string" && (choice.type !== "PUSH" || ["", "Hettich", "Hafele", "Blum", "Magppie"].includes(choice.brand));
    }))) {
    return NextResponse.json({ error: "Invalid handle defaults." }, { status: 400 });
  }
  if (materials._wallSpecialSources !== undefined && (!materials._wallSpecialSources ||
    !["open", "glass"].every((kind) => ["Wall", "Own"].includes(materials._wallSpecialSources?.[kind as "open" | "glass"] ?? "")))) {
    return NextResponse.json({ error: "Invalid wall-unit material sources." }, { status: 400 });
  }
  for (const zone of KITCHEN_ZONES) {
    if (!materials[zone] || typeof materials[zone] !== "object") return NextResponse.json({ error: `Missing ${zone} materials.` }, { status: 400 });
    if (materials[zone].edgeBand !== undefined && !validEdgeBand(materials[zone].edgeBand))
      return NextResponse.json({ error: `Invalid ${zone} edge band finish or price.` }, { status: 400 });
    const glass = materials[zone].glassCarcassLaminate;
    if (glass !== undefined && (!glass || typeof glass !== "object" ||
      [glass.frontSheetPrice, glass.backSheetPrice].some((price) =>
        typeof price !== "string" || !/^(?:\d{1,7})(?:\.\d{1,2})?$/.test(price) || Number(price) > 1000000))) {
      return NextResponse.json({ error: `Invalid ${zone} glass cabinet laminate price.` }, { status: 400 });
    }
    for (const field of MATERIAL_FIELDS) {
      const selection = materials[zone][field];
      if (!selection || typeof selection.itemId !== "string" || typeof selection.frontSheetPrice !== "string" || typeof selection.backSheetPrice !== "string") {
        return NextResponse.json({ error: `Invalid ${zone} ${field} selection.` }, { status: 400 });
      }
      const item = COSTING_ITEMS.find((candidate) => candidate.id === selection.itemId && candidate.group === GROUP[field] &&
        (field !== "visible" || [18, 25].includes(candidate.thicknessMm ?? 0)));
      if (!item) return NextResponse.json({ error: `Unknown ${zone} ${field} material.` }, { status: 400 });
      if (selection.boardSheetPrice !== undefined && !validBoardSheetPrice(selection.boardSheetPrice)) {
        return NextResponse.json({ error: `Invalid ${zone} ${field} board sheet price.` }, { status: 400 });
      }
      if (selection.boardFinish !== undefined && (typeof selection.boardFinish !== "string" ||
        !/^(?=.{1,80}$)[\p{L}\p{N} ._()+&/-]+$/u.test(selection.boardFinish))) {
        return NextResponse.json({ error: `Invalid ${zone} ${field} board finish.` }, { status: 400 });
      }
      if (selection.slabSqft !== undefined && (selection.itemId !== SINK_STONE_BOARD_ID ||
        typeof selection.slabSqft !== "string" || !/^\d{1,4}(?:\.\d{1,2})?$/.test(selection.slabSqft) ||
        Number(selection.slabSqft) <= 0 || Number(selection.slabSqft) > 1000)) {
        return NextResponse.json({ error: `Invalid ${zone} stone slab area.` }, { status: 400 });
      }
      if ([selection.slabLengthMm, selection.slabWidthMm].some((dimension) => dimension !== undefined &&
        (selection.itemId !== SINK_STONE_BOARD_ID || !validStoneDimension(dimension)))) {
        return NextResponse.json({ error: `Invalid ${zone} stone slab dimensions.` }, { status: 400 });
      }
      for (const price of [selection.frontSheetPrice, selection.backSheetPrice]) {
        if (!/^(?:\d{1,7})(?:\.\d{1,2})?$/.test(price) || Number(price) > 1000000) {
          return NextResponse.json({ error: `Invalid ${zone} laminate sheet price.` }, { status: 400 });
        }
      }
    }
  }
  for (const [key, kind] of [["_wallOpen", "open"], ["_wallGlass", "glass"]] as const) {
    const selection = materials[key];
    if (selection === undefined) continue;
    if (!selection || typeof selection !== "object") return NextResponse.json({ error: `Invalid ${kind} unit materials.` }, { status: 400 });
    if (selection.edgeBand !== undefined && !validEdgeBand(selection.edgeBand))
      return NextResponse.json({ error: `Invalid ${kind} unit edge band finish or price.` }, { status: 400 });
    for (const field of ["carcass", "back", "visible"] as const) {
      const choice = (selection as SpecialWallMaterials)[field];
      const group = field === "back" ? "Carcass Back Material" : "Shutter Material";
      if (!choice || typeof choice.itemId !== "string" || typeof choice.frontSheetPrice !== "string" || typeof choice.backSheetPrice !== "string" ||
          !COSTING_ITEMS.some((item) => item.id === choice.itemId && item.group === group && (field !== "visible" || [18, 25].includes(item.thicknessMm ?? 0))) ||
          (choice.boardSheetPrice !== undefined && !validBoardSheetPrice(choice.boardSheetPrice)) ||
          (choice.boardFinish !== undefined && (typeof choice.boardFinish !== "string" ||
            !/^(?=.{1,80}$)[\p{L}\p{N} ._()+&/-]+$/u.test(choice.boardFinish))) ||
          [choice.frontSheetPrice, choice.backSheetPrice].some((price) => !/^(?:\d{1,7})(?:\.\d{1,2})?$/.test(price) || Number(price) > 1000000)) {
        return NextResponse.json({ error: `Invalid ${kind} unit ${field} selection.` }, { status: 400 });
      }
    }
    if (kind === "glass" && (!selection.glass || !COSTING_ITEMS.some((item) => item.id === selection.glass?.itemId && item.group === "Glass Type" && item.type === "Shutter Glass" && item.thicknessMm === 5) ||
        typeof selection.glass.pricePerSqft !== "string" || !/^(?:\d{1,7})(?:\.\d{1,2})?$/.test(selection.glass.pricePerSqft) || Number(selection.glass.pricePerSqft) > 1000000)) {
      return NextResponse.json({ error: "Invalid wall glass shutter finish or price." }, { status: 400 });
    }
  }
  if (materials._sources !== undefined) {
    if (!materials._sources || typeof materials._sources !== "object" || Array.isArray(materials._sources)) {
      return NextResponse.json({ error: "Invalid material sources." }, { status: 400 });
    }
    const sources = materials._sources as Record<string, MaterialSource>;
    if (Object.keys(sources).some((zone) => !KITCHEN_ZONES.includes(zone as typeof KITCHEN_ZONES[number])) ||
      KITCHEN_ZONES.some((zone) => !["Own", "All", ...KITCHEN_ZONES].includes(sources[zone]))) {
      return NextResponse.json({ error: "Unknown material source." }, { status: 400 });
    }
    if (KITCHEN_ZONES.some((zone) => createsMaterialSourceCycle(zone, sources[zone], sources as Record<typeof KITCHEN_ZONES[number], MaterialSource>))) {
      return NextResponse.json({ error: "Material sources cannot reference each other in a loop." }, { status: 400 });
    }
  }
  const session = await userSession();
  setSessionMaterials(session, materials);
  try { await session.save(); } catch { return NextResponse.json({ error: "Selections are too large for the kitchen session." }, { status: 413 }); }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
