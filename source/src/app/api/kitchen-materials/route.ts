import { NextResponse } from "next/server";
import { COSTING_ITEMS } from "@/lib/costing";
import { currentUser, userSession, setSessionMaterials } from "@/lib/user-session";
import { DRAWER_BRANDS, KITCHEN_ZONES, HANDLE_ZONES, HANDLE_TYPES, MATERIAL_FIELDS, createsMaterialSourceCycle, validBoardSheetPrice, type KitchenMaterials, type MaterialField, type MaterialSource } from "@/lib/kitchen-materials";

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
  for (const zone of KITCHEN_ZONES) {
    if (!materials[zone] || typeof materials[zone] !== "object") return NextResponse.json({ error: `Missing ${zone} materials.` }, { status: 400 });
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
      for (const price of [selection.frontSheetPrice, selection.backSheetPrice]) {
        if (!/^(?:\d{1,7})(?:\.\d{1,2})?$/.test(price) || Number(price) > 1000000) {
          return NextResponse.json({ error: `Invalid ${zone} laminate sheet price.` }, { status: 400 });
        }
      }
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
